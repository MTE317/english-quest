import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { el, render } from '../js/dom.js';
import * as character from '../js/character.js';
import { equipmentIcon, armorIcon } from '../js/ui/equipment-icons.js';
import { uiIcon } from '../js/ui/pixel-icons.js';
import { describeFixedEffects } from '../js/equipment-effects.js';
import { realGameData } from './helpers.js';
import { equippedGame } from './combat-fixtures.js';

// ブラウザの表示関数を実行し、クリックによる画面と所持品の変化を確認する。
class TestNode {
  constructor(tag = '', text = '') { this.tag = tag; this.text = text; this.attrs = {}; this.children = []; this.events = {}; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  get id() { return this.getAttribute('id'); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  get hidden() { return 'hidden' in this.attrs; }
  set hidden(value) { if (value) this.attrs.hidden = ''; else delete this.attrs.hidden; }
  append(...nodes) { this.children.push(...nodes.map(n => n instanceof TestNode ? n : new TestNode('', String(n)))); }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  addEventListener(type, callback) { this.events[type] = callback; }
  click() { if (!('disabled' in this.attrs)) this.events.click?.({ currentTarget: this }); }
  get textContent() { return this.text + this.children.map(n => n.textContent).join(''); }
}
const all = (root, predicate) => [root, ...root.children.flatMap(child => all(child, () => true))].filter(predicate);
const hasClass = name => node => node.className.split(' ').includes(name);
const one = (root, predicate) => { const node = all(root, predicate)[0]; assert.ok(node, '対象の表示がある'); return node; };
const buttonText = text => node => node.tag === 'button' && node.textContent === text;

test('装備一覧を保って枠・倉庫アイコン・比較・変更・取り外しを同じ画面で操作できる', () => {
  const oldDocument = globalThis.document, oldNode = globalThis.Node;
  globalThis.Node = TestNode;
  globalThis.document = { createElement: tag => new TestNode(tag), createTextNode: text => new TestNode('', text) };
  try {
    const data = realGameData();
    const game = equippedGame(data, Array.from({ length: 6 }, (_, i) => ({ name: `仲間${i + 1}`, job: i === 1 ? 'knight' : 'warrior', icon: 'x' })));
    const member = game.party[0], current = member.equip.weapon;
    const candidate = character.makeGear(game, current.id, { enh: 2 });
    game.storage.gear = [candidate];
    const view = el('main');
    const window = { scrollY: 240, scrollTo(_x, y) { this.scrollY = y; } };
    const session = { game, inDungeon: false, update(fn) { fn(game); } };
    const source = readFileSync(new URL('../js/pages/party-page.js', import.meta.url), 'utf8');
    const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    const code = [
      section('function gearLabel(', 'function memberBanner('),
      section('function showMember(', 'function skillIcon('),
      section('function equipmentChanges(', '// ---------------- 動作確認用'),
    ].join('\n');
    const context = vm.createContext({
      ...character, el, render, equipmentIcon, armorIcon, uiIcon, describeFixedEffects,
      data, session, view, window, structuredClone,
      pct: value => String(value),
      memberNavigation: index => el('nav', {}, game.party[index].name),
    });
    vm.runInContext(code, context);
    context.showMember(0, 'equipment');
    const slots = one(view, hasClass('equipment-slots'));
    const weaponButton = slots.children[0].children[0];
    assert.equal(one(view, hasClass('equipment-picker')).hidden, true);
    window.scrollY = 240;
    weaponButton.click();
    assert.equal(one(view, hasClass('equipment-slots')), slots, '枠をクリックしても一覧を作り直さない');
    assert.equal(window.scrollY, 240, '選択時に先頭へ移動しない');
    const picker = one(view, hasClass('equipment-picker'));
    assert.equal(picker.hidden, false);
    assert.ok(one(picker, hasClass('equipment-current')).textContent.includes(data.equipment.get(current.id).name));
    const grid = one(picker, hasClass('storage-grid'));
    assert.ok(grid.children[0].className.includes('shop-slot'));
    assert.ok(all(grid, node => node.tag === 'img').length > 0, '倉庫と同じ装備アイコンを表示する');
    assert.equal(one(picker, hasClass('equipment-comparison')).hidden, true);
    const saveBeforePreview = JSON.stringify(game);
    grid.children[0].click();
    const comparison = one(picker, hasClass('equipment-comparison'));
    assert.equal(comparison.hidden, false);
    assert.ok(comparison.textContent.includes('現在：'));
    assert.ok(comparison.textContent.includes('→'));
    assert.equal(JSON.stringify(game), saveBeforePreview, '比較だけでは装備や倉庫を変更しない');
    one(comparison, buttonText('この装備に替える')).click();
    assert.equal(game.party[0].equip.weapon.uid, candidate.uid);
    assert.ok(game.storage.gear.some(gear => gear.uid === current.uid));
    assert.equal(one(view, hasClass('equipment-picker')).hidden, false, '変更後も枠を開いたままにする');
    assert.equal(window.scrollY, 240);
    one(view, buttonText('外して倉庫へ')).click();
    assert.equal(game.party[0].equip.weapon, null);
    assert.ok(one(view, hasClass('equipment-current')).textContent.includes('未装備'));
    // 倉庫に候補がない枠へ切り替え、古い比較を残さない。
    const slotButtons = one(view, hasClass('equipment-slots')).children.map(li => li.children[0]);
    slotButtons[character.SLOTS.indexOf('head')].click();
    assert.equal(one(view, hasClass('equipment-comparison')).hidden, true);
    assert.equal(one(view, hasClass('storage-grid')).children.length, 0);
    context.showMember(1, 'equipment');
    assert.equal(one(view, hasClass('equipment-picker')).hidden, true, '別の仲間へ候補選択を持ち越さない');
    session.inDungeon = true;
    context.showMember(0, 'equipment');
    one(view, hasClass('equipment-slots')).children[0].children[0].click();
    assert.equal(one(view, hasClass('equipment-picker')).hidden, true, '冒険中の装備変更禁止を維持する');
  } finally {
    globalThis.document = oldDocument; globalThis.Node = oldNode;
  }
});
