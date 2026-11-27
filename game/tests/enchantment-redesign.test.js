import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEffects } from '../js/gamedata.js';
import { rollSet, uniqueCandidates, rerollValue, numericEffect } from '../js/enchantment-roll.js';
import { enchant, reroll, craft } from '../js/workshop.js';

const read = path => readFileSync(fileURLToPath(new URL('../../data/' + path, import.meta.url)), 'utf8')
  .replace(/^\uFEFF/, '').trim().split(/\r?\n/);
const csv = path => { const [header, ...lines] = read(path); const keys = header.split(',');
  return lines.map(line => Object.fromEntries(line.split(',').map((v, i) => [keys[i], v]))); };
const data = () => ({
  affixes: csv('affixes.csv').map(row => ({ ...row, min: Number(row.min), max: Number(row.max),
    scales: row.scales_with_item_lv === '1', weight: Number(row.weight) })),
  enchantOverrides: csv('enchant_overrides.csv').map(row => ({ ...row, max: Number(row.max) })),
  equipmentTiers: new Map(csv('equipment_tiers.csv').map(row => [Number(row.star), { affixScale: Number(row.affix_scale) }])),
  rarityTable: csv('rarities.csv').map(row => ({ id: row.id, effects: Number(row.random_effects), effectMul: Number(row.effect_mul) })),
  elements: new Map(['slash', 'strike', 'pierce', 'fire', 'ice', 'wind', 'earth', 'thunder', 'water', 'light', 'dark']
    .map(id => [id, { id }])),
  monsterTypes: new Map([['dragon', {}], ['beast', {}]]),
  statusEffects: new Map(['burn', 'bleed', 'poison', 'freeze', 'blind'].map(id => [id, { id }])),
  enchantGrades: [{ workshop_rank: 1, value_mul: 0.7 }, { workshop_rank: 4, value_mul: 1 }],
  economy: new Map([[1, { craft_gold: 400 }], [4, { craft_gold: 2400 }]]),
  recipes: [], materials: new Map(), equipment: new Map(),
});
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

test('通常ドロップの効果総数は各レアリティの範囲内', () => {
  const d = data(), def = { id: 'gear', slot: 'weapon', star: 1 };
  for (const [rarity, min, max] of [['common', 0, 2], ['rare', 2, 4], ['origin', 5, 7]]) {
    for (let n = 0; n < 30; n++) {
      const { affixes } = rollSet(d, def, rarity, seq(n / 30, 0.21, 0.54, 0.75));
      assert.ok(Object.keys(affixes).length >= min && Object.keys(affixes).length <= max);
    }
  }
});

test('全レシピとボス装備の固有候補が4種類で数値も有効', () => {
  const d = data();
  for (const row of csv('recipes.csv')) {
    const def = { id: row.id, slot: row.slot, star: Number(row.workshop_rank), recipeId: row.id,
      addedElement: row.added_element, fixedEffects: parseEffects(row.fixed_effects) };
    const pool = uniqueCandidates(d, def);
    assert.equal(Object.keys(pool).length, 4, row.id);
    assert.ok(Object.values(pool).every(Number.isFinite), row.id);
  }
  for (const row of csv('uniques.csv')) {
    const def = { id: row.id, slot: row.slot, unique: true, fixedEffects: parseEffects(row.fixed_effects) };
    const pool = uniqueCandidates(d, def);
    assert.equal(Object.keys(pool).length, 4, row.id);
    assert.ok(Object.values(pool).every(Number.isFinite), row.id);
  }
});

test('ユニークは固有2〜4個、共通0〜2個で重複しない', () => {
  const d = data(), def = { id: 'fist', unique: true, slot: 'weapon', star: 1,
    fixedEffects: parseEffects('STR:4|CRT:4|MAG:4|経験値:8') };
  for (let n = 0; n < 30; n++) {
    const rolled = rollSet(d, def, 'unique', seq(n / 30, 0.1, 0.3, 0.8, 0.5));
    const origins = Object.values(rolled.origins);
    assert.ok(origins.filter(x => x === 'unique').length >= 2 && origins.filter(x => x === 'unique').length <= 4);
    assert.ok(origins.filter(x => x === 'common').length <= 2);
    assert.equal(Object.keys(rolled.affixes).length, origins.length);
  }
});

test('施設ランクを使った①②は★別ゴールドと粉10個を消費し、②は種類と個数を維持', () => {
  const d = data(), def = { id: 'fist', unique: true, slot: 'weapon', star: 1,
    fixedEffects: parseEffects('STR:4|CRT:4|MAG:4|経験値:8') };
  d.equipment.set(def.id, def);
  const gear = { id: def.id, rarity: 'unique', affixes: { STR: 5, CRT: 4 },
    affixOrigins: { STR: 'unique', CRT: 'unique' } };
  const game = { gold: 2000, facilities: { workshop: 4 }, storage: { materials: { enchant_powder: 30 } } };
  reroll(d, game, gear, 'STR', seq(0));
  assert.equal(gear.affixes.STR, 3.2);
  assert.deepEqual(Object.keys(gear.affixes), ['STR', 'CRT']);
  assert.equal(game.gold, 1200);
  assert.equal(game.storage.materials.enchant_powder, 20);
  enchant(d, game, gear, null, seq(0.5, 0.2, 0.3, 0.4, 0.1, 0.6));
  assert.equal(game.gold, 400);
  assert.equal(game.storage.materials.enchant_powder, 10);
  assert.ok(Object.values(gear.affixOrigins).filter(x => x === 'unique').length >= 2);
});

test('制作時にユニークを抽選し、カテゴリー効果は数値再抽選できない', () => {
  const d = data(), def = { id: 'flame_sword', name: '炎の剣', recipeId: 'flame_sword',
    source: '専用制作', slot: 'weapon', star: 1, addedElement: 'fire', fixedEffects: parseEffects('STATUS_ON_HIT:burn:12') };
  d.equipment.set(def.id, def);
  d.recipes.push({ id: def.id, workshop_rank: 1, materials: 'stone:1', gold: 50 });
  const game = { gold: 100, facilities: { workshop: 1 }, nextUid: 1,
    storage: { materials: { stone: 1 }, gear: [] } };
  craft(d, game, def, seq(0.5, 0.2, 0.6, 0.1));
  assert.equal(game.storage.gear[0].rarity, 'unique');
  assert.ok(Object.values(game.storage.gear[0].affixOrigins).filter(x => x === 'unique').length >= 2);
  assert.equal(numericEffect('ELEMENT:fire'), false);
  assert.throws(() => rerollValue(d, def, { affixes: { 'ELEMENT:fire': 1 } }, 'ELEMENT:fire', seq(0), 1));
});
