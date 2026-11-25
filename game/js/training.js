import { normalizeAp, gainAp } from './ap.js?v=skill-growth-2';
import { gainXp, xpToNext, levelCap } from './character.js?v=skill-growth-2';

// 短時間で学べる訓練場。問題の種類と教材カテゴリーの選択はUIと共通で扱う。
export const TRAINING_COUNTS = Object.freeze([5, 10, 15]);

/** 訓練場の画面選択を、実際の出題モードに一元的に変換する。 */
export function resolveTrainingMode(mode, phraseMode) {
  return mode === 'phrases' && phraseMode === 'chunks' ? 'chunks' : mode;
}
export const TRAINING_XP_RATIO = 0.10;
export const TRAINING_AP_RATIO = 0.10;
export const DUE_BONUS = 1.20;
export const TRAINING_AP_QUESTIONS_PER_BATTLE = 5;

const recFor = (entry, store, game) => entry.kind === 'word'
  ? store.get(entry.item.id) : game.chants?.records?.[entry.item.id] ?? null;
const keyOf = (entry) => `${entry.kind}:${entry.item.id}`;
const unique = (values) => [...new Map(values.map((item) => [item.id, item])).values()];

// 通常の英作文ではチャンクの学習ヒントを表示しない。
// チャンク集中では同じ型を反復するため、表示してよい。
export function shouldShowChunkHint(mode, phrase) {
  return mode === 'chunks' && Boolean(phrase?.chunkId);
}

/**
 * 通常の新規英作文では教材CSVの連続を崩し、同じチャンクが続かないようにする。
 * チャンクのない独立フレーズは別グループにしてランダムに混ぜる。
 * どうしても他のグループが残っていない場合のみ連続を許容する。
 * チャンク集中・単語・復習には適用しない。
 */
