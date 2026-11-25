import { unlockFootsteps, playDungeonFootstep } from '../dungeon-footsteps.js?v=unified-ap-1';

let active = null;

// 入場の連打を防ぎ、暗転中にだけゲーム画面を切り替える。
export function playDungeonEntrance(name, enter) {
  if (active) return active;
  active = runEntrance(name, enter).finally(() => { active = null; });
  return active;
}

async function runEntrance(name, enter) {
  unlockFootsteps();
  const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const overlay = document.createElement('div');
  overlay.className = `dungeon-entrance${reduced ? ' reduced-motion' : ''}`;
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  const title = document.createElement('div');
  title.className = 'dungeon-entrance-title';
  title.textContent = name;
  overlay.append(title);
  const previousFocus = document.activeElement;
  const blocked = [...document.body.children].map(node => [node, node.inert]);
  const timers = [];
  let frame;
  const wait = ms => new Promise(resolve => timers.push(setTimeout(resolve, ms)));
  try {
    for (const [node] of blocked) node.inert = true;
    document.body.append(overlay);
    const radius = Math.hypot(window.innerWidth, window.innerHeight);
    overlay.style.setProperty('--entry-radius', `${radius}px`);
    const started = performance.now();
    const close = time => {
      const progress = Math.min(1, (time - started) / 1120);
      overlay.style.setProperty('--entry-radius', `${radius * (1 - progress) ** 1.6}px`);
      if (progress < 1) frame = requestAnimationFrame(close);
    };
    if (!reduced) frame = requestAnimationFrame(close);
    // タイマーで刻み、音声が使えなくても同じテンポで進める。
    for (const delay of [100, 450, 800]) timers.push(setTimeout(() => {
      playDungeonFootstep();
      if (!reduced) {
        overlay.classList.remove('step');
        void overlay.offsetWidth;
        overlay.classList.add('step');
      }
    }, delay));
    await wait(1150);
    overlay.classList.add('closed');
    overlay.classList.add('named');
    await wait(130);
    await enter();
    await wait(1260);
    overlay.classList.add('reveal');
    await wait(reduced ? 120 : 340);
  } finally {
    cancelAnimationFrame(frame);
    timers.forEach(clearTimeout);
    overlay.remove();
    for (const [node, inert] of blocked) node.inert = inert;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
}

