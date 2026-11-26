import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SKILL_UI_TEXT, skillUIMessage } from '../js/skill-ui-text.js';
import { describeSkillForUI, describeSkillEffect } from '../js/skill-effects.js';
import { effectiveSkill } from '../js/growth.js';
import { realGameData } from './helpers.js';

const readSpec = name => JSON.parse(readFileSync(new URL('../../docs/specs/' + name, import.meta.url), 'utf8'));
const basic = readSpec('basic-job-skill-ui-text-v1.json');
const advanced = readSpec('additional-jobs-01-03-redesign-v2.json');

test('基本8職と追加3職の承認済み簡素説明を全レベルで表示する', () => {
  let count = 0;
  for (const job of basic.jobs) for (const skill of job.skills) {
    count++;
    for (let level = 1; level <= skill.max_level; level++)
      assert.equal(skillUIMessage({ id: skill.id }, level),
        skill.level_overrides?.[level] ?? skill.description, skill.id + ' Lv' + level);
  }
  for (const job of advanced.jobs) for (const skill of job.skills) {
    count++;
    skill.simpleDescriptions.forEach((text, i) =>
      assert.equal(skillUIMessage({ id: skill.id }, i + 1), text, skill.id + ' Lv' + (i + 1)));
  }
  assert.equal(count, 165);
  assert.equal(Object.keys(SKILL_UI_TEXT).length, count);
});

test('剛断ちは簡素説明を表示し、詳細説明と戦闘効果は保持する', () => {
  const skill = { id: 'warrior_A01', kind: 'attack',
    effect: { description: '敵単体にSTRと装備武器威力を参照する1.25倍の武器攻撃。', base: 'weapon', m: 1.25 } };
  const original = structuredClone(skill);
  assert.equal(describeSkillForUI({}, skill), '敵1体に強力な武器攻撃。');
  assert.equal(describeSkillEffect({}, skill), original.effect.description);
  assert.deepEqual(skill, original);
});

test('習得レベルと強化後のレベルで対象や条件を正しく切り替える', () => {
  const data = realGameData(), base = data.skills.get('warrior_A02');
  const member = { learned: [base.id], skillLevels: { [base.id]: 2 } };
  const current = effectiveSkill(data, member, base);
  assert.equal(describeSkillForUI(data, current), '敵3体までに武器攻撃。');
  const next = { ...base, effect: { ...base.effect, ...base.effect.levels[1].effect } };
  assert.equal(describeSkillForUI(data, next, 3), '敵全体に武器攻撃。');
  assert.equal(describeSkillForUI(data, base, 0), '敵2体までに武器攻撃。');
  assert.equal(describeSkillForUI(data, { id: 'black_mage_P04' }, 2),
    'MPが半分以上ある間、攻撃で受ける魔法ダメージが減る。');
});

test('文面のない共通技能などは既存説明を表示する', () => {
  const skill = { id: 'common_test', kind: 'passive', effect: { description: '自分の最大MPが上がる。' } };
  assert.equal(skillUIMessage(skill), null);
  assert.equal(describeSkillForUI({}, skill), describeSkillEffect({}, skill));
});
