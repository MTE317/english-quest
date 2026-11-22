// 町の基本：暦と月末の会費・ギルドのクエストと冒険者ランク・宿屋・道具屋・武器防具屋・神殿の復活。
// data に数や式として書かれていないものは、シミュレーター（sim/world.py）と同じ値を TOWN_FORMULAS に置く（docs/requests.md で依頼済み）。
import { evaluate } from './expr.js';
import { makeGear, maxHp, maxMp, gearDef } from './character.js?v=rune-study-1';
import { addItem } from './loot.js?v=rune-study-1';
import { currentRank } from './dungeon.js?v=rune-study-1';
import { monsterPool } from './encounter.js?v=rune-study-1';

export const TOWN_FORMULAS = Object.freeze({
  days_per_month: 30, // balance.json の calendar.days_per_month があればそちらを使う
  board_size: 3, // ランクの perk に「クエスト掲示板 N件」がなければ
  revive: '30 * Lv', // balance.json の temple.revive が文なので
  shop_item_lv: 'item_lv_min + 3', // balance.json の shop_gear_price.shop_item_lv が文なので
  sell_price: 'run_income * 0.04 * (1 + 0.8 * rarity_index)',
  sell_rank: 'floor((itemLv + 4) / 11) + 1', // 装備Lvから★を決める
});

// ---------------- 暦と月末 ----------------
export function daysPerMonth(data) {
  return data.balance.calendar?.days_per_month ?? TOWN_FORMULAS.days_per_month;
}
/** 今の季節（seasons.csv）と、何か月目か */
export function calendarOf(data, day) {
  const dpm = daysPerMonth(data);
  const monthIndex = Math.floor((day - 1) / dpm);
  const seasons = data.seasons ?? [];
  return {
    month: monthIndex + 1, dayOfMonth: ((day - 1) % dpm) + 1, daysLeft: dpm - ((day - 1) % dpm),
    season: seasons.length ? seasons[monthIndex % seasons.length] : null,
  };
}

/** 会費の段階：踏破したダンジョンのいちばん高い★（sim と同じ） */
export function feeTier(data, game) {
  const ranks = Object.keys(game.cleared ?? {}).map((id) => data.dungeons.get(id)?.rank ?? 1);
  return Math.max(1, ...ranks);
}
export function guildFee(data, game) {
  return data.economy.get(feeTier(data, game)).guild_fee;
}

/**
 * 日数を進める。月の終わりをまたいだら会費を払う（足りなければ滞納になり、利息がつく）
 * @returns 月末の知らせ（文の配列）
 */
export function advanceDays(data, game, n) {
  const notes = [];
  const dpm = daysPerMonth(data);
  for (let k = 0; k < n; k++) {
    game.day += 1;
    if ((game.day - 1) % dpm === 0) notes.push(...monthEnd(data, game));
  }
  game.notices = [...(game.notices ?? []), ...notes].slice(-10);
  return notes;
}

function monthEnd(data, game) {
  const notes = [];
  const bank = data.balance.bank ?? {};
  if (game.loan > 0) game.loan += Math.ceil(game.loan * (bank.loan_interest_monthly ?? 0));
  if (game.overdue > 0) {
    const interest = Math.ceil(game.overdue * (bank.overdue_interest_monthly ?? 0));
    game.overdue += interest;
    notes.push(`滞納の利息 ${interest}`);
  }
  const fee = guildFee(data, game);
  if (game.gold >= fee) { game.gold -= fee; notes.push(`月末：ギルドの会費 ${fee} を払った`); } else {
    const short = fee - game.gold;
    game.gold = 0;
    game.overdue = (game.overdue ?? 0) + short;
    notes.push(`月末：会費 ${fee} が払えず、${short} を滞納した`);
  }
  return notes;
}

/** 滞納を払う */
export function payOverdue(game, amount) {
  const pay = Math.min(amount, game.overdue ?? 0, game.gold);
  game.gold -= pay;
  game.overdue -= pay;
  return pay;
}

// ---------------- ギルド：クエスト ----------------
const questRules = (data) => data.balance.quest_board ?? {};
const finiteMoney = (n) => Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;

