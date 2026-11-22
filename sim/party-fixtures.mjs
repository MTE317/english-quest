/**
 * 実ゲームの制作・付与・習得規則を通す比較用編成。
 * 冒険の初期所持金を資材予算に流用せず、組立費用は simulationFixture.assembly に記録する。
 * 専用レシピを使う探索比較は、standard も同じ素体の itemLv・品質・強化にそろえる。
 */
import { readFileSync } from 'node:fs';
import { createNewGame } from '../game/js/game-state.js';
import { maxHp, maxMp, canEquip, equipFromStorage, affixSum, SLOTS } from '../game/js/character.js';
import { equipSkill, learnSkill, isLearned, capacity, usedCapacity, commonBlock, learnCommon, changeJob } from '../game/js/growth.js';
import { craft, enhance, enchant, enchantFamilies } from '../game/js/workshop.js';
import { parseAmounts } from '../game/js/csv.js';

// 既存12編成のID・比較条件を残し、開発カタログの36編成を追加する。
export const LEGACY_PROFILES = Object.freeze({
  balanced: { name: '基本編成', jobs: ['warrior', 'knight', 'black_mage', 'white_mage'], minStar: 1 },
  poison: { name: '毒刃の持久戦', jobs: ['thief', 'hexer', 'knight', 'white_mage'], weapons: ['dagger', 'tome', 'hammer', 'staff'], minStar: 3 },
  bleed: { name: '出血鎌の追い込み', jobs: ['warrior', 'hexer', 'bard', 'white_mage'], weapons: ['scythe', 'tome', 'instrument', 'staff'], minStar: 3 },
  critical: { name: '会心二刀の手数', jobs: ['thief', 'hunter', 'bard', 'white_mage'], weapons: ['katana', 'bow', 'instrument', 'staff'], offhands: ['dagger'], minStar: 1 },
  weakness: { name: '弱点・種族狩り', jobs: ['hunter', 'black_mage', 'knight', 'white_mage'], weapons: ['bow', 'tome', 'hammer', 'staff'], minStar: 1 },
  counter: { name: '耐性と反撃', jobs: ['knight', 'warrior', 'bard', 'white_mage'], weapons: ['hammer', 'axe', 'instrument', 'staff'], minStar: 1 },
  spellblade: { name: '属性魔法剣', jobs: ['spellblade', 'dancer', 'knight', 'white_mage'], weapons: ['sword', 'fan', 'hammer', 'staff'], minStar: 3 },
  support: { name: '扇と全体支援', jobs: ['dancer', 'hunter', 'knight', 'white_mage'], weapons: ['fan', 'bow', 'hammer', 'staff'], minStar: 3 },
  healer: { name: '回復とMPの循環', jobs: ['white_mage', 'knight', 'bard', 'hunter'], weapons: ['staff', 'hammer', 'instrument', 'bow'], minStar: 1 },
  magic: { name: '属性魔法', jobs: ['black_mage', 'elementalist', 'bard', 'white_mage'], weapons: ['tome', 'staff', 'instrument', 'staff'], minStar: 3 },
  supplies: { name: '銃・道具', jobs: ['gunner', 'apothecary', 'bard', 'white_mage'], weapons: ['gun', 'dagger', 'instrument', 'staff'], minStar: 3 },
  brawler: { name: '拳・速攻', jobs: ['monk', 'hunter', 'warrior', 'white_mage'], weapons: ['fist', 'bow', 'greatsword', 'staff'], minStar: 1 },
});

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}
export const BUILD_CATALOG = freezeTree(JSON.parse(readFileSync(new URL('./build-catalog.json', import.meta.url), 'utf8')));
export const BUILD_DEFINITIONS = Object.freeze(Object.fromEntries(BUILD_CATALOG.builds.map((build) => [build.id, build])));
export const PROFILES = Object.freeze({
  ...LEGACY_PROFILES,
  ...Object.fromEntries(BUILD_CATALOG.builds.map((build) => [build.id, {
    name: build.name, jobs: [build.job, ...build.allies.map((ally) => ally.job)],
    weapons: [build.weapon, ...build.allies.map((ally) => ally.weapon)],
    ...(build.offhand ? { offhands: [build.offhand] } : {}), minStar: build.minStar, catalogBuildId: build.id,
  }])),
});

