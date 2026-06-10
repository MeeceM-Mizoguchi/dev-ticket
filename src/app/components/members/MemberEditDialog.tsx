import { useState, useEffect } from "react";
import type { Member, RoleDefinition } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { GROUPS } from "@/app/data/mock";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { CustomSelect } from "@/app/components/shared/CustomSelect";

const FALLBACK_ROLES: RoleDefinition[] = [
  { id: 1, name: "admin", label: "管理者", base_permissions: { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true } },
  { id: 2, name: "project-manager", label: "プロジェクトマネージャー", base_permissions: { canCreateTicket: true, canCreateSprint: true, canEditDelete: true, canReview: true } },
  { id: 3, name: "developer", label: "開発者", base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false } },
  { id: 4, name: "designer", label: "デザイナー", base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false } },
];

export function MemberEditDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const { userRole } = useAuth();
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [group, setGroup] = useState(member.group);
  const [status, setStatus] = useState(member.status);
  const [saving, setSaving] = useState(false);
  const [roles, setRoles] = useState<RoleDefinition[]>(FALLBACK_ROLES);
  const [rolesLoaded, setRolesLoaded] = useState(!isSupabaseEnabled);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("roles").select("*").order("id")
      .then(({ data }) => {
        if (data?.length) {
          setRoles(data as RoleDefinition[]);
          // 現在のロールが一覧にない場合は先頭のロールを初期値にする
          const match = (data as RoleDefinition[]).find(r => r.name === member.role);
          if (!match && data.length > 0) setRole((data[0] as RoleDefinition).name);
        }
        setRolesLoaded(true);
      })
      .catch(() => setRolesLoaded(true));
  }, [member.role]);

  const handleSave = async () => {
    setSaving(true);
    if (isSupabaseEnabled) {
      const { data, error } = await supabase!
        .from("profiles")
        .update({ name, role, group_name: group, status })
        .eq("id", member.id)
        .select("id");

      if (error) {
        console.error("profiles update error:", error);
        toast(`更新に失敗しました: ${error.message}`, "error");
        setSaving(false);
        return;
      }
      // RLS で拒否された場合は error がなく data が空になる
      if (!data || data.length === 0) {
        toast("権限がないため更新できませんでした。管理者にSupabaseのRLSポリシーを確認してもらってください。", "error");
        setSaving(false);
        return;
      }

      // 名前が変わった場合、関連テーブルの古い名前を新しい名前に置き換える
      if (name !== member.name) {
        // projects.members 配列を更新
        const { data: projectsData } = await supabase!
          .from("projects")
          .select("id, members")
          .contains("members", [member.name]);
        if (projectsData) {
          for (const proj of projectsData) {
            const updated = (proj.members as string[]).map((m: string) => m === member.name ? name : m);
            await supabase!.from("projects").update({ members: updated }).eq("id", proj.id);
          }
        }

        // sprint_tickets.assignee (text) を更新
        await supabase!
          .from("sprint_tickets")
          .update({ assignee: name })
          .eq("assignee", member.name);

        // sprint_tickets.assignees (text[]) を更新
        const { data: ticketsWithOldName } = await supabase!
          .from("sprint_tickets")
          .select("id, assignees")
          .contains("assignees", [member.name]);
        if (ticketsWithOldName) {
          for (const ticket of ticketsWithOldName) {
            const updatedAssignees = (ticket.assignees as string[]).map(
              (a: string) => a === member.name ? name : a
            );
            await supabase!.from("sprint_tickets").update({ assignees: updatedAssignees }).eq("id", ticket.id);
          }
        }

        // ticket_comments.user_name を更新
        await supabase!
          .from("ticket_comments")
          .update({ user_name: name })
          .eq("user_name", member.name);
      }

      toast(`「${name}」を更新しました`);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  const isEditingAdmin = member.role === "admin";
  const canChangeRole = userRole === "admin";
  const visibleRoles = roles.filter(r => canChangeRole || r.name !== "admin");
  const roleDisabled = !rolesLoaded || (!canChangeRole && isEditingAdmin);

  const canSave = rolesLoaded && !saving;

  return (
    <DialogShell title="メンバー編集" onClose={onClose}
      footer={<>
        <BtnSecondary onClick={onClose}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleSave} disabled={!canSave}>
          {saving ? "保存中..." : rolesLoaded ? "保存する" : "読み込み中..."}
        </BtnPrimary>
      </>}>
      <FieldInput label="名前" value={name} onChange={setName} required style={{ marginBottom: 16 }} />

      {/* 🌟 修正: 権限ロールを CustomSelect に置き換え */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          権限ロール
        </label>
        <CustomSelect
          value={role}
          options={
            !rolesLoaded
              ? [{ value: member.role, label: "読み込み中..." }]
              : visibleRoles.map(r => ({ value: r.name, label: r.label }))
          }
          onChange={v => setRole(v)}
          disabled={roleDisabled}
        />
      </div>

      {/* 🌟 修正: 所属グループを CustomSelect に置き換え */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          所属グループ
        </label>
        <CustomSelect
          value={group}
          options={[
            ...GROUPS.filter(g => g !== "すべて").map(g => ({ value: g, label: g })),
            { value: "", label: "未割り当て" }
          ]}
          onChange={v => setGroup(v)}
        />
      </div>

      {/* 🌟 修正: ステータスを CustomSelect に置き換え */}
      <div>
        <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
          ステータス
        </label>
        <CustomSelect
          value={status}
          options={[
            { value: "active", label: "アクティブ" },
            { value: "inactive", label: "非アクティブ" },
            { value: "invited", label: "招待中" }
          ]}
          onChange={v => setStatus(v as "active" | "inactive" | "invited")}
        />
      </div>
    </DialogShell>
  );
}
