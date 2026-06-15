import { useEffect, useState } from "react";
import { X, CheckCircle2, Circle } from "lucide-react";
import { fetchMilestones } from "@/app/hooks/useProject";
import type { MilestoneRow } from "@/app/hooks/useProject";
import { calcWorkingHours } from "@/app/lib/helpers";
// 🌟 追加: データベース接続チェック用の道具をインポート
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { escStack } from "@/app/lib/escStack";

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
  { key: "releasedAt", label: "リリース" },
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
 * スキップ判定：カスケード記録時は同一の `now` を使うため完全一致になる。
 * idx=2 (レビュー依頼→レビュー承認のコネクタ) のみ対象。
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
  // 🌟 追加: 保留中フラグを管理するためのステート
  const [isHold, setIsHold] = useState(false);
  // 🌟 追加: 保留時間を逆算するためにコメント履歴を保持するステート
  const [comments, setComments] = useState<any[]>([]);

  // モーダルを開いた瞬間の時間を「計測中」の計算用に使用する
  const nowIso = new Date().toISOString();

  useEffect(() => {
    // 🌟 修正: milestones と ticket の進捗、さらに保留コメントを抽出するためにコメント履歴を並列取得する
    Promise.all([
      fetchMilestones(ticketId),
      isSupabaseEnabled ? supabase!.from("sprint_tickets").select("progress").eq("id", ticketId).single() : Promise.resolve({ data: null }),
      isSupabaseEnabled ? supabase!.from("ticket_comments").select("*").eq("ticket_id", ticketId).order("created_at") : Promise.resolve({ data: null })
    ]).then(([data, ticketRes, commentsRes]) => {
      if (data) setMilestones(data);
      if (ticketRes?.data?.progress === -1) setIsHold(true);
      if (commentsRes?.data) setComments(commentsRes.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticketId]);

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  // 🌟 修正: 抜け漏れや後戻りに対応するため、「記録済みの最も後ろの工程」を算出
  let lastCompletedIdx = -1;
  MILESTONES.forEach((m, i) => {
    if (milestones[m.key]) lastCompletedIdx = i;
  });
  const completedCount = lastCompletedIdx + 1;

  // 🌟 追加: 特定の期間（工程の開始〜終了）の間に発生した保留時間をピンポイントで計算する共通ヘルパー関数
  const getHoldHoursForRange = (startStr: string | null | undefined, endStr: string | null | undefined, checkHoldCurrent: boolean) => {
    if (!startStr) return 0;
    const startTime = new Date(startStr).getTime();
    const endTime = endStr ? new Date(endStr).getTime() : new Date(nowIso).getTime();

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
      totalHoldHours += calcWorkingHours(currentHoldStart, new Date(nowIso).getTime());
    }

    return Math.max(0, totalHoldHours);
  };

  // 🌟 修正: 過去の完了した工程も、現在進行中の工程も、それぞれの区間内で発生した保留時間をそれぞれ引いて合算する
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
      if (noLaterDone) {
        const elapsed = calcHours(prev, nowIso) || 0;
        const stepHoldHours = getHoldHoursForRange(prev, nowIso, true);
        return sum + Math.max(0, elapsed - stepHoldHours);
      }
    }
    return sum;
  }, 0);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      {/* 🌟 修正: maxHeightとflexboxを設定し、下部が潰れず内部スクロールできるように改修 */}
      <div
        style={{ background: "#FFFFFF", borderRadius: 16, width: 460, maxHeight: "85vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.18)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header (固定) */}
        <div style={{ flexShrink: 0, padding: "20px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
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
              <div style={{ height: "100%", width: `${(completedCount / MILESTONES.length) * 100}%`, background: "linear-gradient(90deg, #059669, #10B981)", borderRadius: 99, transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)" }} />
            </div>
          </div>
        </div>

        {/* Milestones Timeline (スクロール領域) */}
        <div style={{ flex: 1, minHeight: 0, padding: "12px 0 24px", overflowY: "auto" }}>
          {loading ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#B0A9A4", fontSize: 12 }}>読み込み中...</div>
          ) : (
            <>
              {MILESTONES.map((milestone, idx) => {
                const dateValue = milestones[milestone.key];
                const isDone = !!dateValue;
                const prevDate = idx > 0 ? milestones[MILESTONES[idx - 1].key] : null;

                // 🌟 修正: 現在進行中の工程を特定
                const noLaterDone = MILESTONES.slice(idx).every(m => !milestones[m.key]);
                const isOngoing = idx > 0 && !!prevDate && !dateValue && noLaterDone;

                const hours = isOngoing ? calcHours(prevDate, nowIso) : calcHours(prevDate, dateValue);
                const skipped = isReviewSkipped(idx, prevDate, dateValue);
                // 🌟 追加: その工程区間内で発生した保留時間をピンポイントで計算する
                const currentStepHoldHours = getHoldHoursForRange(prevDate, isOngoing ? nowIso : dateValue, isOngoing);

                return (
                  <div key={milestone.key}>
                    {/* コネクターライン */}
                    {idx > 0 && (
                      <div style={{ display: "flex", alignItems: "center", paddingLeft: 32, paddingRight: 24, height: 36 }}>
                        <div style={{ width: 2, height: "100%", background: (isDone || isOngoing) && !!prevDate ? "#A7F3D0" : "#EDE9E0", marginLeft: 7 }} />
                        {skipped ? (
                          <span style={{ fontSize: 10, color: "#F59E0B", fontFamily: "var(--font-mono)", marginLeft: 12, background: "#FFFBEB", padding: "2px 9px", borderRadius: 20, fontWeight: 600, border: "1px solid rgba(245,158,11,0.25)" }}>
                            スキップ
                          </span>
                        ) : hours !== null ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginLeft: 12 }}>
                            <span style={{
                              fontSize: 10,
                              color: isOngoing ? (isHold ? "#DC2626" : "#D97706") : "#059669",
                              fontFamily: "var(--font-mono)",
                              background: isOngoing ? (isHold ? "#FEF2F2" : "#FFF7ED") : "#ECFDF5",
                              padding: "2px 9px",
                              borderRadius: 20,
                              fontWeight: 600,
                              border: isOngoing ? (isHold ? "1px solid rgba(220,38,38,0.25)" : "1px solid rgba(217,119,6,0.25)") : "1px solid transparent",
                              width: "fit-content"
                            }}>
                              {isOngoing && isHold ? formatDuration(calcHours(prevDate, nowIso) || 0) : formatDuration(hours)} {isOngoing && (isHold ? "（保留中）" : "（計測中）")}
                            </span>
                            {/* 🌟 修正: この工程の区間内で発生した保留時間（currentStepHoldHours > 0）が存在すれば、工程が進んだ後でも常にマイナス表示を残す */}
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
                            ? <Circle style={{ width: 18, height: 18, color: "#F59E0B", fill: "#FFFBEB" }} />
                            : <Circle style={{ width: 18, height: 18, color: "#D1CBC5" }} />
                        }
                      </div>
                      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: isDone ? "#1A1714" : isOngoing ? "#D97706" : "#A09790" }}>
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
            </>
          )}
        </div>

        {/* Footer (合計時間 - 常に固定表示) */}
        {!loading && (
          <div style={{ flexShrink: 0, padding: "16px 24px", background: "#FAFAF9", borderTop: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#3D3732" }}>現時点の合計作業時間</span>
            <span style={{ fontSize: 15, fontWeight: 800, color: "#059669", fontFamily: "var(--font-mono)" }}>
              {formatDuration(totalHours)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}