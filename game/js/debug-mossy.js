// 表示検証専用。通常の遠征やセーブに接続する呼び出し口は持たない。
import { createBattle, makeEnemy } from './battle.js?v=basic-skill-levels-1';
import { createNewGame, defaultPartySpecs } from './game-state.js?v=basic-skill-levels-1';
import { GameSession } from './save.js?v=rune-study-1';
import { LearningStore } from './storage.js?v=stability-1';

const MOSSY = 'mossy_cave';
const five = Object.freeze(['cave_rat', 'pollen_bug', 'slime', 'exp_mossy_cave_7', 'cave_bat']);
const eight = Object.freeze([...five, 'cave_rat', 'pollen_bug', 'slime']);

export function makeDebugMossyBattle(data, stoneId, count) {
  const ids = count === 5 ? five : count === 8 ? eight : null;
  if (!ids) throw new RangeError('敵の数は5体か8体を選んでください。');
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const session = new GameSession({ storage });
  const store = new LearningStore(storage);
  session.startNew(createNewGame(data, defaultPartySpecs(data)));
  session.enterDungeon({ dungeonId: MOSSY, stoneId, floor: 1, state: 'battle', label: `苔むした洞窟・開発テスト（${count}体）` });
  const enemies = ids.map(id => makeEnemy(data, id, { lv: 1, dungeonId: MOSSY }));
  const battle = createBattle(data, session.game, { enemies, seed: 4214 });
  // 開いた直後に敵の全数を読めるよう、最初は味方の操作から始める。
  battle.round = 1;
  battle.turn = { side: 'ally', i: 0 };
  session.setBattle(battle);
  return { session, store };
}
