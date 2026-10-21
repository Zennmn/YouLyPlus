/* =================================================================
   STATE VARIABLES
   ================================================================= */

const audioCtx = new AudioContext();

let currentFetchMediaId = null;
let fetchSessionCounter = 0;
let currentDisplayMode = 'none';     // User's intended display mode ('none', 'translate', 'romanize', 'both')
let lastProcessedDisplayMode = 'none'; // The mode that was actually rendered

let lastKnownSongInfo = null;
let lastBaseLyrics = null;
let lastTranslationResponse = null;
let lastRomanizationResponse = null;

let userOffsetMs = 0;
let offsetEditVersion = 0;
let userSelectedProvider = null;
const availableProviders = new Set();
const notFoundProviders = new Set();

// Debouncing to prevent rapid-fire requests
let lyricsFetchDebounceTimer = null;
let lastRequestedSongKey = null;
const DEBOUNCE_TIME_MS = 200;

function resetLyricsSession() {
  currentFetchMediaId = null;
  lastKnownSongInfo = null;
  lastBaseLyrics = null;
  lastTranslationResponse = null;
  lastRomanizationResponse = null;
  userSelectedProvider = null;
  availableProviders.clear(); notFoundProviders.clear();
  userOffsetMs = 0;
  clearTimeout(lyricsFetchDebounceTimer); lyricsFetchDebounceTimer = null;
}

// Settings keys that affect which cached responses to invalidate
const TRANSLATION_SETTING_KEYS = [
  'customLLMBaseUrl', 'customLLMApiKey', 'customLLMModel',
  'translationProvider',
  'geminiApiKey',
  'geminiModel',
  'openRouterApiKey',
  'openRouterModel',
  'deeplApiKey',
  'overrideTranslateTarget',
  'customTranslateTarget',
  'targetLang',
  'overrideGeminiPrompt',
  'customGeminiPrompt'
];
const ROMANIZATION_SETTING_KEYS = [
  'romanizationProvider',
  'geminiRomanizationModel',
  'transliterationTargetScript',
  'overrideGeminiRomanizePrompt',
  'customGeminiRomanizePrompt'
];
const SHARED_PROVIDER_SETTING_KEYS = ['geminiApiKey', 'openRouterApiKey', 'openRouterModel'];
let settingsRefreshTimer;
let settingsForceReload = false;


/* =================================================================
   HELPER FUNCTIONS - DATA PROCESSING
   ================================================================= */

/**
 * Merges translation and romanization data into a deep copy of the base lyrics object.
 * @param {object}      baseLyrics     - The original lyrics object.
 * @param {object|null} translation    - The translation lyrics object.
 * @param {object|null} romanization   - The romanization lyrics object.
 * @returns {object} The merged lyrics object.
 */
function combineLyricsData(baseLyrics, translation, romanization) {
  const combined = JSON.parse(JSON.stringify(baseLyrics)); // Deep copy

  const translationData  = translation?.data;
  const romanizationData = romanization?.data;

  combined.data = combined.data.map((line, index) => {
    const translatedLine  = translationData?.[index];
    const romanizedLine   = romanizationData?.[index];
    let mergedLine = { ...line };

    if (translatedLine?.translatedText) {
      mergedLine.translatedText = translatedLine.translatedText;
    }

    if (romanizedLine) {
      const hasWordSyncedRomanization =
        baseLyrics.type === "Word" &&
        romanizedLine.chunk?.length > 0 &&
        mergedLine.syllabus?.length > 0;

      if (hasWordSyncedRomanization) {
        mergedLine.syllabus = mergedLine.syllabus.map((syllable, sylIndex) => {
          const romanizedSyllable = romanizedLine.chunk[sylIndex];
          return {
            ...syllable,
            romanizedText: romanizedSyllable?.text || syllable.text
          };
        });
      } else if (romanizedLine.text) {
        mergedLine.romanizedText = romanizedLine.text;
      }
    }

    return mergedLine;
  });

  return combined;
}

