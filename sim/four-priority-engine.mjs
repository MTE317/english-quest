import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { loadData, prepareParty, prepareNextBattle, chooseAction, rngFor, sourceFingerprint } from './balance.mjs';
import { BUILD_CATALOG, PROFILES } from './party-fixtures.mjs';
import { maxHp, maxMp, gainXp } from '../game/js/character.js';
import { actionOptions, createBattle, nextTurn, prepareQuizAction, setPending, resolvePending,
  finishBattle, battleRewards, makeEnemy, collectBattleHits, elementMul } from '../game/js/battle.js';
import { makeEncounter } from '../game/js/encounter.js';
import { recoverAfterBattle } from '../game/js/dungeon.js';

const read = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const data = loadData();
const jobs = read('./build-design-jobs.json').jobs;
const builds = read('./build-design-catalog.json').builds;
const trials = Number(process.argv[2] ?? 100);
const seed = Number(process.argv[3] ?? 613301);
const mode = process.argv[5] ?? 'all';
if (!Number.isInteger(trials) || trials < 1 || !Number.isInteger(seed)) throw Error('usage: [trials] [seed] [output]');
const fingerprint = sourceFingerprint();
const dungeons = [...data.dungeons.values()];
const monsters = [...data.monsters.values()];
const dungeon = (rank, kind = '標準') => dungeons.find(d => d.rank === rank && d.kind === kind);
const sum = xs => xs.reduce((a, b) => a + b, 0);
const count = (xs, key) => Object.fromEntries([...new Set(xs.map(key))].map(k => [k, xs.filter(x => key(x) === k).length]));
const hp = game => sum(game.party.map(m => m.hp));
const mp = game => sum(game.party.map(m => m.mp));
const cache = new Map();
function fixture(dg, profile = 'balanced6', prep = 'standard') {
  const key = [dg.id, profile, prep].join(':');
  if (!cache.has(key)) cache.set(key, prepareParty(data, dg, profile, prep));
  return cache.get(key);
}
function setup(dg, profile, prep, whole) {
  if (profile === 'balanced6' || whole) {
    if (prep === 'standard' || prep === 'prepared') return fixture(dg, profile, prep);
    const game = structuredClone(fixture(dg, profile, 'prepared'));
    const allow = prep === 'weak' ? /^(ELEMENT|TYPE_BONUS):/ : /^(STATUS_RES|ELEM_RES:|PHYS_CUT|EVA)/;
    for (const [i, m] of game.party.entries()) {
      const baseline = fixture(dg, profile).party[i];
      for (const [slot, gear] of Object.entries(m.equip)) {
        if (!gear) continue;
        gear.enchants = [...(baseline.equip[slot]?.enchants ?? []), ...(gear.enchants ?? []).filter(e => allow.test(e.stat))];
      }
      m.hp = maxHp(data, m);
      m.mp = maxMp(data, m);
    }
    return game;
  }
  const game = structuredClone(fixture(dg, 'balanced6'));
  const donor = fixture(dg, profile, prep);
  game.party[0] = { ...structuredClone(donor.party[0]), id: game.party[0].id };
  game.unlockedJobs = [...new Set([...game.unlockedJobs, ...donor.unlockedJobs])];
  game.nextUid = Math.max(game.nextUid, donor.nextUid);
  game.simulationFixture = { profile, preparation: prep, level: donor.simulationFixture.level,
    stage: donor.simulationFixture.stage, commonParty: fixture(dg).simulationFixture.assembly,
    donorFixtureCostAllMembers: donor.simulationFixture.assembly,
    core: donor.simulationFixture.core,
    gear: donor.simulationFixture.gear.filter(x => x.member === 0),
    equipmentAffixes: Object.fromEntries(Object.entries(game.party[0].equip).filter(([, v]) => v).map(([k,v]) => [k,{ enchants:v.enchants, affixes:v.affixes }])),
    loadout: game.party[0].loadout,
    primaryJobChangeJp: data.jobsById.get(game.party[0].job).changeJp ?? 0,
    primaryLoadoutCost: Object.fromEntries(Object.entries(game.party[0].loadout).map(([k,ids]) => [k,sum(ids.map(id => data.skills.get(id)?.cost ?? 0))])) };
  return game;
}
function fight(game, enemies, battleSeed, accuracy, firstBattle, policy) {
  for (const member of game.party) member.priorityStaticLoadout = true;
  const start = performance.now();
  const startedCpu = process.cpuUsage();
  const initialHp = hp(game), initialMp = mp(game);
  const b = createBattle(data, game, { enemies, seed: battleSeed, firstBattle, canFlee: false });
  const answer = rngFor(battleSeed ^ 0x5f3759df);
  const m = { questions: 0, correct: 0, rounds: 0, hits: 0, betweenQuestionHits: 0, sameResolutionExtraHits: 0,
    damageTaken: 0, hpNet: 0, mpNet: 0, mpSpent: 0, statusesEnemy: 0, statusesAlly: 0, buffs: 0, weaknessHits: 0,
    deadAllies: 0, primaryDamage: 0, primaryManual: 0, primarySupport: 0, combatMs: 0, cpuMs: 0 };
  const skills = {}, statusIds = {}, statusAttempts = {}, primarySkills = {};
  const units = [...b.allies, ...b.enemies];
  const prev = units.map(() => new Set());
  let prevBuff = new Map();
  const isSupport = id => /heal|buff|clean|cure|barrier|protect|guard|revive|transfer/i.test(data.skills.get(id)?.kind ?? '');
  function advance(fn, automatic) {
    const hits = collectBattleHits(b, fn);
    m.hits += hits.length;
    if (automatic) m.betweenQuestionHits += hits.length;
    else m.sameResolutionExtraHits += Math.max(0, hits.length - 1);
    for (const h of hits) {
      if (h.target.side === 'ally') m.damageTaken += h.damage;
      if (h.target.side === 'enemy' && h.source?.side === 'ally' && h.source.i === 0) m.primaryDamage += h.damage;
      if (h.effectiveness === 'weak' || h.effectiveness === 'strong_weak') m.weaknessHits++;
    }
    for (const [i, u] of units.entries()) {
      const active = new Set(Object.keys(u.statuses));
      for (const id of active) if (!prev[i].has(id)) {
        if (i >= b.allies.length) m.statusesEnemy++;
        else m.statusesAlly++;
        const key = (i >= b.allies.length ? 'enemy:' : 'ally:') + id;
        statusIds[key] = (statusIds[key] ?? 0) + 1;
      }
      prev[i] = active;
    }
    const buffs = new Map([b.partyBuffs, ...b.allies.map(x => x.buffs), ...b.enemies.map(x => x.buffs ?? {})]
      .flatMap((group, i) => Object.entries(group).map(([key, value]) => [i + ':' + key, value])));
    for (const [key, value] of buffs) if (!prevBuff.has(key) || prevBuff.get(key) !== value) m.buffs++;
    prevBuff = buffs;
  }
  while (m.questions < 400) {
    let turn;
    advance(() => { turn = nextTurn(data, game, b); }, true);
    if (!turn) break;
    const options = actionOptions(data, game, b, b.turn.i);
    if (policy) policy(b, options);
    const action = chooseAction(data, game, b, options);
    let manual;
    advance(() => { manual = prepareQuizAction(data, game, b); }, true);
    if (!manual) continue;
    const i = b.turn.i, actor = game.party[i], beforeMp = actor.mp;
    if (action.skillId) {
      skills[action.skillId] = (skills[action.skillId] ?? 0) + 1;
      if (!i) primarySkills[action.skillId] = (primarySkills[action.skillId] ?? 0) + 1;
    }
    if (!i) {
      m.primaryManual++;
      if (isSupport(action.skillId)) m.primarySupport++;
    }
    const correct = answer() < accuracy;
    const skill = data.skills.get(action.skillId);
    if (correct && skill?.effect?.st) {
      const key = data.statusByName.get(skill.effect.st[0])?.id ?? skill.id;
      statusAttempts[key] = (statusAttempts[key] ?? 0) + 1;
    }
    setPending(b, action, { wordId: 'simulation' });
    advance(() => resolvePending(data, game, b, correct), false);
    m.mpSpent += Math.max(0, beforeMp - actor.mp);
    m.questions++;
    m.correct += Number(correct);
  }
  m.rounds = b.round;
  m.hpNet = initialHp - hp(game);
  m.mpNet = initialMp - mp(game);
  m.deadAllies = game.party.filter(m => m.hp <= 0).length;
  m.combatMs = performance.now() - start;
  const cpu = process.cpuUsage(startedCpu);
  m.cpuMs = (cpu.user + cpu.system) / 1000;
  if (b.result === 'win') finishBattle(data, game, b);
  return { win: b.result === 'win', result: b.result ?? 'cap', m, skills, statusIds, statusAttempts, primarySkills, battle: b };
}
const wilson = (wins, n) => {
  const z = 1.95996398454, p = wins / n, den = 1 + z*z/n;
  const mid = (p + z*z/(2*n)) / den, half = z * Math.sqrt((p*(1-p)+z*z/(4*n))/n) / den;
  return [Math.max(0,mid-half), Math.min(1,mid+half)];
};
const latency = (m, seconds, audio) => 30 + m.questions * (seconds + .6 + audio) + m.hits * .15;
const combine = (a, b) => { for (const [k,v] of Object.entries(b)) a[k] = (a[k] ?? 0) + v; return a; };
function describe(rows) {
  if (!rows.length) return null;
  return Object.fromEntries(Object.keys(rows[0]).map(k => {
    const values = rows.map(r => r[k]).sort((a,b) => a-b);
    return [k, { mean: sum(values)/values.length, p10: values[Math.floor((values.length-1)*.1)], p90: values[Math.floor((values.length-1)*.9)] }];
  }));
}
function summarize(samples) {
  const wins = samples.filter(s => s.win);
  return { n: samples.length, wins: wins.length, winCI95: wilson(wins.length,samples.length),
    outcomes: count(samples,s=>s.result), all: describe(samples.map(s=>s.m)), clear: describe(wins.map(s=>s.m)),
    skills: samples.reduce((a,s)=>combine(a,s.skills),{}),
    primarySkills: samples.reduce((a,s)=>combine(a,s.primarySkills),{}),
    statuses: samples.reduce((a,s)=>combine(a,s.statusIds),{}),
    statusActionQuestionsCorrect: samples.reduce((a,s)=>combine(a,s.statusAttempts),{}),
    paired: samples.map(s=>[Number(s.win),s.m.questions,s.m.damageTaken,s.m.mpNet]),
  };
}
function stages(dg, game, trialSeed, accuracy, policy) {
  const route = data.dungeonFloors.filter(r=>r.dungeonId === dg.id);
  const rng = rngFor(trialSeed);
  const results = [];
  const add = (r, boss) => results.push({ ...r, boss });
  for (const row of route) for (let i=0; i<row.battles; i++) {
    if (results.length) prepareNextBattle(data, game);
    const boss = row.lastBattleIsBoss && i === row.battles-1;
    const enemies = makeEncounter(data,dg.id,row.floor,rng,{ boss, season:'spring', elites:false });
    const r = fight(game,enemies,trialSeed * 1009 + row.floor*37 + i,accuracy,!results.length,policy);
    add(r,boss);
    if (!r.win) return results;
    const rewards = battleRewards(data,game,r.battle);
    for (const [j, member] of game.party.entries()) {
      gainXp(data,member,rewards.xp[j]);
      member.ap[member.job] = (member.ap[member.job] ?? 0) + rewards.ap[j];
    }
    recoverAfterBattle(data,game);
  }
  return results;
}
function expedition(dg, game, trialSeed, accuracy, policy) {
  const initialHp = hp(game), initialMp = mp(game);
  const battles = stages(dg,game,trialSeed,accuracy,policy);
  const last = battles.at(-1);
  const out = battleSum(battles);
  const victory = last.win && last.boss;
  const m = out.m;
  Object.assign(m,{ battles:battles.length, finalHp:hp(game),finalMp:mp(game), expeditionHpNet:initialHp-hp(game),
    expeditionMpNet:initialMp-mp(game), legacySeconds:30+6*m.questions });
  for (const s of [3,6,10]) for (const audio of [0,1.2]) m['seconds_'+s+'_audio_'+audio] = latency(m,s,audio);
  return {...out,win:victory,result:victory?'win':last.result, battles};
}
function battleSum(battles) {
  return Object.fromEntries(['m','skills','primarySkills','statusIds','statusAttempts'].map(k=>[k,battles.reduce((a,r)=>combine(a,r[k]),{})]));
}

