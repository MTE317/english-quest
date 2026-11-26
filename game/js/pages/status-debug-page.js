import { loadGameData } from '../gamedata.js?v=public-rewards-1';
import { loadJson } from '../data.js?v=skill-growth-2';
import { loadLearningCatalog } from '../learning-catalog.js?v=skill-growth-2';
import { Scheduler } from '../srs.js?v=skill-growth-2';
import { LearningStore, loadSettings } from '../storage.js?v=skill-growth-2';
import { GameSession } from '../save.js?v=skill-growth-2';
import { normalizeGame } from '../game-state.js?v=jobs-intro-1';
import { allowedDungeons } from '../dungeon.js?v=public-rewards-1';
import { createBattleView } from '../ui/battle-view.js?v=public-rewards-1';
import { createStatusDebugSession } from '../debug-status.js?v=public-rewards-1';
import { stopSpeech } from '../speech.js?v=skill-growth-2';
import { setSceneMusic } from '../battle-music.js?v=skill-growth-2';
import { el, render } from '../dom.js?v=skill-growth-2';

const controls = document.getElementById('debug-controls');
const view = document.getElementById('view');

(async () => {
  try {
    // 元のセーブは読み取るだけ。テスト用コピーにだけ正規化をかける。
    const original = new GameSession();
    if (original.readOnly) throw new Error('このセーブは新しいバージョンのため使用できません。');
    if (!original.game?.party?.length) throw new Error('先にパーティーを作ってください。');
    const [data, srsFile, catalog] = await Promise.all([loadGameData(), loadJson('srs.json'), loadLearningCatalog()]);
    const baseline = structuredClone(original.game);
    normalizeGame(data, baseline);
    const lex = catalog.lexicon;
    const scheduler = new Scheduler(srsFile.data);
    const statusSelect = el('select', { class: 'select', 'aria-label': '試す状態異常' },
      [...data.statusEffects.values()].map(status => el('option', { value: status.id }, status.name)));
    const destinations = allowedDungeons(data, baseline);
    if (!destinations.length) throw new Error('テストできるダンジョンがありません。');
    const dungeonSelect = el('select', { class: 'select', 'aria-label': 'テストするダンジョン' },
      destinations.map(dungeon => el('option', { value: dungeon.id }, dungeon.name)));
    const description = el('p', { class: 'small', role: 'status' });
    const notice = el('p', { class: 'small', role: 'status' });
    const describe = () => {
      const status = data.statusEffects.get(statusSelect.value);
      description.textContent = `${status.group}・基本持続 ${status.turns}ターン・解除：${status.cure || 'なし'}`;
      if (status.id === 'petrify') description.textContent += '。全員が石化すると即全滅になります。';
    };
    statusSelect.addEventListener('change', describe);
    function start(statusId) {
      try {
        stopSpeech();
        render(view);
        const session = createStatusDebugSession(data, baseline, {
          dungeonId: dungeonSelect.value,
          stoneId: lex.stones.find(stone => stone.id === '00')?.id ?? lex.stones[0].id,
          statusId,
        });
        const names = session.game.party.map(member => member.name).join('・');
        const label = statusId ? data.statusEffects.get(statusId).name : '状態異常なし';
        notice.textContent = `${label}で開始：${names}。HP・MPは全回復。耐性を無視して付与します。`;
        createBattleView({
          view, data, lex, scheduler, session,
          store: new LearningStore(session.store.storage), settings: loadSettings(),
          onEnd: result => {
            stopSpeech();
            setSceneMusic('dungeon');
            render(view, el('section', { class: 'panel' },
              el('h2', {}, result === 'lose' ? 'テスト戦闘：全滅' : result === 'win' ? 'テスト戦闘：勝利' : 'テスト戦闘：終了'),
              el('p', {}, '状態異常を選んで、繰り返し試せます。'),
              el('details', { open: true }, el('summary', {}, '戦闘ログ'),
                el('ul', {}, session.run.battle.log.map(line => el('li', {}, line))))));
          },
        }).start();
      } catch (error) {
        notice.textContent = `開始できませんでした：${error.message}`;
        console.error(error);
      }
    }
    render(controls, el('h2', {}, 'パーティー全員に付与'),
      el('p', { class: 'small' }, '現在のパーティーのコピーで戦闘します。セーブ・持ち物・学習記録には反映されません。状態を変えて開始すると、テスト戦闘を最初からやり直します。'),
      el('label', {}, 'ダンジョン', dungeonSelect), el('label', {}, '状態異常', statusSelect), description,
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => start(statusSelect.value) }, '全員に付与して戦闘開始'),
        el('button', { onclick: () => start('') }, '状態異常なしで戦闘開始')),
      notice);
    describe();
  } catch (error) {
    render(controls, el('p', { class: 'error', role: 'alert' }, error.message),
      el('a', { class: 'btn', href: 'party.html' }, 'パーティーへ'));
    console.error(error);
  }
})();


