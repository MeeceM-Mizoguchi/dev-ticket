// BRU10-062 チケット作成中のプログレス表示
//
// ネットワークが遅い環境ではチケット作成が数秒〜数十秒かかり、その間
// 画面が固まったように見えていた。作成処理をステップに分解し、いまどの
// 段階かを常に見せるための全画面オーバーレイ。
//   step = 0..steps.length-1 : 実行中のステップ
//   step = steps.length      : 全ステップ完了
//   error                    : 失敗（閉じるボタンを出す。下書きは保持される）
//
// UIは外部ライブラリを使わず、アプリ内の他のオーバーレイ（BulkAssignProgress 等）と
// 同じデザイン言語で自前実装している。

import { useEffect, useState } from "react";
import { Check, Loader2, AlertTriangle, Ticket } from "lucide-react";

/** 「通信が遅いかも」のヒントを出すまでの秒数 */
const SLOW_HINT_SEC = 6;

export function TicketCreateProgress({
  steps, step, error, zIndex = 1000, onClose,
}: {
  steps: string[];
  step: number;
  error?: string | null;
  zIndex?: number;
  onClose?: () => void;   // error 時のみ利用
}) {
  const [elapsed, setElapsed] = useState(0);

  // 経過秒数。止まって見える時間が長いほど「動いている」ことを伝える必要がある。
  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(t);
  }, [error]);

  const isError = !!error;
  const done = Math.min(step, steps.length);
  // 実行中のステップは「半分進んだ」扱いにして、バーが必ず前進して見えるようにする。
  const pct = isError
    ? Math.round((done / steps.length) * 100)
    : Math.round(((done + (done < steps.length ? 0.5 : 0)) / steps.length) * 100);
  const slow = !isError && elapsed >= SLOW_HINT_SEC;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,14,12,0.55)", backdropFilter: "blur(3px)" }}
      onClick={e => e.stopPropagation()}
    >
      <style>{`@keyframes tcp-spin{to{transform:rotate(360deg)}}
        @keyframes tcp-sheen{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
        @keyframes tcp-pulse{0%,100%{opacity:1}50%{opacity:.45}}
        @keyframes tcp-pop{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}`}</style>

      <div style={{ width: 430, maxWidth: "92%", background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.30)", overflow: "hidden", animation: "tcp-pop 0.22s cubic-bezier(0.16,1,0.3,1)" }}>

        {/* ヘッダー */}
        <div style={{ padding: "24px 26px 20px", background: isError ? "linear-gradient(135deg,#DC2626,#B91C1C)" : "linear-gradient(135deg,#059669 0%,#047857 60%,#065F46 100%)", color: "#fff", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -26, right: -18, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {isError
                ? <AlertTriangle style={{ width: 22, height: 22 }} />
                : done >= steps.length
                  ? <Check style={{ width: 22, height: 22 }} />
                  : <Ticket style={{ width: 22, height: 22 }} />}
            </div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
                {isError ? "チケットの作成に失敗しました" : done >= steps.length ? "チケットを作成しました" : "チケットを作成しています"}
              </h2>
              <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.85)", marginTop: 3 }}>
                {isError ? "入力内容は残っています。もう一度お試しください" : "完了するまで画面を閉じないでください"}
              </p>
            </div>
          </div>
        </div>

        {/* 本体 */}
        <div style={{ padding: "22px 26px 24px" }}>
          {isError ? (
            <>
              <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7, wordBreak: "break-word" }}>{error}</p>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                <button type="button" onClick={onClose}
                  style={{ padding: "9px 22px", background: "#1A1714", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                  閉じる
                </button>
              </div>
            </>
          ) : (
            <>
              {/* プログレスバー（進行中は光沢が流れ続けるので、通信待ちでも止まって見えない） */}
              <div style={{ position: "relative", width: "100%", height: 10, borderRadius: 999, background: "#EDEBE8", overflow: "hidden" }}>
                <div style={{ position: "relative", height: "100%", width: `${pct}%`, borderRadius: 999, background: "linear-gradient(90deg,#34D399,#059669)", transition: "width 0.45s cubic-bezier(0.16,1,0.3,1)", overflow: "hidden" }}>
                  {done < steps.length && (
                    <div style={{ position: "absolute", inset: 0, width: "40%", background: "linear-gradient(90deg,rgba(255,255,255,0) 0%,rgba(255,255,255,0.55) 50%,rgba(255,255,255,0) 100%)", animation: "tcp-sheen 1.25s linear infinite" }} />
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 12 }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: "#059669", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
                  {pct}<span style={{ fontSize: 13, color: "#A09790" }}>%</span>
                </span>
                <span style={{ fontSize: 11, color: "#B0A9A4", fontVariantNumeric: "tabular-nums" }}>経過 {elapsed}秒</span>
              </div>

              {/* ステップ一覧 */}
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 14 }}>
                {steps.map((label, i) => {
                  const state = i < done ? "done" : i === done ? "active" : "todo";
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 10, background: state === "active" ? "#F0FDF8" : "transparent" }}>
                      <div style={{
                        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: state === "done" ? "#059669" : state === "active" ? "rgba(5,150,105,0.12)" : "#F0EEEB",
                        border: state === "todo" ? "1px solid rgba(26,23,20,0.08)" : "none",
                      }}>
                        {state === "done" && <Check style={{ width: 12, height: 12, color: "#fff" }} />}
                        {state === "active" && <Loader2 style={{ width: 12, height: 12, color: "#059669", animation: "tcp-spin 0.9s linear infinite" }} />}
                      </div>
                      <span style={{
                        fontSize: 12.5,
                        fontWeight: state === "active" ? 700 : 600,
                        color: state === "todo" ? "#C9C4BB" : state === "active" ? "#1A1714" : "#6B6458",
                        animation: state === "active" ? "tcp-pulse 1.6s ease-in-out infinite" : undefined,
                      }}>{label}</span>
                    </div>
                  );
                })}
              </div>

              {slow && (
                <p style={{ fontSize: 11.5, color: "#D97706", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.18)", borderRadius: 10, padding: "9px 12px", marginTop: 12, lineHeight: 1.6 }}>
                  通信に時間がかかっています。電波状況の良い場所でそのままお待ちください。
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