/**
 * Determines the final display mode for the renderer based on user intent and data availability.
 * Falls back gracefully when the intended data could not be fetched.
 * @param {string}  intendedMode     - The mode the user wants ('none', 'translate', 'romanize', 'both').
 * @param {boolean} hasTranslation   - Whether translation data was successfully fetched.
 * @param {boolean} hasRomanization  - Whether romanization data was successfully fetched.
 * @returns {string} The resolved display mode.
 */
function determineFinalDisplayMode(intendedMode, hasTranslation, hasRomanization) {
  if (intendedMode === 'both') {
    if (hasTranslation && hasRomanization) return 'both';
    if (hasTranslation) return 'translate';
    if (hasRomanization) return 'romanize';
  }
  if (intendedMode === 'translate' && hasTranslation) return 'translate';
  if (intendedMode === 'romanize' && hasRomanization) return 'romanize';
  return 'none';
}

/**
 * Coerces a lyrics type string to one of the three valid values: "None", "Line", or "Word".
 * Any unrecognised value is treated as "Word".
 * @param {string} type - The raw type value.
 * @returns {string} The normalised type.
 */
function normalizeLyricsType(type) {
  if (type === "None" || type === "Line") return type;
  return "Word";
}

/**
 * Converts Word-synced lyrics to Line-synced format.
 * Used when word-by-word display is disabled.
 * @param {object} lyrics - The original lyrics object.
 * @returns {object} A new Line-type lyrics object, or the original if already Line/None.
 */
function convertWordLyricsToLine(lyrics) {
  if (lyrics.type !== "Word") return lyrics;

  return {
    ...lyrics,
    type: "Line",
    data: lyrics.data.map(line => ({
      ...line,
      ...(line.amll && !line.romanizedText && line.syllabus?.some(syl => syl.romanizedText)
        ? { romanizedText: line.syllabus.map(syl => syl.romanizedText || syl.text).join('') } : {}),
      syllabus: [],
    })),
  };
}


/* =================================================================
   HELPER FUNCTIONS - FETCHING LOGIC
   ================================================================= */

/**
 * Returns false if an in-flight debounce already covers this exact request,
 * signalling that the fetch can be safely skipped.
 */
function shouldFetchLyrics(songKey, forceReload) {
  return !(
    lyricsFetchDebounceTimer &&
    lastRequestedSongKey === songKey &&
    !forceReload &&
    currentDisplayMode === lastProcessedDisplayMode
  );
}

/**
 * Resolves which display mode should actually be used for this fetch cycle.
 * For new songs with no prior state, the mode is derived from current settings;
 * otherwise the user's existing selection is preserved.
 */
function resolveEffectiveMode() {
  return ['none', 'translate', 'romanize', 'both'].includes(currentSettings.appleMusicDisplayMode)
    ? currentSettings.appleMusicDisplayMode : 'none';
}

function sameAppleSong(first, second) {
  return !!first?.appleId && String(first.appleId) === String(second?.appleId);
}

function activeLyricsSong() {
  return typeof currentSongInfo !== 'undefined' && currentSongInfo?.appleId ? currentSongInfo : null;
}

/**
 * Fetches the base lyrics for the current song, using the cache when appropriate.
 * Returns null if the song changed mid-request or if the fetch failed.
 */
async function fetchBaseLyrics(currentSong, isNewSong, forceReload, fetchId) {
  const isSameSong = lastBaseLyrics && sameAppleSong(lastKnownSongInfo, currentSong);

  if (!isNewSong && !forceReload && isSameSong) {
    if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
    return lastBaseLyrics;
  }

  LyricsPlusAPI.cleanupLyrics();
  lastBaseLyrics = null;
  lastTranslationResponse = null;
  lastRomanizationResponse = null;

  const response = await pBrowser.runtime.sendMessage({
    type: 'FETCH_LYRICS',
    songInfo: currentSong,
    forceReload: forceReload
  });

  if (currentFetchMediaId !== fetchId) {
    console.warn("Song changed during initial lyrics fetch. Aborting.", currentSong);
    return null;
  }

  if (!response?.success) {
    console.warn('Failed to fetch original lyrics:', response?.error || response?.err || 'Unknown error');
    if (LyricsPlusAPI.displaySongNotFound) LyricsPlusAPI.displaySongNotFound();
    return null;
  }

  lastBaseLyrics = response.lyrics;
  if (response.availableProviders) {
    setAvailableProviders(response.availableProviders);
  }
  return lastBaseLyrics;
}

