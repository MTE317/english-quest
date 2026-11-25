import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { unlockJob, recordStoredMaterials, offeringRevealed } from '../js/temple.js';
import { availableJobs, changeJob, learnSkill, skillPrerequisite, equipSkill } from '../js/growth.js';
import { canEquip, makeGear, maxMp } from '../js/character.js';
import { actionOptions, createBattle, makeEnemy, resolvePending, setPending } from '../js/battle.js';

const data = loadData();
const job = 'stormcaster';
const chain = 'stormcaster_chain';
const passive = 'stormcaster_critical_mp';
const ultimate = 'stormcaster_tempest';
const material = 'thunder_plateau_boss_mat';
const fresh = () => createNewGame(data, defaultPartySpecs(data));

test('上級職の儀式は鍵素材で発見し、消費後も表示される', () => {
  const game = fresh();
  const rule = data.jobUnlocks.get(job);
  assert.equal(offeringRevealed(data, game, rule), false);
  assert.throws(() => unlockJob(data, game, job), /まだ発見/);
  game.storage.materials[material] = 1;
  recordStoredMaterials(game);
  delete game.storage.materials[material];
  assert.equal(offeringRevealed(data, game, rule), true);
  assert.throws(() => unlockJob(data, game, job), /素材が足りません/);
  assert.ok(!game.unlockedJobs.includes(job));
});

function train(game) {
  game.storage.materials[material] = 2;
  unlockJob(data, game, job);
  game.jp = 1000;
  changeJob(data, game, 0, job);
  const member = game.party[0];
  member.ap = 63;
  member.loadout = { actions: [chain], passives: [] };
  // 奥義とパッシブは独立に習得できる。
  learnSkill(data, member, ultimate); equipSkill(data, member, ultimate);
  learnSkill(data, member, passive); equipSkill(data, member, passive);
  return member;
}

test('雷術士は神殿の素材解放と転職を経て、技能を持ち出せる', () => {
  const game = fresh();
  assert.equal(availableJobs(data, game).some(entry => entry.id === job), false);
  game.storage.materials[material] = 1;
  assert.throws(() => unlockJob(data, game, job), /素材が足りません/);
  assert.equal(game.storage.materials[material], 1);
  const member = train(game);
  assert.equal(game.storage.materials[material], undefined);
  assert.throws(() => unlockJob(data, game, job), /解放できません/);
  assert.equal(canEquip(data, member, 'weapon', makeGear(game, 'tome_t1')).ok, true);
  assert.equal(skillPrerequisite(data, data.skills.get(ultimate)), undefined);
  assert.ok(member.loadout.actions.includes(ultimate));
  changeJob(data, game, 0, 'black_mage');
  assert.ok(member.loadout.actions.includes(chain));
  assert.ok(member.loadout.passives.includes(passive));
  assert.ok(!member.loadout.actions.includes(ultimate));
});

function useSkill(game, skillId, seed, correct) {
  const enemy = makeEnemy(data, 'slime', { lv: 1 });
  enemy.hp = enemy.maxHp = 100000;
  const battle = createBattle(data, game, { enemies: [enemy], seed });
  battle.turn = { side: 'ally', i: 0 };
  setPending(battle, { type: 'skill', skillId, target: 0 }, {});
  resolvePending(data, game, battle, correct);
  return battle;
}

test('雷会心の還元は正解時に1行動1回、奥義は1戦1回', () => {
  const game = fresh();
  const member = train(game);
  member.equip.weapon = makeGear(game, 'tome_t1');
  const tryTempest = (seed, correct) => {
    member.mp = maxMp(data, member);
    return useSkill(game, ultimate, seed, correct);
  };
  const seeds = Array.from({ length: 64 }, (_, i) => i + 1);
  const seed = seeds.find(i => tryTempest(i, true).log.some(line => line.includes('会心の余韻')));
  assert.ok(seed, '会心MP回復が実戦闘で発動する');
  const battle = tryTempest(seed, true);
  assert.equal(battle.log.filter(line => line.includes('会心の余韻')).length, 1);
  assert.equal(member.mp, maxMp(data, member) - 20 + Math.ceil(maxMp(data, member) * 0.03));
  member.mp = maxMp(data, member);
  assert.match(actionOptions(data, game, battle, 0).skills.find(entry => entry.skill.id === ultimate).reason,
    /もう使った/);
  assert.ok(!tryTempest(seed, false).log.some(line => line.includes('会心の余韻')));
});

