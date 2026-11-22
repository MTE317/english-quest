// 戦闘の報酬（お金・素材・装備）とバックパック。
// 式が data にないものは sim/world.py と同じ値を LOOT_FORMULAS に置く（docs/requests.md で依頼済み）。
import { evaluate } from './expr.js';
import { makeGear } from './character.js?v=balance-builds-1';

export const LOOT_FORMULAS = Object.freeze({
  gold_per_enemy: 'run_income * income_mul * gold_share / reward_budget', // 実際の遠征経路へ一周の基準収入を分配
  gold_rand: [0.8, 1.2],
  boss_common_materials: [1, 2], // ボスはふだんの素材を1〜2個
  boss_rare_rate: 0.3,
  // 装備の部位の割合（武器・頭体腕・マント・アクセサリー）
  slot_share: { weapon: 0.35, armor: 0.45, cloak: 0.08, accessory: 0.12 },
  // 装備Lvは、そのダンジョンの範囲のうち、奥の階ほど高い
  rarity_floor_bonus: 0.08, // 階ごと（レア以上の重みを増やす）
  rarity_rank_bonus: 0.15, // ★ごと
  affix_scale: '1 + itemLv / 12', // scales_with_item_lv の効果
  affix_high_rarity_mul: 1.15, // レアリティの順番が5番目以上（アーティファクト以上）
  stack_max: 99, // 素材は1種類で1枠、99個まで（docs/checklist.md 3章）
  item_max: 10, // 道具は種類ごとに10個まで
});

/** 乱数（0〜1）を返す関数 rng を受け取る */
const between = (rng, [lo, hi]) => lo + (hi - lo) * rng();
function weighted(rng, arr, w) {
  const total = arr.reduce((a, x) => a + w(x), 0);
  let r = rng() * total;
  for (const x of arr) { r -= w(x); if (r <= 0) return x; }
  return arr[arr.length - 1];
}

// ---------------- お金と素材 ----------------
/** 遠征の長さを変えても一周の基準収入を保つ。旧セーブは開始時の経路で計算する。 */
export function goldRewardBudget(data, dungeonId, route = null) {
  const rows = route ?? data.dungeonFloors.filter((row) => row.dungeonId === dungeonId);
  const bossWeight = data.dropTables.get(dungeonId)?.bossGoldMul ?? 1;
  const escorts = Number(/boss\s*\+\s*(\d+)/.exec(String(data.balance.dungeon?.boss_battle ?? ''))?.[1] ?? 0);
  return Math.max(1, rows.reduce((sum, row) => {
    const bosses = Number(row.lastBattleIsBoss);
    return sum + Math.max(0, row.battles - bosses) * row.enemiesPerBattle + bosses * (bossWeight + escorts);
  }, 0));
}

/** 倒した敵1体ぶんのお金 */
export function goldForEnemy(data, dungeonId, enemy, rng, route = null) {
  const dg = data.dungeons.get(dungeonId);
  const dt = data.dropTables.get(dungeonId);
  const econ = data.economy.get(dg.rank);
  const formula = data.balance.loot?.gold_per_enemy ?? LOOT_FORMULAS.gold_per_enemy;
  let g = evaluate(formula, { run_income: econ.run_income, income_mul: dg.incomeMul, gold_share: dt.goldShare,
    reward_budget: goldRewardBudget(data, dungeonId, route) });
  if (enemy.boss) g *= dt.bossGoldMul;
  if (enemy.eliteId) g *= data.elitePrefixes.find((p) => p.id === enemy.eliteId)?.rewardMul ?? 1;
  return Math.max(1, Math.round(g * between(rng, LOOT_FORMULAS.gold_rand)));
}

/** 倒した敵1体ぶんの素材 → [{ id, count }] */
export function materialsForEnemy(data, dungeonId, enemy, rng, dropBonus = 0) {
  const dt = data.dropTables.get(dungeonId);
  const m = data.monsters.get(enemy.monsterId);
  const out = [];
  if (enemy.boss) {
    const [lo, hi] = LOOT_FORMULAS.boss_common_materials;
    if (m.materialCommon) out.push({ id: m.materialCommon, count: lo + Math.floor(rng() * (hi - lo + 1)) });
    if (m.materialRare && rng() < LOOT_FORMULAS.boss_rare_rate) out.push({ id: m.materialRare, count: 1 });
  } else {
    if (m.materialCommon && rng() < dt.materialRate * (1 + dropBonus)) out.push({ id: m.materialCommon, count: 1 });
    if (m.materialRare && rng() < dt.rareRate) out.push({ id: m.materialRare, count: 1 });
  }
  return out.filter((x) => data.materials.has(x.id));
}

