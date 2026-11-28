import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import {
  learnBlock, learnSkill, isLearned, jobSkills, ensureLoadout, equipBlock, equipSkill,
  unequipSkill, capacity, usedCapacity, actionSkills, learnCommon, commonBlock,
  memberMods, parseBonusText, isJobMastered, masteryLevel, addMasteryKill,
  changeJob, availableJobs, ultimateSkill,
} from '../js/growth.js';
import { computeStats, maxHp, canEquip, makeGear, equipFromStorage, gainXp, weaponPower } from '../js/character.js';
import { realGameData } from './helpers.js';

const data = realGameData();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => createNewGame(data, party);

test('新規開始では入口技能も未修得で、通常枠・奥義枠は空', () => {
  const member = fresh().party[0];
  assert.ok(jobSkills(data, 'warrior').every((skill) => !isLearned(member, skill) && skill.apToLearn > 0));
  assert.deepEqual(actionSkills(data, member), []);
  assert.equal(ultimateSkill(data, member), null);
});

test('旧形式の混在枠を通常・パッシブ・奥義の枠へ分離し重複を取り除く', () => {
  const member = fresh().party[0];
  const active = data.skills.get('warrior_A01');
  const passive = data.skills.get('warrior_P02');
  const ultimate = data.skills.get('warrior_U01');
  member.learned = [active.id, passive.id, ultimate.id];
  member.loadout = { actions: [passive.id, active.id, ultimate.id], passives: [active.id, passive.id, ultimate.id] };
  ensureLoadout(data, member);
  assert.deepEqual(member.loadout, { actions: [active.id], passives: [passive.id], ultimate: ultimate.id });
});

test('同じ職業の仲間でも修得・装着状態を共有せず、修得だけで装着しない', () => {
  const game = createNewGame(data, Array.from({ length: 6 }, (_, i) => ({ name: String(i), job: 'warrior', icon: 'x' })));
  const [first, second] = game.party;
  const passive = data.skills.get('warrior_P02');
  first.ap = passive.apToLearn;
  learnSkill(data, first, passive.id);
  assert.equal(first.ap, 0);
  assert.ok(isLearned(first, passive));
  assert.ok(!isLearned(second, passive));
  assert.ok(!first.loadout.passives.includes(passive.id));
  equipSkill(data, first, passive.id);
  assert.ok(first.loadout.passives.includes(passive.id));
  assert.ok(!second.loadout.passives.includes(passive.id));
});

test('AP不足と前提Lvを区別し、装備したパッシブだけ能力値へ反映する', () => {
  const member = fresh().party[0];
  const passive = data.skills.get('warrior_P02');
  member.ap = 0;
  assert.match(learnBlock(data, member, passive), /AP/);
  member.ap = passive.apToLearn + 3;
  const before = computeStats(data, member).str;
  learnSkill(data, member, passive.id);
  assert.equal(member.ap, 3);
  assert.equal(computeStats(data, member).str, before);
  equipSkill(data, member, passive.id);
  assert.ok(computeStats(data, member).str > before);
  assert.match(learnBlock(data, member, data.skills.get('warrior_A02')), /Lv2/);
});

test('覚えた他職技能と奥義を持ち出せ、通常容量と奥義1枠は別に管理する', () => {
  const member = fresh().party[0];
  const fire = data.skills.get('black_mage_A01');
  assert.equal(equipBlock(data, member, fire), '覚えていない');
  member.visitedJobs.push('black_mage');
  member.ap = fire.apToLearn;
  learnSkill(data, member, fire.id);
  equipSkill(data, member, fire.id);
  assert.ok(actionSkills(data, member).some((skill) => skill.id === fire.id));
  const ultimate = data.skills.get('black_mage_U01');
  member.learned.push(ultimate.id);
  const used = usedCapacity(data, member);
  equipSkill(data, member, ultimate.id);
  assert.equal(ultimateSkill(data, member).id, ultimate.id);
  assert.deepEqual(usedCapacity(data, member), used);
  unequipSkill(member, fire.id);
  assert.deepEqual(actionSkills(data, member), []);
  assert.ok(usedCapacity(data, member).actions <= capacity(data, member).actions);
});

test('共通ツリーはレベルと共通APを使い、強化と容量を増やす', () => {
  const member = fresh().party[0];
  const node = data.commonTree.find((entry) => entry.id === 'vit1');
  assert.match(commonBlock(data, member, node), /Lv/);
  gainXp(data, member, 1e6);
  member.ap = 100;
  const hp = maxHp(data, member);
  const cap = capacity(data, member);
  learnCommon(data, member, 'vit1');
  assert.equal(maxHp(data, member), Math.round(hp * 1.05));
  learnCommon(data, member, 'cap1');
  assert.equal(capacity(data, member).actions, cap.actions + 1);
  assert.deepEqual(parseBonusText('戦闘が終わったときMP最大の10%回復'), { mp_regen: 0.1 });
  assert.deepEqual(parseBonusText('STRとMAG+2%'), { str: 0.02, mag: 0.02 });
  assert.deepEqual(parseBonusText('会心率+2%'), { crt: 0.02 });
});

test('全技能修得はマスター判定になるが、枠外の常時能力報酬は発生しない', () => {
  const member = fresh().party[0];
  const before = computeStats(data, member).str;
  member.learned = jobSkills(data, 'warrior').map((skill) => skill.id);
  assert.ok(isJobMastered(data, member, 'warrior'));
  assert.equal(memberMods(data, member).str ?? 0, 0);
  assert.equal(computeStats(data, member).str, before);
});

test('武器熟練度は装備条件にせず、30討伐ごとの威力補正と最大値を保つ', () => {
  const game = fresh();
  const member = game.party[0];
  const top = makeGear(game, 'sword_t24');
  assert.equal(masteryLevel(data, member, 'sword'), 0);
  assert.equal(canEquip(data, member, 'weapon', top).ok, true);
  game.storage.gear.push(top);
  equipFromStorage(data, game, member, 'weapon', top.uid);
  const before = weaponPower(data, member, member.equip.weapon);
  for (let n = 0; n < 60; n += 1) addMasteryKill(data, member);
  assert.equal(masteryLevel(data, member, 'sword'), 2);
  assert.ok(Math.abs(weaponPower(data, member, member.equip.weapon) / before - 1.04) < 1e-9);
  for (let n = 0; n < 300; n += 1) addMasteryKill(data, member);
  assert.equal(masteryLevel(data, member, 'sword'), 10);
  assert.ok(Math.abs(weaponPower(data, member, member.equip.weapon) / before - 1.2) < 1e-9);
});

test('基本職への転職は無料で武器を保持し、技能準備中の伝説職は選べない', () => {
  const game = fresh();
  const member = game.party[0];
  member.equip.weapon = makeGear(game, 'sword_t1');
  const gold = game.gold;
  changeJob(data, game, 0, 'black_mage');
  assert.equal(member.job, 'black_mage');
  assert.equal(member.equip.weapon.id, 'sword_t1');
  assert.equal(game.gold, gold);
  assert.deepEqual(member.learned, []);
  game.unlockedJobs = ['sage'];
  assert.ok(!availableJobs(data, game).some(job=>job.id==='sage'));
  assert.throws(() => changeJob(data, game, 0, 'sage'), /選べない/);
});
