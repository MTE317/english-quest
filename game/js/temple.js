import { parseAmounts } from './csv.js';
import { maxHp } from './character.js?v=balance-builds-1';

export function consumeMaterials(game, requirements) {
  const stock = game.storage.materials;
  for (const [id, count] of Object.entries(requirements)) {
    if ((stock[id] ?? 0) < count) throw new Error('素材が足りません。');
  }
  for (const [id, count] of Object.entries(requirements)) {
    stock[id] -= count;
    if (!stock[id]) delete stock[id];
  }
}

export function unlockJob(data, game, jobId) {
  const rule = data.jobUnlocks.get(jobId);
  game.unlockedJobs ??= [];
  if (rule?.method !== '素材' || game.unlockedJobs.includes(jobId)) throw new Error('このジョブは解放できません。');
  consumeMaterials(game, Object.fromEntries(parseAmounts(rule.materials).map(({ id, count }) => [id, count])));
  game.unlockedJobs.push(jobId);
  return `${data.jobsById.get(jobId).name}を解放した！`;
}

/** 発見回数は既存の踏破記録から読む。保証は公開中級職の指定行だけに適用する。 */
export function jobDiscoveryProgress(data, game, jobId) {
  const rule = data.jobUnlocks.get(jobId);
  if (rule?.method !== '発見') return null;
  const count = Number(game.cleared?.[rule.discover_dungeon] ?? 0);
  const target = Number(rule.discover_guarantee_clears);
  const guarantee = data.jobsById.get(jobId)?.tier === 'mid' && Number.isFinite(target) && target >= 1
    ? Math.floor(target) : null;
  return { dungeonId: rule.discover_dungeon, clears: Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0, guarantee };
}

export function discoverJobs(data, game, dungeonId, rng = Math.random) {
  game.unlockedJobs ??= [];
  game.notices ??= [];
  for (const rule of data.jobUnlocks.values()) {
    if (rule.method !== '発見' || rule.discover_dungeon !== dungeonId || game.unlockedJobs.includes(rule.job_id)) continue;
    const progress = jobDiscoveryProgress(data, game, rule.job_id);
    // この関数はボス撃破直後、今回の踏破数を帰還時に加える前に呼ばれる。
    const guaranteed = progress.guarantee != null && progress.clears + 1 >= progress.guarantee;
    if (!guaranteed && rng() >= Number(rule.discover_chance_after_boss)) continue;
    game.unlockedJobs.push(rule.job_id);
    game.notices.push(`${data.jobsById.get(rule.job_id).name}を発見した！`);
  }
}

export function cureAtTemple(data, game, member) {
  if (!member.persist?.length) throw new Error('治療する状態異常がありません。');
  const cost = data.balance.temple?.cure_gold ?? data.economy.get(Math.max(1, ...Object.keys(game.cleared ?? {}).map((id) => data.dungeons.get(id)?.rank ?? 1))).curse_cure;
  if (game.gold < cost) throw new Error(`治療には ${cost} G が必要です。`);
  game.gold -= cost;
  member.persist = [];
  return `状態異常を治療した（${cost} G）。`;
}

export function openRuneSlot(data, game, member, awakened) {
  if (!Object.keys(awakened).length) throw new Error('先にルーンストーンを覚醒させてください。');
  const entry = data.kokuinSlots.find((r) => Number(r.slot) === (member.runeSlots ?? 0) + 1);
  if (!entry) throw new Error('刻印枠は最大です。');
  const cost = Number(entry.gold);
  if (game.gold < cost) throw new Error(`刻印枠には ${cost} G が必要です。`);
  consumeMaterials(game, Object.fromEntries(parseAmounts(entry.materials).map(({ id, count }) => [id, count])));
  game.gold -= cost;
  member.runeSlots = Number(entry.slot);
  return `刻印枠を ${entry.slot} 枠に増やした。`;
}

export function chooseRuneEffect(data, game, stone, effect, awakened) {
  if (!awakened[stone.id] || !data.runeEffects.has(effect)) throw new Error('その刻印効果は選べません。');
  game.runeEffects ??= {};
  const current = game.runeEffects[stone.id];
  if (current === effect) return '刻印効果は同じです。';
  const cost = current ? runeChangeCost(data, stone) : 0;
  if (game.gold < cost) throw new Error(`刻み直しには ${cost} G が必要です。`);
  game.gold -= cost;
  game.runeEffects[stone.id] = effect;
  return `刻印効果を${data.runeEffects.get(effect).label_ja}にした。`;
}

export function runeChangeCost(data, stone) {
  return data.balance.kokuin?.rechoose_gold ?? 100 * stone.star;
}

export function equipRune(game, member, stoneId) {
  member.runes ??= [];
  if (member.runes.includes(stoneId)) {
    member.runes = member.runes.filter((id) => id !== stoneId);
    return 'ルーンストーンを外した。';
  }
  if (!game.runeEffects?.[stoneId]) throw new Error('先に石の効果を選んでください。');
  if (member.runes.length >= (member.runeSlots ?? 0)) throw new Error('刻印枠が足りません。');
  if (game.party.some((m) => m.runes?.includes(stoneId))) throw new Error('ほかの仲間が装着しています。');
  member.runes.push(stoneId);
  return 'ルーンストーンを装着した。';
}

export function updateRuneModifiers(data, game, lex, store, scheduler, day) {
  const statNames = { STATUS_RES: 'sres', EXP: 'xp', GOLD: 'gold' };
  const stones = new Map(lex.stones.map((stone) => [stone.id, stone]));
  for (const m of game.party) {
    const counts = new Map();
    const mods = {};
    for (const id of m.runes ?? []) {
      if (!store.awakened[id]) continue;
      const stone = stones.get(id);
      const effect = data.runeEffects.get(game.runeEffects?.[id]);
      if (!stone || !effect) continue;
      const stat = statNames[effect.stat] ?? effect.stat.toLowerCase();
      const words = lex.wordsByStone.get(id) ?? [];
      const shines = words.every((w) => !scheduler.isDue(store.get(w.id), day));
      const count = (counts.get(effect.id) ?? 0) + 1;
      counts.set(effect.id, count);
      const bonus = Number(effect.per_star) * stone.star * (1 + (shines ? Number(effect.glow_bonus) : 0));
      mods[stat] = (mods[stat] ?? 0) + bonus;
      if (count === Number(effect.resonance_count)) mods[stat] += Number(effect.resonance_bonus);
    }
    m.runeMods = mods;
    m.hp = Math.min(m.hp, maxHp(data, m));
  }
}
