// 「いま何をしている最中か」を縦に並べて出す進捗表示（PR作成・マージで共用）。
//
// 各行の右に輪と数字を出す。GitHub の応答は「終わったか」しか返さないので、
// 実行中の％は経過時間から作った目安で、94%で頭打ちにして終わった時点で100%にする。
// 数字が一切動かないと固まったように見えるための表示で、実測値ではない
// （％の意味を偽らないよう、輪は実行中だけ回して「待っている最中」だと分かるようにしてある）。
//
// 行と行の間はグレーの棒でつないである。上の行が100%になると、その棒が上から下へ
// 緑色に伸びて次の行へ渡る。どこまで進んだかを目で追えるようにするため。
import { useEffect, useState } from "react";
import { Check, Minus } from "lucide-react";

const GREEN = "#059669";
const AMBER = "#B45309";
/** つなぎの棒（まだ進んでいない部分） */
const RAIL = "#E7E3DC";

/** pending … これから／running … 実行中／done … 完了／none … 完了したが該当なし／failed … 失敗／skipped … 行ごと出さない */
export type StepState = "pending" | "running" | "done" | "none" | "failed" | "skipped";

export interface ProgressStep {
  key: string;
  /** 行に出す文言。状態ごとの言い換えは呼び出し元で決める */
  text: string;
  state: StepState;
  /** 補足の1行（任意） */
  hint?: string;
}

const KEYFRAMES = `
@keyframes sp-spin { to { transform: rotate(360deg); } }
@keyframes sp-pulse {
  0%, 100% { box-shadow: 0 0 0 3px rgba(5,150,105,0.16); }
  50% { box-shadow: 0 0 0 6px rgba(5,150,105,0.04); }
}`;

/** 完了（成否は問わない）。棒を緑／橙で埋める合図でもある */
function isFinished(s: StepState) {
  return s === "done" || s === "none" || s === "failed";
}

function stateColor(s: StepState) {
  if (s === "failed") return AMBER;
  if (s === "pending") return "#C9C4BB";
  return GREEN;
}

/**
 * 実行中の％。2.2秒でだいたい6割まで進み、あとは詰まっていく。
 * 終わりが分からないので94%を超えない（100% は完了の合図として取っておく）
 */
function useCreepingPercent(running: boolean) {
  const [pct, setPct] = useState(0);
  useEffect(() => {
    if (!running) { setPct(0); return; }
    const started = Date.now();
    setPct(3);
    const id = window.setInterval(() => {
      const t = (Date.now() - started) / 1000;
      setPct(Math.min(94, Math.round(94 * (1 - Math.exp(-t / 2.2)))));
    }, 90);
    return () => window.clearInterval(id);
  }, [running]);
  return pct;
}

/** 進捗の輪。実行中は回しながら伸ばし、真ん中に％を出す */
function Ring({ pct, color, spinning, label }: { pct: number; color: string; spinning: boolean; label: string }) {
  const R = 16;
  const C = 2 * Math.PI * R;
  return (
    <div style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
      <svg width={36} height={36} viewBox="0 0 36 36" style={{ display: "block", transform: "rotate(-90deg)" }}>
        <circle cx="18" cy="18" r={R} fill="none" stroke={RAIL} strokeWidth={3} />
        <circle cx="18" cy="18" r={R} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(pct, 100) / 100)}
          style={{
            transition: "stroke-dashoffset .45s ease, stroke .3s ease",
            transformOrigin: "50% 50%",
            animation: spinning ? "sp-spin 1.15s linear infinite" : undefined,
          }} />
      </svg>
      <div style={{
        position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 10, fontWeight: 800, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums",
        color: pct >= 100 ? color : "#6B6458",
      }}>
        {label}
      </div>
    </div>
  );
}

