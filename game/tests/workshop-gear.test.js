import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { makeGear } from '../js/character.js';
import { enhance, dismantle, dismantlePowder } from '../js/workshop.js';
import { stoneRequirement, ENCHANT_POWDER_ID, ENCHANT_POWDER_COST } from '../js/workshop-materials.js';
import { numericEffect, enchantCost } from '../js/enchantment-roll.js';
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
    btn: (label, onclick) => el('button', { onclick }, label),
    equipmentIcon: () => null, uiIcon: () => null,
    describeFixedEffects: () => '', describeEffect: () => '',
    enhance, dismantle, dismantlePowder, stoneRequirement, ENCHANT_POWDER_ID, ENCHANT_POWDER_COST, numericEffect, enchantCost,
    panel: (...children) => el('details', {}, ...children), option: (label, value) => el('option', { value }, label),
    enchantFamilies: () => [], facilityValueMul: () => 1, uniqueCandidates: () => [],
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
  assert.equal(game.storage.materials.enhancement_stone_1, 11);
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
