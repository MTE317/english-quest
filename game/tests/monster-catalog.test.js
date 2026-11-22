import test from 'node:test';
import assert from 'node:assert/strict';
import { readCsv, realGameData } from './helpers.js';
import { monsterPool, makeEncounter } from '../js/encounter.js';
const counts = (rows, key) => rows.reduce((a, row) => (a[row[key]] = (a[row[key]] ?? 0) + 1, a), {});
test('モンスター図鑑は1,024体、既存のカテゴリと新闘技場ボスを保持', () => {
  const data = realGameData(), rows = readCsv('monsters.csv').rows;
  assert.equal(rows.length, 1024);
  assert.equal(data.monsters.size, 1024);
  assert.deepEqual(counts(rows,'role'), { normal:663, season:240, boss:60, bounty:48, arena:13 });
  for (const row of rows) {
    assert.equal(new Set(row.types.split('|')).size, row.types.split('|').length);
    for (const type of row.types.split('|')) assert.ok(data.monsterTypes.has(type), row.id + ': ' + type);
    for (const element of [...row.weak.split('|'),...row.resist.split('|')].filter(Boolean)) assert.ok(data.elements.has(element), row.id + ': ' + element);
    for (const x of row.weak.split('|').filter(Boolean)) assert.ok(!row.resist.split('|').includes(x), row.id + ': duplicated affinity ' + x);
    if (row.status) assert.ok(data.statusEffects.has(row.status),row.id + ': ' + row.status);
    for (const mid of [row.material_common, row.material_rare].filter(Boolean)) assert.ok(data.materials.has(mid),row.id + ': ' + mid);
  }
});
test('60ダンジョンで通常・季節エンカウントし、闘技場専用ボスは登場しない', () => {
  const data = realGameData();
  for (const d of data.dungeons.values()) for (const season of ['spring','summer','autumn','winter']) {
    const pool = monsterPool(data, d.id, season);
    assert.ok(pool.length >= 10, d.id + ': ' + season);
    assert.ok(pool.every(m=>m.role==='normal'||(m.role==='season'&&m.season===season)));
    assert.ok(!pool.some(m=>m.role==='arena'));
    const battle = makeEncounter(data,d.id,1,()=>.24,{season});
    assert.ok(battle.length>0);
  }
});
test('13階級・65戦と固有装備・交換リストの参照が有効',()=>{
  const data=realGameData(),tiers=readCsv('arena_tiers.csv').rows,battles=readCsv('arena_battles.csv').rows,shop=readCsv('arena_shop.csv').rows;
  assert.equal(tiers.length,13);assert.equal(battles.length,65);assert.equal(shop.length,13);
  for(const t of tiers){
    assert.ok(data.equipment.has(t.gear_id));
    const bs=battles.filter(b=>b.tier_id===t.id).sort((a,b)=>Number(a.battle)-Number(b.battle));
    assert.equal(bs.length,5);
    assert.deepEqual(bs.map(x=>Number(x.battle)),[1,2,3,4,5]);
    for(const b of bs)for(const token of b.enemies.split('|')){
      const [id,lv]=token.split(':');
      assert.ok(data.monsters.has(id),id);
      assert.ok(Number.isInteger(Number(lv))&&Number(lv)>0,id);
    }
    assert.equal(data.monsters.get(bs[4].enemies.split(':')[0]).role,'arena');
  }
  for(const row of shop)assert.ok(data.equipment.has(row.gear_id));
});
test('新素材の参照元が有効',()=>{
  const data=realGameData(),rows=readCsv('materials.csv').rows;
  assert.ok(rows.length>=768);
  for(const row of rows)if(row.source_monster)assert.ok(data.monsters.has(row.source_monster),row.id+' -> '+row.source_monster);
});
