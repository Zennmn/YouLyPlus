const CHINESE_LANGUAGES = new Set(['zh', 'zho', 'chi', 'cmn', 'yue', 'wuu', 'nan', 'hak', 'hsn', 'gan']);

/** Decide from the original lyrics, never the page language or translated text. */
export function shouldMachineTranslateLyrics(lyrics, songInfo = {}) {
  const text = (lyrics?.data || []).map(line => line.text || '').join('\n');
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const language = String(lyrics?.metadata?.language || lyrics?.metadata?.lang || songInfo.language || '')
    .trim().toLowerCase().split(/[-_]/)[0];
  if (CHINESE_LANGUAGES.has(language)) return false;
  if (/^[a-z]{2,3}$/.test(language) && !['und', 'mul', 'zxx'].includes(language)) return true;
  // Kana/Hangul distinguish Japanese/Korean from Chinese even when they use Han characters.
  if (/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return true;
  const hanCount = (text.match(/\p{Script=Han}/gu) || []).length;
  return hanCount < letters.length / 2;
}

/** Keep only source-supplied translations; don't echo the original as a translation. */
export function sourceTranslationData(lyrics) {
  return lyrics.data.map(line => ({ ...line, translatedText: line.translation?.text || undefined }));
}
