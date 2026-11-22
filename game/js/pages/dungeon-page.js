// ダンジョンの画面：行き先とルーンストーンを選ぶ → 階を進む → 戦闘 → 帰還ポイント・ボス → 町へ
import { loadGameData } from '../gamedata.js?v=rune-study-1';
import { loadCsv, loadJson } from '../data.js?v=features-2';
import { buildLexicon } from '../lexicon.js';
import { Scheduler } from '../srs.js?v=features-2';
import { LearningStore, now, loadSettings } from '../storage.js?v=rune-study-1';
import { QuestionPicker } from '../picker.js';
import { GameSession } from '../save.js?v=rune-study-1';
import { normalizeGame } from '../game-state.js?v=build36-1';
import {
  allowedDungeons, startRun, startNextBattle, afterBattle, returnToTown, continueRun, resolveLoot,
  isBossBattle, runFloorRow, runFloorCount, returnItems, currentRank, useItemOutsideBattle, FIELD_ITEM_EFFECTS,
} from '../dungeon.js?v=build36-1';
import { backpackSlots, backpackUsed, addItem } from '../loot.js?v=build36-1';
import { maxHp, maxMp } from '../character.js?v=build36-1';
import { createBattleView } from '../ui/battle-view.js?v=pixel-town-1';
import { createVictoryView } from '../ui/victory-view.js?v=pixel-town-1';
import { stoneAllowed } from '../study.js?v=build36-1';
import { el, render, stars } from '../dom.js';
import { setSceneMusic } from '../battle-music.js?v=rune-study-1';

import { expeditionScene } from '../ui/scenery.js';
import { installGameShell } from '../ui/game-shell.js?v=pixel-town-1';
import { portraitIcon } from '../ui/portrait.js';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('dungeon', session);
session.installAutoSave(window);
let data; let lex; let scheduler; let store; let srs;

const gearName = (g) => `${data.equipment.get(g.id).name}${g.rarity && g.rarity !== 'common' ? `（${data.rarityTable.find((r) => r.id === g.rarity)?.name ?? '固有'}）` : ''}`;

function partyPanel() {
  return el('div', { class: 'panel small' }, session.game.party.map((m) => el('div', { class: `expedition-member${m.hp <= 0 ? ' error' : ''}` },
    portraitIcon(m.icon, { small: true }),
    el('span', { class: 'expedition-member-copy' }, `${m.name} Lv${m.lv}　HP ${m.hp}/${maxHp(data, m)}　MP ${m.mp}/${maxMp(data, m)}`,
      m.persist?.length ? `　${m.persist.map((id) => data.statusEffects.get(id)?.name).join('・')}` : ''))));
}

