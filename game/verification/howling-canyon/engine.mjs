import {writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {loadData,rngFor,chooseAction,prepareNextBattle} from '../../../sim/balance.mjs';
import {preparedNewGame} from '../../verification/intro-route/fixture.mjs';
import {MemoryStorage} from '../../tests/helpers.js';
import {GameSession} from '../../js/save.js';
import {startRun,startNextBattle,afterBattle,resolveLoot,returnToTown,allowedDungeons,returnItems,isBossBattle} from '../../js/dungeon.js';
import {nextTurn,setPending,resolvePending,prepareQuizAction,battleRewards} from '../../js/battle.js';
import {maxHp,maxMp,weaponPower,spellPower,armorPieceValue,gearDef,canEquip,equipFromStorage,computeStats} from '../../js/character.js';
import {stayInn,revive,buyItem,calendarOf} from '../../js/town.js';
import {canCraft,craft} from '../../js/workshop.js';
const repo=new URL('../../../',import.meta.url).pathname,data=loadData(),N=Number(process.env.SEEDS??16),preparedLevel=Number(process.env.PREPARED_LEVEL??4),sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
export function fingerprint(){const h=createHash('sha256');for(const f of execFileSync('git',['ls-files','game/js','data'],{cwd:repo,encoding:'utf8'}).trim().split('\n'))h.update(f+'\0').update(readFileSync(repo+'/'+f));return h.digest('hex');}
const hash=fingerprint(),ids=['windward_plain','sunlit_forest','mossy_cave','goblin_quarry','ruined_fort','misty_marsh'],seasons=['spring','summer','autumn','winter'],accuracies=[.65,.8,.95];
const stock={potion:3,ether:2,revive_salts:1,antidote:2},rows=[];
export const snapshot=g=>structuredClone({gold:g.gold,items:{...g.items},materials:{...g.storage.materials},party:g.party.map(m=>({job:m.job,lv:m.lv,xp:m.xp,ap:m.ap,hp:m.hp,mp:m.mp,stats:computeStats(data,m),skillLevels:m.skillLevels,learned:m.learned,loadout:m.loadout,equip:structuredClone(m.equip)})),cleared:{...g.cleared}});
export function newSession(g){const s=new GameSession({storage:new MemoryStorage()});s.startNew(g);return s;}
function gearScore(m,gear,slot){if(!gear)return -1;const def=gearDef(data,gear),bonus=Object.values(gear.affixes??{}).filter(Number.isFinite).reduce((a,b)=>a+Math.abs(b),0)*.01;if(slot==='weapon')return weaponPower(data,m,gear)+spellPower(data,m,gear)+bonus;if(['head','body','arm'].includes(slot))return armorPieceValue(data,m,gear)+bonus;return Object.values(gear.affixes??{}).filter(Number.isFinite).reduce((a,b)=>a+b,0);}
export function equipEarned(g){const changes=[];for(const [i,m] of g.party.entries())for(const slot of ['weapon','head','body','arm','cloak','accessory1','accessory2']){
 const original=m.equip[slot];const kind=slot.startsWith('accessory')?'accessory':slot;
 const c=g.storage.gear.filter(x=>gearDef(data,x).star<=2&&gearDef(data,x).slot===kind&&canEquip(data,m,slot,x).ok&&(slot!=='weapon'||gearDef(data,x).kind===gearDef(data,original)?.kind));
 c.sort((a,b)=>gearScore(m,b,slot)-gearScore(m,a,slot));const best=c[0];if(best&&gearScore(m,best,slot)>gearScore(m,original,slot)){equipFromStorage(data,g,m,slot,best.uid);changes.push({member:i,slot,id:best.id,rarity:best.rarity,crafted:!!best.crafted});}
 }return changes;}
export function townPrep(g,seed,{crafting=false}={}){const log={goldBefore:g.gold,bought:[],crafted:[],equipped:[]};
 for(let i=0;i<g.party.length;i++)if(g.party[i].hp<=0){try{revive(data,g,i);}catch{log.reviveUnaffordable=true;}}
 try{stayInn(data,g,false);}catch{log.innUnaffordable=true;}
 for(const [id,target]of Object.entries(stock)){const need=target-(g.items[id]??0);if(need>0)try{log.bought.push({id,count:buyItem(data,g,id,need)});}catch{log.itemUnaffordable=true;}}
 if(crafting){const rng=rngFor(seed^0x72b51);for(const m of g.party){const def=gearDef(data,m.equip.weapon);if(!m.equip.weapon.crafted&&def.source.includes('制作')&&canCraft(data,g,def)){craft(data,g,def,rng);log.crafted.push(def.id);}}}
 log.equipped=equipEarned(g);log.goldAfter=g.gold;return log;
}
export function run(s,{cohort,phase,season,accuracy,n,dungeonId,seed,prep,retreat=false,onEntry=null,onReturn=null,onAnswer=null,materialReturn=false,firstFloor=false}){
 const row={cohort,phase,season,accuracy,n,dungeonId,seed,prep,reached:false,clear:false,questions:0,correct:0,battles:[],before:snapshot(s.game)};
 if(!allowedDungeons(data,s.game).some(d=>d.id===dungeonId)){row.unreached='locked';rows.push(row);return row;}
 try{startRun(data,s,{dungeonId,stoneId:'00',quizState:{asked:0},seed});}catch(e){row.unreached=e.message;rows.push(row);return row;}
 if(onEntry)onEntry(s);row.reached=true;row.actualSeason=calendarOf(data,s.game.day).season.id;const answer=rngFor(seed^0x5f3759df);
 while(s.run){
  while(s.run?.state==='loot')resolveLoot(data,s,null);
  if(s.run?.state==='cleared'){returnToTown(data,s);row.clear=true;break;}
  if(materialReturn && row.battles.length && ((s.game.storage.materials.fort_bandit_mat??0)+(s.run.backpack?.materials?.fort_bandit_mat??0)>=2 || isBossBattle(data,s.run)) && returnItems(data,s.game).length){returnToTown(data,s,returnItems(data,s.game)[0]);row.retreat=true;row.materialRetreat=true;break;}
  if(firstFloor && row.battles.length){returnToTown(data,s,'return_feather');row.retreat=true;break;}
  prepareNextBattle(data,s.game);
  if(retreat && row.battles.length && (s.game.party.filter(m=>m.hp>0).length<5 || s.game.party.reduce((v,m)=>v+m.hp,0)/s.game.party.reduce((v,m)=>v+maxHp(data,m),0)<.5) && returnItems(data,s.game).length){
    returnToTown(data,s,returnItems(data,s.game)[0]);row.retreat=true;break;
  }
  startNextBattle(data,s);const b=s.run.battle,br={floor:s.run.floor,ids:b.enemies.map(e=>e.monsterId),levels:b.enemies.map(e=>e.lv),boss:b.enemies.some(e=>e.boss),elite:b.enemies.filter(e=>e.eliteId).length,questions:0,correct:0,itemsBefore:{...s.game.items}};
  const counts={};while(nextTurn(data,s.game,b)){
   if(br.questions>1000){row.cutoff=true;break;}
   if(!prepareQuizAction(data,s.game,b))continue;
   const action=chooseAction(data,s.game,b);counts[action.skillId??action.itemId??action.type]=(counts[action.skillId??action.itemId??action.type]??0)+1;setPending(b,action,{wordId:'synthetic',reason:'neutral'});const ok=answer()<accuracy;resolvePending(data,s.game,b,ok);br.questions++;br.correct+=Number(ok);s.run.quiz.asked++;if(onAnswer)onAnswer(s,ok);
  }
  br.actionCounts=counts;br.rewardBefore= b.result==='win'?battleRewards(data,s.game,b,{dungeonId}):null;br.memberLevels=s.game.party.map(m=>m.lv);br.result=b.result;br.hp=s.game.party.map(m=>m.hp);br.mp=s.game.party.map(m=>m.mp);br.itemsAfter={...s.game.items};row.questions+=br.questions;row.correct+=br.correct;row.battles.push(br);
  if(row.cutoff)break;
  const r=afterBattle(data,s);br.growth=r.growth;br.loot=r.loot;br.wiped=!!r.wiped;
  if(r.result==='lose'){row.failure=r.wiped?'wipe':'round-limit';break;}
 }
 if(onReturn)onReturn(s,row);row.after=snapshot(s.game);rows.push(row);return row;
}

export {data,ids,seasons,accuracies,rows,sha,gearScore};
