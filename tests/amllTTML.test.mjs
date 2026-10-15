import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { convertLyrics } from '../ui/applemusic-player/lyricsAdapter.mjs';
import { TTMLParser, toAmllLyrics } from '../src/vendor/amll-ttml/parser.js';

globalThis.self = globalThis;
const { DOMParser } = await import('../src/lib/xmldom.min.js');
const { AppleMusicLyricsService } = await import('../src/background/services/appleMusicLyricsService.js');
const service = new AppleMusicLyricsService();
const tt = (body, head = '', language = 'en') => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" xml:lang="${language}" itunes:timing="Word"><head><metadata>${head}</metadata></head><body><div>${body}</div></body></tt>`;
const backing = tt(`<p itunes:key="L1" begin="1s" end="4s" ttm:agent="v2"><span begin="1s" end="2s">Lead</span><span ttm:role="x-translation" xml:lang="zh-Hans">主唱译文</span><span ttm:role="x-roman">lead roman</span><span ttm:role="x-bg"><span begin="2s" end="3s">(Echo)</span><span ttm:role="x-translation" xml:lang="zh-Hans">和声译文</span><span ttm:role="x-roman">echo roman</span></span></p>`, '<ttm:agent xml:id="v2" type="other"/>');
const display = xml => convertLyrics(service.parse(xml, 'amll'), { displayMode: 'both' });

test('main and x-bg retain independent text, translation, romanization, duet side and exact timing', () => {
  for (const provider of ['amll', 'lunabeat', 'amlyrics', 'applemusic']) {
    const lyrics = service.parse(backing, provider);
    const [lead, bg] = convertLyrics(lyrics, { displayMode: 'both' });
    assert.equal(lead.words[0].word, 'Lead');
    assert.equal(lead.translatedLyric, '主唱译文');
    assert.equal(lead.romanLyric, 'lead roman');
    assert.equal(lead.isBG, false);
    assert.equal(lead.isDuet, true);
    assert.equal(bg.words[0].word, 'Echo');
    assert.equal(bg.translatedLyric, '和声译文');
    assert.equal(bg.romanLyric, 'echo roman');
    assert.equal(bg.isBG, true);
    assert.equal(bg.isDuet, true);
    assert.deepEqual([bg.startTime, bg.endTime], [2000, 3000]);
    assert.deepEqual([lead.startTime, lead.endTime], [1000, 4000]);
    const lineMode = convertLyrics(lyrics, { displayMode: 'both', wordByWord: false });
    assert.equal(lineMode[1].isBG, true);
    assert.equal(lineMode[1].translatedLyric, '和声译文');
    const hidden = convertLyrics(lyrics, { displayMode: 'none' });
    assert.equal(hidden[1].translatedLyric, '');
    assert.equal(hidden[1].romanLyric, '');
  }
});

test('Apple header translations with nested x-bg map to the matching vocal, including prefixed metadata', () => {
  const xml = tt(`<p itunes:key="L1" begin="1s" end="4s"><span begin="1s" end="2s">Lead</span><span ttm:role="x-bg"><span begin="2s" end="3s">(Echo)</span></span></p>`,
    `<itunes:iTunesMetadata><translations><translation xml:lang="zh-Hant"><text for="L1">主唱譯文<span ttm:role="x-bg">(和聲譯文)</span></text></translation></translations></itunes:iTunesMetadata>`);
  const [lead, bg] = display(xml);
  assert.equal(lead.translatedLyric, '主唱译文');
  assert.equal(bg.translatedLyric, '和声译文');
  assert.deepEqual([bg.startTime, bg.endTime], [2000, 3000]);
});

test('duet sides follow AMLL agent types and changes, with group vocals leaving the alternating state intact', () => {
  const agents = '<ttm:agent xml:id="v1" type="person"/><ttm:agent xml:id="v2" type="person"/><ttm:agent xml:id="v3" type="person"/><ttm:agent xml:id="g" type="group"/>';
  const xml = tt(['v1', 'v2', 'g', 'v3', 'v1'].map((agent, i) => `<p itunes:key="L${i}" ttm:agent="${agent}" begin="${i + 1}s" end="${i + 2}s">Vocal ${i}</p>`).join(''), agents);
  assert.deepEqual(display(xml).map(line => line.isDuet), [false, true, false, false, true]);
});

for (const name of ['complex-test-song', 'ruby-test-song', 'apple-music-duet', 'apple-music-other-duet']) {
  test(`renderer data matches upstream AMLL fixture: ${name}`, () => {
    const xml = readFileSync(new URL(`../vendor/amll/packages/ttml/tests/fixtures/${name}.ttml`, import.meta.url), 'utf8');
    const expected = toAmllLyrics(TTMLParser.parse(xml, { domParser: new DOMParser() }), { translationLanguage: 'zh-Hans-CN' }).lines;
    const actual = display(xml);
    const comparable = lines => JSON.parse(JSON.stringify(lines.map(line => ({
      startTime: line.startTime, endTime: line.endTime, isBG: line.isBG, isDuet: line.isDuet,
      translatedLyric: line.translatedLyric, romanLyric: line.romanLyric,
      words: line.words.map(w => ({ word: w.word, startTime: w.startTime, endTime: w.endTime, romanWord: w.romanWord || '', ruby: w.ruby, obscene: w.obscene, emptyBeat: w.emptyBeat })),
    }))));
    assert.ok(actual.length > 0);
    if (name === 'apple-music-other-duet') {
      // This Chinese fixture intentionally goes through the user's simplification
      // and duplicate-subtitle cleanup. Compare upstream timing/roles here;
      // conversion of both vocals is covered separately below.
      const structure = lines => comparable(lines).map(({ translatedLyric, ...line }) => ({
        ...line, words: line.words.map(({ word, ...w }) => w),
      }));
      assert.deepEqual(structure(actual), structure(expected));
    } else {
      assert.deepEqual(comparable(actual), comparable(expected));
    }
  });
}

