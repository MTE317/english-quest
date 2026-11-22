// ゲームで使う data/ のファイルをまとめて読み、ID で引ける形にする。
import { loadCsv, loadJson, loadOptional } from './data.js?v=features-2';
import { toNumber, splitList } from './csv.js';

const FILES = {
  balance: 'balance.json',
  jobs: 'jobs.csv',
  jobsMid: 'jobs_mid.csv',
  aptitude: 'aptitude.csv',
  jobWeaponApt: 'job_weapon_aptitude.csv',
  jobArmorApt: 'job_armor_aptitude.csv',
  weaponTypes: 'weapon_types.csv',
  armorWeights: 'armor_weights.csv',
  equipment: 'equipment.csv',
  icons: 'appearance_icons.csv',
  rarities: 'rarities.csv',
  monsters: 'monsters.csv',
  monsterTypes: 'monster_types.csv',
  elements: 'elements.csv',
  statusEffects: 'status_effects.csv',
  skills: 'skills.csv',
  items: 'items.csv',
  elitePrefixes: 'elite_prefixes.csv',
  dungeons: 'dungeons.csv',
  dungeonFloors: 'dungeon_floors.csv',
  dropTables: 'drop_tables.csv',
  economy: 'economy_by_rank.csv',
  materials: 'materials.csv',
  affixes: 'affixes.csv',
  uniques: 'uniques.csv',
  backpack: 'backpack.csv',
  ranks: 'adventurer_ranks.csv',
  quests: 'quests.csv',
  questTypes: 'quest_types.csv',
  innRooms: 'inn_rooms.csv',
  seasons: 'seasons.csv',
  facilities: 'facilities.csv',
  commonTree: 'common_tree.csv',
  jobMastery: 'job_mastery.csv',
  exams: 'exams.csv',
  jobUnlocks: 'job_unlocks.csv',
  recipes: 'recipes.csv',
  alchemyRecipes: 'alchemy_recipes.csv',
  enhanceRates: 'enhance_rates.csv',
  enchantGrades: 'enchant_grades.csv',
  enchantSources: 'enchant_sources.csv',
  facilityRanks: 'facility_ranks.csv',
  facilityEffects: 'facility_effects.csv',
  kokuinSlots: 'kokuin_slots.csv',
  runeEffects: 'rune_effects.csv',
  sets: 'sets.csv',
  setItems: 'set_items.csv',
  questChains: 'quest_chains.csv',
};

const byId = (rows, key = 'id') => new Map(rows.map((r) => [r[key], r]));

/**
 * 読み込んだ中身（テストでは fs で読んだものを渡す）から GameData を作る
 * @param raw { balance: object, jobs: rows, ... }
 */
