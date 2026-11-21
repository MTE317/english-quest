// 動作確認用：ルーンストーンを選んで10問解く画面
import { loadCsv, loadJson } from '../data.js';
import { buildLexicon } from '../lexicon.js';
import { Scheduler, STAGE_LABEL, dayIndex, dayToString } from '../srs.js';
import { LearningStore, now, getDebugDayOffset, setDebugDayOffset } from '../storage.js';
import { QuestionPicker, REASON_LABEL } from '../picker.js';
import { makeQuestion, DIRECTION, DIRECTION_LABEL } from '../quiz.js';
import { speak, canSpeak } from '../speech.js';
import { el, render, stars } from '../dom.js';

// この画面は動作確認用なので、問題数はユーザーの指定（10問）で固定
const QUESTIONS_PER_TEST = 10;
const MIXED = 'mixed';

const view = document.getElementById('view');
let lex;
let scheduler;
let store;
let selectedStone = null;
let direction = MIXED;

function stoneStats(stoneId, today) {
  const counts = { new: 0, learning: 0, learned: 0, due: 0 };
  for (const w of lex.wordsByStone.get(stoneId) ?? []) {
    const rec = store.get(w.id);
    counts[scheduler.stageOf(rec)] += 1;
    if (scheduler.isDue(rec, today)) counts.due += 1;
  }
  return counts;
}

function totalDue(today) {
  let n = 0;
  for (const [id, rec] of store.entries()) if (lex.wordsById.has(id) && scheduler.isDue(rec, today)) n += 1;
  return n;
}

function daysLabel(days) {
  if (days <= 0) return '今日';
  if (days === 1) return '明日';
  return `${days}日後`;
}

// ---------------- 石を選ぶ画面 ----------------
function showSelect() {
  const today = dayIndex(now());
  const offset = getDebugDayOffset();
  const due = totalDue(today);
  const dirButton = (value, label) => el('button', {
    class: direction === value ? 'on' : '',
    onclick: () => { direction = value; showSelect(); },
  }, label);

  render(view,
    el('div', { class: 'panel' },
      el('div', {}, `今日：${dayToString(today)}`, offset ? el('span', { class: 'error' }, `（テスト用に${offset}日ずらし中）`) : null),
      el('div', {}, `かすれたルーン（復習の時期が来た単語）：${due}語`),
      el('div', { class: 'muted small' }, `1回で初めて出す単語：${scheduler.newLimitFor(due)}語まで`),
    ),
    el('h2', {}, 'ルーンストーンを選ぶ'),
    el('ul', { class: 'choice-list' },
      lex.stones.map((s) => {
        const c = stoneStats(s.id, today);
        return el('li', {},
          el('button', {
            class: selectedStone === s.id ? 'selected' : '',
            onclick: () => { selectedStone = s.id; showSelect(); },
          },
          el('div', { class: 'choice-title' }, el('span', { class: 'stars' }, stars(s.star)), ' ', s.name),
          el('div', { class: 'stats' },
            el('span', {}, `${STAGE_LABEL.new} ${c.new}`),
            el('span', {}, `${STAGE_LABEL.learning} ${c.learning}`),
            el('span', {}, `${STAGE_LABEL.learned} ${c.learned}`),
            c.due ? el('span', { class: 'error' }, `かすれ ${c.due}`) : null,
          )));
      }),
    ),
    el('h2', {}, '問題の形'),
    el('div', { class: 'seg' },
      dirButton(MIXED, 'まぜる'),
      dirButton(DIRECTION.EN_JA, DIRECTION_LABEL.en2ja),
      dirButton(DIRECTION.JA_EN, DIRECTION_LABEL.ja2en),
    ),
    el('button', { class: 'primary', disabled: !selectedStone, onclick: startTest },
      selectedStone ? `${QUESTIONS_PER_TEST}問に挑戦` : '石を選んでください'),
    debugPanel(),
  );
}

function debugPanel() {
  const offset = getDebugDayOffset();
  return el('details', { class: 'panel' },
    el('summary', {}, '学習記録（動作確認用）'),
    el('div', { class: 'small' }, `記録のある単語：${store.size}語・保存の大きさ：約${Math.ceil(store.byteSize() / 1024)}KB`),
    el('div', { class: 'muted small' }, '日付をずらすと、復習の時期が来た単語（かすれたルーン）の出方を確かめられます。'),
    el('div', { class: 'row' },
      el('button', { onclick: () => { setDebugDayOffset(offset + 1); showSelect(); } }, '1日進める'),
      el('button', { onclick: () => { setDebugDayOffset(offset + 7); showSelect(); } }, '7日進める'),
    ),
    el('button', { disabled: !offset, onclick: () => { setDebugDayOffset(0); showSelect(); } }, '日付を今日に戻す'),
    el('button', {
      class: 'ghost error',
      onclick: () => {
        if (confirm('学習記録をすべて消します。よろしいですか？')) { store.clear(); showSelect(); }
      },
    }, '学習記録を消す'),
  );
}

