import { useState } from "react";
import type { SprintStatus } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";

export function NewSprintDialog({ onClose, projectId, onCreated }: { onClose: () => void; projectId: string; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<SprintStatus>("planning");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("sprints").insert({
        id: `S-${Date.now()}`, project_id: projectId, name, goal,
        start_date: startDate || null, end_date: endDate || null, status,
      });
      setSaving(false);
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規スプリント作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <FieldInput label="スプリント名" placeholder="例: Sprint 5: リリース準備" required value={name} onChange={setName} />
      <FieldTextarea label="ゴール" placeholder="このスプリントで達成するゴールを入力..." value={goal} onChange={setGoal} />
      <div className="grid grid-cols-2 gap-3">
        <FieldInput label="開始日" type="date" required value={startDate} onChange={setStartDate} />
        <FieldInput label="終了日" type="date" required value={endDate} onChange={setEndDate} />
      </div>
      <FieldSelect label="ステータス" value={status} onChange={setStatus as (v: string) => void}>
        <option value="planning">計画中</option>
        <option value="active">進行中</option>
        <option value="completed">完了</option>
        <option value="cancelled">中止</option>
      </FieldSelect>
    </DialogShell>
  );
}
