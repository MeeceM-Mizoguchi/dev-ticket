import { useState, useEffect } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { FieldInput } from "@/app/components/shared/FieldInput";
// 🌟 追加: CustomSelect コンポーネントをインポート
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { RoleDefinition } from "@/app/types";

const FALLBACK_ROLES: RoleDefinition[] = [
  { id: 1, name: "developer", label: "開発者", base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false } },
  { id: 2, name: "designer", label: "デザイナー", base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false } },
  { id: 3, name: "project-manager", label: "プロジェクトマネージャー", base_permissions: { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true } },
  { id: 4, name: "admin", label: "管理者", base_permissions: { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true } },
];

export function InviteDialog({ onClose, onInvited }: { onClose: () => void; onInvited?: () => void }) {
  const { toast } = useToast();
  const { userRole } = useAuth();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [group, setGroup] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<RoleDefinition[]>(FALLBACK_ROLES);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("roles").select("*").order("id")
      .then(({ data }) => { if (data?.length) setRoles(data as RoleDefinition[]); });
  }, []);

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
        onInvited?.();
        onClose();
      }
    } catch {
      setError("ネットワークエラーが発生しました");
      setSending(false);
    }
  };

  return (
    <DialogShell title="メンバーを招待" onClose={sending ? () => { } : onClose}
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
      <FieldInput label="氏名（任意）" placeholder="例: 田中太郎" value={name} onChange={setName} style={{ marginBottom: 16 }} />

      {/* 🌟 修正: FieldSelect を CustomSelect に置き換え */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          付与するロール
        </label>
        <CustomSelect
          value={role}
          options={roles
            .filter(r => userRole === "admin" || r.name !== "admin")
            .map(r => ({ value: r.name, label: r.label }))}
          onChange={setRole}
        />
      </div>

      {/* 🌟 修正: FieldSelect を CustomSelect に置き換え */}
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          所属グループ
        </label>
        <CustomSelect
          value={group}
          options={[
            { value: "", label: "未割り当て" },
            { value: "マネジメント", label: "マネジメント" },
            { value: "開発第1チーム", label: "開発第1チーム" },
            { value: "開発第2チーム", label: "開発第2チーム" },
            { value: "デザインチーム", label: "デザインチーム" }
          ]}
          onChange={setGroup}
        />
      </div>
    </DialogShell>
  );
}
