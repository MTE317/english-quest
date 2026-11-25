// 単語4択と瞬間英作文の二段階試験。分野別の合格記録はLearningStoreに保存する。
import { runQuiz } from './quiz-runner.js?v=jobs-master-1';
import { el, render } from '../dom.js?v=jobs-master-1';
import { now } from '../storage.js?v=jobs-master-1';
import { speak, canSpeak, stopSpeech } from '../speech.js?v=jobs-master-1';
import { recordChant } from '../chant.js?v=jobs-master-1';
import { makePromotionExam, promotionExamState, recordPromotionPart,
  scorePhraseGrades, PHRASE_GRADE_SCORES } from '../promotion.js?v=jobs-master-1';

export function runDualPromotionExam({ view, catalog, store, session, scheduler, rankId,
  chantConfig, onFinish }) {
  const plan = makePromotionExam(catalog, store, session.game, rankId);
  const state = promotionExamState(store, rankId);
  const passRate = plan.passRate;
  const title = rankId === 'S' ? 'Sランク最終試験' : '昇格試験 ' + rankId;
  const finish = (result) => { stopSpeech(); onFinish(result); };

  function words() {
    if (state.wordPassed) return phrases();
    let i = 0;
    runQuiz({ view, lex: catalog.lexicon, scheduler, store,
      total: plan.words.length, title: title + '：単語・熟語',
      direction: 'en2ja', format: 'meaning',
      next: () => ({ word: plan.words[i++] }),
      onDone: (correct, total) => {
        const result = recordPromotionPart(store, rankId, 'word', correct, total,
          scheduler.dayOf(now()), passRate);
        render(view, el('section', { class: 'panel' },
          el('h2', {}, result.passed ? '第1試験合格！' : '単語試験は不合格'),
          el('p', {}, String(correct) + ' / ' + String(total) + '問正解'),
          result.passed
            ? el('button', { class: 'primary', onclick: phrases }, '第2試験：瞬間英作文へ')
            : el('button', { class: 'primary', onclick: () => finish({ complete: false, rankId, section: 'word' }) }, '試験の間に戻る')));
      },
    });
  }

  function phrases() {
    if (state.phrasePassed) return finish({ complete: true, rankId });
    const grades = [];
    let position = 0;
    function next() {
      stopSpeech();
      if (position >= plan.phrases.length) {
        const score = scorePhraseGrades(grades);
        const result = recordPromotionPart(store, rankId, 'phrase', score, grades.length,
          scheduler.dayOf(now()), passRate);
        render(view, el('section', { class: 'panel' },
          el('h2', {}, result.passed ? '第2試験合格！' : '英作文試験は不合格'),
          el('p', {}, String(score) + ' / ' + String(grades.length) + '点（80%以上で合格）'),
          el('p', { class: 'muted small' }, '○＝1点、△＝0.5点、×＝0点。自己評価した成績を保存しました。'),
          el('button', { class: 'primary',
            onclick: () => finish({ complete: result.complete, rankId, section: 'phrase' }) },
            result.complete ? '昇格判定へ' : '試験の間に戻る')));
        return;
      }
      const phrase = plan.phrases[position];
      const answer = el('div');
      const reveal = el('button', { class: 'primary', onclick: () => {
        reveal.disabled = true;
        if (canSpeak()) speak(phrase.en);
        render(answer,
          el('p', { class: 'chant-english', lang: 'en' }, phrase.en),
          canSpeak() ? el('button', { class: 'ghost', onclick: () => speak(phrase.en) }, 'もう一度聞く') : null,
          el('p', { class: 'small muted' }, 'どれくらい英語で言えましたか？'),
          el('div', { class: 'chant-grades' }, [
            ['o', '○　言えた'], ['t', '△　詰まった'], ['x', '×　言えなかった'],
          ].map(([grade, label]) => el('button', { onclick: () => {
            session.update((game) => recordChant(game, chantConfig, scheduler, now(), phrase.id, grade));
            grades.push(grade);
            position += 1;
            next();
          } }, label))));
      } }, '答えを見る');
      render(view,
        el('div', { class: 'progress' }, title + '：瞬間英作文　' + (position + 1) + ' / ' + plan.phrases.length),
        el('div', { class: 'panel chant-card' },
          el('p', { class: 'chant-japanese', lang: 'ja' }, phrase.ja), reveal, answer));
      window.scrollTo(0, 0);
    }
    next();
  }
  if (state.wordPassed) phrases();
  else words();
}

