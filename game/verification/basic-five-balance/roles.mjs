import {writeFileSync} from 'node:fs';
import {loadData,sourceFingerprint,rngFor} from '../../../sim/balance.mjs';
import {createNewGame} from '../../js/game-state.js';
import {maxHp,maxMp} from '../../js/character.js';
import {learnSkill,equipSkill,equipBlock} from '../../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,skillMp} from '../../js/battle.js';
import {rollBattleLoot} from '../../js/loot.js';
const data=loadData(),fingerprint=sourceFingerprint(),runs=128;
const skillIds={warrior:'warrior_p1_s1',knight:'knight_p1_s1',black_mage:'black_mage_p1_s1',white_mage:'white_mage_p1_s1',thief:'thief_p2_s1',monk:'monk_p1_s1',hunter:'hunter_p1_s1',bard:'bard_p1_s1'};
const rows=[];
for(const [enemyId,dungeonId,lv]of [['goblin_boss','mossy_cave',5],['stone_giant','ruined_fort',10],['marsh_hydra','misty_marsh',11]])for(const [job,skillId] of Object.entries(skillIds))for(const mode of ['normal','skill']){
 const trials=[];
 for(let n=0;n<runs;n++){
  const seed=927141+n*7919,game=createNewGame(data,['warrior','black_mage','white_mage','hunter','thief',job].map((job,i)=>({job,name:'role'+i,icon:'human_01'})));
  for(const m of game.party){m.lv=6;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
  const m=game.party[5];m.ap=10;
  if(job==='knight'){learnSkill(data,m,'knight_p1_s2');if(!m.loadout.passives.includes('knight_p1_s2'))equipSkill(data,m,'knight_p1_s2');}
  if(!m.loadout.actions.includes(skillId)&&!equipBlock(data,m,data.skills.get(skillId)))equipSkill(data,m,skillId);
  const enemy=makeEnemy(data,enemyId,{lv,dungeonId,boss:true});
  const b=createBattle(data,game,{enemies:[enemy],seed,canFlee:false});b.round=1;b.turn={side:'ally',i:5};b.queue=[];
  game.party[0].hp=Math.floor(game.party[0].hp*.3);
  const hp=enemy.hp,ownMp=m.mp,hurt=game.party[0].hp;
  setPending(b,mode==='normal'?{type:'attack',target:0}:{type:'skill',skillId,target:0},{wordId:'probe'});
  resolvePending(data,game,b,true);
  const heal=game.party[0].hp-hurt,damage=hp-enemy.hp,mpSpent=ownMp-m.mp,buffs=structuredClone(b.partyBuffs);
  const before=game.party.map(m=>m.hp);b.turn=null;b.queue=[{side:'enemy',i:0},{side:'ally',i:1}];nextTurn(data,game,b);
  trials.push({damage,heal,mpSpent,buffs,stolen:(b.stolen??[]).length,covered:b.log.some(s=>s.includes('role5がかばった')),
   incoming:before.reduce((v,h,i)=>v+Math.max(0,h-game.party[i].hp),0),focalTaken:Math.max(0,before[5]-m.hp)});
 }
 const row={enemyId,job,mode,runs};for(const metric of ['damage','heal','mpSpent','stolen','covered','incoming','focalTaken'])row[metric]=trials.reduce((sum,t)=>sum+Number(t[metric]),0)/runs;
 row.buffExample=trials[0].buffs;rows.push(row);
}
// 盗賊の経済効果は戦闘火力の順位に混ぜず、同じ倒した敵・乱数列で別計測。
const loot=[];
for(const bonus of [0,.15]){
 const game=createNewGame(data,Array.from({length:6},(_,i)=>({job:'thief',name:'loot'+i,icon:'human_01'})));
 const enemy=makeEnemy(data,'goblin',{lv:3,dungeonId:'mossy_cave'});
 let materials=0;
 for(let n=0;n<1000;n++)materials+=rollBattleLoot(data,game,'mossy_cave',1,[structuredClone(enemy)],rngFor(927141+n*7919),{dropBonus:bonus}).materials.reduce((s,x)=>s+x.count,0);
 loot.push({bonus,runs:1000,materials});
}
writeFileSync(process.argv[2]??'/tmp/basic-five-roles.json',JSON.stringify({fingerprint,runs,seed:927141,level:6,equipment:'starter',correct:true,rows,loot,sourceUnchangedAtCompletion:fingerprint===sourceFingerprint()},null,2)+'\n');
