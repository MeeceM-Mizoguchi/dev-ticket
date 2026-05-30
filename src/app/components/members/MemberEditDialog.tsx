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
import { FieldSelect } from "@/app/components/shared/FieldSelect";

const FALLBACK_ROLES: RoleDefinition[] = [
  { id: 1, name: "admin",           label: "管理者",                   base_permissions: { canCreateTicket: true,  canCreateSprint: true,  canEditDelete: true,  canReview: true,  canGeneratePrompt: true  } },
  { id: 2, name: "project-manager", label: "プロジェクトマネージャー", base_permissions: { canCreateTicket: true,  canCreateSprint: true,  canEditDelete: true,  canReview: true,  canGeneratePrompt: true  } },
  { id: 3, name: "developer",       label: "開発者",                   base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canGeneratePrompt: false } },
  { id: 4, name: "designer",        label: "デザイナー",               base_permissions: { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canGeneratePrompt: false } },
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

      // 名前が変わった場合、projects.members の古い名前を新しい名前に置き換える
      if (name !== member.name) {
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
      <FieldInput label="名前" value={name} onChange={setName} required />
      <FieldSelect label="権限ロール" value={role} onChange={setRole as (v: string) => void}
        disabled={roleDisabled}>
        {!rolesLoaded && <option value={member.role}>読み込み中...</option>}
        {rolesLoaded && visibleRoles.map(r => <option key={r.id} value={r.name}>{r.label}</option>)}
      </FieldSelect>
      <FieldSelect label="所属グループ" value={group} onChange={setGroup}>
        {GROUPS.filter(g => g !== "すべて").map(g => <option key={g} value={g}>{g}</option>)}
        <option value="">未割り当て</option>
      </FieldSelect>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="active">アクティブ</option>
        <option value="inactive">非アクティブ</option>
        <option value="invited">招待中</option>
      </FieldSelect>
    </DialogShell>
  );
}
