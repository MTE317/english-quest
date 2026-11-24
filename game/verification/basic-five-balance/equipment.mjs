import {writeFileSync} from 'node:fs';
import {loadData,sourceFingerprint} from '../../../sim/balance.mjs';
import {monsterPool} from '../../js/encounter.js';
import {parseAmounts} from '../../js/csv.js';
import {createNewGame} from '../../js/game-state.js';
import {gearShopStock} from '../../js/town.js';
const data=loadData(),initial=['mossy_cave','sunlit_forest','goblin_quarry'],all=[...initial,'ruined_fort','misty_marsh'];
function audit(ids){
 const monsters=[...new Map(ids.flatMap(id=>[...monsterPool(data,id,'spring'),data.monsters.get(data.dungeons.get(id).bossId)]).map(m=>[m.id,m])).values()];
 const materials=new Map();for(const m of monsters)for(const id of [m.materialCommon,m.materialRare])if(id)materials.set(id,m.id);
 const recipes=data.recipes.filter(r=>Number(r.workshop_rank)<=2).map(r=>({
  id:r.id,name:r.name,rank:Number(r.workshop_rank),base:r.base_equipment_id,from:r.derive_from,gold:Number(r.gold),
  fixedEffects:data.equipment.get(r.id)?.fixedEffects,
  materials:parseAmounts(r.materials).map(x=>({...x,source:materials.get(x.id)??null})),
 }));
 const possible=new Set();
 for(let pass=0;pass<recipes.length;pass++)for(const r of recipes)if(r.materials.every(x=>x.source)&&(!r.from||possible.has(r.from)))possible.add(r.id);
 return {dungeons:ids,materialSources:Object.fromEntries(materials),recipes:recipes.map(r=>({...r,sourceReachable:possible.has(r.id)}))};
}
const stock={};
for(const rank of ['R01','R02']){
 const game=createNewGame(data,['warrior','knight','black_mage','white_mage','thief','bard'].map(job=>({job,name:job,icon:'human_01'})));game.rank=rank;
 stock[rank]=gearShopStock(data,game).map(x=>({id:x.def.id,itemLv:x.def.itemLv,price:x.price,slot:x.def.slot,kind:x.def.kind}));
}
writeFileSync(process.argv[2]??'/tmp/basic-five-equipment.json',JSON.stringify({fingerprint:sourceFingerprint(),stock,priorToRank2:audit(initial),farmingAllFive:audit(all)},null,2)+'\n');
