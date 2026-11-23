import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadData, rngFor, sourceFingerprint, chooseAction, prepareNextBattle } from '../../../sim/balance.mjs';
import { partyFixture } from './fixtures.mjs';
import { maxMp } from '../../js/character.js';
import { createBattle, nextTurn, actionOptions, prepareQuizAction, setPending, resolvePending, finishBattle, enemyCanAct, makeEnemy, collectBattleHits } from '../../js/battle.js';
import { makeEncounter } from '../../js/encounter.js';
import { recoverAfterBattle } from '../../js/dungeon.js';
import { normalizeGame } from '../../js/game-state.js';

const data = loadData(), fingerprint = sourceFingerprint();
const runs = Number(process.env.RUNS ?? 40), seed = 1217071, accuracy = .8;
const variants = (process.env.VARIANTS ?? 'gunner,petrifier_native,petrifier,no_passive,pierce_only,gunner_pair,mixed').split(',');
const locations = ['sand_tomb', 'millennium_root'];
const rows = [], fixtures = {};

function action(game, b, variant, options) {
  const member = game.party[b.turn.i];
  if (member.job !== 'petrifier' || variant === 'petrifier_native') return chooseAction(data, game, b, options);
  const living = b.enemies.map((enemy, i) => ({ enemy, i })).filter(({ enemy }) => enemyCanAct(enemy));
  const susceptible = living.filter(({ enemy }) => !enemy.boss && enemy.statusAffinity.petrify !== '×');
  // 石化を積極的に試す別方策。実装と同じ効果計算を複製せず、技能の選択だけを変える。
  const preferred = susceptible.length >= 2 ? ['petrifier_volley', 'petrifier_shot', 'petrifier_pierce']
    : susceptible.length ? ['petrifier_shot', 'petrifier_pierce'] : ['petrifier_pierce'];
  const skill = preferred.find(id => options.skills.some(row => row.skill.id === id && !row.reason));
  if (skill) return { type: 'skill', skillId: skill, target: (susceptible[0] ?? living[0]).i };
  return chooseAction(data, game, b, options);
}
function fight(game, enemies, battleSeed, variant) {
  const b = createBattle(data, game, { enemies, seed: battleSeed, canFlee: false });
  const answers = rngFor(battleSeed ^ 0x5f3759df);
  const result = { questions: 0, petrified: 0, savedEnemyHp: 0, selections: {}, pierceDamage: 0, bossPetrified: 0, win: false, stoneFinish: false };
  while (nextTurn(data, game, b) && result.questions < 400) {
    const options = actionOptions(data, game, b, b.turn.i);
    const chosen = action(game, b, variant, options);
    if (!prepareQuizAction(data, game, b)) continue;
    if (chosen.skillId) result.selections[chosen.skillId] = (result.selections[chosen.skillId] ?? 0) + 1;
    const before = enemies.map(e => Boolean(e.statuses.petrify));
    setPending(b, chosen, { wordId: 'simulation' });
    const hits = collectBattleHits(b, () => resolvePending(data, game, b, answers() < accuracy));
    for (const [i, e] of enemies.entries()) if (!before[i] && e.statuses.petrify) {
      result.petrified++; result.savedEnemyHp += e.hp; if (e.boss) result.bossPetrified++;
    }
    if (chosen.skillId === 'petrifier_pierce') result.pierceDamage += hits.filter(h => h.target.side === 'enemy').reduce((s, h) => s + h.damage, 0);
    result.questions++;
  }
  result.win = b.result === 'win';
  result.stoneFinish = result.win && enemies.some(e => e.hp > 0 && e.statuses.petrify);
  if (result.win) finishBattle(data, game, b);
  return result;
}
const mean = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const equivalent = game => JSON.stringify(game.party.map(m => ({ job: m.job, lv: m.lv, loadout: m.loadout,
  equip: Object.fromEntries(Object.entries(m.equip).map(([slot, gear]) => [slot, gear && Object.fromEntries(Object.entries(gear).filter(([key]) => key !== 'uid'))])) })));
