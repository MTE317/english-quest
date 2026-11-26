// 設計の参照と数値境界を点検する。ゲームの実装・バランス試験ではない。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {realGameData} from '../game/tests/helpers.js';

const data=realGameData();
const spec=JSON.parse(fs.readFileSync(new URL('../docs/specs/additional-jobs-19-24-skills-v1.json',import.meta.url),'utf8'));
const ids=['necromancer','onmyoji','shrine_maiden','summoner','druid','astrologer'];
assert.equal(spec.status,'design_only');assert.deepEqual(spec.jobs.map(j=>j.id),ids);
const skills=spec.jobs.flatMap(j=>j.skills),byId=new Map(skills.map(s=>[s.id,s]));
assert.equal(skills.length,90);assert.equal(byId.size,90);
assert.equal(spec.validation.stages,306);
const validElements=new Set([...data.elements.keys(),'contract','chosen_light_dark','light|dark']);
const baseMp=new Set([0,3,6,12]),costs=new Set([0,1,2,3,4,5]);
let verified=0;
for(const [i,j] of spec.jobs.entries()){
 assert.equal(j.additionalNumber,19+i);assert.equal(j.masterNumber,27+i);
 assert.equal(data.jobsById.get(j.id)?.name,j.name);assert.equal(data.jobsById.get(j.id)?.skillsReady,false);
 assert.deepEqual(['active','passive','ultimate'].map(t=>j.skills.filter(s=>s.type===t).length),[9,5,1]);
 for(const s of j.skills){
  verified++;
  assert.equal(data.skills.has(s.id),false,s.id+' is design only');
  assert.match(s.id,new RegExp('^'+j.id+'_(A0[1-9]|P0[1-5]|U01)$'));
  assert.equal(s.effects.length,s.maxLevel);assert.equal(s.levelRules.length,s.maxLevel);
  assert.deepEqual(s.levelRules.map(v=>v.level),Array.from({length:s.maxLevel},(_,n)=>n+1));
  assert.ok(costs.has(s.cost)&&baseMp.has(s.baseMp));
  assert.equal(s.upgradeAp.length,s.maxLevel-1);
  assert.deepEqual(s.upgradeAp,[12,20,30,45].slice(0,s.maxLevel-1));
  assert.ok([10,18,28,50].includes(s.learnAp));
  assert.ok(['M','MS','BM','F'].includes(s.reference),s.id+' formula');
  assert.ok(s.elements.every(el=>validElements.has(el)),s.id+' element');
  assert.ok(s.effects.every(e=>e.length>8&&!e.includes('{')&&!e.includes('undefined')),s.id+' details');
  for(const p of s.prerequisites){
   assert.ok(p.id.startsWith(j.id+'_'),s.id+' foreign prerequisite');
   assert.ok(byId.has(p.id)&&p.level<=byId.get(p.id).maxLevel,s.id+' missing prerequisite');
  }
  const visit=(v,key='')=>{
   if(Array.isArray(v)){for(const value of v)visit(value,key);return;}
   if(v&&typeof v==='object'){
    if(v.status?.id)assert.ok(data.statusEffects.has(v.status.id),s.id+' status '+v.status.id);
    for(const [k,value] of Object.entries(v))visit(value,k);
   }
   if(typeof v==='number')assert.ok(Number.isFinite(v)&&v>=0,s.id+' '+key);
  };
  s.levelRules.forEach(rule=>visit(rule));
 }
}
// 自己循環、同一職内の間接循環、未定義の習得経路を許さない。
const seen=new Set(),active=new Set();
function walk(id){if(seen.has(id))return;assert.ok(!active.has(id),id+' circular prerequisite');active.add(id);
 for(const p of byId.get(id).prerequisites)walk(p.id);
 active.delete(id);seen.add(id);}
for(const id of byId.keys())walk(id);
assert.equal(verified,90);
const rule=id=>byId.get(id).levelRules.at(-1);
assert.equal(rule('necromancer_A01').grantSoul.perAction,1);
assert.equal(rule('summoner_A08').contractChargeCost,2);
assert.equal(rule('shrine_maiden_A09').oncePerBattle,true);
assert.equal(rule('astrologer_P04').perBattle,3);
assert.ok(spec.commonRules.some(line=>line.includes('追加の味方行動')));
console.log(`設計検証: ${spec.jobs.length}職・${verified}技能・${spec.validation.stages}段階、参照・前提・費用・状態ID整合`);