// ---------------- 装備 ----------------
function rollRarity(data, dungeonId, floor, rng) {
  const dg = data.dungeons.get(dungeonId);
  const bonus = 1 + LOOT_FORMULAS.rarity_floor_bonus * (floor - 1) + LOOT_FORMULAS.rarity_rank_bonus * (dg.rank - 1);
  const table = data.rarityTable.map((r, i) => ({ ...r, i, w: r.weight * (i >= 2 ? bonus : 1) }));
  return weighted(rng, table, (r) => r.w);
}

/** ランダム効果を n 個（同じ系統は1回まで） */
export function rollAffixes(data, slot, n, itemLv, rarityIndex, rng) {
  const key = ['head', 'body', 'arm'].includes(slot) ? 'armor' : slot;
  const pool = data.affixes.filter((a) => a.slot === key && a.stat !== 'ELEMENT');
  const out = {};
  for (let k = 0; k < n && pool.length; k++) {
    const a = weighted(rng, pool, (x) => x.weight);
    pool.splice(pool.indexOf(a), 1);
    let v = a.min + (a.max - a.min) * rng();
    if (a.scales) v *= evaluate(LOOT_FORMULAS.affix_scale, { itemLv });
    if (rarityIndex >= 5) v *= LOOT_FORMULAS.affix_high_rarity_mul;
    let stat = a.stat;
    if (stat === 'TYPE_BONUS') stat = `特効:${[...data.monsterTypes.keys()][Math.floor(rng() * data.monsterTypes.size)]}`;
    out[stat] = Math.round(((out[stat] ?? 0) + v) * 10) / 10;
  }
  return out;
}

/** 落ちた装備を1つ作る（装備Lvはダンジョンの範囲で、奥の階ほど高い） */
export function rollGearDrop(data, game, dungeonId, floor, rng) {
  const dg = data.dungeons.get(dungeonId);
  const top = dg.itemLvMin + (dg.itemLvMax - dg.itemLvMin) * Math.min(1, floor / dg.floors);
  const share = LOOT_FORMULAS.slot_share;
  const kind = weighted(rng, Object.keys(share), (k) => share[k]);
  const slots = kind === 'armor' ? ['head', 'body', 'arm'] : [kind];
  const cands = [...data.equipment.values()].filter((e) => !e.unique && !e.setId && slots.includes(e.slot)
    && e.source.includes('ドロップ') && e.itemLv >= dg.itemLvMin && e.itemLv <= Math.max(top, dg.itemLvMin));
  // 専用制作装備をランダムドロップに混ぜない。候補不足時もドロップ対象だけを探す。
  const pool = cands.length ? cands : [...data.equipment.values()].filter((e) =>
    !e.unique && !e.setId && e.source.includes('ドロップ') && slots.includes(e.slot) && e.itemLv <= dg.itemLvMax);
  // いちばん高い装備Lvのものを多めに
  const maxLv = Math.max(...pool.map((e) => e.itemLv));
  const def = weighted(rng, pool, (e) => (e.itemLv === maxLv ? 2 : 1));
  const rar = rollRarity(data, dungeonId, floor, rng);
  return makeGear(game, def.id, { rarity: rar.id, affixes: rollAffixes(data, def.slot, rar.effects, def.itemLv, rar.i, rng) });
}

/** ボスの固有装備（uniques.csv の drop_rate） */
export function rollUniqueDrop(data, game, monsterId, rng) {
  const u = [...data.equipment.values()].find((e) => e.unique && e.source === monsterId);
  if (!u || rng() >= u.dropRate) return null;
  return makeGear(game, u.id, { rarity: 'unique', affixes: { ...u.fixedEffects } });
}

/**
 * 1回の戦闘に勝ったときの報酬
 * @returns { gold, materials: [{id,count}], gear: [gear] }
 */
