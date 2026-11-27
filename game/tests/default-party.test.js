import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/^\uFEFF/, '');
const balance = JSON.parse(read('../../data/balance.json'));
const icons = read('../../data/appearance_icons.csv').trim().split(/\r?\n/).slice(1).map(line => ({ id: line.split(',')[0] }));
const source = read('../js/game-state.js');
const start = source.indexOf('export function defaultPartySpecs(');
const context = vm.createContext({});
vm.runInContext('const PARTY_SIZE = 6;\n' + source.slice(start, source.indexOf('/**', start)).replace('export function', 'function'), context);
const data = () => ({ balance: structuredClone(balance), icons: structuredClone(icons),
  jobs: ['warrior', 'knight', 'white_mage', 'thief', 'hunter', 'black_mage', 'monk', 'bard'].map(id => ({ id, tier: 'base' })) });
const expected = [
  { name: 'アルス', job: 'warrior', icon: 'human_01' },
  { name: 'ミーナ', job: 'knight', icon: 'human_02' },
  { name: 'セシリア', job: 'white_mage', icon: 'human_04' },
  { name: 'バルト', job: 'thief', icon: 'human_07' },
  { name: 'エルシア', job: 'hunter', icon: 'human_06' },
  { name: 'オーウェン', job: 'black_mage', icon: 'human_03' },
];

test('新規作成の初期6人は指定された名前・職業・顔画像と並び順になる', () => {
  const specs = JSON.parse(JSON.stringify(context.defaultPartySpecs(data())));
  assert.deepEqual(specs, expected);
  for (const member of specs) assert.ok(icons.some(icon => icon.id === member.icon), member.icon);
});

test('作成画面で名前やジョブを編集してもデフォルト設定を変更しない', () => {
  const original = data(), before = structuredClone(original);
  const specs = context.defaultPartySpecs(original);
  specs[0].name = '変更'; specs[0].job = 'hunter'; specs[0].icon = 'human_03';
  assert.deepEqual(original, before);
  assert.deepEqual(JSON.parse(JSON.stringify(context.defaultPartySpecs(original))), expected);
});

test('名前・顔画像の追加設定がないデータでも同じ初期名・顔を使える', () => {
  const legacy = data();
  delete legacy.balance.new_game.party_names;
  delete legacy.balance.new_game.party_icons;
  assert.deepEqual(JSON.parse(JSON.stringify(context.defaultPartySpecs(legacy))), expected);
});
