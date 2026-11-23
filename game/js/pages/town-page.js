// 町をホームにして、施設カードから各施設を開く。
import { loadGameData } from '../gamedata.js?v=rune-study-1';
import { GameSession } from '../save.js?v=rune-study-1';
import { normalizeGame } from '../game-state.js?v=party6-1';
import { currentRank, seededRng } from '../dungeon.js?v=build36-1';
import {
  calendarOf, guildFee, fillBoard, boardSize, questAcceptLimit, acceptQuest, canAcceptQuest, abandonQuest, canReport, reportQuest, questText, questProgress, questDestination, questRewardGold, questDepositTotal, questAbandonRefund, nextRankStatus, stayInn, revive, reviveCost, checkRankUp,
  canExpandBackpack, expandBackpack, feeTier,
  nextBackpackTier,
} from '../town.js?v=build36-1';
import { backpackSlots } from '../loot.js?v=build36-1';
import { maxHp, maxMp, gearDef } from '../character.js?v=build36-1';
import { availableJobs, changeJob } from '../growth.js?v=build36-1';
import { chainStep, stepLabel, acceptChain, talkChain, deliverChain, claimChain } from '../quest-chain.js?v=features-2';
import { cureAtTemple } from '../temple.js?v=rune-study-1';
import { workshopView, managementView, templeExtras } from '../ui/facility-view.js?v=build36-1';
import { itemShopView, gearShopView } from '../ui/town-shops.js?v=pixel-town-1';
import { weaponIcon } from '../ui/weapon-icons.js';
import { equipmentIcon } from '../ui/equipment-icons.js';
import { uiIcon } from '../ui/pixel-icons.js';
import { el, render } from '../dom.js';
import { setSceneMusic } from '../battle-music.js?v=music-suite-1';

import { installGameShell, sceneHeader } from '../ui/game-shell.js?v=pixel-town-1';

const view = document.getElementById('view');
const session = new GameSession();
installGameShell('town', session);
session.installAutoSave(window);
let data;
const workshopSelection = {};
const itemShopSelection = {};
const gearShopSelection = {};
let flash = null;
let guildTab = location.hash === '#guild-active' ? 'active' : 'board';

const requestedFacility = new URLSearchParams(window.location.search).get('facility');
const rng = () => seededRng({ rng: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });

