import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportedFontLoader, importPlayerFont } from '../src/lib/importedPlayerFont.js';

function environment(read) {
  const applied = [], errors = [], fonts = new Set();
  class Face {
    constructor(family, buffer) { this.family = family; this.buffer = buffer; }
    async load() { if (this.buffer === 'invalid') throw new Error('decode'); return this; }
  }
  const loader = createImportedFontLoader(value => applied.push(value), e => errors.push(e), { read, fonts, FontFace: Face });
  return { applied, errors, fonts, loader };
}

test('font binary loads from local storage, replaces existing face and survives a new player', async () => {
  const read = async id => ({ family: `Imported_${id}`, buffer: new ArrayBuffer(4) });
  const a = environment(read);
  await a.loader.update({ id: 'one' });
  assert.equal(a.applied.at(-1), '"Imported_one"');
  await a.loader.update({ id: 'two' });
  assert.equal(a.fonts.size, 1);
  const b = environment(read);
  await b.loader.update({ id: 'two' });
  assert.equal(b.applied.at(-1), a.applied.at(-1));
  await a.loader.update(null, '');
  assert.equal(a.applied.at(-1), '');
  assert.equal(a.fonts.size, 0);
  b.loader.dispose();
  assert.equal(b.fonts.size, 0);
});

test('reset/dispose wins over late font loads; missing or corrupt files fall back cleanly', async () => {
  let finish;
  const a = environment(() => new Promise(resolve => { finish = resolve; }));
  const loading = a.loader.update({ id: 'slow' });
  await a.loader.update(null, 'serif');
  finish({ family: 'Imported_slow', buffer: new ArrayBuffer(2) });
  await loading;
  assert.deepEqual(a.applied, ['serif']);
  assert.equal(a.fonts.size, 0);
  for (const record of [null, { family: 'Imported_invalid', buffer: 'invalid' }]) {
    const b = environment(async () => record);
    await b.loader.update({ id: 'bad' }, 'sans-serif');
    assert.deepEqual(b.applied, ['sans-serif']);
    assert.equal(b.errors.length, 1);
  }
});

test('unsupported or oversized font files never reach storage or font decoding', async () => {
  await assert.rejects(importPlayerFont({ name: 'not-font.txt', size: 10 }), /FONT_FORMAT/);
  await assert.rejects(importPlayerFont({ name: 'huge.ttf', size: 65 * 1024 * 1024 }), /FONT_SIZE/);
  await assert.rejects(importPlayerFont({ name: 'empty.woff2', size: 0 }), /FONT_SIZE/);
});
