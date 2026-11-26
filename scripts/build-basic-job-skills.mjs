// 基本8職の設計文書を技能マスタへ変換する。数値の変更点はこの定義と設計文書を合わせて更新する。
import fs from 'node:fs';
import { specs as originalSpecs } from './parse-basic-spec.mjs';
import { revisedEffect } from './skill-growth-v2.mjs';
const growth = new Map(['physical','magic'].flatMap(name=>JSON.parse(fs.readFileSync(new URL('../data/skill-growth-'+name+'.json',import.meta.url),'utf8')).skills).map(s=>[s.id,s]));
const specs = originalSpecs.map(s=>({...s,meta:growth.get(s.id).metadata,levels:growth.get(s.id).effects}));
import { parseCsv } from '../game/js/csv.js';

const at = (values, i) => Array.isArray(values) ? values[i] : values;
const pct = (values, i) => at(values, i) / 100;
const allPhys = ['sword','greatsword','katana','dagger','axe','spear','bow','hammer','fist','gun','whip','scythe'];
const melee = allPhys.filter(x => !['bow','gun'].includes(x));
const plan = new Map();
const add = (id, kind, effect) => plan.set(id, {kind, effect});
const weapon = (m, i, extra={}) => ({base:'weapon',m:at(m,i),...extra});
const magic = (m, element, i, extra={}) => ({base:'mag',m:at(m,i),element,...extra});
const buff = (values, turns, extra={}) => ({buff:values,turns,...extra});
const condition = (when, rate, scope='all', extra={}) => ({when,rate,scope,...extra});
const healingStatuses = [
  ['poison','sleep','blind'],
  ['poison','sleep','blind','paralysis'],
  ['poison','sleep','blind','paralysis','burn','bleed','freeze'],
  ['poison','sleep','blind','paralysis','burn','bleed','freeze','bind','fear','confusion'],
  ['poison','sleep','blind','paralysis','burn','bleed','freeze','bind','fear','confusion','silence','seal','weaken'],
];

add('warrior_A01','attack',i=>weapon([1.25,1.4,1.55,1.7,1.85],i));
add('warrior_A02','attack',i=>weapon([.55,.65,.75,.85,.95],i,{tgt:'all'}));
add('warrior_A03','attack',i=>weapon([.8,.9,1,1.1,1.2],i,{rules:{attack_after:{debuff:{def:pct([10,12,15,18,20],i)},rate:.8,turns:2}}}));
add('warrior_A04','attack',i=>weapon([.85,.95,1.05,1.15,1.25],i,{rules:{attack_after:{debuff:{str:pct([8,10,12,15,18],i)},rate:.8,turns:2}}}));
add('warrior_A05','attack',i=>weapon([1,1.1,1.2,1.3,1.4],i,{st:['bleed',pct([20,25,30,35,40],i)],status_turns:2}));
add('warrior_A06','attack',i=>weapon([1.3,1.45,1.6,1.75,1.9],i,{hits:[.5,.5]}));
add('warrior_A07','self_buff',i=>buff({cut:pct([15,20,25,30,35],i)},2));
add('warrior_A08','self_buff',i=>buff({str:pct([12,16,20,24,28],i)},2));
add('warrior_A09','attack',i=>weapon([1.15,1.3,1.45,1.6,1.75],i,{defign:pct([15,20,25,30,35],i)}));
add('warrior_P01','passive',i=>({rules:{mp_save:[{tag:'weapon',rate:pct([5,8,11,14,17],i)}]}}));
add('warrior_P02','passive',i=>({mod:{str:pct([4,6,8,10,12],i),hp:pct([0,0,4,6,8],i)}}));
add('warrior_P03','passive',i=>({rules:{condition_damage:[condition('target_def_down',pct([6,9,12,15,18],i),'weapon')]}}));
add('warrior_P04','passive',i=>({rules:{on_attack:{buff:{def:pct([5,8,11,14,17],i)},turns:1,expire:'start'}}}));
add('warrior_P05','passive',i=>({rules:{condition_damage:[condition('target_def_buff',pct([8,12,16,20,24],i),'weapon')]}}));
add('warrior_U01','attack',i=>weapon([3,3.5,4,4.5,5],i,{defign:pct([25,30,35,40,45],i),rules:{attack_after:{debuff:{def:pct([20,23,26,28,30],i)},rate:1,turns:3}}}));

