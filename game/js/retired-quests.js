import { goldScale } from './gold.js?v=unified-ap-1';
// 廃止された24件の連続クエストの旧セーブを一度だけ精算する。
// 新規クエストや地域解放には使わず、受取済みの報酬は再付与しない。
const stageCount = rank => rank <= 4 ? 3 : rank <= 8 ? 4 : 5;
const incomeMultiplier = rank => rank <= 2 ? 2 : rank <= 5 ? 3 : rank <= 8 ? 4 : rank <= 11 ? 5 : 6;

export function retireLegacyQuestChains(data, game) {
  const records = game.chains;
  if (!records || typeof records !== 'object') return;
  game.retiredQuestChains ??= {};
  let totalGold = 0, totalPoints = 0, totalMaterials = 0;
  for (const [id, record] of Object.entries(records)) {
    if (Object.hasOwn(game.retiredQuestChains, id)) continue;
    const m = /^chain_(\d{2})_[12]$/.exec(id);
    const rank = Number(m?.[1]);
    let gold = 0, points = 0, materialId = null, materialCount = 0;
    if (m && rank >= 1 && rank <= 12 && !record?.claimed) {
      const stages = stageCount(rank);
      const completed = Math.min(stages, Math.max(0, Math.floor(Number(record?.step) || 0)));
      // 受付会話は除外し、探索・討伐などの達成段階を比例精算する。
      const ratio = Math.max(0, (completed - 1) / (stages - 1));
      gold = Math.floor(Math.max(0, Number(data.economy?.get(rank)?.run_income) || 0) / goldScale(data) * incomeMultiplier(rank) * ratio) * goldScale(data);
      points = Math.floor((rank + 4) * ratio);
      const rare = [...(data.materials?.values() ?? [])].filter(x => x.rank === rank && x.kind === 'rare' && !x.season)
        .sort((a, b) => a.id.localeCompare(b.id))[0];
      const quantity = Math.floor(3 * ratio);
      if (rare && quantity) {
        materialId = rare.id; materialCount = quantity;
        game.storage.materials[rare.id] = (game.storage.materials[rare.id] ?? 0) + quantity;
      }
      game.gold += gold;
      game.rankPoints = (game.rankPoints ?? 0) + points;
      totalGold += gold; totalPoints += points; totalMaterials += materialCount;
    }
    game.retiredQuestChains[id] = {
      ...(record ?? {}), retired: true,
      settlement: { gold, points, ...(materialId ? { materialId, materialCount } : {}) },
    };
  }
  delete game.chains;
  if (totalGold || totalPoints || totalMaterials) {
    game.notices ??= [];
    game.notices.push(`旧連続クエストの進行分を精算：+${totalGold} G・ポイント +${totalPoints}${totalMaterials ? `・素材 ×${totalMaterials}` : ''}。受領済みの報酬は保持しています。`);
  }
}

