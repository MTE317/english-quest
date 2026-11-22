// 町をホームにして、施設カードから各施設を開く。
import { loadGameData } from '../gamedata.js?v=features-2';
import { GameSession } from '../save.js?v=features-2';
import { normalizeGame } from '../game-state.js?v=features-2';
import { currentRank, seededRng } from '../dungeon.js?v=jrpg-1';
import {
  calendarOf, guildFee, fillBoard, boardSize, acceptQuest, canReport, reportQuest, questText, nextRankStatus, stayInn, revive, reviveCost, checkRankUp,
  itemShopStock, buyItem, gearShopStock, buyGear, sellGear, sellPrice, canExpandBackpack, expandBackpack, feeTier,
  nextBackpackTier,
} from '../town.js?v=features-2';
import { backpackSlots } from '../loot.js?v=features-2';
import { maxHp, maxMp, gearDef, aptitudeGrade } from '../character.js?v=jrpg-1';
import { availableJobs, changeJob } from '../growth.js?v=features-2';
import { loadCsv, loadJson } from '../data.js?v=features-2';
import { buildLexicon } from '../lexicon.js';
import { Scheduler } from '../srs.js?v=features-2';
import { LearningStore, now } from '../storage.js?v=features-2';
import { chainStep, stepLabel, acceptChain, talkChain, deliverChain, claimChain } from '../quest-chain.js?v=features-2';
import { cureAtTemple, updateRuneModifiers } from '../temple.js?v=features-2';
import { workshopView, managementView, templeExtras } from '../ui/facility-view.js?v=features-2';
import { el, render, stars } from '../dom.js';
import { setSceneMusic } from '../battle-music.js?v=jrpg-1';

const view = document.getElementById('view');
const session = new GameSession();
session.installAutoSave(window);
let data;
let lex;
let scheduler;
const learning = new LearningStore();
const workshopSelection = {};
let flash = null;

const requestedFacility = new URLSearchParams(window.location.search).get('facility');
const rng = () => seededRng({ rng: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });

const facilityGroups = [
  { title: '冒険の準備', cards: [
    { id: 'guild', name: 'ギルド酒場', icon: '🍺', detail: '依頼の受注・報告、昇格', show: guild },
    { id: 'inn', name: '宿屋', icon: '🛏️', detail: 'HP・MPを回復', show: inn },
    { id: 'temple', name: '神殿', icon: '🏛️', detail: '復活・治療、転職・刻印', show: temple },
    { href: 'party.html', name: 'パーティ', icon: '🛡️', detail: '仲間の装備・スキル' },
  ] },
  { title: '買い物と強化', cards: [
    { id: 'items', name: '道具屋', icon: '🧪', detail: '道具を買う、荷物枠を広げる', show: items },
    { id: 'gear', name: '武器・防具屋', icon: '⚔️', detail: '装備の購入・売却', show: gearShop },
    { id: 'workshop', name: '工房・調合', icon: '⚒️', detail: '装備の作成・強化、道具の調合',
      show: () => workshopView(data, session.game, act, rng, workshopSelection) },
    { id: 'storage', name: '倉庫', icon: '📦', detail: '装備・道具・素材を確認', show: storage },
  ] },
  { title: '挑戦と町の運営', cards: [
    { href: 'challenge.html', name: '闘技場', icon: '🏆', detail: '対戦と最終試験' },
    { id: 'manage', name: '銀行・投資', icon: '🪙', detail: '融資・返済、施設の強化',
      show: () => managementView(data, session.game, act) },
  ] },
];
const facility = facilityGroups.flatMap(({ cards }) => cards)
  .find((card) => card.id === requestedFacility);

function facilityLink(id) {
  return `index.html?facility=${id}`;
}

/** 進み具合を変えて保存し、結果を出す。失敗したら理由を出す */
function act(fn) {
  try {
    let msg;
    session.update((g) => { msg = fn(g); updateRuneModifiers(data, g, lex, learning, scheduler, scheduler.dayOf(now())); });
    flash = { ok: true, text: Array.isArray(msg) ? msg.join('　') : msg };
  } catch (e) { flash = { ok: false, text: e.message }; }
  draw();
}

function heading(title, isFacility = false) {
  document.title = `${title} - English Quest`;
  return el('header', { class: 'town-header' },
    isFacility ? el('a', { class: 'back', href: 'index.html' }, '← 町へ') : null,
    el('h1', {}, title));
}

