import test from 'node:test';
import assert from 'node:assert/strict';
import { battleConditionLabels } from '../js/ui/battle-view.js';
import { readCsv } from './helpers.js';

const data = { statusEffects: new Map(readCsv('status_effects.csv').rows.map((row) => [row.id, row])) };

test('戦闘の状態表示に障壁の残りHPと次の技能強化を含め、戦闘状態を変更しない', () => {
  const unit = { hp: 80, statuses: { poison: { turns: 2 } }, buffs: { barrier: [42, 3], str: [.2, 2] }, normalSkillReady: true };
  const before = structuredClone(unit);
  const labels = battleConditionLabels(data, unit);
  assert.deepEqual(labels, ['毒', '障壁 42 HP', '次の攻撃技能を強化']);
  assert.ok(!labels.some((label) => label.includes('%')));
  assert.deepEqual(unit, before);
});

test('障壁を消費し終えた時・効果終了時・戦闘不能時は有効な障壁として表示しない', () => {
  for (const barrier of [[0, 2], [-5, 2], [42, 0], [42, -1], [NaN, 2]]) {
    assert.deepEqual(battleConditionLabels(data, { hp: 80, statuses: {}, buffs: { barrier } }), []);
  }
  assert.deepEqual(battleConditionLabels(data, { hp: 0, statuses: {}, buffs: { barrier: [42, 3] }, normalSkillReady: true }), []);
  assert.deepEqual(battleConditionLabels(data, { statuses: {} }), []);
});

test('準備効果が消えたら技能強化表示も消え、既存の状態異常名は残る', () => {
  assert.deepEqual(battleConditionLabels(data, { hp: 80, statuses: { silence: {}, blind: {} }, buffs: {}, normalSkillReady: false }), ['沈黙', '暗闇']);
  assert.deepEqual(battleConditionLabels(data, { hp: 0, statuses: { curse: {} }, buffs: { barrier: [42, 3] } }), ['呪い']);
});
