// 英語学習は訓練場（単語・瞬間英作文・チャンク）と試験の間へ集約する。
import { loadGameData } from '../gamedata.js?v=jobs-master-1';
import { loadJson } from '../data.js?v=jobs-master-1';
import { loadLearningCatalog } from '../learning-catalog.js?v=jobs-master-1';
import { Scheduler } from '../srs.js?v=jobs-master-1';
import { LearningStore, now } from '../storage.js?v=jobs-master-1';
import { GameSession } from '../save.js?v=jobs-master-1';
import { normalizeGame } from '../game-state.js?v=jobs-master-1';
import { currentRank } from '../dungeon.js?v=jobs-master-1';
import { nextRankStatus, checkRankUp } from '../town.js?v=jobs-master-1';
import { promotionProgress, promotionExamState } from '../promotion.js?v=jobs-master-1';
import { learningStatistics } from '../learning-stats.js?v=jobs-master-1';
import { TRAINING_COUNTS, trainingChunksForSet, trainingWordsForSet,
  trainingPhrasesForSet, resolveTrainingMode } from '../training.js?v=jobs-master-1';
import { runTrainingSession } from '../ui/training-runner.js?v=jobs-master-1';
import { runDualPromotionExam } from '../ui/learning-exams.js?v=jobs-master-1';
import { el, render } from '../dom.js?v=jobs-master-1';
import { setSceneMusic } from '../battle-music.js?v=jobs-master-1';
import { installGameShell } from '../ui/game-shell.js?v=jobs-master-1';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('study', session);
session.installAutoSave(window);
setSceneMusic('facility');

