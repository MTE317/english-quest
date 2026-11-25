import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import {
  learnSkill, upgradeSkill, setSkillUseLevel, learnedSkillLevel, usedSkillLevel,
  effectiveSkill, skillMaxLevel, changeJob, equipSkill, usedCapacity,
} from '../js/growth.js';
import { maxHp, maxMp } from '../js/character.js';
import { createBattle, makeEnemy, actionOptions, setPending, resolvePending, skillMp } from '../js/battle.js';
import { describeSkillEffect } from '../js/skill-effects.js';
import { GameSession, SAVE_VERSION } from '../js/save.js';
import { MemoryStorage, realGameData } from './helpers.js';

const data = realGameData();
const basic = data.jobs.filter((job) => job.tier === 'base');
const leveled = [...data.skills.values()].filter((skill) => skill.effect.master);
const fresh = (job = 'warrior') => createNewGame(data, [job, 'knight', 'black_mage', 'white_mage', 'thief', job]
  .map((id) => ({ job: id, name: id, icon: 'x' })));
function trained(skill, level = 1) {
  const game = fresh(skill.job);
  const member = game.party[0];
  member.ap = 10000;
  learnSkill(data, member, skill.id);
  equipSkill(data, member, skill.id);
  for (let n = 1; n < level; n += 1) upgradeSkill(data, member, skill.id);
  member.lv = 30;
  member.hp = maxHp(data, member);
  member.mp = maxMp(data, member);
  return game;
}
function battle(game, skill) {
  const enemy = makeEnemy(data, 'goblin', { lv: 30 });
  enemy.hp = enemy.maxHp = 100000;
  enemy.evasion = 0;
  const state = createBattle(data, game, { enemies: [enemy], seed: 1217071 });
  state.round = 1;
  state.turn = { side: 'ally', i: 0 };
  state.queue = [{ side: 'ally', i: 1 }];
  if (skill.kind === 'heal') {
    game.party[1].lv = 99;
    game.party[1].hp = 1;
  }
  setPending(state, { type: 'skill', skillId: skill.id, target: skill.kind === 'attack' ? 0 : 1 }, { wordId: 'fixture' });
  return state;
}

test('基本8職120技能が1・3・5段階を持ち、各Lvの効果説明と固定装備コストを取得できる', () => {
  assert.equal(basic.length, 8);
  assert.equal(leveled.length, 120);
  const pristine = JSON.stringify([...data.skills]);
  for (const skill of leveled) {
    assert.ok([1,3,5].includes(skillMaxLevel(skill)));
    const member = fresh(skill.job).party[0];
    member.learned = [skill.id];
    for (let level = 1; level <= skillMaxLevel(skill); level += 1) {
      member.skillLevels = { [skill.id]: level };
      member.skillUseLevels = { [skill.id]: 1 }; // 旧選択Lvが残っていても最高Lvを使う。
      const effective = effectiveSkill(data, member, skill);
      assert.equal(usedSkillLevel(member, skill), level);
      assert.equal(effective.cost, skill.cost);
      assert.equal(effective.effect.description, level === 1 ? skill.effect.description : skill.effect.levels[level - 2].effect.description);
      assert.ok(describeSkillEffect(data, effective).length > 0);
    }
  }
  assert.equal(JSON.stringify([...data.skills]), pristine);
});

test('共通APを消費して強化すると発動Lvも上がり、低い使用Lvの選択を拒否する', () => {
  const skill = data.skills.get('black_mage_A01');
  const game = trained(skill);
  const member = game.party[0];
  const peer = structuredClone(game.party[5]);
  const beforeAp = member.ap;
  const beforeCapacity = usedCapacity(data, member);
  upgradeSkill(data, member, skill.id);
  assert.equal(learnedSkillLevel(member, skill), 2);
  assert.equal(usedSkillLevel(member, skill), 2);
  assert.equal(member.ap, beforeAp - skill.effect.levels[0].ap);
  assert.deepEqual(game.party[5], peer);
  assert.deepEqual(usedCapacity(data, member), beforeCapacity);
  for (const level of [0, 1, 3, -1, 1.5, NaN, '2']) assert.throws(() => setSkillUseLevel(data, member, skill.id, level));
  setSkillUseLevel(data, member, skill.id, 2);
  assert.equal(member.skillUseLevels, undefined);
  while (learnedSkillLevel(member, skill) < 5) upgradeSkill(data, member, skill.id);
  assert.throws(() => upgradeSkill(data, member, skill.id), /強化できない/);
  const poor = trained(skill).party[0];
  poor.ap = skill.effect.levels[0].ap - 1;
  assert.throws(() => upgradeSkill(data, poor, skill.id), /AP/);
  assert.equal(poor.ap, skill.effect.levels[0].ap - 1);
  assert.throws(() => upgradeSkill(data, fresh().party[0], skill.id), /覚えていない/);
});