/** 掲示する未受注の件数。受注枠とは独立している。 */
export function boardSize(data, game) {
  const configured = Number(questRules(data).size);
  if (Number.isSafeInteger(configured) && configured > 0) return configured;
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  for (let i = idx; i >= 0; i--) {
    const m = /クエスト掲示板\s*(\d+)\s*件/.exec(data.ranks[i].perk ?? '');
    if (m) return Number(m[1]);
  }
  return TOWN_FORMULAS.board_size;
}

export function questAcceptLimit(data, game) {
  const rules = questRules(data);
  let limit = Number(rules.max_accepted);
  if (!Number.isSafeInteger(limit) || limit < 1) limit = boardSize(data, game);
  const star = currentRank(data, game).maxDungeonRank;
  for (const step of rules.accepted_rank_steps ?? []) {
    if (star >= step.star && Number.isSafeInteger(step.limit)) limit = Math.max(limit, step.limit);
  }
  return limit;
}

/** 数量違いでも同じ依頼として扱い、同じ討伐の重複報酬を避ける。 */
export function questKey(q) {
  if (q.type === 'gather' && q.materialIds?.length) return `gather:${q.rank}:${[...q.materialIds].sort().join('|')}`;
  return `${q.type}:${q.rank}:${q.targetMode === 'dungeon' ? `place:${q.dungeonId}` : q.target ?? '*'}`;
}

export function questRewardGold(data, game, q) {
  if (Number.isFinite(q.rewardGold)) return finiteMoney(q.rewardGold);
  const def = data.quests.find((x) => x.id === q.questId);
  return Math.round((data.economy.get(q.rank)?.run_income ?? 0) * (def?.rewardGoldPct ?? 0) / 100 * (1 + currentRank(data, game).questBonus));
}

export function questDepositTotal(game) {
  return (game.quests ?? []).reduce((sum, q) => sum + finiteMoney(q.depositPaid), 0);
}

export function questAbandonRefund(data, q) {
  const rate = Math.min(1, Math.max(0, Number(questRules(data).abandon_refund_rate ?? 0.8)));
  return Math.floor(finiteMoney(q.depositPaid) * rate);
}

export function questDestination(data, q) {
  const ids = q.destinationIds?.length ? q.destinationIds : q.dungeonId ? [q.dungeonId] : (data.monsters.get(q.target)?.dungeons ?? []);
  return [...new Set(ids)].map((id) => data.dungeons.get(id)?.name).filter(Boolean).join('・');
}

/** 今の季節・行ける場所で取り組める依頼を候補にする。 */
function questCandidates(data, game) {
  const star = currentRank(data, game).maxDungeonRank;
  const season = calendarOf(data, game.day).season?.id;
  const definitions = data.quests.filter((q) => q.rank === star && data.questTypes.some((t) => t.id === q.type));
  const dungeons = [...data.dungeons.values()].filter((d) => d.rank === star);
  const places = dungeons.map((dungeon) => {
    const available = monsterPool(data, dungeon.id, season);
    const residents = [...data.monsters.values()].filter((m) => ['normal', 'season'].includes(m.role) && m.dungeons.includes(dungeon.id));
    const materialIds = [...new Set(residents.map((m) => m.materialCommon))]
      .filter((id) => data.materials.get(id)?.kind === 'common' && data.materials.get(id)?.rank === star).sort();
    return { dungeon, available, residents, materialIds };
  });
  const candidates = [];
  for (const def of definitions) {
    if (def.type === 'bounty') {
      const monster = data.monsters.get(def.target);
      const destinations = dungeons.filter((d) => monster?.role === 'bounty' && monster.dungeons.includes(d.id));
      if (destinations.length) candidates.push({ def, target: monster.id, dungeonId: destinations[0].id, destinationIds: destinations.map((d) => d.id) });
      continue;
    }
    for (const { dungeon, available, residents, materialIds } of places) {
      if (!available.length) continue;
      const base = { def, dungeonId: dungeon.id, destinationIds: [dungeon.id] };
      if (def.type === 'hunt') {
        candidates.push({ ...base, target: dungeon.id, targetMode: 'dungeon', targetIds: residents.map((m) => m.id) });
      } else if (def.type === 'gather' && materialIds.length && available.some((m) => materialIds.includes(m.materialCommon))) {
        candidates.push({ ...base, target: dungeon.id, materialIds });
      } else if (def.type === 'boss' && data.monsters.has(dungeon.bossId)) {
        candidates.push({ ...base, target: dungeon.bossId });
      }
    }
  }
  return candidates;
}

