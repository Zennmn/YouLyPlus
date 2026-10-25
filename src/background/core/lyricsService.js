// ==================================================================================================
// APPLE MUSIC LYRICS SERVICE
// ==================================================================================================

import { state } from '../storage/state.js';
import { lyricsDB, translationsDB, localLyricsDB, offsetsDB } from '../storage/database.js';
import { SettingsManager } from '../storage/settings.js';
import { CONFIG, PROVIDERS } from '../constants.js';
import { DataParser } from '../utils/dataParser.js';
import { Utilities } from '../utils/utilities.js';
import { appleMusicLyrics } from '../services/appleMusicLyricsService.js';
import { APPLE_LYRICS_ORDER, normalizeAppleLyricsOrder } from '../../lib/appleLyricsSources.js';

const SELECTABLE_PROVIDERS = new Set([PROVIDERS.LOCAL, ...APPLE_LYRICS_ORDER]);

export class LyricsService {
  static localLyricsRevisions = new Map();
  static cacheEpoch = 0;
  static cacheMutationQueue = Promise.resolve();

  static queueCacheMutation(operation) {
    const run = this.cacheMutationQueue.then(operation, operation);
    this.cacheMutationQueue = run.catch(() => {});
    return run;
  }

  static createCacheKey(songInfo = {}) {
    const appleId = String(songInfo.appleId || '').trim();
    if (!appleId) throw new Error('Apple Music song ID is required');
    return `apple-sources-v2-amll:${appleId}`;
  }

  static lyricsLanguage(songInfo = {}) {
    return String(songInfo.appleMusicLyricsLanguage || songInfo.language || '').trim().toLowerCase();
  }

