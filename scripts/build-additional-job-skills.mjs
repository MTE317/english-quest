// 追加1〜15職の設計を、本文の推測ではなく明示した実行データへ変換する。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { parseCsv } from '../game/js/csv.js';
import { tacticalJobs, tacticalPlans } from './additional-jobs-04-06-plans.mjs';
import { specialistJobs, specialistPlans } from './additional-jobs-07-09-plans.mjs';
import { pursuitJumpJobs, pursuitJumpPlans } from './additional-jobs-10-12-plans.mjs';
import { firearmSeaArcaneJobs, firearmSeaArcanePlans } from './additional-jobs-13-15-plans.mjs';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8').replace(/^\uFEFF/, '');
const spec = JSON.parse(read('docs/specs/additional-jobs-01-09-skills-v1.json'));
export const implementedJobs = ['paladin', 'dark_knight', 'berserker', ...tacticalJobs, ...specialistJobs, ...pursuitJumpJobs, ...firearmSeaArcaneJobs];
const tacticalSpec = JSON.parse(read('docs/specs/additional-jobs-04-06-skills-v1.json'));
const specialistSpec = JSON.parse(read('docs/specs/additional-jobs-07-09-skills-v1.json'));
const pursuitJumpSpec = JSON.parse(read('docs/specs/additional-jobs-10-12-skills-v1.json'));
const firearmSeaArcaneSpec = JSON.parse(read('docs/specs/additional-jobs-10-18-skills-v1.json'));
const rules = JSON.parse(read('data/basic_job_rules.json'));
const physical = ['sword','greatsword','katana','dagger','axe','spear','bow','hammer','fist','gun','whip','scythe'];
const plans = new Map();
const add = (id, kind, build, weapons = []) => plans.set(id, { kind, build, weapons });
const attack = (m, element, extra = {}) => ({ base: 'weapon', m, element, ...extra });
const condition = (when, rate, scope, extra = {}) => ({ when, rate, scope, ...extra });
const stat = (id, key) => add(id, 'passive', i => ({ mod: { [key]: [.04,.06,.08,.10,.12][i] } }));
const paladin = ['hammer','sword'], dark = ['greatsword','scythe'], berserk = ['axe','greatsword'];

add('paladin_A01','attack',i=>attack([1.05,1.2,1.35,1.5,1.65][i],'light'),paladin);
add('paladin_A02','ally_buff',i=>({rules:{blessing:{m:[.7,.8,.9,1,1.1][i],turns:3}}}));
add('paladin_A03','ally_buff',i=>({rules:{blessing:{m:.8,turns:i+2,counter:{m:.45,element:'light',base:'phys'}}}}));
add('paladin_A04','attack',i=>attack([1,1.15,1.3,1.45,1.6][i],'blunt'),paladin);
add('paladin_A05','ally_buff',()=>({rules:{move_blessing:true}}));
add('paladin_A06','ally_buff',i=>({rules:{status_resist:{statuses:['poison','paralysis','fear'].slice(0,i+1),rate:.2,multiplicative:true,turns:3}}}));
add('paladin_A07','party_buff',i=>({buff:{cut:.15},turns:i+1,rules:{consume_blessing:true}}));
add('paladin_A08','heal',i=>({m:[.7,.8,.9,1,1.1][i],rules:{heal_own_blessing:.15}}));
add('paladin_A09','attack',i=>attack([1.5,1.7,1.9,2.1,2.3][i],'light',{rules:{optional_blessing:.25}}),paladin);
add('paladin_P01','passive',()=>({rules:{blessing_break_heal:.06}}));
stat('paladin_P02','res');
add('paladin_P03','passive',i=>({rules:{blessing_expire:{cut:.08,turns:i+1}}}));
add('paladin_P04','passive',i=>({rules:{condition_damage:[condition('target_type',.12,'all',{types:['undead','ghost','demon'].slice(0,i+1),elements:['light']})]}}));
add('paladin_P05','passive',i=>({rules:{mp_save:[{tag:'blessing',rate:[.2,.35,.5][i]}]}}));
add('paladin_U01','party_buff',()=>({rules:{blessing:{m:1.8,turns:3,break_heal:.1,heal_limit:2}}}));

