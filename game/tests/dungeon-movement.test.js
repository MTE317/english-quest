import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// ページ全体の読み込みを避け、実際の移動ハンドラーをセッションと接続して検証する。
const page = readFileSync(new URL('../js/pages/dungeon-page.js', import.meta.url), 'utf8');
const handler = page.slice(page.indexOf('async function moveToNextBattle()'), page.indexOf('\nfunction beginBattle()'));

function setup(state = 'ready') {
  const run = { state, dungeonId: 'forest', floor: 3 };
  let finish;
  let enter;
  let starts = 0;
  let transitions = 0;
  const scope = { session: { run }, data: { dungeons: new Map([['forest', { name: '森' }]]) },
    playDungeonEntrance(name, callback) {
      transitions++;
      assert.equal(name, '森　3階');
      enter = callback;
      return new Promise(resolve => { finish = resolve; });
    },
    continueRun(session) { session.run.state = 'ready'; },
    beginBattle() { assert.equal(run.state, 'ready'); run.battle = {}; starts++; },
    console: { error() {} }, render() {}, el() {}, view: {}, showRun() {},
  };
  const move = vm.runInNewContext(`let advancing = false; ${handler}; moveToNextBattle;`, scope);
  return { run, scope, move, enter: () => enter(), finish: () => finish(),
    starts: () => starts, transitions: () => transitions };
}

for (const state of ['ready', 'return_point']) test(`${state}から暗転後に次戦を一度だけ開始する`, async () => {
  const game = setup(state);
  const moving = game.move();
  await game.move();
  assert.equal(game.transitions(), 1);
  assert.equal(game.starts(), 0);
  game.enter();
  game.finish();
  await moving;
  assert.equal(game.starts(), 1);
  await game.move();
  assert.equal(game.transitions(), 1, '開始済みの戦闘へ二重入場しない');
});

test('移動演出が失敗しても次の操作を受け付ける', async () => {
  const game = setup();
  game.scope.playDungeonEntrance = async () => { throw new Error('失敗'); };
  await game.move();
  let retried = false;
  game.scope.playDungeonEntrance = async (name, enter) => { retried = true; enter(); };
  await game.move();
  assert.equal(retried, true);
  assert.equal(game.starts(), 1);
});
