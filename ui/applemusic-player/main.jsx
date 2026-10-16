import React, { useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { PrebuiltLyricPlayer } from '../../vendor/amll/packages/react-full/src/components/PrebuiltLyricPlayer';
import { ToggleIconButton } from '../../vendor/amll/packages/react-full/src/components/ToggleIconButton';
import * as data from '../../vendor/amll/packages/react-full/src/states/dataAtoms';
import * as callbacks from '../../vendor/amll/packages/react-full/src/states/callbacks';
import * as config from '../../vendor/amll/packages/react-full/src/states/configAtoms';
import * as controls from '../../vendor/amll/packages/react-full/src/states/controlsAtoms';
import { convertLyrics, getPlainLyrics, seekPosition } from './lyricsAdapter.mjs';
import { createPerformanceDiagnostics } from './performanceDiagnostics.mjs';
import { playerFontFamily } from '../../src/lib/playerFont.js';
import { createImportedFontLoader } from '../../src/lib/importedPlayerFont.js';
import './player.css';

export function createPlayer(host, options = {}) {
  const store = createStore();
  const viewAtom = atom({ status: 'loading', menu: false, toast: '', displayMode: 'none', providers: [], offset: 0, translating: false, connected: false });
  let root = null;
  let destroyed = false;
  let toastTimer;
  let lastArgs;
  let song = {};
  let settings = {};
  let latency = 0;
  let offset = 0;
  let position = 0;
  let playback = {};
  let diagnosticReport;
  let downloadURL;
  let downloadTimer;
  const patchView = (patch) => {
    const previous = store.get(viewAtom);
    if (Object.keys(patch).some(key => !Object.is(previous[key], patch[key]))) store.set(viewAtom, { ...previous, ...patch });
  };
  const zh = { close: '关闭', settings: '歌词设置', lyrics: '歌词', nativePlayer: '原生播放器', connecting: '正在连接 Apple Music…', loadingLyrics: '正在加载歌词…', songNotFound: '暂无歌词', translation: '翻译', original: '原文', romanization: '音译', both: '翻译与音译', lyricsSource: '歌词来源', automatic: '自动', lyricsOffset: '歌词偏移（毫秒）', animatedBackground: '动态背景', reset: '重置偏移', reloadLyrics: '重新加载歌词', translating: '正在加载翻译…' };
  Object.assign(zh, { diagnose: '卡顿诊断（20 秒）', diagnosing: '正在采集卡顿数据，请保持播放…', exportDiagnostics: '导出诊断报告', diagnosticReady: '采集完成，可导出报告', diagnosticStopped: '采集已提前结束，可导出部分报告', diagnosticNeedsPlayback: '请先播放歌曲并等待歌词显示', diagnosticRate: '页面回调频率', diagnosticSlow: '长帧（>50ms）' });
  Object.assign(zh, { downloadNativeTTML: '下载 AM 原生 TTML', downloadingNativeTTML: '正在获取原生 TTML…', nativeTTMLUnavailable: '未获取到这首歌的 AM 原生 TTML，请稍后重试', nativeTTMLSongChanged: '歌曲已切换，请重新下载', nativeTTMLFailed: '原生 TTML 下载失败，请重试' });
  const label = (key, fallback) => {
    const translated = options.translate?.(key);
    if (translated && translated !== key) return translated;
    return /^zh/i.test(document.documentElement.lang || navigator.language) && zh[key] ? zh[key] : fallback;
  };
  const toast = (message) => {
    if (destroyed) return;
    patchView({ toast: message });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (!destroyed) patchView({ toast: '' }); }, 3500);
  };
  const command = async (name, value) => {
    if (name === 'seek') diagnostics.finish('seek');
    try { return await options.sendCommand?.(name, value); }
    catch (error) { toast(error?.message || label('notFoundError', 'Playback command failed')); }
  };
  const diagnostics = createPerformanceDiagnostics({ onComplete(report) {
    diagnosticReport = report;
    if (!destroyed) patchView({ diagnosing: false, diagnosticSummary: report, menu: true });
  } });
  const originalImplementation = store.get(config.lyricPlayerImplementationAtom);
  store.set(config.lyricPlayerImplementationAtom, { lyricPlayer: diagnostics.wrapPlayerClass(originalImplementation.lyricPlayer) });

  function startDiagnostics() {
    if (!store.get(data.musicPlayingAtom) || store.get(viewAtom).status !== 'ready') { toast(label('diagnosticNeedsPlayback', 'Play a song and wait for lyrics first')); return; }
    const lines = store.get(data.musicLyricLinesAtom);
    const context = {
      renderDocument: options.renderDocument || 'page',
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      source: store.get(viewAtom).provider, lines: lines.length, words: lines.reduce((sum, line) => sum + line.words.length, 0),
      background: { static: store.get(config.lyricBackgroundStaticModeAtom), fps: store.get(config.lyricBackgroundFPSAtom), scale: store.get(config.lyricBackgroundRenderScaleAtom) },
      blur: store.get(config.enableLyricLineBlurEffectAtom), spring: store.get(config.enableLyricLineSpringAnimationAtom),
      translation: store.get(config.enableLyricTranslationLineAtom), romanization: store.get(config.enableLyricRomanLineAtom),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
    if (diagnostics.start(context)) { clearTimeout(toastTimer); patchView({ diagnosing: true, menu: false, toast: '' }); }
  }
  function exportDiagnostics() {
    if (!diagnosticReport) return;
    try {
      downloadFile(new Blob([JSON.stringify(diagnosticReport, null, 2)], { type: 'application/json' }), `youlyplus-performance-${Date.now()}.json`);
    } catch (error) { toast(error?.message || 'Unable to export diagnostics'); }
  }
  function downloadFile(blob, filename) {
    clearTimeout(downloadTimer);
    if (downloadURL) URL.revokeObjectURL(downloadURL);
    downloadURL = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadURL;
    link.download = filename;
    host.appendChild(link);
    try { link.click(); } finally { link.remove(); }
    downloadTimer = setTimeout(() => { URL.revokeObjectURL(downloadURL); downloadURL = null; }, 60000);
  }
  async function downloadNativeTTML() {
    if (!song?.appleId || store.get(viewAtom).downloadingNativeTTML) return;
    const id = song.appleId;
    patchView({ downloadingNativeTTML: true });
    try {
      const result = await options.sendCommand?.('nativeTTML', id);
      if (destroyed) return;
      if (song?.appleId !== id || result?.appleId !== id) throw new Error('nativeTTMLSongChanged');
      if (typeof result.ttml !== 'string' || !/<(?:\w+:)?tt[\s>]/.test(result.ttml)) throw new Error('nativeTTMLUnavailable');
      const name = [result.artist, result.title].filter(Boolean).join(' - ').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 160) || 'Apple Music';
      downloadFile(new Blob([result.ttml], { type: 'application/ttml+xml;charset=utf-8' }), `${name} [${id.replace(/[^a-z0-9.-]/gi, '_')}].ttml`);
    } catch (error) {
      if (!destroyed) {
        const key = ['nativeTTMLUnavailable', 'nativeTTMLSongChanged'].includes(error?.message) ? error.message : 'nativeTTMLFailed';
        toast(label(key, key === 'nativeTTMLSongChanged' ? 'The song changed; download again' : key === 'nativeTTMLUnavailable' ? 'No native TTML was retrieved for this song; try again later' : 'Unable to download native TTML; try again'));
      }
    } finally { if (!destroyed) patchView({ downloadingNativeTTML: false }); }
  }
  const setCallback = (key, onEmit) => store.set(callbacks[key], { onEmit });
  setCallback('onPlayOrResumeAtom', () => command('playPause'));
  setCallback('onRequestPrevSongAtom', () => command('previous'));
  setCallback('onRequestNextSongAtom', () => command('next'));
  setCallback('onSeekPositionAtom', (time) => command('seek', time / 1000));
  setCallback('onChangeVolumeAtom', (volume) => command('volume', volume));
  setCallback('onToggleShuffleAtom', () => command('shuffle', !store.get(controls.isShuffleActiveAtom)));
  setCallback('onCycleRepeatModeAtom', () => {
    const modes = ['off', 'all', 'one'];
    command('repeat', modes[(modes.indexOf(store.get(controls.repeatModeAtom)) + 1) % modes.length]);
  });
  setCallback('onClickControlThumbAtom', () => options.onClose?.());
  setCallback('onRequestOpenMenuAtom', () => patchView({ menu: !store.get(viewAtom).menu }));
  setCallback('onLyricLineClickAtom', (event) => command('seek', seekPosition(event.line.getLine().startTime, latency, offset)));
  store.set(config.showBottomControlAtom, true);
  store.set(config.isLyricPageOpenedAtom, true);
  store.set(config.hideLyricViewAtom, false);

  const fontLoader = createImportedFontLoader(fontFamily => {
    if (destroyed) return;
    patchView({ fontFamily });
    store.set(config.lyricFontFamilyAtom, fontFamily);
  }, () => toast(/^zh/i.test(document.documentElement.lang) ? '字体加载失败，请在设置中重新导入' : 'Unable to load font; import it again in Settings'));

  function applySettings(next) {
    settings = { ...settings, ...next };
    const fontFamily = playerFontFamily(settings.appleMusicPlayerFont);
    fontLoader.update(settings.appleMusicPlayerFontFile, fontFamily);
    patchView({ animated: settings.appleMusicAMLLBackground !== false,
      ...(['none', 'translate', 'romanize', 'both'].includes(settings.appleMusicDisplayMode) ? { displayMode: settings.appleMusicDisplayMode } : {}),
    });
    const set = (key, value) => { if (store.get(config[key]) !== value) store.set(config[key], value); };
    set('enableLyricLineBlurEffectAtom', !settings.lightweight);
    set('enableLyricLineSpringAnimationAtom', !settings.lightweight);
    set('lyricBackgroundStaticModeAtom', !!settings.lightweight || settings.appleMusicAMLLBackground === false || document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches);
    set('lyricBackgroundFPSAtom', settings.lightweight ? 15 : 60);
    set('lyricBackgroundRenderScaleAtom', settings.lightweight ? 0.35 : 1);
    // Use AMLL's original responsive typography.
    set('lyricSizePresetAtom', 'medium');
  }

  function updateTick(seconds) {
    if (!Number.isFinite(seconds) || destroyed) return;
    diagnostics.sampleTime(seconds);
    position = seconds;
    store.set(data.musicPlayingPositionAtom, Math.max(0, Math.round(seconds * 1000)));
  }

  function updateSong(info = {}) {
    const key = info.appleId || `${info.title}-${info.artist}-${info.album}`;
    const oldKey = song.appleId || `${song.title}-${song.artist}-${song.album}`;
    if (key !== oldKey) {
      diagnostics.finish('song-changed');
      lastArgs = undefined;
      offset = 0;
      store.set(data.musicLyricLinesAtom, []);
      patchView({ status: 'loading', providers: [], offset: 0, translating: false, plain: null, source: '' });
      updateTick(0);
    }
    song = info;
    store.set(data.musicIdAtom, String(key));
    store.set(data.musicNameAtom, info.title || 'Apple Music');
    store.set(data.musicArtistsAtom, info.artist ? [{ name: info.artist, id: 'applemusic' }] : []);
    store.set(data.musicAlbumNameAtom, info.album || '');
    store.set(data.musicCoverAtom, info.artwork || '');
    store.set(data.musicCoverIsVideoAtom, false);
    store.set(data.musicDurationAtom, Math.max(0, (Number(info.duration) || 0) * 1000));
  }

  function displayLyrics(...args) {
    if (destroyed) return;
    diagnostics.finish('lyrics-updated');
    const [lyrics, songInfo, displayMode = 'none', currentSettings = {}, , , largerTextMode = 'lyrics', offsetLatency = 0, , , , userOffsetMs = 0] = args;
    updateSong(songInfo);
    lastArgs = args;
    latency = Number(offsetLatency) || 0;
    offset = Number(userOffsetMs) || 0;
    applySettings({ ...currentSettings, largerTextMode, displayMode });
    const lines = convertLyrics(lyrics, settings);
    store.set(data.musicLyricLinesAtom, lines);
    store.set(config.enableLyricTranslationLineAtom, ['translate', 'both'].includes(displayMode));
    store.set(config.enableLyricRomanLineAtom, ['romanize', 'both'].includes(displayMode));
    const providerContext = args[10]?.(songInfo, lyrics, currentSettings) || {};
    const providers = new Set([...(store.get(viewAtom).providers || []), ...(providerContext.providerKeys || []).map(v => v.toLowerCase())]);
    if (lyrics?.provider) providers.add(lyrics.provider.toLowerCase());
    patchView({
      status: lyrics?.type === 'None' ? 'plain' : lines.length ? 'ready' : 'empty',
      plain: lyrics?.type === 'None' ? getPlainLyrics(lyrics, settings) : null,
      displayMode: settings.appleMusicDisplayMode || displayMode, offset, translating: false, providers: [...providers],
      providerPreference: lyrics?.playerProviderPreference || 'auto',
      provider: providerContext.activeProvider || lyrics?.provider?.toLowerCase() || '', providerNames: providerContext.providerDisplayNames || {}, source: lyrics?.metadata?.source || lyrics?.provider || '',
      animated: settings.appleMusicAMLLBackground !== false,
    });
  }

  function setOffset(value) {
    offset = Math.round(Math.max(-10000, Math.min(10000, Number(value) || 0)));
    if (lastArgs) lastArgs[11] = offset;
    (lastArgs?.[9] || options.saveOffset)?.(song, offset);
    patchView({ offset });
  }

  async function changeSettings(values) {
    const previous = settings;
    applySettings(values);
    try { await options.onSettingsChange?.(values); }
    catch (error) { applySettings(previous); toast(error?.message || 'Unable to save player settings'); }
  }

  function PlayerView() {
    const view = useAtomValue(viewAtom);
    const hideLyrics = useAtomValue(config.hideLyricViewAtom);
    useLayoutEffect(() => { options.onReady?.(); return () => {}; }, []);
    useLayoutEffect(() => {
      if (!options.browserFullscreen) return;
      let active = true, timer, revision = 0;
      const refresh = async () => {
        const request = ++revision;
        try {
          const result = await options.browserFullscreen('get');
          if (active && request === revision) patchView({ fullscreen: !!result.fullscreen });
        } catch { /* Keep playback available when the browser API is unavailable. */ }
      };
      const resize = () => { clearTimeout(timer); timer = setTimeout(refresh, 150); };
      window.addEventListener('resize', resize);
      refresh();
      return () => { active = false; clearTimeout(timer); window.removeEventListener('resize', resize); };
    }, []);
    const toggleFullscreen = async () => {
      patchView({ fullscreenBusy: true });
      try {
        const result = await options.browserFullscreen('toggle');
        if (!destroyed) patchView({ fullscreen: !!result.fullscreen });
      } catch (error) { if (!destroyed) toast(error?.message || 'Unable to change fullscreen'); }
      finally { if (!destroyed) patchView({ fullscreenBusy: false }); }
    };
    const fullscreenLabel = /^zh/i.test(document.documentElement.lang)
      ? (view.fullscreen ? '退出全屏' : '全屏') : (view.fullscreen ? 'Exit fullscreen' : 'Fullscreen');
    const fullscreenIcon = exit => <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d={exit ? 'M24 13v11H13m27-11v11h11M13 40h11v11m16 0V40h11' : 'M24 13H13v11m27-11h11v11M13 40v11h11m16 0h11V40'} stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
    const isEmpty = view.status !== 'ready';
    return <div className={`lyplus-amll-player${isEmpty ? ' lyplus-amll-no-timed-lyrics' : ''}`}
      style={{ '--lyplus-player-font': view.fontFamily || undefined }} data-custom-font={view.fontFamily ? 'true' : undefined}>
      <PrebuiltLyricPlayer
        className="lyplus-amll-layout"
        lyricTimeOffsetMs={latency * 1000 + view.offset}
        onPlaylistClick={async () => {
          const queue = await command('queue');
          if (queue) patchView({ queue, queueOpen: !view.queueOpen, menu: false });
        }}
        onAirPlayClick={() => command('airplay')}
        fullscreenButtonSlot={options.browserFullscreen && <ToggleIconButton
          className="lyplus-amll-fullscreen" checked={view.fullscreen}
          uncheckedIcon={fullscreenIcon(false)} checkedIcon={fullscreenIcon(true)}
          title={fullscreenLabel} aria-label={fullscreenLabel} aria-pressed={!!view.fullscreen}
          disabled={!!view.fullscreenBusy} onClick={toggleFullscreen}
        />}
      />
      {!view.connected && <div className="lyplus-amll-connection" role="status">{label('connecting', 'Connecting to Apple Music…')}</div>}
      {isEmpty && !hideLyrics && <div className="lyplus-amll-empty" role="status">
        {view.status === 'plain' ? <div className="lyplus-amll-plain">{view.plain?.map((line, index) => <p key={index} dir="auto">{line.text}{line.translation && <small>{line.translation}</small>}{line.romanization && <small>{line.romanization}</small>}</p>)}</div>
          : <div><span className="lyplus-amll-empty-icon">♫</span><p>{view.status === 'loading' ? label('loadingLyrics', 'Loading lyrics…') : view.status === 'error' ? label('notFoundError', 'Unable to load lyrics') : label('songNotFound', 'No lyrics available')}</p></div>}
      </div>}
      {view.menu && <div className="lyplus-amll-settings" role="dialog" aria-label={label('settings', 'Lyrics settings')}>
        <div className="lyplus-amll-settings-heading"><strong>{label('settings', 'Lyrics settings')}</strong><button type="button" aria-label={label('close', 'Close')} onClick={() => patchView({ menu: false })}>×</button></div>
        <label>{label('translation', 'Display')}<select value={view.displayMode} onChange={(event) => { patchView({ displayMode: event.target.value }); (lastArgs?.[5] || options.setDisplayMode)?.(event.target.value, song); }}>
          <option value="none">{label('original', 'Original')}</option><option value="translate">{label('translation', 'Translation')}</option><option value="romanize">{label('romanization', 'Romanization')}</option><option value="both">{label('both', 'Translation + romanization')}</option>
        </select></label>
        <label>{label('lyricsSource', 'Lyrics source')}<select value={view.providerPreference || 'auto'} onChange={(event) => lastArgs?.[8]?.(event.target.value, song)}>
          <option value="auto">{label('automatic', 'Automatic')}{view.source ? ` · ${view.source}` : ''}</option>
          {view.providers.map(provider => <option key={provider} value={provider}>{view.providerNames?.[provider] || provider}</option>)}
        </select></label>
        <label>{label('lyricsOffset', 'Lyrics offset (ms)')}<input type="number" min="-10000" max="10000" step="10" value={view.offset} onChange={event => setOffset(event.target.value)} /></label>
        <label>{label('animatedBackground', 'Animated background')}<input type="checkbox" checked={view.animated !== false} onChange={event => changeSettings({ appleMusicAMLLBackground: event.target.checked })} /></label>
        <div className="lyplus-amll-settings-actions"><button type="button" onClick={() => setOffset(0)}>{label('reset', 'Reset offset')}</button><button type="button" onClick={() => (lastArgs?.[4] || options.reloadLyrics)?.(song, false, true)}>{label('reloadLyrics', 'Reload lyrics')}</button></div>
        <button type="button" disabled={!song?.appleId || !!view.downloadingNativeTTML} onClick={downloadNativeTTML}>{view.downloadingNativeTTML ? label('downloadingNativeTTML', 'Fetching native TTML…') : label('downloadNativeTTML', 'Download AM native TTML')}</button>
        <button type="button" onClick={() => options.onFallback?.()}>{label('nativePlayer', 'Native player')}</button>
        <button type="button" disabled={view.diagnosing} onClick={startDiagnostics}>{label('diagnose', 'Diagnose stutter (20 seconds)')}</button>
        {view.diagnosticSummary && <div className="lyplus-amll-diagnostic-result">
          <p>{label(view.diagnosticSummary.reason === 'complete' ? 'diagnosticReady' : 'diagnosticStopped', 'Recording finished; export the report')}
            <br />{label('diagnosticRate', 'Page callback rate')}: {view.diagnosticSummary.frames.callbackRateHz ?? '—'} Hz
            <br />{label('diagnosticSlow', 'Long intervals (>50ms)')}: {view.diagnosticSummary.frames.over50ms}</p>
          <button type="button" onClick={exportDiagnostics}>{label('exportDiagnostics', 'Export diagnostic report')}</button>
        </div>}
        {view.translating && <p role="status">{label('translating', 'Loading translation…')}</p>}
      </div>}
      {view.queueOpen && <div className="lyplus-amll-settings" role="dialog" aria-label="Queue">
        <div className="lyplus-amll-settings-heading"><strong>{/^zh/i.test(document.documentElement.lang) ? '接下来播放' : 'Up next'}</strong><button type="button" aria-label={label('close', 'Close')} onClick={() => patchView({ queueOpen: false })}>×</button></div>
        <ol className="lyplus-amll-queue">{view.queue.items.map((item, index) => <li key={index} aria-current={index === view.queue.position ? 'true' : undefined}><strong>{item.title}</strong><small>{item.artist}</small></li>)}</ol>
        {!view.queue.items.length && <p>{/^zh/i.test(document.documentElement.lang) ? '当前播放队列为空' : 'The queue is empty'}</p>}
      </div>}
      {view.toast && <div className="lyplus-amll-toast" role="status">{view.toast}</div>}
      {view.diagnosing && <div className="lyplus-amll-diagnostic-status" role="status">{label('diagnosing', 'Recording stutter data; keep playing…')}</div>}
    </div>;
  }

  root = createRoot(host, { onUncaughtError: (error) => { console.error('YouLy+ AMLL:', error); options.onFallback?.(); } });
  root.render(<Provider store={store}><PlayerView /></Provider>);
  return {
    updateSong, displayLyrics, updateCurrentTick: updateTick,
    updatePlayback(state) {
      if (destroyed) return;
      playback = state;
      if (!state.isPlaying) diagnostics.finish('paused');
      if (!store.get(viewAtom).connected) patchView({ connected: true });
      updateTick(state.currentTime);
      store.set(data.musicPlayingAtom, !!state.isPlaying);
      if (Number.isFinite(state.duration)) store.set(data.musicDurationAtom, Math.max(0, state.duration * 1000));
      if (Number.isFinite(state.volume) && store.get(data.musicVolumeAtom) !== state.volume) store.set(data.musicVolumeAtom, state.volume);
      store.set(controls.isShuffleActiveAtom, !!state.shuffle);
      store.set(controls.repeatModeAtom, state.repeat || 'off');
      store.set(controls.isShuffleEnabledAtom, state.capabilities?.shuffle !== false);
      store.set(controls.isRepeatEnabledAtom, state.capabilities?.repeat !== false);
    },
    updateSettings(next) {
      diagnostics.finish('settings-changed');
      applySettings(next);
      if (lastArgs) { lastArgs[3] = settings; lastArgs[6] = settings.largerTextMode || 'lyrics'; displayLyrics(...lastArgs); }
    },
    updateDisplayMode(lyrics, displayMode, nextSettings) {
      if (lastArgs) { lastArgs[0] = lyrics; lastArgs[2] = displayMode; lastArgs[3] = nextSettings || settings; displayLyrics(...lastArgs); }
    },
    setUserOffset(value) { offset = Number(value) || 0; if (lastArgs) lastArgs[11] = offset; patchView({ offset }); },
    setAvailableProviders(providers) { patchView({ providers: [...new Set([...(store.get(viewAtom).providers || []), ...(providers || [])])] }); },
    setVisible(value) { if (!value) diagnostics.finish('hidden'); store.set(config.isLyricPageOpenedAtom, value); applySettings({}); },
    setTranslationLoading(value) { patchView({ translating: !!value }); },
    showToast: toast,
    displaySongNotFound() { store.set(data.musicLyricLinesAtom, []); patchView({ status: 'empty' }); },
    displaySongError() { store.set(data.musicLyricLinesAtom, []); patchView({ status: 'error' }); },
    cleanupLyrics() { diagnostics.finish('lyrics-reloading'); store.set(data.musicLyricLinesAtom, []); patchView({ status: 'loading' }); },
    dispose() { destroyed = true; fontLoader.dispose(); diagnostics.dispose(); diagnosticReport = null; clearTimeout(toastTimer); clearTimeout(downloadTimer); if (downloadURL) URL.revokeObjectURL(downloadURL); store.set(config.isLyricPageOpenedAtom, false); root.unmount(); root = null; },
  };
}

globalThis.LyPlusAMLL = { createPlayer };
