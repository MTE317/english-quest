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
      const { createBattleView } = await import(root + 'ui/battle-view.js?v=battle-compact-1');
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
        await page.evaluate(list => window.spriteFixture('mossy_cave', list), ids.slice(0, count));
        const enemies = page.locator('.battle-enemies .battle-enemy');
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
        if (process.env.SCREENSHOT_DIR) {
          await page.screenshot({ path: process.env.SCREENSHOT_DIR + '/compact-' + width + '-' + count + '.png', fullPage: true });
        }
        const correct = await page.evaluate(() => window.spritePilotSession.run.battle.pending.question.answerIndex);
        await page.locator('.battle-answers button').nth(correct).tap();
        assert.ok(await page.locator('.battle-result.good').isVisible());
        assert.equal(await page.evaluate(() => window.spritePilotSession.run.battle.pending), null);
        assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).sort()), before);
      }
    }
    await page.evaluate(() => document.querySelector('.battle-screen').remove());
    assert.ok(await page.locator('.bar .back').isVisible()); // 非戦闘で復帰
    assert.deepEqual(spriteRequests, []);
    assert.deepEqual(errors, []);
    console.log('PASS 320/390px x 3/8: icons/party unchanged, enemy detail, combat-only back hiding, fixed 3 logs, full history, target/question preserved, answer and storage.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
