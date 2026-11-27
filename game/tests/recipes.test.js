import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { craft, brew, canCraft, canBrew } from '../js/workshop.js';
import { parseMaterialNeed, matchesNeed } from '../js/town.js';
import { canEquip, computeStats, gearEffects, makeGear, maxHp } from '../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending, skillMp, battleStats } from '../js/battle.js';
import { uniqueCandidates } from '../js/enchantment-roll.js';
import { readCsv, readJson, seededRng } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const party = (job = 'warrior') => [job, 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
  .map((j) => ({ job: j, name: j, icon: 'x' }));
const fresh = (job = 'warrior') => {
  const game = createNewGame(data, party(job));
  // このファイルは制作の入出庫だけを比較するため、開始時の支給品を除く。
  game.storage.gear = [];
  return game;
};

function supply(game, recipeId) {
  const row = data.recipes.find((r) => r.id === recipeId);
  assert.ok(row, recipeId);
  game.gold = Math.max(game.gold, 1000000);
  const facility = 'workshop';
  game.facilities[facility] = Math.max(game.facilities[facility] ?? 1, Number(row.workshop_rank));
  for (const entry of row.materials.split('|')) {
    const [id, qty] = entry.split(':');
    game.storage.materials[id] = (game.storage.materials[id] ?? 0) + Number(qty);
  }
  return data.equipment.get(recipeId);
}

function attackWith(id, job = 'thief', seed = 1, ready = () => {}) {
  const game = fresh(job);
  const m = game.party[0];
  const def = data.equipment.get(id);
  m.equip.weapon = makeGear(game, id, { affixes: { ...def.fixedEffects } });
  m.equip.offhand = null;
  const e = makeEnemy(data, 'slime', { lv: 3 });
  e.maxHp = e.hp = 100000; e.spd = 0; e.def = e.res = 30;
  const b = createBattle(data, game, { enemies: [e], seed });
  ready(game, m, b, e);
  b.turn = { side: 'ally', i: 0 };
  setPending(b, { type: 'attack', target: 0 }, {});
  resolvePending(data, game, b, true);
  return { game, m, b, e };
}

test('専用制作レシピ171件、各武器6件以上、防具27件、マント10件、装飾品20件', () => {
  assert.equal(data.recipes.length, 171);
  const counts = {};
  for (const row of data.recipes) {
    const def = data.equipment.get(row.id);
    assert.ok(def, row.id);
    assert.equal(def.source, '専用制作');
    assert.ok(data.equipment.has(row.base_equipment_id));
    assert.ok(Number.isFinite(Number(row.gold)) && Number(row.gold) > 0);
    assert.ok(Object.keys(def.fixedEffects ?? {}).length > 0, row.id);
    for (const token of row.materials.split('|')) {
      const [id, qty] = token.split(':');
      assert.ok(data.materials.has(id), id);
      assert.ok(Number(qty) >= 1, token);
    }
    counts[def.slot] = (counts[def.slot] ?? 0) + 1;
  }
  assert.deepEqual(counts, { weapon: 114, head: 9, body: 9, arm: 9, cloak: 10, accessory: 20 });
  for (const type of data.weaponTypes.keys()) {
    const n = data.recipes.filter((r) => r.weapon_type === type).length;
    assert.ok(n >= 6, `${type}: ${n}`);
  }
});

test('通常制作と調合の実行ボタンは費用・素材・持ち物上限を反映する', () => {
  const g = fresh();
  const def = data.equipment.get('sword_t1');
  const recipe = data.alchemyRecipes.find((r) => r.id === 'rc_buff_str_1');
  g.gold = 100000;
  assert.equal(canCraft(data, g, def), false);
  assert.equal(canBrew(data, g, recipe), false);
  g.storage.materials.goblin_mat = 4;
  g.storage.materials.cave_rat_mat = 4;
  assert.equal(canCraft(data, g, def), true);
  assert.equal(canBrew(data, g, recipe), true);
  g.gold = 0;
  assert.equal(canCraft(data, g, def), false);
  assert.equal(canBrew(data, g, recipe), false);
  g.gold = 100000;
  craft(data, g, def);
  brew(data, g, recipe);
  assert.equal(g.storage.gear.at(-1).id, def.id);
  g.items[recipe.result] = 9;
  assert.equal(canBrew(data, g, recipe), false);
});

test('★2の属性素材を使う調合を完了できる', () => {
  const g = fresh();
  const recipe = data.alchemyRecipes.find((r) => r.id === 'rc_resist_fire_1');
  const need = parseMaterialNeed(data, recipe.materials)[0];
  const mat = [...data.materials.values()].find((m) => matchesNeed(data, m.id, need));
  assert.ok(mat);
  g.gold = 100000;
  g.facilities.alchemy = 2;
  g.storage.materials[mat.id] = need.count;
  assert.equal(canBrew(data, g, recipe), true);
  brew(data, g, recipe);
  assert.equal(g.storage.materials[mat.id] ?? 0, 0);
  assert.equal(g.items[recipe.result], Number(recipe.qty));
});

test('専用の毒短剣を制作すると固有効果が保存され、素材とお金を消費する', () => {
  const g = fresh();
  const def = supply(g, 'craft_dagger_s2');
  const gold = g.gold;
  const materials = { ...g.storage.materials };
  craft(data, g, def, seededRng(167));
  const item = g.storage.gear[0];
  assert.ok(item.crafted);
  assert.equal(item.id, 'craft_dagger_s2');
  // #166以降は候補から2〜4個を抽選する。毒の固定20%を必須にしない。
  const unique = Object.keys(item.affixes).filter(key => item.affixOrigins[key] === 'unique');
  assert.ok(unique.length >= 2 && unique.length <= 4);
  assert.ok(unique.every(key => key in uniqueCandidates(data, def)));
  assert.ok(Object.values(item.affixes).every(Number.isFinite));
  assert.ok(g.gold < gold);
  assert.ok(Object.keys(materials).some((id) => g.storage.materials[id] !== materials[id]));
  assert.equal(data.equipment.get('dagger_t4').fixedEffects, undefined);
});

test('派生制作は制作済みの元装備を要求し、使用した元装備を倉庫から消費する', () => {
  const g = fresh();
  const next = supply(g, 'craft_dagger_s8');
  assert.throws(() => craft(data, g, next), /派生元/);
  const previous = supply(g, 'craft_dagger_s6');
  craft(data, g, previous);
  assert.ok(g.storage.gear.some((it) => it.id === previous.id));
  craft(data, g, next);
  assert.ok(g.storage.gear.some((it) => it.id === next.id));
  assert.ok(!g.storage.gear.some((it) => it.id === previous.id));
});

test('重装防具・マント・アクセサリーが個別スロットへ制作でき、能力に反映される', () => {
  const g = fresh();
  for (const id of ['craft_heavy_body_s3', 'craft_cloak_1_s2', 'craft_ring_1_s2']) {
    const def = supply(g, id);
    craft(data, g, def, seededRng(167));
  }
  const w = g.party[0];
  const slots = ['body', 'cloak', 'accessory1'];
  const before = computeStats(data, w);
  for (let i = 0; i < slots.length; i++) {
    const item = g.storage.gear[i];
    assert.equal(canEquip(data, w, slots[i], item).ok, true);
    w.equip[slots[i]] = item;
  }
  const after = computeStats(data, w);
  assert.ok(after.def > before.def);
  // 特定の候補を必須にせず、実際に抽選された効果が装備に反映されることを検証。
  for (const slot of slots) {
    const item = w.equip[slot];
    assert.ok(Object.keys(item.affixes).length >= 2);
    for (const [key, value] of Object.entries(item.affixes)) {
      assert.ok(Number.isFinite(value));
      assert.equal(gearEffects(item)[key], value);
    }
  }
});

test('専用レシピの毒付与・吸血・追撃が通常攻撃で実際に発動する', () => {
  let poison = false; let extra = false;
  for (let seed = 1; seed <= 180 && (!poison || !extra); seed++) {
    const hit = attackWith('craft_dagger_s2', 'thief', seed);
    poison ||= Boolean(hit.e.statuses.poison);
    const g = attackWith('craft_dagger_s8', 'thief', seed);
    extra ||= g.b.log.some((row) => row.includes('追加攻撃！'));
  }
  assert.ok(poison, '専用短剣の毒が付与される');
  assert.ok(extra, '専用短剣の追加攻撃が発生する');
  const lifesteal = attackWith('craft_dagger_s6', 'thief', 7, (_g, m) => {
    m.hp = Math.max(1, maxHp(data, m) - 50);
  });
  assert.ok(lifesteal.m.hp > maxHp(data, lifesteal.m) - 50);
});

test('MP節約・回復強化・全体支援の固定効果が実際の計算に入る', () => {
  const g = fresh('white_mage');
  const w = g.party[0];
  const initial = skillMp(data, w, { mp: 40 });
  const ring = data.equipment.get('craft_charm_6_s4');
  w.equip.accessory1 = makeGear(g, ring.id, { affixes: { ...ring.fixedEffects } });
  assert.ok(skillMp(data, w, { mp: 40 }) < initial);

  const heal = (staffId) => {
    const game = fresh('white_mage');
    const m = game.party[0];
    const def = data.equipment.get(staffId);
    m.equip.weapon = makeGear(game, staffId, { affixes: { ...(def.fixedEffects ?? {}) } });
    // Lv1だと通常杖でも最大HPまで回復するため、比較が上限で潰れないようにする。
    m.lv = 20;
    m.hp = 1;
    const b = createBattle(data, game, {
      enemies: [makeEnemy(data, 'slime', { lv: 1 })], seed: 3,
    });
    b.turn = { side: 'ally', i: 0 };
    m.learned = ['white_mage_A01'];
    m.loadout = { actions: ['white_mage_A01'], passives: [], ultimate: null };
    setPending(b, { type: 'skill', skillId: 'white_mage_A01', target: 0 }, {});
    const before = m.hp;
    resolvePending(data, game, b, true);
    return m.hp - before;
  };
  assert.ok(heal('craft_staff_s2') > heal('staff_t4'));

  const buff = (instrumentId, removeSupportAffix = false) => {
    const game = fresh('bard');
    const m = game.party[0];
    const def = data.equipment.get(instrumentId);
    m.equip.weapon = makeGear(game, instrumentId, { affixes: { ...(def.fixedEffects ?? {}) } });
    if (removeSupportAffix) delete m.equip.weapon.affixes.PARTY_BUFF_POWER;
    const b = createBattle(data, game, {
      enemies: [makeEnemy(data, 'slime', { lv: 1 })], seed: 3,
    });
    b.turn = { side: 'ally', i: 0 };
    m.learned = ['bard_A01'];
    m.loadout = { actions: ['bard_A01'], passives: [], ultimate: null };
    const before = battleStats(data, game, b, 0).def;
    setPending(b, { type: 'skill', skillId: 'bard_A01', target: 0 }, {});
    resolvePending(data, game, b, true);
    return battleStats(data, game, b, 0).def / before - 1;
  };
  assert.ok(buff('craft_instrument_s2') > buff('instrument_t4'));
  assert.ok(buff('craft_instrument_s2') > buff('craft_instrument_s2', true), '同じ武器のMAGを保ち、全体支援付与だけを除くと強化量が下がる');
});

