// Apple Music content-script adapter. AMLL renders in a separate extension document.
let currentSongInfo = {};
let amllPlayer = null;
let amllHost = null;
let amllModal = null;
let nativeMode = false;
let trackerInjected = false;
let platformStarted = false;
let mountQueued = false;
let cachedLyricsArguments = null;
let cachedPlaybackState = null;
let cachedLyricStatus = 'loading';
let cachedProviders = [];
let cachedOffset = 0;
let manualLyricsProvider = null;
let commandSequence = 0;
let libraryRefreshTimer;
const handledLibraryChanges = { local: 0, cache: 0 };
const pendingCommands = new Map();
const TITLE_FIX_TTL = 6 * 60 * 60 * 1000;
const TITLE_FIX_MISS_TTL = 30 * 60 * 1000;
const TITLE_FIX_MEMORY_LIMIT = 80;
const TITLE_FIX_BUCKET_LIMIT = 150;
// Bump when the original-region pick rule changes so cached picks are dropped.
const TITLE_FIX_RULE = 7;
const titleFixMemory = new Map();
let titleFix = null;
let titleFixRequest = 0;
const songIdentity = (song) => song?.appleId || `${song?.title || ''}-${song?.artist || ''}-${song?.album || ''}`;

function getAppleMusicLyricsLanguage() {
    const target = currentSettings.customTranslateTarget;
    for (const value of [target && target !== 'auto' ? target : '', navigator.language, document.documentElement.lang, 'en-US']) {
        if (!value) continue;
        try {
            const locale = new Intl.Locale(value.replaceAll('_', '-'));
            // Match AMDL's explicit simplified/traditional Chinese language tags.
            return locale.language === 'zh' ? locale.maximize().toString() : locale.toString();
        } catch (_) { }
    }
    return 'en-US';
}

function rememberTitleFix(key, entry) {
    titleFixMemory.set(key, entry);
    if (titleFixMemory.size > TITLE_FIX_MEMORY_LIMIT) titleFixMemory.delete(titleFixMemory.keys().next().value);
}

function titleFixStorageKey(mode) {
    return 'lyplusAppleTitleFix:' + mode;
}

function frameSongInfo(song) {
    if (!titleFix || !song || String(song.appleId) !== String(titleFix.appleId)) return song;
    return {
        ...song,
        title: titleFix.name || song.title,
        artist: titleFix.artistName || song.artist,
        album: titleFix.albumName || song.album,
    };
}

function applyTitleFix() {
    amllPlayer?.updateSong(frameSongInfo(currentSongInfo));
    if (cachedLyricsArguments) cachedLyricsArguments[1] = frameSongInfo(cachedLyricsArguments[1]);
}

// Restore the page-provided metadata as soon as the correction stops applying.
function clearTitleFix() {
    if (!titleFix) return;
    titleFix = null;
    applyTitleFix();
}

async function readStoredTitleFix(mode, appleId) {
    if (!pBrowser?.storage?.local) return undefined;
    const key = titleFixStorageKey(mode);
    try {
        const bucket = (await storageLocalGet({ [key]: null }))?.[key];
        const entry = bucket?.[appleId];
        if (entry?.value && entry.rule === TITLE_FIX_RULE && entry.expires > Date.now()) return entry.value;
    } catch (_) { }
    return undefined;
}

function storeTitleFix(mode, appleId, value) {
    if (!value || !pBrowser?.storage?.local) return;
    const key = titleFixStorageKey(mode);
    const now = Date.now();
    (async () => {
        let bucket = {};
        try { bucket = (await storageLocalGet({ [key]: null }))?.[key] || {}; } catch (_) { }
        const entries = Object.entries(bucket).filter(entry => entry[1]?.expires > now && entry[1]?.rule === TITLE_FIX_RULE);
        entries.push([appleId, { value, rule: TITLE_FIX_RULE, expires: now + TITLE_FIX_TTL }]);
        entries.sort((first, second) => first[1].expires - second[1].expires);
        try { await storageLocalSet({ [key]: Object.fromEntries(entries.slice(-TITLE_FIX_BUCKET_LIMIT)) }); } catch (_) { }
    })();
}

