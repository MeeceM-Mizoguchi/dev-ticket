import { useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
import { DatePicker } from "@/app/components/shared/DatePicker";

export function NewSprintDialog({ onClose, projectId, onCreated }: { onClose: () => void; projectId: string; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      await supabase!.from("sprints").insert({
        id: `S-${Date.now()}`, project_id: projectId, name, goal,
        start_date: startDate || null, end_date: endDate || null, status: "planning",
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
        <DatePicker label="開始日 *" value={startDate} onChange={setStartDate} placeholder="年/月/日" />
        <DatePicker label="終了日 *" value={endDate} onChange={setEndDate} placeholder="年/月/日" min={startDate || undefined} />
      </div>
    </DialogShell>
  );
}
