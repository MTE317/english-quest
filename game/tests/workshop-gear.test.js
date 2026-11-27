import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import { makeGear } from '../js/character.js';
import { enhance, dismantle, dismantlePowder, enchant, reroll } from '../js/workshop.js';
import { stoneRequirement, availableStones, dismantleFragment, stoneFragmentId, STONE_STAGES, ENCHANT_POWDER_ID, ENCHANT_POWDER_COST } from '../js/workshop-materials.js';
import { numericEffect, enchantCost, facilityValueMul } from '../js/enchantment-roll.js';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const source = readFileSync(new URL('../js/ui/facility-view.js', import.meta.url), 'utf8');
const workshopSource = source.slice(source.indexOf('export function workshopView'), source.indexOf('export function managementView'))
  .replace('export function', 'function');
const nodes = root => [root, ...(root.children ?? []).flatMap(nodes)];
const text = root => typeof root === 'object' ? (root.children ?? []).map(text).join('') : String(root);
function view(game, selection = { tab: 'gear' }) {
  const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(c => c != null && c !== false), querySelector: () => null, addEventListener() {} });
  const context = vm.createContext({
    el, render: (root, ...children) => { root.children = children.flat(Infinity).filter(c => c != null && c !== false); },
    btn: (label, onclick, disabled = false) => el('button', { onclick, disabled }, label),
    equipmentIcon: () => null, uiIcon: () => null,
    describeFixedEffects: () => '', describeEffect: () => '',
    enhance, dismantle, dismantlePowder, enchant, reroll, stoneRequirement, availableStones, dismantleFragment, stoneFragmentId, STONE_STAGES, ENCHANT_POWDER_ID, ENCHANT_POWDER_COST, numericEffect, enchantCost,
    panel: (...children) => el('details', {}, ...children), option: (label, value) => el('option', { value }, label),
    enchantFamilies: () => [], facilityValueMul, uniqueCandidates: () => [],
    confirm: () => true,
  });
  vm.runInContext(workshopSource, context);
  return context.workshopView(data, game, fn => fn(game), () => () => 0, selection);
}
function fresh() {
  const game = createNewGame(data, ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
    .map(job => ({ name: job, job, icon: 'x' })));
  game.gold = 100000;
  game.storage.gear = [];
  game.storage.materials = { enhancement_stone_1: 10 };
  for (const member of game.party) {
    for (const slot of Object.keys(member.equip)) {
      const kind = slot === 'offhand' ? 'weapon' : slot.startsWith('accessory') ? 'accessory' : slot;
      const def = [...data.equipment.values()].filter(d => d.slot === kind).sort((a, b) => a.itemLv - b.itemLv)[0];
      member.equip[slot] = makeGear(game, def.id);
    }
  }
  return game;
}
const button = (root, label) => nodes(root).find(n => n.tag === 'button' && (label === '分解する' ? text(n).startsWith(label) : text(n) === label));

test('工房は全員の装備中アイテムを表示し、外さずに強化でき、分解操作を出さない', () => {
  const game = fresh();
  // 武器・副手・防具・装飾品を含め、全員のすべての装備枠を確認する。
  for (const member of game.party) {
    for (const [slot, item] of Object.entries(member.equip)) {
      if (!item) continue;
      game.storage.materials.enhancement_stone_1 = 10;
      const root = view(game, { tab: 'gear', gear: item.uid });
      assert.ok(button(root, '武器強化・分解'));
      assert.ok(text(root).includes(`${member.name}：装備中`));
      assert.equal(button(root, '分解する'), undefined);
      const before = item.enh, gold = game.gold;
      button(root, '強化する').attrs.onclick();
      assert.equal(item.enh, before + 1);
      assert.equal(member.equip[slot], item);
      assert.equal(game.storage.gear.length, 0);
      assert.equal(game.storage.materials.enhancement_stone_1, 10 - stoneRequirement(data, before).count);
      assert.ok(game.gold < gold);
      const saved = structuredClone(game);
      assert.throws(() => dismantle(data, game, item), /所持品/);
      assert.deepEqual(game, saved);
    }
  }
});

test('所持品と装備中の同じ種類を区別し、選び直した所持品の現物だけを分解する', () => {
  const game = fresh();
  const equipped = game.party[0].equip.weapon;
  const stored = makeGear(game, equipped.id);
  game.storage.gear.push(stored);
  const selection = { tab: 'gear', gear: equipped.uid };
  const root = view(game, selection);
  const storedButton = nodes(root).find(n => n.attrs?.['data-workshop-item'] === String(stored.uid));
  assert.ok(text(storedButton).includes('所持品'));
  storedButton.attrs.onclick();
  assert.equal(selection.gear, stored.uid);
  button(root, '分解する').attrs.onclick();
  assert.equal(game.storage.gear.length, 0);
  assert.equal(game.party[0].equip.weapon, equipped);
  assert.equal(game.storage.materials.enhancement_stone_1, 10);
  assert.equal(game.storage.materials[stoneFragmentId(1)], 1);
});

test('所持品が空でも装備中のアイテムを初期選択し、所持装備がなければ空表示する', () => {
  const game = fresh();
  const selection = { tab: 'gear', gear: 'removed' };
  assert.ok(button(view(game, selection), '強化する'));
  assert.ok(game.party.some(m => Object.values(m.equip).some(item => item?.uid === selection.gear)));
  game.party.forEach(m => { m.equip = {}; });
  const root = view(game, selection);
  assert.ok(text(root).includes('強化・分解できる装備がありません。'));
  assert.equal(button(root, '強化する'), undefined);
});