const CROSS_SKILLS = {
  poison: ['apothecary_p2_s1', 'apothecary_p2_s2', 'hunter_p3_s2', 'hexer_p2_s4'],
  bleed: ['apothecary_p2_s2', 'hexer_p2_s4'],
  critical: ['monk_p2_s4'],
  weakness: ['spellblade_p1_s1', 'spellblade_p1_s2', 'spellblade_p1_s3'],
  counter: ['warrior_p2_s1', 'monk_p3_s1', 'monk_p3_s4'],
  spellblade: ['hunter_p2_s4', 'warrior_p1_s2'],
  support: ['bard_p1_s1', 'bard_p1_s2', 'bard_p1_s3'],
  healer: ['apothecary_p1_s2', 'bard_p3_s1'],
  magic: ['elementalist_p2_s1', 'hunter_p2_s4'],
  supplies: ['hunter_p1_s2'],
  brawler: ['thief_p1_s5', 'monk_p2_s4'],
};
const PRIMARY_PRIORITY = {
  poison: ['thief_p3_s3', 'apothecary_p2_s1', 'apothecary_p2_s2', 'hexer_p2_s4', 'hunter_p3_s2'],
  bleed: ['warrior_p3_s3', 'warrior_p1_s2', 'warrior_p3_s4', 'apothecary_p2_s2', 'hexer_p2_s4'],
  critical: ['thief_p1_s1', 'thief_p1_s3', 'thief_p1_s2', 'monk_p2_s4'],
  weakness: ['hunter_p1_s1', 'hunter_p2_s4', 'hunter_p2_s2', 'hunter_p1_s2'],
  counter: ['knight_p3_s3', 'warrior_p2_s1', 'knight_p1_s3', 'knight_p3_s2'],
  spellblade: ['spellblade_p1_s4', 'spellblade_p2_s1', 'spellblade_p2_s2', 'hunter_p2_s4'],
  support: ['bard_p1_s1', 'bard_p1_s3', 'dancer_p1_s5', 'dancer_p1_s1', 'dancer_p1_s2', 'bard_p1_s2'],
  healer: ['white_mage_p1_s1', 'white_mage_p1_s3', 'white_mage_p2_s3', 'white_mage_p1_s2', 'apothecary_p1_s2'],
};

