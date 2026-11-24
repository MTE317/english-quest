// 学習教材の集計・昇格資格は learning-stats.js / promotion.js へ移行。
// 闘技場の問題プールだけ、従来の出題仕様を維持する。
export function arenaReviewWords(lex, store) {
  return lex.words.filter((word) => store.isRead(word.id));
}

// 重複のない検査用抽選。教材が問題数より少なければ実在する項目数だけ出題する。
export function examWords(words, count, rng = Math.random) {
  const pool = words.slice();
  const chosen = [];
  while (chosen.length < count && pool.length) {
    chosen.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return chosen;
}
