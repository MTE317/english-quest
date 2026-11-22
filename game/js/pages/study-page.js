// ギルドの学び舎：資料室（予習）・石碑の間（石の一覧と覚醒の試練）・訓練場（鍛錬）・昇格試験
import { loadGameData } from '../gamedata.js?v=features-2';
import { loadCsv, loadJson } from '../data.js?v=features-2';
import { buildLexicon } from '../lexicon.js';
import { Scheduler, STAGE_LABEL } from '../srs.js?v=features-2';
import { LearningStore, now } from '../storage.js?v=features-2';
import { QuestionPicker } from '../picker.js';
import { GameSession } from '../save.js?v=features-2';
import { normalizeGame } from '../game-state.js?v=features-2';
import { seededRng, currentRank } from '../dungeon.js?v=features-2';
import { checkRankUp } from '../town.js?v=features-2';
import {
  stoneProgress, nextUnread, trialBlock, trialPlan, finishExam, promotionBlock, promotionPlan, starLearnedRatio,
  trainingReward, applyTraining,
} from '../study.js?v=features-2';
import { runQuiz } from '../ui/quiz-runner.js?v=features-2';
import { speak, canSpeak } from '../speech.js';
import { el, render, stars } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();
session.installAutoSave(window);
let data; let lex; let scheduler; let store; let srs;
const today = () => scheduler.dayOf(now());
const rng = () => seededRng({ rng: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });
const TABS = [['library', '資料室'], ['hall', '石碑の間'], ['training', '訓練場'], ['exam', '昇格試験']];
const requestedTab = new URLSearchParams(window.location.search).get('tab');
let tab = TABS.find(([id]) => id === requestedTab)?.[0] ?? 'library';

