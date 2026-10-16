const pBrowser = typeof browser !== 'undefined'
    ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

const defaultSettings = {
    lyricsProviderOrder: 'kpoe,lrcred,unison,lrclib',
    appleMusicLyricsProviderOrder: 'amll,lunabeat,amlyrics,applemusic',
    customLLMBaseUrl: '',
    customLLMModel: '',
    lyricsSourceOrder: 'apple,lyricsplus,qq,musixmatch,musixmatch-word',
    wordByWord: true,
    lightweight: false,
    isEnabled: true,
    useSponsorBlock: false,
    autoHideLyrics: false,
    cacheStrategy: 'aggressive',
    fontSize: 16,
    hideOffscreen: true,
    blurInactive: false,
    dynamicPlayer: false,
    audioBeatSync: false,
    relaxScroll: false,
    customCSS: '',
    translationProvider: 'google',
    geminiApiKey: '',
    geminiModel: 'gemini-flash-lite-latest',
    overrideTranslateTarget: false,
    customTranslateTarget: '',
    overrideGeminiPrompt: false,
    customGeminiPrompt: '',
    overrideGeminiRomanizePrompt: false,
    customGeminiRomanizePrompt: '',
    romanizationProvider: 'offline',
    transliterationTargetScript: 'latin',
    geminiRomanizationModel: 'gemini-flash-latest',
    useSongPaletteFullscreen: false,
    useSongPaletteAllModes: false,
    overridePaletteColor: '',
    largerTextMode: 'lyrics', // 'lyrics' or 'romanization'
    hidePhoneticDup: false,
    bkgOverlap: true,
    customKpoeUrl: '',
    appleMusicTTMLBypass: false,
    appleMusicAMLL: true,
    appleMusicAMLLBackground: true,
    appleMusicDisplayMode: 'none',
    appleMusicTitleCorrection: 'off',
    appleMusicPlayerFont: '',
    appleMusicPlayerFontFile: null,
    YTSongInfo: false,
    YTSongInfoDisableSeekbar: false,
    openRouterApiKey: '',
    openRouterModel: 'google/gemma-3n-e2b-it:free',
    deeplApiKey: ''
};

let currentSettings = { ...defaultSettings };

window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data || event.data.type !== 'UPDATE_SETTINGS') return;

    console.log("Received new settings");
    updateSettings(event.data.settings);
});

function loadSettings(callback) {
    storageLocalGet(defaultSettings).then((items) => {
        currentSettings = items;
        injectCustomCSS(currentSettings.customCSS);
        if (callback) callback();
    });
}

function updateSettings(newSettings) {
    currentSettings = { ...currentSettings, ...newSettings };

    applyDynamicPlayerClass();
    if (newSettings.customCSS !== undefined) {
        injectCustomCSS(currentSettings.customCSS);
    }

    window.dispatchEvent(new CustomEvent('YOUPLUS_SETTINGS_UPDATED', {
        detail: {
            settings: currentSettings,
            changedKeys: Object.keys(newSettings)
        }
    }));
}

if (pBrowser && pBrowser.storage) {
    pBrowser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            const changedSettings = {};
            for (let key in changes) {
                // Downloading a provider index is cache I/O, not a user setting.
                // Re-rendering here can restart the previous track while the new one loads.
                if (key.startsWith('lyplusAppleLyricsIndex_') || key.startsWith('lyplusApplePlayer') || key.startsWith('lyplusAppleTitleFix:')) continue;
                changedSettings[key] = changes[key].newValue;
            }
            if (!Object.keys(changedSettings).length) return;
            console.log("Settings updated via storage");
            updateSettings(changedSettings);
        }
    });
}

function applyDynamicPlayerClass() {
    const layoutElement = document.getElementById('layout');
    if (!layoutElement) return;

    layoutElement.classList.toggle('dynamic-player', currentSettings.dynamicPlayer);
}
function injectCustomCSS(customCSS) {
    let styleTag = document.getElementById('lyrics-plus-custom-css');
    if (!styleTag) {
        styleTag = document.createElement('style');
        styleTag.id = 'lyrics-plus-custom-css';
        document.head.appendChild(styleTag);
    }
    styleTag.textContent = customCSS || '';
}
