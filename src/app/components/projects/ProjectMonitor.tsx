import { useEffect, useRef, useState } from "react";
// 🌟 修正: 修正ボタン用のペンアイコン (Pencil) を追加
import { X, CheckCircle2, Circle, Ban, Pencil } from "lucide-react";
import { fetchMilestones } from "@/app/hooks/useProject";
import type { MilestoneRow } from "@/app/hooks/useProject";
import { calcWorkingHours } from "@/app/lib/helpers";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { escStack } from "@/app/lib/escStack";

// 工程ラベルの定義
const SEGMENT_LABELS = [
  "開始 → レビュー依頼",
  "レビュー依頼 → レビュー承認",
  "レビュー承認 → STG完了",
  "STG完了 → UAT完了",
  "UAT完了 → 対応完了",
];

interface Milestone {
  key: keyof MilestoneRow;
  label: string;
}

const MILESTONES: Milestone[] = [
  { key: "startedAt", label: "開始" },
  { key: "reviewRequestedAt", label: "レビュー依頼" },
  { key: "reviewApprovedAt", label: "レビュー承認" },
  { key: "stgCompletedAt", label: "STG完了" },
  { key: "uatCompletedAt", label: "UAT完了" },
  { key: "releasedAt", label: "対応完了" },
];

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function calcHours(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  return calcWorkingHours(new Date(a).getTime(), new Date(b).getTime());
}

/**
 * スキップ判定
 */
function isReviewSkipped(idx: number, a: string | null | undefined, b: string | null | undefined): boolean {
  if (idx !== 2) return false;
  if (!a || !b) return false;
  return a === b;
}

