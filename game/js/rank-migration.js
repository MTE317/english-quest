const LEGACY_RANKS = [
  ['R01', 'E', 0, 1], ['R01+', 'E+', 6, 1],
  ['R02', 'D', 12, 2], ['R02+', 'D', 20, 2],
  ['R03', 'D+', 28, 3], ['R03+', 'D+', 38, 3],
  ['R04', 'C', 48, 4], ['R04+', 'C', 60, 4],
  ['R05', 'C+', 72, 5], ['R05+', 'C+', 86, 5],
  ['R06', 'B', 100, 6], ['R06+', 'B', 116, 6],
  ['R07', 'B', 132, 7], ['R07+', 'B', 150, 7],
  ['R08', 'B+', 168, 8], ['R08+', 'B+', 188, 8],
  ['R09', 'A', 208, 9], ['R09+', 'A', 230, 9],
  ['R10', 'A', 252, 10], ['R10+', 'A', 276, 10],
  ['R11', 'A+', 300, 11], ['R11+', 'A+', 326, 11],
  ['R12', 'S', 352, 12], ['R12+', 'S', 380, 12],
  ['S', 'S', 408, 12],
];

/** One-time conversion; old purchases, completed exams and guild progress remain available. */
export function migrateRankFacilities(data, game) {
  game.facilities ??= {};
  if (game.rankFacilityVersion === 2) return;
  const legacy = LEGACY_RANKS.find(([id]) => id === game.rank);
  if (game.rankFacilityVersion !== 1 && legacy) {
    const [, rankId, oldThreshold, oldShopLevel] = legacy;
    const rank = data.ranks.find(r => r.id === rankId);
    const next = data.ranks[data.ranks.indexOf(rank) + 1];
    const extra = Math.max(0, Number(game.rankPoints ?? 0) - oldThreshold);
    game.rankPoints = Math.min((next?.pointsRequired ?? Infinity) - 1,
      rank.pointsRequired + Math.round(extra * 10));
    if (!Number.isFinite(game.rankPoints)) game.rankPoints = rank.pointsRequired;
    game.rank = rankId;
    game.facilities.equipment_shop = Math.max(game.facilities.equipment_shop ?? 1, oldShopLevel);
    const previousWorkshop = ['weapon_workshop','armor_workshop','accessory_workshop'];
    game.facilities.workshop = Math.max(game.facilities.workshop ?? 1,
      ...previousWorkshop.map(id => game.facilities[id] ?? 1));
    game.facilities.alchemy = Math.max(game.facilities.alchemy ?? 1, game.facilities.item_shop ?? 1);
    game.examsPassed ??= [];
    for (const exam of data.ranks.filter(row => row.needsExam && row.pointsRequired <= rank.pointsRequired)) {
      if (!game.examsPassed.includes(exam.id)) game.examsPassed.push(exam.id);
    }
    game.notices ??= [];
    game.notices.push(`ギルドランクを${rank.title}に移行しました。施設の投資Lvと獲得済みの特典を引き継ぎました。`);
  }
  for (const key of ['weapon_workshop','armor_workshop','accessory_workshop']) delete game.facilities[key];
  // 旧Lv12は新Lv11に統合。Lv11で★11と★12の両方を扱う。
  for (const id of ['equipment_shop', 'workshop', 'item_shop', 'alchemy', 'temple']) {
    if (game.facilities[id] > 11) game.facilities[id] = 11;
  }
  delete game.facilities.warehouse;
  game.rankFacilityVersion = 2;
}
