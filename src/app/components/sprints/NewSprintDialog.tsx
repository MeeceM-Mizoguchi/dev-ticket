import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { usePlan } from "@/app/contexts/PlanContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
import { DatePicker } from "@/app/components/shared/DatePicker";

const ErrMsg = ({ msg }: { msg: string }) => (
  <p style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#DC2626", marginTop: 4 }}>
    <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />{msg}
  </p>
);

export function NewSprintDialog({ onClose, projectId, onCreated, currentSprintCount }: { onClose: () => void; projectId: string; onCreated?: () => void; currentSprintCount?: number }) {
  const { plan } = usePlan();
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const canSubmit = name.trim() !== "" && identifier.trim() !== "";

  const handleSave = async () => {
    setAttempted(true);
    if (!canSubmit) return;
    if (plan.maxSprintsPerProject !== null && currentSprintCount !== undefined && currentSprintCount >= plan.maxSprintsPerProject) {
      setErrorMsg(`現在のプランのスプリント上限（${plan.maxSprintsPerProject}件/プロジェクト）に達しています`);
      return;
    }
    setErrorMsg(null);
    if (isSupabaseEnabled) {
      setSaving(true);
      const { data: inserted, error } = await supabase!.from("sprints").insert({
        id: `S-${Date.now()}`, project_id: projectId, name, goal,
        start_date: startDate || null, end_date: endDate || null, status: "planning",
        identifier: identifier.trim(),
      }).select("id");
      setSaving(false);
      if (error || !inserted?.length) {
        setErrorMsg(`作成に失敗しました: ${error?.message ?? "0件挿入 (RLS ポリシー不足の可能性)"}`);
        return;
      }
    }
    onCreated?.();
    onClose();
  };

  return (
    <DialogShell title="新規スプリント作成" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave} disabled={saving}>{saving ? "作成中..." : "作成する"}</BtnPrimary></>}>
      <div>
        <FieldInput label="スプリント名" placeholder="例: Sprint 5: リリース準備" required value={name} onChange={setName} />
        {attempted && !name.trim() && <ErrMsg msg="スプリント名を入力してください" />}
      </div>
      <div>
        <FieldInput label="スプリント識別子" placeholder="例: SP5, S1（URLに使用）" required value={identifier} onChange={setIdentifier} />
        <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 3 }}>URLに使用されます。英数字推奨（例: SP5, S1, Q1）</p>
        {attempted && !identifier.trim() && <ErrMsg msg="スプリント識別子を入力してください" />}
      </div>
      <FieldTextarea label="ゴール" placeholder="このスプリントで達成するゴールを入力..." value={goal} onChange={setGoal} />
      <div className="grid grid-cols-2 gap-3">
        <DatePicker label="開始日 *" value={startDate} onChange={setStartDate} placeholder="年/月/日" />
        <DatePicker label="終了日 *" value={endDate} onChange={setEndDate} placeholder="年/月/日" min={startDate || undefined} />
      </div>
      {errorMsg && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "10px 14px", borderRadius: 10, background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", color: "#DC2626", fontSize: 12 }}>
          <AlertCircle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 1 }} />
          {errorMsg}
        </div>
      )}
    </DialogShell>
  );
}
