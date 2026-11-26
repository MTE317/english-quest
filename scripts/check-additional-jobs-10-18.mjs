// 設計の独立点検。新技能をゲームへ登録・実行するテストではない。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {realGameData} from '../game/tests/helpers.js';
import {createNewGame,defaultPartySpecs} from '../game/js/game-state.js';
import {makeGear,gearDef,computeStats,spellPower,weaponPower,aptitudeMul} from '../game/js/character.js';
import {enemyStatusChance} from '../game/js/battle.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=JSON.parse(fs.readFileSync(path.join(root,'docs/specs/additional-jobs-10-18-skills-v1.json'),'utf8'));
const data=realGameData(),skills=source.jobs.flatMap(j=>j.skills),byId=new Map(skills.map(s=>[s.id,s]));
const get=id=>byId.get(id),last=id=>get(id).levelRules.at(-1);
let assertions=0;
const check=(condition,label)=>{assert.ok(condition,label);assertions++;};
const near=(a,b,label)=>check(Math.abs(a-b)<1e-8,label);
check(source.status==='design_only','設計のみ');
check(skills.length===135&&source.validation.stages===439,'135技能439段階');
check(data.jobs.filter(j=>j.skillsReady).length===17,'現行17職のまま');
check([...data.skills.values()].filter(s=>s.effect.master).length===255,'現行255技能のまま');
for(const job of source.jobs){
 const baseline=data.jobsById.get(job.id);check(baseline&&!baseline.skillsReady,job.id+' は準備中');
 check(job.skills.length===15,job.id+' は15技能');
 for(const skill of job.skills){
  check(!data.skills.has(skill.id),skill.id+' は実行データへ未登録');
  check(skill.weapons.every(id=>data.weaponTypes.has(id)),skill.id+' 武器ID');
  check(skill.effectDisplay.sections.every(title=>Object.values({party:'全体の強化・弱化',ongoing:'ジョブの固有継続効果',special:'その他の特殊効果'}).includes(title)),skill.id+' 表示分類');
  check(skill.effectDisplay.icon==='job-special',skill.id+' 共通画像');
  for(const prerequisite of skill.prerequisites)check(prerequisite.id.startsWith(job.id+'_'),skill.id+' 前提は同職');
  function visit(value,key=''){
   if(typeof value==='number')check(Number.isFinite(value)&&value>=0,skill.id+' '+key+' 有限数');
   if(Array.isArray(value)){if(key==='statuses')for(const id of value)check(data.statusEffects.has(id),skill.id+' 状態ID '+id);for(const item of value)visit(item,key);return;}
   if(!value||typeof value!=='object')return;
   if(value.id&&key.toLowerCase().includes('status'))check(data.statusEffects.has(value.id),skill.id+' 状態ID '+value.id);
   if(value.type&&key.toLowerCase().includes('type'))check(data.monsterTypes.has(value.type),skill.id+' 種族ID '+value.type);
   if(value.element)check([...data.elements.keys(),'chosen','enchant'].includes(value.element),skill.id+' 属性ID '+value.element);
   if(value.elements)check(value.elements.every(id=>data.elements.has(id)),skill.id+' 属性集合');
   if(value.rate!=null)check(value.rate<=1,skill.id+' 率の上限');
   for(const [name,item]of Object.entries(value))visit(item,name);
  }
  skill.levelRules.forEach(value=>visit(value));
 }
}
for(const kind of ['W','WB'])for(const s of skills.filter(s=>s.type!=='passive'&&s.reference===kind&&!s.tags.includes('jump_prepare')))check(s.tags.includes('physical')&&s.tags.includes('weapon'),s.id+' 物理攻撃分類');
for(const s of skills.filter(s=>['M','MS'].includes(s.reference)))check(s.tags.includes('magic')&&!s.tags.includes('weapon'),s.id+' 魔法分類');

