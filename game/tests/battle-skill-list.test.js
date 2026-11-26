import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { el } from '../js/dom.js';
import { effectiveSkill, skillMaxLevel, learnedSkillLevel } from '../js/growth.js';
import { describeSkillForUI } from '../js/skill-effects.js';

class TestNode {
  constructor(tag, text = '') { this.tag = tag; this.text = text; this.attrs = {}; this.children = []; this.events = {}; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  addEventListener(type, callback) { this.events[type] = callback; }
  append(child) { this.children.push(child); }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
}
test('戦闘スキル一覧に技名・習得Lvの簡易説明・消費MPと使用不可理由を表示する', () => {
  const oldDocument = globalThis.document, oldNode = globalThis.Node;
  globalThis.Node = TestNode;
  globalThis.document = { createElement: tag => new TestNode(tag), createTextNode: text => new TestNode('', String(text)) };
  try {
    const first = { id: 'warrior_A01', name: '剛断ち', mp: 3, effect: {} };
    const second = { id: 'warrior_A02', name: '旋風斬', mp: 6, effect: { levels: [{ mp: 6, effect: {} }, { mp: 6, effect: {} }] } };
    const ultimate = { id: 'warrior_U01', name: '天裂き', mp: 12, isFinal: true, effect: {} };
    const member = { name: 'A', mp: 3, learned: [first.id, second.id], skillLevels: { [second.id]: 2 } };
    const entries = [{ skill: first, reason: '' }, { skill: second, reason: 'MPが足りない' }];
    const opts = { skills: entries, ultimate: { skill: ultimate, reason: 'EXが足りない', gauge: 20, max: 100 },
      items: [{ item: { id: 'potion', name: '回復薬', description: 'HPを回復する。' }, count: 2, reason: '' }] };
    let panel;
    const source = readFileSync(new URL('../js/ui/battle-view.js', import.meta.url), 'utf8');
    const start = source.indexOf('  function showCommand('), end = source.indexOf('  function chooseSkill(', start);
    const context = vm.createContext({
      el, effectiveSkill, skillMaxLevel, learnedSkillLevel, describeSkillForUI,
      data: { skills: new Map([first, second, ultimate].map(skill => [skill.id, skill])) },
      g: { party: [member] }, b: { turn: { i: 0 } }, actionOptions: () => opts,
      drawField() {}, battleMp: skill => skill.mp, chooseTarget() {}, chooseSkill() {},
      showPanel: (title, contents) => { panel = { title, contents }; },
    });
    vm.runInContext(source.slice(start, end), context);
    context.showCommand('skill');
    const choices = panel.contents.find(node => node?.className === 'battle-action-list').children;
    assert.equal(choices[0].children[0].textContent, '剛断ち');
    assert.equal(choices[0].children[1].textContent, '消費MP 3');
    assert.equal(choices[0].children[2].textContent, '敵1体に強力な武器攻撃。');
    assert.equal(choices[1].children[0].textContent, '旋風斬 Lv2');
    assert.equal(choices[1].children[2].textContent, '敵3体までに武器攻撃。 ／ MPが足りない');
    assert.ok('disabled' in choices[1].attrs);
    assert.match(choices[2].children[1].textContent, /EX 20\/100・消費MP 12/);
    context.showCommand('item');
    const items = panel.contents.find(node => node?.className === 'battle-action-list').children;
    assert.equal(items[0].children[1].textContent, '×2');
    assert.equal(items[0].children[2].textContent, 'HPを回復する。');
  } finally { globalThis.document = oldDocument; globalThis.Node = oldNode; }
});
