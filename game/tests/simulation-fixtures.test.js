// 新マスターの比較条件を、実ゲームの育成・装備APIで組み立てる。
import test from 'node:test';
import assert from 'node:assert/strict';
import { canEquip, maxHp, maxMp } from '../js/character.js';
import { capacity, usedCapacity, learnedSkillLevel, isLearned } from '../js/growth.js';
import { data, formations, buildParty } from '../verification/jobs-master/measure.mjs';

test('比較編成は合法な6人・装備・容量・修得前提を守る', () => {
  for (const formation of formations) {
    const game = buildParty(formation.jobs, { level: 8, itemLevel: 10, apBudget: 120 });
    assert.equal(game.party.length, 6);
    for (const member of game.party) {
      assert.equal(member.lv, 8);
      assert.equal(member.hp, maxHp(data, member));
      assert.equal(member.mp, maxMp(data, member));
      const cap = capacity(data, member), used = usedCapacity(data, member);
      assert.ok(used.actions <= cap.actions && used.passives <= cap.passives);
      for (const id of member.learned) {
        const skill = data.skills.get(id);
        assert.ok(skill.effect.master);
        for (const prerequisite of skill.effect.prerequisites) {
          assert.ok(learnedSkillLevel(member, data.skills.get(prerequisite.id)) >= prerequisite.level);
        }
      }
      for (const id of [...member.loadout.actions, ...member.loadout.passives]) {
        assert.ok(isLearned(member, data.skills.get(id)));
      }
      for (const [slot, gear] of Object.entries(member.equip)) if (gear) {
        assert.equal(canEquip(data, member, slot, gear).ok, true, `${formation.id}/${member.job}/${slot}`);
        assert.ok(data.equipment.get(gear.id).itemLv <= 10);
        assert.equal(data.equipment.get(gear.id).unique, false);
        assert.ok(!data.equipment.get(gear.id).setId);
      }
    }
  }
});

test('比較予算はAP費用を実際に払い、Lv強化分を含めて残高と一致する', () => {
  for (const formation of formations) {
    const game = buildParty(formation.jobs, { level: 8, itemLevel: 10, apBudget: 300, skillLevel: 3 });
    for (const member of game.party) {
      const spent = member.learned.reduce((sum, id) => {
        const skill = data.skills.get(id), level = learnedSkillLevel(member, skill);
        return sum + skill.apToLearn + skill.effect.levels.slice(0, level - 1).reduce((total, upgrade) => total + upgrade.ap, 0);
      }, 0);
      assert.equal(member.ap, 300 - spent);
      assert.ok(member.ap >= 0);
    }
  }
});

test('同じ比較条件は同じ装備・技能・AP残高で再現できる', () => {
  const options = { level: 8, itemLevel: 10, apBudget: 120 };
  for (const formation of formations) {
    const first = buildParty(formation.jobs, options), second = buildParty(formation.jobs, options);
    assert.deepEqual(first, second);
  }
});

test('少ないAPの比較編成も無償技能を捏造せず残高内で組み立てる', () => {
  const game = buildParty(formations[0].jobs, { level: 1, itemLevel: 3, apBudget: 30 });
  for (const member of game.party) {
    const spent = member.learned.reduce((sum, id) => sum + data.skills.get(id).apToLearn, 0);
    assert.equal(member.ap, 30 - spent);
    assert.ok(spent <= 30);
    assert.equal(member.loadout.ultimate, null);
  }
});