function diversifyNewPhrases(entries, rng) {
  const grouped = new Map();
  for (const entry of entries) {
    const key = entry.item.chunkId || `independent:${entry.item.id}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(entry);
  }
  // 同じチャンク内の出題順も固定しない。
  const buckets = [...grouped].map(([key, items]) => {
    for (let i = items.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return { key, items };
  });
  const ordered = [];
  let last = null;
  while (buckets.length) {
    // 残りが多いグループから出すと、可能な限り同じチャンクの連続を避けられる。
    const alternatives = buckets.filter((bucket) => bucket.key !== last);
    const available = alternatives.length ? alternatives : buckets;
    const maxRemaining = Math.max(...available.map((bucket) => bucket.items.length));
    const candidates = available.filter((bucket) => bucket.items.length === maxRemaining);
    const chosen = candidates[Math.floor(rng() * candidates.length)];
    ordered.push(chosen.items.pop());
    last = chosen.key;
    if (!chosen.items.length) buckets.splice(buckets.indexOf(chosen), 1);
  }
  return ordered;
}

export function trainingWordsForSet(catalog, setId) {
  return unique(setId === 'all' ? catalog.words : catalog.wordsByStone.get(setId) ?? []);
}

export function trainingPhrasesForSet(catalog, setId) {
  return unique(setId === 'all' ? catalog.phrases : catalog.phrasesByStone.get(setId) ?? []);
}

/**
 * カテゴリーに実際に属する英文から、練習できるチャンクのみを抽出する。
 * チャンク自身の主所属だけでなく、関連英文の複数カテゴリー所属も参照する。
 * 同じチャンクでもカテゴリーによって練習できる例文数が変わる。
 */
export function trainingChunksForSet(catalog, setId) {
  const allowedIds = new Set(trainingPhrasesForSet(catalog, setId).map((p) => p.id));
  return catalog.chunks.map((chunk) => ({
    ...chunk,
    exampleCount: (catalog.phrasesByChunk.get(chunk.id) ?? [])
      .filter((phrase) => allowedIds.has(phrase.id)).length,
  })).filter((chunk) => chunk.exampleCount > 0)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * mode: words | phrases | chunks | review
 * reviewType: both | words | phrases
 * reviewScope: due（期限到来のみ） | wrong（過去の誤答）
 * 復習はカテゴリー指定を受けず、全教材IDから抽出する。
 * チャンク集中はチャンクIDとsetIdの積集合の英文だけ出題する。
 */
export function makeTrainingPicker(catalog, store, game, scheduler, today,
  { mode = 'words', setId = '00', chunkId = '',
    reviewType = 'both', reviewScope = 'due', rng = Math.random } = {}) {
  const newOnly = mode === 'words' || mode === 'phrases';
  const reviewing = mode === 'review';
  const wantWords = mode === 'words' || (reviewing && reviewType !== 'phrases');
  const wantPhrases = ['phrases', 'chunks'].includes(mode)
    || (reviewing && reviewType !== 'words');
  const words = wantWords ? trainingWordsForSet(catalog, reviewing ? 'all' : setId) : [];
  let phrases = wantPhrases
    ? trainingPhrasesForSet(catalog, reviewing ? 'all' : setId) : [];
  if (mode === 'chunks') {
    const allowedIds = new Set(phrases.map((p) => p.id));
    phrases = unique((catalog.phrasesByChunk.get(chunkId) ?? [])
      .filter((p) => allowedIds.has(p.id)));
  }
  // 復習で両方を選んだ際、同じ期限の単語だけに偏らないよう交互に候補化。
  const entries = [];
  for (let i = 0; i < Math.max(words.length, phrases.length); i++) {
    if (words[i]) entries.push({ kind: 'word', item: words[i] });
    if (phrases[i]) entries.push({ kind: 'phrase', item: phrases[i] });
  }
  const candidates = entries.map((entry) => {
    const record = recFor(entry, store, game);
    return { ...entry, record, due: scheduler.isDue(record, today),
      wrong: (record?.wrong ?? 0) > 0, fresh: !record };
  });
  let eligible = reviewing ? candidates.filter((candidate) =>
    reviewScope === 'wrong' ? candidate.wrong : candidate.due)
    : candidates.filter((candidate) => !newOnly || candidate.fresh);
  if (mode === 'phrases') eligible = diversifyNewPhrases(eligible, rng);
  const seen = new Set();
  const retries = [];
  let asked = 0;
  const queuedForRetry = new Set();
  const pick = (pool, reason) => {
    const entry = pool.find((candidate) => !seen.has(keyOf(candidate)));
    if (!entry) return null;
    const key = keyOf(entry);
    seen.add(key);
    asked += 1;
    return { kind: entry.kind, item: entry.item, reason, wasDue: entry.due, key };
  };
  return {
    size: eligible.length,
    next() {
      const ri = retries.findIndex((retry) => retry.after <= asked);
      if (ri >= 0) {
        const entry = retries.splice(ri, 1)[0].entry;
        asked += 1;
        return { ...entry, reason: 'retry' };
      }
      const due = eligible.filter((e) => e.due).sort((a, b) =>
        a.record.due - b.record.due);
      let result = reviewing
        ? reviewScope === 'wrong' ? pick(eligible, 'retry') : pick(due, 'due')
        : pick(due, 'due');
      if (!result && !reviewing) result = pick(eligible.filter((e) => e.wrong), 'retry');
      if (!result && !reviewing) result = pick(eligible.filter((e) => e.fresh), 'new');
      if (!result && !reviewing) result = pick(eligible, 'practice');
      if (!result && retries.length) {
        asked++;
        return { ...retries.shift().entry, reason: 'retry' };
      }
      return result;
    },
    report(entry, passed) {
      if (newOnly || passed || queuedForRetry.has(entry.key)) return;
      queuedForRetry.add(entry.key);
      retries.push({ entry, after: asked + 3 });
    },
  };
}

/**
 * 6人全員へ少量のXP・APを加算する。単語/英作文の自己評価とは独立して基礎報酬を付け、
 * 期限到来の初回正答のみ1.2倍。1項目1日1回のため連打しても稼げない。
 * XP/APは小数繰越を記録して、実際に使えるAPは整数だけにする。
 */
export function rewardTrainingAnswer(data, game,
  { kind, id, day, due = false, passed = false }) {
  if (!['word', 'phrase'].includes(kind) || !id || !Number.isInteger(day)) throw new Error('訓練の報酬記録が不正です');
  if (game.trainingRewardDay !== day) {
    game.trainingRewardDay = day;
    game.trainingRewardIds = [];
  }
  const key = `${kind}:${id}`;
  if (game.trainingRewardIds.includes(key)) return { awarded: false, members: [] };
  game.trainingRewardIds.push(key);
  const multiplier = due && passed ? DUE_BONUS : 1;
  const baseXp = (Number(game.xpPerQuestion) || 5) * TRAINING_XP_RATIO * multiplier;
  const baseAp = (Number(data.balance.rewards?.ap_per_battle) || 2)
    / TRAINING_AP_QUESTIONS_PER_BATTLE * TRAINING_AP_RATIO * multiplier;
  const members = (game.party ?? []).map((member) => {
    normalizeAp(data, member);
    member.trainingCredit ??= { xp: 0, ap: 0 };
    const storedXp = member.trainingCredit.xp ?? 0;
    // 直近遠征の合計XPをさらにLv倍しない。各人の次Lv必要量を使う下限だけ補う。
    const progressFloor = member.lv < levelCap(data)
      ? xpToNext(data, member.lv) * (data.balance.training.xp_min_level_fraction ?? 0) * multiplier
      : 0;
    const totalXp = storedXp + Math.max(baseXp, progressFloor);
    const xp = Math.floor(totalXp + 1e-9);
    member.trainingCredit.xp = Math.round((totalXp - xp) * 1e6) / 1e6;
    const storedAp = member.trainingCredit.ap ?? 0;
    const totalAp = storedAp + baseAp;
    const ap = Math.floor(totalAp + 1e-9);
    member.trainingCredit.ap = Math.round((totalAp - ap) * 1e6) / 1e6;
    // gainXp と同じ関数を共有し、訓練場だけ別のレベル計算にしない。
    return { member, xp, ap };
  });
  return { awarded: true, members };
}

export function applyTrainingAnswer(data, game, input) {
  const result = rewardTrainingAnswer(data, game, input);
  if (!result.awarded) return { awarded: false, xp: 0, ap: 0 };
  let xp = 0; let ap = 0;
  for (const reward of result.members) {
    if (reward.xp) {
      gainXp(data, reward.member, reward.xp);
      xp += reward.xp;
    }
    if (reward.ap) {
      gainAp(data, reward.member, reward.ap);
      ap += reward.ap;
    }
  }
  return { awarded: true, xp, ap };
}

