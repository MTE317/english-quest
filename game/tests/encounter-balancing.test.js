import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData, readCsv, MemoryStorage, seededRng } from './helpers.js';
import { createNewGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { encounterWeights, monsterPool, makeEncounter, planBounty, bountyProbability, floorRow, bossEscorts } from '../js/encounter.js';
import { startRun, startNextBattle, afterBattle, returnToTown, runRoute, runFloorRow, runFloorCount, isBossBattle } from '../js/dungeon.js';
import { calendarOf } from '../js/town.js';
import { goldForEnemy } from '../js/loot.js';
import { withEngineSkillFixtures } from './combat-fixtures.js';

const data = withEngineSkillFixtures(realGameData());
const party = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));

test('賞金首の補正は道具・パッシブ・装備から各1つを採用し上限を守る', () => {
  const game = createNewGame(data, party);
  assert.equal(bountyProbability(data, game, 'mossy_cave', true), .4);
  for (const member of game.party.slice(0, 2)) {
    member.learned.push('hunter_p2_s5');
    member.loadout.passives = ['hunter_p2_s5'];
    member.equip.accessory1 = { affixes: { BOUNTY_CHANCE: 5 } };
  }
  assert.ok(Math.abs(bountyProbability(data, game, 'mossy_cave', true, true) - .7) < 1e-9);
  const limited = { ...data, balance: { ...data.balance, dungeon: { ...data.balance.dungeon, bounty_quest_chance: .65 } } };
  assert.equal(bountyProbability(limited, game, 'mossy_cave', true, true), .8);
});

function newSession(gameData = data) {
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  session.startNew(createNewGame(gameData, party));
  session.game.cleared = { windward_plain: 1, sunlit_forest: 1 };
  return { session, storage };
}

test('60ダンジョンの短い経路・帰還地点・ボス到達レベルが整合する', () => {
  assert.equal(data.dungeons.size, 61);
  for (const dungeon of data.dungeons.values()) {
    if (data.balance.dungeon.intro_routes[dungeon.id] || dungeon.id === 'howling_canyon') continue;
    const rows = data.dungeonFloors.filter((row) => row.dungeonId === dungeon.id).sort((a, b) => a.floor - b.floor);
    const battles = dungeon.kind === '近場' ? 2 : dungeon.kind === '深層' ? 6 : 3;
    assert.equal(rows.length, battles, dungeon.id);
    assert.equal(rows.reduce((sum, row) => sum + row.battles, 0), battles, dungeon.id);
    assert.equal(rows.filter((row) => row.lastBattleIsBoss).length, 1, dungeon.id);
    assert.ok(rows.at(-1).lastBattleIsBoss, dungeon.id);
    assert.ok(rows.every((row) => row.floor <= dungeon.floors), dungeon.id);
    assert.equal(rows.find((row) => row.returnPointAfter).floor, dungeon.returnPointFloor, dungeon.id);
    const old = data.balance.dungeon.legacy_layout[dungeon.id];
    assert.equal(rows[0].enemyLevel, old.first_level, dungeon.id);
    assert.equal(rows.at(-1).enemyLevel, old.first_level + old.floors - 1, dungeon.id);
  }
  // 旧連続クエストの代わりに、単独の特殊探索が実在ダンジョンを指すことを検証。
  for (const story of data.balance.exploration_stories ?? []) {
    assert.ok(data.dungeons.has(story.dungeon), story.id);
  }
});

test('主力6種類に重みを置き、全通常種・全季節種を図鑑で集められる', () => {
  const reachable = new Set();
  for (const dungeon of data.dungeons.values()) for (const season of ['spring', 'summer', 'autumn', 'winter']) {
    if (dungeon.id === 'windward_plain') continue;
    const weighted = encounterWeights(data, dungeon.id, season, { legacy: true });
    assert.equal(weighted.filter((entry) => entry.common).length, data.balance.encounters.common_count);
    assert.ok(weighted.every((entry) => entry.weight > 0), `${dungeon.id}/${season}`);
    const commonShare = weighted.filter((entry) => entry.common).reduce((sum, entry) => sum + entry.weight, 0);
    assert.ok(Math.abs(commonShare - data.balance.encounters.common_share) < 1e-12);
    for (const entry of weighted) reachable.add(entry.monster.id);
  }
  const expected = [...data.monsters.values()].filter((m) => ['normal', 'season'].includes(m.role));
  assert.equal(expected.length, 903);
  assert.deepEqual(new Set(expected.map((m) => m.id)), reachable);
});