add('dark_knight_A01','attack',i=>attack([1.4,1.55,1.7,1.85,2][i],'slash',{rules:{hp_cost:.06}}),dark);
add('dark_knight_A02','attack',i=>attack([.95,1.1,1.25,1.4,1.55][i],'slash',{rules:{lifesteal:.2}}),dark);
add('dark_knight_A03','attack',i=>attack([1.05,1.2,1.35,1.5,1.65][i],'dark'),dark);
add('dark_knight_A04','self_buff',i=>({buff:{cut:.2},turns:i+2,rules:{hp_cost:.08}}));
add('dark_knight_A05','attack',i=>attack(1.1,'slash',{st:['bleed',.35],status_turns:i+2}),dark);
add('dark_knight_A06','self_buff',()=>({rules:{next_hp_cost:{rate:.5,turns:2}}}));
add('dark_knight_A07','attack',i=>attack(1,'slash',{rules:{attack_after:{rate:.8,debuff:{str:[.1,.15,.15][i]},turns:[2,2,3][i]}}}),dark);
add('dark_knight_A08','attack',i=>attack([.65,.75,.85,.95,1.05][i],'slash',{tgt:'all',rules:{hp_cost:.1}}),dark);
add('dark_knight_A09','attack',i=>attack([1.8,2,2.2,2.4,2.6][i],'dark',{rules:{hp_cost:.12}}),dark);
add('dark_knight_P01','passive',()=>({rules:{paid_weapon_damage:.12}}));
stat('dark_knight_P02','hp');
add('dark_knight_P03','passive',i=>({rules:{lifesteal_cap:[.12,.15,.18][i]}}));
add('dark_knight_P04','passive',i=>({rules:{condition_cut:[condition('hp_below',.12,'all',{threshold:[.4,.5,.6][i]})]}}));
add('dark_knight_P05','passive',i=>({rules:{condition_damage:[condition('element',[.05,.07,.09,.11,.13][i],'weapon',{elements:['dark']})]}}));
add('dark_knight_U01','attack',()=>attack(4.5,'dark',{rules:{instant_lifesteal:{rate:.35,cap:.35},after_lifesteal:{rate:.1,turns:3}}}),physical);

add('berserker_A01','attack',i=>attack([1.15,1.3,1.45,1.6,1.75][i],'slash'),berserk);
add('berserker_A02','attack',i=>attack(.7,'slash',{tgt:'all',target_limit:[2,3,8][i],select_targets:true}),berserk);
add('berserker_A03','self_buff',()=>({buff:{str:.2,cut:-.1},turns:3}));
add('berserker_A04','attack',i=>attack([1.45,1.65,1.85,2.05,2.25][i],'slash',{rules:{spend_anger:.1}}),berserk);
add('berserker_A05','self_buff',()=>({rules:{calm:{heal:.05,remove:'berserker_A03'}}}));
add('berserker_A06','attack',i=>attack([1.05,1.2,1.35,1.5,1.65][i],'fire'),berserk);
add('berserker_A07','cure',i=>({tgt:'self',rules:{cure_statuses:['fear','bind','blind'].slice(0,i+1)}}));
add('berserker_A08','attack',i=>attack([1.2,1.35,1.5,1.65,1.8][i],'blunt',{rules:{attack_after:{rate:.8,debuff:{def:.1},turns:2}}}),berserk);
add('berserker_A09','attack',i=>attack([1.7,1.9,2.1,2.3,2.5][i],'slash',{tgt:'random',hits:[.25,.25,.25,.25],status_once_action:true}),berserk);
add('berserker_P01','passive',()=>({rules:{anger:{max:3,damage:.08,received:.04}}}));
stat('berserker_P02','str');
add('berserker_P03','passive',i=>({rules:{anger_mp_save:{threshold:3-i,rate:.2}}}));
add('berserker_P04','passive',i=>({rules:{condition_cut:[condition('self_status',.1,'all',{statuses:[['burn','bleed'],['burn','bleed','poison'],['burn','bleed','poison','toxic','weaken']][i]})]}}));
add('berserker_P05','passive',i=>({rules:{condition_damage:[condition('weapon_type',[.05,.07,.09,.11,.13][i],'weapon',{weapons:berserk})]}}));
add('berserker_U01','attack',()=>attack(2.7,'slash',{tgt:'all',rules:{spend_anger:.1,after_weapon_buff:{damage:.45,received:.15,turns:2}}}),physical);