test('攻撃魔法と回復魔法は全Lvで候補・説明・消費MP・実行結果が一致する', () => {
  for (const id of ['black_mage_A01', 'white_mage_A01']) {
    const skill = data.skills.get(id);
    const values = [];
    for (let level = 1; level <= 5; level += 1) {
      for (const correct of [true, false]) {
        const game = trained(skill, level);
        const member = game.party[0];
        const state = battle(game, skill);
        const option = actionOptions(data, game, state, 0).skills.find((entry) => entry.skill.id === skill.id);
        assert.equal(option.reason, '');
        assert.deepEqual(option.skill, effectiveSkill(data, member, skill));
        assert.equal(describeSkillEffect(data, option.skill), describeSkillEffect(data, effectiveSkill(data, member, skill)));
        const cost = skillMp(data, member, skill);
        const beforeMp = member.mp;
        resolvePending(data, game, state, correct);
        assert.equal(beforeMp - member.mp, cost);
        const result = skill.kind === 'attack' ? 100000 - state.enemies[0].hp : game.party[1].hp - 1;
        assert.ok(result > 0, id);
        if (correct) values.push(result);
      }
    }
    assert.ok(values.every((value, index) => index === 0 || value > values[index - 1]), id);
  }
});

test('同じ持出し技能でもキャラ別Lvを保存再開後まで独立して保持する', () => {
  const skill = data.skills.get('black_mage_A01');
  const game = trained(skill, 5);
  const peer = game.party[5];
  peer.ap = 10000;
  learnSkill(data, peer, skill.id);
  upgradeSkill(data, peer, skill.id);
  equipSkill(data, peer, skill.id);
  changeJob(data, game, 0, 'warrior');
  changeJob(data, game, 5, 'knight');
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  session.startNew(game);
  const loaded = new GameSession({ storage });
  normalizeGame(data, loaded.game);
  assert.equal(usedSkillLevel(loaded.game.party[0], skill), 5);
  assert.equal(usedSkillLevel(loaded.game.party[5], skill), 2);
  assert.ok(effectiveSkill(data, loaded.game.party[0], skill).effect.m > effectiveSkill(data, loaded.game.party[5], skill).effect.m);
  assert.ok(loaded.game.party[0].loadout.actions.includes(skill.id));
  assert.equal(loaded.game.party[0].ap, game.party[0].ap);
});

test('不正な技能Lvを正規化し、旧使用Lvを削除してAPを変えない', () => {
  const game = fresh();
  const member = game.party[0];
  member.learned = ['warrior_A01'];
  member.skillLevels = { warrior_A01: 99, missing: 3, warrior_A02: 2 };
  member.skillUseLevels = { warrior_A01: 1 };
  const before = member.ap;
  normalizeGame(data, game);
  assert.deepEqual(member.skillLevels, { warrior_A01: 5 });
  assert.equal(member.skillUseLevels, undefined);
  assert.equal(member.ap, before);
  assert.ok(SAVE_VERSION >= 3);
});

test('遠征中の問題待ちも保存と同じ最高Lv・乱数で再開し、全滅時は入場前へ戻る', () => {
  const skill = data.skills.get('black_mage_A01');
  for (const level of [1, 5]) {
    const game = trained(skill, level);
    const storage = new MemoryStorage();
    const session = new GameSession({ storage });
    session.startNew(game);
    session.enterDungeon({ dungeonId: 'field', floor: 1 });
    const state = battle(session.game, skill);
    session.setBattle(state);
    const controlGame = structuredClone(session.game);
    const controlState = structuredClone(state);
    resolvePending(data, controlGame, controlState, true);
    const loaded = new GameSession({ storage });
    normalizeGame(data, loaded.game, loaded.run);
    resolvePending(data, loaded.game, loaded.run.battle, true);
    assert.deepEqual(loaded.run.battle, controlState);
    assert.equal(loaded.game.party[0].mp, controlGame.party[0].mp);
    loaded.wipe();
    assert.equal(usedSkillLevel(loaded.game.party[0], skill), level);
    assert.equal(loaded.game.party[0].ap, game.party[0].ap);
  }
});

test('高Lv技能でもMP不足時は候補を無効にし、実行でもMP・敵HPを変えない', () => {
  const skill = data.skills.get('black_mage_A01');
  const game = trained(skill, 5);
  const member = game.party[0];
  member.mp = skillMp(data, member, skill) - 1;
  const state = battle(game, skill);
  const hp = state.enemies[0].hp;
  const mp = member.mp;
  const option = actionOptions(data, game, state, 0).skills.find((entry) => entry.skill.id === skill.id);
  assert.match(option.reason, /MP/);
  resolvePending(data, game, state, true);
  assert.equal(member.mp, mp);
  assert.equal(state.enemies[0].hp, hp);
});
