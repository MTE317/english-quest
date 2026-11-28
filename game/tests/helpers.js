import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, stripBom } from '../js/csv.js';
import { buildLearningCatalog } from '../js/learning-catalog.js';

export const dataPath = (name) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
export const readCsv = (name) => parseCsv(readFileSync(dataPath(name), 'utf8'));
export const readJson = (name) => JSON.parse(stripBom(readFileSync(dataPath(name), 'utf8')));
export const realLearningCatalog = () => buildLearningCatalog({
  words: readCsv('learning/v1/words.csv').rows,
  phrases: readCsv('learning/v1/phrases.csv').rows,
  chunks: readCsv('learning/v1/chunks.csv').rows,
  categories: readCsv('learning/v1/categories.csv').rows,
  wordCategories: readCsv('learning/v1/word_categories.csv').rows,
  phraseCategories: readCsv('learning/v1/phrase_categories.csv').rows,
});
export const realLexicon = () => realLearningCatalog().lexicon;

export class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/** 決まった順の乱数 */
export function seededRng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
export const DAY = 86400000;
export const T0 = new Date(2026, 10, 21, 12, 0, 0).getTime();

import { buildGameData } from '../js/gamedata.js';
/** data/ から GameData を作る（ブラウザの loadGameData と同じ中身） */
export function realGameData({ world = false } = {}) {
  return buildGameData({
    balance: readJson('balance.json'),
    worldRoutes: world ? readJson('world_routes.json') : undefined,
    basicJobRules: readJson('basic_job_rules.json'),
    skillMigration: readJson('skill_migration.json'),
    jobs: readCsv('jobs.csv').rows,
    jobsMid: readCsv('jobs_mid.csv').rows,
    jobsPublicAdvanced: readCsv('jobs_advanced.csv').rows,
    aptitude: readCsv('aptitude.csv').rows,
    jobWeaponApt: readCsv('job_weapon_aptitude.csv').rows,
    jobArmorApt: readCsv('job_armor_aptitude.csv').rows,
    weaponTypes: readCsv('weapon_types.csv').rows,
    armorWeights: readCsv('armor_weights.csv').rows,
    equipment: readCsv('equipment.csv').rows,
    equipmentTiers: readCsv('equipment_tiers.csv').rows,
    recipes: readCsv('recipes.csv').rows,
    facilityRanks: readCsv('facility_ranks.csv').rows,
    icons: readCsv('appearance_icons.csv').rows,
    rarities: readCsv('rarities.csv').rows,
    monsters: readCsv('monsters.csv').rows,
    monsterStats: readCsv('monster_stats.csv').rows,
    monsterElites: readJson('monster_elites.json'),
    monsterTypes: readCsv('monster_types.csv').rows,
    elements: readCsv('elements.csv').rows,
    statusEffects: readCsv('status_effects.csv').rows,
    skills: readCsv('skills.csv').rows,
    items: readCsv('items.csv').rows,
    elitePrefixes: readCsv('elite_prefixes.csv').rows,
    dungeons: readCsv('dungeons.csv').rows,
    dungeonFloors: readCsv('dungeon_floors.csv').rows,
    dropTables: readCsv('drop_tables.csv').rows,
    economy: readCsv('economy_by_rank.csv').rows,
    materials: readCsv('materials.csv').rows,
    affixes: readCsv('affixes.csv').rows,
    enhanceRates: readCsv('enhance_rates.csv').rows,
    enchantGrades: readCsv('enchant_grades.csv').rows,
    enchantOverrides: readCsv('enchant_overrides.csv').rows,
    enchantSources: readCsv('enchant_sources.csv').rows,
    uniques: readCsv('uniques.csv').rows,
    backpack: readCsv('backpack.csv').rows,
    ranks: readCsv('adventurer_ranks.csv').rows,
    quests: readCsv('quests.csv').rows,
    questTypes: readCsv('quest_types.csv').rows,
    innRooms: readCsv('inn_rooms.csv').rows,
    seasons: readCsv('seasons.csv').rows,
    facilities: readCsv('facilities.csv').rows,
    commonTree: readCsv('common_tree.csv').rows,
    jobMastery: readCsv('job_mastery.csv').rows,
    exams: readCsv('exams.csv').rows,
    jobUnlocks: readCsv('job_unlocks.csv').rows,
  });
}

