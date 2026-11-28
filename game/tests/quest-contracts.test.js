import { roundGold } from '../js/gold.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createNewGame, normalizeGame } from '../js/game-state.js';
import {
  fillBoard, refreshBoard, acceptQuest, canAcceptQuest, abandonQuest, reportQuest, canReport, countKills,
  questKey, questDepositTotal, questAbandonRefund, questProgress, calendarOf,
} from '../js/town.js';
import { monsterPool } from '../js/encounter.js';
import { GameSession } from '../js/save.js';
import { realGameData, seededRng, MemoryStorage } from './helpers.js';

const data = realGameData();
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const fresh = () => { const game = createNewGame(data, party); game.cleared = { windward_plain: 1, sunlit_forest: 1 }; return game; };
const board = (g, seed = 17) => fillBoard(data, g, seededRng(seed));

test('新規開始はパーティー共有10000G。換算済みセーブの所持金は再換算しない', () => {
  const g = fresh();
  assert.equal(g.gold, 10000);
  g.gold = 37;
  normalizeGame(data, g);
  assert.equal(g.gold, 37);
});

test('発見済みの冒険先だけで季節ごとに掲示6件を生成し、高ランクでも未公開地点を出さない', () => {
  for (let seasonIndex = 0; seasonIndex < 4; seasonIndex++) {
    const g = fresh();
    g.rank = seasonIndex % 2 ? 'S' : 'R01';
    g.day = 1 + seasonIndex * 30;
    board(g, 19 + seasonIndex);
    assert.equal(g.board.length, 6);
    assert.equal(new Set(g.board.map(questKey)).size, 6);
    const season = calendarOf(data, g.day).season.id;
    const initial = new Set(['windward_plain', 'mossy_cave', 'sunlit_forest', 'goblin_quarry', 'misty_marsh']);
    for (const q of g.board) {
      assert.ok(initial.has(q.dungeonId), q.dungeonId);
      const pool = monsterPool(data, q.dungeonId, season);
      if (q.type === 'hunt') assert.ok(pool.some((m) => q.targetIds.includes(m.id)));
      if (q.type === 'gather') assert.ok(pool.some((m) => q.materialIds.includes(m.materialCommon)));
      if (q.type === 'bounty') assert.equal(data.monsters.get(q.target).role, 'bounty');
    }
    g.cleared.mossy_cave = 1;
    g.cleared.sunlit_forest = 1;
    refreshBoard(data, g, seededRng(31 + seasonIndex));
    assert.equal(g.board.length, 6);
    const unlocked = new Set([...initial, 'ruined_fort', 'misty_marsh']);
    assert.ok(g.board.every((q) => unlocked.has(q.dungeonId)));
  }
});

test('受注上限5件と掲示6件を別に管理し、同じ依頼の重複を防ぐ', () => {
  const g = fresh(); board(g);
  const accepted = [];
  for (let i = 0; i < 5; i++) {
    const q = g.board[0];
    acceptQuest(data, g, q.uid, seededRng(i + 10)); accepted.push(q);
    assert.equal(g.board.length, 6);
  }
  assert.equal(g.quests.length, 5);
  assert.ok(g.board.every((q) => !accepted.some((a) => questKey(a) === questKey(q))));
  const before = structuredClone(g);
  assert.match(canAcceptQuest(data, g, g.board[0]).reason, /5件まで/);
  assert.throws(() => acceptQuest(data, g, g.board[0].uid), /5件まで/);
  assert.throws(() => acceptQuest(g, g.board[0].uid), /5件まで/);
  assert.deepEqual(g, before, '受注失敗では保証金も掲示も変更しない');
  g.board.push({ ...accepted[0], uid: -1 });
  assert.equal(canAcceptQuest(data, g, g.board.at(-1)).ok, false);
  assert.throws(() => acceptQuest(data, g, -1), /同じ依頼/);
});

test('賞金首保証金は受注時に一度預け、達成時に報酬と分けて全額返還する', () => {
  const g = fresh(); board(g);
  const q = g.board.find((q) => q.type === 'bounty');
  const initial = g.gold;
  assert.equal(q.depositGold, roundGold(data,q.rewardGold * 0.1,'ceil'));
  acceptQuest(data, g, q.uid, seededRng(3));
  assert.equal(g.gold, initial - q.depositGold);
  assert.equal(questDepositTotal(g), q.depositGold);
  countKills(g, [{ monsterId: q.target }]);
  const reward = q.rewardGold;
  const lines = reportQuest(data, g, q.uid, seededRng(4));
  assert.equal(g.gold, initial + reward);
  assert.equal(questDepositTotal(g), 0);
  assert.ok(lines.some((s) => s.includes('保証金')));
  const after = g.gold;
  assert.throws(() => reportQuest(data, g, q.uid), /報告/);
  assert.equal(g.gold, after);
});

test('保証金不足でも掲示と所持金が変わらず、無料依頼は受けられる', () => {
  const g = fresh(); board(g); g.gold = 0;
  const q = g.board.find((q) => q.type === 'bounty');
  const before = structuredClone(g);
  assert.throws(() => acceptQuest(data, g, q.uid), /保証金/);
  assert.deepEqual(g, before);
  acceptQuest(data, g, g.board.find((q) => q.type === 'hunt').uid, seededRng(22));
  assert.equal(g.gold, 0);
});

