// ゲームの進み具合のセーブ（自動保存は1つだけ、いつも上書き）。
//
// 決まりごと（docs/checklist.md 4章）
// - 自動保存は1つ。戦闘が1つ終わるたびに保存し、ダンジョンの途中で閉じても再開できる
// - 読み込み直して全滅をなかったことにはできない
// - 全滅したら、ゲームの進み具合はダンジョンに入る前に戻す。学習記録（storage.js の LearningStore）は別の場所なので残る
// - 遭遇・属性相性・討伐数は、ダンジョンに入る前の状態に戻す
//
// 中身
//   { version, savedAt, game, run }
//   game … 町にいるときの進み具合（お金・日数・パーティ・持ち物など。中身は次の段階から足していく）
//   run  … ダンジョンの中にいるときだけある。{ dungeonId, stoneId, floor, battlesDone, snapshot, battle, ... }
//          snapshot はダンジョンに入る直前の game の写し（全滅したらこれに戻す）
//          battle は戦っている途中の戦闘の状態（読み込み直すと同じ戦闘の続きから始まる）
//
// 全滅をなかったことにさせないための約束（戦闘を作るときに守る）
// - 戦闘を始めたら setBattle() で保存する。1行動ごとにも setBattle() で保存する
//   → 負けそうなときに閉じて開き直しても、同じ戦闘の同じところから続く
// - 全員倒れたら、画面に出す前に wipe() を呼ぶ（その場で保存される）
import { SAVE_KEY, safeStorage } from './storage.js?v=rune-study-1';

export const SAVE_VERSION = 2;
const CHANT_BACKUP_KEY = 'englishQuest.chantBackup.v2';
const BROKEN_KEY = `${SAVE_KEY}.broken`;

// 古い版のセーブを新しい版に直す関数（版を上げたらここに足す）。MIGRATIONS[1] は 1 → 2
// 金額は正式データ読込後のnormalizeGameで換算する。外側の版で旧クライアントの誤書込を防ぐ。
const MIGRATIONS = { 1: data => ({ ...data }) };

const clone = (x) => (x == null ? x : structuredClone(x));

/** セーブの読み書きだけをする（1つの場所に上書き） */
export class SaveStore {
  constructor(storage) {
    this.storage = safeStorage(storage);
  }

  /**
   * → { status: 'none' } / { status: 'ok', data } / { status: 'broken', error } / { status: 'newer', data }
   * 壊れていたら、中身を BROKEN_KEY に写して残す（上書きで失わないように）
   */
  read() {
    const raw = this.storage?.getItem(SAVE_KEY);
    if (!raw) return { status: 'none' };
    let data;
    try {
      data = JSON.parse(raw);
      if (!data || typeof data !== 'object' || typeof data.version !== 'number' || !data.game) {
        throw new Error('セーブの形がおかしい');
      }
    } catch (e) {
      this.storage.setItem(BROKEN_KEY, raw);
      return { status: 'broken', error: e.message };
    }
    if (data.version > SAVE_VERSION) return { status: 'newer', data };
    while (data.version < SAVE_VERSION) {
      const migrate = MIGRATIONS[data.version];
      if (!migrate) {
        this.storage.setItem(BROKEN_KEY, raw);
        return { status: 'broken', error: `版 ${data.version} のセーブを読めない` };
      }
      data = { ...migrate(data), version: data.version + 1 };
    }
    return { status: 'ok', data };
  }

  write(data) {
    if (!this.storage) return false;
    this.storage.setItem(SAVE_KEY, JSON.stringify(data));
    return true;
  }

  clear() {
    this.storage?.removeItem(SAVE_KEY);
  }

  readChantBackup() {
    try { return JSON.parse(this.storage?.getItem(CHANT_BACKUP_KEY) ?? 'null'); }
    catch { return null; }
  }

  updateChantBackup(chants) {
    if (chants) this.storage?.setItem(CHANT_BACKUP_KEY, JSON.stringify(chants));
    else this.storage?.removeItem(CHANT_BACKUP_KEY);
  }

  /** 保存している文字数（容量の目安） */
  byteSize() {
    return this.storage?.getItem(SAVE_KEY)?.length ?? 0;
  }
}

/**
 * 遊んでいる間の進み具合を持ち、変わるたびに保存する。
 * 画面からはこのクラスを通して進み具合を変える。
 */
export class GameSession {
  /**
   * @param storage localStorage（テストでは代わりのもの）
   * @param now いまの時刻を返す関数
   */
  constructor({ storage, now = Date.now } = {}) {
    this.store = new SaveStore(storage);
    this.now = now;
    this.state = null;
    this.loadStatus = 'none';
    this.loadError = null;
    this.readOnly = false; // 新しい版のセーブを読んだときは上書きしない
    this.load();
  }

