// Remaining legendary jobs: battle-only memory, miracles and command resources.
import {passiveRules,grantMasterEffect,masterShieldRoom} from './job-combat.js';
import {maxHp,maxMp} from './character.js';

const rank=(data,m,id)=>passiveRules(data,m).find(x=>x.skill.id===id)?.legendary_final?.level??0;
const at=(v,l)=>v[Math.min(v.length-1,Math.max(0,l-1))];
const alive=(g,b)=>g.party.map((m,i)=>m.hp>0&&!b.allies[i].statuses?.petrify?i:-1).filter(i=>i>=0);
const down=(g,b)=>g.party.map((m,i)=>m.hp<=0&&!b.allies[i].statuses?.petrify?i:-1).filter(i=>i>=0);
const enemies=b=>b.enemies.map((e,i)=>e.hp>0?i:-1).filter(i=>i>=0);
const spent={overlord_A03:1,overlord_A05:1,overlord_A07:2,overlord_A09:3,saint_A06:1,saint_A07:2,saint_A08:1,saint_A09:3};
export const finalTarget=s=>s.effect?.rules?.legendary_final?.target;
export function finalBlock(data,g,b,i,s){
 if(!finalTarget(s))return '';
 const a=b.allies[i],id=s.id,need=spent[id]??0;
 if(need>(id.startsWith('saint_')?a.saintMiracles??0:a.overlordHaki??0))return id.startsWith('saint_')?'奇跡が足りない':'覇気が足りない';
 if(['sage_A04','sage_A05','sage_A08','sage_A09'].includes(id)&&!a.sageMemory)return '術式記憶がない';
 if(['saint_A06','saint_A09'].includes(id)&&!down(g,b).length)return '蘇生できる味方がいない';
 if(id==='saint_A07'&&alive(g,b).every(t=>b.allies[t].saintWardApplied))return '護符を付けられる味方がいない';
 return '';
}
export function finalTargetBlock(g,b,i,s,target,action){
 const kind=finalTarget(s);if(!kind)return '';
 if(s.effect.rules?.choose_element?.length&&!s.effect.rules.choose_element.includes(action.element))return '元素を選ぶ';
 const old=b.allies[i].sageMemory?.element;
 if(['sage_A04','sage_A08','sage_A09','sage_A07'].includes(s.id)&&old===action.element)return '記憶と異なる元素を選ぶ';
 if(kind==='enemy'&&!(b.enemies[target]?.hp>0))return '対象の敵がいない';
 if(kind==='enemies'&&!enemies(b).length)return '対象の敵がいない';
 if(kind==='ally'&&!(g.party[target]?.hp>0))return '生存中の味方を選ぶ';
 if(kind==='ko_ally'&&!down(g,b).includes(target))return '蘇生できる味方を選ぶ';
 if(kind==='ko_allies'){
   const ts=action.targets??[];
   if(!ts.length||ts.length>2||new Set(ts).size!==ts.length||ts.some(t=>!down(g,b).includes(t)))return '蘇生する味方を1〜2人選ぶ';
 }
 if(s.id==='saint_A07'&&b.allies[target]?.saintWardApplied)return 'この味方には既に護符を付けた';
 if(s.id==='overlord_A04'&&i===target)return '自分以外を選ぶ';
 return '';
}
export function finalMpSave(data,m,s,b,i){
 const a=b?.allies[i];if(!a||!['sage_A01','sage_A03'].includes(s?.id)||!a.sageMemory)return 0;
 return [0,.2,.3,.4][rank(data,m,'sage_P03')]??0;
}
export function finalDamageMultiplier(data,g,b,i,s,kind){
 const m=g.party[i],a=b.allies[i],id=s?.id??'';
 const direct=!s||s.kind==='attack'&&!s.isFinal&&!s.effect.rules?.reaction
  &&!s.effect.rules?.proxy_attack&&!s.effect.rules?.nature_forecast&&!s.effect.rules?.companion_attack;
 let bonus=0;
 if(direct&&a.overlordMarch)bonus+=a.overlordMarch.rate;
 if(m.job==='overlord'&&s?.kind==='attack'&&s.effect.base==='weapon'&&!s.isFinal){
   if((a.overlordHaki??0)>0)bonus+=[0,.04,.06,.08][rank(data,m,'overlord_P02')]??0;
   if(a.overlordMomentum)bonus+=a.overlordMomentum.rate;
 }
 if(['sage_A04','sage_A08','sage_A09'].includes(id)&&a.sageCombining)bonus+=[0,.05,.08,.10][rank(data,m,'sage_P01')]??0;
 if(id==='sage_A03'&&a.sageMemory&&s.effect.element!==a.sageMemory.element)bonus+=.05;
 return 1+bonus;
}
export function finalOnCover(b,i){const a=b.allies[i];if(a.overlordCover){delete a.overlordCover;delete a.masterCover;}}
export function finalIncomingCut(data,g,b,i,elements){
 const a=b.allies[i],m=g.party[i];let cut=0;
 if(a.sageMemory&&elements.includes(a.sageMemory.element))cut+=[0,.05,.08,.10][rank(data,m,'sage_P04')]??0;
 if(a.sageWard&&elements.includes(a.sageWard.element))cut+=a.sageWard.rate;
 if((a.overlordHaki??0)>=2)cut+=[0,.04,.06,.08][rank(data,m,'overlord_P03')]??0;
 if(a.overlordVulnerable)cut-=.05;
 return cut;
}
export function finalBeforeFatal(data,g,b,i,source){
 const a=b.allies[i],m=g.party[i];if(!source?.direct||!a.saintWard||a.saintWardUsed||a.statuses?.petrify)return false;
 const ward=a.saintWard;delete a.saintWard;a.saintWardUsed=true;m.hp=1;
 const lv=rank(data,g.party[ward.source],'saint_P05');
 const amount=maxHp(data,m)*(ward.rate+([0,.03,.05,.07][lv]??0));
 const room=masterShieldRoom(data,g,b,i,'saint_A07');const shield=Math.max(0,Math.floor(Math.min(room,amount,maxHp(data,m)*.5)));
 if(shield)grantMasterEffect(b,i,'saint_A07',{shield,remaining:2,source:ward.source,skillId:'saint_A07',grantedClock:b.actionClock});
 return true;
}
export function finalOnKO(data,g,b,target,source){
 if(!source?.direct)return;
 for(let i=0;i<g.party.length;i++){
  const m=g.party[i],a=b.allies[i],lv=rank(data,m,'saint_P04');
  if(i===target||m.hp<=0||a.statuses?.petrify||!lv||a.saintKoEarned)continue;
  a.saintKoEarned=true;gainMiracle(b,i);
  m.mp=Math.min(maxMp(data,m),m.mp+[0,0,2,3][lv]);
 }
}
function gainMiracle(b,i){const a=b.allies[i];if(a.saintEarnedClock===b.actionClock||(a.saintEarnedTotal??0)>=4)return false;
 a.saintMiracles=Math.min(3,(a.saintMiracles??0)+1);a.saintEarnedClock=b.actionClock;a.saintEarnedTotal=(a.saintEarnedTotal??0)+1;return true;}
