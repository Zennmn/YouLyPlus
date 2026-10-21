import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { convertLyrics } from '../ui/applemusic-player/lyricsAdapter.mjs';
globalThis.self = globalThis;
const { AppleMusicLyricsService } = await import('../src/background/services/appleMusicLyricsService.js');

const nativeTTML = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://itunes.apple.com/lyric-ttml-extensions" xml:lang="en" itunes:timing="Word"><head><metadata><itunes:iTunesMetadata><translations><translation xml:lang="zh-Hans-CN"><text for="L1">测试译文</text></translation></translations></itunes:iTunesMetadata></metadata></head><body><div><p itunes:key="L1" begin="1s" end="2s"><span begin="1s" end="2s">Test</span></p></div></body></tt>`;
const manager = readFileSync(new URL('../src/modules/lyrics/lyricsManager.js', import.meta.url), 'utf8');
const platform = readFileSync(new URL('../src/modules/applemusic/index.js', import.meta.url), 'utf8');
const functionSource = (source, name) => {
  const start = source.includes(`async function ${name}(`) ? source.indexOf(`async function ${name}(`) : source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  return source.slice(start, source.indexOf('\n}', start) + 2);
};

async function renderNative(mode, translationResponse) {
  const lyrics = new AppleMusicLyricsService().parse(nativeTTML, 'applemusic');
  let rendered;
  const context = vm.createContext({
    currentSongInfo: { appleId: '1437948973' }, currentFetchMediaId: 'test', lastBaseLyrics: lyrics, lastTranslationResponse: translationResponse,
    lastRomanizationResponse: null, currentDisplayMode: mode, currentSettings: { wordByWord: true },
    lastKnownSongInfo: null, lastProcessedDisplayMode: 'none',
    getAppleMusicLyricsLanguage: () => 'en',
    renderFinalLyrics: (value, song, displayMode) => { rendered = { value, displayMode }; },
    LyricsPlusAPI: {},
  });
  vm.runInContext(['combineLyricsData', 'determineFinalDisplayMode', 'updateAndRenderCombinedLyrics'].map(name => functionSource(manager, name)).join('\n'), context);
  await context.updateAndRenderCombinedLyrics({ appleId: '1437948973' }, 'test');
  return { lyrics, rendered, amll: convertLyrics(rendered.value, { displayMode: rendered.displayMode }) };
}

test('Apple header translation reaches AMLL immediately without a machine translation response', async () => {
  const { lyrics, rendered, amll } = await renderNative('translate', null);
  assert.equal(lyrics.metadata.language, 'en');
  assert.equal(lyrics.data[0].translation.lang, 'zh-Hans-CN');
  assert.equal(rendered.displayMode, 'translate');
  assert.equal(amll[0].translatedLyric, '测试译文');
  assert.equal(amll[0].words[0].word, 'Test');
});

test('a failed translation service cannot hide native translation and the off mode still hides it', async () => {
  assert.equal((await renderNative('translate', { success: false })).amll[0].translatedLyric, '测试译文');
  assert.equal((await renderNative('none', null)).amll[0].translatedLyric, '');
});

test('Apple native language uses browser or explicit translation language independently of page language', () => {
  const context = vm.createContext({ currentSettings: {}, navigator: { language: 'zh-CN' }, document: { documentElement: { lang: 'en-US' } }, Intl });
  vm.runInContext(functionSource(platform, 'getAppleMusicLyricsLanguage'), context);
  assert.equal(context.getAppleMusicLyricsLanguage(), 'zh-Hans-CN');
  context.currentSettings.customTranslateTarget = 'zh-TW';
  assert.equal(context.getAppleMusicLyricsLanguage(), 'zh-Hant-TW');
  context.currentSettings.customTranslateTarget = 'en-US';
  assert.equal(context.getAppleMusicLyricsLanguage(), 'en-US');
});

test('Apple translation enrichment uses the Apple native target language', () => {
  const context = vm.createContext({ getAppleMusicLyricsLanguage: () => 'zh-Hans-CN' });
  vm.runInContext(functionSource(manager, 'getLyricsTargetLanguage'), context);
  assert.equal(context.getLyricsTargetLanguage({ appleId: '1437948973' }), 'zh-Hans-CN');
});