add('knight_A01','ally_buff',i=>({turns:2,rules:{cover:{target:'selected',rate:1,turns:2,limit:1,cut:pct([10,15,20,25,30],i),physical_only:false}}}));
add('knight_A02','party_buff',i=>buff({def:pct([10,12,15,18,20],i)},2));
add('knight_A03','attack',i=>weapon([.75,.85,.95,1.05,1.15],i,{element:'blunt',st:['stun',pct([25,30,35,40,45],i)],status_turns:1}));
add('knight_A04','self_buff',i=>({turns:2,rules:{counter:{m:at([.55,.65,.75,.85,.95],i),turns:2,limit:1}}}));
add('knight_A05','self_buff',i=>buff({def:pct([20,25,30,35,40],i)},3));
add('knight_A06','status',i=>({st:['taunt',pct([70,75,80,85,90],i)],status_turns:at([2,2,2,3,3],i),rules:{taunt:true}}));
add('knight_A07','attack',i=>weapon([.95,1.05,1.15,1.25,1.35],i,{element:'pierce',st:['bind',pct([25,30,35,40,45],i)],status_turns:2}));
add('knight_A08','self_buff',i=>({turns:2,rules:{status_resist:{statuses:['stun','fear'],rate:pct([20,30,40,50,60],i),turns:2,multiplicative:true}}}));
add('knight_A09','attack',i=>weapon([1,1.1,1.2,1.3,1.4],i,{rules:{covered_attack_bonus:at([.4,.45,.5,.55,.6],i)}}));
add('knight_P01','passive',i=>({rules:{cover:{target:'all_low_hp',rate:pct([15,20,25,30,35],i),hp_threshold:.5,limit:1,physical_only:true}}}));
add('knight_P02','passive',i=>({mod:{def:pct([6,9,12,15,18],i),hp:pct([0,0,3,5,7],i)}}));
add('knight_P03','passive',i=>({rules:{on_cover:{def:pct([3,4,5,6,7],i),max:3,turns:2}}}));
add('knight_P04','passive',i=>({rules:{condition_cut:[{when:'other_ally_status',scope:'all',rate:pct([4,6,8,10,12],i)}]}}));
add('knight_P05','passive',i=>({rules:{endure:{hp_frac:pct([1,3,5,8,10],i),buff:{def:pct([0,0,10,15,20],i)},turns:2}}}));
add('knight_U01','party_buff',i=>buff({cut:pct([35,40,45,50,55],i)},2,{rules:{cover:{target:'all',rate:1,turns:2,limit:2,cut:0,physical_only:true}}}));

