import { roundGold } from '../js/gold.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import {
  advanceDays, calendarOf, makeBoard, fillBoard, refreshBoard, acceptQuest, countKills, canReport, reportQuest, boardSize, nextRankStatus,
  stayInn, revive, reviveCost, itemShopStock, buyItem, gearShopStock, buyGear, sellGear, sellPrice, canExpandBackpack, expandBackpack,
  parseMaterialNeed, matchesNeed, questRankPoints, questBoardAreas, selectQuestBoardArea, TOWN_FORMULAS,
} from '../js/town.js';
import { makeEnemy } from '../js/battle.js';
import { seededRng } from '../js/dungeon.js';
import { maxHp, maxMp, computeStats, gearDef } from '../js/character.js';
import { realGameData, readCsv, readJson } from './helpers.js';

const data = realGameData();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => createNewGame(data, party);
const rng = () => seededRng({ rng: 9 });

test('旧会費の滞納だけを清算し、月末は銀行融資の利息だけが増える', () => {
  const g = fresh();
  g.gold = 5;
  g.overdue = 300;
  g.loan = 111;
  normalizeGame(data, g);
  assert.equal(g.overdue, undefined);
  assert.equal(g.loan, 111);
  const notes = advanceDays(data, g, TOWN_FORMULAS.days_per_month);
  assert.equal(g.gold, 5);
  assert.equal(g.loan, 111 + roundGold(data, 111 * readJson('balance.json').bank.loan_interest_monthly, 'ceil'));
  assert.ok(notes.some(n => n.includes('融資')));
  assert.equal(calendarOf(data, 31).month, 2);
  assert.equal(calendarOf(data, 1).season.id, 'spring');
});

test('地域を切り替えても掲示を引き直せず、同等以上の依頼は満額のポイントになる', () => {
  const g = fresh();
  makeBoard(data, g, rng());
  const first = g.board.map(q => q.uid);
  const [area] = questBoardAreas(data, g);
  selectQuestBoardArea(data, g, area.id, rng());
  assert.ok(g.board.length);
  assert.ok(g.board.every(q => area.dungeons.some(dungeon => dungeon.id === q.dungeonId)));
  selectQuestBoardArea(data, g, '', rng());
  assert.deepEqual(g.board.map(q => q.uid), first);
  const q = g.board[0];
  assert.equal(questRankPoints(data, g, { ...q, rank: q.rank + 1 }), questRankPoints(data, g, q));
});

test('特別依頼は報告日ではなく討伐日で期限の返金と報酬を決める', () => {
  for (const late of [false, true]) {
    const g = fresh();
    makeBoard(data, g, rng());
    const q = acceptQuest(data, g, g.specialQuest.uid, rng());
    g.day = q.deadlineDay + Number(late);
    countKills(g, [{ monsterId: q.target }], q.dungeonId);
    g.day += 3;
    const before = g.gold;
    reportQuest(data, g, q.uid, rng());
    assert.equal(g.gold - before, late ? q.rewardGold : roundGold(data, q.rewardGold * 1.3) + q.depositPaid);
  }
});

test('クエスト：掲示6件から地域討伐を受け、指定場所で倒すと報告できる', () => {
  const g = fresh();
  assert.equal(boardSize(data, g), 6);
  g.board = makeBoard(data, g, rng());
  assert.equal(g.board.length, 6);
  let q;
  for (let k = 0; k < 50 && !q; k++) { g.board = makeBoard(data, g, seededRng({ rng: k })); q = g.board.find((x) => x.type === 'hunt'); }
  acceptQuest(data, g, q.uid, rng());
  assert.equal(canReport(data, g, q), false);
  countKills(g, Array.from({ length: q.count }, () => makeEnemy(data, q.targetIds[0], { lv: 1 })), q.dungeonId);
  assert.equal(canReport(data, g, q), true);
  const gold0 = g.gold;
  const lines = reportQuest(data, g, q.uid, rng());
  assert.ok(g.gold > gold0 && g.rankPoints === 1, lines.join(','));
});

test('採集：倉庫の★の通常素材を納品すると、まれな素材がもらえる', () => {
  const g = fresh();
  const q = { uid: 1, questId: 'q1_gather', type: 'gather', rank: 1, target: null, count: 3, progress: 0 };
  g.quests.push(q);
  assert.equal(canReport(data, g, q), false);
  g.storage.materials.slime_mat = 2; g.storage.materials.goblin_mat = 2;
  assert.equal(canReport(data, g, q), true);
  reportQuest(data, g, 1, rng());
  const left = (g.storage.materials.slime_mat ?? 0) + (g.storage.materials.goblin_mat ?? 0);
  assert.equal(left, 1);
  assert.ok(Object.keys(g.storage.materials).some((id) => data.materials.get(id).kind === 'rare'));
});

