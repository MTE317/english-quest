// データ確認画面：data/ のファイルごとの行数と、中身の表
import { loadFiles, loadJson } from '../data.js?v=paid-skills-1';
import { splitList, parseAmounts } from '../csv.js?v=paid-skills-1';
import { buildLearningCatalog, FEATURED_SET_ID } from '../learning-catalog.js?v=paid-skills-1';
import { Scheduler } from '../srs.js?v=paid-skills-1';
import { el, render } from '../dom.js?v=paid-skills-1';

const view = document.getElementById('view');
let loaded = null;
let DATA_FILES = []; // data/manifest.json の一覧

function summaryOf(file) {
  if (file.type === 'csv') return `${file.rows.length}行・${file.header.length}列`;
  const keys = Object.keys(file.data ?? {});
  return `JSON・項目 ${keys.length}`;
}

function checks(files) {
  const notes = [];
  const keys = {
    words: 'learning/v1/words.csv',
    phrases: 'learning/v1/phrases.csv',
    chunks: 'learning/v1/chunks.csv',
    categories: 'learning/v1/categories.csv',
    wordCategories: 'learning/v1/word_categories.csv',
    phraseCategories: 'learning/v1/phrase_categories.csv',
  };
  if (Object.values(keys).every((key) => files[key])) {
    try {
      const catalog = buildLearningCatalog(Object.fromEntries(
        Object.entries(keys).map(([key, filename]) => [key, files[filename].rows]),
      ));
      notes.push(`教材v${catalog.version}：単語 ${catalog.words.length}語・瞬間英作文 ${catalog.phrases.length}文・チャンク ${catalog.chunks.length}型`);
      notes.push(`7メイン・${catalog.subcategories.length}サブ、00の最優先 ${catalog.wordsByStone.get(FEATURED_SET_ID).length}語・${catalog.phrasesByStone.get(FEATURED_SET_ID).length}文`);
    } catch (error) { notes.push(`学習教材エラー：${error.message}`); }
  }
  const srs = files['srs.json'];
  if (srs) {
    const sch = new Scheduler(srs.data);
    if (sch.usedFallbacks.length) {
      notes.push(`srs.json にない項目（ゲーム側の仮の値を使用）：${sch.usedFallbacks.join(', ')}`);
    }
  }
  return notes;
}

function showList() {
  const { files, failures } = loaded;
  const okCount = Object.keys(files).length;
  const totalRows = Object.values(files).reduce((a, f) => a + (f.rows?.length ?? 0), 0);
  const notes = checks(files);
  render(view,
    el('div', { class: 'panel' },
      el('div', {}, `読み込んだファイル：${okCount} / ${DATA_FILES.length}`),
      el('div', { class: 'muted' }, `CSV の行数の合計：${totalRows}`),
      Object.keys(failures).length ? el('div', { class: 'error' }, `読めなかったファイル：${Object.keys(failures).length}`) : null,
    ),
    notes.length ? el('details', { class: 'panel' },
      el('summary', {}, '教材と設定の確認'),
      el('div', { class: 'small' }, notes.map((t) => el('div', {}, t))),
    ) : null,
    el('ul', { class: 'choice-list' },
      DATA_FILES.map((name) => {
        const f = files[name];
        const failure = failures[name];
        const errs = f?.errors?.length ?? 0;
        return el('li', {},
          el('button', { onclick: () => f && showFile(name), disabled: !f },
            el('div', { class: 'choice-title' }, name),
            el('div', { class: 'stats' },
              failure ? el('span', { class: 'error' }, failure) : el('span', {}, summaryOf(f)),
              errs ? el('span', { class: 'error' }, `おかしな行 ${errs}`) : null,
            ),
          ));
      }),
    ),
  );
}

/** セルを分解して見せる：「素材ID:個数」は「ID × 個数」、| 区切りは1行ずつ */
function cellNode(value, split) {
  if (!split || !value.includes('|') && !/^[A-Za-z0-9_]+:\d/.test(value)) return value;
  if (value.trim().startsWith('{') || value.trim().startsWith('[')) return value;
  let parts;
  try {
    parts = /^[A-Za-z0-9_]+:[\d.]+(\|[A-Za-z0-9_]+:[\d.]+)*$/.test(value)
      ? parseAmounts(value).map((a) => `${a.id} × ${a.count}`)
      : splitList(value);
  } catch {
    parts = splitList(value);
  }
  return el('div', {}, parts.map((p) => el('div', {}, `・${p}`)));
}

function showFile(name) {
  const f = loaded.files[name];
  const back = el('button', { class: 'ghost', onclick: showList }, '← ファイルの一覧へ');
  if (f.type === 'json') {
    render(view, back, el('h2', {}, name), el('pre', { class: 'json' }, JSON.stringify(f.data, null, 1)));
    return;
  }
  let query = '';
  let split = false;
  const tableHolder = el('div');
  const count = el('div', { class: 'muted small' });
  const draw = () => {
    const q = query.trim().toLowerCase();
    const rows = q ? f.rows.filter((r) => f.header.some((h) => r[h].toLowerCase().includes(q))) : f.rows;
    count.textContent = `${rows.length} / ${f.rows.length}行`;
    render(tableHolder, el('div', { class: 'table-wrap' },
      el('table', {},
        el('thead', {}, el('tr', {}, f.header.map((h) => el('th', {}, h)))),
        el('tbody', {}, rows.map((r) => el('tr', {}, f.header.map((h) => el('td', {}, cellNode(r[h], split)))))),
      )));
  };
  render(view,
    back,
    el('h2', {}, name),
    el('div', { class: 'muted small' }, `${f.rows.length}行・${f.header.length}列`),
    f.errors.length ? el('div', { class: 'panel error small' }, f.errors.map((e) => el('div', {}, e))) : null,
    el('input', { type: 'search', placeholder: '絞り込み（どの列でも）', oninput: (e) => { query = e.target.value; draw(); } }),
    el('label', { class: 'small', style: 'display:flex;align-items:center;gap:8px;min-height:44px' },
      el('input', { type: 'checkbox', onchange: (e) => { split = e.target.checked; draw(); } }),
      '「|」区切りと「素材ID:個数」を分解して見る'),
    count,
    tableHolder,
  );
  draw();
  window.scrollTo(0, 0);
}

(async () => {
  try {
    DATA_FILES = (await loadJson('manifest.json')).data;
    loaded = await loadFiles(DATA_FILES);
    showList();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
  }
})();