add('monk_A01','attack',i=>weapon([1.1,1.25,1.4,1.55,1.7],i,{element:'blunt',defign:pct([10,12,15,18,20],i)}));
add('monk_A02','attack',i=>weapon([1.2,1.35,1.5,1.65,1.8],i,{element:'blunt',hits:[.5,.5]}));
add('monk_A03','attack',i=>({base:'phys',element:'none',m:at([1.1,1.25,1.4,1.55,1.7],i),rules:{no_weapon_power:true}}));
add('monk_A04','self_buff',i=>buff({str:pct([12,15,18,21,25],i)},3,{rules:{next_mp_save:{tag:'weapon',rate:pct([5,8,10,12,15],i),turns:3}}}));
add('monk_A05','self_buff',i=>({turns:1,rules:{counter:{m:at([.35,.4,.45,.5,.55],i),element:'blunt',turns:1,limit:1,once:true,expire:'start',cut:pct([20,24,28,32,36],i)}}}));
add('monk_A06','attack',i=>weapon([.85,.95,1.05,1.15,1.25],i,{element:'blunt',rules:{attack_after:{debuff:{def:pct([8,10,12,15,18],i)},rate:1,turns:2}}}));
add('monk_A07','status',i=>({st:['seal',pct([35,40,45,50,55],i)],status_turns:2}));
add('monk_A08','cure',i=>({tgt:i>=2?'all':'single',rules:{cure_statuses:i===0?['fear','confusion']:['fear','confusion','sleep'],...(i>=3?{status_resist:{statuses:['fear','confusion'],rate:pct([0,0,0,10,20],i),turns:1}}:{})}}));
add('monk_A09','attack',i=>weapon([1.75,1.95,2.15,2.35,2.55],i,{element:'blunt',rules:{condition_damage:[condition('previous_other_weapon_skill',pct([10,12,14,17,20],i),'weapon')]}}));
add('monk_P01','passive',i=>({rules:{combo:{step:pct([4,5,5,6,7],i),max:at([2,2,3,3,3],i)}}}));
add('monk_P02','passive',i=>({mod:{spd:pct([0,0,2,2,4],i)},rules:{condition_damage:[condition('weapon_type',pct([5,7,9,12,15],i),'weapon',{weapons:['none','fist']})]}}));
add('monk_P03','passive',i=>({rules:{condition_damage:[condition('self_status',pct([5,8,11,14,18],i),'active_weapon_or_qigong')]}}));
add('monk_P04','passive',i=>({rules:{mp_save:[{tag:'qigong',rate:pct([5,8,11,15,20],i)}]}}));
add('monk_P05','passive',i=>({mod:{hp:pct([4,6,8,10,12],i)},rules:{status_resist:{statuses:['stun'],rate:pct([0,0,10,15,20],i)}}}));
add('monk_U01','attack',i=>weapon([4,4.5,5,5.5,6],i,{element:'blunt',hits:[.2,.2,.2,.2,.2],st:['seal',pct([45,50,55,60,65],i)],status_turns:2}));

add('thief_A01','attack',i=>weapon([1,1.12,1.24,1.36,1.5],i));
add('thief_A02','utility',i=>({rules:{steal:{rate:pct([50,55,60,65,70],i)}}}));
add('thief_A03','status',i=>({tgt:'all',st:['blind',pct([25,30,35,40,45],i)],status_turns:2}));
add('thief_A04','attack',i=>weapon([.85,.95,1.05,1.15,1.25],i,{st:['poison',pct([40,45,50,55,60],i)],status_turns:3}));
add('thief_A05','attack',i=>weapon([.7,.8,.9,1,1.1],i,{st:['bind',pct([25,30,35,40,45],i)],status_turns:2}));
add('thief_A06','status',i=>({st:['sleep',pct([35,40,45,50,55],i)],status_turns:2}));
add('thief_A07','attack',i=>weapon([1.05,1.15,1.25,1.35,1.45],i,{crit:pct([10,13,16,20,25],i)}));
add('thief_A08','self_buff',i=>buff({eva:pct([10,12,15,18,20],i),spd:pct([5,7,9,12,15],i)},2));
add('thief_A09','attack',i=>weapon([1.3,1.45,1.6,1.75,1.9],i,{rules:{steal:{rate:pct([30,35,40,45,50],i)}}}));
add('thief_P01','passive',i=>({rules:{first_spd:pct([25,35,45,55,65],i),first_mp_save:pct([0,0,5,8,10],i)}}));
add('thief_P02','passive',i=>({rules:{steal_rate:pct([5,7,10,12,15],i),steal_success_buff:{spd:pct([0,0,5,7,10],i),turns:1}}}));
add('thief_P03','passive',i=>({rules:{condition_crit:[{when:'any_enemy_status',statuses:['blind'],rate:pct([4,6,8,10,12],i)}]}}));
add('thief_P04','passive',i=>({mod:{spd:pct([3,5,7,9,11],i)},rules:{flee:pct([5,7,9,12,15],i)}}));
add('thief_P05','passive',i=>({mod:{eva:pct([4,5,6,7,8],i),spd:pct([0,0,2,3,5],i)}}));
add('thief_U01','party_buff',i=>buff({eva:pct([10,12,15,18,20],i),spd:pct([10,12,15,18,20],i)},at([2,2,2,3,3],i),{rules:{steal_buffs:{count:at([1,1,2,2,2],i),next_mp_save:pct([10,12,15,18,20],i)}}}));

