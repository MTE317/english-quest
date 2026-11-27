import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { craft, enchant, enchantFamilies, enchantCandidates } from '../js/workshop.js';
import { rollAffixes, affixVariants } from '../js/loot.js';
import { gearEffects, maxHp, maxMp, makeGear } from '../js/character.js';
import { learnSkill, equipSkill, isLearned, upgradeSkill, learnedSkillLevel } from '../js/growth.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';
import { parseAmounts } from '../js/csv.js';
import { uniqueCandidates, candidates } from '../js/enchantment-roll.js';
import { readCsv, readJson, seededRng } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const fresh = (job = 'warrior') => createNewGame(data,
  [job, 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((id) => ({ name: id, job: id, icon: 'x' })));
const additions = data.balance.content_updates;

test('追加18制作は固有4候補を持つユニークとして制作・再抽選できる', () => {
  assert.equal(additions.build36_recipes.length, 18);
  for (const id of additions.build36_recipes) {
    const recipe = data.recipes.find(row => row.id === id);
    const def = data.equipment.get(id);
    const rank = Number(recipe.workshop_rank);
    assert.ok([2, 3].includes(rank));
    assert.equal(Object.keys(uniqueCandidates(data, def)).length, 4);
    const game = fresh(); game.gold = 1e6; game.facilities.workshop = rank;
    for (const { id: materialId, count } of parseAmounts(recipe.materials)) game.storage.materials[materialId] = count;
    craft(data, game, def, seededRng(99));
    const item = game.storage.gear.at(-1);
    assert.equal(item.rarity, 'unique');
    assert.ok(Object.values(item.affixOrigins).filter(kind => kind === 'unique').length >= 2);
    game.storage.materials.enchant_powder = 10;
    enchant(data, game, item, '', seededRng(177));
    assert.ok(Object.values(item.affixOrigins).filter(kind => kind === 'unique').length >= 2);
  }
});

test('状態特効・属性耐性を対象別に通常エンチャント候補へ展開する', () => {
  for (const family of [...affixVariants(data, 'VS_STATUS'), 'ELEM_RES:fire', 'ELEM_DMG:fire']) {
    const slots = ['weapon', 'head', 'cloak', 'accessory'].filter(slot => candidates(data, slot).some(row => row.id === family));
    assert.ok(slots.length, family);
  }
});

test('ランダム効果の状態特効と属性耐性は対象IDを持ち、未解決の系統名を残さない', () => {
  for (const slot of ['weapon', 'accessory', 'cloak']) {
    const effects = rollAffixes(data, slot, data.affixes.length, 12, 2, seededRng(177));
    assert.ok(!Object.hasOwn(effects, 'VS_STATUS'));
    assert.ok(!Object.hasOwn(effects, 'ELEM_RES'));
    for (const key of Object.keys(effects)) {
      if (key.startsWith('VS_STATUS:')) assert.ok(data.statusEffects.has(key.slice(10)) || key === 'VS_STATUS:statdown');
      if (key.startsWith('ELEM_RES:')) assert.ok(data.elements.has(key.slice(9)));
    }
    if (slot === 'weapon' || slot === 'accessory') assert.ok(Object.keys(effects).some((key) => key.startsWith('VS_STATUS:')));
    if (slot === 'cloak' || slot === 'accessory') assert.ok(Object.keys(effects).some((key) => key.startsWith('ELEM_RES:')));
  }
});

test('新マスターの状態付与8技能は前提LvとAPを払い、装備して実際に付与できる', () => {
  const ids = ['warrior_A05', 'thief_A04', 'black_mage_A04', 'black_mage_A05',
    'black_mage_A06', 'hunter_A03', 'hunter_A04', 'white_mage_A08'];
  for (const id of ids) {
    const skill = data.skills.get(id);
    const game = fresh(skill.job);
    const member = game.party[0];
    member.lv = 20;
    member.loadout = { actions: [], passives: [] };
    member.ap = 1000;
    function acquire(skillId, level = 1) {
      const entry = data.skills.get(skillId);
      for (const prerequisite of entry.effect.prerequisites ?? []) acquire(prerequisite.id, prerequisite.level);
      if (!isLearned(member, entry)) learnSkill(data, member, entry.id);
      while (learnedSkillLevel(member, entry) < level) upgradeSkill(data, member, entry.id);
    }
    acquire(id);
    assert.ok(member.ap < 1000);
    const weapon = [...data.equipment.values()].find((def) => def.slot === 'weapon'
      && (skill.effect.weapons ?? []).includes(def.kind));
    if (weapon) member.equip.weapon = makeGear(game, weapon.id);
    member.loadout = { actions: [], passives: [] };
    equipSkill(data, member, id);
    const status = data.statusEffects.get(skill.effect.st[0]);
    assert.ok(status);
    let applied = false;
    for (let seed = 1; seed <= 80 && !applied; seed++) {
      member.hp = maxHp(data, member); member.mp = maxMp(data, member);
      const enemy = makeEnemy(data, 'goblin', { lv: 20 });
      enemy.hp = enemy.maxHp = 100000; // 付与前に倒れない標的。味方と成功率は実データ。
      const battle = createBattle(data, game, { enemies: [enemy], seed });
      battle.round = 1; battle.turn = { side: 'ally', i: 0 };
      setPending(battle, { type: 'skill', skillId: id, target: 0 }, {});
      resolvePending(data, game, battle, true);
      applied ||= Boolean(enemy.statuses[status.id]);
    }
    assert.ok(applied, `${skill.name}: ${status.name}`);
  }
});



