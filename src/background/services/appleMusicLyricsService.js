import { parseAMLLLyrics } from '../utils/amllParser.js';
import { Utilities } from '../utils/utilities.js';

import { APPLE_LYRICS_ORDER, APPLE_LYRICS_NAMES, normalizeAppleLyricsOrder } from '../../lib/appleLyricsSources.js';
export { APPLE_LYRICS_ORDER, APPLE_LYRICS_NAMES };
const AMLL = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';
const HUB = 'https://2755337087.github.io/ttml-hub/';
const AM = 'https://raw.githubusercontent.com/Zennmn/am-lyrics/main/';
const SIX_HOURS = 6 * 60 * 60 * 1000;
const MAX_RESULTS = 100;
const NO_RESULT_TTL = 60 * 1000;
const ids = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(String);
const normalizedSha256 = value => {
  const hash = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
};
const sha256Hex = async value => {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
};

export class AppleMusicLyricsService {
  constructor({ request = (...args) => fetch(...args), storage = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local } = {}) {
    this.request = request;
    this.storage = storage;
    this.indexes = new Map();
    this.pendingIndexes = new Map();
    this.results = new Map();
    this.pending = new Map();
    this.nativeLyrics = new Map();
    this.generation = 0;
    this.requestSequence = 0;
    this.resultTickets = new Map();
    this.indexSequence = 0;
    this.indexTickets = new Map();
  }

  nativeLanguage(song = {}) {
    return String(song.appleMusicLyricsLanguage || song.language || '').trim().toLowerCase();
  }

  nativeKey(song = {}) {
    return `${String(song.appleId || '')}:${this.nativeLanguage(song)}`;
  }

