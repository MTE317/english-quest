// ルーンストーン（rune_stones.csv）とルーン（lexicon.csv）をゲームで使いやすい形にする。
import { toNumber } from './csv.js?v=paid-skills-1';

/**
 * @param stonesCsv rune_stones.csv の rows
 * @param lexiconCsv lexicon.csv の rows
 */
export function buildLexicon(stonesCsv, lexiconCsv) {
  const stones = stonesCsv.map((r) => ({
    id: r.id,
    star: toNumber(r.star, 0),
    theme: r.theme,
    name: r.name_ja,
    kind: r.kind,
    size: toNumber(r.size, 0),
    order: toNumber(r.order, 0),
  }));
  stones.sort((a, b) => a.star - b.star || a.order - b.order || a.id.localeCompare(b.id));
  const stonesById = new Map(stones.map((s) => [s.id, s]));

  const words = lexiconCsv.map((r, index) => ({
    id: r.id,
    stoneId: r.stone_id,
    kind: r.kind,
    en: r.en,
    ja: r.ja,
    pos: r.pos,
    exampleEn: r.example_en,
    exampleJa: r.example_ja,
    star: toNumber(r.star, 0),
    index, // CSV の並び順（新しい単語はこの順に出す）
  }));
  const wordsById = new Map(words.map((w) => [w.id, w]));
  const wordsByStone = new Map(stones.map((s) => [s.id, []]));
  const problems = [];
  for (const w of words) {
    if (!wordsByStone.has(w.stoneId)) {
      problems.push(`${w.id}：stone_id「${w.stoneId}」が rune_stones.csv にない`);
      wordsByStone.set(w.stoneId, []);
    }
    wordsByStone.get(w.stoneId).push(w);
  }
  return { stones, stonesById, words, wordsById, wordsByStone, problems };
}

