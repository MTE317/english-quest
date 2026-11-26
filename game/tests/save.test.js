import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSession, SaveStore, SAVE_VERSION } from '../js/save.js';
import { LearningStore, SAVE_KEY, LEARNING_KEY } from '../js/storage.js';
import { Scheduler } from '../js/srs.js';
import { encounterMonsters, learnMonsterElements } from '../js/monster-knowledge.js';
import { MemoryStorage, readJson, T0 } from './helpers.js';

const newGame = () => ({ day: 1, gold: 100, materials: { goblin_mat: 2 }, gear: [] });
const sch = new Scheduler(readJson('srs.json'));

/** 閉じて開き直したのと同じ：同じ保存場所から新しく読む */
const reopen = (mem) => new GameSession({ storage: mem, now: () => T0 });

test('セーブがなければ hasSave は false。はじめからで保存される', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  assert.equal(s.hasSave, false);
  assert.equal(s.loadStatus, 'none');
  s.startNew(newGame());
  const again = reopen(mem);
  assert.equal(again.hasSave, true);
  assert.deepEqual(again.game, newGame());
  assert.equal(again.state.version, SAVE_VERSION);
});

test('自動保存は1つ：変えるたびに同じ場所に上書き', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame());
  s.update((g) => { g.gold += 50; });
  s.update((g) => { g.day += 1; });
  const keys = [...mem.m.keys()];
  assert.deepEqual(keys, [SAVE_KEY]);
  assert.equal(reopen(mem).game.gold, 150);
  assert.equal(reopen(mem).game.day, 2);
});

test('戦闘が終わるたびに保存され、ダンジョンの途中で閉じても続きから', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame());
  s.enterDungeon({ dungeonId: 'mossy_cave', stoneId: 'rs_1_001' });
  s.setBattle({ enemies: [{ id: 'slime', hp: 30 }], turn: 1 });
  s.endBattle((g) => { g.gold += 12; g.materials.goblin_mat += 1; });
  s.updateRun((run) => { run.floor = 2; });
  const again = reopen(mem);
  assert.equal(again.inDungeon, true);
  assert.equal(again.inBattle, false);
  assert.equal(again.run.floor, 2);
  assert.equal(again.run.battlesDone, 1);
  assert.equal(again.game.gold, 112);
});

test('戦闘の途中で閉じたら、同じ戦闘の同じところから（やり直しはできない）', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame());
  s.enterDungeon({ dungeonId: 'mossy_cave', stoneId: 'rs_1_001' });
  s.setBattle({ enemies: [{ id: 'slime', hp: 30 }], party: [{ hp: 5 }], turn: 1, seed: 42 });
  s.setBattle({ enemies: [{ id: 'slime', hp: 18 }], party: [{ hp: 1 }], turn: 2, seed: 42 });
  const again = reopen(mem);
  assert.equal(again.inBattle, true);
  assert.deepEqual(again.run.battle, { enemies: [{ id: 'slime', hp: 18 }], party: [{ hp: 1 }], turn: 2, seed: 42 });
});

test('全滅：入る前に戻り、すぐ保存される。開き直しても全滅はなかったことにならない', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame());
  s.update((g) => { g.day = 5; });
  s.enterDungeon({ dungeonId: 'mossy_cave', stoneId: 'rs_1_001' });
  s.updateRun((run, g) => { g.day += 2; });
  s.endBattle((g) => { g.gold += 999; g.gear.push({ id: 'iron_sword' }); g.materials.goblin_mat = 50; });
  s.setBattle({ turn: 3 });
  s.wipe();
  const again = reopen(mem);
  assert.equal(again.inDungeon, false);
  assert.deepEqual(again.game, { day: 5, gold: 100, materials: { goblin_mat: 2 }, gear: [] });
  assert.equal(again.state.lastWipe.dungeonId, 'mossy_cave');
});

test('全滅しても学習記録は残る', () => {
  const mem = new MemoryStorage();
  const learning = new LearningStore(mem);
  const s = reopen(mem);
  s.startNew(newGame());
  s.enterDungeon({ dungeonId: 'mossy_cave', stoneId: 'rs_1_001' });
  learning.recordAnswer('lx_r1_001', sch.review(null, true, T0), sch.dayOf(T0), true);
  s.wipe();
  const after = new LearningStore(mem);
  assert.equal(after.get('lx_r1_001').correct, 1);
  assert.equal(after.dailyTotal(sch.dayOf(T0)).answered, 1);
  assert.ok(mem.getItem(LEARNING_KEY));
});

