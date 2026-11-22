// 町の基本：暦と月末の会費・ギルドのクエストと冒険者ランク・宿屋・道具屋・武器防具屋・神殿の復活。
// data に数や式として書かれていないものは、シミュレーター（sim/world.py）と同じ値を TOWN_FORMULAS に置く（docs/requests.md で依頼済み）。
import { evaluate } from './expr.js';
import { makeGear, maxHp, maxMp, gearDef } from './character.js?v=features-1';
import { addItem } from './loot.js?v=features-1';
import { currentRank } from './dungeon.js?v=features-1';

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
  // 月が変わるとクエストの掲示板が入れかわる（受けているものは残る）
  game.board = null;
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
export function boardSize(data, game) {
  const m = /クエスト掲示板\s*(\d+)\s*件/.exec(currentRank(data, game).perk ?? '');
  if (m) return Number(m[1]);
  // 書かれていないランクは、それより下のランクで最後に書かれていた件数
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  for (let i = idx; i >= 0; i--) {
    const mm = /クエスト掲示板\s*(\d+)\s*件/.exec(data.ranks[i].perk ?? '');
    if (mm) return Number(mm[1]);
  }
  return TOWN_FORMULAS.board_size;
}

/** 掲示板を作る（今のランクの★のクエスト。賞金首はチェックリスト13番） */
export function makeBoard(data, game, rng) {
  const star = currentRank(data, game).maxDungeonRank;
  const types = data.questTypes;
  const quests = data.quests.filter((q) => q.rank === star && types.some((t) => t.id === q.type));
  const dungeons = [...data.dungeons.values()].filter((d) => d.rank === star);
  const board = [];
  for (let k = 0; k < boardSize(data, game) && quests.length; k++) {
    const q = quests[Math.floor(rng() * quests.length)];
    const count = q.countMin + Math.floor(rng() * (q.countMax - q.countMin + 1));
    let target = null;
    if (q.type === 'hunt') {
      const pool = [...data.monsters.values()].filter((m) => m.role === 'normal' && m.dungeons.some((d) => dungeons.some((x) => x.id === d)));
      target = pool[Math.floor(rng() * pool.length)]?.id ?? null;
    } else if (q.type === 'bounty') {
      target = q.target;
    } else if (q.type === 'boss') {
      target = dungeons[Math.floor(rng() * dungeons.length)]?.bossId ?? null;
    }
    board.push({ uid: (game.nextUid = (game.nextUid ?? 1) + 1), questId: q.id, type: q.type, rank: star, target, count, progress: 0 });
  }
  return board;
}

export function questText(data, q) {
  const name = (id) => data.monsters.get(id)?.name ?? id;
  if (q.type === 'hunt') return `${name(q.target)}を${q.count}体たおす`;
  if (q.type === 'bounty') return `賞金首「${name(q.target)}」を倒す`;
  if (q.type === 'boss') return `${name(q.target)}をたおす`;
  if (q.type === 'gather') return `★${q.rank}の通常素材を${q.count}個納品する`;
  return q.questId;
}

/** 掲示板のクエストを受ける */
export function acceptQuest(game, uid) {
  const i = (game.board ?? []).findIndex((q) => q.uid === uid);
  if (i < 0) throw new Error('そのクエストはない');
  game.quests.push(game.board.splice(i, 1)[0]);
}

/** 戦闘で倒した敵を、受けているクエストに数える（ダンジョンの戦闘に勝ったとき） */
export function countKills(game, enemies) {
  for (const q of game.quests ?? []) {
    if (q.type !== 'hunt' && q.type !== 'boss' && q.type !== 'bounty') continue;
    q.progress = Math.min(q.count, q.progress + enemies.filter((e) => e.monsterId === q.target).length);
  }
}

function gatherable(data, game, rank) {
  return Object.entries(game.storage.materials).filter(([id, n]) => n > 0 && data.materials.get(id)?.kind === 'common' && data.materials.get(id)?.rank === rank);
}
export function canReport(data, game, q) {
  if (q.type === 'gather') return gatherable(data, game, q.rank).reduce((a, [, n]) => a + n, 0) >= q.count;
  return q.progress >= q.count;
}

/**
 * クエストを報告する：お金（run_income × 割合 × ランクの特典）・まれな素材・ランクのポイント
 * @returns 画面に出す文
 */
export function reportQuest(data, game, uid, rng) {
  const i = game.quests.findIndex((q) => q.uid === uid);
  const q = game.quests[i];
  if (!q || !canReport(data, game, q)) throw new Error('まだ報告できない');
  const def = data.quests.find((x) => x.id === q.questId);
  const rank = currentRank(data, game);
  const lines = [];
  if (q.type === 'gather') {
    let need = q.count;
    for (const [id, n] of gatherable(data, game, q.rank).sort((a, b) => b[1] - a[1])) {
      const take = Math.min(n, need);
      game.storage.materials[id] -= take;
      if (game.storage.materials[id] <= 0) delete game.storage.materials[id];
      need -= take;
      if (!need) break;
    }
  }
  const gold = Math.round(data.economy.get(q.rank).run_income * def.rewardGoldPct / 100 * (1 + rank.questBonus));
  if (gold) { game.gold += gold; lines.push(`お金 +${gold}`); }
  if (def.rewardItem.startsWith('まれな素材')) {
    const n = Number(/(\d+)/.exec(def.rewardItem)?.[1] ?? 1);
    const rares = [...data.materials.values()].filter((m) => m.kind === 'rare' && m.rank === q.rank && !m.season);
    const m = rares[Math.floor(rng() * rares.length)];
    if (m) { game.storage.materials[m.id] = (game.storage.materials[m.id] ?? 0) + n; lines.push(`${m.name} ×${n}`); }
  }
  // ポイント：今の★は満点、1つ下は半分、それより下は0（balance.json の guild_points）
  const gp = data.balance.guild_points ?? {};
  const diff = rank.maxDungeonRank - q.rank;
  const mul = diff === 0 ? (gp.same_rank ?? 1) : diff === 1 ? (gp.one_rank_lower ?? 0.5) : 0;
  const pts = def.rankPoints * mul;
  game.rankPoints = (game.rankPoints ?? 0) + pts;
  lines.push(`ランクのポイント +${pts}`);
  game.quests.splice(i, 1);
  lines.push(...checkRankUp(data, game));
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
    game.board = null;
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
