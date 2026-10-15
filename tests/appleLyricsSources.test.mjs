import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { normalizeAppleLyricsOrder } from '../src/lib/appleLyricsSources.js';
globalThis.self = globalThis;
const { AppleMusicLyricsService } = await import('../src/background/services/appleMusicLyricsService.js');
const { parseAppleTTML } = await import('../src/lib/parser.js');
const HUB = 'https://2755337087.github.io/ttml-hub/';
const AM = 'https://raw.githubusercontent.com/Zennmn/am-lyrics/main/';
const amllURL = id => `https://raw.githubusercontent.com/amll-dev/amll-ttml-db/main/am-lyrics/${id}.ttml`;
const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://itunes.apple.com/lyric-ttml-extensions" itunes:timing="Word"><body><div><p begin="1s" end="3s" ttm:agent="v2"><span begin="1s" end="2s">Hello</span> <span begin="2s" end="3s">world</span><span ttm:role="x-translation" xml:lang="zh-Hans">你好世界</span><span ttm:role="x-roman">hello roman</span></p></div></body></tt>`;
const digest = async text => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))).toString('hex');
const song = { appleId: '123', title: 'Song', appleMusicTTML: ttml };
function fixture(resources) {
  const requests = [], stored = {};
  const service = new AppleMusicLyricsService({
    request: async url => {
      requests.push(url);
      const value = resources[url];
      if (value instanceof Error) throw value;
      return new Response(value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value), { status: value === undefined ? 404 : 200 });
    },
    storage: { get: async key => ({ [key]: stored[key] }), set: async values => Object.assign(stored, values) },
  });
  return { service, requests, stored };
}
test('AMLL is preferred to even available native word lyrics and lower sources are never requested', async () => {
  const { service, requests } = fixture({ [amllURL('123')]: ttml });
  const result = await service.resolve(song);
  assert.equal(result.provider, 'amll');
  assert.deepEqual(requests, [amllURL('123')]);
  assert.equal(result.data[0].translation.text, '你好世界');
  assert.equal(result.data[0].romanizedText, 'hello roman');
  assert.equal(result.data[0].text, 'Hello world');
  assert.equal(result.data[0].startTime, 1);
  assert.equal(result.data[0].syllabus[0].time, 1000);
  assert.equal(result.data[0].element.singer, 'v2');
});
test('LunaBeat matches any Apple ID in its array and reuses an unchanged revision', async () => {
  const index = { schemaVersion: 2, revision: 'rev1', songs: [{ sourceIds: { appleMusicId: ['456', '123'] }, path: 'lyrics/ab/song.ttml', sha256: await digest(ttml) }] };
  const { service, requests } = fixture({
    [`${HUB}api/v1/manifest.json`]: { schemaVersion: 2, revision: 'rev1', index: 'songs.json', indexSha256: await digest(JSON.stringify(index)) },
    [`${HUB}api/v1/songs.json`]: index, [`${HUB}lyrics/ab/song.ttml`]: ttml,
  });
  assert.equal((await service.resolve(song)).provider, 'lunabeat');
  await service.provider('lunabeat', song, true);
  assert.equal(requests.filter(url => url.endsWith('songs.json')).length, 1);
  assert.equal(requests[0], amllURL('123'));
  assert.ok(!requests.some(url => url.startsWith(AM)));
});
test('AmLyrics supports alternate IDs, disabled entries and IDs above Number.MAX_SAFE_INTEGER', async () => {
  const { service } = fixture({
    [`${HUB}api/v1/manifest.json`]: new Error('offline'),
    [`${AM}index.json`]: '{"entries":[{"appleMusicId":123,"enabled":false,"path":"am-lyrics/disabled.ttml"},{"appleMusicId":7335408332109193189,"alternateIds":[123,"456"],"path":"am-lyrics/artist - song.ttml"}]}',
    [`${AM}am-lyrics/artist%20-%20song.ttml`]: ttml,
  });
  assert.equal((await service.resolve(song)).provider, 'amlyrics');
  assert.equal((await service.provider('amlyrics', { appleId: '7335408332109193189' })).provider, 'amlyrics');
  assert.equal((await service.provider('amlyrics', { appleId: '456' })).provider, 'amlyrics');
});
test('missing, malformed and corrupt external lyrics fall back to late arriving native TTML', async () => {
  const { service, requests } = fixture({
    [amllURL('123')]: '<html>not TTML</html>',
    [`${HUB}api/v1/manifest.json`]: { schemaVersion: 2, revision: 'rev1', index: 'songs.json' },
    [`${HUB}api/v1/songs.json`]: { schemaVersion: 2, revision: 'rev1', songs: [{ sourceIds: { appleMusicId: ['123'] }, path: 'lyrics/song.ttml', sha256: 'bad' }] },
    [`${HUB}lyrics/song.ttml`]: ttml, [`${AM}index.json`]: { entries: [] },
  });
  await assert.rejects(service.resolve({ ...song, appleMusicTTML: undefined }), /No lyrics/);
  const count = requests.length;
  assert.equal((await service.resolve(song)).provider, 'applemusic');
  assert.equal(requests.length, count);
});
test('LunaBeat uses a stored index if refresh fails and rejects out-of-repository paths', async () => {
  const { service, stored } = fixture({ [`${HUB}lyrics/song.ttml`]: ttml });
  stored.lyplusAppleLyricsIndex_lunabeat = { checkedAt: 0, data: { songs: [{ sourceIds: { appleMusicId: ['123'] }, path: 'lyrics/song.ttml' }] } };
  assert.equal((await service.provider('lunabeat', song)).provider, 'lunabeat');
  assert.throws(() => service.pathURL(HUB, 'lyrics/../../evil', 'lyrics/'));
  assert.throws(() => service.pathURL(HUB, 'https://elsewhere/lyrics/test', 'lyrics/'));
});
test('native TTML and nested AMLL paragraphs retain lyrics once and keep inline translation separate', () => {
  const parsed = parseAppleTTML(ttml.replace('<div>', '<div><div>').replace('</div>', '</div></div>'));
  assert.equal(parsed.lyrics.length, 1);
  assert.equal(parsed.lyrics[0].translation.text, '你好世界');
  const native = parseAppleTTML('<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="2s">Native line</p></div></body></tt>');
  assert.equal(native.lyrics[0].text, 'Native line');
});
test('Apple Music requests bypass old native-first and cross-provider caches', async () => {
  const source = readFileSync(new URL('../src/background/core/lyricsService.js', import.meta.url), 'utf8');
  const get = source.slice(source.indexOf('  static async getOrFetch('), source.indexOf('  static async getAppleMusicLyrics('));
  const apple = source.slice(source.indexOf('  static async getAppleMusicLyrics('), source.indexOf('  static async getFromDB('));
  const winner = { provider: 'amll', data: [{}] }, cache = new Map();
  const service = vm.runInNewContext(`(class { static createCacheKey(s) { return s.appleId; } static cacheProviderLyrics() {} ${get} ${apple} })`, {
    normalizeAppleLyricsOrder, SettingsManager: { get: async () => ({}), getLyricsSettings: async () => ({}) },
    appleMusicLyrics: { rememberNative() {}, resolve: async () => winner }, state: { getCached: key => cache.get(key), setCached: (key, value) => cache.set(key, value) },
  });
  assert.equal((await service.getOrFetch(song)).lyrics.provider, winner.provider);
  assert.equal(cache.get('123').lyrics.provider, 'amll');
});

