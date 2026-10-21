// ==================================================================================================
// MESSAGE HANDLER
// ==================================================================================================

import { MESSAGE_TYPES } from '../constants.js';
import { lyricsDB, translationsDB, localLyricsDB } from '../storage/database.js';
import { LyricsService } from './lyricsService.js';
import { TranslationService } from './translationService.js';
import { DataParser } from '../utils/dataParser.js';
import { dictionaryService } from '../services/romanization/dictionaryService.js';
import { browserFullscreen } from '../services/browserFullscreen.js';
import { SettingsManager } from '../storage/settings.js';

const LOCAL_LYRICS_CHANGED = 'lyplusLocalLyricsChanged';
const LYRICS_CACHE_CHANGED = 'lyplusLyricsCacheChanged';
const PROVIDER_PREFERENCE_PREFIX = 'lyplusApplePlayerProvider_';

export class MessageHandler {
  static handle(message, sender, sendResponse) {
    if (!message
      || message.target === 'catt-offscreen'
      || message.target === 'rawi-offscreen') {
      return false;
    }

    const handlers = {
      BROWSER_FULLSCREEN: async () => sendResponse({ success: true, ...await browserFullscreen(message, sender) }),
      [MESSAGE_TYPES.FETCH_LYRICS]: () => this.fetchLyrics(message, sendResponse),
      [MESSAGE_TYPES.RESET_CACHE]: () => this.resetCache(message, sendResponse),
      [MESSAGE_TYPES.GET_CACHED_SIZE]: () => this.getCacheSize(sendResponse),
      [MESSAGE_TYPES.TRANSLATE_LYRICS]: () => this.translateLyrics(message, sendResponse),
      [MESSAGE_TYPES.UPLOAD_LOCAL_LYRICS]: () => this.uploadLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.GET_LOCAL_LYRICS_LIST]: () => this.getLocalLyricsList(sendResponse),
      [MESSAGE_TYPES.DELETE_LOCAL_LYRICS]: () => this.deleteLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_LOCAL_LYRICS]: () => this.fetchLocalLyrics(message, sendResponse),
      [MESSAGE_TYPES.FETCH_IMAGE]: () => this.fetchImage(message, sendResponse),
      [MESSAGE_TYPES.SAVE_LYRICS_OFFSET]: () => this.saveLyricsOffset(message, sendResponse),
      [MESSAGE_TYPES.GET_LYRICS_OFFSET]: () => this.getLyricsOffset(message, sendResponse),
      [MESSAGE_TYPES.SWITCH_LYRICS_PROVIDER]: () => this.switchLyricsProvider(message, sendResponse),
      [MESSAGE_TYPES.GET_AVAILABLE_PROVIDERS]: () => this.getAvailableLyricsProviders(message, sendResponse),
      [MESSAGE_TYPES.GET_DICTIONARY_STATUS]: () => this.getDictionaryStatus(message, sendResponse),
      [MESSAGE_TYPES.DOWNLOAD_DICTIONARY]: () => this.downloadDictionary(message, sendResponse),
      [MESSAGE_TYPES.DELETE_DICTIONARY]: () => this.deleteDictionary(message, sendResponse)
    };

    const handler = handlers[message.type];
    if (!handler) {
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: `Unknown message type: ${message.type}` });
      return false;
    }

    handler().catch(error => {
      console.error(`Error handling ${message.type}:`, error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  static async fetchLyrics(message, sendResponse) {
    try {
      const { lyrics } = await LyricsService.getOrFetch(
        message.songInfo,
        message.forceReload,
        message.requestedSource
      );
      const availableProviders = await LyricsService.getAvailableProviders(message.songInfo);
      sendResponse({ success: true, lyrics, metadata: message.songInfo, availableProviders });
    } catch (error) {
      sendResponse({ success: false, error: error.message, metadata: message.songInfo });
    }
  }

  static async translateLyrics(message, sendResponse) {
    try {
      const translatedLyrics = await TranslationService.getOrFetch(
        message.songInfo,
        message.action,
        message.targetLang,
        message.forceReload
      );
      sendResponse({ success: true, translatedLyrics });
    } catch (error) {
      console.error('Translation error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async resetCache(message, sendResponse) {
    try {
      const requestedTarget = message?.target || 'all';
      const target = requestedTarget === 'transliteration'
        ? 'romanization'
        : ['lyrics', 'translations', 'romanization'].includes(requestedTarget)
          ? requestedTarget
          : 'all';
      if (target === 'lyrics') {
        await TranslationService.resetCache(target, async () => {});
        await LyricsService.resetCache(target, () => lyricsDB.clear());
      } else if (target === 'translations') {
        await LyricsService.resetCache(target);
        await TranslationService.resetCache(target, async () => {
          await translationsDB.deleteWhere(record => record.key && !record.key.includes(' - romanize - '));
        });
      } else if (target === 'romanization') {
        await LyricsService.resetCache(target);
        await TranslationService.resetCache(target, async () => {
          await translationsDB.deleteWhere(record => record.key && record.key.includes(' - romanize - '));
        });
      } else {
        await LyricsService.resetCache(target, () => lyricsDB.clear());
        await TranslationService.resetCache(target, async () => {
          await translationsDB.clear();
        });
      }

      // Source indexes remain independent for up to six hours; this event only asks pages
      // to discard rendered lyric/translation results.
      await SettingsManager.set({
        [LYRICS_CACHE_CHANGED]: { type: target === 'all' ? 'all' : target, timestamp: Date.now() }
      });
      sendResponse({ success: true, message: 'Cache reset successfully' });
    } catch (error) {
      console.error('Cache reset error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getCacheSize(sendResponse) {
    try {
      const [lyricsStats, translationsBreakdown, totalTransStats] = await Promise.all([
        lyricsDB.estimateSize(),
        translationsDB.getBreakdown(),
        translationsDB.estimateSize()
      ]);

      const lyricsSizeMB = (lyricsStats.sizeKB / 1024).toFixed(2);
      const transSizeMB = (translationsBreakdown.translations.sizeKB / 1024).toFixed(2);
      const romSizeMB = (translationsBreakdown.romanizations.sizeKB / 1024).toFixed(2);
      const totalSizeKB = lyricsStats.sizeKB + totalTransStats.sizeKB;
      const totalSizeMB = (totalSizeKB / 1024).toFixed(2);
      const totalCount = lyricsStats.count + totalTransStats.count;

      sendResponse({
        success: true,
        lyrics: {
          sizeKB: lyricsStats.sizeKB,
          sizeMB: lyricsSizeMB,
          count: lyricsStats.count
        },
        translations: {
          sizeKB: translationsBreakdown.translations.sizeKB,
          sizeMB: transSizeMB,
          count: translationsBreakdown.translations.count
        },
        romanizations: {
          sizeKB: translationsBreakdown.romanizations.sizeKB,
          sizeMB: romSizeMB,
          count: translationsBreakdown.romanizations.count
        },
        sizeKB: totalSizeKB,
        sizeMB: totalSizeMB,
        cacheCount: totalCount
      });
    } catch (error) {
      console.error('Get cache size error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async notifyLocalLyricsChanged(appleIds) {
    const ids = [...new Set(appleIds
      .filter(value => value != null && String(value).trim())
      .map(value => String(value).trim()))];
    const change = { appleIds: ids, timestamp: Date.now() };
    await SettingsManager.set({ [LOCAL_LYRICS_CHANGED]: change });
    return change;
  }

  static async uploadLocalLyrics(message, sendResponse) {
    try {
      const { songInfo, jsonLyrics } = message;
      if (!songInfo?.appleId) throw new Error('Apple Music song ID is required');
      if (!songInfo.title || !songInfo.artist) throw new Error('Missing song metadata');

      const normalized = Array.isArray(jsonLyrics?.data)
        ? jsonLyrics
        : DataParser.parseKPoeFormat(jsonLyrics);
      if (!normalized || !Array.isArray(normalized.data) || normalized.data.length === 0) {
        throw new Error('Invalid local lyrics');
      }

      const appleId = String(songInfo.appleId);
      const songId = `appleMusic:${appleId}`;
      const storedSongInfo = { ...songInfo, appleId };
      await localLyricsDB.set({
        songId,
        songInfo: storedSongInfo,
        lyrics: normalized,
        timestamp: Date.now()
      });

      // Remove older metadata-only duplicates after the replacement is committed.
      await localLyricsDB.deleteWhere(entry =>
        entry.songId !== songId && LyricsService.matchesLocalLyrics(entry.songInfo, storedSongInfo)
      );

      await SettingsManager.set({ [`${PROVIDER_PREFERENCE_PREFIX}${appleId}`]: 'auto' });
      await LyricsService.invalidateLocalLyrics(storedSongInfo);
      const localLyricsChange = await this.notifyLocalLyricsChanged([appleId]);
      sendResponse({ success: true, message: 'Local lyrics uploaded successfully', songId, localLyricsChange });
    } catch (error) {
      console.error('Error uploading local lyrics:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getLocalLyricsList(sendResponse) {
    try {
      const lyricsList = await localLyricsDB.getAll();
      sendResponse({
        success: true,
        lyricsList: lyricsList.map(item => ({
          songId: item.songId,
          songInfo: item.songInfo,
          timestamp: item.timestamp
        }))
      });
    } catch (error) {
      console.error('Error getting local lyrics list:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async resetAllProviderPreferences() {
    const values = await SettingsManager.get(null);
    const preferences = Object.keys(values || {})
      .filter(key => key.startsWith(PROVIDER_PREFERENCE_PREFIX));
    if (!preferences.length) return;
    await SettingsManager.set(Object.fromEntries(preferences.map(key => [key, 'auto'])));
  }

  static async deleteLocalLyrics(message, sendResponse) {
    try {
      if (!message.songInfo && !message.songId) throw new Error('Missing local lyrics song');
      const entries = [];
      if (message.songInfo) {
        await localLyricsDB.deleteWhere(entry => {
          if (!LyricsService.matchesLocalLyrics(entry.songInfo, message.songInfo)) return false;
          entries.push(entry);
          return true;
        });
      } else {
        await localLyricsDB.deleteWhere(entry => {
          if (entry.songId !== message.songId) return false;
          entries.push(entry);
          return true;
        });
      }

      if (!entries.length && !message.songInfo?.appleId) {
        sendResponse({ success: true, message: 'No local lyrics to delete' });
        return;
      }

      const appleIds = new Set();
      let resetAll = false;
      if (message.songInfo?.appleId) appleIds.add(String(message.songInfo.appleId));

      for (const entry of entries) {
        const id = entry.songInfo?.appleId
          || (/^appleMusic:(.+)$/.exec(entry.songId || '')?.[1]);
        if (id) appleIds.add(String(id));
        else resetAll = true;
      }

      if (resetAll) {
        // A legacy record has no Apple ID, so every currently open Apple song may match it.
        await LyricsService.resetCache('lyrics', () => lyricsDB.clear());
        await this.resetAllProviderPreferences();
      } else {
        for (const appleId of appleIds) {
          await SettingsManager.set({ [`${PROVIDER_PREFERENCE_PREFIX}${appleId}`]: 'auto' });
          await LyricsService.invalidateLocalLyrics({ appleId });
        }
      }

      const localLyricsChange = await this.notifyLocalLyricsChanged(resetAll ? [] : [...appleIds]);
      sendResponse({ success: true, message: 'Local lyrics deleted successfully', localLyricsChange });
    } catch (error) {
      console.error('Error deleting local lyrics:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async fetchLocalLyrics(message, sendResponse) {
    try {
      const localLyrics = await localLyricsDB.get(message.songId);
      if (!localLyrics) {
        sendResponse({ success: false, error: 'Local lyrics not found' });
        return;
      }
      sendResponse({
        success: true,
        lyrics: localLyrics.lyrics,
        metadata: localLyrics.songInfo
      });
    } catch (error) {
      console.error('Error fetching local lyrics:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async fetchImage(message, sendResponse) {
    try {
      const response = await fetch(message.url);
      if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => sendResponse({ success: true, dataUrl: reader.result });
      reader.onerror = () => sendResponse({ success: false, error: 'Failed to read blob' });
      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('Error fetching image:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async saveLyricsOffset(message, sendResponse) {
    try {
      await LyricsService.saveLyricsOffset(message.songInfo, message.offsetMs);
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error saving lyrics offset:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getLyricsOffset(message, sendResponse) {
    try {
      const offsetMs = await LyricsService.getLyricsOffset(message.songInfo);
      sendResponse({ success: true, offsetMs });
    } catch (error) {
      console.error('Error getting lyrics offset:', error);
      sendResponse({ success: false, error: error.message, offsetMs: 0 });
    }
  }

  static async switchLyricsProvider(message, sendResponse) {
    try {
      const result = await LyricsService.getProviderLyrics(message.songInfo, message.provider);
      if (!result?.lyrics) {
        sendResponse({ success: false, error: 'No lyrics available from this provider' });
        return;
      }
      const availableProviders = await LyricsService.getAvailableProviders(message.songInfo);
      sendResponse({
        success: true,
        lyrics: result.lyrics,
        provider: message.provider,
        availableProviders
      });
    } catch (error) {
      console.error(`Failed to switch lyrics provider to "${message.provider}":`, error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async getAvailableLyricsProviders(message, sendResponse) {
    try {
      const availableProviders = await LyricsService.getAvailableProviders(message.songInfo);
      sendResponse({ success: true, availableProviders });
    } catch (error) {
      console.error('Error getting available providers:', error);
      sendResponse({ success: false, error: error.message, availableProviders: [] });
    }
  }

  static async getDictionaryStatus(message, sendResponse) {
    try {
      const isArabic = message.dictionary === 'arabic' || message.dictionary === 'catt' || message.dictionary === 'rawi';
      const status = isArabic
        ? await dictionaryService.getCattStatus()
        : await dictionaryService.getKuromojiStatus();
      sendResponse({ success: true, status });
    } catch (error) {
      console.error('Error getting dictionary status:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async downloadDictionary(message, sendResponse) {
    try {
      const isArabic = message.dictionary === 'arabic' || message.dictionary === 'catt' || message.dictionary === 'rawi';
      const result = isArabic
        ? await dictionaryService.downloadCatt()
        : await dictionaryService.downloadKuromoji();
      sendResponse({ success: true, result });
    } catch (error) {
      console.error('Error downloading dictionary:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  static async deleteDictionary(message, sendResponse) {
    try {
      const isArabic = message.dictionary === 'arabic' || message.dictionary === 'catt' || message.dictionary === 'rawi';
      if (isArabic) await dictionaryService.deleteCatt();
      else await dictionaryService.deleteKuromoji();
      sendResponse({ success: true });
    } catch (error) {
      console.error('Error deleting dictionary:', error);
      sendResponse({ success: false, error: error.message });
    }
  }
}
