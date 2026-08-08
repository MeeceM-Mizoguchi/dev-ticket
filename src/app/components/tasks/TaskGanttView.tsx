// ENHA2-032 タスクのガントビュー。
//
// SprintGanttView は Sprint / SprintTicket 型に密結合しているのでコンポーネントは流用せず、
// 日付計算（helpers の daysBetween）とレイアウトの作り（左ペイン固定＋右が日グリッド）だけ踏襲する。
// スプリント側のコードには一切触れない。
//
// 横スクロールは外側の1枚だけに持たせ、左ペインは position:sticky で貼り付ける
// （ヘッダーと本体で2つのスクロールを同期させる必要がなくなる）。
import { useMemo } from "react";
import { FolderKanban, CalendarDays, CornerDownRight } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { daysBetween } from "@/app/lib/helpers";
import { getTaskStatusMeta, getTaskPriorityMeta } from "@/app/lib/taskService";
import { isOverdue } from "@/app/components/tasks/TaskListView";
import type { Task } from "@/app/types";

const DAY_W = 20;
const LEFT_W = 260;
const ROW_H = 34;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

/** 期間の両端。開始だけ／期限だけのタスクは1日分の棒にする */
function span(t: Task): { from: string; to: string } | null {
  const from = t.startDate || t.dueDate;
  const to = t.dueDate || t.startDate;
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

export function TaskGanttView({
  tasks, projectNameOf, selectedId, onSelect,
}: {
  tasks: Task[];
  projectNameOf: (id: string | null) => string;
  selectedId: string | null;
  onSelect: (t: Task) => void;
}) {
  const today = new Date().toLocaleDateString("sv-SE");

  const dated = tasks.filter(t => span(t) !== null);
  const undated = tasks.filter(t => span(t) === null);

  // 表示範囲。前後に少し余白を足して、棒が端に貼り付かないようにする
  const { minDate, totalDays } = useMemo(() => {
    if (dated.length === 0) return { minDate: addDays(today, -7), totalDays: 42 };
    let lo = "9999-12-31", hi = "0000-01-01";
    for (const t of dated) {
      const s = span(t)!;
      if (s.from < lo) lo = s.from;
      if (s.to > hi) hi = s.to;
    }
    if (today < lo) lo = today;
    if (today > hi) hi = today;
    const start = addDays(lo, -3);
    return { minDate: start, totalDays: daysBetween(start, addDays(hi, 4)) + 1 };
  }, [dated, today]);

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(minDate, i)),
    [minDate, totalDays],
  );

  // 月ヘッダー（同じ月が続く分だけセルを結合する）
  const months = useMemo(() => {
    const out: { label: string; days: number }[] = [];
    for (const d of days) {
      const [y, m] = d.split("-");
      const label = `${y}/${Number(m)}`;
      const last = out[out.length - 1];
      if (last && last.label === label) last.days += 1;
      else out.push({ label, days: 1 });
    }
    return out;
  }, [days]);

  // プロジェクトごとにまとめる。個人タスクは「プロジェクトなし」
  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of dated) {
      const key = t.projectId ?? "";
      const arr = map.get(key);
      if (arr) arr.push(t); else map.set(key, [t]);
    }
    return [...map.entries()].map(([id, list]) => ({
      id,
      name: id ? projectNameOf(id) : "プロジェクトなし",
      tasks: list.slice().sort((a, b) => (span(a)!.from).localeCompare(span(b)!.from)),
    })).sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.name.localeCompare(b.name)));
  }, [dated, projectNameOf]);

  const gridW = totalDays * DAY_W;
  const todayOffset = daysBetween(minDate, today);
  const todayInRange = todayOffset >= 0 && todayOffset < totalDays;

  const stickyCell: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, width: LEFT_W, minWidth: LEFT_W,
    background: "#FFFFFF", borderRight: "1px solid rgba(26,23,20,0.08)",
  };

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, overflow: "hidden" }}>
      {/* 日付未設定（棒は描かない。先頭にまとめて出す） */}
      {undated.length > 0 && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FAFAF9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <CalendarDays style={{ width: 12, height: 12, color: "#A09790" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458" }}>日付未設定</span>
            <span style={{ fontSize: 10, color: "#A09790" }}>{undated.length}件</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {undated.map(t => (
              <button key={t.id} type="button" onClick={() => onSelect(t)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", fontSize: 11, borderRadius: 99, border: selectedId === t.id ? "1px solid #059669" : "1px solid rgba(26,23,20,0.1)", background: "#FFF", color: "#1A1714", cursor: "pointer", maxWidth: 260 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: getTaskStatusMeta(t.status).color, flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: LEFT_W + gridW, position: "relative" }}>

          {/* ── ヘッダー（月 / 日）── */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: 3, background: "#FFFFFF" }}>
            <div style={{ ...stickyCell, zIndex: 4, borderBottom: "1px solid rgba(26,23,20,0.08)" }}>
              <div style={{ padding: "6px 12px", fontSize: 10, fontWeight: 700, color: "#9E9690", letterSpacing: "0.06em" }}>タスク</div>
              <div style={{ padding: "0 12px 6px", fontSize: 9, color: "#C9C4BB" }}>{totalDays}日間</div>
            </div>
            <div style={{ width: gridW, borderBottom: "1px solid rgba(26,23,20,0.08)" }}>
              <div style={{ display: "flex" }}>
                {months.map((m, i) => (
                  <div key={i} style={{ width: m.days * DAY_W, fontSize: 10, fontWeight: 700, color: "#6B6458", padding: "6px 0 2px 6px", borderLeft: "1px solid rgba(26,23,20,0.06)", boxSizing: "border-box" as const, overflow: "hidden", whiteSpace: "nowrap" as const }}>
                    {m.label}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex" }}>
                {days.map(d => {
                  const dow = new Date(`${d}T00:00:00`).getDay();
                  const weekend = dow === 0 || dow === 6;
                  return (
                    <div key={d} style={{
                      width: DAY_W, fontSize: 8.5, textAlign: "center" as const, padding: "1px 0 4px",
                      color: d === today ? "#059669" : weekend ? "#C9C4BB" : "#9E9690",
                      fontWeight: d === today ? 800 : 500,
                      background: weekend ? "rgba(26,23,20,0.02)" : "transparent",
                      boxSizing: "border-box" as const,
                    }}>{Number(d.split("-")[2])}</div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 今日の縦線 */}
          {todayInRange && (
            <div style={{ position: "absolute", top: 0, bottom: 0, left: LEFT_W + todayOffset * DAY_W, width: 1, background: "rgba(5,150,105,0.35)", pointerEvents: "none", zIndex: 1 }} />
          )}

          {/* ── 行 ── */}
          {groups.map(g => (
            <div key={g.id || "none"}>
              <div style={{ display: "flex", background: "#FAFAF9", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                <div style={{ ...stickyCell, background: "#FAFAF9", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px" }}>
                  <FolderKanban style={{ width: 11, height: 11, color: "#A09790" }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{g.name}</span>
                  <span style={{ fontSize: 9.5, color: "#B0A9A4" }}>{g.tasks.length}</span>
                </div>
                <div style={{ width: gridW }} />
              </div>

              {g.tasks.map(t => {
                const s = span(t)!;
                const offset = daysBetween(minDate, s.from);
                const len = Math.max(1, daysBetween(s.from, s.to) + 1);
                const meta = getTaskStatusMeta(t.status);
                const pri = getTaskPriorityMeta(t.priority);
                const overdue = isOverdue(t);
                const selected = selectedId === t.id;
                return (
                  <div key={t.id} onClick={() => onSelect(t)}
                    style={{ display: "flex", borderBottom: "1px solid rgba(26,23,20,0.04)", cursor: "pointer", background: selected ? "#F0FDF4" : "transparent" }}>
                    <div style={{ ...stickyCell, background: selected ? "#F0FDF4" : "#FFFFFF", height: ROW_H, display: "flex", alignItems: "center", gap: 6, padding: "0 12px" }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: pri.color, flexShrink: 0 }} />
                      {t.parentId && <CornerDownRight style={{ width: 10, height: 10, color: "#C9C4BB", flexShrink: 0 }} />}
                      <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: t.status === "done" ? "#B0A9A4" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, textDecoration: t.status === "done" ? "line-through" : "none" }}>{t.title}</span>
                      {t.assignee && <Avatar name={t.assignee} size="xs" />}
                    </div>
                    <div style={{ width: gridW, height: ROW_H, position: "relative" }}>
                      <div title={`${s.from} 〜 ${s.to}`}
                        style={{
                          position: "absolute", left: offset * DAY_W + 2, top: 8, height: ROW_H - 16,
                          width: len * DAY_W - 4, borderRadius: 5,
                          background: overdue ? "#FEE2E2" : meta.bg,
                          border: `1px solid ${overdue ? "#FCA5A5" : meta.border}`,
                          display: "flex", alignItems: "center", padding: "0 6px", boxSizing: "border-box" as const,
                        }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: overdue ? "#DC2626" : meta.color, overflow: "hidden", whiteSpace: "nowrap" as const }}>
                          {meta.label}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {groups.length === 0 && (
            <div style={{ padding: "40px 0", textAlign: "center" as const, fontSize: 12, color: "#B0A9A4" }}>
              期間が設定されたタスクがありません
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
