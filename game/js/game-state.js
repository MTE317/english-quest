// 新しいゲームの進み具合（セーブの game の中身）
import { createMember, maxHp, maxMp } from './character.js?v=rune-study-1';
import { ensureLoadout } from './growth.js?v=rune-study-1';
import { parseAmounts } from './csv.js';

export const PARTY_SIZE = 4;

/**
 * はじめから始めるときの進み具合
 * @param partySpecs 4人ぶんの { name, job, icon }
 * 最初のお金と日付は data にまだないので、balance.json の new_game があればそれを使う（docs/requests.md で依頼中）
 */
export function createNewGame(data, partySpecs) {
  if (partySpecs.length !== PARTY_SIZE) throw new Error(`パーティは${PARTY_SIZE}人`);
  const start = data.balance.new_game ?? {};
  const game = {
    day: start.day ?? 1,
    gold: start.gold ?? 0,
    nextUid: 1,
    party: [],
    storage: { gear: [], materials: {} },
    items: {},
    rank: data.ranks?.[0]?.id ?? null, // 冒険者ランク（adventurer_ranks.csv の最初）
    backpackTier: data.backpackTiers?.[0]?.tier ?? 1,
  };
  game.party = partySpecs.map((spec, i) => createMember(data, game, spec, i));
  return normalizeGame(data, game);
}

/**
 * 古いセーブにない項目を足す（あとから増えた項目。セーブを読んだら呼ぶ）
 * 専用制作の固定効果は現行マスタへそろえる。廃止したルーン能力と枠を移行する。
 * 遠征中は全滅時の復元元にも適用する。
 */
export function normalizeGame(data, game, run = null) {
  if (!game) return game;
  game.storage = game.storage ?? { gear: [], materials: {} };
  game.storage.materials ??= {};
  game.items = game.items ?? {};
  game.rank = game.rank ?? data.ranks?.[0]?.id ?? null;
  game.rankPoints = game.rankPoints ?? 0;
  game.backpackTier = game.backpackTier ?? data.backpackTiers?.[0]?.tier ?? 1;
  game.facilities = game.facilities ?? {};
  for (const f of data.facilities ?? []) game.facilities[f.id] = game.facilities[f.id] ?? 1;
  game.quests = game.quests ?? [];
  game.board = game.board ?? null;
  game.cleared = game.cleared ?? {};
  game.overdue = game.overdue ?? 0;
  game.notices = game.notices ?? [];
  game.jp ??= 0;
  game.titles ??= [];
  game.unlockedJobs = game.unlockedJobs ?? [];
  game.examsPassed = game.examsPassed ?? [];
  const retiredMembers = retireRuneBonuses(data, game);
  for (const m of game.party ?? []) {
    m.persist = m.persist ?? []; m.room = m.room ?? null; m.ap = m.ap ?? { [m.job]: 0 };
    m.learned = m.learned ?? []; m.common = m.common ?? []; m.mastery = m.mastery ?? {};
    if (data.skills) ensureLoadout(data, m);
    for (const gear of Object.values(m.equip ?? {})) alignCraftedEffects(data, gear);
    if (retiredMembers.has(m)) {
      // 現在値は回復させず、新上限だけを適用する。戦闘不能の HP 0 も維持する。
      if (Number.isFinite(m.hp)) m.hp = Math.min(m.hp, maxHp(data, m));
      if (Number.isFinite(m.mp)) m.mp = Math.min(m.mp, maxMp(data, m));
    }
  }
  for (const gear of game.storage.gear ?? []) alignCraftedEffects(data, gear);
  // 入場時の写しも返還済みにし、全滅で旧能力が復活したり二重返還されたりしないようにする。
  // 戦闘中の能力値は毎回 game.party から算出されるため、行動順や進行の記録は変えない。
  if (run?.snapshot && run.snapshot !== game) normalizeGame(data, run.snapshot);
  return game;
}

/**
 * 旧ルーンの装備データを廃止し、記録から確定できる枠の解放費用だけを一度返す。
 * 刻み直しの回数・支払額は旧セーブにないため推測しない。
 * kokuinSlots は新規購入に使わず、旧セーブの返還にだけ残している。
 */
function retireRuneBonuses(data, game) {
  const members = (game.party ?? []).filter((m) => ['runes', 'runeSlots', 'runeMods'].some((key) => Object.hasOwn(m, key)));
  const changed = new Set(members);
  if (!members.length && !Object.hasOwn(game, 'runeEffects')) return changed;

  if (game.runeRetirement?.version !== 1) {
    let gold = 0;
    const materials = {};
    for (const m of members) {
      const slots = Number(m.runeSlots);
      if (!Number.isSafeInteger(slots) || slots < 1) continue;
      for (const entry of data.kokuinSlots ?? []) {
        const slot = Number(entry.slot);
        if (!Number.isSafeInteger(slot) || slot < 1 || slot > slots) continue;
        const cost = Number(entry.gold);
        if (Number.isFinite(cost) && cost > 0) gold += cost;
        for (const { id, count } of parseAmounts(entry.materials)) {
          if (Number.isFinite(count) && count > 0) materials[id] = (materials[id] ?? 0) + count;
        }
      }
    }
    game.gold = (game.gold ?? 0) + gold;
    for (const [id, count] of Object.entries(materials)) {
      game.storage.materials[id] = (game.storage.materials[id] ?? 0) + count;
    }
    // 返還の記録も保存し、読み込みや全滅による再実行で重複させない。
    game.runeRetirement = { version: 1, gold, materials };
    if (gold || Object.keys(materials).length) {
      const parts = [gold ? `${gold} G` : '', Object.keys(materials).length ? '解放に使った素材' : ''].filter(Boolean);
      game.notices.push(`ルーンストーンの能力補正を廃止し、刻印枠の費用 ${parts.join('・')} を返還しました。`);
    }
  }
  delete game.runeEffects;
  for (const m of members) {
    delete m.runes;
    delete m.runeSlots;
    delete m.runeMods;
  }
  return changed;
}

function alignCraftedEffects(data, gear) {
  if (!gear?.crafted) return;
  const def = data.equipment?.get(gear.id);
  if (!def?.recipeId || def.unique || def.setId) return;
  // 制作品は振り直せないため、affixes はレシピの固定効果だけ。
  // 効果の辞書をコピーし、マスタや別の装備・入場時の写しと共有しない。
  gear.affixes = { ...(def.fixedEffects ?? {}) };
}
