// 英語学習は訓練場（単語・瞬間英作文・チャンク）と試験の間へ集約する。
import { loadGameData } from '../gamedata.js?v=workshop-materials-1';
import { loadJson } from '../data.js?v=skill-growth-2';
import { loadLearningCatalog } from '../learning-catalog.js?v=skill-growth-2';
import { Scheduler } from '../srs.js?v=skill-growth-2';
import { LearningStore, now } from '../storage.js?v=skill-growth-2';
import { GameSession } from '../save.js?v=party-wipe-1';
import { normalizeGame } from '../game-state.js?v=workshop-materials-1';
import { nextRankStatus, checkRankUp, promotionMaterialStatus, offerPromotionMaterials } from '../town.js?v=canyon-public-1';
import { EXAM_RULES, promotionProgress, promotionExamState } from '../promotion.js?v=promotion-exam-1';
import { runDualPromotionExam } from '../ui/learning-exams.js?v=promotion-exam-1';
import { learningStatistics } from '../learning-stats.js?v=skill-growth-2';
import { TRAINING_COUNTS, trainingChunksForSet, trainingWordsForSet,
  trainingPhrasesForSet, resolveTrainingMode } from '../training.js?v=advanced-jobs-1';
import { runTrainingSession } from '../ui/training-runner.js?v=workshop-materials-1';
import { availableStoneStages, ENCHANT_POWDER_ID } from '../workshop-materials.js?v=workshop-materials-1';
import { el, render } from '../dom.js?v=skill-growth-2';
import { setSceneMusic } from '../battle-music.js?v=skill-growth-2';
import { installGameShell } from '../ui/game-shell.js?v=skill-growth-2';

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
  reviewType: 'both', reviewScope: 'due', count: 10, stoneId: 'enhancement_stone_1',
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
      el('label', { class: 'small' }, 'セット完了時に受け取る強化石',
        el('select', { class: 'select', onchange: (event) => { state.stoneId = event.target.value; } },
          availableStoneStages(data, session.game).map((stage) =>
            el('option', { value: stage.id, selected: stage.id === state.stoneId }, stage.name)))),
      el('p', { class: 'small muted' },
        `5問で石とエンチャント粉を各1個、10問で各2個、15問で各3個。粉は共通1種類（現在${session.game.storage.materials[ENCHANT_POWDER_ID] ?? 0}個）。`),
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
      stoneId: state.stoneId,
    },
    onFinish: (result) => {
      message = result.answered
        ? result.answered + '問完了（単語' + result.words + '・英作文' + result.phrases +
          '）。6人合計 XP +' + result.xp + ' / AP +' + result.ap + '。端数は次回へ繰り越します。' +
          (result.materials ? ` ${result.materials.stoneName}・エンチャント粉を各${result.materials.stones}個獲得。` : '')
        : 'この条件では出題可能な項目がありません。教材や学習モードを変更してください。';
      tab = 'training'; draw();
    },
  });
}

function exam() {
  const g = session.game;
  const status = nextRankStatus(data, g);
  const next = status?.next;
  if (!next) return [el('p', {}, '最高ランクに到達しました。')];
  const material = promotionMaterialStatus(data, g, next);
  const progress = next.needsExam ? promotionProgress(catalog, store, g, next.id) : null;
  const result = next.needsExam ? promotionExamState(store, next.id) : null;
  const rule = EXAM_RULES[next.id];
  const ready = next.needsExam && !session.readOnly && !g.examsPassed?.includes(next.id) &&
    g.rankPoints >= next.pointsRequired && material.ready && progress.wordMet && progress.phraseMet;
  return [el('div', { class: 'panel' },
    el('h3', {}, '現在のギルドランク：' + g.rank),
    el('p', {}, '次のランク：' + next.id + '・' + next.title),
    el('p', {}, '累積ギルドポイント：' + (g.rankPoints ?? 0) + ' / ' + next.pointsRequired),
    el('p', {}, '施設投資上限：Lv' + next.facilityCap),
    material.offered ? el('p', {}, '昇級素材：納品済み') : material.needs.length
      ? material.needs.map(row => el('p', {},
        '必要素材：' + row.name + ' ' + row.have + '/' + row.count + '（崩れた砦）'))
      : next.materialStar ? el('p', {}, '必要素材：★' + next.materialStar + 'のモンスター素材1個（種類は仮）') : null,
    progress ? el('p', {}, '学習履歴：単語 ' + progress.words + '/30件・英作文 ' + progress.phrases + '/15件') : null,
    rule ? el('p', {}, '試験：単語30問＋英作文15問・各' + Math.round(rule.passRate * 100) + '%以上で合格') : null,
    rule ? el('p', { class: 'small muted' }, rule.wordPool
      ? '最近学んだ単語60件・英作文30件から抽選。候補が少ない場合は学習履歴全体を使用します。'
      : '学習履歴全体から抽選します。') : null,
    result ? el('p', {}, '合格記録：単語 ' + (result.wordPassed ? '合格' : '未合格') +
      '・英作文 ' + (result.phrasePassed ? '合格' : '未合格')) : null,
    status.needs.length ? el('p', { class: 'muted small' }, '未達成：' + status.needs.join('・')) : null,
    next.needsExam ? el('button', { class: 'primary', disabled: !ready,
      onclick: () => startPromotion(next.id) },
      material.offered ? '昇級試験に再挑戦' : '素材を納品して昇級試験を受ける') : null),
  ];
}

function startPromotion(rankId) {
  const status = nextRankStatus(data, session.game);
  const progress = promotionProgress(catalog, store, session.game, rankId);
  if (status?.next.id !== rankId || !progress.wordMet || !progress.phraseMet ||
      session.game.rankPoints < status.next.pointsRequired ||
      !promotionMaterialStatus(data, session.game, status.next).ready) {
    message = '受験条件を確認してください。'; draw(); return;
  }
  try {
    session.update(game => offerPromotionMaterials(data, game, rankId));
    runDualPromotionExam({ view, catalog, store, session, scheduler, chantConfig, rankId,
      onFinish: ({ complete }) => {
        if (complete) {
          const updates = [];
          session.update(game => {
            if (!game.examsPassed.includes(rankId)) game.examsPassed.push(rankId);
            updates.push(...checkRankUp(data, game));
          });
          message = updates.length ? updates.join(' ') : '両部門の試験に合格しました。';
        } else message = '未合格の部門を復習して再挑戦しましょう。合格済みの部門は保持されます。';
        tab = 'exam'; draw();
      },
    });
  } catch (error) { message = error.message; draw(); }
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

