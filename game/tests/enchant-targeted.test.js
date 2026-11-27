import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { makeGear } from '../js/character.js';
import { enchant, enchantCandidates, enchantFamilies } from '../js/workshop.js';
import { describeEffect } from '../js/equipment-effects.js';
import { allyStatusChance, allyElementMultiplier, createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';

const data = realGameData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));
const def = (slot) => [...data.equipment.values()].find((e) => e.slot === slot && e.source.includes('制作') && e.star === 1);
const material = (predicate) => [...data.materials.values()].find(predicate);

test('既存素材から物理・魔法11属性、状態異常20種と能力ダウンを対象別に選べる', () => {
  const weapon = def('weapon'), armor = def('body');
  const fire = material((m) => m.element === 'fire' && m.kind === 'common');
  const neutral = material((m) => !m.element && m.kind === 'common');
  const rare = material((m) => m.kind === 'rare');
  const status = material((m) => data.monsters.get(m.sourceMonster)?.status);
  const actor = material((m) => data.monsters.get(m.sourceMonster)?.types?.includes('insect'));
  assert.ok(enchantFamilies(data, weapon, fire).includes('ELEM_DMG:fire'));
  assert.ok(!enchantFamilies(data, weapon, fire).includes('ELEM_DMG:slash'));
  assert.ok(enchantFamilies(data, weapon, neutral).includes('ELEM_DMG:slash'));
  assert.ok(enchantFamilies(data, armor, neutral).includes('ELEM_RES:blunt'));
  assert.ok(enchantFamilies(data, armor, rare).some((id) => id.startsWith('STATUS_RES:')));
  assert.ok(enchantFamilies(data, weapon, actor).some((id) => id.startsWith('STATUS_RATE:')));
  assert.ok(enchantFamilies(data, weapon, status).includes(`VS_STATUS:${data.monsters.get(status.sourceMonster).status}`));
  assert.ok(enchantCandidates(data, weapon).includes('VS_STATUS:statdown'));
  assert.ok(enchantFamilies(data, weapon, status).filter((s) => s.startsWith('VS_STATUS:')).length >= 1);
  assert.equal(enchantCandidates(data, weapon).filter((s) => s.startsWith('VS_STATUS:')).length, 21);
  assert.ok(!enchantFamilies(data, weapon, status).includes('VS_DEBUFFED'));
  assert.ok(!enchantFamilies(data, weapon, actor).includes('STATUS_RATE'));
  assert.ok(!enchantFamilies(data, armor, rare).includes('STATUS_RES'));
  assert.equal(describeEffect(data, 'ELEM_DMG:slash', 12), '斬撃属性攻撃ダメージ +12%');
});

test('施設倍率を自動適用し、追加素材は候補を絞るが結果は保証しない', () => {
  const weapon = def('weapon');
  const common = material(m => m.kind === 'common' && !m.element);
  const game = fresh(); game.gold = 1e6; game.facilities.workshop = 4;
  game.storage.materials.enchant_powder = 10;
  game.storage.materials[common.id] = 1;
  const gear = makeGear(game, weapon.id);
  enchant(data, game, gear, common.id, () => 0.9);
  assert.ok(Object.keys(gear.affixes).length <= 2);
  assert.equal(game.storage.materials[common.id] ?? 0, 0);
  assert.equal(game.storage.materials.enchant_powder ?? 0, 0);
});

test('個別耐性は対象の異常と属性だけを防ぐ', () => {
  const game = fresh();
  const member = game.party[0];
  const battle = createBattle(data, game, { enemies: [], seed: 1 });
  const stats = { statusResist: 0 };
  const beforePoison = allyStatusChance(data, game, battle, 0, 'poison', .5, stats);
  const beforeBurn = allyStatusChance(data, game, battle, 0, 'burn', .5, stats);
  member.equip.accessory1 = { enh: 0, affixes: {}, enchants: [
    { stat: 'STATUS_RES:poison', value: 40 }, { stat: 'ELEM_RES:slash', value: 30 },
  ] };
  assert.ok(Math.abs(allyStatusChance(data, game, battle, 0, 'poison', .5, stats) - beforePoison * .6) < 1e-10);
  assert.equal(allyStatusChance(data, game, battle, 0, 'burn', .5, stats), beforeBurn);
  assert.equal(allyElementMultiplier(data, game, battle, 0, 'slash', false), .7);
  assert.equal(allyElementMultiplier(data, game, battle, 0, 'pierce', false), 1);
});

test('複合属性の攻撃強化は対象属性の最大値を一度だけ使う', () => {
  function hit(effects) {
    const game = fresh();
    const member = game.party[0];
    member.equip.weapon = makeGear(game, 'sword_t1');
    member.equip.weapon.enchants = effects.map(([stat, value]) => ({ stat, value }));
    const enemy = makeEnemy(data, 'slime', { lv: 1, dungeonId: 'mossy_cave' });
    enemy.hp = enemy.maxHp = 100000;
    enemy.evasion = 0; enemy.weak = []; enemy.strongWeak = []; enemy.resist = []; enemy.immune = [];
    const battle = createBattle(data, game, { enemies: [enemy], seed: 42 });
    battle.turn = { side: 'ally', i: 0 };
    setPending(battle, { type: 'attack', target: 0 }, { wordId: 'lx_r1_001' });
    resolvePending(data, game, battle, true);
    return enemy.maxHp - battle.enemies[0].hp;
  }
  const slash = hit([['ELEM_DMG:slash', 20]]);
  const both = hit([['ELEM_DMG:slash', 20], ['ELEM_DMG:fire', 10], ['ELEMENT:fire', 1]]);
  const fire = hit([['ELEM_DMG:fire', 10], ['ELEMENT:fire', 1]]);
  const unrelated = hit([['ELEM_DMG:ice', 50]]);
  assert.equal(both, slash);
  assert.ok(slash > fire && fire > unrelated);
});

