import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const settings = readFileSync(new URL('../src/modules/lyrics/settings.js', import.meta.url), 'utf8');
const manager = readFileSync(new URL('../src/modules/lyrics/lyricsManager.js', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('a first LunaBeat/AmLyrics index cache write cannot restart the previous song during fallback', async () => {
  for (const provider of ['lunabeat', 'amlyrics']) {
    const listeners = new Map(), requests = [], renders = [], states = [];
    let storageChanged, resolveLyrics;
    const pendingLyrics = new Promise(resolve => { resolveLyrics = resolve; });
    const song = { appleId: 'new', title: 'New', artist: 'Artist', album: 'Album' };
    const old = { appleId: 'old', title: 'Old', artist: 'Artist', album: 'Album' };
    const window = {
      addEventListener(name, listener) { listeners.set(name, [...(listeners.get(name) || []), listener]); },
      dispatchEvent(event) { for (const listener of listeners.get(event.type) || []) listener(event); },
    };
    const context = vm.createContext({
      window, AudioContext: class {}, console: { log() {}, warn() {}, error() {} },
      CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
      setTimeout, clearTimeout,
      browser: { storage: { onChanged: { addListener(fn) { storageChanged = fn; } } }, runtime: { sendMessage: async message => {
        if (message.type !== 'FETCH_LYRICS') return { success: false };
        requests.push(message.songInfo.appleId);
        if (message.songInfo.appleId === song.appleId) return pendingLyrics;
        return { success: true, lyrics: { type: 'Line', provider: 'amll', data: [{ text: 'Old lyric' }] } };
      } } },
      document: { getElementById: () => null },
      LyricsPlusAPI: {
        cleanupLyrics() { states.push('loading'); },
        displayLyrics(lyrics, info) { if (info.appleId === song.appleId) { renders.push(lyrics); states.push('ready'); } },
      },
    });
    vm.runInContext(settings + '\n' + manager, context);
    vm.runInContext(`lastKnownSongInfo=${JSON.stringify(old)}; lastBaseLyrics={type:'Line',provider:'amll',data:[{text:'Old lyric'}]}; applySubtitleRetiming=async()=>null; applySponsorBlock=async lyrics=>lyrics.data;`, context);
    const load = context.fetchAndDisplayLyrics(song, true);
    await settle();
    storageChanged({ [`lyplusAppleLyricsIndex_${provider}`]: { newValue: { checkedAt: Date.now(), data: {} } } }, 'local');
    await settle();
    resolveLyrics({ success: true, lyrics: { type: 'Line', provider, data: [{ text: 'Fallback lyric' }] } });
    await load;
    await settle();
    assert.deepEqual(requests, ['new'], `${provider} cache must not fetch the old track`);
    assert.equal(renders.at(-1)?.provider, provider);
    assert.equal(states.at(-1), 'ready');
  }
});
