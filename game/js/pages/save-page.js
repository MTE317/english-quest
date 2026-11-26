import { goldScale } from '../gold.js?v=skill-growth-2';
import { normalizeGame } from '../game-state.js?v=advanced-jobs-1';
// 動作確認用：自動保存・ダンジョンの途中からの再開・全滅で入る前に戻る、を試す画面
// 戦闘とダンジョンはまだないので、報酬（お金・素材・装備・経験値）は「仮」の値を足すだけ
import { GameSession } from '../save.js?v=skill-growth-2';
import { LearningStore } from '../storage.js?v=skill-growth-2';
import { loadGameData } from '../gamedata.js?v=skill-growth-2';
import { gainXp, makeGear } from '../character.js?v=advanced-jobs-1';
import { el, render } from '../dom.js?v=skill-growth-2';

const view = document.getElementById('view');
const session = new GameSession();
session.installAutoSave(window);
const learning = new LearningStore();

let data;

const fmt = (ms) => (ms ? new Date(ms).toLocaleString('ja-JP') : '—');

function summary() {
  const g = session.game;
  const mats = Object.entries(g.storage.materials).map(([id, n]) => `${id}×${n}`).join('、') || 'なし';
  return el('div', { class: 'panel small' },
    el('div', {}, `日数：${g.day}日目　お金：${g.gold}`),
    el('div', {}, `素材：${mats}`),
    el('div', {}, `倉庫の装備：${g.storage.gear.length}個`),
    el('div', {}, `レベル：${g.party.map((m) => `${m.name} Lv${m.lv}`).join('、')}`),
  );
}

function runPanel() {
  const r = session.run;
  return el('div', { class: 'panel small' },
    el('div', {}, `ダンジョンの中：${r.dungeonId}（${r.floor}階・戦闘 ${r.battlesDone}回）`),
    el('div', {}, r.battle ? `戦闘の途中：${r.battle.turn}ターン目・敵のHP ${r.battle.enemyHp}` : '戦闘はしていない'),
    el('div', { class: 'muted' }, `入る前の状態：${r.snapshot.day}日目・お金 ${r.snapshot.gold}・${r.snapshot.party.map((m) => `Lv${m.lv}`).join(' ')}`),
  );
}

function draw() {
  const parts = [];
  if (session.loadStatus === 'broken') {
    parts.push(el('div', { class: 'panel error small' }, `セーブが壊れていたので読めなかった（${session.loadError}）。中身は別の場所に残してある。`));
  }
  if (session.loadStatus === 'newer') {
    parts.push(el('div', { class: 'panel error small' }, '新しい版のゲームで保存されたセーブなので、上書きしない。'));
  }
  parts.push(el('div', { class: 'panel small' },
    el('div', {}, session.hasSave ? `セーブあり（最後に保存：${fmt(session.state.savedAt)}）` : 'セーブなし'),
    el('div', { class: 'muted' }, `学習記録：${learning.size}語（全滅しても消えない）`),
  ));

  if (!session.hasSave || !session.game.party) {
    parts.push(el('a', { class: 'btn primary', href: 'party.html' }, 'パーティーを作ってはじめる'));
    return render(view, parts);
  }

  parts.push(el('h2', {}, '進み具合'), summary());
  if (session.state.lastWipe) {
    const w = session.state.lastWipe;
    parts.push(el('div', { class: 'muted small' }, `前回の全滅：${w.dungeonId} の ${w.floor}階（${fmt(w.at)}）→ 入る前に戻った`));
  }

  if (!session.inDungeon) {
    parts.push(
      el('h2', {}, '町'),
      el('button', { onclick: () => { session.update((g) => { g.day += 1; }); draw(); } }, '1日すごす（日数+1）'),
      el('button', { class: 'primary', onclick: () => { session.enterDungeon({ dungeonId: 'trial_dungeon', stoneId: null }); draw(); } }, 'ダンジョンに入る（仮）'),
    );
  } else {
    parts.push(el('h2', {}, 'ダンジョン'), runPanel());
    const r = session.run;
    if (!r.battle) {
      parts.push(
        el('button', { class: 'primary', onclick: () => { session.setBattle({ turn: 1, enemyHp: 30 }); draw(); } }, '戦闘を始める（仮）'),
        el('button', { onclick: () => { session.updateRun((run, g) => { run.floor += 1; g.day += 1; }); draw(); } }, '次の階へ（日数+1）'),
        el('button', { onclick: () => { session.leaveDungeon(); draw(); } }, '町に帰る（手に入れた物は残る）'),
      );
    } else {
      parts.push(
        el('button', { onclick: () => { session.setBattle({ turn: r.battle.turn + 1, enemyHp: Math.max(0, r.battle.enemyHp - 10) }); draw(); } }, '1行動する（毎回保存）'),
        el('button', {
          class: 'primary',
          onclick: () => {
            session.endBattle((g) => {
              g.gold += 10 * goldScale(data);
              g.storage.materials.trial_mat = (g.storage.materials.trial_mat ?? 0) + 1;
              g.storage.gear.push(makeGear(g, [...data.equipment.keys()][0]));
              for (const m of g.party) gainXp(data, m, 30);
            });
            (async () => {
  try {
    data = await loadGameData();
    if (session.game && !session.readOnly) { normalizeGame(data, session.game, session.run); session.save(); }
    draw();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
  }
})();
          },
        }, `戦闘に勝つ（お金+${10 * goldScale(data)}・素材+1・装備+1・経験値+30 の仮の報酬）`),
      );
    }
    parts.push(el('button', { class: 'ghost error', onclick: () => { session.wipe(); draw(); } }, '全滅する（入る前に戻る）'));
  }

  parts.push(
    el('h2', {}, '閉じて開き直す'),
    el('div', { class: 'muted small' }, '読み込み直すと、最後に保存した状態から始まる。戦闘の途中なら同じ戦闘の続きから。'),
    el('button', { onclick: () => location.reload() }, '読み込み直す'),
    el('details', { class: 'panel' },
      el('summary', {}, 'セーブの中身'),
      el('pre', { class: 'json' }, JSON.stringify(session.state, null, 1)),
      el('div', { class: 'muted small' }, `大きさ：${session.store.byteSize()}文字`),
      el('button', {
        class: 'ghost error',
        onclick: () => { if (confirm('セーブを消します（学習記録は消えません）。よろしいですか？')) { session.deleteSave(); draw(); } },
      }, 'セーブを消す'),
    ),
  );
  render(view, parts);
}

(async () => {
  try {
    data = await loadGameData();
    if (session.game && !session.readOnly) { normalizeGame(data, session.game, session.run); session.save(); }
    draw();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
  }
})();

