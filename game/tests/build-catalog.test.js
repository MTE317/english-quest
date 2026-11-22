// 開発カタログの36案が名前だけにならず、実際に合法な技能と付与で組めることを検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { affixSum, canEquip } from '../js/character.js';
import { capacity, usedCapacity, isLearned, memberMods } from '../js/growth.js';
import { enchantFamilies } from '../js/workshop.js';
import {
  BUILD_CATALOG, BUILD_DEFINITIONS, LEGACY_PROFILES, PROFILES,
  prepareParty, assertBuildCore, resolveBuildFamily,
} from '../../sim/party-fixtures.mjs';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const dungeonFor = (rank) => [...data.dungeons.values()].find((d) => d.rank === rank && d.kind === '標準');
const cached = new Map();
function prepared(id, rank = BUILD_DEFINITIONS[id].minStar) {
  const key = `${id}/${rank}`;
  if (!cached.has(key)) cached.set(key, prepareParty(data, dungeonFor(rank), id, 'prepared'));
  return cached.get(key);
}
const members = (build) => [build, ...build.allies];
const coreSkills = (definition) => [...(definition.actions ?? []), ...(definition.passives ?? [])];

test('開発専用36ビルドは公開14職・16武器を含み、既存12編成も選べる', () => {
  assert.equal(BUILD_CATALOG.schemaVersion, 1);
  assert.equal(BUILD_CATALOG.partySize, 4);
  assert.equal(BUILD_CATALOG.builds.length, 36);
  assert.equal(new Set(BUILD_CATALOG.builds.map((b) => b.id)).size, 36);
  assert.equal(new Set(BUILD_CATALOG.builds.map((b) => b.name)).size, 36);
  assert.equal(Object.keys(PROFILES).length, 48);
  assert.deepEqual(Object.keys(LEGACY_PROFILES), [
    'balanced', 'poison', 'bleed', 'critical', 'weakness', 'counter',
    'spellblade', 'support', 'healer', 'magic', 'supplies', 'brawler',
  ]);
  for (const [id, profile] of Object.entries(LEGACY_PROFILES)) assert.equal(PROFILES[id], profile);
  assert.deepEqual([...new Set(BUILD_CATALOG.builds.map((b) => b.job))].sort(),
    [...data.jobsById.values()].filter((j) => ['base', 'mid'].includes(j.tier)).map((j) => j.id).sort());
  assert.deepEqual([...new Set(BUILD_CATALOG.builds.map((b) => b.weapon))].sort(), [...data.weaponTypes.keys()].sort());
  assert.ok(!Object.values(GAME_FILES).includes('build-catalog.json'), 'ゲーム本体にビルド手引きを読み込まない');
  assert.match(BUILD_CATALOG.minStarMeaning, /fixture/);
  assert.match(BUILD_CATALOG.minStarMeaning, /実ゲームの技能習得を星で制限する設定ではない/);
});