function tabs() {
  return el('div', { class: 'tabs four' }, TABS.map(([id, label]) => el('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; draw(); } }, label)));
}

// ---------------- 資料室：予習カード ----------------
function library() {
  return [
    el('p', { class: 'muted small' }, '次に出るルーンを読み解く（英語・意味・例文・発音）。読むだけでは報酬はありません。'),
    lex.stones.map((s) => {
      const p = stoneProgress(lex, store, scheduler, s.id, today());
      return el('button', { disabled: p.allRead, onclick: () => showCards(s.id) },
        el('div', { class: 'choice-title' }, `${stars(s.star)} ${s.name}`),
        el('div', { class: 'stats' }, `読み解いた ${p.read} / ${p.total}`, p.allRead ? '　すべて読み解いた' : ''));
    }),
  ];
}

function showCards(stoneId) {
  const cards = nextUnread(lex, store, stoneId, 999);
  let k = 0;
  const show = () => {
    if (k >= cards.length) { draw(); return; }
    const w = cards[k];
    render(view,
      el('div', { class: 'progress' }, el('span', {}, '予習カード'), el('span', {}, `${k + 1} / ${cards.length}`)),
      el('div', { class: 'panel card' },
        el('div', { class: 'prompt', lang: 'en' }, w.en),
        canSpeak() ? el('div', { class: 'center' }, el('button', { class: 'speak', onclick: () => speak(w.en) }, '🔊')) : null,
        el('div', { class: 'center', style: 'font-size:1.3rem' }, w.ja),
        w.pos ? el('div', { class: 'center muted small' }, w.pos) : null,
        w.exampleEn ? el('div', { class: 'small', lang: 'en' }, w.exampleEn) : null,
        w.exampleJa ? el('div', { class: 'small muted' }, w.exampleJa) : null),
      el('button', { class: 'primary', onclick: () => { store.markRead([w.id]); k += 1; show(); } }, '読み解いた → 次へ'),
      el('button', { class: 'ghost', onclick: () => draw() }, 'ここでやめる'));
    window.scrollTo(0, 0);
  };
  show();
}

// ---------------- 石碑の間 ----------------
function hall() {
  return [
    el('p', { class: 'muted small' }, 'ルーンストーンの一覧。すべて読み解いた石は「覚醒の試練」を受けられる。'),
    lex.stones.map((s) => {
      const p = stoneProgress(lex, store, scheduler, s.id, today());
      const block = trialBlock(data, lex, store, scheduler, s.id, today());
      return el('div', { class: `panel small ${p.awakened ? 'awakened' : ''}` },
        el('div', { class: 'choice-title' }, `${stars(s.star)} ${s.name}${p.awakened ? '　✨覚醒' : ''}`),
        el('div', { class: 'stats' },
          el('span', {}, `読み解いた ${p.read}/${p.total}`),
          el('span', {}, `${STAGE_LABEL.learning} ${p.learning}`), el('span', {}, `${STAGE_LABEL.learned} ${p.learned}`),
          p.due ? el('span', { class: 'error' }, `かすれ ${p.due}`) : null),
        p.awakened ? null : el('button', { disabled: !!block, onclick: () => startTrial(s.id) }, block || '覚醒の試練を受ける'));
    }),
  ];
}

function startTrial(stoneId) {
  const plan = trialPlan(data, lex, stoneId, rng());
  let i = 0;
  runQuiz({
    view, lex, scheduler, store, total: plan.words.length, format: 'mixed', title: '覚醒の試練',
    next: () => ({ word: lex.wordsById.get(plan.words[i++]) }),
    onDone: (correct, total) => {
      const passed = finishExam(data, store, plan, correct, today(), () => {
        store.setAwakened(stoneId, today());
        session.update((game) => {
          const title = 'ルーンを覚醒させし者';
          if (!game.titles.includes(title)) game.titles.push(title);
        });
      });
      render(view,
        el('h2', {}, passed ? '✨ 石が覚醒した！' : '試練に失敗…'),
        el('div', { class: 'panel center' }, el('div', { class: 'prompt' }, `${correct} / ${total}`), el('div', { class: 'muted' }, `合格は ${Math.round(plan.passRate * 100)}%`)),
        passed ? el('p', { class: 'small' }, '神殿で刻印にはめられます。') : el('p', { class: 'small' }, '次の日に再挑戦できる。'),
        el('button', { class: 'primary', onclick: () => { tab = 'hall'; draw(); } }, '石碑の間へ'));
    },
  });
}

// ---------------- 訓練場：鍛錬 ----------------
function training() {
  const g = session.game;
  const counts = data.balance.training?.questions ?? [5, 10, 15];
  const st = { member: 0, kind: 'xp', count: counts[counts.length - 1], stoneId: lex.stones[0].id };
  const read = lex.stones.filter((s) => stoneProgress(lex, store, scheduler, s.id, today()).read > 0);
  return [
    el('p', { class: 'muted small' }, '戦闘なしでまとめて解く。かすれたルーン（復習）を先に出す。日数は進まず、お金や素材は入らない。'),
    el('label', { class: 'small' }, 'だれを鍛える', el('select', { class: 'select', onchange: (e) => { st.member = Number(e.target.value); } },
      g.party.map((m, i) => el('option', { value: i }, `${m.name}（${data.jobsById.get(m.job).name} Lv${m.lv}）`)))),
    el('label', { class: 'small' }, '何を伸ばす', el('select', { class: 'select', onchange: (e) => { st.kind = e.target.value; } },
      el('option', { value: 'xp' }, '経験値'), el('option', { value: 'ap' }, 'AP（今のジョブ）'))),
    el('label', { class: 'small' }, '問題数', el('select', { class: 'select', onchange: (e) => { st.count = Number(e.target.value); } },
      counts.map((c) => el('option', { value: c, selected: c === st.count }, `${c}問`)))),
    el('label', { class: 'small' }, '新しいルーンを出す石', el('select', { class: 'select', onchange: (e) => { st.stoneId = e.target.value; } },
      (read.length ? read : lex.stones).map((s) => el('option', { value: s.id }, `${stars(s.star)} ${s.name}`)))),
    el('button', { class: 'primary', onclick: () => startTraining(st) }, '鍛錬をはじめる'),
  ];
}

function startTraining(st) {
  const picker = new QuestionPicker({ lex, store, scheduler, stoneId: st.stoneId, nowMs: now() });
  runQuiz({
    view, lex, scheduler, store, total: st.count, title: '鍛錬',
    next: () => picker.next(),
    onAnswer: (w, ok) => picker.report(w.id, ok),
    onDone: (correct, total) => {
      let msg;
      session.update((g) => {
        const m = g.party[st.member];
        const r = trainingReward(data, g, m, st.kind, correct, total);
        const ups = applyTraining(data, g, st.member, r);
        msg = r.xp ? `${m.name}：経験値 +${r.xp}${ups ? `（Lv${m.lv}に上がった！）` : ''}` : `${m.name}：AP +${r.ap}`;
        if (!r.xp && st.kind === 'xp') msg += '（今の★の敵より強くなりすぎて、鍛錬の経験値が入らない）';
      });
      render(view,
        el('h2', {}, '鍛錬おわり'),
        el('div', { class: 'panel center' }, el('div', { class: 'prompt' }, `${correct} / ${total}`)),
        el('div', { class: 'panel small' }, msg),
        el('button', { class: 'primary', onclick: () => { tab = 'training'; draw(); } }, 'もどる'));
    },
  });
}

// ---------------- 昇格試験 ----------------
function exam() {
  const g = session.game;
  const idx = data.ranks.findIndex((r) => r.id === g.rank);
  const next = data.ranks[idx + 1];
  const star = currentRank(data, g).maxDungeonRank;
  const r = starLearnedRatio(lex, store, scheduler, star);
  const block = promotionBlock(data, lex, store, scheduler, g, today());
  return [
    el('div', { class: 'panel small' },
      el('div', {}, `今のランク：${currentRank(data, g).title}`),
      next ? el('div', {}, `次のランク：${next.title}${next.needsExam ? '（昇格試験あり）' : '（試験なし。ギルドのポイントで上がる）'}`) : null,
      el('div', {}, `★${star}のルーンの習得：${r.learned} / ${r.total}（${Math.round(r.ratio * 100)}%）`)),
    next?.id === 'S' ? el('a', { class: 'btn primary', href: 'challenge.html' }, '最終試験へ') : next?.needsExam ? el('button', { class: 'primary', disabled: !!block, onclick: () => startPromotion() }, block || '昇格試験を受ける') : null,
    el('p', { class: 'muted small' }, '合格したうえで、ギルドのポイントと「今の★のダンジョンを踏破」がそろうとランクが上がる。'),
  ];
}

function startPromotion() {
  const plan = promotionPlan(data, lex, session.game, rng());
  let i = 0;
  runQuiz({
    view, lex, scheduler, store, total: plan.words.length, format: 'mixed', title: '昇格試験',
    next: () => ({ word: lex.wordsById.get(plan.words[i++]) }),
    onDone: (correct, total) => {
      const lines = [];
      const passed = finishExam(data, store, plan, correct, today(), () => {
        session.update((g) => { g.examsPassed.push(plan.rankId); lines.push(...checkRankUp(data, g)); });
      });
      render(view,
        el('h2', {}, passed ? '合格！' : '不合格…'),
        el('div', { class: 'panel center' }, el('div', { class: 'prompt' }, `${correct} / ${total}`), el('div', { class: 'muted' }, `合格は ${Math.round(plan.passRate * 100)}%`)),
        lines.length ? el('div', { class: 'panel small' }, lines.map((l) => el('div', {}, l))) : null,
        passed && !lines.length ? el('p', { class: 'small' }, 'ポイントか踏破がそろうとランクが上がる。') : null,
        passed ? null : el('p', { class: 'small' }, '次の日に再挑戦できる。'),
        el('button', { class: 'primary', onclick: () => { tab = 'exam'; draw(); } }, 'もどる'));
    },
  });
}

function draw() {
  if (!session.game?.party) {
    render(view, el('p', {}, 'まだパーティがいません。'), el('a', { class: 'btn primary', href: 'party.html' }, 'パーティを作る'));
    return;
  }
  if (session.inDungeon) {
    render(view, el('p', {}, 'ダンジョンの中にいます。'), el('a', { class: 'btn primary', href: 'dungeon.html' }, 'ダンジョンへ'));
    return;
  }
  render(view, tabs(), { library, hall, training, exam }[tab]());
  window.scrollTo(0, 0);
}

(async () => {
  try {
    const [gd, srsFile, stones, lexicon] = await Promise.all([loadGameData(), loadJson('srs.json'), loadCsv('rune_stones.csv'), loadCsv('lexicon.csv')]);
    data = gd; srs = srsFile.data;
    scheduler = new Scheduler(srs);
    lex = buildLexicon(stones.rows, lexicon.rows);
    store = new LearningStore();
    if (session.game && !session.readOnly) { normalizeGame(data, session.game); session.save(); }
    draw();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
