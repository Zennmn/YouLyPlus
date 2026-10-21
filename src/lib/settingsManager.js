// ==========================================================================
// Settings Manager - Centralized storage and configuration management
// ==========================================================================

import './defaultSettings.js';

export const pBrowser = typeof browser !== 'undefined'
    ? browser
    : (typeof chrome !== 'undefined' ? chrome : null);

export const defaultSettings = globalThis.LYPLUS_DEFAULT_SETTINGS;

export function pickSettings(values = {}) {
    return Object.fromEntries(Object.entries(values).filter(([key]) => Object.hasOwn(defaultSettings, key)));
}

let currentSettings = { ...defaultSettings };
let storedSettings = { ...defaultSettings };
let pendingSettings = {};
let saveQueue = Promise.resolve();
let editRevision = 0;
const pendingRevisions = new Map();
const storageRevisions = new Map();
const settingsListeners = new Set();

function refreshCurrentSettings() {
    const next = { ...storedSettings, ...pendingSettings };
    const changed = Object.keys(defaultSettings).some(key => JSON.stringify(next[key]) !== JSON.stringify(currentSettings[key]));
    currentSettings = next;
    if (changed) for (const callback of settingsListeners) {
        try { callback(getSettings()); } catch (error) { console.warn('YouLy+: could not refresh settings UI', error); }
    }
}

export function storageLocalGet(keys) {
    if (typeof browser !== 'undefined' && browser.storage?.local) return browser.storage.local.get(keys);
    return new Promise((resolve, reject) => {
        if (!pBrowser || !pBrowser.storage) {
            console.warn("YouLy+: pBrowser.storage not available. Using mock storage fallback.");
            try {
                const mockStorage = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
                const result = {};
                const targetKeys = keys || defaultSettings;
                Object.keys(targetKeys).forEach(key => {
                    if (Object.prototype.hasOwnProperty.call(mockStorage, key)) {
                        result[key] = mockStorage[key];
                    } else {
                        result[key] = targetKeys[key];
                    }
                });
                resolve(result);
            } catch (err) {
                resolve({ ...defaultSettings });
            }
            return;
        }

        pBrowser.storage.local.get(keys, (result) => {
            if (pBrowser.runtime && pBrowser.runtime.lastError) {
                reject(pBrowser.runtime.lastError);
            } else {
                resolve(result || {});
            }
        });
    });
}

export function storageLocalSet(items) {
    if (typeof browser !== 'undefined' && browser.storage?.local) return browser.storage.local.set(items);
    return new Promise((resolve, reject) => {
        if (!pBrowser || !pBrowser.storage) {
            console.warn("YouLy+: pBrowser.storage not available. Using mock storage fallback.");
            try {
                let mockStorage = JSON.parse(localStorage.getItem('youly_mock_storage') || '{}');
                mockStorage = { ...mockStorage, ...items };
                localStorage.setItem('youly_mock_storage', JSON.stringify(mockStorage));
                resolve();
            } catch (err) {
                reject(err);
            }
            return;
        }

        pBrowser.storage.local.set(items, () => {
            if (pBrowser.runtime && pBrowser.runtime.lastError) {
                reject(pBrowser.runtime.lastError);
            } else {
                resolve();
            }
        });
    });
}

export function loadSettings(callback) {
    const revisions = new Map(storageRevisions);
    return storageLocalGet(defaultSettings).then((items) => {
        for (const [key, value] of Object.entries({ ...defaultSettings, ...pickSettings(items) })) {
            if (storageRevisions.get(key) === revisions.get(key)) storedSettings[key] = value;
        }
        refreshCurrentSettings();
        if (callback) callback(currentSettings);
        return currentSettings;
    }).catch(error => {
        console.error("YouLy+: Error loading settings:", error);
        refreshCurrentSettings();
        if (callback) callback(currentSettings);
        return currentSettings;
    });
}

export function saveSettings() {
    const operation = saveQueue.catch(() => {}).then(async () => {
        const values = { ...pendingSettings };
        if (!Object.keys(values).length) return getSettings();
        const edits = new Map(pendingRevisions);
        const revisions = new Map(storageRevisions);
        await storageLocalSet(values);
        for (const [key, value] of Object.entries(values)) {
            // An onChanged event received during the write is newer than its snapshot.
            if (storageRevisions.get(key) === revisions.get(key)) {
                storedSettings[key] = value;
                storageRevisions.set(key, (storageRevisions.get(key) || 0) + 1);
            }
            if (pendingRevisions.get(key) === edits.get(key)) {
                delete pendingSettings[key];
                pendingRevisions.delete(key);
            }
        }
        refreshCurrentSettings();
        return currentSettings;
    });
    saveQueue = operation;
    return operation;
}

export function updateSettings(newSettings) {
    const values = pickSettings(newSettings);
    for (const key of Object.keys(values)) pendingRevisions.set(key, ++editRevision);
    currentSettings = { ...currentSettings, ...values };
    pendingSettings = { ...pendingSettings, ...values };
    return currentSettings;
}

