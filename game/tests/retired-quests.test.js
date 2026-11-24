import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCsv } from '../js/data.js';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { GameSession } from '../js/save.js';
import { MemoryStorage, readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const fresh = () => createNewGame(data, defaultPartySpecs(data));
const rewards = game => structuredClone({ gold: game.gold, points: game.rankPoints,
  materials: game.storage.materials, retired: game.retiredQuestChains });

test('旧ローダーが必須CSVを取得しても空の一覧として読み込める', async t => {
  t.mock.method(globalThis, 'fetch', async url => {
    try { return new Response(await readFile(new URL(url)), { status: 200 }); }
    catch (error) {
      if (error.code === 'ENOENT') return new Response('', { status: 404 });
      throw error;
    }
  });
  const result = await loadCsv('quest_chains.csv');
  assert.deepEqual(result.header, ['id', 'star', 'title', 'steps', 'reward']);
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.errors, []);
  assert.equal(GAME_FILES.questChains, undefined);
  assert.equal(data.questChains, undefined);
});

test('新規ゲームの再読込では旧依頼の報酬や履歴を追加しない', () => {
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  session.startNew(fresh());
  const before = rewards(session.game);
  for (let i = 0; i < 3; i++) {
    session.load();
    normalizeGame(data, session.game, session.run);
    session.save();
    assert.deepEqual(rewards(session.game), before);
  }
});

test('旧24依頼の未受領・受領済み・途中進行は保存と再読込をまたいで一度だけ精算する', () => {
  for (const claimed of [false, true]) for (const completed of [false, true]) {
    const storage = new MemoryStorage();
    const session = new GameSession({ storage });
    const game = fresh();
    game.chains = Object.fromEntries(Array.from({ length: 24 }, (_, i) => {
      const rank = Math.floor(i / 2) + 1;
      return [`chain_${String(rank).padStart(2, '0')}_${i % 2 + 1}`,
        { step: completed ? (rank <= 4 ? 3 : rank <= 8 ? 4 : 5) : 2, claimed, progress: 0 }];
    }));
    session.startNew(game);
    normalizeGame(data, session.game);
    session.save();
    const settled = rewards(session.game);
    assert.equal(Object.keys(settled.retired).length, 24);
    assert.equal(session.game.chains, undefined);
    assert.equal(settled.gold > game.gold, !claimed);
    for (let i = 0; i < 3; i++) {
      session.load();
      normalizeGame(data, session.game);
      session.save();
      assert.deepEqual(rewards(session.game), settled);
    }
  }
});

test('旧遠征の現在値と復元元を精算し、全滅では遠征中の進行分だけを巻き戻す', () => {
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  const game = fresh();
  game.chains = { chain_01_1: { step: 2, progress: 0 } };
  session.startNew(game);
  session.enterDungeon({ dungeonId: 'mossy_cave' });
  session.updateRun((run, current) => {
    current.chains.chain_01_1.step = 3;
    run.battle = { pending: { actor: 0 }, rng: 42 };
  });
  session.load();
  const battle = structuredClone(session.run.battle);
  normalizeGame(data, session.game, session.run);
  assert.deepEqual(session.run.battle, battle);
  const current = rewards(session.game), snapshot = rewards(session.run.snapshot);
  assert.ok(current.gold > snapshot.gold);
  session.save();
  session.load();
  normalizeGame(data, session.game, session.run);
  assert.deepEqual(rewards(session.game), current);
  assert.deepEqual(rewards(session.run.snapshot), snapshot);
  session.wipe();
  session.load();
  normalizeGame(data, session.game);
  assert.deepEqual(rewards(session.game), snapshot);
});
