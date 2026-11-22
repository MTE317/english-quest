import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { makeGear } from '../js/character.js';
import { MemoryStorage, readCsv, readJson, T0 } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const fresh = () => createNewGame(data, ['thief', 'warrior', 'knight', 'white_mage'].map((job) => ({ job, name: job, icon: 'x' })));
function legacyCraft(game, id = 'craft_dagger_s2') {
  const gear = makeGear(game, id, { quality: 1.15, enh: 7, affixes: { 'STATUS_ON_HIT:poison': 20, OLD_FIXED: 99 } });
  gear.crafted = true;
  gear.enchants = [{ stat: 'STATUS_RATE', value: 8.4 }, { stat: 'ELEMENT:fire', value: 1 }];
  gear.enhanceFailures = 2;
  return gear;
}
const withoutAffixes = ({ affixes, ...rest }) => rest;

test('装備中・倉庫内の専用制作だけ現行効果へ更新し、UID・品質・強化・付与を維持する', () => {
  const game = fresh();
  const equipped = legacyCraft(game);
  const stored = legacyCraft(game, 'shadow_scythe');
  game.party[0].equip.weapon = equipped;
  game.storage.gear.push(stored);
  const oldEquipped = structuredClone(equipped); const oldStored = structuredClone(stored);
  const enchantments = equipped.enchants;
  assert.equal(normalizeGame(data, game), game);
  assert.deepEqual(equipped.affixes, data.equipment.get(equipped.id).fixedEffects);
  assert.deepEqual(stored.affixes, data.equipment.get(stored.id).fixedEffects);
  assert.deepEqual(withoutAffixes(equipped), withoutAffixes(oldEquipped));
  assert.deepEqual(withoutAffixes(stored), withoutAffixes(oldStored));
  assert.strictEqual(equipped.enchants, enchantments);
  assert.notStrictEqual(equipped.affixes, data.equipment.get(equipped.id).fixedEffects);
  equipped.affixes.DOT_POWER = 999;
  assert.notEqual(data.equipment.get(equipped.id).fixedEffects.DOT_POWER, 999);
});

test('通常ランダム装備・通常制作品・固有品・セット品・未知IDは変更しない', () => {
  const game = fresh();
  const unique = [...data.equipment.values()].find((def) => def.unique);
  const set = [...data.equipment.values()].find((def) => def.setId);
  assert.ok(unique && set);
  const local = { ...data, equipment: new Map(data.equipment) };
  // 将来の追加データに recipeId があっても、固有・セットの保護条件を優先する。
  local.equipment.set(unique.id, { ...unique, recipeId: 'future_unique_recipe' });
  local.equipment.set(set.id, { ...set, recipeId: 'future_set_recipe' });
  const definitions = [
    ['dagger_t4', false], ['dagger_t4', true], ['craft_dagger_s2', false],
    [unique.id, true], [set.id, true], ['removed_recipe_id', true],
  ];
  game.storage.gear = definitions.map(([id, crafted]) => ({
    ...makeGear(game, id, { affixes: { CRT: 7, LIFESTEAL: 4 } }), crafted,
    enchants: [{ stat: 'HP', value: 27.5 }],
  }));
  const before = structuredClone(game.storage.gear);
  normalizeGame(local, game);
  assert.deepEqual(game.storage.gear, before);
});

test('現ゲームと入場時の写しを独立した効果辞書で更新し、経路・進行・戦闘を変えない', () => {
  const game = fresh(); game.gold = 0;
  game.party[0].equip.weapon = legacyCraft(game);
  game.storage.gear.push(legacyCraft(game, 'shadow_scythe'));
  const snapshot = structuredClone(game);
  // 別々の装備が旧効果の辞書を共有していても、移行後は相互に影響しない。
  snapshot.party[0].equip.weapon.affixes = game.party[0].equip.weapon.affixes;
  const run = { snapshot, dungeonId: 'mossy_cave', floor: 2, battleIndex: 1, battlesDone: 3,
    route: [{ floor: 1, battles: 2 }, { floor: 2, battles: 3 }], layoutVersion: 1,
    battle: { rng: 31415, round: 2, turn: { side: 'ally', i: 2 }, pending: { actor: 2, action: { type: 'attack', target: 1 } },
      enemies: [{ hp: 80, statuses: { poison: { turns: 2, n: 1 } } }] } };
  const { snapshot: ignored, ...beforeRun } = structuredClone(run);
  normalizeGame(data, game, run);
  const { snapshot: updated, ...afterRun } = run;
  assert.deepEqual(afterRun, beforeRun);
  for (const container of [game, updated]) {
    assert.equal(container.gold, 0);
    assert.deepEqual(container.party[0].equip.weapon.affixes, data.equipment.get('craft_dagger_s2').fixedEffects);
    assert.deepEqual(container.storage.gear[0].affixes, data.equipment.get('shadow_scythe').fixedEffects);
  }
  const currentGear = game.party[0].equip.weapon; const snapshotGear = updated.party[0].equip.weapon;
  assert.notStrictEqual(currentGear, snapshotGear);
  assert.notStrictEqual(currentGear.affixes, snapshotGear.affixes);
  assert.notStrictEqual(currentGear.enchants, snapshotGear.enchants);
  currentGear.affixes.DOT_POWER = 123;
  currentGear.enchants[0].value = 321;
  assert.notEqual(snapshotGear.affixes.DOT_POWER, 123);
  assert.notEqual(snapshotGear.enchants[0].value, 321);
});

test('移行後のセーブ再読込と全滅でも、更新済みの固定効果へ復元する', () => {
  const memory = new MemoryStorage();
  const session = new GameSession({ storage: memory, now: () => T0 });
  const old = fresh(); old.gold = 0;
  old.party[0].equip.weapon = legacyCraft(old);
  old.storage.gear.push(legacyCraft(old, 'shadow_scythe'));
  session.startNew(old);
  session.enterDungeon({ dungeonId: 'mossy_cave', route: [{ floor: 1, battles: 2 }] });
  session.updateRun((run, game) => { game.gold = 230; run.floor = 2; });
  const resumed = new GameSession({ storage: memory, now: () => T0 });
  normalizeGame(data, resumed.game, resumed.run);
  resumed.save();
  const reloaded = new GameSession({ storage: memory, now: () => T0 });
  assert.equal(reloaded.game.gold, 230);
  assert.equal(reloaded.run.snapshot.gold, 0);
  reloaded.wipe();
  assert.equal(reloaded.game.gold, 0);
  assert.deepEqual(reloaded.game.party[0].equip.weapon.affixes, data.equipment.get('craft_dagger_s2').fixedEffects);
  assert.deepEqual(reloaded.game.storage.gear[0].affixes, data.equipment.get('shadow_scythe').fixedEffects);
  const afterWipe = new GameSession({ storage: memory, now: () => T0 });
  assert.deepEqual(afterWipe.game, reloaded.game);
});

test('二度移行しても値は変わらず、旧所持金は0Gを含めて維持する', () => {
  for (const gold of [0, 17, 1000, 45678]) {
    const game = fresh(); game.gold = gold;
    game.party[0].equip.weapon = legacyCraft(game);
    const run = { snapshot: structuredClone(game), route: [{ floor: 1, battles: 2 }], battle: { rng: 42 } };
    normalizeGame(data, game, run);
    const once = structuredClone({ game, run });
    normalizeGame(data, game, run);
    assert.deepEqual({ game, run }, once);
    assert.equal(game.gold, gold); assert.equal(run.snapshot.gold, gold);
  }
  assert.equal(normalizeGame(data, null), null);
});