// ---------------- 問題 ----------------
function startTest() {
  const picker = new QuestionPicker({ lex, store, scheduler, stoneId: selectedStone, nowMs: now() });
  const results = [];
  const askNext = () => {
    if (results.length >= QUESTIONS_PER_TEST) return showResult(results);
    const next = picker.next();
    if (!next) return showResult(results);
    const dir = direction === MIXED
      ? (Math.random() < 0.5 ? DIRECTION.EN_JA : DIRECTION.JA_EN)
      : direction;
    const rec = store.get(next.word.id);
    const q = makeQuestion(next.word, lex, { direction: dir, familiar: scheduler.isFamiliar(rec) });
    showQuestion(q, next.reason, results.length + 1, (correct) => {
      const newRec = scheduler.review(rec, correct, now());
      store.set(next.word.id, newRec);
      picker.report(next.word.id, correct);
      results.push({ word: next.word, correct, rec: newRec, reason: next.reason });
      return newRec;
    }, askNext);
  };
  askNext();
}

function showQuestion(q, reason, number, onAnswer, onNext) {
  const isEnPrompt = q.direction === DIRECTION.EN_JA;
  const feedback = el('div', { class: 'feedback' });
  const after = el('div');
  let answered = false;

  const buttons = q.choices.map((c, i) => el('button', {
    onclick: () => {
      if (answered) return;
      answered = true;
      const correct = i === q.answerIndex;
      buttons.forEach((b, j) => {
        b.disabled = true;
        if (j === q.answerIndex) b.classList.add('correct');
        else if (j === i) b.classList.add('wrong');
      });
      const rec = onAnswer(correct);
      const today = dayIndex(now());
      feedback.className = `feedback ${correct ? 'good' : 'bad'}`;
      feedback.textContent = correct ? '正解！ ルーンが輝いた' : `ざんねん… 正解は「${q.choices[q.answerIndex].text}」`;
      render(after,
        el('div', { class: 'panel small' },
          el('div', {}, `${q.word.en} ＝ ${q.word.ja}`),
          el('div', { class: 'muted' },
            `${STAGE_LABEL[rec.stage]}・日を空けた連続正解 ${rec.streak}回・次の復習：${daysLabel(rec.due - today)}`),
        ),
        canSpeak() && !isEnPrompt ? el('button', { class: 'ghost', onclick: () => speak(q.word.en) }, `🔊 ${q.word.en}`) : null,
        el('button', { class: 'primary', onclick: onNext }, number >= QUESTIONS_PER_TEST ? '結果を見る' : '次へ'),
      );
    },
  }, c.text));

  render(view,
    el('div', { class: 'progress' },
      el('span', {}, `${number} / ${QUESTIONS_PER_TEST}問`),
      el('span', {}, DIRECTION_LABEL[q.direction]),
    ),
    el('div', { class: 'center' }, el('span', { class: `tag ${reason}` }, REASON_LABEL[reason])),
    el('div', { class: `prompt ${isEnPrompt ? '' : 'ja'}`, lang: isEnPrompt ? 'en' : 'ja' }, q.prompt),
    el('div', { class: 'center' },
      canSpeak() && isEnPrompt ? el('button', { class: 'speak', onclick: () => speak(q.word.en), 'aria-label': '発音を聞く' }, '🔊') : null),
    el('div', { class: 'muted small center' },
      isEnPrompt ? '意味を選んでください' : '英語を選んでください'),
    el('div', { class: 'options' }, buttons),
    feedback,
    after,
  );
  window.scrollTo(0, 0);
}

// ---------------- 結果 ----------------
function showResult(results) {
  const today = dayIndex(now());
  const ok = results.filter((r) => r.correct).length;
  render(view,
    el('h2', {}, '結果'),
    el('div', { class: 'panel center' },
      el('div', { class: 'prompt' }, `${ok} / ${results.length}`),
      el('div', { class: 'muted' }, '正解'),
    ),
    el('ul', { class: 'result-list' },
      results.map((r) => el('li', {},
        el('span', { class: r.correct ? 'mark-good' : 'mark-bad' }, r.correct ? '○ ' : '× '),
        el('span', { lang: 'en' }, r.word.en), '　', r.word.ja,
        el('div', { class: 'stats' },
          el('span', {}, REASON_LABEL[r.reason]),
          el('span', {}, STAGE_LABEL[r.rec.stage]),
          el('span', {}, `次の復習：${daysLabel(r.rec.due - today)}`),
        ),
      )),
    ),
    el('button', { class: 'primary', onclick: startTest }, 'もう一度（同じ石）'),
    el('button', { onclick: showSelect }, '石を選び直す'),
  );
  window.scrollTo(0, 0);
}

(async () => {
  try {
    const [srs, stones, lexicon] = await Promise.all([
      loadJson('srs.json'), loadCsv('rune_stones.csv'), loadCsv('lexicon.csv'),
    ]);
    scheduler = new Scheduler(srs.data);
    lex = buildLexicon(stones.rows, lexicon.rows);
    store = new LearningStore();
    selectedStone = lex.stones[0]?.id ?? null;
    showSelect();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
  }
})();

