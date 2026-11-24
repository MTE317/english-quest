import { makeQuestion } from '../quiz.js?v=question-speech-1';
import { makeTrainingPicker, applyTrainingAnswer, shouldShowChunkHint } from '../training.js?v=training-start-top-1';
import { recordChant } from '../chant.js?v=stability-1';
import { now } from '../storage.js?v=stability-1';
import { speak, canSpeak, stopSpeech } from '../speech.js?v=music-suite-1';
import { el, render } from '../dom.js';

const WORD_GRADES = [[1, '×', 'わからない'], [3, '〇', 'わかる'], [4, '◎', '簡単']];
const REASONS = { due: '期限が来た復習', retry: '苦手問題', new: '新規学習', practice: '練習' };
const MODE_LABELS = { words: '単語・熟語', phrases: '通常の英作文', chunks: 'チャンク集中', review: '復習' };

export function runTrainingSession({ view, catalog, store, session, scheduler, data,
  chantConfig, options, onFinish }) {
  const picker = makeTrainingPicker(catalog, store, session.game, scheduler,
    scheduler.dayOf(now()), options);
  let answered = 0;
  let wordCorrect = 0;
  let words = 0;
  let phrases = 0;
  let xp = 0;
  let ap = 0;

  function finish() {
    stopSpeech();
    onFinish({ answered, words, wordCorrect, phrases, xp, ap });
  }
  function recordReward(entry, passed) {
    let result;
    session.update((game) => {
      result = applyTrainingAnswer(data, game, {
        kind: entry.kind, id: entry.item.id, day: scheduler.dayOf(now()),
        due: entry.wasDue, passed,
      });
    });
    xp += result.xp;
    ap += result.ap;
  }
  function next() {
    stopSpeech();
    if (answered >= options.count) return finish();
    const entry = picker.next();
    if (!entry) return finish();
    if (entry.kind === 'word') wordQuestion(entry);
    else phraseQuestion(entry);
  }
  function header(entry) {
    return el('div', { class: 'progress quiz-progress' },
      el('span', {}, '訓練場 ' + (answered + 1) + ' / ' + options.count),
      el('span', {}, [MODE_LABELS[options.mode], REASONS[entry.reason] ?? '学習中'].filter(Boolean).join('・')));
  }
  function wordQuestion(entry) {
    const word = entry.item;
    const q = makeQuestion(word, catalog.lexicon,
      { direction: 'en2ja', familiar: scheduler.isFamiliar(store.get(word.id)) });
    let done = false;
    const feedback = el('div');
    const buttons = q.choices.map((choice, index) => el('button', { onclick: () => {
      if (done) return;
      done = true;
      const correct = index === q.answerIndex;
      const time = now();
      let rated = false;
      function rate(grade) {
        if (rated) return;
        rated = true;
        const rec = scheduler.reviewGrade(store.get(word.id), correct ? grade : 1, time, correct);
        store.recordAnswer(word.id, rec, scheduler.dayOf(time), correct);
        picker.report(entry, correct);
        recordReward(entry, correct);
        answered++;
        words++;
        if (correct) wordCorrect++;
      }
      // 誤答はその場で Again として保存する。
      if (!correct) rate(1);
      for (let i = 0; i < buttons.length; i++) {
        buttons[i].disabled = true;
        if (i === q.answerIndex) buttons[i].classList.add('correct');
        else if (i === index) buttons[i].classList.add('wrong');
      }
      render(feedback,
        el('div', { class: 'feedback ' + (correct ? 'good' : 'bad'), role: 'status' },
          correct ? '正解！' : '正解は「' + q.choices[q.answerIndex].text + '」'),
        el('p', { class: 'small center' }, word.en + ' ＝ ' + word.ja),
        el('p', { class: 'small center', id: 'word-grade-label' },
          correct ? 'どのくらい覚えていますか？' : '誤答は × として記録しました'),
        el('div', { class: 'training-word-grades', role: 'group', 'aria-labelledby': 'word-grade-label' },
          WORD_GRADES.map(([grade, symbol, label]) => el('button', {
            disabled: !correct && grade !== 1,
            'aria-label': symbol + ' ' + label,
            onclick: () => {
              if (feedback.parentNode !== view) return;
              rate(grade);
              next();
            },
          }, el('span', {}, symbol), el('small', {}, label)))));
      feedback.querySelector('button:not(:disabled)').focus();
      feedback.scrollIntoView({ block: 'nearest' });
    } }, el('span', { class: 'choice-letter', 'aria-hidden': 'true' },
      String.fromCharCode(65 + index)), el('span', {}, choice.text)));
    render(view, header(entry),
      el('div', { class: 'prompt', lang: 'en' }, q.prompt),
      canSpeak() ? el('div', { class: 'center' },
        el('button', { class: 'speak', onclick: () => speak(word.en) }, '🔊 発音')) : null,
      el('div', { class: 'options' }, buttons), feedback);
    window.scrollTo(0, 0);
  }
  function phraseQuestion(entry) {
    const phrase = entry.item;
    const answer = el('div');
    const reveal = el('button', { class: 'primary', onclick: () => {
      reveal.disabled = true;
      if (canSpeak()) speak(phrase.en);
      render(answer,
        el('p', { lang: 'en', class: 'chant-english' }, phrase.en),
        canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(phrase.en) }, 'もう一度聞く') : null,
        el('p', { class: 'muted small' }, '英語で言えましたか？'),
        el('div', { class: 'chant-grades' }, [
          ['o', '○　言えた'], ['t', '△　詰まった'], ['x', '×　言えなかった'],
        ].map(([grade, label]) => el('button', { onclick: () => {
          session.update((game) => {
            recordChant(game, chantConfig, scheduler, now(), phrase.id, grade);
          });
          const passed = grade !== 'x';
          picker.report(entry, passed);
          recordReward(entry, passed);
          answered++;
          phrases++;
          next();
        } }, label))));
    } }, '答えを見る');
    render(view, header(entry),
      el('div', { class: 'panel chant-card' },
        shouldShowChunkHint(options.mode, phrase) ? el('p', { class: 'muted small' },
          'チャンク：' + (catalog.chunksById.get(entry.item.chunkId)?.pattern ?? entry.item.chunkId)) : null,
        el('p', { class: 'chant-japanese', lang: 'ja' }, phrase.ja),
        reveal, answer));
    window.scrollTo(0, 0);
  }
  next();
}