function statusBar(g) {
  const cal = calendarOf(data, g.day);
  return el('dl', { class: 'town-status' },
    el('div', {}, el('dt', {}, '所持金'), el('dd', {}, `${g.gold.toLocaleString('ja-JP')} G`)),
    el('div', {}, el('dt', {}, '冒険者ランク'), el('dd', {}, currentRank(data, g).title)),
    el('div', {}, el('dt', {}, '日付'), el('dd', {}, `${cal.season?.name ?? ''} ${cal.dayOfMonth}日`)));
}

function townCard({ href, id, name, icon, detail }) {
  return el('a', { class: 'town-card', href: href ?? facilityLink(id) },
    el('span', { class: 'town-card-icon', 'aria-hidden': 'true' }, icon),
    el('span', {},
      el('strong', {}, name),
      el('span', { class: 'town-card-detail' }, detail)));
}

function townActions(g) {
  const reportable = g.quests.filter((q) => canReport(data, g, q)).length;
  const down = g.party.filter((m) => m.hp <= 0).length;
  const cure = g.party.some((m) => m.persist?.length);
  const rest = g.party.some((m) => m.hp > 0 && (m.hp < maxHp(data, m) || m.mp < maxMp(data, m)));
  const actions = [
    reportable ? el('a', { href: facilityLink('guild') }, `報告できる依頼 ${reportable}件`) : null,
    down || cure ? el('a', { href: facilityLink('temple') }, down ? `戦闘不能 ${down}人・神殿へ` : '状態異常の治療へ') : null,
    rest ? el('a', { href: facilityLink('inn') }, 'HP・MPの回復へ') : null,
    g.overdue ? el('a', { href: facilityLink('manage') }, '会費の滞納を確認') : null,
  ].filter(Boolean);
  return actions.length ? el('nav', { class: 'town-actions', 'aria-label': '町でできること' }, actions) : null;
}

function townNotices(g) {
  if (!g.notices?.length) return null;
  return el('details', { class: 'panel small' },
    el('summary', {}, `お知らせ（${g.notices.length}件）`),
    el('ul', {}, g.notices.slice().reverse().map((notice) => el('li', {}, notice))),
    el('button', { class: 'ghost', onclick: () => act((gg) => { gg.notices = []; }) }, 'お知らせを消す'));
}

function adventureCard(title, detail, href, label) {
  return el('section', { class: 'town-adventure' },
    el('h2', {}, title),
    detail ? el('p', {}, detail) : null,
    el('a', { class: 'btn primary', href }, label));
}

function showHome(g) {
  if (session.inDungeon) {
    const run = session.run;
    const destination = run.label ?? data.dungeons.get(run.dungeonId)?.name;
    const detail = run.challenge ? destination : [destination, run.floor && `${run.floor}階`].filter(Boolean).join('・');
    render(view, heading('冒険者の町'),
      adventureCard(run.challenge ? '挑戦の途中' : '遠征の途中', detail,
        run.challenge ? 'challenge.html' : 'dungeon.html', '冒険を続ける'));
    return;
  }

  render(view, heading('冒険者の町'), statusBar(g),
    adventureCard('ダンジョン', '行き先とルーンストーンを選ぶ', 'dungeon.html', 'ダンジョンへ'),
    el('nav', { class: 'town-grid town-learning', 'aria-label': '英語の学習' },
      townCard({ href: 'study.html?tab=training', icon: '📖', name: '単語を復習', detail: '訓練場でまとめて解く' }),
      townCard({ href: 'chant.html', icon: '✦', name: '瞬間英作文', detail: '詠唱の間でフレーズ練習' })),
    townActions(g), townNotices(g),
    facilityGroups.map(({ title, cards }) => el('section', { class: 'town-district' },
      el('h2', {}, title), el('div', { class: 'town-grid' }, cards.map(townCard)))));
}

