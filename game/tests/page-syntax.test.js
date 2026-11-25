import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('ページの入口JSは構文解析できる（記録ページのcatalog重複宣言の回帰）', () => {
  const dir = new URL('../js/pages/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', fileURLToPath(new URL(file, dir))], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${file}\n${result.stderr}`);
  }
});

test('全ブラウザJSのimport/exportと循環依存を実行前にリンクできる', () => {
  const script = fileURLToPath(new URL('../../scripts/check-game-modules.cjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
