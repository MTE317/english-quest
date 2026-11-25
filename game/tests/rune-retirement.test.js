import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { computeStats, maxHp, maxMp } from '../js/character.js';
import { memberMods } from '../js/growth.js';
import { battleStats, battleRewards, createBattle, makeEnemy } from '../js/battle.js';
import { GameSession } from '../js/save.js';
import { LEARNING_KEY } from '../js/storage.js';
import { MemoryStorage, readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const specs = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => createNewGame(data, specs);

function legacy() {
  const game = fresh();
  game.runeEffects = { rs_1_001: 'hp', rs_2_001: 'exp', rs_3_001: 'gold' };
  game.party[0].runeSlots = 3;
  game.party[0].runes = ['rs_1_001', 'rs_2_001', 'rs_3_001'];
  game.party[0].runeMods = { hp: 0.2, xp: 0.1, gold: 0.1 };
  game.party[1].runeSlots = 2;
  game.party[1].runes = [];
  game.party[1].runeMods = {};
  return game;
}

function assertRetired(game) {
  assert.equal(Object.hasOwn(game, 'runeEffects'), false);
  for (const member of game.party) {
    for (const key of ['runes', 'runeSlots', 'runeMods']) assert.equal(Object.hasOwn(member, key), false, key);
  }
}

test('旧ルーンの全能力・経験値・お金補正は移行前のデータが残っていても作用しない', () => {
  const game = fresh();
  const battle = createBattle(data, game, { enemies: [makeEnemy(data, 'slime', { lv: 3 })], seed: 17 });
  const originalStats = game.party.map((m) => computeStats(data, m));
  const originalBattleStats = game.party.map((_, i) => battleStats(data, game, battle, i));
  const originalMods = game.party.map((m) => memberMods(data, m));
  const originalRewards = battleRewards(data, game, battle);
  for (const member of game.party) {
    member.runeMods = Object.fromEntries(['hp', 'mp', 'str', 'mag', 'def', 'res', 'spd', 'luk', 'sres', 'xp', 'gold'].map((key) => [key, 0.5]));
    member.runes = ['rs_1_001'];
  }
  assert.deepEqual(game.party.map((m) => computeStats(data, m)), originalStats);
  assert.deepEqual(game.party.map((_, i) => battleStats(data, game, battle, i)), originalBattleStats);
  assert.deepEqual(game.party.map((m) => memberMods(data, m)), originalMods);
  assert.deepEqual(battleRewards(data, game, battle), originalRewards);
});

test('解放済みの枠は累計費用を一度だけ返還し、旧装備データを除く', () => {
  const game = legacy();
  const beforeGold = game.gold;
  const beforeInventory = structuredClone(game.storage);
  normalizeGame(data, game);
  assertRetired(game);
  assert.equal(game.gold, beforeGold + 70000); // 3枠の 0+1000+5000 と、2枠の 0+1000
  assert.deepEqual(game.storage, beforeInventory);
  assert.deepEqual(game.runeRetirement, { version: 1, gold: 70000, materials: {} });
  assert.equal(game.notices.filter((s) => s.includes('返還')).length, 1);
  const once = structuredClone(game);
  normalizeGame(data, game);
  assert.deepEqual(game, once);
});

test('素材が必要だった枠も返還し、装着数や系統選択だけから費用を推測しない', () => {
  const game = legacy();
  game.storage.materials.goblin_mat = 3;
  const migrationData = { ...data, kokuinSlots: [
    { slot: 1, gold: 0, materials: '' },
    { slot: 2, gold: 1000, materials: 'goblin_mat:2' },
    { slot: 3, gold: 5000, materials: 'goblin_mat:1|cave_rat_mat:4' },
  ] };
  normalizeGame(migrationData, game);
  assert.equal(game.storage.materials.goblin_mat, 8);
  assert.equal(game.storage.materials.cave_rat_mat, 4);
  const gold = game.gold;
  normalizeGame(migrationData, game);
  assert.equal(game.gold, gold);
  assert.equal(game.storage.materials.goblin_mat, 8);

  const unknown = fresh();
  unknown.runeEffects = { rs_1_001: 'str' };
  unknown.party[0].runes = ['rs_1_001'];
  const unknownGold = unknown.gold;
  normalizeGame(data, unknown);
  assert.equal(unknown.gold, unknownGold);
  assert.equal(unknown.runeRetirement.gold, 0);
  assertRetired(unknown);
});

test('廃止後のHP・MP上限を反映し、負傷や戦闘不能を回復しない', () => {
  const game = legacy();
  const [full, fallen, injured, caster] = game.party;
  full.hp = maxHp(data, full) + 50;
  full.mp = maxMp(data, full) + 20;
  fallen.hp = 0;
  injured.hp = 1;
  injured.mp = 0;
  injured.runeMods = { hp: 0.1 };
  caster.runeMods = { mp: 0.1 };
  caster.mp = 1;
  normalizeGame(data, game);
  assert.equal(full.hp, maxHp(data, full));
  assert.equal(full.mp, maxMp(data, full));
  assert.equal(fallen.hp, 0);
  assert.equal(injured.hp, 1);
  assert.equal(injured.mp, 0);
  assert.equal(caster.mp, 1);
});

test('遠征中のセーブと入場時の写しを移行し、再読込・全滅でも返還や旧能力が重複しない', () => {
  const storage = new MemoryStorage();
  const learningRaw = JSON.stringify({ v: 1, words: { word1: [1, 2, 3, 4, 5, 6, 7, 8, 1] }, awakened: { rs_1_001: { day: 4 } } });
  storage.setItem(LEARNING_KEY, learningRaw);
  const session = new GameSession({ storage });
  const initial = legacy();
  session.startNew(initial);
  session.enterDungeon({ dungeonId: 'mossy_cave', stoneId: 'rs_1_001' });
  session.setBattle(createBattle(data, session.game, { enemies: [makeEnemy(data, 'slime', { lv: 3 })], seed: 7 }));
  session.game.gold += 300;
  session.game.party[0].hp = 0;
  const battleBefore = structuredClone(session.run.battle);
  normalizeGame(data, session.game, session.run);
  session.save();
  assert.equal(session.game.gold, initial.gold + 70000 + 300);
  assert.equal(session.run.snapshot.gold, initial.gold + 70000);
  assert.equal(session.game.party[0].hp, 0);
  assert.deepEqual(session.run.battle, battleBefore);
  assertRetired(session.game);
  assertRetired(session.run.snapshot);
  assert.equal(storage.getItem(LEARNING_KEY), learningRaw);

  const resumed = new GameSession({ storage });
  normalizeGame(data, resumed.game, resumed.run);
  resumed.save();
  assert.equal(resumed.game.gold, initial.gold + 70000 + 300);
  resumed.wipe();
  const afterWipe = new GameSession({ storage });
  normalizeGame(data, afterWipe.game, afterWipe.run);
  afterWipe.save();
  assert.equal(afterWipe.game.gold, initial.gold + 70000);
  assertRetired(afterWipe.game);
  assert.equal(afterWipe.game.notices.filter((s) => s.includes('返還')).length, 1);
  assert.equal(storage.getItem(LEARNING_KEY), learningRaw);
});

test('新規ゲームには返還や旧刻印の記録を付けない', () => {
  const game = fresh();
  assert.equal(game.gold, data.balance.new_game.gold);
  assert.equal(game.runeRetirement, undefined);
  assertRetired(game);
});
