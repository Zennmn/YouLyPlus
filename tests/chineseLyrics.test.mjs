import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeChineseLyrics } from '../ui/applemusic-player/chineseLyrics.mjs';
import { convertLyrics, getPlainLyrics } from '../ui/applemusic-player/lyricsAdapter.mjs';

test('traditional Chinese original and syllables become simplified without changing timestamps or cached data', () => {
  const lyrics = { type: 'Word', provider: 'lunabeat', metadata: { language: 'zh-Hant' }, data: [{
    text: '頭髮發著光', startTime: 1, endTime: 4, duration: 3, translation: { lang: 'zh-Hans', text: '头发发着光' },
    translatedText: '头发发着光', romanizedText: 'tou fa fa zhe guang',
    syllabus: [ { text: '頭', time: 1000, duration: 300 }, { text: '髮', time: 1300, duration: 300 }, { text: '發著光', time: 1600, duration: 2400 } ],
  }] };
  const original = JSON.stringify(lyrics);
  const normalized = normalizeChineseLyrics(lyrics);
  assert.equal(normalized.data[0].text, '头发发着光');
  assert.equal(normalized.data[0].translation, undefined);
  assert.equal(normalized.data[0].translatedText, undefined);
  assert.equal(normalized.data[0].romanizedText, 'tou fa fa zhe guang');
  assert.deepEqual(normalized.data[0].syllabus.map(s => [s.time, s.duration]), [[1000, 300], [1300, 300], [1600, 2400]]);
  const amll = convertLyrics(lyrics, { displayMode: 'both' });
  assert.equal(amll[0].words.map(w => w.word).join(''), '头发发着光');
  assert.equal(amll[0].translatedLyric, '');
  assert.equal(amll[0].startTime, 1000);
  assert.equal(amll[0].endTime, 4000);
  assert.equal(JSON.stringify(lyrics), original);
});

test('Chinese without translation is simplified and punctuation-only subtitle differences are deduplicated', () => {
  const lyrics = { type: 'Line', data: [
    { text: '風輕輕吹過頭髮，雨後我們回家', startTime: 2, endTime: 5 },
    { text: '請別說再見', startTime: 5, endTime: 8, translation: { lang: 'zh-CN', text: '请别说，再见！' } },
  ] };
  const lines = convertLyrics(lyrics, { displayMode: 'translate' });
  assert.equal(lines[0].words[0].word, '风轻轻吹过头发，雨后我们回家');
  assert.equal(lines[1].translatedLyric, '');
});

test('foreign original stays unchanged while traditional Chinese translation becomes simplified', () => {
  const lyrics = { type: 'Line', metadata: { language: 'en' }, data: [{ text: 'Goodbye', translation: { lang: 'zh-Hant', text: '請別說再見' } }] };
  const lines = convertLyrics(lyrics, { displayMode: 'translate' });
  assert.equal(lines[0].words[0].word, 'Goodbye');
  assert.equal(lines[0].translatedLyric, '请别说再见');
});

test('Japanese original and Japanese subtitles are preserved, including Han-only text', () => {
  const lyrics = { type: 'Line', metadata: { language: 'ja' }, data: [
    { text: '月光 世界', translation: { lang: 'zh-Hant', text: '這個世界' } },
    { text: '夜に駆ける', translation: { lang: 'ja', text: '夢の國' } },
  ] };
  const lines = convertLyrics(lyrics, { displayMode: 'translate' });
  assert.equal(lines[0].words[0].word, '月光 世界');
  assert.equal(lines[0].translatedLyric, '这个世界');
  assert.equal(lines[1].words[0].word, '夜に駆ける');
  assert.equal(lines[1].translatedLyric, '夢の國');
});

test('nonduplicate Chinese paraphrases and English translations are retained; plain lyrics follow the same rules', () => {
  const lyrics = { type: 'None', metadata: { language: 'yue' }, data: [
    { text: '唔好走', translation: { lang: 'zh-Hant', text: '請你留下來' } },
    { text: '請別說再見', translation: '请别说再见' },
    { text: '月光', translatedText: 'Moonlight', translation: { lang: 'en', text: 'Moonlight' } },
  ] };
  const lines = getPlainLyrics(lyrics, { displayMode: 'translate' });
  assert.equal(lines[0].translation, '请你留下来');
  assert.equal(lines[1].text, '请别说再见');
  assert.equal(lines[1].translation, '');
  assert.equal(lines[2].translation, 'Moonlight');
});
