// データ確認画面：data/ のファイルごとの行数と、中身の表
import { DATA_FILES } from '../manifest.js';
import { loadFiles } from '../data.js';
import { splitList, parseAmounts } from '../csv.js';
import { buildLexicon } from '../lexicon.js';
import { Scheduler } from '../srs.js';
import { el, render } from '../dom.js';

const view = document.getElementById('view');
let loaded = null;

function summaryOf(file) {
  if (file.type === 'csv') return `${file.rows.length}行・${file.header.length}列`;
  const keys = Object.keys(file.data ?? {});
  return `JSON・項目 ${keys.length}`;
}

function checks(files) {
  const notes = [];
  const stones = files['rune_stones.csv'];
  const lexicon = files['lexicon.csv'];
  if (stones && lexicon) {
    const lex = buildLexicon(stones.rows, lexicon.rows);
    notes.push(`ルーンストーン ${lex.stones.length}個・ルーン ${lex.words.length}語`);
    for (const s of lex.stones) {
      const n = lex.wordsByStone.get(s.id)?.length ?? 0;
      const warn = s.size && n !== s.size ? `（size は ${s.size}）` : '';
      notes.push(`　${s.id}：${n}語${warn}`);
    }
    notes.push(...lex.problems);
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
      el('summary', {}, 'ルーンと設定の確認'),
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
    loaded = await loadFiles(DATA_FILES);
    showList();
  } catch (e) {
    render(view, el('p', { class: 'error' }, `読み込みに失敗：${e.message}`));
  }
})();