function candidateKey(candidate) {
  return questKey({ ...candidate, type: candidate.def.type, rank: candidate.def.rank });
}

function createQuestOffer(data, game, candidate, rng) {
  const { def, ...target } = candidate;
  const q = {
    ...target, uid: (game.nextUid = (game.nextUid ?? 1) + 1), questId: def.id, type: def.type, rank: def.rank,
    count: def.countMin + Math.floor(rng() * (def.countMax - def.countMin + 1)), progress: 0, contractVersion: 1,
  };
  q.rewardGold = questRewardGold(data, game, q);
  q.depositGold = q.type === 'bounty' ? Math.ceil(q.rewardGold * Number(questRules(data).deposit_rate ?? 0.1)) : 0;
  return q;
}

// 新しい掲示を無制限に引き直せないよう、この遠征間に引き受けた依頼は再掲しない。
// 受注中の契約・預かり金も game に保存され、全滅時は遠征開始前の状態へ戻る。
export function fillBoard(data, game, rng = Math.random) {
  game.quests ??= [];
  if (game.questBoardVersion !== 2) {
    game.board = []; // 未受注だけ更新。旧セーブの受注済み契約はそのまま残す。
    game.questBoardUsed = [];
    game.questBoardVersion = 2;
  }
  game.board ??= [];
  game.questBoardUsed ??= [];
  game.questBoardPolicy = { acceptedLimit: questAcceptLimit(data, game) };
  const candidates = questCandidates(data, game);
  const validKeys = new Set(candidates.map(candidateKey));
  const taken = new Set([...game.quests.map(questKey), ...game.questBoardUsed]);
  const kept = [];
  for (const q of game.board) {
    const key = questKey(q);
    if (!validKeys.has(key) || taken.has(key)) continue;
    kept.push(q); taken.add(key);
    if (kept.length >= boardSize(data, game)) break;
  }
  game.board = kept;
  const types = questRules(data).type_slots ?? ['hunt', 'hunt', 'gather', 'gather', 'boss', 'bounty'];
  while (game.board.length < boardSize(data, game)) {
    const available = candidates.filter((candidate) => !taken.has(candidateKey(candidate)));
    if (!available.length) break;
    const counts = game.board.reduce((out, q) => ({ ...out, [q.type]: (out[q.type] ?? 0) + 1 }), {});
    const desired = types.find((type) => (counts[type] ?? 0) < types.filter((x) => x === type).length && available.some((c) => c.def.type === type));
    const choices = desired ? available.filter((c) => c.def.type === desired) : available;
    const candidate = choices[Math.min(choices.length - 1, Math.floor(rng() * choices.length))];
    const q = createQuestOffer(data, game, candidate, rng);
    game.board.push(q); taken.add(questKey(q));
  }
  return game.board;
}

/** 遠征から戻ると未受注の掲示が更新され、同じ依頼にも再挑戦できる。 */
export function refreshBoard(data, game, rng = Math.random) {
  game.board = [];
  game.questBoardUsed = [];
  return fillBoard(data, game, rng);
}

export function makeBoard(data, game, rng = Math.random) {
  return refreshBoard(data, game, rng);
}

export function questText(data, q) {
  const name = (id) => data.monsters.get(id)?.name ?? id;
  if (q.type === 'hunt' && q.targetMode === 'dungeon') return `${data.dungeons.get(q.dungeonId)?.name ?? q.dungeonId}の魔物を${q.count}体たおす`;
  if (q.type === 'hunt') return `${name(q.target)}を${q.count}体たおす`;
  if (q.type === 'bounty') return `賞金首「${name(q.target)}」を倒す`;
  if (q.type === 'boss') return `${name(q.target)}をたおす`;
  if (q.type === 'gather' && q.materialIds?.length) return `${data.dungeons.get(q.dungeonId)?.name ?? q.dungeonId}の通常素材を${q.count}個納品する`;
  if (q.type === 'gather') return `★${q.rank}の通常素材を${q.count}個納品する`;
  return q.questId;
}

