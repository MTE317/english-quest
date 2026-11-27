import test from 'node:test';
import assert from 'node:assert/strict';
import { workshopView } from '../js/ui/facility-view.js';
import { realGameData, MemoryStorage } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { makeGear } from '../js/character.js';
import { seededRng } from '../js/dungeon.js';
import { GameSession } from '../js/save.js';
import { rarityRange, enchantCost } from '../js/enchantment-roll.js';
import { dismantlePowder } from '../js/workshop.js';

// 実際の工房ビューが登録するボタンイベントを、町と同じfactory契約で実行する。
class Element {
  constructor(tag, text = '') { this.tag = tag; this.text = text; this.attrs = {}; this.children = []; this.events = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  set className(v) { this.attrs.class = v; }
  append(...nodes) { this.children.push(...nodes.map(n => n instanceof Element ? n : new Element('', String(n)))); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(k, v) { this.events[k] = v; }
  get value() { return this.attrs.value ?? this.children.find(n => n.tag === 'option')?.value ?? ''; }
  get textContent() { return this.text + this.children.map(n => n.textContent).join(''); }
  click() { if (!('disabled' in this.attrs)) this.events.click?.(); }
}
const nodes = n => [n, ...n.children.flatMap(nodes)];
const data = realGameData();
function fixture(fn) {
  const saved = { document: globalThis.document, Node: globalThis.Node, confirm: globalThis.confirm };
  Object.assign(globalThis, { Node: Element, document: { createElement: t => new Element(t), createTextNode: s => new Element('', String(s)) }, confirm: () => true });
  try {
    const game = createNewGame(data, defaultPartySpecs(data));
    game.storage.gear = []; game.storage.materials = { slime_mat: 4, enchant_powder: 40, enhancement_stone_1: 3 };
    const gear = makeGear(game, 'greatsword_t1', { rarity: 'epic', affixes: { STR: 5, MAG: 3 }, affixOrigins: { STR: 'common', MAG: 'common' } });
    game.storage.gear.push(gear);
    let generators = 0;
    const factory = () => { generators++; return seededRng({ rng: 167 }); };
    const view = selection => workshopView(data, game, f => f(game), factory, selection);
    const button = (root, text) => { const b = nodes(root).find(n => n.tag === 'button' && (typeof text === 'string' ? n.textContent === text : text.test(n.textContent))); assert.ok(b, String(text)); return b; };
    fn({ game, gear, view, button, calls: () => generators });
  } finally { Object.assign(globalThis, saved); }
}
function reload(game) {
  const storage = new MemoryStorage(), s = new GameSession({ storage }); s.startNew(game); s.save();
  return new GameSession({ storage }).game;
}
const finite = gear => assert.ok(Object.values(gear.affixes).every(Number.isFinite));

test('制作ボタンは一生成器で固有2〜4個を抽選し、一度だけ支払い保存する', () => fixture(({game,view,button,calls}) => {
  const gold = game.gold;
  button(view({ tab: 'craft', craftMode: 'standard', craftCategory: 'weapon', recipe: 'greatsword_t1' }), '制作する').click();
  assert.equal(calls(), 1);
  const made = game.storage.gear.at(-1), unique = Object.values(made.affixOrigins).filter(x => x === 'unique').length;
  assert.ok(unique >= 2 && unique <= 4); finite(made);
  assert.equal(game.gold, gold - data.economy.get(1).craft_gold);
  assert.equal(game.storage.materials.slime_mat ?? 0, 0);
  assert.deepEqual(reload(game).storage.gear.at(-1), made);
}));

test('全再付与ボタンは一生成器でエピックの個数範囲を満たし一度だけ払う', () => fixture(({game,gear,view,button,calls}) => {
  const gold = game.gold;
  button(view({tab:'gear',gear:gear.uid}), 'すべて再抽選する').click();
  assert.equal(calls(),1);const [min,max]=rarityRange(data,'epic'),count=Object.keys(gear.affixes).length;
  assert.ok(count>=min&&count<=max);finite(gear);assert.equal(gear.rarity,'epic');
  assert.equal(game.gold,gold-enchantCost(data,data.equipment.get(gear.id)));assert.equal(game.storage.materials.enchant_powder,30);
  assert.deepEqual(reload(game).storage.gear[0],gear);
}));

test('数値再抽選ボタンは選択した数値だけを有限値へ変更し保存する', () => fixture(({game,gear,view,button,calls}) => {
  const old=structuredClone(gear),gold=game.gold;
  button(view({tab:'gear',gear:gear.uid}), /の数値を引き直す$/).click();
  assert.equal(calls(),1);finite(gear);assert.notEqual(gear.affixes.STR,old.affixes.STR);
  assert.deepEqual(Object.keys(gear.affixes),Object.keys(old.affixes));assert.equal(gear.affixes.MAG,old.affixes.MAG);assert.deepEqual(gear.affixOrigins,old.affixOrigins);
  assert.equal(game.gold,gold-enchantCost(data,data.equipment.get(gear.id)));assert.equal(game.storage.materials.enchant_powder,30);
  assert.deepEqual(reload(game).storage.gear[0],gear);
}));

test('不足時はボタン無効・表示後の残高不足でも支払いや効果の変更なし', () => fixture(({game,gear,view,button,calls}) => {
  const stale=button(view({tab:'gear',gear:gear.uid}),'すべて再抽選する');game.gold=0;const old=structuredClone(game);
  assert.throws(()=>stale.click(),/お金/);assert.deepEqual(game,old);
  const count=calls();button(view({tab:'gear',gear:gear.uid}),'すべて再抽選する').click();assert.equal(calls(),count);assert.deepEqual(game,old);
  game.gold=10000;game.storage.materials.enchant_powder=0;const noPowder=structuredClone(game);
  button(view({tab:'gear',gear:gear.uid}),/の数値を引き直す$/).click();assert.deepEqual(game,noPowder);
  game.storage.materials.slime_mat=0;const noMaterial=structuredClone(game);
  button(view({tab:'craft',craftMode:'standard',recipe:'greatsword_t1'}),'制作する').click();assert.deepEqual(game,noMaterial);
}));

test('強化は従来どおり一生成器、分解は確認後に一度だけ還元する', () => fixture(({game,gear,view,button,calls}) => {
  const gold=game.gold;button(view({tab:'gear',gear:gear.uid}),'強化する').click();assert.equal(calls(),1);assert.equal(gear.enh,1);assert.equal(game.gold,gold-420);assert.equal(game.storage.materials.enhancement_stone_1??0,0);
  let root=view({tab:'gear',gear:gear.uid});globalThis.confirm=()=>false;const before=structuredClone(game);button(root,/^分解する/).click();assert.deepEqual(game,before);
  globalThis.confirm=()=>true;const powder=dismantlePowder(gear);button(root,/^分解する/).click();assert.equal(game.storage.gear.length,0);assert.equal(game.storage.materials.enchant_powder,40+powder);assert.equal(game.storage.materials.enhancement_stone_1,1);assert.equal(calls(),1);
}));

test('過去に保存されたnullや空の抽選結果・残高を自動復旧しない', () => fixture(({game,gear}) => {
  gear.affixes.STR=null;const broken=makeGear(game,'greatsword_t1',{rarity:'unique',affixes:{},affixOrigins:{}});broken.crafted=true;game.storage.gear.push(broken);
  const loaded=reload(game);assert.deepEqual(loaded.storage.gear,game.storage.gear);assert.equal(loaded.gold,game.gold);assert.deepEqual(loaded.storage.materials,game.storage.materials);
}));
