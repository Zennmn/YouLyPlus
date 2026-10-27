import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { atom, createStore, Provider, useAtomValue } from 'jotai';
import { PrebuiltLyricPlayer } from '../../vendor/amll/packages/react-full/src/components/PrebuiltLyricPlayer';
import { ToggleIconButton } from '../../vendor/amll/packages/react-full/src/components/ToggleIconButton';
import PlayIcon from '../../vendor/amll/packages/react-full/src/components/PrebuiltLyricPlayer/icon_play.svg?react';
import StarIcon from '../../vendor/amll/packages/react-full/src/components/ToggleIconButton/star.svg?react';
import StarFilledIcon from '../../vendor/amll/packages/react-full/src/components/ToggleIconButton/star_filled.svg?react';
import * as data from '../../vendor/amll/packages/react-full/src/states/dataAtoms';
import * as callbacks from '../../vendor/amll/packages/react-full/src/states/callbacks';
import * as config from '../../vendor/amll/packages/react-full/src/states/configAtoms';
import * as controls from '../../vendor/amll/packages/react-full/src/states/controlsAtoms';
import { convertLyrics, getPlainLyrics, seekPosition } from './lyricsAdapter.mjs';
import { createPerformanceDiagnostics } from './performanceDiagnostics.mjs';
import { playerFontFamily } from '../../src/lib/playerFont.js';
import { createImportedFontLoader } from '../../src/lib/importedPlayerFont.js';
import { parseAMLLLyrics } from '../../src/background/utils/amllParser.js';
import './player.css';

function PlayerSelect({ label, value, options, disabled = false, onChange }) {
  const id = useId();
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(value);
  const [placement, setPlacement] = useState({ side: 'bottom', maxHeight: 264 });
  const selected = options.find(option => option.value === value);
  const available = options.filter(option => !option.disabled);
  const expanded = open && !disabled && available.length > 0;
  const activeIndex = options.findIndex(option => option.value === activeValue && !option.disabled);

  const openList = (edge) => {
    if (disabled || !available.length) return;
    const trigger = triggerRef.current;
    const rect = trigger.getBoundingClientRect();
    const bounds = trigger.closest('.lyplus-amll-panel-body')?.getBoundingClientRect();
    const scale = rect.height / trigger.offsetHeight || 1;
    const below = (Math.min(bounds?.bottom ?? innerHeight, innerHeight) - rect.bottom) / scale - 8;
    const above = (rect.top - Math.max(bounds?.top ?? 0, 0)) / scale - 8;
    const side = below >= Math.min(220, above) ? 'bottom' : 'top';
    setPlacement({ side, maxHeight: Math.max(0, Math.min(264, side === 'bottom' ? below : above)) });
    setActiveValue((edge === 'first' ? available[0] : edge === 'last' ? available.at(-1)
      : available.find(option => option.value === value) || available[0]).value);
    setOpen(true);
  };
  const choose = (option) => {
    if (!option || option.disabled) return;
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };
  const handleKey = (event) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Tab') { setOpen(false); return; }
    if (event.key === 'Escape') {
      if (!expanded) return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      if (!expanded) { openList(event.key === 'End' ? 'last' : event.key === 'Home' ? 'first' : undefined); return; }
      if (event.key === 'Enter' || event.key === ' ') { choose(options[activeIndex]); return; }
      const index = available.findIndex(option => option.value === activeValue);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1
        : Math.max(0, Math.min(available.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)));
      setActiveValue(available[next].value);
    }
  };
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const dismiss = event => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const close = () => setOpen(false);
    const body = rootRef.current?.closest('.lyplus-amll-panel-body');
    document.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('resize', close);
    body?.addEventListener('scroll', close);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('resize', close);
      body?.removeEventListener('scroll', close);
    };
  }, [expanded]);
  useLayoutEffect(() => {
    if (!expanded) return;
    if (activeIndex < 0) { setActiveValue(available[0].value); return; }
    const list = listRef.current;
    const option = list?.children[activeIndex];
    if (!option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [expanded, activeIndex]);

  return <div ref={rootRef} className="lyplus-amll-select" data-open={expanded} data-side={placement.side}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={triggerRef} type="button" className="lyplus-amll-select-trigger" role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={`${id}-list`}
      aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      disabled={disabled || !available.length} onKeyDown={handleKey}
      onClick={() => expanded ? setOpen(false) : openList()}>
      <span className="lyplus-amll-select-value">{selected?.label || value}</span>
      <svg className="lyplus-amll-select-chevron" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {expanded && <div ref={listRef} id={`${id}-list`} className="lyplus-amll-select-options" role="listbox"
      aria-label={label} style={{ maxHeight: placement.maxHeight }}>
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        className="lyplus-amll-select-option" aria-selected={option.value === value} aria-disabled={!!option.disabled}
        data-active={index === activeIndex} onPointerDown={event => event.preventDefault()}
        onPointerMove={() => { if (!option.disabled) setActiveValue(option.value); }} onClick={() => choose(option)}>
        <span>{option.label}</span>
        {option.value === value && <svg className="lyplus-amll-select-check" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>}
      </div>)}
    </div>}
  </div>;
}

