// 町をホームにして、施設カードから各施設を開く。
import { loadGameData } from '../gamedata.js?v=rune-study-1';
import { GameSession } from '../save.js?v=rune-study-1';
import { normalizeGame } from '../game-state.js?v=basic-skill-levels-1';
import { currentRank, seededRng } from '../dungeon.js?v=basic-skill-levels-1';
import {
  calendarOf, fillBoard, boardSize, questAcceptLimit, acceptQuest, canAcceptQuest, abandonQuest, canReport, reportQuest, questText, questProgress, questDestination, questRewardGold, questRankPoints, questDepositTotal, questAbandonRefund, nextRankStatus, stayInn, revive, reviveCost, checkRankUp,
  canExpandBackpack, expandBackpack, feeTier,
  nextBackpackTier,
} from '../town.js?v=basic-skill-levels-1';
import { backpackSlots } from '../loot.js?v=basic-skill-levels-1';
import { maxHp, maxMp, gearDef } from '../character.js?v=basic-skill-levels-1';
import { availableJobs, changeJob } from '../growth.js?v=basic-skill-levels-1';
import { explorationStories, acceptExplorationStory, reportExplorationStory } from '../exploration-story.js?v=basic-skill-levels-1';
import { cureAtTemple, recordStoredMaterials } from '../temple.js?v=systems-v1';
import { workshopView, managementView, templeExtras } from '../ui/facility-view.js?v=basic-skill-levels-1';
import { itemShopView, gearShopView } from '../ui/town-shops.js?v=basic-skill-levels-1';
import { weaponIcon } from '../ui/weapon-icons.js';
import { equipmentIcon } from '../ui/equipment-icons.js';
import { storageView } from '../ui/storage-view.js?v=storage-tabs-1';
import { uiIcon } from '../ui/pixel-icons.js';
import { portraitIcon } from '../ui/portrait.js';
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
const storageSelection = {};
let flash = null;
let templeTab = 'recovery';
let templeMember = 0;
let templeJob = null;
let guildTab = location.hash === '#guild-active' ? 'active' : 'board';

const requestedFacility = new URLSearchParams(window.location.search).get('facility');
const rng = () => seededRng({ rng: (Date.now() ^ (Math.random() * 2 ** 32)) >>> 0 });

