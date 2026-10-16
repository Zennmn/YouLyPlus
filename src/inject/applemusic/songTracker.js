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
  let nativeLyricsRequest;
  let accountStorefront;
  let pendingStorefront;
  let pendingMetadata;
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

  function fetchNativeLyrics(id) {
    if (nativeLyricsRequest?.id === id && !pendingLyrics?.signal.aborted) return nativeLyricsRequest.promise;
    const entry = { id };
    entry.promise = requestNativeLyrics(id).finally(() => {
      if (nativeLyricsRequest === entry) nativeLyricsRequest = null;
    });
    nativeLyricsRequest = entry;
    return entry.promise;
  }

  async function requestNativeLyrics(id) {
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

  const metadataCache = new Map();
  const METADATA_TTL = 6 * 60 * 60 * 1000;
  const METADATA_MISS_TTL = 30 * 60 * 1000;

  const hasCjkText = value => /[\u3041-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff66-\uff9d]/.test(value || '');
  const hasHangulText = value => /[\uac00-\ud7af]/.test(value || '');
  const JAPANESE_METADATA = /j-pop|j-rock|japanese|anime|日本流行|日语流行|日語流行|动画|動畫/;
  const KOREAN_METADATA = /k-pop|korean|韩国流行|韓國流行|韩语流行|韓語流行/;
  const CHINESE_METADATA = /mandopop|cantopop|mandarin|chinese|hong kong|taiwan|国语流行|國語流行|华语流行|華語流行|中文流行|粤语流行|粵語流行/;

  // The original region comes from the recording itself, the way AM++ resolves it:
  // the ISRC country prefix names the release country (JP, KR, CN/HK/MO/TW) and the
  // genre covers what the ISRC does not. Scripts only corroborate a found entry, so
  // the JP storefront rewriting a foreign song in katakana can no longer win.
  function originalLanguageFor(base, pageText) {
    // Genres first, then the ISRC country prefix: the same order the module uses.
    for (const genreName of base?.genreNames || []) {
      const genre = String(genreName).toLowerCase();
      if (JAPANESE_METADATA.test(genre)) return 'ja-JP';
      if (KOREAN_METADATA.test(genre)) return 'ko-KR';
      if (CHINESE_METADATA.test(genre)) return 'zh-Hans-CN';
    }
    const country = String(base?.isrc || '').trim().slice(0, 2).toUpperCase();
    if (country === 'JP') return 'ja-JP';
    if (country === 'KR') return 'ko-KR';
    if (['CN', 'HK', 'MO', 'TW'].includes(country)) return 'zh-Hans-CN';
    // With neither signal, only a song the page itself shows in CJK is retried.
    return hasCjkText(pageText) ? 'unknown-cjk' : null;
  }

  function pickOriginalMetadata(results, pageText) {
    const base = results.get('us') || results.get('jp') || results.get('cn') || results.get('hk') || results.get('tw');
    const language = originalLanguageFor(base, pageText);
    if (!language) return null;
    if (language === 'ja-JP') return results.get('jp') || null;
    if (language === 'ko-KR') {
      const korean = results.get('kr');
      return korean && hasHangulText(korean.name) ? korean : null;
    }
    if (language === 'unknown-cjk') {
      const japanese = results.get('jp');
      if (japanese && hasCjkText(japanese.name)) return japanese;
    }
    // Simplified first (cn, then the zh-Hans localization other storefronts carry),
    // then the traditional Hong Kong/Taiwan spelling.
    for (const storefront of ['cn', 'us', 'hk', 'tw']) {
      const candidate = results.get(storefront);
      if (candidate && hasCjkText(candidate.name)) return candidate;
    }
    return null;
  }

  async function fetchCatalogSongAttributes(storefront, language, id, headers, signal) {
    const query = new URLSearchParams({ l: language });
    const url = 'https://amp-api.music.apple.com/v1/catalog/' + storefront + '/songs/' + encodeURIComponent(id) + '?' + query.toString();
    const response = await fetch(url, { headers, credentials: 'include', signal });
    if (!response.ok) return null;
    const attributes = (await response.json())?.data?.[0]?.attributes;
    return attributes ? {
      name: attributes.name || '',
      artistName: attributes.artistName || '',
      albumName: attributes.albumName || '',
      isrc: attributes.isrc || '',
      genreNames: attributes.genreNames || [],
    } : null;
  }

  // Title correction for the AMLL player only: fetch the song resource with the
  // storefront/language of the selected region and return its title/artist/album.
  // The page keeps its own Apple Music metadata; only the extension player shows this.
  async function requestCatalogMetadata(id, mode) {
    if (!id || !music || !['original', 'cn', 'jp'].includes(mode)) return null;
    const cacheKey = mode + ':' + id;
    const cached = metadataCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;
    const developerToken = music.developerToken || music.configuration?.app?.developerToken;
    if (!developerToken) return null;
    pendingMetadata?.abort();
    const controller = new AbortController();
    pendingMetadata = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const headers = { Authorization: 'Bearer ' + developerToken, Accept: 'application/json' };
      if (music.musicUserToken) headers['Music-User-Token'] = music.musicUserToken;
      const account = await getAccountStorefront(headers);
      const fallback = account || validStorefront(music.storefrontId) || 'us';
      const language = mode === 'jp' ? 'ja-JP' : 'zh-CN';
      // The storefront decides whether a track exists there, the language decides
      // the script it comes back in: mainland titles are often missing from the cn
      // storefront while another storefront still serves their zh-Hans name, and
      // Hong Kong/Taiwan carry the traditional one. Every probe runs at once.
      const targets = mode === 'original'
        ? [['jp', 'ja-JP'], ['cn', 'zh-Hans-CN'], ['us', 'zh-Hans-CN'], ['hk', 'zh-Hant-HK'], ['tw', 'zh-Hant-TW'], ['kr', 'ko-KR']]
        : [[mode, language], [fallback, language]];
      const uniqueTargets = [...new Map(targets.map(target => [target[0], target])).values()];
      const results = new Map();
      // Probe in parallel: this runs while the player is already on screen.
      await Promise.all(uniqueTargets.map(async target => {
        try { results.set(target[0], await fetchCatalogSongAttributes(target[0], target[1], id, headers, controller.signal)); }
        catch (_) { results.set(target[0], null); }
      }));
      if (controller.signal.aborted) return null;
      const picked = mode === 'original'
        ? pickOriginalMetadata(results, `${songInfo?.title || ''} ${songInfo?.artist || ''}`)
        : (results.get(mode) || results.get(fallback) || null);
      const value = picked && (picked.name || picked.artistName) ? picked : null;
      metadataCache.set(cacheKey, { value, expires: Date.now() + (value ? METADATA_TTL : METADATA_MISS_TTL) });
      if (metadataCache.size > 80) metadataCache.delete(metadataCache.keys().next().value);
      return value;
    } catch (_) { return null; }
    finally { clearTimeout(timeout); if (pendingMetadata === controller) pendingMetadata = null; }
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
    if (command === 'nativeTTML') {
      syncSong();
      if (!songInfo?.appleId || songInfo.isVideo) throw new Error('nativeTTMLUnavailable');
      if (value !== songInfo.appleId) throw new Error('nativeTTMLSongChanged');
      const current = songInfo;
      const request = lyricRequest;
      const ttml = current.appleMusicTTML || await fetchNativeLyrics(current.appleId);
      if (request !== lyricRequest || songInfo?.appleId !== current.appleId) throw new Error('nativeTTMLSongChanged');
      if (typeof ttml !== 'string' || !/<(?:\w+:)?tt[\s>]/.test(ttml)) throw new Error('nativeTTMLUnavailable');
      songInfo = { ...songInfo, appleMusicTTML: ttml };
      return { ttml, appleId: current.appleId, title: current.title, artist: current.artist };
    }
    if (command === 'catalogMetadata') {
      const id = String(value?.appleId || '');
      const mode = value?.mode;
      if (!/^\d+$/.test(id) || !['original', 'cn', 'jp'].includes(mode)) throw new Error('Invalid metadata request');
      return requestCatalogMetadata(id, mode);
    }
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
    pendingMetadata?.abort();
    for (const [name, listener] of subscriptions) music?.removeEventListener?.(name, listener);
  }, { once: true });
  waitForMusicKit();
})();