add('hunter_A01','attack',i=>weapon([1.15,1.3,1.45,1.6,1.75],i,{rules:{weak_damage:pct([0,0,5,5,10],i)}}));
add('hunter_A02','utility',i=>({rules:{inspect:{count:at([1,1,2,2,3],i)},next_damage:{tag:'weapon',rate:pct([10,15,15,20,25],i),turns:2}}}));
add('hunter_A03','attack',i=>weapon([1,1.1,1.2,1.3,1.4],i,{st:['bind',pct([40,45,50,55,60],i)],status_turns:2}));
add('hunter_A04','attack',i=>weapon([.9,1,1.1,1.2,1.3],i,{st:['sleep',pct([30,35,40,45,50],i)],status_turns:at([1,1,2,2,2],i)}));
add('hunter_A05','attack',i=>weapon([1.1,1.25,1.4,1.55,1.7],i,{element:'wind'}));
add('hunter_A06','attack',i=>weapon([1.05,1.2,1.35,1.5,1.65],i,{tgt:'random',hits:[1/3,1/3,1/3]}));
add('hunter_A07','utility',i=>({rules:{trap:{base:'phys',no_weapon_power:true,element:'pierce',m:at([1.1,1.25,1.4,1.55,1.7],i),st:['bind',pct([30,35,40,45,50],i)],status_turns:2,limit_per_target:1,limit_total:2}}}));
add('hunter_A08','attack',i=>weapon([1.1,1.2,1.3,1.4,1.5],i,{rules:{condition_damage:[condition('target_type',pct([20,25,25,30,35],i),'weapon',{types:['beast','bird','insect']})]}}));
add('hunter_A09','self_buff',i=>buff({spd:pct([8,10,12,14,16],i),eva:pct([3,4,5,6,7],i)},3));
add('hunter_P01','passive',i=>({rules:{condition_damage:[condition('target_type',pct([8,10,10,12,12],i),'all',{types:i<2?['beast']:i<4?['beast','bird']:['beast','bird','insect']})]}}));
add('hunter_P02','passive',i=>({mod:{weak_all:pct([8,10,12,15,18],i)}}));
add('hunter_P03','passive',i=>({rules:{condition_damage:[condition('target_status',pct([10,12,15,18,20],i),'weapon_or_phys',{statuses:['bind','sleep']})]}}));
add('hunter_P04','passive',i=>({rules:{condition_evasion:[{when:'any_enemy_status',statuses:['bind','sleep'],rate:pct([4,5,6,8,10],i)}]}}));
add('hunter_P05','passive',i=>({rules:{normal_weak_mp:pct([1,1.5,2,2.5,3],i)}}));
add('hunter_U01','utility',i=>({rules:{party_target_damage:{rate:pct([25,30,35,40,45],i),turns:3,inspect:at([1,2,3,4,5],i)}}}));