const matrix = [], swaps = [], teams = [], encounters = [];
function evaluate(target, key, template, simulate) {
  if (template.party.length !== 6) throw Error('expected 6 players');
  const samples = Array.from({length:trials},(_,i)=>simulate(structuredClone(template), seed+i*7919));
  const result = { ...key, jobs:template.party.map(p=>p.job), fixture:template.simulationFixture, ...summarize(samples) };
  if (samples[0].battles) {
    result.normal = summarize(samples.flatMap(x=>x.battles.filter(b=>!b.boss)));
    const boss = samples.flatMap(x=>x.battles.filter(b=>b.boss));
    result.boss = boss.length ? summarize(boss) : null;
    delete result.normal.paired;
    if (result.boss) delete result.boss.paired;
  }
  target.push(result);
}
const checked = (build, callback) => {
  try { callback(); } catch (e) { failures.push({ id:build.id, message:e.message }); }
};
const failures = [];
function audit() {
  const invalid = [];
  const clashes = [];
  const repeatedReplacement = [];
  const removedOutsidePool = [];
  const legacyStatusUses = monsters.filter(m=>m.status==='statdown').length;
  for (const m of monsters) {
    const replacements = (m.replaces ?? '').split('|').filter(Boolean);
    for (const [key, ids, known] of [
      ['types',m.types,data.monsterTypes],['elements',[...m.weak,...m.strongWeak,...m.resist,...m.immune,m.attackElement].filter(Boolean),data.elements],
      ['statuses',[...Object.keys(m.statusAffinity),m.status==='statdown'?null:m.status].filter(Boolean),data.statusEffects],
      ['placement',m.dungeons,data.dungeons],['replaces',replacements,data.monsters],
    ]) for (const id of ids) if (!known.has(id)) invalid.push({ monster:m.id,key,id });
    for (const [id,tier] of Object.entries(m.statusAffinity)) if (!['★','◎','〇','△','×'].includes(tier)) invalid.push({monster:m.id,key:'statusTier',id,tier});
    const affinities = [...new Set([...m.weak,...m.strongWeak,...m.resist,...m.immune])];
    for (const id of affinities) {
      const tiers = ['weak','strongWeak','resist','immune'].filter(k=>m[k].includes(id));
      if (tiers.length>1) clashes.push({monster:m.id,element:id,tiers});
    }
    if(new Set(replacements).size!==replacements.length) repeatedReplacement.push(m.id);
    for(const id of new Set(replacements)){
      const target=data.monsters.get(id);
      if(target&&!target.dungeons.some(d=>m.dungeons.includes(d))) removedOutsidePool.push({monster:m.id,target:id});
    }
  }
  for (const d of dungeons) if (!data.monsters.get(d.bossId)?.isBoss) invalid.push({ dungeon:d.id,key:'boss',id:d.bossId });
  for (const r of data.dungeonFloors) if(!data.dungeons.has(r.dungeonId)) invalid.push({key:'floor',dungeon:r.dungeonId});
  return { size:monsters.length, types:data.monsterTypes.size, statusCount:data.statusEffects.size,
    elements:data.elements.size, weapons:data.weaponTypes.size, invalid, clashes, repeatedReplacement, removedOutsidePool,
    legacyStatusUses, exactBossCount:monsters.filter(m=>m.isBoss).length,
    monsterRanks:count(monsters,m=>m.rank), tactics:count(monsters,m=>m.tactics ?? 'default'),
    byType:Object.fromEntries([...data.monsterTypes.keys()].map(id=>[id,monsters.filter(m=>m.types.includes(id)).length])),
    explicitStatus:count(monsters,m=>m.status || 'none'), placement:count(monsters,m=>m.dungeons.length),
    affinityCounts:Object.fromEntries(['weak','strongWeak','resist','immune'].map(k=>[k,monsters.filter(m=>m[k].length).length])) };
}