test('採集報酬のまれな素材は依頼先の通常・季節モンスター由来に限定する', () => {
  for (const dungeonId of ['mossy_cave', 'sunlit_forest', 'goblin_quarry', 'ruined_fort', 'misty_marsh']) {
    const dungeon = data.dungeons.get(dungeonId);
    const resident = [...data.monsters.values()].find((m) => m.dungeons.includes(dungeonId)
      && m.role === 'normal' && data.materials.has(m.materialCommon));
    const eligible = new Set([...data.monsters.values()]
      .filter((m) => m.dungeons.includes(dungeonId) && ['normal', 'season'].includes(m.role))
      .map((m) => m.materialRare));
    for (const draw of [0, 0.5, 0.999]) {
      const g = fresh();
      const q = { uid: 999, questId: `q${dungeon.rank}_gather`, type: 'gather', rank: dungeon.rank,
        dungeonId, materialIds: [resident.materialCommon], count: 1, progress: 0 };
      g.quests.push(q);
      g.storage.materials[resident.materialCommon] = 1;
      reportQuest(data, g, q.uid, () => draw);
      const [reward] = Object.keys(g.storage.materials).filter((id) => data.materials.get(id)?.kind === 'rare');
      assert.ok(eligible.has(reward), `${dungeonId}: ${reward}`);
    }
  }
});

test('調合レシピの素材条件は全件読め、属性と状態異常の一致を判定する', () => {
  for (const recipe of data.alchemyRecipes) assert.doesNotThrow(() => parseMaterialNeed(data, recipe.materials), recipe.id);
  const fire = parseMaterialNeed(data, '★2以上の炎属性の素材:3')[0];
  const fireMaterial = [...data.materials.values()].find((m) => m.rank >= 2 && m.element === 'fire');
  assert.ok(fireMaterial);
  assert.equal(matchesNeed(data, fireMaterial.id, fire), true);
  assert.equal(matchesNeed(data, 'slime_mat', fire), false);
  const poison = parseMaterialNeed(data, '★2以上の、「継続ダメージ」系の状態異常を使うモンスターの素材:3')[0];
  const poisonMaterial = [...data.materials.values()].find((m) => m.rank >= 2
    && data.statusEffects.get(data.monsters.get(m.sourceMonster)?.status)?.group === '継続ダメージ');
  assert.ok(poisonMaterial);
  assert.equal(matchesNeed(data, poisonMaterial.id, poison), true);
  assert.equal(matchesNeed(data, 'slime_mat', poison), false);
});

test('ランク：ポイントがたまると「＋」に上がる。本ランクは踏破と昇格試験がいる', () => {
  const g = fresh();
  g.rankPoints = 6;
  g.quests.push({ uid: 5, questId: 'q1_hunt', type: 'hunt', rank: 1, target: 'slime', count: 1, progress: 1 });
  reportQuest(data, g, 5, rng());
  assert.equal(g.rank, 'R01+');
  g.rankPoints = 100;
  const st = nextRankStatus(data, g);
  assert.equal(st.next.id, 'R02');
  assert.ok(st.needs.some((n) => n.includes('踏破')) && st.needs.some((n) => n.includes('昇格試験')));
});

test('宿屋：HP・MP が全回復。良い部屋は最大HPが増える（倒れた人は起きない）', () => {
  const g = fresh();
  g.gold = 1000;
  g.party[0].hp = 1; g.party[1].hp = 0;
  const base = maxHp(data, g.party[0]);
  stayInn(data, g, true);
  const fx = readCsv('inn_rooms.csv').rows[0];
  assert.equal(maxHp(data, g.party[0]), Math.round(base * (1 + Number(fx.max_hp_pct) / 100)));
  assert.equal(g.party[0].hp, maxHp(data, g.party[0]));
  assert.equal(g.party[1].hp, 0);
  assert.equal(g.gold, 1000 - data.economy.get(1).inn_good);
  assert.ok(computeStats(data, g.party[0]).hp > base);
});

test('神殿の復活：30×レベル', () => {
  const g = fresh();
  g.party[2].hp = 0; g.gold = 1000;
  assert.equal(reviveCost(data, g.party[2]), 300);
  revive(data, g, 2);
  assert.equal(g.party[2].hp, maxHp(data, g.party[2]));
  assert.equal(g.gold, 700);
});