export function getSettings() {
    return { ...currentSettings };
}

function getI18nMsg(key, substitutions) {
    if (typeof msg === 'function') {
        return msg(key, substitutions);
    }
    const api = (typeof browser !== 'undefined' && browser.i18n) ? browser.i18n : (typeof chrome !== 'undefined' ? chrome.i18n : null);
    return api ? api.getMessage(key, substitutions) : '';
}

export function updateCacheSize() {
    return new Promise((resolve) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'GET_CACHED_SIZE' }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error getting cache size:", pBrowser.runtime.lastError.message);
                    const errMsg = getI18nMsg('msgErrorLoadingCache') || 'Error loading cache size.';
                    const cacheSizeEl = document.getElementById('cache-size');
                    if (cacheSizeEl) cacheSizeEl.textContent = errMsg;
                    const lyricsCacheEl = document.getElementById('lyrics-cache-size');
                    if (lyricsCacheEl) lyricsCacheEl.textContent = errMsg;
                    const transCacheEl = document.getElementById('translation-cache-size');
                    if (transCacheEl) transCacheEl.textContent = errMsg;
                    resolve({ success: false, error: pBrowser.runtime.lastError.message });
                    return;
                }
                if (response && response.success) {
                    const sizeMB = response.sizeMB || (response.sizeKB / 1024).toFixed(2);
                    const lyricsSizeMB = response.lyrics ? response.lyrics.sizeMB : (response.sizeKB / 1024).toFixed(2);
                    const lyricsCount = response.lyrics ? response.lyrics.count : response.cacheCount;
                    const transSizeMB = response.translations ? response.translations.sizeMB : '0.00';
                    const transCount = response.translations ? response.translations.count : 0;

                    const lyricsCacheEl = document.getElementById('lyrics-cache-size');
                    if (lyricsCacheEl) {
                        const formattedLyrics = getI18nMsg('labelLyricsCacheFormat', [lyricsSizeMB, String(lyricsCount)]) || getI18nMsg('labelCacheUsageFormat', [lyricsSizeMB, String(lyricsCount)]);
                        lyricsCacheEl.textContent = formattedLyrics || `${lyricsSizeMB} MB used (${lyricsCount} songs cached)`;
                    }

                    const transCacheEl = document.getElementById('translation-cache-size');
                    if (transCacheEl) {
                        const formattedTrans = getI18nMsg('labelTranslationCacheFormat', [transSizeMB, String(transCount)]);
                        transCacheEl.textContent = formattedTrans || `${transSizeMB} MB used (${transCount} items cached)`;
                    }

                    const romSizeMB = response.romanizations ? response.romanizations.sizeMB : '0.00';
                    const romCount = response.romanizations ? response.romanizations.count : 0;
                    const romCacheEl = document.getElementById('romanization-cache-size');
                    if (romCacheEl) {
                        const formattedRom = getI18nMsg('labelRomanizationCacheFormat', [romSizeMB, String(romCount)]);
                        romCacheEl.textContent = formattedRom || `${romSizeMB} MB used (${romCount} items cached)`;
                    }

                    const cacheSizeEl = document.getElementById('cache-size');
                    if (cacheSizeEl) {
                        const formatted = getI18nMsg('labelTotalCacheFormat', [sizeMB, String(response.cacheCount)]) || getI18nMsg('labelCacheUsageFormat', [sizeMB, String(response.cacheCount)]);
                        cacheSizeEl.textContent = formatted || `${sizeMB} MB used (${response.cacheCount} items cached)`;
                    }
                    const popupSizeEl = document.querySelector('.cache-size-value');
                    const popupCountEl = document.querySelector('.cache-count-value');
                    if (popupSizeEl) popupSizeEl.textContent = `${sizeMB} MB`;
                    if (popupCountEl) popupCountEl.textContent = response.cacheCount.toString();
                    resolve({ success: true, sizeMB, sizeKB: response.sizeKB, cacheCount: response.cacheCount, lyrics: response.lyrics, translations: response.translations, romanizations: response.romanizations });
                } else {
                    const err = response ? response.error : "No response";
                    console.error("YouLy+: Error getting cache size from response:", err);
                    const errMsg = getI18nMsg('msgErrorLoadingCache') || 'Could not retrieve cache size.';
                    const cacheSizeEl = document.getElementById('cache-size');
                    if (cacheSizeEl) cacheSizeEl.textContent = errMsg;
                    const lyricsCacheEl = document.getElementById('lyrics-cache-size');
                    if (lyricsCacheEl) lyricsCacheEl.textContent = errMsg;
                    const transCacheEl = document.getElementById('translation-cache-size');
                    if (transCacheEl) transCacheEl.textContent = errMsg;
                    const romCacheEl = document.getElementById('romanization-cache-size');
                    if (romCacheEl) romCacheEl.textContent = errMsg;
                    const popupSizeEl = document.querySelector('.cache-size-value');
                    const popupCountEl = document.querySelector('.cache-count-value');
                    if (popupSizeEl) popupSizeEl.textContent = 'N/A';
                    if (popupCountEl) popupCountEl.textContent = 'N/A';
                    resolve({ success: false, error: err });
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping cache size update.");
            const unavailMsg = getI18nMsg('msgCacheUnavailable') || 'Cache info unavailable.';
            const cacheSizeEl = document.getElementById('cache-size');
            if (cacheSizeEl) cacheSizeEl.textContent = unavailMsg;
            const lyricsCacheEl = document.getElementById('lyrics-cache-size');
            if (lyricsCacheEl) lyricsCacheEl.textContent = unavailMsg;
            const transCacheEl = document.getElementById('translation-cache-size');
            if (transCacheEl) transCacheEl.textContent = unavailMsg;
            const romCacheEl = document.getElementById('romanization-cache-size');
            if (romCacheEl) romCacheEl.textContent = unavailMsg;
            const popupSizeEl = document.querySelector('.cache-size-value');
            const popupCountEl = document.querySelector('.cache-count-value');
            if (popupSizeEl) popupSizeEl.textContent = 'N/A';
            if (popupCountEl) popupCountEl.textContent = 'N/A';
            resolve({ success: false, error: 'API unavailable' });
        }
    });
}

