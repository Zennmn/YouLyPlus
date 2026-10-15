import test from 'node:test';
import assert from 'node:assert/strict';
import { playerFontFamily } from '../src/lib/playerFont.js';

test('font names and fallbacks stay literal, with Chinese commas and quoted names supported', () => {
  assert.equal(playerFontFamily('Microsoft YaHei, sans-serif'), '"Microsoft YaHei", sans-serif');
  assert.equal(playerFontFamily(' "思源宋体"， SimSun , serif '), '"思源宋体", "SimSun", serif');
  assert.equal(playerFontFamily(''), '');
  assert.equal(playerFontFamily(null), '');
});

test('font field cannot introduce CSS declarations and invalid families reset to default', () => {
  assert.equal(playerFontFamily('Arial; color:red'), '');
  assert.equal(playerFontFamily('x}\nbody{display:none'), '');
  assert.equal(playerFontFamily('Missing Font, Arial'), '"Missing Font", "Arial"');
});
