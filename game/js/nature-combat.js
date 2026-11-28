import { passiveRules } from './job-combat.js?v=jobs-22-24-1';
import { maxHp, maxMp } from './character.js?v=jobs-22-24-1';

const passive=(data,m,id)=>passiveRules(data,m).find(x=>x.skill.id===id)?.nature??null;
const alive=(game,b)=>game.party.flatMap((m,i)=>m.hp>0&&!b.allies[i].statuses?.petrify?[i]:[]);
const foes=b=>b.enemies.flatMap((e,i)=>e.hp>0?[i]:[]);
const selected=(arr,action)=>arr?.[Number.isInteger(action.resourceIndex)?action.resourceIndex:0];
const grown=a=>a.seeds?.find(s=>s.growth>0);
const contract=a=>a.contract?.charges>0?a.contract:null;
const forecast=a=>a.forecasts?.length>0?a.forecasts:null;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));

export function natureResources(b,actor,skill){
  const a=b.allies[actor],id=skill.id;
  if(['druid_A04','druid_A05','druid_A06'].includes(id))return (a.seeds??[]).map((s,i)=>({index:i,label:`種${i+1}：成長${s.growth}/3・残り${s.remaining}行動`})).filter(x=>id==='druid_A04'?a.seeds[x.index].growth<3:a.seeds[x.index].growth>0);
  if(['astrologer_A06','astrologer_A07','astrologer_A08'].includes(id))return (a.forecasts??[]).map((s,i)=>({index:i,label:`${s.name}：残り${s.remaining}行動`})).filter(x=>id!=='astrologer_A07'||a.forecasts[x.index].type==='attack');
  return [];
}
export function natureBlock(data,game,b,actor,skill){
  const r=skill.effect?.rules?.nature;if(!r)return '';
  const a=b.allies[actor],id=skill.id,c=contract(a);
  if(a.beast&&!['druid_A07','druid_A08','druid_A09','druid_U01'].includes(id))return '獣化中は使えない';
  if(!a.beast&&['druid_A08','druid_A09'].includes(id))return '獣化中のみ使える';
  if(r.requiresContract&&(!c||c.charges<(r.contractChargeCost??1)||r.requiresContract!=='any'&&c.element!==r.requiresContract))return '契約の属性または残回数が足りない';
  if(r.requiresSeed&&!a.seeds?.length||r.requiresSeedGrowth&&!grown(a)||r.chooseSeed&&!natureResources(b,actor,skill).length)return '使える種がない';
  if(r.requiresForecast&&!natureResources(b,actor,skill).length)return '使える予兆がない';
  if(r.forecast&&!skill.isFinal&&(a.forecasts??[]).filter(f=>!f.ultimate).length>=2)return '予兆の通常枠が満杯';
  return '';
}
export function natureTargetBlock(data,game,b,actor,skill,target,action){
  const r=skill.effect?.rules?.nature;if(!r)return '';
  const kind=skill.effect.rules.nature_target;
  if(kind==='enemy'&&!(b.enemies[target]?.hp>0))return '敵がいない';
  if(kind==='enemies'&&!foes(b).length)return '敵がいない';
  if(kind==='ally'&&(!game.party[target]||game.party[target].hp<=0||b.allies[target].statuses?.petrify))return '対象の味方が行動できない';
  if(r.chooseContract&&skill.id==='summoner_A07'&&action.element===b.allies[actor].contract?.element)return '別の契約を選んでください';
  if(r.chooseContract&&!r.chooseContract.includes(action.element)||r.chooseElement&&!r.chooseElement.includes(action.element))return '属性を選んでください';
  if(r.chooseSeed||r.requiresSeedGrowth||r.requiresForecast)if(!natureResources(b,actor,skill).some(x=>x.index===(action.resourceIndex??0)))return '対象の資源を選んでください';
  return '';
}
export function natureMpSave(data,member,skill,b,actor){
  if(!b||actor==null||skill.isFinal)return 0;
  const rule=skill.effect?.rules?.nature,a=b.allies[actor];
  return (rule?.contractChargeCost||rule?.consumeAllContract)&&contract(a)?passive(data,member,'summoner_P03')?.rate??0:0;
}
export function natureEvasion(data,game,b,actor){return forecast(b.allies[actor])?passive(data,game.party[actor],'astrologer_P01')?.rate??0:0;}
export function natureIncomingCut(data,game,b,actor){
  const m=game.party[actor],a=b.allies[actor];
  return (contract(a)?passive(data,m,'summoner_P05')?.cut??0:0)+(a.beast?passive(data,m,'druid_P03')?.cut??0:0)
    +(forecast(a)?passive(data,m,'astrologer_P05')?.cut??0:0);
}
export function natureAttackBonus(data,game,b,actor,skill,elements){
  const a=b.allies[actor],m=game.party[actor];let bonus=0;
  if(['summoner_A03','summoner_A08','summoner_A09'].includes(skill?.id)&&a.contract?.element===elements[0])bonus+=passive(data,m,'summoner_P01')?.bonus??0;
  if(a.beast&&['druid_A08','druid_A09'].includes(skill?.id))bonus+=passive(data,m,'druid_P05')?.bonus??0;
  if(a.starGuide&&(!skill||skill.kind==='attack'&&!skill.isFinal)&&!skill?.effect?.rules?.nature_forecast&&a.starGuide.grantedClock!==b.actionClock){bonus+=a.starGuide.rate;delete a.starGuide;}
  return bonus;
}
export function clearNature(b,actor){
  for(const key of ['contract','seeds','beast','forecasts','starGuide','starMpRestored'])delete b.allies[actor][key];
}
export function finishNature(data,game,b,actor,ctx){
  const a=b.allies[actor],m=game.party[actor],clock=b.actionClock;
  if(a.contract&&a.contract.grantedClock!==clock&&--a.contract.remaining<=0)delete a.contract;
  for(const seed of a.seeds??[])if(seed.grantedClock!==clock){seed.growth=Math.min(3,seed.growth+1);seed.remaining--;}
  if(a.seeds)a.seeds=a.seeds.filter(seed=>seed.remaining>0);
  if(a.beast&&a.beast.grantedClock!==clock&&--a.beast.remaining<=0)delete a.beast;
  if(a.starGuide&&a.starGuide.grantedClock!==clock&&--a.starGuide.remaining<=0)delete a.starGuide;
  const ready=[];
  for(const f of a.forecasts??[])if(f.remaining<=0||f.grantedClock!==clock&&--f.remaining<=0)ready.push(f);
  if(a.forecasts)a.forecasts=a.forecasts.filter(f=>!ready.includes(f));
  let effective=false;
  for(const f of ready){
    let resolved=false;
    const targets=f.type==='attack_all'?f.targets.filter(t=>b.enemies[t]?.hp>0):f.type==='party_shield'?alive(game,b):[f.target];
    if(f.type==='attack'||f.type==='attack_all')for(const t of targets)if(b.enemies[t]?.hp>0){const hit=ctx.attack(t,f.power,f.element,'mag',f.id,f.snapshot);resolved ||=hit.landed&&hit.damage>0;}
    if(f.type==='shield'||f.type==='party_shield')for(const t of targets)if(maybeAlly(game,b,t)){resolved ||=ctx.shield(t,f.power,f.id)>0;}
    if(f.type==='heal')for(const t of targets)if(maybeAlly(game,b,t)){resolved ||=ctx.heal(t,f.power,f.snapshot)>0;}
    effective ||=resolved;
    if(f.guide&&targets.length&&f.type!=='party_shield'){
      const t=['attack','attack_all'].includes(f.type)?actor:f.target;
      if(maybeAlly(game,b,t)&&resolved)b.allies[t].starGuide={rate:f.guide,remaining:2,grantedClock:clock};
    }
  }
  const mp=passive(data,m,'astrologer_P04');
  if(effective&&mp&&(a.starMpRestored??0)<3){a.starMpRestored=(a.starMpRestored??0)+1;m.mp=Math.min(maxMp(data,m),m.mp+mp.restore);}
  const regen=passive(data,m,'druid_P04');
  if(regen&&m.hp>0&&!a.statuses?.petrify&&grown(a))ctx.healRaw(actor,maxHp(data,m)*regen.regen);
}
const maybeAlly=(game,b,t)=>game.party[t]?.hp>0&&!b.allies[t]?.statuses?.petrify;

