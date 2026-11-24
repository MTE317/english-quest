// 英語学習は訓練場（単語・瞬間英作文・チャンク）と試験の間へ集約する。
import { loadGameData } from '../gamedata.js?v=rune-study-1';
import { loadJson } from '../data.js?v=features-2';
import { loadLearningCatalog, FEATURED_SET_ID } from '../learning-catalog.js?v=learning-v1-1';
import { Scheduler } from '../srs.js?v=features-2';
import { LearningStore, now } from '../storage.js?v=rune-study-1';
import { GameSession } from '../save.js?v=rune-study-1';
import { normalizeGame } from '../game-state.js?v=party6-1';
import { currentRank } from '../dungeon.js?v=build36-1';
import { nextRankStatus, checkRankUp } from '../town.js?v=build36-1';
import { promotionProgress, promotionExamState } from '../promotion.js?v=training-v2-1';
import { learningStatistics } from '../learning-stats.js?v=training-v2-1';
import { TRAINING_COUNTS } from '../training.js?v=training-v2-1';
import { runTrainingSession } from '../ui/training-runner.js?v=training-v2-1';
import { runDualPromotionExam } from '../ui/learning-exams.js?v=training-v2-1';
import { el, render } from '../dom.js';
import { setSceneMusic } from '../battle-music.js?v=music-suite-1';
import { installGameShell } from '../ui/game-shell.js?v=pixel-town-1';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('study', session);
session.installAutoSave(window);
setSceneMusic('facility');

let data; let catalog; let store; let scheduler; let chantConfig;
const TABS = [['training', '訓練場'], ['exam', '試験の間']];
const query = new URLSearchParams(location.search);
let tab = query.get('tab') === 'exam' ? 'exam' : 'training';
const state = {
  mode: ['words','phrases','chunks','review','mixed'].includes(query.get('mode')) ? query.get('mode') : 'mixed',
  setId: FEATURED_SET_ID, chunkId: 'C001', count: 10,
};
let message = '';

function menu() {
  return el('div', { class: 'tabs study-tabs', role: 'group', 'aria-label': '英語学習' },
    TABS.map(([id, label]) => el('button', {
      class: tab === id ? 'on' : '', 'aria-pressed': String(tab === id),
      onclick: () => {
        tab = id;
        const url = new URL(location.href); url.searchParams.set('tab', id);
        history.replaceState(null, '', url);
        message = '';
        draw();
      },
    }, label)));
}

function chosenText(set) {
  const count = (catalog.wordsByStone.get(set.id) ?? []).length;
  const phrases = (catalog.phrasesByStone.get(set.id) ?? []).length;
  return set.name + '（単語' + count + '・英作文' + phrases + '）';
}

