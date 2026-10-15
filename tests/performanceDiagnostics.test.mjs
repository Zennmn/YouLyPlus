import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceDiagnostics } from '../ui/applemusic-player/performanceDiagnostics.mjs';

function harness(supported = ['longtask', 'long-animation-frame']) {
  let time = 0, id = 0;
  const raf = new Map(), timers = new Map(), listeners = new Map(), observers = [], reports = [];
  const env = { performance: { now: () => time },
    requestAnimationFrame: fn => { raf.set(++id, fn); return id; }, cancelAnimationFrame: key => raf.delete(key),
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
    document: { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
    PerformanceObserver: class {
      static supportedEntryTypes = supported;
      constructor(fn) { this.fn = fn; this.pending = []; observers.push(this); }
      observe({ type }) { this.type = type; }
      takeRecords() { return this.pending.splice(0); }
      disconnect() { this.disconnected = true; }
    },
  };
  const diagnostics = createPerformanceDiagnostics({ env, onComplete: report => reports.push(report) });
  class Core {
    update(delta) { time += 2; return delta; }
    setCurrentTime(value) { time += 1; this.time = value; }
    calcLayout() { time += 3; throw new Error('layout failed'); }
    dispose() { this.disposed = true; }
  }
  const Wrapped = diagnostics.wrapPlayerClass(Core);
  const core = new Wrapped();
  return { diagnostics, core, Core, Wrapped, env, raf, timers, listeners, observers, reports,
    at: value => { time = value; },
    frame(value) { time = value; const callbacks = [...raf.values()]; raf.clear(); for (const fn of callbacks) fn(value); },
    complete() { const callbacks = [...timers.values()]; timers.clear(); for (const fn of callbacks) fn(); },
  };
}

test('diagnostics add no idle RAF/observers or core method wrapper and restore methods after capture', () => {
  const h = harness();
  assert.equal(h.raf.size, 0); assert.equal(h.observers.length, 0);
  assert.equal(h.core.update, h.Core.prototype.update);
  h.diagnostics.sampleTime(1);
  h.diagnostics.start({ blur: true });
  assert.notEqual(h.core.update, h.Core.prototype.update);
  assert.equal(h.core.update(17), 17);
  h.core.setCurrentTime(40);
  assert.equal(h.core.time, 40);
  assert.throws(() => h.core.calcLayout(), /layout failed/);
  const report = h.diagnostics.finish();
  assert.equal(report.core.update.mean, 2);
  assert.equal(report.core.setCurrentTime.mean, 1);
  assert.equal(report.core.calcLayout.mean, 3);
  assert.equal(h.core.update, h.Core.prototype.update);
  assert.equal(h.raf.size, 0); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
  assert.ok(h.observers.every(observer => observer.disconnected));
  assert.equal(h.diagnostics.finish(), null);
});

test('144/240Hz sampling measures actual callback cadence and catches long frames without claiming display FPS', () => {
  for (const hz of [144, 240]) {
    const h = harness([]);
    h.diagnostics.start();
    for (let i = 1; i <= hz; i++) {
      const wall = i * 1000 / hz + (i > hz / 2 ? 90 : 0);
      h.frame(wall); h.diagnostics.sampleTime(wall / 1000);
      h.core.update(1000 / hz);
    }
    h.at(20000); h.complete();
    const report = h.reports[0];
    assert.equal(report.reason, 'complete');
    assert.equal(report.frames.over50ms, 1);
    assert.equal(report.frames.slowIntervals, 1);
    assert.ok(Math.abs(report.frames.observedCadenceHz - hz) < 1);
    assert.ok(report.frames.callbackRateHz < hz);
    assert.equal(report.timeline.samples, hz);
    assert.equal(report.core.update.count, hz);
    assert.deepEqual(report.supportedObservers, []);
    assert.match(report.limits.join(' '), /not presented-frame FPS/);
  }
});

test('media clock stalls and backwards jumps are separate from normal RAF cadence', () => {
  const h = harness();
  h.diagnostics.start();
  for (let i = 0; i < 60; i++) {
    h.frame(i * 10);
    h.diagnostics.sampleTime(i < 30 ? 10 : 8 + (i - 30) / 100);
  }
  const report = h.diagnostics.finish('seek');
  assert.equal(report.frames.over50ms, 0);
  assert.equal(report.timeline.backwards, 1);
  assert.ok(report.timeline.repeated >= 29);
  assert.ok(report.timeline.longestFrozenMs >= 300);
  assert.equal(report.timeline.discontinuities, 1);
});

test('observer records are flushed at finish, filter pre-capture entries and omit script URLs', () => {
  const h = harness();
  h.at(500); h.diagnostics.start();
  h.observers[0].pending.push({ startTime: 490, duration: 900 }, { startTime: 510, duration: 80 });
  h.observers[1].fn({ getEntries: () => [{ startTime: 550, duration: 100, renderStart: 580, blockingDuration: 45,
    scripts: [{ sourceURL: 'https://private.example/?key=SECRET', forcedStyleAndLayoutDuration: 12 }] }] });
  h.at(700);
  const report = h.diagnostics.finish();
  assert.equal(report.longTasks.count, 1);
  assert.equal(report.longTasks.max, 80);
  assert.equal(report.samples['long-animation-frame'][0].forcedLayout, 12);
  assert.equal(report.samples['long-animation-frame'][0].render, 70);
  assert.doesNotMatch(JSON.stringify(report), /SECRET|private.example/);
});

test('hidden/unmount cancel sampling, restarted captures reattach, replacement cores preserve lifecycle', () => {
  const h = harness();
  h.diagnostics.start();
  const replacement = new h.Wrapped();
  assert.notEqual(replacement.update, h.Core.prototype.update);
  h.core.dispose(); assert.equal(h.core.disposed, true);
  assert.equal(h.core.update, h.Core.prototype.update);
  h.env.document.hidden = true; h.listeners.get('visibilitychange')();
  assert.equal(h.reports[0].reason, 'hidden');
  assert.equal(replacement.update, h.Core.prototype.update);
  assert.equal(h.diagnostics.start(), false);
  h.env.document.hidden = false;
  assert.equal(h.diagnostics.start(), true);
  assert.equal(h.diagnostics.start(), false);
  assert.notEqual(replacement.update, h.Core.prototype.update);
  h.diagnostics.dispose();
  assert.equal(h.reports.length, 1, 'dispose must not reopen the menu');
  assert.equal(h.raf.size + h.timers.size + h.listeners.size, 0);
  assert.equal(replacement.update, h.Core.prototype.update);
});
