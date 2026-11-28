// Battle-local state for the first three legendary jobs. All effects are resolved on a real action.
import { passiveRules, grantMasterEffect } from './job-combat.js';
import { maxHp, maxMp } from './character.js';

const rank=(data,m,id)=>passiveRules(data,m).find(x=>x.skill.id===id)?.legendary?.level??0;
const value=(list,level)=>list[Math.min(level-1,list.length-1)];
const alive=(g,b)=>g.party.map((m,i)=>m.hp>0&&!b.allies[i].statuses?.petrify?i:-1).filter(i=>i>=0);
const enemies=b=>b.enemies.map((e,i)=>e.hp>0?i:-1).filter(i=>i>=0);
const chainIds=new Set(['sword_saint_A01','sword_saint_A02','sword_saint_A03','sword_saint_A05','sword_saint_A07','sword_saint_A09']);
export const legendaryTarget=s=>s.effect?.rules?.legendary?.target;
export function legendaryBlock(data,game,b,i,s){
 if(!legendaryTarget(s))return '';
 const a=b.allies[i],id=s.id;
 if(id.startsWith('hero_')&&({hero_A04:1,hero_A07:1,hero_A08:2,hero_A09:2}[id]??0)>(a.heroCourage??0))return '勇気が足りない';
 if(id==='demon_lord_A07'&&a.demonTransformedOnce)return 'この戦闘では変身済み';
 if(['demon_lord_A08','demon_lord_A09'].includes(id)&&!a.demonForm?.remaining)return '変身中のみ使用できる';
 return '';
}
export function legendaryTargetBlock(game,b,i,s,target){
 const t=legendaryTarget(s);if(!t)return '';
 if(s.id==='hero_A02'&&i===target)return '自分以外を選ぶ';
 if(t==='enemy'&&!(b.enemies[target]?.hp>0))return '対象の敵がいない';
 if(t==='ally'&&!(game.party[target]?.hp>0))return '生存中の味方を選ぶ';
 if(t==='enemies'&&!enemies(b).length)return '対象の敵がいない';
 return '';
}
export function legendaryMpSave(data,m,s,b,i){
 const a=b?.allies[i],id=s?.id;
 if(!a||!id)return 0;
 if(id.startsWith('hero_')&&!s.isFinal&&['hero_A04','hero_A07','hero_A08','hero_A09'].includes(id))return rank(data,m,'hero_P05')?[0,.2,.3,.4][rank(data,m,'hero_P05')]:0;
 if(chainIds.has(id)&&a.swordChainId===id&&a.swordChainStage>0)return rank(data,m,'sword_saint_P03')?[0,.2,.3,.4][rank(data,m,'sword_saint_P03')]:0;
 return 0;
}
export function legendaryAttackBonus(data,g,b,i,skill,target,elements,kind){
 const m=g.party[i],a=b.allies[i],id=skill?.id??'';
 let bonus=0;
 if(id==='sword_saint_A02'&&(b.enemies[target]?.buffs?.def?.[0]??0)>0)bonus+=.10;
 if(id==='sword_saint_A09'&&a.swordChainId===id&&a.swordChainStage>=2)bonus+=.10;
 if(chainIds.has(id)&&a.swordChainId===id&&a.swordChainStage>0)bonus+=(a.swordChainStage)*([0,.03,.04,.05][rank(data,m,'sword_saint_P01')]??0);
 if(a.demonForm?.remaining){if(!skill)bonus+=.15;else if(id.startsWith('demon_lord_'))bonus+=a.demonForm.bonus;}
 if(!skill&&m.job==='hero'&&rank(data,m,'hero_P01')&&elements?.some(el=>b.enemies[target]?.weak?.includes(el)))bonus+=[0,.05,.08,.10][rank(data,m,'hero_P01')];
 if(!skill&&kind==='mag'&&a.demonForm?.remaining&&m.mp>=12&&rank(data,m,'demon_lord_P04'))bonus+=[0,.05,.08,.10][rank(data,m,'demon_lord_P04')];
 return bonus;
}
export function legendaryAccuracy(data,g,b,i,skill){
 const a=b.allies[i],m=g.party[i],id=skill?.id;
 let result=a.swordFocus?.rate??0;
 if(chainIds.has(id)&&a.swordChainId===id&&a.swordChainStage===3)result+=[0,.05,.08,.10][rank(data,m,'sword_saint_P04')]??0;
 return result;
}
export function legendaryAttackUsed(b,i){delete b.allies[i].swordFocus;}
export function legendaryIncomingCut(data,g,b,i,element){
 const a=b.allies[i],m=g.party[i];let cut=0;
 if(a.demonForm?.remaining)cut+=.05+([0,.04,.06,.08][rank(data,m,'demon_lord_P03')]??0);
 if(['dark','fire'].includes(element))cut+=[0,.05,.08,.10][rank(data,m,'demon_lord_P05')]??0;
 if(a.swordGuard){cut+=a.swordGuard;a.swordGuardApplied=a.swordGuard;delete a.swordGuard;}
 if(a.heroGuard){cut+=a.heroGuard;delete a.heroGuard;}
 return cut;
}
export function legendaryAfterDamage(data,g,b,i,beforeHp){
 const a=b.allies[i];if(a.swordGuardApplied){
  const gained=beforeHp-g.party[i].hp;
  if(gained>0){const lv=rank(data,g.party[i],'sword_saint_P05');if(lv)g.party[i].mp=Math.min(maxMp(data,g.party[i]),g.party[i].mp+lv);}
  delete a.swordGuardApplied;
 }
}
export function legendaryOnCover(data,g,b,actor,received){
 const a=b.allies[actor];if(!a.heroCover)return;
 if(received){gainCourage(b,actor);delete a.heroCover;delete a.masterCover;}
}
export function gainCourage(b,i){
 const a=b.allies[i];if(a.heroEarnedClock===b.actionClock||a.heroEarnedTotal>=6)return;
 a.heroCourage=Math.min(3,(a.heroCourage??0)+1);a.heroEarnedTotal=(a.heroEarnedTotal??0)+1;a.heroEarnedClock=b.actionClock;
}
export function legendaryOnHit(data,g,b,i,target,result,skill,actual){
 if(!actual||!result?.landed)return;
 const id=skill?.id??'';
 if(g.party[i].job==='hero'&&!['hero_A04','hero_A08','hero_U01'].includes(id)&&result.em>1&&(!skill||id==='hero_A01'))gainCourage(b,i);
}
export function clearLegendary(b,i,finished=false){
 const a=b.allies[i];for(const k of ['heroCourage','heroEarnedClock','heroCover','heroGuard','demonForm','swordChainId','swordChainStage','swordGuard','swordGuardApplied','swordFocus'])delete a[k];
 delete a.masterCover;
 if(finished){delete a.heroEarnedTotal;delete a.demonTransformedOnce;}
}
export function finishLegendaryOpportunity(b,i,skill=null,performed=false){
 const a=b.allies[i];
 if(a.demonForm?.remaining&&a.demonForm.grantedClock!==b.actionClock&&--a.demonForm.remaining<=0)delete a.demonForm;
 if(a.swordFocus?.grantedClock!==b.actionClock)delete a.swordFocus;
 if(performed&&chainIds.has(skill?.id)){
   a.swordChainStage=a.swordChainId===skill.id?Math.min(3,(a.swordChainStage??0)+1):0;
   a.swordChainId=skill.id;
 }else if(performed||!skill){a.swordChainStage=0;delete a.swordChainId;}
}
export function runLegendary(data,g,b,i,s,target,cm,action,ctx){
 const id=s.id,L=s.effect.rules.legendary.level,m=g.party[i],a=b.allies[i],p=suffix=>rank(data,m,`${s.job}_${suffix}`);
 const power=s.effect.m??1;
 const shield=(t,scale)=>ctx.shield(t,Math.floor((10+.5*m.lv+ctx.stats().res)*scale),id);
 const heal=(t,scale)=>{const low=g.party[t].hp<=maxHp(data,g.party[t])*.3;const got=ctx.heal(t,scale);if(got>0&&id==='hero_A03'&&low)gainCourage(b,i);
   if(got>0&&low&&id.startsWith('hero_')&&p('P04'))ctx.shield(t,maxHp(data,g.party[t])*[0,.03,.05,.07][p('P04')],`${id}_P04`);return got;};
 const hit=(t,amount,element,base='weapon',factor=1,status)=>ctx.attack(t,amount,element,base,status,factor);
 const best=(t,choices)=>choices.reduce((a,c)=>ctx.elementMultiplier(b.enemies[t],c)>ctx.elementMultiplier(b.enemies[t],a)?c:a);
 const all=enemies(b),party=alive(g,b);
 if(id.startsWith('hero_')){
   if(id==='hero_A02'){a.heroCover={target};a.masterCover={target:'selected',targetIndex:target,rate:1,cut:value([.10,.15,.20],L)+([0,.05,.08,.10][p('P03')]??0),physical_only:false};}
   else if(id==='hero_A03')heal(target,power);
   else if(id==='hero_A05'){const spent=action.spendCourage&&a.heroCourage>0?1:0;a.heroCourage-=spent;shield(target,power*(1+spent*.2));}
   else if(id==='hero_A07'){a.heroCourage--;for(const t of party)heal(t,power);}
   else if(id==='hero_A09'){a.heroCourage-=2;for(const t of party){shield(t,power);b.allies[t].heroGuard=.05;}}
   else if(id==='hero_U01'){const spent=Math.min(3,a.heroCourage??0);a.heroCourage=0;for(const t of all)hit(t,1.55+.2*spent,best(t,['light','slash']),'weapon');for(const t of party){heal(t,.35);shield(t,.40);}}
   else {if(id==='hero_A04')a.heroCourage--;if(id==='hero_A08')a.heroCourage-=2;
     const factor=id==='hero_A08'&&m.hp<=maxHp(data,m)*.5?1.1:1;
     hit(target,power,id==='hero_A06'?best(target,['light','thunder']):undefined,id==='hero_A06'?'mag':'weapon',factor);}
 }else if(id.startsWith('demon_lord_')){
   if(id==='demon_lord_A03')shield(i,power);
   else if(id==='demon_lord_A07'||id==='demon_lord_U01'){
     if(id==='demon_lord_U01')for(const t of all)hit(t,1.65,best(t,['dark','fire']),'mag');
     a.demonForm={remaining:id.endsWith('U01')?3:value([2,3,4],L),bonus:id.endsWith('U01')?.20:.10,grantedClock:b.actionClock};
     if(id==='demon_lord_A07')a.demonTransformedOnce=true;
   }else if(id==='demon_lord_A08'){for(const t of all)hit(t,power,'fire','mag');}
   else {const result=hit(target,power,id==='demon_lord_A01'?best(target,['dark','fire']):['demon_lord_A04','demon_lord_A06'].includes(id)?'dark':undefined,['demon_lord_A01','demon_lord_A04','demon_lord_A06'].includes(id)?'mag':'weapon',1,
      id==='demon_lord_A06'?['fear',.35]:undefined);
     if(id==='demon_lord_A05'&&result.damage>0)ctx.healRaw(i,Math.min(Math.floor(result.damage*.1),Math.floor(maxHp(data,m)*.1)));
     if(id==='demon_lord_A09'&&a.demonForm&&--a.demonForm.remaining<=0)delete a.demonForm;
   }
 }else if(id.startsWith('sword_saint_')){
   const stage=a.swordChainId===id?a.swordChainStage??0:0;
   if(id==='sword_saint_A04'){ctx.healRaw(i,Math.floor(maxHp(data,m)*value([.08,.10,.12],L)));a.swordGuard=.05;}
   else if(id==='sword_saint_A06'){m.mp=Math.min(maxMp(data,m),m.mp+value([2,3,4],L));a.swordFocus={rate:.05,grantedClock:b.actionClock};}
   else if(id==='sword_saint_A08')a.swordGuard=value([.10,.15,.20],L);
   else {let amount=power;if(id==='sword_saint_U01')amount=2.10+.25*(a.swordChainStage??0);
     const count=id==='sword_saint_A07'?2:1;let dealt=false;
     for(let n=0;n<count&&b.enemies[target]?.hp>0;n++){const result=hit(target,amount/count,'slash','weapon');dealt ||=result.damage>0;}
     if(id==='sword_saint_A05'&&dealt&&b.enemies[target]?.buffs?.def)delete b.enemies[target].buffs.def;
     if(id==='sword_saint_U01'){a.swordChainStage=0;delete a.swordChainId;}
   }
 }
}
