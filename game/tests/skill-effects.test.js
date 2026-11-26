import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { describeSkillEffect } from '../js/skill-effects.js';
import { learnBlock, skillPrerequisite, effectiveSkill } from '../js/growth.js';
import { createNewGame } from '../js/game-state.js';
import { prerequisiteText } from '../js/ui/skill-presentation.js';

const data = realGameData();

test('基本職技能の説明に属性・倍率・基礎率と適用条件を残す', () => {
  const expected = [
    ['monk_A07', ['封印', '45%', '攻撃ダメージはない', '耐性・免疫・ボス補正']],
    ['thief_A03', ['敵全体', '暗闇', '35%']],
    ['hunter_A08', ['獣', '35%', '1回だけ適用', '基本攻撃は成立']],
    ['black_mage_A04', ['炎属性', 'MAG', '0.65倍', '火傷', '20%', '同じ攻撃の条件特効に使わない']],
    ['warrior_A02', ['2体', '0.75倍', '武器に従う', '追加の英語回答は発生しない']],
  ];
  for (const [id, fragments] of expected) {
    const text = describeSkillEffect(data, data.skills.get(id));
    for (const fragment of fragments) assert.ok(text.includes(fragment), `${id}: ${fragment}`);
  }
});

test('習得画面の前提表示が必要Lvと習得判定に一致する', () => {
  const game = createNewGame(data, ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
    .map(job => ({ job, name: job, icon: 'x' })));
  const member = game.party[0];
  member.ap = 100;
  const first = data.skills.get('warrior_A01');
  const sweep = data.skills.get('warrior_A02');
  assert.equal(skillPrerequisite(data, first), undefined);
  assert.equal(skillPrerequisite(data, sweep).id, first.id);
  assert.match(learnBlock(data, member, sweep), /剛断ち.*Lv2/);
  member.learned.push(first.id);
  member.skillLevels = { [first.id]: 1 };
  assert.match(prerequisiteText(data, member, sweep), /剛断ち Lv2（現在Lv1）/);
  assert.match(learnBlock(data, member, sweep), /Lv2/);
  member.skillLevels[first.id] = 2;
  assert.match(prerequisiteText(data, member, sweep), /剛断ち Lv2（達成）/);
  assert.equal(learnBlock(data, member, sweep), '');
});

test('治療・蘇生・歌の説明は対象と例外を区別する', () => {
  const cure = describeSkillEffect(data, data.skills.get('white_mage_A03'));
  assert.match(cure, /味方1人/);
  assert.match(cure, /毒・睡眠・暗闇/);
  assert.match(cure, /石化中の味方には使用できない/);
  const sanctuary = describeSkillEffect(data, data.skills.get('white_mage_U01'));
  assert.match(sanctuary, /指定した1人だけ/);
  assert.match(sanctuary, /全体回復・治療は重ねて適用しない/);
  assert.match(describeSkillEffect(data, data.skills.get('bard_A01')), /別曲なら.*併用できる/);
  assert.match(describeSkillEffect(data, data.skills.get('bard_P01')), /奥義.*には適用しない/);
});

test('基本8職の全396段階が修得最高Lvの説明を表示できる', () => {
  const skills = [...data.skills.values()].filter(skill => skill.effect.master && data.jobsById.get(skill.job)?.tier === 'base');
  assert.equal(skills.length, 120);
  for (const skill of skills) for (let level = 1; level <= 1+skill.effect.levels.length; level += 1) {
    const member = { learned: [skill.id], skillLevels: { [skill.id]: level }, skillUseLevels: { [skill.id]: 1 } };
    const effective = effectiveSkill(data, member, skill);
    const text = describeSkillEffect(data, effective);
    assert.equal(text, level === 1 ? skill.effect.description : skill.effect.levels[level - 2].effect.description, `${skill.id} Lv${level}`);
    assert.doesNotMatch(text, /undefined|NaN|説明はありません/, `${skill.id} Lv${level}`);
  }
});
