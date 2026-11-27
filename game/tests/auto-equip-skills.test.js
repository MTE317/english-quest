import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createNewGame } from '../js/game-state.js';
import { learnAndEquipSkill, jobSkills, capacity } from '../js/growth.js';
import { realGameData, MemoryStorage } from './helpers.js';
import { GameSession } from '../js/save.js';

const data = realGameData();
const fresh = () => createNewGame(data, ['warrior', 'knight', 'black_mage', 'white_mage', 'thief', 'bard']
  .map(job => ({ job, name: job, icon: 'x' })));

for (const [id, key] of [['warrior_A01', 'actions'], ['warrior_P02', 'passives'], ['warrior_U01', 'ultimate']]) {
  test(`${id}を習得すると対応する枠へ自動セットし、APを一度だけ消費する`, () => {
    const game = fresh(), member = game.party[0], skill = data.skills.get(id);
    member.ap = 10000;
    if (skill.isFinal) member.learned = jobSkills(data, 'warrior').filter(s => !s.isFinal).map(s => s.id);
    const peers = structuredClone(game.party.slice(1));
    const message = learnAndEquipSkill(data, member, id);
    assert.match(message, /自動でセットしました/);
    assert.ok(member.learned.includes(id));
    assert.equal(member.ap, 10000 - skill.apToLearn);
    assert.ok(key === 'ultimate' ? member.loadout[key] === id : member.loadout[key].includes(id));
    assert.deepEqual(game.party.slice(1), peers);
    const storage = new MemoryStorage();
    const session = new GameSession({ storage });
    session.startNew(game);
    const reloaded = new GameSession({ storage });
    // 保存されるゲームデータも、習得とセットの両方を保持する。
    assert.deepEqual(reloaded.game.party[0].loadout, member.loadout);
    assert.ok(reloaded.game.party[0].learned.includes(id));
    const before = structuredClone(member);
    assert.throws(() => learnAndEquipSkill(data, member, id), /覚えている/);
    assert.deepEqual(member, before);
  });
}

for (const [id, key] of [['warrior_A01', 'actions'], ['warrior_P02', 'passives']]) {
  test(`${key}容量不足は習得を維持し、既存セットを外さず理由を返す`, () => {
    const member = fresh().party[0], skill = data.skills.get(id);
    const existing = [...data.skills.values()].find(s => s.id !== id && !s.isFinal && (s.kind === 'passive') === (key === 'passives') && s.cost > 0);
    const fullData = { ...data, basicJobRules: { ...data.basicJobRules, capacity: { ...capacity(data, member), [key]: existing.cost } } };
    member.learned = [existing.id];
    member.loadout[key] = [existing.id];
    member.ap = 10000;
    const before = structuredClone(member.loadout);
    const message = learnAndEquipSkill(fullData, member, id);
    assert.match(message, /習得しました。自動セットできませんでした：枠が足りない/);
    assert.ok(member.learned.includes(id));
    assert.deepEqual(member.loadout, before);
    assert.equal(member.ap, 10000 - skill.apToLearn);
  });
}

test('奥義枠が埋まっている場合も習得し、既存奥義を維持して通知する', () => {
  const member = fresh().party[0];
  member.ap = 10000;
  member.learned = [...jobSkills(data, 'warrior').filter(s => !s.isFinal).map(s => s.id), 'knight_U01'];
  member.loadout.ultimate = 'knight_U01';
  assert.match(learnAndEquipSkill(data, member, 'warrior_U01'), /自動セットできませんでした：奥義は1つまで/);
  assert.ok(member.learned.includes('warrior_U01'));
  assert.equal(member.loadout.ultimate, 'knight_U01');
});

test('習得不可の場合はAP・習得・セットを変更しない', () => {
  const member = fresh().party[0];
  member.ap = 0;
  const before = structuredClone(member);
  assert.throws(() => learnAndEquipSkill(data, member, 'warrior_A01'), /AP/);
  assert.deepEqual(member, before);
});

test('習得処理の結果メッセージを更新後の画面へ渡す', () => {
  const source = readFileSync(new URL('../js/pages/party-page.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function updateSkill(fn)'), end = source.indexOf('  function selectSkill', start);
  const member = {}, messages = [];
  const context = vm.createContext({ session: { update: fn => fn({ party: [member] }) }, index: 0,
    job: 'warrior', selected: { id: 'warrior_A01' }, showSkills: (...args) => messages.push(args[3]) });
  vm.runInContext(source.slice(start, end), context);
  context.updateSkill(() => '容量不足でセットできませんでした');
  assert.equal(messages.pop(), '容量不足でセットできませんでした');
  context.updateSkill(() => '自動でセットしました');
  assert.equal(messages.pop(), '自動でセットしました');
});
