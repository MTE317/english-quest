import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {loadData,rngFor,chooseAction,prepareNextBattle,sourceFingerprint} from '../../../sim/balance.mjs';
import {preparedNewGame} from '../intro-route/fixture.mjs';
import {MemoryStorage} from '../../tests/helpers.js';
import {GameSession} from '../../js/save.js';
import {startRun,startNextBattle,afterBattle,resolveLoot,returnToTown} from '../../js/dungeon.js';
import {battleRewards,nextTurn,setPending,resolvePending,prepareQuizAction} from '../../js/battle.js';
import {stayInn} from '../../js/town.js';
const data=loadData(), old=loadData();delete old.balance.rewards.fixed_monster_dungeons;
const fingerprint=()=>({engine:sourceFingerprint(),rewards:createHash('sha256').update(readFileSync(new URL('../../js/monster-rewards.js',import.meta.url))).digest('hex')});
const start=fingerprint(), seasons=['spring','summer','autumn','winter'],ids=data.balance.rewards.fixed_monster_dungeons;
function session(d,season){const {game}=preparedNewGame(d);game.day=1+30*seasons.indexOf(season);const s=new GameSession({storage:new MemoryStorage()});s.startNew(game);return s;}
const encounter=[];
// 同一抽選・全勝を仮定した報酬だけの比較。各戦のLv1で上方レベル差ペナルティを無効化。
for(const season of seasons)for(const dungeonId of ids)for(let n=0;n<128;n++){
 const s=session(data,season);s.game.cleared=Object.fromEntries(ids.map(id=>[id,1]));s.game.gold=100000;
 const seed=172903+n*7919;startRun(data,s,{dungeonId,stoneId:'00',quizState:{asked:0},seed});
 const row={season,dungeonId,seed,oldXp:0,xp:0,oldAp:0,ap:0,battles:0,elite:0,bounty:0};
 while(s.run.state!=='cleared'){
  while(s.run.state==='loot')resolveLoot(data,s,null);
  if(s.run.state==='cleared')break;
  s.game.party.forEach(m=>{m.lv=1;m.hp=999;m.xp=0;});startNextBattle(data,s);const b=s.run.battle;
  const before=battleRewards(old,s.game,b), after=battleRewards(data,s.game,b,{dungeonId});
  row.oldXp+=before.xp[0];row.xp+=after.xp[0];row.oldAp+=before.ap[0];row.ap+=after.ap[0];row.battles++;row.elite+=b.enemies.filter(e=>e.eliteId).length;row.bounty+=b.enemies.filter(e=>e.bounty).length;
  b.enemies.forEach(e=>e.hp=0);b.result='win';afterBattle(data,s);
 }
 encounter.push(row);
}
const progress=[];
for(const mode of ['old','fixed'])for(const fought of [false,true])for(const accuracy of fought?[.65,.8]:[1])for(const season of seasons)for(let n=0;n<32;n++){
 const d=mode==='old'?old:data,s=session(d,season);
 for(const [index,dungeonId] of ids.slice(0,3).entries()){
  const seed=172903+n*7919+index*101,answer=rngFor(seed^0x5f3759df);
  const row={mode,fought,accuracy,season,n,dungeonId,seed,questions:0,xp:0,ap:0,clear:false};
  startRun(d,s,{dungeonId,stoneId:'00',quizState:{asked:0},seed});
  while(s.run){
   while(s.run?.state==='loot')resolveLoot(d,s,null);
   if(s.run?.state==='cleared'){returnToTown(d,s);row.clear=true;break;}
   prepareNextBattle(d,s.game);startNextBattle(d,s);const b=s.run.battle;
   if(fought){while(nextTurn(d,s.game,b)){if(row.questions>1000)throw Error('question cap');if(!prepareQuizAction(d,s.game,b))continue;setPending(b,chooseAction(d,s.game,b),{wordId:'synthetic',reason:'neutral'});resolvePending(d,s.game,b,answer()<accuracy);row.questions++;}}
   else {b.enemies.forEach(e=>e.hp=0);b.result='win';}
   const result=afterBattle(d,s);row.xp+=result.growth[0]?.xp??0;row.ap+=result.growth[0]?.ap??0;
  }
  row.balances=s.game.party.map(m=>({ap:m.ap,xp:m.xp}));row.lv=s.game.party.map(m=>m.lv);row.gold=s.game.gold;progress.push(row);
  if(!row.clear)break;if(index<2)stayInn(d,s.game,false);
 }
}
const mean=(rows,key)=>rows.reduce((s,r)=>s+r[key],0)/rows.length;
const encounters=ids.map(dungeonId=>{const r=encounter.filter(r=>r.dungeonId===dungeonId);return {dungeonId,runs:r.length,...Object.fromEntries(['oldXp','xp','oldAp','ap','elite','bounty'].map(k=>[k,mean(r,k)]))};});
const progression=[];
for(const mode of ['old','fixed'])for(const fought of [false,true])for(const accuracy of fought?[.65,.8]:[1])for(const dungeonId of ids.slice(0,3)){
 const r=progress.filter(r=>r.mode===mode&&r.fought===fought&&r.accuracy===accuracy&&r.dungeonId===dungeonId);
 progression.push({mode,fought,accuracy,dungeonId,runs:r.length,clears:r.filter(r=>r.clear).length,questions:mean(r,'questions'),xp:mean(r,'xp'),ap:mean(r,'ap'),levels:[...new Set(r.flatMap(r=>r.lv))]});
}
const result={fingerprint:start,sourceUnchanged:JSON.stringify(start)===JSON.stringify(fingerprint()),seed:172903,step:7919,encounters,progression,encounter,progress};
const {encounter:rawEncounters,progress:rawProgress,...summary}=result;
writeFileSync(new URL('./results.json',import.meta.url),JSON.stringify(summary,null,2).slice(0,-2)+',\n  "encounter": [\n'+rawEncounters.map(r=>'    '+JSON.stringify(r)).join(',\n')+'\n  ],\n  "progress": [\n'+rawProgress.map(r=>'    '+JSON.stringify(r)).join(',\n')+'\n  ]\n}\n');console.table(encounters);console.table(progression);