/**
 * Initiates translation and romanization fetches independently without blocking each other.
 * Each fetch updates the UI as soon as its data is ready.
 */
function getLyricsTargetLanguage(currentSong) {
  return getAppleMusicLyricsLanguage();
}

function fetchAdditionalData(currentSong, effectiveMode, htmlLang, fetchId) {
  const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
  const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

  if (needsTranslation && !lastTranslationResponse) {
    pBrowser.runtime.sendMessage({
      type: 'TRANSLATE_LYRICS',
      action: 'translate',
      songInfo: currentSong,
      targetLang: htmlLang
    }).then(response => {
      if (currentFetchMediaId === fetchId) {
        lastTranslationResponse = response || { success: false };
        updateAndRenderCombinedLyrics(currentSong, fetchId);
      }
    }).catch(error => {
      console.warn("Translation request error:", error);
      if (currentFetchMediaId === fetchId) {
        lastTranslationResponse = { success: false, error: error.message };
        updateAndRenderCombinedLyrics(currentSong, fetchId);
      }
    });
  }

  if (needsRomanization && !lastRomanizationResponse) {
    pBrowser.runtime.sendMessage({
      type: 'TRANSLATE_LYRICS',
      action: 'romanize',
      songInfo: currentSong,
      targetLang: htmlLang
    }).then(response => {
      if (currentFetchMediaId === fetchId) {
        lastRomanizationResponse = response || { success: false };
        updateAndRenderCombinedLyrics(currentSong, fetchId);
      }
    }).catch(error => {
      console.warn("Romanization request error:", error);
      if (currentFetchMediaId === fetchId) {
        lastRomanizationResponse = { success: false, error: error.message };
        updateAndRenderCombinedLyrics(currentSong, fetchId);
      }
    });
  }
}

/* =================================================================
   PROVIDER, SOURCE & OFFSET HELPERS (NON-RENDERING)
   ================================================================= */

function detectLyricsProviderFromSource(source) {
  const name = String(source || '').toLowerCase();
  for (const key of ['amll', 'lunabeat', 'amlyrics', 'local']) if (name.includes(key)) return key;
  return name.includes('apple') ? 'applemusic' : '';
}

function getLyricsProviderContext(songInfo = lastKnownSongInfo, lyrics = lastBaseLyrics, settings = currentSettings, selectedProvider = userSelectedProvider) {
  const configured = String(settings.appleMusicLyricsProviderOrder || defaultSettings.appleMusicLyricsProviderOrder)
    .split(',').map(key => key.trim()).filter(key => ['amll', 'lunabeat', 'amlyrics'].includes(key));
  const providerKeys = [...new Set(configured), 'applemusic'];
  const activeProvider = lyrics?.provider || lyrics?.metadata?.provider
    || detectLyricsProviderFromSource(lyrics?.metadata?.source) || selectedProvider || '';
  if ((activeProvider === 'local' || availableProviders.has('local')) && !providerKeys.includes('local')) providerKeys.unshift('local');
  return {
    providerKeys, activeProvider,
    providerDisplayNames: { amll: 'AMLL TTML DB', lunabeat: 'LunaBeat', amlyrics: 'AmLyrics', applemusic: 'Apple Music', local: t('playerLocalLyrics') || 'Local TTML' }
  };
}

function saveLyricsOffset(songInfo, offsetMs) {
  if (!sameAppleSong(songInfo, activeLyricsSong())) return Promise.resolve();
  userOffsetMs = offsetMs;
  offsetEditVersion++;
  return pBrowser.runtime.sendMessage({ type: 'SAVE_LYRICS_OFFSET', songInfo, offsetMs }).then(response => {
    if (!response?.success) throw new Error(response?.error || 'Could not save lyrics offset');
  }).catch(error => {
    console.warn('Failed to save offset:', error);
    if (sameAppleSong(songInfo, activeLyricsSong())) LyricsPlusAPI.showToast?.(t('playerOffsetSaveFailed') || 'Could not save lyrics offset. Try again.');
  });
}

