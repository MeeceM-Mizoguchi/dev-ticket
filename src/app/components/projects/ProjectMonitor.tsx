import { useEffect, useState } from "react";
// 🌟 修正: 進行中工程が取下になった際に表示するアイコン (Ban) を追加
import { X, CheckCircle2, Circle, Ban } from "lucide-react";
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
  // 🌟 追加: 取下フラグと取下日時を管理するためのステート
  const [isWithdrawn, setIsWithdrawn] = useState(false);
  const [withdrawnAt, setWithdrawnAt] = useState<string | null>(null);
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
      if (ticketRes?.data?.progress === -2) setIsWithdrawn(true);
      if (commentsRes?.data) {
        setComments(commentsRes.data);
        // 取下されている場合、最後に「チケットを取下げました」と記録された時間を探す
        const wCmt = [...commentsRes.data].reverse().find(c => c.content && c.content.includes("チケットを取下げました"));
        if (wCmt) setWithdrawnAt(wCmt.created_at || wCmt.createdAt);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [ticketId]);

  // 🌟 追加: 現在取下中の場合は、計測の現在時刻（now）を「取下日時」でストップさせる
  const effectiveNow = isWithdrawn && withdrawnAt ? withdrawnAt : nowIso;

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
      // 最終工程（対応完了）はリリース待ちの間は集計しない
      if (noLaterDone && idx < MILESTONES.length - 1) {
        const elapsed = calcHours(prev, effectiveNow) || 0;
        const stepHoldHours = getHoldHoursForRange(prev, effectiveNow, true);
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

                // 🌟 修正: 現在進行中の工程を特定（最終工程 = 対応完了 はongoing扱いしない）
                const noLaterDone = MILESTONES.slice(idx).every(m => !milestones[m.key]);
                const isOngoing = idx > 0 && idx < MILESTONES.length - 1 && !!prevDate && !dateValue && noLaterDone;

                const hours = isOngoing ? calcHours(prevDate, effectiveNow) : calcHours(prevDate, dateValue);
                const skipped = isReviewSkipped(idx, prevDate, dateValue);
                // 🌟 追加: その工程区間内で発生した保留時間をピンポイントで計算する
                const currentStepHoldHours = getHoldHoursForRange(prevDate, isOngoing ? effectiveNow : dateValue, isOngoing);

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