export function runNature(data,game,b,actor,skill,target,cm,action,ctx){
  const id=skill.id,r=skill.effect.rules.nature,a=b.allies[actor],m=game.party[actor],clock=b.actionClock;
  const c=contract(a),seed=selected(a.seeds,action),old=selected(a.forecasts,action);
  const shield=(t,p)=>ctx.shield(t,p,id);
  const heal=(t,p)=>ctx.heal(t,p);
  const attack=(t,p,element,base='mag',status=null)=>ctx.attack(t,p,element,base,id,null,status);
  const invoke=(kind,p)=>kind==='fire'?attack(target,p,'fire'):kind==='earth'?alive(game,b).forEach(t=>shield(t,p)):alive(game,b).forEach(t=>heal(t,p));
  if(id.startsWith('summoner_')){
    if(id==='summoner_A01')a.contract={element:action.element,charges:2,remaining:3+(passive(data,m,'summoner_P04')?.turns??0),grantedClock:clock};
    if(id==='summoner_A02')attack(target,r.power,'fire');
    if(['summoner_A03','summoner_A04','summoner_A05','summoner_A06','summoner_A08'].includes(id))c.charges-=r.contractChargeCost;
    if(id==='summoner_A03')attack(target,r.power,'fire');
    if(id==='summoner_A04')for(const t of alive(game,b))shield(t,r.guard);
    if(id==='summoner_A05')for(const t of alive(game,b))heal(t,r.power);
    if(id==='summoner_A06')ctx.statusResist(target,r.rate,id);
    if(id==='summoner_A07'){c.charges--;c.element=action.element;}
    if(id==='summoner_A08')for(const t of foes(b))attack(t,r.power,c.element);
    if(id==='summoner_A09'){const element=c.element,p=r.power*(c.charges>=2?1.2:1);c.charges=0;invoke(element,p);}
    if(id==='summoner_U01'){const same=c?.element===action.element;if(same)c.charges--;const p=r.variants[action.element].power*(same?1.1:1);
      if(action.element==='fire')for(const t of foes(b))attack(t,p,'fire');else invoke(action.element,p);}
  }
  if(id.startsWith('druid_')){
    if(id==='druid_A01'){a.seeds??=[];if(a.seeds.length>=2)a.seeds.shift();a.seeds.push({growth:0,remaining:r.turns,grantedClock:clock});}
    if(id==='druid_A02')attack(target,r.power,'earth');
    if(id==='druid_A03')attack(target,r.power,'water');
    if(id==='druid_A04')seed.growth=clamp(seed.growth+r.growth,0,3);
    if(['druid_A05','druid_A06'].includes(id))seed.growth--;
    if(id==='druid_A05')ctx.inflict(target,r.status.id,r.status.rate,cm,r.turns);
    if(id==='druid_A06')heal(target,r.power*(1+(passive(data,m,'druid_P01')?.bonus??0)));
    if(id==='druid_A07'){if(a.beast)delete a.beast;else a.beast={remaining:r.turns,grantedClock:clock};}
    if(id==='druid_A08')attack(target,r.power,'slash','beast');
    if(id==='druid_A09')for(const t of foes(b))attack(t,r.power,'blunt','beast',r.status);
    if(id==='druid_U01'){const growth=(a.seeds??[]).reduce((n,s)=>n+s.growth,0);a.seeds=[];delete a.beast;
      for(const t of foes(b))attack(t,r.attack.power+growth*r.attack.perGrowth,'earth');
      for(const t of alive(game,b))heal(t,r.heal.power+growth*r.heal.perGrowth);}
  }
  if(id.startsWith('astrologer_')){
    a.forecasts??=[];
    const create=(type,power,element,delay,tgt,ultimate=false)=>{
      const bonus=passive(data,m,'astrologer_P03')?.bonus??0;
      a.forecasts.push({id,name:skill.name,type,power:power*(1+bonus),element,remaining:delay,grantedClock:clock,
        target:tgt,targets:foes(b),snapshot:ctx.snapshot(),ultimate});
    };
    if(r.forecast)create(r.forecast,r.power??r.guard,r.element,r.delay,target);
    if(id==='astrologer_A03')attack(target,r.power,'none');
    if(id==='astrologer_A06')old.remaining=Math.max(0,old.remaining-1);
    if(id==='astrologer_A07')old.target=target;
    if(id==='astrologer_A08')old.guide=r.bonus;
    if(id==='astrologer_U01'){
      for(const f of a.forecasts)f.remaining=Math.max(0,f.remaining-1);
      create('attack_all',r.afterForecasts[0].power,'light',1,0,true);
      create('party_shield',r.afterForecasts[1].power,null,1,0,true);
    }
  }
}
