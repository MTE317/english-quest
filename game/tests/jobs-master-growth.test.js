import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { makeGear, maxHp, maxMp } from '../js/character.js';
import {
  jobSkills, learnBlock, learnSkill, upgradeSkill, effectiveSkill, learnedSkillLevel,
  usedSkillLevel, memberMods, capacity, usedCapacity, equipSkill, unequipSkill,
  equipBlock, ultimateSkill, actionSkills, changeJob, availableJobs, skillWeaponBlock,
} from '../js/growth.js';

const data = realGameData();
const specs = ['warrior', 'knight', 'monk', 'hunter', 'black_mage', 'white_mage']
  .map((job) => ({ job, name: job, icon: 'x' }));
const fresh = () => createNewGame(data, specs);

test('新しい冒険は全員無装備・自動修得なし。初期APを用意し、装備は配給しない', () => {
  const game = fresh();
  assert.equal(game.party.length, 6);
  for (const member of game.party) {
    assert.ok(Object.values(member.equip).every((gear) => gear === null));
    assert.deepEqual(member.learned, []);
    assert.equal(member.ap, data.basicJobRules.starting_ap);
    assert.equal(member.ultimateGauge, 0);
  }
  assert.equal(game.storage.gear.length, 0);
  const count = game.storage.gear.length;
  normalizeGame(data, game);
  assert.equal(game.storage.gear.length, count);
});

test('技能の強化は最高修得Lvへ即反映し、装備コストを変えない', () => {
  const member = fresh().party[4];
  const skill = data.skills.get('black_mage_A01');
  member.ap = 10000;
  learnSkill(data, member, skill.id);
  equipSkill(data, member, skill.id);
  const before = usedCapacity(data, member);
  for (let n = 0; n < 4; n += 1) upgradeSkill(data, member, skill.id);
  assert.equal(learnedSkillLevel(member, skill), 5);
  assert.equal(usedSkillLevel(member, skill), 5);
  assert.equal(effectiveSkill(data, member, skill).effect.description, skill.effect.levels[3].effect.description);
  assert.equal(effectiveSkill(data, member, skill).mp, skill.mp);
  assert.deepEqual(usedCapacity(data, member), before);
});

test('前提は技能の種類と必要Lvを判定する', () => {
  const member = fresh().party[0];
  member.ap = 10000;
  const starter = data.skills.get('warrior_A01');
  const follow = data.skills.get('warrior_A02');
  assert.match(learnBlock(data, member, follow), /Lv2/);
  learnSkill(data, member, starter.id);
  assert.match(learnBlock(data, member, follow), /Lv2/);
  upgradeSkill(data, member, starter.id);
  assert.equal(learnBlock(data, member, follow), '');
});

test('パッシブも強化したLvを使い、マスター記録だけでは常時能力を増やさない', () => {
  const member = fresh().party[0];
  member.ap = 10000;
  const skill = data.skills.get('warrior_P02');
  learnSkill(data, member, skill.id);
  equipSkill(data, member, skill.id);
  const first = memberMods(data, member).str;
  upgradeSkill(data, member, skill.id);
  assert.ok(memberMods(data, member).str > first);
  unequipSkill(member, skill.id);
  member.masteredJobs = data.jobs.map((job) => job.id);
  assert.equal(memberMods(data, member).str ?? 0, 0);
});

test('奥義は非奥義10種類で解禁し、別枠1つを他職へ継承できる', () => {
  const game = fresh();
  const member = game.party[0];
  const skills = jobSkills(data, 'warrior').filter((skill) => !skill.isFinal);
  const ultimate = data.skills.get('warrior_U01');
  member.ap = 10000;
  member.learned = [skills[0].id];
  member.skillLevels = { [skills[0].id]: 5 };
  assert.match(learnBlock(data, member, ultimate), /1\/10/);
  member.learned = skills.slice(0, 9).map((skill) => skill.id);
  assert.match(learnBlock(data, member, ultimate), /9\/10/);
  member.learned.push(skills[9].id);
  assert.equal(learnBlock(data, member, ultimate), '');
  learnSkill(data, member, ultimate.id);
  const before = usedCapacity(data, member);
  equipSkill(data, member, ultimate.id);
  assert.deepEqual(usedCapacity(data, member), before);
  assert.equal(ultimateSkill(data, member).id, ultimate.id);
  assert.ok(!actionSkills(data, member).some((skill) => skill.isFinal));
  const other = data.skills.get('knight_U01');
  member.learned.push(other.id);
  assert.match(equipBlock(data, member, other), /1つ/);
  changeJob(data, game, 0, 'knight');
  assert.equal(member.loadout.ultimate, ultimate.id);
  assert.equal(ultimateSkill(data, member).id, ultimate.id);
  assert.ok(usedCapacity(data, member).actions <= capacity(data, member).actions);
});

