import test from 'node:test';
import assert from 'node:assert/strict';
import { playDungeonEntrance } from '../js/ui/dungeon-entrance.js';

function setup(t, reduced = false) {
  const keys = ['document', 'window', 'matchMedia', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => saved.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }));
  const classes = () => {
    const values = new Set();
    return { add: x => values.add(x), remove: x => values.delete(x), contains: x => values.has(x) };
  };
  const app = { inert: false };
  const locked = { inert: true };
  const body = { children: [app, locked], append(node) { this.children.push(node); } };
  const nodes = [];
  const document = { body, activeElement: { isConnected: false }, createElement() {
    const node = { classList: classes(), style: { setProperty() {} }, append() {}, setAttribute() {},
      remove() { body.children = body.children.filter(child => child !== this); } };
    nodes.push(node);
    return node;
  } };
  Object.assign(globalThis, { document, window: { innerWidth: 390, innerHeight: 844 },
    matchMedia: () => ({ matches: reduced }),
    requestAnimationFrame: fn => setTimeout(() => fn(performance.now()), 16),
    cancelAnimationFrame: clearTimeout });
  return { app, locked, body, nodes };
}

test('入場は暗転後に一度だけ開始し、演出が終わると操作を戻す', async t => {
  const { app, locked, body, nodes } = setup(t);
  let entered = 0;
  const run = playDungeonEntrance('木漏れ日の森', () => {
    entered++;
    assert.equal(app.inert, true);
    assert.equal(nodes[0].classList.contains('closed'), true);
  });
  assert.equal(app.inert, true);
  assert.equal(entered, 0);
  assert.equal(nodes[1].textContent, '木漏れ日の森');
  assert.equal(playDungeonEntrance('別の場所', () => { entered += 10; }), run);
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(entered, 0, '足音の途中ではまだ戦闘を開始しない');
  assert.equal(nodes[0].classList.contains('closed'), false);
  await new Promise(resolve => setTimeout(resolve, 600));
  assert.equal(nodes[0].classList.contains('named'), true);
  assert.equal(nodes[0].classList.contains('reveal'), false);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.equal(nodes[0].classList.contains('reveal'), false, 'ダンジョン名の短縮後も読み取る時間を確保する');
  await run;
  assert.equal(entered, 1);
  assert.equal(body.children.length, 2);
  assert.equal(app.inert, false);
  assert.equal(locked.inert, true);
});

test('視差効果を減らす設定でも入場し、音声非対応でも完了する', async t => {
  const { app, nodes } = setup(t, true);
  let entered = false;
  await playDungeonEntrance('霧の洞窟', () => { entered = true; });
  assert.equal(entered, true);
  assert.match(nodes[0].className, /reduced-motion/);
  assert.equal(app.inert, false);
});

test('戦闘画面の開始に失敗しても暗転や操作ロックを残さず再試行できる', async t => {
  const { app, body } = setup(t, true);
  await assert.rejects(playDungeonEntrance('洞窟', () => { throw new Error('開始失敗'); }), /開始失敗/);
  assert.equal(app.inert, false);
  assert.equal(body.children.length, 2);
  await playDungeonEntrance('洞窟', () => {});
  assert.equal(app.inert, false);
});
