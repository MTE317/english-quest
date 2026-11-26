import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame } from '../js/game-state.js';
import { createBattle, makeEnemy } from '../js/battle.js';
import { GameSession } from '../js/save.js';
import { startRun, afterBattle, returnToTown } from '../js/dungeon.js';
import { discoverJobs, jobDiscoveryProgress } from '../js/temple.js';
import { readCsv, readJson, MemoryStorage } from './helpers.js';

const master = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
// 発見処理は制御データで検証する。個別技能が未実装の30職は準備中のまま。
const data = { ...master, jobsById: new Map(master.jobsById), jobUnlocks: new Map() };
for (const [id, dungeon] of [['necromancer', 'ruined_fort'], ['onmyoji', 'howling_canyon']]) {
  data.jobsById.set(id, { ...master.jobsById.get(id), skillsReady: true });
  data.jobUnlocks.set(id, { job_id: id, method: '発見', discover_dungeon: dungeon,
    discover_chance_after_boss: '0.1', discover_guarantee_clears: '3' });
}
const specs = ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard'].map((job) => ({ name: job, job, icon: 'x' }));
const discoveries = [['necromancer', 'ruined_fort'], ['onmyoji', 'howling_canyon']];
const fresh = () => createNewGame(data, specs);

test('新マスターの準備中30職は踏破しても解放せず、初期解放12職と旧職を混同しない', () => {
  const game = createNewGame(master, specs);
  for (const dungeon of master.dungeons.values()) discoverJobs(master, game, dungeon.id, () => 0);
  assert.deepEqual(game.unlockedJobs, ['paladin','dark_knight','berserker','samurai','gladiator','warrior_monk','ascetic','executioner','ninja','assassin','bounty_hunter','dragoon','gunner','pirate','spellblade','elementalist','witch','hexer']);
  assert.equal(master.jobs.filter((job) => job.skillsReady === false).length,24);
});

test('公開の発見2職だけ3踏破保証を持ち、元の10%抽選を維持する', () => {
  const rules = [...data.jobUnlocks.values()].filter((rule) => Number(rule.discover_guarantee_clears) > 0);
  assert.deepEqual(new Set(rules.map((rule) => rule.job_id)), new Set(discoveries.map(([job]) => job)));
  for (const [jobId, dungeonId] of discoveries) {
    const rule = data.jobUnlocks.get(jobId);
    assert.equal(rule.discover_dungeon, dungeonId);
    assert.equal(Number(rule.discover_guarantee_clears), 3);
    assert.equal(Number(rule.discover_chance_after_boss), 0.1);
  }
});

test('一回目でも確率抽選で発見でき、旧セーブの未定義配列を補う', () => {
  for (const [jobId, dungeonId] of discoveries) {
    const game = { cleared: {} };
    discoverJobs(data, game, dungeonId, () => 0.05);
    assert.deepEqual(game.unlockedJobs, [jobId]);
    assert.deepEqual(game.notices, [`${data.jobsById.get(jobId).name}を発見した！`]);
    assert.deepEqual(game.cleared, {}); // 踏破数の加算は帰還側だけが担当する。
  }
});

test('最初の二回が抽選外でも、今回を含め三回目のボス撃破で必ず発見する', () => {
  for (const [jobId, dungeonId] of discoveries) {
    const game = fresh();
    let draws = 0;
    const unlucky = () => { draws++; return 0.99; };
    for (const prior of [0, 1]) {
      game.cleared[dungeonId] = prior;
      discoverJobs(data, game, dungeonId, unlucky);
      assert.ok(!game.unlockedJobs.includes(jobId));
    }
    game.cleared[dungeonId] = 2;
    discoverJobs(data, game, dungeonId, unlucky);
    assert.ok(game.unlockedJobs.includes(jobId));
    assert.equal(draws, 2); // 保証が成立した回は抽選結果に左右されない。
    assert.equal(game.cleared[dungeonId], 2);
  }
});

test('違うダンジョンの踏破・既に解放済みの職では追加の発見を行わない', () => {
  const game = fresh();
  game.cleared.ruined_fort = 10;
  game.cleared.howling_canyon = 10;
  discoverJobs(data, game, 'mossy_cave', () => { throw new Error('関係ない地域で抽選しない'); });
  assert.deepEqual(game.unlockedJobs, []);
  game.unlockedJobs.push('necromancer');
  const notices = [...game.notices];
  discoverJobs(data, game, 'ruined_fort', () => { throw new Error('既解放なら抽選しない'); });
  assert.deepEqual(game.unlockedJobs, ['necromancer']);
  assert.deepEqual(game.notices, notices);
});

