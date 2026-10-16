const CHINESE_LANGUAGES = new Set(['zh', 'zho', 'chi', 'cmn', 'yue', 'wuu', 'nan', 'hak', 'hsn', 'gan']);
const JAPANESE_KOREAN_LANGUAGES = new Set(['ja', 'jpn', 'ko', 'kor']);
const KANA_HANGUL = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const normalizeLanguage = value => {
  const language = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(language) && !['und', 'mul', 'zxx'].includes(language) ? language : '';
};

export function isChineseLanguage(language) {
  return CHINESE_LANGUAGES.has(normalizeLanguage(language));
}

export function getLyricsLanguageContext(lyrics, songInfo = {}) {
  const lines = lyrics?.data || [];
  return {
    language: normalizeLanguage(lyrics?.metadata?.language) || normalizeLanguage(lyrics?.metadata?.lang) || normalizeLanguage(songInfo.language),
    // Include the entire song so a Japanese line containing only kanji is protected.
    hasJapaneseOrKorean: lines.some(line => KANA_HANGUL.test(line.text || '') ||
      JAPANESE_KOREAN_LANGUAGES.has(normalizeLanguage(line.language || line.lang))),
  };
}

export function isChineseLyricLine(line, context = {}) {
  const text = line.text || '';
  if (!/\p{Script=Han}/u.test(text) || KANA_HANGUL.test(text)) return false;
  const language = normalizeLanguage(line.language || line.lang);
  if (language) return CHINESE_LANGUAGES.has(language);
  if (context.hasJapaneseOrKorean || JAPANESE_KOREAN_LANGUAGES.has(context.language)) return false;
  const letters = (text.match(/\p{L}/gu) || []).length;
  const han = (text.match(/\p{Script=Han}/gu) || []).length;
  return han >= letters / 2;
}

/** Decide from the original lyrics, never the page language or translated text. */
export function shouldMachineTranslateLyrics(lyrics, songInfo = {}) {
  const sourceLines = lyrics?.data || [];
  const text = sourceLines.map(line => line.text || '').join('\n');
  const letters = text.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  const context = getLyricsLanguageContext(lyrics, songInfo);
  const { language } = context;
  if (CHINESE_LANGUAGES.has(language)) return false;
  if (language || context.hasJapaneseOrKorean) return true;

  // Count repeated choruses once, and don't give separate background vocals another vote.
  const mainLines = sourceLines.filter(line => !line.amll?.isBG);
  const uniqueLines = new Map();
  for (const line of mainLines.length ? mainLines : sourceLines) {
    const key = (line.text || '').normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();
    if (/\p{L}/u.test(key) && !uniqueLines.has(key)) uniqueLines.set(key, line);
  }
  const lines = [...uniqueLines.values()];
  if (!lines.length) return false;
  const chineseLines = lines.filter(line => isChineseLyricLine(line, context)).length;
  const uniqueText = lines.map(line => line.text || '').join('\n');
  const hanCount = (uniqueText.match(/\p{Script=Han}/gu) || []).length;
  const letterCount = (uniqueText.match(/\p{L}/gu) || []).length;
  return !(chineseLines > lines.length / 2 || hanCount >= letterCount / 2);
}

/** Apple Music only requests machine translation for native lyrics without a translation track. */
export function canMachineTranslateLyrics(lyrics, songInfo = {}) {
  const provider = lyrics?.provider || lyrics?.metadata?.provider;
  const appleMusic = songInfo.appleId || ['applemusic', 'amll', 'lunabeat', 'amlyrics'].includes(provider);
  if (appleMusic && provider !== 'applemusic') return false;
  // Any source translation track is authoritative, regardless of language or completeness.
  if (appleMusic && lyrics?.data?.some(line => line.translation != null || line.translatedText)) return false;
  return shouldMachineTranslateLyrics(lyrics, songInfo);
}

/** Keep only source-supplied translations; don't echo the original as a translation. */
export function sourceTranslationData(lyrics) {
  return lyrics.data.map(line => ({
    ...line,
    translatedText: (typeof line.translation === 'string' ? line.translation : line.translation?.text) || line.translatedText || undefined,
  }));
}
