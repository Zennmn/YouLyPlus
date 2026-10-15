const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const text = (value) => typeof value === 'string' ? value : '';

// YouLy+ uses seconds for lines and milliseconds for syllables. AMLL uses ms everywhere.
export function convertLyrics(lyrics, settings = {}) {
  if (!lyrics || lyrics.type === 'None' || !Array.isArray(lyrics.data)) return [];
  lyrics = normalizeChineseLyrics(lyrics);
  const singers = new Map();
  const lines = [];
  const romanAsMain = settings.largerTextMode === 'romanization';
  const showRoman = settings.displayMode === 'romanize' || settings.displayMode === 'both';
  const showTranslation = settings.displayMode === 'translate' || settings.displayMode === 'both';
  const primary = (item) => text(romanAsMain ? item.romanizedText || item.text : item.text);
  const secondary = (item) => text(romanAsMain ? item.text : item.romanizedText);

  for (const line of lyrics.data) {
    const syllables = Array.isArray(line.syllabus) ? line.syllabus : [];
    const start = Math.max(0, Math.round(finite(line.startTime, finite(syllables[0]?.time) / 1000) * 1000));
    const end = Math.max(start, Math.round(finite(line.endTime, start / 1000 + finite(line.duration)) * 1000));
    const singer = line.element?.singer;
    if (singer && !singers.has(singer)) singers.set(singer, singers.size % 2 === 1);
    const isDuet = line.amll?.isDuet ?? (singers.get(singer) || false);
    const translatedLyric = showTranslation ? text(line.translatedText || line.translation?.text || line.translation) : '';
    const romanLyric = showRoman ? secondary(line) || (line.amll ? '' : syllables.map(secondary).join('')) : '';
    const base = { startTime: start, endTime: end, translatedLyric, romanLyric, isDuet, isBG: line.amll?.isBG || false };

    if (lyrics.type !== 'Word' || settings.wordByWord === false || !syllables.length) {
      const word = primary(line);
      if (word.trim()) lines.push({ ...base,
        romanLyric: romanLyric || (showRoman ? syllables.map(secondary).join('') : ''),
        words: [{ word, startTime: start, endTime: end }],
      });
      continue;
    }

    const toWords = (background) => syllables.filter(s => !!s.isBackground === background).map(s => {
      const startTime = Math.max(0, Math.round(finite(s.time, start)));
      const endTime = startTime + Math.max(0, Math.round(finite(s.duration)));
      const word = background ? primary(s).replace(/[()]/g, '') : primary(s);
      let romanWord = showRoman ? secondary(s) : '';
      if (settings.hidePhoneticDup && romanWord.trim() === word.trim()) romanWord = '';
      return { ...s.amllWord, word, startTime, endTime, romanWord };
    }).filter(w => w.word.length > 0);

    if (line.amll) {
      // AMLL already separated background vocals and computed their exact time range.
      // Preserve its flags, punctuation, translation and romanization without re-splitting.
      const words = toWords(false);
      if (words.length) lines.push({ ...base, words });
      continue;
    }
    const main = toWords(false);
    const background = toWords(true);
    const withTiming = (words, isBG) => ({
      ...base, words, isBG,
      startTime: Math.min(start, ...words.map(w => w.startTime)),
      endTime: Math.max(end, ...words.map(w => w.endTime)),
      ...(isBG ? { translatedLyric: '', romanLyric: '' } : {}),
    });
    if (main.length) lines.push(withTiming(main, false));
    if (background.length) lines.push(withTiming(background, main.length > 0));
  }
  return lines;
}

export function getPlainLyrics(lyrics, settings = {}) {
  lyrics = normalizeChineseLyrics(lyrics);
  return (lyrics?.data || []).map(line => ({
    text: text(settings.largerTextMode === 'romanization' ? line.romanizedText || line.text : line.text),
    translation: ['translate', 'both'].includes(settings.displayMode) ? text(line.translatedText || line.translation?.text || line.translation) : '',
    romanization: ['romanize', 'both'].includes(settings.displayMode) ? text(line.romanizedText) : '',
  }));
}

export function lyricPosition(positionSeconds, latencySeconds = 0, offsetMs = 0) {
  return Math.max(0, Math.round(finite(positionSeconds) * 1000 - finite(latencySeconds) * 1000 - finite(offsetMs)));
}

export function seekPosition(positionMs, latencySeconds = 0, offsetMs = 0) {
  return Math.max(0, (finite(positionMs) + finite(latencySeconds) * 1000 + finite(offsetMs)) / 1000);
}
import { normalizeChineseLyrics } from './chineseLyrics.mjs';

