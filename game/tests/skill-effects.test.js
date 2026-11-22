import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { describeSkillEffect } from '../js/skill-effects.js';
import { learnBlock, skillPrerequisite } from '../js/growth.js';
import { createNewGame } from '../js/game-state.js';

const data = realGameData();

test('追加8技能の状態異常・基礎付与率と攻撃の属性・倍率を説明する', () => {
  const expected = [
    ['apothecary_p3_s1', ['猛毒', '70%', '敵一体']],
    ['monk_p4_s1', ['麻痺', '45%', '雷属性', '1.2倍', '物理攻撃']],
    ['spellblade_p3_s1', ['凍結', '35%', '氷属性', '1.2倍', '武器依存']],
    ['spellblade_p3_s2', ['火傷', '60%', '炎属性', '1.2倍', '武器依存']],
    ['hexer_p3_s1', ['沈黙', '70%', '魔法']],
    ['hexer_p3_s2', ['能力ダウン', '60%', '魔法']],
    ['thief_p4_s1', ['暗闇', '55%', '武器の属性', '1.1倍']],
    ['thief_p4_s2', ['睡眠', '60%', '敵一体']],
  ];
  for (const [id, fragments] of expected) {
    const text = describeSkillEffect(data, data.skills.get(id));
    for (const fragment of fragments) assert.ok(text.includes(fragment), `${id}: ${fragment}`);
    assert.match(text, /基礎付与率/);
    assert.match(text, /補正や耐性で変化/);
  }
});

test('新しい2段目の前提は習得判定と同じ技能を参照する', () => {
  const game = createNewGame(data, ['spellblade', 'knight', 'black_mage', 'white_mage']
    .map((job) => ({ job, name: job, icon: 'x' })));
  const member = game.party[0];
  member.ap.spellblade = 100;
  const frost = data.skills.get('spellblade_p3_s1');
  const burn = data.skills.get('spellblade_p3_s2');
  assert.equal(skillPrerequisite(data, frost), undefined);
  assert.equal(skillPrerequisite(data, burn).id, frost.id);
  assert.equal(burn.stage, 2);
  assert.equal(burn.apToLearn, 12);
  assert.match(learnBlock(data, member, burn), /霜刃/);
  member.learned.push(frost.id);
  assert.equal(learnBlock(data, member, burn), '');
});

test('既存技能も対象・連撃・回復・パッシブ・治療対象を日本語で説明する', () => {
  assert.match(describeSkillEffect(data, data.skills.get('monk_p1_s3')), /4連撃/);
  assert.match(describeSkillEffect(data, data.skills.get('white_mage_p1_s3')), /味方全員のHPを回復/);
  assert.match(describeSkillEffect(data, data.skills.get('warrior_p2_s2')), /最大HP \+10%/);
  assert.match(describeSkillEffect(data, data.skills.get('common_mana_afterglow')), /戦闘後に最大MPの10%を回復/);
  const dance = describeSkillEffect(data, data.skills.get('dancer_p1_s3'));
  assert.match(dance, /味方全員/);
  for (const condition of ['毒', '睡眠', '沈黙']) assert.ok(dance.includes(condition));
  for (const condition of ['呪い', '石化', '衰弱']) assert.ok(!dance.includes(condition));
  for (const skill of data.skills.values()) {
    const text = describeSkillEffect(data, skill);
    assert.doesNotMatch(text, /undefined|NaN|説明はありません|状態異常なし/, skill.id);
  }
});