export function canAcceptQuest(data, game, q) {
  const limit = questAcceptLimit(data, game);
  if ((game.quests ?? []).length >= limit) return { ok: false, reason: `同時受注は${limit}件までです。` };
  if ((game.quests ?? []).some((active) => questKey(active) === questKey(q))) return { ok: false, reason: '同じ依頼を受注中です。' };
  if (finiteMoney(q.depositGold) > game.gold) return { ok: false, reason: `保証金 ${q.depositGold} G が必要です。` };
  return { ok: true, reason: '' };
}

/** data つきが正式な呼び出し。旧 (game, uid) は保存済みの掲示情報で受注する。 */
export function acceptQuest(dataOrGame, gameOrUid, uid, rng = Math.random) {
  const withData = uid !== undefined;
  const data = withData ? dataOrGame : null;
  const game = withData ? gameOrUid : dataOrGame;
  const offerUid = withData ? uid : gameOrUid;
  const i = (game.board ?? []).findIndex((q) => q.uid === offerUid);
  if (i < 0) throw new Error('そのクエストはない');
  const q = game.board[i];
  game.quests ??= [];
  const limit = data ? questAcceptLimit(data, game) : game.questBoardPolicy?.acceptedLimit ?? TOWN_FORMULAS.board_size;
  if (game.quests.length >= limit) throw new Error(`同時受注は${limit}件までです。`);
  if (game.quests.some((active) => questKey(active) === questKey(q))) throw new Error('同じ依頼を受注中です。');
  const deposit = finiteMoney(q.depositGold);
  if (game.gold < deposit) throw new Error(`保証金 ${deposit} G が必要です。`);
  game.gold -= deposit;
  q.depositPaid = deposit;
  game.quests.push(game.board.splice(i, 1)[0]);
  game.questBoardUsed ??= [];
  if (!game.questBoardUsed.includes(questKey(q))) game.questBoardUsed.push(questKey(q));
  if (data) fillBoard(data, game, rng);
  return q;
}

/** 戦闘勝利時だけ呼ぶ。地域討伐は場所も一致する必要がある。 */
export function countKills(game, enemies, dungeonId = null) {
  for (const q of game.quests ?? []) {
    if (!['hunt', 'boss', 'bounty'].includes(q.type)) continue;
    const killed = q.targetMode === 'dungeon'
      ? (q.dungeonId === dungeonId ? enemies.filter((e) => q.targetIds?.includes(e.monsterId)).length : 0)
      : enemies.filter((e) => e.monsterId === q.target).length;
    q.progress = Math.min(q.count, (q.progress ?? 0) + killed);
  }
}

function gatherable(data, game, q) {
  return Object.entries(game.storage.materials).filter(([id, n]) => n > 0 && data.materials.get(id)?.kind === 'common'
    && data.materials.get(id)?.rank === q.rank && (!q.materialIds?.length || q.materialIds.includes(id)));
}

export function questProgress(data, game, q) {
  return Math.min(q.count, q.type === 'gather' ? gatherable(data, game, q).reduce((sum, [, n]) => sum + n, 0) : q.progress ?? 0);
}

export function canReport(data, game, q) {
  return questProgress(data, game, q) >= q.count;
}

/** 自主放棄。旧契約は預かり金0として扱う。 */
export function abandonQuest(data, game, uid, rng = Math.random) {
  const i = (game.quests ?? []).findIndex((q) => q.uid === uid);
  if (i < 0) throw new Error('その依頼は受注していません。');
  const q = game.quests[i];
  const refund = questAbandonRefund(data, q);
  const fee = finiteMoney(q.depositPaid) - refund;
  game.gold += refund;
  game.quests.splice(i, 1);
  game.questBoardUsed ??= [];
  if (!game.questBoardUsed.includes(questKey(q))) game.questBoardUsed.push(questKey(q));
  fillBoard(data, game, rng);
  return `依頼を取り下げた。${refund ? ` 保証金 ${refund} G を返還（手数料 ${fee} G）。` : ' 費用はかかりません。'}`;
}

