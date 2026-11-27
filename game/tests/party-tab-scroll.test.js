import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/pages/party-page.js', import.meta.url), 'utf8');
const start = source.indexOf('function switchMemberTab(');
const end = source.indexOf('function jobAptitudeChart(', start);
const allNodes = root => Array.isArray(root) ? root.flatMap(allNodes)
  : root && typeof root === 'object' ? [root, ...allNodes(root.children ?? [])] : [];

for (const active of ['skills', 'equipment', 'abilities']) {
  test(`${active}から各タブへ切り替えてもスクロール位置を保持する`, () => {
    const calls = [], focused = [];
    const window = { scrollX: 12, scrollY: 460, scrollTo: options => {
      assert.equal(options.behavior, 'instant');
      window.scrollX = options.left;
      window.scrollY = options.top;
    } };
    const context = vm.createContext({ window,
      el: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity) }),
      session: { game: { party: [{}] } }, showParty() {}, memberSwitcher: () => null, memberBanner: () => null,
      showMember: (index, tab, slot, options) => {
        calls.push({ index, tab, slot, scroll: options.scroll });
        // スキル画面内の先頭移動や描画中のスクロール変化も再現する。
        window.scrollX = 0; window.scrollY = 0;
      },
      view: { querySelector: selector => {
        assert.equal(selector, '.member-main-tabs [aria-pressed="true"]');
        return { focus: options => focused.push(options.preventScroll) };
      } },
    });
    vm.runInContext(source.slice(start, end), context);
    const nav = context.memberNavigation(0, active);
    const tabs = allNodes(nav).filter(n => n.tag === 'button' && ['スキル', '装備', '能力'].includes(n.children[0]));
    assert.equal(tabs.length, 3);
    for (const [i, tab] of ['skills', 'equipment', 'abilities'].entries()) {
      tabs[i].attrs.onclick();
      assert.equal(window.scrollX, 12);
      assert.equal(window.scrollY, 460);
      if (tab !== active) assert.deepEqual(calls.at(-1), { index: 0, tab, slot: null, scroll: false });
    }
    assert.equal(calls.length, 2, '選択中のタブは再描画しない');
    assert.deepEqual(focused, [true, true]);
  });
}

test('パーティー画面の入口モジュールは一度だけ読み込む', () => {
  const html = readFileSync(new URL('../party.html', import.meta.url), 'utf8');
  assert.equal((html.match(/src="js\/pages\/party-page\.js\?/g) ?? []).length, 1);
});

for (const skillMode of ['learn', 'set']) {
  for (const custom of [false, true]) {
    test(`スキル${skillMode}からの切り替えで位置を保持する（専用コールバック${custom ? 'あり' : 'なし'}）`, () => {
      const calls = [], focused = [];
      const window = { scrollX: 5, scrollY: 390, scrollTo: options => {
        assert.equal(options.behavior, 'instant');
        window.scrollX = options.left; window.scrollY = options.top;
      } };
      const show = mode => { calls.push(mode); window.scrollX = 0; window.scrollY = 0; };
      const context = vm.createContext({ window,
        el: (tag, attrs, ...children) => ({ tag, attrs, children: children.flat(Infinity) }),
        session: { game: { party: [{}] } }, showParty() {}, memberSwitcher: () => null, memberBanner: () => null,
        showSkills: index => { assert.equal(index, 0); show('learn'); },
        showLoadout: index => { assert.equal(index, 0); show('set'); },
        view: { querySelector: selector => {
          assert.equal(selector, '.member-skill-tabs [aria-pressed="true"]');
          return { focus: options => focused.push(options.preventScroll) };
        } },
      });
      vm.runInContext(source.slice(start, end), context);
      const options = custom ? { skillMode, onSkillLearn: () => show('custom-learn'), onSkillSet: () => show('custom-set') } : { skillMode };
      const nav = context.memberNavigation(0, 'skills', undefined, options);
      const tabs = allNodes(nav).filter(n => n.tag === 'button' && ['習得', 'セット'].includes(n.children[0]));
      assert.equal(tabs.length, 2);
      const current = tabs[skillMode === 'learn' ? 0 : 1];
      current.attrs.onclick();
      assert.deepEqual(calls, [], '選択中のタブは再描画しない');
      const other = tabs[skillMode === 'learn' ? 1 : 0];
      other.attrs.onclick();
      assert.deepEqual(calls, [(custom ? 'custom-' : '') + (skillMode === 'learn' ? 'set' : 'learn')]);
      assert.equal(window.scrollX, 5);
      assert.equal(window.scrollY, 390);
      assert.deepEqual(focused, [true]);
    });
  }
}