// ---------------- 行き先を選ぶ（町） ----------------
function showDeparture(message = null) {
  setSceneMusic('dungeon');
  const g = session.game;
  if (!g?.party) {
    render(view, el('p', {}, 'まだパーティがいません。'), el('a', { class: 'btn primary', href: 'party.html' }, 'パーティを作る'));
    return;
  }
  const rank = currentRank(data, g);
  const dungeons = allowedDungeons(data, g);
  const nearby = dungeons.find(d => d.rank === 1 && d.kind === '近場');
  const averageLevel = g.party.reduce((sum, member) => sum + member.lv, 0) / g.party.length;
  const beginner = rank.maxDungeonRank === 1 && nearby && (g.cleared?.[nearby.id] ?? 0) < 3 && averageLevel < 5;
  const suggested = beginner ? nearby : dungeons.find(d => d.rank === rank.maxDungeonRank && d.kind === '標準') ?? dungeons[0];
  const st = { dungeonId: suggested.id, stoneId: null };
  const stoneSel = el('select', { class: 'select', onchange: (e) => { st.stoneId = e.target.value; } });
  const info = el('div', { class: 'route-info', 'aria-live': 'polite' });
  const fill = () => {
    const dg = data.dungeons.get(st.dungeonId);
    document.querySelector('.page-heading').className = `bar page-heading scene-${expeditionScene(dg.id)}`;
    // ★がダンジョン以上で、今のランクの★まで（1つ下の★の石をすべて読み解けば1つ上まで）
    const stones = lex.stones.filter((s) => stoneAllowed(lex, store, scheduler, s, dg.rank, rank.maxDungeonRank, scheduler.dayOf(now())));
    st.stoneId = stones.find((s) => s.id === st.stoneId)?.id ?? stones[0]?.id ?? null;
    render(stoneSel, stones.map((s) => el('option', { value: s.id, selected: s.id === st.stoneId }, `${stars(s.star)} ${s.name}`)));
    departure.disabled = !st.stoneId;
    render(info, el('div', { class: 'route-facts' },
      [['階層', `${dg.floors}階`], ['所要日数', `${dg.days}日`], ['帰還地点', dg.returnPointFloor ? `${dg.returnPointFloor}階の後` : 'なし']]
        .map(([key, value]) => el('div', {}, el('small', {}, key), el('strong', {}, value)))),
      el('p', { class: 'muted small' }, [dg.kind, dg.character].filter(Boolean).join(' ／ ')),
      !stones.length ? el('p', { class: 'error' }, '持ち込めるルーンストーンがありません。') : null);
  };
  const departure = el('button', {
    class: 'primary',
    onclick: () => {
      if (!st.stoneId) return;
      if (session.game.party.every((m) => m.hp <= 0)) { showDeparture('全員倒れている。宿屋や神殿で回復してから出発しよう。'); return; }
      const picker = new QuestionPicker({ lex, store, scheduler, stoneId: st.stoneId, nowMs: now() });
      startRun(data, session, { dungeonId: st.dungeonId, stoneId: st.stoneId, quizState: picker.toState(), seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });
      showRun();
    },
  }, '出発する');
  fill();
  render(view,
    el('section', { class: 'departure' },
      el('h2', { class: 'chapter-title' }, '遠征の準備'),
      beginner ? el('p', { class: 'panel small' }, `はじめは近場の「${nearby.name}」がおすすめ。短い冒険を2〜3回重ねて仲間を育て、回復やスキルを準備してから標準ダンジョンへ挑もう。行き先は自由に選べます。`) : null,
      message ? el('p', { class: 'panel error', role: 'alert' }, message, '　', el('a', { href: 'index.html?facility=temple' }, '神殿へ')) : null,
      el('div', { class: 'panel departure-plan' },
        el('label', {}, '行き先',
          el('select', { class: 'select', onchange: (e) => { st.dungeonId = e.target.value; fill(); } },
            dungeons.map((d) => el('option', { value: d.id, selected: d.id === st.dungeonId }, `${stars(d.rank)} ${d.name}${g.cleared?.[d.id] ? '（踏破済み）' : ''}`)))),
        info,
        el('label', {}, '持っていくルーンストーン', stoneSel),
        el('details', { class: 'stone-help' }, el('summary', {}, '教材を選ぶ条件'),
          el('p', {}, `今のランクは「${rank.title}」。行き先以上の★の石を選べます。今の★の石をすべて読み解くと、1つ上の★の石も持ち込めます。`)),
        departure),
      el('details', { class: 'panel' }, el('summary', {}, `仲間の状態（${g.party.length}人）`), partyPanel()),
      new URLSearchParams(location.search).has('debug') ? debugTools() : null)
  );
}

function debugTools() {
  return el('details', { class: 'panel' },
    el('summary', {}, '動作確認用'),
    el('p', { class: 'muted small' }, '本番のゲームにはないボタンです（町の宿屋・道具屋・昇格試験はチェックリスト8・10番で作る）。'),
    el('button', {
      onclick: () => {
        session.update((game) => { for (const id of ['potion', 'ether', 'revive_salts', 'antidote', 'panacea', 'return_feather']) if (data.items.has(id)) addItem(game, id, 3); });
        showDeparture('道具を足した');
      },
    }, '道具を3つずつ足す'),
    el('button', {
      onclick: () => { session.update((game) => { for (const m of game.party) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); m.persist = []; } }); showDeparture('全員を全回復した'); },
    }, '全員を全回復（宿屋のかわり）'),
    el('button', {
      onclick: () => { session.update((game) => { const i = data.ranks.findIndex((r) => r.id === game.rank); game.rank = data.ranks[Math.min(i + 1, data.ranks.length - 1)].id; }); showDeparture('ランクを1つ上げた'); },
    }, 'ランクを1つ上げる'),
  );
}

