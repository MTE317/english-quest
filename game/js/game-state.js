// 新しいゲームの進み具合（セーブの game の中身）
import { createMember } from './character.js';

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
 */
export function normalizeGame(data, game) {
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
  for (const m of game.party ?? []) { m.persist = m.persist ?? []; m.room = m.room ?? null; m.ap = m.ap ?? { [m.job]: 0 }; }
  return game;
}
