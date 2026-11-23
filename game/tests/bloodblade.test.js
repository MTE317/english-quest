import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs } from '../js/game-state.js';
import { changeJob, availableJobs, learnSkill } from '../js/growth.js';
import { makeGear, canEquip, maxMp } from '../js/character.js';
import { countKills, reportQuest } from '../js/town.js';
import { GameSession } from '../js/save.js';
import { MemoryStorage } from './helpers.js';
import { makeEnemy, createBattle, actionOptions, setPending, resolvePending, collectBattleHits } from '../js/battle.js';

const data = loadData();
const job = 'bloodblade';
const jobRule = data.jobUnlocks.get(job);
const fresh = () => createNewGame(data, defaultPartySpecs(data));
const hunt = () => ({ uid: 100, questId: 'q1_hunt', type: 'hunt', rank: 1, count: 1, progress: 0,
  dungeonId: 'sunlit_forest', targetMode: 'dungeon', targetIds: ['wolf_pup', 'pollen_bug'] });
const defeat = (id) => ({ ...makeEnemy(data, id, { lv: 1 }), hp: 0 });

test('討伐の条件は依頼の対象・場所・報告を満たした場合だけ成立し、全滅で取り消される', () => {
  const game = fresh();
  game.quests.push(hunt());
  const storage = new MemoryStorage();
  const session = new GameSession({ storage });
  session.startNew(game);
  assert.ok(!availableJobs(data, session.game).some(j => j.id === job));
  countKills(session.game, [defeat('wolf_pup')], 'wrong_dungeon');
  assert.throws(() => reportQuest(data, session.game, 100));

  session.enterDungeon({ dungeonId: 'sunlit_forest' });
  session.updateRun((run, current) => countKills(current, [defeat('wolf_pup')], run.dungeonId));
  const resumed = new GameSession({ storage });
  resumed.wipe();
  assert.equal(resumed.game.quests[0].defeatedStatusIds, undefined);
  assert.throws(() => reportQuest(data, resumed.game, 100));

  countKills(resumed.game, [defeat('pollen_bug')], 'sunlit_forest');
  reportQuest(data, resumed.game, 100, () => 0);
  assert.ok(!resumed.game.unlockedJobs.includes(job));

  resumed.game.quests.push(hunt());
  countKills(resumed.game, [defeat('wolf_pup')], 'sunlit_forest');
  assert.ok(!resumed.game.unlockedJobs.includes(job));
  reportQuest(data, resumed.game, 100, () => 0);
  assert.ok(availableJobs(data, resumed.game).some(j => j.id === job));
  assert.equal(jobRule.report_enemy_status, 'bleed');
  assert.throws(() => reportQuest(data, resumed.game, 100));
});

test('鎌の特効は状態ごとに乗り、奥義は1回の命中で両方を独立判定する', () => {
  const game = fresh();
  game.quests.push(hunt());
  countKills(game, [defeat('wolf_pup')], 'sunlit_forest');
  reportQuest(data, game, 100, () => 0);
  game.jp = 220;
  changeJob(data, game, 0, job);
  assert.equal(game.jp, 0);
  const member = game.party[0];
  member.lv = 30;
  member.mp = maxMp(data, member);
  member.ap[job] = 80;
  assert.ok(member.loadout.actions.includes('bloodblade_scorch'));
  member.loadout.actions = ['bloodblade_scorch'];
  for (const skill of ['bloodblade_rend', 'bloodblade_wounds', 'bloodblade_reaping']) learnSkill(data, member, skill);
  const gear = kind => makeGear(game, [...data.equipment.values()].find(def => def.kind === kind && def.slot === 'weapon' && !def.unique).id);
  const scythe = gear('scythe');
  assert.ok(canEquip(data, member, 'weapon', scythe).ok);
  member.equip.weapon = scythe;

  function act(skillId, statuses = [], weapon = scythe, block = [], passive = true) {
    const copy = structuredClone(game);
    copy.party[0].equip.weapon = weapon;
    if (!passive) copy.party[0].loadout.passives = [];
    const enemy = makeEnemy(data, 'slime', { lv: 15 });
    enemy.hp = enemy.maxHp = 10000;
    for (const id of statuses) enemy.statuses[id] = { turns: 2, n: 1 };
    enemy.statusAffinity = { burn: '★', bleed: '★', ...Object.fromEntries(block.map(id => [id, '×'])) };
    const battle = createBattle(data, copy, { enemies: [enemy], seed: 2 });
    battle.round = 1;
    battle.turn = { side: 'ally', i: 0 };
    assert.equal(actionOptions(data, copy, battle, 0).skills.find(row => row.skill.id === skillId).reason, '');
    setPending(battle, { type: 'skill', skillId, target: 0 }, {});
    const hits = collectBattleHits(battle, () => resolvePending(data, copy, battle, true));
    return { damage: 10000 - enemy.hp, enemy, hits, copy, battle };
  }

  const baseline = act('bloodblade_scorch').damage;
  assert.ok(Math.abs(act('bloodblade_scorch', ['burn']).damage - baseline * 1.12) <= 2);
  const both = ['burn', 'bleed'];
  const innate = act('bloodblade_scorch', both, scythe, [], false).damage;
  assert.ok(Math.abs(act('bloodblade_scorch', both).damage - innate - baseline * .24) <= 2);
  const sword = gear('sword');
  assert.equal(act('bloodblade_scorch', ['burn', 'bleed'], sword).damage, act('bloodblade_scorch', [], sword).damage);

  const ultimate = 'bloodblade_reaping';
  const outcome = act(ultimate);
  assert.equal(outcome.hits.length, 1);
  assert.ok(outcome.enemy.statuses.burn);
  assert.ok(outcome.enemy.statuses.bleed);
  assert.equal(actionOptions(data, outcome.copy, outcome.battle, 0).skills.find(row => row.skill.id === ultimate).reason, 'この戦闘ではもう使った');
  const immune = act(ultimate, [], scythe, ['burn']);
  assert.equal(immune.enemy.statuses.burn, undefined);
  assert.ok(immune.enemy.statuses.bleed);
});
