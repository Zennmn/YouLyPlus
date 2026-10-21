// ==================================================================================================
// LOCAL LYRICS DATA PARSER
// ==================================================================================================

export class DataParser {
  /**
   * Accepts both the AMLL-normalized record (data) used by current imports and the
   * legacy KPoe JSON shape (lyrics) retained in existing local databases.
   */
  static parseKPoeFormat(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data.data)) return data;
    if (!Array.isArray(data.lyrics) || data.lyrics.length === 0) return null;

    const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    return {
      type: data.type,
      data: data.lyrics.map(item => {
        const startTime = Number(item.time || 0) / 1000;
        const duration = Number(item.duration || 0) / 1000;
        const syllabus = (item.syllabus || []).map(syl => ({
          text: syl.text || '',
          time: Number(syl.time || 0),
          duration: Number(syl.duration || 0),
          isBackground: syl.isBackground || false
        }));

        let lineRomanizedText;
        let romanizedSyllabus;
        if (item.transliteration) {
          if (Array.isArray(item.transliteration.syllabus)
            && item.transliteration.syllabus.length === syllabus.length
            && syllabus.length > 0) {
            romanizedSyllabus = syllabus.map((syl, index) => ({
              ...syl,
              romanizedText: item.transliteration.syllabus[index].text || syl.text
            }));
            lineRomanizedText = item.transliteration.text || item.text;
          } else if (item.transliteration.text) {
            lineRomanizedText = item.transliteration.text;
          }
        }

        return {
          text: item.text || '',
          startTime,
          duration,
          endTime: startTime + duration,
          syllabus: romanizedSyllabus || syllabus,
          element: item.element || [],
          romanizedText: lineRomanizedText,
          translation: item.translation || null
        };
      }),
      metadata: {
        ...metadata,
        source: String(metadata.source || 'Local')
      }
    };
  }
}
