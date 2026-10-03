import { type ReactNode, useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { escStack } from "@/app/lib/escStack";
import { BtnSecondary } from "./BtnSecondary";

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
  busy?: boolean;
  /**
   * ×・背景クリック・ESC で閉じようとしたとき、「本当に閉じますか？」を挟む。
   *
   * この先に次の操作が続くダイアログ（マージやPR作成の流れ）用。うっかり背景を
   * 押しただけで流れごと消えて、最初から押し直しになるのを防ぐ。
   * フッターの「キャンセル」等は自分で押した操作なので対象外（呼び出し側の onClose がそのまま走る）。
   */
  confirmClose?: boolean }) {
  const { maxWidth } = sizeConfig[size];
  const minHeight = minHeightProp ?? sizeConfig[size].minHeight;
  const [askingClose, setAskingClose] = useState(false);
  // 実行が始まったら確認は出さない（busy 中は閉じられないので、確認だけ残っても意味がない）
  const confirming = askingClose && !busy;

  const requestClose = useCallback(() => {
    if (confirmClose) setAskingClose(true);
    else onClose();
  }, [confirmClose, onClose]);

  // 実行中でも必ず積む。積まないと ESC が下のダイアログや一覧の閉じる処理に届いてしまう。
  // 確認を出している間は積まない（ESC は上に重ねた確認ダイアログが受ける。
  // ここで積み直すと確認より上に来てしまい、ESC で確認を閉じられなくなる）
  useEffect(() => {
    if (confirming) return;
    const handler = busy ? () => {} : requestClose;
    escStack.push(handler);
    return () => escStack.pop(handler);
  }, [requestClose, busy, confirming]);

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
    <>
    <div style={{ position: "fixed", inset: 0, zIndex, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      {/* 実行中は背景クリックでも閉じない */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }}
        onClick={busy ? undefined : requestClose} />
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
            <button onClick={requestClose} disabled={busy} aria-label={busy ? "処理中は閉じられません" : "閉じる"}
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
    {confirming && (
      <DialogShell title="画面を閉じる確認" size="sm" zIndex={zIndex + 10} onClose={() => setAskingClose(false)}
        footer={<>
          <BtnSecondary onClick={() => setAskingClose(false)}>戻る</BtnSecondary>
          <button type="button" onClick={() => { setAskingClose(false); onClose(); }}
            style={{ padding: "9px 20px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.30)" }}>
            閉じる
          </button>
        </>}>
        <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>本当に閉じますか？</p>
        <p style={{ fontSize: 12, color: "#A09790", lineHeight: 1.7 }}>閉じると、この画面の操作は実行されません。</p>
      </DialogShell>
    )}
    </>
  );
}
