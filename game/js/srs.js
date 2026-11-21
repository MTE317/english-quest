// 単語ごとの復習の時期の計算（FSRS を参考にした実装）。
// 設定は data/srs.json を読む。srs.json にまだない項目だけ、下の FALLBACK を使う
// （どれを使ったかは scheduler.usedFallbacks で分かる。srs.json への追加は docs/requests.md で依頼済み）。
//
// 4択なので評価は2段階：正解＝Good(3)、不正解＝Again(1)。
// 日数は「現実の日付」で数える（記憶は現実の時間で薄れるため。ゲーム内の日数とは別）。

/** srs.json に項目がないときだけ使う値（FSRS-5 の公開されている初期値など） */
export const FALLBACK = Object.freeze({
  // FSRS-5 の初期パラメータ（19個）
  fsrs_w: [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
    1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621],
  desired_retention: 0.9,
  maximum_interval_days: 36500,
  // 「日を空けて3回続けて正解したら習得」の 3 と「日を空けて」の日数
  learned_streak: 3,
  learned_min_gap_days: 1,
  // 誤答の選択肢を「同じ石の似た単語」にし始める連続正解数（それまでは別の石から）
  familiar_streak: 1,
  // 1回の遠征の中で、間違えた単語をもう一度出すまでにはさむ問題数
  retry_gap: 3,
  new_per_run: [10, 15],
  reduce_new_when_due_over: 50,
  reduced_new_per_run: 5,
});

const DECAY = -0.5;
const FACTOR = 19 / 81; // R(S, S) = 0.9 になるように決まる定数
const DAY_MS = 86400000;

export const STAGE = Object.freeze({ NEW: 'new', LEARNING: 'learning', LEARNED: 'learned' });
export const STAGE_LABEL = Object.freeze({ new: '未解読', learning: '学習中', learned: '習得' });

/** ローカル時間の日付の通し番号（1970-01-01 = 0） */
export function dayIndex(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** 日付の通し番号 → 'YYYY-MM-DD' */
export function dayToString(day) {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const round2 = (x) => Math.round(x * 100) / 100;

export class Scheduler {
  /** @param srsJson data/srs.json の中身 */
  constructor(srsJson = {}) {
    this.usedFallbacks = [];
    const pick = (key) => {
      if (srsJson[key] !== undefined) return srsJson[key];
      this.usedFallbacks.push(key);
      return FALLBACK[key];
    };
    this.w = pick('fsrs_w');
    this.retention = pick('desired_retention');
    this.maxInterval = pick('maximum_interval_days');
    this.learnedStreak = pick('learned_streak');
    this.learnedMinGap = pick('learned_min_gap_days');
    this.familiarStreak = pick('familiar_streak');
    this.retryGap = pick('retry_gap');
    this.newPerRun = pick('new_per_run');
    this.reduceNewWhenDueOver = pick('reduce_new_when_due_over');
    this.reducedNewPerRun = pick('reduced_new_per_run');
    this.reviewFirst = srsJson.review_first !== false;
    if (!Array.isArray(this.w) || this.w.length < 19) throw new Error('srs.json の fsrs_w は19個の数が必要');
  }

  // ---- FSRS の式 ----
  retrievability(elapsedDays, stability) {
    return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
  }
  initStability(g) { return Math.max(this.w[g - 1], 0.1); }
  initDifficulty(g) { return clamp(this.w[4] - Math.exp(this.w[5] * (g - 1)) + 1, 1, 10); }
  nextDifficulty(d, g) {
    const delta = -this.w[6] * (g - 3);
    const dp = d + delta * (10 - d) / 9; // 10 に近いほど上がりにくい
    const target = this.w[4] - Math.exp(this.w[5] * 3) + 1; // D0(Easy) へ少し戻す
    return clamp(this.w[7] * target + (1 - this.w[7]) * dp, 1, 10);
  }
  recallStability(d, s, r) {
    const w = this.w;
    return s * (Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp(w[10] * (1 - r)) - 1) + 1);
  }
  forgetStability(d, s, r) {
    const w = this.w;
    const sf = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp(w[14] * (1 - r));
    return Math.min(sf, s);
  }
  shortTermStability(s, g) {
    return s * Math.exp(this.w[17] * (g - 3 + this.w[18]));
  }
  /** 思い出せる確率が desired_retention まで下がるまでの日数 */
  intervalDays(stability) {
    const t = stability / FACTOR * (Math.pow(this.retention, 1 / DECAY) - 1);
    return clamp(Math.round(t), 1, this.maxInterval);
  }

  /**
   * 1回答えたあとの記録を返す（rec は変更しない）。
   * @param rec これまでの記録（初めてなら null）
   * @param correct 正解か
   * @param nowMs いまの時刻
   */
  review(rec, correct, nowMs) {
    const today = dayIndex(nowMs);
    const g = correct ? 3 : 1;
    let s;
    let d;
    if (!rec) {
      s = this.initStability(g);
      d = this.initDifficulty(g);
    } else {
      const elapsed = Math.max(0, today - rec.last);
      d = this.nextDifficulty(rec.d, g);
      if (elapsed === 0) {
        s = this.shortTermStability(rec.s, g);
      } else {
        const r = this.retrievability(elapsed, rec.s);
        s = correct ? this.recallStability(rec.d, rec.s, r) : this.forgetStability(rec.d, rec.s, r);
      }
    }
    s = Math.max(s, 0.1);

    const prev = rec ?? { correct: 0, wrong: 0, streak: 0, streakDay: null, stage: STAGE.LEARNING };
    let { streak, streakDay, stage } = prev;
    if (correct) {
      // 「日を空けて」続けて正解：同じ日に何度正解しても1回分
      if (streakDay == null || today - streakDay >= this.learnedMinGap) {
        streak += 1;
        streakDay = today;
      }
      if (streak >= this.learnedStreak) stage = STAGE.LEARNED;
    } else {
      streak = 0;
      streakDay = null;
      stage = STAGE.LEARNING; // 習得していても間違えたら学習中に戻す
    }
    return {
      s: round2(s),
      d: round2(d),
      last: today,
      // 間違えた単語は、安定度に関係なく次の日にもう一度出す（FSRS の「再学習」にあたる）
      due: today + (correct ? this.intervalDays(s) : 1),
      correct: prev.correct + (correct ? 1 : 0),
      wrong: prev.wrong + (correct ? 0 : 1),
      streak,
      streakDay,
      stage,
    };
  }

  // ---- 記録の見方 ----
  stageOf(rec) { return rec ? rec.stage : STAGE.NEW; }
  /** 復習の時期が来たか（＝かすれたルーン） */
  isDue(rec, today) { return !!rec && rec.due <= today; }
  /** いま思い出せる確率の見込み（未解読は 0） */
  currentRetrievability(rec, today) {
    if (!rec) return 0;
    return this.retrievability(Math.max(0, today - rec.last), rec.s);
  }
  /** 慣れたか（誤答の選択肢を同じ石の似た単語にするか） */
  isFamiliar(rec) { return !!rec && rec.streak >= this.familiarStreak; }
  /** かすれたルーンの数に応じた、1回の遠征で初めて出してよい単語の数 */
  newLimitFor(dueCount) {
    if (dueCount > this.reduceNewWhenDueOver) return this.reducedNewPerRun;
    return this.newPerRun[this.newPerRun.length - 1];
  }
}
