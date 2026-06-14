import { useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
import { DatePicker } from "@/app/components/shared/DatePicker";
import type { Sprint, SprintStatus } from "@/app/types";

// "delayed" is computed from deadline, not stored in DB (constraint: planning/active/completed/cancelled)
const SPRINT_STATUSES: { value: SprintStatus; label: string }[] = [
  { value: "planning",  label: "計画中" },
  { value: "active",    label: "進行中" },
  { value: "completed", label: "完了"   },
];

export function EditSprintDialog({ sprint, otherSprints = [], onClose, onUpdated }: {
  sprint: Sprint;
  otherSprints?: Sprint[];
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal);
  const [startDate, setStartDate] = useState(sprint.startDate || "");
  const [endDate, setEndDate] = useState(sprint.endDate || "");
  const [status, setStatus] = useState<SprintStatus>(sprint.status);
  const [identifier, setIdentifier] = useState(sprint.identifier || "");
  const [saving, setSaving] = useState(false);

  const trimmedIdentifier = identifier.trim();
  const isDuplicateIdentifier = trimmedIdentifier !== "" &&
    otherSprints.some(s => s.identifier === trimmedIdentifier);
  const canSave = !!name.trim() && !!trimmedIdentifier && !isDuplicateIdentifier;

  const handleSave = async () => {
    if (!canSave) return;
    if (isSupabaseEnabled) {
      setSaving(true);
      const newIdentifier = identifier.trim();
      const dbStatus = (status === "delayed" ? "planning" : status);
      await supabase!.from("sprints").update({
        name, goal, status: dbStatus,
        start_date: startDate || null,
        end_date: endDate || null,
        identifier: newIdentifier || null,
      }).eq("id", sprint.id);

      // 識別子が変わった場合、このスプリントの全チケットのWBSを更新
      if (newIdentifier && newIdentifier !== (sprint.identifier || "")) {
        const { data: tickets } = await supabase!
          .from("sprint_tickets")
          .select("id")
          .eq("sprint_id", sprint.id)
          .order("created_at");

        if (tickets?.length) {
          await Promise.all(
            tickets.map((t, i) =>
              supabase!.from("sprint_tickets")
                .update({ wbs: `${newIdentifier}-${String(i + 1).padStart(3, "0")}` })
                .eq("id", t.id)
            )
          );
        }
      }
      setSaving(false);
    }
    onUpdated?.();
    onClose();
  };

  return (
    <DialogShell title="スプリント編集" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave} disabled={!canSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <FieldInput label="スプリント名" placeholder="例: Sprint 5: リリース準備" required value={name} onChange={setName} />
      <div>
        <FieldInput label="スプリント識別子" placeholder="例: SP5, S1（URLに使用）" required value={identifier} onChange={setIdentifier} />
        {isDuplicateIdentifier && (
          <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>
            その識別子はすでに別のスプリントで使用されています。
          </p>
        )}
      </div>
      <FieldTextarea label="ゴール" placeholder="このスプリントで達成するゴールを入力..." value={goal} onChange={setGoal} />
      <div className="grid grid-cols-2 gap-3">
        <DatePicker label="開始日" value={startDate} onChange={setStartDate} placeholder="年/月/日" />
        <DatePicker label="終了日" value={endDate} onChange={setEndDate} placeholder="年/月/日" min={startDate || undefined} />
      </div>
      <div>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>ステータス</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SPRINT_STATUSES.map(s => (
            <button key={s.value} type="button" onClick={() => setStatus(s.value)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                border: `1.5px solid ${status === s.value ? "#059669" : "rgba(26,23,20,0.12)"}`,
                background: status === s.value ? "#059669" : "#F7F8F9",
                color: status === s.value ? "#fff" : "#6B6458",
                transition: "all 0.15s",
              }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </DialogShell>
  );
}
