import { el } from '../dom.js?v=skill-growth-2';
import { worldGraph, worldNode, worldEntries } from '../world-journey.js?v=world-journey-1';

function svgElement(name, attrs, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

export function createJourneyMap({ data, game, season, currentKey }) {
  const graph = worldGraph(data, game, season);
  const places = [...graph.nodes, ...graph.stones];
  const point = id => places.find(p => (p.key ?? p.id) === id);
  const position = p => ({ x: 100 + p.x * 190, y: 65 + (p.y + 1) * 95 });
  const height = Math.max(250, ...places.map(p => position(p).y + 65));
  const svg = svgElement('svg', { viewBox: `0 0 790 ${height}`, role: 'img', 'aria-label': '発見した場所と道。金色は通った道、点線は未通過、赤は閉鎖中。' });
  const defs = svgElement('defs', {});
  for (const [id, color] of [['open', '#8795aa'], ['passed', '#e7bd6c'], ['closed', '#c78181']]) {
    const marker = svgElement('marker', { id: `journey-arrow-${id}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
    marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: color }));
    defs.append(marker);
  }
  svg.append(defs);
  // 同じ行き先の左右出口も記録は別々に保持。図では一本にまとめる。
  const grouped = new Map();
  for (const edge of graph.edges) {
    const key = `${edge.from}:${edge.to}`;
    const prev = grouped.get(key);
    grouped.set(key, prev ? { ...edge, label: prev.label + '・' + edge.label, passed: prev.passed || edge.passed } : edge);
  }
  for (const edge of grouped.values()) {
    const from = point(edge.from), to = point(edge.to);
    if (!from || !to) continue;
    const a = position(from), b = position(to);
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
    const type = !edge.open ? 'closed' : edge.passed ? 'passed' : 'open';
    const line = svgElement('path', { d: `M ${a.x + dx * 30 - dy * 6} ${a.y + dy * 30 + dx * 6} L ${b.x - dx * 34 - dy * 6} ${b.y - dy * 34 + dx * 6}`,
      class: `journey-edge ${type}`, 'marker-end': `url(#journey-arrow-${type})` });
    line.append(svgElement('title', {}, `${from.name} → ${to.name}：${edge.label}${edge.reason ? '・' + edge.reason : ''}`));
    svg.append(line);
  }
  for (const place of places) {
    const id = place.key ?? place.id, p = position(place), stone = !place.key;
    const reached = stone ? graph.map.stones.includes(place.id) : graph.map.visited.includes(place.key);
    const group = svgElement('g', { class: `journey-node${stone ? ' stone' : ''}${reached ? ' visited' : ''}${id === currentKey ? ' current' : ''}` });
    group.append(svgElement('rect', { x: p.x - 82, y: p.y - 28, width: 164, height: 56, rx: stone ? 15 : 5 }));
    group.append(svgElement('text', { x: p.x, y: p.y - 4, 'text-anchor': 'middle' }, stone ? place.name : `${place.key} ${place.name}`));
    group.append(svgElement('text', { x: p.x, y: p.y + 16, class: 'journey-sub', 'text-anchor': 'middle' }, stone
      ? reached ? 'ワープ解放済み' : '未到達'
      : id === currentKey ? '現在地' : reached ? '到達済み' : '未到達'));
    svg.append(group);
  }
  const routes = graph.edges.map(edge => el('li', {}, `${point(edge.from)?.name} → ${point(edge.to)?.name}（${edge.label}・${!edge.open ? edge.reason : edge.passed ? '通過済み' : '未通過'}）`));
  return el('section', { class: 'panel journey-map' },
    el('h3', {}, '探索の地図'), el('p', { class: 'muted small' }, '金色：通った道 ／ 点線：未通過 ／ 赤：閉鎖中'),
    el('div', { class: 'journey-map-scroll', tabindex: '0', 'aria-label': '地図を左右にスクロール' }, svg),
    el('details', {}, el('summary', {}, '発見した道を一覧で見る'), el('ul', { class: 'journey-route-list' }, routes)));
}

export function createJourneyDeparture({ data, game, season, selectedStone, selectedDungeon, onStone, onDungeon }) {
  const stones = data.worldRoutes.stones.filter(stone => game.worldJourney.stones.includes(stone.id));
  const entries = worldEntries(data, game, selectedStone);
  return el('section', { class: 'journey-departure' },
    el('h2', { class: 'chapter-title' }, 'ワールドマップ'),
    el('div', { class: 'journey-stones', role: 'group', 'aria-label': '出発するワールドストーン' }, stones.map(stone => el('button', {
      type: 'button', 'aria-pressed': String(stone.id === selectedStone), onclick: () => onStone(stone.id),
    }, stone.name))),
    el('p', { class: 'muted' }, selectedStone === data.worldRoutes.startStone ? '町から冒険に出発する。' : `${stones.find(s => s.id === selectedStone)?.name}へワープして出発する。`),
    entries.length ? el('div', { class: 'atlas-destinations', role: 'group', 'aria-label': '地域の入口' }, entries.map(node => el('button', {
      type: 'button', class: 'atlas-destination', 'aria-pressed': String(selectedDungeon === node.id), onclick: () => onDungeon(node.id),
    }, el('strong', {}, `${node.key} ${node.name}`), el('span', {}, `${node.battles}戦`))))
      : el('p', { class: 'panel', role: 'status' }, 'この地域の続きは準備中です。ワープの解放記録は保存されています。'),
    el('details', {}, el('summary', {}, '探索の地図を見る'), createJourneyMap({ data, game, season })));
}
