// 追加34〜36職の一時資源。保存対象は battle の JSON だけに置く。
import { passiveRules, grantMasterEffect } from './job-combat.js?v=jobs-34-36-1';
import { maxHp, maxMp } from './character.js?v=jobs-34-36-1';

const at=(values,level)=>values[Math.min(values.length-1,Math.max(0,level-1))];
const passive=(data,member,id)=>passiveRules(data,member).find(x=>x.skill.id===id)?.civic?.level??0;
const living=(game,b)=>game.party.flatMap((m,i)=>m.hp>0&&!b.allies[i].statuses?.petrify?[i]:[]);
const enemies=b=>b.enemies.flatMap((e,i)=>e.hp>0?[i]:[]);
const healingIds=['potion','hi_potion','x_potion','elixir','grand_elixir'];
const reviveIds=['revive_salts','life_drop'];
const mark=(b,enemy,owner)=>b.enemies[enemy]?.civicMarks?.[owner];
const ownerEffects=(b,target,owner)=>Object.values(b.allies[target].masterEffects??{}).some(e=>e.source===owner&&e.shield>0&&e.skillId?.startsWith('merchant_'));

export function civicItems(data,game,skill){
  const ids=skill.effect?.rules?.civic_items==='heal'?healingIds:skill.effect?.rules?.civic_items==='revive'?reviveIds:[];
  return ids.filter(id=>(game.items?.[id]??0)>0&&data.items.has(id)).map(id=>({id,name:data.items.get(id).name,count:game.items[id]}));
}
export function initCivic(data,game,b,actor){
  const a=b.allies[actor];if(a.civicInitialized)return;
  a.civicInitialized=true;a.supply=passive(data,game.party[actor],'merchant_P02')?1:0;
  a.supplyGained=0;a.dishPrepared=0;a.relicMpGains=0;a.relicHitEnemies=[];
}
export function civicBlock(data,game,b,actor,skill){
  if(!skill.effect?.rules?.civic)return '';
  initCivic(data,game,b,actor);
  const a=b.allies[actor],id=skill.id,dish=a.dish,relic=a.relic;
  const supply=id==='merchant_A09'?3:/^merchant_A0[2346]$/.test(id)?1:0;
  if(supply && a.supply<supply)return '補給札が足りない';
  if(id==='cook_A01'&&a.dishPrepared>=2)return 'この戦闘ではもう仕込めない';
  if(['cook_A03','cook_A04','cook_A05','cook_A07','cook_A08','cook_A09'].includes(id)&&(!dish||dish.preparing||dish.portions<(id==='cook_A08'?2:1)))return '完成した皿の取り分が足りない';
  if(id==='cook_A06'&&(!dish||dish.portions<1))return '仕立て直す皿がない';
  if((id==='cook_A03'&&dish?.taste!=='meat')||(id==='cook_A04'||id==='cook_A07')&&dish?.taste!=='vegetable'||id==='cook_A05'&&dish?.taste!=='soup')return '皿の味が違う';
  const energy=id==='archaeologist_A09'?2:/^archaeologist_A0[34]$/.test(id)?1:0;
  if(energy && (!relic||relic.energy<energy))return '遺物のエネルギーが足りない';
  if(id==='archaeologist_A03'&&relic?.mode!=='attack'||id==='archaeologist_A04'&&relic?.mode!=='guard')return '遺物の型が違う';
  if(id==='archaeologist_A06'&&!relic)return '遺物がない';
  if(['merchant_A05','merchant_A08'].includes(id)&&!civicItems(data,game,skill).length)return '使える品物がない';
  return '';
}
export function civicTargetBlock(data,game,b,actor,skill,target,action){
  if(!skill.effect?.rules?.civic)return '';
  const id=skill.id,kind=skill.effect.rules.civic.targetKind;
  if(kind==='enemy'&&!(b.enemies[target]?.hp>0))return '敵がいない';
  if(kind==='enemies'&&!enemies(b).length)return '敵がいない';
  if(['ally','ko_ally'].includes(kind)&&!game.party[target])return '味方を選んでください';
  if(kind==='ally'&&(game.party[target].hp<=0||b.allies[target].statuses?.petrify))return '対象が行動できない';
  if(kind==='ko_ally'&&(game.party[target].hp>0||b.allies[target].statuses?.petrify))return '戦闘不能の味方を選んでください';
  if(id==='merchant_A03'&&(target===actor||game.party[target].mp>=maxMp(data,game.party[target])))return 'MPを渡せる味方がいない';
  if(skill.effect.rules.civic_items&&!civicItems(data,game,skill).some(item=>item.id===action.itemId))return '使用する品を選んでください';
  if(['archaeologist_A05','archaeologist_A08'].includes(id)&&!mark(b,target,actor))return '鑑定印がない';
  if(id==='archaeologist_A08'&&(!game.party[action.sourceTarget]||game.party[action.sourceTarget].hp<=0||b.allies[action.sourceTarget].statuses?.petrify))return '強化する味方を選んでください';
  if(id==='cook_A06'&&action.element===b.allies[actor].dish?.taste)return '別の味を選んでください';
  return '';
}
export function clearCivic(b,actor){
  const a=b.allies[actor];
  for(const key of ['civicInitialized','supply','supplyGained','supplyRefunded','dish','dishPrepared','dishRefunded','relic','relicRefunded','relicMpGains','relicHitEnemies','civicTransfer'])delete a[key];
  for(const enemy of b.enemies){if(enemy.civicMarks)delete enemy.civicMarks[actor];if(enemy.civicDebuffs)delete enemy.civicDebuffs[actor];}
  for(const ally of b.allies)if(ally.civicTransfer?.owner===actor)delete ally.civicTransfer;
}
export function finishCivicOpportunity(data,game,b,actor){
  const a=b.allies[actor],clock=b.actionClock;
  if(a.dish&&a.dish.grantedClock!==clock){
    if(a.dish.preparing){
      a.dish.preparing=false;a.dish.grantedClock=clock;
      const level=passive(data,game.party[actor],'cook_P04');
      if(level&&!a.dishRefunded){a.dishRefunded=true;game.party[actor].mp=Math.min(maxMp(data,game.party[actor]),game.party[actor].mp+Math.min(a.dish.mpPaid,at([2,3,4],level)));}
    }else if(--a.dish.remaining<=0)delete a.dish;
  }
  if(a.relic&&a.relic.grantedClock!==clock&&--a.relic.remaining<=0)delete a.relic;
  if(a.civicTransfer&&a.civicTransfer.grantedClock!==clock&&--a.civicTransfer.remaining<=0)delete a.civicTransfer;
  for(const enemy of b.enemies){const found=enemy.civicMarks?.[actor];if(found&&found.grantedClock!==clock&&--found.remaining<=0)delete enemy.civicMarks[actor];}
}
export function finishCivicEnemy(b,index){
  const enemy=b.enemies[index];for(const [key,effect] of Object.entries(enemy?.civicDebuffs??{}))if(--effect.remaining<=0)delete enemy.civicDebuffs[key];
}
export function civicIncomingCut(data,game,b,target,enemy){
  let rate=0;const source=b.enemies[enemy];
  for(const effect of Object.values(source?.civicDebuffs??{}))rate+=effect.rate;
  const ownMark=mark(b,enemy,target),p04=passive(data,game.party[target],'archaeologist_P04');
  if(ownMark&&p04)rate+=at([.04,.06,.08],p04);
  for(let owner=0;owner<game.party.length;owner++){
    const level=passive(data,game.party[owner],'merchant_P05');
    if(level&&game.party[owner].hp>0&&ownerEffects(b,target,owner))rate+=at([.03,.05,.07],level);
  }
  return rate;
}
export function civicAttackBonus(data,game,b,actor,target,skill){
  let bonus=0;const a=b.allies[actor],id=skill?.id;
  if(id==='archaeologist_A03'&&mark(b,target,actor))bonus+=.10;
  if(id==='archaeologist_U01'&&mark(b,target,actor))bonus+=.15;
  const transfer=a.civicTransfer;
  if(transfer?.enemy===target&&transfer.grantedClock!==b.actionClock){bonus+=transfer.rate;delete a.civicTransfer;}
  return bonus;
}
export function civicOnHit(data,game,b,actor,target,primary){
  if(!primary||!mark(b,target,actor))return;
  const a=b.allies[actor],level=passive(data,game.party[actor],'archaeologist_P05');
  if(!level||a.relicMpGains>=2||a.relicHitEnemies.includes(target))return;
  a.relicHitEnemies.push(target);a.relicMpGains++;
  game.party[actor].mp=Math.min(maxMp(data,game.party[actor]),game.party[actor].mp+at([2,3,4],level));
}

