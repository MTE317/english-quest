import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {loadData,sourceFingerprint,rngFor,chooseAction} from '../../../sim/balance.mjs';
import {realLearningCatalog} from '../../tests/helpers.js';
import {createNewGame} from '../../js/game-state.js';
import {applyTrainingAnswer} from '../../js/training.js';
import {xpToNext,maxHp,maxMp,equipFromStorage} from '../../js/character.js';
import {gearShopStock,buyGear} from '../../js/town.js';
import {makeEncounter} from '../../js/encounter.js';
import {createBattle,nextTurn,actionOptions,prepareQuizAction,setPending,resolvePending,battleRewards} from '../../js/battle.js';
const baselineSha='0dcf37c757d776b612ed86b731c8d223c1814f92';
const beforeSource=execFileSync('git',['show',baselineSha+':game/js/training.js'],{encoding:'utf8'});
const beforeModule=await import('data:text/javascript;base64,'+Buffer.from(beforeSource.replace("'./character.js?v=basic-skill-levels-1'",JSON.stringify(new URL('../../js/character.js?v=basic-skill-levels-1',import.meta.url).href))).toString('base64'));
const trainingHash=()=>createHash('sha256').update(readFileSync(new URL('../../js/training.js',import.meta.url))).digest('hex');
const data=loadData(),fingerprint=sourceFingerprint(),trainingSha256=trainingHash();
const catalog=realLearningCatalog(),levels=[1,5,10,25,50,75,98,99],jobs=['warrior','knight','black_mage','white_mage','thief','bard'];
const fresh=lv=>{const g=createNewGame(data,jobs.map(job=>({job,name:job,icon:'human_01'})));g.party.forEach(m=>{m.lv=lv;m.hp=maxHp(data,m);m.mp=maxMp(data,m);});return g;};
const chunk=[...catalog.phrasesByChunk.values()].sort((a,b)=>b.length-a.length)[0];assert.ok(chunk.length>=5);
const entries={words:catalog.words.slice(0,100).map(x=>({kind:'word',id:x.id})),phrases:catalog.phrases.slice(0,100).map(x=>({kind:'phrase',id:x.id})),chunks:chunk.slice(0,5).map(x=>({kind:'phrase',id:x.id})),review:[...catalog.words.slice(0,3).map(x=>({kind:'word',id:x.id})),...catalog.phrases.slice(0,2).map(x=>({kind:'phrase',id:x.id}))]};
const training=[];
// 5問セッション×20実日。同IDの日内二重報酬は避ける。ゲーム内日数は進めない。
for(const lv of levels)for(const reference of [5,30])for(const [mode,list]of Object.entries(entries))for(const due of [false,true]){
 const pair={};
 for(const [variant,apply]of [['before',beforeModule.applyTrainingAnswer],['after',applyTrainingAnswer]]){
  const g=fresh(lv);g.xpPerQuestion=reference;let displayedXp=0;
  for(let i=0;i<100;i++)displayedXp+=apply(data,g,{...list[i%list.length],day:1+Math.floor(i/5),due,passed:i%5!==0}).xp;
  const m=g.party[0];pair[variant]={lv:m.lv,xp:m.xp,credit:m.trainingCredit.xp,ap:m.ap,displayedPartyXp:displayedXp,progressTowardStartingLevel:lv===99?0:(m.xp+levelsSpent(lv,m.lv))/xpToNext(data,lv)};
 }
 training.push({startLv:lv,nextLevelXp:xpToNext(data,lv),reference,mode,due,questions:100,correct:80,...pair});
}
function levelsSpent(a,b){let x=0;for(let lv=a;lv<b;lv++)x+=xpToNext(data,lv);return x;}
const combat=[];const runs=16,seed=1217071;
for(const lv of levels)for(const id of ['mossy_cave','ruined_fort'])for(const boss of [false,true]){
 const template=fresh(lv);template.rank=lv>=6?'R02':'R01';template.gold=100000;
 if(lv>=6)for(const m of template.party)for(const slot of ['weapon','head','body','arm']){
  const j=data.jobsById.get(m.job),def=gearShopStock(data,template).map(x=>x.def).filter(e=>e.slot===slot&&(slot==='weapon'?e.kind===j.startWeapon:e.armorWeight===j.startArmorWeight)).sort((a,b)=>b.itemLv-a.itemLv)[0];
  const gear=buyGear(data,template,def.id);equipFromStorage(data,template,m,slot,gear.uid);
 }
 template.party.forEach(m=>{m.hp=maxHp(data,m);m.mp=maxMp(data,m);});
 const floors=data.dungeonFloors.filter(f=>f.dungeonId===id),floor=boss?floors.at(-1).floor:1;const trials=[];
 for(let n=0;n<runs;n++){
  const g=structuredClone(template),s=seed+n*7919,enemies=makeEncounter(data,id,floor,rngFor(s),{boss,season:'spring',elites:false});
  const b=createBattle(data,g,{enemies,seed:s,canFlee:false}),rng=rngFor(s^0x5f3759df);let questions=0;
  while(nextTurn(data,g,b)&&questions<400){const action=chooseAction(data,g,b,actionOptions(data,g,b,b.turn.i));if(!prepareQuizAction(data,g,b))continue;setPending(b,action,{wordId:'synthetic'});resolvePending(data,g,b,rng()<.8);questions++;}
  const xp=b.result==='win'?battleRewards(data,g,b).xp:jobs.map(()=>0);
  trials.push({seed:s,win:b.result==='win',questions,xp,enemyIds:enemies.map(e=>e.monsterId),enemyLevels:enemies.map(e=>e.lv)});
 }
 const totalQ=trials.reduce((s,t)=>s+t.questions,0),totalXp=trials.reduce((s,t)=>s+t.xp.reduce((a,b)=>a+b,0),0),partyXpPerQuestion=totalXp/totalQ;
 const reference=partyXpPerQuestion || 5; // XP0の帰還は参照を更新しない。旧値未設定の初期値で比較。
 combat.push({lv,id,boss,runs,referenceAssumption:partyXpPerQuestion?'aggregate estimate':'unchanged default 5',wins:trials.filter(t=>t.win).length,meanQuestions:totalQ/runs,perCharacterXpPerQuestion:partyXpPerQuestion/6,trainingBeforeAtThisReference:reference*.1,trainingAfterAtThisReference:Math.max(reference*.1,lv<99?xpToNext(data,lv)*.001:0),gear:lv>=6?'R02 ilvl13 quality1':'starter ilvl3 quality1',trials});
}
// 適正Lv敵からの報酬単価だけのプローブ。未公開の地域を遊べるとは仮定しない。
const equalLevelRewardProbe=levels.filter(lv=>lv<99).map(lv=>{
 const g=fresh(lv),enemies=makeEncounter(data,'mossy_cave',1,rngFor(seed),{season:'spring',elites:false});
 enemies.forEach(e=>e.lv=lv);const b=createBattle(data,g,{enemies,seed});
 const xp=battleRewards(data,g,b).xp[0];return {lv,enemies:enemies.length,xpPerCharacter:xp,trainingFloor:xpToNext(data,lv)*.001,breakEvenQuestions:xp/(xpToNext(data,lv)*.001)};
});
const unchanged=sourceFingerprint()===fingerprint&&trainingHash()===trainingSha256;assert.ok(unchanged);
writeFileSync(process.argv[2]??'game/verification/training-xp/results.json',JSON.stringify({baselineSha,trainingSha256,fingerprint,harnessSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),sourceUnchangedAtCompletion:unchanged,seed,runs,training,combat,equalLevelRewardProbe},null,2)+'\n');
console.log(JSON.stringify({trainingCases:training.length,combatBattles:combat.length*runs,unchanged}));