export function createPlayer(host, options = {}) {
  const store = createStore();
  const viewAtom = atom({
    status: 'loading', menu: false, toast: '', displayMode: 'none', providers: [], offset: 0,
    translating: false, connected: false, queueOpen: false, queueLoading: false, queueError: false,
    queue: { position: 0, items: [], canSelect: false }, queuePlayingIndex: null, displayFeedback: {},
    isFavorited: null, canFavorite: false, favoriteBusy: false,
  });
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
  let localLyricsBusy = false;
  let queueRequest = 0;
  let queueSelecting = false;
  let lastQueueRevision;
  let panelTrigger = null;
  let favoriteRequest = 0;
  const patchView = (patch) => {
    const previous = store.get(viewAtom);
    if (Object.keys(patch).some(key => !Object.is(previous[key], patch[key]))) store.set(viewAtom, { ...previous, ...patch });
  };
  const label = (key, fallback) => {
    const translated = options.translate?.(key);
    return translated && translated !== key ? translated : fallback;
  };
  const songIdentity = info => info?.appleId || `${info?.title || ''}-${info?.artist || ''}-${info?.album || ''}`;
  const closePanels = (restoreFocus = true) => {
    queueRequest++;
    const target = panelTrigger;
    panelTrigger = null;
    patchView({ menu: false, queueOpen: false, queueLoading: false, queueError: false });
    if (restoreFocus && target?.isConnected) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  };
  const rememberPanelTrigger = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) panelTrigger = active;
  };
  const toggleMenu = () => {
    const current = store.get(viewAtom);
    if (current.menu) { closePanels(); return; }
    queueRequest++;
    rememberPanelTrigger();
    patchView({ menu: true, queueOpen: false, queueLoading: false, queueError: false });
  };
  async function refreshQueue() {
    const current = store.get(viewAtom);
    if (destroyed || !current.queueOpen) return;
    const request = ++queueRequest;
    const requestedSong = songIdentity(song);
    patchView({ queueLoading: true, queueError: false });
    try {
      const result = await options.sendCommand?.('queue');
      if (destroyed || request !== queueRequest || !store.get(viewAtom).queueOpen || songIdentity(song) !== requestedSong) return;
      if (!result || !Array.isArray(result.items)) throw new Error('Invalid queue response');
      patchView({
        queue: { ...result, position: Number(result.position) || 0, canSelect: result.canSelect === true },
        queueLoading: false,
        queueError: false,
      });
    } catch (_) {
      if (!destroyed && request === queueRequest && store.get(viewAtom).queueOpen && songIdentity(song) === requestedSong) {
        patchView({ queueLoading: false, queueError: true });
      }
    }
  }
  async function playQueueItem(item) {
    const current = store.get(viewAtom);
    if (destroyed || queueSelecting || current.queueLoading || !current.queue?.canSelect) return;
    queueSelecting = true;
    patchView({ queuePlayingIndex: item.index });
    try {
      await options.sendCommand?.('queuePlay', {
        index: item.index, id: item.id, revision: current.queue.revision, songId: current.queue.songId,
      });
    } catch (error) {
      if (!destroyed) {
        const errorCode = error?.code || error?.message;
        const key = ['playerQueueChanged', 'playerQueueControlUnavailable'].includes(errorCode) ? errorCode : 'playerQueuePlayFailed';
        toast(label(key, key === 'playerQueueChanged' ? 'The queue changed; choose the song again' : key === 'playerQueueControlUnavailable' ? 'Apple Music cannot switch queue items right now' : 'Unable to play this song; try again'));
      }
    } finally {
      queueSelecting = false;
      if (!destroyed) { patchView({ queuePlayingIndex: null }); refreshQueue(); }
    }
  }
  function toggleQueue() {
    const current = store.get(viewAtom);
    if (current.queueOpen) { closePanels(); return; }
    rememberPanelTrigger();
    patchView({ menu: false, queueOpen: true, queue: { position: 0, items: [], canSelect: false }, queueLoading: true, queueError: false });
    refreshQueue();
  }
  const toast = (message) => {
    if (destroyed) return;
    patchView({ toast: message });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { if (!destroyed) patchView({ toast: '' }); }, 3500);
  };
  const command = async (name, value) => {
    if (name === 'seek') diagnostics.finish('seek');
    try { return await options.sendCommand?.(name, value); }
    catch (error) { toast(error?.message || label('playerPlaybackCommandFailed', 'Playback command failed')); }
  };
  async function toggleFavorite() {
    const current = String(song.appleId || '');
    const view = store.get(viewAtom);
    if (view.favoriteBusy) return;
    if (!current || !options.sendCommand) { toast(label('playerFavoriteUnavailable', 'Favorites are unavailable for this song')); return; }
    const request = ++favoriteRequest;
    patchView({ favoriteBusy: true });
    try {
      let isFavorited = view.isFavorited;
      if (!view.canFavorite || typeof isFavorited !== 'boolean') {
        toast(label('playerFavoriteReading', 'Reading favorite status…'));
        const state = await options.sendCommand('favoriteState', { songId: current });
        if (destroyed || request !== favoriteRequest || String(song.appleId) !== current) return;
        if (state?.favoriteSongId !== current || typeof state.isFavorited !== 'boolean' || !state.canFavorite) {
          throw Object.assign(new Error('Favorite status is unavailable'), { code: 'playerFavoriteLoadFailed' });
        }
        isFavorited = state.isFavorited;
        patchView({ isFavorited, canFavorite: true });
      }
      const favorited = !isFavorited;
      const result = await options.sendCommand('favorite', { songId: current, favorited });
      if (destroyed || request !== favoriteRequest || String(song.appleId) !== current) return;
      if (result?.favoriteSongId !== current || result.isFavorited !== favorited) throw new Error('Invalid Apple Music favorite response');
      patchView({ isFavorited: result.isFavorited, canFavorite: !!result.canFavorite });
      toast(label(favorited ? 'playerFavoriteAdded' : 'playerFavoriteRemoved', favorited ? 'Added to Favorite Songs' : 'Removed from Favorite Songs'));
    } catch (error) {
      if (destroyed || request !== favoriteRequest || String(song.appleId) !== current) return;
      const key = ['playerFavoriteUnavailable', 'playerFavoriteSongChanged', 'playerFavoriteFailed', 'playerFavoriteSignIn', 'playerFavoriteLoadFailed'].includes(error?.code) ? error.code : 'playerFavoriteFailed';
      toast(label(key, 'Unable to update your Apple Music favorite. Try again.'));
    } finally {
      if (!destroyed && request === favoriteRequest) patchView({ favoriteBusy: false });
    }
  }
  const diagnostics = createPerformanceDiagnostics({ onComplete(report) {
    diagnosticReport = report;
    if (!destroyed) { queueRequest++; patchView({ diagnosing: false, diagnosticSummary: report, menu: true, queueOpen: false, queueLoading: false, queueError: false }); }
  } });
  const originalImplementation = store.get(config.lyricPlayerImplementationAtom);
  store.set(config.lyricPlayerImplementationAtom, { lyricPlayer: diagnostics.wrapPlayerClass(originalImplementation.lyricPlayer) });

  function startDiagnostics() {
    if (!store.get(data.musicPlayingAtom) || store.get(viewAtom).status !== 'ready') { toast(label('playerDiagnosticNeedsPlayback', 'Play a song and wait for lyrics first')); return; }
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
    if (diagnostics.start(context)) { clearTimeout(toastTimer); patchView({ diagnosing: true, toast: '' }); }
  }
  function exportDiagnostics() {
    if (!diagnosticReport) return;
    try {
      downloadFile(new Blob([JSON.stringify(diagnosticReport, null, 2)], { type: 'application/json' }), `youlyplus-performance-${Date.now()}.json`);
    } catch (error) { toast(error?.message || label('playerExportFailed', 'Unable to export diagnostics')); }
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
      if (song?.appleId !== id || result?.appleId !== id) throw new Error('playerNativeTTMLSongChanged');
      if (typeof result.ttml !== 'string' || !/<(?:\w+:)?tt[\s>]/.test(result.ttml)) throw new Error('playerNativeTTMLUnavailable');
      const name = [result.artist, result.title].filter(Boolean).join(' - ').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 160) || 'Apple Music';
      downloadFile(new Blob([result.ttml], { type: 'application/ttml+xml;charset=utf-8' }), `${name} [${id.replace(/[^a-z0-9.-]/gi, '_')}].ttml`);
    } catch (error) {
      if (!destroyed) {
        const errorKey = { nativeTTMLUnavailable: 'playerNativeTTMLUnavailable', nativeTTMLSongChanged: 'playerNativeTTMLSongChanged' }[error?.message] || error?.message;
        const key = ['playerNativeTTMLUnavailable', 'playerNativeTTMLSongChanged'].includes(errorKey) ? errorKey : 'playerNativeTTMLFailed';
        toast(label(key, key === 'playerNativeTTMLSongChanged' ? 'The song changed; download again' : key === 'playerNativeTTMLUnavailable' ? 'No native TTML was retrieved for this song; try again later' : 'Unable to download native TTML; try again'));
      }
    } finally { if (!destroyed) patchView({ downloadingNativeTTML: false }); }
  }
  async function importTTML(file, songInfo) {
    if (!file || destroyed || localLyricsBusy) return;
    const id = songInfo?.appleId;
    localLyricsBusy = true;
    patchView({ localLyricsAction: 'import' });
    try {
      if (!id || song?.appleId !== id) throw new Error('playerLocalTTMLSongChanged');
      if (file.size > 2 * 1024 * 1024) throw new Error('playerImportTTMLTooLarge');
      const text = await file.text();
      if (destroyed) return;
      const xml = new DOMParser().parseFromString(text, 'application/xml');
      if (xml.documentElement?.localName !== 'tt' || xml.getElementsByTagName('parsererror').length) throw new Error('playerImportTTMLInvalid');
      let lyrics;
      try { lyrics = parseAMLLLyrics(text); } catch { throw new Error('playerImportTTMLInvalid'); }
      if (!lyrics.data?.some(line => line.text?.trim())) throw new Error('playerImportTTMLInvalid');
      if (song?.appleId !== id) throw new Error('playerLocalTTMLSongChanged');
      await options.importTTML(id, lyrics);
      if (!destroyed && song?.appleId === id) toast(label('playerImportTTMLSuccess', 'TTML imported and saved for this song'));
    } catch (error) {
      if (!destroyed) {
        const errorKey = error?.message === 'localTTMLSongChanged' ? 'playerLocalTTMLSongChanged' : error?.message;
        const key = ['playerImportTTMLInvalid', 'playerImportTTMLTooLarge', 'playerLocalTTMLSongChanged'].includes(errorKey) ? errorKey : 'playerImportTTMLFailed';
        toast(label(key, key === 'playerLocalTTMLSongChanged' ? 'The song changed; try again for the current song' : key === 'playerImportTTMLTooLarge' ? 'TTML files must be 2 MB or smaller' : key === 'playerImportTTMLInvalid' ? 'Invalid TTML file or no lyrics to display' : 'Unable to import TTML; try again'));
      }
    } finally { localLyricsBusy = false; if (!destroyed) patchView({ localLyricsAction: '' }); }
  }
  async function removeLocalTTML() {
    if (!song?.appleId || destroyed || localLyricsBusy) return;
    const id = song.appleId;
    localLyricsBusy = true;
    patchView({ localLyricsAction: 'remove' });
    try {
      await options.removeLocalTTML(id);
      if (!destroyed && song?.appleId === id) {
        patchView({ providers: store.get(viewAtom).providers.filter(provider => provider !== 'local') });
        toast(label('playerRemoveLocalTTMLSuccess', 'Local lyrics removed; automatic fetching restored'));
      }
    } catch (error) {
      if (!destroyed) toast(label(error?.message === 'localTTMLSongChanged' ? 'playerLocalTTMLSongChanged' : 'playerRemoveLocalTTMLFailed', 'Unable to remove local lyrics; try again'));
    } finally { localLyricsBusy = false; if (!destroyed) patchView({ localLyricsAction: '' }); }
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
  setCallback('onRequestOpenMenuAtom', toggleMenu);
  setCallback('onLyricLineClickAtom', (event) => command('seek', seekPosition(event.line.getLine().startTime, latency, offset)));
  store.set(config.showBottomControlAtom, true);
  store.set(config.isLyricPageOpenedAtom, true);
  store.set(config.hideLyricViewAtom, false);

  const fontLoader = createImportedFontLoader(fontFamily => {
    if (destroyed) return;
    patchView({ fontFamily });
    store.set(config.lyricFontFamilyAtom, fontFamily);
  }, () => toast(label('playerFontLoadFailed', 'Unable to load font; import it again in Settings')));

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
    const songChanged = key !== oldKey;
    if (songChanged) {
      favoriteRequest++;
      diagnostics.finish('song-changed');
      lastArgs = undefined;
      offset = 0;
      store.set(data.musicLyricLinesAtom, []);
      patchView({ status: 'loading', providers: [], providerPreference: 'auto', offset: 0, translating: false, plain: null, source: '', displayFeedback: {}, isFavorited: null, canFavorite: false, favoriteBusy: false });
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
    if (songChanged && store.get(viewAtom).queueOpen) {
      patchView({ queue: { position: 0, items: [], canSelect: false }, queueLoading: true, queueError: false });
      refreshQueue();
    }
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
    const feedback = lyrics?.displayFeedback || {};
    patchView({
      status: lyrics?.type === 'None' ? 'plain' : lines.length ? 'ready' : 'empty',
      plain: lyrics?.type === 'None' ? getPlainLyrics(lyrics, settings) : null,
      displayMode: settings.appleMusicDisplayMode || displayMode, offset, translating: false, providers: [...providers],
      displayFeedback: {
        translation: feedback.translation || 'hidden',
        romanization: feedback.romanization || 'hidden',
      },
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
    catch (error) { applySettings(previous); toast(error?.message || label('playerSettingsSaveFailed', 'Unable to save player settings')); }
  }

  function PlayerView() {
    const view = useAtomValue(viewAtom);
    const hideLyrics = useAtomValue(config.hideLyricViewAtom);
    const importInput = useRef(null);
    const importSong = useRef(null);
    const panelRef = useRef(null);
    const closeButtonRef = useRef(null);
    const panelOpen = view.menu || view.queueOpen;
    const panelType = view.menu ? 'menu' : view.queueOpen ? 'queue' : null;
    const [retainedPanel, setRetainedPanel] = useState(null);
    const visiblePanel = panelType || retainedPanel;
    useLayoutEffect(() => {
      if (panelType) { setRetainedPanel(panelType); return; }
      if (!retainedPanel) return;
      const timer = setTimeout(() => setRetainedPanel(null), 200);
      return () => clearTimeout(timer);
    }, [panelType, retainedPanel]);
    useLayoutEffect(() => { options.onReady?.(); return () => {}; }, []);
    useEffect(() => {
      const handlePlaybackKey = event => {
        if ((event.code !== 'Space' && event.key !== ' ') || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const view = store.get(viewAtom);
        if (document.hidden || !store.get(config.isLyricPageOpenedAtom) || !view.connected || view.menu || view.queueOpen) return;
        const target = event.target;
        if (target?.isContentEditable || target?.closest?.('input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="textbox"], [role="combobox"], [role="listbox"], [role="slider"]')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) command('playPause');
      };
      document.addEventListener('keydown', handlePlaybackKey, true);
      return () => document.removeEventListener('keydown', handlePlaybackKey, true);
    }, []);
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
    useEffect(() => {
      if (!panelOpen) return;
      const handlePanelKey = event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
          if (panelRef.current?.querySelector('.lyplus-amll-select[data-open="true"]')) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          closePanels();
        } else if (event.key === 'Tab') {
          const targets = [...(panelRef.current?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]') || [])].filter(element => element.getClientRects().length);
          const first = targets[0], last = targets[targets.length - 1];
          if (!first) { event.preventDefault(); panelRef.current?.focus(); return; }
          if (!panelRef.current?.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
            event.preventDefault(); (event.shiftKey ? last : first).focus();
          }
        }
      };
      document.addEventListener('keydown', handlePanelKey, true);
      closeButtonRef.current?.focus({ preventScroll: true });
      return () => document.removeEventListener('keydown', handlePanelKey, true);
    }, [view.menu, view.queueOpen]);
    useEffect(() => {
      if (view.queueOpen && !view.queueLoading) panelRef.current?.querySelector('li[aria-current]')?.scrollIntoView({ block: 'nearest' });
    }, [view.queueOpen, view.queueLoading, view.queue]);
    const toggleFullscreen = async () => {
      patchView({ fullscreenBusy: true });
      try {
        const result = await options.browserFullscreen('toggle');
        if (!destroyed) patchView({ fullscreen: !!result.fullscreen });
      } catch (error) { if (!destroyed) toast(error?.message || label('playerFullscreenChangeFailed', 'Unable to change fullscreen')); }
      finally { if (!destroyed) patchView({ fullscreenBusy: false }); }
    };
    const fullscreenLabel = view.fullscreen
      ? label('playerExitFullscreen', 'Exit fullscreen')
      : label('playerFullscreen', 'Fullscreen');
    const favoriteAvailable = view.canFavorite && typeof view.isFavorited === 'boolean';
    const favoriteLabel = view.favoriteBusy ? label('playerFavoriteUpdating', 'Updating favorite…')
      : !favoriteAvailable ? `${label('playerFavorite', 'Favorite')} · ${label('playerQueueRetry', 'Retry')}`
      : view.isFavorited ? label('playerUnfavorite', 'Remove from favorites') : label('playerFavorite', 'Favorite');
    const fullscreenIcon = exit => <svg viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <path d={exit ? 'M24 13v11H13m27-11v11h11M13 40h11v11m16 0V40h11' : 'M24 13H13v11m27-11h11v11M13 40v11h11m16 0h11V40'} stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>;
    const closeIcon = <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 6 8 8M14 6l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
    const isEmpty = view.status !== 'ready';
    const preferredProvider = view.providerPreference || 'auto';
    const preferredUnavailable = preferredProvider !== 'auto' && !view.providers.includes(preferredProvider);
    const displayFeedback = view.displayFeedback || {};
    const secondaryStatus = [];
    const secondaryFallbacks = {
      translation: {
        loading: 'Loading translation…',
        unavailable: 'Translation is unavailable from the current lyrics source',
        error: 'Unable to load translation from the current lyrics source',
      },
      romanization: {
        loading: 'Loading romanization…',
        unavailable: 'Romanization is unavailable from the current lyrics source',
        error: 'Unable to load romanization from the current lyrics source',
      },
    };
    const addSecondaryStatus = (kind, state) => {
      if (state === 'loading') secondaryStatus.push({ kind, state, key: `player${kind === 'translation' ? 'Translation' : 'Romanization'}Loading` });
      else if (state === 'unavailable') secondaryStatus.push({ kind, state, key: `player${kind === 'translation' ? 'Translation' : 'Romanization'}Unavailable` });
      else if (state === 'error') secondaryStatus.push({ kind, state, key: `player${kind === 'translation' ? 'Translation' : 'Romanization'}Error` });
    };
    if (['translate', 'both'].includes(view.displayMode)) addSecondaryStatus('translation', view.translating ? 'loading' : displayFeedback.translation);
    if (['romanize', 'both'].includes(view.displayMode)) addSecondaryStatus('romanization', displayFeedback.romanization);
    return <div className={`lyplus-amll-player${isEmpty ? ' lyplus-amll-no-timed-lyrics' : ''}`}
      style={{ '--lyplus-player-font': view.fontFamily || undefined }} data-custom-font={view.fontFamily ? 'true' : undefined}>
      <PrebuiltLyricPlayer
        className="lyplus-amll-layout"
        lyricTimeOffsetMs={latency * 1000 + view.offset}
        onPlaylistClick={toggleQueue}
        onAirPlayClick={() => command('airplay')}
        favoriteButtonSlot={<ToggleIconButton
          className="lyplus-amll-favorite" checked={view.isFavorited === true}
          uncheckedIcon={<StarIcon />} checkedIcon={<StarFilledIcon />}
          title={favoriteLabel} aria-label={favoriteLabel} aria-pressed={view.isFavorited === true}
          aria-busy={view.favoriteBusy || undefined} aria-disabled={view.favoriteBusy}
          onClick={toggleFavorite}
        />}
        fullscreenButtonSlot={options.browserFullscreen && <ToggleIconButton
          className="lyplus-amll-fullscreen" checked={view.fullscreen}
          uncheckedIcon={fullscreenIcon(false)} checkedIcon={fullscreenIcon(true)}
          title={fullscreenLabel} aria-label={fullscreenLabel} aria-pressed={!!view.fullscreen}
          disabled={!!view.fullscreenBusy} onClick={toggleFullscreen}
        />}
      />
      <input type="file" hidden ref={importInput} accept=".ttml,.xml,application/ttml+xml,application/xml,text/xml" aria-label={label('playerImportTTML', 'Import TTML')}
        onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; importTTML(file, importSong.current); }} />
      {!view.connected && <div className="lyplus-amll-connection" role="status">{label('playerConnecting', 'Connecting to Apple Music…')}</div>}
      {isEmpty && !hideLyrics && <div className="lyplus-amll-empty" role="status">
        {view.status === 'plain' ? <div className="lyplus-amll-plain">{view.plain?.map((line, index) => <p key={index} dir="auto">{line.text}{line.translation && <small>{line.translation}</small>}{line.romanization && <small>{line.romanization}</small>}</p>)}</div>
          : <div><span className="lyplus-amll-empty-icon">♫</span><p>{view.status === 'loading' ? label('playerLoadingLyrics', 'Loading lyrics…') : view.status === 'error' ? label('playerNotFoundError', 'Unable to load lyrics') : label('playerSongNotFound', 'No lyrics available')}</p></div>}
      </div>}
      {visiblePanel && <div key={visiblePanel} className="lyplus-amll-panel-layer" data-state={panelOpen ? 'open' : 'closing'} inert={!panelOpen} aria-hidden={!panelOpen || undefined}
        onAnimationEnd={event => { if (!panelOpen && event.target === event.currentTarget) setRetainedPanel(null); }}
        onClick={event => { if (panelOpen && event.target === event.currentTarget) closePanels(); }}>
      {visiblePanel === 'menu' && <div className="lyplus-amll-settings" ref={panelRef} tabIndex="-1" role="dialog" aria-modal={panelOpen || undefined} aria-label={label('playerSettings', 'Lyrics settings')}>
        <div className="lyplus-amll-settings-heading"><strong>{label('playerSettings', 'Lyrics settings')}</strong><button ref={closeButtonRef} type="button" aria-label={label('playerClose', 'Close')} onClick={() => closePanels()}>{closeIcon}</button></div>
        <div className="lyplus-amll-panel-body">
        <div className="lyplus-amll-settings-fields">
        <div className="lyplus-amll-setting-row"><span>{label('playerDisplay', 'Display')}</span>
          <PlayerSelect label={label('playerDisplay', 'Display')} value={view.displayMode} disabled={!panelOpen}
            options={[
              { value: 'none', label: label('playerOriginal', 'Original') },
              { value: 'translate', label: label('playerTranslation', 'Translation') },
              { value: 'romanize', label: label('playerRomanization', 'Romanization') },
              { value: 'both', label: label('playerTranslationAndRomanization', 'Translation + romanization') },
            ]}
            onChange={value => { patchView({ displayMode: value }); (lastArgs?.[5] || options.setDisplayMode)?.(value, song); }} />
        </div>
        {secondaryStatus.length > 0 && <div className="lyplus-amll-feedback" role="status">
          {secondaryStatus.map(item => <span key={`${item.kind}-${item.state}`}>{label(item.key, secondaryFallbacks[item.kind][item.state])}</span>)}
        </div>}
        <div className="lyplus-amll-setting-row"><span>{label('playerLyricsSource', 'Lyrics source')}</span>
          <PlayerSelect label={label('playerLyricsSource', 'Lyrics source')} value={preferredProvider} disabled={!panelOpen || !!view.localLyricsAction}
            options={[
              { value: 'auto', label: `${label('playerAutomatic', 'Automatic')}${view.source ? ` · ${view.source}` : ''}` },
              ...view.providers.map(provider => ({ value: provider, label: view.providerNames?.[provider] || provider })),
              ...(preferredUnavailable ? [{ value: preferredProvider, label: `${view.providerNames?.[preferredProvider] || preferredProvider} · ${label('playerSourceUnavailable', 'currently unavailable')}`, disabled: true }] : []),
            ]}
            onChange={value => (lastArgs?.[8] || options.switchProvider)?.(value, song)} />
        </div>
        {preferredProvider !== 'auto' && view.provider !== preferredProvider && view.source && <div className="lyplus-amll-source-status">
          <span>{label('playerCurrentSource', 'Current source')}: {view.source}</span>
        </div>}
        <label><span>{label('playerLyricsOffset', 'Lyrics offset (ms)')}</span><input type="number" min="-10000" max="10000" step="10" value={view.offset} onChange={event => setOffset(event.target.value)} /></label>
        <label><span>{label('playerAnimatedBackground', 'Animated background')}</span><input type="checkbox" role="switch" checked={view.animated !== false} onChange={event => changeSettings({ appleMusicAMLLBackground: event.target.checked })} /></label>
        </div>
        <div className="lyplus-amll-settings-actions"><button type="button" onClick={() => setOffset(0)}>{label('playerResetOffset', 'Reset offset')}</button><button type="button" disabled={!!view.localLyricsAction} onClick={() => (lastArgs?.[4] || options.reloadLyrics)?.(song, false, true)}>{label('playerReloadLyrics', 'Reload lyrics')}</button></div>
        <div className="lyplus-amll-settings-actions">
        {options.importTTML &&
          <button type="button" disabled={!song?.appleId || !!view.localLyricsAction} onClick={() => { importSong.current = { ...song }; importInput.current?.click(); }}>{view.localLyricsAction === 'import' ? label('playerImportingTTML', 'Importing TTML…') : label('playerImportTTML', 'Import TTML')}</button>
        }
        <button type="button" disabled={!song?.appleId || !!view.downloadingNativeTTML} onClick={downloadNativeTTML}>{view.downloadingNativeTTML ? label('playerDownloadingNativeTTML', 'Fetching native TTML…') : label('playerExportNativeTTML', 'Export native TTML')}</button>
        </div>
        {options.importTTML && <p className="lyplus-amll-import-hint">{label('playerImportTTMLHint', 'Saved for this song · up to 2 MB')}</p>}
        {options.removeLocalTTML && view.providers.includes('local') && <button type="button" disabled={!song?.appleId || !!view.localLyricsAction} onClick={removeLocalTTML}>{view.localLyricsAction === 'remove' ? label('playerRemovingLocalTTML', 'Removing…') : label('playerRemoveLocalTTML', 'Remove imported TTML')}</button>}
        <button type="button" className="lyplus-amll-native-button" onClick={() => options.onFallback?.()}>{label('playerNativePlayer', 'Native player')}</button>
        <details className="lyplus-amll-advanced">
          <summary>{label('playerAdvanced', 'Advanced')}</summary>
          <div className="lyplus-amll-advanced-content">
            <button type="button" disabled={view.diagnosing} onClick={startDiagnostics}>{view.diagnosing ? label('playerDiagnosing', 'Recording stutter data; keep playing…') : label('playerDiagnose', 'Diagnose stutter (20 seconds)')}</button>
            {view.diagnosticSummary && <div className="lyplus-amll-diagnostic-result">
              <p>{label(view.diagnosticSummary.reason === 'complete' ? 'playerDiagnosticReady' : 'playerDiagnosticStopped', 'Recording finished; export the report')}
                <br />{label('playerDiagnosticRate', 'Page callback rate')}: {view.diagnosticSummary.frames.callbackRateHz ?? '—'} Hz
                <br />{label('playerDiagnosticSlow', 'Long intervals (>50ms)')}: {view.diagnosticSummary.frames.over50ms}</p>
              <button type="button" onClick={exportDiagnostics}>{label('playerExportDiagnostics', 'Export diagnostic report')}</button>
            </div>}
          </div>
        </details>
        </div>
      </div>}
      {visiblePanel === 'queue' && <div className="lyplus-amll-settings" ref={panelRef} tabIndex="-1" role="dialog" aria-modal={panelOpen || undefined} aria-label={label('playerQueue', 'Up next')} aria-busy={!!view.queueLoading || view.queuePlayingIndex !== null}>
        <div className="lyplus-amll-settings-heading"><strong>{label('playerQueue', 'Up next')}</strong><button ref={closeButtonRef} type="button" aria-label={label('playerClose', 'Close')} onClick={() => closePanels()}>{closeIcon}</button></div>
        <div className="lyplus-amll-panel-body">
        <ol className="lyplus-amll-queue">{(view.queue?.items || []).map(item => <li key={`${item.index}-${item.id}`} aria-current={item.index === view.queue?.position ? 'true' : undefined}>
          <button type="button" className="lyplus-amll-queue-item" disabled={!view.queue.canSelect || !item.id || view.queueLoading || view.queuePlayingIndex !== null} onClick={() => playQueueItem(item)}>
            <span className="lyplus-amll-queue-cover" aria-hidden="true">♫{item.artwork && <img src={item.artwork} alt="" loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }} />}</span>
            <span className="lyplus-amll-queue-info"><strong title={item.title}>{item.title}</strong>{item.artist && <small title={item.artist}>{item.artist}</small>}</span>
            <span className="lyplus-amll-queue-marker" aria-hidden="true">{view.queuePlayingIndex === item.index ? '…' : item.index === view.queue.position ? <PlayIcon /> : item.index + 1}</span>
            {item.index === view.queue.position && <span className="lyplus-amll-sr-only">{label('playerQueueCurrent', 'Current song')}</span>}
          </button>
        </li>)}</ol>
        {!view.queueLoading && !view.queueError && !!view.queue?.items.length && !view.queue.canSelect && <p role="status">{label('playerQueueControlUnavailable', 'Apple Music cannot switch queue items right now')}</p>}
        {view.queuePlayingIndex !== null && <p role="status">{label('playerQueuePlaying', 'Switching song…')}</p>}
        {view.queueLoading && <p role="status">{label('playerQueueLoading', 'Refreshing queue…')}</p>}
        {view.queueError && <div className="lyplus-amll-feedback" role="alert"><span>{label('playerQueueLoadFailed', 'Unable to load the queue')}</span><button type="button" onClick={refreshQueue}>{label('playerQueueRetry', 'Retry')}</button></div>}
        {!view.queueLoading && !view.queueError && !(view.queue?.items || []).length && <p>{label('playerQueueEmpty', 'The queue is empty')}</p>}
        </div>
      </div>}
      </div>}
      {view.toast && <div className="lyplus-amll-toast" role="status">{view.toast}</div>}
    </div>;
  }

  root = createRoot(host, { onUncaughtError: (error) => { console.error('YouLy+ AMLL:', error); options.onFallback?.(); } });
  root.render(<Provider store={store}><PlayerView /></Provider>);
  return {
    updateSong, displayLyrics, updateCurrentTick: updateTick,
    updatePlayback(state) {
      if (destroyed) return;
      playback = state;
      const sameFavoriteSong = !!song.appleId && state.favoriteSongId === String(song.appleId);
      patchView({
        isFavorited: sameFavoriteSong && typeof state.isFavorited === 'boolean' ? state.isFavorited : null,
        canFavorite: sameFavoriteSong && typeof state.isFavorited === 'boolean' && state.canFavorite === true,
      });
      if (state.queueRevision !== undefined && state.queueRevision !== null && state.queueRevision !== lastQueueRevision) {
        lastQueueRevision = state.queueRevision;
        if (store.get(viewAtom).queueOpen) refreshQueue();
      }
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
    setAvailableProviders(providers) { patchView({ providers: [...new Set(providers || [])] }); },
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
