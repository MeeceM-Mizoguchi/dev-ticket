import { useState, useRef, useEffect, useMemo } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Plus, GitBranch } from "lucide-react";
import type { Sprint, SprintTicket } from "@/app/types";
import { daysBetween, formatDate, getSprintStatusMeta, sprintProgress, getTicketStatusMeta, computeSprintStatus } from "@/app/lib/helpers";
import { usePlan } from "@/app/contexts/PlanContext";
import { PlanTooltip } from "@/app/components/shared/PlanTooltip";

export function SprintGanttView({ sprints, onSelectSprint, onSelectTicket, onCreateTicket, onBulkCreate }: {
  sprints: Sprint[]; onSelectSprint: (s: Sprint) => void; onSelectTicket?: (t: SprintTicket) => void; onCreateTicket?: (sprintId: string) => void; onBulkCreate?: (sprintId: string) => void;
}) {
  const { plan } = usePlan();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(sprints.map(s => s.id)));
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerScrollRef = useRef<HTMLDivElement>(null);

  const DAY_W = 20;
  const thisYear = new Date().getFullYear();
  const minDate = `${thisYear}-01-01`;
  const maxDate = `${thisYear + 4}-12-31`;
  const totalDays = daysBetween(minDate, maxDate) + 1;

  const getLeft  = (d: string) => Math.max(0, daysBetween(minDate, d)) * DAY_W;
  const getWidth = (s: string, e: string) => Math.max((daysBetween(s, e) + 1) * DAY_W, 2);

  // ② useMemo: 毎レンダーで new Date() を呼ばない
  const todayStr  = useMemo(() => new Date().toISOString().split("T")[0], []);
  const todayLeft = getLeft(todayStr);

  useEffect(() => {
    if (scrollRef.current) {
      const targetLeft = todayLeft - scrollRef.current.offsetWidth / 3;
      scrollRef.current.scrollLeft = targetLeft;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = targetLeft;
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // ヘッダーとボディの横スクロールを同期
  const handleBodyScroll = () => {
    if (scrollRef.current && headerScrollRef.current) {
      headerScrollRef.current.scrollLeft = scrollRef.current.scrollLeft;
    }
  };

  // ② useMemo: 1825日分のループを初回のみ実行
  const calDays = useMemo(() => {
    const days: { date: string; day: number; month: number; year: number; isFirst: boolean }[] = [];
    const cur = new Date(minDate);
    for (let i = 0; i < totalDays; i++) {
      days.push({ date: cur.toISOString().split("T")[0], day: cur.getDate(), month: cur.getMonth(), year: cur.getFullYear(), isFirst: cur.getDate() === 1 });
      cur.setDate(cur.getDate() + 1);
    }
    return days;
  }, [minDate, totalDays]);

  // ② useMemo: 月スパンも初回のみ
  const months = useMemo(() => {
    const ms: { label: string; left: number; width: number }[] = [];
    let mStart = 0;
    calDays.forEach((d, i) => {
      if (d.isFirst || i === 0) mStart = i;
      const isLast = i === calDays.length - 1 || calDays[i + 1]?.isFirst;
      if (isLast) ms.push({ label: `${d.month + 1}月`, left: mStart * DAY_W, width: (i - mStart + 1) * DAY_W });
    });
    return ms;
  }, [calDays]);

  // ② useMemo: 年スパンも初回のみ
  const years = useMemo(() => {
    const ys: { year: number; left: number; width: number }[] = [];
    calDays.forEach((d, i) => {
      if (i === 0 || calDays[i - 1].year !== d.year) {
        ys.push({ year: d.year, left: i * DAY_W, width: 0 });
      }
      ys[ys.length - 1].width = (i - calDays.findIndex(c => c.year === ys[ys.length - 1].year) + 1) * DAY_W;
    });
    return ys;
  }, [calDays]);

  const LEFT_W = 240, ROW_H = 44, TICK_ROW_H = 30;
  const YEAR_H = 22, MON_H = 24, DAY_H = 20;

  return (
    // overflow: clip は borderRadius を維持しつつ position:sticky をブロックしない
    <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.08)", overflow: "clip" as React.CSSProperties["overflow"] }}>

      {/* ヘッダー（sticky固定） — 縦スクロールでここまで来たら固定、上に戻ったら解除 */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, display: "flex", boxShadow: "0 1px 0 rgba(26,23,20,0.07)" }}>
        {/* 左パネルヘッダー */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: "1px solid rgba(26,23,20,0.07)", height: YEAR_H + MON_H + DAY_H, background: "#F4F5F6", display: "flex", alignItems: "center", padding: "0 14px" }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>スプリント</span>
        </div>
        {/* カレンダーヘッダー（横スクロールをボディと同期） */}
        <div ref={headerScrollRef} style={{ flex: 1, overflowX: "hidden" }}>
          <div style={{ width: totalDays * DAY_W }}>
            {/* 年行 */}
            <div style={{ height: YEAR_H, background: "#EDEAE5", borderBottom: "1px solid rgba(26,23,20,0.08)", position: "relative" }}>
              {years.map((y, i) => (
                <div key={i} style={{ position: "absolute", left: y.left, width: y.width, height: "100%", display: "flex", alignItems: "center", padding: "0 8px", borderRight: "2px solid rgba(26,23,20,0.12)", boxSizing: "border-box" as const }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#6B6458", letterSpacing: "0.04em" }}>{y.year}</span>
                </div>
              ))}
            </div>
            {/* 月行 */}
            <div style={{ height: MON_H, background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.07)", position: "relative" }}>
              {months.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: m.left, width: m.width, height: "100%", display: "flex", alignItems: "center", padding: "0 6px", borderRight: "1px solid rgba(26,23,20,0.12)", boxSizing: "border-box" as const }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#9E9690", whiteSpace: "nowrap" as const }}>{m.label}</span>
                </div>
              ))}
            </div>
            {/* 日行 */}
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
          </div>
        </div>
      </div>

      {/* ボディ */}
      <div style={{ display: "flex" }}>
        {/* 左パネル */}
        <div style={{ width: LEFT_W, flexShrink: 0, borderRight: "1px solid rgba(26,23,20,0.07)" }}>
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
                  {onCreateTicket && (
                    <button onClick={e => { e.stopPropagation(); onCreateTicket(sprint.id); }}
                      style={{ padding: 4, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", flexShrink: 0, display: "flex", alignItems: "center" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F5F3FF"; (e.currentTarget as HTMLElement).style.color = "#7C3AED"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                      <Plus style={{ width: 11, height: 11 }} />
                    </button>
                  )}
                  {onBulkCreate && (
                    <PlanTooltip text="現在のプランではご利用できません" active={!plan.featureBulkCreate} placement="bottom-left">
                      <button onClick={e => { e.stopPropagation(); if (plan.featureBulkCreate) onBulkCreate(sprint.id); }}
                        title={plan.featureBulkCreate ? "一括作成" : undefined}
                        style={{ padding: 4, borderRadius: 5, border: "none", background: "transparent", cursor: plan.featureBulkCreate ? "pointer" : "not-allowed", color: plan.featureBulkCreate ? "#C9C4BB" : "#9CA3AF", flexShrink: 0, display: "flex", alignItems: "center", opacity: plan.featureBulkCreate ? 1 : 0.5 }}
                        onMouseEnter={e => { if (plan.featureBulkCreate) { (e.currentTarget as HTMLElement).style.background = "#F0F9FF"; (e.currentTarget as HTMLElement).style.color = "#0284C7"; } }}
                        onMouseLeave={e => { if (plan.featureBulkCreate) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; } }}>
                        <Plus style={{ width: 11, height: 11 }} />
                      </button>
                    </PlanTooltip>
                  )}
                </div>
                {isExp && sprint.tickets.filter(t => !t.parentId).map(t => {
                  const tsm = getTicketStatusMeta(t.status, t.progress);
                  const children = sprint.tickets.filter(c => c.parentId === t.id);
                  const hasChildren = children.length > 0;
                  const isTicketExpanded = expandedTickets.has(t.id);
                  const needsHours = t.status === "waiting-release" && (t.actualWorkHours == null);
                  return (
                    <div key={t.id}>
                      <div onClick={() => onSelectTicket?.(t)}
                        style={{ height: TICK_ROW_H, borderBottom: "1px solid rgba(26,23,20,0.03)", padding: "0 8px 0 14px", display: "flex", alignItems: "center", gap: 5, background: needsHours ? "rgba(239,68,68,0.06)" : "rgba(26,23,20,0.012)", cursor: "pointer", outline: needsHours ? "1px solid rgba(239,68,68,0.25)" : "none", outlineOffset: "-1px" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = needsHours ? "rgba(239,68,68,0.10)" : "#F0F9F5"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = needsHours ? "rgba(239,68,68,0.06)" : "rgba(26,23,20,0.012)"; }}>
                        {hasChildren ? (
                          <button onClick={e => { e.stopPropagation(); setExpandedTickets(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); }}
                            style={{ padding: 1, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", alignItems: "center", flexShrink: 0 }}>
                            {isTicketExpanded ? <ChevronDown style={{ width: 9, height: 9 }} /> : <ChevronRight style={{ width: 9, height: 9 }} />}
                          </button>
                        ) : <span style={{ width: 11 }} />}
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: tsm.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 }}>{t.title}</span>
                        {hasChildren && <GitBranch style={{ width: 8, height: 8, color: "#B0A9A4", flexShrink: 0 }} />}
                        <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: tsm.bg, color: tsm.color, flexShrink: 0 }}>{tsm.label}</span>
                      </div>
                      {hasChildren && isTicketExpanded && children.map(child => {
                        const ctsm = getTicketStatusMeta(child.status, child.progress);
                        return (
                          <div key={child.id} onClick={() => onSelectTicket?.(child)}
                            style={{ height: TICK_ROW_H, borderBottom: "1px solid rgba(26,23,20,0.03)", padding: "0 8px 0 30px", display: "flex", alignItems: "center", gap: 5, background: "rgba(5,150,105,0.02)", cursor: "pointer" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EEF7F3"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(5,150,105,0.02)"; }}>
                            <div style={{ width: 1, height: 10, background: "rgba(26,23,20,0.15)", flexShrink: 0 }} />
                            <div style={{ width: 4, height: 4, borderRadius: "50%", background: ctsm.color, flexShrink: 0 }} />
                            <span style={{ fontSize: 9, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1 }}>{child.title}</span>
                            <span style={{ fontSize: 7, fontWeight: 700, padding: "1px 4px", borderRadius: 8, background: ctsm.bg, color: ctsm.color, flexShrink: 0 }}>{ctsm.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* カレンダーボディ */}
        <div ref={scrollRef} style={{ flex: 1, overflowX: "auto" }} onScroll={handleBodyScroll}>
          <div style={{ width: totalDays * DAY_W, position: "relative" }}>
            {/* ① 共有グリッド線 */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
              {calDays.map((d, i) => (
                <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: i * DAY_W, width: 1,
                  background: d.isFirst ? "rgba(26,23,20,0.18)" : d.day % 7 === 1 ? "rgba(26,23,20,0.07)" : "rgba(26,23,20,0.03)" }} />
              ))}
              <div style={{ position: "absolute", top: 0, bottom: 0, left: todayLeft, width: 2, background: "#059669", opacity: 0.6 }} />
            </div>

            {/* スプリント行 */}
            {sprints.map(sprint => {
              const isExp = expanded.has(sprint.id);
              const sm = getSprintStatusMeta(computeSprintStatus(sprint));
              const barL = sprint.startDate ? getLeft(sprint.startDate) : 0;
              const barW = sprint.startDate && sprint.endDate ? getWidth(sprint.startDate, sprint.endDate) : 0;
              const prog = sprintProgress(sprint);
              return (
                <div key={sprint.id}>
                  <div style={{ height: ROW_H, borderBottom: "1px solid rgba(26,23,20,0.05)", position: "relative" }}>
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
                  {isExp && sprint.tickets.filter(t => !t.parentId).map(t => {
                    const tsm = getTicketStatusMeta(t.status, t.progress);
                    const hasBar = !!(t.startDate && t.dueDate);
                    const tL = t.startDate ? getLeft(t.startDate) : 0;
                    const tW = hasBar ? getWidth(t.startDate, t.dueDate) : 0;
                    const children = sprint.tickets.filter(c => c.parentId === t.id);
                    const isTicketExpanded = expandedTickets.has(t.id);
                    return (
                      <div key={t.id}>
                        <div style={{ height: TICK_ROW_H, borderBottom: "1px solid rgba(26,23,20,0.03)", position: "relative", background: "rgba(26,23,20,0.012)" }}>
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
                        {children.length > 0 && isTicketExpanded && children.map(child => {
                          const ctsm = getTicketStatusMeta(child.status, child.progress);
                          const cHasBar = !!(child.startDate && child.dueDate);
                          const cL = child.startDate ? getLeft(child.startDate) : 0;
                          const cW = cHasBar ? getWidth(child.startDate, child.dueDate) : 0;
                          return (
                            <div key={child.id} style={{ height: TICK_ROW_H, borderBottom: "1px solid rgba(26,23,20,0.03)", position: "relative", background: "rgba(5,150,105,0.02)" }}>
                              {cHasBar && (
                                <div style={{ position: "absolute", left: cL, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", gap: 4, zIndex: 1 }}>
                                  <div style={{ width: cW, height: 9, borderRadius: 3, background: ctsm.color + "20", border: `1px solid ${ctsm.color}40`, overflow: "hidden", flexShrink: 0, position: "relative" }}>
                                    <div style={{ height: "100%", width: `${child.progress}%`, background: ctsm.color + "50", borderRadius: 2 }} />
                                  </div>
                                  <span style={{ fontSize: 7, fontFamily: "var(--font-mono)", color: "#B0A9A4", whiteSpace: "nowrap" as const }}>{formatDate(child.dueDate)}</span>
                                </div>
                              )}
                              {!cHasBar && (
                                <div style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 7, color: "#D5D0CB", fontStyle: "italic" }}>日程未設定</div>
                              )}
                            </div>
                          );
                        })}
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
