// 画面を組み立てる小さな道具
/** el('button', { class: 'primary', onclick }, '押す') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}
export function render(root, ...children) {
  root.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
}
export function stars(n) { return '★'.repeat(Math.max(0, n)); }
