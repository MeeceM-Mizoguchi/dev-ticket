import { useState } from "react";
import type { Member } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { GROUPS } from "@/app/data/mock";
import { useToast } from "@/app/contexts/ToastContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";

export function MemberEditDialog({ member, onClose, onSaved }: { member: Member; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(member.name);
  const [role, setRole] = useState(member.role);
  const [group, setGroup] = useState(member.group);
  const [status, setStatus] = useState(member.status);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("profiles").update({ name, role, group_name: group, status }).eq("id", member.id);
      if (error) { toast("更新に失敗しました", "error"); setSaving(false); return; }
      toast(`「${name}」を更新しました`);
    }
    setSaving(false);
    onSaved();
    onClose();
  };

  return (
    <DialogShell title="メンバー編集" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <FieldInput label="名前" value={name} onChange={setName} required />
      <FieldSelect label="権限ロール" value={role} onChange={setRole as (v: string) => void}>
        <option value="admin">管理者</option>
        <option value="project-manager">プロジェクトマネージャー</option>
        <option value="developer">開発者</option>
        <option value="designer">デザイナー</option>
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