async function loadLyricsOffset(songInfo, fetchId) {
  if (!songInfo || typeof pBrowser === 'undefined' || !pBrowser.runtime?.sendMessage) return 0;
  const editVersion = offsetEditVersion;
  try {
    const response = await pBrowser.runtime.sendMessage({
      type: 'GET_LYRICS_OFFSET',
      songInfo
    });
    if ((fetchId && currentFetchMediaId !== fetchId) || editVersion !== offsetEditVersion) return userOffsetMs;
    if (response && Number.isFinite(response.offsetMs)) {
      userOffsetMs = response.offsetMs;
      if (LyricsPlusAPI.setUserOffset) {
        LyricsPlusAPI.setUserOffset(response.offsetMs);
      }
      return response.offsetMs;
    }
  } catch (err) {
    console.warn('Failed to load lyrics offset:', err);
  }
  return 0;
}

async function loadAvailableProviders(songInfo, fetchId) {
  if (!songInfo || typeof pBrowser === 'undefined' || !pBrowser.runtime?.sendMessage) return;
  try {
    const response = await pBrowser.runtime.sendMessage({
      type: 'GET_AVAILABLE_PROVIDERS',
      songInfo
    });
    if (currentFetchMediaId !== fetchId || !sameAppleSong(songInfo, activeLyricsSong())) return;
    if (response?.success && Array.isArray(response.availableProviders)) {
      setAvailableProviders(response.availableProviders);
    }
  } catch (err) {}
}

function setAvailableProviders(providers) {
  if (Array.isArray(providers)) {
    providers.forEach(p => {
      if (p && !notFoundProviders.has(p.toLowerCase())) {
        availableProviders.add(p.toLowerCase());
      }
    });
  }
  const activeProvider = (
    userSelectedProvider ||
    lastBaseLyrics?.provider ||
    lastBaseLyrics?.metadata?.provider ||
    detectLyricsProviderFromSource(lastBaseLyrics?.metadata?.source)
  );
  if (activeProvider) {
    availableProviders.add(activeProvider.toLowerCase());
  }

  if (LyricsPlusAPI.setAvailableProviders) {
    LyricsPlusAPI.setAvailableProviders(Array.from(availableProviders));
  }
}

function getProviderDisplayName(provider) {
  return getLyricsProviderContext().providerDisplayNames[provider] || provider;
}

