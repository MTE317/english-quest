import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStorage } from './helpers.js';

const positionKey = 'englishQuest.musicPositions.music-suite-1';
const settingsKey = 'englishQuest.settings.v1';
let imports = 0;

class Events {
  listeners = new Map();
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  emit(type, detail = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({
      type, target: { closest: () => null }, ...detail,
    });
  }
}

async function setup(t, { session = new MemoryStorage(), delayedMetadata = false } = {}) {
  const oldGlobals = Object.fromEntries(['Audio', 'document', 'window', 'localStorage', 'sessionStorage']
    .map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of Object.entries(oldGlobals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const players = [];
  class FakeAudio extends Events {
    currentTime = 0;
    duration = NaN;
    paused = true;
    sourceChanges = 0;
    playCalls = 0;
    rejectPlay = false;
    constructor() { super(); players.push(this); }
    set src(value) {
      this.source = value;
      this.sourceChanges++;
      this.currentTime = 0;
      this.duration = NaN;
      this.paused = true;
      if (!delayedMetadata) this.loadMetadata();
    }
    get src() { return this.source; }
    loadMetadata() {
      this.duration = this.src.includes('victory') ? 3.448 : 180;
      this.emit('loadedmetadata');
    }
    play() {
      this.playCalls++;
      if (this.rejectPlay) return Promise.reject(new Error('NotAllowedError'));
      this.paused = false;
      return Promise.resolve();
    }
    pause() { this.paused = true; }
    finish() { this.paused = true; this.currentTime = this.duration; this.emit('ended'); }
  }
  const document = new Events();
  const window = new Events();
  const settings = new MemoryStorage();
  for (const [key, value] of Object.entries({
    Audio: FakeAudio, document, window, localStorage: settings, sessionStorage: session,
  })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const music = await import(`../js/battle-music.js?test=${++imports}`);
  return { music, players, document, window, settings, session };
}

test('長いBGMは町・施設・探索・戦闘を往復しても各曲の続きから再開する', async (t) => {
  const { music, players } = await setup(t);
  music.setSceneMusic('town');
  const player = players[0];
  assert.equal(player.preload, 'metadata');
  assert.match(player.src, /town-square\.mp3\?v=music-suite-1$/);
  player.currentTime = 37;
  music.setSceneMusic('facility');
  player.currentTime = 21;
  music.setSceneMusic('town');
  assert.equal(player.currentTime, 37);
  const changes = player.sourceChanges;
  music.setSceneMusic('town');
  assert.equal(player.sourceChanges, changes);
  assert.equal(player.currentTime, 37);
  music.setSceneMusic('dungeon');
  player.currentTime = 48;
  music.startBattleMusic();
  player.currentTime = 65;
  music.finishBattleMusic('win');
  assert.equal(player.loop, false);
  assert.equal(player.currentTime, 0);
  player.finish();
  assert.match(player.src, /dungeon-depths/);
  assert.equal(player.currentTime, 48);
  assert.equal(player.loop, true);
  music.startBattleMusic();
  assert.equal(player.currentTime, 65);
  assert.equal(players.length, 1, '音声要素を場面ごとに増やさない');
});

test('勝利演出中に町・施設へ移動すると、演出後にその場面へ戻り、次の勝利は先頭から鳴る', async (t) => {
  const { music, players } = await setup(t);
  music.setSceneMusic('facility');
  const player = players[0];
  player.currentTime = 25;
  music.startBattleMusic();
  music.finishBattleMusic('win');
  player.currentTime = 2;
  music.setSceneMusic('town');
  music.setSceneMusic('facility');
  assert.match(player.src, /victory/);
  player.finish();
  assert.match(player.src, /town-facility/);
  assert.equal(player.currentTime, 25);
  music.startBattleMusic();
  music.finishBattleMusic('win');
  assert.equal(player.currentTime, 0);
  assert.equal(player.loop, false);
  assert.equal(player.duration, 3.448);
  music.startBattleMusic();
  music.finishBattleMusic('lose');
  assert.match(player.src, /town-square/);
  assert.equal(player.loop, true);
});

test('BGMオフは勝利演出中でも停止し、再びオンにした場面の続きから復帰する', async (t) => {
  const { music, players, settings, document } = await setup(t);
  music.setSceneMusic('facility');
  const player = players[0];
  player.currentTime = 50;
  settings.setItem(settingsKey, JSON.stringify({ music: 'off' }));
  music.setSceneMusic('facility');
  assert.equal(player.paused, true);
  document.emit('click');
  assert.equal(player.paused, true);
  settings.setItem(settingsKey, JSON.stringify({ music: 'on' }));
  music.setSceneMusic('facility');
  assert.equal(player.currentTime, 50);
  assert.equal(player.paused, false);
  music.startBattleMusic();
  music.finishBattleMusic('win');
  settings.setItem(settingsKey, JSON.stringify({ music: 'off' }));
  music.setSceneMusic('facility');
  assert.equal(player.paused, true);
  settings.setItem(settingsKey, JSON.stringify({ music: 'on' }));
  music.setSceneMusic('facility');
  assert.match(player.src, /town-facility/);
  assert.equal(player.currentTime, 50);
  assert.equal(player.paused, false);
});

test('英語読み上げ中は場面変更・勝利演出でもミュートを保ち、終了時に戻す', async (t) => {
  const { music, players } = await setup(t);
  music.setSpeechPlaying(true);
  music.setSceneMusic('town');
  const player = players[0];
  assert.equal(player.muted, true);
  music.setSceneMusic('tavern');
  assert.equal(player.muted, true);
  music.startBattleMusic();
  music.finishBattleMusic('win');
  assert.equal(player.muted, true);
  player.finish();
  assert.equal(player.muted, true);
  music.setSpeechPlaying(false);
  assert.equal(player.muted, false);
});

test('ページ移動の再生位置はメタデータを待って復元し、読み込み中の再移動でも失わない', async (t) => {
  const session = new MemoryStorage();
  session.setItem(positionKey, JSON.stringify({ town: 134, dungeon: 42 }));
  const { music, players, window } = await setup(t, { session, delayedMetadata: true });
  music.setSceneMusic('town');
  const player = players[0];
  assert.equal(player.currentTime, 0);
  music.setSceneMusic('dungeon');
  player.loadMetadata();
  assert.equal(player.currentTime, 42);
  music.setSceneMusic('town');
  player.loadMetadata();
  assert.equal(player.currentTime, 134);
  player.currentTime = 147;
  window.emit('pagehide');
  assert.equal(player.paused, true);
  assert.equal(JSON.parse(session.getItem(positionKey)).town, 147);
  const nextPage = await import(`../js/battle-music.js?test=${++imports}`);
  nextPage.setSceneMusic('town');
  const nextPlayer = players[1];
  nextPlayer.loadMetadata();
  assert.equal(nextPlayer.currentTime, 147);
});

test('ブラウザの戻る操作は更新された位置を使い、自動再生拒否後も操作で再試行できる', async (t) => {
  const { music, players, window, document, session } = await setup(t);
  music.setSceneMusic('facility');
  const player = players[0];
  player.currentTime = 12;
  window.emit('pagehide');
  session.setItem(positionKey, JSON.stringify({ facility: 88 }));
  player.rejectPlay = true;
  window.emit('pageshow', { persisted: true });
  await Promise.resolve();
  assert.equal(player.currentTime, 88);
  assert.equal(player.paused, true);
  player.rejectPlay = false;
  document.emit('click');
  assert.equal(player.currentTime, 88);
  assert.equal(player.paused, false);
});

test('保存データ破損・保存禁止・Audio非対応でもゲームの呼び出しを妨げない', async (t) => {
  const session = new MemoryStorage();
  session.setItem(positionKey, JSON.stringify({ town: -8, tavern: '31', dungeon: 181, victory: 2 }));
  const { music, players } = await setup(t, { session });
  music.setSceneMusic('unknown');
  music.setSceneMusic('__proto__');
  assert.equal(players.length, 0);
  music.setSceneMusic('town');
  assert.equal(players[0].currentTime, 0);
  music.setSceneMusic('dungeon');
  assert.equal(players[0].currentTime, 1, '長さ以上の位置は曲の範囲に収める');
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get() { throw new Error('SecurityError'); } });
  const noStorage = await import(`../js/battle-music.js?test=${++imports}`);
  assert.doesNotThrow(() => noStorage.setSceneMusic('town'));
  players[1].currentTime = 9;
  assert.doesNotThrow(() => noStorage.setSceneMusic('facility'));
  noStorage.setSceneMusic('town');
  assert.equal(players[1].currentTime, 9);
  delete globalThis.Audio;
  const noAudio = await import(`../js/battle-music.js?test=${++imports}`);
  assert.doesNotThrow(() => noAudio.startBattleMusic());
  assert.doesNotThrow(() => noAudio.finishBattleMusic('win'));
});