/** 達成報告：受注時の金銭報酬と保証金の返還を分け、一度だけ受け取る。 */
export function reportQuest(data, game, uid, rng = Math.random) {
  const i = game.quests.findIndex((q) => q.uid === uid);
  const q = game.quests[i];
  if (!q || !canReport(data, game, q)) throw new Error('まだ報告できない');
  const def = data.quests.find((x) => x.id === q.questId);
  if (!def) throw new Error('依頼の報酬データが見つかりません。');
  const rank = currentRank(data, game);
  const gold = questRewardGold(data, game, q);
  const lines = [];
  if (q.type === 'gather') {
    let need = q.count;
    for (const [id, n] of gatherable(data, game, q).sort((a, b) => b[1] - a[1])) {
      const take = Math.min(n, need);
      game.storage.materials[id] -= take;
      if (game.storage.materials[id] <= 0) delete game.storage.materials[id];
      need -= take;
      if (!need) break;
    }
  }
  if (gold) { game.gold += gold; lines.push(`報酬 +${gold} G`); }
  const refund = finiteMoney(q.depositPaid);
  if (refund) { game.gold += refund; lines.push(`保証金 ${refund} G を返還`); }
  if (def.rewardItem.startsWith('まれな素材')) {
    const n = Number(/(\d+)/.exec(def.rewardItem)?.[1] ?? 1);
    const rares = [...data.materials.values()].filter((m) => m.kind === 'rare' && m.rank === q.rank && !m.season);
    const m = rares[Math.min(rares.length - 1, Math.floor(rng() * rares.length))];
    if (m) { game.storage.materials[m.id] = (game.storage.materials[m.id] ?? 0) + n; lines.push(`${m.name} ×${n}`); }
  }
  const gp = data.balance.guild_points ?? {};
  const diff = rank.maxDungeonRank - q.rank;
  const mul = diff === 0 ? (gp.same_rank ?? 1) : diff === 1 ? (gp.one_rank_lower ?? 0.5) : 0;
  const pts = def.rankPoints * mul;
  game.rankPoints = (game.rankPoints ?? 0) + pts;
  lines.push(`ランクのポイント +${pts}`);
  game.quests.splice(i, 1);
  game.questBoardUsed ??= [];
  if (!game.questBoardUsed.includes(questKey(q))) game.questBoardUsed.push(questKey(q));
  lines.push(...checkRankUp(data, game));
  fillBoard(data, game, rng);
  return lines;
}

/** ランクの次の段階（上がれるか・何が足りないか） */
export function nextRankStatus(data, game) {
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  const next = data.ranks[idx + 1];
  if (!next) return null;
  const cur = data.ranks[idx];
  const needs = [];
  if ((game.rankPoints ?? 0) < next.pointsRequired) needs.push(`ポイント ${game.rankPoints ?? 0} / ${next.pointsRequired}`);
  if (next.needsBossClear && !Object.keys(game.cleared ?? {}).some((id) => data.dungeons.get(id)?.rank === cur.maxDungeonRank)) {
    needs.push(`★${cur.maxDungeonRank}のダンジョンを踏破する`);
  }
  if (next.needsExam && !(game.examsPassed ?? []).includes(next.id)) needs.push('昇格試験に合格する（ギルドの資料室のとなり）');
  return { next, needs, examOnly: needs.length === 1 && next.needsExam && !(game.examsPassed ?? []).includes(next.id) };
}

/** ポイントがたまっていて試験のいらないランクなら上げる */
export function checkRankUp(data, game) {
  const lines = [];
  for (let st = nextRankStatus(data, game); st && st.needs.length === 0; st = nextRankStatus(data, game)) {
    game.rank = st.next.id;
    game.board = []; // 受けていない枠は新しいランクのクエストに入れかえる（町の画面か報告のときに補充）
    lines.push(`冒険者ランクが「${st.next.title}」に上がった！`);
  }
  return lines;
}

// ---------------- 宿屋 ----------------
/** 泊まる：倒れていない人の HP・MP が全回復。良い部屋は次の遠征のあいだ効果がある（inn_rooms.csv） */
export function stayInn(data, game, good) {
  const econ = data.economy.get(feeTier(data, game));
  const cost = good ? econ.inn_good : econ.inn_cheap;
  if (game.gold < cost) throw new Error('お金が足りない');
  game.gold -= cost;
  const fx = good ? data.innRooms.find((r) => r.innRank === (game.facilities?.inn ?? 1)) : null;
  for (const m of game.party) {
    m.room = fx ? { hp: fx.maxHpPct / 100, mp: fx.maxMpPct / 100, spd1: fx.firstBattleSpdPct / 100, sres: fx.statusResistPct / 100 } : null;
    if (m.hp > 0) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); }
  }
  return cost;
}

