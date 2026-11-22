// 町の画面：ギルド（クエスト・ランク）・宿屋・道具屋・武器防具屋・神殿（復活）・倉庫
import { loadGameData } from '../gamedata.js';
import { GameSession } from '../save.js';
import { normalizeGame } from '../game-state.js';
import { currentRank, seededRng } from '../dungeon.js';
import {
  calendarOf, guildFee, makeBoard, acceptQuest, canReport, reportQuest, questText, nextRankStatus, stayInn, revive, reviveCost,
  itemShopStock, buyItem, gearShopStock, buyGear, sellGear, sellPrice, canExpandBackpack, expandBackpack, payOverdue, feeTier,
  nextBackpackTier, daysPerMonth,
} from '../town.js';
import { backpackSlots } from '../loot.js';
import { maxHp, maxMp, gearDef, aptitudeGrade } from '../character.js';
import { availableJobs, changeJob } from '../growth.js';
import { el, render, stars } from '../dom.js';

const view = document.getElementById('view');
const session = new GameSession();
session.installAutoSave(window);
let data;
let tab = 'guild';
let flash = null;

const TABS = [['guild', 'ギルド'], ['inn', '宿屋'], ['items', '道具屋'], ['gear', '武器・防具屋'], ['temple', '神殿'], ['storage', '倉庫']];
const rng = () => seededRng({ rng: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });

/** 進み具合を変えて保存し、結果を出す。失敗したら理由を出す */
function act(fn) {
  try {
    let msg;
    session.update((g) => { msg = fn(g); });
    flash = { ok: true, text: Array.isArray(msg) ? msg.join('　') : msg };
  } catch (e) { flash = { ok: false, text: e.message }; }
  draw();
}

function head() {
  const g = session.game;
  const cal = calendarOf(data, g.day);
  const rank = currentRank(data, g);
  return [
    el('div', { class: 'panel small' },
      el('div', {}, `${cal.month}か月目（${cal.season?.name ?? ''}）${cal.dayOfMonth}日目・月末まで${cal.daysLeft}日`),
      el('div', {}, `お金 ${g.gold}${g.overdue ? `　滞納 ${g.overdue}` : ''}・ランク ${rank.title}`),
      el('div', { class: 'muted' }, `月末の会費 ${guildFee(data, g)}`)),
    g.notices?.length ? el('details', { class: 'panel small' }, el('summary', {}, `お知らせ（${g.notices.length}）`),
      g.notices.slice().reverse().map((n) => el('div', {}, n)),
      el('button', { class: 'ghost', onclick: () => act((gg) => { gg.notices = []; return '消した'; }) }, 'お知らせを消す')) : null,
    el('div', { class: 'tabs' }, TABS.map(([id, label]) => el('button', { class: tab === id ? 'on' : '', onclick: () => { tab = id; flash = null; draw(); } }, label))),
    flash ? el('div', { class: `panel small ${flash.ok ? '' : 'error'}` }, flash.text) : null,
  ];
}

function guild() {
  const g = session.game;
  if (!g.board) { g.board = makeBoard(data, g, rng()); session.save(); }
  const st = nextRankStatus(data, g);
  return [
    el('h2', {}, '受けているクエスト'),
    g.quests.length ? null : el('p', { class: 'muted small' }, 'なし'),
    g.quests.map((q) => el('div', { class: 'panel small' },
      el('div', {}, `★${q.rank} ${questText(data, q)}`),
      q.type !== 'gather' ? el('div', { class: 'muted' }, `${q.progress} / ${q.count}`) : null,
      el('button', { disabled: !canReport(data, g, q), onclick: () => act((gg) => reportQuest(data, gg, q.uid, rng())) }, canReport(data, g, q) ? '報告する' : 'まだ'))),
    el('h2', {}, `掲示板（${g.board.length}件・月が変わると入れかわる）`),
    g.board.length ? null : el('p', { class: 'muted small' }, '今月の依頼はもうない'),
    g.board.map((q) => el('div', { class: 'panel small' },
      el('div', {}, `★${q.rank} ${questText(data, q)}`),
      el('div', { class: 'muted' }, `報酬：${rewardText(q)}`),
      el('button', { onclick: () => act((gg) => { acceptQuest(gg, q.uid); return 'クエストを受けた'; }) }, '受ける'))),
    el('h2', {}, '冒険者ランク'),
    el('div', { class: 'panel small' },
      el('div', {}, `${currentRank(data, g).title}（ポイント ${g.rankPoints}）　特典：${currentRank(data, g).perk || 'なし'}`),
      st ? el('div', { class: 'muted' }, `次は「${st.next.title}」：${st.needs.length ? st.needs.join('・') : '上がれる'}`) : el('div', {}, '最高のランク')),
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
    el('p', { class: 'muted small' }, '倒れている人は起きません（神殿へ）。'),
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
  ];
}

function temple() {
  const g = session.game;
  return [
    el('p', { class: 'muted small' }, '復活とジョブチェンジ（治療・ジョブの解放・刻印はチェックリスト12番で作る）。'),
    g.party.map((m, i) => el('div', { class: 'row small', style: 'align-items:center' },
      el('div', { style: 'flex:2' }, `${m.name}　${m.hp > 0 ? '元気' : '倒れている'}`),
      m.hp <= 0 ? el('button', { onclick: () => act((gg) => `${m.name}が復活した（-${revive(data, gg, i)}）`) }, `復活 ${reviveCost(data, m)}`) : null)),
    g.overdue ? el('button', { onclick: () => act((gg) => `滞納を ${payOverdue(gg, gg.gold)} 払った`) }, `滞納を払う（${g.overdue}）`) : null,
    el('h2', {}, 'ジョブチェンジ'),
    el('p', { class: 'muted small' }, '装備できなくなる物は倉庫に入ります。覚えたスキルと AP はジョブごとに残ります。'),
    g.party.map((m, i) => el('label', { class: 'small' }, `${m.name}（今：${data.jobsById.get(m.job).name}）`,
      el('select', {
        class: 'select',
        onchange: (e) => { if (e.target.value && confirm(`${m.name}を${data.jobsById.get(e.target.value).name}にしますか？`)) act((gg) => { changeJob(data, gg, i, e.target.value); return `${m.name}は${data.jobsById.get(e.target.value).name}になった`; }); else draw(); },
      }, el('option', { value: '' }, '変えない'), availableJobs(data, g).filter((j) => j.id !== m.job).map((j) => el('option', { value: j.id }, `${j.name}（${j.role}）`))))),
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
  if (!session.game?.party) {
    render(view, el('p', {}, 'まだパーティがいません。'), el('a', { class: 'btn primary', href: 'party.html' }, 'パーティを作る'));
    return;
  }
  if (session.inDungeon) {
    render(view, el('p', {}, 'ダンジョンの中にいます。'), el('a', { class: 'btn primary', href: 'dungeon.html' }, 'ダンジョンへ'));
    return;
  }
  const body = { guild, inn, items, gear: gearShop, temple, storage }[tab]();
  render(view, head(), body, el('a', { class: 'btn primary', href: 'dungeon.html' }, 'ダンジョンへ出発する'));
}

(async () => {
  try {
    data = await loadGameData();
    if (session.game && !session.readOnly) { normalizeGame(data, session.game); session.save(); }
    draw();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
