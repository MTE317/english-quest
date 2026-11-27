// 新職業マスターは、画面と同じGameData・育成・戦闘処理で測定する。
// 旧Pythonモデルへの技能効果の二重実装を避け、乱数の種と条件を結果へ残す。
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { realGameData } from '../../tests/helpers.js';
import { createNewGame } from '../../js/game-state.js';
import { makeGear, maxHp, maxMp, computeStats, gainXp, gearDef } from '../../js/character.js';
import { gainAp } from '../../js/ap.js';
import { jobSkills, learnBlock, learnSkill, learnedSkillLevel, upgradeSkill, upgradeSkillBlock, equipBlock, equipSkill,
  ensureLoadout, effectiveSkill, capacity, usedCapacity } from '../../js/growth.js';
import { makeEnemy, createBattle, actionOptions, nextTurn, setPending, resolvePending, targetKind,
  finishBattle, battleRewards, skillMp, elementMul, battleStats } from '../../js/battle.js';
import { makeEncounter } from '../../js/encounter.js';
import { recoverAfterBattle } from '../../js/dungeon.js';
import { isTrialDungeonUnlocked } from '../../js/world-map.js';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, value = 'true'] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const samples = Math.max(1, Number(args.get('samples') ?? 8));
const output = args.get('output') ?? fileURLToPath(new URL('./results.json', import.meta.url));
const data = realGameData();
const basicJobs = data.jobs.filter(job => job.tier === 'base');
// この比較器は基本8職を対象に保つ。追加職は専用の戦闘テストで検証する。
const skills = [...data.skills.values()].filter(skill => skill.effect.master && data.jobsById.get(skill.job)?.tier === 'base');
const PREFERRED = {
  warrior: ['A01', 'A03', 'P02', 'P03', 'A06', 'P04', 'A07'],
  knight: ['A01', 'A03', 'P02', 'P01', 'A02', 'P03', 'A04'],
  monk: ['A01', 'A02', 'P02', 'P01', 'A03', 'P04', 'A09'],
  thief: ['A01', 'A04', 'P01', 'P04', 'A03', 'P03', 'A08'],
  hunter: ['A01', 'A02', 'P01', 'P02', 'A03', 'P03', 'A07', 'A08'],
  black_mage: ['A01', 'A02', 'A03', 'P02', 'P03', 'P01', 'A04', 'A05'],
  white_mage: ['A01', 'A03', 'P01', 'A02', 'A04', 'P03', 'P05'],
  bard: ['A01', 'A02', 'P05', 'A03', 'P01', 'A04', 'P02', 'A08'],
};
const formations = [
  { id: 'balanced', jobs: ['warrior', 'knight', 'monk', 'hunter', 'black_mage', 'white_mage'] },
  { id: 'songs-and-tricks', jobs: ['warrior', 'knight', 'thief', 'black_mage', 'white_mage', 'bard'] },
  { id: 'physical-party', jobs: ['warrior', 'knight', 'monk', 'thief', 'hunter', 'white_mage'] },
];
const lcg = (seed) => {
  let value = seed >>> 0;
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 4294967296);
};
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const round = value => Math.round(value * 1000) / 1000;
const title = id => data.jobsById.get(id)?.name ?? id;

function minimumUltimateCost(list) {
  const ordinary = list.filter(skill => !skill.isFinal);
  const ultimate = list.find(skill => skill.isFinal);
  let best = null;
  function visit(selected, start) {
    if (selected.length < 10) {
      for (let index = start; index <= ordinary.length - (10 - selected.length); index++) visit([...selected, ordinary[index]], index + 1);
      return;
    }
    const levels = new Map();
    const require = (skill, level) => {
      if ((levels.get(skill.id) ?? 0) >= level) return;
      levels.set(skill.id, level);
      for (const previous of skill.effect.prerequisites ?? []) require(data.skills.get(previous.id), previous.level);
    };
    for (const skill of selected) require(skill, 1);
    let cost = ultimate.apToLearn;
    for (const [id, level] of levels) {
      const skill = data.skills.get(id);
      cost += skill.apToLearn + (skill.effect.levels ?? []).slice(0, level - 1).reduce((sum, upgrade) => sum + upgrade.ap, 0);
    }
    if (!best || cost < best.ap) best = { ap: cost, nonUltimateSkills: levels.size,
      requiredLevels: Object.fromEntries(levels) };
  }
  visit([], 0);
  return best;
}

