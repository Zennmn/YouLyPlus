import { DOMParser } from '../../lib/xmldom.min.js';
import { TTMLParser, toAmllLyrics } from '../../vendor/amll-ttml/parser.js';

/** Keep each AMLL main/background line separate throughout enrichment and display. */
export function parseAMLLLyrics(ttml) {
  const doc = new DOMParser().parseFromString(ttml, 'application/xml');
  const elements = Array.from(doc.getElementsByTagName('*'));
  const keys = new Set(elements.flatMap(el => Array.from(el.attributes || []).filter(a => a.localName === 'key').map(a => a.value)));
  let generated = 0;
  for (const el of elements) {
    // Some sources omit iTunes keys. AMLL requires one to accept a paragraph.
    if (el.localName === 'p' && !Array.from(el.attributes).some(a => a.localName === 'key' && a.value)) {
      let key;
      do { key = `lyplus-generated-${++generated}`; } while (keys.has(key));
      keys.add(key);
      el.setAttributeNS('http://music.apple.com/lyric-ttml-internal', 'itunes:key', key);
    }
  }
  // Apple also supplies prefixed iTunesMetadata/body elements; upstream uses
  // unqualified tag lookups. Resolve those by local name without altering content.
  for (const node of [doc, ...elements]) {
    const getByTag = node.getElementsByTagName.bind(node);
    node.getElementsByTagName = name => name !== '*' && !name.includes(':')
      ? node.getElementsByTagNameNS('*', name) : getByTag(name);
  }
  const parsed = TTMLParser.parse(ttml, { domParser: { parseFromString: () => doc } });
  const sources = parsed.lines.flatMap(line => line.backgroundVocal ? [line, line.backgroundVocal] : [line]);
  // Preserve the existing preference for Chinese when a file supplies several translations.
  const languages = sources.flatMap(line => (line.translations || []).map(t => t.language));
  const translationLanguage = languages.find(lang => /^zh[-_](Hans|CN)/i.test(lang)) || languages.find(lang => /^zh/i.test(lang));
  const converted = toAmllLyrics(parsed, { translationLanguage });
  const type = converted.lines.every(line => line.startTime === 0 && line.endTime === 0) ? 'None' : parsed.metadata.timingMode;
  return {
    type,
    metadata: { ...parsed.metadata, ttmlParser: 'amll-1', amllMetadata: converted.metadata },
    data: converted.lines.map((line, index) => {
      const source = sources[index];
      const translation = source.translations?.find(t => t.language === translationLanguage) || source.translations?.[0];
      const main = line.isBG ? sources[index - 1] : source;
      return {
        text: line.words.map(w => w.word).join(''),
        startTime: line.startTime / 1000,
        endTime: line.endTime / 1000,
        duration: (line.endTime - line.startTime) / 1000,
        amll: { isBG: line.isBG, isDuet: line.isDuet },
        element: { singer: main.agentId || '' },
        ...(line.translatedLyric ? { translation: { text: line.translatedLyric, lang: translation?.language || '' } } : {}),
        ...(line.romanLyric ? { romanizedText: line.romanLyric } : {}),
        syllabus: line.words.map(w => ({
          text: w.word, time: w.startTime, duration: w.endTime - w.startTime,
          ...(w.romanWord ? { romanizedText: w.romanWord } : {}),
          amllWord: { ruby: w.ruby, obscene: w.obscene, emptyBeat: w.emptyBeat },
        })),
      };
    }),
  };
}
