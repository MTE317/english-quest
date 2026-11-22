import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import {
  learnBlock, learnSkill, isLearned, jobSkills, equipBlock, equipSkill, unequipSkill, capacity, usedCapacity, actionSkills,
  commonPoints, learnCommon, commonBlock, memberMods, parseBonusText, isJobMastered, masteryLevel, addMasteryKill,
  changeJob, availableJobs, GROWTH_FORMULAS,
} from '../js/growth.js';
import { computeStats, maxHp, canEquip, makeGear, equipFromStorage, gainXp, weaponPower } from '../js/character.js';
import { realGameData } from './helpers.js';

const data = realGameData();
const party = ['warrior', 'knight', 'black_mage', 'white_mage'].map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => createNewGame(data, party);

test('最初は1段目のスキルを覚えていて、枠についている', () => {
  const w = fresh().party[0];
  const s1 = jobSkills(data, 'warrior').filter((s) => s.stage === 1);
  assert.ok(s1.every((s) => isLearned(w, s)));
  assert.ok(actionSkills(data, w).length > 0);
  assert.ok(actionSkills(data, w).every((s) => s.job === 'warrior' && s.kind !== 'passive'));
});

test('AP で2段目を覚える（前の段が必要・AP が減る・パッシブは能力値に入る）', () => {
  const g = fresh(); const w = g.party[0];
  const s2 = jobSkills(data, 'warrior').find((s) => s.name === '鉄の体'); // 守り2段目：HP+10%
  assert.match(learnBlock(data, w, s2), /AP/);
  w.ap.warrior = s2.apToLearn + 3;
  const hp0 = maxHp(data, w);
  learnSkill(data, w, s2.id);
  assert.equal(w.ap.warrior, 3);
  assert.ok(w.loadout.passives.includes(s2.id));
  assert.equal(maxHp(data, w), Math.round(hp0 * 1.1));
  const s3 = jobSkills(data, 'warrior').find((s) => s.path === s2.path && s.stage === 4);
  assert.match(learnBlock(data, w, s3), /先に/);
});

test('枠：cost の合計が上限まで。ほかのジョブのスキルも持ち出せるが奥義はだめ', () => {
  const g = fresh(); const w = g.party[0];
  const cap = capacity(data, w);
  assert.equal(cap.actions, GROWTH_FORMULAS.action_capacity);
  // 黒魔道士のスキルを覚えていることにする
  const fire = jobSkills(data, 'black_mage').find((s) => s.stage === 1 && s.kind === 'attack');
  assert.equal(equipBlock(data, w, fire), ''); // 1段目は最初から覚えている扱い
  equipSkill(data, w, fire.id);
  assert.ok(actionSkills(data, w).includes(fire));
  const fin = jobSkills(data, 'black_mage').find((s) => s.isFinal);
  w.learned.push(fin.id);
  assert.match(equipBlock(data, w, fin), /奥義/);
  unequipSkill(w, fire.id);
  assert.ok(!actionSkills(data, w).includes(fire));
  assert.ok(usedCapacity(data, w).actions <= cap.actions);
});

test('共通ツリー：レベルでポイントが入り、効果が入る。枠も広がる', () => {
  const g = fresh(); const w = g.party[0];
  const vit = data.commonTree.find((n) => n.id === 'vit1');
  assert.match(commonBlock(data, w, vit), /Lv/);
  gainXp(data, w, 1e6);
  assert.equal(commonPoints(data, w).earned, (w.lv - 1) * GROWTH_FORMULAS.common_points_per_level);
  const hp0 = maxHp(data, w);
  learnCommon(data, w, 'vit1');
  assert.equal(maxHp(data, w), Math.round(hp0 * 1.05));
  learnCommon(data, w, 'cap1');
  assert.equal(capacity(data, w).actions, GROWTH_FORMULAS.action_capacity + 1);
  assert.deepEqual(parseBonusText('戦闘が終わったときMP最大の10%回復'), { mp_regen: 0.1 });
  assert.deepEqual(parseBonusText('STRとMAG+2%'), { str: 0.02, mag: 0.02 });
  assert.deepEqual(parseBonusText('会心率+2%'), { crt: 0.02 });
});

test('ジョブを極めると、全ジョブにボーナス（戦士：STR+3%）', () => {
  const g = fresh(); const w = g.party[0];
  const str0 = computeStats(data, w).str;
  w.learned = jobSkills(data, 'warrior').map((s) => s.id);
  assert.ok(isJobMastered(data, w, 'warrior'));
  assert.ok(memberMods(data, w).str >= 0.03);
  assert.ok(computeStats(data, w).str > str0);
});

test('武器熟練度：高レベル武器は熟練度0でも装備可能、30体ごとに威力+2%（最大+20%）', () => {
  const g = fresh(); const w = g.party[0];
  const top = makeGear(g, 'sword_t24'); // ★12・剣の熟練度0
  assert.equal(masteryLevel(data, w, 'sword'), 0);
  assert.equal(canEquip(data, w, 'weapon', top).ok, true);
  g.storage.gear.push(top);
  equipFromStorage(data, g, w, 'weapon', top.uid);
  assert.equal(w.equip.weapon.id, 'sword_t24');
  const p0 = weaponPower(data, w, w.equip.weapon);
  for (let k = 0; k < 60; k++) addMasteryKill(data, w);
  assert.equal(masteryLevel(data, w, 'sword'), 2);
  assert.ok(Math.abs(weaponPower(data, w, w.equip.weapon) / p0 - 1.04) < 1e-9);
  for (let k = 0; k < 300; k++) addMasteryKill(data, w);
  assert.equal(masteryLevel(data, w, 'sword'), 10);
  assert.ok(Math.abs(weaponPower(data, w, w.equip.weapon) / p0 - 1.20) < 1e-9);
});

test('ジョブチェンジ：基本ジョブは選べる。装備できない物は倉庫へ', () => {
  const g = fresh();
  assert.ok(availableJobs(data, g).every((j) => j.tier === 'base'));
  assert.throws(() => changeJob(data, g, 0, 'gunner'));
  assert.throws(() => changeJob(data, g, 0, 'black_mage'), /JPが足りない/);
  g.jp = data.jobsById.get('black_mage').changeJp;
  changeJob(data, g, 0, 'black_mage'); // 剣と重装は黒魔道士は×
  const w = g.party[0];
  assert.equal(w.job, 'black_mage');
  assert.equal(g.jp, 0);
  assert.equal(w.equip.weapon, null);
  assert.equal(w.equip.body, null);
  assert.ok(g.storage.gear.length >= 4);
  assert.ok(actionSkills(data, w).some((s) => s.job === 'black_mage'));
  g.unlockedJobs = ['gunner'];
  assert.ok(availableJobs(data, g).some((j) => j.id === 'gunner'));
});