export function rollBattleLoot(data, game, dungeonId, floor, enemies, rng, { dropBonus = 0, route = null } = {}) {
  const dt = data.dropTables.get(dungeonId);
  let gold = 0;
  const mats = {};
  const gear = [];
  // 短剣の素材ドロップ補正はパーティ内で重複しない。他のドロップ補正とは加算。
  const daggerMul = Math.max(1, ...(game.party ?? []).filter((member) => member.hp > 0).flatMap((member) =>
    ['weapon', 'offhand'].map((slot) => {
      const def = data.equipment.get(member.equip?.[slot]?.id);
      return data.weaponTypes.get(def?.kind)?.traits.material_drop_mul ?? 1;
    })));
  const materialBonus = dropBonus + daggerMul - 1;
  for (const e of enemies) {
    gold += goldForEnemy(data, dungeonId, e, rng, route);
    for (const m of materialsForEnemy(data, dungeonId, e, rng, materialBonus)) mats[m.id] = (mats[m.id] ?? 0) + m.count;
  }
  const boss = enemies.find((e) => e.boss);
  if (rng() < (boss ? dt.bossGearDrop : dt.gearRate)) gear.push(rollGearDrop(data, game, dungeonId, floor, rng));
  for (const enemy of enemies.filter((e) => e.boss || e.bounty)) {
    const unique = rollUniqueDrop(data, game, enemy.monsterId, rng);
    if (unique) gear.push(unique);
  }
  const setOdds = data.balance.dungeon?.set_drop_rate ?? 0.05;
  const parts = [...data.equipment.values()].filter((def) => def.setId && def.star === data.dungeons.get(dungeonId).rank);
  if (boss && parts.length && rng() < setOdds) {
    const def = parts[Math.floor(rng() * parts.length)];
    gear.push(makeGear(game, def.id, { rarity: 'set', affixes: { ...def.fixedEffects } }));
  }
  return { gold, materials: Object.entries(mats).map(([id, count]) => ({ id, count })), gear };
}

// ---------------- バックパック ----------------
export function backpackSlots(data, game) {
  return data.backpackTiers.find((t) => t.tier === game.backpackTier)?.slots ?? data.backpackTiers[0].slots;
}

/** 使っている枠の数（装備1個で1枠、素材は1種類で1枠＝99個ごと） */
export function backpackUsed(pack) {
  const mats = Object.values(pack.materials).reduce((a, n) => a + Math.ceil(n / LOOT_FORMULAS.stack_max), 0);
  return pack.gear.length + mats;
}

/** 入れるのにもう1枠いるか */
function needsSlot(pack, entry) {
  if (entry.type === 'gear') return true;
  const cur = pack.materials[entry.id] ?? 0;
  return Math.ceil((cur + entry.count) / LOOT_FORMULAS.stack_max) > Math.ceil(cur / LOOT_FORMULAS.stack_max);
}

/**
 * バックパックに入れる。入りきらないものは返す（入れ替えるかあきらめるかをプレイヤーが選ぶ）
 * @param entries [{ type: 'gear', gear } | { type: 'material', id, count }]
 * @returns 入らなかったもの
 */
export function addToBackpack(data, game, pack, entries) {
  const left = [];
  const cap = backpackSlots(data, game);
  for (const entry of entries) {
    if (needsSlot(pack, entry) && backpackUsed(pack) >= cap) { left.push(entry); continue; }
    if (entry.type === 'gear') pack.gear.push(entry.gear);
    else pack.materials[entry.id] = (pack.materials[entry.id] ?? 0) + entry.count;
  }
  return left;
}

/** バックパックの中身を1つ捨てて、拾ったものを入れる */
export function swapIntoBackpack(data, game, pack, drop, entry) {
  if (drop.type === 'gear') pack.gear = pack.gear.filter((g) => g.uid !== drop.uid);
  else delete pack.materials[drop.id];
  const left = addToBackpack(data, game, pack, [entry]);
  return left.length === 0;
}

/** 町に帰ったら、バックパックの中身はすべて倉庫へ */
export function unloadBackpack(game, pack) {
  for (const g of pack.gear) game.storage.gear.push(g);
  for (const [id, n] of Object.entries(pack.materials)) game.storage.materials[id] = (game.storage.materials[id] ?? 0) + n;
  pack.gear = [];
  pack.materials = {};
}

/** 道具を足す（種類ごとに上限まで）→ 入らなかった数 */
export function addItem(game, id, count) {
  const cur = game.items[id] ?? 0;
  const room = Math.max(0, LOOT_FORMULAS.item_max - cur);
  const n = Math.min(room, count);
  if (n > 0) game.items[id] = cur + n;
  return count - n;
}