  async read(url, { json = false, sha256, limit = 8 * 1024 * 1024, withHash = false } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await this.request(url, { signal: controller.signal, credentials: 'omit', cache: 'no-cache' });
      if (!response.ok) {
        const error = new Error(`Lyrics HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > limit) throw new Error('Lyrics resource is too large');
      const sourceHash = sha256 || withHash ? await sha256Hex(bytes) : '';
      if (sha256 && sourceHash !== String(sha256).toLowerCase()) throw new Error('Lyrics SHA-256 mismatch');
      let text = new TextDecoder().decode(bytes);
      let value = text;
      if (json) {
        // Some AmLyrics IDs exceed Number.MAX_SAFE_INTEGER. Preserve the JSON digits.
        text = text.replace(/("appleMusicId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"')
          .replace(/("alternateIds"\s*:\s*\[)([^\]]*)(\])/g, (_, start, values, end) => start + values.replace(/\b\d+\b/g, value => `"${value}"`).replace(/""(\d+)""/g, '"$1"') + end);
        value = JSON.parse(text);
      }
      return withHash ? { value, sourceHash } : value;
    } finally { clearTimeout(timeout); }
  }

  pathURL(base, path, prefix) {
    if (typeof path !== 'string' || !path.startsWith(prefix) || path.split('/').includes('..') || /[?#\\]/.test(path)) throw new Error('Invalid lyrics path');
    const url = new URL(path.split('/').map(encodeURIComponent).join('/'), base);
    if (!url.href.startsWith(base)) throw new Error('Invalid lyrics host');
    return url.href;
  }

  async index(provider, force = false) {
    const activeForce = this.pendingIndexes.get(`${provider}:force`);
    if (!force && activeForce) return activeForce;
    const pendingKey = `${provider}:${force ? 'force' : 'normal'}`;
    if (this.pendingIndexes.has(pendingKey)) return this.pendingIndexes.get(pendingKey);
    const ticket = ++this.indexSequence;
    this.indexTickets.set(provider, ticket);
    const promise = this.refreshIndex(provider, force, ticket);
    this.pendingIndexes.set(pendingKey, promise);
    try { return await promise; } finally {
      if (this.pendingIndexes.get(pendingKey) === promise) this.pendingIndexes.delete(pendingKey);
      if (![...this.pendingIndexes.keys()].some(key => key.startsWith(`${provider}:`))) this.indexTickets.delete(provider);
    }
  }

  async refreshIndex(provider, force, ticket) {
    const key = `lyplusAppleLyricsIndex_${provider}`;
    let cached = this.indexes.get(provider);
    if (!cached) { try { cached = (await this.storage?.get(key))?.[key]; } catch (_) {} }
    if (!force && cached?.checkedAt > Date.now() - SIX_HOURS) {
      if (this.indexTickets.get(provider) === ticket) this.indexes.set(provider, cached);
      return cached.data;
    }
    try {
      let data;
      let indexSha256 = normalizedSha256(cached?.indexSha256);
      if (provider === 'lunabeat') {
        const manifest = await this.read(`${HUB}api/v1/manifest.json`, { json: true });
        if (manifest.schemaVersion !== 2) throw new Error('Unsupported LunaBeat index');
        const manifestSha256 = normalizedSha256(manifest.indexSha256);
        if (cached?.data?.revision === manifest.revision && manifestSha256 && indexSha256 === manifestSha256) {
          data = cached.data;
        } else {
          const indexURL = this.pathURL(`${HUB}api/v1/`, manifest.index, '');
          const resource = await this.read(indexURL, { json: true, sha256: manifest.indexSha256, withHash: true });
          data = resource.value;
          indexSha256 = resource.sourceHash;
          if (data.schemaVersion !== 2 || data.revision !== manifest.revision || !Array.isArray(data.songs)) throw new Error('Invalid LunaBeat revision');
        }
      } else {
        const resource = await this.read(`${AM}index.json`, { json: true, withHash: true });
        data = resource.value;
        indexSha256 = resource.sourceHash;
        if (!Array.isArray(data.entries)) throw new Error('Invalid AmLyrics index');
      }
      cached = { checkedAt: Date.now(), data, ...(indexSha256 ? { indexSha256 } : {}) };
      if (this.indexTickets.get(provider) === ticket) {
        this.indexes.set(provider, cached);
        try { await this.storage?.set({ [key]: cached }); } catch (_) {}
      }
      return data;
    } catch (error) {
      if (cached?.data) {
        if (this.indexTickets.get(provider) === ticket) this.indexes.set(provider, cached);
        if (!force) return cached.data;
      }
      throw error;
    }
  }

  parse(ttml, provider, sourceHash) {
    if (typeof ttml !== 'string' || !/<(?:\w+:)?tt[\s>]/.test(ttml)) return null;
    let lyrics;
    try { lyrics = parseAMLLLyrics(ttml); } catch { return null; }
    if (Utilities.isEmptyLyrics(lyrics)) return null;
    lyrics.provider = provider;
    lyrics.metadata = { ...lyrics.metadata, source: APPLE_LYRICS_NAMES[provider], provider };
    const hash = normalizedSha256(sourceHash);
    if (hash) lyrics.sourceHash = hash;
    return lyrics;
  }

  async externalSource(provider, id, force = false) {
    if (!/^\d+$/.test(id)) return null;
    let url, sha256;
    if (provider === 'amll') url = `${AMLL}am-lyrics/${id}.ttml`;
    else {
      if (provider !== 'lunabeat' && provider !== 'amlyrics') return null;
      const index = await this.index(provider, force);
      const entry = provider === 'lunabeat'
        ? index.songs.find(song => ids(song.sourceIds?.appleMusicId).includes(id))
        : index.entries.find(song => song.enabled !== false && [String(song.appleMusicId), ...ids(song.alternateIds)].includes(id));
      if (!entry) return null;
      url = this.pathURL(provider === 'lunabeat' ? HUB : AM, entry.path, provider === 'lunabeat' ? 'lyrics/' : 'am-lyrics/');
      if (entry.sha256 != null && entry.sha256 !== '') {
        sha256 = normalizedSha256(entry.sha256);
        if (!sha256) throw new Error('Invalid lyrics SHA-256');
      }
    }
    return { url, sha256: sha256 || '' };
  }

  async fetchExternal(provider, id, force) {
    const source = await this.externalSource(provider, id, force);
    if (!source) return null;
    const resource = await this.read(source.url, { sha256: source.sha256 || undefined, limit: 2 * 1024 * 1024, withHash: true });
    return this.parse(resource.value, provider, resource.sourceHash);
  }

  async provider(provider, song, force = false, { cacheResults = true } = {}) {
    if (provider === 'applemusic') {
      // Native TTML is language-specific. Never borrow another target language's cached track.
      const candidates = [song.appleMusicTTML, this.nativeLyrics.get(this.nativeKey(song))];
      for (const ttml of candidates) {
        if (typeof ttml !== 'string' || !ttml) continue;
        const parsed = this.parse(ttml, provider, await sha256Hex(ttml));
        if (parsed) return parsed;
      }
      return null;
    }
    if (!APPLE_LYRICS_ORDER.includes(provider)) return null;
    const key = `${provider}:${song.appleId}`;
    const activeForce = this.pending.get(`${key}:force:${cacheResults ? 'cache' : 'direct'}`);
    if (!force && activeForce) return activeForce;
    if (cacheResults && !force) {
      const cached = this.getCachedResult(key);
      if (cached) return cached.lyrics;
    }
    const pendingKey = `${key}:${force ? 'force' : 'normal'}:${cacheResults ? 'cache' : 'direct'}`;
    if (this.pending.has(pendingKey)) return this.pending.get(pendingKey);
    const ticket = cacheResults ? ++this.requestSequence : 0;
    if (cacheResults) this.resultTickets.set(key, ticket);
    const generation = this.generation;
    const promise = this.fetchExternal(provider, String(song.appleId), force).catch(error => {
      if (error.status !== 404) console.warn(`YouLy+ ${APPLE_LYRICS_NAMES[provider]}: ${error.message}`);
      return null;
    });
    this.pending.set(pendingKey, promise);
    try {
      const lyrics = await promise;
      if (cacheResults && generation === this.generation && this.resultTickets.get(key) === ticket) {
        this.rememberResult(key, lyrics);
      }
      return lyrics;
    } finally {
      if (this.pending.get(pendingKey) === promise) this.pending.delete(pendingKey);
      if (![...this.pending.keys()].some(pending => pending.startsWith(`${key}:`))) this.resultTickets.delete(key);
    }
  }

  getCachedResult(key) {
    const cached = this.results.get(key);
    if (!cached) return null;
    if (!cached.lyrics && cached.expiresAt <= Date.now()) {
      this.results.delete(key);
      return null;
    }
    this.results.delete(key);
    this.results.set(key, cached);
    return cached;
  }

  rememberResult(key, lyrics) {
    const previous = this.results.get(key);
    if (!lyrics && previous?.lyrics) {
      this.results.delete(key);
      this.results.set(key, previous);
      return;
    }
    this.results.delete(key);
    this.results.set(key, { lyrics, expiresAt: lyrics ? 0 : Date.now() + NO_RESULT_TTL });
    while (this.results.size > MAX_RESULTS) this.results.delete(this.results.keys().next().value);
  }

  async revalidate(song, cachedLyrics, options = {}) {
    if (!cachedLyrics) return cachedLyrics;
    try {
      const provider = String(options.provider || cachedLyrics.provider || cachedLyrics.metadata?.provider || '').trim().toLowerCase();
      if (!APPLE_LYRICS_ORDER.includes(provider)) return cachedLyrics;
      const cachedHash = normalizedSha256(cachedLyrics.sourceHash);
      if (provider === 'applemusic') {
        const candidates = [song?.appleMusicTTML, this.nativeLyrics.get(this.nativeKey(song))];
        for (const ttml of candidates) {
          if (typeof ttml !== 'string' || !ttml) continue;
          const sourceHash = await sha256Hex(ttml);
          const lyrics = this.parse(ttml, provider, sourceHash);
          if (!lyrics) continue;
          return sourceHash === cachedHash ? cachedLyrics : lyrics;
        }
        return cachedLyrics;
      }

      const source = await this.externalSource(provider, String(song?.appleId || ''), true);
      if (!source) return cachedLyrics;
      if (source.sha256 && source.sha256 === cachedHash) return cachedLyrics;
      const resource = await this.read(source.url, { sha256: source.sha256 || undefined, limit: 2 * 1024 * 1024, withHash: true });
      if (resource.sourceHash === cachedHash) return cachedLyrics;
      return this.parse(resource.value, provider, resource.sourceHash) || cachedLyrics;
    } catch (_) {
      return cachedLyrics;
    }
  }

  async resolve(song, force = false, order, options = {}) {
    for (const provider of normalizeAppleLyricsOrder(order)) {
      const lyrics = await this.provider(provider, song, force, options);
      if (lyrics) return lyrics;
    }
    throw new Error('No lyrics found from AMLL, LunaBeat, AmLyrics or Apple Music');
  }

  rememberNative(song) {
    if (!song?.appleId) return;
    // A metadata-only snapshot or a transient empty fetch must not erase a later valid TTML
    // for the same language. Language-specific keys already prevent cross-language reuse.
    if (!song.appleMusicTTML) return;
    const key = this.nativeKey(song);
    if (this.nativeLyrics.size >= 30) this.nativeLyrics.delete(this.nativeLyrics.keys().next().value);
    this.nativeLyrics.set(key, song.appleMusicTTML);
  }

  clearResultCache() {
    this.generation++;
    this.results.clear();
    this.pending.clear();
    this.resultTickets.clear();
  }

  clearResults() {
    this.clearResultCache();
    this.nativeLyrics.clear();
  }

}

export const appleMusicLyrics = new AppleMusicLyricsService();