let data; let catalog; let store; let scheduler; let chantConfig;
const TABS = [['training', '訓練場'], ['exam', '試験の間']];
const query = new URLSearchParams(location.search);
let tab = query.get('tab') === 'exam' ? 'exam' : 'training';
const initialMode = query.get('mode');
const state = {
  mode: ['phrases', 'chunks'].includes(initialMode) ? 'phrases'
    : initialMode === 'review' ? 'review' : 'words',
  phraseMode: initialMode === 'chunks' ? 'chunks' : 'normal',
  mainId: '00', setId: '00', chunkId: '',
  chunkSearch: '', chunkLimit: 10, showSubcategories: false,
  reviewType: 'both', reviewScope: 'due', count: 10,
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

// モードの選択肢と教材の階層を分け、操作中に不要な選択欄を表示しない。
const MODES = [
  ['words', '単語・熟語', '4択で新規学習'],
  ['phrases', '瞬間英作文', '新規学習・チャンク集中'],
  ['review', '復習', '期限到来・苦手克服'],
];

function choiceButtons(options, selected, onSelect, label) {
  return el('div', { class: 'training-choice-row', role: 'group', 'aria-label': label },
    options.map(([id, title]) => el('button', {
      class: 'training-choice', 'aria-pressed': String(selected === id),
      onclick: () => onSelect(id),
    }, title)));
}

function chooseSet(setId, mainId = state.mainId) {
  state.mainId = mainId;
  state.setId = setId;
  state.chunkId = '';
  state.chunkSearch = '';
  state.chunkLimit = 10;
  state.showSubcategories = false;
  draw();
}

function categorySummary(setId) {
  if (state.mode === 'words') {
    return trainingWordsForSet(catalog, setId).length + '語';
  }
  return trainingPhrasesForSet(catalog, setId).length + '文';
}

function categoryPicker() {
  const main = catalog.mainCategories.find((category) => category.id === state.mainId);
  const sub = catalog.subcategoryById.get(state.setId);
  const selectedSub = sub?.mainId === state.mainId ? sub : null;
  const currentName = state.setId === 'all' ? '全カテゴリー'
    : selectedSub?.name ?? main?.name ?? '';
  const mainButtons = catalog.mainCategories.map((category) => el('button', {
    class: 'training-main-category',
    'aria-pressed': String(category.id === state.mainId),
    onclick: () => chooseSet(category.id, category.id),
  }, el('strong', {}, category.id + ' ' + category.name),
  el('small', {}, categorySummary(category.id))));
  const subcategories = catalog.subcategories.filter((category) => category.mainId === state.mainId);
  return [
    el('h3', {}, '教材を選ぶ'),
    el('p', { class: 'muted small' }, 'まずカテゴリーを選択。必要な場合だけサブカテゴリーへ絞り込めます。'),
    el('div', { class: 'training-category-grid', role: 'group', 'aria-label': 'メインカテゴリー' },
      mainButtons),
    el('button', { class: 'training-all-category', 'aria-pressed': String(state.setId === 'all'),
      onclick: () => chooseSet('all', 'all'),
    }, 'すべてのカテゴリーから学ぶ（' + categorySummary('all') + '）'),
    el('div', { class: 'training-selected-category' },
      el('div', {},
        el('strong', {}, '選択中：' + currentName),
        el('small', {}, '　' + categorySummary(state.setId))),
      subcategories.length ? el('button', {
        class: 'ghost training-sub-toggle',
        'aria-expanded': String(state.showSubcategories),
        onclick: () => {
          state.showSubcategories = !state.showSubcategories;
          draw();
        },
      }, state.showSubcategories ? 'サブカテゴリーを閉じる'
        : selectedSub ? 'サブカテゴリーを変更' : 'サブカテゴリーで絞る') : null,
      state.showSubcategories ? el('div', {
        class: 'training-subcategory-grid', role: 'group', 'aria-label': 'サブカテゴリー',
      }, subcategories.map((category) => el('button', {
        class: 'training-subcategory', 'aria-pressed': String(state.setId === category.id),
        onclick: () => chooseSet(category.id, state.mainId),
      }, el('strong', {}, category.name),
      el('small', {}, categorySummary(category.id))))) : null),
  ];
}

function chunkPicker() {
  const available = trainingChunksForSet(catalog, state.setId);
  if (!available.some((chunk) => chunk.id === state.chunkId)) {
    state.chunkId = available[0]?.id ?? '';
  }
  const selected = available.find((chunk) => chunk.id === state.chunkId);
  const list = el('div', { class: 'training-chunk-list', role: 'group', 'aria-label': '練習するチャンク' });
  const search = el('input', {
    type: 'search', class: 'select', value: state.chunkSearch,
    placeholder: '表現・意味・IDでチャンクを検索',
    'aria-label': 'チャンクを検索',
    oninput: (event) => {
      state.chunkSearch = event.target.value;
      state.chunkLimit = 10;
      paint();
    },
  });
  function paint() {
    const query = state.chunkSearch.trim().toLowerCase();
    const matched = available.filter((chunk) =>
      !query || [chunk.id, chunk.pattern, chunk.meaning]
        .some((value) => String(value ?? '').toLowerCase().includes(query)));
    render(list,
      el('p', { class: 'muted small' }, matched.length + 'チャンクが該当'),
      matched.slice(0, state.chunkLimit).map((chunk) => el('button', {
        class: 'training-chunk-choice', 'aria-pressed': String(state.chunkId === chunk.id),
        onclick: () => {
          state.chunkId = chunk.id;
          draw();
        },
      }, el('strong', {}, chunk.id + '　' + chunk.pattern),
      el('small', {}, chunk.exampleCount + '文・' + (chunk.meaning ?? '')))),
      matched.length > state.chunkLimit ? el('button', {
        class: 'ghost', onclick: () => {
          state.chunkLimit += 10;
          paint();
        },
      }, 'さらに10件表示') : null);
  }
  paint();
  return [
    el('h3', {}, 'チャンクを選ぶ'),
    el('p', { class: 'muted small' },
      '選択した教材に含まれる例文があるチャンクだけ表示します。'),
    available.length ? el('div', { class: 'panel small' },
      '練習中：' + selected.id + '　' + selected.pattern +
      '（この教材に含まれる例文 ' + selected.exampleCount + '件）') :
      el('p', { class: 'muted small' }, 'この教材にはチャンク付きの例文がありません。'),
    available.length ? el('label', { class: 'small training-chunk-search' },
      'チャンクを検索', search) : null,
    available.length ? list : null,
  ];
}

function reviewPicker() {
  return [
    el('p', { class: 'muted small' },
      '全カテゴリーの学習済み項目から探します。教材選択は不要です。'),
    el('h3', {}, '復習する内容'),
    choiceButtons([
      ['both', '単語・英作文'], ['words', '単語のみ'], ['phrases', '英作文のみ'],
    ], state.reviewType, (value) => { state.reviewType = value; draw(); }, '復習する内容'),
    el('h3', {}, '復習の種類'),
    choiceButtons([
      ['due', '期限が来た問題'], ['wrong', '間違えた問題'],
    ], state.reviewScope, (value) => { state.reviewScope = value; draw(); }, '復習の種類'),
  ];
}

function training() {
  const progress = learningStatistics(catalog, store, session.game,
    scheduler, scheduler.dayOf(now()));
  const learningMode = state.mode !== 'review';
  // チャンク一覧は表示より先に生成する。初期チャンクIDを確定させたうえで、
  // 上部の開始ボタンの disabled 状態を正しく判断する。
  const chunks = state.mode === 'phrases' && state.phraseMode === 'chunks' ? chunkPicker() : null;
  return [
    el('p', { class: 'muted small' },
      '5問から気軽に学習できます。訓練報酬は育成対象を選ばず、6人全員へ少量のXP・APを付与します。'),
    el('h3', {}, '学習モード'),
    el('div', { class: 'training-mode-grid', role: 'group', 'aria-label': '学習モード' },
      MODES.map(([id, title, note]) => el('button', {
        class: 'training-mode', 'aria-pressed': String(state.mode === id),
        onclick: () => { state.mode = id; message = ''; draw(); },
      }, el('strong', {}, title), el('small', {}, note)))),
    state.mode === 'phrases' ? [
      el('h3', {}, '瞬間英作文の練習方法'),
      choiceButtons([['normal', '通常の英作文'], ['chunks', 'チャンク集中']],
        state.phraseMode, (value) => {
          state.phraseMode = value;
          draw();
        }, '英作文の練習方法'),
    ] : null,
    // 長い教材・チャンク一覧をスクロールする前に訓練を開始できるようにする。
    el('div', { class: 'training-start-bar' },
      el('label', { class: 'small training-count-select' }, '問題数',
        el('select', { class: 'select', onchange: (event) => {
          state.count = Number(event.target.value);
          draw();
        } }, TRAINING_COUNTS.map((n) =>
          el('option', { value: n, selected: state.count === n }, n + '問')))),
      el('button', {
        class: 'primary training-start-button',
        disabled: state.mode === 'phrases' && state.phraseMode === 'chunks' && !state.chunkId,
        onclick: startTraining,
      }, state.count + '問の訓練を始める')),
    el('div', { class: 'route-facts' }, [
      ['単語の復習待ち', progress.words.due],
      ['英作文の復習待ち', progress.phrases.due],
    ].map(([title, value]) =>
      el('div', {}, el('small', {}, title), el('strong', {}, String(value))))),
    learningMode ? categoryPicker() : reviewPicker(),
    chunks,
    el('p', { class: 'muted small' },
      '復習期限に正解すると報酬1.2倍。1項目の報酬は1日1回です。間違えた問題は復習の「苦手克服」から練習できます。'),
    el('a', { class: 'btn', href: 'records.html?tab=log' }, '学習統計を見る'),
  ];
}

function startTraining() {
  message = '';
  const mode = resolveTrainingMode(state.mode, state.phraseMode);
  runTrainingSession({
    view, catalog, store, session, scheduler, data, chantConfig,
    options: {
      mode, setId: state.mode === 'review' ? 'all' : state.setId,
      chunkId: state.chunkId, reviewType: state.reviewType,
      reviewScope: state.reviewScope, count: state.count,
    },
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
    render(view, el('p', {}, '先にパーティーを作成してください。'),
      el('a', { class: 'btn primary', href: 'party.html' }, 'パーティーを作る'));
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

