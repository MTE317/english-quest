import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCsvRecords, splitList, parseAmounts, stripBom, toValue } from '../js/csv.js';
import { readFileSync } from 'node:fs';
import { dataPath, readCsv, readJson } from './helpers.js';

const DATA_FILES = readJson('manifest.json');

test('BOM を取り除く（なくても読める）', () => {
  assert.equal(parseCsv('id,a\nx,1').rows[0].id, 'x');
  assert.equal(stripBom('﻿id,a'), 'id,a');
  const { header } = parseCsv('﻿id,name\r\nx,y\r\n');
  assert.deepEqual(header, ['id', 'name']);
});

test('引用符・"" のエスケープ・セル内のカンマと改行・CRLF', () => {
  const recs = parseCsvRecords('a,b\r\n1,"x,""y""\nz"\r\n\r\n2,\n');
  assert.deepEqual(recs, [['a', 'b'], ['1', 'x,"y"\nz'], ['2', '']]);
});

test('列の数が合わない行はエラーにする', () => {
  const { errors, rows } = parseCsv('id,a,b\nx,1\n');
  assert.equal(rows.length, 1);
  assert.match(errors[0], /2行目/);
});

test('| 区切りと 素材ID:個数', () => {
  assert.deepEqual(splitList('fire|slash'), ['fire', 'slash']);
  assert.deepEqual(splitList(''), []);
  assert.deepEqual(parseAmounts('goblin_mat:2|cave_rat_mat:2'), [
    { id: 'goblin_mat', count: 2 }, { id: 'cave_rat_mat', count: 2 }]);
  assert.deepEqual(parseAmounts('x'), [{ id: 'x', count: 1 }]);
  assert.throws(() => parseAmounts('x:abc'));
});

test('toValue', () => {
  assert.equal(toValue('1.5'), 1.5);
  assert.equal(toValue(''), null);
  assert.equal(toValue('rs_1_001'), 'rs_1_001');
});

test('manifest.json のファイルがすべて読めて、列の数がそろっている', () => {
  for (const name of DATA_FILES) {
    if (name.endsWith('.json')) { readJson(name); continue; }
    if (name.endsWith('.csv') && !name.startsWith('learning/v1/')) {
      assert.equal(readFileSync(dataPath(name), 'utf8').charCodeAt(0), 0xfeff, `${name} は BOM つきのはず`);
    }
    const { header, rows, errors } = readCsv(name);
    assert.deepEqual(errors, [], name);
    assert.ok(rows.length > 0, name);
    assert.match(header[0], /^[a-z_]+$/, `${name} の1列目は英字の ID`);
  }
});

test('skills.csv の effect_json（"" を含む）が JSON として読める', () => {
  const { rows } = readCsv('skills.csv');
  for (const r of rows) if (r.effect_json) JSON.parse(r.effect_json);
});

test('recipes.csv の素材が分解できる', () => {
  const { rows } = readCsv('recipes.csv');
  for (const r of rows) for (const a of parseAmounts(r.materials)) assert.ok(a.count > 0);
});
