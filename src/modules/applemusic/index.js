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
let manualProviderSelected = false;
let commandSequence = 0;
const pendingCommands = new Map();
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

injectPlatformCSS = function () {
    return loadPlatformStyle('src/modules/applemusic/style.css', 'data-lyrics-plus-platform-style');
};

function sendPlayerCommand(command, value) {
    return new Promise((resolve, reject) => {
        const requestId = `lyplus-${Date.now()}-${++commandSequence}`;
        const timer = setTimeout(() => { pendingCommands.delete(requestId); reject(new Error('Apple Music did not respond. Try the native player.')); }, command === 'nativeTTML' ? 16000 : 6000);
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
            settings: currentSettings,
            onSettingsChange: (values) => storageLocalSet(values),
            saveOffset: (song, value) => {
                cachedOffset = Number(value) || 0;
                if (cachedLyricsArguments) cachedLyricsArguments[11] = cachedOffset;
                return saveLyricsOffset(song, value);
            },
            reloadLyrics: () => fetchAndDisplayLyrics(currentSongInfo, false, true),
            setDisplayMode: (mode) => setCurrentDisplayModeAndRender(mode, currentSongInfo),
            onReady: () => stylesReady.then(() => {
                if (amllHost === host && host.isConnected && !nativeMode) { modal.setAttribute('data-lyplus-amll-active', 'true'); }
            }).catch(() => { if (amllHost === host) showNativePlayer(); }),
        });
        amllPlayer.updateSettings(currentSettings);
        amllPlayer.updateSong(currentSongInfo);
        if (cachedPlaybackState) amllPlayer.updatePlayback(cachedPlaybackState);
        if (cachedLyricsArguments) amllPlayer.displayLyrics(...cachedLyricsArguments);
        else if (cachedLyricStatus === 'empty') amllPlayer.displaySongNotFound();
        else if (cachedLyricStatus === 'error') amllPlayer.displaySongError();
        amllPlayer.setAvailableProviders(cachedProviders);
        amllPlayer.setUserOffset(cachedOffset);
        amllPlayer.setVisible(!document.hidden);
        sendPlayerCommand('snapshot').catch(error => amllPlayer?.showToast(error.message));
    } catch (error) { console.error('YouLy+: could not mount AMLL', error); showNativePlayer(); }
}

const LyricsPlusAPI = {
    displayLyrics: (...args) => {
        if (songIdentity(args[1]) !== songIdentity(currentSongInfo)) return;
        const switchProvider = args[8];
        const saveOffset = args[9];
        manualProviderSelected = !!args[0]?.playerProviderPreference && args[0].playerProviderPreference !== 'auto';
        args[8] = (...parameters) => { manualProviderSelected = parameters[0] !== 'auto'; return switchProvider?.(...parameters); };
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
    window.addEventListener('pagehide', () => { observer.disconnect(); unmountAMLL(); }, { once: true });
    mountAMLL();
};

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', (event) => {
    if (!currentSettings.isEnabled) { unmountAMLL(); return; }
    injectDOMScript();
    window.initializeLyricsPlusPlatform();
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
        if (message.ok) pending.resolve(message.result); else pending.reject(new Error(message.error || 'Playback failed'));
    } else if (message.type === 'LYPLUS_SONG_CHANGED' || message.type === 'LYPLUS_SONG_SNAPSHOT') {
        const nextSong = message.songInfo || {};
        const changed = songIdentity(nextSong) !== songIdentity(currentSongInfo);
        if (changed) { cachedLyricsArguments = null; cachedProviders = []; cachedOffset = 0; cachedLyricStatus = 'loading'; manualProviderSelected = false; cachedPlaybackState = null; }
        currentSongInfo = nextSong;
        amllPlayer?.updateSong(currentSongInfo);
        if (message.type === 'LYPLUS_SONG_SNAPSHOT' && !cachedLyricsArguments && nextSong.title && currentSettings.isEnabled) fetchAndDisplayLyrics(nextSong, false);
    } else if (message.type === 'LYPLUS_NATIVE_LYRICS') {
        if (songIdentity(message.songInfo) !== songIdentity(currentSongInfo)) return;
        currentSongInfo = message.songInfo;
        // Remember late native TTML for manual source switching, even if an external source won.
        if (currentSettings.isEnabled) pBrowser.runtime.sendMessage({ type: 'FETCH_LYRICS', songInfo: currentSongInfo }).catch(() => {});
        const activeProvider = cachedLyricsArguments?.[0]?.provider;
        if (currentSettings.isEnabled && !manualProviderSelected && !['amll', 'lunabeat', 'amlyrics'].includes(activeProvider)) fetchAndDisplayLyrics(currentSongInfo, false, true);
    } else if (message.type === 'LYPLUS_PLAYBACK_STATE') {
        if (!message.state || message.state.songId !== (currentSongInfo.appleId || null)) return;
        cachedPlaybackState = message.state;
        amllPlayer?.updatePlayback(cachedPlaybackState);
    } else if (message.type === 'LYPLUS_TIME_UPDATE' && message.songId === (currentSongInfo.appleId || null) && Number.isFinite(message.currentTime)) {
        LyricsPlusAPI.updateCurrentTick(message.currentTime);
    }
});
