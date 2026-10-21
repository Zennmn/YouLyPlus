import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { playerFontFamily } from '../src/lib/playerFont.js';
import { lyricsHarness, memory } from './appleLyricsServiceHarness.mjs';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const defaults = read('src/lib/defaultSettings.js');
const manager = read('src/modules/lyrics/lyricsManager.js');
const settings = read('src/modules/lyrics/settings.js');
const main = read('ui/applemusic-player/main.jsx');
const quiet = { log() {}, warn() {}, error() {} };
const extract = (source, name, indent = '') => {
  const start = source.search(new RegExp(`${indent}(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf(`\n${indent}}`, start) + indent.length + 2);
};
function page(storage, sendMessage = async () => ({ success: true })) {
  let storageChanged;
  const listeners = new Map();
  const window = {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    dispatchEvent: event => { for (const fn of listeners.get(event.type) || []) fn(event); },
  };
  const context = vm.createContext({
    window, console: quiet, setTimeout, clearTimeout, AudioContext: class {}, currentSongInfo: null,
    getAppleMusicLyricsLanguage: () => 'en',
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    browser: { storage: { onChanged: { addListener(fn) { storageChanged = fn; } } }, runtime: { sendMessage } },
    storageLocalGet: storage.get, storageLocalSet: storage.set,
    document: { getElementById: () => ({ textContent: '', classList: { toggle() {} } }) },
    LyricsPlusAPI: {},
  });
  vm.runInContext(`${defaults}\n${settings}\n${manager}`, context);
  const load = () => new Promise(resolve => context.loadSettings(resolve));
  return { context, load, storageChanged: patch => storageChanged(patch, 'local') };
}

test('every display mode and background setting survives a new page session, including explicit off', async () => {
  const storage = memory();
  const first = page(storage);
  await first.load();
  vm.runInContext('currentSongInfo={appleId:"123"}; fetchAndDisplayLyrics=()=>{};', first.context);
  for (const mode of ['translate', 'romanize', 'both', 'none']) {
    first.context.setCurrentDisplayModeAndRender(mode, { appleId: '123' });
    await Promise.resolve();
    const refreshed = page(storage);
    await refreshed.load();
    assert.equal(refreshed.context.resolveEffectiveMode(false, { appleId: '123' }), mode);
    assert.equal(refreshed.context.resolveEffectiveMode(true, { appleId: 'another' }), mode);
  }
  const view = {}, atoms = new Map();
  const ui = vm.createContext({
    settings: { appleMusicDisplayMode: 'both', appleMusicAMLLBackground: true },
    playerFontFamily,
    fontLoader: { update(_file, family) { view.fontFamily = family; atoms.set('font', family); } },
    patchView: patch => Object.assign(view, patch), config: { lyricFontFamilyAtom: 'font' }, store: { get: key => atoms.get(key), set: (key, value) => atoms.set(key, value) },
    document: { hidden: false }, matchMedia: () => ({ matches: false }),
    options: { onSettingsChange: storage.set }, toast() {},
  });
  vm.runInContext([extract(main, 'applySettings', '  '), extract(main, 'changeSettings', '  ')].join('\n'), ui);
  await ui.changeSettings({ appleMusicAMLLBackground: false });
  assert.equal(view.animated, false);
  const refreshed = page(storage);
  await refreshed.load();
  assert.equal(vm.runInContext('currentSettings.appleMusicAMLLBackground', refreshed.context), false);
  assert.equal(view.displayMode, 'both');
  await ui.changeSettings({ appleMusicPlayerFont: 'SimSun, serif' });
  const withFont = page(storage);
  await withFont.load();
  assert.equal(vm.runInContext('currentSettings.appleMusicPlayerFont', withFont.context), 'SimSun, serif');
  assert.equal(view.fontFamily, '"SimSun", serif');
  assert.equal(atoms.get('font'), '"SimSun", serif');
  await ui.changeSettings({ appleMusicPlayerFont: '' });
  assert.equal(view.fontFamily, '');
  assert.equal(atoms.get('font'), '');
  ui.options.onSettingsChange = async () => { throw new Error('storage failed'); };
  await ui.changeSettings({ appleMusicAMLLBackground: true });
  assert.equal(view.animated, false, 'failed write must restore the saved background');
});

test('manual source is restored by song ID after a worker/page restart; auto clears only that song', async t => {
  const storage = memory(), song = { appleId: '123', title: 'Song' };
  const backend = lyricsHarness({ storage });
  t.after(backend.restore);
  let service = backend.service;
  const manual = await service.getAppleMusicLyrics(song, false, 'amlyrics');
  assert.equal(manual.lyrics.provider, 'amlyrics');
  backend.resetRuntime();
  service = backend.service;
  assert.equal((await service.getAppleMusicLyrics({ ...song, title: 'Localized title' })).lyrics.provider, 'amlyrics');
  assert.equal((await service.getAppleMusicLyrics({ appleId: '456' })).lyrics.provider, 'amll');
  assert.equal((await service.getAppleMusicLyrics(song, false, 'auto')).lyrics.provider, 'amll');
  backend.resetRuntime();
  service = backend.service;
  assert.equal((await service.getAppleMusicLyrics(song)).lyrics.playerProviderPreference, 'auto');
});

test('unavailable saved source falls back without forgetting it; a failed manual switch does not overwrite memory', async t => {
  const storage = memory({ lyplusApplePlayerProvider_123: 'lunabeat' });
  const backend = lyricsHarness({ storage, resolver: async provider => provider ? null : { provider: 'amll', data: [{}] } });
  t.after(backend.restore);
  const service = backend.service;
  assert.equal((await service.getAppleMusicLyrics({ appleId: '123' })).lyrics.provider, 'amll');
  assert.equal(storage.values.lyplusApplePlayerProvider_123, 'lunabeat');
  await assert.rejects(service.getAppleMusicLyrics({ appleId: '123' }, false, 'amlyrics'));
  assert.equal(storage.values.lyplusApplePlayerProvider_123, 'lunabeat');
});

test('offset memory migrates old cache keys, survives metadata/version changes and remembers a zero reset', async t => {
  const storage = memory();
  const old = new Map([['apple-sources-v1:123', { offsetMs: -350 }]]);
  const backend = lyricsHarness({ storage, oldOffsets: old });
  t.after(backend.restore);
  let service = backend.service;
  assert.equal(await service.getLyricsOffset({ appleId: '123', title: 'Song' }), -350);
  assert.equal(storage.values.lyplusApplePlayerOffset_123, -350);
  await service.saveLyricsOffset({ appleId: '123' }, 220);
  backend.resetRuntime();
  service = backend.service;
  assert.equal(await service.getLyricsOffset({ appleId: '123', title: 'Different' }), 220);
  await service.saveLyricsOffset({ appleId: '123' }, 0);
  backend.resetRuntime();
  service = backend.service;
  assert.equal(await service.getLyricsOffset({ appleId: '123' }), 0);
  assert.equal(await service.getLyricsOffset({ appleId: '456' }), 0);
});

test('offset write is sent immediately and late reads cannot overwrite edits or another track', async () => {
  let finishRead;
  const writes = [], applied = [];
  const instance = page(memory(), async message => {
    if (message.type === 'GET_LYRICS_OFFSET') return new Promise(resolve => { finishRead = resolve; });
    if (message.type === 'SAVE_LYRICS_OFFSET') writes.push(message.offsetMs);
    return { success: true };
  });
  const { context } = instance;
  context.LyricsPlusAPI.setUserOffset = value => applied.push(value);
  vm.runInContext('currentFetchMediaId="A";', context);
  const readA = context.loadLyricsOffset({ appleId: '123' }, 'A');
  const write = context.saveLyricsOffset({ appleId: '123' }, 400);
  assert.deepEqual(writes, [400], 'no page-owned debounce before the write');
  finishRead({ success: true, offsetMs: 0 });
  await Promise.all([readA, write]);
  assert.deepEqual(applied, []);
  assert.equal(vm.runInContext('userOffsetMs', context), 400);
  const oldRead = context.loadLyricsOffset({ appleId: '123' }, 'A');
  vm.runInContext('currentFetchMediaId="B";userOffsetMs=70;', context);
  finishRead({ success: true, offsetMs: 400 });
  await oldRead;
  assert.equal(vm.runInContext('userOffsetMs', context), 70);
});

test('song preference writes and player-setting echoes cannot restart the previous track', () => {
  const instance = page(memory());
  vm.runInContext('lastKnownSongInfo={appleId:"old"}; fetchAndDisplayLyrics=()=>{throw new Error("must not refetch old song");};', instance.context);
  instance.storageChanged({ lyplusApplePlayerProvider_123: { newValue: 'amlyrics' }, lyplusApplePlayerOffset_123: { newValue: 200 } });
  instance.storageChanged({ appleMusicDisplayMode: { newValue: 'both' } });
  instance.storageChanged({ appleMusicAMLLBackground: { newValue: false } });
});

test('a full fresh-page fetch restores the selected source, translation intent and offset together', async t => {
  const storage = memory({ appleMusicDisplayMode: 'both', appleMusicAMLLBackground: false });
  const song = { appleId: '123', title: 'Song', artist: 'Artist', album: 'Album' };
  const backend = lyricsHarness({ storage, resolver: async provider => ({ provider: provider || 'amll', type: 'Line', data: [{
    text: 'Lyric', startTime: 1, endTime: 2, translation: { text: '歌词', lang: 'zh' }, romanizedText: 'roman',
  }] }) });
  t.after(backend.restore);
  let service = backend.service;
  await service.getAppleMusicLyrics(song, false, 'amlyrics');
  await service.saveLyricsOffset(song, 250);
  backend.resetRuntime();
  service = backend.service; // worker memory/cache discarded
  const fresh = page(storage, async message => {
    if (message.type === 'GET_LYRICS_OFFSET') return { success: true, offsetMs: await service.getLyricsOffset(message.songInfo) };
    if (message.type === 'FETCH_LYRICS') return { success: true, ...await service.getAppleMusicLyrics(message.songInfo) };
    return { success: false };
  });
  await fresh.load();
  const renders = [];
  fresh.context.LyricsPlusAPI.cleanupLyrics = () => {};
  fresh.context.LyricsPlusAPI.displayLyrics = (...args) => renders.push(args);
  vm.runInContext(`currentSongInfo=${JSON.stringify(song)};`, fresh.context);
  await fresh.context.fetchAndDisplayLyrics(song, true);
  const final = renders.at(-1);
  assert.equal(final[0].provider, 'amlyrics');
  assert.equal(final[0].playerProviderPreference, 'amlyrics');
  assert.equal(final[3].appleMusicDisplayMode, 'both');
  assert.equal(final[3].appleMusicAMLLBackground, false);
  assert.equal(final[11], 250);
});
