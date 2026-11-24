const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8767';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    for (const width of [320, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(base + '/game/debug.html');
      const before = await page.evaluate(() => {
        localStorage.setItem('englishQuest.save.v2', JSON.stringify({ version: 1, game: { gold: 8675309, party: [] } }));
        localStorage.setItem('englishQuest.learning.v2', 'canary');
        return Object.entries(localStorage).sort();
      });
      for (const count of [5, 8]) {
        await page.getByRole('link', { name: `敵${count}体を表示`, exact: true }).tap();
        const enemies = page.locator('.battle-enemies .battle-enemy');
        await enemies.last().waitFor();
        assert.equal(await enemies.count(), count);
        for (const [name, path] of [['ラットル', 'rattle.png'], ['花粉ムシ', 'pollen-bug.png']]) {
          const enemy = enemies.filter({ hasText: name }).first();
          const sprite = enemy.locator('img');
          assert.ok((await sprite.getAttribute('src')).endsWith(path));
          await sprite.evaluate(img => img.decode());
          await enemy.tap();
          assert.ok(await page.locator('.battle-encyclopedia[open]').getByText('判明した弱点').isVisible());
          await page.locator('.battle-encyclopedia[open]').getByRole('button', { name: '閉じる' }).tap();
        }
        assert.ok(await enemies.evaluateAll(cards => cards.every(card => {
          const box = card.getBoundingClientRect(); return box.width >= 44 && box.left >= 0 && box.right <= innerWidth;
        })));
        assert.ok(await page.locator('.battle-enemy .battle-resource-value').evaluateAll(values => values.every(el => el.scrollWidth <= el.clientWidth + 1)));
        if (process.env.SPRITE_SCREENSHOT_DIR) {
          await page.screenshot({ path: `${process.env.SPRITE_SCREENSHOT_DIR}/mossy-${width}-${count}.png` });
        }
        await page.getByRole('button', { name: '通常攻撃', exact: true }).tap();
        await enemies.first().tap();
        await page.locator('.battle-answers button').first().tap();
        assert.deepEqual(await page.evaluate(() => Object.entries(localStorage).sort()), before);
        await page.getByRole('link', { name: '← 開発用メニューへ', exact: true }).tap();
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('デバッグ実画面: 5体/8体、320/390px、春の画像、図鑑、出題回答と実ストレージ非変更');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
