import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData,seededRng} from './helpers.js';
import {catalogMonsters,monsterBattleVisibility,monsterUnlocks} from '../js/monster-catalog.js';
import {makeEnemy} from '../js/battle.js';
import {recordMonsterDefeats} from '../js/monster-knowledge.js';
import {xpToNext,gainXp} from '../js/character.js';
import {createNewGame,defaultPartySpecs,normalizeGame} from '../js/game-state.js';
import {applyTrainingAnswer} from '../js/training.js';
import {encounterWeights,makeEncounter} from '../js/encounter.js';
const data=realGameData({world:true});
const fresh=()=>createNewGame(data,defaultPartySpecs(data));

test('HP・MP・種族は図鑑と同じ討伐条件で開示し、初回やスキャンでは漏らさない',()=>{
 for(const id of ['slime','stone_giant'])for(const count of [0,1,2,3,4,19,20]){
  const e=makeEnemy(data,id),g=fresh();(g.catalog??={}).defeats={[id]:count};
  e.revealed=true;
  const known=monsterUnlocks(data.monsters.get(id),count);
  assert.deepEqual(monsterBattleVisibility(data,g,e),{hp:known.hp,mp:known.stats,types:known.types});
 }
 const g=fresh(),elite=makeEnemy(data,'slime',{eliteId:'elite'});
 assert.deepEqual(monsterBattleVisibility(data,g,elite),{hp:false,mp:false,types:false});
 elite.hp=0;recordMonsterDefeats(g,[elite]);
 assert.deepEqual(monsterBattleVisibility(data,g,makeEnemy(data,'slime')),{hp:true,mp:false,types:false});
 assert.deepEqual(monsterBattleVisibility(data,g,elite),{hp:true,mp:false,types:false});
 assert.equal(catalogMonsters(data).length,39);
 assert.ok(catalogMonsters(data).some(m=>m.id==='owl_sage'));
});

test('地域1の通常種とボスを強化し、同じ種のLvは維持する',()=>{
 for(const [id,lv,hp,str] of [['slime',1,253,14.08],['stone_giant',10,910,238.85],['storm_eagle',12,1325,465.43]]){
  const e=makeEnemy(data,id);assert.equal(e.lv,lv);
  assert.equal(e.maxHp,Math.round(hp*1.1));assert.equal(e.str,Math.round(str*1.15*100)/100);
  assert.equal(e.mag,e.str);
 }
 assert.equal([...data.monsters.values()].filter(m=>m.statsReview==='region1').length,39);
});

test('必要XPは約1.5倍、既存Lv・保持XPは維持し、同じ獲得量で成長を遅くする',()=>{
 const old=structuredClone(data);old.balance.player.xp_to_next='25 * Lv^1.5';
 for(const lv of [1,2,5,10,50,98])assert.ok(Math.abs(xpToNext(data,lv)-xpToNext(old,lv)*1.5)<=1);
 const g=fresh(),before=structuredClone(g);gainXp(data,g.party[0],500);gainXp(old,before.party[0],500);
 assert.ok(g.party[0].lv<before.party[0].lv);
 g.party[0].lv=9;g.party[0].xp=150;normalizeGame(data,g);
 assert.equal(g.party[0].lv,9);assert.equal(g.party[0].xp,150);
});

test('鍛錬の下限報酬を必要XP増加で膨らませず、APを維持する',()=>{
 const old=structuredClone(data);old.balance.player.xp_to_next='25 * Lv^1.5';old.balance.training.xp_min_level_fraction=.001;
 const g=fresh(),previous=fresh();g.xpPerQuestion=previous.xpPerQuestion=1;
 for(const game of [g,previous])for(const m of game.party){m.lv=50;m.xp=0;}
 for(let i=0;i<100;i++){
  const input={kind:'word',id:String(i),day:1,passed:true};
  applyTrainingAnswer(data,g,input);applyTrainingAnswer(old,previous,input);
 }
 assert.ok(Math.abs(g.party[0].xp-previous.party[0].xp)<=1);
 assert.equal(g.party[0].ap,previous.party[0].ap);
});

test('季節種の重み3倍で実際の出現を増やし、季節外と単独制限を維持',()=>{
 const previous=structuredClone(data);previous.worldRoutes.seasonalWeightMultiplier=1;
 const a=encounterWeights(data,'world_a','spring');
 assert.equal(a.find(e=>e.monster.id==='pollen_bug').weight,45);
 assert.equal(a.find(e=>e.monster.id==='slime').weight,55);
 const count=d=>{const rng=seededRng(85);let found=0;for(let i=0;i<3000;i++)found+=makeEncounter(d,'world_a',1,rng,{season:'spring'}).filter(e=>e.monsterId==='pollen_bug').length;return found;};
 assert.ok(count(data)>count(previous)*1.8);
 assert.ok(!encounterWeights(data,'world_a','summer').some(e=>e.monster.id==='pollen_bug'));
});