for (const slot of ['weapon', 'head', 'accessory1']) {
  test(`装備中の${slot}を外さず全再付与・数値再抽選でき、費用を消費する`, () => {
    const game = fresh(), member = game.party[0], item = member.equip[slot];
    item.rarity = 'rare';
    const stat = slot === 'head' ? 'DEF' : 'STR';
    item.affixes = { [stat]: 999 };
    game.storage.materials[ENCHANT_POWDER_ID] = 30;
    const otherGear = makeGear(game, item.id, { affixes: { STR: 123 } });
    game.storage.gear.push(otherGear);
    const savedOther = structuredClone(otherGear);
    const price = enchantCost(data, data.equipment.get(item.id));
    const gold = game.gold;
    const root = view(game, { tab: 'gear', gear: item.uid });
    const full = button(root, 'すべて再抽選する');
    assert.ok(full && !full.attrs.disabled);
    full.attrs.onclick();
    assert.notEqual(item.affixes[stat], 999);
    assert.ok(Object.keys(item.affixes).length > 0);
    assert.equal(game.gold, gold - price);
    assert.equal(game.storage.materials[ENCHANT_POWDER_ID], 30 - ENCHANT_POWDER_COST);
    assert.equal(member.equip[slot], item);
    assert.deepEqual(otherGear, savedOther);
    // 数値再抽選は種類と装備先を維持する。
    item.affixes = { [stat]: 999 };
    const rerollRoot = view(game, { tab: 'gear', gear: item.uid });
    const numeric = nodes(rerollRoot).find(n => n.tag === 'button' && text(n).includes('の数値を引き直す'));
    assert.ok(numeric && !numeric.attrs.disabled);
    numeric.attrs.onclick();
    assert.deepEqual(Object.keys(item.affixes), [stat]);
    assert.notEqual(item.affixes[stat], 999);
    assert.equal(game.gold, gold - price * 2);
    assert.equal(game.storage.materials[ENCHANT_POWDER_ID], 30 - ENCHANT_POWDER_COST * 2);
    assert.equal(member.equip[slot], item);
    assert.equal(button(rerollRoot, '分解する'), undefined);
    assert.deepEqual(otherGear, savedOther);
  });
}

test('装備中でも資金・粉不足では再付与と数値再抽選を無効にする', () => {
  for (const missing of ['gold', 'powder']) {
    const game = fresh(), item = game.party[0].equip.weapon;
    item.affixes = { STR: 2 };
    game.gold = missing === 'gold' ? 0 : 100000;
    game.storage.materials[ENCHANT_POWDER_ID] = missing === 'powder' ? ENCHANT_POWDER_COST - 1 : ENCHANT_POWDER_COST;
    const root = view(game, { tab: 'gear', gear: item.uid });
    assert.equal(button(root, 'すべて再抽選する').attrs.disabled, true);
    const numeric = nodes(root).find(n => n.tag === 'button' && text(n).includes('の数値を引き直す'));
    assert.equal(numeric.attrs.disabled, true);
    const before = structuredClone(game);
    assert.throws(() => button(root, 'すべて再抽選する').attrs.onclick());
    assert.deepEqual(game, before);
  }
});

test('レアリティに応じた欠片だけを分解で得る（粉は効果がある場合のみ）', () => {
  const game = fresh();
  for (const [rarity, stage] of Object.entries({
    common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, artifact: 5, origin: 5,
  })) {
    const gear = makeGear(game, game.party[0].equip.weapon.id, { rarity, affixes: {} });
    game.storage.gear.push(gear);
    const before = game.storage.materials[stoneFragmentId(stage)] ?? 0;
    dismantle(data, game, gear);
    assert.equal(game.storage.materials[stoneFragmentId(stage)], before + 1, rarity);
  }
  assert.equal(game.storage.materials.enhancement_stone_1, 10);
  assert.equal(game.storage.materials.enchant_powder ?? 0, 0);
  assert.equal(Object.keys(game.storage.materials).some(id => id.startsWith('fragment_')), false);
});

test('欠片3個を石1個分として強化し、石と欠片も併用できる', () => {
  const game = fresh();
  const gear = game.party[0].equip.weapon;
  game.storage.materials = { [stoneFragmentId(1)]: 9 };
  assert.equal(availableStones(game, stoneRequirement(data, 0)), 3);
  assert.equal(button(view(game, { tab: 'gear', gear: gear.uid }), '強化する').attrs.disabled, false);
  enhance(data, game, gear, () => 0);
  assert.equal(gear.enh, 1);
  assert.equal(game.storage.materials[stoneFragmentId(1)], undefined);
  game.storage.materials = { enhancement_stone_1: 1, [stoneFragmentId(1)]: 7 };
  enhance(data, game, gear, () => 0);
  assert.equal(gear.enh, 2);
  assert.equal(game.storage.materials.enhancement_stone_1, undefined);
  assert.equal(game.storage.materials[stoneFragmentId(1)], 1);
  const snapshot = structuredClone(game);
  assert.throws(() => enhance(data, game, gear, () => 0), /足りません/);
  assert.deepEqual(game, snapshot);
});

test('旧欠片を新しい段階へ一度だけ移し、既存の完成石を維持する', () => {
  const game = fresh();
  game.storage.materials = { fragment_common: 2, fragment_rare: 3,
    fragment_legendary: 1, fragment_unique: 2, enhancement_stone_1: 4 };
  normalizeGame(data, game);
  assert.equal(game.storage.materials[stoneFragmentId(1)], 2);
  assert.equal(game.storage.materials[stoneFragmentId(3)], 3);
  assert.equal(game.storage.materials[stoneFragmentId(5)], 3);
  assert.equal(game.storage.materials.enhancement_stone_1, 4);
  assert.equal(game.storage.materials.fragment_common, undefined);
  const materials = structuredClone(game.storage.materials);
  normalizeGame(data, game);
  assert.deepEqual(game.storage.materials, materials);
});
