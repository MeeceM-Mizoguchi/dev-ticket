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
  { value: "planning", label: "計画中" },
  { value: "active", label: "進行中" },
  { value: "completed", label: "完了" },
];

// 日付からステータスを自動計算するヘルパー
function calculateAutoStatus(start: string, end: string): SprintStatus {
  if (!start || !end) return "planning";
  const today = new Date().toISOString().split("T")[0];
  if (today < start) return "planning";
  if (today > end) return "completed";
  return "active";
}

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
  const [isManualStatus, setIsManualStatus] = useState<boolean>(sprint.isManualStatus ?? false);
  const [saving, setSaving] = useState(false);

  const trimmedIdentifier = identifier.trim();

  // 開始日変更時のハンドラー
  const handleStartDateChange = (val: string) => {
    setStartDate(val);
    if (!isManualStatus) {
      setStatus(calculateAutoStatus(val, endDate));
    }
  };

  // 終了日変更時のハンドラー
  const handleEndDateChange = (val: string) => {
    setEndDate(val);
    if (!isManualStatus) {
      setStatus(calculateAutoStatus(startDate, val));
    }
  };

  // ステータスボタン手動選択時のハンドラー（自動で手動モードに切り替え）
  const handleStatusClick = (newStatus: SprintStatus) => {
    setStatus(newStatus);
    setIsManualStatus(true);
  };

  // 自動設定トグルのON/OFF切替
  const handleToggleAuto = () => {
    if (isManualStatus) {
      setIsManualStatus(false);
      const autoStatus = calculateAutoStatus(startDate, endDate);
      setStatus(autoStatus);
    } else {
      setIsManualStatus(true);
    }
  };
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
        is_manual_status: isManualStatus,
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
      <FieldTextarea label="ゴール" placeholder="このスプリントで達成するゴールを入力..." value={goal} onChange={setGoal} onSubmit={() => { if (!saving && canSave) void handleSave(); }} />
      <div className="grid grid-cols-2 gap-3">
        <DatePicker label="開始日" value={startDate} onChange={handleStartDateChange} placeholder="年/月/日" />
        <DatePicker label="終了日" value={endDate} onChange={handleEndDateChange} placeholder="年/月/日" min={startDate || undefined} />
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              ステータス
            </label>
            <span style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 20,
              background: isManualStatus ? "#FFFBEB" : "#ECFDF5",
              color: isManualStatus ? "#D97706" : "#059669",
              border: `1px solid ${isManualStatus ? "rgba(217,119,6,0.25)" : "rgba(5,150,105,0.25)"}`,
            }}>
              {isManualStatus ? "手動設定中" : "自動設定中"}
            </span>
          </div>

          <div
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}
            onClick={handleToggleAuto}
            title={isManualStatus ? "クリックして自動設定に戻す" : "クリックして手動設定に切替"}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>
              ステータス自動設定
            </span>
            <div style={{
              width: 36,
              height: 20,
              borderRadius: 10,
              background: !isManualStatus ? "#059669" : "#D1D5DB",
              position: "relative",
              transition: "background 0.2s ease",
            }}>
              <div style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#FFFFFF",
                position: "absolute",
                top: 2,
                left: !isManualStatus ? 18 : 2,
                transition: "left 0.2s ease",
                boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
              }} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SPRINT_STATUSES.map(s => (
            <button key={s.value} type="button" onClick={() => handleStatusClick(s.value)}
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
        {isManualStatus && (
          <p style={{ fontSize: 11, color: "#D97706", marginTop: 6, lineHeight: 1.4 }}>
            ※手動で変更した場合、今後の期間経過による自動ステータス遷移は行われなくなります。
          </p>
        )}
      </div>
    </DialogShell>
  );
}
