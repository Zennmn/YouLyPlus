import { Converter } from 'opencc-js/t2cn';
import { shouldMachineTranslateLyrics } from '../../src/background/utils/lyricsLanguage.js';

let converter;
const simplify = value => {
  converter ||= Converter({ from: 'tw', to: 'cn' });
  return converter(value);
};
const chineseLanguages = new Set(['zh', 'zho', 'chi', 'cmn', 'yue', 'wuu', 'nan', 'hak', 'hsn', 'gan']);
const hasHan = value => /\p{Script=Han}/u.test(value);
const isChineseText = (value, lang = '') => {
  if (typeof value !== 'string' || !hasHan(value)) return false;
  const language = String(lang).toLowerCase().split(/[-_]/)[0];
  if (language && !['und', 'mul', 'zxx'].includes(language)) return chineseLanguages.has(language);
  return !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
};
const comparable = value => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();

function simplifySyllables(syllables) {
  const original = syllables.map(s => s.text || '').join('');
  const converted = [...simplify(original)];
  // Convert with whole-line context, then keep each original timing boundary.
  if (converted.length === [...original].length) {
    let offset = 0;
    return syllables.map(s => {
      const length = [...(s.text || '')].length;
      const text = converted.slice(offset, offset += length).join('');
      return { ...s, text };
    });
  }
  return syllables.map(s => ({ ...s, text: simplify(s.text || '') }));
}

/** Display-only conversion: preserve cached source lyrics and every timing value. */
export function normalizeChineseLyrics(lyrics) {
  if (!Array.isArray(lyrics?.data)) return lyrics;
  const chineseSong = !shouldMachineTranslateLyrics(lyrics) && lyrics.data.some(line => hasHan(line.text || ''));
  return { ...lyrics, data: lyrics.data.map(line => {
    const result = { ...line };
    if (chineseSong) {
      result.text = simplify(line.text || '');
      if (Array.isArray(line.syllabus)) result.syllabus = simplifySyllables(line.syllabus);
    }
    const language = line.translation?.lang || '';
    const normalizeTranslation = value => isChineseText(value, language) ? simplify(value) : value;
    const duplicate = (value, originalValue) => typeof value === 'string' && (
      originalValue === line.text || value === result.text ||
      (chineseSong && hasHan(result.text) && comparable(value) === comparable(result.text))
    );
    if (typeof line.translatedText === 'string') {
      result.translatedText = normalizeTranslation(line.translatedText);
      if (duplicate(result.translatedText, line.translatedText)) delete result.translatedText;
    }
    if (typeof line.translation === 'string') {
      result.translation = normalizeTranslation(line.translation);
      if (duplicate(result.translation, line.translation)) delete result.translation;
    } else if (line.translation?.text) {
      result.translation = { ...line.translation, text: normalizeTranslation(line.translation.text) };
      if (duplicate(result.translation.text, line.translation.text)) delete result.translation;
    }
    return result;
  }) };
}