for (const rank of [1,6,12].filter(rank=>mode==='all'||mode==='matrix'+rank)) for (const kind of ['近場','標準','深層']) {
  const dg = dungeon(rank,kind);
  for (const accuracy of [.65,.8,.95]) for (const prep of ['standard','weak','status']) {
    evaluate(matrix,{rank,kind,accuracy,prep},setup(dg,'balanced6',prep,true),(g,s)=>expedition(dg,g,s,accuracy));
  }
  process.stderr.write('route '+rank+' '+kind+'\n');
}
const late = dungeon(12);
if (mode==='draft') {
  const random=rngFor(seed ^ 0xda817);
  const ids=BUILD_CATALOG.builds.map(b=>b.id);
  const adHoc=Array.from({length:24},()=>{
    const pool=[...ids];
    return Array.from({length:6},()=>pool.splice(Math.floor(random()*pool.length),1)[0]);
  });
  const curated=[
    ['species_gunner','vital_sniper','armor_breaker','undying_warrior','critical_siphon','charged_giant'],
    ['poison_assassin','shadow_chaser','species_gunner','vital_sniper','bleeding_reaper','armor_breaker'],
    ['poison_assassin','shadow_chaser','illusion_duelist','first_strike_samurai','dream_executioner','toxic_alchemist'],
    ['battlefield_bard','blessing_dancer','cleansing_apothecary','avenging_knight','resistance_specialist','item_alchemist'],
    ['species_gunner','vital_sniper','battlefield_bard','blessing_dancer','cleansing_apothecary','avenging_knight'],
  ];
  evaluate(teams,{profile:'baseline',rank:12,prep:'standard'},fixture(late),(g,s)=>expedition(late,g,s,.8));
  for (const [index, picks] of [...curated,...adHoc].entries()) {
    const template=structuredClone(fixture(late));
    const donors=picks.map(id=>setup(late,id,'prepared',false));
    template.party=donors.map((d,i)=>({...d.party[0],id:template.party[i].id}));
    template.unlockedJobs=[...new Set(donors.flatMap(d=>d.unlockedJobs))];
    template.nextUid=Math.max(...donors.map(d=>d.nextUid));
    template.simulationFixture={level:donors[0].simulationFixture.level,stage:donors[0].simulationFixture.stage,
      costs:donors.map(d=>({id:d.simulationFixture.profile,gear:d.simulationFixture.gear,
        slotUse:d.simulationFixture.primaryLoadoutCost,jobChangeJp:d.simulationFixture.primaryJobChangeJp,
        donorFixtureCostAllMembers:d.simulationFixture.donorFixtureCostAllMembers}))};
    evaluate(teams,{profile:'draft_'+(index+1),rank:12,picks,prep:'prepared'},template,(g,s)=>expedition(late,g,s,.8));
  }
}
if (mode==='tuning') {
  for (const [id, key, values] of [
    ['species_gunner','TYPE_BONUS',[54,42,36]],
    ['vital_sniper','WEAK_DMG',[21.6,16.2,10.8]],
    ['poison_assassin','sleep_policy',[0,1,2]],
    ['shadow_chaser','sleep_policy',[0,1,2]],
  ]) for (const value of values) {
    const template=structuredClone(setup(late,id,'prepared',false));
    let policy;
    if (key==='sleep_policy') {
      // 0 = existing policy. 1 = no sleep without a specialist finisher.
      // 2 = also evaluate the catalogue's six-player action-selection branch.
      if (value===2) template.simulationFixture.catalogBuildId=id;
      if (value) policy=(b,options)=>{
        if (b.turn.i!==0) return;
        const option=options.skills.find(x=>x.skill.id==='thief_p4_s2');
        if (option) option.reason='simulation_sleep_policy';
      };
    } else {
      const enchant=template.party[0].equip.weapon.enchants.find(e=>e.stat.split(':')[0]===key);
      if (!enchant) throw Error('tuning enchant missing');
      enchant.value=value;
    }
    evaluate(swaps,{id,key,value,rank:12,prep:'prepared'},template,(g,s)=>expedition(late,g,s,.8,policy));
  }
}
if (mode==='niches') {
  const cases = [
    ['multi', monsters.filter(m=>m.rank===12 && !m.isBoss && !m.season && m.role==='normal').slice(0,3), {}],
    ['boss', [data.monsters.get(late.bossId)], {}],
    ['armored', [data.monsters.get(late.bossId)], { defMultiplier:2, resMultiplier:1.3, regen:.04 }],
  ];
  for (const [scenario, definitions, tuning] of cases) {
    const rows = [{id:'baseline'}, ...BUILD_CATALOG.builds];
    for (const build of rows) checked(build,()=>{
      const base=build.id==='baseline';
      const game=base?fixture(late):setup(late,build.id,'prepared',false);
      const arms=base?['full']:['full','noPrimaryPassive'];
      for (const arm of arms) {
        const template=structuredClone(game);
        // Skills were acquired and slots purchased on both arms. Omit their
        // runtime contribution in just one arm, leaving the spend as sunk cost.
        if (arm==='noPrimaryPassive') template.party[0].loadout.passives=[];
        evaluate(swaps,{id:build.id,rank:12,scenario,arm,synthetic:Object.keys(tuning).length>0},template,(g,s)=>{
          const enemies=definitions.map(m=>{
            const enemy=makeEnemy(data,m.id,{lv:g.simulationFixture.level,dungeonId:late.id,boss:m.isBoss});
            if (tuning.regen) {
              enemy.def*=tuning.defMultiplier;
              enemy.res*=tuning.resMultiplier;
              enemy.regen=tuning.regen;
            }
            return enemy;
          });
          return fight(g,enemies,s,.8,false);
        });
      }
    });
    process.stderr.write('niche '+scenario+'\n');
  }
}
if (['all','teams'].includes(mode)) for (const [rank, profile, prep] of [[6,'balanced6','prepared'],[6,'critical6','prepared'],[6,'weakness6','prepared'],
  [12,'balanced6','prepared'],[12,'critical6','prepared'],[12,'weakness6','prepared']]) {
  const dg = dungeon(rank);
  evaluate(teams,{rank,profile,prep},setup(dg,profile,prep,true),(g,s)=>expedition(dg,g,s,.8));
}
if (['all','swapsA'].includes(mode)) evaluate(swaps,{id:'baseline',rank:12,prep:'standard'},fixture(late),(g,s)=>expedition(late,g,s,.8));
const selectedBuilds = BUILD_CATALOG.builds.filter((_,i)=>mode==='all'||(mode==='swapsA'&&i<18)||(mode==='swapsB'&&i>=18));
for (const build of selectedBuilds) for (const prep of ['standard','prepared']) checked(build,()=>{
  evaluate(swaps,{id:build.id,rank:12,prep},setup(late,build.id,prep,false),(g,s)=>expedition(late,g,s,.8));
  process.stderr.write('build '+build.id+' '+prep+'\n');
});

