// 正式データと本体JSによる固定5人+1枠比較。AP・装備は検証用に供給する。
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {loadData,sourceFingerprint,rngFor,chooseAction} from '../../../sim/balance.mjs';
import {createNewGame} from '../../js/game-state.js';
import * as growth from '../../js/growth.js';
import {makeGear,maxHp,maxMp,canEquip,equipFromStorage,SLOTS} from '../../js/character.js';
import {createBattle,nextTurn,actionOptions,prepareQuizAction,setPending,resolvePending,finishBattle,skillMp} from '../../js/battle.js';
import {makeEncounter} from '../../js/encounter.js';
import {recoverAfterBattle} from '../../js/dungeon.js';
const data=loadData(), fingerprint=sourceFingerprint(), seed=1217071, runs=Number(process.env.RUNS??24), accuracy=.8;
const jobs=['black_mage'];
const modes=(process.env.MODES??'lv1,lv2,lv3,lv1_lore,lv2_lore,lv3_lore').split(',');
const settings=[{id:'mossy_cave',level:8,itemCap:10},{id:'sunken_temple',level:30,itemCap:36},{id:'silent_corridor',level:30,itemCap:36}];
const core={warrior:'warrior_p1_s1',knight:'knight_p2_s1',black_mage:'black_mage_p1_s1',white_mage:'white_mage_p1_s1',thief:'thief_p1_s1',monk:'monk_p1_s1',hunter:'hunter_p1_s1',bard:'bard_p2_s1'};
// 全て20+10 AP。旧mainでも前提込みで合法な同額の横展開。
const wide={warrior:['warrior_p1_s2','warrior_p1_s3'],knight:['knight_p1_s2','knight_p1_s3'],black_mage:['black_mage_p1_s2','black_mage_p1_s3'],white_mage:['white_mage_p1_s2','white_mage_p1_s3'],thief:['thief_p1_s2','thief_p1_s3'],monk:['monk_p1_s2','monk_p1_s3'],hunter:['hunter_p1_s2','hunter_p1_s3'],bard:['bard_p1_s2','bard_p1_s3']};
function fixture(job,mode,cfg){
 const game=createNewGame(data,['warrior','knight','white_mage','hunter','bard',job].map((job,i)=>({job,name:`検証${i}`,icon:'x'})));
 game.items={};
 for(const [i,m] of game.party.entries()){
  m.lv=cfg.level;m.ap[m.job]=i===5&&mode==='lv3_lore'?40:30;
  if(i<5)for(const id of wide[m.job])growth.learnSkill(data,m,id);
  if(i===5){
   const level=Number(mode[2]);
   for(let n=1;n<level;n++)growth.upgradeSkill(data,m,core[job]);
   growth.setSkillUseLevel(data,m,core[job],level);
   if(mode.endsWith('_lore'))growth.learnSkill(data,m,'black_mage_p1_s2');
  }
  // 同じAPの取得済み技能を同じ優先順で枠に装着する。奥義を自動装着不足で隠さない。
  const known=[...data.skills.values()].filter(s=>s.job===m.job&&growth.isLearned(m,s)&&(i<5||s.id===core[job]||s.kind==='passive'));
  known.sort((a,b)=>Number(b.isFinal)-Number(a.isFinal)||Number(b.kind==='heal_all')-Number(a.kind==='heal_all')||a.stage-b.stage);
  m.loadout={actions:[],passives:[]}; for(const s of known)if(!growth.equipBlock(data,m,s))growth.equipSkill(data,m,s.id);
  for(const slot of SLOTS){
   const jd=data.jobsById.get(m.job);
   const defs=[...data.equipment.values()].filter(e=>e.slot===slot&&!e.unique&&e.itemLv<=cfg.itemCap&&(slot!=='weapon'||e.kind===jd.startWeapon)&&(slot==='weapon'||!e.armorWeight||e.armorWeight===jd.startArmorWeight)).sort((a,b)=>b.itemLv-a.itemLv);
   const def=defs.find(e=>canEquip(data,m,slot,{id:e.id}).ok);if(!def)continue;
   const gear=makeGear(game,def.id,{quality:1.15,enh:1});game.storage.gear.push(gear);equipFromStorage(data,game,m,slot,gear.uid);
  }
  m.hp=maxHp(data,m);m.mp=maxMp(data,m);
 }
 const upgrade=[0,10,30][Number(mode[2])-1],lore=mode.endsWith('_lore')?10:0;
 assert.equal(game.party[5].ap[job],(mode==='lv3_lore'?40:30)-upgrade-lore);
 return game;
}
function fight(game,enemies,seed){
 const b=createBattle(data,game,{enemies,seed,canFlee:false}),answers=rngFor(seed^0x5f3759df);
 let questions=0,mpSpent=0,actualSkillMp=0,attackActions=0,partyAttackActions=0,kills=0;const skills={};
 while(nextTurn(data,game,b)&&questions<400){
  const i=b.turn.i,options=actionOptions(data,game,b,i),a=chooseAction(data,game,b,options);
  if(!prepareQuizAction(data,game,b))continue;
  if(i===5&&a.skillId){skills[a.skillId]=(skills[a.skillId]??0)+1;mpSpent+=skillMp(data,game.party[i],data.skills.get(a.skillId));}
  const attacking=a.type==='attack'||a.skillId&&data.skills.get(a.skillId)?.kind==='attack';
  if(attacking){partyAttackActions++;if(i===5)attackActions++;}
  const beforeMp=game.party[i].mp,beforeAlive=b.enemies.filter(e=>e.hp>0).length;
  setPending(b,a,{wordId:'simulation'});resolvePending(data,game,b,answers()<accuracy);questions++;
  kills+=beforeAlive-b.enemies.filter(e=>e.hp>0).length;
  if(i===5&&a.skillId)actualSkillMp+=beforeMp-game.party[i].mp;

 }
 const win=b.result==='win';if(win)finishBattle(data,game,b);
 return {win,questions,mpSpent,actualSkillMp,attackActions,partyAttackActions,kills,skills};
}
const rows=[],fixtures={};const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const summary=xs=>({battles:xs.length,wins:xs.filter(x=>x.win).length,questions:mean(xs.map(x=>x.questions)),mpSpent:mean(xs.map(x=>x.mpSpent)),actualSkillMp:mean(xs.map(x=>x.actualSkillMp)),attackActions:mean(xs.map(x=>x.attackActions)),partyAttackActions:mean(xs.map(x=>x.partyAttackActions)),kills:mean(xs.map(x=>x.kills)),skills:xs.reduce((o,x)=>{for(const [id,n]of Object.entries(x.skills))o[id]=(o[id]??0)+n;return o;},{})});
for(const cfg of settings)for(const job of jobs)for(const mode of modes){
 const template=fixture(job,mode,cfg);const key=`${cfg.id}/${job}/${mode}`;
 fixtures[key]=template.party.map(m=>({job:m.job,ap:m.ap,learned:m.learned,loadout:m.loadout,skillLevels:m.skillLevels,skillUseLevels:m.skillUseLevels,equip:Object.fromEntries(Object.entries(m.equip).map(([slot,g])=>[slot,g&&{...g,uid:undefined}]))}));
 const trials=[],normal=[],boss=[];
 for(let i=0;i<runs;i++){
  const game=structuredClone(template),rseed=seed+i*7919,rng=rngFor(rseed),battles=[];let stop=false;
  for(const floor of data.dungeonFloors.filter(f=>f.dungeonId===cfg.id)){
   for(let n=0;n<floor.battles;n++){
    const isBoss=floor.lastBattleIsBoss&&n===floor.battles-1;
    const enemies=makeEncounter(data,cfg.id,floor.floor,rng,{boss:isBoss,season:'spring',elites:false});
    const r=fight(game,enemies,rseed*1009+floor.floor*37+n);battles.push(r);(isBoss?boss:normal).push(r);
    if(!r.win){stop=true;break;}recoverAfterBattle(data,game);
   }if(stop)break;
  }
  trials.push({win:battles.every(b=>b.win),questions:battles.reduce((n,b)=>n+b.questions,0),mp:game.party[5].mp/maxMp(data,game.party[5]),actualSkillMp:battles.reduce((n,b)=>n+b.actualSkillMp,0),attackActions:battles.reduce((n,b)=>n+b.attackActions,0),partyAttackActions:battles.reduce((n,b)=>n+b.partyAttackActions,0),kills:battles.reduce((n,b)=>n+b.kills,0)});
 }
 const row={...cfg,job,mode,runs,wins:trials.filter(t=>t.win).length,questions:mean(trials.map(t=>t.questions)),endMp:mean(trials.map(t=>t.mp)),actualSkillMp:mean(trials.map(t=>t.actualSkillMp)),attackActions:mean(trials.map(t=>t.attackActions)),partyAttackActions:mean(trials.map(t=>t.partyAttackActions)),kills:mean(trials.map(t=>t.kills)),spentAp:(Number(mode[2])===3?30:Number(mode[2])===2?10:0)+(mode.endsWith('_lore')?10:0),remainingAp:template.party[5].ap[job],usedCapacity:growth.usedCapacity(data,template.party[5]),capacity:growth.capacity(data,template.party[5]),rawFireCoefficient:growth.effectiveSkill(data,template.party[5],data.skills.get(core[job])).effect.m*(1+(mode.endsWith('_lore')?data.skills.get('black_mage_p1_s2').effect.mod.edmg[1]:0)),normal:summary(normal),boss:summary(boss)};
 rows.push(row);console.log(`${key}: ${row.wins}/${runs}, Q=${row.questions.toFixed(2)}`);
}
const result={fingerprint,sourceUnchangedAtCompletion:fingerprint===sourceFingerprint(),harnessSha256:createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex'),runs,seed,accuracy,settings,fixtures,rows};
assert.ok(result.sourceUnchangedAtCompletion);writeFileSync(process.argv[2]??'/tmp/basic-lore-controls.json',JSON.stringify(result,null,2)+'\n');