// ---------------- 神殿（復活だけ。ほかはチェックリスト12番） ----------------
export function reviveCost(data, member) {
  return Math.round(evaluate(TOWN_FORMULAS.revive, { Lv: member.lv }));
}
export function revive(data, game, index) {
  const m = game.party[index];
  if (m.hp > 0) throw new Error('倒れていない');
  const cost = reviveCost(data, m);
  if (game.gold < cost) throw new Error('お金が足りない');
  game.gold -= cost;
  m.hp = maxHp(data, m);
  m.mp = maxMp(data, m);
  return cost;
}

// ---------------- 店 ----------------
export const discount = (data, game) => currentRank(data, game).shopDiscount;
const priceWith = (data, game, p) => Math.max(1, Math.round(p * (1 - discount(data, game))));

/** 道具屋の品ぞろえ（items.csv の shop_rank が道具屋のランク以下で、店で売るもの） */
export function itemShopStock(data, game) {
  const rank = game.facilities?.item_shop ?? 1;
  return [...data.items.values()].filter((it) => it.source === '店' && it.price > 0 && it.shopRank <= rank)
    .map((it) => ({ item: it, price: priceWith(data, game, it.price) }));
}
export function buyItem(data, game, itemId, count = 1) {
  const e = itemShopStock(data, game).find((x) => x.item.id === itemId);
  if (!e) throw new Error('売っていない');
  const room = Math.min(count, Math.floor(game.gold / e.price));
  if (room <= 0) throw new Error('お金が足りない');
  const left = addItem(game, itemId, room);
  const bought = room - left;
  if (bought <= 0) throw new Error('これ以上持てない');
  game.gold -= bought * e.price;
  return bought;
}

/** 武器・防具屋の品ぞろえ：ランクで行ける★ごとに「その★の装備Lv下限+3」の、効果なしの武器・防具（頭・体・腕） */
export function gearShopStock(data, game) {
  const maxStar = currentRank(data, game).maxDungeonRank;
  const out = [];
  for (let star = 1; star <= maxStar; star++) {
    const ds = [...data.dungeons.values()].filter((d) => d.rank === star);
    if (!ds.length) continue;
    const target = evaluate(TOWN_FORMULAS.shop_item_lv, { item_lv_min: Math.min(...ds.map((d) => d.itemLvMin)) });
    const cands = [...data.equipment.values()].filter((e) => !e.unique && e.source.includes('店') && ['weapon', 'head', 'body', 'arm'].includes(e.slot));
    const lv = cands.map((e) => e.itemLv).filter((x) => x <= target).sort((a, b) => b - a)[0] ?? Math.min(...cands.map((e) => e.itemLv));
    for (const e of cands.filter((x) => x.itemLv === lv)) out.push({ def: e, star, price: priceWith(data, game, gearPrice(data, e)) });
  }
  return out;
}
export function gearPrice(data, def) {
  const P = data.balance.shop_gear_price;
  return Math.round(evaluate(def.slot === 'weapon' ? P.weapon : P.armor, { itemLv: def.itemLv }));
}
export function buyGear(data, game, equipId) {
  const e = gearShopStock(data, game).find((x) => x.def.id === equipId);
  if (!e) throw new Error('売っていない');
  if (game.gold < e.price) throw new Error('お金が足りない');
  game.gold -= e.price;
  const g = makeGear(game, equipId);
  game.storage.gear.push(g);
  return g;
}

/** 倉庫の装備を売る値段 */
export function sellPrice(data, gear) {
  const def = gearDef(data, gear);
  const star = Math.min(data.economy.size, Math.max(1, evaluate(TOWN_FORMULAS.sell_rank, { itemLv: def.itemLv })));
  const ri = Math.max(0, data.rarityTable.findIndex((r) => r.id === gear.rarity));
  return Math.max(1, Math.round(evaluate(TOWN_FORMULAS.sell_price, { run_income: data.economy.get(star).run_income, rarity_index: ri })));
}
export function sellGear(data, game, uid) {
  const i = game.storage.gear.findIndex((g) => g.uid === uid);
  if (i < 0) throw new Error('倉庫にない');
  const p = sellPrice(data, game.storage.gear[i]);
  game.storage.gear.splice(i, 1);
  game.gold += p;
  return p;
}

