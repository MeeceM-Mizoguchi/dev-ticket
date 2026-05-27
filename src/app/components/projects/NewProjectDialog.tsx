import { useState } from "react";
import type { Client, ProjectStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";

export function NewProjectDialog({ onClose, clients, onCreated }: { onClose: () => void; clients: Client[]; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<ProjectStatus>("planning");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("projects").insert({
        id: `P-${Date.now()}`, name, client: clientName, description,
        start_date: startDate || null, end_date: endDate || null,
        status, members: [], done: 0, in_progress: 0, todo: 0,
      });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規プロジェクト作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <FieldInput label="プロジェクト名" placeholder="例: ECサイトリニューアル" required value={name} onChange={setName} />
      <FieldSelect label="クライアント" required value={clientName} onChange={setClientName}>
        <option value="">クライアントを選択</option>
        {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
      </FieldSelect>
      <FieldTextarea label="説明" placeholder="プロジェクトの概要を入力..." value={description} onChange={setDescription} />
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" required value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" required value={endDate} onChange={setEndDate} />
      </div>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="planning">計画中</option><option value="in-progress">進行中</option>
        <option value="completed">完了</option><option value="on-hold">保留中</option>
      </FieldSelect>
    </DialogShell>
  );
}