  static stableHash(value) {
    let first = 0x811c9dc5;
    let second = 0x9e3779b9;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      first = Math.imul(first ^ code, 0x01000193);
      second = Math.imul(second ^ code, 0x85ebca6b);
    }
    return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
  }

  static resultVersion(lyrics, songInfo, localVersion = null) {
    const provider = lyrics?.provider || lyrics?.metadata?.provider || 'unknown';
    const payload = JSON.stringify({
      provider,
      language: this.lyricsLanguage(songInfo),
      sourceHash: lyrics?.sourceHash,
      data: lyrics?.data || []
    });
    const prefix = localVersion != null ? `local:${localVersion}` : `lyrics:${provider}`;
    return `${prefix}:${this.stableHash(payload)}`;
  }

  static async maintainCache() {
    try {
      await this.queueCacheMutation(async () => {
        const settings = await SettingsManager.getLyricsSettings();
        if (settings.cacheStrategy === 'none') {
          await Promise.all([lyricsDB.clear(), translationsDB.clear()]);
          state.clear();
          appleMusicLyrics.clearResults();
          return;
        }

        // Existing records migrate by their last use, with no age-based expiry.
        const evicted = await Promise.all([
          lyricsDB.trimToLimit(CONFIG.CACHE_MAX_ENTRIES),
          translationsDB.trimToLimit(CONFIG.CACHE_MAX_ENTRIES)
        ]);
        for (const key of evicted.flat()) state.deleteCached(key);
      });
    } catch (error) {
      console.error('Error maintaining bounded lyrics cache:', error);
    }
  }

  static async getOrFetch(songInfo, forceReload = false, requestedSource = null) {
    if (!songInfo?.appleId) throw new Error('Apple Music song ID is required');
    return this.getAppleMusicLyrics(songInfo, forceReload, requestedSource);
  }

  static async getAppleMusicLyrics(songInfo, forceReload = false, provider = null) {
    const cacheKey = this.createCacheKey(songInfo);
    const language = this.lyricsLanguage(songInfo);
    const revision = this.localLyricsRevisions.get(cacheKey) || 0;
    const epoch = this.cacheEpoch;
    const explicitSelection = provider != null;
    const resetToAuto = provider === 'auto';
    const manualProvider = explicitSelection && !resetToAuto ? provider : null;
    const changed = () => epoch !== this.cacheEpoch || (this.localLyricsRevisions.get(cacheKey) || 0) !== revision;

    try {
      // An empty native payload still updates availability for this exact language.
      appleMusicLyrics.rememberNative(songInfo);
      const settings = await SettingsManager.getLyricsSettings();
      const order = normalizeAppleLyricsOrder(settings.appleMusicLyricsProviderOrder);
      const orderKey = order.join(',');
      const preferenceKey = `lyplusApplePlayerProvider_${songInfo.appleId}`;
      if (resetToAuto) await SettingsManager.set({ [preferenceKey]: 'auto' });
      const saved = explicitSelection ? {} : await SettingsManager.get({ [preferenceKey]: 'auto' });
      if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);

      const preference = manualProvider || saved[preferenceKey] || 'auto';
      const selected = SELECTABLE_PROVIDERS.has(preference) ? preference : null;
      const expected = {
        sourceOrder: orderKey,
        sourcePreference: selected || 'auto',
        lyricsLanguage: language
      };
      const cacheEnabled = settings.cacheStrategy !== 'none';
      if (!cacheEnabled) {
        state.deleteCached(cacheKey);
        appleMusicLyrics.clearResultCache();
        await this.queueCacheMutation(async () => {
          state.deleteCached(cacheKey);
          await lyricsDB.delete(cacheKey);
        });
      }

      let cached = null;
      if (!manualProvider && !forceReload && cacheEnabled) {
        const memoryCached = state.getCached(cacheKey);
        if (memoryCached?.lyrics
          && memoryCached.sourceOrder === expected.sourceOrder
          && memoryCached.sourcePreference === expected.sourcePreference
          && memoryCached.lyricsLanguage === language) {
          cached = memoryCached;
        } else if (memoryCached) {
          state.deleteCached(cacheKey);
        }
        cached ||= await this.getFromDB(cacheKey, expected);
      }

      let local = null;
      let lyrics = null;
      if (cached?.lyrics) {
        const cachedProvider = cached.lyrics.provider || cached.lyrics.metadata?.provider;
        if (cachedProvider === PROVIDERS.LOCAL) {
          local = await this.checkLocalLyrics(songInfo);
          lyrics = local?.lyrics || null;
          if (!local) cached = null;
        } else {
          // Without expiry, a fallback must still yield when a preferred source gains lyrics.
          const preferred = selected
            ? (selected !== cachedProvider && selected !== PROVIDERS.LOCAL ? [selected] : [])
            : order.slice(0, Math.max(0, order.indexOf(cachedProvider)));
          for (const candidate of preferred) {
            lyrics = await appleMusicLyrics.provider(candidate, songInfo, true, { cacheResults: cacheEnabled });
            if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);
            if (lyrics) break;
          }
          // A failed validation returns the usable cached lyrics; it never expires by age.
          lyrics ||= await appleMusicLyrics.revalidate(songInfo, cached.lyrics);
        }
        if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);
      }

      // Local imports always win in automatic mode; selecting an online source explicitly bypasses it.
      if (!lyrics) {
        local = (selected === PROVIDERS.LOCAL || (!manualProvider && !selected))
          ? await this.checkLocalLyrics(songInfo)
          : null;
        lyrics = local?.lyrics || null;
      }
      // A cache miss must not borrow an unvalidated provider result or an old index.
      const sourceForceReload = true;
      const sourceOptions = { cacheResults: cacheEnabled };

      if (!lyrics && selected !== PROVIDERS.LOCAL) {
        lyrics = selected
          ? await appleMusicLyrics.provider(selected, songInfo, sourceForceReload, sourceOptions)
          : await appleMusicLyrics.resolve(songInfo, sourceForceReload, order, sourceOptions);
      }

      // A saved source may be unavailable. Keep its preference and use normal fallback.
      if (!lyrics && !explicitSelection) {
        lyrics = await appleMusicLyrics.resolve(songInfo, sourceForceReload, order, sourceOptions);
      }

      if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);
      if (!lyrics || Utilities.isEmptyLyrics(lyrics)) {
        throw new Error(`No lyrics found from source: ${selected || preference}`);
      }

      if (manualProvider) {
        await SettingsManager.set({ [preferenceKey]: selected || 'auto' });
        if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);
      }

      lyrics = {
        ...lyrics,
        playerProviderPreference: selected || 'auto'
      };
      // Preserve the provider that actually won a fallback, rather than the saved preference.
      this.cacheProviderOnLyrics(
        lyrics,
        lyrics.provider || lyrics.metadata?.provider || 'unknown'
      );

      const version = this.resultVersion(lyrics, songInfo, local?.version);
      const unchanged = cached?.version === version
        && cached.lyrics?.sourceHash === lyrics.sourceHash;
      const result = {
        lyrics,
        version,
        sourceOrder: orderKey,
        sourcePreference: selected || 'auto',
        lyricsLanguage: language,
        timestamp: unchanged ? cached.timestamp : Date.now()
      };
      if (cacheEnabled) {
        await this.queueCacheMutation(async () => {
          if (epoch !== this.cacheEpoch
            || (this.localLyricsRevisions.get(cacheKey) || 0) !== revision) return;
          const current = await SettingsManager.getLyricsSettings();
          if (current.cacheStrategy === 'none') return;
          const touched = unchanged ? await lyricsDB.touch(cacheKey) : null;
          if (!touched) {
            const evicted = await lyricsDB.setCapped({
              key: cacheKey,
              lyrics: result.lyrics,
              version: result.version,
              sourceOrder: result.sourceOrder,
              sourcePreference: result.sourcePreference,
              lyricsLanguage: result.lyricsLanguage,
              duration: songInfo.duration,
              timestamp: result.timestamp
            }, CONFIG.CACHE_MAX_ENTRIES);
            for (const key of evicted) state.deleteCached(key);
          }
          if (epoch === this.cacheEpoch
            && (this.localLyricsRevisions.get(cacheKey) || 0) === revision) {
            state.setCached(cacheKey, result);
          }
        });
      }
      if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);
      return result;
    } catch (error) {
      // A request started before a local edit must not hide the newly imported file.
      if (changed()) return this.getAppleMusicLyrics(songInfo, forceReload, provider);
      throw error;
    }
  }

  static cacheProviderOnLyrics(lyrics, provider) {
    if (!lyrics) return;
    if (!lyrics.metadata) lyrics.metadata = {};
    lyrics.metadata.provider = provider;
    lyrics.provider = provider;
  }

  static async getFromDB(key, expected = null) {
    const settings = await SettingsManager.getLyricsSettings();
    if (settings.cacheStrategy === 'none') return null;

    const result = await lyricsDB.touch(key);
    if (!result) return null;

    const mismatched = expected && (
      result.sourceOrder !== expected.sourceOrder
      || result.sourcePreference !== expected.sourcePreference
      || result.lyricsLanguage !== expected.lyricsLanguage
    );

    if (mismatched) return null;

    return {
      lyrics: result.lyrics,
      version: result.version,
      sourceOrder: result.sourceOrder,
      sourcePreference: result.sourcePreference,
      lyricsLanguage: result.lyricsLanguage,
      timestamp: result.timestamp
    };
  }

  static async checkLocalLyrics(songInfo) {
    const matched = await this.findLocalLyricsRecord(songInfo);
    if (!matched) return null;

    const fetchedLocal = await localLyricsDB.get(matched.songId);
    if (!fetchedLocal) return null;

    const stored = fetchedLocal.lyrics;
    // Keep both record shapes used so far: AMLL-normalized data and legacy KPoe JSON.
    const lyrics = Array.isArray(stored?.data)
      ? stored
      : Array.isArray(stored?.lyrics) ? DataParser.parseKPoeFormat(stored) : null;
    if (!lyrics || Utilities.isEmptyLyrics(lyrics)) {
      console.warn(`Ignoring unusable local lyrics for "${songInfo.title || songInfo.appleId}"`);
      return null;
    }

    this.cacheProviderOnLyrics(lyrics, PROVIDERS.LOCAL);
    return {
      lyrics,
      version: fetchedLocal.timestamp || matched.songId
    };
  }

  static matchesLocalLyrics(storedSongInfo, songInfo) {
    if (!storedSongInfo || !songInfo) return false;
    if (storedSongInfo.appleId) {
      return !!songInfo.appleId && String(storedSongInfo.appleId) === String(songInfo.appleId);
    }
    // Metadata-only records remain removable from an Apple song, but never outrank an exact ID.
    if (storedSongInfo.title !== songInfo.title || storedSongInfo.artist !== songInfo.artist) return false;
    if (storedSongInfo.duration && songInfo.duration) {
      return Math.abs(storedSongInfo.duration - songInfo.duration) < 2;
    }
    return true;
  }

  static legacyMetadataMatches(storedSongInfo, songInfo) {
    if (!storedSongInfo || !songInfo || storedSongInfo.appleId) return false;
    if (storedSongInfo.title !== songInfo.title || storedSongInfo.artist !== songInfo.artist) return false;
    if (storedSongInfo.duration && songInfo.duration) {
      return Math.abs(storedSongInfo.duration - songInfo.duration) < 2;
    }
    return true;
  }

  static async migrateLegacyLocalRecord(record, songInfo) {
    const appleId = String(songInfo.appleId);
    const songId = `appleMusic:${appleId}`;
    const cacheKey = this.createCacheKey(songInfo);
    const revision = this.localLyricsRevisions.get(cacheKey) || 0;
    const recordTime = Number(record.timestamp) || 0;

    const migrated = {
      ...record,
      songId,
      songInfo: {
        ...record.songInfo,
        ...songInfo,
        appleId
      },
      timestamp: recordTime || Date.now()
    };
    const stored = await localLyricsDB.putLocalIfNotOlder(migrated, record.songId);

    // If an upload/delete changed this song while the migration was waiting, return the
    // record that actually won instead of the migration's stale snapshot.
    if ((this.localLyricsRevisions.get(cacheKey) || 0) !== revision) {
      return localLyricsDB.get(songId) || stored;
    }
    return stored;
  }

  static async findLocalLyricsRecord(songInfo) {
    if (!songInfo?.title || !songInfo.appleId) return null;
    const records = await localLyricsDB.getAll();
    const exact = records
      .filter(record => record.songInfo?.appleId
        && String(record.songInfo.appleId) === String(songInfo.appleId))
      .sort((first, second) => (Number(second.timestamp) || 0) - (Number(first.timestamp) || 0));

    if (exact.length) return exact[0];

    const legacy = records
      .filter(record => this.legacyMetadataMatches(record.songInfo, songInfo))
      .sort((first, second) => (Number(second.timestamp) || 0) - (Number(first.timestamp) || 0));

    return legacy.length ? this.migrateLegacyLocalRecord(legacy[0], songInfo) : null;
  }

  static async invalidateLocalLyrics(songInfo = {}) {
    const cacheKey = this.createCacheKey(songInfo);
    this.localLyricsRevisions.set(cacheKey, (this.localLyricsRevisions.get(cacheKey) || 0) + 1);
    state.deleteCached(cacheKey);
    await this.queueCacheMutation(() => lyricsDB.delete(cacheKey));
    return cacheKey;
  }

  static async resetCache(target = 'all', clearOperation) {
    const clearsLyrics = target === 'all' || target === 'lyrics';
    if (clearsLyrics) {
      this.cacheEpoch++;
      appleMusicLyrics.clearResults();
    }
    state.clear(target);
    await this.queueCacheMutation(clearOperation || (async () => {}));
  }

  static async getProviderLyrics(songInfo, provider) {
    if (!songInfo?.appleId) return null;
    return this.getAppleMusicLyrics(songInfo, false, provider);
  }

  static async getLyricsOffset(songInfo) {
    if (!songInfo?.appleId) return 0;
    const key = `lyplusApplePlayerOffset_${songInfo.appleId}`;
    const saved = await SettingsManager.get({ [key]: null });
    if (Number.isFinite(saved[key])) return saved[key];

    // Offset preferences survive lyrics parser and cache version changes.
    for (const prefix of ['apple-sources-v2-amll:', 'apple-sources-v1:']) {
      const old = await offsetsDB.get(`${prefix}${songInfo.appleId}`);
      if (Number.isFinite(old?.offsetMs)) {
        await SettingsManager.set({ [key]: old.offsetMs });
        return old.offsetMs;
      }
    }

    if (!songInfo.title) return 0;
    const artist = songInfo.artist || '';
    const duration = songInfo.duration || '';
    const album = (songInfo.album || '').trim();
    const candidates = [];
    candidates.push(this.createCacheKey(songInfo));
    if (duration) candidates.push(`${songInfo.title} - ${artist} - ${duration}`);
    if (album) candidates.push(`${songInfo.title} - ${artist} - ${album}`);
    candidates.push(`${songInfo.title} - ${artist}`);

    for (const candidate of candidates) {
      const record = await offsetsDB.get(candidate);
      if (!record || !Number.isFinite(record.offsetMs)) continue;
      await SettingsManager.set({ [key]: record.offsetMs });
      return record.offsetMs;
    }
    return 0;
  }

  static async saveLyricsOffset(songInfo, offsetMs) {
    if (!songInfo?.appleId) throw new Error('Apple Music song ID is required');
    if (!Number.isFinite(offsetMs)) throw new Error('Invalid lyrics offset');
    return SettingsManager.set({ [`lyplusApplePlayerOffset_${songInfo.appleId}`]: offsetMs });
  }

  static async getAvailableProviders(songInfo) {
    if (!songInfo?.appleId) return [];
    const order = normalizeAppleLyricsOrder((await SettingsManager.getLyricsSettings()).appleMusicLyricsProviderOrder);
    const hasLocal = !!(await this.findLocalLyricsRecord(songInfo));
    return hasLocal ? [PROVIDERS.LOCAL, ...order] : order;
  }
}