const indexes = new WeakMap();
function index(data) {
  if (!indexes.has(data)) indexes.set(data, {
    equipment: [...data.equipment.values()],
    materials: [...data.materials.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)),
    skills: [...data.skills.values()],
    materialChoices: new Map(),
  });
  return indexes.get(data);
}
function publicJobRank(data, id) {
  const job = data.jobsById.get(id);
  if (!job || !['base', 'mid'].includes(job.tier)) return Infinity;
  if (job.tier === 'base') return 1;
  const rule = data.jobUnlocks?.get(id);
  if (!rule) return Infinity;
  if (rule.discover_dungeon) return data.dungeons.get(rule.discover_dungeon)?.rank ?? Infinity;
  return Math.max(1, ...parseAmounts(rule.materials ?? '').map(({ id }) => data.materials.get(id)?.rank ?? Infinity));
}
function genericPriority(skill, job) {
  if (skill.kind === 'passive') return 50 + skill.stage;
  if (skill.kind === 'heal_all') return 130 + skill.stage;
  if (skill.kind === 'heal') return 120 + skill.stage;
  if (skill.kind === 'revive') return 110;
  if (skill.kind === 'party_buff') return 100 + (skill.effect.buff?.dmg ?? 0) * 20 + skill.stage;
  if (skill.kind === 'cure') return job === 'white_mage' ? 95 : 30;
  if (skill.kind === 'attack') return 65 + Math.min(skill.effect.m ?? 1, 3) * 5 + (skill.effect.tgt === 'all' ? 15 : 0) + (skill.effect.st ? 4 : 0);
  if (skill.kind === 'imbue') return 90;
  if (skill.kind === 'debuff') return 85;
  if (skill.kind === 'self_buff' && skill.effect.buff?.counter) return 80;
  if (skill.kind === 'status') return 40;
  return 20;
}
function materialFor(data, def, family, rank) {
  const idx = index(data);
  const slot = ['head', 'body', 'arm'].includes(def.slot) ? 'armor' : def.slot;
  const key = `${slot}/${family}/${rank}`;
  if (!idx.materialChoices.has(key)) idx.materialChoices.set(key,
    idx.materials.find((m) => m.rank <= rank && enchantFamilies(data, def, m).includes(family)) ?? null);
  return idx.materialChoices.get(key);
}
export function resolveBuildFamily(data, boss, family) {
  if (family === 'TYPE_BONUS:$bossType') {
    if (!boss.types[0]) throw new Error('種族特効の対象となるボス種族がありません。');
    return `TYPE_BONUS:${boss.types[0]}`;
  }
  if (family === 'ELEMENT:$weakElement') {
    return `ELEMENT:${boss.weak.find((id) => data.elements.get(id)?.kind === '魔法') ?? 'fire'}`;
  }
  if (family.includes('$')) throw new Error(`未定義の付与条件です: ${family}`);
  return family;
}
function memberDefinitions(build) { return build ? [build, ...build.allies] : []; }
function requiredSkills(definition) { return [...(definition?.actions ?? []), ...(definition?.passives ?? [])]; }
function buildAffixes(data, boss, definition) {
  return Object.fromEntries(Object.entries(definition?.affixes ?? {}).map(([slot, families]) =>
    [slot, families.map((family) => resolveBuildFamily(data, boss, family))]));
}
function checkBuildProgress(data, build, rank, stage) {
  for (const [i, definition] of memberDefinitions(build).entries()) {
    for (const id of requiredSkills(definition)) {
      const skill = data.skills.get(id);
      if (!skill) throw new Error(`${build.id} の核心技能がありません: ${i + 1}人目/${id}`);
      if (skill.stage > stage) throw new Error(`${build.id} の核心技能 ${id} には比較用技能段階${skill.stage}が必要です。`);
      if (publicJobRank(data, skill.job) > rank) throw new Error(`${build.id} の核心技能 ${id} のジョブは現在の★で公開されていません。`);
      if (skill.isFinal && skill.job !== definition.job) throw new Error(`${build.id} は他職の奥義 ${id} を持ち出せません。`);
    }
  }
}

