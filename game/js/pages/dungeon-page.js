// ダンジョンの画面：行き先とルーンストーンを選ぶ → 階を進む → 戦闘 → 帰還ポイント・ボス → 町へ
import { loadGameData } from '../gamedata.js?v=unique-reroll-1';
import { loadJson } from '../data.js?v=skill-growth-2';
import { loadLearningCatalog } from '../learning-catalog.js?v=skill-growth-2';
import { Scheduler } from '../srs.js?v=skill-growth-2';
import { LearningStore, now, loadSettings } from '../storage.js?v=skill-growth-2';
import { QuestionPicker } from '../picker.js?v=skill-growth-2';
import { GameSession } from '../save.js?v=party-wipe-1';
import { normalizeGame } from '../game-state.js?v=unique-reroll-1';
import {
  allowedDungeons, allowedStones, expeditionFee, startRun, startNextBattle, afterBattle, returnToTown, continueRun, resolveLoot,
  isBossBattle, runFloorRow, runFloorCount, returnItems, currentRank, useItemOutsideBattle, FIELD_ITEM_EFFECTS,
} from '../dungeon.js?v=canyon-public-1';
import { backpackSlots, backpackUsed, addItem } from '../loot.js?v=unique-reroll-1';
import { maxHp, maxMp, partyCanAct } from '../character.js?v=unique-reroll-1';
import { createBattleView } from '../ui/battle-view.js?v=targeted-enchant-2';
import { createVictoryView, createLootIcons } from '../ui/victory-view.js?v=advanced-jobs-1';
import { el, render, stars } from '../dom.js?v=skill-growth-2';
import { buildWorldMap, newDiscoveries } from '../world-map.js?v=canyon-public-1';
import { createWorldMapView } from '../ui/world-map-view.js?v=canyon-public-1';
import { setSceneMusic } from '../battle-music.js?v=skill-growth-2';

import { expeditionScene } from '../ui/scenery.js?v=skill-growth-2';
import { installGameShell } from '../ui/game-shell.js?v=skill-growth-2';
import { portraitIcon } from '../ui/portrait.js?v=skill-growth-2';
import { playDungeonEntrance } from '../ui/dungeon-entrance.js?v=skill-growth-2';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('dungeon', session);
session.installAutoSave(window);
let data; let lex; let scheduler; let store; let srs;
let advancing = false;

const gearName = (g) => `${data.equipment.get(g.id).name}${g.rarity && g.rarity !== 'common' ? `（${data.rarityTable.find((r) => r.id === g.rarity)?.name ?? '固有'}）` : ''}`;

function partyPanel() {
  const resource = (label, value, max, kind) => el('span', { class: `expedition-resource ${kind}` },
    el('span', {}, label), el('span', { class: 'expedition-resource-value' }, `${value}/${max}`),
    el('span', { class: 'expedition-meter', 'aria-hidden': 'true' },
      el('span', { style: `width:${max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0}%` })));
  return el('div', { class: 'panel expedition-party', role: 'group', 'aria-label': `仲間${session.game.party.length}人の状態` },
    session.game.party.map((m) => {
      const conditions = m.persist?.map((id) => data.statusEffects.get(id)?.name ?? id) ?? [];
      if (m.hp <= 0) conditions.unshift('戦闘不能');
      return el('div', { class: `expedition-member${m.hp <= 0 ? ' error' : ''}`, role: 'group', 'aria-label': `${m.name} Lv${m.lv}` },
        el('div', { class: 'expedition-member-heading' }, portraitIcon(m.icon, { small: true }),
          el('span', { class: 'expedition-member-copy' },
            el('strong', { title: m.name }, m.name), el('small', {}, `Lv${m.lv}`))),
        resource('HP', m.hp, maxHp(data, m), 'hp'),
        resource('MP', m.mp, maxMp(data, m), 'mp'),
        conditions.length ? el('span', { class: 'expedition-conditions' }, conditions.join('・')) : null);
    }));
}