function inspectMaster() {
  assert.equal(data.jobs.length, 50, '職業マスターは50職');
  assert.equal(new Set(data.jobs.map(job => job.id)).size, 50, '職業IDの重複なし');
  assert.equal(basicJobs.length, 8);
  assert.equal(data.jobs.filter(job => job.tier === 'additional').length, 36);
  assert.equal(data.jobs.filter(job => job.tier === 'legendary').length, 6);
  const basicSkills=skills.filter(skill=>data.jobsById.get(skill.job)?.tier==='base');
  assert.equal(basicSkills.length, 120, '基本8職の技能は120種類');
  const rows = [];
  for (const job of basicJobs) {
    const list = jobSkills(data, job.id).filter(skill => skill.effect.master);
    assert.equal(list.length, 15, `${job.name}の技能は15種類`);
    assert.equal(list.filter(skill => skill.kind === 'passive').length, 5);
    assert.equal(list.filter(skill => skill.isFinal).length, 1);
    for (const skill of list) {
      assert.ok([0,2,4].includes(skill.effect.levels?.length));
      assert.ok(skill.cost >= 0 && Number.isFinite(skill.mp) && Number.isFinite(skill.apToLearn));
      for (const prerequisite of skill.effect.prerequisites ?? []) {
        assert.ok(data.skills.has(prerequisite.id), `${skill.id}の前提が存在`);
        assert.ok(prerequisite.level >= 1 && prerequisite.level <= 5);
      }
    }
    rows.push({ job: job.id, name: job.name, skills: list.length,
      minimumUltimate: minimumUltimateCost(list),
      learnAllAp: list.reduce((sum, skill) => sum + skill.apToLearn, 0),
      maxAllAp: list.reduce((sum, skill) => sum + skill.apToLearn
        + (skill.effect.levels ?? []).reduce((total, level) => total + level.ap, 0), 0),
      initialSkillMp: list.filter(skill => skill.kind !== 'passive' && !skill.isFinal).map(skill => ({ id: skill.id, mp: skill.mp })),
    });
  }
  return { jobs: data.jobs.length, basicJobs: 8, additionalJobs: 36, legendaryJobs: 6, skills: basicSkills.length,
    skillLevelDefinitions: basicSkills.reduce((n,s)=>n+1+s.effect.levels.length,0), costs: rows };
}

function gearFor(member, itemLevel, kindOverride) {
  const apt = data.jobWeaponApt.get(member.job) ?? {};
  const weaponKind = kindOverride ?? [...data.weaponTypes.keys()].find(kind => apt[kind] === 'S');
  const choose = predicate => [...data.equipment.values()]
    .filter(gear => !gear.unique && !gear.setId && !gear.recipeId && gear.star <= Math.max(1, Math.ceil(itemLevel / 10)) && predicate(gear))
    .sort((a, b) => b.star - a.star || a.id.localeCompare(b.id))[0];
  const entries = { weapon: choose(gear => gear.slot === 'weapon' && gear.kind === weaponKind) };
  const gradeOrder = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  const armorApt = data.jobArmorApt.get(member.job) ?? {};
  const armorWeight = ['heavy', 'medium', 'light'].sort((a, b) => (gradeOrder[armorApt[b]] ?? 0) - (gradeOrder[armorApt[a]] ?? 0))[0];
  for (const slot of ['head', 'body', 'arm']) {
    entries[slot] = choose(gear => gear.slot === slot && gear.armorWeight === armorWeight);
  }
  entries.cloak = choose(gear => gear.slot === 'cloak');
  return entries;
}

function equipFixture(game, member, itemLevel, weaponKind) {
  for (const [slot, definition] of Object.entries(gearFor(member, itemLevel, weaponKind))) {
    member.equip[slot] = definition ? makeGear(game, definition.id) : null;
  }
}

