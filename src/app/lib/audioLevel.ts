// MediaStream の音量を監視して「発話中かどうか」を判定するユーティリティ。
// 通話UIの発話インジケータに使う。AudioContext を1つ共有し、
// stream ごとに AnalyserNode を張って RMS を requestAnimationFrame で監視する。
let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      sharedCtx = new AC();
    }
    if (sharedCtx.state === "suspended") void sharedCtx.resume();
    return sharedCtx;
  } catch {
    return null;
  }
}

// 発話開始/終了のしきい値(ヒステリシス)。
const SPEAK_ON = 0.045;
const SPEAK_OFF = 0.03;

// stream の発話状態を監視する。onChange(true/false) を返し、停止関数を返す。
export function monitorSpeaking(stream: MediaStream, onChange: (speaking: boolean) => void): () => void {
  const ctx = getCtx();
  if (!ctx || stream.getAudioTracks().length === 0) return () => {};

  let source: MediaStreamAudioSourceNode;
  try {
    source = ctx.createMediaStreamSource(stream);
  } catch {
    return () => {};
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  let raf = 0;
  let speaking = false;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    if (!speaking && rms > SPEAK_ON) {
      speaking = true;
      onChange(true);
    } else if (speaking && rms < SPEAK_OFF) {
      speaking = false;
      onChange(false);
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    try { source.disconnect(); } catch { /* noop */ }
    try { analyser.disconnect(); } catch { /* noop */ }
  };
}
