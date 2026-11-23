// 16武器種のマスタ・戦闘特性・入手経路の回帰テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { canEquip, makeGear, computeStats } from '../js/character.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';
import { rollBattleLoot } from '../js/loot.js';
import { craft } from '../js/workshop.js';
import { gearShopStock } from '../js/town.js';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const member = (job) => ({ name: job, job, icon: 'x' });
const fresh = (job = 'warrior') => createNewGame(data, [member(job), member('knight'), member('black_mage'), member('white_mage'), member('thief'), member('bard')]);

function prepare(weapon, job, seed = 1, count = 1, weak = []) {
  const game = fresh(job);
  const m = game.party[0];
  const gear = makeGear(game, weapon);
  assert.equal(canEquip(data, m, 'weapon', gear).ok, true, `${job} は ${weapon} を装備できる`);
  m.equip.weapon = gear;
  m.equip.offhand = null;
  const enemies = Array.from({ length: count }, () => {
    const e = makeEnemy(data, 'slime', { lv: 1 });
    e.maxHp = e.hp = 100000; e.def = e.res = 50; e.spd = 0; e.weak = weak; e.resist = [];
    return e;
  });
  const battle = createBattle(data, game, { enemies, seed });
  return { game, battle, enemies };
}
function action(ctx, type = 'attack', skillId) {
  ctx.battle.turn = { side: 'ally', i: 0 };
  setPending(ctx.battle, type === 'skill' ? { type, skillId, target: 0 } : { type, target: 0 }, {});
  resolvePending(data, ctx.game, ctx.battle, true);
  return ctx.battle.log;
}
function damage(weapon, job, weak = [], seed = 5, statuses = {}) {
  const ctx = prepare(weapon, job, seed, 1, weak);
  ctx.enemies[0].statuses = statuses;
  action(ctx);
  return 100000 - ctx.enemies[0].hp;
}

test('16武器種・通常装備384本・★1〜★12の各24段階・全公開職の適性が揃う', () => {
  assert.equal(data.weaponTypes.size, 16);
  const basic = [...data.equipment.values()].filter((e) => e.slot === 'weapon' && /^.+_t\d+$/.test(e.id));
  assert.equal(basic.length, 384);
  for (const type of data.weaponTypes.keys()) {
    const entries = basic.filter((e) => e.kind === type);
    assert.equal(entries.length, 24, type);
    assert.equal(entries[0].star, 1);
    assert.equal(entries[23].star, 12);
    for (let t = 1; t <= 24; t++) assert.equal(entries.some((e) => e.id === `${type}_t${t}`), true);
  }
  assert.deepEqual([...data.jobWeaponApt.keys()].sort(), [...data.jobsById.keys()].sort());
  for (const row of data.jobWeaponApt.values()) {
    for (const type of data.weaponTypes.keys()) assert.ok(row[type], `${row.job_id} / ${type}`);
  }
  assert.equal(data.weaponTypes.get('scythe').hands, 2);
  assert.equal(data.weaponTypes.get('fan').attackStat, 'mag');
});

test('鎌と扇は店・工房・ドロップの通常武器リストに含まれる', () => {
  const g = fresh();
  const stock = gearShopStock(data, g);
  assert.ok(stock.some(({ def }) => def.id === 'scythe_t1'));
  assert.ok(stock.some(({ def }) => def.id === 'fan_t1'));
  assert.ok(data.equipment.get('scythe_t2').source.includes('ドロップ'));
  assert.ok(data.equipment.get('fan_t2').source.includes('ドロップ'));
  g.gold = 1000;
  g.storage.materials = { goblin_mat: 4, cave_rat_mat: 4 };
  craft(data, g, data.equipment.get('iron_scythe'));
  craft(data, g, data.equipment.get('iron_fan'));
  assert.deepEqual(g.storage.gear.map((it) => it.id), ['iron_scythe', 'iron_fan']);
});