function learnAtLevel(member, id, required = 1, chain = new Set()) {
  if (chain.has(id)) throw new Error(`技能の前提循環: ${id}`);
  const skill = data.skills.get(id);
  if (!skill) return false;
  const nextChain = new Set([...chain, id]);
  for (const previous of skill.effect.prerequisites ?? []) {
    if (!learnAtLevel(member, previous.id, previous.level, nextChain)) return false;
  }
  if (!member.learned.includes(id)) {
    if (learnBlock(data, member, skill)) return false;
    learnSkill(data, member, id);
  }
  while (learnedSkillLevel(member, skill) < required) {
    if (upgradeSkillBlock(data, member, skill)) return false;
    upgradeSkill(data, member, id);
  }
  return true;
}

function buildParty(jobs, { level, itemLevel, apBudget, skillLevel = 1, maxSkills = false } = {}) {
  const specs = jobs.map((job, index) => ({ job, name: `${title(job)}${index + 1}`, icon: data.icons[index % data.icons.length]?.id ?? '' }));
  const game = createNewGame(data, specs);
  for (const member of game.party) {
    member.lv = level;
    equipFixture(game, member, itemLevel);
    assert.ok(member.equip.weapon, `${member.job}の比較用武器が存在（装備Lv上限${itemLevel}）`);
    if (maxSkills) {
      member.learned = jobSkills(data, member.job).map(skill => skill.id);
      member.skillLevels = Object.fromEntries(member.learned.map(id => [id, skillLevel]));
    } else {
      // 費用・前提判定は実ゲームの育成APIを利用。APを節約して無償習得しない。
      if (member.ap < apBudget) gainAp(data, member, apBudget - member.ap);
      const desired = PREFERRED[member.job] ?? [];
      for (const suffix of desired) learnAtLevel(member, `${member.job}_${suffix}`);
      for (const suffix of desired) learnAtLevel(member, `${member.job}_${suffix}`, skillLevel);
    }
    member.loadout = { actions: [], passives: [], ultimate: null };
    const desired = [...(PREFERRED[member.job] ?? []).map(suffix => `${member.job}_${suffix}`),
      ...jobSkills(data, member.job).map(skill => skill.id)];
    for (const id of [...new Set(desired)]) {
      const skill = data.skills.get(id);
      if (skill && member.learned.includes(id) && !equipBlock(data, member, skill)) equipSkill(data, member, id);
    }
    ensureLoadout(data, member);
    const cap = capacity(data, member), used = usedCapacity(data, member);
    assert.ok(used.actions <= cap.actions && used.passives <= cap.passives, '実行編成は装備容量内');
    member.hp = maxHp(data, member);
    member.mp = maxMp(data, member);
  }
  return game;
}

function targetFor(battle, game, action, actor = battle.turn?.i ?? 0) {
  const member = game.party[actor];
  const skill = action.type === 'skill' ? effectiveSkill(data, member, data.skills.get(action.skillId)) : null;
  const kind = targetKind(data, action, member);
  if (kind === 'self') return actor;
  if (kind === 'none' || kind === 'allies' || kind === 'enemies') return undefined;
  if (kind === 'ko_ally') return game.party.findIndex((member, index) => member.hp <= 0 && !battle.allies[index].statuses.petrify);
  if (kind === 'ally') {
    const otherAlly = skill?.effect.rules?.cover?.target === 'selected' || skill?.kind === 'mp_give' && skill.effect.transfer;
    return game.party.map((member, index) => ({ index, ratio: member.hp / maxHp(data, member) }))
      .filter(entry => game.party[entry.index].hp > 0 && !battle.allies[entry.index].statuses.petrify
        && (!otherAlly || entry.index !== actor)).sort((a, b) => a.ratio - b.ratio)[0]?.index ?? -1;
  }
  const options = actionOptions(data, game, battle, actor);
  const option = skill?.isFinal ? options.ultimate : options.skills.find(entry => entry.skill.id === skill?.id);
  return battle.enemies.findIndex((enemy, index) => enemy.hp > 0 && !enemy.statuses.petrify && !option?.targetReasons?.[index]);
}

