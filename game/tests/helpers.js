import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, stripBom } from '../js/csv.js';
import { buildLexicon } from '../js/lexicon.js';

export const dataPath = (name) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
export const readCsv = (name) => parseCsv(readFileSync(dataPath(name), 'utf8'));
export const readJson = (name) => JSON.parse(stripBom(readFileSync(dataPath(name), 'utf8')));
export const realLexicon = () => buildLexicon(readCsv('rune_stones.csv').rows, readCsv('lexicon.csv').rows);

export class MemoryStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

/** 決まった順の乱数 */
export function seededRng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
export const DAY = 86400000;
export const T0 = new Date(2026, 10, 21, 12, 0, 0).getTime();
