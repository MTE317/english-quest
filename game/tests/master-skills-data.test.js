import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../js/csv.js';
const specs=['physical','magic'].flatMap(name=>JSON.parse(readFileSync(new URL('../../data/skill-growth-'+name+'.json',import.meta.url),'utf8')).skills).map(s=>({id:s.id,name:s.name,meta:s.metadata,levels:s.effects}));

const read = name => readFileSync(new URL(`../../data/${name}`,import.meta.url),'utf8').replace(/^\uFEFF/,'');
const basicIds=new Set(specs.map(skill=>skill.id));
const rows = parseCsv(read('skills.csv')).rows.filter(s=>basicIds.has(s.id));
const skills = new Map(rows.map(s=>[s.id,{...s,effect:JSON.parse(s.effect_json)}]));
const levels = s => [s.effect,...s.effect.levels.map(e=>e.effect)];
const weapons = new Set(parseCsv(read('weapon_types.csv')).rows.map(w=>w.id).concat('none'));
const statuses = new Set(parseCsv(read('status_effects.csv')).rows.map(s=>s.id));

test('基本8職の正本に一致する120技能と396段階を持つ',()=>{
  assert.equal(skills.size,120);
  const jobs=new Set(rows.map(s=>s.job));
  assert.equal(jobs.size,8);
  for(const job of jobs){
    const list=rows.filter(s=>s.job===job);
    assert.equal(list.length,15);
    assert.equal(list.filter(s=>s.kind==='passive').length,5);
    assert.equal(list.filter(s=>s.is_final==='1').length,1);
    assert.equal(list.filter(s=>s.kind!=='passive'&&s.is_final!=='1').length,9);
  }
  for(const spec of specs){
    const skill=skills.get(spec.id);
    assert.ok(skill,spec.id);
    assert.equal(skill.name,spec.name);
    assert.equal(Number(skill.cost),spec.id.includes('_U')?0:Number(spec.meta['固定装備コスト']));
    assert.equal(skill.effect.levels.length,spec.levels.length-1);
    assert.deepEqual(levels(skill).map(e=>e.source_description),spec.levels);
    assert.ok(levels(skill).every(e=>!e.description.includes('仕様待ち')&&!e.description.includes('仕様で決定')));
    assert.ok(levels(skill).every(e=>e.master));
  }
});

test('前提技能が存在し、Lv範囲内で循環せず奥義を要求しない',()=>{
  const state=new Map();
  function visit(id){
    assert.notEqual(state.get(id),'visiting',`前提循環 ${id}`);
    if(state.get(id)==='visited')return;
    state.set(id,'visiting');
    const skill=skills.get(id);
    for(const req of skill.effect.prerequisites){
      const parent=skills.get(req.id);
      assert.ok(parent,`${id} -> ${req.id}`);
      assert.ok(req.level>=1&&req.level<=levels(parent).length);
      assert.notEqual(parent.is_final,'1');
      assert.equal(parent.job,skill.job);
      visit(req.id);
    }
    state.set(id,'visited');
  }
  for(const id of skills.keys())visit(id);
});

test('各Lvの実行データ・MP/AP・武器条件・状態異常が有効',()=>{
  for(const skill of skills.values()){
    assert.ok(Number.isInteger(Number(skill.mp))&&Number(skill.mp)>=0,skill.id);
    assert.ok(Number(skill.ap_to_learn)>0,skill.id);
    const list=levels(skill);
    for(const e of list){
      assert.ok(Array.isArray(e.tags));
      assert.ok(Array.isArray(e.weapons));
      for(const weapon of e.weapons)assert.ok(weapons.has(weapon),`${skill.id}:${weapon}`);
      assert.equal(new Set(e.weapons).size,e.weapons.length);
      if(e.st)assert.ok(statuses.has(e.st[0]),`${skill.id}:${e.st[0]}`);
      if(e.rules?.cure_statuses)for(const status of e.rules.cure_statuses)assert.ok(statuses.has(status));
      if(skill.kind==='attack')assert.ok(e.m>0,skill.id);
      if(e.hits)assert.ok(Math.abs(e.hits.reduce((a,b)=>a+b,0)-1)<1e-9,skill.id);
    }
    for(const upgrade of skill.effect.levels){
      assert.ok(upgrade.ap>0);
      assert.equal(upgrade.mp,Number(skill.mp),'Lv強化によってMP帯を引き上げない');
    }
  }
});