function chooseAction(game, battle, actor) {
  const options = actionOptions(data, game, battle, actor);
  const available = options.skills.filter(option => !option.reason);
  const weakest = Math.min(...game.party.filter(member => member.hp > 0).map(member => member.hp / maxHp(data, member)));
  const knockedOut = game.party.some(member => member.hp <= 0);
  let selected = knockedOut ? available.find(option => option.skill.kind === 'revive') : null;
  if (!selected && weakest < .6) {
    const injured = game.party.filter(member => member.hp > 0 && member.hp / maxHp(data, member) < .65).length;
    selected = available.find(option => option.skill.kind === (injured >= 3 ? 'heal_all' : 'heal'))
      ?? available.find(option => ['heal_all', 'heal'].includes(option.skill.kind));
  }
  const effects = battle.allies[actor].masterEffects ?? {};
  if (!selected) selected = available.find(option => option.skill.kind === 'party_buff'
    && !effects[option.skill.id] && !Object.values(effects).some(effect => effect.skillId === option.skill.id)
    && (game.party[actor].job === 'bard' || battle.round === 1));
  if (!selected && options.ultimate && !options.ultimate.reason) selected = options.ultimate;
  if (!selected) {
    const living = battle.enemies.map((enemy, target) => ({ enemy, target })).filter(entry => entry.enemy.hp > 0);
    const stats = battleStats(data, game, battle, actor);
    const weapon = game.party[actor].equip.weapon;
    const weaponElements = weapon ? data.weaponTypes.get(gearDef(data, weapon).kind).elements : ['blunt'];
    const score = option => {
      const effect = option.skill.effect;
      const elements = option.skill.elements.length ? option.skill.elements : effect.base === 'weapon' ? weaponElements : ['none'];
      const magical = effect.base === 'mag';
      const attack = (magical ? stats.mag : stats.str) + (effect.base === 'weapon' ? stats.attack : 0);
      const hit = entry => {
        const affinity = Math.max(...elements.map(element => elementMul(data, entry.enemy, element)));
        const estimate = attack * (effect.m ?? 1) * affinity * 100 / (100 + (magical ? entry.enemy.res : entry.enemy.def));
        return Math.min(entry.enemy.hp, estimate);
      };
      const damage = effect.tgt === 'all' ? living.reduce((sum, entry) => sum + hit(entry), 0) : Math.max(...living.map(hit));
      return damage / Math.max(2, skillMp(data, game.party[actor], option.skill, { battle, actor }));
    };
    selected = available.filter(option => option.skill.kind === 'attack')
      .sort((a, b) => score(b) - score(a))[0];
  }
  const action = selected ? { type: 'skill', skillId: selected.skill.id } : { type: 'attack' };
  if (selected?.elements?.length) action.element = selected.elements[0];
  else if (selected?.skill.id === 'black_mage_U01') action.element = 'fire';
  action.target = targetFor(battle, game, action, actor);
  if (targetKind(data, action, game.party[actor]) === 'enemy') {
    const weapon = game.party[actor].equip.weapon;
    const effect = selected?.skill.effect;
    const elements = selected?.skill.elements.length ? selected.skill.elements
      : weapon ? data.weaponTypes.get(gearDef(data, weapon).kind).elements : ['blunt'];
    const targets = battle.enemies.map((enemy, target) => ({ enemy, target }))
      .filter(entry => entry.enemy.hp > 0).sort((a, b) => {
        const threat = entry => Math.max(...elements.map(element => elementMul(data, entry.enemy, element)))
          * 100 / (100 + (effect?.base === 'mag' ? entry.enemy.res : entry.enemy.def)) / Math.max(1, entry.enemy.hp);
        return threat(b) - threat(a);
      });
    action.target = targets[0]?.target ?? action.target;
  }
  return action;
}

