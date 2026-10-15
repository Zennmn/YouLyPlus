import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/inject/applemusic/songTracker.js', import.meta.url), 'utf8');
const item = id => ({ id, attributes: { name: `Song ${id}`, artistName: 'Artist', albumName: 'Album', durationInMillis: 200000, artwork: { url: 'https://example.test/{w}x{h}.jpg' }, playParams: { id, kind: 'songs' } } });

function tracker(overrides = {}) {
  const listeners = new Map();
  const events = new Map();
  const messages = [];
  const frames = new Map();
  let frame = 0;
  const music = {
    nowPlayingItem: item('A'), isPlaying: false, currentPlaybackTime: 12, currentPlaybackDuration: 200, volume: 0.5, shuffleMode: 0, repeatMode: 0,
    addEventListener: (name, callback) => events.set(name, callback), removeEventListener() {},
    async play() { this.isPlaying = true; }, async pause() { this.isPlaying = false; },
    async seekToTime(time) { this.currentPlaybackTime = time; },
    async skipToNextItem() { this.nowPlayingItem = item('B'); this.currentPlaybackTime = 0; },
    async skipToPreviousItem() { this.nowPlayingItem = item('A'); this.currentPlaybackTime = 0; },
    ...overrides.music,
  };
  const window = { location: { origin: 'https://music.apple.com' }, MusicKit: { getInstance: () => music }, postMessage: message => messages.push(message), addEventListener: (name, callback) => listeners.set(name, callback) };
  vm.runInNewContext(source, {
    window, document: { hidden: false, documentElement: { lang: 'zh-CN' }, addEventListener() {}, ...overrides.document }, navigator: { language: 'zh-CN', ...overrides.navigator },
    requestAnimationFrame: callback => { frames.set(++frame, callback); return frame; }, cancelAnimationFrame: id => frames.delete(id),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 2, clearInterval() {},
    AbortController, URLSearchParams, Intl, fetch: overrides.fetch || (async () => ({ ok: false })),
  });
  const command = (name, value, extra = {}) => listeners.get('message')({ source: window, origin: window.location.origin, data: { type: 'LYPLUS_PLAYER_COMMAND', requestId: 'test', command: name, value }, ...extra });
  const advanceFrame = time => {
    const callbacks = [...frames.values()];
    frames.clear();
    for (const callback of callbacks) callback(time);
  };
  return { command, music, messages, events, window, advanceFrame };
}

test('high-refresh time events keep every timeline sample without duplicate full-state broadcasts', () => {
  const bridge = tracker({ music: { isPlaying: true } });
  const initial = bridge.messages.filter(m => m.type === 'LYPLUS_PLAYBACK_STATE').length;
  for (let i = 1; i <= 240; i++) {
    bridge.music.currentPlaybackTime = i / 240;
    bridge.events.get('playbackTimeDidChange')();
    bridge.advanceFrame(i * 1000 / 240);
  }
  assert.equal(bridge.messages.filter(m => m.type === 'LYPLUS_TIME_UPDATE').length, 240);
  assert.equal(bridge.messages.filter(m => m.type === 'LYPLUS_PLAYBACK_STATE').length, initial);
  bridge.music.volume = 0.8;
  bridge.events.get('volumeDidChange')();
  assert.equal(bridge.messages.filter(m => m.type === 'LYPLUS_PLAYBACK_STATE').at(-1).state.volume, 0.8);
  bridge.music.isPlaying = false;
  bridge.events.get('playbackStateDidChange')();
  bridge.music.currentPlaybackTime = 70;
  bridge.events.get('playbackTimeDidChange')();
  assert.equal(bridge.messages.filter(m => m.type === 'LYPLUS_PLAYBACK_STATE').at(-1).state.currentTime, 70);
});