test('道具屋：ランク1の品ぞろえ・割引・10個まで', () => {
  const g = fresh();
  g.gold = 10000;
  const stock = itemShopStock(data, g);
  assert.ok(stock.every((x) => x.item.shopRank <= 1 && x.item.source === '店'));
  const potion = stock.find((x) => x.item.id === 'potion');
  const disc = Number(readCsv('adventurer_ranks.csv').rows[0].shop_discount);
  assert.equal(potion.price, roundGold(data, data.items.get('potion').price * (1 - disc)));
  assert.equal(buyItem(data, g, 'potion', 15), 10);
});

test('武器・防具屋：★1は装備Lv下限+3の段階。買うと倉庫へ、売るとお金', () => {
  const g = fresh();
  g.gold = 10000;
  const stock = gearShopStock(data, g);
  assert.ok(stock.length > 0 && stock.every((x) => x.def.itemLv === 3 && x.star === 1));
  const sword = stock.find((x) => x.def.id === 'sword_t1');
  assert.equal(sword.price, 10 * Math.round(Math.round((8 + 1.6 * 3) * 4.5) * (1 - Number(readCsv('adventurer_ranks.csv').rows[0].shop_discount))));
  const beforeCount = g.storage.gear.length;
  const gear = buyGear(data, g, 'sword_t1');
  assert.equal(g.storage.gear.length, beforeCount + 1);
  const p = sellPrice(data, gear);
  sellGear(data, g, gear.uid);
  assert.equal(g.storage.gear.length, beforeCount);
  assert.equal(g.gold, 10000 - sword.price + p);
});

test('バックパックを広げる：お金と素材の条件（backpack.csv の文を読む）', () => {
  const g = fresh();
  const need = parseMaterialNeed(data, '★1以上の通常素材（獣・人型）:5');
  assert.deepEqual(need[0].types.sort(), ['beast', 'humanoid']);
  g.facilities.item_shop = 2;
  assert.equal(canExpandBackpack(data, g).ok, false);
  g.gold = 6000; g.storage.materials.goblin_mat = 3; g.storage.materials.cave_rat_mat = 2; g.storage.materials.slime_mat = 9;
  assert.equal(canExpandBackpack(data, g).ok, true, canExpandBackpack(data, g).reasons.join());
  expandBackpack(data, g);
  assert.equal(g.backpackTier, 2);
  assert.equal(g.storage.materials.slime_mat, 9); // スライム（不定形）は使わない
  assert.equal(g.gold, 1000);
});

test('古いセーブに足りない項目を足す', () => {
  const g = fresh();
  delete g.facilities; delete g.quests; delete g.party[0].persist;
  normalizeGame(data, g);
  assert.equal(g.facilities.inn, 1);
  assert.deepEqual(g.quests, []);
  assert.deepEqual(g.party[0].persist, []);
});

test('掲示板：受注とは別に6候補を保ち、月末だけでは入れかわらない', () => {
  const g = fresh();
  const n = boardSize(data, g);
  fillBoard(data, g, rng());
  assert.equal(g.board.length, n);
  const first = g.board[0];
  acceptQuest(data, g, first.uid, rng());
  assert.equal(g.board.length, n);
  assert.equal(g.quests.length, 1);
  fillBoard(data, g, rng());
  assert.equal(g.board.length, n); // 未受注の候補は受注枠と別に6件
  const offers = g.board.map((q) => q.uid);
  advanceDays(data, g, TOWN_FORMULAS.days_per_month);
  assert.deepEqual(g.board.map((q) => q.uid), offers);
  // 報告後も未受注の6候補を維持
  first.type = 'hunt'; first.progress = first.count;
  reportQuest(data, g, first.uid, rng());
  assert.equal(g.quests.length, 0);
  assert.equal(g.board.length, n);
  assert.deepEqual(g.board.map((q) => q.uid), offers);
});

test('掲示板：入れかえは受けていない枠だけ', () => {
  const g = fresh();
  fillBoard(data, g, rng());
  const kept = g.board[0];
  acceptQuest(data, g, kept.uid, rng());
  const old = g.board.map((q) => q.uid);
  refreshBoard(data, g, seededRng({ rng: 77 }));
  assert.deepEqual(g.quests.map((q) => q.uid), [kept.uid]);
  assert.equal(g.board.length, boardSize(data, g));
  assert.ok(g.board.every((q) => !old.includes(q.uid)));
});

