import test from 'node:test';
import assert from 'node:assert/strict';
import { enemyStatusChance, statModifier } from '../js/battle.js';

const data = { balance: { battle_formulas: {} }, basicJobRules: { caps: { stat_buff: 1, stat_debuff: .5 } } };
test('能力強化と弱体は独立した上限を適用する', () => {
  assert.equal(statModifier(data, 2, .2), 1.8);
  assert.equal(statModifier(data, 0, 2), .5);
  assert.equal(statModifier(data, 0, 2, true), .7);
});
test('状態異常相性・ボス免疫・付与率上限', () => {
  assert.equal(enemyStatusChance(data, {statusAffinity:{statdown:'×'}}, 1, 'statdown', 1), 0);
  assert.equal(enemyStatusChance(data, {statusAffinity:{poison:'★'}}, 1, 'poison', 1), .95);
  assert.equal(enemyStatusChance(data, {boss:true}, 1, 'petrify', 1, true), 0);
  assert.equal(enemyStatusChance(data, {boss:true}, 1, 'statdown', 1), .75);
  assert.equal(enemyStatusChance(data, {boss:true,controlGuardUntil:2}, 2, 'sleep', 1, true), 0);
});
