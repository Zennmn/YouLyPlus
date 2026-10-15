import test from 'node:test';
import assert from 'node:assert/strict';
import { convertLyrics, getPlainLyrics, lyricPosition, seekPosition } from '../ui/applemusic-player/lyricsAdapter.mjs';

test('converts seconds on lines and milliseconds on words, with a separate backing vocal', () => {
  const lyric = { type: 'Word', data: [{ text: '你好 (世界)', startTime: 2, endTime: 5, translatedText: 'Hello world', syllabus: [
    { text: '你', time: 2000, duration: 600, romanizedText: 'ni ' },
    { text: '好', time: 2600, duration: 700, romanizedText: 'hao' },
    { text: '(世界)', time: 3500, duration: 1200, isBackground: true },
  ] }] };
  const original = JSON.stringify(lyric);
  const lines = convertLyrics(lyric, { displayMode: 'both' });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].startTime, 2000);
  assert.equal(lines[0].words[1].endTime, 3300);
  assert.equal(lines[0].translatedLyric, 'Hello world');
  assert.equal(lines[0].words[0].romanWord, 'ni ');
  assert.equal(lines[1].isBG, true);
  assert.equal(lines[1].words[0].word, '世界');
  assert.equal(JSON.stringify(lyric), original);
});

test('keeps line lyrics, duets, and romanization as the main lyric', () => {
  const lyrics = { type: 'Line', data: [
    { text: '你好', romanizedText: 'ni hao', startTime: 1, endTime: 2, element: { singer: 'v1' } },
    { text: '再见', startTime: 2, endTime: 3, element: { singer: 'v2' } },
  ] };
  const lines = convertLyrics(lyrics, { largerTextMode: 'romanization', displayMode: 'both' });
  assert.equal(lines[0].words[0].word, 'ni hao');
  assert.equal(lines[0].romanLyric, '你好');
  assert.equal(lines[0].isDuet, false);
  assert.equal(lines[1].isDuet, true);
  assert.equal(lines[1].words[0].endTime, 3000);
});

test('keeps unsynced text out of the timed renderer', () => {
  const lyrics = { type: 'None', data: [{ text: 'Plain line', translatedText: '翻译' }] };
  assert.deepEqual(convertLyrics(lyrics), []);
  assert.equal(getPlainLyrics(lyrics, { displayMode: 'translate' })[0].translation, '翻译');
  assert.equal(getPlainLyrics({ type: 'None', data: [{ text: 'Plain line', translation: { text: '原生翻译' } }] }, { displayMode: 'translate' })[0].translation, '原生翻译');
});

test('timing correction round trips between media time and lyric seek time', () => {
  assert.equal(lyricPosition(12, 0.15, 250), 11600);
  assert.equal(seekPosition(11600, 0.15, 250), 12);
  assert.equal(lyricPosition(0, 0.1, 200), 0);
  assert.equal(seekPosition(0, 0, -500), 0);
});
