import { loadSettings } from './storage.js?v=paid-skills-1';

let context;
let resume;
const buffers = new Map();

function makeHitBuffer(audio, kind) {
  const weak = kind === 'weak';
  const resist = kind === 'resist';
  const duration = weak ? 0.25 : 0.16;
  const rate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.round(rate * duration), rate);
  const samples = buffer.getChannelData(0);
  const lowCut = 1 - Math.exp(-2 * Math.PI * 420 / rate);
  let seed = 19;
  let high = 0;
  let low = 0;
  let phase = 0;

  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const noise = seed / 2 ** 31 - 1;
    // 高い音を落としながら、空を切る音と命中直後のざらつきを重ねる。
    const cutoff = (resist ? 500 : 1100) + (resist ? 1250 : 5200) * Math.exp(-t / 0.042);
    high += (noise - high) * (1 - Math.exp(-2 * Math.PI * cutoff / rate));
    low += (high - low) * lowCut;
    phase += 2 * Math.PI * (75 + (resist ? 70 : 145) * Math.exp(-t / 0.025)) / rate;
    const sweep = Math.min(1, t / 0.006) * Math.exp(-t / 0.05);
    const impactTime = Math.max(0, t - 0.014);
    const impact = Math.min(1, impactTime / 0.002) * Math.exp(-impactTime / 0.023);
    const fade = Math.min(1, (duration - t) / 0.022);
    const ring = weak && t > 0.022
      ? (Math.sin(2 * Math.PI * 1120 * t) + 0.35 * Math.sin(2 * Math.PI * 1780 * t)) * 0.12 * Math.exp(-(t - 0.022) / 0.075)
      : 0;
    samples[i] = ((high - low) * (0.24 * sweep + 0.41 * impact) +
      Math.sin(phase) * (resist ? 0.31 : 0.23) * impact + ring) * fade;
  }
  return buffer;
}

function makeButtonBuffer(audio) {
  const rate = audio.sampleRate;
  const buffer = audio.createBuffer(1, Math.round(rate * 0.068), rate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    const note = t < 0.025 ? 740 : 990;
    const elapsed = t < 0.025 ? t : t - 0.025;
    const phase = 2 * Math.PI * note * elapsed;
    const envelope = Math.min(1, elapsed / 0.004, (samples.length - i) / (rate * 0.008)) * Math.exp(-t / 0.045);
    samples[i] = (Math.sin(phase) + 0.26 * Math.sin(2 * phase)) * 0.12 * envelope;
  }
  return buffer;
}

// スマホでも、タップやキーでボタンを押したときに音を有効にする。
export function unlockBattleSound() {
  try {
    if (loadSettings().effects === 'off') return;
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state !== 'running' && !resume) {
      resume = context.resume().catch(() => {}).finally(() => { resume = null; });
    }
  } catch {
    // 音声を利用できない環境でも戦闘は続ける。
  }
}

async function playEffect(kind, delay = 0) {
  try {
    if (loadSettings().effects === 'off') return;
    if (context?.state !== 'running') await resume;
    if (context?.state !== 'running') return;
    if (!buffers.has(kind)) buffers.set(kind, kind === 'button' ? makeButtonBuffer(context) : makeHitBuffer(context, kind));
    const source = context.createBufferSource();
    source.buffer = buffers.get(kind);
    source.connect(context.destination);
    source.start(context.currentTime + delay);
  } catch {
    // ブラウザが音声の再生を制限している場合はそのまま進める。
  }
}

export function playBattleHitSound(kind = 'normal', delay = 0) {
  return playEffect(kind, delay);
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (event) => {
    const control = event.target.closest?.('button:not(:disabled), summary, a.btn, a.town-card, a.back, .town-actions a');
    if (!control || event.defaultPrevented || loadSettings().effects === 'off') return;
    unlockBattleSound();
    playEffect('button');

    // 同じゲーム内のリンクでは短い決定音が切れる前に移動する。
    if (!context || control.tagName !== 'A' || control.target || control.download ||
        event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
        control.origin !== location.origin || control.pathname === location.pathname) return;
    event.preventDefault();
    setTimeout(() => location.assign(control.href), 75);
  });
}

