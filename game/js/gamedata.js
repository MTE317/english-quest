// ゲームで使う data/ のファイルをまとめて読み、ID で引ける形にする。
import { loadCsv, loadJson } from './data.js';
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
  });
  const jobs = [...raw.jobs.map((r) => job(r, 'base')), ...raw.jobsMid.map((r) => job(r, 'mid'))];

  const aptitude = new Map(raw.aptitude.map((r) => [r.grade, toNumber(r.multiplier, null)])); // × は null（装備不可）
  const weaponTypes = byId(raw.weaponTypes.map((r) => ({
    id: r.id, name: r.name, elements: splitList(r.elements), hands: toNumber(r.hands, 1),
    powerMul: toNumber(r.power_mul, 1), spdMod: toNumber(r.spd_mod, 0), critBonus: toNumber(r.crit_bonus, 0),
    defPierce: toNumber(r.def_pierce, 0), hits: splitList(r.hits).map(Number), feature: r.feature,
    // 二刀流：dual_wield 列があればそれを使う。なければ片手武器は可、ただし説明に「二刀流はできない」とあれば不可
    dualWield: r.dual_wield != null && r.dual_wield !== ''
      ? r.dual_wield === '1' || r.dual_wield === 'true'
      : toNumber(r.hands, 1) === 1 && !String(r.feature).includes('二刀流はできない'),
  })));
  const armorWeights = byId(raw.armorWeights.map((r) => ({
    id: r.id, name: r.name, defResMul: toNumber(r.def_res_mul, 1), spdMod: toNumber(r.spd_mod, 0), evasionBonus: toNumber(r.evasion_bonus, 0),
  })));
  const equipment = byId(raw.equipment.map((r) => ({
    id: r.id, name: r.name, slot: r.slot, kind: r.weapon_type_or_kind || null, armorWeight: r.armor_weight || null,
    itemLv: toNumber(r.item_lv, 1), star: toNumber(r.star, 1), source: r.source,
  })));
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
      return buildGameData(Object.fromEntries(entries));
    })();
  }
  return cached;
}

export const GAME_FILES = FILES;
