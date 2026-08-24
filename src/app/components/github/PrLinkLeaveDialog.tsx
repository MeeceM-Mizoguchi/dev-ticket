// 「リリースノートに追加したのにPRが紐付いていない」まま、チケット詳細を閉じようとしたときの離脱確認（BRU13-013）。
//
// ブラウザ標準の confirm は使わない。何が起きるのか（一覧で赤くなる）と、
// 取れる手が3つある（紐付ける／PR不要にする／このまま閉じる）ことをその場で見せたいため、
// 共通の ConfirmDialog（2択・緑ヘッダー）ではなく専用のUIにしている。
import { useEffect, useState } from "react";
import { AlertTriangle, GitPullRequest, X } from "lucide-react";
import { escStack } from "@/app/lib/escStack";

export function PrLinkLeaveDialog({ wbs, title, onLink, onWaive, onLeave, onCancel }: {
  wbs: string;
  title: string;
  /** 紐付け作業に戻る（ダイアログを閉じるだけ） */
  onLink: () => void;
  /** このチケットはPR不要として確定し、そのまま閉じる。DBの更新を伴うので待つ */
  onWaive: () => void | Promise<void>;
  /** 紐付けずに閉じる。一覧で赤くなる */
  onLeave: () => void;
  onCancel: () => void;
}) {
  // 「PR不要」は保存を伴う。二度押しで二重に走らせない
  const [busy, setBusy] = useState(false);

  // Esc は「戻る」に倒す。誤って離脱させない
  useEffect(() => {
    if (busy) return;
    escStack.push(onCancel);
    return () => escStack.pop(onCancel);
  }, [onCancel, busy]);

  const handleWaive = async () => {
    setBusy(true);
    try {
      await onWaive();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 360, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.50)", backdropFilter: "blur(4px)" }} onClick={onCancel} />

      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth: 480, background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.26), 0 4px 16px rgba(0,0,0,0.10)", overflow: "hidden" }}>
        {/* 警告であることが一目で分かるヘッダー */}
        <div style={{ background: "linear-gradient(135deg, #DC2626 0%, #B91C1C 60%, #991B1B 100%)", padding: "20px 22px 18px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -24, right: -18, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.08)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.16)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <AlertTriangle style={{ width: 17, height: 17, color: "#FFF" }} />
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 9, color: "rgba(255,255,255,0.6)", fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase" as const, marginBottom: 4 }}>Pull request required</p>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "#FFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                  プルリクエストが紐付いていません
                </h2>
              </div>
            </div>
            <button onClick={onCancel} disabled={busy}
              style={{ width: 30, height: 30, borderRadius: 9, border: "1px solid rgba(255,255,255,0.20)", background: "rgba(255,255,255,0.10)", display: "flex", alignItems: "center", justifyContent: "center", cursor: busy ? "default" : "pointer", color: "rgba(255,255,255,0.85)", flexShrink: 0 }}>
              <X style={{ width: 13, height: 13 }} />
            </button>
          </div>
        </div>

        <div style={{ padding: "18px 22px 6px", display: "flex", flexDirection: "column" as const, gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 9, padding: "9px 12px" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{wbs}</span>
            <span style={{ fontSize: 12, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{title}</span>
          </div>

          <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.8 }}>
            このチケットはリリースノートに追加済みですが、対応内容のプルリクエストがまだ紐付いていません。
          </p>
          <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.8, background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.22)", borderRadius: 9, padding: "10px 12px" }}>
            このまま閉じると、チケット一覧・スプリント一覧でこのチケットの行が赤く表示され、
            未紐付けのアラートが出続けます。
          </p>
        </div>

        {/* 縦並びにして「紐付ける」を最上段に置く。危険な選択肢を押しやすい位置に置かない */}
        <div style={{ padding: "12px 22px 20px", display: "flex", flexDirection: "column" as const, gap: 8 }}>
          <button type="button" onClick={onLink} disabled={busy}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", padding: "11px 18px", background: busy ? "#9CA3AF" : "#1F2328", color: "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 11, border: "none", cursor: busy ? "not-allowed" : "pointer" }}>
            <GitPullRequest style={{ width: 14, height: 14 }} />
            プルリクエストを紐付ける
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={handleWaive} disabled={busy}
              style={{ flex: 1, padding: "9px 14px", background: "#FFF", color: "#4B4540", fontSize: 12, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(26,23,20,0.14)", cursor: busy ? "not-allowed" : "pointer" }}>
              {busy ? "保存中..." : "PR不要にして閉じる"}
            </button>
            <button type="button" onClick={onLeave} disabled={busy}
              style={{ flex: 1, padding: "9px 14px", background: "#FEF2F2", color: "#B91C1C", fontSize: 12, fontWeight: 700, borderRadius: 10, border: "1px solid rgba(220,38,38,0.28)", cursor: busy ? "not-allowed" : "pointer" }}>
              紐付けずに閉じる
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
