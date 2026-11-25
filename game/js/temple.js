import { parseAmounts } from './csv.js?v=paid-skills-1';

export function recordStoredMaterials(game) {
  game.discoveredMaterials ??= {};
  for (const [id, quantity] of Object.entries(game.storage?.materials ?? {})) {
    if (quantity > 0) game.discoveredMaterials[id] = true;
  }
}

export function offeringRevealed(data, game, rule) {
  if (data.jobsById.get(rule.job_id)?.tier !== 'advanced' || rule.method !== '素材') return true;
  const [first] = parseAmounts(rule.materials);
  const key = rule.discovery_material || first?.id;
  return Boolean(key && (game.discoveredMaterials?.[key] || game.storage?.materials?.[key] > 0));
}

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
  if (!offeringRevealed(data, game, rule)) throw new Error('この儀式はまだ発見されていません。');
  recordStoredMaterials(game);
  consumeMaterials(game, Object.fromEntries(parseAmounts(rule.materials).map(({ id, count }) => [id, count])));
  game.unlockedJobs.push(jobId);
  return `${data.jobsById.get(jobId).name}を解放した！`;
}

export function unlockReportedHuntJobs(data, game, quest) {
  if (!['hunt', 'bounty'].includes(quest.type) || !quest.defeatedStatusIds?.length) return [];
  const messages = [];
  game.unlockedJobs ??= [];
  for (const rule of data.jobUnlocks.values()) {
    if (rule.method !== '討伐報告' || !quest.defeatedStatusIds.includes(rule.report_enemy_status)) continue;
    const job = data.jobsById.get(rule.job_id);
    if (!job?.publicRelease || game.unlockedJobs.includes(job.id)) continue;
    game.unlockedJobs.push(job.id);
    messages.push(`${job.name}を解放した！`);
  }
  return messages;
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
  delete member.persistState;
  return `状態異常を治療した（${cost} G）。`;
}