const mid = dungeon(6);
const prototypes = [
  ['multi', monsters.filter(m=>m.rank===6 && !m.isBoss && !m.season).slice(0,3), {}],
  ['boss', [data.monsters.get(mid.bossId)], {}],
  ['physical_resist', [monsters.filter(m=>m.rank>=4 && m.rank<=8 && !m.isBoss).sort((a,b)=>b.defMul-a.defMul)[0]], {}],
  ['magical_resist', [monsters.filter(m=>m.rank>=4 && m.rank<=8 && !m.isBoss).sort((a,b)=>b.resMul-a.resMul)[0]], {}],
  ...['heal','ward','disrupt'].map(t=>[t,[monsters.find(m=>m.tactics===t)],{}]),
  ...['poison','burn','bleed','paralysis','sleep','freeze','silence','fear'].filter(id=>data.statusEffects.has(id)).map(id=>{
    const m = monsters.filter(m=>m.status===id).sort((a,b)=>Math.abs(a.rank-6)-Math.abs(b.rank-6))[0];
    return ['incoming_'+id, [m ?? data.monsters.get(mid.bossId)], m ? {} : {status:id,statusRate:.65}];
  }),
  ['regen_stress',[data.monsters.get(mid.bossId)],{regen:.08}],
  ['high_affinity',[data.monsters.get(mid.bossId)],{weak:[],strongWeak:[],resist:[...data.elements.keys()],immune:['fire','ice']}],
  ['low_mp',[data.monsters.get(mid.bossId)],{}],
];
if (['all','encounters'].includes(mode)) for (const [scenario, definitions, override] of prototypes) {
  for (const prep of ['standard','weak','status']) {
    const game = setup(mid,'balanced6',prep,true);
    const normalLevel = game.simulationFixture.level;
    evaluate(encounters,{ scenario, ids:definitions.map(m=>m.id), prep, synthetic:Object.keys(override).length>0 || scenario==='low_mp',
      enemyTraits:definitions.map(m=>({rank:m.rank,types:m.types,weak:m.weak,immune:m.immune,status:m.status,magicRate:m.magicRate,def:m.defMul,res:m.resMul,tactics:m.tactics})),override },
    game,(g,s)=>{
      if (scenario==='low_mp') for (const p of g.party) p.mp=Math.floor(p.mp*.1);
      const enemies=definitions.map(m=>Object.assign(makeEnemy(data,m.id,{lv:normalLevel,dungeonId:mid.id,boss:m.isBoss}),override));
      return fight(g,enemies,s,.8,false);
    });
  }
}
const out = { seed, stride:7919, trials, fingerprint, node:process.version, memoized:process.env.EQ_SIM_CACHE === '1', audit:audit(), failures, matrix, swaps, teams, encounters,
  catalog:builds.map(b=>({id:b.id,no:b.number,status:b.status,effects:b.effectRefs ?? b.newEffects})),
  jobs:jobs.map((j,i)=>({id:j.id,no:i+1,role:j.role,builds:j.builds,tier:j.tier})),
  elementProbe: (()=>{const e=makeEnemy(data,mid.bossId,{lv:30,dungeonId:mid.id,boss:true});
    return Object.fromEntries([...data.elements.keys()].map(id=>[id,elementMul(data,e,id)]));})(),
};
if (sourceFingerprint()!==fingerprint) throw Error('source changed');
writeFileSync(process.argv[4] ?? 'sim/results/four-priority-engine.json',JSON.stringify(out)+'\n');
console.log(JSON.stringify({matrix:matrix.length,swaps:swaps.length,teams:teams.length,encounters:encounters.length,failures}));
