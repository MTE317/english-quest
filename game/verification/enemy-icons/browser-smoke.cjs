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
    await page.evaluate(async () => {
      const root = '/game/js/';
      const { createBattleView } = await import(root + 'ui/battle-view.js?v=enemy-icons-2');
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
        createBattleView({ view: document.getElementById('view'), data, lex,
          scheduler: new Scheduler(), store: new LearningStore(memory()), session, onEnd: () => {} }).start();
      };
    });
    const ids = ['slime', 'exp_mossy_cave_7', 'goblin_boss', 'goblin', 'cave_rat', 'cave_bat', 'slime', 'goblin'];
    const mount = (dungeonId, enemies = ids) => page.evaluate(([id, list]) => window.spriteFixture(id, list), [dungeonId, enemies]);
    await mount('mossy_cave');
    const enemies = page.locator('.battle-enemies .battle-enemy');
    assert.equal(await enemies.count(), 8);
    const images = page.locator('.battle-enemies .battle-enemy-sprite');
    assert.equal(await images.count(), 0);
    const expected = await page.evaluate(() => window.spritePilotSession.run.battle.enemies.map(e => e.icon));
    assert.deepEqual(await enemies.locator('.battle-enemy-icon').allTextContents(), expected);
    assert.match(await enemies.nth(3).locator('.battle-enemy-icon').textContent(), /👺/);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await enemies.evaluateAll(x => x.map(el => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.top), r.left, r.right, r.width, r.height];
      }));
      assert.ok(layout.every(([, left, right, w, h]) => left >= 0 && right <= width && w >= 44 && h >= 44));

    }
    if (process.env.SPRITE_SCREENSHOT) await page.screenshot({ path: process.env.SPRITE_SCREENSHOT });
    for (const index of [0, 1, 2]) {
      await enemies.nth(index).tap();
      const info = page.locator('.battle-encyclopedia[open]');
      assert.equal(await info.getByText('判明した弱点', { exact: true }).count(), 1);
      assert.equal(await info.locator('.battle-resource.hp').count(), 1);
      assert.equal(await info.locator('img').count(), 0);
      assert.equal(await info.locator('.battle-enemy-icon').textContent(), expected[index]);
      await info.getByRole('button', { name: '閉じる' }).tap();
    }
    await page.getByRole('button', { name: '通常攻撃', exact: true }).tap();
    await enemies.nth(1).tap();
    assert.equal(await page.evaluate(() => window.spritePilotSession.run.battle.pending.action.target), 1);
    await mount('blooming_hill', ['slime', 'goblin_boss', 'cave_rat']);
    assert.equal(await images.count(), 0);

    await mount('mossy_cave', ['goblin_boss']);
    await page.waitForFunction(() => !document.querySelector('.battle-enemy-sprite'));
    assert.match(await enemies.first().locator('.battle-enemy-icon').textContent(), /👹/);
    assert.deepEqual(spriteRequests, []);
    assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).sort()), before);
    assert.deepEqual(errors, []);
    console.log('Enemy icons: 320/390px, all 3 reverted species, inspect/HP/weakness/targeting and outside-cave passed.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
