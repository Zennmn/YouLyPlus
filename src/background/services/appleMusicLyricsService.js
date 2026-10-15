import { parseAMLLLyrics } from '../utils/amllParser.js';
import { DataParser } from '../utils/dataParser.js';
import { Utilities } from '../utils/utilities.js';

import { APPLE_LYRICS_ORDER, APPLE_LYRICS_NAMES, normalizeAppleLyricsOrder } from '../../lib/appleLyricsSources.js';
export { APPLE_LYRICS_ORDER, APPLE_LYRICS_NAMES };
const AMLL = 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/';
const HUB = 'https://2755337087.github.io/ttml-hub/';
const AM = 'https://raw.githubusercontent.com/Zennmn/am-lyrics/main/';
const SIX_HOURS = 6 * 60 * 60 * 1000;
const ids = value => (Array.isArray(value) ? value : value == null ? [] : [value]).map(String);

export class AppleMusicLyricsService {
  constructor({ request = (...args) => fetch(...args), storage = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local } = {}) {
    this.request = request;
    this.storage = storage;
    this.indexes = new Map();
    this.pendingIndexes = new Map();
    this.results = new Map();
    this.pending = new Map();
    this.nativeLyrics = new Map();
  }

  async read(url, { json = false, sha256, limit = 8 * 1024 * 1024 } = {}) {
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
      if (sha256) {
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
        if (hash !== sha256.toLowerCase()) throw new Error('Lyrics SHA-256 mismatch');
      }
      let text = new TextDecoder().decode(bytes);
      if (!json) return text;
      // Some AmLyrics IDs exceed Number.MAX_SAFE_INTEGER. Preserve the JSON digits.
      text = text.replace(/("appleMusicId"\s*:\s*)(\d+)(?=\s*[,}])/g, '$1"$2"')
        .replace(/("alternateIds"\s*:\s*\[)([^\]]*)(\])/g, (_, start, values, end) => start + values.replace(/\b\d+\b/g, value => `"${value}"`).replace(/""(\d+)""/g, '"$1"') + end);
      return JSON.parse(text);
    } finally { clearTimeout(timeout); }
  }

  pathURL(base, path, prefix) {
    if (typeof path !== 'string' || !path.startsWith(prefix) || path.split('/').includes('..') || /[?#\\]/.test(path)) throw new Error('Invalid lyrics path');
    const url = new URL(path.split('/').map(encodeURIComponent).join('/'), base);
    if (!url.href.startsWith(base)) throw new Error('Invalid lyrics host');
    return url.href;
  }

  async index(provider, force = false) {
    if (this.pendingIndexes.has(provider)) return this.pendingIndexes.get(provider);
    const promise = this.refreshIndex(provider, force);
    this.pendingIndexes.set(provider, promise);
    try { return await promise; } finally { this.pendingIndexes.delete(provider); }
  }

  async refreshIndex(provider, force) {
    const key = `lyplusAppleLyricsIndex_${provider}`;
    let cached = this.indexes.get(provider);
    if (!cached) { try { cached = (await this.storage?.get(key))?.[key]; } catch (_) {} }
    if (!force && cached?.checkedAt > Date.now() - SIX_HOURS) { this.indexes.set(provider, cached); return cached.data; }
    try {
      let data;
      if (provider === 'lunabeat') {
        const manifest = await this.read(`${HUB}api/v1/manifest.json`, { json: true });
        if (manifest.schemaVersion !== 2) throw new Error('Unsupported LunaBeat index');
        if (cached?.data?.revision === manifest.revision) data = cached.data;
        else {
          const indexURL = this.pathURL(`${HUB}api/v1/`, manifest.index, '');
          data = await this.read(indexURL, { json: true, sha256: manifest.indexSha256 });
          if (data.schemaVersion !== 2 || data.revision !== manifest.revision || !Array.isArray(data.songs)) throw new Error('Invalid LunaBeat revision');
        }
      } else {
        data = await this.read(`${AM}index.json`, { json: true });
        if (!Array.isArray(data.entries)) throw new Error('Invalid AmLyrics index');
      }
      cached = { checkedAt: Date.now(), data };
      this.indexes.set(provider, cached);
      try { await this.storage?.set({ [key]: cached }); } catch (_) {}
      return data;
    } catch (error) {
      if (cached?.data) { this.indexes.set(provider, cached); return cached.data; }
      throw error;
    }
  }

  parse(ttml, provider) {
    if (typeof ttml !== 'string' || !/<(?:\w+:)?tt[\s>]/.test(ttml)) return null;
    let lyrics;
    try { lyrics = parseAMLLLyrics(ttml); } catch { return null; }
    if (Utilities.isEmptyLyrics(lyrics)) return null;
    lyrics.provider = provider;
    lyrics.metadata = { ...lyrics.metadata, source: APPLE_LYRICS_NAMES[provider], provider };
    return lyrics;
  }

  async fetchExternal(provider, id, force) {
    if (!/^\d+$/.test(id)) return null;
    let url, sha256;
    if (provider === 'amll') url = `${AMLL}am-lyrics/${id}.ttml`;
    else {
      const index = await this.index(provider, force);
      const entry = provider === 'lunabeat'
        ? index.songs.find(song => ids(song.sourceIds?.appleMusicId).includes(id))
        : index.entries.find(song => song.enabled !== false && [String(song.appleMusicId), ...ids(song.alternateIds)].includes(id));
      if (!entry) return null;
      url = this.pathURL(provider === 'lunabeat' ? HUB : AM, entry.path, provider === 'lunabeat' ? 'lyrics/' : 'am-lyrics/');
      sha256 = entry.sha256;
    }
    const lyrics = this.parse(await this.read(url, { sha256, limit: 2 * 1024 * 1024 }), provider);
    return lyrics;
  }

  async provider(provider, song, force = false) {
    if (provider === 'applemusic') {
      const ttml = song.appleMusicTTML || this.nativeLyrics.get(String(song.appleId));
      if (ttml) {
        const parsed = this.parse(ttml, provider);
        if (parsed) return parsed;
      }
      const lyrics = song.lyricsJSON && DataParser.parseKPoeFormat(song.lyricsJSON);
      if (lyrics && !Utilities.isEmptyLyrics(lyrics)) {
        lyrics.provider = provider;
        lyrics.metadata = { ...lyrics.metadata, source: 'Apple Music', provider };
        return lyrics;
      }
      return null;
    }
    if (!APPLE_LYRICS_ORDER.includes(provider)) return null;
    const key = `${provider}:${song.appleId}`;
    const cached = this.results.get(key);
    if (!force && cached?.expires > Date.now()) return cached.lyrics;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.fetchExternal(provider, String(song.appleId), force).catch(error => {
      if (error.status !== 404) console.warn(`YouLy+ ${APPLE_LYRICS_NAMES[provider]}: ${error.message}`);
      return null;
    });
    this.pending.set(key, promise);
    try {
      const lyrics = await promise;
      if (this.results.size >= 100) this.results.delete(this.results.keys().next().value);
      this.results.set(key, { lyrics, expires: Date.now() + (lyrics ? SIX_HOURS : 60000) });
      return lyrics;
    } finally { this.pending.delete(key); }
  }

  async resolve(song, force = false, order) {
    for (const provider of normalizeAppleLyricsOrder(order)) {
      const lyrics = await this.provider(provider, song, force);
      if (lyrics) return lyrics;
    }
    throw new Error('No lyrics found from AMLL, LunaBeat, AmLyrics or Apple Music');
  }

  rememberNative(song) {
    if (!song.appleMusicTTML) return;
    if (this.nativeLyrics.size >= 30) this.nativeLyrics.delete(this.nativeLyrics.keys().next().value);
    this.nativeLyrics.set(String(song.appleId), song.appleMusicTTML);
  }
}

export const appleMusicLyrics = new AppleMusicLyricsService();
