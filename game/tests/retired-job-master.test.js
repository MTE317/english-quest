import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { realGameData } from './helpers.js';

const retiredJobs = ['stormcaster','venomist','bloodblade','infernalist','seal_archer','neutralist','petrifier'];
const data=realGameData();

test('現行マスターは基本8・追加36・伝説6、基本120技能と追加30職450技能に統一する',()=>{
  assert.equal(data.jobs.length,50);
  assert.equal(data.jobs.filter(j=>j.tier==='base').length,8);
  assert.equal(data.jobs.filter(j=>j.tier==='additional').length,36);
  assert.equal(data.jobs.filter(j=>j.tier==='legendary').length,6);
  assert.equal(new Set(data.jobs.map(j=>j.id)).size,50);
  for(const id of retiredJobs)assert.ok(!data.jobsById.has(id),id);
  const skills=[...data.skills.values()].filter(s=>s.job!=='common');
  assert.equal(skills.length,570);
  assert.ok(skills.every(s=>s.effect.master&&data.jobsById.get(s.job)?.skillsReady));
  assert.ok(skills.every(s=>!/_p\d+_s\d+$/.test(s.id)));
});

test('旧212技能の修得・強化費用を返還用カタログへ保持する',()=>{
  const catalog=data.skillMigration.retired_skills;
  assert.equal(catalog.length,212);
  assert.equal(new Set(catalog.map(s=>s.id)).size,212);
  for(const job of retiredJobs){
    assert.ok(catalog.some(s=>s.job===job),job);
    assert.ok(![...data.skills.values()].some(s=>s.job===job));
  }
  for(const old of catalog){
    assert.ok(Number.isInteger(old.ap)&&old.ap>=0,old.id);
    assert.ok(Array.isArray(old.levels));
    assert.ok(old.levels.every(l=>Number.isInteger(l.ap)&&l.ap>=0));
    assert.ok(!data.skills.has(old.id),old.id);
  }
  const oldFirst=catalog.find(s=>s.id==='warrior_p1_s1');
  assert.deepEqual([oldFirst.ap,...oldFirst.levels.map(l=>l.ap)],[10,10,20]);
});

test('旧extra_game_dataに廃止職と技能が残っていても読込時に復活しない',async()=>{
  const previousFetch=globalThis.fetch;
  const injected={
    jobsAdvanced:[{id:'stormcaster',name:'旧雷術士'}],
    skills:[{id:'legacy-injected-skill',job:'stormcaster',name:'旧雷技能',kind:'attack',effect_json:'{}'}],
    jobMastery:[{job:'stormcaster',bonus_all_jobs:'STR+99%'}],
    jobWeaponApt:[{job_id:'stormcaster',sword:'S'}],
    jobArmorApt:[{job_id:'stormcaster',light:'S'}],
    jobUnlocks:[{job_id:'stormcaster',condition:'free'}],
  };
  globalThis.fetch=async url=>{
    const content=String(url).endsWith('/extra_game_data.json')?JSON.stringify(injected):readFileSync(fileURLToPath(url),'utf8');
    return {ok:true,status:200,text:async()=>content};
  };
  try{
    const {loadGameData}=await import('../js/gamedata.js?retired-master-injection');
    const loaded=await loadGameData();
    assert.equal(loaded.jobs.length,50);
    assert.ok(!loaded.jobsById.has('stormcaster'));
    assert.ok(!loaded.skills.has('legacy-injected-skill'));
    assert.ok(!loaded.jobWeaponApt.has('stormcaster'));
    assert.ok(!loaded.jobArmorApt.has('stormcaster'));
    assert.ok(!loaded.jobUnlocks.has('stormcaster'));
    assert.ok(!loaded.jobMastery.some(j=>j.job==='stormcaster'));
  }finally{globalThis.fetch=previousFetch;}
});