/** 行と行をつなぐ棒の一部。filled になったら上から下へ緑色が伸びる */
function Rail({ place, filled, color, delayed }: {
  place: "top" | "bottom";
  filled: boolean;
  color: string;
  /** 直前の棒が伸び切ってから動かす（上の行の下半分 → この行の上半分、と続けて見せるため） */
  delayed?: boolean;
}) {
  const box = place === "top"
    ? { top: 0, height: "calc(50% - 11px)" }
    : { top: "calc(50% + 11px)", bottom: 0 };
  return (
    <div style={{ position: "absolute", left: 6.5, width: 3, borderRadius: 2, background: RAIL, overflow: "hidden", ...box }}>
      <div style={{
        width: "100%", height: filled ? "100%" : 0, background: color, borderRadius: 2,
        transition: `height .32s ease ${delayed ? ".3s" : "0s"}`,
      }} />
    </div>
  );
}

function StepRow({ step, first, last, prevState }: {
  step: ProgressStep;
  first: boolean;
  last: boolean;
  /** 上の行の状態。上が終わったら、この行の上半分の棒も色を伸ばす */
  prevState?: StepState;
}) {
  const running = step.state === "running";
  const finished = isFinished(step.state);
  const creeping = useCreepingPercent(running);
  const pct = finished ? 100 : running ? creeping : 0;
  const color = stateColor(step.state);
  const textColor = step.state === "running" ? "#1A1714"
    : step.state === "failed" ? AMBER
      : step.state === "pending" ? "#B0A9A4" : "#6B6458";

  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 12, minHeight: 48 }}>
      <div style={{ position: "relative", width: 16, flexShrink: 0 }}>
        {!first && prevState && (
          <Rail place="top" filled={isFinished(prevState)} color={stateColor(prevState)} delayed />
        )}
        {!last && <Rail place="bottom" filled={finished} color={color} />}
        <div style={{
          position: "absolute", top: "50%", left: 0, transform: "translateY(-50%)",
          width: 16, height: 16, borderRadius: "50%", boxSizing: "border-box" as const,
          display: "flex", alignItems: "center", justifyContent: "center",
          background: finished ? color : "#FFF",
          border: finished ? "none" : `2px solid ${running ? GREEN : "#DDD8D0"}`,
          animation: running ? "sp-pulse 1.6s ease-in-out infinite" : undefined,
          transition: "background .3s ease, border-color .3s ease",
        }}>
          {finished && (step.state === "failed"
            ? <Minus style={{ width: 10, height: 10, color: "#FFF" }} strokeWidth={3.5} />
            : <Check style={{ width: 10, height: 10, color: "#FFF" }} strokeWidth={3.5} />)}
          {running && <span style={{ width: 6, height: 6, borderRadius: "50%", background: GREEN }} />}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, alignSelf: "center", paddingRight: 4 }}>
        <p style={{ fontSize: 12, fontWeight: running ? 700 : 600, color: textColor, lineHeight: 1.6, transition: "color .3s ease" }}>
          {step.text}
        </p>
        {step.hint && <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.6, marginTop: 2 }}>{step.hint}</p>}
      </div>

      <div style={{ alignSelf: "center" }}>
        <Ring pct={pct} color={color} spinning={running}
          label={step.state === "failed" ? "—" : `${pct}%`} />
      </div>
    </div>
  );
}

export function StepProgress({ steps }: { steps: ProgressStep[] }) {
  const rows = steps.filter(s => s.state !== "skipped");
  return (
    <div>
      {/* spin は各画面で個別に定義されているので、ここでも名前をぶつけないよう接頭辞を付けて持つ */}
      <style>{KEYFRAMES}</style>
      {rows.map((s, i) => (
        <StepRow key={s.key} step={s} first={i === 0} last={i === rows.length - 1}
          prevState={i > 0 ? rows[i - 1].state : undefined} />
      ))}
    </div>
  );
}

/** 枠付きで出す版。ダイアログの本文にそのまま置ける */
export function StepProgressPanel({ steps, note }: { steps: ProgressStep[]; note?: string }) {
  return (
    <div style={{ background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px" }}>
      <StepProgress steps={steps} />
      {note && <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7, marginTop: 12 }}>{note}</p>}
    </div>
  );
}