// ---------------- ダンジョンの中 ----------------
function showRun(result = null) {
  const run = session.run;
  if (!run) return showDeparture();
  if (run.battle) return battleView().start();
  if (run.state === 'ready' && run.battlesDone === 0) return beginBattle();
  setSceneMusic('dungeon');
  if (run.state === 'loot') {
    render(view, lootActions(result));
    return;
  }
  const dg = data.dungeons.get(run.dungeonId);
  const g = session.game;
  const backpack = `${backpackUsed(run.backpack)} / ${backpackSlots(data, g)}`;
  const head = [
    el('div', { class: 'choice-title' }, `${stars(dg.rank)} ${dg.name}`),
    el('div', { class: 'muted small' },
      `${run.floor} / ${runFloorCount(data, run)}階${run.state === 'ready' ? `・${run.battleIndex + 1} / ${runFloorRow(data, run).battles}戦目` : ''}`,
      `・バックパック ${backpack}・稼いだお金 ${run.earned.gold}`),
  ];
  let actions = [];
  if (run.state === 'ready') {
    const boss = isBossBattle(data, run);
    actions = [
      el('button', { class: 'primary', onclick: beginBattle }, boss ? '👑 ボスに挑む' : '次の戦闘へ'),
      el('button', { onclick: () => showFieldItems(result) }, '道具を使う'),
      ...returnItems(data, g).map((id) => el('button', {
        onclick: () => { if (confirm(`${data.items.get(id).name}で町に帰りますか？`)) { const pack = summary(run); returnToTown(data, session, id); showReturned(pack); } },
      }, `${data.items.get(id).name}で帰る（×${g.items[id]}）`)),
    ];
  } else if (run.state === 'return_point') {
    actions = [
      el('div', { class: 'panel small' }, '帰還ポイントに着いた。ここから町に帰れる。'),
      el('button', { class: 'primary', onclick: () => { continueRun(session); showRun(); } }, '先へ進む'),
      el('button', { onclick: () => { const pack = summary(run); returnToTown(data, session); showReturned(pack); } }, '町に帰る（拾った物は持ち帰る）'),
      el('button', { onclick: () => showFieldItems(result) }, '道具を使う'),
    ];
  } else if (run.state === 'cleared') {
    actions = [
      el('div', { class: 'panel small' }, 'いちばん奥のボスを倒した！'),
      el('button', { class: 'primary', onclick: () => { const pack = summary(run); returnToTown(data, session); showReturned(pack); } }, '町に帰る'),
    ];
  }
  if (result?.result === 'win') {
    render(view, createVictoryView({
      data, dungeon: dg, party: g.party, result, backpack,
      totalGold: run.earned.gold, gearName, actions,
    }));
    view.querySelector('h2').focus({ preventScroll: true });
  } else {
    const escaped = result?.result === 'fled' ? el('div', { class: 'panel small' }, '逃げ切った') : null;
    render(view, head, escaped, partyPanel(), actions);
  }
  window.scrollTo(0, 0);
}

function summary(run) {
  return { gold: run.earned.gold, gear: run.backpack.gear.map(gearName), materials: Object.entries(run.backpack.materials).map(([id, n]) => `${data.materials.get(id)?.name ?? id}×${n}`) };
}

function showReturned(pack) {
  setSceneMusic('town');
  render(view,
    el('h2', {}, '町に帰った'),
    el('div', { class: 'panel small' },
      el('div', {}, `稼いだお金：${pack.gold}`),
      el('div', {}, `持ち帰った装備：${pack.gear.join('、') || 'なし'}`),
      el('div', {}, `持ち帰った素材：${pack.materials.join('、') || 'なし'}`),
      el('div', { class: 'muted' }, '拾った物は町の倉庫に入った。')),
    el('a', { class: 'btn primary', href: 'index.html' }, '町へ'));
}