for (const variant of variants) {
  const template = partyFixture(data, variant);
  fixtures[variant] = JSON.parse(equivalent(template));
  for (const dungeonId of locations) {
    const trials = [], normal = [], boss = [];
    for (let n = 0; n < runs; n++) {
      const game = structuredClone(template), currentSeed = seed + n * 7919, rng = rngFor(currentSeed);
      const battles = [];
      let stop = false;
      for (const floor of data.dungeonFloors.filter(r => r.dungeonId === dungeonId)) {
        for (let bi = 0; bi < floor.battles; bi++) {
          const isBoss = floor.lastBattleIsBoss && bi === floor.battles - 1;
          if (battles.length) prepareNextBattle(data, game);
          const enemies = makeEncounter(data, dungeonId, floor.floor, rng, { boss: isBoss, season: 'spring', elites: false });
          const r = fight(game, enemies, currentSeed * 1009 + floor.floor * 37 + bi, variant);
          (isBoss ? boss : normal).push(r); battles.push(r);
          if (!r.win) { stop = true; break; }
          recoverAfterBattle(data, game);
        }
        if (stop) break;
      }
      trials.push({ win: battles.every(b => b.win), questions: battles.reduce((s, b) => s + b.questions, 0),
        mp: game.party[5].mp / maxMp(data, game.party[5]) });
    }
    const summarize = xs => ({ reached: xs.length, wins: xs.filter(x => x.win).length, questions: mean(xs.map(x => x.questions)),
      petrified: mean(xs.map(x => x.petrified)), bossPetrified: xs.reduce((s, x) => s + x.bossPetrified, 0),
      pierceDamage: mean(xs.map(x => x.pierceDamage)), stoneFinishes: xs.filter(x => x.stoneFinish).length,
      selections: xs.reduce((o, r) => { for (const [id, n] of Object.entries(r.selections)) o[id] = (o[id] ?? 0) + n; return o; }, {}) });
    const row = { variant, dungeonId, runs, wins: trials.filter(t => t.win).length, questions: mean(trials.map(t => t.questions)),
      mp: mean(trials.map(t => t.mp)), normal: summarize(normal), boss: summarize(boss) };
    rows.push(row); console.log(JSON.stringify(row));
  }
}
// 通常正規化を通した重複装着は同じseedの戦闘結果まで一致する。
let duplicates = null;
if (data.jobsById.has('petrifier') && variants.includes('petrifier')) {
  let matched = 0;
  for (let n = 0; n < 12; n++) {
    const normal = partyFixture(data, 'petrifier'), duplicate = structuredClone(normal);
    duplicate.party[5].loadout.passives.push('petrifier_aim');
    normalizeGame(data, normal); normalizeGame(data, duplicate);
    assert.equal(equivalent(normal), equivalent(duplicate));
    const enemies = [makeEnemy(data, 'm06_008', { lv: 45 }), makeEnemy(data, 'm06_008', { lv: 45 })];
    assert.deepEqual(fight(normal, structuredClone(enemies), seed+n*7919, 'petrifier'), fight(duplicate, structuredClone(enemies), seed+n*7919, 'petrifier'));
    matched++;
  }
  duplicates = { matched, total: 12 };
}
const output = { fingerprint, sourceUnchangedAtCompletion: fingerprint === sourceFingerprint(),
  harnessSha256: createHash('sha256').update(readFileSync(import.meta.filename)).update(readFileSync(new URL('./fixtures.mjs', import.meta.url))).digest('hex'),
  runs, seed, accuracy, level: 45, itemCap: 54, fixtures, rows, duplicates };
writeFileSync(process.argv[2] ?? '/tmp/petrifier-results.json', JSON.stringify(output, null, 2)+'\n');
