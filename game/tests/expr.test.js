import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, isFormula } from '../js/expr.js';
import { readJson } from './helpers.js';

test('四則・べき乗・かっこ・関数', () => {
  assert.equal(evaluate('70 + g*30 + (Lv-1)*g*9', { g: 3, Lv: 1 }), 160);
  assert.equal(evaluate('25 * Lv^1.5', { Lv: 4 }), 200);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('max(0, 1 - 0.25*x)', { x: 8 }), 0);
  assert.equal(evaluate('a.b * 強化値', { 'a.b': 2, 強化値: 3 }), 6);
});

test('読めない式・変数がないときは例外', () => {
  assert.throws(() => evaluate('1 +'));
  assert.throws(() => evaluate('x * 2', {}));
  assert.throws(() => evaluate('evil(1)'));
  assert.equal(isFormula('(8 + 1.6*itemLv) * quality(作った装備1.15)'), false);
});

test('balance.json の能力値の式が読める', () => {
  const p = readJson('balance.json').player;
  for (const k of ['hp', 'other_stats', 'mp', 'xp_to_next']) assert.ok(isFormula(p[k]), k);
  assert.ok(isFormula(readJson('balance.json').armor_value));
});