/** 核心が技能枠や付与枠から落ちた比較結果を作らない。専用制作の固定効果だけで代用もしない。 */
export function assertBuildCore(data, game) {
  const fixture = game.simulationFixture;
  const build = BUILD_DEFINITIONS[fixture?.catalogBuildId];
  if (!build) throw new Error('検証する開発ビルドのIDがありません。');
  const boss = data.monsters.get(fixture.bossId);
  const verified = [];
  for (const [i, definition] of memberDefinitions(build).entries()) {
    const m = game.party[i];
    if (!m || m.job !== definition.job || data.equipment.get(m.equip.weapon?.id)?.kind !== definition.weapon) {
      throw new Error(`${build.id} の核心構成が異なります: ${i + 1}人目のジョブ・武器`);
    }
    if (definition.offhand && data.equipment.get(m.equip.offhand?.id)?.kind !== definition.offhand) {
      throw new Error(`${build.id} の核心構成が異なります: ${i + 1}人目の副武器`);
    }
    for (const key of ['actions', 'passives']) for (const id of definition[key] ?? []) {
      if (!m.loadout[key].includes(id) || !isLearned(m, data.skills.get(id))) {
        throw new Error(`${build.id} の核心技能を装備できませんでした: ${i + 1}人目/${id}`);
      }
    }
    const affixes = buildAffixes(data, boss, definition);
    for (const [slot, families] of Object.entries(affixes)) for (const family of families) {
      if (!m.equip[slot]?.enchants?.some((e) => e.stat === family && e.value > 0)) {
        throw new Error(`${build.id} の核心付与を用意できませんでした: ${i + 1}人目/${slot}/${family}`);
      }
    }
    const effects = (definition.coreEffects ?? []).map((family) => resolveBuildFamily(data, boss, family));
    for (const family of effects) if (!(affixSum(m, family) > 0)) throw new Error(`${build.id} の核心効果がありません: ${family}`);
    verified.push({ member: i, actions: [...(definition.actions ?? [])], passives: [...(definition.passives ?? [])], affixes, effects });
  }
  return verified;
}
function preferredArmor(data, job) {
  if (job.startArmorWeight) return job.startArmorWeight;
  const grades = data.jobArmorApt.get(job.id) ?? {};
  return ['heavy', 'medium', 'light'].filter((kind) => data.aptitude.get(grades[kind]) != null)
    .sort((a, b) => data.aptitude.get(grades[b]) - data.aptitude.get(grades[a]))[0];
}
function affixWants(job, profile, primary) {
  if (primary) {
    if (['poison', 'bleed'].includes(profile)) return { weapon: ['DOT_POWER', 'STATUS_RATE'], accessory1: ['STATUS_RATE'], accessory2: ['VS_DEBUFFED'] };
    if (profile === 'critical') return { weapon: ['CRIT_DMG', 'CRT'], accessory1: ['CRT'], accessory2: ['CRIT_DMG'] };
    if (profile === 'counter') return { weapon: ['DEF_PIERCE'], arm: ['COUNTER'], body: ['PHYS_CUT'], accessory1: ['COUNTER'], accessory2: ['HP'] };
    if (profile === 'support') return { weapon: ['PARTY_BUFF_POWER'], accessory1: ['PARTY_BUFF_POWER'], accessory2: ['MP_SAVE'] };
    if (profile === 'healer') return { weapon: ['MP_ON_HIT'], accessory1: ['HEAL_POWER'], accessory2: ['MP_SAVE'] };
    if (profile === 'spellblade') return { weapon: ['WEAK_DMG'], accessory1: ['MAG'], accessory2: ['WEAK_DMG'] };
    if (profile === 'brawler') return { weapon: ['LIFESTEAL'], accessory1: ['CRIT_DMG'], accessory2: ['CRT'] };
  }
  if (job === 'white_mage') return { weapon: ['HEAL_POWER'], accessory1: ['MP_SAVE'], accessory2: ['HEAL_POWER'] };
  if (['bard', 'dancer'].includes(job)) return { weapon: ['PARTY_BUFF_POWER'], accessory1: ['MP_SAVE'], accessory2: ['PARTY_BUFF_POWER'] };
  if (job === 'hexer' || job === 'apothecary' && profile === 'poison') return { weapon: ['DOT_POWER'], accessory1: ['STATUS_RATE'], accessory2: ['VS_DEBUFFED'] };
  if (job === 'knight') return { weapon: ['DEF_PIERCE'], accessory1: ['COUNTER'], accessory2: ['HP'] };
  if (['hunter', 'black_mage', 'elementalist', 'gunner'].includes(job)) return { weapon: ['WEAK_DMG'], accessory1: ['WEAK_DMG'], accessory2: ['MP_SAVE'] };
  return { weapon: ['CRIT_DMG'], accessory1: ['CRT'], accessory2: ['HP'] };
}
function recipeScore(def, weights, normal) {
  const fx = def.fixedEffects ?? {};
  let score = def.itemLv * 2;
  for (const key of weights) score += Math.min(15, (fx[key] ?? 0) * .7);
  if (weights.includes('DOT_POWER')) score += Object.keys(fx).some((key) => key.startsWith('STATUS_ON_HIT:')) ? 10 : 0;
  return score - Math.max(0, normal.itemLv - def.itemLv) * .4;
}

