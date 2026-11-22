// 比較用編成が実ゲームで作れない装備・付与・技能を使わないことを検証する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGameData, GAME_FILES } from '../js/gamedata.js';
import { maxHp, maxMp, canEquip } from '../js/character.js';
import { capacity, usedCapacity, commonPoints, isLearned, equipBlock } from '../js/growth.js';
import { enchantFamilies } from '../js/workshop.js';
import { PROFILES, prepareParty } from '../../sim/party-fixtures.mjs';
import { readCsv, readJson } from './helpers.js';

const data = buildGameData(Object.fromEntries(Object.entries(GAME_FILES).map(([key, name]) =>
  [key, name.endsWith('.json') ? readJson(name) : readCsv(name).rows])));
const dungeonFor = (rank) => [...data.dungeons.values()].find((d) => d.rank === rank && d.kind === '標準');
const samples = [];
for (const rank of [1, 3, 6, 9, 12]) for (const [profile, def] of Object.entries(PROFILES)) {
  if (rank < def.minStar) continue;
  const dungeon = dungeonFor(rank);
  samples.push({ rank, profile, dungeon, standard: prepareParty(data, dungeon, profile, 'standard'),
    prepared: prepareParty(data, dungeon, profile, 'prepared') });
}

test('比較用編成は4人・公開職・合法装備・Lv上限・強化上限と熟練を守る', () => {
  for (const sample of samples) for (const mode of ['standard', 'prepared']) {
    const game = sample[mode]; const meta = game.simulationFixture;
    assert.equal(game.party.length, 4);
    assert.equal(meta.level, Math.round(data.dungeonFloors.filter((r) => r.dungeonId === sample.dungeon.id)
      .reduce((sum, r, _i, rows) => sum + r.enemyLevel / rows.length, 0)));
    assert.equal(meta.stage, Math.min(5, 1 + Math.floor(sample.rank / 3)));
    assert.equal(game.gold, data.balance.new_game.gold, '組立資金を実際の初期ゴールドに混ぜない');
    for (const m of game.party) {
      assert.ok(['base', 'mid'].includes(data.jobsById.get(m.job).tier));
      if (data.jobsById.get(m.job).tier === 'mid') assert.ok(game.unlockedJobs.includes(m.job));
      assert.equal(m.lv, meta.level);
      assert.equal(m.hp, maxHp(data, m)); assert.equal(m.mp, maxMp(data, m));
      for (const [slot, gear] of Object.entries(m.equip)) {
        if (!gear) continue;
        const def = data.equipment.get(gear.id);
        assert.ok(canEquip(data, m, slot, gear).ok, `${sample.profile} ${m.job}/${slot}/${gear.id}`);
        assert.ok(def.itemLv <= sample.dungeon.itemLvMin + 3);
        assert.ok(def.star <= sample.rank);
        assert.ok(!def.unique && !def.setId);
        assert.equal(gear.quality, 1.15); assert.equal(gear.enh, Math.min(3, Math.floor(sample.rank / 4)));
        assert.equal(gear.crafted, true);
        assert.ok((gear.enchants?.length ?? 0) <= 2);
        if (def.recipeId) assert.ok(Number(data.recipes.find((r) => r.id === def.id).workshop_rank) <= sample.rank);
        if (def.slot === 'weapon') assert.equal(m.mastery[def.kind], Math.min(10, sample.rank - 1) * 30);
      }
    }
  }
});

test('基本編成は同★・同装備Lvで比較し、各ビルドは専用制作と同じ素体Lvを対にする', () => {
  for (const sample of samples) {
    for (let i = 0; i < 4; i++) {
      const normal = sample.standard.party[i]; const prepared = sample.prepared.party[i];
      assert.equal(normal.lv, prepared.lv);
      for (const [slot, gear] of Object.entries(normal.equip)) {
        const other = prepared.equip[slot];
        assert.equal(Boolean(gear), Boolean(other));
        if (!gear) continue;
        const def = data.equipment.get(gear.id); const otherDef = data.equipment.get(other.id);
        assert.equal(def.itemLv, otherDef.itemLv, `${sample.rank}/${sample.profile}/${i}/${slot}`);
        assert.equal(def.star, otherDef.star);
        assert.equal(gear.enh, other.enh); assert.equal(gear.quality, other.quality);
        if (sample.profile === 'balanced') {
          assert.equal(gear.id, other.id); assert.equal(def.star, sample.rank);
          assert.equal(def.recipeId, undefined);
        } else if (otherDef.recipeId) {
          const recipe = data.recipes.find((r) => r.id === other.id);
          assert.equal(gear.id, recipe.base_equipment_id);
          assert.deepEqual(other.affixes, otherDef.fixedEffects, '制作の固定効果を手で水増ししない');
        }
      }
    }
  }
});