function guild() {
  const g = session.game;
  const st = nextRankStatus(data, g);
  const pending = g.quests.filter((q) => canReport(data, g, q)).length;
  const card = (q, accepted) => {
    const ready = accepted && canReport(data, g, q);
    return el('li', { class: `guild-contract${ready ? ' reportable' : ''}` },
      el('div', { class: 'guild-contract-meta' },
        el('span', {}, `★${q.rank}`),
        el('span', {}, accepted ? (ready ? '報告可' : '進行中') : '募集中')),
      el('h3', {}, questText(data, q)),
      el('p', {}, `報酬　${rewardText(q)}`),
      accepted && q.type !== 'gather'
        ? el('progress', { max: q.count, value: q.progress, 'aria-label': '討伐の進み具合' }) : null,
      accepted && !ready && q.type !== 'gather' ? el('span', {}, `${q.progress} / ${q.count}`) : null,
      accepted
        ? ready ? el('button', { onclick: () => act((gg) => reportQuest(data, gg, q.uid, rng())) }, '報告する') : null
        : el('button', { onclick: () => act((gg) => { acceptQuest(gg, q.uid); return 'クエストを受けた'; }) }, '依頼を受ける'));
  };
  return [
    el('section', { class: 'guild-board', 'aria-labelledby': 'guild-board-title' },
      el('header', {},
        el('h2', { id: 'guild-board-title' }, '依頼掲示板'),
        el('span', {}, `受注 ${g.quests.length} / ${boardSize(data, g)}件`)),
      pending ? el('a', { class: 'guild-board-jump', href: '#guild-active' }, `報告できる依頼 ${pending}件 ↓`) : null,
      g.board.length
        ? el('ul', { class: 'guild-contracts' }, g.board.map((q) => card(q, false)))
        : el('p', { class: 'small' }, '現在、受けられる依頼はありません。')),
    el('section', { class: 'guild-reports', 'aria-labelledby': 'guild-active' },
      el('h2', { id: 'guild-active' }, '受けている依頼'),
      g.quests.length
        ? el('ul', { class: 'guild-contracts' }, [...g.quests].sort((a, b) => Number(canReport(data, g, b)) - Number(canReport(data, g, a)))
          .map((q) => card(q, true)))
        : el('p', { class: 'muted small' }, '受けている依頼はありません。')),
    el('details', { class: 'panel small' }, el('summary', {}, '連続クエスト'),
      data.questChains.filter((chain) => Number(chain.star) <= currentRank(data, g).maxDungeonRank).map((chain) => {
        const state = g.chains?.[chain.id];
        const step = chainStep(chain, g);
        return el('div', { class: 'panel small' }, chain.title,
          state?.claimed ? el('div', {}, '達成済み') : null,
          !state ? el('button', { onclick: () => act((game) => { acceptChain(game, chain); return '連続クエストを受けた。'; }) }, '受ける') : null,
          step ? el('p', {}, stepLabel(data, step)) : null,
          step?.kind === 'talk' ? el('button', { onclick: () => act((game) => talkChain(game, chain)) }, '話す') : null,
          step?.kind === 'gather' ? el('button', { onclick: () => act((game) => deliverChain(data, game, chain)) }, '納品する') : null,
          step?.kind === 'reward' ? el('button', { onclick: () => act((game) => [claimChain(data, game, chain, rng()), ...checkRankUp(data, game)]) }, '報告する') : null);
      })),
    el('h2', {}, '冒険者ランク'),
    el('div', { class: 'panel small' },
      el('div', {}, `${currentRank(data, g).title}（ポイント ${g.rankPoints}）　特典：${currentRank(data, g).perk || 'なし'}`),
      st ? el('div', { class: 'muted' }, `次は「${st.next.title}」：${st.needs.length ? st.needs.join('・') : '上がれる'}`) : el('div', {}, '最高のランク')),
    st ? el('a', { class: 'btn', href: 'study.html?tab=exam' }, '昇格条件・試験を確認') : null,
    el('a', { class: 'btn', href: 'study.html' }, 'ギルドの学び舎'),
  ];
}
function rewardText(q) {
  const def = data.quests.find((x) => x.id === q.questId);
  const gold = Math.round(data.economy.get(q.rank).run_income * def.rewardGoldPct / 100 * (1 + currentRank(data, session.game).questBonus));
  return [gold ? `お金 ${gold}` : null, def.rewardItem || null, `ポイント ${def.rankPoints}`].filter(Boolean).join('・');
}