export function runCivic(data,game,b,actor,skill,target,cm,action,ctx){
  const id=skill.id,L=skill.effect.rules.civic.level,m=game.party[actor],a=b.allies[actor];
  // 他職へ技能を継承した場合も、技能所有者ではなく装着中パッシブを参照する。
  const passiveLevel=suffix=>passive(data,m,`${id.split('_')[0]}_${suffix}`);
  const all=()=>living(game,b),foes=()=>enemies(b);
  const R=()=>Math.floor(10+.5*m.lv+ctx.stats().res);
  const markEffect=(t,key,values,extra={})=>grantMasterEffect(b,t,key,{values,source:actor,skillId:id,remaining:2,grantedClock:b.actionClock,...extra});
  const shield=(t,amount,supply=false)=>ctx.shield(t,amount*(supply&&passiveLevel('P01')?1+at([.05,.08,.10],passiveLevel('P01')):1),id);
  const heal=(t,power,supply=false)=>ctx.heal(t,power*(supply&&passiveLevel('P01')?1+at([.05,.08,.10],passiveLevel('P01')):1));
  const spendItem=()=>{const item=data.items.get(action.itemId);game.items[item.id]--;if(!game.items[item.id])delete game.items[item.id];return item;};
  const attack=(t,power,element,base='mag',bonus=1)=>ctx.attack(t,power,element,base,null,bonus);

  if(id.startsWith('merchant_')){
    const supplyCost=id==='merchant_A09'?3:/^merchant_A0[2346]$/.test(id)?1:0;
    if(supplyCost){a.supply-=supplyCost;if(supplyCost>=2&&passiveLevel('P04')&&!a.supplyRefunded){a.supplyRefunded=true;a.supply=Math.min(3,a.supply+1);}}
    if(id==='merchant_A01'){if(a.supplyGained<3){a.supply=Math.min(3,a.supply+1);a.supplyGained++;}shield(target,R()*at([.40,.50,.60,.70,.80],L));}
    if(id==='merchant_A02')heal(target,at([.45,.55,.65,.75,.85],L),true);
    if(id==='merchant_A03')game.party[target].mp=Math.min(maxMp(data,game.party[target]),game.party[target].mp+at([4,6,8],L)+(passiveLevel('P03')?at([1,2,3],passiveLevel('P03')):0));
    if(id==='merchant_A04')shield(target,R()*at([.80,1,1.20],L),true);
    if(id==='merchant_A05'){const item=spendItem();ctx.healRaw(target,Number(item.value)*(1+at([.05,.08,.10],L))*cm,.5);}
    if(id==='merchant_A06')markEffect(target,id,{def:at([.06,.09,.12],L)*cm,res:at([.06,.09,.12],L)*cm});
    if(id==='merchant_A07'){attack(target,at([.85,1,1.15,1.30,1.45],L),null,'weapon');if(b.enemies[target]?.statuses?.taunt?.actor===actor)markEffect(actor,id,{cut:.05},{remaining:1});}
    if(id==='merchant_A08'){const item=spendItem();game.party[target].hp=Math.max(1,Math.round(maxHp(data,game.party[target])*Number(item.value)/100*cm));shield(target,R()*at([.30,.45,.60],L));}
    if(id==='merchant_A09')for(const t of all()){game.party[t].mp=Math.min(maxMp(data,game.party[t]),game.party[t].mp+at([4,6,8],L));heal(t,at([.20,.30,.40],L),true);}
    if(id==='merchant_U01')for(const t of all()){heal(t,.55);game.party[t].mp=Math.min(maxMp(data,game.party[t]),game.party[t].mp+6);shield(t,R()*.45);}
  }else if(id.startsWith('cook_')){
    const dish=a.dish,portion=()=>{dish.portions--;if(!dish.portions)delete a.dish;};
    const afterMeal=(t,healed)=>{const level=passiveLevel('P03');if(level&&healed>0)markEffect(t,'cook_P03',{cut:at([.03,.05,.07],level)*cm},{remaining:1});};
    if(id==='cook_A01'){a.dish={taste:action.element,portions:passiveLevel('P01')?4:3,preparing:true,remaining:at([3,3,4,4,5],L),grantedClock:b.actionClock,mpPaid:ctx.spentMp};a.dishPrepared++;}
    if(id==='cook_A02'){
      const consumed=dish&&!dish.preparing&&dish.portions>0;
      const p01=passiveLevel('P01'),p05=passiveLevel('P05');
      const dishExtra=.20+(p01?at([.05,.08,.10],p01):0)+(p05?at([.05,.08,.10],p05):0);
      const extra=consumed?(p05?Math.min(at([.25,.28,.30],p05),dishExtra):dishExtra):(p05?at([.05,.08,.10],p05):0);
      if(consumed)portion();afterMeal(target,heal(target,at([.40,.50,.60,.70,.80],L)*(1+extra))*(consumed?1:0));
    }
    if(id==='cook_A03'){portion();markEffect(target,id,{str:at([.08,.11,.14],L)*cm});afterMeal(target,heal(target,at([.25,.35,.45],L)));}
    if(id==='cook_A04'){portion();markEffect(target,id,{def:at([.06,.09,.12],L)*cm,res:at([.06,.09,.12],L)*cm});ctx.cure(target,['poison','toxic'],1);}
    if(id==='cook_A05'){portion();afterMeal(target,heal(target,at([.50,.65,.80],L)));game.party[target].mp=Math.min(maxMp(data,game.party[target]),game.party[target].mp+at([2,3,4],L));}
    if(id==='cook_A06'){dish.taste=action.element;portion();heal(actor,at([.20,.30,.40],L));}
    if(id==='cook_A07'){portion();const statuses=[...data.statusEffects.values()].filter(s=>s.group==='継続ダメージ').map(s=>s.id);markEffect(target,id,{}, {statusResist:{statuses,rate:at([.30,.40,.50],L)}});}
    if(id==='cook_A08'){
      const taste=dish.taste;dish.portions-=2;if(!dish.portions)delete a.dish;
      for(const t of all()){
        afterMeal(t,heal(t,at([.30,.40,.50],L)));
        if(taste==='meat')markEffect(t,id,{str:.05*cm});
        if(taste==='vegetable')markEffect(t,id,{def:.05*cm,res:.05*cm});
        if(taste==='soup')game.party[t].mp=Math.min(maxMp(data,game.party[t]),game.party[t].mp+2);
      }
    }
    if(id==='cook_A09'){const power=at([.25,.35,.45],L)*dish.portions;delete a.dish;for(const t of foes())attack(t,power,'fire');}
    if(id==='cook_U01'){
      if(dish)delete a.dish;
      for(const t of all()){heal(t,.80);markEffect(t,id,{str:.08*cm,def:.08*cm,res:.08*cm});}
    }
  }else if(id.startsWith('archaeologist_')){
    const relic=a.relic;
    if(id==='archaeologist_A01'){
      const enemy=b.enemies[target],order=['slash','blunt','pierce','none','fire','ice','wind','earth','thunder','water','light','dark'];
      const best=order.reduce((current,el)=>ctx.elementMultiplier(enemy,el)>ctx.elementMultiplier(enemy,current)?el:current,order[0]);
      (enemy.civicMarks??={})[actor]={remaining:at([2,2,3,3,3],L)+(passiveLevel('P01')?at([1,1,2],passiveLevel('P01')):0),grantedClock:b.actionClock,element:best,types:[...enemy.types]};
      ctx.log(`${enemy.name}の種族：${enemy.types.map(t=>data.monsterTypes.get(t)?.name??t).join('・')}／${ctx.elementMultiplier(enemy,best)>1?`弱点：${ctx.elementName(best)}`:'確認できた弱点なし'}（最有効：${ctx.elementName(best)}）`);
    }
    if(id==='archaeologist_A02')a.relic={mode:action.element,energy:2,remaining:at([2,3,4],L),grantedClock:b.actionClock};
    if(id==='archaeologist_A03'){relic.energy--;attack(target,at([1.05,1.20,1.35,1.50,1.65],L),'light');}
    if(id==='archaeologist_A04'){relic.energy--;shield(target,R()*at([.80,1.05,1.30],L));}
    if(id==='archaeologist_A05'){
      const debuffs=b.enemies[target].civicDebuffs??={};const old=debuffs[actor],rate=at([.08,.11,.14],L);
      if(!old||rate>=old.rate)debuffs[actor]={rate:Math.max(rate,old?.rate??0),remaining:Math.max(2,old?.remaining??0)};
    }
    if(id==='archaeologist_A06'){relic.mode=relic.mode==='attack'?'guard':'attack';m.mp=Math.min(maxMp(data,m),m.mp+Math.min(ctx.spentMp,at([2,3,4],L)));}
    if(id==='archaeologist_A07')attack(target,at([.85,1,1.15,1.30,1.45],L)+(mark(b,target,actor)?.20:0),'earth');
    if(id==='archaeologist_A08'){
      const t=action.sourceTarget,old=b.allies[t].civicTransfer,rate=at([.08,.12,.16],L);
      if(!old||rate>=old.rate)b.allies[t].civicTransfer={owner:actor,enemy:target,rate,remaining:2,grantedClock:b.actionClock};
    }
    if(id==='archaeologist_A09'){
      relic.energy-=2;if(relic.mode==='attack')for(const t of foes())attack(t,at([.85,1.05,1.25],L),'light');
      else for(const t of all())shield(t,R()*at([.50,.65,.80],L));
      if(passiveLevel('P03')&&!a.relicRefunded&&a.relic){a.relicRefunded=true;relic.energy++;}
    }
    if(id==='archaeologist_U01'){
      for(const t of foes())attack(t,1.40,['earth','light']);
      for(const t of all())shield(t,R()*.55);
      delete a.relic;
    }
  }
}
