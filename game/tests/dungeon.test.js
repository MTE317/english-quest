import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession } from '../js/save.js';
import { createNewGame } from '../js/game-state.js';
import { nextTurn, setPending, resolvePending } from '../js/battle.js';
import {
  startRun, startNextBattle, afterBattle, returnToTown, continueRun, resolveLoot, allowedDungeons, allowedStones, isBossBattle, seededRng,
} from '../js/dungeon.js';
import { backpackSlots, backpackUsed, addToBackpack, rollBattleLoot, rollGearDrop, addItem } from '../js/loot.js';
import { makeEnemy } from '../js/battle.js';
import { maxHp, maxMp, gainXp, computeStats } from '../js/character.js';
import { realGameData, realLexicon, readJson, readCsv, MemoryStorage } from './helpers.js';

const data = realGameData();
const lex = realLexicon();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));

function newSession() {
  const s = new GameSession({ storage: new MemoryStorage() });
  s.startNew(createNewGame(data, party));
  return s;
}
/** 戦闘を最後まで（正解の割合 acc） */
function fightOut(session, acc = 1, seed = 1) {
  const b = session.run.battle; const r = seededRng({ rng: seed });
  while (nextTurn(data, session.game, b)) { setPending(b, { type: 'attack', target: 0 }, {}); resolvePending(data, session.game, b, r() < acc); session.save(); }
}

test('ランクで行けるダンジョンが決まる（見習いは★1だけ）。石は★がダンジョン以上', () => {
  const game = createNewGame(data, party);
  assert.ok(allowedDungeons(data, game).every((d) => d.rank === 1));
  game.rank = 'R02';
  assert.ok(allowedDungeons(data, game).some((d) => d.rank === 2));
  const srs = readJson('srs.json');
  const d2 = [...data.dungeons.values()].find((d) => d.rank === 2);
  assert.ok(allowedStones(srs, lex, d2).every((s) => s.star >= 2));
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
  const { catalog, ...progress } = s.game;
  const { catalog: priorCatalog, ...priorProgress } = before;
  assert.deepEqual(progress, priorProgress);
  assert.deepEqual(catalog.gear, priorCatalog?.gear ?? []);
  assert.ok(catalog.monsters.length > 0); // 敗戦で得た魔物の知識は次の挑戦へ残る
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