test('カタログの技能参照・持ち出し・段階・武器適性と4人構成に矛盾がない', () => {
  const signatures = new Set();
  for (const build of BUILD_CATALOG.builds) {
    const profile = PROFILES[build.id];
    assert.equal(profile.catalogBuildId, build.id);
    assert.equal(members(build).length, 4);
    assert.equal(profile.jobs.length, 4);
    assert.ok(build.playstyle.length > 20 && build.weakness.length > 20, build.id);
    const stage = Math.min(5, 1 + Math.floor(build.minStar / 3));
    for (const definition of members(build)) {
      assert.notEqual(data.jobWeaponApt.get(definition.job)?.[definition.weapon], '×', build.id);
      const skills = coreSkills(definition);
      assert.equal(new Set(skills).size, skills.length, `${build.id}: 核心技能の重複`);
      for (const [key, passive] of [['actions', false], ['passives', true]]) {
        for (const id of definition[key] ?? []) {
          const skill = data.skills.get(id);
          assert.ok(skill, `${build.id}/${id}`);
          assert.equal(skill.kind === 'passive', passive, `${build.id}/${id}`);
          assert.ok(skill.stage <= stage, `${build.id}/${id} のfixture進度`);
          if (skill.isFinal) assert.equal(skill.job, definition.job, '奥義は自職のみ');
        }
      }
      assert.deepEqual([...(definition.crossSkills ?? [])].sort(),
        skills.filter((id) => data.skills.get(id).job !== definition.job).sort());
      for (const [slot, families] of Object.entries(definition.affixes ?? {})) {
        assert.ok(families.length <= 2, `${build.id}/${slot}`);
        assert.equal(new Set(families).size, families.length);
        const actual = ['head', 'body', 'arm'].includes(slot) ? 'armor'
          : slot.startsWith('accessory') ? 'accessory' : slot === 'offhand' ? 'weapon' : slot;
        for (const family of families) assert.ok(data.affixes.some((a) => a.slot === actual && a.stat === family.split(':')[0]), `${build.id}/${slot}/${family}`);
      }
    }
    const signature = JSON.stringify([build.job, build.weapon, build.offhand, build.actions, build.passives, build.affixes]);
    assert.ok(!signatures.has(signature), `${build.id}: 名前だけ変えたビルド`);
    signatures.add(signature);
  }
});

test('最低進度と★12の全36編成で、必須技能と付与が実際に装備される', () => {
  for (const build of BUILD_CATALOG.builds) for (const rank of [build.minStar, 12]) {
    const game = prepared(build.id, rank); const fixture = game.simulationFixture;
    assert.equal(game.party.length, 4);
    assert.equal(fixture.catalogBuildId, build.id);
    assert.equal(fixture.skipped.length, 0);
    assert.deepEqual(assertBuildCore(data, game), fixture.core);
    for (const [i, definition] of members(build).entries()) {
      const member = game.party[i]; const cap = capacity(data, member); const used = usedCapacity(data, member);
      assert.ok(used.actions <= cap.actions && used.passives <= cap.passives);
      for (const id of coreSkills(definition)) assert.ok(isLearned(member, data.skills.get(id)), `${build.id}/${id}`);
      for (const [slot, gear] of Object.entries(member.equip)) if (gear) {
        assert.ok(canEquip(data, member, slot, gear).ok);
        assert.ok((gear.enchants?.length ?? 0) <= 2);
      }
      for (const raw of definition.coreEffects ?? []) {
        const family = resolveBuildFamily(data, data.monsters.get(fixture.bossId), raw);
        assert.ok(affixSum(member, family) > 0, `${build.id}/${family}`);
      }
    }
    for (const e of fixture.enchants) {
      const gear = game.party[e.member].equip[e.slot]; const material = data.materials.get(e.materialId);
      assert.ok(material.rank <= rank);
      assert.ok(enchantFamilies(data, data.equipment.get(gear.id), material).includes(e.family));
    }
    for (const m of game.party) {
      const paid = {};
      for (const id of m.learned) {
        const skill = data.skills.get(id);
        paid[skill.job] = (paid[skill.job] ?? 0) + skill.apToLearn;
      }
      assert.deepEqual(fixture.assembly.ap[m.id], paid, `${build.id}: APを通常費用で支払う`);
    }
    const trainingJp = fixture.assembly.jobTraining.reduce((sum, entry) => {
      assert.equal(entry.jp, data.jobsById.get(entry.to).changeJp);
      return sum + entry.jp;
    }, 0);
    const startingJp = [...new Set(game.party.map((m) => m.job))].filter((id) => data.jobsById.get(id).tier === 'mid')
      .reduce((sum, id) => sum + data.jobsById.get(id).changeJp, 0);
    assert.equal(fixture.assembly.jp, startingJp + trainingJp);
    assert.equal(game.jp, 0, '組立用JPを実所持JPに残さない');
  }
});