for(const [n,element] of [[1,'fire'],[2,'ice'],[3,'thunder']]) add(`black_mage_A0${n}`,'attack',i=>magic([1,1.1,1.2,1.3,1.4],element,i));
add('black_mage_A04','attack',i=>magic([.65,.72,.79,.86,.95],'fire',i,{tgt:'all',st:['burn',pct([20,24,28,32,36],i)]}));
add('black_mage_A05','attack',i=>magic([.65,.72,.79,.86,.95],'ice',i,{tgt:'all',st:['freeze',pct([8,10,12,14,16],i)]}));
add('black_mage_A06','attack',i=>magic([.65,.72,.79,.86,.95],'thunder',i,{tgt:'all',st:['paralysis',pct([12,15,18,21,24],i)]}));
add('black_mage_A07','attack',i=>magic([1.4,1.5,1.6,1.7,1.8],'fire',i,{rules:{condition_damage:[condition('target_status',pct([15,18,21,24,27],i),'magic',{statuses:['burn']})]}}));
add('black_mage_A08','attack',i=>magic([.5,.6,.7,.8,.9],'ice',i,{st:['freeze',pct([45,50,55,60,65],i)]}));
add('black_mage_A09','attack',i=>magic([1.05,1.15,1.25,1.35,1.45],'thunder',i,{rules:{condition_damage:[condition('target_status',pct([20,23,26,29,32],i),'magic')]}}));
add('black_mage_P01','passive',i=>({rules:{mp_boost:{mp:6,damage:pct([12,16,20,24,28],i)}}}));
add('black_mage_P02','passive',i=>({rules:{condition_damage:[condition('element',pct([5,7,9,11,13],i),'magic',{elements:['fire','ice','thunder']})]}}));
add('black_mage_P03','passive',i=>({rules:{condition_damage:[condition('any_enemy_status',pct([4,6,8,10,12],i),'magic',{statuses:['burn','freeze','paralysis']})]}}));
add('black_mage_P04','passive',i=>({rules:{condition_cut:[{when:'mp_half',scope:'magic',rate:pct([5,7,9,11,13],i)}]}}));
add('black_mage_P05','passive',i=>({rules:{condition_damage:[condition('self_status',pct([5,7,9,11,13],i),'magic')]}}));
add('black_mage_U01','attack',i=>magic([3.2,3.5,3.8,4.1,4.4],'fire',i,{tgt:'all',rules:{choose_element:['fire','ice','thunder'],element_status:{fire:['burn',pct([30,35,40,45,50],i)],ice:['freeze',pct([15,18,21,24,27],i)],thunder:['paralysis',pct([20,24,28,32,36],i)]}}}));

add('white_mage_A01','heal',i=>({m:at([1.2,1.35,1.5,1.65,1.8],i)}));
add('white_mage_A02','heal_all',i=>({m:at([.55,.63,.71,.79,.87],i),tgt:'all'}));
add('white_mage_A03','cure',i=>({rules:{cure_statuses:healingStatuses[i]}}));
add('white_mage_A04','revive',i=>({frac:pct([25,35,45,55,65],i)}));
add('white_mage_A05','ally_buff',i=>({turns:3,rules:{regen:{m:at([.22,.26,.3,.34,.38],i),turns:3,trigger:'start'}}}));
add('white_mage_A06','ally_buff',i=>({turns:2,rules:{shield:{m:at([.6,.7,.8,.9,1],i),turns:2}}}));
add('white_mage_A07','attack',i=>magic([.9,1,1.1,1.2,1.3],'light',i));
add('white_mage_A08','attack',i=>magic([.5,.6,.7,.8,.9],'light',i,{st:['bind',pct([30,35,40,45,50],i)]}));
add('white_mage_A09','attack',i=>magic([.55,.65,.75,.85,.95],'light',i,{rules:{cleanse_buffs:{count:at([1,1,2,2,3],i),requires_damage:false}}}));
add('white_mage_P01','passive',i=>({mod:{healp:pct([5,8,11,14,17],i)}}));
add('white_mage_P02','passive',i=>({rules:{cure_heal_frac:pct([2,3,4,5,6],i)}}));
add('white_mage_P03','passive',i=>({rules:{condition_heal:[{when:'any_ally_status',rate:pct([5,8,11,14,17],i)}]}}));
add('white_mage_P04','passive',i=>({rules:{on_healing:{cut:pct([5,7,9,11,13],i),turns:1}}}));
add('white_mage_P05','passive',i=>({rules:{mp_save:[{tag:'healing',rate:pct([5,7,9,11,13],i)}]}}));
add('white_mage_U01','heal_all',i=>({m:at([2.4,2.7,3,3.3,3.6],i),tgt:'all',rules:{cure_statuses:healingStatuses[3],revive:{frac:pct([30,40,50,60,70],i),count:1,separate:true}}}));

