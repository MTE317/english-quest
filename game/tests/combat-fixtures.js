// 旧商品技能を再導入せず、汎用戦闘エンジンの効果キーと装備の相互作用を検証する制御データ。
// 実際の職業・120技能は jobs-master-* とデータ検証で別途検証する。
import { readFileSync } from 'node:fs';
import { parseCsv, splitList } from '../js/csv.js';
import { createNewGame } from '../js/game-state.js';
import { starterGearIds, makeGear } from '../js/character.js';

export function withEngineSkillFixtures(data) {
  const rows = parseCsv(readFileSync(new URL('./fixtures/engine-skill-effects.csv', import.meta.url), 'utf8')).rows;
  const skills = new Map(data.skills);
  for (const row of rows) {
    skills.set(row.id, {
      id: row.id, job: row.job, path: row.path, stage: Number(row.stage), name: row.name,
      kind: row.kind, cost: Number(row.cost), mp: Number(row.mp), apToLearn: Number(row.ap_to_learn),
      isFinal: row.is_final === '1', elements: splitList(row.element), effect: JSON.parse(row.effect_json || '{}'),
    });
  }
  return { ...data, skills };
}

/** 新規ゲームを作り、その後に配給装備を手動で装着した状態を用意する。 */
export function equippedGame(data, specs, options) {
  const game = createNewGame(data, specs, options);
  for (const member of game.party) {
    for (const [slot, id] of Object.entries(starterGearIds(data, member.job))) {
      const index = game.storage.gear.findIndex((gear) => gear.id === id);
      member.equip[slot] = index >= 0 ? game.storage.gear.splice(index, 1)[0] : makeGear(game, id);
    }
  }
  return game;
}