export function buildGameData(raw) {
  const STATS = ['hp', 'str', 'mag', 'def', 'res', 'spd', 'luk'];
  const job = (r, tier) => ({
    id: r.id, name: r.name, role: r.role, tier,
    grades: Object.fromEntries(STATS.map((k) => [k, r[k]])),
    elements: splitList(r.main_elements),
    weakness: r.weakness ?? '',
    startWeapon: r.start_weapon || null,
    startArmorWeight: r.start_armor_weight || null,
    unlock: r.unlock ?? '',
    changeJp: toNumber(r.change_jp, 0),
  });
  const jobs = [...raw.jobs.map((r) => job(r, 'base')), ...raw.jobsMid.map((r) => job(r, 'mid')), ...(raw.jobsAdvanced ?? []).map((r) => job(r, 'advanced'))];

  const aptitude = new Map(raw.aptitude.map((r) => [r.grade, toNumber(r.multiplier, null)])); // × は null（装備不可）
  const weaponTypes = byId(raw.weaponTypes.map((r) => ({
    id: r.id, name: r.name, elements: splitList(r.elements), hands: toNumber(r.hands, 1),
    powerMul: toNumber(r.power_mul, 1), spdMod: toNumber(r.spd_mod, 0), critBonus: toNumber(r.crit_bonus, 0),
    defPierce: toNumber(r.def_pierce, 0), hits: splitList(r.hits).map(Number), feature: r.feature,
    attackStat: r.attack_stat || 'phys',
    traits: parseJsonCell(r.traits_json, `weapon_types.csv の ${r.id}`),
    // 二刀流はCSVで指定。古い追加データには従来の判定を残す。
    dualWield: r.dual_wield != null && r.dual_wield !== ''
      ? r.dual_wield === '1' || r.dual_wield === 'true'
      : toNumber(r.hands, 1) === 1 && !String(r.feature).includes('二刀流はできない'),
  })));
  const armorWeights = byId(raw.armorWeights.map((r) => ({
    id: r.id, name: r.name, defResMul: toNumber(r.def_res_mul, 1), spdMod: toNumber(r.spd_mod, 0), evasionBonus: toNumber(r.evasion_bonus, 0),
  })));
  const equipment = byId([
    ...raw.equipment.map((r) => ({
      id: r.id, name: r.name, slot: r.slot, kind: r.weapon_type_or_kind || null, armorWeight: r.armor_weight || null,
      itemLv: toNumber(r.item_lv, 1), star: toNumber(r.star, 1), source: r.source, unique: false,
    })),
    ...(raw.setItems ?? []).map((r) => ({
      id: r.id, name: r.name, slot: r.slot, kind: r.kind || null, armorWeight: r.armor_weight || null,
      itemLv: toNumber(r.item_lv, 1), star: toNumber(r.star, 1), source: r.source, setId: r.set_id,
      fixedEffects: parseEffects(r.fixed_effects),
    })),
    // 固有装備（ボス・賞金首が落とす）も同じ表で引けるようにする
    ...(raw.uniques ?? []).map((r) => ({
      id: r.id, name: r.name, slot: r.slot, kind: r.kind || null, armorWeight: r.armor_weight || null,
      itemLv: toNumber(r.item_lv, 1), star: toNumber(r.star, 1), source: r.source, unique: true,
      dropRate: toNumber(r.drop_rate, 0), fixedEffects: parseEffects(r.fixed_effects),
    })),
  ]);
  // 専用レシピは通常装備を素体に、武器・防具・マント・装飾品を独立したIDで生成する。
  // 旧レシピは base_equipment_id がない場合も既存の武器選択方式で読める。
  for (const r of raw.recipes ?? []) {
    if (equipment.has(r.id)) throw new Error(`制作レシピIDが既存装備と重複：${r.id}`);
    const cap = Number((raw.facilityRanks ?? []).find((x) => x.rank === r.workshop_rank)?.craft_item_lv);
    const base = r.base_equipment_id
      ? equipment.get(r.base_equipment_id)
      : [...equipment.values()].filter((def) => def.slot === 'weapon' && def.kind === r.weapon_type && def.itemLv <= cap && !def.unique)
        .sort((a, b) => b.itemLv - a.itemLv)[0];
    if (!base || (r.slot && base.slot !== r.slot) || base.unique || base.setId) {
      throw new Error(`制作レシピの素体が不正：${r.id}（${r.base_equipment_id || r.weapon_type}）`);
    }
    equipment.set(r.id, {
      ...base, id: r.id, name: r.name, source: '専用制作', unique: false,
      addedElement: r.added_element || null, fixedEffects: parseEffects(r.fixed_effects),
      recipeDescription: r.description || '', recipeId: r.id,
    });
  }
  const aptTable = (rows) => new Map(rows.map((r) => [r.job_id, r]));

  return {
    balance: raw.balance,
    jobs,
    jobsById: byId(jobs),
    aptitude,
    jobWeaponApt: aptTable(raw.jobWeaponApt),
    jobArmorApt: aptTable(raw.jobArmorApt),
    weaponTypes,
    armorWeights,
    equipment,
    icons: raw.icons.map((r) => ({ id: r.id, category: r.category, icon: r.icon })),
    rarities: raw.rarities.map((r) => ({ id: r.id, name: r.name })),
    jobUnlocks: byId(raw.jobUnlocks ?? [], 'job_id'),
    recipes: raw.recipes ?? [],
    alchemyRecipes: raw.alchemyRecipes ?? [],
    enhanceRates: raw.enhanceRates ?? [],
    enchantGrades: raw.enchantGrades ?? [],
    enchantSources: raw.enchantSources ?? [],
    facilityRanks: raw.facilityRanks ?? [],
    facilityEffects: raw.facilityEffects ?? [],
    kokuinSlots: raw.kokuinSlots ?? [],
    runeEffects: byId(raw.runeEffects ?? []),
    sets: byId(raw.sets ?? []),
    questChains: raw.questChains ?? [],
    ...buildBattleData(raw),
  };
}

