// BRU6-002-2 一括アサイン ─ 全画面プログレス表示
//
// 「処理中は画面操作させない」要件のため、全面をブロックするオーバーレイ。
//   phase = "analyzing": AI分析中（件数不定なのでインデターミネート表示）
//   phase = "saving":    担当保存中（current/total で進捗率を刻む）
//   phase = "error":     失敗（閉じるボタンを出す）

import { Sparkles, Loader2, AlertTriangle } from "lucide-react";

export type BulkAssignPhase = "analyzing" | "saving" | "error";

export function BulkAssignProgress({
  phase, current, total, message, onClose,
}: {
  phase: BulkAssignPhase;
  current: number;
  total: number;
  message?: string;
  onClose?: () => void;   // error 時のみ利用
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const isError = phase === "error";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,14,12,0.55)", backdropFilter: "blur(3px)" }}
      onClick={e => e.stopPropagation()}>
      <style>{`@keyframes bulk-spin { to { transform: rotate(360deg); } }
        @keyframes bulk-indeterminate { 0% { left: -40%; } 100% { left: 100%; } }`}</style>

      <div style={{ width: 460, maxWidth: "92%", background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.30)", overflow: "hidden" }}>
        {/* ヘッダー */}
        <div style={{ padding: "26px 28px 20px", background: isError ? "linear-gradient(135deg,#DC2626,#B91C1C)" : "linear-gradient(135deg,#059669 0%,#047857 60%,#065F46 100%)", color: "#fff", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -24, right: -20, width: 110, height: 110, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {isError
                ? <AlertTriangle style={{ width: 22, height: 22 }} />
                : phase === "analyzing"
                  ? <Sparkles style={{ width: 22, height: 22 }} />
                  : <Loader2 style={{ width: 22, height: 22, animation: "bulk-spin 1s linear infinite" }} />}
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
                {isError ? "一括アサインに失敗しました" : "一括アサインを実行中"}
              </h2>
              <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.85)", marginTop: 3 }}>
                {isError ? "しばらくしてから再度お試しください" : "完了するまで画面を閉じないでください"}
              </p>
            </div>
          </div>
        </div>

        {/* 本体 */}
        <div style={{ padding: "24px 28px 26px" }}>
          {isError ? (
            <>
              <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7 }}>{message || "処理中にエラーが発生しました。"}</p>
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                <button type="button" onClick={onClose}
                  style={{ padding: "9px 22px", background: "#1A1714", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer" }}>
                  閉じる
                </button>
              </div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", marginBottom: 4 }}>
                {phase === "analyzing" ? "推奨担当者を分析しています…" : "担当者を保存しています…"}
              </p>
              <p style={{ fontSize: 11.5, color: "#A09790", marginBottom: 16, minHeight: 16 }}>
                {message || (phase === "analyzing" ? "スキル・実績・空き状況から最適な担当者を算出中" : `${current} / ${total} 件`)}
              </p>

              {/* プログレスバー */}
              <div style={{ position: "relative", width: "100%", height: 10, borderRadius: 999, background: "#EDEBE8", overflow: "hidden" }}>
                {phase === "analyzing" ? (
                  <div style={{ position: "absolute", top: 0, height: "100%", width: "40%", borderRadius: 999, background: "linear-gradient(90deg,#34D399,#059669)", animation: "bulk-indeterminate 1.1s ease-in-out infinite" }} />
                ) : (
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: 999, background: "linear-gradient(90deg,#34D399,#059669)", transition: "width 0.25s ease" }} />
                )}
              </div>

              {phase === "saving" && (
                <p style={{ fontSize: 22, fontWeight: 800, color: "#059669", fontFamily: "var(--font-heading)", textAlign: "center", marginTop: 16, letterSpacing: "-0.02em" }}>
                  {pct}<span style={{ fontSize: 13, color: "#A09790" }}>%</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