// Title correction feeds only the AMLL player: the page keeps its own metadata.
async function refreshTitleFix() {
    const request = ++titleFixRequest;
    const mode = currentSettings.appleMusicTitleCorrection;
    if (!currentSettings.isEnabled || !mode || mode === 'off' || !amllHost?.isConnected || nativeMode) { clearTitleFix(); return; }
    const song = currentSongInfo;
    if (!song?.appleId || song.isVideo) { clearTitleFix(); return; }
    const appleId = String(song.appleId);
    const key = mode + ':' + appleId;
    let entry = titleFixMemory.get(key);
    if (entry && entry.expires <= Date.now()) entry = undefined;
    if (!entry) {
        const stored = await readStoredTitleFix(mode, appleId);
        if (request !== titleFixRequest) return;
        entry = typeof stored === 'undefined' ? undefined : { value: stored, expires: Date.now() + TITLE_FIX_TTL };
        if (entry) rememberTitleFix(key, entry);
    }
    let value = entry ? entry.value : undefined;
    if (value === undefined) {
        let failed = false;
        try { value = await sendPlayerCommand('catalogMetadata', { appleId, mode }); } catch (_) { failed = true; }
        if (request !== titleFixRequest) return;
        // A failed request proves nothing about the song: keep the current display and retry later.
        if (failed) { if (titleFix && titleFix.mode !== mode) clearTitleFix(); return; }
        rememberTitleFix(key, { value: value || null, expires: Date.now() + (value ? TITLE_FIX_TTL : TITLE_FIX_MISS_TTL) });
        if (value) storeTitleFix(mode, appleId, value);
    }
    if (request !== titleFixRequest) return;
    if (!value) { clearTitleFix(); return; }
    if (!amllHost?.isConnected || nativeMode || songIdentity(currentSongInfo) !== songIdentity(song)) return;
    titleFix = { mode, appleId, name: value.name || '', artistName: value.artistName || '', albumName: value.albumName || '' };
    applyTitleFix();
}

function injectDOMScript() {
    if (trackerInjected || !pBrowser?.runtime?.getURL) return;
    trackerInjected = true;
    const script = document.createElement('script');
    script.dataset.lyricsLanguage = getAppleMusicLyricsLanguage();
    script.src = pBrowser.runtime.getURL('src/inject/applemusic/songTracker.js');
    script.onload = () => script.remove();
    script.onerror = () => { trackerInjected = false; script.remove(); console.warn('YouLy+: Apple Music bridge could not load'); };
    (document.head || document.documentElement).appendChild(script);
}

function loadPlatformStyle(path, attribute) {
    let link = document.querySelector(`link[${attribute}]`);
    if (link?.sheet) return Promise.resolve();
    if (link?._lyplusLoading) return link._lyplusLoading;
    if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = pBrowser.runtime.getURL(path);
        link.setAttribute(attribute, 'true');
    }
    link._lyplusLoading = new Promise((resolve, reject) => {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', () => { link.remove(); reject(new Error('Player stylesheet could not load')); }, { once: true });
    });
    if (!link.isConnected) (document.head || document.documentElement).appendChild(link);
    return link._lyplusLoading;
}

function injectPlatformCSS() {
    return loadPlatformStyle('src/modules/applemusic/style.css', 'data-lyrics-plus-platform-style');
}

function sendPlayerCommand(command, value) {
    return new Promise((resolve, reject) => {
        const requestId = `lyplus-${Date.now()}-${++commandSequence}`;
        const timer = setTimeout(() => { pendingCommands.delete(requestId); reject(new Error('Apple Music did not respond. Try the native player.')); }, ['nativeTTML', 'lyricsLanguage'].includes(command) ? 16000 : ['queuePlay', 'favorite', 'favoriteState'].includes(command) ? 12000 : command === 'catalogMetadata' ? 10000 : 6000);
        pendingCommands.set(requestId, { resolve, reject, timer });
        window.postMessage({ type: 'LYPLUS_PLAYER_COMMAND', command, value, requestId }, window.location.origin);
    });
}

function unmountAMLL() {
    amllModal?.removeAttribute('data-lyplus-amll-active');
    amllPlayer?.dispose();
    amllPlayer = null;
    amllHost?.remove();
    amllHost = null;
}

function showNativePlayer() {
    nativeMode = true;
    unmountAMLL();
    if (!amllModal?.isConnected || amllModal.querySelector('#lyplus-amll-restore')) return;
    const button = document.createElement('button');
    button.id = 'lyplus-amll-restore';
    button.type = 'button';
    button.textContent = 'YouLy+ · AMLL';
    button.addEventListener('click', () => { nativeMode = false; button.remove(); mountAMLL(); });
    amllModal.appendChild(button);
}