test('自主放棄で保証金80%返還、同じ掲示は帰還まで再受注できず二重返金もない', () => {
  const g = fresh(); board(g);
  const q = g.board.find((q) => q.type === 'bounty');
  const start = g.gold;
  acceptQuest(data, g, q.uid, seededRng(1));
  const refund = questAbandonRefund(data, q);
  abandonQuest(data, g, q.uid, seededRng(2));
  assert.equal(g.gold, start - q.depositGold + refund);
  assert.equal(refund, Math.floor(q.depositGold / 10 * 0.8) * 10);
  assert.ok(!g.board.some((offer) => questKey(offer) === questKey(q)));
  const gold = g.gold;
  assert.throws(() => abandonQuest(data, g, q.uid), /受注/);
  assert.equal(g.gold, gold);
});

test('全滅・再読込・途中帰還でも契約と保証金が維持される', () => {
  const g = fresh(); board(g);
  const q = g.board.find((q) => q.type === 'bounty');
  acceptQuest(data, g, q.uid, seededRng(8));
  const paidGold = g.gold;
  const deposit = questDepositTotal(g);
  const storage = new MemoryStorage();
  const session = new GameSession({ storage }); session.startNew(g);
  session.enterDungeon({ dungeonId: q.dungeonId, stoneId: 'test' });
  session.updateRun((run, game) => { game.gold += 90; game.quests[0].progress = 1; });
  const resumed = new GameSession({ storage });
  resumed.wipe();
  assert.equal(resumed.game.gold, paidGold);
  assert.equal(questDepositTotal(resumed.game), deposit);
  assert.equal(resumed.game.quests[0].progress, 0);
  resumed.enterDungeon({ dungeonId: q.dungeonId, stoneId: 'test' });
  resumed.leaveDungeon((game) => refreshBoard(data, game, seededRng(9)));
  assert.equal(resumed.game.gold, paidGold);
  assert.equal(questDepositTotal(resumed.game), deposit);
  assert.equal(resumed.game.quests[0].uid, q.uid);
});

test('地域討伐は指定地域で数え、旧セーブの特定種討伐もそのまま達成できる', () => {
  const g = fresh(); board(g);
  const q = g.board.find((q) => q.type === 'hunt');
  acceptQuest(data, g, q.uid, seededRng(4));
  const enemies = Array.from({ length: q.count }, () => ({ monsterId: q.targetIds[0] }));
  countKills(g, enemies, 'another_dungeon'); assert.equal(q.progress, 0);
  countKills(g, enemies, q.dungeonId); assert.equal(canReport(data, g, q), true);
  const legacy = { uid: 99999, questId: 'q1_hunt', rank: 1, type: 'hunt', target: 'slime', count: 2, progress: 0 };
  g.quests.push(legacy);
  countKills(g, [{ monsterId: 'slime' }, { monsterId: 'slime' }]);
  assert.equal(canReport(data, g, legacy), true);
  const money = g.gold;
  reportQuest(data, g, legacy.uid, seededRng(11));
  assert.ok(g.gold > money);
});

test('採集は指定地域の素材だけを消費し、在庫での報告後も同条件を即再掲しない', () => {
  const g = fresh(); board(g);
  const q = g.board.find((q) => q.type === 'gather');
  acceptQuest(data, g, q.uid, seededRng(5));
  const other = [...data.materials.values()].find((m) => m.rank === q.rank && m.kind === 'common' && !q.materialIds.includes(m.id));
  assert.ok(other);
  g.storage.materials[other.id] = 99;
  assert.equal(canReport(data, g, q), false);
  g.storage.materials[q.materialIds[0]] = 20;
  assert.equal(questProgress(data, g, q), q.count);
  reportQuest(data, g, q.uid, seededRng(6));
  assert.equal(g.storage.materials[q.materialIds[0]], 20 - q.count);
  assert.equal(g.storage.materials[other.id], 99);
  assert.ok(!g.board.some((offer) => questKey(offer) === questKey(q)));
});

test('古い受注依頼は維持し保証金0。未受注だけが6候補へ移行する', () => {
  const g = fresh();
  const legacy = { uid: 9000, questId: 'q_bounty_01_1', type: 'bounty', rank: 1, target: 'bounty_01_1', count: 1, progress: 0 };
  g.quests = [legacy]; g.board = [];
  const before = structuredClone(legacy);
  board(g);
  assert.deepEqual(g.quests[0], before);
  assert.equal(g.board.length, 6);
  assert.equal(questDepositTotal(g), 0);
  const money = g.gold;
  abandonQuest(data, g, legacy.uid, seededRng(3));
  assert.equal(g.gold, money);
});


test('既存の6件以上は保持し、報告・放棄で4件になったら再受注できる', () => {
  for (const finish of ['report', 'abandon']) {
    const g = fresh(); board(g);
    for (let i = 0; i < 5; i++) acceptQuest(data, g, g.board[0].uid, seededRng(i + 20));
    // 上限導入前のセーブを再現する。
    g.quests.push({ ...g.board[0] });
    g.board.shift();
    const before = structuredClone(g);
    assert.throws(() => acceptQuest(data, g, g.board[0].uid), /5件まで/);
    assert.deepEqual(g, before);
    abandonQuest(data, g, g.quests.at(-1).uid, seededRng(40));
    assert.equal(g.quests.length, 5);
    assert.equal(canAcceptQuest(data, g, g.board[0]).ok, false);
    const hunt = g.quests.find(q => q.type === 'hunt');
    assert.ok(hunt);
    if (finish === 'report') {
      hunt.progress = hunt.count;
      reportQuest(data, g, hunt.uid, seededRng(41));
    } else abandonQuest(data, g, hunt.uid, seededRng(41));
    assert.equal(g.quests.length, 4);
    assert.equal(canAcceptQuest(data, g, g.board[0]).ok, true);
    acceptQuest(data, g, g.board[0].uid, seededRng(42));
    assert.equal(g.quests.length, 5);
  }
});
