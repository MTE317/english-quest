import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockFootsteps, playDungeonFootstep } from '../js/dungeon-footsteps.js';

test('足音を合成し、効果音オフでは再生せずBGM設定には左右されない', async t => {
  const keys = ['AudioContext', 'localStorage'];
  const saved = keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  t.after(() => saved.forEach(([key, descriptor]) => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }));
  let settings = { effects: 'off' };
  let created = 0;
  let played = 0;
  let samples;
  class AudioContext {
    state = 'running';
    sampleRate = 44100;
    constructor() { created++; }
    createBuffer(channels, length) {
      samples = new Float32Array(length);
      return { getChannelData: () => samples };
    }
    createBufferSource() { return { connect() {}, start() { played++; } }; }
  }
  Object.assign(globalThis, { AudioContext, localStorage: { getItem: () => JSON.stringify(settings) } });
  unlockFootsteps();
  await playDungeonFootstep();
  assert.equal(created, 0);
  settings = { effects: 'on', music: 'off' };
  unlockFootsteps();
  for (let i = 0; i < 3; i++) await playDungeonFootstep();
  assert.equal(played, 3);
  assert.equal(created, 1);
  assert.ok(samples.every(Number.isFinite));
  assert.ok(samples.some(value => value !== 0));
  settings.effects = 'off';
  await playDungeonFootstep();
  assert.equal(played, 3);
});