test('publishes an initial snapshot and updates paused seek immediately', async () => {
  const bridge = tracker();
  assert.equal(bridge.messages.find(m => m.type === 'LYPLUS_SONG_CHANGED').songInfo.appleId, 'A');
  await bridge.command('seek', 65);
  const state = bridge.messages.filter(m => m.type === 'LYPLUS_PLAYBACK_STATE').at(-1).state;
  assert.equal(state.currentTime, 65);
  assert.equal(state.isPlaying, false);
  assert.equal(bridge.messages.at(-1).ok, true);
  await bridge.command('snapshot');
  assert.ok(bridge.messages.some(m => m.type === 'LYPLUS_SONG_SNAPSHOT'));
});

test('controls the existing player and clamps volume without replacing its queue', async () => {
  const { command, music, messages } = tracker();
  await command('playPause'); assert.equal(music.isPlaying, true);
  await command('playPause'); assert.equal(music.isPlaying, false);
  await command('volume', 2); assert.equal(music.volume, 1);
  await command('shuffle', true); assert.equal(music.shuffleMode, 1);
  await command('repeat', 'all'); assert.equal(music.repeatMode, 2);
  await command('next'); assert.equal(music.nowPlayingItem.id, 'B');
  assert.equal(messages.filter(m => m.type === 'LYPLUS_SONG_CHANGED').at(-1).songInfo.appleId, 'B');
  await command('previous'); assert.equal(music.nowPlayingItem.id, 'A');
});

test('supports MusicKit v1 player methods and rejects malformed or foreign messages', async () => {
  const bridge = tracker({ music: { seekToTime: undefined, player: { seekToTime(time) { bridge.music.currentPlaybackTime = time; } } } });
  await bridge.command('seek', 23); assert.equal(bridge.music.currentPlaybackTime, 23);
  await bridge.command('volume', NaN); assert.equal(bridge.messages.at(-1).ok, false);
  await bridge.command('__proto__'); assert.equal(bridge.messages.at(-1).ok, false);
  const count = bridge.messages.length;
  await bridge.command('playPause', undefined, { source: {} });
  await bridge.command('playPause', undefined, { origin: 'https://other.test' });
  assert.equal(bridge.messages.length, count);
});

