// 出題する単語を選ぶ（1回の遠征・鍛錬・動作確認のテストで共通に使う）。
// 順番：
//   1. かすれたルーン（復習の時期が来た単語。どの石でも）… 思い出せる確率が低い順
//   2. この回で間違えた単語（retry_gap 問あけてからもう一度）
//   3. 選んだ石の未解読の単語 … 1回で初めて出すのは newLimitFor(かすれた数) 語まで
//   4. 選んだ石の、もう見たことのある単語 … 思い出せる確率が低い順、直前に出したものは避ける

export const REASON = Object.freeze({
  DUE: 'due', // かすれたルーン（復習）
  RETRY: 'retry', // この回で間違えた単語
  NEW: 'new', // 初めての単語
  PRACTICE: 'practice', // 練習
});
export const REASON_LABEL = Object.freeze({
  due: 'かすれたルーン（復習）',
  retry: 'もう一度',
  new: '新しいルーン',
  practice: '練習',
});

export class QuestionPicker {
  /**
   * @param lex buildLexicon の結果
   * @param store LearningStore
   * @param scheduler Scheduler
   * @param stoneId 持ってきたルーンストーン
   * @param nowMs 開始の時刻
   * @param state toState() で保存したもの（ダンジョンの途中から再開するとき）
   */
  constructor({ lex, store, scheduler, stoneId, nowMs, state = null }) {
    this.lex = lex;
    this.store = store;
    this.scheduler = scheduler;
    this.stoneId = stoneId;
    if (state) {
      Object.assign(this, {
        today: state.today, asked: state.asked, lastAskedAt: new Map(state.lastAskedAt), retry: state.retry,
        newIntroduced: state.newIntroduced, dueQueue: state.dueQueue, dueAtStart: state.dueAtStart, newLimit: state.newLimit,
      });
      return;
    }
    this.today = scheduler.dayOf(nowMs);
    this.asked = 0; // 出した問題の数
    this.lastAskedAt = new Map(); // id → 何問目に出したか
    this.retry = []; // { id, after }
    this.newIntroduced = 0;

    // 開始の時点でかすれているルーン（どの石でも）
    const due = [];
    for (const [id, rec] of store.entries()) {
      if (lex.wordsById.has(id) && scheduler.isDue(rec, this.today)) due.push(id);
    }
    const r = (id) => scheduler.currentRetrievability(store.get(id), this.today);
    due.sort((a, b) => r(a) - r(b));
    this.dueQueue = scheduler.reviewFirst ? due : [];
    this.dueAtStart = due.length;
    this.newLimit = scheduler.newLimitFor(due.length);
  }

  stoneWords() { return this.lex.wordsByStone.get(this.stoneId) ?? []; }

  /** 次に出す単語 → { word, reason }（出せる単語がなければ null） */
  next() {
    const pick = (id, reason) => {
      this.asked += 1;
      this.lastAskedAt.set(id, this.asked);
      return { word: this.lex.wordsById.get(id), reason };
    };

    // 1. かすれたルーン（この回でまだ出していないもの）
    while (this.dueQueue.length) {
      const id = this.dueQueue.shift();
      if (!this.lastAskedAt.has(id)) return pick(id, REASON.DUE);
    }
    // 2. 間違えた単語のやり直し
    const ri = this.retry.findIndex((x) => x.after <= this.asked);
    if (ri >= 0) {
      const [{ id }] = this.retry.splice(ri, 1);
      return pick(id, REASON.RETRY);
    }
    // 3. 未解読の単語（CSV の順）
    if (this.newIntroduced < this.newLimit) {
      const w = this.stoneWords().find((x) => !this.store.get(x.id) && !this.lastAskedAt.has(x.id));
      if (w) {
        this.newIntroduced += 1;
        return pick(w.id, REASON.NEW);
      }
    }
    // 4. 見たことのある単語の練習（直前に出したものはなるべく避ける）
    const seen = this.stoneWords().filter((x) => this.store.get(x.id) || this.lastAskedAt.has(x.id));
    if (seen.length) {
      const recent = Math.min(this.scheduler.retryGap, seen.length - 1);
      const notRecent = seen.filter((x) => {
        const at = this.lastAskedAt.get(x.id);
        return at == null || this.asked - at >= recent;
      });
      const pool = notRecent.length ? notRecent : seen;
      const r = (w) => this.scheduler.currentRetrievability(this.store.get(w.id), this.today);
      const askedAt = (w) => this.lastAskedAt.get(w.id) ?? -1;
      pool.sort((a, b) => askedAt(a) - askedAt(b) || r(a) - r(b));
      return pick(pool[0].id, REASON.PRACTICE);
    }
    // やり直しが残っていれば、あけずに出す
    if (this.retry.length) return pick(this.retry.shift().id, REASON.RETRY);
    return null;
  }

  /** セーブに入れる形（1回の遠征の中の出題の状態） */
  toState() {
    return {
      stoneId: this.stoneId, today: this.today, asked: this.asked, lastAskedAt: [...this.lastAskedAt], retry: this.retry,
      newIntroduced: this.newIntroduced, dueQueue: this.dueQueue, dueAtStart: this.dueAtStart, newLimit: this.newLimit,
    };
  }

  /** 答えた結果を知らせる（間違えたらこの回の中でもう一度出す） */
  report(id, correct) {
    this.retry = this.retry.filter((x) => x.id !== id);
    if (!correct) this.retry.push({ id, after: this.asked + this.scheduler.retryGap });
  }
}
