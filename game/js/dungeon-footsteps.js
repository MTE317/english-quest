import { loadSettings } from './storage.js?v=paid-skills-1';

let context;
let buffer;
let resume;

// 入場ボタンのタップ中に音声を有効にする。既存の効果音設定を共有する。
export function unlockFootsteps() {
  try {
    if (loadSettings().effects === 'off') return;
    const Audio = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state !== 'running') resume = context.resume().catch(() => {});
  } catch {}
}

function makeFootstep(audio) {
  const rate = audio.sampleRate;
  const result = audio.createBuffer(1, Math.round(rate * 0.18), rate);
  const samples = result.getChannelData(0);
  let seed = 31;
  let low = 0;
  for (let i = 0; i < samples.length; i++) {
    const t = i / rate;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    low += (seed / 2 ** 31 - 1 - low) * 0.2;
    // 靴底の短い打音と、少し遅れて返る小さな反響。
    const dry = (low * 0.65 + Math.sin(2 * Math.PI * 135 * t) * 0.35)
      * Math.min(1, t / 0.003) * Math.exp(-t / 0.022);
    const echo = t > 0.055 ? low * 0.18 * Math.exp(-(t - 0.055) / 0.035) : 0;
    samples[i] = (dry + echo) * 0.65 * Math.min(1, (0.18 - t) / 0.02);
  }
  return result;
}

export async function playDungeonFootstep() {
  try {
    if (loadSettings().effects === 'off') return;
    if (context?.state !== 'running') await resume;
    if (context?.state !== 'running' || loadSettings().effects === 'off') return;
    buffer ??= makeFootstep(context);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
  } catch {
    // 音声を利用できない環境でも入場演出を続ける。
  }
}

