import { useState } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [group, setGroup] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

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
      if (!res.ok) { setError(json.error || "送信に失敗しました"); setSending(false); }
      else { setSuccess(true); setTimeout(() => { onClose(); }, 2000); }
    } catch {
      setError("ネットワークエラーが発生しました"); setSending(false);
    }
  };

  return (
    <DialogShell title="メンバーを招待" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSend}>{sending ? "送信中..." : success ? "✓ 送信しました" : "招待メールを送信"}</BtnPrimary></>}>
      {error && <div style={{ padding:"10px 14px", background:"#FEF2F2", borderRadius:8, fontSize:12, color:"#DC2626", border:"1px solid rgba(220,38,38,0.2)" }}>{error}</div>}
      {success && <div style={{ padding:"10px 14px", background:"#ECFDF5", borderRadius:8, fontSize:12, color:"#059669", border:"1px solid rgba(5,150,105,0.2)" }}>招待メールを送信しました。メールを確認してください。</div>}
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
