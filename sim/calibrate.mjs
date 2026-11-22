/** 数値校正用の小標本探索。実データは書き換えず、候補パッチと全評価履歴を出す。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { loadData, prepareParty, runExpedition } from './balance.mjs';

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const rounded = (value) => Math.round(value * 1000) / 1000;
const FIELDS = ['hp_rank_mul', 'atk_rank_mul', 'hp_boss_rank_mul', 'atk_boss_rank_mul'];

function coefficients(data, star) {
  return Object.fromEntries(FIELDS.map((field) => [field, data.balance.enemy[field]?.[star] ?? 1]));
}

function applyCoefficients(data, star, values) {
  for (const field of FIELDS) {
    data.balance.enemy[field] ??= {};
    data.balance.enemy[field][star] = rounded(values[field]);
  }
}

function wilson95(wins, total) {
  if (!total) return null;
  const z = 1.96, p = wins / total, denominator = 1 + z * z / total;
  const midpoint = (p + z * z / (2 * total)) / denominator;
  const half = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return [Math.max(0, midpoint - half), Math.min(1, midpoint + half)];
}

/** 敗戦の問題数を捨てず、通常戦と最終ボスを別に集計する。 */
export function measure(data, dungeonId, { runs = 24, seed = 190001, preparation = 'standard', accuracy = .8 } = {}) {
  const samples = Array.from({ length: runs }, (_, index) => runExpedition(data, dungeonId, {
    seed: (seed + index * 7919) >>> 0, accuracy, profile: 'balanced', preparation,
    season: 'spring', elites: true, bounties: false,
  }));
  const battles = samples.flatMap((sample) => sample.battles);
  const normal = battles.filter((battle) => !battle.boss && !battle.bounty);
  const boss = battles.filter((battle) => battle.boss);
  const wins = samples.filter((sample) => sample.win);
  const normalWins = normal.filter((battle) => battle.win), bossWins = boss.filter((battle) => battle.win);
  return {
    runs, seed, preparation, accuracy, wins: wins.length, clearRate: wins.length / runs,
    clearRateWilson95: wilson95(wins.length, runs),
    normalBattles: normal.length, normalWins: normalWins.length,
    normalWinRate: normal.length ? normalWins.length / normal.length : 0,
    normalQuestions: mean(normalWins.map((battle) => battle.questions)),
    normalQuestionsAll: mean(normal.map((battle) => battle.questions)),
    normalLossQuestions: mean(normal.filter((battle) => !battle.win).map((battle) => battle.questions)),
    bossBattles: boss.length, bossWins: bossWins.length,
    bossWinRate: boss.length ? bossWins.length / boss.length : 0,
    bossQuestions: mean(bossWins.map((battle) => battle.questions)),
    bossQuestionsAll: mean(boss.map((battle) => battle.questions)),
    bossLossQuestions: mean(boss.filter((battle) => !battle.win).map((battle) => battle.questions)),
    clearQuestions: mean(wins.map((sample) => sample.questions)),
    hpRemaining: mean(wins.map((sample) => sample.hp)), mpRemaining: mean(wins.map((sample) => sample.mp)),
    consumablesPerClear: mean(wins.map((sample) => sample.consumed)),
    failedBeforeBoss: samples.filter((sample) => !sample.win && !sample.battles.some((battle) => battle.boss)).length,
  };
}

function distanceOutside(value, low, high) {
  if (value == null) return high;
  return value < low ? low - value : value > high ? value - high : 0;
}

function candidateScore(result, target) {
  // 通常戦の全滅をボス難度で帳尻合わせしない。低標本の勝率は中心値へ寄せ過ぎない。
  const normalPenalty = Math.max(0, target.normalWinRate - result.normalWinRate) * 200;
  const clearDistance = Math.max(0, Math.abs(result.clearRate - target.clear) - .025);
  return normalPenalty + clearDistance * 14
    + distanceOutside(result.normalQuestions, 15, 20) * .25
    + distanceOutside(result.bossQuestionsAll, 20, 25) * .2;
}

