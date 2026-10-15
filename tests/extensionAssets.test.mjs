import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import vm from 'node:vm';

test('manifest references built local assets and keeps other platform renderers', () => {
  const root = new URL('../', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  for (const entry of manifest.content_scripts) for (const path of entry.js) assert.ok(existsSync(new URL(path, root)), `Missing ${path}`);
  const apple = manifest.content_scripts.find(entry => entry.matches.some(match => match.includes('music.apple.com')));
  assert.ok(!apple.js.includes('src/vendor/amll-player/player.js'), 'React and AMLL must not initialize in the Apple document');
  assert.ok(apple.js.indexOf('src/modules/applemusic/framePlayer.js') < apple.js.indexOf('src/modules/applemusic/index.js'));
  assert.ok(existsSync(new URL('src/vendor/amll-player/player.js', root)));
  assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes('src/player-frame/index.html') && entry.matches.some(match => match.includes('music.apple.com'))));
  for (const entry of manifest.content_scripts.filter(entry => entry !== apple)) assert.ok(entry.js.includes('src/modules/lyrics/lyricsRenderer.js'));
  assert.ok(manifest.web_accessible_resources.some(entry => entry.resources.includes('src/vendor/amll-player/player.css') && entry.matches.some(match => match.includes('music.apple.com'))));
});

test('native TTML lyrics can populate the cache before external providers run', async () => {
  const source = readFileSync(new URL('../src/background/core/lyricsService.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  static async getOrFetch('), source.indexOf('  static async getFromDB('));
  const cache = new Map();
  const calls = [];
  const cachedLyrics = { type: 'Word', data: [{ text: 'Native lyric' }] };
  const service = vm.runInNewContext(`(class { static createCacheKey() { return 'song'; } static cacheProviderLyrics(key, provider) { calls.push([key, provider]); } ${method} })`, {
    calls, DataParser: { parseKPoeFormat: () => cachedLyrics }, parseAppleTTML: () => ({ type: 'Word', lyrics: [{}] }),
    Utilities: { isEmptyLyrics: () => false }, SettingsManager: { get: async () => ({ appleMusicTTMLBypass: false }) },
    state: { hasCached: key => cache.has(key), getCached: key => cache.get(key), setCached: (key, value) => cache.set(key, value) },
    console: { log() {}, error() {} },
  });
  const result = await service.getOrFetch({ appleMusicTTML: '<tt>native</tt>' });
  assert.equal(result.lyrics, cachedLyrics);
  assert.equal(cache.get('song').lyrics, cachedLyrics);
  assert.equal(calls[0][0], 'song');
});
