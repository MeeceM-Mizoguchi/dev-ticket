// マージが最後まで終わったことを、全画面で知らせる。
//
// 緑が中央から広がって画面を覆い、ブランチが合流する線を描く。紙吹雪は上から降らせる。
// 3秒で自動的に閉じる。クリックと ESC でも閉じられる。
//
// 出すのは「GitHub 上のマージが終わった」時点。本番へ届いたかどうかは別の事実で、
// ここでは確かめていない（docs/deploy-verification-design.md 層B）。
// そのため文言は「マージ完了」に留め、リリースや本番反映が済んだとは書かない。
//
// 出す側（マージの確認・まとめてマージ・復帰モーダル）はどの画面にも居るので、
// 表示する側は App の最上位に1つだけ置き、celebrateMerge() で呼び出す。
// マージの確認ダイアログは成功と同時に閉じるため、ダイアログの中に置くと一緒に消えてしまう。
import { useCallback, useEffect, useState, type CSSProperties } from "react";
// @ts-ignore 型定義（@types/canvas-confetti）は未導入。本体は package.json に入っている
import confetti from "canvas-confetti";
import { escStack } from "@/app/lib/escStack";

/** 自動で閉じるまでの時間 */
const SHOW_MS = 3000;
/** 復帰モーダル（GithubRunOverlay の 100001）より手前に出す */
const Z = 100010;

export interface MergeCelebrationInfo {
  /** 何をマージしたか（PR番号とタイトル、または件数） */
  title: string;
  /** 補足（マージ先とブランチ名、またはPR番号の並び）。無ければ出さない */
  sub?: string;
}

let show: ((info: MergeCelebrationInfo) => void) | null = null;

/** 「マージ完了」を出す。表示する側がまだ居ない場合は何もしない */
export function celebrateMerge(info: MergeCelebrationInfo) {
  show?.(info);
}

/** まとめてマージの補足に出す番号の並び。多いときは画面からはみ出すので途中で切る */
export function pullNumbersLine(numbers: number[], max = 8): string {
  const head = numbers.slice(0, max).map(n => `#${n}`).join(" / ");
  return numbers.length > max ? `${head} ほか${numbers.length - max}件` : head;
}

const KEYFRAMES = `
@keyframes mgc-wipe { from { clip-path: circle(0% at 50% 50%) } to { clip-path: circle(150% at 50% 50%) } }
@keyframes mgc-draw { to { stroke-dashoffset: 0 } }
@keyframes mgc-node { from { opacity: 0; transform: scale(0) } to { opacity: 1; transform: scale(1) } }
@keyframes mgc-rise { from { opacity: 0; transform: translateY(26px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) {
  .mgc-root, .mgc-root * { animation-duration: 0.01ms !important; animation-delay: 0s !important; }
}
`;

const LINE: CSSProperties = { animation: "mgc-draw 0.7s ease-out 0.3s forwards" };
const node = (delay: number): CSSProperties => ({
  transformBox: "fill-box", transformOrigin: "center",
  animation: `mgc-node 0.3s cubic-bezier(0.34,1.56,0.64,1) ${delay}s both`,
});

export function MergeCelebrationHost() {
  // run は出し直しのたびに増やす。続けて呼ばれたときに演出を最初からやり直すため
  const [current, setCurrent] = useState<{ info: MergeCelebrationInfo; run: number } | null>(null);
  const close = useCallback(() => setCurrent(null), []);

  useEffect(() => {
    const handler = (info: MergeCelebrationInfo) => setCurrent(prev => ({ info, run: (prev?.run ?? 0) + 1 }));
    show = handler;
    return () => { if (show === handler) show = null; };
  }, []);

  const run = current?.run;
  useEffect(() => {
    if (run === undefined) return;
    escStack.push(close);
    const closeTimer = window.setTimeout(close, SHOW_MS);
    // 緑が広がりきってから降らせる。視覚効果を減らす設定のときは紙吹雪を出さない
    const timers = [0.15, 0.4, 0.6, 0.85].map((x, i) => window.setTimeout(() => confetti({
      particleCount: 38, angle: 270, spread: 75, startVelocity: 18, gravity: 0.9, ticks: 260, scalar: 1.1,
      origin: { x, y: -0.05 }, colors: ["#FFFFFF", "#FDE68A", "#A7F3D0", "#064E3B"],
      zIndex: Z + 1, disableForReducedMotion: true,
    }), 380 + i * 110));
    return () => {
      escStack.pop(close);
      window.clearTimeout(closeTimer);
      timers.forEach(t => window.clearTimeout(t));
    };
  }, [run, close]);

  if (!current) return null;
  const { info } = current;

  return (
    <div key={current.run} className="mgc-root" onClick={close} role="status"
      style={{ position: "fixed", inset: 0, zIndex: Z, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: "#FFF", cursor: "pointer", background: "linear-gradient(135deg, #047857 0%, #10B981 55%, #34D399 100%)", animation: "mgc-wipe 0.55s cubic-bezier(0.65,0,0.35,1) both" }}>
      <style>{KEYFRAMES}</style>
      <svg width="260" height="98" viewBox="0 0 240 90" fill="none" stroke="#FFF" strokeWidth="5" strokeLinecap="round" style={{ maxWidth: "70vw" }} aria-hidden="true">
        <path d="M10 60 H230" pathLength={1} strokeDasharray={1} strokeDashoffset={1} style={LINE} opacity="0.55" />
        <path d="M40 60 C70 60 70 20 100 20 H130 C160 20 160 60 190 60" pathLength={1} strokeDasharray={1} strokeDashoffset={1} style={LINE} />
        <circle cx="40" cy="60" r="8" fill="#047857" style={node(0.3)} />
        <circle cx="115" cy="20" r="8" fill="#047857" style={node(0.6)} />
        <circle cx="190" cy="60" r="12" fill="#FFF" style={node(0.95)} />
      </svg>
      <p style={{ marginTop: 26, fontSize: 12, fontWeight: 700, letterSpacing: "0.42em", opacity: 0.8, fontFamily: "var(--font-mono)", animation: "mgc-rise 0.5s ease-out 0.5s both" }}>MERGED</p>
      <p style={{ marginTop: 6, fontSize: "clamp(40px, 8vw, 88px)", fontWeight: 900, lineHeight: 1.1, fontFamily: "var(--font-heading)", letterSpacing: "-0.03em", animation: "mgc-rise 0.6s cubic-bezier(0.16,1,0.3,1) 0.6s both" }}>マージ完了！</p>
      <p style={{ marginTop: 18, fontSize: 14, fontWeight: 600, maxWidth: "80vw", wordBreak: "break-word", animation: "mgc-rise 0.6s ease-out 0.75s both" }}>{info.title}</p>
      {info.sub && (
        <p style={{ marginTop: 6, fontSize: 12, opacity: 0.75, maxWidth: "80vw", wordBreak: "break-word", fontFamily: "var(--font-mono)", animation: "mgc-rise 0.6s ease-out 0.8s both" }}>{info.sub}</p>
      )}
      <p style={{ position: "absolute", bottom: 26, fontSize: 11, opacity: 0.6 }}>クリックで閉じる</p>
    </div>
  );
}
