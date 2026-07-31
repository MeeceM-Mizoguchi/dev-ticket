// 着信音・発信音を WebAudio で合成する(音声ファイル同梱不要)。
// 着信(incoming): 2音のリング音を約1秒周期で繰り返す。
// 発信(outgoing): 低めのプッシュ音を約3秒周期で鳴らす。
//
// 状態(AudioContext と繰り返しタイマー)は globalThis 上の単一オブジェクトに保持する。
// これにより dev の HMR やモジュール二重評価でタイマー参照が分裂して「stopしても鳴り続ける」
// 孤立インターバルを根絶する(stopRingtone は常に現在アクティブなタイマーを止められる)。
type Kind = "incoming" | "outgoing";

interface RingState {
  ctx: AudioContext | null;
  timer: ReturnType<typeof setInterval> | null;
}

const store = globalThis as unknown as { __devTicketRing?: RingState };
function state(): RingState {
  return (store.__devTicketRing ??= { ctx: null, timer: null });
}

function ensureCtx(): AudioContext | null {
  const s = state();
  try {
    if (!s.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      s.ctx = new AC();
    }
    if (s.ctx.state === "suspended") void s.ctx.resume();
    return s.ctx;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, freq: number, start: number, dur: number, gain: number) {
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
      beep(c, 880, t, 0.18, 0.12);
      beep(c, 660, t + 0.22, 0.18, 0.12);
    } else {
      beep(c, 440, t, 0.4, 0.08);
    }
  };
  play();
  state().timer = setInterval(play, kind === "incoming" ? 1200 : 3000);
}

export function stopRingtone() {
  const s = state();
  if (s.timer) {
    clearInterval(s.timer);
    s.timer = null;
  }
}

// 通話終了時のワンショット効果音(下降する2音)。繰り返さない。
export function playHangupTone() {
  const c = ensureCtx();
  if (!c) return;
  const t = c.currentTime;
  beep(c, 480, t, 0.14, 0.1);
  beep(c, 360, t + 0.16, 0.2, 0.1);
}
