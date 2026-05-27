import { useState } from "react";
import { DialogShell } from "./DialogShell";
import { BtnSecondary } from "./BtnSecondary";
import { BtnSpinner } from "./PageLoader";

export function ConfirmDialog({
  message, onConfirm, onClose,
}: {
  message: string;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
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
    <DialogShell title="削除の確認" onClose={loading ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={loading}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleConfirm} disabled={loading}
          style={{ padding: "9px 20px", background: loading ? "#9CA3AF" : "#DC2626", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: loading ? "not-allowed" : "pointer", boxShadow: loading ? "none" : "0 2px 8px rgba(220,38,38,0.30)", display: "flex", alignItems: "center" }}>
          {loading && <BtnSpinner />}
          {loading ? "削除中..." : "削除する"}
        </button>
      </>}>
      <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>{message}</p>
      <p style={{ fontSize: 12, color: "#A09790" }}>この操作は取り消せません。</p>
    </DialogShell>
  );
}
