import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATUS_ICON_IDS, statusIconId, buffIconId, JOB_EFFECT_ICON } from '../js/ui/effect-icons.js';
import { allyEffectEntries, allyEffectSections } from '../js/ui/battle-view.js';
import { readCsv } from './helpers.js';

const statuses = readCsv('status_effects.csv').rows;
const data = { statusEffects: new Map(statuses.map(row => [row.id, row])), elements: new Map(),
  skills: new Map([['ward', { name: '守護の祈り' }]]) };

test('状態異常マスタ全20種に対応し、35個のPNG実体が32×32である', () => {
  assert.deepEqual([...STATUS_ICON_IDS].sort(), statuses.map(row => row.id).sort());
  const ids = [...STATUS_ICON_IDS, ...['str','mag','def','res','spd','crt','eva'].flatMap(stat => [`${stat}-up`, `${stat}-down`]), JOB_EFFECT_ICON];
  assert.equal(new Set(ids).size, 35);
  for (const id of ids) {
    const png = readFileSync(new URL(`../art/effects/${id}.png`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), 'PNG', id);
    assert.equal(png.readUInt32BE(16), 32, id);
    assert.equal(png.readUInt32BE(20), 32, id);
  }
  assert.equal(statusIconId('future-status'), null);
});

test('正負の強化弱体・down接頭辞・会心別名を正しいアイコンに対応させる', () => {
  for (const stat of ['str','mag','def','res','spd','crt','eva']) {
    assert.equal(buffIconId(stat, .2), `${stat}-up`);
    assert.equal(buffIconId(stat, -.2), `${stat}-down`);
    assert.equal(buffIconId(`down:${stat}`, .2), `${stat}-down`);
  }
  assert.equal(buffIconId('crit', .2), 'crt-up');
  assert.equal(buffIconId('atk', .2), 'str-up');
  assert.equal(buffIconId('barrier', 50), JOB_EFFECT_ICON);
});

test('キャラ詳細は残り時間・重複数・効果量を保持し、ジョブ継続効果も特殊効果も同じ1種を使う', () => {
  const game = { party: [{ name: '主人公', hp: 100 }, { name: '仲間', hp: 100 }] };
  const battle = { partyBuffs: { spd: [.1, 3] }, allies: [{
    statuses: { poison: { turns: 2, n: 3 }, weaken: { turns: 1 } },
    buffs: { str: [.2, 2], 'down:def': [.1, 3], barrier: [40, 2], mag: [.2, 0] },
    masterEffects: { ward: { remaining: 2, values: { def: .3 }, shield: 40 }, expired: { remaining: 0 } },
    anger: 2, normalSkillReady: true, masterCover: { target: 'all', remaining: 1 },
  }, { masterCover: { target: 'selected', targetIndex: 0, remaining: 2 } }] };
  const before = structuredClone({ game, battle });
  const sections = allyEffectEntries(data, game, battle, 0);
  assert.deepEqual(sections[0][1], [{ label: '毒 ×3（残り2）', icon: 'poison' }, { label: '魔力漏出（残り1）', icon: 'weaken' }]);
  assert.deepEqual(sections[1][1].map(e => e.icon), ['str-up', 'def-down', JOB_EFFECT_ICON]);
  assert.equal(sections[2][1][0].icon, 'spd-up');
  const job = sections.slice(3).flatMap(([, entries]) => entries);
  assert.ok(job.length >= 5);
  assert.ok(job.every(e => e.icon === JOB_EFFECT_ICON));
  assert.ok(job.some(e => e.label.includes('守護の祈り（残り2）') && e.label.includes('DEF +30%') && e.label.includes('防護 40 HP')));
  assert.ok(job.some(e => e.label.includes('怒気 2/3')));
  assert.deepEqual(allyEffectSections(data, game, battle, 0), sections.map(([title, entries]) => [title, entries.map(e => e.label)]));
  assert.deepEqual({ game, battle }, before);
});