// ---------------- 行き先を選ぶ（町） ----------------
function showDeparture(message = null) {
  setSceneMusic('dungeon');
  if (session.game && !session.readOnly && !session.inDungeon) {
    normalizeGame(data, session.game);
    session.save();
  }
  const g = session.game;
  if (!g?.party) {
    render(view, el('p', {}, 'まだパーティーがいません。'), el('a', { class: 'btn primary', href: 'party.html' }, 'パーティーを作る'));
    return;
  }
  const canDepart = partyCanAct(g);
  const rank = currentRank(data, g);
  const dungeons = allowedDungeons(data, g);
  const nextIntro = Object.keys(data.balance.dungeon?.intro_routes ?? {})
    .map(id => dungeons.find(d => d.id === id)).find(d => d && !(g.cleared?.[d.id] > 0));
  const suggested = nextIntro ?? dungeons.find(d => d.rank === rank.maxDungeonRank && d.kind === '標準') ?? dungeons[0];
  const st = { dungeonId: suggested.id, stoneId: null };
  // 地域の接続線とノードは再設計中。公開ルートだけを一覧で表示する。
  const dungeonLabel = (dungeon) => stars(dungeon.rank) + ' ' + dungeon.name
    + (g.cleared?.[dungeon.id] ? '（踏破済み）' : '');
  const world = buildWorldMap(data.dungeons, dungeons, g);
  const seen = Array.isArray(g.worldMapSeen) ? g.worldMapSeen : [];
  const discoveries = newDiscoveries(world.dungeons, seen);
  const destinationHeading = el('h3', { tabindex: '-1' });
  const lure = el('input', { type: 'checkbox' });
  const stoneSel = el('select', { class: 'select', 'aria-describedby': 'expedition-study-help', onchange: (e) => { st.stoneId = e.target.value; } });
  const info = el('div', { class: 'route-info', 'aria-live': 'polite' });
  const fill = () => {
    const dg = data.dungeons.get(st.dungeonId);
    destinationHeading.textContent = dungeonLabel(dg);
    document.querySelector('.page-heading').className = `bar page-heading scene-${expeditionScene(dg.id)}`;
    const stones = allowedStones(lex);
    st.stoneId = stones.find((s) => s.id === st.stoneId)?.id
      ?? stones.find((s) => s.id === '00')?.id ?? stones[0]?.id ?? null;
    // 教材セットはマスターCSVから自動生成。主カテゴリーと60サブカテゴリーに対応。
    const choose = (set, label = set.name) => el('option', {
      value: set.id, selected: set.id === st.stoneId,
    }, label + `（${lex.wordsByStone.get(set.id)?.length ?? 0}語）`);
    const groups = [
      ...lex.stones.filter((s) => s.kind === 'main').map((main) => el('optgroup', { label: main.name },
        choose(main, 'すべて'),
        stones.filter((s) => s.kind === 'sub' && s.mainId === main.id).map((sub) => choose(sub)),
      )),
    ];
    render(stoneSel, groups);
    const fee = expeditionFee(data, dg);
    departure.disabled = !canDepart || !st.stoneId || g.gold < fee;
    render(info, el('div', { class: 'route-facts' },
      [['階層', `${dg.floors}階`], ['所要日数', `${dg.days}日`], ['遠征費', fee ? `${fee} G` : '無料']]
        .map(([key, value]) => el('div', {}, el('small', {}, key), el('strong', {}, value)))),
      !stones.length ? el('p', { class: 'error' }, '持ち込めるルーンストーンがありません。') : null,
      g.gold < fee ? el('p', { class: 'error' }, '遠征費が足りません。') : null);
  };
  const departure = el('button', {
    class: 'primary',
    onclick: async () => {
      if (!st.stoneId || departure.disabled || session.inDungeon) return;
      departure.disabled = true;
      try {
        const picker = new QuestionPicker({ lex, store, scheduler, stoneId: st.stoneId, nowMs: now() });
        startRun(data, session, { dungeonId: st.dungeonId, stoneId: st.stoneId, quizState: picker.toState(),
          seed: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0, bountyLure: lure.checked });
        await playDungeonEntrance(data.dungeons.get(st.dungeonId).name, () => showRun());
      } catch (error) {
        console.error(error);
        render(view, el('p', { class: 'error', role: 'alert' }, `入場に失敗：${error.message}`),
          el('button', { onclick: () => session.inDungeon ? showRun() : showDeparture() }, 'もう一度開く'));
      } finally {
        departure.disabled = false;
      }
    },
  }, '出発する');
  const atlas = createWorldMapView({
    world, discoveries, selectedDungeon: st.dungeonId,
    onDungeon: (id) => {
      st.dungeonId = id;
      fill();
      destinationHeading.focus();
      destinationHeading.scrollIntoView({ block: 'nearest' });
    },
  });
  fill();
  render(view,
    el('section', { class: 'departure' },
      el('h2', { class: 'chapter-title' }, '遠征の準備'),
      !canDepart ? el('p', { class: 'panel error', role: 'alert' }, '全員が死亡または石化しています。', '　',
        el('a', { href: 'index.html?facility=temple' }, '神殿へ')) : null,
      message ? el('p', { class: 'panel error', role: 'alert' }, message) : null,
      atlas,
      el('div', { class: 'panel departure-plan' },
        destinationHeading,
        info,
        g.items.bounty_lure > 0 ? el('label', {}, lure, ` おびき寄せ香を1個使う（所持 ${g.items.bounty_lure}）`) : null,
        el('label', {}, '学習する教材', stoneSel),
        el('p', { id: 'expedition-study-help', class: 'muted small' }, '00 最重要・実用英語を初期選択。7メイン・60サブから自由に選べます。出題記録は教材をまたいで共有されます。'),
        departure),
      el('details', { class: 'panel' }, el('summary', {}, `仲間の状態（${g.party.length}人）`), partyPanel()),
      new URLSearchParams(location.search).has('debug') ? debugTools() : null)
  );
  if (!session.readOnly && discoveries.length) {
    session.update((game) => { game.worldMapSeen = [...new Set([...seen, ...discoveries.map(({ id }) => id)])]; });
  }
}