add('bard_A01','party_buff',i=>buff({def:pct([12,15,18,21,24],i),res:pct([12,15,18,21,24],i)},3));
add('bard_A02','party_buff',i=>buff({str:pct([10,12,15,18,20],i),mag:pct([10,12,15,18,20],i)},3));
add('bard_A03','party_buff',i=>buff({spd:pct([10,12,15,18,20],i)},3));
add('bard_A04','party_buff',i=>({turns:3,rules:{regen:{frac:pct([3,3.5,4,4.5,5],i),turns:3,trigger:'end'}}}));
add('bard_A05','mp_give',i=>({frac:pct([10,12,14,16,18],i),transfer:true}));
add('bard_A06','status',i=>({tgt:'all',st:['sleep',pct([20,23,26,29,32],i)],status_turns:at([1,1,2,2,2],i)}));
add('bard_A07','attack',i=>magic([.5,.6,.7,.8,.9],'water',i,{tgt:'all',st:['silence',pct([15,18,21,24,27],i)],status_turns:1}));
add('bard_A08','attack',i=>magic([1,1.15,1.3,1.45,1.6],'light',i,{rules:{condition_damage:[condition('own_song',pct([5,5,10,10,15],i),'magic')]}}));
add('bard_A09','party_buff',i=>({rules:{song_end:{next_mp_save:pct([15,18,21,24,27],i),turns:2}}}));
add('bard_P01','passive',i=>({rules:{song_extend:at([1,1,2,2,3],i),mp_save:[{tag:'song',rate:pct([0,5,5,10,10],i)}]}}));
add('bard_P02','passive',i=>({rules:{song_combo:{count:2,rate:pct([5,7,9,12,15],i)}}}));
add('bard_P03','passive',i=>({rules:{song_status:{statuses:['poison','toxic','burn','bleed','weaken'],rate:pct([5,7,9,12,15],i)}}}));
add('bard_P04','passive',i=>({rules:{regen_status:{statuses:['poison','toxic','burn','bleed'],rate:pct([10,14,18,22,25],i)}}}));
add('bard_P05','passive',i=>({rules:{instrument:{song:pct([5,7,10,12,15],i),elements:['light','water'],damage:pct([0,0,5,5,10],i)}}}));
add('bard_U01','party_buff',i=>buff({dmg:pct([25,30,35,40,45],i),cut:pct([15,17,19,22,25],i)},3,{rules:{mp_save:[{tag:'active',rate:pct([10,11,12,14,15],i)}]}}));

