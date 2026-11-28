import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, MemoryStorage } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { createBattle, makeEnemy, setPending, resolvePending, targetKind, actionOptions } from '../js/battle.js';
import { monsterBattleVisibility } from '../js/monster-catalog.js';
import { monsterKnowledge, learnMonsterElements } from '../js/monster-knowledge.js';
import { itemShopStock, buyItem } from '../js/town.js';
import { FIELD_ITEM_EFFECTS } from '../js/dungeon.js';
import { GameSession } from '../js/save.js';
const data = realGameData(), itemId = 'reveal_talisman';
function setup(id = 'slime') {
  const game = createNewGame(data, defaultPartySpecs(data));
  game.items[itemId] = 5;
  const enemy = makeEnemy(data, id), other = makeEnemy(data, 'goblin');
  Object.assign(enemy, { strongWeak:['fire'], weak:['fire','ice'], resist:['wind'], immune:[] });
  const battle = createBattle(data, game, { enemies:[enemy, other], seed:51 });
  return { game, enemy, other, battle };
}
function use(c, correct = true, target = 0) {
  c.battle.turn = { side:'ally', i:0, bleedProcessed:true };
  setPending(c.battle, { type:'item', itemId, target }, {});
  resolvePending(data, c.game, c.battle, correct);
}
test('看破の札は初期道具屋で200G、購入して敵単体に使用可能、移動中は不可', () => {
  const c = setup(), stock = itemShopStock(data, c.game).find(x=>x.item.id===itemId);
  assert.equal(stock.price, 200);
  assert.equal(stock.price, itemShopStock(data,c.game).find(x=>x.item.id==='potion').price);
  c.game.gold = 500; delete c.game.items[itemId];
  assert.equal(buyItem(data,c.game,itemId,2),2);
  assert.equal(c.game.gold,100); assert.equal(c.game.items[itemId],2);
  assert.equal(targetKind(data,{type:'item',itemId}),'enemy');
  assert.equal(actionOptions(data,c.game,c.battle,0).items.find(x=>x.item.id===itemId).reason,'');
  assert.equal(FIELD_ITEM_EFFECTS.includes(stock.item.effect),false);
});
test('通常敵・ボスのHPと未判明の弱点を1種類ずつ記録し1個消費する', () => {
  for (const id of ['slime','goblin_boss']) for(const correct of [true,false]) {
    const c=setup(id);
    use(c,correct);
    assert.equal(c.game.items[itemId],4);
    assert.deepEqual(c.game.catalog.affinities[id].elements,['fire']);
    assert.equal(c.game.catalog.affinities[id].scanned,false);
    assert.deepEqual(monsterBattleVisibility(data,c.game,c.enemy),{hp:true,mp:false,types:false});
    assert.equal(monsterKnowledge(data,c.game,c.enemy).weak.length,1);
    assert.equal(monsterBattleVisibility(data,c.game,c.other).hp,false);
    use(c,correct);
    assert.deepEqual(c.game.catalog.affinities[id].elements,['fire','ice']);
    use(c,correct);
    assert.deepEqual(c.game.catalog.affinities[id].elements,['fire','ice']);
    assert.equal(c.game.items[itemId],2);
  }
});
test('弱点なし・全弱点判明済みでもHPを開示し、耐性などを追加で開示しない', () => {
  for (const mode of ['none','known','scanned','defeats']) {
    const c=setup();
    if(mode==='none') { c.enemy.strongWeak=[]; c.enemy.weak=[]; }
    if(mode==='known') learnMonsterElements(c.game,c.enemy,['fire','ice']);
    if(mode==='scanned') learnMonsterElements(c.game,c.enemy,[],true);
    if(mode==='defeats') c.game.catalog.defeats={slime:3};
    const before=[...(c.game.catalog.affinities?.slime?.elements ?? [])];
    use(c);
    assert.equal(monsterBattleVisibility(data,c.game,c.enemy).hp,true);
    assert.deepEqual(c.game.catalog.affinities.slime.elements,before);
  }
});
test('対象不在・死亡済みなら消費せず、所持していなければ調査できない', () => {
  for(const target of [0,99]) {
    const c=setup();c.enemy.hp=0;use(c,true,target);
    assert.equal(c.game.items[itemId],5);
    assert.equal(c.game.catalog.affinities?.slime,undefined);
  }
  const c=setup();delete c.game.items[itemId];use(c);
  assert.equal(c.game.catalog.affinities?.slime,undefined);
});
test('調査結果は全滅後の保存・再読込と次回遭遇でも残る', () => {
  const c=setup(),storage=new MemoryStorage(),session=new GameSession({storage});
  session.startNew(c.game);session.enterDungeon({dungeonId:'mossy_cave'});
  c.game=session.game;use(c);session.wipe();
  const restored=new GameSession({storage}).game;
  assert.deepEqual(restored.catalog.affinities.slime.elements,['fire']);
  assert.equal(monsterBattleVisibility(data,restored,makeEnemy(data,'slime')).hp,true);
});