/** `STR:4|特効:beast:15` → { STR: 4, '特効:beast': 15 } */
export function parseEffects(cell) {
  const out = {};
  for (const part of splitList(cell)) {
    const bits = part.split(':').map((x) => x.trim());
    const value = Number(bits.pop());
    out[bits.join(':')] = (out[bits.join(':')] ?? 0) + value;
  }
  return out;
}

/**
 * 強い個体の冠の効果：`atk_mul:1.25|element:ice|status:freeze:0.2`
 * → { muls: { atk_mul: 1.25 }, element: 'ice', status: { id: 'freeze', rate: 0.2 }, other: { eva: 0.15 } }
 */
export function parseEliteMods(cell) {
  const out = { muls: {}, element: null, status: null, other: {} };
  for (const part of splitList(cell)) {
    const [key, a, b] = part.split(':').map((x) => x.trim());
    if (key === 'element') out.element = a;
    else if (key === 'status') out.status = { id: a, rate: Number(b) };
    else if (key.endsWith('_mul')) out.muls[key] = Number(a);
    else out.other[key] = Number(a);
  }
  return out;
}

function parseJsonCell(text, where) {
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new Error(`${where} の JSON が読めない`); }
}

/** 戦闘で使うデータ（モンスター・属性・状態異常・スキル・道具・ダンジョン） */
function buildBattleData(raw) {
  if (!raw.monsters) return {};
  const statusEffects = raw.statusEffects.map((r) => ({
    id: r.id, name: r.name, group: r.group, kind: r.kind, value: toNumber(r.value, 0), turns: toNumber(r.turns, 1),
    persists: r.persists_after_battle === '1', cure: r.cure,
  }));
  const monsters = raw.monsters.map((r) => ({
    id: r.id, name: r.name, icon: r.icon, rank: toNumber(r.dungeon_rank, 1), dungeons: splitList(r.dungeons),
    types: splitList(r.types), weak: splitList(r.weak), resist: splitList(r.resist),
    hpMul: toNumber(r.hp_mul, 1), atkMul: toNumber(r.atk_mul, 1), defMul: toNumber(r.def_mul, 1), resMul: toNumber(r.res_mul, 1), spdMul: toNumber(r.spd_mul, 1),
    magicRate: toNumber(r.magic_rate, 0), status: r.status || null, statusRate: toNumber(r.status_rate, 0),
    attackElement: r.attack_element && r.attack_element !== 'none' ? r.attack_element : null,
    season: r.season, replaces: r.replaces || null, isBoss: r.is_boss === '1', role: r.role,
    materialCommon: r.material_common, materialRare: r.material_rare,
  }));
  const skills = raw.skills.map((r) => ({
    id: r.id, job: r.job, path: r.path, stage: toNumber(r.stage, 1), name: r.name, kind: r.kind,
    cost: toNumber(r.cost, 0), mp: toNumber(r.mp, 0), apToLearn: toNumber(r.ap_to_learn, 0), isFinal: r.is_final === '1',
    elements: splitList(r.element).filter((e) => e !== 'none'),
    effect: parseJsonCell(r.effect_json, `skills.csv の ${r.id}`),
  }));
  const items = raw.items.map((r) => ({
    id: r.id, name: r.name, price: toNumber(r.price, 0), shopRank: toNumber(r.shop_rank, 1), effect: r.effect,
    value: toNumber(r.value, null), valueText: r.value, target: r.target, description: r.description, turns: toNumber(r.turns, null), source: r.source,
  }));
  const elitePrefixes = raw.elitePrefixes.map((r) => ({
    id: r.id, prefix: r.prefix, mods: parseEliteMods(r.mods),
    description: r.description, minStar: toNumber(r.min_star, 1), appearRate: toNumber(r.appear_rate, 0), rewardMul: toNumber(r.reward_mul, 1),
  }));
  const dungeons = raw.dungeons.map((r) => ({
    id: r.id, rank: toNumber(r.rank, 1), name: r.name, kind: r.kind, days: toNumber(r.days, 1), floors: toNumber(r.floors, 1),
    itemLvMin: toNumber(r.item_lv_min, 1), itemLvMax: toNumber(r.item_lv_max, 1), returnPointFloor: toNumber(r.return_point_floor, 0),
    bossId: r.boss_id, enemyMul: toNumber(r.enemy_mul, 1), incomeMul: toNumber(r.income_mul, 1), character: r.character,
  }));
  const floors = raw.dungeonFloors.map((r) => ({
    dungeonId: r.dungeon_id, floor: toNumber(r.floor, 1), enemyLevel: toNumber(r.enemy_level, 1), battles: toNumber(r.battles, 1),
    enemiesPerBattle: toNumber(r.enemies_per_battle, 1), lastBattleIsBoss: r.last_battle_is_boss === '1', returnPointAfter: r.return_point_after === '1',
  }));
  const loot = raw.dropTables ? {
    dropTables: byId(raw.dropTables.map((r) => ({
      dungeonId: r.dungeon_id, gearRate: toNumber(r.gear_drop_rate_per_battle, 0), materialRate: toNumber(r.material_rate_per_enemy, 0),
      rareRate: toNumber(r.rare_material_rate, 0), goldShare: toNumber(r.gold_share_of_run_income, 0), bossGoldMul: toNumber(r.boss_gold_mul, 1),
      bossGearDrop: toNumber(r.boss_gear_drop, 0), bountyChance: toNumber(r.bounty_chance_per_run, 0),
    })), 'dungeonId'),
    economy: new Map(raw.economy.map((r) => [toNumber(r.dungeon_rank, 1), Object.fromEntries(Object.entries(r).map(([k, v]) => [k, toNumber(v, v)]))])),
    materials: byId(raw.materials.map((r) => ({
      id: r.id, name: r.name, rank: toNumber(r.rank, 1), kind: r.kind, sourceMonster: r.source_monster, season: r.season, element: r.element,
    }))),
    affixes: raw.affixes.map((r) => ({
      slot: r.slot, stat: r.stat, min: toNumber(r.min, 0), max: toNumber(r.max, 0), scales: r.scales_with_item_lv === '1', weight: toNumber(r.weight, 1),
    })),
    rarityTable: raw.rarities.map((r) => ({ id: r.id, name: r.name, weight: toNumber(r.drop_weight_pct, 0), effects: toNumber(r.random_effects, 0) })),
    backpackTiers: raw.backpack.map((r) => ({ tier: toNumber(r.tier, 1), slots: toNumber(r.slots, 12), gold: toNumber(r.gold, 0), materials: r.materials, shopRank: toNumber(r.shop_rank, 1) })),
    ranks: raw.ranks.map((r) => ({
      id: r.id, title: r.title, pointsRequired: toNumber(r.points_required, 0), maxDungeonRank: toNumber(r.max_dungeon_rank, 1),
      needsBossClear: r.needs_boss_clear === '1', needsExam: r.needs_exam === '1', questBonus: toNumber(r.quest_bonus, 0),
      shopDiscount: toNumber(r.shop_discount, 0), perk: r.perk,
    })),
  } : {};
  if (loot.materials && raw.enhanceRates?.length) {
    loot.materials.set('enhancement_stone', { id: 'enhancement_stone', name: '強化石', rank: 1, kind: 'workshop' });
    for (const rarity of [...raw.rarities, { id: 'unique', name: 'ユニーク' }, { id: 'set', name: 'セット' }]) {
      const id = 'fragment_' + rarity.id;
      loot.materials.set(id, { id, name: rarity.name + 'の欠片', rank: 1, kind: 'workshop' });
    }
  }
  const town = raw.quests ? {
    quests: raw.quests.map((r) => ({
      id: r.id, type: r.type, rank: toNumber(r.rank, 1), target: r.target, countMin: toNumber(r.count_min, 1), countMax: toNumber(r.count_max, 1),
      rewardGoldPct: toNumber(r.reward_gold_pct_of_run_income, 0), rewardItem: r.reward_item ?? '', rankPoints: toNumber(r.rank_points, 0),
    })),
    questTypes: raw.questTypes.map((r) => ({ id: r.id, name: r.name })),
    innRooms: raw.innRooms.map((r) => ({
      innRank: toNumber(r.inn_rank, 1), maxHpPct: toNumber(r.max_hp_pct, 0), maxMpPct: toNumber(r.max_mp_pct, 0),
      firstBattleSpdPct: toNumber(r.first_battle_spd_pct, 0), statusResistPct: toNumber(r.status_resist_pct, 0), description: r.description,
    })),
    seasons: raw.seasons.map((r) => ({ id: r.id, name: r.name, monthInYear: toNumber(r.month_in_year, 1) })).sort((a, b) => a.monthInYear - b.monthInYear),
    facilities: raw.facilities.map((r) => ({ id: r.id, name: r.name, role: r.role })),
  } : {};
  const growth = raw.commonTree ? {
    commonTree: raw.commonTree.map((r) => ({ id: r.id, name: r.name, level: toNumber(r.level, 1), points: toNumber(r.points, 1), kind: r.kind, effect: r.effect })),
    jobMastery: raw.jobMastery.map((r) => ({ job: r.job, condition: r.condition, bonus: r.bonus_all_jobs })),
    exams: (raw.exams ?? []).map((r) => ({
      id: r.id, kind: r.kind, questions: toNumber(r.questions, 20), passRate: toNumber(r.pass_rate, 0.8), retryAfterDays: toNumber(r.retry_after_days, 1), unlock: r.unlock,
    })),
  } : {};
  return {
    ...loot,
    ...town,
    ...growth,
    monsters: byId(monsters),
    monsterTypes: byId(raw.monsterTypes.map((r) => ({ id: r.id, name: r.name }))),
    elements: byId(raw.elements.map((r) => ({ id: r.id, name: r.name, kind: r.kind }))),
    statusEffects: byId(statusEffects),
    statusByName: new Map(statusEffects.map((s) => [s.name, s])),
    skills: byId(skills),
    items: byId(items),
    elitePrefixes,
    dungeons: byId(dungeons),
    dungeonFloors: floors,
  };
}

let cached = null;
/** ブラウザで data/ から読む（1回だけ） */
export function loadGameData() {
  if (!cached) {
    cached = (async () => {
      const entries = await Promise.all(Object.entries(FILES).map(async ([key, name]) => {
        const f = name.endsWith('.json') ? (await loadJson(name)).data : (await loadCsv(name)).rows;
        return [key, f];
      }));
      const raw = Object.fromEntries(entries);
      const expansion = (await loadOptional('extra_game_data.json'))?.data;
      for (const key of ['jobsAdvanced', 'jobUnlocks', 'jobWeaponApt', 'jobArmorApt', 'skills', 'uniques', 'monsters', 'dungeons', 'dungeonFloors', 'dropTables', 'materials', 'jobMastery']) {
        if (Array.isArray(expansion?.[key])) raw[key] = [...(raw[key] ?? []), ...expansion[key]];
      }
      return buildGameData(raw);
    })();
  }
  return cached;
}

export const GAME_FILES = FILES;
