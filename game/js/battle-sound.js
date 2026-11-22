// 短い斬撃音を合成し、同じ音をすべての命中で使う。
let context;
let resume;
let hitBuffer;

function makeHitBuffer(audio) {
  const duration = 0.16;
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
    const cutoff = 1100 + 5200 * Math.exp(-t / 0.042);
    high += (noise - high) * (1 - Math.exp(-2 * Math.PI * cutoff / rate));
    low += (high - low) * lowCut;
    phase += 2 * Math.PI * (75 + 145 * Math.exp(-t / 0.025)) / rate;
    const sweep = Math.min(1, t / 0.006) * Math.exp(-t / 0.05);
    const impactTime = Math.max(0, t - 0.014);
    const impact = Math.min(1, impactTime / 0.002) * Math.exp(-impactTime / 0.023);
    const fade = Math.min(1, (duration - t) / 0.022);
    samples[i] = ((high - low) * (0.24 * sweep + 0.41 * impact) +
      Math.sin(phase) * 0.23 * impact) * fade;
  }
  return buffer;
}

// スマホでも、タップやキーでボタンを押したときに音を有効にする。
export function unlockBattleSound() {
  try {
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

export async function playBattleHitSound() {
  try {
    if (context?.state !== 'running') await resume;
    if (context?.state !== 'running') return;
    hitBuffer ??= makeHitBuffer(context);
    const source = context.createBufferSource();
    source.buffer = hitBuffer;
    source.connect(context.destination);
    source.start();
  } catch {
    // ブラウザが音声の再生を制限している場合はそのまま進める。
  }
}