test('全滅しても図鑑は残り、報酬と依頼進捗は入場時に戻す', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  const before = {
    ...newGame(),
    party: [{ lv: 2, xp: 4, ap: { warrior: 2 }, learned: ['slash_1'] }],
    items: { potion: 3 },
    kills: { goblin: 2 },
    quests: [{ uid: 1, progress: 0, depositPaid: 30 }],
    catalog: {
      gear: ['wood_sword'], monsters: ['goblin'],
      affinities: { goblin: { elements: ['slash'], scanned: false } },
    },
  };
  s.startNew(before);
  s.enterDungeon({ dungeonId: 'mossy_cave' });
  const goblin = { monsterId: 'goblin', weak: ['fire', 'wind'], resist: ['dark'] };
  const boss = { monsterId: 'owl_boss', weak: ['ice', 'wind'], resist: ['fire', 'light'] };
  s.updateRun((run, game) => {
    encounterMonsters(game, [goblin, boss, { monsterId: 'unexamined_slime' }]);
    learnMonsterElements(game, goblin, ['fire', 'dark', 'none']);
    learnMonsterElements(game, boss, boss.weak, true);
    game.gold += 400;
    game.materials.goblin_mat += 5;
    game.gear.push({ id: 'iron_sword' });
    game.catalog.gear.push('iron_sword');
    game.party[0] = { lv: 3, xp: 20, ap: { warrior: 6 }, learned: ['slash_1', 'slash_2'] };
    game.items.potion -= 2;
    game.quests[0].progress = 1;
    game.kills.goblin += 1;
    game.catalog.defeats = { goblin: 3 };
  });
  const resumed = reopen(mem);
  resumed.wipe();
  const expectedCatalog = {
    gear: ['wood_sword'], monsters: ['goblin', 'owl_boss', 'unexamined_slime'],
    affinities: {
      goblin: { elements: ['slash', 'fire', 'dark', 'none'], scanned: false },
      owl_boss: { elements: ['ice', 'wind'], scanned: true },
    },
    defeats: { goblin: 3 }, sightings: {},
  };
  assert.deepEqual(resumed.game, { ...before, catalog: expectedCatalog });
  assert.deepEqual(reopen(mem).game, { ...before, catalog: expectedCatalog });
});

test('旧セーブでも遠征中の初遭遇と相性調査は全滅後に残る', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame()); // 旧セーブには catalog 自体がない
  const enemy = { monsterId: 'slime' };
  s.enterDungeon({ dungeonId: 'mossy_cave' });
  s.updateRun((run, game) => {
    encounterMonsters(game, [enemy]);
    learnMonsterElements(game, enemy, ['fire']);
  });
  s.wipe();
  s.enterDungeon({ dungeonId: 'mossy_cave' });
  s.updateRun((run, game) => {
    encounterMonsters(game, [enemy]);
    learnMonsterElements(game, enemy, ['fire', 'ice'], true);
  });
  s.wipe();
  assert.deepEqual(reopen(mem).game.catalog.monsters, ['slime']);
  assert.deepEqual(reopen(mem).game.catalog.affinities.slime, { elements: ['fire', 'ice'], scanned: true });
});

test('町に帰ると run がなくなり、ダンジョンで得たものは残る', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame());
  s.enterDungeon({ dungeonId: 'mossy_cave' });
  s.endBattle((g) => { g.gold += 30; });
  assert.throws(() => { s.setBattle({}); s.leaveDungeon(); }, /戦闘の途中/);
  s.endBattle();
  s.leaveDungeon();
  const again = reopen(mem);
  assert.equal(again.inDungeon, false);
  assert.equal(again.game.gold, 130);
});

test('ダンジョンの中で入り直すことはできない', () => {
  const s = reopen(new MemoryStorage());
  s.startNew(newGame());
  s.enterDungeon({ dungeonId: 'a' });
  assert.throws(() => s.enterDungeon({ dungeonId: 'b' }));
});

test('壊れたセーブは別の場所に残し、broken として知らせる', () => {
  const mem = new MemoryStorage();
  mem.setItem(SAVE_KEY, '{こわれている');
  const s = reopen(mem);
  assert.equal(s.loadStatus, 'broken');
  assert.equal(s.hasSave, false);
  assert.equal(mem.getItem(`${SAVE_KEY}.broken`), '{こわれている');
});

test('新しい版のセーブは読めるが上書きしない', () => {
  const mem = new MemoryStorage();
  const raw = JSON.stringify({ version: SAVE_VERSION + 1, game: { x: 1 }, run: null });
  mem.setItem(SAVE_KEY, raw);
  const s = reopen(mem);
  assert.equal(s.loadStatus, 'newer');
  assert.equal(s.save(), false);
  assert.throws(() => s.update(() => {}));
  assert.equal(mem.getItem(SAVE_KEY), raw);
});

test('閉じるとき（pagehide）にも保存する', () => {
  const mem = new MemoryStorage();
  const s = reopen(mem);
  s.startNew(newGame());
  s.state.game.gold = 777; // 保存せずに変えた
  const listeners = {};
  const target = { addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener() {} };
  s.installAutoSave(target);
  listeners.pagehide();
  assert.equal(reopen(mem).game.gold, 777);
});

test('SaveStore：はじめからで学習記録は消えない', () => {
  const mem = new MemoryStorage();
  mem.setItem(LEARNING_KEY, '{"v":1,"words":{}}');
  const s = reopen(mem);
  s.startNew(newGame());
  s.deleteSave();
  assert.equal(new SaveStore(mem).read().status, 'none');
  assert.ok(mem.getItem(LEARNING_KEY));
});
