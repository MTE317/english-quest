import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, defaultPartySpecs, normalizeGame, PARTY_SIZE } from '../js/game-state.js';
import { maxHp, maxMp } from '../js/character.js';
import { createBattle, makeEnemy, nextTurn, setPending, resolvePending, battleRewards } from '../js/battle.js';
import { GameSession } from '../js/save.js';
import { LEARNING_KEY } from '../js/storage.js';
import { MemoryStorage, realGameData } from './helpers.js';

const data = realGameData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));
const legacy = () => createNewGame(data, defaultPartySpecs(data).slice(0, 4), { partySize: 4 });

test('新規作成は6人を要求し、全員に初期装備と重複しないIDを用意する', () => {
  const specs = defaultPartySpecs(data);
  const game = fresh();
  assert.equal(PARTY_SIZE, 6);
  assert.equal(game.party.length, 6);
  assert.deepEqual(specs.map((member) => member.job), data.balance.new_game.party_jobs);
  assert.equal(new Set(game.party.map((member) => member.id)).size, 6);
  const gear = game.party.flatMap((member) => Object.values(member.equip).filter(Boolean));
  assert.equal(new Set(gear.map((item) => item.uid)).size, gear.length);
  for (const member of game.party) {
    assert.ok(member.equip.weapon);
    assert.equal(member.hp, maxHp(data, member));
    assert.equal(member.mp, maxMp(data, member));
  }
  assert.throws(() => createNewGame(data, specs.slice(0, 4)), /6人/);
  assert.throws(() => createNewGame(data, [...specs, specs[0]]), /6人/);
});

test('町の旧4人セーブは育成・負傷・装備・学習記録を保持して一度だけ6人になる', () => {
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  const game = legacy();
  game.party.forEach((member, i) => { member.lv = 8 + i; member.xp = 10 + i; member.hp = i ? 12 : 0; member.mp = i; });
  game.party[0].name = '大切な仲間';
  game.party[0].ap.warrior = 17;
  game.party[0].persist = ['weaken'];
  game.storage.gear.push({ ...structuredClone(game.party[0].equip.weapon), uid: 800 });
  game.nextUid = 2; // 古い/取り込み済みのカウンタでも既存UIDと重複しない。
  const original = structuredClone(game.party);
  const inventory = structuredClone(game.storage);
  const learning = '{"words":{"remembered":[1,2,3]}}';
  storage.setItem(LEARNING_KEY, learning);
  session.startNew(game);
  normalizeGame(data, session.game);
  session.save();
  assert.deepEqual(session.game.party.slice(0, 4), original);
  assert.deepEqual(session.game.storage, inventory);
  assert.equal(session.game.gold, game.gold);
  assert.equal(session.game.party.length, 6);
  for (const member of session.game.party.slice(4)) {
    assert.equal(member.lv, 8);
    assert.equal(member.hp, maxHp(data, member));
    assert.equal(member.mp, maxMp(data, member));
    for (const item of Object.values(member.equip).filter(Boolean)) assert.ok(item.uid > 800);
  }
  assert.equal(storage.getItem(LEARNING_KEY), learning);
  const once = structuredClone(session.game);
  const resumed = new GameSession({ storage });
  normalizeGame(data, resumed.game);
  assert.deepEqual(resumed.game, once);
  assert.equal(resumed.game.notices.filter((notice) => notice.includes('加入')).length, 1);
});

test('旧4人の遠征・回答中の問題・全滅復元元を保ち、町に戻ってから6人へ移行する', () => {
  for (const exit of ['return', 'wipe']) {
    const storage = new MemoryStorage();
    const session = new GameSession({ storage });
    session.startNew(legacy());
    session.enterDungeon({ dungeonId: 'mossy_cave', stoneId: 'rs_1_001' });
    const battle = createBattle(data, session.game, { enemies: [makeEnemy(data, 'slime', { lv: 3 })], seed: 19 });
    nextTurn(data, session.game, battle);
    setPending(battle, { type: 'attack', target: 0 }, { wordId: 'saved-question' });
    session.setBattle(battle);
    const before = structuredClone(session.state);
    normalizeGame(data, session.game, session.run);
    assert.deepEqual(session.state, before);
    session.save();
    const resumed = new GameSession({ storage });
    normalizeGame(data, resumed.game, resumed.run);
    assert.equal(resumed.game.party.length, 4);
    assert.equal(resumed.run.snapshot.party.length, 4);
    assert.deepEqual(resumed.run.battle.pending, before.run.battle.pending);
    assert.doesNotThrow(() => resolvePending(data, resumed.game, resumed.run.battle, true));
    const originalMembers = structuredClone(exit === 'wipe' ? resumed.run.snapshot.party : resumed.game.party);
    if (exit === 'wipe') resumed.wipe();
    else { resumed.endBattle(); resumed.leaveDungeon(); }
    normalizeGame(data, resumed.game);
    resumed.save();
    assert.equal(resumed.run, null);
    assert.equal(resumed.game.party.length, 6);
    assert.deepEqual(resumed.game.party.slice(0, 4), originalMembers);
    assert.equal(new GameSession({ storage }).game.party.length, 6);
  }
});

test('6人全員に行動機会と報酬があり、5・6人目を回復対象にできる', () => {
  const game = fresh();
  const enemy = makeEnemy(data, 'slime', { lv: 1 });
  enemy.hp = enemy.maxHp = 100000;
  enemy.spd = 0;
  const battle = createBattle(data, game, { enemies: [enemy], seed: 7 });
  const actors = new Set();
  for (let i = 0; i < PARTY_SIZE; i++) {
    assert.ok(nextTurn(data, game, battle));
    actors.add(battle.turn.i);
    setPending(battle, { type: 'attack', target: 0 }, { wordId: 'one-question' });
    resolvePending(data, game, battle, true);
  }
  assert.deepEqual([...actors].sort(), [0, 1, 2, 3, 4, 5]);
  const potion = [...data.items.values()].find((item) => item.effect === 'heal_hp');
  assert.ok(potion);
  for (const target of [4, 5]) {
    game.items[potion.id] = 1;
    game.party[target].hp = 1;
    battle.turn = { side: 'ally', i: 0 };
    setPending(battle, { type: 'item', itemId: potion.id, target }, { wordId: 'heal-question' });
    resolvePending(data, game, battle, true);
    assert.ok(game.party[target].hp > 1);
  }
  const rewards = battleRewards(data, game, battle);
  assert.equal(rewards.xp.length, 6);
  assert.equal(rewards.ap.length, 6);
});