test('late native lyrics remain available for a manual switch using the initial song snapshot', async () => {
  const { service } = fixture({ [amllURL('123')]: ttml });
  const initialSong = { appleId: '123' };
  await service.resolve(initialSong);
  service.rememberNative(song);
  assert.equal((await service.provider('applemusic', initialSong)).provider, 'applemusic');
});

test('changing the settings order invalidates the winning source cache', async () => {
  const source = readFileSync(new URL('../src/background/core/lyricsService.js', import.meta.url), 'utf8');
  const method = source.slice(source.indexOf('  static async getAppleMusicLyrics('), source.indexOf('  static async getFromDB('));
  let order = 'amll,lunabeat,amlyrics,applemusic', cached;
  const calls = [];
  const service = vm.runInNewContext(`(class { static createCacheKey() { return 'song'; } static cacheProviderLyrics() {} ${method} })`, {
    normalizeAppleLyricsOrder,
    SettingsManager: { get: async () => ({}), getLyricsSettings: async () => ({ appleMusicLyricsProviderOrder: order }) },
    state: { getCached: () => cached, setCached: (_, value) => { cached = value; } },
    appleMusicLyrics: { rememberNative() {}, resolve: async (_, __, configured) => { calls.push(configured.join(',')); return { provider: configured[0] }; } },
  });
  assert.equal((await service.getAppleMusicLyrics(song)).lyrics.provider, 'amll');
  order = 'amlyrics,amll,applemusic';
  assert.equal((await service.getAppleMusicLyrics(song)).lyrics.provider, 'amlyrics');
  assert.equal(calls.length, 2);
});