test('drops lyrics from a previous track even if its aborted request resolves late', async () => {
  const requests = [];
  const bridge = tracker({ music: { developerToken: 'test-token', nowPlayingItem: { ...item('A'), attributes: { ...item('A').attributes, hasLyrics: true } } }, fetch: () => new Promise(resolve => requests.push(resolve)) });
  await new Promise(resolve => setImmediate(resolve));
  bridge.music.nowPlayingItem = { ...item('B'), attributes: { ...item('B').attributes, hasLyrics: true } };
  bridge.events.get('nowPlayingItemDidChange')();
  await new Promise(resolve => setImmediate(resolve));
  requests.at(-1)({ ok: true, json: async () => ({ data: [{ relationships: { 'syllable-lyrics': { data: [{ attributes: { ttmlLocalizations: 'B lyrics' } }] } } }] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 2);
  requests[0]({ ok: true, json: async () => ({ data: [{ relationships: { 'syllable-lyrics': { data: [{ attributes: { ttmlLocalizations: 'A lyrics' } }] } } }] }) });
  await new Promise(resolve => setImmediate(resolve));
  const lyrics = bridge.messages.filter(m => m.type === 'LYPLUS_NATIVE_LYRICS');
  assert.equal(lyrics.length, 1);
  assert.equal(lyrics[0].songInfo.appleId, 'B');
  assert.ok(bridge.messages.every(m => !JSON.stringify(m).includes('test-token')));
});

const lyricRelationship = attributes => ({ data: [{ attributes }] });
const settleLyrics = () => new Promise(resolve => setImmediate(resolve));

test('AMDL catalog request uses both lyric relationships and prefers localized word TTML', async () => {
  const requests = [];
  const bridge = tracker({ music: {
    developerToken: 'dev-fixture', musicUserToken: 'user-fixture', storefrontId: 'cn',
    nowPlayingItem: { ...item('library-id'), attributes: { ...item('library-id').attributes, playParams: { id: 'library-id', catalogId: '123456' } } },
  }, fetch: async (url, options) => {
    if (url.endsWith('/me/storefront')) return { ok: true, json: async () => ({ data: [{ id: 'cn' }] }) };
    requests.push({ url, options });
    return { ok: true, json: async () => ({ data: [{ relationships: {
      'syllable-lyrics': lyricRelationship({ ttmlLocalizations: '<tt>localized words</tt>', ttml: '<tt>words</tt>' }),
      lyrics: lyricRelationship({ ttml: '<tt>lines</tt>' }),
    } }] }) };
  } });
  await settleLyrics();
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.pathname, '/v1/catalog/cn/songs/123456');
  assert.equal(url.searchParams.get('include'), 'lyrics,syllable-lyrics');
  assert.equal(url.searchParams.get('extend'), 'ttmlLocalizations');
  assert.equal(url.searchParams.get('l'), 'zh-Hans-CN');
  assert.equal(requests[0].options.credentials, 'include');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer dev-fixture');
  assert.equal(requests[0].options.headers['Music-User-Token'], 'user-fixture');
  assert.equal(bridge.messages.find(m => m.type === 'LYPLUS_NATIVE_LYRICS').songInfo.appleMusicTTML, '<tt>localized words</tt>');
  assert.ok(bridge.messages.every(m => !JSON.stringify(m).includes('fixture')));
});

test('native catalog lyrics fall back from empty or non-string word data to ordinary TTML', async () => {
  for (const syllable of [undefined, { ttmlLocalizations: '  ' }, { ttmlLocalizations: { zh: 'not a TTML string' } }]) {
    const bridge = tracker({ music: { developerToken: 'test-token' }, fetch: async () => ({ ok: true, json: async () => ({ data: [{ relationships: {
      'syllable-lyrics': lyricRelationship(syllable), lyrics: lyricRelationship({ ttml: '<tt>line lyrics</tt>' }),
    } }] }) }) });
    await settleLyrics();
    assert.equal(bridge.messages.find(m => m.type === 'LYPLUS_NATIVE_LYRICS').songInfo.appleMusicTTML, '<tt>line lyrics</tt>');
  }
});

test('native catalog lyrics accept unlocalized word TTML before line lyrics', async () => {
  const bridge = tracker({ music: { configuration: { app: { developerToken: 'test-token' } } }, fetch: async () => ({ ok: true, json: async () => ({ data: [{ relationships: {
    'syllable-lyrics': lyricRelationship({ ttml: '<tt>word lyrics</tt>' }), lyrics: lyricRelationship({ ttml: '<tt>line lyrics</tt>' }),
  } }] }) }) });
  await settleLyrics();
  assert.equal(bridge.messages.find(m => m.type === 'LYPLUS_NATIVE_LYRICS').songInfo.appleMusicTTML, '<tt>word lyrics</tt>');
});

test('native catalog failures and empty relationships do not publish bogus lyrics or break playback', async () => {
  for (const fetch of [async () => ({ ok: false }), async () => { throw new Error('offline'); }, async () => ({ ok: true, json: async () => ({ data: [{ relationships: {} }] }) })]) {
    const bridge = tracker({ music: { developerToken: 'test-token' }, fetch });
    await settleLyrics();
    assert.equal(bridge.messages.filter(m => m.type === 'LYPLUS_NATIVE_LYRICS').length, 0);
    await bridge.command('playPause');
    assert.equal(bridge.music.isPlaying, true);
  }
});

test('native lyrics request honors the configured language on an English Apple Music page', async () => {
  const requests = [];
  tracker({ music: { developerToken: 'test-token' },
    document: { documentElement: { lang: 'en-US' }, currentScript: { dataset: { lyricsLanguage: 'zh-Hans-CN' } } },
    navigator: { language: 'en-US' },
    fetch: async url => { requests.push(url); return { ok: false }; },
  });
  await settleLyrics();
  assert.equal(new URL(requests[0]).searchParams.get('l'), 'zh-Hans-CN');
});


test("account storefront takes priority over browsing region and ignores its hasLyrics false flag", async () => {
  const requests = [];
  const bridge = tracker({ music: { developerToken: "dev-secret", musicUserToken: "user-secret", storefrontId: "us", nowPlayingItem: { ...item("A"), attributes: { ...item("A").attributes, hasLyrics: false } } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => url.endsWith("/me/storefront") ? { data: [{ id: "tr" }] } : { data: [{ relationships: { "syllable-lyrics": lyricRelationship({ ttmlLocalizations: "<tt>Chinese translated words</tt>" }) } }] } };
    },
  });
  await settleLyrics();
  assert.equal(requests.length, 2);
  assert.ok(requests[1].url.includes("/catalog/tr/songs/A?"));
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers["Music-User-Token"], "user-secret");
  assert.ok(bridge.messages.some(m => m.type === "LYPLUS_NATIVE_LYRICS"));
  await bridge.command("next"); await settleLyrics();
  assert.equal(requests.filter(r => r.url.endsWith("/me/storefront")).length, 1);
  bridge.music.musicUserToken = "different-secret";
  await bridge.command("previous"); await settleLyrics();
  assert.equal(requests.filter(r => r.url.endsWith("/me/storefront")).length, 2);
  assert.ok(bridge.messages.every(m => !JSON.stringify(m).includes("secret")));
});

