import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../js/save.js';
import { createNewGame } from '../js/game-state.js';
import { nextTurn, setPending, resolvePending } from '../js/battle.js';
import {
  startRun, expeditionFee, startNextBattle, afterBattle, returnToTown, continueRun, resolveLoot, allowedDungeons, allowedStones, isBossBattle, seededRng,
} from '../js/dungeon.js';
import { backpackSlots, backpackUsed, addToBackpack, rollBattleLoot, rollGearDrop, addItem } from '../js/loot.js';
import { makeEnemy } from '../js/battle.js';
import { maxHp, maxMp, gainXp, computeStats } from '../js/character.js';
import { realGameData, realLexicon, readJson, readCsv, MemoryStorage, T0 } from './helpers.js';
import { planExploration } from '../js/exploration.js';
import { buildWorldMap } from '../js/world-map.js';
import { acceptQuest, canReport, checkRankUp, makeBoard, reportQuest } from '../js/town.js';
import { QuestionPicker } from '../js/picker.js';
import { Scheduler } from '../js/srs.js';
import { LearningStore } from '../js/storage.js';

const data = realGameData();
const lex = realLexicon();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));

function newSession(storage = new MemoryStorage()) {
  const s = new GameSession({ storage });
  s.startNew(createNewGame(data, party));
  return s;
}

test('遠征費は出発時に払い、途中帰還で確定し、全滅時は香とともに戻る', () => {
  const storage = new MemoryStorage();
  const session = newSession(storage);
  const options = { dungeonId: 'sunlit_forest', stoneId: 'rs_1_001', seed: 1 };
  const fee = expeditionFee(data, data.dungeons.get(options.dungeonId));
  assert.equal(fee, 8);
  const gold = session.game.gold;
  session.game.items.bounty_lure = 1;
  startRun(data, session, { ...options, bountyLure: true });
  assert.equal(session.game.gold, gold - fee);
  assert.equal(session.game.items.bounty_lure, undefined);
  const resumed = new GameSession({ storage });
  resumed.wipe();
  assert.equal(resumed.game.gold, gold);
  assert.equal(resumed.game.items.bounty_lure, 1);
  startRun(data, resumed, options);
  resumed.updateRun(run => { run.state = 'return_point'; });
  returnToTown(data, resumed);
  assert.equal(resumed.game.gold, gold - fee);
  resumed.game.gold = 0;
  assert.throws(() => startRun(data, resumed, options), /遠征費/);
  assert.equal(resumed.run, null);
  startRun(data, resumed, { ...options, dungeonId: 'mossy_cave' });
  assert.equal(resumed.game.gold, 0);
});
/** 戦闘を最後まで（正解の割合 acc） */
function fightOut(session, acc = 1, seed = 1) {
  const b = session.run.battle; const r = seededRng({ rng: seed });
  while (nextTurn(data, session.game, b)) { setPending(b, { type: 'attack', target: 0 }, {}); resolvePending(data, session.game, b, r() < acc); session.save(); }
}

test('先行5か所は踏破で解放され、ランクでは増えない', () => {
  const game = createNewGame(data, party);
  assert.deepEqual(allowedDungeons(data, game).map(({ id }) => id).sort(),
    ['mossy_cave', 'sunlit_forest', 'goblin_quarry'].sort());
  game.rank = 'S';
  assert.equal(allowedDungeons(data, game).length, 3);
  game.rank = 'R01';
  game.cleared.mossy_cave = 1;
  assert.ok(allowedDungeons(data, game).some(({ id }) => id === 'ruined_fort'));
  assert.ok(!allowedDungeons(data, game).some(({ id }) => id === 'misty_marsh'));
  game.cleared.sunlit_forest = 1;
  assert.equal(allowedDungeons(data, game).length, 5);
});