async function switchLyricsProvider(providerId) {
  const currentSong = activeLyricsSong();
  if (!currentSong || !['auto', 'local', 'amll', 'lunabeat', 'amlyrics', 'applemusic'].includes(providerId)) return false;
  const baseId = currentSong.appleId;
  const fetchId = `${baseId}__${++fetchSessionCounter}`;
  currentFetchMediaId = fetchId;
  const providerName = getProviderDisplayName(providerId, lastBaseLyrics);

  try {
    const response = await pBrowser.runtime.sendMessage({
      type: 'SWITCH_LYRICS_PROVIDER',
      songInfo: currentSong,
      provider: providerId
    });

    if (currentFetchMediaId !== fetchId) {
      console.warn("Song changed during lyrics provider switch. Aborting.", currentSong);
      return false;
    }

    if (response?.success && response.lyrics) {
      userSelectedProvider = providerId === 'auto' ? null : providerId;
      if (providerId !== 'auto') availableProviders.add(providerId.toLowerCase());
      if (response.availableProviders) {
        availableProviders.clear();
        setAvailableProviders(response.availableProviders);
      } else if (LyricsPlusAPI.setAvailableProviders) {
        LyricsPlusAPI.setAvailableProviders(Array.from(availableProviders));
      }

      lastKnownSongInfo = currentSong;
      // Clear previous translation and romanization responses as lyrics lines/timing differ
      lastTranslationResponse = null;
      lastRomanizationResponse = null;

      lastBaseLyrics = response.lyrics;
      await updateAndRenderCombinedLyrics(currentSong, fetchId);

      // Re-trigger translation / romanization fetch if enabled
      const needsTranslation = currentDisplayMode === 'translate' || currentDisplayMode === 'both';
      const needsRomanization = currentDisplayMode === 'romanize' || currentDisplayMode === 'both' || currentSettings.largerTextMode === "romanization";
      if (currentFetchMediaId === fetchId && (needsTranslation || needsRomanization)) {
        if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
        const htmlLang = getLyricsTargetLanguage(currentSong);
        fetchAdditionalData(currentSong, currentDisplayMode, htmlLang, fetchId);
      }

      if (currentFetchMediaId !== fetchId) return false;
      if (LyricsPlusAPI.showToast) {
        LyricsPlusAPI.showToast(t('playerSourceSwitched', providerName) || `Switched lyrics to ${providerName}`);
      }
      return true;
    } else {
      notFoundProviders.add(providerId.toLowerCase());
      availableProviders.delete(providerId.toLowerCase());
      if (LyricsPlusAPI.showToast) {
        const notFoundMsg = t('playerSourceUnavailable') || `No lyrics found from ${providerName}`;
        LyricsPlusAPI.showToast(notFoundMsg);
      }
      return false;
    }
  } catch (error) {
    console.warn("Failed to switch lyrics provider:", error);
    if (LyricsPlusAPI.showToast) {
      if (sameAppleSong(currentSong, activeLyricsSong())) LyricsPlusAPI.showToast(t('playerSourceSwitchFailed') || 'Could not switch lyrics source');
    }
    return false;
  }
}

/**
 * Calls the LyricsPlusAPI display function with the standard argument set.
 */
function callDisplayLyricsAPI(lyrics, currentSong, displayMode) {
  LyricsPlusAPI.displayLyrics(
    lyrics,
    currentSong,
    displayMode,
    currentSettings,
    fetchAndDisplayLyrics,
    setCurrentDisplayModeAndRender,
    currentSettings.largerTextMode,
    audioCtx.outputLatency || 0,
    switchLyricsProvider,
    saveLyricsOffset,
    getLyricsProviderContext,
    userOffsetMs
  );
}

/**
 * Renders the base lyrics immediately as a placeholder while additional data loads.
 * Shown only for new songs to avoid an empty state during async fetches.
 */
function renderPreliminaryBaseLyrics(baseLyrics, currentSong) {
  let lyrics = JSON.parse(JSON.stringify(baseLyrics));

  if (lyrics.type === "Word" && !currentSettings.wordByWord) {
    lyrics = convertWordLyricsToLine(lyrics);
  }

  lyrics.type = normalizeLyricsType(lyrics.type);
  callDisplayLyricsAPI(lyrics, currentSong, 'none');
}

/**
 * Renders the fully enriched lyrics with the resolved display mode.
 */
function renderFinalLyrics(lyrics, currentSong, displayMode) {
  lyrics.type = normalizeLyricsType(lyrics.type);

  if (LyricsPlusAPI.displayLyrics) {
    callDisplayLyricsAPI(lyrics, currentSong, displayMode);
  } else {
    console.error("displayLyrics is not available.");
  }
}

/**
 * Renders the lyrics with whatever translation and romanization data is currently available.
 * Manages loading indicator state based on whether any required request is still pending.
 */