test("unavailable or invalid account storefront falls back to browsing region", async () => {
  for (const accountResponse of [{ ok: false }, { ok: true, json: async () => ({ data: [{ id: "../tr" }] }) }]) {
    const requests = [];
    const bridge = tracker({ music: { developerToken: "dev", musicUserToken: "user", storefrontId: "jp" }, fetch: async url => {
      requests.push(url);
      if (url.endsWith("/me/storefront")) return accountResponse;
      return { ok: true, json: async () => ({ data: [{ relationships: { lyrics: lyricRelationship({ ttml: "<tt>fallback</tt>" }) } }] }) };
    } });
    await settleLyrics();
    assert.ok(requests[1].includes("/catalog/jp/songs/A?"));
    assert.ok(bridge.messages.some(m => m.type === "LYPLUS_NATIVE_LYRICS"));
    await bridge.command("next"); await settleLyrics();
    assert.equal(requests.filter(url => url.endsWith("/me/storefront")).length, 1);
  }
});

test("empty account-region lyrics retry the browsing region without duplicate region requests", async () => {
  for (const region of ["us", "tr"]) {
    const requests = [];
    tracker({ music: { developerToken: "dev", musicUserToken: "user", storefrontId: region }, fetch: async url => {
      requests.push(url);
      return { ok: true, json: async () => url.endsWith("/me/storefront") ? { data: [{ id: "tr" }] } : { data: [{ relationships: {} }] } };
    } });
    await settleLyrics();
    assert.equal(requests.length, region === "us" ? 3 : 2);
  }
});

test("cookie-authenticated account lookup survives a track change without publishing stale lyrics", async () => {
  let resolveAccount;
  const requests = [];
  const bridge = tracker({ document: { cookie: "media-user-token=cookie-secret" }, music: { developerToken: "dev", storefrontId: "us" }, fetch: async url => {
    requests.push(url);
    if (url.endsWith("/me/storefront")) return new Promise(resolve => { resolveAccount = resolve; });
    return { ok: true, json: async () => ({ data: [{ relationships: { lyrics: lyricRelationship({ ttml: "<tt>B lyrics</tt>" }) } }] }) };
  } });
  await bridge.command("next");
  resolveAccount({ ok: true, json: async () => ({ data: [{ id: "tr" }] }) });
  await settleLyrics();
  assert.equal(requests.length, 2);
  assert.ok(requests[1].includes("/catalog/tr/songs/B?"));
  assert.equal(bridge.messages.filter(m => m.type === "LYPLUS_NATIVE_LYRICS").length, 1);
  assert.ok(bridge.messages.every(m => !JSON.stringify(m).includes("cookie-secret")));
});