function inn() {
  const g = session.game;
  const econ = data.economy.get(feeTier(data, g));
  const fx = data.innRooms.find((r) => r.innRank === g.facilities.inn);
  return [
    el('p', { class: 'muted small' }, '戦闘不能の仲間は', el('a', { href: facilityLink('temple') }, '神殿'), 'で復活できます。'),
    g.party.map((m) => el('div', { class: 'small' }, `${m.name}　HP ${m.hp}/${maxHp(data, m)}　MP ${m.mp}/${maxMp(data, m)}${m.room ? '　（良い部屋の効果）' : ''}`)),
    el('button', { onclick: () => act((gg) => `ふつうの部屋に泊まった（-${stayInn(data, gg, false)}）`) }, `ふつうの部屋（${econ.inn_cheap}）：全回復`),
    el('button', { class: 'primary', onclick: () => act((gg) => `良い部屋に泊まった（-${stayInn(data, gg, true)}）`) },
      el('div', {}, `良い部屋（${econ.inn_good}）`), el('div', { class: 'tiny' }, fx?.description ?? '')),
  ];
}

function items() {
  const g = session.game;
  const exp = canExpandBackpack(data, g);
  const nt = nextBackpackTier(data, g);
  return [
    el('h2', {}, '道具'),
    itemShopStock(data, g).map(({ item, price }) => el('div', { class: 'panel small' },
      el('div', {}, `${item.name}　${price}　（持っている数 ${g.items[item.id] ?? 0}）`), el('div', { class: 'muted' }, item.description),
      el('div', { class: 'row' },
        el('button', { onclick: () => act((gg) => `${item.name}を${buyItem(data, gg, item.id, 1)}個買った`) }, '1個買う'),
        el('button', { onclick: () => act((gg) => `${item.name}を${buyItem(data, gg, item.id, 5)}個買った`) }, '5個買う')))),
    el('h2', {}, 'バックパックを広げる'),
    el('div', { class: 'panel small' },
      el('div', {}, `今：${backpackSlots(data, g)}枠`),
      nt ? el('div', {}, `次：${nt.slots}枠（お金 ${nt.gold}${nt.materials ? `・${nt.materials}` : ''}）`) : el('div', {}, '最大'),
      nt && !exp.ok ? el('div', { class: 'error' }, exp.reasons.join('・')) : null,
      nt ? el('button', { disabled: !exp.ok, onclick: () => act((gg) => `バックパックが${expandBackpack(data, gg)}枠になった`) }, '広げる') : null),
  ];
}

function gearShop() {
  const g = session.game;
  return [
    el('h2', {}, '買う'),
    el('p', { class: 'muted small' }, '買った装備は倉庫に入ります（パーティの画面でつける）。'),
    gearShopStock(data, g).map(({ def, star, price }) => el('div', { class: 'row small', style: 'align-items:center' },
      el('div', { style: 'flex:2' }, `${stars(star)} ${def.name}`, el('div', { class: 'tiny muted' }, g.party.map((m) => `${m.name}:${aptitudeGrade(data, m.job, def) ?? '-'}`).join(' '))),
      el('button', { onclick: () => act((gg) => { buyGear(data, gg, def.id); return `${def.name}を買った（-${price}）`; }) }, `${price}`))),
    el('h2', {}, '倉庫の装備を売る'),
    g.storage.gear.length ? null : el('p', { class: 'muted small' }, '倉庫に装備がない'),
    g.storage.gear.map((x) => el('div', { class: 'row small', style: 'align-items:center' },
      el('div', { style: 'flex:2' }, `${gearDef(data, x).name}（${x.rarity}）`),
      el('button', { onclick: () => act((gg) => `売った（+${sellGear(data, gg, x.uid)}）`) }, `売る ${sellPrice(data, x)}`))),
    el('a', { class: 'btn', href: 'party.html' }, 'パーティの装備を変更'),
  ];
}