export function calibrateStar(data, star, options = {}, onProgress = () => {}) {
  const dungeon = [...data.dungeons.values()].find((row) => row.rank === star && row.kind === '標準');
  if (!dungeon) throw new Error(`★${star}の標準ダンジョンがありません。`);
  const runs = options.runs ?? 24, preparedRuns = options.preparedRuns ?? 12;
  const seed = ((options.seed ?? 190001) + star * 104729) >>> 0;
  // 初級は選べる対策が少ないため、75%へ無理に下げず80〜90%を許容する。
  const target = { normalQuestions: 17, bossQuestions: 23, normalWinRate: .97, clear: star === 1 ? .85 : .75, ...(options.target ?? {}) };
  const fixture = prepareParty(data, dungeon, 'balanced', 'standard').simulationFixture;
  if (!fixture) throw new Error('合法なparty-fixturesがまだbalance.mjsへ接続されていません。');
  const initial = coefficients(data, star);
  const history = [];
  const evaluate = (phase) => {
    const result = measure(data, dungeon.id, { runs, seed, accuracy: options.accuracy ?? .8 });
    const entry = { phase, coefficients: coefficients(data, star), result };
    history.push(entry);
    onProgress({ star, phase, coefficients: entry.coefficients,
      clear: result.clearRate, normalWin: result.normalWinRate,
      normalQ: result.normalQuestions, bossQ: result.bossQuestionsAll, bossWinQ: result.bossQuestions });
    return entry;
  };
  let current = evaluate('baseline');

  // 通常HPを動かすとき、ボスの総HP倍率は一旦固定する。
  for (let pass = 0; pass < 2; pass++) {
    const before = current.coefficients, result = current.result;
    const next = { ...before };
    const observed = result.normalQuestions ?? result.normalQuestionsAll;
    const hpFactor = observed && Math.abs(observed - target.normalQuestions) > 1
      ? clamp((target.normalQuestions / observed) ** .85, .65, 1.6) : 1;
    next.hp_rank_mul = before.hp_rank_mul * hpFactor;
    next.hp_boss_rank_mul = before.hp_boss_rank_mul / hpFactor;
    if (result.normalWinRate < target.normalWinRate) {
      const attackFactor = result.normalWinRate >= .9 ? .83 : .7;
      next.atk_rank_mul = before.atk_rank_mul * attackFactor;
      next.atk_boss_rank_mul = before.atk_boss_rank_mul / attackFactor;
    }
    if (hpFactor === 1 && next.atk_rank_mul === before.atk_rank_mul) break;
    applyCoefficients(data, star, next);
    current = evaluate(`normal_hp_${pass + 1}`);
  }
  // HP調整で長引いた通常戦に全滅が残る場合だけ、通常攻撃力を下げる。
  for (let pass = 0; pass < 2 && current.result.normalWinRate < target.normalWinRate; pass++) {
    const next = { ...current.coefficients };
    next.atk_rank_mul *= .8; next.atk_boss_rank_mul /= .8;
    applyCoefficients(data, star, next);
    current = evaluate(`normal_survival_${pass + 1}`);
  }

  for (let pass = 0; pass < 2; pass++) {
    const result = current.result;
    const observed = result.bossQuestionsAll;
    if (observed == null || Math.abs(observed - target.bossQuestions) <= 1.5) break;
    // 早期全滅の短い時間を、ボスHPが少ない証拠として扱わない。
    if (result.bossWinRate < .35 && observed < 20) break;
    const factor = clamp((target.bossQuestions / observed) ** .85, .65, 1.55);
    const next = { ...current.coefficients, hp_boss_rank_mul: clamp(current.coefficients.hp_boss_rank_mul * factor, .2, 8) };
    applyCoefficients(data, star, next);
    current = evaluate(`boss_hp_${pass + 1}`);
  }

  const attackCandidates = [current];
  let easier = null, harder = null;
  function bracket(entry) {
    const value = entry.coefficients.atk_boss_rank_mul;
    if (entry.result.clearRate >= target.clear) {
      if (!easier || value > easier.coefficients.atk_boss_rank_mul) easier = entry;
    } else if (!harder || value < harder.coefficients.atk_boss_rank_mul) harder = entry;
  }
  bracket(current);
  for (let pass = 0; pass < (options.bossAttackPasses ?? 5); pass++) {
    if (Math.abs(current.result.clearRate - target.clear) <= .04
      && distanceOutside(current.result.bossQuestionsAll, 20, 25) === 0) break;
    const value = easier && harder
      ? Math.sqrt(easier.coefficients.atk_boss_rank_mul * harder.coefficients.atk_boss_rank_mul)
      : easier ? easier.coefficients.atk_boss_rank_mul * 1.5 : harder.coefficients.atk_boss_rank_mul * .67;
    const nextValue = rounded(clamp(value, .15, 8));
    if (attackCandidates.some((entry) => entry.coefficients.atk_boss_rank_mul === nextValue)) break;
    applyCoefficients(data, star, { ...current.coefficients, atk_boss_rank_mul: nextValue });
    current = evaluate(`boss_attack_${pass + 1}`);
    attackCandidates.push(current); bracket(current);
  }
  const best = [...attackCandidates].sort((a, b) => candidateScore(a.result, target) - candidateScore(b.result, target)
    || Math.abs(a.result.clearRate - target.clear) - Math.abs(b.result.clearRate - target.clear))[0];
  applyCoefficients(data, star, best.coefficients);
  const prepared = measure(data, dungeon.id, {
    runs: preparedRuns, seed: (seed ^ 0x6ac1e74d) >>> 0, preparation: 'prepared', accuracy: options.accuracy ?? .8,
  });
  const warnings = [];
  if (best.result.normalWinRate < target.normalWinRate) warnings.push('通常戦の勝率が97%未満。ボス以前の消耗を再確認。');
  if (distanceOutside(best.result.normalQuestions, 15, 20)) warnings.push('通常戦の勝利時問題数が15〜20問の範囲外。');
  if (distanceOutside(best.result.bossQuestionsAll, 20, 25)) warnings.push('敗戦を含むボス問題数が20〜25問の範囲外。');
  if (distanceOutside(best.result.clearRate, star === 1 ? .8 : .7, star === 1 ? .9 : .8)) warnings.push('基準編成の踏破率が許容範囲外。別seed検証で確認。');
  if (prepared.clearRate < .85) warnings.push('準備編成の少数確認が85%未満。勝率の信頼区間と敗因を確認。');
  return {
    star, dungeonId: dungeon.id, target, initial, selected: best.coefficients,
    fixture: { rank: fixture.rank, level: fixture.level, stage: fixture.stage, itemCap: fixture.itemCap,
      enhancement: fixture.enhancement, assembly: fixture.assembly },
    baseline: history[0].result, standard: best.result, prepared, warnings, history,
  };
}

