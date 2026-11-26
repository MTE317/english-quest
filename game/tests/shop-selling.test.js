import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stackSellPrice, sellStack, stackSellStock } from '../js/shop-selling.js';

const data = {
  balance: { gold_economy: { scale: 10, minimum_step: 10, significant_digits: 3 } },
  economy: new Map([[1, { run_income: 1500 }], [2, { run_income: 2700 }]]),
  items: new Map([
    ['potion', { id: 'potion', name: '回復薬', price: 200, description: 'HPを回復する。', source: '店' }],
    ['drop_only', { id: 'drop_only', name: '拾った道具', price: 600, description: '戦利品。', source: 'ドロップ' }],
  ]),
  materials: new Map([
    ['normal', { id: 'normal', name: '通常素材', rank: 1, kind: 'common' }],
    ['rare', { id: 'rare', name: 'まれな素材', rank: 1, kind: 'rare' }],
    ['boss', { id: 'boss', name: 'ボス素材', rank: 1, kind: 'boss' }],
    ['higher', { id: 'higher', name: '上位素材', rank: 2, kind: 'rare' }],
  ]),
};
const fresh = () => ({ gold: 100, party: [], storage: { gear: [], materials: { normal: 7, rare: 2, boss: 1 } },
  items: { potion: 8, drop_only: 2 } });

test('道具は基準価格の半額以下、素材はランク・希少度で売却単価を決める', () => {
  assert.equal(stackSellPrice(data, 'item', 'potion'), 100);
  assert.equal(stackSellPrice(data, 'item', 'drop_only'), 300);
  assert.equal(stackSellPrice(data, 'material', 'normal'), 20);
  assert.equal(stackSellPrice(data, 'material', 'rare'), 50);
  assert.equal(stackSellPrice(data, 'material', 'boss'), 150);
  assert.ok(stackSellPrice(data, 'material', 'higher') > stackSellPrice(data, 'material', 'rare'));
});

test('素材を指定個数売り、残数と金額を更新する。完売した在庫キーを消す', () => {
  const game = fresh();
  assert.equal(sellStack(data, game, 'material', 'normal', 5), 100);
  assert.equal(game.storage.materials.normal, 2);
  assert.equal(game.gold, 200);
  sellStack(data, game, 'material', 'normal', 2);
  assert.ok(!('normal' in game.storage.materials));
  assert.equal(game.gold, 240);
  assert.equal(game.items.potion, 8);
});

test('店売りでない道具も売れ、素材や装備の在庫に影響しない', () => {
  const game = fresh(), materials = structuredClone(game.storage.materials);
  sellStack(data, game, 'item', 'drop_only', 2);
  assert.ok(!('drop_only' in game.items));
  assert.equal(game.gold, 700);
  assert.deepEqual(game.storage.materials, materials);
  assert.deepEqual(game.storage.gear, []);
});

test('個数不足・不正な個数・不明な品物は所持品もお金も変更しない', () => {
  for (const count of [0, -1, .5, NaN, Infinity, '1', 99]) {
    const game = fresh(), before = structuredClone(game);
    assert.throws(() => sellStack(data, game, 'item', 'potion', count));
    assert.deepEqual(game, before);
  }
  for (const [kind, id] of [['item', 'unknown'], ['material', 'unknown'], ['unknown', 'normal']]) {
    const game = fresh(), before = structuredClone(game);
    assert.throws(() => sellStack(data, game, kind, id, 1));
    assert.deepEqual(game, before);
  }
  const game = fresh();
  sellStack(data, game, 'material', 'boss', 1);
  const before = structuredClone(game);
  assert.throws(() => sellStack(data, game, 'material', 'boss', 1));
  assert.deepEqual(game, before, '同じ在庫の二重売却を防ぐ');
});

test('売却候補には所持中の素材・道具をすべて含め、0個は表示しない', () => {
  const game = fresh();
  game.items.potion = 0;
  const entries = stackSellStock(data, game);
  assert.equal(entries.length, 4);
  assert.deepEqual(entries.map(entry => entry.id).sort(), ['boss', 'drop_only', 'normal', 'rare']);
  assert.ok(entries.every(entry => entry.count > 0 && entry.price > 0));
});

test('武器・防具屋の売却に素材・道具のカテゴリと1個・5個・全部の確認操作を用意する', () => {
  const source = readFileSync(new URL('../js/ui/town-shops.js', import.meta.url), 'utf8');
  const game = fresh(), uiData = { ...data, weaponTypes: new Map(), armorWeights: new Map(), rarityTable: [] };
  const context = vm.createContext({
    stackSellStock, sellStack, gearShopStock: () => [], shopView: (_state, catalogs) => catalogs,
    uiIcon: id => id, stars: rank => '★' + rank, goldText: amount => amount + ' G',
    gearCategories: [{ id: 'weapon', label: '武器' }, { id: 'armor', label: '防具' }, { id: 'accessory', label: '装飾品' }],
  });
  vm.runInContext(source.slice(source.indexOf('export function gearShopView')).replace('export function', 'function'), context);
  const catalogs = context.gearShopView(uiData, game, {}, fn => fn(game));
  const selling = catalogs.find(catalog => catalog.id === 'sell');
  assert.ok(selling.categories.some(category => category.id === 'items'));
  assert.ok(selling.categories.some(category => category.id === 'materials'));
  assert.equal(selling.entries.length, 5);
  const normal = selling.entries.find(entry => entry.id === 'material:normal');
  assert.deepEqual(Array.from(normal.actions, action => action.count), [1, 5, 7]);
  assert.equal(normal.actions[2].total, normal.price * 7);
  assert.equal(game.storage.materials.normal, 7, '確認前の一覧表示では在庫を消費しない');
  normal.actions[2].run();
  assert.ok(!('normal' in game.storage.materials));
  assert.equal(game.gold, 240);
});