function training() {
  const today = scheduler.dayOf(now());
  const progress = learningStatistics(catalog, store, session.game, scheduler, today);
  const modes = [
    ['mixed', 'おまかせ', '単語と英作文を混ぜて学習'],
    ['words', '単語・熟語', '4択で新規学習と復習'],
    ['phrases', '瞬間英作文', '日本語から英文を声に出す'],
    ['chunks', 'チャンク集中', '同じ型の英文を続けて反復'],
    ['review', '復習・苦手', '期限到来と間違えた問題'],
  ];
  const allSets = [catalog.stonesById.get(FEATURED_SET_ID),
    ...catalog.mainCategories.map((main) => catalog.stonesById.get(main.id))].filter(Boolean);
  const subSets = catalog.subcategories;
  return [
    el('p', { class: 'muted small' },
      '時間がなくても5問から。育成対象は選ばず、6人全員へ冒険の約10分の1を目安とした少量のXP・APを付与します。'),
    el('div', { class: 'route-facts' },
      [['単語の復習待ち', progress.words.due],
        ['英作文の復習待ち', progress.phrases.due],
        ['習得した単語', progress.words.masteredEver],
        ['言えるようになった英文', progress.phrases.masteredEver]]
        .map(([title, value]) => el('div', {}, el('small', {}, title), el('strong', {}, String(value))))),
    el('h3', {}, '学習モード'),
    el('div', { class: 'training-mode-grid', role: 'group', 'aria-label': '学習モード' },
      modes.map(([id, title, note]) => el('button', {
        class: 'training-mode', 'aria-pressed': String(state.mode === id),
        onclick: () => { state.mode = id; message = ''; draw(); },
      }, el('strong', {}, title), el('small', {}, note)))),
    el('h3', {}, '教材を選ぶ'),
    el('div', { class: 'training-set-grid', role: 'group', 'aria-label': '教材コレクション' },
      allSets.map((set) => el('button', {
        class: 'training-set', 'aria-pressed': String(state.setId === set.id),
        onclick: () => { state.setId = set.id; draw(); },
      }, el('span', { class: 'training-set-gem', 'aria-hidden': 'true' }, '◆'),
      el('strong', {}, set.name),
      el('small', {}, state.mode === 'words'
        ? String((catalog.wordsByStone.get(set.id) ?? []).length) + '項目'
        : String((catalog.phrasesByStone.get(set.id) ?? []).length) + 'フレーズ')))),
    el('label', { class: 'small' }, 'さらに細かく選ぶ（任意）',
      el('select', { class: 'select', value: state.setId, onchange: (e) => {
        state.setId = e.target.value; draw();
      } }, [
        ...allSets.map((set) => el('option', { value: set.id, selected: state.setId === set.id }, chosenText(set))),
        ...catalog.mainCategories.map((main) => el('optgroup', { label: main.name },
          subSets.filter((sub) => sub.mainId === main.id).map((sub) =>
            el('option', { value: sub.id, selected: state.setId === sub.id }, chosenText(sub))))),
        el('option', { value: 'all', selected: state.setId === 'all' }, '全カテゴリー'),
      ])),
    state.mode === 'chunks'
      ? el('label', { class: 'small' }, '練習するチャンク',
        el('select', { class: 'select', onchange: (e) => { state.chunkId = e.target.value; draw(); } },
          catalog.chunks.map((chunk) => el('option', {
            value: chunk.id, selected: chunk.id === state.chunkId,
          }, chunk.id + ' ' + chunk.pattern + '（例文' +
            (catalog.phrasesByChunk.get(chunk.id) ?? []).length + '件）'))),
        el('p', { class: 'muted small' }, '例文が1件のチャンクも学習できますが、複数文での反復には例文追加が必要です。')) : null,
    el('label', { class: 'small' }, '問題数',
      el('select', { class: 'select', onchange: (e) => { state.count = Number(e.target.value); draw(); } },
        TRAINING_COUNTS.map((n) => el('option', { value: n, selected: state.count === n }, n + '問')))),
    el('p', { class: 'muted small' }, '間違えた項目は再出題・苦手記録に反映。期限に正解したときは訓練報酬が1.2倍（1項目1日1回）。'),
    el('button', { class: 'primary', onclick: startTraining }, state.count + '問の訓練を始める'),
    el('a', { class: 'btn', href: 'records.html?tab=log' }, '学習統計を見る'),
  ];
}

function startTraining() {
  message = '';
  runTrainingSession({
    view, catalog, store, session, scheduler, data, chantConfig,
    options: { ...state },
    onFinish: (result) => {
      message = result.answered
        ? result.answered + '問完了（単語' + result.words + '・英作文' + result.phrases +
          '）。6人合計 XP +' + result.xp + ' / AP +' + result.ap + '。端数は次回へ繰り越します。'
        : 'この条件では出題可能な項目がありません。教材や学習モードを変更してください。';
      tab = 'training'; draw();
    },
  });
}