function debugTools() {
  return el('details', { class: 'panel' },
    el('summary', {}, '動作確認用'),
    el('a', { class: 'btn', href: 'status-debug.html' }, '全員の状態異常を試す'),
    el('p', { class: 'muted small' }, '本番のゲームにはないボタンです（町の宿屋・道具屋・昇格試験はチェックリスト8・10番で作る）。'),
    el('button', {
      onclick: () => {
        session.update((game) => { for (const id of ['potion', 'ether', 'revive_salts', 'antidote', 'panacea', 'return_feather']) if (data.items.has(id)) addItem(game, id, 3); });
        showDeparture('道具を足した');
      },
    }, '道具を3つずつ足す'),
    el('button', {
      onclick: () => { session.update((game) => { for (const m of game.party) { m.hp = maxHp(data, m); m.mp = maxMp(data, m); m.persist = []; delete m.persistState; } }); showDeparture('全員を全回復した'); },
    }, '全員を全回復（宿屋のかわり）'),
    el('button', {
      onclick: () => { session.update((game) => { const i = data.ranks.findIndex((r) => r.id === game.rank); game.rank = data.ranks[Math.min(i + 1, data.ranks.length - 1)].id; }); showDeparture('ランクを1つ上げた'); },
    }, 'ランクを1つ上げる'),
  );
}

