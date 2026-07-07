// 着信音・発信音を WebAudio で合成する(音声ファイル同梱不要)。
// 着信(incoming): 2音のリング音を約1秒周期で繰り返す。
// 発信(outgoing): 低めのプッシュ音を約3秒周期で鳴らす。
type Kind = "incoming" | "outgoing";

let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function beep(freq: number, start: number, dur: number, gain: number) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.linearRampToValueAtTime(0, start + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

export function startRingtone(kind: Kind) {
  stopRingtone();
  const c = ensureCtx();
  if (!c) return;
  const play = () => {
    const t = c.currentTime;
    if (kind === "incoming") {
      beep(880, t, 0.18, 0.12);
      beep(660, t + 0.22, 0.18, 0.12);
    } else {
      beep(440, t, 0.4, 0.08);
    }
  };
  play();
  timer = setInterval(play, kind === "incoming" ? 1200 : 3000);
}

export function stopRingtone() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