const csv = path => parseCsv(read(path));
const writeCsv = (path, header, rows) => {
  const cell = v => /[",\r\n]/.test(String(v??'')) ? '"'+String(v).replaceAll('"','""')+'"' : String(v??'');
  fs.writeFileSync(new URL(path,root),'\uFEFF'+[header.join(','),...rows.map(r=>header.map(k=>cell(r[k])).join(','))].join('\n')+'\n');
};
const current = csv('data/skills.csv');
const rows = current.rows.filter(row => !implementedJobs.includes(row.job));
const selected = [...spec.jobs.filter(job => implementedJobs.includes(job.id) && !tacticalJobs.includes(job.id) && !specialistJobs.includes(job.id)), ...tacticalSpec.jobs, ...specialistSpec.jobs, ...pursuitJumpSpec.jobs, ...firearmSeaArcaneSpec.jobs.filter(job => firearmSeaArcaneJobs.includes(job.id))];
const weaponNames = { '刀':'katana', '剣':'sword', '大剣':'greatsword', '槍':'spear', '斧':'axe', '鎌':'scythe', '短剣':'dagger' };
for (const job of selected) for (const s of job.skills) {
  const plan = plans.get(s.id) ?? tacticalPlans.get(s.id) ?? specialistPlans.get(s.id) ?? pursuitJumpPlans.get(s.id) ?? firearmSeaArcanePlans.get(s.id);
  assert.ok(plan, `実行定義なし: ${s.id}`);
  const weapons = plan.weapons ?? s.weapons ?? (s.weaponCondition.includes('12種') ? physical
    : s.weaponCondition.startsWith('武器条件なし') ? [] : s.weaponCondition.split('・').map(name => weaponNames[name]));
  assert.ok(weapons.every(Boolean), `武器条件が未定義: ${s.id}`);
  const final = s.type === 'ultimate';
  const mp = s.type === 'passive' || final ? 0 : rules.mp_bands[{'軽':'light','中':'medium','重':'heavy'}[s.mpBand]];
  const ap = rules.ap_bands[{'導入':'intro','標準':'standard','発展':'advanced','奥義':'ultimate'}[s.apBand]];
  const tags = [...new Set([s.type === 'active' ? 'active' : s.type,...s.tags])];
  const effects = s.effects.map((description,i)=>({master:true,additional:true,description,source_description:description,
    prerequisites:s.prerequisites,weapons,tags,target:s.target,reference:(firearmSeaArcaneJobs.includes(job.id)?firearmSeaArcaneSpec:spec).formulas[s.reference],
    ...(s.simpleDescriptions ? {short_description:s.simpleDescriptions[i]} : {}),
    growth_mode:s.growthMode,...(final?{ultimate:true}:{}),...plan.build(i)}));
  assert.equal(effects.length,s.maxLevel);
  const effect = {...effects[0],levels:effects.slice(1).map((effect,i)=>({ap:rules.upgrade_ap[i],mp,effect}))};
  rows.push({id:s.id,job:job.id,path:final?'奥義':s.type==='passive'?'パッシブ':'アクティブ',stage:Number(s.id.slice(-2)),
    name:s.name,kind:plan.kind,cost:final?0:s.cost,mp,ap_to_learn:ap,is_final:final?1:0,element:effect.element??'',effect_json:JSON.stringify(effect)});
}
writeCsv('data/skills.csv',current.header,rows);
const roster = csv('data/jobs_mid.csv');
for (const row of roster.rows) if (implementedJobs.includes(row.id)) { row.skills_ready='1'; row.unlock='初期解放（条件は後日設定）'; }
writeCsv('data/jobs_mid.csv',roster.header,roster.rows);
const unlocks = csv('data/job_unlocks.csv');
for (const row of unlocks.rows) if (implementedJobs.includes(row.job_id)) row.method='初期';
writeCsv('data/job_unlocks.csv',unlocks.header,unlocks.rows);
const mastery = csv('data/job_mastery.csv');
for (const job of selected) if (!mastery.rows.some(row=>row.job===job.id)) mastery.rows.push({job:job.id,condition:'この職の15種類の技能を修得（強化回数は種類数に含めない）',bonus_all_jobs:''});
writeCsv('data/job_mastery.csv',mastery.header,mastery.rows);
rules.protection = {base:10,per_level:.5,stat_scale:1};
fs.writeFileSync(new URL('data/basic_job_rules.json',root),JSON.stringify(rules,null,2)+'\n');
// 通常の装備吸収も同じ行動上限を共有する。上限を上げる技能は別途判定する。
const balance=fs.readFileSync(new URL('data/balance.json',root),'utf8');
assert.match(balance,/"lifesteal_action_cap":\s*[\d.]+/);
fs.writeFileSync(new URL('data/balance.json',root),balance.replace(/"lifesteal_action_cap":\s*[\d.]+/,'"lifesteal_action_cap": 0.1'));
console.log(`追加1〜15職: ${selected.reduce((n,j)=>n+j.skills.length,0)}技能、最初から選択可能`);
