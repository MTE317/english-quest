import { roundGold } from './gold.js?v=skill-growth-2';
import { maxHp, maxMp } from './character.js?v=advanced-jobs-1';
import { monsterPool } from './encounter.js?v=tactical-jobs-1';
import { addItem, rollGearDrop } from './loot.js?v=advanced-jobs-1';

export function planExploration(config, dungeonId, route, rng) {
  if (!config) return [];
  const floors = route.slice(0, -1).map(({ floor }) => floor);
  const battles = route.reduce((total, row) => total + row.battles, 0);
  const slots = config.slots[battles] ?? [];
  const plan = (Object.hasOwn(config.fixed, dungeonId) ? config.fixed[dungeonId] : [])
    .filter(({ floor }) => floors.includes(floor))
    .map((event) => ({ ...event }));
  for (const [index, rate] of slots.entries()) {
    if (!floors.length || rng() >= rate) continue;
    const floor = floors.splice(Math.floor(rng() * floors.length), 1)[0];
    plan.push({ id: `random-${index + 1}`, floor, type: weightedType(config.weights, rng) });
  }
  return plan.map((event) => ({ ...event, rng: Math.floor(rng() * 2 ** 32) }));
}

function weightedType(weights, rng) {
  const entries = Object.entries(weights).filter(([, weight]) => weight > 0);
  let draw = rng() * entries.reduce((total, [, weight]) => total + weight, 0);
  return entries.find(([, weight]) => (draw -= weight) < 0)?.[0];
}

// These records are staged in the run and committed only when its pack is unloaded.
export function commitExploration(game, records) {
  if (!records?.length) return;
  game.exploration ??= { events: {}, discoveries: {} };
  for (const { key, discovery, flag } of records) {
    game.exploration.events[key] = true;
    if (discovery) game.exploration.discoveries[discovery] = true;
    if (flag) {
      game.worldFlags ??= {};
      game.worldFlags[flag] = true;
    }
  }
}

export function explorationEntryAllowed(config, game, dungeonId) {
  const gates = config?.entry;
  if (!gates || !Object.hasOwn(gates, dungeonId)) return true;
  const { discovery, flags = [], cleared = [] } = gates[dungeonId];
  return (!discovery || game.exploration?.discoveries[discovery] === true)
    && flags.every((flag) => game.worldFlags?.[flag] === true)
    && cleared.every((id) => game.cleared?.[id] > 0);
}

function localMaterials(data, dungeon, season) {
  const pool = monsterPool(data, dungeon.id, season);
  return [...new Set(pool.map((monster) => monster.materialCommon))].filter((id) => {
    const material = data.materials.get(id);
    return material?.kind === 'common' && material.rank <= dungeon.rank
      && (!material.season || material.season === season);
  });
}

export function resolveExploration(data, game, run, floor, season, rngForEvent, receiveLoot) {
  const config = data.balance.dungeon?.exploration;
  const events = run.explorationPlan?.filter((event) => event.floor === floor) ?? [];
  run.explorationNotices = [];
  if (!config || !events.length) return;
  const dungeon = data.dungeons.get(run.dungeonId);
  const materials = localMaterials(data, dungeon, season);
  for (const event of events) {
    if (event.requiredStory && !game.explorationStories?.[event.requiredStory]) continue;
    const key = `${run.dungeonId}:${event.id}`;
    const once = event.first || event.type === 'discover' || event.type === 'investigate';
    if (once && (game.exploration?.events[key] || run.explorationRecords?.some((record) => record.key === key))) continue;
    const rng = rngForEvent({ rng: event.rng });
    const loot = { gold: 0, gear: [], materials: [] };
    const notice = { type: event.type, first: Boolean(event.first), gold: 0 };
    if (event.type === 'discover') notice.discovery = event.discovery;
    if (event.type === 'rest') {
      notice.hp = 0;
      notice.mp = 0;
      for (const member of game.party.filter((m) => m.hp > 0)) {
        const hp = maxHp(data, member);
        const mp = maxMp(data, member);
        const recoveredHp = Math.max(0, Math.min(hp - member.hp, Math.floor(hp * config.rest.hp)));
        const recoveredMp = Math.max(0, Math.min(mp - member.mp, Math.floor(mp * config.rest.mp)));
        member.hp += recoveredHp;
        member.mp += recoveredMp;
        notice.hp += recoveredHp;
        notice.mp += recoveredMp;
      }
    } else if (event.type === 'chest' || event.type === 'gather') {
      const reward = event.type === 'gather' ? 'material'
        : event.first ? 'gold' : weightedType(config.chest.weights, rng);
      if ((reward === 'material' || event.first) && materials.length) {
        const id = materials.includes(event.material) ? event.material : materials[Math.floor(rng() * materials.length)];
        loot.materials.push({ id, count: event.first ? config.chest.first_materials : 1 });
      }
      if (reward === 'item' && data.items.has(config.chest.item)
          && addItem(game, config.chest.item, 1) === 0) notice.item = config.chest.item;
      if (reward === 'gear') {
        const gear = rollGearDrop(data, game, dungeon.id, floor, rng, { commonOnly: true });
        if (gear) loot.gear.push(gear);
      }
      const income = data.economy.get(dungeon.rank).run_income * dungeon.incomeMul;
      if (reward === 'gold' || (event.type === 'chest' && !loot.gear.length && !loot.materials.length && !notice.item)) {
        loot.gold = roundGold(data, income * (event.first ? config.chest.first_gold : config.chest.gold), 'floor');
      }
      receiveLoot(data, game, run, loot);
      Object.assign(notice, loot);
    }
    if (once) {
      run.explorationRecords ??= [];
      run.explorationRecords.push({ key, discovery: event.discovery, flag: event.flag });
    }
    run.explorationNotices.push(notice);
  }
}

