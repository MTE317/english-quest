// 学習の町機能：資料室の予習・石碑の間（石の進み具合）・任意の確認テスト・鍛錬・昇格試験。
// 学習の記録（読み解いた・確認テスト・試験の結果）は LearningStore に入れる（ゲームの進み具合とは別。全滅しても残る）。
// 予習カードを見ただけでは報酬は出ない（CLAUDE.md）。強くなるのは問題に正解したときだけ。
import { evaluate } from './expr.js';
import { gainXp } from './character.js?v=rune-study-1';
import { memberMods } from './growth.js?v=rune-study-1';
import { BATTLE_FORMULAS } from './battle.js?v=rune-study-1';
import { currentRank } from './dungeon.js?v=rune-study-1';

export const STUDY_FORMULAS = Object.freeze({
  promotion_learned_ratio: 0.8, // exams.csv の unlock「その★のルーンの8割を習得」
  default_xp_per_question: 5, // 鍛錬の経験値：まだ遠征していないとき（sim と同じ）
  training_wrong_share: 0.3, // 不正解でも経験値の3割（sim と同じ）
  training_ap_per_15: 3, // 15問で AP 3（sim と同じ）
});

const exam = (data, id) => data.exams.find((e) => e.id === id);

// ---------------- 石の進み具合 ----------------
export function stoneProgress(lex, store, scheduler, stoneId, today) {
  const words = lex.wordsByStone.get(stoneId) ?? [];
  const p = { total: words.length, read: 0, new: 0, learning: 0, learned: 0, due: 0, test: store.confirmationResult(stoneId) };
  for (const w of words) {
    const rec = store.get(w.id);
    if (store.isRead(w.id)) p.read += 1;
    p[scheduler.stageOf(rec)] += 1;
    if (scheduler.isDue(rec, today)) p.due += 1;
  }
  p.allRead = p.total > 0 && p.read === p.total;
  return p;
}

/** 資料室：まだ読み解いていないルーン（CSV の順に n 個） */
export function nextUnread(lex, store, stoneId, n) {
  return (lex.wordsByStone.get(stoneId) ?? []).filter((w) => !store.isRead(w.id)).slice(0, n);
}

/**
 * 持っていける石：★がダンジョン以上で、今のランクの★までか、1つ下の★の石をすべて読み解いていれば1つ上まで（srs.json の stones_ahead）
 */
export function stoneAllowed(lex, store, scheduler, stone, dungeonRank, rankStar, today) {
  if (stone.star < dungeonRank || !lex.wordsByStone.get(stone.id)?.length) return false;
  if (stone.star <= rankStar) return true;
  if (stone.star > rankStar + 1) return false;
  const below = lex.stones.filter((s) => s.star === stone.star - 1);
  return below.length > 0 && below.every((s) => stoneProgress(lex, store, scheduler, s.id, today).allRead);
}

/** 闘技場の総復習。セットの所属や確認テストの合否ではなく、項目ごとの学習記録で選ぶ。 */
export function arenaReviewWords(lex, store) {
  return lex.words.filter((word) => store.isRead(word.id));
}

// ---------------- 試験（任意の確認テスト・昇格試験） ----------------
/** 再挑戦できる日か（落ちた日から retry_after_days 日あける） */
function retryBlock(data, store, key, examId, today) {
  const e = store.exams[key];
  const wait = exam(data, examId).retryAfterDays;
  if (e?.lastFailDay != null && today < e.lastFailDay + wait) return `${e.lastFailDay + wait - today}日後に再挑戦できる`;
  return '';
}

export function trialBlock(data, lex, store, scheduler, stoneId, today) {
  return lex.wordsByStone.get(stoneId)?.length ? '' : 'この石には教材がありません。';
}

/** 試験の問題にする単語（重ならないように選ぶ。足りなければくり返す） */
export function examWords(words, n, rng) {
  const out = [];
  let pool = [];
  while (out.length < n && words.length) {
    if (!pool.length) pool = words.slice();
    out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  }
  return out;
}

export function trialPlan(data, lex, stoneId, rng) {
  const words = lex.wordsByStone.get(stoneId) ?? [];
  if (!words.length) throw new Error('この石には教材がありません。');
  // 旧データファイルも読み込めるように、設定ID awakening を互換で扱う。
  const e = exam(data, 'confirmation') ?? exam(data, 'awakening');
  return { key: `confirmation:${stoneId}`, examId: 'confirmation', stoneId, words: examWords(words, e.questions, rng).map((w) => w.id), passRate: e.passRate };
}

