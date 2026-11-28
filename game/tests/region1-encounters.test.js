import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData,seededRng,readJson} from './helpers.js';
import {makeEncounter,monsterPool,encounterWeights} from '../js/encounter.js';
import {fixedBattleRewards} from '../js/monster-rewards.js';
import {installWorldData} from '../js/world-journey.js';

const data=realGameData({world:true}),seasons=['spring','summer','autumn','winter'];
test('全39種に到達可能な出現場所があり、季節外の敵・他地域の敵を抽選しない',()=>{
 const seen=new Set(),rng=seededRng(871);
 for(const node of data.worldRoutes.nodes)for(const season of seasons){
  if(node.key==='J'&&season!=='spring')continue;
  const pool=monsterPool(data,node.id,season);
  assert.ok(pool.length);
  for(let i=0;i<600;i++){
   const es=makeEncounter(data,node.id,1,rng,{season,elites:true});
   assert.ok(es.length>=1&&es.length<=2);
   for(const e of es){const m=data.monsters.get(e.monsterId);
    assert.ok(pool.some(m=>m.id===e.monsterId));assert.ok(m.season==='all'||m.season===season);
    assert.equal(e.lv,m.fixedStats.level);assert.ok(m.skillProfile);seen.add(e.monsterId);
   }
   assert.ok(es.filter(e=>e.skillProfile.skills.some(s=>s.kind==='heal')).length<=1);
   if(es.some(e=>node.soloMonsters.includes(e.monsterId)))assert.equal(es.length,1);
   assert.ok(fixedBattleRewards(data,es,node.id)?.length===es.length);
  }
  if(node.bossId){const boss=makeEncounter(data,node.id,3,rng,{season,boss:true,elites:true});
   assert.equal(boss.length,1);assert.equal(boss[0].monsterId,node.bossId);assert.equal(boss[0].eliteId,null);seen.add(node.bossId);}
 }
 assert.deepEqual([...seen].sort(),Object.keys(data.monsterSkills.monsters).sort());
});

test('抽選比率は設定した重みを使い、上位種は低頻度の単独出現',()=>{
 const rng=seededRng(73),n=data.worldRoutes.nodes.find(n=>n.key==='K');
 const weights=encounterWeights(data,n.id,'spring'),total=weights.reduce((s,e)=>s+e.weight,0),counts={};
 for(let i=0;i<6000;i++){const [e]=makeEncounter(data,n.id,1,rng,{season:'spring'});counts[e.monsterId]=(counts[e.monsterId]??0)+1;}
 for(const {monster,weight} of weights)assert.ok(Math.abs((counts[monster.id]??0)/6000-weight/total)<.025,monster.id);
 assert.ok(counts.kamaitachi<counts.canyon_wolf/2);
});

test('保存された戦闘を変更せず、同じ種と乱数で次の抽選を再現できる',()=>{
 const a=makeEncounter(data,'world_f',1,seededRng(991),{season:'summer',elites:true});
 const saved=JSON.parse(JSON.stringify(a));
 assert.deepEqual(a,makeEncounter(data,'world_f',1,seededRng(991),{season:'summer',elites:true}));
 makeEncounter(data,'world_f',1,seededRng(991),{season:'winter'});
 assert.deepEqual(saved,a);
});

test('敵数・出現比率・単独候補・季節の設定ミスを読み込み時に検出',()=>{
 for(const change of [n=>n.counts=[1,9],n=>n.weights.slime=0,n=>n.soloMonsters=['missing'],
  n=>{n.pool=['pollen_bug'];n.weights={pollen_bug:1};},n=>n.pool.push('slime')]){
  const config=readJson('world_routes.json');change(config.nodes[0]);
  assert.throws(()=>installWorldData(realGameData(),config),/出現設定/);
 }
});
