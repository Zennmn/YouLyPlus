import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { shouldMachineTranslateLyrics, sourceTranslationData } from '../src/background/utils/lyricsLanguage.js';

const lyrics = (text, language) => ({ metadata: { language }, data: [{ text }] });
const source = readFileSync(new URL('../src/background/core/translationService.js', import.meta.url), 'utf8');
const getMethod = source.slice(source.indexOf('  static async getOrFetch('), source.indexOf('  static async getCached('));
const translateMethod = source.slice(source.indexOf('  static async translate('), source.indexOf('  /**', source.indexOf('  static async translate(')));

test('Chinese simplified, traditional, Cantonese and Chinese songs with occasional English skip machine translation', () => {
  for (const value of [lyrics('晚风轻轻掠过海面'), lyrics('月光落在你的肩上 與你走過漫長黑夜 Love'), lyrics('只想一生跟你走', 'yue-Hant'), lyrics('Love love love 爱', 'zh-CN')]) {
    assert.equal(shouldMachineTranslateLyrics(value), false);
  }
  assert.equal(shouldMachineTranslateLyrics(lyrics('♪ 123 ...')), false);
});
test('English, Japanese, Korean and Han-only Japanese with metadata still allow translation', () => {
  for (const value of [lyrics('The evening breeze'), lyrics('夜に駆ける'), lyrics('月光 世界', 'ja'), lyrics('너와 함께 이 밤을 걸어'), lyrics('Привет мир')]) {
    assert.equal(shouldMachineTranslateLyrics(value), true);
  }
});
test('Chinese source translations are retained without creating duplicate original lines', () => {
  const original = { data: [{ text: '夜空', translation: { lang: 'en', text: 'Night sky' } }, { text: '晚风' }] };
  const data = sourceTranslationData(original);
  assert.equal(data[0].translatedText, 'Night sky');
  assert.equal(data[1].translatedText, undefined);
  assert.equal(original.data[0].translatedText, undefined);
});
test('Chinese lyrics bypass old machine caches and never construct a translation provider', async () => {
  const original = lyrics('晚风轻轻掠过海面');
  const service = vm.runInNewContext(`(class {
    static createCacheKey() { return 'old-cache'; }
    static getCached() { throw new Error('Old machine cache must not be read'); }
    static getProvider() { throw new Error('Provider must not be used'); }
    ${getMethod} ${translateMethod}
  })`, {
    shouldMachineTranslateLyrics, sourceTranslationData,
    SettingsManager: { getTranslationSettings: async () => ({}) },
    LyricsService: { getOrFetch: async () => ({ lyrics: original }) },
    Utilities: { isEmptyLyrics: () => false },
  });
  const result = await service.getOrFetch({}, 'translate', 'en');
  assert.equal(result.data[0].translatedText, undefined);
  assert.equal((await service.translate(original, 'en', {}))[0].translatedText, undefined);
});
test('foreign lyrics use the selected provider and preserve matching source translations', async () => {
  const calls = [];
  const original = { metadata: { language: 'en' }, data: [{ text: 'Hello', translation: { lang: 'zh-Hans', text: '你好' } }, { text: 'Good night' }] };
  const service = vm.runInNewContext(`(class {
    static getProvider() { return { translate: async lines => { calls.push(lines); return ['晚安']; } }; }
    ${translateMethod}
  })`, { shouldMachineTranslateLyrics, sourceTranslationData, calls });
  const result = await service.translate(original, 'zh-CN', {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].join(','), 'Good night');
  assert.equal(result[0].translatedText, '你好');
  assert.equal(result[1].translatedText, '晚安');
});