export function clearCache(target = 'all') {
    return new Promise((resolve) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'RESET_CACHE', target }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error resetting cache:", pBrowser.runtime.lastError.message);
                    resolve({ success: false, error: pBrowser.runtime.lastError.message });
                    return;
                }
                if (response && response.success) {
                    updateCacheSize();
                    resolve({ success: true });
                } else {
                    const err = response ? response.error : "No response";
                    console.error("YouLy+: Error resetting cache from response:", err);
                    resolve({ success: false, error: err });
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping cache clear.");
            resolve({ success: false, error: 'API unavailable' });
        }
    });
}

export function getLocalLyricsList() {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'GET_LOCAL_LYRICS_LIST' }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error getting local lyrics list:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response.lyricsList);
                } else {
                    const err = response ? response.error : 'Unknown error';
                    console.error("YouLy+: Error getting local lyrics list from response:", err);
                    reject(err);
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping local lyrics list retrieval.");
            reject('Local lyrics list feature is unavailable in this context.');
        }
    });
}

export function deleteLocalLyrics(songId) {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'DELETE_LOCAL_LYRICS', songId }, (response) => {
                if (pBrowser.runtime.lastError) {
                    console.error("YouLy+: Error deleting local lyrics:", pBrowser.runtime.lastError.message);
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    const err = response ? response.error : 'Unknown error';
                    console.error("YouLy+: Error deleting local lyrics from response:", err);
                    reject(err);
                }
            });
        } else {
            console.warn("YouLy+: pBrowser.runtime.sendMessage is not available. Skipping local lyrics deletion.");
            reject('Local lyrics deletion feature is unavailable in this context.');
        }
    });
}

export function getDictionaryStatus(dictionary = 'japanese') {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'GET_DICTIONARY_STATUS', dictionary }, (response) => {
                if (pBrowser.runtime.lastError) {
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response.status);
                } else {
                    reject(response ? response.error : 'Unknown error');
                }
            });
        } else {
            reject('Runtime unavailable');
        }
    });
}

export function downloadDictionary(dictionary = 'japanese') {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'DOWNLOAD_DICTIONARY', dictionary }, (response) => {
                if (pBrowser.runtime.lastError) {
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response.result);
                } else {
                    reject(response ? response.error : 'Download failed');
                }
            });
        } else {
            reject('Runtime unavailable');
        }
    });
}

export function deleteDictionary(dictionary = 'japanese') {
    return new Promise((resolve, reject) => {
        if (pBrowser && pBrowser.runtime && typeof pBrowser.runtime.sendMessage === 'function') {
            pBrowser.runtime.sendMessage({ type: 'DELETE_DICTIONARY', dictionary }, (response) => {
                if (pBrowser.runtime.lastError) {
                    return reject(pBrowser.runtime.lastError.message);
                }
                if (response && response.success) {
                    resolve(response);
                } else {
                    reject(response ? response.error : 'Delete failed');
                }
            });
        } else {
            reject('Runtime unavailable');
        }
    });
}

export function setupSettingsMessageListener(callback) {
    if (typeof callback !== 'function') return () => {};
    settingsListeners.add(callback);
    return () => settingsListeners.delete(callback);
}

// Storage change listener to keep settings in sync across all contexts
if (pBrowser && pBrowser.storage) {
    pBrowser.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') {
            const newSettings = {};
            for (let key in changes) {
                if (!Object.hasOwn(defaultSettings, key)) continue;
                newSettings[key] = changes[key].newValue === undefined ? defaultSettings[key] : changes[key].newValue;
                storageRevisions.set(key, (storageRevisions.get(key) || 0) + 1);
            }
            if (!Object.keys(newSettings).length) return;
            storedSettings = { ...storedSettings, ...newSettings };
            refreshCurrentSettings();
        }
    });
}