test('実際の遭遇抽選でも常連が多く、旧セーブの特定種依頼は探しやすくなる', () => {
  const dungeonId = 'goblin_quarry', season = 'spring';
  const weights = encounterWeights(data, dungeonId, season);
  const common = new Set(weights.filter((entry) => entry.common).map((entry) => entry.monster.id));
  const rare = weights.find((entry) => !entry.common);
  const withQuest = encounterWeights(data, dungeonId, season, { quests: [{ type: 'hunt', target: rare.monster.id, progress: 0, count: 2 }] });
  assert.ok(withQuest.find((entry) => entry.monster.id === rare.monster.id).weight > rare.weight);
  const rng = seededRng(482);
  const rowOverride = { ...floorRow(data, dungeonId, 1), enemiesPerBattle: 1 };
  let regulars = 0;
  for (let i = 0; i < 1500; i++) {
    const [enemy] = makeEncounter(data, dungeonId, 1, rng, { season, rowOverride });
    if (common.has(enemy.monsterId)) regulars += 1;
  }
  assert.ok(Math.abs(regulars / 1500 - data.balance.encounters.common_share) < 0.045, String(regulars));
});

test('季節の地以外でも現在の季節の敵だけが出現する', () => {
  const dungeonId = 'goblin_quarry';
  let sawSeasonal = false;
  for (let seed = 1; seed <= 35; seed++) {
    const { session } = newSession();
    startRun(data, session, { dungeonId, stoneId: 'rs_1_001', quizState: null, seed: seed * 1299709 });
    session.run.bounty = null;
    const season = calendarOf(data, session.game.day).season.id;
    const allowed = new Set(monsterPool(data, dungeonId, season).map((m) => m.id));
    startNextBattle(data, session);
    for (const enemy of session.run.battle.enemies) {
      assert.ok(allowed.has(enemy.monsterId), enemy.monsterId);
      if (data.monsters.get(enemy.monsterId).role === 'season') sawSeasonal = true;
    }
  }
  assert.ok(sawSeasonal);
});

test('冠付きは初心者・ボス・賞金首を避け、通常戦でも上限を守る', () => {
  const dungeon = [...data.dungeons.values()].find((d) => d.rank === data.balance.dungeon.elite_min_star);
  const normal = makeEncounter(data, dungeon.id, 1, () => 0, { elites: true, season: 'spring' });
  assert.equal(normal.filter((enemy) => enemy.eliteId).length, 1);
  assert.ok(makeEncounter(data, 'mossy_cave', 1, () => 0, { elites: true }).every((enemy) => !enemy.eliteId));
  assert.ok(makeEncounter(data, dungeon.id, dungeon.floors, () => 0, { boss: true, elites: true }).every((enemy) => !enemy.eliteId));
  const bounty = [...data.monsters.values()].find((m) => m.role === 'bounty' && m.dungeons.includes(dungeon.id));
  assert.ok(makeEncounter(data, dungeon.id, 1, () => 0, { bountyId: bounty.id, elites: true }).every((enemy) => !enemy.eliteId));
  assert.ok(makeEncounter(data, dungeon.id, 1, () => 0, { elites: true, maxElites: 0 }).every((enemy) => !enemy.eliteId));
});

test('賞金首は受注中に見つけやすくなり、最終ボス戦へ重ねない', () => {
  const game = createNewGame(data, party);
  const dungeonId = 'goblin_quarry';
  const bounty = [...data.monsters.values()].find((m) => m.role === 'bounty' && m.dungeons.includes(dungeonId));
  const chance = data.balance.dungeon.bounty_quest_chance;
  const baseChance = data.dropTables.get(dungeonId).bountyChance;
  assert.ok(chance > baseChance);
  const draw = (chance + baseChance) / 2;
  assert.equal(planBounty(data, game, dungeonId, () => draw), null);
  game.quests.push({ type: 'bounty', target: bounty.id, count: 1, progress: 0 });
  const planned = planBounty(data, game, dungeonId, () => draw);
  assert.equal(planned.monsterId, bounty.id);
  const row = floorRow(data, dungeonId, planned.floor);
  assert.ok(planned.battle < row.battles - Number(row.lastBattleIsBoss));
});