test('状態異常12種の供給手段を持ち、睡眠・凍結は味方にも核となる付与と支援を用意する', () => {
  const statuses = new Set();
  for (const build of BUILD_CATALOG.builds.filter((b) => b.category === 'status')) {
    for (const id of build.actions) {
      const effect = data.skills.get(id).effect;
      const status = effect.st && (data.statusByName.get(effect.st[0]) ?? data.statusEffects.get(effect.st[0]));
      if (status) statuses.add(status.id);
    }
  }
  assert.deepEqual([...statuses].sort(), ['poison', 'toxic', 'burn', 'bleed', 'sleep', 'paralysis', 'freeze', 'stun', 'bind', 'silence', 'blind', 'statdown'].sort());
  const sleep = prepared('dream_executioner');
  assert.ok(sleep.party[0].loadout.actions.includes('thief_p4_s2'));
  assert.ok(sleep.party[2].loadout.actions.includes('bard_p2_s3'));
  assert.ok(sleep.party[2].loadout.actions.includes('bard_p1_s1'));
  const freeze = prepared('frost_executioner');
  assert.ok(freeze.party[0].loadout.actions.includes('spellblade_p3_s1'));
  assert.ok(freeze.party[2].loadout.actions.includes('spellblade_p3_s1'));
  assert.ok(freeze.unlockedJobs.includes('spellblade'));
  const tank = prepared('undying_warrior');
  assert.equal(memberMods(data, tank.party[0]).endure, 1);
  assert.ok(memberMods(data, tank.party[0]).lowhp_dmg > 0);
  const supplies = prepared('item_alchemist');
  assert.ok(memberMods(data, supplies.party[0]).itemp > 0);
  assert.ok(Object.values(supplies.items).every((n) => Number.isInteger(n) && n > 0 && n <= 3));
});

test('核の欠落はprimary・補助役・専用制作の固定効果があっても検出する', () => {
  const primary = structuredClone(prepared('skill_cyclist'));
  primary.party[0].loadout.actions = primary.party[0].loadout.actions.filter((id) => id !== 'spellblade_p2_s1');
  assert.throws(() => assertBuildCore(data, primary), /核心技能.*spellblade_p2_s1/);
  const supporter = structuredClone(prepared('dream_executioner'));
  supporter.party[2].loadout.actions = supporter.party[2].loadout.actions.filter((id) => id !== 'bard_p2_s3');
  assert.throws(() => assertBuildCore(data, supporter), /核心技能.*3人目.*bard_p2_s3/);
  const enchant = structuredClone(prepared('skill_cyclist'));
  enchant.party[0].equip.weapon.affixes.NORMAL_SKILL = 20;
  enchant.party[0].equip.weapon.enchants = enchant.party[0].equip.weapon.enchants.filter((e) => e.stat !== 'NORMAL_SKILL');
  assert.throws(() => assertBuildCore(data, enchant), /核心付与.*NORMAL_SKILL/);
});

test('枠不足・不足データ・低い比較段階・他職奥義を黙って省略しない', () => {
  const dungeon = dungeonFor(9);
  const expensive = { ...data, skills: new Map(data.skills) };
  expensive.skills.set('monk_p3_s4', { ...data.skills.get('monk_p3_s4'), cost: 99 });
  assert.throws(() => prepareParty(expensive, dungeon, 'undying_warrior', 'prepared'), /核心技能.*枠/);
  const unavailable = { ...data, affixes: data.affixes.filter((a) => a.stat !== 'NORMAL_SKILL') };
  assert.throws(() => prepareParty(unavailable, dungeonFor(3), 'skill_cyclist', 'prepared'), /核心付与.*NORMAL_SKILL/);
  const final = { ...data, skills: new Map(data.skills) };
  final.skills.set('monk_p3_s4', { ...data.skills.get('monk_p3_s4'), isFinal: true });
  assert.throws(() => prepareParty(final, dungeon, 'undying_warrior', 'prepared'), /他職の奥義/);
  assert.throws(() => prepareParty(data, dungeon, 'undying_warrior', 'prepared', { stage: 3 }), /比較用技能段階4/);
  assert.throws(() => prepareParty(data, dungeonFor(3), 'dream_executioner', 'prepared'), /★6/);
});