test('継承時の武器条件と、連撃・気功・魔法の参照を分離する',()=>{
  assert.deepEqual(skills.get('thief_A01').effect.weapons,['dagger','bow']);
  assert.deepEqual(skills.get('thief_A04').effect.weapons,['dagger']);
  assert.deepEqual(skills.get('knight_A07').effect.weapons,['spear']);
  assert.deepEqual(skills.get('monk_U01').effect.weapons,['none','fist','hammer']);
  assert.equal(skills.get('monk_A03').effect.base,'phys');
  assert.equal(skills.get('monk_A03').effect.rules.no_weapon_power,true);
  assert.deepEqual(skills.get('monk_A03').effect.weapons,[]);
  assert.deepEqual(skills.get('warrior_A06').effect.hits,[.5,.5]);
  assert.equal(skills.get('warrior_A06').effect.m,1.3);
  for(const s of skills.values())if(s.job==='black_mage')assert.deepEqual(s.effect.weapons,[]);
});

test('全攻撃技能の基礎倍率が原文と一致し、連撃は総倍率を等分する',()=>{
  for(const spec of specs){
    const skill=skills.get(spec.id);
    if(skill.kind!=='attack')continue;
    for(const [index,effect] of levels(skill).entries()){
      const first=spec.levels[index].match(/(\d+(?:\.\d+)?)倍/);
      assert.ok(first,`${spec.id} Lv${index+1}`);
      const described=Number(first[1]);
      const equal=(a,b)=>Math.abs(a-b)<1e-9;
      assert.ok(equal(effect.m,described)||effect.hits&&equal(effect.m*effect.hits[0],described),`${spec.id} Lv${index+1}: ${effect.m} / ${described}`);
      const total=spec.levels[index].match(/合計(?:基礎)?倍率(?:は)?(\d+(?:\.\d+)?)倍/);
      if(total)assert.ok(equal(effect.m,Number(total[1])),`${spec.id} 合計倍率`);
    }
  }
});

test('治療対象・種族・発動条件が拡張Lvごとに正しく変化する',()=>{
  const cure=levels(skills.get('white_mage_A03'));
  assert.deepEqual(cure[0].rules.cure_statuses,['poison','sleep','blind','paralysis']);
  assert.ok(cure[2].rules.cure_statuses.includes('weaken'));
  assert.ok(!cure[2].rules.cure_statuses.includes('toxic'));
  assert.equal(levels(skills.get('monk_A08'))[2].tgt,'all');
  const hunter=levels(skills.get('hunter_P01'));
  assert.deepEqual(hunter[0].rules.condition_damage[0].types,['beast']);
  assert.deepEqual(hunter[2].rules.condition_damage[0].types,['beast','bird','insect']);
  assert.equal(skills.get('black_mage_A09').effect.rules.condition_damage[0].when,'target_status');
  assert.equal(skills.get('black_mage_P03').effect.rules.condition_damage[0].when,'any_enemy_status');
  assert.equal(levels(skills.get('hunter_A01'))[4].rules.weak_damage,.1);
  assert.deepEqual(skills.get('hunter_P04').effect.rules.condition_evasion,[{when:'any_enemy_status',statuses:['bind','sleep'],rate:.1}]);
  assert.equal(skills.get('monk_P03').effect.rules.condition_damage[0].scope,'active_weapon_or_qigong');
  assert.equal(skills.get('hunter_P03').effect.rules.condition_damage[0].scope,'weapon_or_phys');
  assert.equal(skills.get('hunter_A07').effect.rules.trap.no_weapon_power,true);
  assert.ok(skills.get('white_mage_A05').effect.tags.includes('magic'));
  assert.ok(skills.get('bard_A01').effect.tags.includes('magic'));
});

test('仮仕様と旧技能の返還カタログを独立データとして保持する',()=>{
  const rules=JSON.parse(read('basic_job_rules.json'));
  assert.equal(rules.version,2);
  assert.equal(rules.provisional,true);
  assert.equal(rules.starting_ap,20);
  assert.deepEqual(rules.capacity,{actions:10,passives:10});
  assert.equal(rules.ultimate.gauge_max,100);
  assert.equal(rules.ultimate.capacity_cost,0);
  const migration=JSON.parse(read('skill_migration.json'));
  assert.equal(migration.version,1);
  assert.ok(migration.retired_skills.length>100);
  assert.ok(migration.retired_skills.some(s=>s.id==='warrior_p1_s1'&&s.ap===10&&s.levels.length===2));
  assert.equal(new Set(migration.retired_skills.map(s=>s.id)).size,migration.retired_skills.length);
});