function temple() {
  const g = session.game;
  return [
    el('p', { class: 'muted small' }, '復活とジョブチェンジ。'),
    g.party.map((m, i) => el('div', { class: 'row small', style: 'align-items:center' },
      el('div', { style: 'flex:2' }, `${m.name}　${m.hp > 0 ? '元気' : '倒れている'}`),
      m.hp <= 0 ? el('button', { onclick: () => act((gg) => `${m.name}が復活した（-${revive(data, gg, i)}）`) }, `復活 ${reviveCost(data, m)}`) : null)),
    g.party.filter((m) => m.persist?.length).map((m) => el('button', { onclick: () => act((gg) => cureAtTemple(data, gg, m)) }, `${m.name}の状態異常を治療`)),
    el('a', { class: 'btn primary', href: 'chant.html' }, '詠唱の間（瞬間英作文）'),
    templeExtras(data, g, act, lex, learning),
    el('h2', {}, 'ジョブチェンジ'),
    el('div', { class: 'panel small' }, `共有JP ${g.jp}`),
    el('p', { class: 'muted small' }, '装備できなくなる物は倉庫に入ります。覚えたスキルと AP はジョブごとに残ります。'),
    g.party.map((m, i) => el('label', { class: 'small' }, `${m.name}（今：${data.jobsById.get(m.job).name}）`,
      el('select', {
        class: 'select',
        onchange: (e) => { if (e.target.value && confirm(`${m.name}を${data.jobsById.get(e.target.value).name}に転職しますか？（${data.jobsById.get(e.target.value).changeJp} JP）`)) act((gg) => { changeJob(data, gg, i, e.target.value); return `${m.name}は${data.jobsById.get(e.target.value).name}になった`; }); else draw(); },
      }, el('option', { value: '' }, '変えない'), availableJobs(data, g).filter((j) => j.id !== m.job).map((j) => el('option', { value: j.id, disabled: g.jp < j.changeJp }, `${j.name}（${j.changeJp} JP）`))))),
  ];
}

function storage() {
  const g = session.game;
  const mats = Object.entries(g.storage.materials);
  return [
    el('h2', {}, `素材（${mats.length}種類）`),
    mats.length ? el('div', { class: 'panel small' }, mats.map(([id, n]) => el('div', {}, `★${data.materials.get(id)?.rank} ${data.materials.get(id)?.name ?? id} ×${n}`))) : el('p', { class: 'muted small' }, 'なし'),
    el('h2', {}, `装備（${g.storage.gear.length}個）`),
    g.storage.gear.length ? el('div', { class: 'panel small' }, g.storage.gear.map((x) => el('div', {}, gearDef(data, x).name))) : el('p', { class: 'muted small' }, 'なし'),
    el('h2', {}, '道具'),
    el('div', { class: 'panel small' }, Object.entries(g.items).map(([id, n]) => el('div', {}, `${data.items.get(id)?.name ?? id} ×${n}`))),
  ];
}

function draw() {
  const g = session.game;
  const inFacility = g?.party && facility && !session.inDungeon && !session.readOnly;
  view.classList.toggle('guild-view', inFacility && facility.id === 'guild');
  setSceneMusic(inFacility ? (facility.id === 'guild' ? 'tavern' : 'facility') : 'town');
  if (session.readOnly) {
    render(view, heading('冒険者の町'), el('p', { class: 'panel' }, 'このセーブは、より新しいバージョンのゲームで作成されています。'));
    return;
  }
  if (!g?.party) {
    render(view, heading('冒険者の町'),
      adventureCard('冒険をはじめる', '仲間の名前・ジョブ・見た目を選んで、最初のパーティを作ろう。', 'party.html', 'パーティを作る'));
    return;
  }
  // 最初に町を開いたときや、昇格で枠が増えたときに依頼を補充する。
  if (!session.inDungeon && (g.board?.length ?? 0) + g.quests.length < boardSize(data, g)) {
    fillBoard(data, g, rng());
    session.save();
  }
  if (!facility || session.inDungeon) return showHome(g);

  const cal = calendarOf(data, g.day);
  render(view, heading(facility.name, true), statusBar(g),
    flash?.text ? el('div', { class: `panel small ${flash.ok ? '' : 'error'}`, role: 'status' }, flash.text) : null,
    facility.id === 'manage' ? el('p', { class: 'panel small' },
      `${cal.month}か月目・月末まで${cal.daysLeft}日・月末の会費 ${guildFee(data, g)}`) : null,
    facility.show());
}

function refresh() {
  if (session.game && !session.readOnly) {
    normalizeGame(data, session.game);
    updateRuneModifiers(data, session.game, lex, learning, scheduler, scheduler.dayOf(now()));
    session.save();
  }
  draw();
}

(async () => {
  try {
    const [gd, stones, words, srs] = await Promise.all([loadGameData(), loadCsv('rune_stones.csv'), loadCsv('lexicon.csv'), loadJson('srs.json')]);
    data = gd;
    lex = buildLexicon(stones.rows, words.rows);
    scheduler = new Scheduler(srs.data);
    refresh();
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      session.load();
      learning.load();
      flash = null;
      refresh();
    });
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
