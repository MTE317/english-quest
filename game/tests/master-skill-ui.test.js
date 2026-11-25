import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSkillEffect } from '../js/skill-effects.js';
import { skillCategory, skillLoadoutKind, equippedSkillIds, isSkillEquipped, skillCostLabel, skillWeaponText, prerequisiteText, jobProfileRows, ultimateGauge } from '../js/ui/skill-presentation.js';

test('奥義は元の攻撃・回復種別に関わらず専用の分類と装備枠で表示する', () => {
  for (const kind of ['attack', 'heal_all', 'party_buff']) {
    const skill = { id: 'job_U01', kind, isFinal: true, cost: 0 };
    const member = { loadout: { actions: ['attack'], passives: [], ultimate: skill.id } };
    assert.equal(skillCategory(skill), '奥義');
    assert.equal(skillLoadoutKind(skill), 'ultimate');
    assert.equal(skillCostLabel(skill), '奥義専用枠');
    assert.deepEqual(equippedSkillIds(member, 'ultimate'), ['job_U01']);
    assert.equal(isSkillEquipped(member, skill), true);
    assert.equal(isSkillEquipped({ loadout: { ...member.loadout, ultimate: null } }, skill), false);
  }
});

test('回復・治療と防御・支援を分け、調査・妨害も開閉可能な分類に含める', () => {
  for (const kind of ['heal', 'heal_all', 'revive', 'cure', 'cure_all', 'mp_give']) assert.equal(skillCategory({ kind }), '回復・治療');
  for (const kind of ['self_buff', 'party_buff', 'ally_buff']) assert.equal(skillCategory({ kind }), '防御・支援');
  for (const kind of ['utility', 'status', 'debuff']) assert.equal(skillCategory({ kind }), '妨害・調査');
  assert.equal(skillCategory({ kind: 'passive' }), 'パッシブ');
});

test('複数の前提レベルと奥義の種類数を正しく案内し、強化回数を種類数に数えない', () => {
  const first = { id: 'first', name: '発勁', job: 'monk' };
  const second = { id: 'second', name: '連打', job: 'monk' };
  const ultimate = { id: 'monk_U01', name: '百裂天衝', job: 'monk', isFinal: true,
    effect: { prerequisites: [{ id: 'first', level: 2 }, { id: 'second', level: 2 }] } };
  const data = { skills: new Map([first, second, ultimate].map(skill => [skill.id, skill])) };
  const member = { learned: ['first', 'second'], skillLevels: { first: 5, second: 1 } };
  assert.equal(prerequisiteText(data, member, ultimate), '同職の非奥義10種類（2/10）・発勁 Lv2（達成）・連打 Lv2（現在Lv1）');
});

test('マスター技能の説明はLvごとの対象・治療範囲・条件を省略せず表示する', () => {
  const description = '味方1人の恐怖・混乱を解除する。戦闘不能や石化には作用しない。';
  assert.equal(describeSkillEffect({}, { kind: 'cure', effect: { master: true, description } }), description);
  const upgraded = '生存味方全員の恐怖・混乱を解除する。戦闘不能や石化には作用しない。';
  assert.equal(describeSkillEffect({}, { kind: 'cure', effect: { master: true, description: upgraded } }), upgraded);
});

test('奥義ゲージは設定上限を使い、旧セーブの欠損や不正値でも表示が崩れない', () => {
  const data = { basicJobRules: { ultimate: { gauge_max: 150 } } };
  assert.deepEqual(ultimateGauge(data, { ultimateGauge: 75 }), { value: 75, max: 150, percent: 50, ready: false });
  assert.deepEqual(ultimateGauge(data, { ultimateGauge: 900 }), { value: 150, max: 150, percent: 100, ready: true });
  for (const value of [-5, NaN, undefined]) assert.deepEqual(ultimateGauge(data, { ultimateGauge: value }), { value: 0, max: 150, percent: 0, ready: false });
});

test('現在職の武器・属性情報を表示し、補助属性なしを無属性と混同しない', () => {
  const data = { weaponTypes: new Map([['sword', { name: '剣' }], ['axe', { name: '斧' }]]), elements: new Map([['slash', { name: '斬撃' }]]) };
  const job = { role: '汎用物理', sWeapons: ['sword'], aWeapons: ['axe'], elements: ['slash'], supportElements: [], style: '戦技を使い分ける' };
  assert.deepEqual(jobProfileRows(data, job), [['役割', '汎用物理'], ['得意武器S', '剣'], ['得意武器A', '斧'], ['主力属性', '斬撃'], ['補助属性', '―'], ['戦い方', '戦技を使い分ける']]);
});

test('継承技能の武器条件は素手と装備武器を区別して表示する', () => {
  const data = { weaponTypes: new Map([['fist', { name: '拳' }], ['sword', { name: '剣' }]]) };
  assert.equal(skillWeaponText(data, { effect: { weapons: ['unarmed', 'fist'] } }), '素手・拳');
  assert.equal(skillWeaponText(data, { effect: { require_weapon: 'sword' } }), '剣');
  assert.equal(skillWeaponText(data, { effect: { weapons: [] } }), '条件なし');
});
