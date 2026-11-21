// 4択の問題を作る（英→日・日→英）。
// 誤答の選択肢：
//   慣れないうち … 別の石から（同じ種類 word / phrase を優先）
//   慣れたら     … 同じ石の似た単語から（つづりが似ている・同じ種類・同じ品詞・意味の語尾が同じ）

export const DIRECTION = Object.freeze({ EN_JA: 'en2ja', JA_EN: 'ja2en' });
export const DIRECTION_LABEL = Object.freeze({ en2ja: '英→日', ja2en: '日→英' });
const CHOICES = 4;

/** レーベンシュタイン距離（つづりの近さ） */
export function editDistance(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 似ている度合い（大きいほど似ている） */
export function similarity(target, other) {
  const dist = editDistance(target.en, other.en);
  const spelling = 1 - dist / Math.max(target.en.length, other.en.length, 1);
  let score = spelling * 3;
  if (target.kind === other.kind) score += 2;
  if (target.pos && target.pos === other.pos) score += 1;
  if (target.ja.slice(-1) === other.ja.slice(-1)) score += 0.5; // 「〜する」「〜な」などがそろう
  return score;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 誤答の選択肢にする単語を選ぶ。
 * @returns {{ words: object[], source: 'other_stones'|'same_stone' }}
 */
export function pickDistractors(word, lex, { familiar, direction, rng = Math.random, count = CHOICES - 1 }) {
  const shown = (w) => (direction === DIRECTION.EN_JA ? w.ja : w.en);
  const used = new Set([shown(word)]);
  const result = [];
  const take = (cands) => {
    for (const w of cands) {
      if (result.length >= count) break;
      if (w.id === word.id || used.has(shown(w))) continue; // 同じ表示の選択肢は出さない
      used.add(shown(w));
      result.push(w);
    }
  };

  const sameStone = lex.wordsByStone.get(word.stoneId) ?? [];
  const others = lex.words.filter((w) => w.stoneId !== word.stoneId);
  let source;
  if (familiar) {
    source = 'same_stone';
    // 似ている上位から少しばらつかせて選ぶ
    const ranked = sameStone
      .filter((w) => w.id !== word.id)
      .map((w) => ({ w, s: similarity(word, w) + rng() * 0.5 }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.w);
    take(ranked);
  } else {
    source = 'other_stones';
    const pool = shuffle(others, rng);
    take(pool.filter((w) => w.kind === word.kind));
    take(pool);
  }
  // 足りないとき（石が1つしかないなど）はほかから埋める
  if (result.length < count) take(shuffle(sameStone, rng));
  if (result.length < count) take(shuffle(lex.words, rng));
  return { words: result, source };
}

/**
 * 4択の問題を1つ作る。
 * @returns {{ word, direction, prompt, choices: {id, text}[], answerIndex, distractorSource }}
 */
export function makeQuestion(word, lex, { direction, familiar, rng = Math.random }) {
  const { words, source } = pickDistractors(word, lex, { familiar, direction, rng });
  const shown = (w) => (direction === DIRECTION.EN_JA ? w.ja : w.en);
  const options = shuffle([word, ...words], rng);
  return {
    word,
    direction,
    prompt: direction === DIRECTION.EN_JA ? word.en : word.ja,
    choices: options.map((w) => ({ id: w.id, text: shown(w) })),
    answerIndex: options.findIndex((w) => w.id === word.id),
    distractorSource: source,
  };
}
