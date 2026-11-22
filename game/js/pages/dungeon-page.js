// ダンジョンの画面：行き先とルーンストーンを選ぶ → 階を進む → 戦闘 → 帰還ポイント・ボス → 町へ
import { loadGameData } from '../gamedata.js?v=features-2';
import { loadCsv, loadJson } from '../data.js?v=features-2';
import { buildLexicon } from '../lexicon.js';
import { Scheduler } from '../srs.js?v=features-2';
import { LearningStore, now, loadSettings } from '../storage.js?v=features-2';
import { QuestionPicker } from '../picker.js';
import { GameSession } from '../save.js?v=features-2';
import { normalizeGame } from '../game-state.js?v=features-2';
import {
  allowedDungeons, startRun, startNextBattle, afterBattle, returnToTown, continueRun, resolveLoot,
  isBossBattle, runFloorRow, returnItems, currentRank, useItemOutsideBattle, FIELD_ITEM_EFFECTS,
} from '../dungeon.js?v=features-2';
import { backpackSlots, backpackUsed, addItem } from '../loot.js?v=features-2';
import { maxHp, maxMp } from '../character.js?v=features-2';
import { createBattleView } from '../ui/battle-view.js?v=features-2';
import { createVictoryView } from '../ui/victory-view.js?v=features-2';
import { updateRuneModifiers } from '../temple.js?v=features-2';
import { stoneAllowed } from '../study.js?v=features-2';
import { el, render, stars } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();
session.installAutoSave(window);
let data; let lex; let scheduler; let store; let srs;

const iconOf = (id) => data.icons.find((i) => i.id === id)?.icon ?? '❔';
const gearName = (g) => `${data.equipment.get(g.id).name}${g.rarity && g.rarity !== 'common' ? `（${data.rarityTable.find((r) => r.id === g.rarity)?.name ?? '固有'}）` : ''}`;

function partyPanel() {
  return el('div', { class: 'panel small' }, session.game.party.map((m) => el('div', { class: m.hp <= 0 ? 'error' : '' },
    `${iconOf(m.icon)} ${m.name} Lv${m.lv}　HP ${m.hp}/${maxHp(data, m)}　MP ${m.mp}/${maxMp(data, m)}`,
    m.persist?.length ? `　${m.persist.map((id) => data.statusEffects.get(id)?.name).join('・')}` : '')));
}

// ---------------- 行き先を選ぶ（町） ----------------
function showTown(message = null) {
  const g = session.game;
  if (!g?.party) {
    render(view, el('p', {}, 'まだパーティがいません。'), el('a', { class: 'btn primary', href: 'party.html' }, 'パーティを作る'));
    return;
  }
  const rank = currentRank(data, g);
  const dungeons = allowedDungeons(data, g);
  const st = { dungeonId: dungeons[0].id, stoneId: null };
  const stoneSel = el('select', { class: 'select', onchange: (e) => { st.stoneId = e.target.value; } });
  const info = el('div', { class: 'muted small' });
  const fill = () => {
    const dg = data.dungeons.get(st.dungeonId);
    // ★がダンジョン以上で、今のランクの★まで（1つ下の★の石をすべて読み解けば1つ上まで）
    const stones = lex.stones.filter((s) => stoneAllowed(lex, store, scheduler, s, dg.rank, rank.maxDungeonRank, scheduler.dayOf(now())));
    st.stoneId = stones.find((s) => s.id === st.stoneId)?.id ?? stones[0]?.id ?? null;
    render(stoneSel, stones.map((s) => el('option', { value: s.id, selected: s.id === st.stoneId }, `${stars(s.star)} ${s.name}`)));
    departure.disabled = !st.stoneId;
    info.textContent = `${dg.kind}・${dg.floors}階・${dg.days}日かかる・帰還ポイント ${dg.returnPointFloor ? `${dg.returnPointFloor}階のあと` : 'なし'}　${dg.character}${stones.length ? '' : '　持ち込める教材がありません。'}`;
  };
  const departure = el('button', {
    class: 'primary',
    onclick: () => {
      if (!st.stoneId) return;
      if (session.game.party.every((m) => m.hp <= 0)) { showTown('全員倒れている。宿屋や神殿で回復してから出発しよう。'); return; }
      const picker = new QuestionPicker({ lex, store, scheduler, stoneId: st.stoneId, nowMs: now() });
      startRun(data, session, { dungeonId: st.dungeonId, stoneId: st.stoneId, quizState: picker.toState(), seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });
      showRun();
    },
  }, '出発する');
  fill();
  render(view,
    message ? el('div', { class: 'panel small' }, message) : null,
    el('div', { class: 'muted small' }, `${g.day}日目・お金 ${g.gold}・ランク ${rank.title}（★${rank.maxDungeonRank}まで）`),
    partyPanel(),
    el('label', { class: 'small' }, '行き先',
      el('select', { class: 'select', onchange: (e) => { st.dungeonId = e.target.value; fill(); } },
        dungeons.map((d) => el('option', { value: d.id }, `${stars(d.rank)} ${d.name}${g.cleared?.[d.id] ? '（踏破済み）' : ''}`)))),
    info,
    el('label', { class: 'small' }, '持っていくルーンストーン（★がダンジョン以上。今の★の石をすべて読み解くと1つ上も）', stoneSel),
    departure,
    debugTools(),
  );
}

