import { useState } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";
import { useToast } from "@/app/contexts/ToastContext";

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [group, setGroup] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const handleSend = async () => {
    if (!email.trim()) return;
    setSending(true); setError("");
    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, group }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "送信に失敗しました");
        setSending(false);
      } else {
        toast(`${email} に招待メールを送信しました`);
        onClose();
      }
    } catch {
      setError("ネットワークエラーが発生しました");
      setSending(false);
    }
  };

  return (
    <DialogShell title="メンバーを招待" onClose={sending ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={sending}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleSend} disabled={sending || !email.trim()}
          style={{ padding: "9px 20px", background: sending || !email.trim() ? "#9CA3AF" : "linear-gradient(135deg,#059669,#047857)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: sending || !email.trim() ? "not-allowed" : "pointer", boxShadow: sending || !email.trim() ? "none" : "0 2px 10px rgba(5,150,105,0.30)", display: "flex", alignItems: "center" }}>
          {sending && <BtnSpinner />}
          {sending ? "送信中..." : "招待メールを送信"}
        </button>
      </>}>
      {error && <div style={{ padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, fontSize: 12, color: "#DC2626", border: "1px solid rgba(220,38,38,0.2)" }}>{error}</div>}
      <FieldInput label="メールアドレス" type="email" placeholder="taro@example.com" required value={email} onChange={setEmail} />
      <FieldInput label="氏名（任意）" placeholder="例: 田中太郎" value={name} onChange={setName} />
      <FieldSelect label="付与する権限" value={role} onChange={setRole}>
        <option value="developer">開発者</option><option value="designer">デザイナー</option>
        <option value="project-manager">PM</option><option value="admin">管理者</option>
      </FieldSelect>
      <FieldSelect label="所属グループ" value={group} onChange={setGroup}>
        <option value="">未割り当て</option><option value="マネジメント">マネジメント</option>
        <option value="開発第1チーム">開発第1チーム</option><option value="開発第2チーム">開発第2チーム</option>
        <option value="デザインチーム">デザインチーム</option>
      </FieldSelect>
    </DialogShell>
  );
}