function closePlayer() {
    const scope = amllModal?.closest('[data-testid="modal"]') || amllModal?.parentElement;
    const close = [...(scope?.querySelectorAll('[data-testid="close-button"], [data-testid="close-modal"], button[aria-label="Close"], button[aria-label="关闭"], .lyrics__close-button, .close-button') || [])]
        .find(element => !amllHost?.contains(element));
    if (close) { close.click(); return; }
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    setTimeout(() => { if (amllModal?.isConnected) showNativePlayer(); }, 100);
}

async function updateLocalTTML(appleId, lyrics, remove = false) {
    if (!appleId || String(currentSongInfo.appleId) !== String(appleId)) throw new Error('localTTMLSongChanged');
    if (!remove && (!Array.isArray(lyrics?.data) || !lyrics.data.some(line => typeof line.text === 'string' && line.text.trim()))) throw new Error('importTTMLInvalid');
    // The frame may show corrected titles. Storage always uses the original song.
    const song = { ...currentSongInfo };
    const response = await pBrowser.runtime.sendMessage(remove
        ? { type: 'DELETE_LOCAL_LYRICS', songInfo: song }
        : { type: 'UPLOAD_LOCAL_LYRICS', songInfo: song, jsonLyrics: lyrics });
    if (!response?.success) throw new Error(response?.error || 'Local lyrics could not be saved');
    if (songIdentity(currentSongInfo) !== songIdentity(song)) return;
    scheduleLibraryRefresh(response.localLyricsChange);
}

function mountAMLL() {
    const modal = document.querySelector('article[data-testid="lyrics-fullscreen-modal"]');
    if (modal !== amllModal) {
        unmountAMLL();
        amllModal?.querySelector('#lyplus-amll-restore')?.remove();
        amllModal = modal;
        nativeMode = false;
    }
    if (!currentSettings.isEnabled || currentSettings.appleMusicAMLL === false || !modal || nativeMode) { unmountAMLL(); return; }
    if (amllHost?.isConnected && amllPlayer) return;
    if (amllPlayer) unmountAMLL();
    if (!globalThis.LyPlusAMLLFrame?.createPlayer) { console.warn('YouLy+: AMLL frame bridge is unavailable'); return; }
    const host = document.createElement('iframe');
    host.id = 'lyplus-amll-root';
    host.setAttribute('role', 'region');
    host.setAttribute('aria-label', 'YouLy+ Apple Music player');
    modal.appendChild(host);
    amllHost = host;
    const stylesReady = injectPlatformCSS();
    try {
        amllPlayer = globalThis.LyPlusAMLLFrame.createPlayer(host, {
            sendCommand: sendPlayerCommand, onClose: closePlayer, onFallback: showNativePlayer,
            translate: (key) => typeof t === 'function' ? t(key) : '',
            getLanguage: getUserLanguage,
            settings: currentSettings,
            onSettingsChange: (values) => storageLocalSet(values),
            saveOffset: (song, value) => {
                cachedOffset = Number(value) || 0;
                if (cachedLyricsArguments) cachedLyricsArguments[11] = cachedOffset;
                return saveLyricsOffset(song, value);
            },
            reloadLyrics: () => fetchAndDisplayLyrics(currentSongInfo, false, true),
            switchProvider: switchLyricsProvider,
            setDisplayMode: (mode) => setCurrentDisplayModeAndRender(mode, currentSongInfo),
            importTTML: (id, lyrics) => updateLocalTTML(id, lyrics),
            removeLocalTTML: (id) => updateLocalTTML(id, null, true),
            onReady: () => stylesReady.then(() => {
                if (amllHost === host && host.isConnected && !nativeMode) {
                    modal.setAttribute('data-lyplus-amll-active', 'true');
                    host.focus({ preventScroll: true });
                }
            }).catch(() => { if (amllHost === host) showNativePlayer(); }),
        });
        amllPlayer.updateSettings(currentSettings);
        amllPlayer.updateSong(frameSongInfo(currentSongInfo));
        if (cachedPlaybackState) amllPlayer.updatePlayback(cachedPlaybackState);
        if (cachedLyricsArguments) amllPlayer.displayLyrics(...cachedLyricsArguments);
        else if (cachedLyricStatus === 'empty') amllPlayer.displaySongNotFound();
        else if (cachedLyricStatus === 'error') amllPlayer.displaySongError();
        amllPlayer.setAvailableProviders(cachedProviders);
        amllPlayer.setUserOffset(cachedOffset);
        amllPlayer.setVisible(!document.hidden);
        refreshTitleFix();
        sendPlayerCommand('snapshot').catch(error => amllPlayer?.showToast(error.message));
    } catch (error) { console.error('YouLy+: could not mount AMLL', error); showNativePlayer(); }
}