test('武器条件は現職でなく現在の主武器を見て判定する', () => {
  const game = fresh();
  const member = game.party[1];
  const skill = data.skills.get('warrior_A01');
  assert.ok(skillWeaponBlock(data, member, skill));
  member.equip.weapon = makeGear(game, 'sword_t1');
  assert.equal(skillWeaponBlock(data, member, skill), '');
  assert.equal(skillWeaponBlock(data, game.party[2], data.skills.get('monk_A01')), '');
});

test('技能準備中の36職は解放記録があっても転職できない', () => {
  const game = fresh();
  game.unlockedJobs = data.jobs.map((job) => job.id);
  assert.equal(availableJobs(data, game).length, 14);
  const pending = data.jobs.find((job) => job.skillsReady === false);
  assert.ok(pending);
  assert.throws(() => changeJob(data, game, 0, pending.id), /選べない/);
});

test('保存した専用奥義枠の選択は、旧形式の通常枠に混ざった別奥義より優先する', () => {
  const member = fresh().party[0];
  member.learned = ['warrior_U01', 'knight_U01'];
  member.loadout = { actions: ['warrior_U01'], passives: [], ultimate: 'knight_U01' };
  assert.equal(ultimateSkill(data, member).id, 'knight_U01');
  assert.deepEqual(member.loadout.actions, []);
});

test('旧技能のAP返還は本人と遠征前の写しで各1度。所持品と発見記録を維持する', () => {
  const game = fresh();
  const member = game.party[0];
  const old = data.skillMigration.retired_skills.find((skill) => skill.levels.length >= 2);
  assert.ok(old);
  member.job = 'stormcaster';
  member.visitedJobs = ['stormcaster'];
  delete member.jobMasterVersion;
  member.ap = 100;
  member.learned = [old.id];
  member.skillLevels = { [old.id]: 3 };
  member.skillUseLevels = { [old.id]: 1 };
  member.loadout = { actions: [old.id], passives: [] };
  member.masteredJobs = ['stormcaster'];
  game.unlockedJobs = ['stormcaster', 'elementalist'];
  game.monsterKnowledge = { slime: { encounters: 2 } };
  game.storage.materials.iron = 3;
  const originalGear = structuredClone(game.storage.gear);
  const run = {
    snapshot: structuredClone(game),
    battle: { turn: { i: 0 }, pending: { action: { type: 'skill', skillId: old.id } } },
  };
  const expected = 100 + old.ap + old.levels[0].ap + old.levels[1].ap;
  normalizeGame(data, game, run);
  assert.equal(member.ap, expected);
  assert.equal(run.snapshot.party[0].ap, expected);
  assert.equal(member.job, 'black_mage');
  assert.deepEqual(member.learned, []);
  assert.equal(member.skillUseLevels, undefined);
  assert.equal(run.battle.pending, null);
  assert.deepEqual(run.battle.turn, { i: 0 });
  assert.deepEqual(game.storage.gear, originalGear);
  assert.equal(game.storage.materials.iron, 3);
  assert.deepEqual(game.monsterKnowledge, { slime: { encounters: 2 } });
  assert.ok(game.legacyUnlockedJobs.includes('stormcaster'));
  normalizeGame(data, game, run);
  normalizeGame(data, run.snapshot);
  assert.equal(member.ap, expected);
  assert.equal(run.snapshot.party[0].ap, expected);
});

test('旧職の移行で低下した上限へ本人だけを切り詰め、HP0を回復しない', () => {
  const game = fresh();
  const member = game.party[0];
  member.job = 'stormcaster';
  member.hp = 1000000;
  member.mp = 1000000;
  delete member.jobMasterVersion;
  const fallen = game.party[1];
  fallen.job = 'venomist';
  fallen.hp = 0;
  fallen.mp = 1;
  delete fallen.jobMasterVersion;
  const unaffected = game.party[2];
  unaffected.hp = 1000000;
  const run = { snapshot: structuredClone(game) };
  normalizeGame(data, game, run);
  assert.equal(member.hp, maxHp(data, member));
  assert.equal(member.mp, maxMp(data, member));
  assert.equal(fallen.hp, 0);
  assert.equal(fallen.mp, 1);
  assert.equal(unaffected.hp, 1000000);
  assert.equal(run.snapshot.party[0].hp, maxHp(data, run.snapshot.party[0]));
  assert.equal(run.snapshot.party[0].mp, maxMp(data, run.snapshot.party[0]));
  assert.equal(run.snapshot.party[1].hp, 0);
});
