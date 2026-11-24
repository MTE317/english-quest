import { readFileSync, writeFileSync } from 'node:fs';

const json = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));
const catalog = json('./build-design-catalog.json').builds;
const jobs = json('./build-design-jobs.json').jobs;
const effectDesign = json('./build-design-effects.json');
const {effects,budget} = effectDesign;
const seed = 613301;
const runs = 120;
function randFor(seed) {
  let n = seed >>> 0;
  return () => ((n = (Math.imul(n,1664525)+1013904223)>>>0)/4294967296);
}

// Six normalized actors, one action opportunity per actor per round.
// Same 4 active AP slots, 2 passive AP slots, one candidate replaces one neutral passive,
// 0 incremental JP, an equal weapon budget and identical random event tape per arm.
const contexts = {
  short:     {rounds:2,targets:1,status:.25,weak:.30,pressure:.25,enemyMp:.80,ward:.05,kills:.30},
  multi:     {rounds:4,targets:3,status:.60,weak:.35,pressure:.40,enemyMp:.60,ward:.10,kills:.42},
  boss:      {rounds:5,targets:1,status:.28,weak:.35,pressure:.58,enemyMp:.55,ward:.25,kills:0},
  resistant: {rounds:5,targets:1,status:.04,weak:.05,pressure:.60,enemyMp:.75,ward:.45,kills:0},
  attrition: {rounds:8,targets:2,status:.40,weak:.22,pressure:.70,enemyMp:.23,ward:.18,kills:.15},
  scouting:  {rounds:4,targets:2,status:.32,weak:.20,pressure:.28,enemyMp:.70,ward:.08,kills:.25},
};