const weaponByName = {剣:'sword',大剣:'greatsword',刀:'katana',短剣:'dagger',斧:'axe',槍:'spear',弓:'bow',鎚:'hammer',拳:'fist',杖:'staff',魔導書:'tome',楽器:'instrument',銃:'gun',鞭:'whip',鎌:'scythe',扇:'fan',素手:'none'};
function requiredWeapons(spec) {
  const t=spec.meta['武器条件'].replace(/盾条件なし。?/g,'');
  if(/条件なし|条件はない|武器種や現職は問わない|武器種条件なし|STR参照の気功技能|物品を盗む技能を使用/.test(t)) return [];
  if(t.includes('近接のSTR'))return melee;
  if(t.includes('STR依存の物理武器'))return allPhys;
  if(t.includes('物理武器を用いる攻撃'))return [...allPhys,'none'];
  // 「短剣」を「剣」へも誤って数えないよう、長い武器名から字句として読む。
  const pattern = new RegExp(Object.keys(weaponByName).sort((a,b)=>b.length-a.length).join('|'),'g');
  return [...new Set([...t.matchAll(pattern)].map(m=>weaponByName[m[0]]))];
}
const names = new Map(specs.map(s=>[s.name,s.id]));
function displayDescription(text){
  return text
    .replace(/ゲージ消費量・MP・再使用規則は奥義共通仕様待ち。?/g,'')
    .replace(/必殺技ゲージ満タンが必要で、MP・ゲージ消費・再使用・持越しは共通奥義仕様で決定する。?/g,'必殺技ゲージ満タンで使用する。')
    .replace(/追加MP（中の帯。額は共通収支設計で決定）/g,'追加MP6')
    .replace(/軽減で新しいMP回復やAP獲得は発生しない。?/g,'')
    .replace(/追加MPの帯はLv強化で重くしない。?/g,'追加MPはLv強化では増えない。')
    .replace(/重ね掛けの回復量・上限は共通ルールを適用する。?/g,'同じ再生は強い回復量で更新する。')
    .replace(/軽減・回避は共通上限に従い、/g,'軽減・回避には上限があり、')
    .replace(/他のMP軽減との合算上限と端数処理は共通ルールで決める。?/g,'MP軽減は合計50%まで。消費MPは切り上げ、最低1。')
    .replace(/MP軽減の合計上限は共通仕様に従う。?/g,'MP軽減は合計50%まで。');
}
function prerequisites(spec){
  const t=spec.meta['修得前提'];
  if(/なし|同職/.test(t))return [];
  return [...t.matchAll(/([^・]+?)\s+(?:Lv(\d+)|修得)/g)].map(m=>({id:names.get(m[1].trim()),level:Number(m[2]??1)}));
}
function tagsFor(spec, entry){
  const tags=[];
  const kind=entry.kind;
  if(spec.id.includes('_U'))tags.push('ultimate');else if(kind!=='passive')tags.push('active');
  if(spec.id==='monk_A03')tags.push('qigong');
  else if(entry.effect(0).base==='weapon')tags.push('weapon');
  if(entry.effect(0).base==='mag'||spec.id.startsWith('black_mage_A')||spec.id.startsWith('white_mage_')&&kind!=='passive')tags.push('magic');
  if(['heal','heal_all'].includes(kind)||entry.effect(0).rules?.regen)tags.push('heal','healing');
  if(kind==='cure')tags.push('cure','healing');
  if(kind==='revive')tags.push('revive','healing');
  if(/^bard_A0[1-4]$/.test(spec.id))tags.push('song','magic');
  if(['bard_A06','bard_U01'].includes(spec.id))tags.push('magic');
  return tags;
}

