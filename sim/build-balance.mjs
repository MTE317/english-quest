/** 36ビルドを、完成の目安となる進度と★12で比較する。勝率を決め打ちする補正は行わない。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';
import { BUILD_CATALOG } from './party-fixtures.mjs';
import { loadData, evaluateScenario, sourceFingerprint } from './balance.mjs';

export async function compareBuilds({ runs = 24, seed = 927141, workers = 2, onProgress = () => {} } = {}) {
  if (!Number.isInteger(runs) || runs < 1 || !Number.isInteger(workers) || workers < 1 || workers > 8) {
    throw new Error('runs は正の整数、workers は1〜8の整数で指定する。');
  }
  const sourceSha256Start = sourceFingerprint();
  const data = loadData();
  const jobs = BUILD_CATALOG.builds.flatMap(build => [...new Set([build.minStar, 12])].flatMap(star => {
    const dungeon = [...data.dungeons.values()].find(d => d.rank === star && d.kind === '標準');
    if (!dungeon) throw new Error(`標準ダンジョンがない: ★${star}`);
    return ['standard', 'prepared'].map(preparation => ({ dungeonId: dungeon.id, runs,
      options: { profile: build.id, preparation, accuracy: .8, season: 'spring', seed } }));
  }));
  const scenarios = Array(jobs.length);
  let next = 0;
  let completed = 0;
  async function runQueue() {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      const result = workers === 1 ? evaluateScenario(data, job.dungeonId, job.options, runs)
        : await new Promise((resolve, reject) => {
          const worker = new Worker(new URL('./balance-worker.mjs', import.meta.url), { workerData: job });
          worker.once('message', resolve);
          worker.once('error', reject);
          worker.once('exit', code => { if (code) reject(new Error(`worker exit ${code}`)); });
        });
      scenarios[index] = result;
      completed++;
      onProgress({ completed, total: jobs.length, profile: result.profile, star: result.star,
        preparation: result.preparation, wins: result.wins, runs: result.runs, clearQuestions: result.clearQuestions });
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, runQueue));
  const sourceSha256 = sourceFingerprint();
  return {
    schema: 1, engine: 'game/js/battle.js', sourceSha256Start, sourceSha256,
    sourceUnchangedAtCompletion: sourceSha256Start === sourceSha256,
    harnessSha256: createHash('sha256').update(readFileSync(new URL('./build-balance.mjs', import.meta.url))).digest('hex'),
    assumptions: {
      purpose: '新36案の探索比較。少数試行の順位は強さの確定評価ではない。',
      party: '主役1名と補助3名。比較は同じジョブ・通常装備素体・品質・強化・Lv。',
      preparation: 'preparedは核技能・持出し・付与・耐性を用意する。standardは同素材等級の通常制作。AP・JP・制作費は追加投資として各fixtureに記録し、同じ総予算とは扱わない。',
      progression: 'minStarは比較の技能進度。実際の技能習得に★制限を追加していない。',
      answers: '正答率80%、春、既知の敵相性を使う固定方策。未来乱数は参照しない。',
      policy: '新効果・通常武器特性・MP移譲・予告への障壁・睡眠凍結を残す補助行動を使う近似方策。最適な人間操作ではない。',
      resources: '有限の道具、遠征中のHP/MP持越し、自然発生の賞金首・エリートを含む。',
      timing: '問題数×6秒+30秒。実際のブラウザーで遊んだ時間の実測ではない。',
    },
    scenarios,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
  const result = await compareBuilds({ runs: Number(value('--runs', 24)), seed: Number(value('--seed', 927141)),
    workers: Number(value('--workers', 2)), onProgress: row => console.log(JSON.stringify(row)) });
  const output = value('--output', 'sim/results/build36-comparison.json');
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  if (!result.sourceUnchangedAtCompletion) throw new Error('実行中に入力が変わった。確定結果として使わず再計測する。');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
