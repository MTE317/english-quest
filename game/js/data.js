// data/ の CSV と JSON を読み込む。
import { parseCsv, stripBom } from './csv.js?v=unified-ap-1';

// game/js/data.js から見た data/ の場所（GitHub Pages でもローカルでも同じ相対位置）
const DATA_BASE = new URL('../../data/', import.meta.url);

export function dataUrl(name) {
  return new URL(name, DATA_BASE).href;
}

async function fetchText(name) {
  let res;
  try {
    res = await fetch(dataUrl(name), { cache: 'no-cache' });
  } catch (e) {
    throw new Error(`${name} を読み込めない（file:// で開いていないか確認。ローカルでは http サーバーで開く）：${e.message}`);
  }
  if (!res.ok) throw new Error(`${name} を読み込めない（HTTP ${res.status}）`);
  return res.text();
}

/** CSV を読む → { name, type:'csv', header, rows, errors } */
export async function loadCsv(name) {
  const text = await fetchText(name);
  return { name, type: 'csv', ...parseCsv(text) };
}

/** JSON を読む（BOM があっても読めるようにする） → { name, type:'json', data } */
export async function loadJson(name) {
  const text = await fetchText(name);
  return { name, type: 'json', data: JSON.parse(stripBom(text)) };
}

export function loadFile(name) {
  return name.toLowerCase().endsWith('.json') ? loadJson(name) : loadCsv(name);
}

/**
 * いくつかのファイルをまとめて読む。1つ失敗してもほかは読む。
 * → { files: { 名前: 結果 }, failures: { 名前: エラーメッセージ } }
 */
export async function loadFiles(names) {
  const results = await Promise.allSettled(names.map(loadFile));
  const files = {};
  const failures = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') files[names[i]] = r.value;
    else failures[names[i]] = r.reason?.message ?? String(r.reason);
  });
  return { files, failures };
}

/** 別管理のコンテンツはファイルが存在する公開環境だけで読み込む。 */
export async function loadOptional(name) {
  try { return await loadFile(name); }
  catch (error) {
    if (error.message.endsWith('（HTTP 404）')) return null;
    throw error;
  }
}

