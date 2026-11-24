import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {loadData,sourceFingerprint,rngFor,chooseAction,prepareNextBattle} from '../../../sim/balance.mjs';
import {createNewGame} from '../../js/game-state.js';
import {maxHp,maxMp,equipFromStorage,gainXp} from '../../js/character.js';
import {learnSkill,equipSkill,equipBlock,isLearned} from '../../js/growth.js';
import {gearShopStock,buyGear,buyItem} from '../../js/town.js';
import {craft} from '../../js/workshop.js';
import {createBattle,nextTurn,actionOptions,prepareQuizAction,setPending,resolvePending,finishBattle,battleRewards,skillMp} from '../../js/battle.js';
import {makeEncounter} from '../../js/encounter.js';
import {recoverAfterBattle} from '../../js/dungeon.js';
const harnessSha256=createHash('sha256').update(readFileSync(import.meta.filename)).digest('hex');
const data=loadData(),fingerprint=sourceFingerprint(),runs=Number(process.env.RUNS??32),seed=1217071,accuracy=Number(process.env.ACCURACY??.8);
const jobs=data.jobs.filter(j=>j.tier==='base').map(j=>j.id);
const dungeons=(process.env.DUNGEONS??'mossy_cave,sunlit_forest,goblin_quarry,ruined_fort,misty_marsh').split(',');
const purchases={
 warrior:['warrior_p1_s2','warrior_p1_s3'],knight:['knight_p1_s2','knight_p3_s2','knight_p2_s2'],
 black_mage:['black_mage_p1_s2','black_mage_p1_s3'],white_mage:['white_mage_p1_s2','white_mage_p1_s3'],
 thief:['thief_p1_s2','thief_p2_s2','thief_p3_s2'],monk:['monk_p1_s2','monk_p2_s2','monk_p3_s2'],
 hunter:['hunter_p1_s2','hunter_p2_s2','hunter_p3_s2'],bard:['bard_p1_s2','bard_p2_s2','bard_p3_s2'],
};
const mean=xs=>xs.reduce((a,b)=>a+b,0)/(xs.length||1),sum=xs=>xs.reduce((a,b)=>a+b,0);
function fixture(job,id,phase,gearMode){
 const star=data.dungeons.get(id).rank,level=phase==='first'?(star===1?1:6):(star===1?5:10);
 const ap=phase==='first'&&star===1?0:30;
 const game=createNewGame(data,['warrior','knight','black_mage','white_mage','bard',job].map((job,i)=>({job,name:'test'+i,icon:'human_01'})));
 game.rank=star===1?'R01':'R02';game.gold=100000;game.items={};
 const material=star===1?'goblin_mat':'fort_bandit_mat';
 game.storage.materials[material]=1000;
 game.facilities.weapon_workshop=star;game.facilities.armor_workshop=star;
 const gearCosts=[];
 for(const m of game.party){
  m.lv=level;m.ap[m.job]=ap;
  if(ap)for(const id of purchases[m.job])learnSkill(data,m,id);
  const known=[...data.skills.values()].filter(s=>s.job===m.job&&isLearned(m,s));
  // 回復/全体技を先に装着。自職以外の持ち出し・奥義・上位職なし。
  known.sort((a,b)=>Number(b.kind==='heal_all')-Number(a.kind==='heal_all')||a.stage-b.stage);
  m.loadout={actions:[],passives:[]};
  for(const s of known)if(!equipBlock(data,m,s))equipSkill(data,m,s.id);
  const jd=data.jobsById.get(m.job);
  for(const slot of ['weapon','head','body','arm']){
   const match=e=>e.slot===slot&&(slot==='weapon'?e.kind===jd.startWeapon:e.armorWeight===jd.startArmorWeight);
   if(gearMode==='starter')continue;
   let def;
   if(gearMode==='shop'){
    def=gearShopStock(data,game).map(x=>x.def).filter(match).sort((a,b)=>b.itemLv-a.itemLv)[0];
    const before=game.gold;const gear=buyGear(data,game,def.id);equipFromStorage(data,game,m,slot,gear.uid);
    gearCosts.push({job:m.job,id:def.id,gold:before-game.gold});
   } else {
    def=[...data.equipment.values()].filter(e=>match(e)&&e.star===star&&!e.unique&&!e.setId&&e.source.includes('制作')&&!data.recipes.some(r=>r.id===e.id)).sort((a,b)=>b.itemLv-a.itemLv)[0];
    const before=game.gold;craft(data,game,def);const gear=game.storage.gear.at(-1);equipFromStorage(data,game,m,slot,gear.uid);
    gearCosts.push({job:m.job,id:def.id,gold:before-game.gold,material,count:4});
   }
  }
  m.hp=maxHp(data,m);m.mp=maxMp(data,m);
 }
 for(const [id,n]of Object.entries({potion:3,ether:2,revive_salts:1,antidote:2}))buyItem(data,game,id,n);
 return {game,meta:{level,ap,rank:game.rank,gearMode,gearCosts,setupGold:100000-game.gold,materialSource:gearMode==='crafted'?material:null,
  slots:game.party.map(m=>({job:m.job,loadout:m.loadout,equip:Object.fromEntries(Object.entries(m.equip).filter(([,g])=>g).map(([k,g])=>[k,{id:g.id,quality:g.quality,enh:g.enh}]))}))}};
}
function fight(game,enemies,s,firstBattle){
 const b=createBattle(data,game,{enemies,seed:s,firstBattle,canFlee:false}),answers=rngFor(s^0x5f3759df);
 let questions=0,damage=0,healing=0,mp=0,turns=0,buffs=0;const skills={};
 while(nextTurn(data,game,b)&&questions<400){
  const i=b.turn.i,opts=actionOptions(data,game,b,i),action=chooseAction(data,game,b,opts);
  if(!prepareQuizAction(data,game,b))continue;
  const correct=answers()<accuracy;
  const beforeE=sum(b.enemies.map(e=>e.hp)),beforeH=sum(game.party.map(m=>m.hp));
  if(i===5){turns++; if(correct&&action.skillId){const sk=data.skills.get(action.skillId);mp+=skillMp(data,game.party[i],sk);skills[sk.id]=(skills[sk.id]??0)+1;if(sk.kind.includes('buff'))buffs++;}}
  setPending(b,action,{wordId:'simulation'});resolvePending(data,game,b,correct);questions++;
  if(i===5){damage+=Math.max(0,beforeE-sum(b.enemies.map(e=>e.hp)));healing+=Math.max(0,sum(game.party.map(m=>m.hp))-beforeH);}
 }
 if(b.result==='win')finishBattle(data,game,b);
 return {b,win:b.result==='win',questions,damage,healing,mp,turns,buffs,skills};
}
const rows=[],fixtures={};
for(const id of dungeons)for(const phase of ['first','farm']){
 const star=data.dungeons.get(id).rank;
 // 初回は対象地域の報酬を使わない。周回では同地域の通常素材制作を比較する。
 for(const gearMode of phase==='first'?[star===1?'starter':'shop']:['shop','crafted'])for(const job of jobs){
  const {game:template,meta}=fixture(job,id,phase,gearMode);const key=[id,phase,gearMode,job].join('/');
  fixtures[key]=meta;const trials=[],floorRows=[];
  for(let n=0;n<runs;n++){
   const game=structuredClone(template),s=seed+n*7919,rng=rngFor(s),initialItems={...game.items};let win=true;const battles=[];
   for(const floor of data.dungeonFloors.filter(f=>f.dungeonId===id)){
    for(let k=0;k<floor.battles;k++){
     if(battles.length)prepareNextBattle(data,game);
     const boss=floor.lastBattleIsBoss&&k===floor.battles-1;
     const enemies=makeEncounter(data,id,floor.floor,rng,{boss,season:'spring',elites:false});
     const r=fight(game,enemies,s*1009+floor.floor*37+k,battles.length===0);battles.push(r);
     floorRows.push({floor:floor.floor,boss,win:r.win,questions:r.questions,enemyIds:enemies.map(e=>e.monsterId)});
     if(!r.win){win=false;break;}
     const rewards=battleRewards(data,game,r.b);for(const [i,m]of game.party.entries())gainXp(data,m,rewards.xp[i]);
     recoverAfterBattle(data,game);
    }if(!win)break;
   }
   trials.push({seed:s,win,questions:sum(battles.map(x=>x.questions)),damage:sum(battles.map(x=>x.damage)),healing:sum(battles.map(x=>x.healing)),
    mpSpent:sum(battles.map(x=>x.mp)),turns:sum(battles.map(x=>x.turns)),buffs:sum(battles.map(x=>x.buffs)),
    endHp:sum(game.party.map(m=>m.hp))/sum(game.party.map(m=>maxHp(data,m))),endMp:game.party[5].mp/maxMp(data,game.party[5]),
    consumed:Object.fromEntries(Object.entries(initialItems).map(([id,n])=>[id,n-(game.items[id]??0)])),
    skills:battles.reduce((o,r)=>{for(const [id,n]of Object.entries(r.skills))o[id]=(o[id]??0)+n;return o;},{})});
  }
  const row={id,phase,gearMode,job,runs,wins:trials.filter(x=>x.win).length};
  for(const metric of ['questions','damage','healing','mpSpent','turns','buffs','endHp','endMp'])row[metric]=mean(trials.map(x=>x[metric]));
  row.items=Object.fromEntries(Object.keys(template.items).map(id=>[id,mean(trials.map(x=>x.consumed[id]))]));
  row.floors=[...new Set(floorRows.map(x=>x.floor))].map(floor=>{const rs=floorRows.filter(x=>x.floor===floor);return{floor,boss:rs[0].boss,reached:rs.length,wins:rs.filter(x=>x.win).length,questions:mean(rs.map(x=>x.questions)),enemyIds:[...new Set(rs.flatMap(x=>x.enemyIds))]};});
  row.skills=trials.reduce((o,r)=>{for(const[id,n]of Object.entries(r.skills))o[id]=(o[id]??0)+n;return o;},{});
  row.trials=trials;rows.push(row);console.log(key,row.wins+'/'+runs,row.questions.toFixed(1));
 }
}
assert.equal(fingerprint,sourceFingerprint());
writeFileSync(process.argv[2]??'/tmp/basic-five.json',JSON.stringify({fingerprint,harnessSha256,sourceUnchangedAtCompletion:true,runs,seed,accuracy,season:'spring',elites:false,bounties:false,fixedFive:['warrior','knight','black_mage','white_mage','bard'],fixtures,rows},null,2)+'\n');
