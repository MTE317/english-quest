import test from 'node:test';
import assert from 'node:assert/strict';
import { realGameData } from './helpers.js';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { createBattle, makeEnemy, setPending, resolvePending } from '../js/battle.js';
import { monsterBattleVisibility, monsterUnlocks } from '../js/monster-catalog.js';
import { learnMonsterElements } from '../js/monster-knowledge.js';

const data = realGameData();
const inspectSkills = [...data.skills.values()].filter(s => s.effect.rules?.inspect || s.effect.rules?.party_target_damage?.inspect);
test('調査スキル・奥義は初遭遇でもHPを記録し、MP・種族を開示しない', () => {
  assert.ok(inspectSkills.length >= 2);
  for (const skill of inspectSkills) for (const id of ['slime', 'goblin_boss']) for (const allKnown of [false, true]) {
    const specs = defaultPartySpecs(data); specs[0].job = skill.job;
    const game = createNewGame(data, specs), m = game.party[0];
    m.learned.push(skill.id); (m.skillLevels ??= {})[skill.id] = 1; m.mp = 999; m.ultimateGauge = 100;
    if (skill.isFinal) m.loadout.ultimate = skill.id; else m.loadout.actions.push(skill.id);
    const enemy = makeEnemy(data, id), b = createBattle(data, game, { enemies: [enemy], seed: 51 });
    if (allKnown) learnMonsterElements(game, enemy, [...data.elements.keys()]);
    assert.deepEqual(monsterBattleVisibility(data, game, enemy), { hp:false, mp:false, types:false });
    b.turn = { side:'ally', i:0, bleedProcessed:true };
    setPending(b, { type:'skill', skillId:skill.id, target:0 }, {});
    resolvePending(data, game, b, true);
    assert.deepEqual(monsterBattleVisibility(data, game, enemy), { hp:true, mp:false, types:false }, skill.id);
    const restored = JSON.parse(JSON.stringify(game));
    assert.deepEqual(monsterBattleVisibility(data, restored, makeEnemy(data, id)), { hp:true, mp:false, types:false });
    assert.equal(monsterUnlocks(data.monsters.get(id), 0, restored.catalog.affinities[id]).hp, true);
    assert.equal(restored.catalog.defeats?.[id] ?? 0, 0);
    assert.equal(monsterBattleVisibility(data, restored, makeEnemy(data, 'goblin')).hp, false);
  }
});
test('通常攻撃の相性判明だけではHPを開示せず、旧スキャン記録はHPも開示する', () => {
  const game = createNewGame(data, defaultPartySpecs(data)), enemy = makeEnemy(data, 'slime');
  learnMonsterElements(game, enemy, ['fire']);
  assert.equal(monsterBattleVisibility(data, game, enemy).hp, false);
  learnMonsterElements(game, enemy, [], true);
  assert.deepEqual(monsterBattleVisibility(data, game, enemy), { hp:true, mp:false, types:false });
});
