// 単語ごとの復習の時期の計算（FSRS を参考にした実装）。
// 設定は data/srs.json を読む。srs.json にない項目（数ではなく説明の文だけが入っている項目も）は下の FALLBACK を使う
// （どれを使ったかは scheduler.usedFallbacks で分かる）。fsrs_w は FALLBACK の値を正とする（docs/checklist.md の回答）。
//
// 試験・ダンジョンは正誤で評価し、訓練場の単語は自己評価で記憶を更新する。
// 日数は「現実の日付」で数える（記憶は現実の時間で薄れるため。ゲーム内の日数とは別）。
// 日付の切り替わりは srs.json の day_boundary_hour（午前4時）。

/** srs.json に項目がないときだけ使う値（FSRS-5 の公開されている初期値など） */
export const FALLBACK = Object.freeze({
  // FSRS-5 の初期パラメータ（19個）
  fsrs_w: [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
    1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621],
  desired_retention: 0.9,
  maximum_interval_days: 36500,
  learned_stability_days: 30,
  // 誤答の選択肢を「同じ石の似た単語」にし始める連続正解数（それまでは別の石から）
  familiar_streak: 1,
  // 1回の遠征の中で、間違えた単語をもう一度出すまでにはさむ問題数
  retry_gap: 3,
  new_per_run: [10, 15],
  reduce_new_when_due_over: 50,
  reduced_new_per_run: 5,
  day_boundary_hour: 4,
});

const DECAY = -0.5;
const FACTOR = 19 / 81; // R(S, S) = 0.9 になるように決まる定数
const DAY_MS = 86400000;

export const STAGE = Object.freeze({ NEW: 'new', LEARNING: 'learning', LEARNED: 'learned' });
export const STAGE_LABEL = Object.freeze({ new: '未解読', learning: '学習中', learned: '習得' });

/** ローカル時間の日付の通し番号（1970-01-01 = 0）。boundaryHour 時より前は前の日として数える */
export function dayIndex(ms, boundaryHour = 0) {
  const d = new Date(ms - boundaryHour * 3600000);
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
      const v = srsJson[key];
      // 型が FALLBACK と同じときだけ srs.json の値を使う（説明の文が入っている項目は使わない）
      if (v !== undefined && Array.isArray(v) === Array.isArray(FALLBACK[key]) && typeof v === typeof FALLBACK[key]) return v;
      this.usedFallbacks.push(key);
      return FALLBACK[key];
    };
    this.w = pick('fsrs_w');
    this.retention = pick('desired_retention');
    this.maxInterval = pick('maximum_interval_days');
    this.learnedStability = pick('learned_stability_days');
    this.familiarStreak = pick('familiar_streak');
    this.retryGap = pick('retry_gap');
    this.newPerRun = pick('new_per_run');
    this.reduceNewWhenDueOver = pick('reduce_new_when_due_over');
    this.reducedNewPerRun = pick('reduced_new_per_run');
    this.dayBoundaryHour = pick('day_boundary_hour');
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
  /** 学習の日付（午前4時で切り替わる）の通し番号 */
  dayOf(nowMs) { return dayIndex(nowMs, this.dayBoundaryHour); }

  review(rec, correct, nowMs) {
    return this.reviewGrade(rec, correct ? 3 : 1, nowMs);
  }

  reviewGrade(rec, g, nowMs, answerCorrect = g >= 2) {
    const today = this.dayOf(nowMs);
    const correct = g >= 2;
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
        const gradeMultiplier = g === 2 ? this.w[15] : g === 4 ? this.w[16] : 1;
        s = correct ? rec.s + (this.recallStability(rec.d, rec.s, r) - rec.s) * gradeMultiplier
          : this.forgetStability(rec.d, rec.s, r);
      }
    }
    s = Math.max(s, 0.1);

    // 連続正解数は選択肢の難しさを決めるために残す。
    const prev = rec ?? { correct: 0, wrong: 0, streak: 0, streakDay: null };
    let { streak, streakDay } = prev;
    if (!answerCorrect) {
      streak = 0;
      streakDay = null;
    } else if (streakDay == null || today > streakDay) {
      streak += 1;
      streakDay = today;
    }
    const stability = round2(s);
    return {
      s: stability,
      d: round2(d),
      last: today,
      // 間違えた単語は、安定度に関係なく次の日にもう一度出す（FSRS の「再学習」にあたる）
      due: today + (correct ? this.intervalDays(s) : 1),
      correct: prev.correct + Number(answerCorrect),
      wrong: prev.wrong + Number(!answerCorrect),
      streak,
      streakDay,
      grade: g,
      stage: this.stageOf({ s: stability, grade: g }),
    };
  }

  // ---- 記録の見方 ----
  stageOf(rec) {
    if (!rec) return STAGE.NEW;
    const lastSuccess = rec.grade == null ? rec.streak > 0 : rec.grade >= 2;
    return lastSuccess && rec.s >= this.learnedStability ? STAGE.LEARNED : STAGE.LEARNING;
  }
  /** 復習の時期が来たか（＝かすれたルーン） */
  isDue(rec, today) { return !!rec && rec.due <= today; }
  /** いま思い出せる確率の見込み（未解読は 0） */
  currentRetrievability(rec, today) {
    if (!rec) return 0;
    return this.retrievability(Math.max(0, today - rec.last), rec.s);
  }
  /** 慣れたか（誤答の選択肢を同じ石の似た単語にするか） */
  isFamiliar(rec) { return !!rec && rec.streak >= this.familiarStreak; }
  /**
   * かすれたルーンの数に応じた、1回の遠征で初めて出してよい単語の数（srs.json の new_per_run_rule）
   * 普段は new_per_run の上限。かすれたルーンが増えるにつれて下限まで減らし、
   * reduce_new_when_due_over を超えたら reduced_new_per_run。
   */
  newLimitFor(dueCount) {
    if (dueCount > this.reduceNewWhenDueOver) return this.reducedNewPerRun;
    const lo = this.newPerRun[0];
    const hi = this.newPerRun[this.newPerRun.length - 1];
    const ratio = this.reduceNewWhenDueOver > 0 ? dueCount / this.reduceNewWhenDueOver : 1;
    return Math.round(hi - (hi - lo) * ratio);
  }
}