test('★2の冒険先も踏破で発見すればR01のまま既存教材で遠征し、依頼を報告できる', () => {
  const session = newSession();
  const game = session.game;
  const rng = seededRng({ rng: 9 });
  game.cleared.mossy_cave = 1;
  game.gold = 1000;
  for (const member of game.party) {
    gainXp(data, member, 1000000);
    member.hp = maxHp(data, member);
    member.mp = maxMp(data, member);
  }
  assert.equal(game.rank, 'R01');
  const available = allowedDungeons(data, game);
  assert.ok(available.some(({ id }) => id === 'ruined_fort'));
  assert.equal(buildWorldMap(data.dungeons, available, game).dungeons.length, 4);
  makeBoard(data, game, rng);
  const offer = game.board.find(quest => quest.type === 'boss');
  assert.ok(offer && available.some(({ id }) => id === offer.dungeonId));
  const quest = acceptQuest(data, game, offer.uid, rng);

  const empty = { id: 'empty', star: 4 };
  const stones = allowedStones({ ...lex, stones: [...lex.stones, empty] });
  assert.equal(stones.length, 68);
  assert.equal(stones[0].id, '00:S');
  assert.ok(!stones.some(({ id }) => id === 'empty'));
  const stoneId = stones[0].id;
  const picker = new QuestionPicker({
    lex, store: new LearningStore(new MemoryStorage()), scheduler: new Scheduler(readJson('srs.json')),
    stoneId, nowMs: T0, rng,
  });
  assert.ok(picker.next());
  startRun(data, session, { dungeonId: offer.dungeonId, stoneId, quizState: picker.toState(), seed: 9 });
  assert.equal(session.run.stoneId, stoneId);
  for (let i = 0; i < 12 && session.run?.state !== 'cleared'; i++) {
    if (session.run.state === 'return_point') { continueRun(session); continue; }
    if (session.run.state === 'loot') { resolveLoot(data, session, null); continue; }
    startNextBattle(data, session);
    fightOut(session);
    assert.notEqual(afterBattle(data, session).result, 'lose');
  }
  assert.equal(session.run?.state, 'cleared');
  returnToTown(data, session);
  assert.equal(session.inDungeon, false);
  assert.ok(canReport(data, session.game, quest));
  reportQuest(data, session.game, quest.uid, rng);
  assert.ok(!session.game.quests.some(active => active.uid === quest.uid));
});

test('入ると日数を使い、全滅すると日数・お金・経験値・拾った物がすべて戻る', () => {
  const s = newSession();
  const before = structuredClone(s.game);
  startRun(data, s, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 1 });
  assert.equal(s.game.day, before.day + data.dungeons.get('mossy_cave').days);
  startNextBattle(data, s); fightOut(s, 1);
  afterBattle(data, s);
  assert.ok(s.game.gold > before.gold);
  // 強い敵で負ける
  for (const m of s.game.party) m.hp = 1;
  startNextBattle(data, s); fightOut(s, 0);
  const r = afterBattle(data, s);
  assert.equal(r.result, 'lose');
  assert.deepEqual(s.game, before);
  assert.equal(s.inDungeon, false);
});

test('いちばん奥まで：階を進み、帰還ポイント・ボス・クリア。帰るとバックパックは倉庫へ', () => {
  const s = newSession();
  for (const m of s.game.party) { gainXp(data, m, 5000); m.hp = maxHp(data, m); m.mp = maxMp(data, m); }
  s.save();
  const dg = data.dungeons.get('mossy_cave');
  startRun(data, s, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 3 });
  let sawReturnPoint = false; let sawBoss = false; let n = 0;
  while (s.run && s.run.state !== 'cleared' && n++ < 50) {
    if (s.run.state === 'return_point') { sawReturnPoint = true; continueRun(s); continue; }
    if (s.run.state === 'loot') { resolveLoot(data, s, null); continue; }
    if (isBossBattle(data, s.run)) sawBoss = true;
    startNextBattle(data, s);
    if (sawBoss) assert.ok(s.run.battle.enemies.some((e) => e.boss && e.monsterId === dg.bossId));
    fightOut(s, 1, n);
    const r = afterBattle(data, s);
    assert.notEqual(r.result, 'lose');
    for (const m of s.game.party) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); }
  }
  assert.equal(s.run.state, 'cleared');
  assert.ok(sawReturnPoint && sawBoss);
  const pack = structuredClone(s.run.backpack);
  returnToTown(data, s);
  assert.equal(s.inDungeon, false);
  assert.equal(s.game.cleared.mossy_cave, 1);
  assert.equal(s.game.storage.gear.length, pack.gear.length);
  for (const [id, c] of Object.entries(pack.materials)) assert.equal(s.game.storage.materials[id], c);
});

