// CSV の読み込みと、セルの分解（| 区切り・「素材ID:個数」）
// data/README.md の決まりに合わせている：UTF-8（BOM つき）、1行目は見出し、1列目は英字の ID。

/** 先頭の BOM（U+FEFF）を取り除く */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * CSV の文字列を2次元配列にする（RFC 4180 相当：" で囲んだセル、"" のエスケープ、セル内の改行・カンマ）。
 * 改行は \n / \r\n / \r のどれでもよい。
 */
export function parseCsvRecords(text) {
  text = stripBom(text);
  const records = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldQuoted = false;
  const n = text.length;
  const endRow = () => {
    row.push(field);
    // 空行（セルが1つで空）は飛ばす
    if (!(row.length === 1 && row[0] === '' && !fieldQuoted)) records.push(row);
    row = [];
    field = '';
    fieldQuoted = false;
  };
  for (let i = 0; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') { inQuotes = true; fieldQuoted = true; }
    else if (c === ',') { row.push(field); field = ''; fieldQuoted = false; }
    else if (c === '\n') endRow();
    else if (c === '\r') { if (text[i + 1] === '\n') i++; endRow(); }
    else field += c;
  }
  if (field !== '' || row.length > 0 || fieldQuoted) endRow();
  return records;
}

/**
 * CSV を「見出しをキーにしたオブジェクトの配列」にする。値はすべて文字列のまま。
 * 列の数が見出しと合わない行は errors に入れる（行番号は見出しを1行目として数える）。
 */
export function parseCsv(text) {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { header: [], rows: [], errors: ['空のファイル'] };
  const header = records[0].map((h) => h.trim());
  const rows = [];
  const errors = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length !== header.length) {
      errors.push(`${r + 1}行目：列の数が ${rec.length}（見出しは ${header.length}）`);
    }
    const obj = {};
    header.forEach((h, i) => { obj[h] = rec[i] ?? ''; });
    rows.push(obj);
  }
  return { header, rows, errors };
}

/** `fire|slash` → ['fire', 'slash']。空のセルは []。 */
export function splitList(cell) {
  if (cell == null) return [];
  return String(cell).split('|').map((s) => s.trim()).filter((s) => s !== '');
}

/**
 * `goblin_mat:2|cave_rat_mat:2` → [{ id: 'goblin_mat', count: 2 }, ...]
 * 個数が書かれていないもの（`goblin_mat`）は1個として扱う。数字でない個数は例外にする。
 */
export function parseAmounts(cell) {
  return splitList(cell).map((part) => {
    const idx = part.lastIndexOf(':');
    if (idx < 0) return { id: part, count: 1 };
    const id = part.slice(0, idx).trim();
    const countText = part.slice(idx + 1).trim();
    const count = Number(countText);
    if (!id || countText === '' || !Number.isFinite(count)) {
      throw new Error(`「素材ID:個数」の形ではない：${part}`);
    }
    return { id, count };
  });
}

/** 数字に見えるセルは数にする。空のセルは null、それ以外は文字列のまま。 */
export function toValue(cell) {
  if (cell == null) return null;
  const t = String(cell).trim();
  if (t === '') return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return Number(t);
  return t;
}

/** 数として読む。空や数でないときは fallback。 */
export function toNumber(cell, fallback = null) {
  const v = toValue(cell);
  return typeof v === 'number' ? v : fallback;
}
