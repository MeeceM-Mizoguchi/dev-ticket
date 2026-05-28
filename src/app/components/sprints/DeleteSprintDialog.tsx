import { useState } from "react";
import { Plus } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
import { DatePicker } from "@/app/components/shared/DatePicker";
import type { Sprint } from "@/app/types";
import { formatDate, getSprintStatusMeta, computeSprintStatus } from "@/app/lib/helpers";

type Step = "choose" | "select" | "new-sprint";
type DeleteMode = "delete" | "move";

export function DeleteSprintDialog({ sprint, otherSprints, projectId, onClose, onDeleted }: {
  sprint: Sprint;
  otherSprints: Sprint[];
  projectId: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [step, setStep] = useState<Step>("choose");
  const [deleteMode, setDeleteMode] = useState<DeleteMode>("delete");
  const [selectedSprintId, setSelectedSprintId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [newName, setNewName] = useState("");
  const [newGoal, setNewGoal] = useState("");
  const [newStartDate, setNewStartDate] = useState("");
  const [newEndDate, setNewEndDate] = useState("");

  const hasTickets = sprint.tickets.length > 0;

  const deleteWithTickets = async () => {
    setSaving(true);
    if (isSupabaseEnabled) {
      await supabase!.from("sprints").delete().eq("id", sprint.id);
    }
    setSaving(false);
    onDeleted();
    onClose();
  };

  const moveTicketsAndDelete = async (targetSprintId: string) => {
    setSaving(true);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({ sprint_id: targetSprintId }).eq("sprint_id", sprint.id);
      await supabase!.from("sprints").delete().eq("id", sprint.id);
    }
    setSaving(false);
    onDeleted();
    onClose();
  };

  const createSprintAndMove = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    const newSprintId = `S-${Date.now()}`;
    if (isSupabaseEnabled) {
      await supabase!.from("sprints").insert({
        id: newSprintId, project_id: projectId, name: newName, goal: newGoal,
        start_date: newStartDate || null, end_date: newEndDate || null, status: "planning",
      });
      await supabase!.from("sprint_tickets").update({ sprint_id: newSprintId }).eq("sprint_id", sprint.id);
      await supabase!.from("sprints").delete().eq("id", sprint.id);
    }
    setSaving(false);
    onDeleted();
    onClose();
  };

  // ---- Step: choose ----
  if (step === "choose") {
    if (!hasTickets) {
      return (
        <DialogShell title="スプリントの削除" onClose={saving ? () => {} : onClose}
          footer={<>
            <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
            <DeleteBtn onClick={deleteWithTickets} saving={saving} />
          </>}>
          <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>「<strong>{sprint.name}</strong>」を削除しますか？</p>
          <p style={{ fontSize: 12, color: "#A09790" }}>この操作は取り消せません。</p>
        </DialogShell>
      );
    }

    return (
      <DialogShell title="スプリントの削除" onClose={saving ? () => {} : onClose}
        footer={<>
          <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
          {deleteMode === "delete"
            ? <DeleteBtn onClick={deleteWithTickets} saving={saving} />
            : (
              <button type="button" onClick={() => setStep("select")}
                style={{ padding: "9px 20px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
                次へ
              </button>
            )
          }
        </>}>
        <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>
          「<strong>{sprint.name}</strong>」を削除します。このスプリントには <strong>{sprint.tickets.length}件</strong>のチケットがあります。
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(["delete", "move"] as const).map(mode => {
            const isSelected = deleteMode === mode;
            return (
              <div key={mode} onClick={() => setDeleteMode(mode)}
                style={{ padding: "12px 16px", borderRadius: 12, border: `2px solid ${isSelected ? "#059669" : "rgba(26,23,20,0.12)"}`, background: isSelected ? "#F0FDF4" : "#F9F8F6", cursor: "pointer", transition: "all 0.15s" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <RadioDot selected={isSelected} />
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>
                      {mode === "delete" ? "チケットごと削除する" : "チケットを別のスプリントに移動する"}
                    </p>
                    <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
                      {mode === "delete"
                        ? "スプリントに含まれるすべてのチケットを削除します。"
                        : "チケットを別のスプリントに移動してからスプリントを削除します。"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: 11, color: "#A09790" }}>この操作は取り消せません。</p>
      </DialogShell>
    );
  }

  // ---- Step: select sprint ----
  if (step === "select") {
    return (
      <DialogShell title="移動先スプリントの選択" onClose={saving ? () => {} : onClose}
        footer={<>
          <BtnSecondary onClick={() => setStep("choose")} disabled={saving}>戻る</BtnSecondary>
          <button type="button" onClick={() => selectedSprintId && moveTicketsAndDelete(selectedSprintId)}
            disabled={saving || !selectedSprintId}
            style={{ padding: "9px 20px", background: saving || !selectedSprintId ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving || !selectedSprintId ? "not-allowed" : "pointer", display: "flex", alignItems: "center", boxShadow: saving || !selectedSprintId ? "none" : "0 2px 8px rgba(5,150,105,0.25)" }}>
            {saving && <BtnSpinner />}
            {saving ? "処理中..." : "保存して削除"}
          </button>
        </>}>
        <p style={{ fontSize: 13, color: "#6B6458" }}>「{sprint.name}」のチケットを移動するスプリントを選択してください。</p>

        <button type="button" onClick={() => setStep("new-sprint")}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, border: "2px dashed rgba(5,150,105,0.35)", background: "#F0FDF4", color: "#059669", fontSize: 13, fontWeight: 600, cursor: "pointer", width: "100%", transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#DCFCE7"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F0FDF4"; }}>
          <Plus style={{ width: 14, height: 14 }} />
          新規スプリント作成
        </button>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
          {otherSprints.length === 0 ? (
            <p style={{ fontSize: 12, color: "#A09790", padding: "16px 0", textAlign: "center" }}>他のスプリントがありません。上のボタンから新規作成してください。</p>
          ) : otherSprints.map(s => {
            const sm = getSprintStatusMeta(computeSprintStatus(s));
            const isSelected = selectedSprintId === s.id;
            return (
              <div key={s.id} onClick={() => setSelectedSprintId(s.id)}
                style={{ padding: "12px 16px", borderRadius: 10, border: `2px solid ${isSelected ? "#059669" : "rgba(26,23,20,0.10)"}`, background: isSelected ? "#F0FDF4" : "#FAFAF9", cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: 12 }}>
                <RadioDot selected={isSelected} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: sm.bg, color: sm.color, flexShrink: 0 }}>{sm.label}</span>
                  </div>
                  <span style={{ fontSize: 11, color: "#B0A9A4" }}>{formatDate(s.startDate)} → {formatDate(s.endDate)} · {s.tickets.length}件のチケット</span>
                </div>
              </div>
            );
          })}
        </div>
      </DialogShell>
    );
  }

  // ---- Step: new sprint form ----
  return (
    <DialogShell title="新規スプリント作成" onClose={saving ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={() => setStep("select")} disabled={saving}>戻る</BtnSecondary>
        <button type="button" onClick={createSprintAndMove} disabled={saving || !newName.trim()}
          style={{ padding: "9px 20px", background: saving || !newName.trim() ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving || !newName.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", boxShadow: saving || !newName.trim() ? "none" : "0 2px 8px rgba(5,150,105,0.25)" }}>
          {saving && <BtnSpinner />}
          {saving ? "作成中..." : "作成する"}
        </button>
      </>}>
      <p style={{ fontSize: 13, color: "#6B6458" }}>新しいスプリントを作成し、「{sprint.name}」のチケットを移動します。</p>
      <FieldInput label="スプリント名" placeholder="例: Sprint 6: 次のスプリント" required value={newName} onChange={setNewName} />
      <FieldTextarea label="ゴール" placeholder="このスプリントで達成するゴールを入力..." value={newGoal} onChange={setNewGoal} />
      <div className="grid grid-cols-2 gap-3">
        <DatePicker label="開始日" value={newStartDate} onChange={setNewStartDate} placeholder="年/月/日" />
        <DatePicker label="終了日" value={newEndDate} onChange={setNewEndDate} placeholder="年/月/日" min={newStartDate || undefined} />
      </div>
    </DialogShell>
  );
}

function RadioDot({ selected }: { selected: boolean }) {
  return (
    <div style={{ width: 18, height: 18, borderRadius: "50%", border: `2px solid ${selected ? "#059669" : "#C9C4BB"}`, background: selected ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
      {selected && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
    </div>
  );
}

function DeleteBtn({ onClick, saving }: { onClick: () => void; saving: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={saving}
      style={{ padding: "9px 20px", background: saving ? "#9CA3AF" : "#DC2626", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", boxShadow: saving ? "none" : "0 2px 8px rgba(220,38,38,0.30)" }}>
      {saving && <BtnSpinner />}
      {saving ? "削除中..." : "削除する"}
    </button>
  );
}