test('帰還ポイントでないところからは帰れない（帰還の羽があれば帰れる）', () => {
  const s = newSession();
  s.update((g) => { g.items.return_feather = 1; });
  startRun(data, s, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 1 });
  assert.throws(() => returnToTown(data, s));
  returnToTown(data, s, 'return_feather');
  assert.equal(s.inDungeon, false);
  assert.equal(s.game.items.return_feather, undefined);
});

test('バックパック：装備は1個1枠、素材は1種類1枠。いっぱいなら残りを返す', () => {
  const game = createNewGame(data, party);
  const cap = backpackSlots(data, game);
  assert.equal(cap, Number(readCsv('backpack.csv').rows[0].slots));
  const pack = { gear: [], materials: {} };
  addToBackpack(data, game, pack, [{ type: 'material', id: 'slime_mat', count: 5 }, { type: 'material', id: 'slime_mat', count: 3 }]);
  assert.equal(backpackUsed(pack), 1);
  const gear = Array.from({ length: cap }, () => ({ type: 'gear', gear: rollGearDrop(data, game, 'mossy_cave', 1, Math.random) }));
  const left = addToBackpack(data, game, pack, gear);
  assert.equal(backpackUsed(pack), cap);
  assert.equal(left.length, 1);
  // 同じ素材は枠が増えないので入る
  assert.equal(addToBackpack(data, game, pack, [{ type: 'material', id: 'slime_mat', count: 1 }]).length, 0);
});

test('ドロップ：お金は run_income から。装備はダンジョンの装備Lvの範囲。ボスは固有装備を落とすことがある', () => {
  const game = createNewGame(data, party);
  const dg = data.dungeons.get('mossy_cave');
  const rng = seededRng({ rng: 5 });
  for (let k = 0; k < 50; k++) {
    const g = rollGearDrop(data, game, 'mossy_cave', 1 + (k % 5), rng);
    const def = data.equipment.get(g.id);
    assert.ok(def.itemLv >= dg.itemLvMin && def.itemLv <= dg.itemLvMax, def.id);
  }
  let uniques = 0;
  for (let k = 0; k < 200; k++) {
    const loot = rollBattleLoot(data, game, 'mossy_cave', 5, [makeEnemy(data, dg.bossId, { lv: 5, boss: true })], rng);
    assert.ok(loot.gold > 0);
    if (loot.gear.some((x) => data.equipment.get(x.id).unique)) uniques++;
  }
  assert.ok(uniques > 5 && uniques < 80, String(uniques));
});

test('固有装備・ランダム効果は能力値に入る', () => {
  const game = createNewGame(data, party);
  const m = game.party[0];
  const before = computeStats(data, m).crit;
  m.equip.accessory1 = { uid: 999, id: 'ring_t1', enh: 0, quality: 1, rarity: 'rare', affixes: { CRT: 5 } };
  assert.ok(Math.abs(computeStats(data, m).crit - before - 0.05) < 1e-9);
});

test('道具は種類ごとに10個まで', () => {
  const game = createNewGame(data, party);
  assert.equal(addItem(game, 'potion', 12), 2);
  assert.equal(game.items.potion, 10);
});

test('掲示板：町に戻ると受けていない枠が入れかわり、全滅したら入る前のまま', async () => {
  const { fillBoard, acceptQuest, boardSize } = await import('../js/town.js');
  const s = newSession();
  s.update((g) => { fillBoard(data, g, seededRng({ rng: 5 })); acceptQuest(data, g, g.board[0].uid, seededRng({ rng: 6 })); g.items.return_feather = 1; });
  const accepted = s.game.quests.map((q) => q.uid);
  const offers = s.game.board.map((q) => q.uid);
  // 帰還の羽で帰る → 受けていない枠だけ入れかわる
  startRun(data, s, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 1 });
  returnToTown(data, s, 'return_feather');
  assert.deepEqual(s.game.quests.map((q) => q.uid), accepted);
  assert.equal(s.game.board.length, boardSize(data, s.game));
  assert.ok(s.game.board.every((q) => !offers.includes(q.uid)));
  // 全滅 → 掲示板は入る前のまま
  const before = s.game.board.map((q) => q.uid);
  startRun(data, s, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 2 });
  for (const m of s.game.party) m.hp = 1;
  startNextBattle(data, s); fightOut(s, 0);
  assert.equal(afterBattle(data, s).result, 'lose');
  assert.deepEqual(s.game.board.map((q) => q.uid), before);
});