test('付与は実在素材・実グレード・部位・2枠制限を満たし、値を実データから再計算できる', () => {
  for (const sample of samples) for (const mode of ['standard', 'prepared']) {
    const game = sample[mode]; const meta = game.simulationFixture;
    assert.equal(meta.skipped.length, 0);
    for (const item of meta.enchants) {
      const gear = game.party[item.member].equip[item.slot];
      const def = data.equipment.get(gear.id); const material = data.materials.get(item.materialId);
      assert.ok(material.rank <= sample.rank);
      assert.ok(enchantFamilies(data, def, material).includes(item.family));
      const row = data.enchantGrades.find((r) => Number(r.grade) === item.grade);
      assert.ok(Number(row.workshop_rank) <= sample.rank);
      const slot = ['head', 'body', 'arm'].includes(def.slot) ? 'armor' : def.slot;
      const base = data.affixes.find((a) => a.slot === slot && a.stat === item.family.split(':')[0]);
      const value = base.stat === 'ELEMENT' ? 1 : Math.round(base.max * Number(row.value_mul) * (base.scales ? 1 + def.itemLv / 12 : 1) * 10) / 10;
      assert.equal(item.value, value);
      assert.deepEqual(gear.enchants[item.enchantSlot], { stat: item.family, value });
    }
    const expectedEnchantCost = meta.enchants.reduce((sum, e) => sum + Number(data.enchantGrades.find((g) => Number(g.grade) === e.grade).gold), 0);
    assert.equal(meta.assembly.byPurpose.enchant, expectedEnchantCost);
    assert.ok(meta.assembly.gold >= expectedEnchantCost);
    assert.ok(Object.keys(meta.assembly.materials).length > 0);
    for (const [id, n] of Object.entries(meta.assembly.materials)) { assert.ok(data.materials.has(id)); assert.ok(n > 0); }
  }
});

test('共通ポイント・技能枠・前提技能・奥義持ち出し制限を守ってビルドを組む', () => {
  for (const sample of samples) for (const mode of ['standard', 'prepared']) {
    const game = sample[mode]; const stage = game.simulationFixture.stage;
    for (const m of game.party) {
      assert.ok(commonPoints(data, m).left >= 0);
      for (const id of m.common) assert.ok(data.commonTree.find((n) => n.id === id).level <= m.lv);
      const cap = capacity(data, m); const used = usedCapacity(data, m);
      assert.ok(used.actions <= cap.actions && used.passives <= cap.passives);
      for (const id of m.learned) {
        const skill = data.skills.get(id);
        assert.ok(skill.stage <= stage);
        assert.ok(['base', 'mid'].includes(data.jobsById.get(skill.job).tier));
        const previous = [...data.skills.values()].find((s) => s.job === skill.job && s.path === skill.path && s.stage === skill.stage - 1);
        if (previous) assert.ok(isLearned(m, previous), `${id} の前提`);
      }
      for (const kind of ['actions', 'passives']) for (const id of m.loadout[kind]) {
        const skill = data.skills.get(id);
        assert.ok(isLearned(m, skill));
        const without = { ...m, loadout: { ...m.loadout, [kind]: m.loadout[kind].filter((x) => x !== id) } };
        assert.equal(equipBlock(data, without, skill), '', `${sample.profile} / ${id}`);
        if (skill.isFinal) assert.equal(skill.job, m.job);
      }
    }
  }
});

test('8系統の主役に適した武器・付与・習得済みの相乗技能が含まれる', () => {
  const checks = [
    ['poison', 'dagger', 'DOT_POWER', 'apothecary_p2_s2'],
    ['bleed', 'scythe', 'DOT_POWER', 'warrior_p3_s3'],
    ['critical', 'katana', 'CRIT_DMG', 'monk_p2_s4'],
    ['weakness', 'bow', 'WEAK_DMG', 'hunter_p2_s4'],
    ['counter', 'hammer', 'COUNTER', 'knight_p3_s3'],
    ['spellblade', 'sword', 'WEAK_DMG', 'spellblade_p2_s2'],
    ['support', 'fan', 'PARTY_BUFF_POWER', 'bard_p1_s3'],
    ['healer', 'staff', 'MP_ON_HIT', 'white_mage_p1_s3'],
  ];
  for (const [profile, kind, family, skill] of checks) {
    const game = samples.find((s) => s.rank === 9 && s.profile === profile).prepared;
    const m = game.party[0];
    assert.equal(data.equipment.get(m.equip.weapon.id).kind, kind);
    assert.ok(Object.values(m.equip).filter(Boolean).some((g) => g.enchants?.some((e) => e.stat === family)), profile);
    assert.ok([...m.loadout.actions, ...m.loadout.passives].includes(skill), `${profile} / ${skill}`);
  }
});

test('最低★・無効な設定を拒否し、闘技場のボス差し替えとLv99比較を許容する', () => {
  assert.throws(() => prepareParty(data, dungeonFor(1), 'poison'), /★3/);
  assert.throws(() => prepareParty(data, dungeonFor(1), 'unknown'), /編成/);
  assert.throws(() => prepareParty(data, dungeonFor(1), 'balanced', 'standard', { stage: 0 }), /段階/);
  assert.throws(() => prepareParty(data, dungeonFor(1), 'balanced', 'standard', { level: 100 }), /レベル/);
  const dungeon = { ...dungeonFor(12), bossId: 'slime' };
  const game = prepareParty(data, dungeon, 'balanced', 'prepared', { level: 99, stage: 5 });
  assert.equal(game.simulationFixture.bossId, 'slime');
  assert.ok(game.party.every((m) => m.lv === 99));
  assert.ok(game.simulationFixture.gear.every((g) => g.enhancement <= 3));
});