/** 試験の結果を記録する → 合格したか */
export function finishExam(data, store, plan, correct, today, onPass) {
  const passed = plan.words.length > 0 && correct >= Math.ceil(plan.words.length * plan.passRate - 1e-9);
  if (plan.examId === 'confirmation') {
    store.recordConfirmation(plan.stoneId, { correct, total: plan.words.length, day: today, passed });
    return passed;
  }
  if (passed) { store.setExam(plan.key, { passedDay: today, lastFailDay: null }); onPass?.(); } else store.setExam(plan.key, { lastFailDay: today });
  return passed;
}

/** 昇格試験：今の★のルーンの何割を習得したか */
export function starLearnedRatio(lex, store, scheduler, star) {
  const words = lex.words.filter((w) => w.star === star);
  if (!words.length) return { ratio: 0, learned: 0, total: 0 };
  const learned = words.filter((w) => scheduler.stageOf(store.get(w.id)) === 'learned').length;
  return { ratio: learned / words.length, learned, total: words.length };
}

export function promotionBlock(data, lex, store, scheduler, game, today) {
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  const next = data.ranks[idx + 1];
  if (!next?.needsExam) return '次のランクに試験はない';
  if (next.id === 'S') return '最終試験に挑戦する';
  if ((game.examsPassed ?? []).includes(next.id)) return 'もう合格している';
  const star = currentRank(data, game).maxDungeonRank;
  const r = starLearnedRatio(lex, store, scheduler, star);
  if (r.ratio < STUDY_FORMULAS.promotion_learned_ratio) return `★${star}のルーンを${Math.round(STUDY_FORMULAS.promotion_learned_ratio * 100)}%習得する（${r.learned} / ${r.total}）`;
  return retryBlock(data, store, `promotion:${next.id}`, 'promotion', today);
}

export function promotionPlan(data, lex, game, rng) {
  const e = exam(data, 'promotion');
  const idx = data.ranks.findIndex((r) => r.id === game.rank);
  const star = currentRank(data, game).maxDungeonRank;
  return {
    key: `promotion:${data.ranks[idx + 1].id}`, examId: 'promotion', rankId: data.ranks[idx + 1].id,
    words: examWords(lex.words.filter((w) => w.star === star), e.questions, rng).map((w) => w.id), passRate: e.passRate,
  };
}

// ---------------- 鍛錬（ギルドの訓練場） ----------------
/** 今の★でいちばん強い敵のレベル（鍛錬の経験値の減り方に使う） */
export function strongestEnemyLv(data, game) {
  const star = currentRank(data, game).maxDungeonRank;
  const ids = [...data.dungeons.values()].filter((d) => d.rank === star).map((d) => d.id);
  return Math.max(1, ...data.dungeonFloors.filter((f) => ids.includes(f.dungeonId)).map((f) => f.enemyLevel));
}

/**
 * 鍛錬の報酬（1人ぶん）。日数は進まず、お金や素材も入らない
 * @param kind 'xp' | 'ap'
 */
export function trainingReward(data, game, member, kind, correct, total) {
  const tb = 1 + (memberMods(data, member).training ?? 0);
  if (kind === 'ap') return { ap: Math.round(STUDY_FORMULAS.training_ap_per_15 * (total / 15) * (correct + STUDY_FORMULAS.training_wrong_share * (total - correct)) / total * tb), xp: 0 };
  const xpq = game.xpPerQuestion ?? STUDY_FORMULAS.default_xp_per_question;
  const eff = data.balance.training?.efficiency_vs_dungeon ?? 1;
  const pen = evaluate(BATTLE_FORMULAS.overlevel, { Lv: member.lv, enemyLv: strongestEnemyLv(data, game) });
  return { xp: Math.round(xpq * eff * (correct + STUDY_FORMULAS.training_wrong_share * (total - correct)) * pen * tb), ap: 0 };
}

export function applyTraining(data, game, index, reward) {
  const m = game.party[index];
  const ups = reward.xp ? gainXp(data, m, reward.xp) : 0;
  if (reward.ap) m.ap[m.job] = (m.ap[m.job] ?? 0) + reward.ap;
  return ups;
}