test('ジョブ適性・両手武器・扇の二刀流禁止を維持', () => {
  const hexer = fresh('hexer').party[0];
  assert.equal(canEquip(data, hexer, 'weapon', makeGear({ nextUid: 0 }, 'scythe_t24')).ok, true);
  const dancer = fresh('dancer').party[0];
  assert.equal(canEquip(data, dancer, 'weapon', makeGear({ nextUid: 0 }, 'fan_t24')).ok, true);
  assert.equal(canEquip(data, dancer, 'offhand', makeGear({ nextUid: 0 }, 'fan_t1')).ok, false);
  assert.equal(canEquip(data, fresh('knight').party[0], 'weapon', makeGear({ nextUid: 0 }, 'scythe_t1')).ok, false);
});

test('鎌は出血中の敵への武器攻撃+10%、通常攻撃で出血を与える', () => {
  const base = damage('scythe_t1', 'hexer', [], 13);
  const bleeding = damage('scythe_t1', 'hexer', [], 13, { bleed: { turns: 3, n: 1 } });
  assert.ok(bleeding > base, `${bleeding} vs ${base}`);
  let inflicted = false;
  for (let seed = 1; seed <= 200 && !inflicted; seed++) {
    const ctx = prepare('scythe_t1', 'hexer', seed);
    action(ctx);
    inflicted = Boolean(ctx.enemies[0].statuses.bleed);
  }
  assert.ok(inflicted, '鎌の通常攻撃で出血する');
});

test('扇は風属性のMAG攻撃で、全体強化量を10%増やす', () => {
  const weak = damage('fan_t1', 'dancer', ['wind']);
  const plain = damage('fan_t1', 'dancer');
  assert.ok(weak > plain * 1.3, `${weak} vs ${plain}`);
  const via = (weapon) => {
    const ctx = prepare(weapon, 'bard', 5);
    action(ctx, 'skill', 'bard_p1_s1'); // DEF/RES 各25%の守りの歌
    return ctx.battle.partyBuffs.def?.[0];
  };
  assert.equal(via('instrument_t1'), 0.25);
  assert.ok(Math.abs(via('fan_t1') - 0.275) < 1e-9);
});

test('鎚はスタン、槍は敵2体への貫通が発動する', () => {
  for (const [weapon, job, result] of [['hammer_t1', 'knight', 'stun'], ['spear_t1', 'knight', 'pierce']]) {
    let triggered = false;
    for (let seed = 1; seed <= 250 && !triggered; seed++) {
      const ctx = prepare(weapon, job, seed, 2);
      action(ctx);
      triggered = result === 'stun' ? Boolean(ctx.enemies[0].statuses.stun)
        : ctx.enemies[1].hp < 100000;
    }
    assert.ok(triggered, weapon);
  }
});

test('弓は弱点攻撃の倍率が高く、短剣はSPDと素材の入手確率を上げる', () => {
  const bowNormal = damage('bow_t1', 'hunter', []);
  const bowWeak = damage('bow_t1', 'hunter', ['pierce']);
  assert.ok(bowWeak > bowNormal * 1.65, `${bowWeak} vs ${bowNormal}`);
  const thief = fresh('thief');
  const speedWith = computeStats(data, thief.party[0]).spd;
  const oldDagger = thief.party[0].equip.weapon;
  thief.party[0].equip.weapon = null;
  assert.equal(speedWith - computeStats(data, thief.party[0]).spd, 2);
  thief.party[0].equip.weapon = oldDagger;
  // 追加された仲間の短剣補正が混ざらないよう、先頭の1本だけで比較する。
  for (const member of thief.party.slice(1)) {
    member.equip.weapon = null;
    member.equip.offhand = null;
  }
  const enemy = { monsterId: 'slime', boss: false, bounty: false };
  // 基礎ドロップ率が調整されても、短剣あり/なしの境目を検証する。
  const chance = data.dropTables.get('mossy_cave').materialRate;
  const bonus = data.weaponTypes.get('dagger').traits.material_drop_mul - 1;
  const getMats = () => rollBattleLoot(data, thief, 'mossy_cave', 1, [enemy], () => chance * (1 + bonus / 2)).materials;
  assert.ok(getMats().some((m) => m.id === 'slime_mat'));
  thief.party[0].equip.weapon = null;
  assert.ok(!getMats().some((m) => m.id === 'slime_mat'));
});
