// ルーンストーン（rune_stones.csv）とルーン（lexicon.csv）をゲームで使いやすい形にする。
import { splitList, toNumber } from './csv.js';

/**
 * @param stonesCsv rune_stones.csv の rows
 * @param lexiconCsv lexicon.csv の rows
 */
export function buildLexicon(stonesCsv, lexiconCsv) {
  const stones = stonesCsv.map((r) => ({
    id: r.id,
    star: toNumber(r.star, 0),
    theme: r.theme,
    category: r.category || null,
    name: r.name_ja,
    kind: r.kind,
    size: toNumber(r.size, 0),
    order: toNumber(r.order, 0),
  }));
  stones.sort((a, b) => Number(Boolean(a.category)) - Number(Boolean(b.category))
    || a.star - b.star || a.order - b.order || a.id.localeCompare(b.id));
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
    priority: r.priority || null,
    contextEn: r.context_en || '',
    distractorsJa: splitList(r.distractors_ja),
    star: toNumber(r.star, 0),
    index, // CSV の並び順（新しい単語はこの順に出す）
  }));
  const canonicalWords = words.filter((_, index) => !lexiconCsv[index].history_id);
  const wordsById = new Map(canonicalWords.map((w) => [w.id, w]));
  const wordsByStone = new Map(stones.map((s) => [s.id, []]));
  const problems = [];
  for (const w of words) {
    if (!wordsByStone.has(w.stoneId)) {
      problems.push(`${w.id}：stone_id「${w.stoneId}」が rune_stones.csv にない`);
      wordsByStone.set(w.stoneId, []);
    }
    const historyId = lexiconCsv[w.index].history_id;
    if (historyId && !wordsById.has(historyId)) {
      problems.push(`${w.id}：history_id「${historyId}」が lexicon.csv にない`);
      continue;
    }
    wordsByStone.get(w.stoneId).push(historyId ? { ...w, id: historyId } : w);
  }
  return { stones, stonesById, words: canonicalWords, wordsById, wordsByStone, problems };
}