export function finalOnHit(data,g,b,i,damage,primaryAction){
 if(!primaryAction||damage<=0||!g.party[i])return;
 const actor=b.allies[i],id=actor.advancedAction?.skillId;
 const skill=id?data.skills.get(id):null;
 if(skill?.isFinal||skill?.effect.rules?.proxy_attack||skill?.effect.rules?.reaction||id==='overlord_A05')return;
 if(skill&&skill.kind!=='attack')return;
 for(let j=0;j<g.party.length;j++){
  if(i===j||g.party[j].job!=='overlord'||g.party[j].hp<=0)continue;
  const a=b.allies[j];if(['petrify','sleep','freeze','stun','paralysis','confusion','charm'].some(st=>a.statuses?.[st]))continue;
  if(a.overlordEarnedRound===b.round||(a.overlordEarnedTotal??0)>=4)continue;
  a.overlordEarnedRound=b.round;a.overlordEarnedTotal=(a.overlordEarnedTotal??0)+1;a.overlordHaki=Math.min(3,(a.overlordHaki??0)+1);
 }
}
export function clearFinal(b,i,finished=false){
 const a=b.allies[i];for(const key of ['sageMemory','sageCombining','sageWard','saintMiracles','saintWard','overlordHaki','overlordMarch','overlordMomentum','overlordVulnerable','overlordHealPending','overlordCover'])delete a[key];
 if(finished)for(const key of ['saintEarnedTotal','saintEarnedClock','saintKoEarned','saintWardUsed','saintWardApplied','sageRefundCount','overlordEarnedRound','overlordEarnedTotal','overlordHealCount'])delete a[key];
}
export function finishFinalOpportunity(data,g,b,i,skill=null,performed=false){
 const a=b.allies[i];
 if(performed&&(!skill||skill.kind==='attack'&&!skill.isFinal)){
   if(a.overlordMarch&&a.overlordMarch.grantedClock!==b.actionClock&&--a.overlordMarch.uses<=0)delete a.overlordMarch;
   if(a.overlordMomentum&&a.overlordMomentum.grantedClock!==b.actionClock&&(!skill||skill.effect.base==='weapon'))delete a.overlordMomentum;
 }
 if(a.overlordHealPending){if((a.overlordHealCount??0)<2&&g.party[i].hp>0){
  const lv=rank(data,g.party[i],'overlord_P04');if(lv){g.party[i].hp=Math.min(maxHp(data,g.party[i]),g.party[i].hp+Math.floor(maxHp(data,g.party[i])*[0,.03,.05,.07][lv]));a.overlordHealCount=(a.overlordHealCount??0)+1;}
 }delete a.overlordHealPending;}
 if(a.overlordVulnerable&&a.overlordVulnerable.grantedClock!==b.actionClock)delete a.overlordVulnerable;
 if(a.overlordMarch&&a.overlordMarch.grantedClock!==b.actionClock&&--a.overlordMarch.remaining<=0)delete a.overlordMarch;
 if(a.overlordMomentum&&a.overlordMomentum.grantedClock!==b.actionClock)delete a.overlordMomentum;
 if(a.sageWard&&a.sageWard.grantedClock!==b.actionClock&&--a.sageWard.remaining<=0)delete a.sageWard;
 if(a.saintWard&&a.saintWard.grantedClock!==b.actionClock&&--a.saintWard.remaining<=0)delete a.saintWard;
}
export function runFinal(data,g,b,i,s,target,cm,action,ctx){
 const id=s.id,L=s.effect.rules.legendary_final.level,m=g.party[i],a=b.allies[i],power=s.effect.m??1;
 const p=code=>rank(data,m,`${s.job}_${code}`),party=alive(g,b),foes=enemies(b);
 const shield=(t,scale,key=id)=>ctx.shield(t,Math.floor((10+.5*m.lv+ctx.stats().res)*scale),key);
 const heal=(t,scale,earn=true)=>{const low=g.party[t].hp<=maxHp(data,g.party[t])*.4;
  const bonus=low&&p('P01')&&id.startsWith('saint_')&&id!=='saint_U01'?[0,.05,.08,.10][p('P01')]:0;
  const got=ctx.heal(t,scale*(1+bonus));if(earn&&low&&got>0&&id.startsWith('saint_'))gainMiracle(b,i);return got;};
 const hit=(t,mult,elements,base='mag')=>ctx.attack(t,mult,elements,base);
 if(id.startsWith('sage_')){
   const old=a.sageMemory?.element,el=action.element;
   if(id==='sage_A05'){b.allies[target].sageWard={element:old,rate:at([.15,.20,.25],L),remaining:2,grantedClock:b.actionClock};}
   else if(id==='sage_A06')m.mp=Math.min(maxMp(data,m),m.mp+Math.min(ctx.spentMp,at([3,4,5],L)));
   else if(id==='sage_A07')a.sageMemory={element:el,level:L};
   else if(id==='sage_U01'){
     const combined=old&&old!==el;delete a.sageMemory;
     for(const t of foes)hit(t,1.65+(combined?.25:0),combined?[old,el]:el);
     a.sageMemory={element:el,level:L};
   }else{
     const combined=['sage_A04','sage_A08','sage_A09'].includes(id);
     if(combined){delete a.sageMemory;a.sageCombining=true;}
     const elements=combined?[old,el]:id==='sage_A02'?['none']:el;
     const targets=id==='sage_A08'?foes:[target];let dealt=false;
     for(const t of targets){const r=hit(t,power,elements);dealt ||=r.landed&&r.damage>0;}
     delete a.sageCombining;
     if(combined&&dealt&&p('P05')&&(a.sageRefundCount??0)<2){m.mp=Math.min(maxMp(data,m),m.mp+[0,2,3,4][p('P05')]);a.sageRefundCount=(a.sageRefundCount??0)+1;}
     if(['sage_A01','sage_A03'].includes(id)&&dealt)a.sageMemory={element:el,level:L};
   }
 }else if(id.startsWith('saint_')){
   if(id==='saint_A01')heal(target,power);
   else if(id==='saint_A02')shield(target,power*(1+([0,.10,.15,.20][p('P03')]??0)));
   else if(id==='saint_A03')hit(target,power,'light');
   else if(id==='saint_A04'){ctx.cure(target,L);heal(target,.25);}
   else if(id==='saint_A05')for(const t of party)heal(t,power);
   else if(id==='saint_A06'){a.saintMiracles--;ctx.revive(target,at([.20,.30,.40],L));}
   else if(id==='saint_A07'){a.saintMiracles-=2;b.allies[target].saintWardApplied=true;b.allies[target].saintWard={source:i,rate:at([.10,.15,.20],L),remaining:2,grantedClock:b.actionClock};}
   else if(id==='saint_A08'){a.saintMiracles--;for(const t of party){ctx.cure(t,1);heal(t,power,false);}}
   else if(id==='saint_A09'){a.saintMiracles-=3;for(const t of action.targets)ctx.revive(t,at([.20,.25,.30],L));}
   else if(id==='saint_U01'){a.saintMiracles=0;for(const t of down(g,b))ctx.revive(t,.30);
     for(const t of alive(g,b)){heal(t,.80,false);shield(t,.40);}}
 }else if(id.startsWith('overlord_')){
   const cost=id==='overlord_U01'?Math.min(3,a.overlordHaki??0):spent[id]??0;
   if(cost){a.overlordHaki-=cost;if(cost>=2)a.overlordHealPending=true;}
   if(id==='overlord_A02'||id==='overlord_U01'){
     if(id==='overlord_U01')for(const t of foes)hit(t,1.45+.15*cost,undefined,'weapon');
     for(const t of party)b.allies[t].overlordMarch={rate:id==='overlord_U01'?.08:at([.05,.07,.09],L),remaining:2,uses:id==='overlord_U01'?2:1,grantedClock:b.actionClock};
   }else if(id==='overlord_A04'){
     a.overlordCover={target};a.masterCover={target:'selected',targetIndex:target,rate:1,cut:at([.10,.15,.20],L),physical_only:false};
   }else if(id==='overlord_A05')for(const t of party)if(t!==i)ctx.putBuff(t,'str',at([.05,.07,.09],L),2);
   else if(id==='overlord_A08'){
     const extra=action.spendHaki&&(a.overlordHaki??0)>0?1:0;a.overlordHaki-=extra;
     for(const t of party)shield(t,power*(1+extra*.20));
   }else{
     const targets=id==='overlord_A07'?foes:[target];let dealt=false;
     for(const t of targets){const r=hit(t,power,id==='overlord_A06'?'fire':undefined,'weapon');dealt ||=r.landed&&r.damage>0;}
     if(id==='overlord_A09')a.overlordVulnerable={grantedClock:b.actionClock};
     if(dealt&&['overlord_A03','overlord_A07','overlord_A09'].includes(id)&&p('P05'))a.overlordMomentum={rate:[0,.05,.08,.10][p('P05')],grantedClock:b.actionClock};
   }
 }
}