// [trigger, channel, amount per proc, scope]; damage is in normalized 100-damage
// hits, protection in units of a 100-HP reference actor. MP is in model MP.
const rules = [
  ['statusKill','damage',.24],['multiStatus','damage',.18],['sleepDot','damage',.18],['status','damage',.21],
  ['disable','guard',.25],['seal','damage',.18],['lowEnemyMp','damage',.26],['curse','guard',.12],
  ['forced','mp',3],['forced','guard',.16],['doom','damage',.55,'battle'],['petrify','damage',.60,'battle'],
  ['spell','damage',.13],['lightUndead','damage',.23],['spell','mp',2],['fireArea','damage',.22],
  ['iceWard','mp',2],['spellCrit','mp',3],['opening','damage',.28,'battle'],['earth','guard',.10],
  ['water','mp',2],['weak','damage',.19],['knownWeak','mp',2],['weak','damage',.17],
  ['singleArmored','damage',.24],['multiCrit','mp',3],['evade','mp',3],['statusArea','damage',.23],
  ['enemyWard','damage',.27],['evade','damage',.24],['lowHp','damage',.26],['knownWeak','damage',.23],
  ['multi','damage',.22],['multiHit','damage',.12],['hit','guard',.14],['secondHit','damage',.22],
  ['secondHit','guard',.12],['evade','guard',.16],['magicHit','guard',.27],['matchingElement','guard',.24],
  ['cleanse','guard',.20],['normal','mp',2],['spell','guard',.15],['lowHp','guard',.19],
  ['allyCrit','damage',.24,'round'],['allyMulti','guard',.13,'round'],['allyOtherElement','damage',.18,'round'],
  ['allyWard','guard',.18,'round'],['allyCover','damage',.22,'round'],['allyStatus','damage',.22,'round'],
  ['allyWeakKnown','damage',.24,'round'],['allyHeal','damage',.20,'round'],['allyHit','mp',2,'round'],
  ['allyDown','guard',.34,'battle'],['charged','damage',.25],['delayed','damage',.23],
  ['trap','damage',.21],['mark','damage',.29],['allyOtherElement','mp',2,'round'],['allyHit','damage',.24,'round'],
  ['newInfo','info',1,'battle'],['loot','loot',.13,'battle'],['escape','guard',.25,'battle'],['victory','mp',4,'battle'],
];
const unsupported = {
  75:'反射の再入防止と反射先',93:'罠の配置・持越し',94:'刻印の持続・スタック消費',
  95:'領域の上書きと複数所有者',96:'自動追撃の連鎖と実行順',
  97:'図鑑・探索の永続化',98:'実物の盗品・レア報酬テーブル',
  99:'実際の逃走成功、失敗時進行、戦闘ごとの可否',100:'道具在庫・補給の経済と勝利確定順',
};
const makeTape = (name, sample) => {
  const c=contexts[name], rng=randFor(seed+sample*7919);
  return Array.from({length:c.rounds*6},(_,i)=>{
    const u=Array.from({length:14},()=>rng());
    const correct=u[0]<.8, damage=correct && u[1]<.72, spell=damage && u[2]<.55;
    const status=damage && u[3]<c.status, hit=u[4]<c.pressure, ward=u[5]<c.ward;
    const weak=damage && u[6]<c.weak, crit=damage && u[7]<.24, multiHit=damage && u[8]<.34;
    const multi=c.targets>1, kill=damage && u[9]<c.kills, lowHp=hit && i>=12 && u[10]<.46;
    const heal=correct && !damage && u[11]<c.pressure, evade=!hit && u[12]<c.pressure*.35;
    const word=['fireArea','iceWard','earth','water'][Math.min(3,Math.floor(u[13]*4))];
    return {i,actor:i%6,round:Math.floor(i/6),damage,spell,status,hit,ward,weak,crit,multiHit,kill,lowHp,heal,evade,
      triggers:{statusKill:status&&kill&&multi,multiStatus:status&&u[11]<c.status,sleepDot:status&&u[10]<.3,
        status,disable:status&&u[8]<.45,seal:status&&!spell&&u[10]<.35,lowEnemyMp:damage&&c.enemyMp<.3,
        curse:status&&u[12]<.45,forced:status&&u[13]<.4,doom:status&&u[10]<.45&&name!=='boss'&&name!=='resistant',
        petrify:status&&u[10]<.2&&name!=='boss'&&name!=='resistant',spell,lightUndead:spell&&name==='boss'&&u[13]<.5,
        [word]:spell&&(word!=='fireArea'||multi)&&(word!=='iceWard'||ward),spellCrit:spell&&crit,
        opening:damage&&i<6,weak,knownWeak:weak&&name!=='short',singleArmored:damage&&!multi&&name==='resistant',
        multiCrit:multiHit&&crit,evade,statusArea:status&&multi,enemyWard:damage&&ward,lowHp,
        multi:damage&&multi,multiHit,hit,secondHit:hit&&i>=6,magicHit:hit&&u[2]<.5,
        matchingElement:hit&&name==='boss'&&u[6]<.65,cleanse:heal&&u[3]<.55,normal:damage&&!spell,
        allyCrit:crit,allyMulti:multiHit,allyOtherElement:spell,allyWard:correct&&!damage&&ward,
        allyCover:hit&&u[12]<.28,allyStatus:status,allyWeakKnown:weak&&name!=='short',allyHeal:heal,allyHit:damage,
        allyDown:lowHp&&u[12]<.24,charged:damage&&i>=6&&u[13]<.25,delayed:spell&&i>=6&&u[13]<.35,
        trap:damage&&multi&&u[13]<.35,mark:spell&&i>=12,newInfo:name==='scouting'&&correct&&!damage,
        loot:kill&&name==='scouting',escape:lowHp&&name==='attrition',victory:i===c.rounds*6-1},
    };
  });
};
const tapes = Object.fromEntries(Object.keys(contexts).map(name=>[name,Array.from({length:runs},(_,i)=>makeTape(name,i))]));
const channels = ['damage','guard','mp','info','loot'];
const mechanical = build => {
  if (build.number>36) return rules[build.number-37];
  // Legacy IDs participate in the proxy party draft with a budget-neutral effect.
  // Their actual measured performance is supplied separately from engine output.
  return ['always','damage',0];
};
function simulate(team,tape,scale=1,listenerBudget=null){
  const delta=Object.fromEntries(channels.map(c=>[c,0]));
  const activations=Array(6).fill(0), unused=Array(6).fill(0);
  const marked=new Set(), limits=new Set(), queued=new Set();
  const roundListeners=new Map();
  let eventChecks=0, extraHits=0;
  const hooks=team.map(mechanical);
  for (const event of tape) {
    let rootListeners=0;
    for (const [actor,[trigger,channel,value,scope]] of hooks.entries()) {
      if (value===0) continue;
      const listener=trigger.startsWith('ally');
      const isTeamEvent=['victory','loot','escape'].includes(trigger);
      if (!isTeamEvent && (listener ? event.actor===actor : event.actor!==actor)) {
        if (queued.has(actor) && event.actor===actor && event.damage) {
          delta[channel]+=value*scale; queued.delete(actor); activations[actor]++;
          if (team[actor].number===96) extraHits++;
        }
        continue;
      }
      eventChecks++;
      if (!event.triggers[trigger]) continue;
      const roundKey=event.round+':'+actor;
      if ((scope==='round'&&limits.has(roundKey))||(scope==='battle'&&marked.has(actor))) {
        unused[actor]++; continue;
      }
      if(listener&&listenerBudget){
        const roundCount=roundListeners.get(event.round)??0;
        if(rootListeners>=listenerBudget.root||roundCount>=listenerBudget.round){
          unused[actor]++; continue;
        }
        rootListeners++;
        roundListeners.set(event.round,roundCount+1);
      }
      if (scope==='round') limits.add(roundKey);
      if (scope==='battle') marked.add(actor);
      if (listener && channel==='damage') { if (queued.has(actor)) unused[actor]++; queued.add(actor); continue; }
      delta[channel]+=value*scale;
      activations[actor]++;
    }
  }
  for(const actor of queued) unused[actor]++;
  return {delta,activations,unused,eventChecks,extraHits};
}
const zero = catalog.slice(0,6);
function averages(samples){
  const mid = key => samples.reduce((a,x)=>a+x[key],0)/samples.length;
  return { delta:Object.fromEntries(channels.map(c=>[c,samples.reduce((a,x)=>a+x.delta[c],0)/samples.length])),
    activations:mid('activations'), unused:mid('unused'), extraHits:mid('extraHits'), eventChecks:mid('eventChecks') };
}
function project(team,tape,scale,listenerBudget=null){
  const p=simulate(team,tape,scale,listenerBudget);
  return {...p,activations:p.activations.reduce((a,b)=>a+b,0),unused:p.unused.reduce((a,b)=>a+b,0)};
}
const buildRows = catalog.map(b=>{
  if (b.number<=36) return {id:b.id,no:b.number,status:'see_engine'};
  const model = mechanical(b), team=[b,...zero.slice(1)];
  return {id:b.id,no:b.number,status:'暫定モデル',designStatus:b.status,effects:b.effectRefs??b.newEffects,
    components:(b.existingParts??[]).map(x=>x.id), rule:model, pending:unsupported[b.number]??null,
    scenarios:Object.fromEntries(Object.entries(tapes).map(([k,rows])=>[k,[.5,1,1.5].map(scale=>({scale,...averages(rows.map(t=>project(team,t,scale)))}))]))};
});
const jobRows = jobs.map((j,index)=>{
  const candidateRows=j.builds.map(n=>buildRows[n-1]).filter(x=>x?.scenarios);
  return {id:j.id,no:index+1,role:j.role,tier:j.tier,status:j.status==='existing'?'see_engine':candidateRows.length?'暫定モデル':'未検証',
    buildNos:j.builds, linkedModelBuilds:candidateRows.map(x=>x.no),
    representative:Object.fromEntries(Object.keys(contexts).map(k=>[k,channels.map(channel=>{
      const options=candidateRows.filter(x=>x.rule[1]===channel).map(x=>[x.no,x.scenarios[k][1].delta[channel]]).sort((a,b)=>b[1]-a[1]);
      return [channel,options[0]??null];
    })]))};
});
const draft = randFor(seed^0x2fe21);
const samples = Array.from({length:600},()=>{
  const picks=new Set();
  while(picks.size<6)picks.add(catalog[Math.floor(draft()*catalog.length)]);
  return [...picks];
});
samples.push([81,82,83,84,85,86].map(n=>catalog[n-1]),[85,86,87,88,89,96].map(n=>catalog[n-1]),
  [37,38,39,40,42,44].map(n=>catalog[n-1]),[71,72,73,74,75,76].map(n=>catalog[n-1]),
  [47,48,93,97,98,99].map(n=>catalog[n-1]),zero);