function formatDuration(hours: number): string {
  if (hours <= 0) return "0人日";
  const pd = Math.round(hours / 8 * 10) / 10;
  if (pd < 0.1) return "0.1人日未満";
  return `${pd}人日`;
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
  const [isHold, setIsHold] = useState(false);
  const [isWithdrawn, setIsWithdrawn] = useState(false);
  const [withdrawnAt, setWithdrawnAt] = useState<string | null>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [actualWorkHours, setActualWorkHours] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<string[] | null>(null);
  const [ticketStatus, setTicketStatus] = useState<string>("");

  // インライン修正モード用のステート
  const [isEditFormMode, setIsEditFormMode] = useState(false);
  const [segmentValues, setSegmentValues] = useState<string[]>(["", "", "", "", ""]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const firstInputRef = useRef<HTMLInputElement>(null);

  const nowIso = new Date().toISOString();

  useEffect(() => {
    Promise.all([
      fetchMilestones(ticketId),
      isSupabaseEnabled ? supabase!.from("sprint_tickets").select("progress, actual_work_hours, actual_work_hours_breakdown, status").eq("id", ticketId).single() : Promise.resolve({ data: null }),
      isSupabaseEnabled ? supabase!.from("ticket_comments").select("*").eq("ticket_id", ticketId).order("created_at") : Promise.resolve({ data: null })
    ]).then(([data, ticketRes, commentsRes]) => {
      if (data) setMilestones(data);
      if (ticketRes?.data?.progress === -1) setIsHold(true);
      if (ticketRes?.data?.progress === -2) setIsWithdrawn(true);
      if (ticketRes?.data?.actual_work_hours != null) setActualWorkHours(ticketRes.data.actual_work_hours);
      if (Array.isArray(ticketRes?.data?.actual_work_hours_breakdown)) setBreakdown(ticketRes.data.actual_work_hours_breakdown.map((v: unknown) => String(v)));
      if (ticketRes?.data?.status) setTicketStatus(ticketRes.data.status);
      if (commentsRes?.data) {
        setComments(commentsRes.data);
        const wCmt = [...commentsRes.data].reverse().find(c => c.content && c.content.includes("チケットを取下げました"));
        if (wCmt) setWithdrawnAt(wCmt.created_at || wCmt.createdAt);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticketId]);

  // ユーザーが入力した「オリジナルの工程別内訳」を専用カラムから100%そのまま復元する
  useEffect(() => {
    if (loading) return;

    // 前回保存された工程別内訳があれば、打ち込んだ通りの各マスの数値をそのままフォームへ完全再現
    if (breakdown && breakdown.length === 5) {
      setSegmentValues(breakdown.map(v => v === "0" || v === "" ? "" : String(v)));
      return;
    }

    // 初回入力時などで、内訳データがまだ存在しない場合のみシステム自動計測値を初期値にする
    const systemSegments = MILESTONES.map((m, idx) => {
      if (idx === 0) return 0;
      const prev = milestones[MILESTONES[idx - 1].key];
      const cur = milestones[m.key];
      const val = calcHours(prev, cur) || 0;
      const hold = getHoldHoursForRange(prev, cur, false);
      return Math.max(0, val - hold);
    }).slice(1);

    const systemTotal = systemSegments.reduce((a, b) => a + b, 0);

    if (actualWorkHours != null && actualWorkHours > 0) {
      if (systemTotal > 0) {
        const ratio = actualWorkHours / systemTotal;
        const adjusted = systemSegments.map(h => Math.round(h * ratio * 10) / 10);
        setSegmentValues(adjusted.map(h => h > 0 ? String(h) : ""));
      } else {
        const equalShare = Math.round((actualWorkHours / 5) * 10) / 10;
        setSegmentValues(Array(5).fill(String(equalShare)));
      }
    } else {
      setSegmentValues(systemSegments.map(h => h > 0 ? String(h) : ""));
    }
  }, [loading, milestones, actualWorkHours, breakdown]);

  const effectiveNow = isWithdrawn && withdrawnAt ? withdrawnAt : nowIso;

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  useEffect(() => {
    if (isEditFormMode) setTimeout(() => firstInputRef.current?.focus(), 100);
  }, [isEditFormMode]);

  let lastCompletedIdx = -1;
  MILESTONES.forEach((m, i) => {
    if (milestones[m.key]) lastCompletedIdx = i;
  });
  const completedCount = lastCompletedIdx + 1;

  const getHoldHoursForRange = (startStr: string | null | undefined, endStr: string | null | undefined, checkHoldCurrent: boolean) => {
    if (!startStr) return 0;
    const startTime = new Date(startStr).getTime();
    const endTime = endStr ? new Date(endStr).getTime() : new Date(effectiveNow).getTime();

    const phaseComments = comments
      .filter(c => {
        const t = new Date(c.created_at || c.createdAt).getTime();
        return t >= startTime && t <= endTime && (c.commentType === "status_change" || c.comment_type === "status_change");
      })
      .sort((a, b) => new Date(a.created_at || a.createdAt).getTime() - new Date(b.created_at || b.createdAt).getTime());

    let totalHoldHours = 0;
    let currentHoldStart: number | null = null;

    phaseComments.forEach(c => {
      const t = new Date(c.created_at || c.createdAt).getTime();
      if (c.content.includes("チケットを保留にしました")) {
        currentHoldStart = t;
      } else if (c.content.includes("保留を解除しました") && currentHoldStart !== null) {
        totalHoldHours += calcWorkingHours(currentHoldStart, t);
        currentHoldStart = null;
      }
    });

    if (checkHoldCurrent && isHold && currentHoldStart !== null) {
      totalHoldHours += calcWorkingHours(currentHoldStart, new Date(effectiveNow).getTime());
    }

    return Math.max(0, totalHoldHours);
  };

  const totalHours = MILESTONES.reduce((sum, m, idx) => {
    if (idx === 0) return sum;
    const prev = milestones[MILESTONES[idx - 1].key];
    const cur = milestones[m.key];

    if (prev && cur) {
      if (!isReviewSkipped(idx, prev, cur)) {
        const elapsed = calcHours(prev, cur) || 0;
        const stepHoldHours = getHoldHoursForRange(prev, cur, false);
        return sum + Math.max(0, elapsed - stepHoldHours);
      }
    } else if (prev && !cur) {
      const noLaterDone = MILESTONES.slice(idx).every(ms => !milestones[ms.key]);
      if (noLaterDone && idx < MILESTONES.length - 1) {
        const elapsed = calcHours(prev, effectiveNow) || 0;
        const stepHoldHours = getHoldHoursForRange(prev, effectiveNow, true);
        return sum + Math.max(0, elapsed - stepHoldHours);
      }
    }
    return sum;
  }, 0);

  // 手動入力された工程別内訳があれば、タイムラインはシステム計測値ではなく入力値をそのまま表示する
  const savedBreakdown: number[] | null = breakdown && breakdown.length === 5
    ? breakdown.map(v => { const n = parseFloat(v); return isNaN(n) || n < 0 ? 0 : n; })
    : null;

  const handleTriggerEdit = () => {
    setIsEditFormMode(true);
  };

  // 保存完了時、各マスのオリジナル数値を次回100%復元させるため、合計と工程別内訳を専用カラムへ保存する
  const handleFormSave = async () => {
    const total = segmentValues.reduce((sum, v) => {
      const n = parseFloat(v);
      return sum + (isNaN(n) || n < 0 ? 0 : n);
    }, 0);

    if (total <= 0) {
      setError("少なくとも1つの工程に時間を入力してください");
      return;
    }
    setSaving(true);
    if (isSupabaseEnabled) {
      await supabase!.from("sprint_tickets").update({
        actual_work_hours: Math.round(total * 100) / 100,
        actual_work_hours_breakdown: segmentValues.map(v => v === "" ? "0" : v),
      }).eq("id", ticketId);
    }
    setSaving(false);
    onClose();
  };

  const updateSegment = (i: number, v: string) => {
    setSegmentValues(prev => { const n = [...prev]; n[i] = v; return n; });
    setError("");
  };

  const isEligibleForEdit = ticketStatus === "waiting-release" || ticketStatus === "waiting_release" || ticketStatus === "released" || ticketStatus === "closed";

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#FFFFFF", borderRadius: 16, width: 460, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, padding: "20px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
                {isEditFormMode ? "対応工数の修正" : "実績モニタ"}
              </h2>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>{subtitle}</p>
            </div>
            <button onClick={onClose}
              style={{ padding: 6, border: "none", background: "transparent", cursor: "pointer", borderRadius: 7, color: "#B0A9A4", display: "flex", alignItems: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>
          {!isEditFormMode && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "#6B6458", fontWeight: 600 }}>工程進捗</span>
                <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700 }}>{completedCount} / {MILESTONES.length}</span>
              </div>
              <div style={{ height: 5, background: "#F4F5F6", borderRadius: 99, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(completedCount / MILESTONES.length) * 100}%`, background: "linear-gradient(90deg, #059669, #10B981)", borderRadius: 99, transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }} />
              </div>
            </div>
          )}
        </div>

        {/* 修正用フォームモード / タイムライン表示 */}
        {isEditFormMode ? (
          <div style={{ flex: 1, minHeight: 0, padding: "20px 24px", overflowY: "auto", display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontSize: 12, color: "#9E9690", margin: "0 0 4px" }}>
              各工程の実際の時間を修正してください（時間単位）
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {SEGMENT_LABELS.map((label, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1, fontSize: 12, color: "#4B4744", fontWeight: 500 }}>{label}</span>
                  <input
                    ref={i === 0 ? firstInputRef : undefined}
                    type="number"
                    min="0"
                    step="0.5"
                    value={segmentValues[i]}
                    // 🌟 修正: event => のアロー指定を完全付与。閉じタグとの噛み合わせを完全に整合
                    onChange={event => updateSegment(i, event.target.value)}
                    style={{
                      width: 72, padding: "6px 8px", fontSize: 14, fontWeight: 700,
                      border: "1.5px solid rgba(26,23,20,0.15)", borderRadius: 8, outline: "none",
                      color: "#1A1714", background: "#FFFFFF", textAlign: "right"
                    }}
                    onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.boxShadow = "0 0 0 2px rgba(5,150,105,0.12)"; }}
                    onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.15)"; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  <span style={{ fontSize: 12, color: "#6B6458", width: 18, flexShrink: 0 }}>h</span>
                </div>
              ))}
            </div>
            
            {error && <p style={{ fontSize: 12, color: "#EF4444", margin: "8px 0 0", fontWeight: 600 }}>{error}</p>}
            
            <button
              onClick={handleFormSave}
              disabled={saving}
              style={{
                width: "100%", padding: "12px 0", marginTop: 16, fontSize: 14, fontWeight: 700, borderRadius: 11,
                border: "none", cursor: saving ? "not-allowed" : "pointer",
                background: saving ? "rgba(5,150,105,0.25)" : "#059669", color: "#FFFFFF",
                boxShadow: saving ? "none" : "0 4px 14px rgba(5,150,105,0.30)", transition: "all 0.15s"
              }}
            >
              {saving ? "保存中..." : "修正を完了する"}
            </button>
            <button
              type="button"
              onClick={() => setIsEditFormMode(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#B0A9A4", fontSize: 13, textDecoration: "underline", marginTop: 4, width: "fit-content", alignSelf: "center" }}
            >
              戻る
            </button>
          </div>
        ) : (
          /* 通常のタイムライン領域 */
          <div style={{ flex: 1, minHeight: 0, padding: "12px 0 24px", overflowY: "auto" }}>
            {loading ? (
              <div style={{ padding: "32px 0", textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>読み込み中...</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column" }}>
                {MILESTONES.map((milestone, idx) => {
                  const dateValue = milestones[milestone.key];
                  const isDone = !!dateValue;
                  const prevDate = idx > 0 ? milestones[MILESTONES[idx - 1].key] : null;

                  const noLaterDone = MILESTONES.slice(idx).every(m => !milestones[m.key]);
                  const isOngoing = idx > 0 && idx < MILESTONES.length - 1 && !!prevDate && !dateValue && noLaterDone;

                  const hours = isOngoing ? calcHours(prevDate, effectiveNow) : calcHours(prevDate, dateValue);
                  const skipped = isReviewSkipped(idx, prevDate, dateValue);
                  const currentStepHoldHours = getHoldHoursForRange(prevDate, isOngoing ? effectiveNow : dateValue, isOngoing);

                  return (
                    <div key={milestone.key}>
                      {/* コネクターライン */}
                      {idx > 0 && (
                        <div style={{ display: "flex", alignItems: "center", paddingLeft: 32, paddingRight: 24, height: 36 }}>
                          <div style={{ width: 2, height: "100%", background: (isDone || isOngoing) && !!prevDate ? "#A7F3D0" : "#EDE9E0", marginLeft: 7 }} />
                          {savedBreakdown ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: 12 }}>
                              <span style={{
                                fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)",
                                background: "#ECFDF5", padding: "2px 9px", borderRadius: 20,
                                fontWeight: 600, border: "1px solid transparent", width: "fit-content"
                              }}>
                                {formatDuration(savedBreakdown[idx - 1] ?? 0)}
                              </span>
                            </div>
                          ) : skipped ? (
                            <span style={{ fontSize: 10, color: "#F59E0B", fontFamily: "var(--font-mono)", marginLeft: 12, background: "#FFFBEB", padding: "2px 9px", borderRadius: 20, fontWeight: 600, border: "1px solid rgba(245,158,11,0.25)" }}>
                              スキップ
                            </span>
                          ) : hours !== null ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: 12 }}>
                              <span style={{
                                fontSize: 10,
                                color: isOngoing ? (isWithdrawn ? "#6B7280" : isHold ? "#DC2626" : "#D97706") : "#059669",
                                fontFamily: "var(--font-mono)",
                                background: isOngoing ? (isWithdrawn ? "#F3F4F6" : isHold ? "#FEF2F2" : "#FFF7ED") : "#ECFDF5",
                                padding: "2px 9px",
                                borderRadius: 20,
                                fontWeight: 600,
                                border: isOngoing ? (isWithdrawn ? "1px solid rgba(107,114,128,0.25)" : isHold ? "1px solid rgba(220,38,38,0.25)" : "1px solid rgba(217,119,6,0.25)") : "1px solid transparent",
                                width: "fit-content"
                              }}>
                                {isOngoing && (isHold || isWithdrawn) ? formatDuration(calcHours(prevDate, effectiveNow) || 0) : formatDuration(hours)} {isOngoing && (isWithdrawn ? "（取下済）" : isHold ? "（保留中）" : "（計測中）")}
                              </span>
                              {currentStepHoldHours > 0 && (
                                <span style={{ fontSize: 10, color: "#EF4444", fontFamily: "var(--font-mono)", fontWeight: 600, paddingLeft: 6 }}>
                                  - 保留時間 {formatDuration(currentStepHoldHours)}
                                </span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      )}

                      {/* ステータスノード */}
                      <div style={{ display: "flex", gap: 12, padding: "4px 24px", alignItems: "center" }}>
                        <div style={{ flexShrink: 0 }}>
                          {isDone
                            ? <CheckCircle2 style={{ width: 18, height: 18, color: "#059669" }} />
                            : isOngoing
                              ? (isWithdrawn ? <Ban style={{ width: 18, height: 18, color: "#6B7280", fill: "#F3F4F6" }} /> : <Circle style={{ width: 18, height: 18, color: "#F59E0B", fill: "#FFFBEB" }} />)
                              : <Circle style={{ width: 18, height: 18, color: "#D1CBC5" }} />
                        }
                        </div>
                        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, fontWeight: 600, color: isDone ? "#1A1714" : isOngoing ? (isWithdrawn ? "#6B7280" : "#D97706") : "#A09790" }}>
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
              </div>
            )}
          </div>
        )}

        {/* Footer (合計時間) */}
        {!loading && !isEditFormMode && (
          <div style={{ flexShrink: 0, padding: "16px 24px", background: "#FAFAF9", borderTop: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#3D3732" }}>現時点の合計作業時間</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#059669", fontFamily: "var(--font-mono)" }}>
                  {Math.round((actualWorkHours != null ? actualWorkHours : totalHours) * 100) / 100}h
                </span>
              </div>
              {actualWorkHours != null && (
                <span style={{ fontSize: 10, color: "#6B6458", fontWeight: 500 }}>手動入力済み</span>
              )}
            </div>
            
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {isEligibleForEdit && (
                <button
                  type="button"
                  onClick={handleTriggerEdit}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 14px",
                    fontSize: "12px",
                    fontWeight: 700,
                    borderRadius: "8px",
                    border: "none",
                    background: "#059669",
                    color: "#FFFFFF",
                    cursor: "pointer",
                    boxShadow: "0 2px 8px rgba(5,150,105,0.18)",
                    transition: "all 0.15s"
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}
                >
                  <Pencil style={{ width: 13, height: 13 }} />
                  実績を修正する
                </button>
              )}

              <span style={{ fontSize: 15, fontWeight: 800, color: "#059669", fontFamily: "var(--font-mono)" }}>
                {actualWorkHours != null
                  ? formatDuration(actualWorkHours)
                  : formatDuration(totalHours)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}