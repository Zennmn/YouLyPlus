const round = value => Math.round(value * 100) / 100;
const percentile = (sorted, fraction) => sorted.length ? sorted[Math.floor((sorted.length - 1) * fraction)] : null;
export function summarizeSamples(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return { count: sorted.length, mean: sorted.length ? round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
    p50: percentile(sorted, .5), p95: percentile(sorted, .95), max: sorted.at(-1) ?? null };
}

// No observer, sampling loop, or per-frame core wrapper exists until start().
// Reports contain timings/configuration only, never lyrics, URLs, tokens or keys.
export function createPerformanceDiagnostics({ env = globalThis, onComplete = () => {} } = {}) {
  const instances = new Set(), restorers = new Map();
  let session = null, frame, timer;
  const now = () => env.performance.now();
  const push = (list, value) => { if (list.length < 12000) list.push(value); };

  function instrument(instance) {
    if (!session || restorers.has(instance)) return;
    const restore = [];
    for (const name of ['update', 'setCurrentTime', 'calcLayout']) {
      const original = instance[name];
      if (typeof original !== 'function') continue;
      const own = Object.getOwnPropertyDescriptor(instance, name);
      const wrapped = function (...args) {
        const recording = session, start = now();
        try { return original.apply(this, args); }
        finally {
          if (recording && recording === session) push(recording.core[name], [round(start - recording.start), round(now() - start)]);
        }
      };
      instance[name] = wrapped;
      restore.push(() => { if (instance[name] === wrapped) { if (own) Object.defineProperty(instance, name, own); else delete instance[name]; } });
    }
    restorers.set(instance, () => { for (const undo of restore) undo(); restorers.delete(instance); });
  }

  function observe(type) {
    if (!env.PerformanceObserver?.supportedEntryTypes?.includes(type)) return;
    const recording = session;
    const consume = entries => {
      if (session !== recording) return;
      for (const entry of entries) {
        if (entry.startTime < recording.start) continue;
        // Save only numeric durations. Method timings include nested calls;
        // they must not be added together as exclusive CPU time.
        const item = { at: round(entry.startTime - recording.start), duration: round(entry.duration) };
        if (type === 'long-animation-frame') {
          item.blocking = round(entry.blockingDuration || 0);
          item.render = entry.renderStart > 0 ? round(entry.startTime + entry.duration - entry.renderStart) : 0;
          item.forcedLayout = round((entry.scripts || []).reduce((sum, script) => sum + (script.forcedStyleAndLayoutDuration || 0), 0));
        }
        push(recording.entries[type], item);
      }
    };
    try {
      const observer = new env.PerformanceObserver(list => consume(list.getEntries()));
      observer.observe({ type, buffered: false });
      recording.observers.push({ observer, consume });
      recording.supported.push(type);
    } catch { /* Some isolated worlds list an entry type but cannot observe it. */ }
  }

  function finish(reason = 'complete', notify = true) {
    if (!session) return null;
    const recording = session, end = now();
    env.cancelAnimationFrame(frame);
    env.clearTimeout(timer);
    env.document?.removeEventListener('visibilitychange', onVisibility);
    for (const { observer, consume } of recording.observers) {
      consume(observer.takeRecords());
      observer.disconnect();
    }
    for (const restore of [...restorers.values()]) restore();
    session = null;
    const intervals = recording.frames.slice(1).map((value, i) => round(value - recording.frames[i]));
    const sorted = [...intervals].sort((a, b) => a - b), cadence = percentile(sorted, .2);
    const changes = [];
    let repeated = 0, backwards = 0, discontinuities = 0;
    let lastChange = recording.ticks[0]?.[0] ?? 0, longestFrozenMs = 0;
    for (let i = 1; i < recording.ticks.length; i++) {
      const [wall, media] = recording.ticks[i], [previousWall, previousMedia] = recording.ticks[i - 1];
      if (media === previousMedia) repeated++;
      else {
        changes.push(round(wall - lastChange));
        longestFrozenMs = Math.max(longestFrozenMs, wall - lastChange);
        lastChange = wall;
        if (media < previousMedia - 2) backwards++;
        if (Math.abs(media - previousMedia - (wall - previousWall)) > 100) discontinuities++;
      }
    }
    if (recording.ticks.length) longestFrozenMs = Math.max(longestFrozenMs, end - recording.start - lastChange);
    const report = {
      schema: 'youlyplus-performance-v1', reason, elapsedMs: round(end - recording.start), context: recording.context,
      supportedObservers: recording.supported,
      frames: { ...summarizeSamples(intervals), callbackRateHz: intervals.length ? round(intervals.length * 1000 / (recording.frames.at(-1) - recording.frames[0])) : null,
        observedCadenceHz: cadence > 0 ? round(1000 / cadence) : null,
        slowIntervals: cadence > 0 ? intervals.filter(value => value > cadence * 1.5).length : null,
        over50ms: intervals.filter(value => value > 50).length },
      timeline: { samples: recording.ticks.length, repeated, backwards, discontinuities, longestFrozenMs: round(longestFrozenMs), changeIntervals: summarizeSamples(changes) },
      core: Object.fromEntries(Object.entries(recording.core).map(([name, samples]) => [name, summarizeSamples(samples.map(value => value[1]))])),
      longTasks: summarizeSamples(recording.entries.longtask.map(entry => entry.duration)),
      longAnimationFrames: summarizeSamples(recording.entries['long-animation-frame'].map(entry => entry.duration)),
      samples: { frameTimes: recording.frames, timeline: recording.ticks, core: recording.core, ...recording.entries },
      limits: [
        'RAF callback cadence is not presented-frame FPS or the monitor refresh rate; uniform throttling cannot be identified from RAF alone.',
        'Core timings measure synchronous JavaScript only, with inclusive/nested durations; async work, paint, GPU and other page code need a DevTools Performance trace for attribution.',
        'Observers cover the page when available; unsupported observers mean unavailable data, not zero blocking.',
        'Sampling is capped at 12000 entries per series and adds a small recording overhead.',
      ],
    };
    if (notify) onComplete(report);
    return report;
  }
  function onVisibility() { if (env.document.hidden) finish('hidden'); }
  return {
    get active() { return session !== null; },
    wrapPlayerClass(Base) {
      return class DiagnosticLyricPlayer extends Base {
        constructor(...args) { super(...args); instances.add(this); instrument(this); }
        dispose(...args) { restorers.get(this)?.(); instances.delete(this); return super.dispose(...args); }
      };
    },
    start(context = {}) {
      if (session || env.document?.hidden) return false;
      session = { start: now(), context: structuredClone(context), frames: [], ticks: [],
        core: { update: [], setCurrentTime: [], calcLayout: [] },
        entries: { longtask: [], 'long-animation-frame': [] }, supported: [], observers: [] };
      for (const instance of instances) instrument(instance);
      observe('longtask'); observe('long-animation-frame');
      env.document?.addEventListener('visibilitychange', onVisibility);
      const recording = session;
      const sampleFrame = () => {
        if (session !== recording) return;
        push(recording.frames, round(now() - recording.start));
        frame = env.requestAnimationFrame(sampleFrame);
      };
      frame = env.requestAnimationFrame(sampleFrame);
      timer = env.setTimeout(() => finish(), 20000);
      return true;
    },
    sampleTime(seconds) { if (session && Number.isFinite(seconds)) push(session.ticks, [round(now() - session.start), round(seconds * 1000)]); },
    finish,
    dispose() { finish('disposed', false); instances.clear(); },
  };
}
