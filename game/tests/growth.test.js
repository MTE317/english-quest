import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import {
  learnBlock, learnSkill, isLearned, jobSkills, ensureLoadout, equipBlock, equipSkill, unequipSkill, capacity, usedCapacity, actionSkills,
  commonPoints, learnCommon, commonBlock, memberMods, parseBonusText, isJobMastered, masteryLevel, addMasteryKill,
  changeJob, availableJobs, GROWTH_FORMULAS,
} from '../js/growth.js';
import { computeStats, maxHp, canEquip, makeGear, equipFromStorage, gainXp, weaponPower } from '../js/character.js';
import { realGameData } from './helpers.js';

const data = realGameData();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => createNewGame(data, party);

test('最初は1段目のスキルを覚えていて、枠についている', () => {
  const w = fresh().party[0];
  const s1 = jobSkills(data, 'warrior').filter((s) => s.stage === 1);
  assert.ok(s1.every((s) => isLearned(w, s)));
  assert.ok(actionSkills(data, w).length > 0);
  assert.ok(actionSkills(data, w).every((s) => s.job === 'warrior' && s.kind !== 'passive'));
});

test('未経験ジョブの初期スキルは共有されず、装備枠はアクティブ・パッシブに分離される', () => {
  const w = fresh().party[0];
  const foreign = jobSkills(data, 'black_mage').find((s) => s.stage === 1);
  assert.equal(isLearned(w, foreign), false);

  const active = jobSkills(data, 'warrior').find((s) => s.stage === 1 && s.kind !== 'passive');
  const passive = jobSkills(data, 'warrior').find((s) => s.kind === 'passive');
  w.learned.push(passive.id);
  w.loadout = { actions: [passive.id, active.id], passives: [active.id, passive.id] };
  ensureLoadout(data, w);
  assert.deepEqual(w.loadout.actions, [active.id]);
  assert.deepEqual(w.loadout.passives, [passive.id]);
});

test('同じジョブの仲間同士でも習得・装着状態は共有しない', () => {
  const specs = Array.from({ length: 6 }, (_, i) => ({ name: `warrior${i + 1}`, job: 'warrior', icon: 'x' }));
  const g = createNewGame(data, specs);
  const first = g.party[0];
  const second = g.party[1];
  const passive = jobSkills(data, 'warrior').find((s) => s.kind === 'passive' && s.stage === 2);
  first.ap.warrior = passive.apToLearn;
  learnSkill(data, first, passive.id);
  assert.equal(isLearned(first, passive), true);
  assert.equal(isLearned(second, passive), false);
  assert.ok(!first.loadout.passives.includes(passive.id));
  equipSkill(data, first, passive.id);
  assert.ok(first.loadout.passives.includes(passive.id));
  assert.ok(!second.loadout.passives.includes(passive.id));
});

test('基本職は独立習得（AP が減る・パッシブは能力値に入る）', () => {
  const g = fresh(); const w = g.party[0];
  const s2 = jobSkills(data, 'warrior').find((s) => s.name === '鉄の体'); // 守り2段目：HP+10%
  assert.match(learnBlock(data, w, s2), /AP/);
  w.ap.warrior = s2.apToLearn + 3;
  const hp0 = maxHp(data, w);
  const loadoutBefore = structuredClone(w.loadout);
  learnSkill(data, w, s2.id);
  assert.equal(w.ap.warrior, 3);
  assert.deepEqual(w.loadout, loadoutBefore);
  assert.equal(maxHp(data, w), hp0);
  equipSkill(data, w, s2.id);
  assert.ok(w.loadout.passives.includes(s2.id));
  assert.equal(maxHp(data, w), Math.round(hp0 * 1.1));
  const s3 = jobSkills(data, 'warrior').find((s) => s.path === s2.path && s.stage === 4);
  assert.match(learnBlock(data, w, s3), /AP/);
  w.ap.warrior = s3.apToLearn;
  assert.equal(learnBlock(data, w, s3), '');
});

test('枠：cost の合計が上限まで。ほかのジョブのスキルも持ち出せるが奥義はだめ', () => {
  const g = fresh(); const w = g.party[0];
  const cap = capacity(data, w);
  assert.equal(cap.actions, GROWTH_FORMULAS.action_capacity);
  // 未経験ジョブの初期スキルは共有されない。転職経験があれば持ち出せる。
  const fire = jobSkills(data, 'black_mage').find((s) => s.stage === 1 && s.kind === 'attack');
  assert.equal(equipBlock(data, w, fire), '覚えていない');
  w.ap.black_mage = 0; // 一度そのジョブに就いた履歴
  assert.equal(equipBlock(data, w, fire), '');
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
  const originalGold = g.gold;
  changeJob(data, g, 0, 'black_mage'); // 剣と重装は黒魔道士は×
  const w = g.party[0];
  assert.equal(w.job, 'black_mage');
  assert.equal(g.jp, undefined);
  assert.equal(g.gold, originalGold);
  assert.equal(w.equip.weapon, null);
  assert.equal(w.equip.body, null);
  assert.ok(g.storage.gear.length >= 4);
  assert.ok(actionSkills(data, w).some((s) => s.job === 'black_mage'));
  g.unlockedJobs = ['gunner'];
  assert.ok(availableJobs(data, g).some((j) => j.id === 'gunner'));
});
