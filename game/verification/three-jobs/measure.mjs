// 本体JSと正式データ。資源を供給する検証用セーブだけを使用する。
import { writeFileSync } from 'node:fs';
import { loadData, sourceFingerprint, rngFor, chooseAction, prepareNextBattle } from '../../../sim/balance.mjs';
import { createNewGame } from '../../js/game-state.js';
import { maxHp, maxMp, makeGear, canEquip, equipFromStorage, SLOTS } from '../../js/character.js';
import { changeJob, learnSkill, isLearned, equipSkill, equipBlock } from '../../js/growth.js';
import { unlockJob } from '../../js/temple.js';
import { countKills, reportQuest } from '../../js/town.js';
import { makeEncounter } from '../../js/encounter.js';
import { recoverAfterBattle } from '../../js/dungeon.js';
import { makeEnemy, createBattle, nextTurn, actionOptions, prepareQuizAction, setPending, resolvePending, finishBattle, skillMp } from '../../js/battle.js';
const data=loadData(), fingerprint=sourceFingerprint(), runs=Number(process.env.RUNS??40), seed=1217071, accuracy=.8;
const fixed=['warrior','knight','white_mage','thief','bard'];
const variants=(process.env.JOBS??'black_mage,hunter,infernalist,seal_archer,neutralist').split(',');
export function fixture(job){
 const base=job==='seal_archer'?'hunter':job==='infernalist'||job==='neutralist'?'black_mage':job;
 const game=createNewGame(data,[...fixed,base].map((job,i)=>({job,name:`試験${i}`,icon:'x'})));
 const costs={jp:0,ap:{},materials:{}};
 if(job!==base){
  if(job==='seal_archer'){
   game.quests.push({uid:100,questId:'q_bounty_07_2',type:'bounty',rank:7,count:1,progress:0,target:'bounty_07_2',targetIds:['bounty_07_2'],dungeonId:'sky_isles'});
   const e=makeEnemy(data,'bounty_07_2',{lv:45});e.hp=0;countKills(game,[e],'sky_isles');reportQuest(data,game,100,()=>0);
  }else{costs.materials=job==='infernalist'?{lava_golem_rare:2,lava_golem_mat:4}:{paper_golem_rare:2,paper_golem_mat:4};game.storage.materials={...costs.materials};unlockJob(data,game,job);}
  game.jp=data.jobsById.get(job).changeJp;costs.jp=game.jp;changeJob(data,game,5,job);
 }
 for(const [i,m] of game.party.entries()){
  m.lv=45;m.loadout={actions:[],passives:[]};m.ap=1000;costs.ap[i]=0;
  const skills=[...data.skills.values()].filter(s=>s.job===m.job&&s.stage<=3);
  for(const s of skills){if(!isLearned(m,s)){learnSkill(data,m,s.id);costs.ap[i]+=s.apToLearn;}}
  m.loadout={actions:[],passives:[]};
  // 回復役の全体回復を優先。他は通常の段階順、承認3職は全3技能。
  skills.sort((a,b)=>(b.kind==='heal_all')-(a.kind==='heal_all')||a.stage-b.stage);
  for(const s of skills)if(!equipBlock(data,m,s))equipSkill(data,m,s.id);
  const jd=data.jobsById.get(m.job);
  for(const slot of SLOTS){
   const defs=[...data.equipment.values()].filter(e=>e.slot===slot&&!e.unique&&e.itemLv<=64&&(slot!=='weapon'||e.kind===jd.startWeapon)&&(slot==='weapon'||!e.armorWeight||e.armorWeight===jd.startArmorWeight)).sort((a,b)=>b.itemLv-a.itemLv);
   const def=defs.find(e=>canEquip(data,m,slot,makeGear(game,e.id)).ok);if(!def)continue;
   const gear=makeGear(game,def.id,{quality:1.15,enh:1});game.storage.gear.push(gear);equipFromStorage(data,game,m,slot,gear.uid);
  }
  m.hp=maxHp(data,m);m.mp=maxMp(data,m);
 }
 game.items={};return {game,costs};
}
function fight(game,enemies,seed){
 const b=createBattle(data,game,{enemies,seed,canFlee:false});const answers=rngFor(seed^0x5f3759df);let questions=0,eligibleTargets=0,mpSaved=0,selected=0,statusApplied=0;
 while(nextTurn(data,game,b)&&questions<400){
  const i=b.turn.i,options=actionOptions(data,game,b,i),action=chooseAction(data,game,b,options);
  if(!prepareQuizAction(data,game,b))continue;
  const correct=answers()<accuracy,m=game.party[i],skill=data.skills.get(action.skillId);
  if(i===5&&skill?.job===m.job)selected++;
  if(i===5&&correct){
   const targets=skill?.effect.tgt==='all'?enemies.filter(e=>e.hp>0):[enemies[action.target]].filter(Boolean);
   if(m.job==='infernalist'&&skill?.elements.includes('fire'))eligibleTargets+=targets.filter(e=>e.statuses.burn).length;
   if(m.job==='seal_archer'&&(!skill||skill.effect.base==='weapon'))eligibleTargets+=targets.filter(e=>e.statuses.seal).length;
   if(m.job==='neutralist'&&skill){const copy=structuredClone(m);copy.loadout.passives=[];mpSaved+=skillMp(data,copy,skill)-skillMp(data,m,skill);}
  }
  const status=m.job==='infernalist'?'burn':m.job==='seal_archer'?'seal':null;
  const before=enemies.map(e=>Boolean(status&&e.statuses[status]));
  setPending(b,action,{wordId:'simulation'});resolvePending(data,game,b,correct);questions++;
  if(i===5&&status)statusApplied+=enemies.filter((e,j)=>!before[j]&&e.statuses[status]).length;
 }
 if(b.result==='win')finishBattle(data,game,b);
 return {win:b.result==='win',questions,eligibleTargets,mpSaved,selected,statusApplied};
}
const scenarios=['sky_isles','drowned_city','lava_golem','stone_statue','m08_006'];
const results=[];const fixtures={};
for(const job of variants){const {game:template,costs}=fixture(job);fixtures[job]={costs,party:template.party.map(m=>({job:m.job,lv:m.lv,equip:m.equip,loadout:m.loadout}))};
 for(const scenario of scenarios){const trials=[];for(let n=0;n<runs;n++){
  const game=structuredClone(template),s=seed+n*7919,rng=rngFor(s);const battles=[];
  if(data.dungeons.has(scenario)){
   const rows=data.dungeonFloors.filter(r=>r.dungeonId===scenario);
   let stop=false;for(const row of rows){for(let bi=0;bi<row.battles;bi++){
    if(battles.length)prepareNextBattle(data,game);
    const enemies=makeEncounter(data,scenario,row.floor,rng,{boss:row.lastBattleIsBoss&&bi===row.battles-1,season:'spring',elites:false});
    const result=fight(game,enemies,s*1009+row.floor*37+bi);battles.push(result);if(!result.win){stop=true;break;}recoverAfterBattle(data,game);
   }if(stop)break;}
  }else battles.push(fight(game,[makeEnemy(data,scenario,{lv:45})],s*1009));
  trials.push({win:battles.every(b=>b.win),...Object.fromEntries(['questions','eligibleTargets','mpSaved','selected','statusApplied'].map(k=>[k,battles.reduce((s,b)=>s+b[k],0)])),mp:game.party[5].mp/maxMp(data,game.party[5])});
 }
 results.push({job,scenario,runs,wins:trials.filter(t=>t.win).length,...Object.fromEntries(['questions','eligibleTargets','mpSaved','selected','statusApplied','mp'].map(k=>[k,trials.reduce((s,t)=>s+t[k],0)/runs]))});
 }
}
const output={fingerprint,sourceUnchangedAtCompletion:fingerprint===sourceFingerprint(),seed,accuracy,runs,level:45,fixtures,results};
writeFileSync(process.argv[2]??'/tmp/three-jobs-results.json',JSON.stringify(output,null,2)+'\n');console.table(results);
