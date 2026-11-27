import fs from 'node:fs';
import {data,newSession,run,townPrep} from './engine.mjs';
import {buyItem} from '../../js/town.js';
const inputs=new URL('./inputs/',import.meta.url).pathname,out=(process.env.OUT??'/tmp/canyon-verification')+'/';fs.mkdirSync(out,{recursive:true});
const rows=[],seasons=['spring','summer','autumn','winter'];
const materialCount=g=>Object.entries(g.storage.materials).reduce((n,[id,q])=>n+(data.materials.get(id)?.rank===3?q:0),0);
for(const file of fs.readdirSync(inputs).filter(x=>x.endsWith('.json')))for(const season of seasons)for(const accuracy of [.65,.8,.95])for(let n=0;n<4;n++)for(const level of [10,15])for(const mode of ['material','boss']){
 const input=JSON.parse(fs.readFileSync(inputs+file)),s=newSession(structuredClone(input.state.game));
 const before=materialCount(s.game),results=[];s.game.day=1+30*seasons.indexOf(season)-data.dungeons.get('howling_canyon').days;
 for(const r of data.dungeonFloors.filter(r=>r.dungeonId==='howling_canyon'))r.enemyLevel=(level===10?[10,12,15]:[15,17,19])[r.floor-1];
 for(let trip=1;trip<=(mode==='material'?3:1);trip++){
  const prep=townPrep(s.game,12345+trip);if(!s.game.items.return_feather)try{buyItem(data,s.game,'return_feather',1)}catch{}
  if(!s.game.items.return_feather&&mode==='material'){results.push({blocked:'feather'});break;}
  const r=run(s,{cohort:file,season,accuracy,n,dungeonId:'howling_canyon',seed:81827+trip*7919+n*104729,prep,firstFloor:mode==='material'});results.push(r);
  if(mode==='material'&&materialCount(s.game)>before)break;
 }
 rows.push({file,season,accuracy,n,level,mode,materialBefore:before,materialAfter:materialCount(s.game),results});
 console.log(JSON.stringify({file,season,accuracy,n,level,mode,trips:results.length,clear:results.some(r=>r.clear),material:materialCount(s.game)>before}));
 fs.writeFileSync(out+'final.json',JSON.stringify(rows));
}
