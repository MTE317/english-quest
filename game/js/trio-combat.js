// 追加31〜33職の戦闘内資源。技能実行は battle.js の共通命中・回復処理を使う。
import { passiveRules, grantMasterEffect, masterShieldRoom } from './job-combat.js?v=jobs-31-33-1';
import { maxHp, maxMp } from './character.js?v=jobs-31-33-1';

const at = (values, level) => values[Math.min(values.length-1, Math.max(0, level-1))];
const passive = (data, member, suffix) => passiveRules(data,member).find(x=>x.skill.id.endsWith(suffix))?.trio?.level ?? 0;
const living = (game,b) => game.party.map((member,i)=>member.hp>0&&!b.allies[i].statuses?.petrify?i:-1).filter(i=>i>=0);
const validMaterial = (data,id) => {
  const item=data.materials.get(id);
  return item && item.kind==='common' && ['fire','ice','thunder'].includes(item.element);
};
const healingItems = new Set(['potion','hi_potion','x_potion','elixir','grand_elixir']);
const reviveItems = new Set(['revive_salts','life_drop']);
export function trioItems(data,game,skill) {
  const kind=skill.effect?.rules?.trio_items;
  if(kind==='material')return Object.entries(game.storage?.materials??{}).filter(([id,n])=>n>0&&validMaterial(data,id))
    .map(([id,n])=>({id,name:data.materials.get(id).name,count:n}));
  const allowed=kind==='heal'?healingItems:kind==='revive'?reviveItems:null;
  return allowed?[...allowed].filter(id=>(game.items?.[id]??0)>0)
    .map(id=>({id,name:data.items.get(id)?.name??id,count:game.items[id]})):[];
}
export function initialTrio(data,game,b,actor) {
  const a=b.allies[actor],member=game.party[actor];
  if(a.trioInitialized)return;
  a.trioInitialized=true;
  a.medicine=passive(data,member,'apothecary_P02')?1:0;
  a.supply=0;
  a.reagents=[];
  a.machineDeploys=0;a.machineRepairs=0;
}
export function trioBlock(data,game,b,actor,skill) {
  if(!skill.effect?.rules?.trio)return '';
  initialTrio(data,game,b,actor);
  const a=b.allies[actor],id=skill.id;
  if(id==='apothecary_A08' && a.once.includes(id))return 'この戦闘ではもう使えない';
  const med=id.match(/^apothecary_(A02|A03|A04|A07)$/)?1:
    id.match(/^apothecary_(A08|A09)$/)?2:0;
  if(med && a.medicine<med)return '薬効が足りない';
  const n=id.match(/^alchemist_(A03|A09)$/)?2:
    id.match(/^alchemist_(A02|A05|A07|A08)$/)?1:0;
  if(n && (a.reagents?.length??0)<n)return '反応槽の印が足りない';
  if(['alchemist_A01','alchemist_A06'].includes(id) && a.reagents.length>=2)return '反応槽が満杯';
  if(id==='alchemist_A06' && a.once.includes(id))return 'この戦闘ではもう使えない';
  if(id==='alchemist_A06' && !trioItems(data,game,skill).length)return '使える実素材がない';
  if(id==='apothecary_A06' && !trioItems(data,game,skill).length)return '回復薬がない';
  if(id==='machinist_A01' && (a.machineDeploys??0)>=2)return 'この戦闘ではもう設置できない';
  if(id==='machinist_U01' && !a.machine && (a.machineDeploys??0)>=2)return 'この戦闘ではもう設置できない';
  const machine=id.match(/^machinist_(A02|A03|A04|A06|A07|A08|A09)$/);
  if(machine && !a.machine)return '装置がない';
  const fuel=id.match(/^machinist_(A02|A03|A08)$/)?1:id==='machinist_A06'?2:id==='machinist_A09'?1:0;
  if(fuel && a.machine?.fuel<fuel)return '装置の燃料が足りない';
  if(id==='machinist_A07' && (a.machineRepairs??0)>=2)return 'この戦闘ではもう整備できない';
  if(id==='machinist_A07' && a.machine?.fuel>=3 && a.machine?.hp>=a.machine?.maxHp)return '整備は不要';
  return '';
}
export function trioTargetBlock(data,game,b,actor,skill,target,action) {
  if(!skill.effect?.rules?.trio)return '';
  const id=skill.id,a=b.allies[actor],targetKind=skill.effect.rules.trio.targetKind;
  if(targetKind==='enemy' && !(b.enemies[target]?.hp>0))return '敵がいない';
  if(['ally','ko_ally'].includes(targetKind) && !game.party[target])return '味方を選んでください';
  if(targetKind==='ally' && (game.party[target].hp<=0||b.allies[target].statuses?.petrify))return '対象が行動できない';
  if(targetKind==='ko_ally' && (game.party[target].hp>0||b.allies[target].statuses?.petrify))return '戦闘不能の味方を選んでください';
  if(['apothecary_A06','alchemist_A06'].includes(id) &&
    !trioItems(data,game,skill).some(item=>item.id===action.itemId))return '使用する品を選んでください';
  if(id==='alchemist_A08' && a.reagents[0]?.element===action.element)return '別の属性を選んでください';
  if(id==='alchemist_A07' && !a.reagents.some(x=>x.element===action.element))return 'その属性の印がない';
  return '';
}
export function clearTrio(b,actor) {
  const a=b.allies[actor];
  for(const key of ['trioInitialized','medicine','medicineRefunded','supply','reagents','reagentRefunded','machine','machineDeploys','machineRepairs','machineFuelRefunded'])delete a[key];
}
export function finishTrioOpportunity(b,actor) {
  const a=b.allies[actor],clock=b.actionClock;
  a.reagents=a.reagents?.filter(x=>x.grantedClock===clock||--x.remaining>0)??[];
  if(a.machine && a.machine.grantedClock!==clock && --a.machine.remaining<=0)delete a.machine;
  if(a.machine?.overdrive && a.machine.overdrive.grantedClock!==clock && --a.machine.overdrive.remaining<=0)delete a.machine.overdrive;
}
export function runTrio(data,game,b,actor,skill,target,cm,action,ctx) {
  const id=skill.id,L=skill.effect.rules.trio.level,m=game.party[actor],a=b.allies[actor];
  const p=(suffix)=>passive(data,m,suffix);
  const heal=(t,power,cap=1)=>{
    const craft=['apothecary_A02','apothecary_A03','apothecary_A09'].includes(id);
    const low=craft&&p('apothecary_P03')&&game.party[t].hp<=maxHp(data,game.party[t])*.30?at([.10,.15,.20],p('apothecary_P03')):0;
    const guarded=p('apothecary_P05')&&Object.values(b.allies[t].masterEffects??{}).some(x=>x.source===actor&&x.statusResist)?at([.05,.08,.10],p('apothecary_P05')):0;
    return ctx.heal(t,power*(1+(craft&&p('apothecary_P01')?at([.08,.12,.16],p('apothecary_P01')):0)+low+guarded),cap);
  };
  const shield=(t,amount,key=id)=>ctx.shield(t,amount,key);
  const mark=(t,key,values,remaining=2,extra={})=>grantMasterEffect(b,t,key,{values,remaining,source:actor,skillId:id,grantedClock:b.actionClock,...extra});
  const cure=(t,ids,count)=>ctx.cure(t,ids,count);
  const hit=(t,power,element,base='mag',status=null,finalMultiplier=1)=>ctx.attack(t,power,element,base,status,finalMultiplier);
  const all=()=>b.enemies.map((enemy,i)=>enemy.hp>0?i:-1).filter(i=>i>=0);
  const allies=()=>living(game,b);
  const r=()=>Math.floor(10+.5*m.lv+ctx.stats().res);
  if(id.startsWith('apothecary_')){
    if(id==='apothecary_A01'){if(heal(target,at([.70,.85,1,1.15,1.30],L))>0)a.medicine=Math.min(3,a.medicine+1);}
    if(id==='apothecary_A02'||id==='apothecary_A03'){
      a.medicine--;
      const ids=id.endsWith('A02')?['poison','toxic','burn','bleed']:['sleep','paralysis','freeze','fear','silence','seal','blind','confusion'];
      cure(target,ids,id.endsWith('A02')?at([1,2,2],L):at([1,1,2],L));
      heal(target,id.endsWith('A02')?at([.30,.45,.60],L):at([.30,.40,.50],L));
    }
    if(id==='apothecary_A04'||id==='apothecary_U01'){
      const group=action.element,ids=[...data.statusEffects.values()].filter(s=>s.group===group).map(s=>s.id);
      const recipients=id.endsWith('U01')?allies():[target],rate=id.endsWith('U01')?.30:at([.30,.40,.50],L);
      if(id.endsWith('A04'))a.medicine--;
      for(const t of recipients)mark(t,id,{},2,{statusResist:{statuses:ids,rate}});
    }
    if(id==='apothecary_A05')hit(target,at([.80,.95,1.10,1.25,1.40],L),'pierce','weapon',['poison',at([.30,.33,.36,.39,.42],L)]);
    if(id==='apothecary_A06'){
      const it=data.items.get(action.itemId);game.items[it.id]--;if(game.items[it.id]<=0)delete game.items[it.id];
      ctx.healRaw(target,Number(it.value)*at([1.10,1.20,1.30],L)*cm,.5);
    }
    if(id==='apothecary_A07'){
      a.medicine--;mark(target,id,{},2,{regen:{amount:r()*at([.45,.60,.75],L)*cm*(1+(p('apothecary_P01')?at([.08,.12,.16],p('apothecary_P01')):0)),trigger:'end'}});
    }
    if(id==='apothecary_A08'){
      a.medicine-=2;a.once.push(id);if(p('apothecary_P04')&&!a.medicineRefunded){a.medicineRefunded=true;a.medicine++;}const recipient=game.party[target];
      recipient.hp=Math.max(1,Math.round(maxHp(data,recipient)*at([.20,.30,.40],L)*cm));
      ctx.log(`${recipient.name}が起き上がった`);
    }
    if(id==='apothecary_A09'){
      a.medicine-=2;heal(target,at([1,1.25,1.50],L));
      if(p('apothecary_P04')&&!a.medicineRefunded){a.medicineRefunded=true;a.medicine=Math.min(3,a.medicine+1);}
      cure(target,['poison','toxic','burn','bleed','sleep','paralysis','freeze','fear','silence','seal','blind','confusion'],2);
    }
    if(id==='apothecary_U01')for(const t of allies()){
      heal(t,.95);cure(t,['poison','toxic','burn','bleed','sleep','paralysis','freeze','fear','silence','seal','blind','confusion'],2);
    }
  }else if(id.startsWith('alchemist_')){
    const take=()=>a.reagents.shift(),place=(element,enhanced=false,remaining=at([2,2,3,3,4],L))=>
      a.reagents.push({element,enhanced,remaining:remaining+(p('alchemist_P01')?at([1,1,2],p('alchemist_P01')):0),grantedClock:b.actionClock});
    if(id==='alchemist_A01')place(action.element);
    if(id==='alchemist_A02'){const q=take();hit(target,at([1.15,1.30,1.45,1.60,1.75],L),q.element,'mag',null,q.enhanced?1+at([.08,.12,.16],q.level):1);}
    if(id==='alchemist_A03'){
      const x=take(),y=take(),key=[x.element,y.element].sort().join('+');
      const element=x.element===y.element?x.element:key==='fire+ice'?'water':[x.element,y.element];
      const st=key==='fire+ice'?['blind',.20]:key==='ice+thunder'?['freeze',.18]:key==='fire+thunder'?['burn',.25]:null;
      const enhance=Math.max(x.enhanced?at([.08,.12,.16],x.level):0,y.enhanced?at([.08,.12,.16],y.level):0);
      hit(target,at([1.45,1.75,2.05],L)+(x.element===y.element?.20:0),element,'mag',st,(1+enhance)*(1+(p('alchemist_P03')?at([.06,.09,.12],p('alchemist_P03')):0)));
      if(p('alchemist_P04')&&!a.reagentRefunded){a.reagentRefunded=true;a.reagents.push({element:y.element,enhanced:false,remaining:at([1,2,2],p('alchemist_P04')),grantedClock:b.actionClock});}
    }
    if(id==='alchemist_A04')for(const t of all())hit(t,at([.55,.70,.85],L),action.element);
    if(id==='alchemist_A05'){const x=take();hit(target,at([.75,.90,1.05],L),x.element,'mag',['petrify',Math.min(.95,at([.10,.13,.16],L)+(p('alchemist_P05')?at([.02,.03,.04],p('alchemist_P05')):0))],x.enhanced?1+at([.08,.12,.16],x.level):1);}
    if(id==='alchemist_A06'){
      const q=data.materials.get(action.itemId),bag=game.storage.materials;
      bag[q.id]--;if(bag[q.id]<=0)delete bag[q.id];
      place(q.element,true,2);a.reagents.at(-1).level=L;a.once.push(id);
    }
    if(id==='alchemist_A07'){
      const ix=a.reagents.findIndex(x=>x.element===action.element);a.reagents.splice(ix,1);
      ctx.putBuff(target,`eres:${action.element}`,at([.20,.25,.30],L)*cm,3);
    }
    if(id==='alchemist_A08'){
      const old=take();a.reagents.push({element:action.element,enhanced:false,remaining:old.remaining,grantedClock:old.grantedClock});
      m.mp=Math.min(maxMp(data,m),m.mp+Math.min(ctx.spentMp,at([2,3,4],L)));
    }
    if(id==='alchemist_A09'){
      const x=take(),y=take(),element=x.element===y.element?x.element:[x.element,y.element];
      const enhanced=Math.max(x.enhanced?at([.08,.12,.16],x.level):0,y.enhanced?at([.08,.12,.16],y.level):0);
      for(const t of all())hit(t,at([.90,1.10,1.30],L)+(x.element===y.element?.15:0),element,'mag',null,(1+enhanced)*(1+(p('alchemist_P03')?at([.06,.09,.12],p('alchemist_P03')):0)));
      if(p('alchemist_P04')&&!a.reagentRefunded){a.reagentRefunded=true;a.reagents.push({element:y.element,enhanced:false,remaining:at([1,2,2],p('alchemist_P04')),grantedClock:b.actionClock});}
    }
    if(id==='alchemist_U01'){
      const [mode,element]=(action.element??'attack:fire').split(':');
      if(mode==='attack')for(const t of all())hit(t,a.reagents.length>=2?2.05:1.70,element);
      else for(const t of allies()){shield(t,r()*.90);ctx.putBuff(t,`eres:${element}`,.25*cm,3);}
      a.reagents=[];
    }
  }else if(id.startsWith('machinist_')){
    const machine=()=>a.machine;
    const deploy=()=>{const extra=p('machinist_P01')?at([.05,.08,.10],p('machinist_P01')):0;
      const max=Math.max(1,Math.floor(maxHp(data,m)*(.25+extra)));
      a.machine={hp:max,maxHp:max,fuel:2,remaining:at([3,3,4,4,5],L),grantedClock:b.actionClock,mode:'attack'};
      a.machineDeploys++;};
    if(id==='machinist_A01')deploy();
    if(id==='machinist_A02'){
      machine().fuel--;const power=at([1.10,1.25,1.40,1.55,1.70],L)*(machine().mode==='attack'?1+(machine().modeBonus??0):1);
      hit(target,power,'blunt','weapon');
      delete machine().overdrive;
    }
    if(id==='machinist_A03'){machine().fuel--;machine().guard={target,remaining:1,placedClock:b.actionClock};}
    if(id==='machinist_A04'){machine().mode=action.element;machine().modeBonus=at([.08,.12,.16],L);}
    if(id==='machinist_A05'){hit(target,at([.90,1.05,1.20,1.35,1.50],L),null,'weapon');if(machine())machine().fuel=Math.min(3,machine().fuel+1);}
    if(id==='machinist_A06'){
      machine().fuel-=2;for(const t of all())hit(t,at([.75,.95,1.15],L)*(machine().mode==='attack'?1+(machine().modeBonus??0):1),'blunt','weapon');
      delete machine().overdrive;
      if(p('machinist_P03')&&!a.machineFuelRefunded){a.machineFuelRefunded=true;machine().fuel=Math.min(3,machine().fuel+1);}
    }
    if(id==='machinist_A07'){a.machineRepairs++;machine().fuel=Math.min(3,machine().fuel+1);machine().hp=Math.min(machine().maxHp,machine().hp+Math.floor(maxHp(data,m)*at([.10,.15,.20],L)));}
    if(id==='machinist_A08'){machine().fuel--;machine().overdrive={rate:at([.20,.25,.30],L),remaining:2,grantedClock:b.actionClock};}
    if(id==='machinist_A09'){
      const q=machine(),power=at([.90,1.15,1.40],L)+(q.fuel>=2?.20:0);for(const t of all())hit(t,power,'fire','weapon');
      delete a.machine;
    }
    if(id==='machinist_U01'){
      if(!machine())deploy();
      for(const t of all())hit(t,1.60,'blunt','weapon');
      for(const t of allies())shield(t,r()*.50);
      delete a.machine;
    }
  }
}
