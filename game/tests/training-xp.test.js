import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame } from '../js/game-state.js';
import { applyTrainingAnswer } from '../js/training.js';
import { xpToNext, maxHp, maxMp } from '../js/character.js';
import { GameSession, SAVE_VERSION } from '../js/save.js';
import { realGameData, MemoryStorage } from './helpers.js';
const data=realGameData();
const floorRatio=data.balance.training.xp_min_level_fraction;
const fresh=()=>createNewGame(data,['warrior','knight','black_mage','white_mage','thief','bard'].map(job=>({name:job,job,icon:'human_01'})));
const answer=(g,id=0,extra={},d=data)=>applyTrainingAnswer(d,g,{kind:'word',id:String(id),day:1,passed:true,...extra});

test('訓練XPの低Lvと高い直近遠征報酬は従来値を維持する',()=>{
 for(const [lv,reference] of [[1,5],[5,5],[25,100],[99,5]]){
  const g=fresh();g.xpPerQuestion=reference;g.party.forEach(m=>m.lv=lv);
  const before=structuredClone(g),legacy=structuredClone(data);legacy.balance.training.xp_min_level_fraction=0;
  for(let i=0;i<10;i++){answer(g,i);answer(before,i,{},legacy);}
  assert.deepEqual(g,before);
 }
});

test('各人の必要XPで下限を計算し、戦闘不能者も既存どおり対象・APは全ジョブ共通',()=>{
 const g=fresh();const levels=[1,10,25,50,75,98];
 g.party.forEach((m,i)=>{m.lv=levels[i];m.ap=17;m.hp=0;});
 for(let i=0;i<100;i++)answer(g,i,{passed:i%5!==0});
 for(const [i,m]of g.party.entries()){
  if(levels[i]===1){assert.equal(m.lv,2);assert.equal(m.xp,50-xpToNext(data,1));}
  else {assert.equal(m.lv,levels[i]);assert.equal(m.xp,Math.floor(Math.max(.5,xpToNext(data,levels[i])*floorRatio)*100+1e-7));}
  assert.equal(m.ap,21);
 }
 assert.equal(g.day,1);assert.equal(g.gold,10000);assert.deepEqual(g.storage.materials,{});
});

test('期限正答のみ1.2倍、失敗にも従来の基礎報酬・同IDはモードをまたいでも1日1回',()=>{
 const g=fresh();g.party.forEach(m=>m.lv=50);
 const base=xpToNext(data,50)*floorRatio;
 answer(g,1,{due:true});answer(g,2,{due:true,passed:false});
 const snapshot=structuredClone(g);
 assert.deepEqual(answer(g,1,{due:true}),{awarded:false,xp:0,ap:0});assert.deepEqual(g,snapshot);
 assert.equal(g.party[0].xp,Math.floor(base*2.2));
 assert.equal(answer(g,1,{kind:'phrase'}).awarded,true);
 assert.equal(answer(g,1,{day:2}).awarded,true);
});

test('既存セーブの小数繰越・日内履歴・中断再開を変更せず保存する',()=>{
 const mem=new MemoryStorage(),session=new GameSession({storage:mem});session.startNew(fresh());
 session.update(g=>{g.party[0].lv=25;g.party[0].trainingCredit={xp:.9,ap:{warrior:.99,knight:.75}};answer(g,'first');});
 const before=structuredClone(session.game),reopened=new GameSession({storage:mem});
 assert.equal(reopened.state.version,SAVE_VERSION);assert.deepEqual(reopened.game,before);
 reopened.update(g=>assert.equal(answer(g,'first').awarded,false));
 assert.deepEqual(reopened.game,before);
 const continuous=structuredClone(before);
 reopened.update(g=>answer(g,'second'));answer(continuous,'second');assert.deepEqual(reopened.game,continuous);
 assert.equal(reopened.game.party[0].trainingCredit.ap,.82);
});

test('99上限とレベルアップHP/MP規則は既存gainXpに従う',()=>{
 const g=fresh(),m=g.party[0];m.lv=98;m.xp=xpToNext(data,98)-1;m.hp=maxHp(data,m)-10;m.mp=maxMp(data,m)-3;
 answer(g);assert.equal(m.lv,99);assert.equal(m.xp,0);assert.equal(m.hp,maxHp(data,m)-10);assert.equal(m.mp,maxMp(data,m)-3);
 for(let i=1;i<30;i++)answer(g,i);assert.equal(m.lv,99);assert.equal(m.xp,0);assert.ok(m.ap>0);
});

test('必要XP曲線の変更を反映し、報酬前の表示Lvや他メンバーLvを参照しない',()=>{
 const d=structuredClone(data);d.balance.player.xp_to_next='100 * Lv^2';
 const g=fresh();g.party[0].lv=20;g.party[1].lv=1;
 answer(g,0,{},d);assert.equal(g.party[0].xp,Math.floor(40000*floorRatio));assert.equal(g.party[1].xp,0);
 assert.equal(g.party[1].trainingCredit.xp,.5);
});

