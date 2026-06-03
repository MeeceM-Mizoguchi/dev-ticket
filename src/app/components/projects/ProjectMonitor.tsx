import { useEffect, useState } from "react";
import { X, CheckCircle2, Circle } from "lucide-react";
import { fetchMilestones } from "@/app/hooks/useProject";
import type { MilestoneRow } from "@/app/hooks/useProject";

interface Milestone {
  key: keyof MilestoneRow;
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
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function calcHours(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  return (new Date(b).getTime() - new Date(a).getTime()) / (1000 * 60 * 60);
}

/**
 * スキップ判定：カスケード記録時は同一の `now` を使うため完全一致になる。
 * 通常のレビュー依頼→承認は2回の別操作なので最低1ms以上ズレる。
 * idx=2 (レビュー依頼→レビュー承認のコネクタ) のみ対象。
 */
function isReviewSkipped(idx: number, a: string | null | undefined, b: string | null | undefined): boolean {
  if (idx !== 2) return false;
  if (!a || !b) return false;
  return a === b;
}

function formatDuration(hours: number): string {
  if (hours < 1 / 60) return "1分未満";
  if (hours < 1) return `${Math.round(hours * 60)}分`;
  const h = Math.round(hours * 10) / 10;
  const pd = hours / 8;
  const pdStr = pd >= 0.1
    ? (Number.isInteger(Math.round(pd * 10) / 10) ? `${Math.round(pd)}人日` : `${(Math.round(pd * 10) / 10).toFixed(1)}人日`)
    : "0.1人日未満";
  return `${h}時間（${pdStr}）`;
}

export function ProjectMonitor({
  ticketId,
  subtitle,
  onClose,
}: {
  ticketId: string;
  subtitle: string;
  onClose: () => void;
}) {
  const [milestones, setMilestones] = useState<MilestoneRow>({
    startedAt: null, reviewRequestedAt: null, reviewApprovedAt: null,
    stgCompletedAt: null, uatCompletedAt: null, releasedAt: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMilestones(ticketId).then(data => {
      if (data) setMilestones(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticketId]);

  const completedCount = MILESTONES.filter(m => !!milestones[m.key]).length;

  const totalHours = MILESTONES.reduce((sum, m, idx) => {
    if (idx === 0) return sum;
    const prev = milestones[MILESTONES[idx - 1].key];
    const cur = milestones[m.key];
    const h = calcHours(prev, cur);
    if (h === null) return sum;
    if (isReviewSkipped(idx, prev, cur)) return sum;
    return sum + h;
  }, 0);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FFFFFF", borderRadius: 16, width: 460, maxHeight: "82vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>実績モニタ</h2>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>{subtitle}</p>
            </div>
            <button onClick={onClose}
              style={{ padding: 6, border: "none", background: "transparent", cursor: "pointer", borderRadius: 7, color: "#B0A9A4", display: "flex", alignItems: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
              <span style={{ fontSize: 10, color: "#6B6458", fontWeight: 600 }}>工程進捗</span>
              <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{completedCount} / {MILESTONES.length}</span>
            </div>
            <div style={{ height: 5, background: "#F4F5F6", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${(completedCount / MILESTONES.length) * 100}%`, background: "linear-gradient(90deg, #059669, #10B981)", borderRadius: 99, transition: "width 0.3s" }} />
            </div>
          </div>
        </div>

        {/* Milestones */}
        <div style={{ padding: "4px 0 0", overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>読み込み中...</div>
          ) : (
            <>
              {MILESTONES.map((milestone, idx) => {
                const dateValue = milestones[milestone.key];
                const isDone = !!dateValue;
                const prevDate = idx > 0 ? milestones[MILESTONES[idx - 1].key] : null;
                const hours = calcHours(prevDate, dateValue);
                const skipped = isReviewSkipped(idx, prevDate, dateValue);

                return (
                  <div key={milestone.key}>
                    {idx > 0 && (
                      <div style={{ display: "flex", alignItems: "center", paddingLeft: 32, paddingRight: 24, height: 32 }}>
                        <div style={{ width: 1, height: "100%", background: isDone && !!prevDate ? "#A7F3D0" : "#EDE9E0", marginLeft: 8 }} />
                        {skipped ? (
                          <span style={{ fontSize: 10, color: "#F59E0B", fontFamily: "var(--font-mono)", marginLeft: 12, background: "#FFFBEB", padding: "2px 9px", borderRadius: 20, fontWeight: 600, border: "1px solid rgba(245,158,11,0.25)" }}>
                            スキップ
                          </span>
                        ) : hours !== null ? (
                          <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", marginLeft: 12, background: "#ECFDF5", padding: "2px 9px", borderRadius: 20, fontWeight: 600 }}>
                            {formatDuration(hours)}
                          </span>
                        ) : null}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 12, padding: "4px 24px", alignItems: "center" }}>
                      <div style={{ flexShrink: 0 }}>
                        {isDone
                          ? <CheckCircle2 style={{ width: 18, height: 18, color: "#059669" }} />
                          : <Circle style={{ width: 18, height: 18, color: "#D1CBC5" }} />
                        }
                      </div>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: isDone ? "#1A1714" : "#A09790" }}>
                          {milestone.label}
                        </span>
                        {isDone ? (
                          <span style={{ fontSize: 11, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 500 }}>
                            {formatDateTime(dateValue)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#C9C4BB" }}>未記録</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

              {completedCount >= 2 && (
                <div style={{ margin: "12px 24px 16px", padding: "12px 16px", background: "#F0FDF4", borderRadius: 10, border: "1px solid rgba(5,150,105,0.15)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#3D3732" }}>合計工数</span>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#059669", fontFamily: "var(--font-mono)" }}>
                    {formatDuration(totalHours)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
