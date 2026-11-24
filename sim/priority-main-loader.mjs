import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// main ca4ebba: the merge of #44 and #45 dropped dungeonRegion's closing brace.
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith('file:')) return result;
    const path = new URL(url).pathname;
    if (path.endsWith('/game/js/character.js') && process.env.EQ_SIM_CACHE === '1') {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      const original = 'export function affixSum(member, key) {';
      if (!source.includes(original)) throw Error('character memoization target changed');
      const cached = `const simAffixes = new WeakMap();
export function affixSum(member, key) {
  if (!member.priorityStaticLoadout) return uncachedAffixSum(member, key);
  if (!simAffixes.has(member)) simAffixes.set(member, new Map());
  const values = simAffixes.get(member);
  if (!values.has(key)) values.set(key, uncachedAffixSum(member, key));
  return values.get(key);
}
function uncachedAffixSum(member, key) {`;
      return { ...result, source: source.replace(original, cached) };
    }
    if (path.endsWith('/game/js/growth.js') && process.env.EQ_SIM_CACHE === '1') {
      const source = readFileSync(fileURLToPath(url), 'utf8');
      const original = 'export function memberMods(data, member) {';
      if (!source.includes(original)) throw Error('growth memoization target changed');
      // The priority harness fixes equipment, learned skills, mastery bonuses,
      // common tree and passive loadout for each actor after fixture creation.
      const cached = `const simMods = new WeakMap();
export function memberMods(data, member) {
  if (!member.priorityStaticLoadout) return uncachedMemberMods(data, member);
  if (!simMods.has(data)) simMods.set(data, new WeakMap());
  const members = simMods.get(data);
  if (!members.has(member)) members.set(member, uncachedMemberMods(data, member));
  return members.get(member);
}
function uncachedMemberMods(data, member) {`;
      return { ...result, source: source.replace(original, cached) };
    }
    if (!path.endsWith('/game/js/dungeon.js')) return result;
    const source = readFileSync(fileURLToPath(url), 'utf8');
    const boundary = /\]\[Math\.floor\(\(dungeon\.rank - 1\) \/ 3\)\];(\r?\n)(?=\/\*\* 同じ★)/;
    if (!boundary.test(source)) return result;
    process.stderr.write('Simulation loader: restored dungeonRegion closing brace in memory.\n');
    return { ...result, source: source.replace(boundary, '$&}$1') };
  },
});