const teams = samples.map(team=>({nos:team.map(b=>b.number), scenarios:Object.fromEntries(Object.entries(tapes).map(([k,rows])=>
  [k,averages(rows.map(t=>project(team,t,1)))]))}));
const budgetSensitivity=samples.slice(-6,-4).map(team=>({nos:team.map(b=>b.number),
  scenarios:Object.fromEntries(['boss','attrition'].map(k=>[k,[null,
    {root:budget.derivedPerRoot,round:budget.derivedPerPartyRound},
    {root:1,round:budget.derivedPerPartyRound}].map(limits=>({
      limits,...averages(tapes[k].map(t=>project(team,t,1,limits))),
    }))])),
}));
writeFileSync(process.argv[2]??'sim/results/four-priority-model.json',JSON.stringify({
  runs,seed,stride:7919,contexts,rulesStatus:'sensitivity projection; no win/time prediction; shared synthetic tapes',
  effects:effects.map(e=>({id:e.id,status:e.status,limits:e.limits,observation:
    ({E01:'typed opportunity',E02:'state availability',E03:'hit/crit/weak opportunity',E04:'received-hit/evade proxy',
      E05:'status probability',E06:'KO/kill opportunities',E07:'one listener opportunity per owner/round',
      E08:'simplified repeated-event eligibility',E09:'fixed per-proc exchange; actual stat conversion pending',
      E10:'additive delta only',E11:'protection as normalized HP; barrier state machine pending',
      E12:'single owner reservation, consumed on next eligible manual damage; ordering pending',
      E13:'revealed-scenario switch and isolated rewards; persistence pending',E14:'isolated post-battle resource delta; logistics pending'})[e.id]})),
  builds:buildRows,jobs:jobRows,teams,budgetSensitivity,
})+'\n');
console.log(JSON.stringify({builds:buildRows.length,jobs:jobRows.length,teams:teams.length,runs}));