const jump=last('dragoon_A02');check(jump.opportunities===2&&jump.payMp==='launch'&&jump.weaponTriggers==='landing','跳躍は2行動・支払い1回・着地のみ武器技');
check(jump.attackRestrictionAtBothPhases===true&&jump.landingUnavailable==='cancel_then_normal_choice','攻撃技能制限を跳躍の両段階で確認');
check(last('dragoon_U01').createsLandingHistory===false,'即時奥義で跳躍後条件を無料作成しない');
const reload=last('gunner_A02'),bullet=last('gunner_A03');
let ammo=0,baseMp=0;ammo=Math.min(reload.capacity,ammo+reload.count);baseMp+=get('gunner_A02').baseMp;
for(let i=0;i<3;i++){check(ammo>=bullet.ammoCost,'3射分を前払い可能');ammo-=bullet.ammoCost;baseMp+=get('gunner_A03').baseMp;}
check(ammo===0&&ammo<bullet.ammoCost,'補充なしの4射目は不可');
const familiar=last('witch_A02'),bond=last('witch_P01').familiarOnSummon,foresight=last('witch_P05').familiarConditionDamage;
const familiarFinite=familiar.charges*(familiar.power+bond.powerAdd)*(1+foresight.rate);
const mark=last('hexer_A01'),markAdd=last('hexer_P03').bitterMarkPowerAdd;
const markFinite=mark.targetLimit*mark.charges*(mark.power+markAdd);
check(familiar.charges===3&&familiar.turns===3,'通常使い魔は反応3回・3行動');
check(mark.charges===2&&mark.turns===3,'通常苦呪印は反応2回・対象3行動');
const discount=[.2,.35,.5].map(rate=>Math.ceil(6*(1-rate)));check(discount.join(',')==='5,4,3','限定燃費の3段階');
const statuses=new Set(['poison','bind','blind','fear','seal','silence']);
const statusCases=[];
for(const id of statuses){
 const immune=enemyStatusChance(data,{statusAffinity:{[id]:'×'},boss:false},1,id,.7,false);
 near(immune,0,id+' の無効を迂回しない');
 const normal=enemyStatusChance(data,{statusAffinity:{[id]:'〇'},boss:false},1,id,.7,false);
 const boss=enemyStatusChance(data,{statusAffinity:{[id]:'〇'},boss:true,statusHits:{}},1,id,.7,false);
 check(boss<=normal,id+' ボス補正で付与率を増やさない');
 statusCases.push({id,normal,boss,immune});
}
near(enemyStatusChance(data,{statusAffinity:{fear:'★'},boss:false},1,'fear',.7,false),.95,'弱点でも95%上限');
const resistance=(base,additive,multiplicative)=>base*(1-Math.min(1,additive))*multiplicative.reduce((value,rate)=>value*(1-rate),1);
near(resistance(1,1,[last('hexer_P05').statusResist.rate]),0,'加算100%は0のまま');
near(resistance(.5,.4,[.4]),.18,'乗算40%を加算耐性へ混ぜない');

const equipment=[];
for(const lv of [1,20,50,80]){
 const game=createNewGame(data,defaultPartySpecs(data)),member=game.party[0];member.job='witch';member.lv=lv;
 const candidates=[...data.equipment.values()].filter(item=>item.kind==='scythe'&&!item.unique).sort((a,b)=>a.itemLv-b.itemLv);
 const def=candidates.filter(item=>item.itemLv<=lv).at(-1)??candidates[0];const gear=makeGear(game,def.id);member.equip.weapon=gear;
 const shared=data.basicJobRules.spell_equipment;
 const plannedAux=(shared.base+shared.per_level*def.itemLv)*(gear.quality??1)*(1+.05*(gear.enh??0))*aptitudeMul(data,member.job,def);
 const stat=computeStats(data,member),physical=weaponPower(data,member,gear),currentAux=spellPower(data,member,gear);
 check(plannedAux>0&&currentAux===0,'MS補助は未実装の独立した設計 '+lv);
 const normalized=plannedAux/aptitudeMul(data,member.job,def)/(gear.quality??1)/(1+.05*(gear.enh??0));
 near(normalized,shared.base+shared.per_level*def.itemLv,'通常術装備と同じLv係数 '+lv);
 equipment.push({characterLevel:lv,item:def.id,itemLevel:def.itemLv,MAG:stat.mag,physicalWeaponPower:Number(physical.toFixed(3)),currentOrdinarySpellAux:currentAux,plannedMSAux:Number(plannedAux.toFixed(3))});
}
const budgets=[
 {case:'跳躍槍（最大Lv）',actions:jump.opportunities,baseMp:get('dragoon_A02').baseMp,rawPower:jump.landingPower,perAction:jump.landingPower/jump.opportunities,note:'準備1＋着地1。即時長槍突きは1行動1.70。跳躍の防御窓は別の価値。'},
 {case:'装弾3発→火薬弾3回（最大Lv）',actions:4,baseMp,rawPower:bullet.power*3,perAction:bullet.power*3/4,note:'補充1行動を含む。属性相性・銃特性・軽減を省いた基礎倍率。'},
 {case:'通常使い魔1契約の追撃上限',actions:1,baseMp:get('witch_A02').baseMp,rawPower:Number(familiarFinite.toFixed(4)),perAction:null,note:'絆＋先読み成立時の反応3回分。別途3回の自発魔法とMPが必要。影写しと同時に出さない。'},
 {case:'通常苦呪印1回の反応総量',actions:1,baseMp:get('hexer_A01').baseMp,rawPower:Number(markFinite.toFixed(4)),perAction:null,note:'最大Lvで3敵×2反応、苦呪の深さ最大を加算。敵の実行・生存・所有者生存等の条件が必要。'}
];
const report={date:'2026-11-26',status:'design_review_only',assertions,structural:source.validation,budgets,equipment,statusCases,
 limits:['新技能を実戦闘エンジンへ登録・発動する検証ではない','倍率の概算は正誤・会心・乱数・属性・敵防御・6人編成を含まない','長期バランスと新機構の実動は個別実装後に検証する']};