test('旧セーブの既踏破数を使い、未解放なら次の対象ボス撃破で追いつく', () => {
  const game = { cleared: { ruined_fort: 8 } };
  assert.deepEqual(jobDiscoveryProgress(data, game, 'necromancer'), { dungeonId: 'ruined_fort', clears: 8, guarantee: 3 });
  discoverJobs(data, game, 'ruined_fort', () => 0.99);
  assert.deepEqual(game.unlockedJobs, ['necromancer']);
  assert.equal(game.cleared.ruined_fort, 8);
  assert.equal(jobDiscoveryProgress(data, {}, 'onmyoji').clears, 0);
});

test('保証列がないデータは従来の確率だけで判定し、非公開上級職へ保証を広げない', () => {
  for (const value of [undefined, '', '0']) {
    const rule = { ...data.jobUnlocks.get('necromancer'), discover_guarantee_clears: value };
    const legacy = { ...data, jobUnlocks: new Map([['necromancer', rule]]) };
    const game = { cleared: { ruined_fort: 20 } };
    discoverJobs(legacy, game, 'ruined_fort', () => 0.99);
    assert.deepEqual(game.unlockedJobs, []);
    discoverJobs(legacy, game, 'ruined_fort', () => 0.05);
    assert.deepEqual(game.unlockedJobs, ['necromancer']);
  }
  const hidden = { ...data, jobsById: new Map(data.jobsById), jobUnlocks: new Map() };
  hidden.jobsById.set('private_test', { id: 'private_test', name: '非公開', tier: 'advanced' });
  hidden.jobUnlocks.set('private_test', { job_id: 'private_test', method: '発見', discover_dungeon: 'ruined_fort',
    discover_chance_after_boss: '0.1', discover_guarantee_clears: '3' });
  const game = { cleared: { ruined_fort: 20 } };
  discoverJobs(hidden, game, 'ruined_fort', () => 0.99);
  assert.deepEqual(game.unlockedJobs, []);
});

test('実遠征のボス撃破時は未加算の踏破数を使い、帰還で一回だけ加算する', () => {
  const session = new GameSession({ storage: new MemoryStorage() });
  const game = fresh();
  game.rank = 'R02';
  game.cleared.mossy_cave = 1; // 砦の発見条件
  game.cleared.ruined_fort = 2;
  session.startNew(game);
  startRun(data, session, { dungeonId: 'ruined_fort', stoneId: 'rs_2_001', quizState: null, seed: 1 });
  session.run.floor = data.dungeons.get('ruined_fort').floors;
  const boss = makeEnemy(data, data.dungeons.get('ruined_fort').bossId, { lv: 10, dungeonId: 'ruined_fort', boss: true });
  const battle = createBattle(data, session.game, { enemies: [boss], seed: 2 });
  battle.enemies[0].hp = 0;
  battle.result = 'win';
  session.setBattle(battle);
  afterBattle(data, session);
  assert.ok(session.game.unlockedJobs.includes('necromancer'));
  assert.equal(session.game.cleared.ruined_fort, 2);
  assert.equal(session.run.cleared, true);
  returnToTown(data, session);
  assert.equal(session.game.cleared.ruined_fort, 3);
  assert.equal(session.game.notices.filter((note) => note.includes(data.jobsById.get('necromancer').name + 'を発見')).length, 1);
});

test('全滅や途中帰還を繰り返しても発見の踏破回数を増やさない', () => {
  const session = new GameSession({ storage: new MemoryStorage() });
  const game = fresh();
  game.rank = 'R02';
  game.cleared.mossy_cave = 1;
  game.cleared.ruined_fort = 1;
  session.startNew(game);
  startRun(data, session, { dungeonId: 'ruined_fort', stoneId: 'rs_2_001', quizState: null, seed: 3 });
  session.run.state = 'return_point';
  returnToTown(data, session);
  assert.equal(session.game.cleared.ruined_fort, 1);
  assert.deepEqual(session.game.unlockedJobs, []);
  startRun(data, session, { dungeonId: 'ruined_fort', stoneId: 'rs_2_001', quizState: null, seed: 4 });
  session.wipe();
  assert.equal(session.game.cleared.ruined_fort, 1);
  assert.deepEqual(session.game.unlockedJobs, []);
});
