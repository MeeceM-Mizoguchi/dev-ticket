import { useState } from "react";
import { X, CheckCircle2, Clock, Circle, Pencil, Check, XIcon } from "lucide-react";
import type { Project } from "@/app/types";
import type { MilestoneKey } from "@/app/hooks/useProject";
import { recordMilestone } from "@/app/hooks/useProject";

interface Milestone {
  key: MilestoneKey;
  label: string;
}

const MILESTONES: Milestone[] = [
  { key: "startedAt",          label: "開始" },
  { key: "reviewRequestedAt",  label: "レビュー依頼" },
  { key: "reviewApprovedAt",   label: "レビュー承認" },
  { key: "stgCompletedAt",     label: "STG完了" },
  { key: "uatCompletedAt",     label: "UAT完了" },
  { key: "releasedAt",         label: "リリース" },
];

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${day} ${h}:${min}`;
}

function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export function ProjectMonitor({
  project,
  onClose,
  onUpdated,
}: {
  project: Project;
  onClose: () => void;
  onUpdated: (key: MilestoneKey, value: string | null) => void;
}) {
  const [editing, setEditing] = useState<MilestoneKey | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const startEdit = (key: MilestoneKey, current: string | null | undefined) => {
    setEditing(key);
    setEditValue(toDateInputValue(current));
  };

  const cancelEdit = () => {
    setEditing(null);
    setEditValue("");
  };

  const saveEdit = async (key: MilestoneKey) => {
    setSaving(true);
    const isoValue = editValue ? new Date(editValue).toISOString() : null;
    await recordMilestone(project.id, key, isoValue);
    onUpdated(key, isoValue);
    setSaving(false);
    setEditing(null);
  };

  const recordNow = async (key: MilestoneKey) => {
    setSaving(true);
    const now = new Date().toISOString();
    await recordMilestone(project.id, key, now);
    onUpdated(key, now);
    setSaving(false);
  };

  const clearMilestone = async (key: MilestoneKey) => {
    setSaving(true);
    await recordMilestone(project.id, key, null);
    onUpdated(key, null);
    setSaving(false);
  };

  const completedCount = MILESTONES.filter(m => !!project[m.key]).length;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FFFFFF", borderRadius: 16, width: 520, maxHeight: "80vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>実績モニタ</h2>
              <p style={{ fontSize: 12, color: "#A09790", marginTop: 2 }}>{project.name}</p>
            </div>
            <button onClick={onClose} style={{ padding: 6, border: "none", background: "transparent", cursor: "pointer", borderRadius: 7, color: "#B0A9A4", display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
              <X style={{ width: 16, height: 16 }} />
            </button>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#6B6458", fontWeight: 600 }}>工程進捗</span>
              <span style={{ fontSize: 11, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{completedCount} / {MILESTONES.length}</span>
            </div>
            <div style={{ height: 6, background: "#F4F5F6", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(completedCount / MILESTONES.length) * 100}%`, background: "linear-gradient(90deg, #059669, #10B981)", borderRadius: 99, transition: "width 0.3s" }} />
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div style={{ padding: "8px 0", overflowY: "auto", flex: 1 }}>
          {MILESTONES.map((milestone, idx) => {
            const dateValue = project[milestone.key];
            const isDone = !!dateValue;
            const isEditingThis = editing === milestone.key;
            const isLast = idx === MILESTONES.length - 1;

            return (
              <div key={milestone.key} style={{ display: "flex", gap: 16, padding: "12px 24px", borderBottom: isLast ? "none" : "1px solid rgba(26,23,20,0.05)" }}>
                {/* Timeline icon */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 2 }}>
                  {isDone
                    ? <CheckCircle2 style={{ width: 18, height: 18, color: "#059669", flexShrink: 0 }} />
                    : <Circle style={{ width: 18, height: 18, color: "#D1CBC5", flexShrink: 0 }} />
                  }
                  {!isLast && <div style={{ width: 1, flex: 1, marginTop: 4, background: isDone ? "#A7F3D0" : "#F0EDE8" }} />}
                </div>

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: isDone ? "#1A1714" : "#A09790" }}>{milestone.label}</span>

                    {!isEditingThis && (
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {isDone ? (
                          <>
                            <button onClick={() => startEdit(milestone.key, dateValue)} disabled={saving}
                              style={{ padding: "3px 8px", fontSize: 11, border: "1px solid rgba(26,23,20,0.12)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", gap: 3 }}>
                              <Pencil style={{ width: 9, height: 9 }} />修正
                            </button>
                            <button onClick={() => clearMilestone(milestone.key)} disabled={saving}
                              style={{ padding: "3px 8px", fontSize: 11, border: "1px solid rgba(220,38,38,0.25)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "#DC2626" }}>
                              クリア
                            </button>
                          </>
                        ) : (
                          <button onClick={() => recordNow(milestone.key)} disabled={saving}
                            style={{ padding: "4px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 6, background: "#059669", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", gap: 4 }}>
                            <Clock style={{ width: 9, height: 9 }} />今すぐ記録
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {isEditingThis ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
                      <input
                        type="date"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        style={{ border: "1px solid rgba(5,150,105,0.4)", borderRadius: 7, padding: "5px 10px", fontSize: 12, outline: "none", color: "#1A1714" }}
                      />
                      <button onClick={() => saveEdit(milestone.key)} disabled={saving}
                        style={{ padding: "5px 10px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: 7, background: "#059669", cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", gap: 4 }}>
                        <Check style={{ width: 11, height: 11 }} />保存
                      </button>
                      <button onClick={cancelEdit} disabled={saving}
                        style={{ padding: "5px 8px", fontSize: 11, border: "1px solid rgba(26,23,20,0.12)", borderRadius: 7, background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center" }}>
                        <XIcon style={{ width: 11, height: 11 }} />
                      </button>
                    </div>
                  ) : (
                    isDone && (
                      <p style={{ fontSize: 12, color: "#059669", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                        {formatDateTime(dateValue)}
                      </p>
                    )
                  )}

                  {!isDone && !isEditingThis && (
                    <p style={{ fontSize: 11, color: "#C9C4BB", marginTop: 2 }}>未記録</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
