import {writeFileSync} from 'node:fs';
import {loadData,sourceFingerprint,rngFor} from '../../../sim/balance.mjs';
import {createNewGame} from '../../js/game-state.js';
import {maxHp,maxMp,equipFromStorage} from '../../js/character.js';
import {learnSkill,equipSkill,equipBlock} from '../../js/growth.js';
import {createBattle,makeEnemy,setPending,resolvePending,nextTurn,skillMp} from '../../js/battle.js';
import {rollBattleLoot} from '../../js/loot.js';
import {craft} from '../../js/workshop.js';
import {parseAmounts} from '../../js/csv.js';
const data=loadData(),fingerprint=sourceFingerprint(),runs=32;
const named={warrior:'steel_sword',knight:'craft_riposte_hammer',black_mage:'craft_siphon_tome',white_mage:'craft_staff_s2',
thief:'craft_dagger_s2',monk:'craft_thunder_claw',hunter:'craft_bow_s2',bard:'craft_instrument_s2'};
function makeWeapon(game,id){
 const def=data.equipment.get(id),recipe=data.recipes.find(r=>r.id===id);
 if(recipe?.derive_from)makeWeapon(game,recipe.derive_from);
 for(const {id,count}of parseAmounts(recipe?.materials??''))game.storage.materials[id]=(game.storage.materials[id]??0)+count;
 if(!recipe)game.storage.materials.fort_bandit_mat=4;
 craft(data,game,def);
 return game.storage.gear.at(-1);
}
const skillIds={warrior:'warrior_p1_s1',knight:'knight_p1_s1',black_mage:'black_mage_p1_s1',white_mage:'white_mage_p1_s1',thief:'thief_p2_s1',monk:'monk_p1_s1',hunter:'hunter_p1_s1',bard:'bard_p1_s1'};
const rows=[];
for(const [enemyId,dungeonId,lv]of [['goblin_boss','mossy_cave',5],['stone_giant','ruined_fort',10],['marsh_hydra','misty_marsh',11]])for(const [job,skillId] of Object.entries(skillIds))for(const mode of ['normal','skill'])for(const gearMode of ['generic','named']){
 const trials=[];
 for(let n=0;n<runs;n++){
  const seed=927141+n*7919,game=createNewGame(data,['warrior','black_mage','white_mage','hunter','thief',job].map((job,i)=>({job,name:'role'+i,icon:'human_01'})));
  for(const m of game.party){m.lv=10;m.hp=maxHp(data,m);m.mp=maxMp(data,m);}
  const m=game.party[5];m.ap=10;
  game.gold=100000;game.facilities.weapon_workshop=2;
  const recipe=data.recipes.find(r=>r.id===named[job]);
  const weapon=makeWeapon(game,gearMode==='named'?named[job]:recipe.base_equipment_id);
  equipFromStorage(data,game,m,'weapon',weapon.uid);
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
 const row={enemyId,job,mode,gearMode,runs};for(const metric of ['damage','heal','mpSpent','stolen','covered','incoming','focalTaken'])row[metric]=trials.reduce((sum,t)=>sum+Number(t[metric]),0)/runs;
 row.buffExample=trials[0].buffs;rows.push(row);
}
writeFileSync(process.argv[2]??'/tmp/basic-five-weapon-probes.json',JSON.stringify({fingerprint,runs,seed:927141,level:10,equipment:'generic/named quality 1.15, itemLv18, weapon workshop2; other slots starter',named,correct:true,rows,sourceUnchangedAtCompletion:fingerprint===sourceFingerprint()},null,2)+'\n');