function lootActions(result) {
  const run = session.run;
  const entry = run.pendingLoot[0];
  const label = entry.type === 'gear' ? gearName(entry.gear) : `${data.materials.get(entry.id)?.name}×${entry.count}`;
  return [
    el('h2', {}, 'バックパックがいっぱい'),
    el('div', { class: 'panel' }, '拾った物：', el('b', {}, label)),
    el('p', { class: 'muted small' }, '中の何かと入れ替えるか、あきらめるかを選んでください。'),
    el('ul', { class: 'choice-list' },
      run.backpack.gear.map((x) => el('li', {}, el('button', { onclick: () => { resolveLoot(data, session, { type: 'gear', uid: x.uid }); showRun(result); } }, `捨てる：${gearName(x)}`))),
      Object.entries(run.backpack.materials).map(([id, n]) => el('li', {}, el('button', { onclick: () => { resolveLoot(data, session, { type: 'material', id }); showRun(result); } }, `捨てる：${data.materials.get(id)?.name}×${n}`)))),
    el('button', { class: 'ghost', onclick: () => { resolveLoot(data, session, null); showRun(result); } }, 'あきらめる'),
  ];
}

function showFieldItems(result) {
  const g = session.game;
  const owned = Object.keys(g.items).filter((id) => FIELD_ITEM_EFFECTS.includes(data.items.get(id)?.effect));
  render(view,
    el('h2', {}, '道具を使う'),
    partyPanel(),
    owned.length ? null : el('p', { class: 'muted' }, '使える道具を持っていない'),
    owned.map((id) => {
      const it = data.items.get(id);
      return el('div', { class: 'panel small' },
        el('div', { class: 'choice-title' }, `${it.name} ×${g.items[id]}`), el('div', { class: 'muted' }, it.description),
        el('div', { class: 'row' }, g.party.map((m, i) => el('button', {
          onclick: () => {
            try { session.update((game) => useItemOutsideBattle(data, game, id, i)); showFieldItems(result); } catch (e) { alert(e.message); }
          },
        }, m.name))));
    }),
    el('button', { onclick: () => showRun(result) }, 'もどる'));
}

// ---------------- 戦闘 ----------------
function beginBattle() {
  startNextBattle(data, session);
  battleView().start();
}

function battleView() {
  return createBattleView({
    view, data, lex, scheduler, store, session,
    settings: loadSettings(),
    onEnd: () => {
      const { dungeonId, floor, battleIndex } = session.run;
      const dg = data.dungeons.get(dungeonId);
      const r = afterBattle(data, session);
      if (r.result === 'lose') {
        render(view,
          el('h2', {}, '全滅…'),
          el('p', {}, 'ダンジョンに入る前の状態に戻った（お金・素材・拾った装備・経験値・日数）。'),
          el('p', { class: 'muted small' }, '学習記録と、出会った魔物・判明した弱点や耐性は図鑑に残っています。受注中の依頼と保証金も維持されます。'),
          el('div', { class: 'panel small' }, `ヒント：図鑑を見て属性耐性や状態異常対策を準備しよう。育成が必要なら、${dg.rank > 1 ? '★を1つ下げたダンジョン' : '近場のダンジョン'}がおすすめ。`),
          el('a', { class: 'btn', href: 'party.html' }, '編成を見直す'),
          el('a', { class: 'btn primary', href: 'index.html' }, '町へ'));
        return;
      }
      const battleCount = runFloorRow(data, { ...session.run, dungeonId, floor }).battles;
      showRun({ ...r, floor, battleNumber: battleIndex + 1, battleCount });
    },
  });
}

(async () => {
  try {
    if (session.run?.challenge) { location.replace('challenge.html'); return; }
    const [gd, srsFile, stones, lexicon] = await Promise.all([
      loadGameData(), loadJson('srs.json'), loadCsv('rune_stones.csv'), loadCsv('lexicon.csv'),
    ]);
    data = gd;
    srs = srsFile.data;
    scheduler = new Scheduler(srs);
    lex = buildLexicon(stones.rows, lexicon.rows);
    store = new LearningStore();
    if (session.game && !session.readOnly) { normalizeGame(data, session.game, session.run);
      session.save(); }
    if (session.inDungeon && session.run.backpack) showRun();
    else if (session.inDungeon) { session.leaveDungeon(); showDeparture(); } // 古い形の遠征（セーブの確認画面で始めたもの）は終わらせる
    else showDeparture();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