function fight(game, enemies, seed, accuracy) {
  const battle = createBattle(data, game, { enemies, seed, canFlee: false });
  const answers = lcg(seed ^ 0x9e3779b9);
  let questions = 0;
  const uses = {};
  while (!battle.result && questions < 1000) {
    const turn = nextTurn(data, game, battle);
    if (!turn) continue;
    const action = chooseAction(game, battle, turn.i);
    const key = action.skillId ?? action.type;
    uses[key] = (uses[key] ?? 0) + 1;
    setPending(battle, action, { verification: true });
    resolvePending(data, game, battle, answers() < accuracy);
    questions += 1;
    for (const member of game.party) assert.ok(Number.isFinite(member.hp) && Number.isFinite(member.mp), 'HP/MPに不正値なし');
  }
  assert.ok(battle.result, '戦闘は有限回で終了');
  finishBattle(data, game, battle);
  return { battle, questions, uses };
}

function activeSkillSmoke() {
  const results = [];
  const dummy = [...data.monsters.values()].find(monster => !monster.isBoss && monster.role === 'normal');
  for (const skill of skills.filter(skill => skill.kind !== 'passive')) {
    for (const level of [1, 2, 3, 4, 5]) {
      const game = buildParty(Array(6).fill(skill.job), { level: 12, itemLevel: 15, apBudget: 9999, skillLevel: level, maxSkills: true });
      const member = game.party[0];
      const definition = effectiveSkill(data, member, skill);
      const weapon = definition.effect.weapons?.find(id => id !== 'unarmed');
      if (weapon) equipFixture(game, member, 15, weapon);
      member.loadout = { actions: skill.isFinal ? [] : [skill.id], passives: [], ultimate: skill.isFinal ? skill.id : null };
      member.ultimateGauge = data.basicJobRules?.ultimate?.gauge_max ?? 100;
      member.mp = maxMp(data, member);
      for (const ally of game.party) ally.hp = Math.max(1, Math.floor(maxHp(data, ally) * .4));
        const action = { type: 'skill', skillId: skill.id, element: 'fire' };
        if (targetKind(data, action, member) === 'ko_ally') game.party[1].hp = 0;
        if (skill.kind === 'mp_give' && definition.effect.transfer) game.party[1].mp = Math.floor(maxMp(data, game.party[1]) * .25);
      const enemy = makeEnemy(data, dummy.id, { lv: 12 });
      enemy.maxHp = enemy.hp = Math.max(enemy.hp, 100000);
      const battle = createBattle(data, game, { enemies: [enemy], seed: 20261125, canFlee: false });
      battle.round = 1;
      battle.turn = { side: 'ally', i: 0 };
      const options = actionOptions(data, game, battle, 0);
      const option = skill.isFinal ? options.ultimate : options.skills.find(entry => entry.skill.id === skill.id);
      assert.ok(option, `${skill.id} Lv${level}が実行候補にある`);
      assert.equal(option.reason, '', `${skill.id} Lv${level}の実行条件を満たす`);
      action.target = targetFor(battle, game, action);
        const kind = targetKind(data, action, member);
        if (['ally', 'ko_ally', 'enemy'].includes(kind)) assert.ok(action.target >= 0, `${skill.id} Lv${level}の合法な対象が存在`);
        if (definition.effect.rules?.cover?.target === 'selected' || skill.kind === 'mp_give' && definition.effect.transfer) {
          assert.notEqual(action.target, 0, `${skill.id} Lv${level}は自分以外の味方を選択`);
        }
      const before = structuredClone({ party: game.party.map(ally => ({ hp: ally.hp, mp: ally.mp })), enemyHp: enemy.hp });
      setPending(battle, action, { verification: true });
      resolvePending(data, game, battle, true);
      assert.ok(battle.log.some(message => message.includes(`の${skill.name}！`)), `${skill.id} Lv${level}の実行を確認`);
      for (const ally of game.party) assert.ok(Number.isFinite(ally.hp) && Number.isFinite(ally.mp), `${skill.id} Lv${level}のHP/MP`);
      assert.ok(Number.isFinite(enemy.hp));
      results.push({ id: skill.id, level, mpSpent: before.party[0].mp - member.mp,
        damage: before.enemyHp - enemy.hp, log: battle.log.slice(-3) });
    }
  }
  return { cases: results.length, results,
    scope: '各通常アクティブ・奥義を各Lvで一度実行する実行時スモーク。条件分岐の全証明ではない。' };
}