if(process.argv.includes('--write')){
 fs.writeFileSync(path.join(root,'docs/specs/additional-jobs-10-18-review-v1.json'),JSON.stringify(report,null,2)+'\n');
 const cell=value=>String(value??'—').replaceAll('|','／'),row=values=>'| '+values.map(cell).join(' | ')+' |';
 let md='# 追加10〜18職：設計点検\n\n2026-11-26。[135技能の設計](additional-jobs-10-18-skills-v1.md)に対する独立点検。ゲームへの実装・実動確認ではない。\n\n'+assertions+'件の参照・分類・数値・上限チェックが成功。全135技能、439段階、既存256技能との非重複、現行17職・255技能を維持したことを確認した。全体の構造結果は[点検JSON](specs/additional-jobs-10-18-review-v1.json)に保存。\n\n## 準備・有限反応の予算\n\n生の倍率と基礎MPだけの比較。属性相性、敵防御、正誤、乱数、会心、6人編成は含まない。\n\n| 対象 | 必要な自発行動 | 基礎MP | 倍率合計 | 1行動当たり | 条件 |\n|---|---:|---:|---:|---:|---|\n'+budgets.map(b=>row([b.case,b.actions,b.baseMp,b.rawPower,b.perAction==null?'—':Number(b.perAction.toFixed(4)),b.note])).join('\n')+'\n\n## 魔女の鎌術と装備補助\n\n現行の通常MAG魔法は鎌から術補助を得ない。鎌術MSは、普通の術装備と同じLv・品質・強化・適性係数で独立した補助を設計した。鎌の物理武器威力を足す式ではなく、MS技能だけに適用する未実装要素。\n\n| キャラLv | 実装済みの装備 | 装備Lv | MAG | 物理武器威力 | 現行の通常術補助 | 設計したMS術補助 |\n|---|---|---:|---:|---:|---:|---:|\n'+equipment.map(e=>row([e.characterLevel,e.item,e.itemLevel,e.MAG,e.physicalWeaponPower,e.currentOrdinarySpellAux,e.plannedMSAux])).join('\n')+'\n\n## 状態異常と範囲\n\n実行中の共通計算を用い、毒・束縛・暗闇・恐怖・封印・沈黙の×相性が0、ボス補正が成功率を増やさない、★相性も95%上限であることを確認。味方の乗算軽減の算術は加算100%なら0を保つ。新技能の実付与は未実装のため、ゲーム上での発動を確認した結果ではない。\n\n## 実装時に残る検証\n\n'+report.limits.map(s=>'- '+s).join('\n')+'\n\n再確認：node scripts/design-additional-jobs-10-18.mjs → node scripts/check-additional-jobs-10-18.mjs --write。\n';
 fs.writeFileSync(path.join(root,'docs/additional-jobs-10-18-review-v1.md'),md);
}
console.log(JSON.stringify({status:'passed',assertions,jobs:9,skills:135,stages:439,budgets,equipment},null,2));
