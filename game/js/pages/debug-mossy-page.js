import { loadGameData } from '../gamedata.js?v=rune-study-1';
import { loadJson } from '../data.js?v=features-2';
import { loadLearningCatalog } from '../learning-catalog.js?v=learning-00-v1';
import { Scheduler } from '../srs.js?v=stability-1';
import { el, render } from '../dom.js';
import { makeDebugMossyBattle } from '../debug-mossy.js?v=1';
import { createBattleView } from '../ui/battle-view.js?v=mossy-sprites-2';

const view = document.getElementById('view');
const requested = new URLSearchParams(location.search).get('count');

async function start() {
  if (requested !== '5' && requested !== '8') throw new Error('開発用メニューで敵5体か8体を選んでください。');
  const [data, catalog, config] = await Promise.all([loadGameData(), loadLearningCatalog(), loadJson('srs.json')]);
  const lex = catalog.lexicon;
  const { session, store } = makeDebugMossyBattle(data, lex.stones[0].id, Number(requested));
  createBattleView({
    view, data, lex, scheduler: new Scheduler(config.data), store, session,
    onEnd: () => render(view, el('section', { class: 'panel' },
      el('p', {}, '表示テストを終了しました。通常の記録には反映されません。'),
      el('a', { class: 'btn', href: 'debug.html' }, '開発用メニューへ戻る'))),
  }).start();
}

start().catch(error => render(view, el('p', { class: 'error', role: 'alert' }, error.message)));