const rules = {
  version:2, master:'basic-jobs-skills-v2', provisional:true,
  starting_ap:30,
  capacity:{actions:10,passives:10},
  ultimate:{gauge_max:100,gain_correct:20,gain_hit:5,carry_over:true,mp:0,once_per_battle:false,capacity_cost:0},
  spell_equipment:{base:3,per_level:1.8,types:['staff','tome','instrument','fan']},
  song_support:{mag_scale:.2,mag_divisor:100},
  mp_bands:{light:3,medium:6,heavy:12,ultimate:0},
  ap_bands:{intro:10,standard:18,advanced:28,ultimate:50},
  upgrade_ap:[12,20,30,45],
  caps:{stat_buff:1,stat_debuff:.5,damage_cut:.7,mp_save:.5,def_ignore:.7,status_rate:.95,crit:.85,evasion:.6,shield_hp:.5,song_same_name:1,counter_per_round:1,cover_per_round:1,ultimate_cover_per_round:2},
  rounding:{mp:'ceil',minimum_mp:1,hp:'floor'},
  stacking:{same_skill:'strongest_refresh',different_skills:'add_to_cap',duration:'target_action_opportunities',skip_consumes_duration:true,application_action_consumes_duration:false,extra_actions:false},
  notes:['MP・AP・容量・ゲージは実装用の仮値。技能効果とLv成長は設計文書を正とする。','奥義専用枠は通常容量0、MP0、ゲージ100消費。正解行動20、敵の直接攻撃被弾5。奥義自体と連鎖効果ではゲージを増やさない。','術装備補助はstaff/tome/instrument/fanの武器Lvと適性のみ。銃等の物理武器威力を一般魔法と回復へ加算しない。'],
};
const currentCsv=fs.readFileSync(new URL('../data/skills.csv',import.meta.url),'utf8');
const current=parseCsv(currentCsv).rows;
const migrationUrl=new URL('../data/skill_migration.json',import.meta.url);
if(!fs.existsSync(migrationUrl)){
  const retired=current.filter(r=>r.job!=='common'&&!JSON.parse(r.effect_json||'{}').master).map(r=>({id:r.id,job:r.job,name:r.name,ap:Number(r.ap_to_learn),levels:JSON.parse(r.effect_json||'{}').levels??[]}));
  fs.writeFileSync(migrationUrl,JSON.stringify({version:1,retired_skills:retired},null,2)+'\n');
}
const rows=[];
for(const spec of specs){
  const entry=plan.get(spec.id);if(!entry)throw new Error(`未定義: ${spec.id}`);
  if(![1,3,5].includes(spec.levels.length))throw new Error(`Lv不足: ${spec.id}`);
  const [mpBand,apBand]=spec.meta['MP帯・AP帯'].split('／');
  const final=spec.id.includes('_U');
  const mp=entry.kind==='passive'?0:final?0:rules.mp_bands[{'軽':'light','中':'medium','重':'heavy'}[mpBand]];
  const ap=rules.ap_bands[{'導入':'intro','標準':'standard','発展':'advanced','奥義':'ultimate'}[apBand]];
  if(mp==null||ap==null)throw new Error(`費用帯不正: ${spec.id}`);
  const tags=tagsFor(spec,entry);
  const effects=spec.levels.map((description,i)=>({
    master:true,description:displayDescription(description),source_description:description,prerequisites:prerequisites(spec),weapons:requiredWeapons(spec),tags,
    target:spec.meta['対象'],reference:spec.meta['参照能力・基準'],
    ...revisedEffect(spec.id,i,entry.effect(spec.levels.length===5?i:spec.id.includes('_U')?4:2)),
    growth_mode:spec.levels.length===1?'none':`lv${spec.levels.length}`,
    ...(final?{ultimate:true}:{}),
  }));
  const effect={...effects[0],levels:effects.slice(1).map((effect,i)=>({ap:rules.upgrade_ap[i],mp,effect}))};
  rows.push({id:spec.id,job:spec.id.replace(/_[APU]\d+$/,''),path:final?'奥義':entry.kind==='passive'?'パッシブ':'アクティブ',stage:Number(spec.id.match(/\d+$/)[0]),name:spec.name,kind:entry.kind,cost:final?0:Number(spec.meta['固定装備コスト']),mp,ap_to_learn:ap,is_final:final?1:0,element:effect.element??'',effect_json:JSON.stringify(effect)});
}
// 個別実装済みの追加職を、基本職の再生成で消さない。
for(const r of current.filter(r=>r.job==='common'||JSON.parse(r.effect_json||'{}').additional))rows.push(r);
const cols=['id','job','path','stage','name','kind','cost','mp','ap_to_learn','is_final','element','effect_json'];
const cell=v=>{const t=String(v??'');return /[",\n\r]/.test(t)?'"'+t.replaceAll('"','""')+'"':t};
fs.writeFileSync(new URL('../data/skills.csv',import.meta.url),'\uFEFF'+cols.join(',')+'\n'+rows.map(r=>cols.map(c=>cell(r[c])).join(',')).join('\n')+'\n');
const previousRules=JSON.parse(fs.readFileSync(new URL('../data/basic_job_rules.json',import.meta.url),'utf8'));
if(previousRules.protection)rules.protection=previousRules.protection;
fs.writeFileSync(new URL('../data/basic_job_rules.json',import.meta.url),JSON.stringify(rules,null,2)+'\n');
console.log(`基本8職 ${specs.length}技能・${specs.reduce((n,s)=>n+s.levels.length,0)}段階を出力`);