async function updateAndRenderCombinedLyrics(currentSong, fetchId) {
  if (currentFetchMediaId !== fetchId || !lastBaseLyrics) return;

  const hasTranslationResponse = lastTranslationResponse?.success && lastTranslationResponse.translatedLyrics?.data?.some(line => line.translatedText || line.translation?.text);
  const hasSourceTranslation = lastBaseLyrics.data.some(line => line.translatedText || line.translation?.text || (typeof line.translation === 'string' && line.translation));
  const hasTranslation = hasSourceTranslation || hasTranslationResponse;
  const hasRomanizationResponse = lastRomanizationResponse?.success && lastRomanizationResponse.translatedLyrics?.data?.some(line => line.text?.trim() || line.chunk?.some(word => word.text?.trim()));
  const hasSourceRomanization = lastBaseLyrics.data.some(line => line.romanizedText || line.syllabus?.some(syl => syl.romanizedText));
  const hasRomanization = hasRomanizationResponse || hasSourceRomanization;

  let lyrics = combineLyricsData(
    lastBaseLyrics,
    hasTranslationResponse ? lastTranslationResponse.translatedLyrics : null,
    hasRomanizationResponse ? lastRomanizationResponse.translatedLyrics : null
  );

  const finalDisplayMode = determineFinalDisplayMode(currentDisplayMode, hasTranslation, hasRomanization);

  if (lyrics.type === "Word" && !currentSettings.wordByWord) {
    lyrics = convertWordLyricsToLine(lyrics);
  }

  const feedback = (needed, present, response) => !needed ? 'hidden' : present ? 'ready'
    : !response ? 'loading' : response.success ? 'unavailable' : 'error';
  lyrics.displayFeedback = {
    translation: feedback(['translate', 'both'].includes(currentDisplayMode), hasTranslation, lastTranslationResponse),
    romanization: feedback(['romanize', 'both'].includes(currentDisplayMode) || currentSettings.largerTextMode === 'romanization', hasRomanization, lastRomanizationResponse)
  };

  renderFinalLyrics(lyrics, currentSong, finalDisplayMode);

  lastKnownSongInfo = currentSong;
  lastProcessedDisplayMode = finalDisplayMode;

  const needsTranslation = currentDisplayMode === 'translate' || currentDisplayMode === 'both';
  const needsRomanization = currentDisplayMode === 'romanize' || currentDisplayMode === 'both' || currentSettings.largerTextMode === "romanization";
  const isTranslationPending = needsTranslation && !lastTranslationResponse && !hasSourceTranslation;
  const isRomanizationPending = needsRomanization && !lastRomanizationResponse && !hasSourceRomanization;

  if (LyricsPlusAPI.setTranslationLoading) {
    LyricsPlusAPI.setTranslationLoading(isTranslationPending || isRomanizationPending);
  }
}


/* =================================================================
   CORE LOGIC: FETCHING AND PROCESSING
   ================================================================= */

async function fetchAndDisplayLyrics(currentSong, isNewSong = false, forceReload = false) {
  if (!currentSong?.appleId || !sameAppleSong(currentSong, activeLyricsSong()) || !currentSettings.isEnabled) return;
  const songKey = String(currentSong.appleId);
  if (!shouldFetchLyrics(songKey, forceReload)) return;

  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = setTimeout(() => {
    lyricsFetchDebounceTimer = null;
    lastRequestedSongKey = null;
  }, DEBOUNCE_TIME_MS);
  lastRequestedSongKey = songKey;

  const baseId = currentSong.appleId;
  const fetchId = `${baseId}__${++fetchSessionCounter}`;
  currentFetchMediaId = fetchId;

  try {
    const effectiveMode = resolveEffectiveMode(isNewSong, currentSong);
    currentDisplayMode = effectiveMode;

    const isDifferentSong = !sameAppleSong(lastKnownSongInfo, currentSong);
    if (isNewSong || isDifferentSong) {
      userSelectedProvider = null;
      availableProviders.clear();
      notFoundProviders.clear();
      userOffsetMs = 0;
      lastBaseLyrics = null;
      lastTranslationResponse = null;
      lastRomanizationResponse = null;
      lastKnownSongInfo = currentSong;
      loadAvailableProviders(currentSong, fetchId);
      await loadLyricsOffset(currentSong, fetchId);
      if (currentFetchMediaId !== fetchId) return;
    }

    const baseLyrics = await fetchBaseLyrics(currentSong, isNewSong, forceReload, fetchId);
    if (!baseLyrics) return;

    const needsTranslation = effectiveMode === 'translate' || effectiveMode === 'both';
    const needsRomanization = effectiveMode === 'romanize' || effectiveMode === 'both' || currentSettings.largerTextMode === "romanization";

    const isMissingTranslation = needsTranslation && !lastTranslationResponse;
    const isMissingRomanization = needsRomanization && !lastRomanizationResponse;

    if (isNewSong) {
      renderPreliminaryBaseLyrics(baseLyrics, currentSong);
    }
    await updateAndRenderCombinedLyrics(currentSong, fetchId);

    if (currentFetchMediaId === fetchId && (isMissingTranslation || isMissingRomanization)) {
      if (LyricsPlusAPI.setTranslationLoading) LyricsPlusAPI.setTranslationLoading(true);
      const htmlLang = getLyricsTargetLanguage(currentSong);
      fetchAdditionalData(currentSong, effectiveMode, htmlLang, fetchId);
    }

  } catch (error) {
    console.warn('Error in fetchAndDisplayLyrics:', error);
    if (currentFetchMediaId === fetchId) {
      if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
    }
  }
}


