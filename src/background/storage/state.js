// ==================================================================================================
// STATE MANAGEMENT
// ==================================================================================================

import { CONFIG } from '../constants.js';

const isDerivedCacheKey = key => typeof key === 'string'
  && (key.includes(' - translate - ') || key.includes(' - romanize - '));

class StateManager {
  constructor() {
    this.lyricsCache = new Map();
    this.ongoingFetches = new Map();
  }

  getCached(key) {
    return this._touchCached(key);
  }

  setCached(key, value) {
    this.lyricsCache.delete(key);
    this.lyricsCache.set(key, value);
    this._trimCacheGroup(key);
  }

  hasCached(key) {
    if (!this.lyricsCache.has(key)) return false;
    this._touchCached(key);
    return true;
  }

  _touchCached(key) {
    if (!this.lyricsCache.has(key)) return undefined;
    const value = this.lyricsCache.get(key);
    this.lyricsCache.delete(key);
    this.lyricsCache.set(key, value);
    return value;
  }

  _trimCacheGroup(key) {
    const derived = isDerivedCacheKey(key);
    const keys = [...this.lyricsCache.keys()]
      .filter(cacheKey => isDerivedCacheKey(cacheKey) === derived);
    const limitValue = Number(CONFIG.CACHE_MAX_ENTRIES);
    const limit = Number.isFinite(limitValue) ? Math.max(0, Math.floor(limitValue)) : 100;

    for (const cacheKey of keys.slice(0, Math.max(0, keys.length - limit))) {
      this.lyricsCache.delete(cacheKey);
    }
  }

  deleteCached(key) {
    this.lyricsCache.delete(key);
  }

  getOngoingFetch(key) {
    return this.ongoingFetches.get(key);
  }

  setOngoingFetch(key, promise) {
    this.ongoingFetches.set(key, promise);
  }

  deleteOngoingFetch(key) {
    this.ongoingFetches.delete(key);
  }

  hasOngoingFetch(key) {
    return this.ongoingFetches.has(key);
  }

  clear(target = 'all') {
    if (target === 'lyrics') {
      for (const key of this.lyricsCache.keys()) {
        if (!key.includes(' - translate - ') && !key.includes(' - romanize - ')) {
          this.lyricsCache.delete(key);
        }
      }
      this.ongoingFetches.clear();
    } else if (target === 'translations') {
      for (const key of this.lyricsCache.keys()) {
        if (key.includes(' - translate - ')) {
          this.lyricsCache.delete(key);
        }
      }
    } else if (target === 'romanization' || target === 'transliteration') {
      for (const key of this.lyricsCache.keys()) {
        if (key.includes(' - romanize - ')) {
          this.lyricsCache.delete(key);
        }
      }
    } else {
      this.lyricsCache.clear();
      this.ongoingFetches.clear();
    }
  }
}

export const state = new StateManager();