function makePatch(results) {
  const enemy = Object.fromEntries(FIELDS.map((field) => [field, {}]));
  for (const result of results) for (const field of FIELDS) enemy[field][result.star] = result.selected[field];
  return { enemy };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => { const index = args.indexOf(name); return index < 0 ? fallback : args[index + 1]; };
  if (args.includes('--help')) {
    console.log('node sim/calibrate.mjs --runs 24 --prepared-runs 12 --workers 4 --stars 1,2,3,4,5,6,7,8,9,10,11,12 --output /tmp/calibrated-balance-patch.json --report /tmp/calibration-report.json');
    return;
  }
  const options = { runs: Number(arg('--runs', '24')), preparedRuns: Number(arg('--prepared-runs', '12')),
    seed: Number(arg('--seed', '190001')), accuracy: Number(arg('--accuracy', '.8')),
    bossAttackPasses: Number(arg('--boss-attack-passes', '5')) };
  const stars = arg('--stars', '1,2,3,4,5,6,7,8,9,10,11,12').split(',').map(Number);
  const workers = Math.min(stars.length, Number(arg('--workers', '4')));
  if (![options.runs, options.preparedRuns, workers].every((value) => Number.isInteger(value) && value > 0)
    || !stars.every((value) => Number.isInteger(value) && value >= 1 && value <= 12)) throw new Error('試行数・worker数・★の指定が不正です。');
  const output = arg('--output', '/tmp/calibrated-balance-patch.json');
  const reportPath = arg('--report', '/tmp/calibration-report.json');
  const data = loadData();
  const sources = ['sim/balance.mjs', 'sim/party-fixtures.mjs', 'game/js/battle.js', 'data/balance.json', 'data/monsters.csv', 'data/skills.csv', 'data/weapon_types.csv'];
  const fingerprints = Object.fromEntries(sources.map((name) => [name,
    createHash('sha256').update(readFileSync(new URL(`../${name}`, import.meta.url))).digest('hex')]));
  const results = [];
  const startedAt = new Date().toISOString();
  const save = () => {
    const ordered = [...results].sort((a, b) => a.star - b.star);
    writeFileSync(output, JSON.stringify(makePatch(ordered), null, 2) + '\n');
    writeFileSync(reportPath, JSON.stringify({ schema: 1, startedAt, updatedAt: new Date().toISOString(), options, fingerprints,
      assumptions: {
        engine: '実battle.js、合法party-fixtures、balanced編成、春・冠付きあり・賞金首なし。数値確率による勝率の強制なし。',
        sampling: '各★の探索は同じ固定seed群。prepared確認は別seed。最終評価はこの校正に使わないseed群で行う。',
        timing: '通常は勝利時と全試行の両方、ボスは敗戦時も含む問題数を記録。早期全滅で短くなったボス戦からHP増加を推測しない。',
        uncertainty: '少数試行の探索候補。95% Wilson区間は踏破した試行の比率。数値の採用は別seed・十分な試行の検証後。',
      }, complete: results.length === stars.length, results: ordered }, null, 2) + '\n');
  };
  const tasks = Array.from({ length: workers }, (_, index) => stars.filter((_, i) => i % workers === index));
  console.log(JSON.stringify({ phase: 'start', stars, workers, ...options }));
  await Promise.all(tasks.map((assigned) => new Promise((resolve, reject) => {
    // GameDataを開始時に複製し、途中のファイル更新でworker間の条件が変わらないようにする。
    const worker = new Worker(new URL(import.meta.url), { workerData: { calibration: true, data, stars: assigned, options } });
    worker.on('message', (message) => {
      if (message.type === 'progress') console.log(JSON.stringify(message.value));
      if (message.type === 'result') {
        results.push(message.value); save();
        console.log(JSON.stringify({ phase: 'selected', star: message.value.star, coefficients: message.value.selected,
          standard: message.value.standard.clearRate, prepared: message.value.prepared.clearRate, warnings: message.value.warnings }));
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`校正workerが終了しました: ${code}`)));
  })));
  save();
  console.log(JSON.stringify({ phase: 'complete', stars: results.length, output, report: reportPath }));
}

if (!isMainThread && workerData?.calibration) {
  for (const star of workerData.stars) {
    const result = calibrateStar(workerData.data, star, workerData.options,
      (value) => parentPort.postMessage({ type: 'progress', value }));
    parentPort.postMessage({ type: 'result', value: result });
  }
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
