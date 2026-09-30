import { useCallback, useRef, useState } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { GoogleGLogo } from "@/app/components/files/GoogleGLogo";
import { useToast } from "@/app/contexts/ToastContext";
import { startGoogleOAuth } from "@/app/lib/googleDrive";
import { useGoogleAccountLink } from "@/app/hooks/useGoogleAccountLink";

/**
 * Googleファイルを開く前の確認（BRU17-028）。
 *
 * Googleのファイルは招待メールのアドレス宛てに共有されるが、そのアドレスがGoogleアカウントで
 * なければ開けない。開けなかったかどうかは別タブの Google 側で起きるので DevTicket からは分からない。
 * そこで「まだ自分でGoogleアカウントを紐づけていない」ときは、開く前に紐づけるかを尋ねる。
 *
 *   const gate = useGoogleLinkGate();
 *   onClick={() => gate.guard(() => openGoogleFile(file))}
 *   {gate.dialog}
 *
 * ★ open はクリックと同じ実行の中で呼ぶこと（window.open のポップアップブロック対策）。
 *   ダイアログの「このまま開く」もボタンのクリックなので、そこから呼べば通る。
 */
export function useGoogleLinkGate(opts?: { zIndex?: number }) {
  const { linked } = useGoogleAccountLink();
  const { toast } = useToast();
  const [pending, setPending] = useState<(() => void) | null>(null);
  // BUG-05 連携開始は await を含むので ref で二重起動を止める
  const startingRef = useRef(false);
  const [starting, setStarting] = useState(false);

  const guard = useCallback((open: () => void) => {
    // 読み込み中(null)は止めない。確認のために開く操作を待たせない
    if (linked === false) { setPending(() => open); return; }
    open();
  }, [linked]);

  const close = useCallback(() => { if (!startingRef.current) setPending(null); }, []);

  const handleLink = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    try {
      // 連携が済むと今の画面へ戻ってくる（戻り先は startGoogleOAuth の既定）
      await startGoogleOAuth();
    } catch (e) {
      toast(e instanceof Error ? e.message : "連携を開始できませんでした", "error");
      startingRef.current = false;
      setStarting(false);
    }
  }, [toast]);

  const dialog = pending ? (
    <DialogShell title="Googleアカウントの紐づけ" size="sm" zIndex={opts?.zIndex} onClose={close} busy={starting}
      footer={<>
        <BtnSecondary onClick={close} disabled={starting}>キャンセル</BtnSecondary>
        <BtnSecondary onClick={() => { const open = pending; setPending(null); open(); }} disabled={starting}>
          紐づけずに開く
        </BtnSecondary>
        <button type="button" onClick={() => { void handleLink(); }} disabled={starting}
          style={{ padding: "9px 20px", background: starting ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: starting ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ display: "flex", background: "#fff", borderRadius: 4, padding: 2 }}><GoogleGLogo size={12} /></span>
          {starting ? "Googleへ移動しています..." : "紐づける"}
        </button>
      </>}>
      <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7, margin: 0 }}>
        Googleアカウントが紐づけられていません。紐づけを行いますか？
      </p>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.8, margin: "10px 0 0" }}>
        Googleのファイルは、招待メールを受け取ったアドレス宛てに共有されています。
        そのアドレスがGoogleアカウントでない場合、ファイルを開けません。<br />
        紐づけると、紐づけたGoogleアカウントでファイルを開けるようになります。
        紐づけは右上のメニューからもできます。
      </p>
    </DialogShell>
  ) : null;

  return { guard, dialog, linked };
}