function exam() {
  const g = session.game;
  const rank = currentRank(data, g);
  const status = nextRankStatus(data, g);
  const next = status?.next;
  if (!next) return [el('p', {}, 'すべてのランクを達成しました！')];
  const current = next.needsExam
    ? promotionProgress(catalog, store, g, next.id) : null;
  const passed = current ? promotionExamState(store, next.id) : null;
  return [
    el('div', { class: 'panel' },
      el('h3', {}, '冒険者ランク：' + rank.title),
      el('p', {}, '次の目標：' + next.title),
      !next.needsExam ? el('p', { class: 'muted small' }, '「＋」ランクはギルドポイントで昇格します。') : null,
      current ? el('div', { class: 'route-facts' },
        [['単語の累積習得', current.words + ' / ' + current.required.words],
          ['英作文の累積習得', current.phrases + ' / ' + current.required.phrases],
          ['単語試験', passed.wordPassed ? '合格' : '未合格'],
          ['英作文試験', passed.phrasePassed ? '合格' : '未合格']]
          .map(([name, value]) => el('div', {}, el('small', {}, name), el('strong', {}, value)))) : null,
      (status?.needs ?? []).length
        ? el('p', { class: 'muted small' }, 'その他の昇格条件：' + status.needs.join('・')) : null),
    next.id === 'S'
      ? el('a', { class: 'btn primary', href: 'challenge.html' }, 'Sランク最終試験へ')
      : next.needsExam
        ? el('button', { class: 'primary',
          disabled: !current.wordMet || !current.phraseMet || (g.examsPassed ?? []).includes(next.id),
          onclick: () => startPromotion(next.id) },
          (g.examsPassed ?? []).includes(next.id) ? '二分野とも合格済み' :
            !current.wordMet || !current.phraseMet ? '累積習得条件を達成すると受験可能' : '単語・英作文の昇格試験に挑む') : null,
    el('p', { class: 'muted small' },
      '単語4択と瞬間英作文の両方で80%以上が必要です。各分野の合格履歴は保存し、合格済みの分野は再受験不要です。'),
  ];
}

function startPromotion(rankId) {
  runDualPromotionExam({ view, catalog, store, session, scheduler, chantConfig, rankId,
    onFinish: ({ complete }) => {
      if (complete) {
        const updates = [];
        session.update((g) => {
          if (!g.examsPassed.includes(rankId)) g.examsPassed.push(rankId);
          updates.push(...checkRankUp(data, g));
        });
        message = updates.length ? updates.join('　') :
          '単語・瞬間英作文の両試験に合格しました！ その他の昇格条件を満たすとランクが上がります。';
      } else message = '未合格の分野を復習してから再挑戦しましょう。合格済みの分野は保持されます。';
      tab = 'exam'; draw();
    },
  });
}

function draw() {
  if (!session.game?.party) {
    render(view, el('p', {}, '先にパーティを作成してください。'),
      el('a', { class: 'btn primary', href: 'party.html' }, 'パーティを作る'));
    return;
  }
  if (session.inDungeon) {
    render(view, el('p', {}, '遠征中です。町に帰ってから訓練できます。'),
      el('a', { class: 'btn primary', href: 'dungeon.html' }, '遠征を続ける'));
    return;
  }
  render(view, menu(), message ? el('p', { class: 'panel small', role: 'status' }, message) : null,
    el('section', { class: 'study-room' },
      el('h2', { class: 'chapter-title' }, tab === 'exam' ? '試験の間' : '訓練場'),
      tab === 'exam' ? exam() : training()));
}

(async () => {
  try {
    const [gd, srs, cat, cfg] = await Promise.all([
      loadGameData(), loadJson('srs.json'), loadLearningCatalog(), loadJson('chant.json'),
    ]);
    data = gd; catalog = cat; chantConfig = cfg.data;
    scheduler = new Scheduler(srs.data);
    store = new LearningStore();
    if (session.game && !session.readOnly) {
      normalizeGame(data, session.game, session.run);
      session.save();
    }
    draw();
  } catch (e) {
    render(view, el('p', { class: 'error' }, '読み込みに失敗：' + e.message));
    console.error(e);
  }
})();