function weaponComparisons() {
  const rows = [];
  const dummy = [...data.monsters.values()].find(monster => !monster.isBoss && monster.role === 'normal');
  const cases = [
    { job: 'black_mage', skill: 'black_mage_A01', kinds: ['tome', 'staff', 'gun'] },
    { job: 'white_mage', skill: 'white_mage_A01', kinds: ['staff', 'tome', 'gun'] },
    { job: 'warrior', skill: 'warrior_A01', kinds: ['sword', 'axe', 'gun'] },
  ];
  for (const fixture of cases) for (const kind of fixture.kinds) {
    const game = buildParty(Array(6).fill(fixture.job), { level: 12, itemLevel: 15, apBudget: 9999, skillLevel: 3, maxSkills: true });
    const member = game.party[0];
    equipFixture(game, member, 15, kind);
    member.loadout = { actions: [fixture.skill], passives: [], ultimate: null };
    for (const ally of game.party) ally.hp = 1;
    member.mp = maxMp(data, member);
    const enemy = makeEnemy(data, dummy.id, { lv: 12 });
    enemy.maxHp = enemy.hp = 100000;
    const battle = createBattle(data, game, { enemies: [enemy], seed: 20261125, canFlee: false });
    battle.round = 1; battle.turn = { side: 'ally', i: 0 };
    const beforeHp = game.party[0].hp;
    const action = { type: 'skill', skillId: fixture.skill, target: 0 };
    setPending(battle, action, { verification: true });
    resolvePending(data, game, battle, true);
    rows.push({ job: fixture.job, skill: fixture.skill, weapon: kind,
      gearId: member.equip.weapon?.id ?? null, stats: computeStats(data, member),
      damage: 100000 - enemy.hp, heal: member.hp - beforeHp });
  }
  const value = (job, kind, metric) => rows.find(row => row.job === job && row.weapon === kind)[metric];
  assert.ok(value('black_mage', 'gun', 'damage') <= value('black_mage', 'tome', 'damage'), '銃の物理武器威力で一般魔法が魔導書を上回らない');
  assert.ok(value('white_mage', 'gun', 'heal') <= value('white_mage', 'staff', 'heal'), '銃の物理武器威力で回復が杖を上回らない');
  return rows;
}

function dungeonTrials() {
  // ゲームの公開対象判定を再利用。地名や先頭5行を独自に固定しない。
  const discoveries = { cleared: Object.fromEntries([...data.dungeons.keys()].map(id => [id, 1])) };
  const dungeons = [...data.dungeons.values()].filter(dungeon => isTrialDungeonUnlocked(discoveries, dungeon.id));
  assert.equal(dungeons.length, 5);
  const rows = [];
  for (const dungeon of dungeons) {
    const route = data.dungeonFloors.filter(row => row.dungeonId === dungeon.id).sort((a, b) => a.floor - b.floor);
    assert.ok(route.length);
    const minimumGearLevel = Math.max(...[...data.weaponTypes.keys()].map(kind => Math.min(...[...data.equipment.values()]
      .filter(gear => gear.slot === 'weapon' && gear.kind === kind && !gear.unique && !gear.recipeId).map(gear => gear.star * 10))));
    for (const phase of ['entry', 'prepared']) {
    const level = phase === 'entry' ? route[0].enemyLevel : Math.max(...route.map(row => row.enemyLevel));
    const itemLevel = Math.max(minimumGearLevel, phase === 'entry' ? dungeon.rank * 10 : dungeon.rank * 10);
    const apBudget = phase === 'entry' ? 70 + level * 10 : 130 + level * 10;
    const skillLevel = phase === 'entry' ? 1 : 2;
    for (const formation of formations) for (const accuracy of [.7, 1]) {
      const trials = [];
      for (let sample = 0; sample < samples; sample++) {
        const seed = 20261125 + sample * 104729;
        const rng = lcg(seed);
        const game = buildParty(formation.jobs, { level, itemLevel, apBudget, skillLevel });
        let questions = 0, victories = 0, rounds = 0, won = true;
        const uses = {};
        for (const row of route) {
          for (let index = 0; index < row.battles; index++) {
            const enemies = makeEncounter(data, dungeon.id, row.floor, rng, { boss: row.lastBattleIsBoss && index === row.battles - 1,
              season: 'spring', elites: false, rowOverride: row });
            const result = fight(game, enemies, Math.floor(rng() * 4294967296), accuracy);
            questions += result.questions;
            rounds += result.battle.round;
            for (const [id, count] of Object.entries(result.uses)) uses[id] = (uses[id] ?? 0) + count;
            if (result.battle.result !== 'win') { won = false; break; }
            victories += 1;
            const reward = battleRewards(data, game, result.battle);
            game.party.forEach((member, actor) => { gainXp(data, member, reward.xp[actor]); gainAp(data, member, reward.ap[actor]); });
            recoverAfterBattle(data, game);
          }
          if (!won) break;
        }
        trials.push({ seed, won, questions, victories, rounds, uses,
          endingHp: round(mean(game.party.map(member => member.hp / maxHp(data, member)))),
          endingMp: round(mean(game.party.map(member => member.mp / maxMp(data, member)))) });
      }
      rows.push({ dungeon: dungeon.id, name: dungeon.name, phase, formation: formation.id, jobs: formation.jobs, accuracy,
        initialLevel: level, itemLevel, apBudgetPerMember: apBudget, targetSkillLevel: skillLevel, samples,
        clearRate: round(mean(trials.map(trial => Number(trial.won)))),
        meanQuestions: round(mean(trials.map(trial => trial.questions))),
        meanRounds: round(mean(trials.map(trial => trial.rounds))), trials });
    }
    }
  }
  return rows;
}