// ---------------- ダンジョンの中 ----------------
function explorationNotices(run) {
  const notices = run.explorationNotices ?? [];
  if (!notices.length) return null;
  const labels = { chest: '宝箱', gather: '採集', rest: '休憩', discover: '隠し通路の発見', investigate: '調査地点' };
  return el('div', { class: 'panel small', role: 'status' }, notices.map((notice) => {
    const destinationId = notice.discovery?.startsWith('dungeon:') ? notice.discovery.slice('dungeon:'.length) : null;
    const destinationName = data.dungeons.get(destinationId)?.name;
    const rewards = [
      notice.gold ? `${notice.gold} G` : null,
      ...(notice.materials ?? []).map(({ id, count }) => `${data.materials.get(id)?.name ?? id}×${count}`),
      ...(notice.gear ?? []).map(gearName),
      notice.item ? data.items.get(notice.item)?.name : null,
    ].filter(Boolean);
    const message = {
      chest: rewards.join(' ／ '),
      gather: rewards.join(' ／ ') || '持ち帰れる素材はなかった。',
      rest: `HP +${notice.hp} ／ MP +${notice.mp}`,
      discover: destinationName ? `「${destinationName}」への手がかりを見つけた。` : '新しい場所への手がかりを見つけた。',
      investigate: '調査の手がかりを記録した。',
    }[notice.type];
    return el('div', {}, el('b', {}, notice.first ? '初回の宝箱' : labels[notice.type]), '　', message);
  }));
}

function showRun(result = null) {
  const run = session.run;
  if (!run) return showDeparture();
  if (run.battle) return battleView().start();
  if (run.state === 'ready' && run.battlesDone === 0) return beginBattle();
  setSceneMusic('dungeon');
  if (run.state === 'loot') {
    render(view, explorationNotices(run), lootActions(result));
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
      el('button', { class: 'primary', onclick: moveToNextBattle }, boss ? '👑 ボスに挑む' : '次の戦闘へ'),
      el('button', { onclick: () => showFieldItems(result) }, '道具を使う'),
      ...returnItems(data, g).map((id) => el('button', {
        onclick: () => { if (confirm(`${data.items.get(id).name}で町に帰りますか？`)) { const pack = summary(run); returnToTown(data, session, id); showReturned(pack); } },
      }, `${data.items.get(id).name}で帰る（×${g.items[id]}）`)),
    ];
  } else if (run.state === 'return_point') {
    actions = [
      el('div', { class: 'panel small' }, '帰還ポイントに着いた。ここから町に帰れる。'),
      el('button', { class: 'primary', onclick: moveToNextBattle }, '先へ進む'),
      el('button', { onclick: () => { const pack = summary(run); returnToTown(data, session); showReturned(pack); } }, '町に帰る（拾った物は持ち帰る）'),
      el('button', { onclick: () => showFieldItems(result) }, '道具を使う'),
    ];
  } else if (run.state === 'cleared') {
    actions = [
      el('div', { class: 'panel small' }, run.training ? '育成探索を完了した！' : '最後の戦闘を終えた！ 道具なしで町へ帰れます。'),
      el('button', { class: 'primary', onclick: () => { const pack = summary(run); returnToTown(data, session); showReturned(pack); } }, '町に帰る'),
    ];
  }
  const notices = explorationNotices(run);
  if (result?.result === 'win') {
    render(view, createVictoryView({
      data, dungeon: dg, party: g.party, result, backpack,
      totalGold: run.earned.gold, gearName, actions: [notices, ...actions],
    }));
    view.querySelector('h2').focus({ preventScroll: true });
  } else {
    const escaped = result?.result === 'fled' ? el('div', { class: 'panel small' }, '逃げ切った') : null;
    render(view, head, escaped, notices, partyPanel(), actions);
  }
  window.scrollTo(0, 0);
}

function summary(run) {
  return { gold: run.earned.gold, gear: run.backpack.gear.map(gear => ({ ...gear })),
    materials: Object.entries(run.backpack.materials).map(([id, count]) => ({ id, count })) };
}

