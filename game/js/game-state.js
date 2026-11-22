// 新しいゲームの進み具合（セーブの game の中身）
import { createMember } from './character.js?v=balance-builds-1';
import { ensureLoadout } from './growth.js?v=balance-builds-1';

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
 * 専用制作の固定効果は現行マスタへそろえる。遠征中は全滅時の復元元にも適用する。
 */
export function normalizeGame(data, game, run = null) {
  if (!game) return game;
  game.storage = game.storage ?? { gear: [], materials: {} };
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
  for (const m of game.party ?? []) {
    m.persist = m.persist ?? []; m.room = m.room ?? null; m.ap = m.ap ?? { [m.job]: 0 };
    m.learned = m.learned ?? []; m.common = m.common ?? []; m.mastery = m.mastery ?? {};
    if (data.skills) ensureLoadout(data, m);
    for (const gear of Object.values(m.equip ?? {})) alignCraftedEffects(data, gear);
  }
  for (const gear of game.storage.gear ?? []) alignCraftedEffects(data, gear);
  // route・進行・戦闘状態は触らず、入場時のゲームの写しだけを同じ規則で移行する。
  if (run?.snapshot && run.snapshot !== game) normalizeGame(data, run.snapshot);
  return game;
}

function alignCraftedEffects(data, gear) {
  if (!gear?.crafted) return;
  const def = data.equipment?.get(gear.id);
  if (!def?.recipeId || def.unique || def.setId) return;
  // 制作品は振り直せないため、affixes はレシピの固定効果だけ。
  // 効果の辞書をコピーし、マスタや別の装備・入場時の写しと共有しない。
  gear.affixes = { ...(def.fixedEffects ?? {}) };
}
