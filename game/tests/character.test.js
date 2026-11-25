import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStats, gainXp, xpToNext, canEquip, equipFromStorage, unequip, makeGear, starterGearIds, SLOTS, maxHp,
} from '../js/character.js';
import { createNewGame, PARTY_SIZE } from '../js/game-state.js';
import { realGameData, readJson } from './helpers.js';

const data = realGameData();
const party = [
  { name: 'アレン', job: 'warrior', icon: 'human_01' },
  { name: 'ベル', job: 'knight', icon: 'human_02' },
  { name: 'クロ', job: 'black_mage', icon: 'fantasy_01' },
  { name: 'シロ', job: 'white_mage', icon: 'animal_01' },
  { name: 'エル', job: 'thief', icon: 'human_03' },
  { name: 'ファ', job: 'bard', icon: 'human_04' },
];
const fresh = () => createNewGame(data, party);

test('6人・装備8枠・Lv1・HP/MP満タン・無装備で開始する', () => {
  const g = fresh();
  assert.equal(g.party.length, PARTY_SIZE);
  for (const m of g.party) {
    assert.deepEqual(Object.keys(m.equip), SLOTS);
    assert.equal(SLOTS.length, 8);
    assert.equal(m.lv, 1);
    assert.equal(m.hp, computeStats(data, m).hp);
    assert.ok(Object.values(m.equip).every(gear => gear === null), `${m.job} は無装備`);
    assert.deepEqual(m.learned, []);
    assert.equal(m.ap, data.basicJobRules.starting_ap);
  }
  const ids = starterGearIds(data, 'warrior');
  assert.equal(data.equipment.get(ids.weapon).kind, 'sword');
  assert.equal(data.equipment.get(ids.body).armorWeight, 'heavy');
  assert.throws(() => createNewGame(data, party.slice(0, 3)));
});

test('能力値は balance.json の式どおり（戦士 Lv1：HP=B, STR=A）', () => {
  const p = readJson('balance.json').player;
  const w = fresh().party[0];
  const st = computeStats(data, w);
  const g = p.grade_points;
  assert.equal(st.hp, 70 + g.B * 30);
  assert.equal(st.str, 8 + g.A * 6);
  assert.equal(st.mp, 12 + g[data.jobsById.get('warrior').grades.mp] * 6);
  assert.equal(st.attack, 0);
  assert.equal(st.def, 8 + g.B * 6);
  assert.ok(st.crit > 0 && st.crit < 1 && st.evasion > 0 && st.evasion <= 0.45);
});

test('装備を外すと能力値が下がる・倉庫に入る', () => {
  const g = fresh();
  const w = g.party[0];
  const body = makeGear(g, starterGearIds(data, w.job).body);
  w.equip.body = body;
  const storedBefore = g.storage.gear.length;
  const before = computeStats(data, w);
  unequip(data, g, w, 'body');
  assert.ok(computeStats(data, w).def < before.def);
  assert.equal(g.storage.gear.length, storedBefore + 1);
  equipFromStorage(data, g, w, 'body', body.uid);
  assert.equal(computeStats(data, w).def, before.def);
  assert.equal(g.storage.gear.length, storedBefore);
});

test('不得意な武器・防具も適性Dで装備できる・枠が違うとつけられない', () => {
  const g = fresh();
  const mage = g.party[2];
  const sword = makeGear(g, 'sword_t1');
  assert.equal(canEquip(data, mage, 'weapon', sword).ok, true);
  const heavy = makeGear(g, 'heavy_body_t1');
  assert.equal(canEquip(data, mage, 'body', heavy).ok, true);
  assert.equal(canEquip(data, g.party[0], 'head', sword).ok, false);
});

test('二刀流：片手武器だけ。両手武器・鞭は不可。武器を外すとサブ武器も外れる', () => {
  const g = fresh();
  const w = g.party[0]; // 戦士：剣S・大剣A
  w.equip.weapon = makeGear(g, starterGearIds(data, w.job).weapon);
  const sword2 = makeGear(g, 'sword_t2');
  assert.equal(canEquip(data, w, 'offhand', sword2).ok, true);
  g.storage.gear.push(sword2);
  equipFromStorage(data, g, w, 'offhand', sword2.uid);
  assert.ok(w.equip.offhand);
  const replacement = makeGear(g, 'sword_t1');
  const original = w.equip.weapon;
  g.storage.gear.push(replacement);
  equipFromStorage(data, g, w, 'weapon', replacement.uid);
  assert.equal(w.equip.offhand, sword2);
  assert.ok(g.storage.gear.includes(original));
  // 大剣（両手）に持ちかえるとサブ武器は倉庫へ
  const gs = makeGear(g, 'greatsword_t1');
  g.storage.gear.push(gs);
  equipFromStorage(data, g, w, 'weapon', gs.uid);
  assert.equal(w.equip.offhand, null);
  assert.equal(canEquip(data, w, 'offhand', makeGear(g, 'sword_t1')).ok, false);
  const bard = createNewGame(data, [party[0], party[1], party[2], { name: 'ド', job: 'bard', icon: 'x' }, ...party.slice(4)]).party[3];
  assert.equal(canEquip(data, bard, 'offhand', makeGear(g, 'whip_t1')).ok, false);
});

test('レベル：xp_to_next で上がり、HP も増える。上限は level_cap', () => {
  const g = fresh();
  const w = g.party[0];
  const hp1 = maxHp(data, w);
  const need = xpToNext(data, 1);
  assert.equal(need, Math.round(25 * 1 ** 1.5));
  assert.equal(gainXp(data, w, need - 1), 0);
  assert.equal(gainXp(data, w, 1), 1);
  assert.equal(w.lv, 2);
  assert.ok(w.hp > hp1 && w.hp === maxHp(data, w));
  gainXp(data, w, 1e9);
  assert.equal(w.lv, readJson('balance.json').player.level_cap);
  assert.equal(w.xp, 0);
});

test('すべてのジョブで最初の能力値が計算できる', () => {
  for (const job of data.jobs) {
    const g = createNewGame(data, [{ name: 'a', job: job.id, icon: 'x' }, ...party.slice(1)]);
    const st = computeStats(data, g.party[0]);
    for (const v of Object.values(st)) assert.ok(Number.isFinite(v), `${job.id}`);
  }
});