export function generateReport({ smokeOnly = false } = {}) {
  const sourceFiles = ['data/jobs.csv', 'data/jobs_mid.csv', 'data/jobs_advanced.csv', 'data/skills.csv',
    'data/basic_job_rules.json', 'data/balance.json', 'data/weapon_types.csv', 'data/job_weapon_aptitude.csv',
    'game/js/gamedata.js', 'game/js/character.js', 'game/js/growth.js', 'game/js/battle.js', 'game/js/job-combat.js',
    'game/js/game-state.js', 'game/js/dungeon.js', 'game/js/encounter.js', 'game/verification/jobs-master/measure.mjs'];
  const fingerprints = Object.fromEntries(sourceFiles.map(name => [name,
    createHash('sha256').update(readFileSync(new URL(`../../../${name}`, import.meta.url))).digest('hex')]));
  return {
  version: 1, design: 'jobs-baseline-v1 / basic-jobs-skills-v1', seed: 20261125,
  sourceSha256: fingerprints,
  method: '実ゲームのGameData、育成、装備、戦闘処理を直接呼出し。属性相性・負傷・既存支援を参照する固定AI、エリートなし。',
  limits: ['単純AIによる比較用の戦闘経路試行。最適な手動操作や全状態異常・装備の組合せの保証ではない。',
    'APは前提を守って修得するための比較予算。現実の学習時間は問題文・音声・個人の回答速度に依存する。',
    '探索イベント・遠征費・道具補給・戦闘間の宿屋は含まない。今回の既存ダンジョン数値の自動変更はしない。'],
  master: inspectMaster(), smoke: activeSkillSmoke(), weaponComparisons: weaponComparisons(),
  dungeonTrials: smokeOnly ? [] : dungeonTrials(),
  };
}

export { data, basicJobs, skills, formations, inspectMaster, buildParty, gearFor, learnAtLevel, chooseAction, fight, minimumUltimateCost };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = generateReport({ smokeOnly: args.has('smoke-only') });
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  const summary = { output, jobs: result.master.jobs, skills: result.master.skills,
    skillSmokeCases: result.smoke.cases, dungeonScenarios: result.dungeonTrials.length,
    dungeonTrials: result.dungeonTrials.reduce((sum, row) => sum + row.samples, 0),
    sourceSha256: result.sourceSha256,
    clearRates: result.dungeonTrials.map(row => ({ dungeon: row.dungeon, phase: row.phase, formation: row.formation, accuracy: row.accuracy, rate: row.clearRate })) };
  writeFileSync(resolve(dirname(output), 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
}