const LyricsPlusAPI = {
    displayLyrics: (...args) => {
        if (songIdentity(args[1]) !== songIdentity(currentSongInfo)) return;
        args[1] = frameSongInfo(args[1]);
        const switchProvider = args[8];
        const saveOffset = args[9];
        manualLyricsProvider = args[0]?.playerProviderPreference && args[0].playerProviderPreference !== 'auto' ? args[0].playerProviderPreference : null;
        args[8] = async (...parameters) => {
            const result = await switchProvider?.(...parameters);
            if (result && songIdentity(args[1]) === songIdentity(currentSongInfo)) manualLyricsProvider = parameters[0] === 'auto' ? null : parameters[0];
            return result;
        };
        args[9] = (song, value) => {
            cachedOffset = Number(value) || 0;
            if (cachedLyricsArguments) cachedLyricsArguments[11] = cachedOffset;
            return saveOffset?.(song, value);
        };
        cachedLyricsArguments = args;
        cachedLyricStatus = 'ready';
        cachedOffset = Number(args[11]) || 0;
        amllPlayer?.displayLyrics(...args);
    },
    displaySongNotFound: () => { cachedLyricStatus = 'empty'; cachedLyricsArguments = null; amllPlayer?.displaySongNotFound(); },
    displaySongError: () => { cachedLyricStatus = 'error'; cachedLyricsArguments = null; amllPlayer?.displaySongError(); },
    cleanupLyrics: () => { cachedLyricStatus = 'loading'; cachedLyricsArguments = null; amllPlayer?.cleanupLyrics(); },
    updateDisplayMode: (...args) => amllPlayer?.updateDisplayMode(...args),
    updateCurrentTick: (seconds) => {
        if (cachedPlaybackState) cachedPlaybackState.currentTime = seconds;
        amllPlayer?.updateCurrentTick(seconds);
    },
    setTranslationLoading: (value) => amllPlayer?.setTranslationLoading(value),
    showToast: (...args) => amllPlayer?.showToast(...args),
    setUserOffset: (value) => { cachedOffset = value; if (cachedLyricsArguments) cachedLyricsArguments[11] = value; amllPlayer?.setUserOffset(value); },
    setAvailableProviders: (providers) => { cachedProviders = providers || []; amllPlayer?.setAvailableProviders(cachedProviders); },
};

function queueMount() {
    if (mountQueued) return;
    mountQueued = true;
    queueMicrotask(() => { mountQueued = false; mountAMLL(); });
}