export function prepareParty(data, dungeon, profileId = 'balanced', preparation = 'standard', options = {}) {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error(`比較用編成がありません: ${profileId}`);
  if (!['standard', 'prepared'].includes(preparation)) throw new Error(`準備条件が不正です: ${preparation}`);
  const requiredRank = Math.max(profile.minStar, ...profile.jobs.map((id) => publicJobRank(data, id)));
  if (dungeon.rank < requiredRank) throw new Error(`${profileId} は★${requiredRank}からの編成です。`);
  const rows = data.dungeonFloors.filter((r) => r.dungeonId === dungeon.id);
  if (!rows.length) throw new Error(`階層データがありません: ${dungeon.id}`);
  const level = options.level ?? Math.round(rows.reduce((sum, r) => sum + r.enemyLevel, 0) / rows.length);
  const stage = options.stage ?? Math.min(5, 1 + Math.floor(dungeon.rank / 3));
  if (!Number.isInteger(level) || level < 1 || level > data.balance.player.level_cap) throw new Error('比較用レベルが範囲外です。');
  if (!Number.isInteger(stage) || stage < 1 || stage > 5) throw new Error('比較用技能段階が範囲外です。');
  const build = BUILD_DEFINITIONS[profileId];
  if (build && preparation === 'prepared') checkBuildProgress(data, build, dungeon.rank, stage);
  const boss = data.monsters.get(dungeon.bossId);
  if (!boss) throw new Error(`ボスがありません: ${dungeon.bossId}`);
  const itemCap = dungeon.itemLvMin + 3;
  const enhancement = Math.min(3, Math.floor(dungeon.rank / 4));
  const prepared = preparation === 'prepared';
  const specialized = profileId !== 'balanced';
  const idx = index(data);
  const game = createNewGame(data, profile.jobs.map((job, i) => ({ name: `${i + 1}:${job}`, job, icon: 'x' })));
  const initialGold = game.gold;
  game.rank = data.ranks.find((r) => r.maxDungeonRank === dungeon.rank)?.id ?? game.rank;
  game.facilities = Object.fromEntries(data.facilities.map((f) => [f.id, Math.min(dungeon.rank, 12)]));
  game.unlockedJobs = profile.jobs.filter((id) => data.jobsById.get(id).tier === 'mid');
  game.storage = { gear: [], materials: {} };
  const fixture = game.simulationFixture = {
    profile: profileId, preparation, dungeonId: dungeon.id, bossId: dungeon.bossId,
    ...(build ? { catalogBuildId: build.id, catalogSchemaVersion: BUILD_CATALOG.schemaVersion } : {}),
    rank: dungeon.rank, level, stage, itemCap, enhancement,
    comparison: specialized ? '専用制作と同じ素体・品質・強化の通常制作を比較' : '同★の通常制作で基本と属性・状態耐性の準備を比較',
    assembly: { gold: 0, byPurpose: {}, materials: {}, ap: {}, jp: 0, ...(build ? { jobTraining: [] } : {}) }, gear: [], enchants: [], skipped: [],
  };
  const grade = Number(data.enchantGrades.filter((r) => Number(r.workshop_rank) <= dungeon.rank)
    .sort((a, b) => Number(b.grade) - Number(a.grade))[0]?.grade ?? 1);
  const transaction = (purpose, fn) => {
    const beforeGold = 1e12;
    const beforeMaterials = { ...game.storage.materials };
    game.gold = beforeGold;
    fn();
    const paid = beforeGold - game.gold;
    fixture.assembly.gold += paid;
    fixture.assembly.byPurpose[purpose] = (fixture.assembly.byPurpose[purpose] ?? 0) + paid;
    for (const [id, amount] of Object.entries(beforeMaterials)) {
      const used = amount - (game.storage.materials[id] ?? 0);
      if (used > 0) fixture.assembly.materials[id] = (fixture.assembly.materials[id] ?? 0) + used;
    }
    game.gold = initialGold;
  };
  const supply = (id, count) => {
    if (!data.materials.has(id) || data.materials.get(id).rank > dungeon.rank) throw new Error(`現在の★で用意できない素材: ${id}`);
    game.storage.materials[id] = (game.storage.materials[id] ?? 0) + count;
  };
  const createCraft = (def, chain = new Set()) => {
    if (chain.has(def.id)) throw new Error(`制作派生の循環: ${def.id}`);
    const recipe = data.recipes.find((r) => r.id === def.id);
    if (recipe) {
      if (Number(recipe.workshop_rank) > dungeon.rank) throw new Error('工房ランクを超える制作です。');
      if (recipe.derive_from) createCraft(data.equipment.get(recipe.derive_from), new Set([...chain, def.id]));
      for (const { id, count } of parseAmounts(recipe.materials)) supply(id, count);
    } else {
      const material = idx.materials.find((m) => m.rank >= def.star && m.rank <= dungeon.rank && m.kind === 'common');
      if (!material) throw new Error(`通常制作の素材がありません: ${def.id}`);
      supply(material.id, 4);
    }
    transaction('craft', () => craft(data, game, def));
    return game.storage.gear.at(-1);
  };
  const addEnchant = (m, gear, slot, family, memberIndex, required = false) => {
    const def = data.equipment.get(gear.id);
    if (gear.enchants?.some((entry) => entry.stat === family)) return;
    if ((gear.enchants?.length ?? 0) >= 2) {
      if (required) throw new Error(`${profileId} の核心付与が2枠に入りません: ${memberIndex + 1}人目/${slot}/${family}`);
      return;
    }
    const material = materialFor(data, def, family, dungeon.rank);
    if (!material) {
      if (required) throw new Error(`${profileId} の核心付与に同★以下の対応素材がありません: ${slot}/${family}`);
      fixture.skipped.push({ member: memberIndex, slot, family, reason: '同★以下の対応素材なし' }); return;
    }
    const enchantSlot = gear.enchants?.length ?? 0;
    supply(material.id, 1);
    transaction('enchant', () => enchant(data, game, gear, enchantSlot, material.id, family, grade));
    fixture.enchants.push({ member: memberIndex, slot, gearId: gear.id, enchantSlot, family, grade,
      materialId: material.id, value: gear.enchants[enchantSlot].value });
  };

  for (const [i, m] of game.party.entries()) {
    const job = data.jobsById.get(m.job);
    const definition = memberDefinitions(build)[i];
    const coreSkills = prepared ? requiredSkills(definition) : [];
    m.lv = level; m.equip = Object.fromEntries(SLOTS.map((slot) => [slot, null]));
    for (const node of [...data.commonTree].sort((a, b) => a.level - b.level)) if (!commonBlock(data, m, node)) learnCommon(data, m, node.id);
    const own = idx.skills.filter((s) => s.job === m.job && s.stage <= stage);
    const wanted = new Set(own.map((s) => s.id));
    const cross = prepared && definition ? [...new Set([...(definition.crossSkills ?? []),
      ...coreSkills.filter((id) => data.skills.get(id).job !== m.job)])]
      : prepared && specialized && i === 0 ? [...(CROSS_SKILLS[profileId] ?? [])] : [];
    if (prepared && specialized && ['black_mage', 'elementalist', 'hexer'].includes(m.job)) {
      const elemental = idx.skills.filter((s) => s.kind === 'attack' && s.effect.base === 'mag' && s.stage <= stage && !s.isFinal
        && s.elements.some((el) => boss.weak.includes(el)) && publicJobRank(data, s.job) <= dungeon.rank)
        .sort((a, b) => a.cost - b.cost || a.stage - b.stage)[0];
      if (elemental) cross.push(elemental.id);
    }
    for (const id of cross) {
      const s = data.skills.get(id);
      if (!s || s.stage > stage || s.isFinal || publicJobRank(data, s.job) > dungeon.rank) continue;
      for (const prerequisite of idx.skills.filter((candidate) => candidate.job === s.job && candidate.path === s.path && candidate.stage <= s.stage)) wanted.add(prerequisite.id);
      if (data.jobsById.get(s.job).tier === 'mid' && !game.unlockedJobs.includes(s.job)) game.unlockedJobs.push(s.job);
    }
    m.loadout = { actions: [], passives: [] }; m.learned = []; m.ap = {};
    const toLearn = [...wanted].map((id) => data.skills.get(id)).sort((a, b) => a.stage - b.stage || a.id.localeCompare(b.id));
    // 新カタログの持ち出しは実際に転職してAP習得し、元の職へ戻るJPも計上する。
    // 既存12編成の費用・生成順は従来の比較結果を保つため変えない。
    const originalJob = m.job;
    if (build) {
      const jobOrder = [originalJob, ...new Set(toLearn.filter((s) => s.job !== originalJob).map((s) => s.job))];
      toLearn.sort((a, b) => jobOrder.indexOf(a.job) - jobOrder.indexOf(b.job) || a.stage - b.stage || a.id.localeCompare(b.id));
    }
    const trainAs = (jobId) => {
      if (!build || m.job === jobId) return;
      const from = m.job;
      const cost = data.jobsById.get(jobId).changeJp;
      const originalJp = game.jp ?? 0;
      game.jp = originalJp + cost;
      changeJob(data, game, i, jobId);
      if (game.jp !== originalJp) throw new Error('比較用転職費が実際のAPIと一致しません。');
      fixture.assembly.jp += cost;
      fixture.assembly.jobTraining.push({ member: i, from, to: jobId, jp: cost });
    };
    fixture.assembly.ap[m.id] = {};
    for (const s of toLearn) {
      if (isLearned(m, s)) continue;
      trainAs(s.job);
      m.ap[s.job] = (m.ap[s.job] ?? 0) + s.apToLearn;
      learnSkill(data, m, s.id);
      fixture.assembly.ap[m.id][s.job] = (fixture.assembly.ap[m.id][s.job] ?? 0) + s.apToLearn;
    }
    trainAs(originalJob);
    m.loadout = { actions: [], passives: [] };
    const preferred = prepared && definition ? [...coreSkills, ...(definition.upgrades ?? [])]
      : prepared && specialized && i === 0 ? PRIMARY_PRIORITY[profileId] ?? [] : [];
    const priority = (s) => genericPriority(s, m.job) + (preferred.includes(s.id) ? 100 : 0)
      + (prepared && specialized && s.kind === 'imbue' && s.elements.some((el) => boss.weak.includes(el)) ? 120 : 0)
      + (prepared && specialized && s.kind === 'attack' && s.effect.base === 'mag' && s.elements.some((el) => boss.weak.includes(el)) ? 45 : 0);
    const kinds = new Set();
    // 核の低コスト技能をgenericの高段階技能で押し出さない。枠不足は失敗として返す。
    for (const id of coreSkills) {
      const s = data.skills.get(id);
      try { equipSkill(data, m, id); }
      catch (error) { throw new Error(`${profileId} の核心技能 ${i + 1}人目/${id}: ${error.message}`); }
      kinds.add(s.kind);
    }
    for (const s of toLearn.sort((a, b) => priority(b) - priority(a) || a.id.localeCompare(b.id))) {
      if (m.loadout.actions.includes(s.id) || m.loadout.passives.includes(s.id)) continue;
      if (['heal', 'heal_all', 'revive', 'cure'].includes(s.kind) && kinds.has(s.kind)) continue;
      // 異なる歌・舞を組み合わせる枠は残す。基本編成だけは同種強化を一つに絞る。
      if (!specialized && s.kind === 'party_buff' && kinds.has(s.kind)) continue;
      const key = s.kind === 'passive' ? 'passives' : 'actions';
      if (usedCapacity(data, m)[key] + s.cost <= capacity(data, m)[key]) { equipSkill(data, m, s.id); kinds.add(s.kind); }
    }
    const weaponKind = profile.weapons?.[i] ?? job.startWeapon;
    const armorWeight = preferredArmor(data, job);
    const requiredAffixes = buildAffixes(data, boss, definition);
    const wants = { ...affixWants(m.job, profileId, i === 0), ...requiredAffixes };
    for (const slot of ['weapon', ...(profile.offhands?.[i] ? ['offhand'] : []), 'head', 'body', 'arm', 'cloak', 'accessory1', 'accessory2']) {
      const actual = slot.startsWith('accessory') ? 'accessory' : slot === 'offhand' ? 'weapon' : slot;
      const kind = slot === 'offhand' ? profile.offhands[i] : weaponKind;
      const eligible = (def) => !def.unique && !def.setId && def.slot === actual && def.itemLv <= itemCap && def.star <= dungeon.rank
        && (actual !== 'weapon' || def.kind === kind)
        && (!['head', 'body', 'arm'].includes(slot) || def.armorWeight === armorWeight)
        && canEquip(data, m, slot, { id: def.id }).ok;
      const normal = idx.equipment.filter((def) => eligible(def) && !def.recipeId && def.source?.includes('制作'))
        .sort((a, b) => b.itemLv - a.itemLv || a.id.localeCompare(b.id))[0];
      if (!normal) throw new Error(`${m.job} の合法な装備がありません: ${slot}`);
      const weightKeys = wants[slot === 'offhand' ? 'weapon' : slot] ?? [];
      const recipe = specialized ? idx.equipment.filter((def) => eligible(def) && def.recipeId && def.itemLv >= normal.itemLv - 20)
        .filter((def) => {
          const row = data.recipes.find((r) => r.id === def.id);
          return Number(row.workshop_rank) <= dungeon.rank && Number(row.base_stat_bonus_pct) === 15
            && parseAmounts(row.materials).every(({ id }) => data.materials.get(id)?.rank <= dungeon.rank);
        }).sort((a, b) => recipeScore(b, weightKeys, normal) - recipeScore(a, weightKeys, normal) || a.id.localeCompare(b.id))[0] : null;
      const recipeRow = recipe && data.recipes.find((r) => r.id === recipe.id);
      const def = prepared && recipe ? recipe : recipeRow ? data.equipment.get(recipeRow.base_equipment_id) : normal;
      const gear = createCraft(def);
      for (let n = 0; n < enhancement; n++) {
        supply('enhancement_stone', 1);
        transaction('enhance', () => enhance(data, game, gear, () => 0));
      }
      equipFromStorage(data, game, m, slot, gear.uid);
      if (prepared) for (const family of requiredAffixes[slot] ?? []) addEnchant(m, gear, slot, family, i, true);
      if (slot === 'weapon' || slot === 'offhand') {
        const attribute = data.weaponTypes.get(def.kind).attackStat === 'mag' ? 'MAG' : 'STR';
        const family = prepared && specialized ? wants.weapon?.[0] ?? attribute : attribute;
        addEnchant(m, gear, slot, family, i);
        if (prepared) {
          const weak = boss.weak.find((el) => data.elements.get(el)?.kind === '魔法' && materialFor(data, def, `ELEMENT:${el}`, dungeon.rank));
          if (weak) addEnchant(m, gear, slot, `ELEMENT:${weak}`, i);
          else if (specialized) addEnchant(m, gear, slot,
            wants.weapon?.[1] ?? (boss.types[0] ? `TYPE_BONUS:${boss.types[0]}` : attribute), i);
        }
      } else if (prepared && ['body', 'cloak'].includes(slot)) {
        addEnchant(m, gear, slot, boss.attackElement && data.elements.get(boss.attackElement)?.kind === '魔法'
          ? `ELEM_RES:${boss.attackElement}` : slot === 'body' ? 'PHYS_CUT' : 'EVA', i);
      } else if (prepared && slot === 'arm') addEnchant(m, gear, slot, 'STATUS_RES', i);
      else if (slot === 'accessory1') addEnchant(m, gear, slot, prepared && specialized ? wants.accessory1?.[0] ?? 'HP' : 'HP', i);
      if (prepared && specialized && slot !== 'weapon' && slot !== 'offhand') {
        for (const family of wants[slot] ?? []) addEnchant(m, gear, slot, family, i);
      }
      fixture.gear.push({ member: i, slot, id: def.id, pairedBaseId: recipeRow?.base_equipment_id ?? normal.id,
        itemLv: def.itemLv, star: def.star, quality: gear.quality, enhancement: gear.enh });
    }
    for (const slot of ['weapon', 'offhand']) if (m.equip[slot]) {
      const kind = data.equipment.get(m.equip[slot].id).kind;
      m.mastery[kind] = Math.min(10, dungeon.rank - 1) * 30;
    }
    m.hp = maxHp(data, m); m.mp = maxMp(data, m);
  }
  const heal = dungeon.rank >= 6 ? 'x_potion' : dungeon.rank >= 3 ? 'hi_potion' : 'potion';
  const mana = dungeon.rank >= 8 ? 'x_ether' : dungeon.rank >= 4 ? 'hi_ether' : 'ether';
  game.items = { [heal]: 3, [mana]: 2, revive_salts: 1, antidote: 2, ...(dungeon.rank >= 2 ? { panacea: 1 } : {}) };
  fixture.assembly.byPurpose.items = Object.entries(game.items).reduce((sum, [id, count]) => sum + data.items.get(id).price * count, 0);
  fixture.assembly.gold += fixture.assembly.byPurpose.items;
  fixture.assembly.jp += [...new Set(game.party.map((m) => m.job))].filter((id) => data.jobsById.get(id).tier === 'mid')
    .reduce((sum, id) => sum + data.jobsById.get(id).changeJp, 0);
  if (build && prepared) fixture.core = assertBuildCore(data, game);
  game.gold = initialGold;
  return game;
}
