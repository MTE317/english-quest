// 実行せずに全ブラウザJSを構文解析・リンクし、import/exportの不整合を検出する。
// node --experimental-vm-modules --no-warnings scripts/check-game-modules.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../game/js');
const modules = new Map();
function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(file);
    else if (file.endsWith('.js')) modules.set(file, new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { identifier: file }));
  }
}
(async () => {
  collect(root);
  for (const module of modules.values()) {
    if (module.status !== 'unlinked') continue;
    await module.link((specifier, parent) => {
      const file = path.resolve(path.dirname(parent.identifier), specifier.split(/[?#]/)[0]);
      const dependency = modules.get(file);
      if (!dependency) throw new Error(`モジュールがない：${parent.identifier} → ${specifier}`);
      return dependency;
    });
  }
  console.log(`${modules.size} browser modules linked successfully`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