const facilityGroups = [
  { title: '冒険の準備', cards: [
    { id: 'guild', name: 'ギルド酒場', icon: 'guild', detail: '依頼の受注・報告、昇格', show: guild },
    { id: 'inn', name: '宿屋', icon: 'inn', detail: 'HP・MPを回復', show: inn },
    { id: 'temple', name: '神殿', icon: 'temple', detail: '復活・治療、無料転職・ジョブ解放', show: temple },
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
    session.update((g) => { msg = fn(g); recordStoredMaterials(g); });
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
  { scene: 'wilds', title: '訓練場', task: '単語・英作文・チャンク', href: 'study.html?tab=training',
    guide: '単語の4択、瞬間英作文、チャンク集中、復習を5問から。6人全員に少量のXP・APが入ります。' },
  { scene: 'library', title: '試験の間', task: '昇格試験に挑む', href: 'study.html?tab=exam',
    guide: '単語と瞬間英作文の2分野を試験し、両方合格するとランク昇格の資格になります。' },
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
    action: heroAction('dungeon.html', '冒険先を選ぶ'), status: statusBar(g),
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
    const refund = questAbandonRefund(data, q, g.day);
    const type = data.questTypes.find((type) => type.id === q.type)?.name ?? '依頼';
    return el('li', { class: `guild-contract${ready ? ' reportable' : ''}` },
      el('div', { class: 'guild-contract-meta' },
        el('span', {}, `★${q.rank} ${type}`),
        el('span', {}, accepted ? (ready ? '報告可' : '進行中') : '募集中')),
      el('h3', {}, questText(data, q)),
      destination ? el('p', { class: 'small' }, `行き先　${destination}`) : null,
      el('p', {}, `報酬　${rewardText(q)}`),
      el('p', { class: 'small' }, deposit ? `${accepted ? '預かり中' : '受注保証金'} ${deposit} G（${q.special ? '期限内の達成で全額返還' : '達成時に全額返還'}）` : '受注無料'),
      q.special ? el('p', { class: 'small' }, accepted
        ? `期限 ${q.deadlineDay}日目${q.completedDay != null ? `・達成 ${q.completedDay}日目` : g.day > q.deadlineDay ? '・期限超過' : ''}`
        : `受注から${q.daysToComplete}日。期限内の達成でゴールド報酬30%増。`) : null,
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
  const tabs = [['board', '掲示板'], ['active', `受注中 ${g.quests.length}`], ['rank', '昇格']];
  const storyCard = story => el('li', { class: 'panel small' },
    el('h3', {}, story.title), el('p', {}, story.brief),
    el('p', {}, `報酬　${story.reward.gold} G・ポイント ${story.reward.points}`),
    story.ready ? el('button', { onclick: () => act(game => [
      reportExplorationStory(data, game, story.id), ...checkRankUp(data, game),
    ]) }, '探索を報告する') : story.accepted ? el('p', {}, '受注中') :
      el('button', { onclick: () => act(game => acceptExplorationStory(data, game, story.id)) }, '探索依頼を受ける'));
  const switcher = el('div', { class: 'district-switch', role: 'group', 'aria-label': '酒場の窓口' },
    tabs.map(([id, title]) => el('button', { 'aria-pressed': String(guildTab === id), onclick: () => {
      guildTab = id; flash = null; draw();
      view.querySelector('.district-switch [aria-pressed="true"]')?.focus({ preventScroll: true });
    } }, title)));
  if (guildTab === 'board') {
    const stories = explorationStories(data, g).filter(story => !story.accepted);
    return [switcher, el('section', { class: 'guild-board', 'aria-labelledby': 'guild-board-title' },
    el('header', {}, el('h2', { id: 'guild-board-title' }, '依頼掲示板'),
      el('span', {}, `掲示 ${g.board.length}件・受注 ${g.quests.length} / ${questAcceptLimit(data, g)}件`)),
    el('p', { class: 'small muted' }, '発見済みの冒険先に関する依頼だけを掲示しています。'),
    el('p', { class: 'small muted' }, `所持金 ${g.gold} G・預けている保証金 ${questDepositTotal(g)} G。`),
    g.specialQuest ? el('ul', { class: 'guild-contracts' }, card(g.specialQuest, false)) : null,
    stories.length ? el('ul', { class: 'guild-contracts' }, stories.map(storyCard)) : null,
    g.board.length ? el('ul', { class: 'guild-contracts' }, g.board.map((q) => card(q, false)))
      : el('p', {}, 'この掲示分の依頼は出そろいました。遠征から戻ると新しい依頼が届きます。'))];
  }
  if (guildTab === 'active') return [switcher, el('section', { class: 'guild-board', id: 'guild-active' },
    el('header', {}, el('h2', {}, '受けている依頼'), el('span', {}, `報告可 ${pending}件・受注 ${g.quests.length} / ${questAcceptLimit(data, g)}件`)),
    el('p', { class: 'small muted' }, `預かり保証金 ${questDepositTotal(g)} G。`),
    explorationStories(data, g).some(story => story.accepted)
      ? el('ul', { class: 'guild-contracts' }, explorationStories(data, g).filter(story => story.accepted).map(storyCard)) : null,
    g.quests.length ? el('ul', { class: 'guild-contracts' },
      [...g.quests].sort((a,b) => Number(canReport(data, g, b)) - Number(canReport(data, g, a))).map((q) => card(q, true)))
      : el('p', {}, '掲示板で依頼を受けると、ここで進み具合を確認できます。'))];
  return [switcher,
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
  const points = questRankPoints(data, session.game, q);
  return [gold ? `${gold} G` : null, item || null, `ポイント ${points}`].filter(Boolean).join('・');
}

function innPartyPanel(g) {
  const resource = (label, value, max, kind) => el('span', { class: `expedition-resource ${kind}` },
    el('span', {}, label), el('span', { class: 'expedition-resource-value' }, `${value}/${max}`),
    el('span', { class: 'expedition-meter', 'aria-hidden': 'true' },
      el('span', { style: `width:${max > 0 ? Math.max(0, Math.min(100, value / max * 100)) : 0}%` })));
  return el('div', { class: 'panel expedition-party', role: 'group', 'aria-label': `仲間${g.party.length}人の状態` },
    g.party.map((m) => {
      const conditions = (m.persist ?? []).map((id) => data.statusEffects.get(id)?.name ?? id);
      if (m.hp <= 0) conditions.unshift('戦闘不能');
      if (m.room) conditions.push('良い部屋の効果');
      return el('div', { class: `expedition-member${m.hp <= 0 ? ' error' : ''}`, role: 'group', 'aria-label': `${m.name} Lv${m.lv}` },
        el('div', { class: 'expedition-member-heading' }, portraitIcon(m.icon, { small: true }),
          el('span', { class: 'expedition-member-copy' },
            el('strong', { title: m.name }, m.name), el('small', {}, `Lv${m.lv}`))),
        resource('HP', m.hp, maxHp(data, m), 'hp'),
        resource('MP', m.mp, maxMp(data, m), 'mp'),
        conditions.length ? el('span', { class: 'expedition-conditions' }, conditions.join('・')) : null);
    }));
}

function inn() {
  const g = session.game;
  const econ = data.economy.get(feeTier(data, g));
  const fx = data.innRooms.find((r) => r.innRank === g.facilities.inn);
  return [
    el('p', { class: 'muted small' }, '戦闘不能の仲間は', el('a', { href: facilityLink('temple') }, '神殿'), 'で復活できます。'),
    innPartyPanel(g),
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

function templeJobIcon(job) {
  const kinds = { elementalist: 'staff', gunner: 'gun', dancer: 'whip',
    spellblade: 'sword', hexer: 'tome', apothecary: 'dagger' };
  return weaponIcon(job.startWeapon || kinds[job.id] || 'tome');
}

function temple() {
  const g = session.game;
  const switcher = el('div', { class: 'district-switch temple-tabs', role: 'group', 'aria-label': '神殿の窓口' },
    [['recovery', '回復'], ['jobs', 'ジョブチェンジ'], ['unlock', 'ジョブ解放']].map(([id, title]) => el('button', {
      type: 'button', 'aria-pressed': String(templeTab === id), onclick: () => {
        templeTab = id; flash = null; draw();
        view.querySelector('.temple-tabs [aria-pressed="true"]')?.focus({ preventScroll: true });
      },
    }, title)));
  if (templeTab === 'recovery') {
    const needsCare = g.party.some(m => m.hp <= 0 || m.persist?.length);
    return [switcher,
      el('h2', {}, '復活・状態異常の治療'),
      innPartyPanel(g),
      !needsCare ? el('p', { class: 'muted small' }, '復活・治療が必要な仲間はいません。') : null,
      g.party.map((m, i) => m.hp <= 0 || m.persist?.length
        ? el('section', { class: 'panel temple-treatment' },
          el('strong', {}, m.name),
          m.hp <= 0 ? el('button', { onclick: () => act(gg => `${m.name}が復活した（-${revive(data, gg, i)}）`) },
            `復活（${reviveCost(data, m)} G）`) : null,
          m.persist?.length ? el('button', { onclick: () => act(gg => cureAtTemple(data, gg, gg.party[i])) },
            '状態異常を治療する') : null)
        : null),
      el('p', { class: 'muted small' }, 'HP・MPの回復は宿屋で行えます。'),
      el('a', { class: 'btn ghost', href: facilityLink('inn') }, '宿屋へ'),
    ];
  }

  if (templeTab === 'unlock') return [switcher,
    el('h2', {}, 'ジョブ解放'),
    templeExtras(data, g, act),
  ];

  templeMember = Math.max(0, Math.min(templeMember, g.party.length - 1));
  const member = g.party[templeMember];
  const jobs = availableJobs(data, g);
  const selected = jobs.find(job => job.id === templeJob)
    ?? jobs.find(job => job.id === member.job) ?? jobs[0];
  templeJob = selected?.id ?? null;
  const current = selected?.id === member.job;
  const chooseMember = el('div', { class: 'temple-members', role: 'group', 'aria-label': '転職する仲間' },
    g.party.map((m, i) => el('button', {
      type: 'button', 'aria-pressed': String(i === templeMember),
      'aria-label': `${m.name}・${data.jobsById.get(m.job).name}`,
      onclick: () => {
        templeMember = i; templeJob = null; flash = null; draw();
        view.querySelector('.temple-members [aria-pressed="true"]')?.focus({ preventScroll: true });
      },
    }, portraitIcon(m.icon, { small: true }),
    el('strong', {}, m.name), el('small', {}, data.jobsById.get(m.job).name))));
  const grid = el('div', { class: 'shop-grid temple-job-grid', role: 'group', 'aria-label': '転職できるジョブ' },
    jobs.map(job => el('button', {
      type: 'button', class: 'shop-slot', 'aria-pressed': String(job.id === selected?.id),
      'aria-label': `${job.name}${job.id === member.job ? '・現在のジョブ' : ''}`,
      onclick: () => {
        templeJob = job.id; draw();
        view.querySelector('.temple-job-grid [aria-pressed="true"]')?.focus({ preventScroll: true });
      },
    }, templeJobIcon(job), el('span', { class: 'shop-slot-name' }, job.name),
    job.id === member.job ? el('span', { class: 'shop-slot-count' }, '現在のジョブ') : null)));
  const detail = selected ? el('section', { class: 'shop-detail temple-job-detail', 'aria-label': '選んだジョブ' },
    el('header', {}, templeJobIcon(selected), el('h2', {}, selected.name)),
    el('p', { class: 'shop-description' }, selected.role),
    selected.weakness ? el('p', { class: 'small muted' }, `苦手：${selected.weakness}`) : null,
    el('p', {}, `${member.name}：${data.jobsById.get(member.job).name} → ${selected.name}`),
    el('p', { class: 'small' }, `このジョブの残りAP：${member.ap?.[selected.id] ?? 0}`),
    el('button', { class: 'primary', disabled: current, onclick: () => {
      const index = templeMember;
      if (!confirm(`${member.name}を${selected.name}に無料転職しますか？`)) return;
      act(gg => {
        changeJob(data, gg, index, selected.id);
        return `${member.name}は${selected.name}になった`;
      });
    } }, current ? '現在のジョブ' : 'このジョブに転職する（無料）')) : null;
  return [switcher,
    el('h2', {}, '転職する仲間'),
    chooseMember,
    el('p', { class: 'muted small' }, '転職は何度でも無料。装備できなくなる物は倉庫へ戻り、習得スキルとAPは残ります。'),
    el('div', { class: 'shop-layout temple-job-layout' }, grid, detail),
  ];
}

function storage() {
  return storageView(data, session.game, storageSelection);
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
  if (!session.inDungeon && (g.questBoardVersion !== 3 || (g.board?.length ?? 0) < boardSize(data, g))) {
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
      `${cal.month}か月目・月末まで${cal.daysLeft}日`) : null,
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
