// data/balance.json の式（"70 + g*30 + (Lv-1)*g*9" など）を計算する。eval は使わない。
// 使えるもの：数、変数（英字・日本語。a.b や hp_rank_mul[★] のような名前も1つの変数）、+ - * / ^、かっこ、min / max / round / floor / ceil / abs / sqrt
// 式として読めない文字列（説明の文が混ざっているもの）は例外を投げる。

const FUNCS = {
  min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt,
};

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([\p{L}_][\p{L}\p{N}_.]*(?:\[[^\]\s]*\])?)|(\*\*|[-+*/^(),]))/uy;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`式として読めない：「${src}」の ${pos + 1} 文字目`);
    if (m[1] != null) tokens.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] != null) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
    pos = re.lastIndex;
  }
  return tokens;
}

/** 式を読んで、変数を渡すと計算する関数を返す */
export function compile(src) {
  const tokens = tokenize(String(src));
  let i = 0;
  const peek = () => tokens[i];
  const eat = (v) => {
    const tk = tokens[i];
    if (!tk || tk.v !== v) throw new Error(`式として読めない：「${src}」（${v} がない）`);
    i++;
  };
  // 文法：expr = term (('+'|'-') term)* ; term = unary (('*'|'/') unary)* ; unary = '-' unary | power ; power = atom ('^' unary)?
  const expr = () => {
    let node = term();
    while (peek()?.t === 'op' && (peek().v === '+' || peek().v === '-')) {
      const op = tokens[i++].v; const l = node; const r = term();
      node = op === '+' ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
    }
    return node;
  };
  const term = () => {
    let node = unary();
    while (peek()?.t === 'op' && (peek().v === '*' || peek().v === '/')) {
      const op = tokens[i++].v; const l = node; const r = unary();
      node = op === '*' ? (env) => l(env) * r(env) : (env) => l(env) / r(env);
    }
    return node;
  };
  const unary = () => {
    if (peek()?.t === 'op' && peek().v === '-') { i++; const n = unary(); return (env) => -n(env); }
    if (peek()?.t === 'op' && peek().v === '+') { i++; return unary(); }
    return power();
  };
  const power = () => {
    const base = atom();
    if (peek()?.t === 'op' && peek().v === '^') { i++; const ex = unary(); return (env) => base(env) ** ex(env); }
    return base;
  };
  const atom = () => {
    const tk = tokens[i++];
    if (!tk) throw new Error(`式として読めない：「${src}」（途中で終わっている）`);
    if (tk.t === 'num') return () => tk.v;
    if (tk.t === 'op' && tk.v === '(') { const n = expr(); eat(')'); return n; }
    if (tk.t === 'id') {
      if (peek()?.t === 'op' && peek().v === '(') {
        const fn = FUNCS[tk.v];
        if (!fn) throw new Error(`式として読めない：「${src}」（${tk.v} という関数はない）`);
        i++;
        const args = [];
        if (!(peek()?.t === 'op' && peek().v === ')')) {
          args.push(expr());
          while (peek()?.t === 'op' && peek().v === ',') { i++; args.push(expr()); }
        }
        eat(')');
        return (env) => fn(...args.map((a) => a(env)));
      }
      const name = tk.v;
      return (env) => {
        const v = env[name];
        if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`式「${src}」の ${name} に数が入っていない`);
        return v;
      };
    }
    throw new Error(`式として読めない：「${src}」（${tk.v}）`);
  };
  const root = expr();
  if (i < tokens.length) throw new Error(`式として読めない：「${src}」（${tokens[i].v} 以降）`);
  return root;
}

const cache = new Map();
/** 式を計算する（同じ式は1回だけ読む） */
export function evaluate(src, env = {}) {
  let fn = cache.get(src);
  if (!fn) { fn = compile(src); cache.set(src, fn); }
  return fn(env);
}

/** 式として読めるか */
export function isFormula(src) {
  try { compile(src); return true; } catch { return false; }
}
