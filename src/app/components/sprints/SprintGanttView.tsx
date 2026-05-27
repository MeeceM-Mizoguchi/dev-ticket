import { useState, useRef, useEffect } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { Sprint, SprintTicket } from "@/app/types";
import { daysBetween, formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES, computeSprintStatus } from "@/app/lib/helpers";

export function SprintGanttView({ sprints, onSelectSprint, onSelectTicket }: {
  sprints: Sprint[]; onSelectSprint: (s: Sprint) => void; onSelectTicket?: (t: SprintTicket) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(sprints.map(s => s.id)));
  const scrollRef = useRef<HTMLDivElement>(null);

  const DAY_W = 20;
  const thisYear = new Date().getFullYear();
  const minDate = `${thisYear}-01-01`;
  const maxDate = `${thisYear + 4}-12-31`;
  const totalDays = daysBetween(minDate, maxDate) + 1;

  const getLeft  = (d: string) => Math.max(0, daysBetween(minDate, d)) * DAY_W;
  const getWidth = (s: string, e: string) => Math.max((daysBetween(s, e) + 1) * DAY_W, 2);

  const todayStr  = new Date().toISOString().split("T")[0];
  const todayLeft = getLeft(todayStr);

  // Auto-scroll to today on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = todayLeft - scrollRef.current.offsetWidth / 3;
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Build calendar days
  const calDays: { date: string; day: number; month: number; year: number; isFirst: boolean }[] = [];
  const cur = new Date(minDate);
  for (let i = 0; i < totalDays; i++) {
    calDays.push({ date: cur.toISOString().split("T")[0], day: cur.getDate(), month: cur.getMonth(), year: cur.getFullYear(), isFirst: cur.getDate() === 1 });
    cur.setDate(cur.getDate() + 1);
  }

  // Month spans
  const months: { label: string; left: number; width: number }[] = [];
  let mStart = 0;
  calDays.forEach((d, i) => {
    if (d.isFirst || i === 0) mStart = i;
    const isLast = i === calDays.length - 1 || calDays[i + 1]?.isFirst;
    if (isLast) months.push({ label: `${d.month + 1}月`, left: mStart * DAY_W, width: (i - mStart + 1) * DAY_W });
  });

  // Year spans
  const years: { year: number; left: number; width: number }[] = [];
  months.forEach(m => {
    // extract year from position
  });
  calDays.forEach((d, i) => {
    if (i === 0 || calDays[i - 1].year !== d.year) {
      years.push({ year: d.year, left: i * DAY_W, width: 0 });
    }
    years[years.length - 1].width = (i - calDays.findIndex(c => c.year === years[years.length - 1].year) + 1) * DAY_W;
  });

  const LEFT_W = 240, ROW_H = 44, TICK_ROW_H = 30;
  const YEAR_H = 22, MON_H = 24, DAY_H = 20, HDR_H = YEAR_H + MON_H + DAY_H;

  const GridLines = () => (
    <>
      {calDays.map((d, i) => (
        <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: i * DAY_W, width: 1, pointerEvents: "none",
          background: d.isFirst ? "rgba(26,23,20,0.18)" : d.day % 7 === 1 ? "rgba(26,23,20,0.07)" : "rgba(26,23,20,0.03)" }} />
      ))}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: todayLeft, width: 2, background: "#059669", opacity: 0.6, pointerEvents: "none" }} />
    </>
  );

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.08)", overflow: "hidden" }}>
      <div style={{ display: "flex" }}>
        {/* Left pane */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: "1px solid rgba(26,23,20,0.07)" }}>
          <div style={{ height: HDR_H, background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", padding: "0 14px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>スプリント</span>
          </div>
          {sprints.map(sprint => {
            const isExp = expanded.has(sprint.id);
            const sm = getSprintStatusMeta(computeSprintStatus(sprint));
            return (
              <div key={sprint.id}>
                <div style={{ height: ROW_H, borderBottom: "1px solid rgba(26,23,20,0.05)", padding: "0 8px 0 10px", display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  onClick={() => { const n = new Set(expanded); n.has(sprint.id) ? n.delete(sprint.id) : n.add(sprint.id); setExpanded(n); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <ChevronDown style={{ width: 11, height: 11, color: "#B0A9A4", transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sprint.name}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: sm.bg, color: sm.color }}>{sm.label}</span>
                      <span style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{sprintProgress(sprint)}%</span>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                    style={{ padding: 4, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", flexShrink: 0, display: "flex", alignItems: "center" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <ExternalLink style={{ width: 11, height: 11 }} />
                  </button>
                </div>
                {isExp && sprint.tickets.map(t => {
                  const tsm = TICKET_STATUSES.find(s => s.value === t.status) ?? TICKET_STATUSES[0];
                  return (
                    <div key={t.id} onClick={() => onSelectTicket?.(t)}
                      style={{ height: TICK_ROW_H, borderBottom: "1px solid rgba(26,23,20,0.03)", padding: "0 8px 0 28px", display: "flex", alignItems: "center", gap: 5, background: "rgba(26,23,20,0.012)", cursor: "pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F0F9F5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(26,23,20,0.012)"; }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: tsm.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 10, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 }}>{t.title}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: tsm.bg, color: tsm.color, flexShrink: 0 }}>{tsm.label}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Calendar pane */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: "auto" }}>
          <div style={{ width: totalDays * DAY_W, position: "relative" }}>
            {/* Year row */}
            <div style={{ height: YEAR_H, background: "#EDEAE5", borderBottom: "1px solid rgba(26,23,20,0.08)", position: "relative" }}>
              {years.map((y, i) => (
                <div key={i} style={{ position: "absolute", left: y.left, width: y.width, height: "100%", display: "flex", alignItems: "center", padding: "0 8px", borderRight: "2px solid rgba(26,23,20,0.12)", boxSizing: "border-box" as const }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#6B6458", letterSpacing: "0.04em" }}>{y.year}</span>
                </div>
              ))}
            </div>
            {/* Month row */}
            <div style={{ height: MON_H, background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.07)", position: "relative" }}>
              {months.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: m.left, width: m.width, height: "100%", display: "flex", alignItems: "center", padding: "0 6px", borderRight: "1px solid rgba(26,23,20,0.12)", boxSizing: "border-box" as const }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#9E9690", whiteSpace: "nowrap" as const }}>{m.label}</span>
                </div>
              ))}
            </div>
            {/* Day row — every single day */}
            <div style={{ height: DAY_H, background: "#FAFAF8", borderBottom: "1px solid rgba(26,23,20,0.07)", position: "relative" }}>
              {calDays.map((d, i) => (
                <div key={i} style={{ position: "absolute", left: i * DAY_W, width: DAY_W, height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                  borderLeft: d.isFirst ? "1px solid rgba(26,23,20,0.15)" : "1px solid rgba(26,23,20,0.04)",
                  boxSizing: "border-box" as const,
                  background: d.date === todayStr ? "rgba(5,150,105,0.10)" : "transparent" }}>
                  <span style={{ fontSize: 8, color: d.date === todayStr ? "#059669" : "#B0A9A4", fontFamily: "var(--font-mono)", fontWeight: d.date === todayStr ? 700 : 400 }}>
                    {d.day}
                  </span>
                </div>
              ))}
            </div>

            {/* Sprint rows */}
            {sprints.map(sprint => {
              const isExp = expanded.has(sprint.id);
              const sm = getSprintStatusMeta(computeSprintStatus(sprint));
              const barL = sprint.startDate ? getLeft(sprint.startDate) : 0;
              const barW = sprint.startDate && sprint.endDate ? getWidth(sprint.startDate, sprint.endDate) : 0;
              const prog = sprintProgress(sprint);
              return (
                <div key={sprint.id}>
                  <div style={{ height: ROW_H, borderBottom: "1px solid rgba(26,23,20,0.05)", position: "relative" }}>
                    <GridLines />
                    {sprint.startDate && sprint.endDate && (
                      <div style={{ position: "absolute", left: barL, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 5, zIndex: 1 }}>
                        <div style={{ width: barW, height: 22, borderRadius: 5, background: sm.barColor + "22", border: `1.5px solid ${sm.barColor}55`, overflow: "hidden", display: "flex", alignItems: "center", position: "relative", flexShrink: 0 }}>
                          <div style={{ position: "absolute", height: "100%", width: `${prog}%`, background: sm.barColor + "55", borderRadius: 4 }} />
                          <span style={{ position: "relative", paddingLeft: 6, fontSize: 9, fontWeight: 700, color: sm.color, whiteSpace: "nowrap" as const }}>
                            {barW > 60 ? (sprint.name.length > 16 ? sprint.name.slice(0, 15) + "…" : sprint.name) : ""}
                          </span>
                        </div>
                        <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: sm.color, fontWeight: 600, whiteSpace: "nowrap" as const }}>{formatDate(sprint.endDate)}</span>
                      </div>
                    )}
                  </div>
                  {isExp && sprint.tickets.map(t => {
                    const tsm = TICKET_STATUSES.find(s => s.value === t.status) ?? TICKET_STATUSES[0];
                    const hasBar = !!(t.startDate && t.dueDate);
                    const tL = t.startDate ? getLeft(t.startDate) : 0;
                    const tW = hasBar ? getWidth(t.startDate, t.dueDate) : 0;
                    return (
                      <div key={t.id} style={{ height: TICK_ROW_H, borderBottom: "1px solid rgba(26,23,20,0.03)", position: "relative", background: "rgba(26,23,20,0.012)" }}>
                        <GridLines />
                        {hasBar && (
                          <div style={{ position: "absolute", left: tL, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4, zIndex: 1 }}>
                            <div style={{ width: tW, height: 12, borderRadius: 3, background: tsm.color + "25", border: `1px solid ${tsm.color}50`, overflow: "hidden", flexShrink: 0, position: "relative" }}>
                              <div style={{ height: "100%", width: `${t.progress}%`, background: tsm.color + "55", borderRadius: 2 }} />
                            </div>
                            <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "#9E9690", whiteSpace: "nowrap" as const }}>{formatDate(t.dueDate)}</span>
                            <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 4px", borderRadius: 8, background: tsm.bg, color: tsm.color, whiteSpace: "nowrap" as const }}>{tsm.label}</span>
                          </div>
                        )}
                        {!hasBar && (
                          <div style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", fontSize: 8, color: "#D5D0CB", fontStyle: "italic" }}>日程未設定</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