function debugTools() {
  return el('details', { class: 'panel' },
    el('summary', {}, '動作確認用'),
    el('p', { class: 'muted small' }, '本番のゲームにはないボタンです（町の宿屋・道具屋・昇格試験はチェックリスト8・10番で作る）。'),
    el('button', {
      onclick: () => {
        session.update((game) => { for (const id of ['potion', 'ether', 'revive_salts', 'antidote', 'panacea', 'return_feather']) if (data.items.has(id)) addItem(game, id, 3); });
        showTown('道具を足した');
      },
    }, '道具を3つずつ足す'),
    el('button', {
      onclick: () => { session.update((game) => { for (const m of game.party) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); m.persist = []; } }); showTown('全員を全回復した'); },
    }, '全員を全回復（宿屋のかわり）'),
    el('button', {
      onclick: () => { session.update((game) => { const i = data.ranks.findIndex((r) => r.id === game.rank); game.rank = data.ranks[Math.min(i + 1, data.ranks.length - 1)].id; }); showTown('ランクを1つ上げた'); },
    }, 'ランクを1つ上げる'),
  );
}

// ---------------- ダンジョンの中 ----------------
function showRun(result = null) {
  const run = session.run;
  if (!run) return showTown();
  if (run.battle) return battleView().start();
  if (run.state === 'ready' && run.battlesDone === 0) return beginBattle();
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
      `${run.floor} / ${dg.floors}階${run.state === 'ready' ? `・${run.battleIndex + 1} / ${runFloorRow(data, run).battles}戦目` : ''}`,
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
      totalGold: run.earned.gold, iconOf, gearName, actions,
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
  render(view,
    el('h2', {}, '町に帰った'),
    el('div', { class: 'panel small' },
      el('div', {}, `稼いだお金：${pack.gold}`),
      el('div', {}, `持ち帰った装備：${pack.gear.join('、') || 'なし'}`),
      el('div', {}, `持ち帰った素材：${pack.materials.join('、') || 'なし'}`),
      el('div', { class: 'muted' }, '拾った物は町の倉庫に入った。')),
    el('button', { class: 'primary', onclick: () => showTown() }, 'つづける'));
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
          el('p', { class: 'muted small' }, '学習記録（ルーンの状態）は残っています。'),
          el('div', { class: 'panel small' }, `ヒント：${dg.rank > 1 ? '★を1つ下げたダンジョンで' : '浅い階や近場のダンジョンで'}鍛え直してから挑もう。`),
          el('button', { class: 'primary', onclick: () => showTown() }, '町へ'));
        return;
      }
      const battleCount = runFloorRow(data, { dungeonId, floor }).battles;
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
    if (session.game && !session.readOnly) { normalizeGame(data, session.game);
      updateRuneModifiers(data, session.game, lex, store, scheduler, scheduler.dayOf(now()));
      session.save(); }
    if (session.inDungeon && session.run.backpack) showRun();
    else if (session.inDungeon) { session.leaveDungeon(); showTown(); } // 古い形の遠征（セーブの確認画面で始めたもの）は終わらせる
    else showTown();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