  load() {
    const r = this.store.read();
    this.loadStatus = r.status;
    this.loadError = r.error ?? null;
    this.readOnly = r.status === 'newer';
    this.state = r.status === 'ok' || r.status === 'newer' ? r.data : null;
    return r.status;
  }

  get hasSave() { return !!this.state; }
  get game() { return this.state?.game ?? null; }
  get run() { return this.state?.run ?? null; }
  get inDungeon() { return !!this.state?.run; }
  get inBattle() { return !!this.state?.run?.battle; }

  /** いまの状態を保存する（いつも上書き） */
  save() {
    if (!this.state || this.readOnly) return false;
    this.state.savedAt = this.now();
    return this.store.write(this.state);
  }

  /** はじめから（いまのセーブは上書きされる。学習記録は消えない） */
  startNew(game) {
    this.readOnly = false;
    const previousChants = this.game?.chants ?? this.store.readChantBackup();
    this.state = { version: SAVE_VERSION, savedAt: this.now(), game: clone(game), run: null, lastWipe: null };
    if (previousChants) this.state.game.chants = clone(previousChants);
    if (this.save()) this.store.updateChantBackup(null);
  }

  /** 町にいるときに進み具合を変える：update((game) => { game.gold += 10 }) */
  update(fn) {
    this.#need();
    fn(this.state.game);
    this.save();
  }

  /** ダンジョンに入る。入る直前の game を写しておく */
  enterDungeon({ dungeonId, stoneId, ...rest } = {}, initialize) {
    this.#need();
    if (this.state.run) throw new Error('すでにダンジョンの中にいる');
    this.state.run = {
      dungeonId,
      goldVersion: this.game.goldVersion,
      stoneId,
      ...rest,
      floor: 1,
      battlesDone: 0,
      enteredAt: this.now(),
      snapshot: clone(this.state.game),
      battle: null,
    };
    initialize?.(this.state.run, this.state.game);
    this.save();
  }

  /** ダンジョンの中の状態を変える（階を進めるなど）：updateRun((run, game) => { run.floor += 1 }) */
  updateRun(fn) {
    this.#needRun();
    fn(this.state.run, this.state.game);
    this.save();
  }

  /** 戦闘を始めたとき・1行動ごと：戦闘の状態を保存する */
  setBattle(battle) {
    this.#needRun();
    this.state.run.battle = clone(battle);
    this.save();
  }

  /**
   * 戦闘が1つ終わった（勝った・逃げた）。報酬などは fn の中で game に入れる
   * endBattle((game, run) => { game.gold += 10 })
   */
  endBattle(fn) {
    this.#needRun();
    fn?.(this.state.game, this.state.run);
    this.state.run.battle = null;
    this.state.run.battlesDone += 1;
    this.save();
  }

  /** 町に帰る（帰還ポイント・帰還の道具・クリア） */
  leaveDungeon(fn) {
    this.#needRun();
    if (this.state.run.battle) throw new Error('戦闘の途中では帰れない');
    fn?.(this.state.game, this.state.run);
    this.state.run = null;
    this.save();
  }

  /**
   * 全滅：ゲームの進み具合をダンジョンに入る前に戻して、すぐ保存する。
   * 学習記録は別の場所にあるので、ここでは触らない（残る）。
   * 図鑑・討伐数・報酬は入場時に戻す。詠唱の記録は残す。
   */
  wipe() {
    this.#needRun();
    const run = this.state.run;
    const { chants } = this.state.game;
    this.state.game = clone(run.snapshot);
    if (chants != null) this.state.game.chants = chants;

    this.state.run = null;
    this.state.lastWipe = { at: this.now(), dungeonId: run.dungeonId, floor: run.floor, battlesDone: run.battlesDone };
    this.save();
  }

  /** セーブを消す（学習記録は消さない） */
  deleteSave({ includeLearning = false } = {}) {
    if (includeLearning) this.store.updateChantBackup(null);
    else if (this.game?.chants) this.store.updateChantBackup(this.game.chants);
    this.store.clear();
    this.state = null;
    this.readOnly = false;
  }

  /** 閉じるとき・裏に回ったときにも保存する */
  installAutoSave(target = globalThis) {
    const handler = () => { this.save(); };
    const onVisibility = () => { if (target.document?.visibilityState === 'hidden') handler(); };
    target.addEventListener?.('pagehide', handler);
    target.document?.addEventListener?.('visibilitychange', onVisibility);
    return () => {
      target.removeEventListener?.('pagehide', handler);
      target.document?.removeEventListener?.('visibilitychange', onVisibility);
    };
  }

  #need() {
    if (!this.state) throw new Error('セーブがない（はじめから始める）');
    if (this.readOnly) throw new Error('新しい版のセーブなので変えられない');
  }

  #needRun() {
    this.#need();
    if (!this.state.run) throw new Error('ダンジョンの中ではない');
  }
}