/* =================================================================
   PUBLIC API AND RENDER TRIGGER
   ================================================================= */

function setCurrentDisplayModeAndRender(mode, overrideSongInfo) {
  if (!['none', 'translate', 'romanize', 'both'].includes(mode)) return;
  currentDisplayMode = mode;
  const song = overrideSongInfo || activeLyricsSong();
  if (!sameAppleSong(song, activeLyricsSong())) return;
  if (song?.appleId) {
    updateSettings({ appleMusicDisplayMode: mode });
    storageLocalSet({ appleMusicDisplayMode: mode }).catch(error => {
      console.warn('Failed to save display mode:', error);
      LyricsPlusAPI.showToast?.(t('playerModeSaveFailed') || 'Could not save display mode. Try again.');
    });
  }

  if (song) {
    clearTimeout(settingsRefreshTimer);
    clearTimeout(lyricsFetchDebounceTimer); lyricsFetchDebounceTimer = null;
    fetchAndDisplayLyrics(song, false, false);
  } else {
    console.error("Cannot update display mode: No song information available for refetch.");
    currentDisplayMode = 'none';
    if (LyricsPlusAPI.displaySongError) LyricsPlusAPI.displaySongError();
  }
}


/* =================================================================
   LIVE SETTINGS UPDATE LISTENER
   ================================================================= */

window.addEventListener('YOUPLUS_SETTINGS_UPDATED', ({ detail }) => {
  const changedKeys = detail?.changedKeys || [];
  if (!changedKeys.length) return;
  const translationChanged = changedKeys.some(key => TRANSLATION_SETTING_KEYS.includes(key));
  const romanizationChanged = changedKeys.some(key => ROMANIZATION_SETTING_KEYS.includes(key) || SHARED_PROVIDER_SETTING_KEYS.includes(key));
  const sourceChanged = changedKeys.includes('appleMusicLyricsProviderOrder');
  const languageChanged = changedKeys.includes('customTranslateTarget');
  const modeChanged = changedKeys.includes('appleMusicDisplayMode');
  const rerender = translationChanged || romanizationChanged || sourceChanged || modeChanged
    || changedKeys.some(key => ['wordByWord', 'largerTextMode', 'hidePhoneticDup', 'isEnabled'].includes(key));
  if (!currentSettings.isEnabled) { resetLyricsSession(); return; }
  if (!rerender) return;
  // Reject old replies immediately, before the coalesced refresh starts.
  currentFetchMediaId = null;
  if (translationChanged) lastTranslationResponse = null;
  if (romanizationChanged) lastRomanizationResponse = null;
  if (sourceChanged) userSelectedProvider = null;
  settingsForceReload ||= sourceChanged || languageChanged;
  clearTimeout(lyricsFetchDebounceTimer);
  lyricsFetchDebounceTimer = null;
  clearTimeout(settingsRefreshTimer);
  settingsRefreshTimer = setTimeout(() => {
    const song = activeLyricsSong();
    const forceReload = settingsForceReload;
    settingsForceReload = false;
    if (song) fetchAndDisplayLyrics(song, false, forceReload).catch(error => console.warn('YouLy+: settings refresh failed', error));
  }, 100);
});
