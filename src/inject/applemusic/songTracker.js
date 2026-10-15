// Runs in the page world; MusicKit and its tokens stay in this world.
(function () {
  if (window.__lyplusAppleMusicTracker) return;
  window.__lyplusAppleMusicTracker = true;
  let music;
  let songKey;
  let songInfo = null;
  let lyricRequest = 0;
  let frame;
  let poll;
  let lastState = '';
  let pendingLyrics;
  let accountStorefront;
  let pendingStorefront;
  const subscriptions = [];
  const lyricsLanguage = document.currentScript?.dataset?.lyricsLanguage;
  const emit = (type, payload) => window.postMessage({ type, ...payload }, window.location.origin);
  const player = () => music?.player || music;
  const read = (key, fallback) => music?.[key] ?? player()?.[key] ?? fallback;
  const method = (name) => typeof music?.[name] === 'function' ? music : typeof player()?.[name] === 'function' ? player() : null;
  const settingTarget = (name) => music && name in music ? music : player() && name in player() ? player() : null;

  function getPreciseTime() {
    try {
      const active = music?.services?.mediaItemPlayback?._currentPlayer;
      const element = active?._targetElement;
      if (element && Number.isFinite(element.currentTime)) return Math.max(0, element.currentTime - (active._buffer?.currentTimestampOffset || 0));
    } catch (_) { /* Fall back to the public timeline if MusicKit internals change. */ }
    return Math.max(0, Number(read('currentPlaybackTime', 0)) || 0);
  }

  function getState() {
    const repeatValue = read('repeatMode', 0);
    const repeatEnums = window.MusicKit?.PlayerRepeatMode || { none: 0, one: 1, all: 2 };
    const shuffleValue = read('shuffleMode', false);
    const shuffleEnums = window.MusicKit?.PlayerShuffleMode || { off: 0, songs: 1 };
    return {
      songId: songInfo?.appleId || null, currentTime: getPreciseTime(),
      duration: Number(read('currentPlaybackDuration', songInfo?.duration || 0)) || songInfo?.duration || 0,
      isPlaying: !!read('isPlaying', false),
      volume: Math.max(0, Math.min(1, Number(read('volume', 1)) || 0)),
      shuffle: shuffleValue === true || shuffleValue === 'songs' || shuffleValue === shuffleEnums.songs,
      repeat: repeatValue === 'one' || repeatValue === repeatEnums.one ? 'one' : repeatValue === 'all' || repeatValue === repeatEnums.all ? 'all' : 'off',
      capabilities: { shuffle: !!settingTarget('shuffleMode'), repeat: !!settingTarget('repeatMode') },
    };
  }

  function publishState(force = false) {
    if (!music) return;
    const state = getState();
    // While playing, the per-frame timeline already sends the precise time.
    // Do not broadcast a duplicate full control snapshot for a time-only event.
    const { currentTime, ...controls } = state;
    const serialized = JSON.stringify(state.isPlaying ? controls : state);
    if (force || serialized !== lastState) { lastState = serialized; emit('LYPLUS_PLAYBACK_STATE', { state }); }
    updateFrame();
  }

  function updateFrame() {
    if (!read('isPlaying', false) || document.hidden) {
      if (frame) cancelAnimationFrame(frame);
      frame = null;
      return;
    }
    if (frame) return;
    const loop = () => {
      frame = null;
      if (!read('isPlaying', false) || document.hidden) return;
      emit('LYPLUS_TIME_UPDATE', { currentTime: getPreciseTime(), songId: songInfo?.appleId || null });
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
  }

  const validStorefront = value => typeof value === 'string' && /^[a-z]{2}$/i.test(value) ? value.toLowerCase() : null;

  async function getAccountStorefront(headers) {
    // Keep credentials and this account-scoped cache inside the page world.
    const userToken = headers['Music-User-Token'] || '';
    if (!userToken && !music.isAuthorized && !/(?:^|;\s*)media-user-token=/.test(document.cookie || '')) return null;
    const key = `${headers.Authorization}\n${userToken}`;
    if (accountStorefront?.key === key && accountStorefront.expires > Date.now()) return accountStorefront.promise;
    const controller = new AbortController();
    pendingStorefront?.abort();
    pendingStorefront = controller;
    const entry = { key, expires: Infinity, promise: null };
    entry.promise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const response = await fetch('https://amp-api.music.apple.com/v1/me/storefront', { headers, credentials: 'include', signal: controller.signal });
        if (!response.ok) return null;
        return validStorefront((await response.json())?.data?.[0]?.id);
      } catch (_) { return null; }
      finally { clearTimeout(timeout); if (pendingStorefront === controller) pendingStorefront = null; }
    })().then(value => { entry.expires = Date.now() + (value ? 30 * 60 * 1000 : 60000); return value; });
    accountStorefront = entry;
    return entry.promise;
  }

  async function fetchNativeLyrics(id) {
    if (!id || !music) return null;
    const developerToken = music.developerToken || music.configuration?.app?.developerToken;
    if (!developerToken) return null;
    pendingLyrics?.abort();
    const controller = new AbortController();
    pendingLyrics = controller;
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const requestedLanguage = lyricsLanguage || navigator.language || document.documentElement.lang || 'en-US';
      let locale = 'en-US';
      try {
        const tag = new Intl.Locale(requestedLanguage.replaceAll('_', '-'));
        locale = tag.language === 'zh' ? tag.maximize().toString() : tag.toString();
      } catch (_) { }
      // AMDL requests both lyric relationships from the catalog song resource.
      const query = new URLSearchParams({ l: locale, include: 'lyrics,syllable-lyrics', extend: 'ttmlLocalizations' });
      const headers = { Authorization: `Bearer ${developerToken}`, Accept: 'application/json' };
      if (music.musicUserToken) headers['Music-User-Token'] = music.musicUserToken;
      const account = await getAccountStorefront(headers);
      const storefronts = [...new Set([account, validStorefront(music.storefrontId) || 'us'].filter(Boolean))];
      for (const storefront of storefronts) {
        if (controller.signal.aborted) return null;
        try {
          const response = await fetch(`https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${encodeURIComponent(id)}?${query}`, { headers, credentials: 'include', signal: controller.signal });
          if (!response.ok) continue;
          const result = await response.json();
          const relationships = result?.data?.[0]?.relationships;
          const syllable = relationships?.['syllable-lyrics']?.data?.[0]?.attributes;
          const line = relationships?.lyrics?.data?.[0]?.attributes;
          const ttml = [syllable?.ttmlLocalizations, syllable?.ttml, line?.ttml]
            .find(value => typeof value === 'string' && value.trim());
          if (ttml) return ttml;
        } catch (_) { if (controller.signal.aborted) return null; }
      }
      return null;
    } catch (_) { return null; }
    finally { clearTimeout(timeout); if (pendingLyrics === controller) pendingLyrics = null; }
  }

  function syncSong(force = false) {
    const item = read('nowPlayingItem', null);
    const key = item?.id || null;
    if (!force && key === songKey) return;
    const changed = key !== songKey;
    songKey = key;
    if (!changed && songInfo) { emit('LYPLUS_SONG_SNAPSHOT', { songInfo }); return; }
    const request = ++lyricRequest;
    pendingLyrics?.abort();
    const attrs = item?.attributes;
    if (!attrs) { songInfo = null; emit('LYPLUS_SONG_CHANGED', { songInfo: null }); return; }
    const params = attrs.playParams || {};
    songInfo = {
      title: attrs.name || '', artist: attrs.artistName || '', album: attrs.albumName || '',
      duration: (Number(attrs.durationInMillis) || 0) / 1000,
      artwork: (attrs.artwork?.url || '').replaceAll('{w}', '800').replaceAll('{h}', '800'),
      appleId: String(params.catalogId || params.id || item.id), isVideo: params.kind === 'music-videos', lyricsJSON: null,
    };
    emit('LYPLUS_SONG_CHANGED', { songInfo }); // Do not hold up the cover/UI on a lyrics request.
    publishState(true);
    // hasLyrics describes the browsing storefront, not necessarily the account's.
    if (!songInfo.isVideo) {
      const id = songInfo.appleId;
      fetchNativeLyrics(id).then(ttml => {
        if (!ttml || request !== lyricRequest || songInfo?.appleId !== id) return;
        songInfo = { ...songInfo, appleMusicTTML: ttml };
        emit('LYPLUS_NATIVE_LYRICS', { songInfo });
      });
    }
  }

  async function execute(command, value) {
    if (!music) throw new Error('Apple Music is not ready yet');
    if (command === 'snapshot') { syncSong(true); publishState(true); return; }
    if (command === 'queue') {
      const queue = read('queue', null);
      return {
        position: Number(queue?.position) || 0,
        items: (Array.isArray(queue?.items) ? queue.items : []).slice(0, 100).map(item => ({ title: item.attributes?.name || item.title || '', artist: item.attributes?.artistName || item.artistName || '' })),
      };
    }
    if (command === 'airplay') {
      const element = document.querySelector('audio, video');
      if (typeof element?.webkitShowPlaybackTargetPicker !== 'function') throw new Error('AirPlay is unavailable in this browser');
      element.webkitShowPlaybackTargetPicker();
      return;
    }
    const calls = { playPause: read('isPlaying', false) ? 'pause' : 'play', previous: 'skipToPreviousItem', next: 'skipToNextItem', seek: 'seekToTime' };
    if (Object.hasOwn(calls, command)) {
      const name = calls[command];
      const target = method(name);
      if (!target) throw new Error('This playback control is unavailable');
      if (command === 'seek') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('Invalid playback position');
        await target[name](Math.min(value, getState().duration || value));
      } else { await target[name](); }
    } else if (command === 'volume') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid volume');
      const target = settingTarget('volume');
      if (!target) throw new Error('Volume control is unavailable');
      target.volume = Math.max(0, Math.min(1, value));
    } else if (command === 'shuffle') {
      if (typeof value !== 'boolean') throw new Error('Invalid shuffle mode');
      const target = settingTarget('shuffleMode');
      if (!target) throw new Error('Shuffle control is unavailable');
      const enums = window.MusicKit?.PlayerShuffleMode || { off: 0, songs: 1 };
      target.shuffleMode = value ? enums.songs : enums.off;
    } else if (command === 'repeat') {
      if (!['off', 'one', 'all'].includes(value)) throw new Error('Invalid repeat mode');
      const target = settingTarget('repeatMode');
      if (!target) throw new Error('Repeat control is unavailable');
      const enums = window.MusicKit?.PlayerRepeatMode || { none: 0, one: 1, all: 2 };
      target.repeatMode = value === 'off' ? enums.none : enums[value];
    } else { throw new Error('Unknown playback control'); }
    syncSong();
    publishState(true); // Include seek updates while paused.
  }

  window.addEventListener('message', async (event) => {
    if (event.source !== window || !event.data || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message.type === 'LYPLUS_SEEK_TO') { try { await execute('seek', message.time); } catch (_) { } return; }
    if (message.type !== 'LYPLUS_PLAYER_COMMAND' || typeof message.requestId !== 'string') return;
    try {
      const result = await execute(message.command, message.value);
      emit('LYPLUS_PLAYER_RESULT', { requestId: message.requestId, ok: true, result });
    } catch (error) { emit('LYPLUS_PLAYER_RESULT', { requestId: message.requestId, ok: false, error: error?.message || 'Playback failed' }); }
  });

  function attach(instance) {
    music = instance;
    for (const name of ['nowPlayingItemDidChange', 'playbackStateDidChange', 'playbackTimeDidChange', 'playbackDurationDidChange', 'playbackVolumeDidChange', 'volumeDidChange', 'shuffleModeDidChange', 'repeatModeDidChange', 'queueItemsDidChange']) {
      const listener = () => { syncSong(); publishState(); };
      try { instance.addEventListener(name, listener); subscriptions.push([name, listener]); } catch (_) { }
    }
    syncSong();
    publishState(true);
    poll = setInterval(() => { syncSong(); publishState(); }, 500);
  }

  function waitForMusicKit() {
    try { const instance = window.MusicKit?.getInstance(); if (instance) { attach(instance); return; } } catch (_) { }
    setTimeout(waitForMusicKit, 500);
  }
  document.addEventListener('visibilitychange', () => publishState(true));
  window.addEventListener('pagehide', () => {
    clearInterval(poll);
    if (frame) cancelAnimationFrame(frame);
    pendingLyrics?.abort();
    pendingStorefront?.abort();
    for (const [name, listener] of subscriptions) music?.removeEventListener?.(name, listener);
  }, { once: true });
  waitForMusicKit();
})();