window.initializeLyricsPlusPlatform = function () {
    if (platformStarted) { mountAMLL(); return; }
    if (!document.body) { setTimeout(window.initializeLyricsPlusPlatform, 100); return; }
    platformStarted = true;
    injectPlatformCSS().catch(error => console.warn('YouLy+:', error.message));
    const observer = new MutationObserver(records => {
        if (records.some(record => !amllHost?.contains(record.target))) queueMount();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', () => {
        amllPlayer?.setVisible(!document.hidden);
        if (!document.hidden && amllPlayer) sendPlayerCommand('snapshot').catch(() => {});
    });
    window.addEventListener('pagehide', () => {
        observer.disconnect(); unmountAMLL(); clearTimeout(libraryRefreshTimer);
        for (const pending of pendingCommands.values()) { clearTimeout(pending.timer); pending.reject(new Error('Player closed')); }
        pendingCommands.clear();
    }, { once: true });
    mountAMLL();
};

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', (event) => {
    if (!currentSettings.isEnabled) { unmountAMLL(); return; }
    injectDOMScript();
    window.initializeLyricsPlusPlatform();
    if (event.detail.changedKeys?.includes('appleMusicTitleCorrection')) refreshTitleFix();
    if (event.detail.changedKeys?.includes('customTranslateTarget')) {
        currentSongInfo = { ...currentSongInfo, appleMusicTTML: undefined, appleMusicLyricsLanguage: getAppleMusicLyricsLanguage() };
        sendPlayerCommand('lyricsLanguage', getAppleMusicLyricsLanguage()).catch(error => console.warn('YouLy+: native language refresh failed', error));
    }
    // Frame messages clone their arguments; keep replay state current explicitly.
    if (cachedLyricsArguments) {
        cachedLyricsArguments[3] = event.detail.settings;
        cachedLyricsArguments[6] = event.detail.settings.largerTextMode || 'lyrics';
    }
    amllPlayer?.updateSettings(event.detail.settings);
});

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.origin !== window.location.origin) return;
    const message = event.data;
    if (message.type === 'LYPLUS_PLAYER_RESULT') {
        const pending = pendingCommands.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer); pendingCommands.delete(message.requestId);
        if (message.ok) pending.resolve(message.result); else pending.reject(Object.assign(new Error(message.error || 'Playback failed'), { code: message.code }));
    } else if (message.type === 'LYPLUS_SONG_CHANGED' || message.type === 'LYPLUS_SONG_SNAPSHOT') {
        const nextSong = message.songInfo || {};
        const changed = songIdentity(nextSong) !== songIdentity(currentSongInfo);
        if (changed) {
            clearTimeout(libraryRefreshTimer);
            resetLyricsSession();
            titleFixRequest++; titleFix = null;
            cachedLyricsArguments = null; cachedProviders = []; cachedOffset = 0;
            cachedLyricStatus = 'loading'; manualLyricsProvider = null; cachedPlaybackState = null;
        }
        currentSongInfo = nextSong;
        amllPlayer?.updateSong(frameSongInfo(currentSongInfo));
        if (changed) refreshTitleFix();
        if (message.type === 'LYPLUS_SONG_SNAPSHOT' && !cachedLyricsArguments && nextSong.title && currentSettings.isEnabled) fetchAndDisplayLyrics(nextSong, false);
    } else if (message.type === 'LYPLUS_NATIVE_LYRICS') {
        if (songIdentity(message.songInfo) !== songIdentity(currentSongInfo) || message.songInfo?.appleMusicLyricsLanguage !== getAppleMusicLyricsLanguage()) return;
        currentSongInfo = message.songInfo;
        // Remember late native TTML for manual source switching, even if an external source won.
        if (currentSettings.isEnabled) pBrowser.runtime.sendMessage({ type: 'FETCH_LYRICS', songInfo: currentSongInfo }).catch(() => {});
        const activeProvider = cachedLyricsArguments?.[0]?.provider;
        if (currentSettings.isEnabled && (!manualLyricsProvider || manualLyricsProvider === 'applemusic') && !['local', 'amll', 'lunabeat', 'amlyrics'].includes(activeProvider)) fetchAndDisplayLyrics(currentSongInfo, false, true);
    } else if (message.type === 'LYPLUS_PLAYBACK_STATE') {
        if (!message.state || message.state.songId !== (currentSongInfo.appleId || null)) return;
        cachedPlaybackState = message.state;
        amllPlayer?.updatePlayback(cachedPlaybackState);
    } else if (message.type === 'LYPLUS_TIME_UPDATE' && message.songId === (currentSongInfo.appleId || null) && Number.isFinite(message.currentTime)) {
        LyricsPlusAPI.updateCurrentTick(message.currentTime);
    }
});

function scheduleLibraryRefresh(local, cache) {
    if (!currentSettings.isEnabled || !currentSongInfo.appleId) return;
    const appleId = String(currentSongInfo.appleId);
    let changed = false;
    for (const [kind, notification] of [['local', local], ['cache', cache]]) {
        if (!notification || (kind === 'local' && notification.appleIds?.length && !notification.appleIds.map(String).includes(appleId))) continue;
        const timestamp = Number(notification.timestamp);
        if (!Number.isFinite(timestamp) || timestamp <= handledLibraryChanges[kind]) continue;
        handledLibraryChanges[kind] = timestamp;
        changed = true;
    }
    if (!changed) return;
    clearTimeout(libraryRefreshTimer);
    libraryRefreshTimer = setTimeout(() => {
        if (!currentSettings.isEnabled || String(currentSongInfo.appleId) !== appleId) return;
        manualLyricsProvider = null;
        resetLyricsSession();
        cachedProviders = []; amllPlayer?.setAvailableProviders([]);
        fetchAndDisplayLyrics(currentSongInfo, false, true).catch(error => console.warn('YouLy+: library refresh failed', error));
    }, 80);
}

pBrowser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    scheduleLibraryRefresh(changes.lyplusLocalLyricsChanged?.newValue, changes.lyplusLyricsCacheChanged?.newValue);
});