test('石化だけの勝利でも討伐依頼・経験値・ドロップを精算する', () => {
  const session = newSession();
  startRun(data, session, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', seed: 1 });
  startNextBattle(data, session);
  const battle = session.run.battle;
  const target = battle.enemies[0].monsterId;
  session.game.quests = [{ type: 'hunt', target, count: 99, progress: 0 }];
  for (const enemy of battle.enemies) enemy.statuses.petrify = { turns: 99, n: 1 };
  assert.equal(nextTurn(data, session.game, battle), null);
  const result = afterBattle(data, session);
  assert.equal(result.result, 'win');
  assert.equal(session.game.quests[0].progress, battle.enemies.filter((enemy) => enemy.monsterId === target).length);
  assert.ok(result.growth.every(({ xp }) => xp > 0));
  assert.ok(result.loot.gold > 0);
});

test('旧育成遠征を保存から再開して完走できる。新規遠征は同じ行き先でボスと戦う', () => {
  const storage = new MemoryStorage();
  const old = newSession(storage);
  startRun(data, old, { dungeonId: 'sunlit_forest', stoneId: 'rs_1_001', seed: 1 });
  assert.ok(old.run.route.at(-1).lastBattleIsBoss);
  old.run.training = true;
  delete old.run.explorationPlan;
  for (const row of old.run.route) row.lastBattleIsBoss = false;
  startNextBattle(data, old);
  const session = new GameSession({ storage });
  const gold = session.game.gold;
  while (session.run.state !== 'cleared') {
    if (session.run.state === 'return_point') { continueRun(session); continue; }
    if (session.run.state === 'loot') { resolveLoot(data, session, null); continue; }
    assert.equal(isBossBattle(data, session.run), false);
    if (!session.run.battle) startNextBattle(data, session);
    assert.ok(session.run.battle.enemies.every((enemy) => !enemy.boss));
    for (const enemy of session.run.battle.enemies) enemy.hp = 0;
    nextTurn(data, session.game, session.run.battle);
    assert.equal(afterBattle(data, session).result, 'win');
  }
  returnToTown(data, session);
  assert.equal(session.game.cleared.sunlit_forest, undefined);
  assert.ok(session.game.gold > gold);
});

function finishWithoutTurns(local, session, result = 'win') {
  if (!session.run.battle) startNextBattle(local, session);
  const battle = session.run.battle;
  battle.result = result;
  if (result === 'win') battle.enemies.forEach((enemy) => { enemy.hp = 0; });
  return afterBattle(local, session);
}

function discardOverflow(local, session) {
  while (session.run.state === 'loot') resolveLoot(local, session, null);
}

const expedition = { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: { asked: 3 }, seed: 12345 };

test('全60経路は2・3・6戦で最奥だけがボス。前半に帰還地点がある', () => {
  assert.equal(data.dungeons.size, 60);
  for (const dungeon of data.dungeons.values()) {
    const route = data.dungeonFloors.filter(({ dungeonId }) => dungeonId === dungeon.id);
    const length = dungeon.kind === '近場' ? 2 : dungeon.kind === '深層' ? 6 : 3;
    assert.equal(route.length, length, dungeon.id);
    assert.ok(route.every(({ battles, lastBattleIsBoss }, i) => battles === 1 && lastBattleIsBoss === (i === length - 1)), dungeon.id);
    assert.ok(route.slice(0, -1).some(({ returnPointAfter }) => returnPointAfter), dungeon.id);
    assert.equal(data.monsters.get(dungeon.bossId)?.role, 'boss', dungeon.id);
  }
});

test('探索抽選はseedで再現し、固定枠と独立。抽選の発生数と内訳は設定値に収束する', () => {
  const config = data.balance.dungeon.exploration;
  const configWithFixed = { ...config, fixed: { test: [{ id: 'fixed', floor: 1, type: 'investigate' }] } };
  const rng = seededRng({ rng: 8017 });
  for (const [length, expected] of [[2, 0.5], [3, 0.8], [6, 1.6]]) {
    const route = Array.from({ length }, (_, i) => ({ floor: i + 1, battles: 1 }));
    const fromSeed = () => planExploration(configWithFixed, 'test', route, seededRng({ rng: 135 }));
    assert.deepEqual(fromSeed(), fromSeed());
    const totals = { chest: 0, gather: 0, rest: 0 };
    const runs = 10000;
    for (let i = 0; i < runs; i++) {
      const [fixed, ...random] = planExploration(configWithFixed, 'test', route, rng);
      assert.equal(fixed.id, 'fixed');
      assert.equal(new Set(random.map(({ floor }) => floor)).size, random.length);
      for (const event of random) {
        assert.ok(event.floor < length);
        totals[event.type]++;
      }
    }
    const count = Object.values(totals).reduce((a, b) => a + b);
    assert.ok(Math.abs(count / runs - expected) < 0.035);
    for (const [type, weight] of Object.entries(config.weights)) assert.ok(Math.abs(totals[type] / count - weight / 100) < 0.025);
  }
});

test('最奥のボス報酬は周回ごとに出る。逃走・途中帰還は踏破に数えない', () => {
  const session = newSession();
  for (let i = 0; i < 3; i++) {
    startRun(data, session, { ...expedition, seed: i });
    finishWithoutTurns(data, session);
    discardOverflow(data, session);
    finishWithoutTurns(data, session);
    discardOverflow(data, session);
    assert.equal(session.run.state, 'return_point');
    continueRun(session);
    assert.ok(isBossBattle(data, session.run));
    const result = finishWithoutTurns(data, session, i === 0 ? 'fled' : 'win');
    discardOverflow(data, session);
    if (i > 0) {
      assert.equal(session.run.state, 'cleared');
      assert.ok(result.loot.gold > 0 && result.loot.gear.length > 0 && result.loot.materials.length > 0);
    }
    assert.equal(session.game.cleared.mossy_cave ?? 0, Math.max(0, i - 1));
    returnToTown(data, session);
    assert.equal(session.game.cleared.mossy_cave ?? 0, i);
  }
});

test('固定箱は全滅で再試行でき、途中帰還で確定。調査・発見・入場条件は独立する', () => {
  const local = structuredClone(data);
  const config = local.balance.dungeon.exploration;
  config.slots = {};
  config.fixed.mossy_cave.push({ id: 'hidden', floor: 1, type: 'discover', discovery: 'test-location' });
  config.entry.sunlit_forest = { discovery: 'test-location', flags: ['SQ-1'], cleared: ['mossy_cave'] };
  const storage = new MemoryStorage();
  let session = newSession(storage);
  const before = structuredClone(session.game);
  startRun(local, session, expedition);
  finishWithoutTurns(local, session);
  assert.deepEqual(session.run.explorationNotices.map(({ type }) => type), ['chest', 'discover']);
  const savedPlan = structuredClone(session.run.explorationPlan);
  const savedPack = structuredClone(session.run.backpack);
  session = new GameSession({ storage });
  assert.deepEqual(session.run.explorationPlan, savedPlan);
  assert.deepEqual(session.run.backpack, savedPack);
  assert.equal(session.run.stoneId, expedition.stoneId);
  assert.deepEqual(session.run.quiz, expedition.quizState);
  assert.equal(session.game.exploration, undefined);
  finishWithoutTurns(local, session, 'lose');
  assert.deepEqual(session.game, before);
  startRun(local, session, expedition);
  finishWithoutTurns(local, session);
  assert.equal(session.run.explorationNotices[0].first, true);
  finishWithoutTurns(local, session);
  discardOverflow(local, session);
  returnToTown(local, session);
  assert.equal(session.game.exploration.events['mossy_cave:first-cache'], true);
  assert.equal(session.game.exploration.discoveries['test-location'], true);
  assert.equal(session.game.worldFlags['SQ-1'], true);
  assert.equal(session.game.cleared.mossy_cave, undefined);
  assert.ok(!allowedDungeons(local, session.game).some(({ id }) => id === 'sunlit_forest'));
  startRun(local, session, expedition);
  finishWithoutTurns(local, session);
  assert.deepEqual(session.run.explorationNotices, []);
  finishWithoutTurns(local, session);
  assert.deepEqual(session.run.explorationNotices, []);
  discardOverflow(local, session);
  continueRun(session);
  finishWithoutTurns(local, session);
  discardOverflow(local, session);
  returnToTown(local, session);
  assert.ok(allowedDungeons(local, session.game).some(({ id }) => id === 'sunlit_forest'));
});

test('周回の箱と採集は再発生し、満杯時は再開後に既存の入れ替えで受け取れる', () => {
  const local = structuredClone(data);
  local.balance.dungeon.exploration = {
    ...local.balance.dungeon.exploration, slots: {}, fixed: { mossy_cave: [
      { id: 'chest', floor: 1, type: 'chest' },
      { id: 'gather', floor: 1, type: 'gather' },
    ] },
  };
  local.balance.dungeon.exploration.chest.weights = { gear: 100 };
  const storage = new MemoryStorage();
  let session = newSession(storage);
  for (let i = 0; i < 2; i++) {
    session.game.items.return_feather = 1;
    startRun(local, session, expedition);
    const filler = rollGearDrop(local, session.game, expedition.dungeonId, 1, () => 0.5);
    session.run.backpack.gear = Array.from({ length: backpackSlots(local, session.game) }, (_, uid) => ({ ...filler, uid: -1 - uid }));
    finishWithoutTurns(local, session, 'fled');
    assert.equal(session.run.state, 'loot');
    assert.deepEqual(session.run.explorationNotices.map(({ type }) => type), ['chest', 'gather']);
    assert.equal(session.run.pendingLoot[0].gear.rarity, 'common');
    assert.equal(session.run.pendingLoot[1].type, 'material');
    assert.equal(session.run.pendingLoot.length, 2);
    session = new GameSession({ storage });
    for (const uid of [-1, -2]) resolveLoot(local, session, { type: 'gear', uid });
    const [[id, count]] = Object.entries(session.run.backpack.materials);
    assert.equal(count, 1);
    returnToTown(local, session, 'return_feather');
    assert.ok(session.game.storage.materials[id] >= 1);
    assert.equal(session.game.exploration, undefined);
  }
});

test('旧探索イベントは残すが、対象外のダンジョンはランクや記録だけで開かない', () => {
  const session = newSession();
  const options = { ...expedition, dungeonId: 'sunlit_forest' };
  const event = data.balance.dungeon.exploration.fixed[options.dungeonId].find(({ type }) => type === 'discover');
  const target = event.discovery.slice('dungeon:'.length);
  startRun(data, session, options);
  finishWithoutTurns(data, session);
  discardOverflow(data, session);
  assert.equal(session.run.explorationNotices.find(({ type }) => type === 'discover').discovery, event.discovery);
  returnToTown(data, session);
  assert.equal(session.game.exploration.discoveries[event.discovery], true);
  session.game.rank = 'S';
  assert.ok(!allowedDungeons(data, session.game).some(({ id }) => id === target));
  assert.ok(!allowedDungeons(data, session.game).some(({ id }) => id === 'misty_marsh'));
  session.game.cleared.sunlit_forest = 1;
  assert.ok(allowedDungeons(data, session.game).some(({ id }) => id === 'misty_marsh'));
});

test('休憩は生存者だけを部分回復し、上限を超えない', () => {
  const local = structuredClone(data);
  local.balance.dungeon.exploration = {
    ...local.balance.dungeon.exploration, slots: {}, fixed: { mossy_cave: [{ id: 'rest', floor: 1, type: 'rest' }] },
  };
  const session = newSession();
  startRun(local, session, expedition);
  startNextBattle(local, session);
  const [fallen, survivor] = session.game.party;
  fallen.hp = 0;
  survivor.hp = 1;
  survivor.mp = 0;
  finishWithoutTurns(local, session, 'fled');
  const [notice] = session.run.explorationNotices;
  assert.equal(notice.type, 'rest');
  assert.equal(session.game.party[0].hp, 0);
  const member = session.game.party[1];
  assert.equal(member.hp, 1 + Math.floor(maxHp(local, member) * 0.10));
  assert.equal(member.mp, Math.floor(maxMp(local, member) * 0.05));
});