const facilityGroups = [
  { title: '冒険の準備', cards: [
    { id: 'guild', name: 'ギルド酒場', icon: 'guild', detail: '依頼の受注・報告、昇格', show: guild },
    { id: 'inn', name: '宿屋', icon: 'inn', detail: 'HP・MPを回復', show: inn },
    { id: 'temple', name: '神殿', icon: 'temple', detail: '復活・治療、転職・ジョブ解放', show: temple },
    { href: 'party.html', name: 'パーティ', icon: 'party', detail: '仲間の装備・スキル' },
  ] },
  { title: '買い物・強化', cards: [
    { id: 'items', name: '道具屋', icon: 'items', detail: '道具を買う、荷物枠を広げる', show: items },
    { id: 'gear', name: '武器・防具屋', icon: 'gear', detail: '装備の購入・売却', show: gearShop },
    { id: 'workshop', name: '工房・調合', icon: 'workshop', detail: '装備の作成・強化、道具の調合',
      show: () => workshopView(data, session.game, act, rng, workshopSelection) },
    { id: 'storage', name: '倉庫', icon: 'storage', detail: '装備・道具・素材を確認', show: storage },
  ] },
  { title: '挑戦・運営', cards: [
    { href: 'challenge.html', name: '闘技場', icon: 'arena', detail: '対戦と最終試験' },
    { id: 'manage', name: '銀行・投資', icon: 'bank', detail: '融資・返済、施設の強化',
      show: () => managementView(data, session.game, act) },
    { id: 'catalog', name: '図鑑', icon: 'catalog', detail: '魔物・装備・収集記録',
      show: () => el('section', { class: 'panel' }, el('p', { class: 'muted' }, '図鑑の内容は準備中です。')) },
    { id: 'achievements', name: '実績・称号', icon: 'achievements', detail: '達成記録と称号',
      show: () => el('section', { class: 'panel' }, el('p', { class: 'muted' }, '実績・称号の内容は準備中です。')) },
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
    session.update((g) => { msg = fn(g); });
    flash = { ok: true, text: Array.isArray(msg) ? msg.join('　') : msg };
  } catch (e) { flash = { ok: false, text: e.message }; }
  draw();
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
    el('span', { class: 'town-card-icon', 'aria-hidden': 'true' }, uiIcon(icon)),
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
    reportable ? el('a', { href: facilityLink('guild') + '#guild-active' }, `報告できる依頼 ${reportable}件`) : null,
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

const townStops = [
  { scene: 'tavern', title: 'ギルド酒場', task: '依頼を受ける', href: facilityLink('guild'),
    guide: '掲示板から依頼を受けよう。討伐や採集の条件を満たして酒場で報告すると、お金とランクポイントを獲得できる。' },
  { scene: 'wilds', title: '訓練場', task: '単語を復習', href: 'study.html?tab=training',
    guide: '鍛えたい仲間と問題数を選んで、英単語の4択に挑戦。復習が必要な単語から出題され、正解すると仲間が成長する。' },
  { scene: 'library', title: '詠唱の間', task: '瞬間英作文', href: 'chant.html',
    guide: '日本語を見て、英語で声に出そう。答えと発音を確かめて、自分がどこまで言えたかを選ぶ。' },
];

function stopCards(intro = false) {
  return el('section', { class: 'town-stops' },
    el('h2', { class: 'chapter-title' }, intro ? 'はじめての冒険ガイド' : '町の行き先'),
    el('div', { class: 'stop-grid' }, townStops.map(({ scene, title, task, guide, href }) => {
      const face = [
        el('span', { class: `stop-art scene-${scene}`, 'aria-hidden': 'true' }),
        el('span', { class: 'stop-label' }, el('small', {}, title), el('strong', {}, task)),
      ];
      return intro
        ? el('details', { class: 'stop-card' }, el('summary', {}, face), el('p', {}, guide))
        : el('a', { class: 'stop-card', href }, face);
    })));
}

function heroAction(href, label) {
  return el('a', { class: 'btn primary hero-action', href },
    el('span', { 'aria-hidden': 'true' }, '✦'), label);
}

function facilityDirectory() {
  const list = el('div', { class: 'town-grid facility-grid', id: 'facility-list' });
  const nav = el('div', { class: 'district-switch', role: 'group', 'aria-label': '施設の種類' });
  function choose(index) {
    Array.from(nav.children).forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    render(list, facilityGroups[index].cards.map(townCard));
  }
  facilityGroups.forEach(({ title }, i) => nav.append(el('button', { 'aria-controls': list.id, onclick: () => choose(i) }, title)));
  choose(0);
  return el('section', {}, el('h2', { class: 'chapter-title' }, '施設案内'), nav, list);
}

function showHome(g) {
  if (session.inDungeon) {
    const run = session.run;
    const detail = [run.label ?? data.dungeons.get(run.dungeonId)?.name, run.floor && `${run.floor}階`].filter(Boolean).join('・');
    render(view, sceneHeader(run.challenge ? '挑戦の途中' : '遠征の途中', 'wilds',
      { detail, action: heroAction(run.challenge ? 'challenge.html' : 'dungeon.html', '冒険を続ける') }));
    return;
  }
  render(view, sceneHeader('冒険者の町', 'town', {
    detail: '行き先とルーンストーンを選んで遠征へ。',
    action: heroAction('dungeon.html', 'ダンジョンへ'), status: statusBar(g),
  }), townActions(g), townNotices(g), stopCards(), facilityDirectory());
}

function guild() {
  const g = session.game;
  const st = nextRankStatus(data, g);
  const pending = g.quests.filter((q) => canReport(data, g, q)).length;
  const card = (q, accepted) => {
    const ready = accepted && canReport(data, g, q);
    const accept = accepted ? null : canAcceptQuest(data, g, q);
    const destination = questDestination(data, q);
    const deposit = accepted ? q.depositPaid ?? 0 : q.depositGold ?? 0;
    const refund = questAbandonRefund(data, q);
    const type = data.questTypes.find((type) => type.id === q.type)?.name ?? '依頼';
    return el('li', { class: `guild-contract${ready ? ' reportable' : ''}` },
      el('div', { class: 'guild-contract-meta' },
        el('span', {}, `★${q.rank} ${type}`),
        el('span', {}, accepted ? (ready ? '報告可' : '進行中') : '募集中')),
      el('h3', {}, questText(data, q)),
      destination ? el('p', { class: 'small' }, `行き先　${destination}`) : null,
      el('p', {}, `報酬　${rewardText(q)}`),
      el('p', { class: 'small' }, deposit ? `${accepted ? '預かり中' : '受注保証金'} ${deposit} G（達成時に全額返還）` : '受注無料'),
      accepted ? el('progress', { max: q.count, value: questProgress(data, g, q), 'aria-label': '依頼の進み具合' }) : null,
      accepted ? el('span', {}, `${questProgress(data, g, q)} / ${q.count}`) : null,
      accepted
        ? ready ? el('button', { onclick: () => act((gg) => reportQuest(data, gg, q.uid, rng())) }, '報告する') : null
        : el('button', { disabled: !accept.ok, title: accept.reason, onclick: () => act((gg) => {
          const taken = acceptQuest(data, gg, q.uid, rng());
          return taken.depositPaid ? `依頼を受けた。保証金 ${taken.depositPaid} G を預けた。` : '依頼を受けた。';
        }) }, accept.ok ? (deposit ? `${deposit} G を預けて受注` : '依頼を受ける') : accept.reason),
      accepted ? el('details', { class: 'small' }, el('summary', {}, '依頼を取り下げる'),
        el('p', {}, deposit ? `保証金 ${refund} G を返還します。手数料は ${deposit - refund} G です。` : '取り下げても費用はかかりません。'),
        el('p', { class: 'muted small' }, '同じ内容の依頼は、次の遠征から戻るまで再掲されません。'),
        el('button', { onclick: () => act((gg) => abandonQuest(data, gg, q.uid, rng())) }, 'この依頼を取り下げる')) : null);
  };
  const tabs = [['board', '掲示板'], ['active', `受注中 ${g.quests.length}`], ['rank', '昇格・連続依頼']];
  const switcher = el('div', { class: 'district-switch', role: 'group', 'aria-label': '酒場の窓口' },
    tabs.map(([id, title]) => el('button', { 'aria-pressed': String(guildTab === id), onclick: () => {
      guildTab = id; flash = null; draw();
      view.querySelector('.district-switch [aria-pressed="true"]')?.focus({ preventScroll: true });
    } }, title)));
  if (guildTab === 'board') return [switcher, el('section', { class: 'guild-board', 'aria-labelledby': 'guild-board-title' },
    el('header', {}, el('h2', { id: 'guild-board-title' }, '依頼掲示板'),
      el('span', {}, `掲示 ${g.board.length}件・受注 ${g.quests.length} / ${questAcceptLimit(data, g)}件`)),
    el('p', { class: 'small muted' }, `所持金 ${g.gold} G・預けている保証金 ${questDepositTotal(g)} G。期限はなく、帰還・全滅でも受注は継続します。`),
    g.board.length ? el('ul', { class: 'guild-contracts' }, g.board.map((q) => card(q, false)))
      : el('p', {}, 'この掲示分の依頼は出そろいました。遠征から戻ると新しい依頼が届きます。'))];
  if (guildTab === 'active') return [switcher, el('section', { class: 'guild-board', id: 'guild-active' },
    el('header', {}, el('h2', {}, '受けている依頼'), el('span', {}, `報告可 ${pending}件・受注 ${g.quests.length} / ${questAcceptLimit(data, g)}件`)),
    el('p', { class: 'small muted' }, `預かり保証金 ${questDepositTotal(g)} G。達成報告で全額返還されます。`),
    g.quests.length ? el('ul', { class: 'guild-contracts' },
      [...g.quests].sort((a,b) => Number(canReport(data, g, b)) - Number(canReport(data, g, a))).map((q) => card(q, true)))
      : el('p', {}, '掲示板で依頼を受けると、ここで進み具合を確認できます。'))];
  return [switcher,
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
  const gold = questRewardGold(data, session.game, q);
  const item = def?.rewardItem?.includes('確定ではない') ? '固有装備は討伐時に抽選' : def?.rewardItem;
  const gap = currentRank(data, session.game).maxDungeonRank - q.rank;
  const rules = data.balance.guild_points ?? {};
  const points = (def?.rankPoints ?? 0) * (gap === 0 ? rules.same_rank ?? 1 : gap === 1 ? rules.one_rank_lower ?? 0.5 : 0);
  return [gold ? `${gold} G` : null, item || null, `ポイント ${points}`].filter(Boolean).join('・');
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
    itemShopView(data, g, itemShopSelection, act),
    el('h2', {}, 'バックパックを広げる'),
    el('div', { class: 'panel small' },
      el('div', {}, `今：${backpackSlots(data, g)}枠`),
      nt ? el('div', {}, `次：${nt.slots}枠（お金 ${nt.gold}${nt.materials ? `・${nt.materials}` : ''}）`) : el('div', {}, '最大'),
      nt && !exp.ok ? el('div', { class: 'error' }, exp.reasons.join('・')) : null,
      nt ? el('button', { disabled: !exp.ok, onclick: () => act((gg) => `バックパックが${expandBackpack(data, gg)}枠になった`) }, '広げる') : null),
  ];
}

function gearShop() {
  return [
    gearShopView(data, session.game, gearShopSelection, act),
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
    templeExtras(data, g, act),
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
    g.storage.gear.length ? el('div', { class: 'panel small' }, g.storage.gear.map((x) => {
      const def = gearDef(data, x);
      return el('div', { class: 'gear-with-icon' },
        equipmentIcon(def), el('span', {}, def.name));
    })) : el('p', { class: 'muted small' }, 'なし'),
    el('h2', {}, '道具'),
    el('div', { class: 'panel small' }, Object.entries(g.items).map(([id, n]) => el('div', {}, `${data.items.get(id)?.name ?? id} ×${n}`))),
  ];
}

function draw() {
  const g = session.game;
  const inFacility = g?.party && facility && !session.inDungeon && !session.readOnly;
  view.classList.toggle('facility-view', !!inFacility);
  view.classList.toggle('guild-view', !!inFacility && facility.id === 'guild');
  setSceneMusic(inFacility ? (facility.id === 'guild' ? 'tavern' : 'facility') : 'town');
  if (session.readOnly) {
    render(view, sceneHeader('冒険者の町', 'town'), el('p', { class: 'panel' }, 'このセーブは、より新しいバージョンのゲームで作成されています。'));
    return;
  }
  if (!g?.party) {
    render(view, sceneHeader('冒険者の町', 'town', {
      detail: '仲間を編成してダンジョンへ。英語の4択に正解すると、仲間が攻撃やスキルを繰り出します。',
      action: heroAction('party.html', 'パーティを作る'),
    }), stopCards(true));
    return;
  }
  // 最初に町を開いたときや、昇格で枠が増えたときに依頼を補充する。
  if (!session.inDungeon && (g.questBoardVersion !== 2 || (g.board?.length ?? 0) < boardSize(data, g))) {
    fillBoard(data, g, rng());
    session.save();
  }
  if (!facility || session.inDungeon) return showHome(g);

  const cal = calendarOf(data, g.day);
  document.title = `${facility.name} - English Quest`;
  const scene = { guild: 'tavern', inn: 'tavern', temple: 'temple', workshop: 'forge', gear: 'forge' }[facility.id] ?? 'town';
  render(view, sceneHeader(facility.name, scene, { detail: facility.detail, returnToTown: true, status: statusBar(g) }),
    flash?.text ? el('div', { class: `action-feedback ${flash.ok ? '' : 'error'}`, role: 'status' }, flash.text, el('button', { 'aria-label': '通知を閉じる', onclick: (e) => { flash = null; e.currentTarget.parentNode.remove(); } }, '×')) : null,
    facility.id === 'manage' ? el('p', { class: 'panel small' },
      `${cal.month}か月目・月末まで${cal.daysLeft}日・月末の会費 ${guildFee(data, g)}`) : null,
    facility.show());
}

function refresh() {
  if (session.game && !session.readOnly) {
    normalizeGame(data, session.game, session.run);
    session.save();
  }
  draw();
}

(async () => {
  try {
    data = await loadGameData();
    refresh();
    window.addEventListener('pageshow', (event) => {
      if (!event.persisted) return;
      session.load();
      flash = null;
      refresh();
    });
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
    console.error(e);
  }
})();
