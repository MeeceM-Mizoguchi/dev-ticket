import { Fragment, useMemo } from "react";
import type { CSSProperties } from "react";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import type { SprintTicket } from "@/app/types";

/**
 * リリースノートのガントチャート（KAIZEN2611-014）。
 *
 * 表示している月にリリース日があるチケットを1行ずつ並べ、
 * 「進行中になった日（startedAt）→ リリース日」をバーで描く。
 *   ・startedAt が無ければ開始日（startDate）から描く。どちらも無ければバーは描かず ◆ だけ。
 *   ・始まりが月より前なら月の左端から描く。
 *   ・見るだけ。ドラッグでリリース日を変える操作は付けない（カレンダーか詳細パネルで変える）。
 */
export interface ReleaseGanttItem {
  ticket: SprintTicket;
  projectId: string;
  projectName: string;
}

const LEFT_W = 300;
const DAY_MIN_W = 26;
const HEAD_H = 34;
const ROW_H = 34;
const GROUP_H = 28;
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function pad(n: number) { return String(n).padStart(2, "0"); }

/** 日時（ISO）を日本時間の日付（YYYY-MM-DD）に直す */
function toJstDate(iso: string): string | null {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" の形だけを日付として扱う（日時が入っていても日付の部分だけ使う） */
function normDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

function compareWbs(a: string, b: string) {
  return a.localeCompare(b, "ja", { numeric: true });
}

export function ReleaseGanttView<T extends ReleaseGanttItem>({ year, month, items, todayStr, groupByProject, onSelect }: {
  /** 表示している年と月（month は 0 始まり） */
  year: number;
  month: number;
  /** 絞り込み済みのチケット（リリース日が表示している月に無いものは、ここで外す） */
  items: T[];
  todayStr: string;
  /** 全体のリリースノートでは、行をプロジェクトごとにまとめる */
  groupByProject: boolean;
  onSelect: (item: T) => void;
}) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthFirst = `${year}-${pad(month + 1)}-01`;
  const monthLast = `${year}-${pad(month + 1)}-${pad(daysInMonth)}`;
  const monthPrefix = `${year}-${pad(month + 1)}-`;

  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    return { d, dow: new Date(year, month, d).getDay(), date: `${monthPrefix}${pad(d)}` };
  }), [year, month, daysInMonth, monthPrefix]);

  // 行の組み立て。リリース日の早い順、同じ日は WBS の順
  const rows = useMemo(() => {
    const list = items
      .filter(it => !!it.ticket.releaseDate && it.ticket.releaseDate.startsWith(monthPrefix))
      .slice()
      .sort((a, b) => (a.ticket.releaseDate! < b.ticket.releaseDate! ? -1 : a.ticket.releaseDate! > b.ticket.releaseDate! ? 1 : compareWbs(a.ticket.wbs, b.ticket.wbs)));
    return list.map(item => {
      const release = normDate(item.ticket.releaseDate)!;
      const started = item.ticket.startedAt ? toJstDate(item.ticket.startedAt) : null;
      const start = started ?? normDate(item.ticket.startDate);
      // 始まりがリリース日より後のデータは、バーを描かず ◆ だけにする
      const barStart = start && start <= release ? (start < monthFirst ? monthFirst : start) : null;
      return { item, release, start, barStart, clipped: !!start && start < monthFirst && start <= release };
    });
  }, [items, monthPrefix, monthFirst]);

  const groups = useMemo(() => {
    if (!groupByProject) return [{ key: "", name: "", rows }];
    const map = new Map<string, { key: string; name: string; rows: typeof rows }>();
    for (const r of rows) {
      const k = r.item.projectId;
      if (!map.has(k)) map.set(k, { key: k, name: r.item.projectName, rows: [] });
      map.get(k)!.rows.push(r);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [rows, groupByProject]);

  const dayIndex = (date: string) => Number(date.slice(8, 10)) - 1;
  const pct = (n: number) => `${(n / daysInMonth) * 100}%`;
  const todayInMonth = todayStr >= monthFirst && todayStr <= monthLast;
  const todayIdx = todayInMonth ? dayIndex(todayStr) : -1;

  // 日ごとの縦の罫線（行の背景で描く）
  const gridLines: CSSProperties = {
    backgroundImage: "linear-gradient(to right, rgba(26,23,20,0.05) 1px, transparent 1px)",
    backgroundSize: `calc(100% / ${daysInMonth}) 100%`,
  };

  if (rows.length === 0) {
    return (
      <div style={{ flex: 1, minHeight: 120, display: "flex", alignItems: "center", justifyContent: "center", background: "#FFF", borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)" }}>
        <p style={{ fontSize: 13, color: "#A09790" }}>この月にリリースされたチケットはありません</p>
      </div>
    );
  }

  const gridTemplateColumns = `${LEFT_W}px minmax(${daysInMonth * DAY_MIN_W}px, 1fr)`;
  const stickyLeft: CSSProperties = { position: "sticky", left: 0, zIndex: 2 };

  return (
    // ページ全体は横にはみ出させず、この中だけを横・縦にスクロールする
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "auto", background: "#FFF", borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)" }}>
      <div style={{ display: "grid", gridTemplateColumns, minWidth: LEFT_W + daysInMonth * DAY_MIN_W }}>
        {/* 見出し（縦にスクロールしても固定） */}
        <div style={{ ...stickyLeft, top: 0, zIndex: 4, height: HEAD_H, background: "#F4F5F6", borderRight: "1px solid rgba(26,23,20,0.08)", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 11, fontWeight: 700, color: "#6B6458" }}>
          チケット（{rows.length}件）
        </div>
        <div style={{ position: "sticky", top: 0, zIndex: 3, height: HEAD_H, background: "#FAFAF8", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "grid", gridTemplateColumns: `repeat(${daysInMonth}, 1fr)` }}>
          {days.map(day => {
            const isToday = day.date === todayStr;
            return (
              <div key={day.d} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderLeft: "1px solid rgba(26,23,20,0.05)", background: isToday ? "rgba(5,150,105,0.10)" : "transparent", lineHeight: 1.1 }}>
                <span style={{ fontSize: 10, fontWeight: isToday ? 800 : 600, color: isToday ? "#059669" : day.dow === 0 ? "#EF4444" : day.dow === 6 ? "#3B82F6" : "#6B6458" }}>{day.d}</span>
                <span style={{ fontSize: 8, color: day.dow === 0 ? "#EF4444" : day.dow === 6 ? "#3B82F6" : "#B0A9A4" }}>{DOW[day.dow]}</span>
              </div>
            );
          })}
        </div>

        {groups.map(g => (
          <Fragment key={g.key || "all"}>
            {groupByProject && (
              <>
                <div style={{ ...stickyLeft, height: GROUP_H, background: "#F0F0EE", borderRight: "1px solid rgba(26,23,20,0.08)", borderBottom: "1px solid rgba(26,23,20,0.06)", display: "flex", alignItems: "center", gap: 6, padding: "0 12px", minWidth: 0 }}>
                  <TruncatedText text={g.name} style={{ fontSize: 12, fontWeight: 700, color: "#3D3732", flex: 1, minWidth: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: "#FFF", color: "#6B6458", flexShrink: 0 }}>{g.rows.length}件</span>
                </div>
                <div style={{ height: GROUP_H, background: "#F0F0EE", borderBottom: "1px solid rgba(26,23,20,0.06)" }} />
              </>
            )}
            {g.rows.map(r => {
              const t = r.item.ticket;
              const isReleased = t.status === "released";
              const color = isReleased ? "#16A34A" : "#4F46E5";
              const relIdx = dayIndex(r.release);
              const startIdx = r.barStart ? dayIndex(r.barStart) : -1;
              const titleTip = `${t.wbs} ${t.title}`;
              const periodTip = r.start && r.barStart
                ? `${r.start.replace(/-/g, "/")} → ${r.release.replace(/-/g, "/")}（${isReleased ? "リリース済み" : "リリース待ち"}）`
                : `リリース日 ${r.release.replace(/-/g, "/")}（${isReleased ? "リリース済み" : "リリース待ち"}）`;
              return (
                <Fragment key={t.id}>
                  <div onClick={() => onSelect(r.item)}
                    style={{ ...stickyLeft, height: ROW_H, background: "#FFF", borderRight: "1px solid rgba(26,23,20,0.08)", borderBottom: "1px solid rgba(26,23,20,0.05)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px", cursor: "pointer", minWidth: 0 }}>
                    <span style={{ fontSize: 10, color: "#8A847C", fontFamily: "var(--font-mono)", background: "#F4F5F6", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>{t.wbs}</span>
                    <TruncatedText text={t.title} style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", flex: 1, minWidth: 0 }} />
                  </div>
                  <div onClick={() => onSelect(r.item)}
                    style={{ height: ROW_H, position: "relative", borderBottom: "1px solid rgba(26,23,20,0.05)", cursor: "pointer", ...gridLines }}>
                    {todayIdx >= 0 && (
                      <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(${pct(todayIdx)} + (100% / ${daysInMonth}) / 2)`, width: 2, marginLeft: -1, background: "#059669", opacity: 0.55, pointerEvents: "none" }} />
                    )}
                    {r.barStart && (
                      <div title={periodTip}
                        style={{
                          position: "absolute", top: "50%", height: 14, marginTop: -7,
                          left: `calc(${pct(startIdx)} + 2px)`,
                          width: `calc(${pct(relIdx - startIdx + 1)} - 4px)`,
                          background: `${color}26`, border: `1px solid ${color}66`,
                          borderRadius: r.clipped ? "0 4px 4px 0" : 4,
                          borderLeftStyle: r.clipped ? "dashed" : "solid",
                        }} />
                    )}
                    <div title={periodTip}
                      style={{
                        position: "absolute", top: "50%", left: `calc(${pct(relIdx)} + (100% / ${daysInMonth}) / 2)`,
                        width: 12, height: 12, marginLeft: -6, marginTop: -6,
                        background: color, transform: "rotate(45deg)", borderRadius: 2,
                        boxShadow: "0 0 0 2px #FFF",
                      }} />
                  </div>
                </Fragment>
              );
            })}
          </Fragment>
        ))}
      </div>
      {/* 足元に凡例を置く。色だけでは「済」と「待ち」が分かりにくいため */}
      <div style={{ position: "sticky", left: 0, display: "flex", alignItems: "center", gap: 14, padding: "8px 12px", fontSize: 11, color: "#6B6458" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, background: "#16A34A", transform: "rotate(45deg)", borderRadius: 1.5 }} />リリース済み</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 9, height: 9, background: "#4F46E5", transform: "rotate(45deg)", borderRadius: 1.5 }} />リリース待ち</span>
        <span style={{ color: "#A09790" }}>バーは「進行中になった日（無ければ開始日）→ リリース日」</span>
      </div>
    </div>
  );
}
