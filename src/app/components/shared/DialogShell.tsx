import { type ReactNode, useEffect } from "react";
import { X } from "lucide-react";
import { escStack } from "@/app/lib/escStack";

type DialogSize = "sm" | "md" | "lg" | "xl";

const sizeConfig: Record<DialogSize, { maxWidth: number; minHeight?: number }> = {
  sm: { maxWidth: 420 },
  md: { maxWidth: 580, minHeight: 320 },
  lg: { maxWidth: 720, minHeight: 400 },
  xl: { maxWidth: 940 },
};

export function DialogShell({ title, onClose, children, footer, size = "md", zIndex = 300, minHeight: minHeightProp, busy = false }: { title: string; onClose: () => void; children: ReactNode; footer: ReactNode; size?: DialogSize; zIndex?: number;
  /** サイズ既定の最低高さを上書きする。中身が短いのに縦に間延びさせたくないダイアログで 0 を渡す */
  minHeight?: number;
  /**
   * 取り消しの効かない処理を実行中。閉じる手段を全部塞ぐ（BRU13-045）。
   *
   * 以前も onClose に空関数を渡して無効化していたが、×ボタンは押せる見た目のままで
   * 「押したら止まるのか」が分からなかった。ここでは押せないことを見た目にも出し、
   * ESC・背景クリック・タブを閉じる操作までまとめて塞ぐ。
   */
  busy?: boolean }) {
  const { maxWidth } = sizeConfig[size];
  const minHeight = minHeightProp ?? sizeConfig[size].minHeight;

  // 実行中でも必ず積む。積まないと ESC が下のダイアログや一覧の閉じる処理に届いてしまう
  useEffect(() => {
    const handler = busy ? () => {} : onClose;
    escStack.push(handler);
    return () => escStack.pop(handler);
  }, [onClose, busy]);

  // タブ・ウィンドウを閉じようとしたら引き止める。
  // 閉じても処理そのものはサーバー側で走り切るが、結果を見ないまま離れると
  // 「どこまで終わったのか」が分からなくなるため
  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  return (
    <div style={{ position: "fixed", inset: 0, zIndex, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {/* 実行中は背景クリックでも閉じない */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }}
        onClick={busy ? undefined : onClose} />
      {/* overflow: visible でドロップダウンがモーダル外にはみ出せるようにする */}
      <div style={{ position: "relative", zIndex: 10, width: "100%", maxWidth, background: "#FFFFFF", borderRadius: 20, boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)" }}>
        {/* ヘッダーに borderRadius を付けて上角を丸く */}
        <div style={{ background: "linear-gradient(135deg, #059669 0%, #047857 60%, #065F46 100%)", padding: "22px 24px 20px", position: "relative", overflow: "hidden", borderRadius: "20px 20px 0 0" }}>
          <div style={{ position: "absolute", top: -20, right: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.07)" }} />
          <div style={{ position: "absolute", bottom: -30, left: 40, width: 80, height: 80, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <p style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontFamily: "var(--font-mono)", letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>Dev Ticket</p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: "#FFFFFF", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em", lineHeight: 1.1 }}>{title}</h2>
            </div>
            <button onClick={onClose} disabled={busy} aria-label={busy ? "処理中は閉じられません" : "閉じる"}
              title={busy ? "処理が終わるまで閉じられません" : undefined}
              style={{ width: 32, height: 32, borderRadius: 9, border: `1px solid rgba(255,255,255,${busy ? 0.10 : 0.20})`, background: `rgba(255,255,255,${busy ? 0.04 : 0.10})`, display: "flex", alignItems: "center", justifyContent: "center", cursor: busy ? "not-allowed" : "pointer", color: `rgba(255,255,255,${busy ? 0.3 : 0.8})`, flexShrink: 0, transition: "all 0.15s" }}
              onMouseEnter={e => { if (!busy) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.20)"; }}
              onMouseLeave={e => { if (!busy) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.10)"; }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>
        <div style={{ padding: "24px 24px 20px", display: "flex", flexDirection: "column", gap: 14, maxHeight: "80vh", ...(minHeight ? { minHeight } : {}), overflowY: "auto" }}>{children}</div>
        <div style={{ padding: "14px 24px 20px", display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid rgba(26,23,20,0.07)", borderRadius: "0 0 20px 20px", background: "#FFFFFF" }}>{footer}</div>
      </div>
    </div>
  );
}