// ---------------- バックパックを広げる（道具屋） ----------------
/** backpack.csv の素材の条件「★1以上の通常素材（獣・人型）:5」を読む */
export function parseMaterialNeed(data, text) {
  const kinds = { 通常: 'common', まれな: 'rare', ボス: 'boss' };
  return String(text ?? '').split('|').filter(Boolean).map((part) => {
    const m = /★(\d+)以上の(通常|まれな|ボス)素材(?:（(.+?)）)?:(\d+)/.exec(part);
    if (!m) throw new Error(`素材の条件が読めない：${part}`);
    const typeNames = m[3] ? m[3].split('・') : null;
    const types = typeNames ? [...data.monsterTypes.values()].filter((t) => typeNames.includes(t.name)).map((t) => t.id) : null;
    return { text: part.split(':')[0], minRank: Number(m[1]), kind: kinds[m[2]], types, count: Number(m[4]) };
  });
}
export function matchesNeed(data, matId, need) {
  const mat = data.materials.get(matId);
  if (!mat || mat.kind !== need.kind || mat.rank < need.minRank) return false;
  if (!need.types) return true;
  return need.types.some((t) => data.monsters.get(mat.sourceMonster)?.types.includes(t));
}
export function nextBackpackTier(data, game) {
  return data.backpackTiers.find((t) => t.tier === game.backpackTier + 1) ?? null;
}
/** 広げられるか → { ok, reasons } */
export function canExpandBackpack(data, game) {
  const t = nextBackpackTier(data, game);
  if (!t) return { ok: false, reasons: ['これ以上は広げられない'] };
  const reasons = [];
  if ((game.facilities?.item_shop ?? 1) < t.shopRank) reasons.push(`道具屋のランク${t.shopRank}が必要`);
  if (game.gold < t.gold) reasons.push(`お金 ${t.gold} が必要`);
  for (const need of parseMaterialNeed(data, t.materials)) {
    const have = Object.entries(game.storage.materials).filter(([id]) => matchesNeed(data, id, need)).reduce((a, [, n]) => a + n, 0);
    if (have < need.count) reasons.push(`${need.text}が ${have} / ${need.count}`);
  }
  return { ok: reasons.length === 0, reasons, tier: t };
}
export function expandBackpack(data, game) {
  const c = canExpandBackpack(data, game);
  if (!c.ok) throw new Error(c.reasons.join('・'));
  game.gold -= c.tier.gold;
  for (const need of parseMaterialNeed(data, c.tier.materials)) {
    let left = need.count;
    for (const [id, n] of Object.entries(game.storage.materials).filter(([x]) => matchesNeed(data, x, need)).sort((a, b) => b[1] - a[1])) {
      const take = Math.min(n, left);
      game.storage.materials[id] -= take;
      if (!game.storage.materials[id]) delete game.storage.materials[id];
      left -= take;
      if (!left) break;
    }
  }
  game.backpackTier = c.tier.tier;
  return c.tier.slots;
}

export function loanLimit(data, game) {
  const rank = currentRank(data, game).maxDungeonRank;
  const index = Math.max(0, data.ranks.findIndex((r) => r.id === game.rank));
  return Math.floor(3 * data.economy.get(rank).guild_fee * (1 + 0.25 * index / 2));
}

export function borrow(data, game, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('借りる金額を1 G以上で入力してください。');
  if ((game.loan ?? 0) + amount > loanLimit(data, game)) throw new Error('融資の上限を超えています。');
  game.loan = (game.loan ?? 0) + amount;
  game.gold += amount;
  return `${amount} G 借りた。`;
}

export function repayLoan(game, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error('返す金額を1 G以上で入力してください。');
  const paid = Math.min(amount, game.gold, game.loan ?? 0);
  if (paid <= 0) throw new Error('返済できる金額がありません。');
  game.gold -= paid;
  game.loan -= paid;
  return `${paid} G 返済した。`;
}
