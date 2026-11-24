const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8767';
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const spriteRequests = [];
    page.on('request', request => {
      if (request.url().includes('/art/monsters/')) spriteRequests.push(request.url());
    });
    await page.goto(base + '/game/dungeon.html');
    const before = await page.evaluate(() => Object.entries(localStorage).sort());
    assert.ok(await page.locator('.bar .back').isVisible());
    await page.evaluate(async () => {
      const root = '/game/js/';
      const { createBattleView } = await import(root + 'ui/battle-view.js?v=battle-field-1');
      const { makeEnemy, createBattle } = await import(root + 'battle.js');
      const { createNewGame } = await import(root + 'game-state.js');
      const { loadGameData } = await import(root + 'gamedata.js');
      const { loadLearningCatalog } = await import(root + 'learning-catalog.js');
      const { Scheduler } = await import(root + 'srs.js');
      const { LearningStore } = await import(root + 'storage.js');
      const { GameSession } = await import(root + 'save.js');
      const memory = () => {
        const map = new Map();
        return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) };
      };
      const data = await loadGameData();
      const { lexicon: lex } = await loadLearningCatalog();
      const names = ['warrior', 'knight', 'white_mage', 'black_mage', 'hunter', 'bard'];
      window.spriteFixture = function mount(dungeonId, ids) {
        const session = new GameSession({ storage: memory() });
        session.startNew(createNewGame(data, names.map(job => ({ job, name: job, icon: 'human_01' }))));
        session.enterDungeon({ dungeonId, stoneId: lex.stones[0].id, floor: 1, state: 'battle' });
        const enemies = ids.map(id => makeEnemy(data, id, { lv: 1, dungeonId, boss: id === 'goblin_boss' }));
        const battle = createBattle(data, session.game, { enemies, seed: 731 });
        battle.round = 1;
        battle.turn = { side: 'ally', i: 0 };
        battle.queue = [];
        session.setBattle(battle);
        window.spritePilotSession = session;
        const options = { view: document.getElementById('view'), data, lex,
          scheduler: new Scheduler(), store: new LearningStore(memory()), session, onEnd: () => {} };
        window.compactRedraw = () => createBattleView(options).start();
        window.compactRedraw();
      };
    });

    const ids = ['slime', 'exp_mossy_cave_7', 'goblin_boss', 'goblin', 'cave_rat', 'cave_bat', 'slime', 'goblin'];
    const snapshot = () => page.evaluate(() => JSON.stringify(window.spritePilotSession.run.battle));
    const openClose = async () => {
      const beforeBattle = await snapshot();
      await page.getByRole('button', { name: '戦闘ログの履歴を開く', exact: true }).tap();
      assert.ok(await page.locator('.battle-log-dialog[open]').isVisible());
      await page.locator('.battle-log-dialog').getByRole('button', { name: '閉じる', exact: true }).tap();
      assert.equal(await snapshot(), beforeBattle);
    };
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const count of [3, 8]) {
        await page.evaluate(list => window.spriteFixture('sunlit_forest', list), ids.slice(0, count));
        const enemies = page.locator('.battle-enemies .battle-enemy');
        assert.equal(await page.locator('.page-heading').isVisible(), false);
        assert.equal(await page.locator('.battle-turn').count(), 0);
        assert.deepEqual(await page.locator('.battle-screen').evaluate(el => [...el.children].slice(0, 5).map(child => child.className)),
          ['battle-stage', 'battle-log', 'battle-controls', 'battle-party-toggle', 'battle-party']);
        assert.ok(await page.locator('.battle-log').evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 14));
        assert.ok(await page.locator('.battle-stage').evaluate(el => getComputedStyle(el).backgroundImage.includes('url(')));
        assert.ok(await enemies.evaluateAll(cards => cards.every(card => getComputedStyle(card).backgroundColor === 'rgba(0, 0, 0, 0)')));
        await page.evaluate(() => {
          window.spritePilotSession.run.label = '木漏れ日の森の奥に続くとても長いダンジョンの名前';
          window.compactRedraw();
        });
        assert.ok(await page.locator('.battle-stage').evaluate(stage => {
          const name = stage.querySelector('.battle-location').getBoundingClientRect();
          const enemies = stage.querySelector('.battle-enemies').getBoundingClientRect();
          return name.bottom <= enemies.top && name.left >= 0 && name.right <= innerWidth;
        }));
        assert.equal(await enemies.count(), count);
        assert.equal(await page.locator('.battle-party .battle-ally').count(), 6);
        assert.equal(await page.locator('.bar .back').isVisible(), false);
        assert.equal(await enemies.locator('.battle-unit-name:visible, .battle-resource-value:visible, .battle-known-weak:visible, .battle-inspect:visible').count(), 0);
        assert.equal(await enemies.locator('.battle-resource.hp .battle-meter:visible').count(), count);
        assert.equal(await page.locator('.battle-party .battle-resource-value:visible').count(), 12);
        assert.ok(await enemies.evaluateAll(cards => cards.every(card => {
          const r = card.getBoundingClientRect();
          return r.width >= 44 && r.height >= 44 && r.left >= 0 && r.right <= innerWidth;
        })));
        assert.ok(await enemies.nth(2).locator('.battle-enemy-marks').isVisible());
        assert.match(await enemies.nth(2).getAttribute('aria-label'), /ボス/);
        await page.evaluate(() => {
          const enemy = window.spritePilotSession.run.battle.enemies[0];
          enemy.mp = 0;
          enemy.eliteId = 'synthetic-display-only';
          window.compactRedraw();
        });
        assert.ok(await enemies.first().locator('.battle-enemy-marks').isVisible());
        assert.match(await enemies.first().getAttribute('aria-label'), /エリート/);
        const initial = await snapshot();
        await enemies.first().tap();
        const info = page.locator('.battle-encyclopedia:not(.battle-log-dialog)[open]');
        assert.equal(await info.locator('h3').textContent(), 'スライム');
        assert.ok(await info.locator('.battle-resource-value').first().isVisible());
        assert.equal(await info.locator('dd').first().textContent(), '未判明');
        const maxMp = await page.evaluate(() => window.spritePilotSession.run.battle.enemies[0].maxMp);
        assert.equal(await info.locator('.battle-resource.mp .battle-resource-value').textContent(), '0/' + maxMp);
        assert.equal(await snapshot(), initial);
        await info.getByRole('button', { name: '閉じる', exact: true }).tap();
        await openClose(); // コマンド段階
        await page.getByRole('button', { name: '通常攻撃', exact: true }).tap();
        await openClose(); // 対象選択中
        assert.equal(await enemies.filter({ has: page.locator('.battle-enemy-icon') }).count(), count);
        assert.ok(await enemies.nth(1).evaluate(card => card.classList.contains('targetable')));
        await enemies.nth(1).tap();
        assert.equal(await page.locator('.battle-answers button').count(), 4);
        assert.equal(await page.evaluate(() => window.spritePilotSession.run.battle.pending.action.target), 1);
        await openClose(); // 問題・選択対象を保持
        const questionsBefore = await page.locator('.battle-answers').textContent();
        const position = () => page.locator('.battle-answers').evaluate(el => el.getBoundingClientRect().top + scrollY);
        const questionTop = await position();
        for (const lines of [[], ['短いログ'], ['開幕の長文'.repeat(100)], Array.from({ length: 40 }, (_, i) => i + ' 長文イベント'.repeat(25) + '\n追加行')]) {
          await page.evaluate(lines => {
            window.spritePilotSession.run.battle.log = lines;
            window.compactRedraw();
          }, lines);
          assert.equal(await page.locator('.battle-answers').textContent(), questionsBefore);
          assert.ok(Math.abs(await position() - questionTop) < 1);
          assert.deepEqual(await page.locator('.battle-log-line').allTextContents(), lines.slice(-3));
          assert.ok(await page.locator('.battle-log').isVisible());
          await page.getByRole('button', { name: '戦闘ログの履歴を開く', exact: true }).tap();
          assert.deepEqual(await page.locator('.battle-history li').allTextContents(), lines);
          await page.locator('.battle-log-dialog').getByRole('button', { name: '閉じる', exact: true }).tap();
          assert.ok(Math.abs(await position() - questionTop) < 1);
        }
        await page.evaluate(() => {
          window.spritePilotSession.run.label = '木漏れ日の森';
          window.compactRedraw();
        });
        if (process.env.SCREENSHOT_DIR) {
          await page.screenshot({ path: process.env.SCREENSHOT_DIR + '/field-' + width + '-' + count + '.png', fullPage: true });
        }
        const correct = await page.evaluate(() => window.spritePilotSession.run.battle.pending.question.answerIndex);
        await page.locator('.battle-answers button').nth(correct).tap();
        assert.ok(await page.locator('.battle-result.good').isVisible());
        assert.equal(await page.evaluate(() => window.spritePilotSession.run.battle.pending), null);
        assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).sort()), before);
      }
    }

    // 味方を一番下へ移しても回復・蘇生対象は実操作で選べる。
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const itemId of ['potion', 'revive_salts']) {
        await page.evaluate(list => window.spriteFixture('mossy_cave', list), ids);
        await page.evaluate(id => {
          const session = window.spritePilotSession;
          session.game.items[id] = 2;
          session.game.party[2].hp = id === 'potion' ? 1 : 0;
          if (id === 'revive_salts') session.game.party[3].hp = 0;
          window.compactRedraw();
        }, itemId);
        await page.getByRole('button', { name: 'アイテム', exact: true }).tap();
        await page.locator('.battle-list-choice').filter({ hasText: itemId === 'potion' ? '回復薬' : '気付け薬' }).first().tap();
        const target = page.locator('.battle-party .battle-ally').nth(2);
        assert.ok(await target.evaluate(el => el.classList.contains('targetable')));
        await openClose();
        await target.tap();
        assert.equal(await page.evaluate(() => window.spritePilotSession.run.battle.pending.action.target), 2);
        const correct = await page.evaluate(() => window.spritePilotSession.run.battle.pending.question.answerIndex);
        await page.locator('.battle-answers button').nth(correct).tap();
        assert.ok(await page.evaluate(() => window.spritePilotSession.game.party[2].hp > 1));
        assert.equal(await page.evaluate(id => window.spritePilotSession.game.items[id], itemId), 1);
      }
    }
    // 共通ビューの闘技場は階ではなく対戦番号を表示。
    await page.evaluate(() => {
      const run = window.spritePilotSession.run;
      run.challenge = 'arena'; run.label = '闘技場 テスト階級'; run.battlesDone = 2;
      window.compactRedraw();
    });
    assert.equal(await page.locator('.battle-location h2').textContent(), '闘技場 テスト階級');
    assert.equal(await page.locator('.battle-floor').textContent(), '3戦目');
    assert.ok(await page.locator('.battle-screen').evaluate(el => el.classList.contains('scene-arena')));
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).sort()), before);
    await page.evaluate(() => document.querySelector('.battle-screen').remove());
    assert.ok(await page.locator('.bar .back').isVisible()); // 非戦闘で復帰
    assert.deepEqual(spriteRequests, []);
    assert.deepEqual(errors, []);
    console.log('PASS 320/390px x 3/8: field label/background, transparent cards, DOM order, 3 logs/history, target/quiz, heal/revive, arena, noncombat header, storage.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
