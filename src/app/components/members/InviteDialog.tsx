import { useState, useEffect } from "react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { RoleDefinition, Organization } from "@/app/types";

const FALLBACK_ROLES: RoleDefinition[] = [
  { id: 1, name: "developer", label: "開発者", base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canSkipReview: false, canAccessMembers: false, canAccessRoles: false, canAccessGroups: false, canAccessAdminSettings: false, canAccessWiki: false, canAccessBacklog: false, canAccessMinutes: false, canAccessOrganization: false } },
  { id: 2, name: "designer", label: "デザイナー", base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canSkipReview: false, canAccessMembers: false, canAccessRoles: false, canAccessGroups: false, canAccessAdminSettings: false, canAccessWiki: false, canAccessBacklog: false, canAccessMinutes: false, canAccessOrganization: false } },
  { id: 3, name: "project-manager", label: "プロジェクトマネージャー", base_permissions: { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true, canSkipReview: false, canAccessMembers: true, canAccessRoles: false, canAccessGroups: true, canAccessAdminSettings: false, canAccessWiki: true, canAccessBacklog: true, canAccessMinutes: true, canAccessOrganization: false } },
  { id: 4, name: "admin", label: "管理者", base_permissions: { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true, canSkipReview: true, canAccessMembers: true, canAccessRoles: true, canAccessGroups: true, canAccessAdminSettings: true, canAccessWiki: true, canAccessBacklog: true, canAccessMinutes: true, canAccessOrganization: false } },
];

interface Props {
  onClose: () => void;
  onInvited?: () => void;
  /** 組織詳細ページから開く場合に渡す — 選択不可で固定される */
  fixedOrganizationId?: string;
  fixedOrganizationName?: string;
}

export function InviteDialog({ onClose, onInvited, fixedOrganizationId, fixedOrganizationName }: Props) {
  const { toast } = useToast();
  const { userRole, userId } = useAuth();
  const isOwner = userRole === "owner";

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("developer");
  const [group, setGroup] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [roles, setRoles] = useState<RoleDefinition[]>(FALLBACK_ROLES);

  // 組織関連
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>(fixedOrganizationId ?? "");
  // 自分の組織ID（owner以外が招待するとき自動設定）
  const [myOrgId, setMyOrgId] = useState<string | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled) return;

    // ロール一覧を取得
    supabase!.from("roles").select("*").order("id")
      .then(({ data }) => { if (data?.length) setRoles(data as RoleDefinition[]); });

    if (isOwner) {
      // オーナーは組織一覧を取得してプルダウンに表示
      supabase!.from("organizations").select("id, name, created_at").order("created_at")
        .then(({ data }) => {
          if (data) {
            setOrganizations(data.map((r: any) => ({ id: r.id, name: r.name, createdAt: r.created_at || "" })));
            // fixedOrganizationId が渡されていない場合、先頭の組織を初期選択
            if (!fixedOrganizationId && data.length > 0) {
              setSelectedOrgId(data[0].id);
            }
          }
        });
    } else {
      // owner以外: 自分のorganization_idを取得して自動設定
      supabase!.from("profiles").select("organization_id").eq("id", userId).maybeSingle()
        .then(({ data }) => { if (data?.organization_id) setMyOrgId(data.organization_id); });
    }
  }, [isOwner, userId, fixedOrganizationId]);

  const handleSend = async () => {
    if (!email.trim()) return;
    setSending(true);
    setError("");

    // 送信する組織ID
    const organizationId = fixedOrganizationId ?? (isOwner ? selectedOrgId : myOrgId) ?? null;

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role, group, organizationId }),
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

  // ownerロールは選択肢から除外
  const visibleRoles = roles.filter(r => r.name !== "owner");

  return (
    <DialogShell
      title="メンバーを招待"
      onClose={sending ? () => {} : onClose}
      footer={
        <>
          <BtnSecondary onClick={onClose} disabled={sending}>キャンセル</BtnSecondary>
          <button
            type="button"
            onClick={handleSend}
            disabled={sending || !email.trim()}
            style={{ padding: "9px 20px", background: sending || !email.trim() ? "#9CA3AF" : "linear-gradient(135deg,#059669,#047857)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: sending || !email.trim() ? "not-allowed" : "pointer", boxShadow: sending || !email.trim() ? "none" : "0 2px 10px rgba(5,150,105,0.30)", display: "flex", alignItems: "center" }}
          >
            {sending && <BtnSpinner />}
            {sending ? "送信中..." : "招待メールを送信"}
          </button>
        </>
      }
    >
      {error && (
        <div style={{ padding: "10px 14px", background: "#FEF2F2", borderRadius: 8, fontSize: 12, color: "#DC2626", border: "1px solid rgba(220,38,38,0.2)" }}>
          {error}
        </div>
      )}

      <FieldInput label="メールアドレス" type="email" placeholder="taro@example.com" required value={email} onChange={setEmail} />
      <FieldInput label="氏名（任意）" placeholder="例: 田中太郎" value={name} onChange={setName} style={{ marginBottom: 16 }} />

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          付与するロール
        </label>
        <CustomSelect
          value={role}
          options={visibleRoles.map(r => ({ value: r.name, label: r.label }))}
          onChange={setRole}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
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
            { value: "デザインチーム", label: "デザインチーム" },
          ]}
          onChange={setGroup}
        />
      </div>

      {/* 組織選択: ownerのみ表示 */}
      {isOwner && (
        <div>
          <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
            所属組織
            {fixedOrganizationName && (
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", padding: "2px 8px", borderRadius: 20 }}>
                {fixedOrganizationName}（固定）
              </span>
            )}
          </label>
          {fixedOrganizationId ? (
            <div style={{ padding: "9px 12px", background: "#F4F5F6", borderRadius: 10, fontSize: 13, color: "#6B6458" }}>
              {fixedOrganizationName}
            </div>
          ) : (
            <CustomSelect
              value={selectedOrgId}
              options={[
                { value: "", label: "未割り当て" },
                ...organizations.map(o => ({ value: o.id, label: o.name })),
              ]}
              onChange={setSelectedOrgId}
            />
          )}
        </div>
      )}
    </DialogShell>
  );
}
