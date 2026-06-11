import { useState } from "react";
import { DialogShell } from "./DialogShell";
import { BtnSecondary } from "./BtnSecondary";
import { BtnSpinner } from "./PageLoader";

export function ConfirmDialog({
  message, onConfirm, onClose, title = "削除の確認", confirmLabel = "削除する", confirmColor = "#DC2626", hasWarningText = true,
}: {
  message: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  title?: string;         // 🛠️ タイトルを外から変えられるように追加
  confirmLabel?: string;  // 🛠️ 決定ボタンの文字を変えられるように追加
  confirmColor?: string;  // 🛠️ ボタンの色（破棄する時の赤、閉じる時の緑など）を変えられるように追加
  hasWarningText?: boolean; // 🛠️ 「この操作は取り消せません。」の表示・非表示を選べるように追加
}) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
      onClose();
    }
  };

  return (
    <DialogShell title={title} size="sm" onClose={loading ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={loading}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleConfirm} disabled={loading}
          style={{ padding: "9px 20px", background: loading ? "#9CA3AF" : confirmColor, color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: loading ? "not-allowed" : "pointer", boxShadow: loading ? "none" : `0 2px 8px ${confirmColor}4D`, display: "flex", alignItems: "center" }}>
          {loading && <BtnSpinner />}
          {loading ? "処理中..." : confirmLabel}
        </button>
      </>}>
      <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{message}</p>
      {hasWarningText && <p style={{ fontSize: 12, color: "#A09790" }}>この操作は取り消せません。</p>}
    </DialogShell>
  );
}