test('遠征中に新しい経路へ更新されても、開始時の経路で再開できる', () => {
  const local = realGameData();
  const { session, storage } = newSession(local);
  startRun(local, session, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 42 });
  const before = structuredClone(session.run.route);
  local.dungeonFloors = local.dungeonFloors.filter((row) => row.dungeonId !== 'mossy_cave' || row.floor === 1);
  session.save();
  const resumed = new GameSession({ storage });
  assert.deepEqual(runRoute(local, resumed.run), before);
  assert.equal(runFloorCount(local, resumed.run), 4);
});

test('短縮前の遠征セーブを最深階から再開し、旧ボスを倒して帰還できる', () => {
  const { session, storage } = newSession();
  startRun(data, session, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 7 });
  const legacy = data.balance.dungeon.legacy_layout.mossy_cave;
  delete session.run.route; delete session.run.layoutVersion; delete session.run.introRouteVersion;
  session.run.floor = legacy.floors;
  session.run.battleIndex = legacy.battles_per_floor - 1;
  session.run.battlesDone = legacy.floors * legacy.battles_per_floor - 1;
  session.run.bounty = null;
  session.save();
  const resumed = new GameSession({ storage });
  assert.equal(runFloorCount(data, resumed.run), legacy.floors);
  assert.equal(runFloorRow(data, resumed.run).enemyLevel, legacy.first_level + legacy.floors - 1);
  assert.ok(isBossBattle(data, resumed.run));
  startNextBattle(data, resumed);
  assert.ok(resumed.run.battle.enemies.some((enemy) => enemy.monsterId === data.dungeons.get('mossy_cave').bossId));
  resumed.run.battle.result = 'win';
  resumed.run.battle.enemies.forEach((enemy) => { enemy.hp = 0; });
  afterBattle(data, resumed);
  assert.equal(resumed.run.state, 'cleared');
  returnToTown(data, resumed);
  assert.equal(resumed.inDungeon, false);
  assert.equal(resumed.game.cleared.mossy_cave, 1);
});

test('短い経路も旧経路も、一周の基準収入を保つ', () => {
  const dungeon = data.dungeons.get('mossy_cave');
  const old = runRoute(data, { dungeonId: dungeon.id, floor: 1, battleIndex: 0 });
  const current = data.dungeonFloors.filter((row) => row.dungeonId === dungeon.id);
  for (const route of [old, current]) {
    let gold = 0, enemyCount = 0;
    for (const row of route) {
      const ordinary = (row.battles - Number(row.lastBattleIsBoss)) * row.enemiesPerBattle;
      const count = ordinary + (row.lastBattleIsBoss ? bossEscorts(data) : 0);
      for (let i = 0; i < count; i++) { gold += goldForEnemy(data, dungeon.id, { boss: false }, () => 0.5, route); enemyCount++; }
      if (row.lastBattleIsBoss) { gold += goldForEnemy(data, dungeon.id, { boss: true }, () => 0.5, route); enemyCount++; }
    }
    const expected = data.economy.get(dungeon.rank).run_income * dungeon.incomeMul * data.dropTables.get(dungeon.id).goldShare;
    assert.ok(Math.abs(gold - expected) <= enemyCount * 10, `${gold} / ${expected}`);
  }
});

test('最終ボスから逃げても踏破扱いにならず、帰還または再挑戦できる', () => {
  const { session } = newSession();
  startRun(data, session, { dungeonId: 'mossy_cave', stoneId: 'rs_1_001', quizState: null, seed: 11 });
  session.run.floor = data.dungeons.get('mossy_cave').floors;
  session.run.battleIndex = 0;
  session.run.bounty = null;
  startNextBattle(data, session);
  const gold = session.game.gold;
  session.run.battle.result = 'fled';
  assert.equal(afterBattle(data, session).result, 'fled');
  assert.equal(session.run.state, 'return_point');
  assert.equal(session.run.cleared, false);
  assert.ok(isBossBattle(data, session.run));
  assert.equal(session.game.gold, gold);
  returnToTown(data, session);
  assert.equal(session.game.cleared.mossy_cave, undefined);
});