function showReturned(pack) {
  setSceneMusic('town');
  normalizeGame(data, session.game);
  session.save();
  render(view,
    el('h2', {}, '町に帰った'),
    el('div', { class: 'panel small' },
      el('div', {}, `稼いだお金：${pack.gold}`),
      el('h3', {}, '持ち帰った装備'),
      createLootIcons(data, { gear: pack.gear }, gearName),
      el('h3', {}, '持ち帰った素材'),
      createLootIcons(data, { materials: pack.materials }, gearName),
      el('div', { class: 'muted' }, '拾った物は町の所持品に入った。')),
    el('div', { class: 'row' },
      el('a', { class: 'btn primary', href: 'index.html' }, '町へ'),
      el('button', { type: 'button', onclick: () => { showDeparture(); window.scrollTo(0, 0); } }, '冒険先一覧へ')));
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
        el('div', { class: 'field-item-targets', role: 'group', 'aria-label': `${it.name}を使う仲間` }, g.party.map((m, i) => el('button', {
          'aria-label': `${m.name}に${it.name}を使う`,
          onclick: () => {
            try { session.update((game) => useItemOutsideBattle(data, game, id, i)); showFieldItems(result); } catch (e) { alert(e.message); }
          },
        }, m.name))));
    }),
    el('button', { onclick: () => showRun(result) }, 'もどる'));
}

// ---------------- 戦闘 ----------------
async function moveToNextBattle() {
  const run = session.run;
  if (advancing || !run || run.battle || !['ready', 'return_point'].includes(run.state)) return;
  advancing = true;
  try {
    const name = `${data.dungeons.get(run.dungeonId).name}　${run.floor}階`;
    await playDungeonEntrance(name, () => {
      if (run.state === 'return_point') continueRun(session);
      beginBattle();
    });
  } catch (error) {
    console.error(error);
    render(view, el('p', { class: 'error', role: 'alert' }, `移動に失敗：${error.message}`),
      el('button', { onclick: () => showRun() }, 'もう一度開く'));
  } finally {
    advancing = false;
  }
}

function beginBattle() {
  startNextBattle(data, session);
  battleView().start();
}

function battleView() {
  let defeat;
  return createBattleView({
    view, data, lex, scheduler, store, session,
    settings: loadSettings(),
    onDefeat: () => { defeat = afterBattle(data, session, (game) => normalizeGame(data, game)); },
    onEnd: (result) => {
      if (result === 'lose') {
        render(view,
          el('h2', {}, defeat.wiped ? 'パーティーは全滅した…' : '遠征に失敗した…'),
          defeat.wiped ? [
            el('p', {}, '今回の遠征で手に入れたアイテムとゴールドを失い、全滅した状態で町に帰還しました。'),
            el('p', { class: 'muted small' }, '経験値・AP・図鑑・学習の記録は残ります。仲間は神殿で治療できます。'),
            el('a', { class: 'btn', href: 'index.html?facility=temple' }, '神殿へ'),
          ] : el('p', {}, '戦闘が長引いたため、遠征前の状態に戻りました。'),
          el('a', { class: 'btn primary', href: 'index.html' }, '町へ'));
        return;
      }
      const { dungeonId, floor, battleIndex } = session.run;
      const r = afterBattle(data, session);
      const battleCount = runFloorRow(data, { ...session.run, dungeonId, floor }).battles;
      showRun({ ...r, floor, battleNumber: battleIndex + 1, battleCount });
    },
  });
}

(async () => {
  try {
    if (session.run?.challenge) { location.replace('challenge.html'); return; }
    const [gd, srsFile, catalog] = await Promise.all([
      loadGameData(), loadJson('srs.json'), loadLearningCatalog(),
    ]);
    data = gd;
    srs = srsFile.data;
    scheduler = new Scheduler(srs);
    lex = catalog.lexicon;
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





