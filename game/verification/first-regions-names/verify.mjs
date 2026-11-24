// 表示名だけの変更と、全地域・全季節の遭遇／依頼表示を照合する。
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {parseCsv} from '../../js/csv.js';
import {buildGameData,GAME_FILES} from '../../js/gamedata.js';
import {rngFor} from '../../../sim/balance.mjs';
import {encounterWeights,makeEncounter} from '../../js/encounter.js';
import {questText} from '../../js/town.js';
const base=process.argv[2]??'a61b6ab';
const changes=JSON.parse(readFileSync(new URL('./changes.json',import.meta.url)));
const before={},after={};
for(const [key,file] of Object.entries(GAME_FILES)){
 const a=execFileSync('git',['show',`${base}:data/${file}`],{encoding:'utf8'}).replace(/^\uFEFF/,'');
 const b=readFileSync(new URL(`../../../data/${file}`,import.meta.url),'utf8').replace(/^\uFEFF/,'');
 before[key]=file.endsWith('.json')?JSON.parse(a):parseCsv(a).rows;
 after[key]=file.endsWith('.json')?JSON.parse(b):parseCsv(b).rows;
 const expected=structuredClone(before[key]);
 for(const c of changes[file.replace('.csv','')]??[]){const row=expected.find(x=>x.id===c.id);assert.equal(row.name,c.old);row.name=c.new;}
 assert.deepEqual(after[key],expected,file);
}
const old=buildGameData(before),data=buildGameData(after);
assert.equal(data.monsters.size,1024);
const targets=new Set(['mossy_cave','sunlit_forest']);
const arena=readFileSync(new URL('../../../data/arena_battles.csv',import.meta.url),'utf8');
for(const c of changes.monsters){
 const m=data.monsters.get(c.id);
 assert(m.dungeons.every(id=>targets.has(id)),c.id+' shared dungeon');
 assert(!arena.includes(c.id+':'),c.id+' arena');
 assert.equal([...data.monsters.values()].filter(x=>x.name===c.new).length,1);
 for(const type of ['hunt','boss','bounty'])assert(questText(data,{type,target:c.id,count:2}).includes(c.new));
}
// 名前以外をそのまま比較（アイコン、強さ、状態、耐性、素材IDなどを含む）。
const strip=(x)=>Array.isArray(x)?x.map(strip):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).filter(([k])=>k!=='name').map(([k,v])=>[k,strip(v)])):x;
let pools=0,encounters=0;
for(const id of data.dungeons.keys())for(const season of ['spring','summer','autumn','winter']){
 assert.deepEqual(strip(encounterWeights(data,id,season)),strip(encounterWeights(old,id,season)));pools++;
 const bounty=[...data.monsters.values()].find(m=>m.role==='bounty'&&m.dungeons.includes(id));
 for(const boss of [false,true])for(let seed=1;seed<=10;seed++){
  const opts={season,boss,...(seed%2&&bounty?{bountyId:bounty.id}:{})};
  assert.deepEqual(strip(makeEncounter(data,id,1,rngFor(seed),opts)),strip(makeEncounter(old,id,1,rngFor(seed),opts)));encounters++;
 }
}
console.log(JSON.stringify({base,monsters:1024,renamed:changes.monsters.length,pools,encounters,displayOnly:true}));