test('keyless/nested/prefixed paragraphs stay usable and Chinese conversion cleans each vocal separately', () => {
  const xml = tt(`<div><p begin="1s" end="4s"><span begin="1s" end="2s">發著光</span><span ttm:role="x-translation" xml:lang="zh-Hans">发着光</span><span ttm:role="x-bg"><span begin="2s" end="3s">(與你)</span><span ttm:role="x-translation" xml:lang="zh-Hans">与你</span></span></p></div>`, '', 'zh-Hant');
  const [lead, bg] = display(xml);
  assert.equal(lead.words[0].word, '发着光');
  assert.equal(bg.words[0].word, '与你');
  assert.equal(lead.translatedLyric, '');
  assert.equal(bg.translatedLyric, '');
  const prefixed = xml.replaceAll('<body>', '<t:body xmlns:t="http://www.w3.org/ns/ttml">').replaceAll('</body>', '</t:body>');
  assert.equal(display(prefixed).length, 2);
  assert.equal(service.parse('<tt><body/></tt>', 'amll'), null);
});

const manager = readFileSync(new URL('../src/modules/lyrics/lyricsManager.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = manager.includes(`async function ${name}(`) ? manager.indexOf(`async function ${name}(`) : manager.indexOf(`function ${name}(`);
  return manager.slice(start, manager.indexOf('\n}', start) + 2);
};

test('enrichment and line-mode conversion preserve x-bg metadata and built-in subtitles on service failure', async () => {
  let rendered;
  const context = vm.createContext({
    currentFetchMediaId: 'song', lastBaseLyrics: service.parse(backing, 'amll'),
    lastTranslationResponse: { success: false }, lastRomanizationResponse: { success: false },
    currentDisplayMode: 'both', currentSettings: { wordByWord: false },
    applySubtitleRetiming: async () => null, applySponsorBlock: async value => value.data,
    renderFinalLyrics: (value, _, mode) => { rendered = { value, mode }; },
    LyricsPlusAPI: {}, lastKnownSongInfo: null, lastProcessedDisplayMode: 'none',
  });
  vm.runInContext(['combineLyricsData', 'convertWordLyricsToLine', 'determineFinalDisplayMode', 'updateAndRenderCombinedLyrics'].map(functionSource).join('\n'), context);
  await context.updateAndRenderCombinedLyrics({ appleId: 'test' }, 'song');
  assert.equal(rendered.mode, 'both');
  const [lead, bg] = convertLyrics(rendered.value, { displayMode: rendered.mode });
  assert.equal(lead.translatedLyric, '主唱译文');
  assert.equal(bg.translatedLyric, '和声译文');
  assert.equal(bg.romanLyric, 'echo roman');
  assert.equal(bg.isBG, true);
  assert.equal(bg.isDuet, true);
  assert.deepEqual([bg.startTime, bg.endTime], [2000, 3000]);
});

test('prebuilt word romanization survives enrichment without adding a duplicate romanization line', async () => {
  const xml = readFileSync(new URL('../vendor/amll/packages/ttml/tests/fixtures/complex-test-song.ttml', import.meta.url), 'utf8');
  const lyrics = service.parse(xml, 'amll');
  const translationSource = readFileSync(new URL('../src/background/core/translationService.js', import.meta.url), 'utf8');
  const start = translationSource.indexOf('  static async romanize(');
  const method = translationSource.slice(start, translationSource.indexOf('\n  }', start) + 4);
  const romanizer = vm.runInNewContext(`(class { ${method} })`, { console: { log() {} } });
  const response = await romanizer.romanize(lyrics, {}, {}, 'zh-CN', 'latin');
  const context = vm.createContext({});
  vm.runInContext(['combineLyricsData', 'convertWordLyricsToLine'].map(functionSource).join('\n'), context);
  const enriched = context.combineLyricsData(lyrics, null, { data: response });
  const before = convertLyrics(lyrics, { displayMode: 'both' });
  const after = convertLyrics(enriched, { displayMode: 'both' });
  assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(before)));
  assert.equal(after[0].romanLyric, '');
  assert.ok(after[0].words.some(w => w.romanWord));
  const lineMode = convertLyrics(context.convertWordLyricsToLine(enriched), { displayMode: 'both' });
  assert.ok(lineMode[0].romanLyric);
  assert.equal(lineMode[3].isBG, true);
  assert.equal(lineMode[3].romanLyric, before[3].romanLyric);
});
