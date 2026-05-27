import { useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import type { Sprint, SprintTicket } from "@/app/types";
import { daysBetween, formatDate, getSprintStatusMeta, sprintProgress } from "@/app/lib/helpers";

export function SprintGanttView({ sprints, onSelectSprint, onSelectTicket }: {
  sprints: Sprint[]; onSelectSprint: (s: Sprint) => void; onSelectTicket?: (t: SprintTicket) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const DAY_W = 8;
  if (!sprints.length) return null;

  const minDate = sprints.reduce((m, s) => s.startDate < m ? s.startDate : m, sprints[0].startDate);
  const maxDate = sprints.reduce((m, s) => s.endDate > m ? s.endDate : m, sprints[0].endDate);
  const totalDays = daysBetween(minDate, maxDate) + 1;
  const getLeft = (d: string) => daysBetween(minDate, d) * DAY_W;
  const getWidth = (s: string, e: string) => (daysBetween(s, e) + 1) * DAY_W;
  const todayStr = new Date().toISOString().split("T")[0];
  const todayLeft = todayStr >= minDate && todayStr <= maxDate ? getLeft(todayStr) : -1;

  const months: { year: number; month: number; label: string; left: number; width: number }[] = [];
  const startD = new Date(minDate);
  const endD = new Date(maxDate);
  let cur = new Date(startD.getFullYear(), startD.getMonth(), 1);
  while (cur <= endD) {
    const mStart = new Date(cur);
    const mEnd = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const effStart = mStart < startD ? startD : mStart;
    const effEnd = mEnd > endD ? endD : mEnd;
    const days = daysBetween(effStart.toISOString().split("T")[0], effEnd.toISOString().split("T")[0]) + 1;
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1, label: `${cur.getMonth() + 1}月`, left: getLeft(effStart.toISOString().split("T")[0]), width: days * DAY_W });
    cur.setMonth(cur.getMonth() + 1);
  }

  const yearSpans: { year: number; left: number; width: number }[] = [];
  months.forEach(m => {
    const last = yearSpans[yearSpans.length - 1];
    if (last && last.year === m.year) { last.width += m.width; }
    else { yearSpans.push({ year: m.year, left: m.left, width: m.width }); }
  });

  const weekLines: number[] = [];
  for (let d = 7; d < totalDays; d += 7) weekLines.push(d * DAY_W);

  const LEFT_W = 230, ROW_H = 44, TICK_ROW_H = 30, YEAR_H = 22, MON_H = 28, HDR_H = YEAR_H + MON_H;

  const GridLines = () => (
    <>
      {weekLines.map(x => <div key={x} style={{ position:"absolute", top:0, bottom:0, left:x, width:1, background:"rgba(26,23,20,0.04)", pointerEvents:"none" }} />)}
      {months.map((m, i) => <div key={i} style={{ position:"absolute", top:0, bottom:0, left:m.left + m.width - 1, width:1, background:"rgba(26,23,20,0.10)", pointerEvents:"none" }} />)}
      {todayLeft >= 0 && <div style={{ position:"absolute", top:0, bottom:0, left:todayLeft, width:2, background:"#059669", opacity:0.5, pointerEvents:"none" }} />}
    </>
  );

  return (
    <div style={{ background:"#FFFFFF", borderRadius:14, border:"1px solid rgba(26,23,20,0.08)", overflow:"hidden" }}>
      <div style={{ display:"flex" }}>
        <div style={{ width:LEFT_W, flexShrink:0, borderRight:"1px solid rgba(26,23,20,0.07)" }}>
          <div style={{ height:HDR_H, borderBottom:"1px solid rgba(26,23,20,0.07)", background:"#F4F5F6", display:"flex", alignItems:"center", padding:"0 14px" }}>
            <span style={{ fontSize:10, fontWeight:700, color:"#B0A9A4", textTransform:"uppercase" as const, letterSpacing:"0.06em" }}>スプリント</span>
          </div>
          {sprints.map(sprint => {
            const isExp = expanded.has(sprint.id);
            const sm = getSprintStatusMeta(sprint.status);
            return (
              <div key={sprint.id}>
                <div style={{ height:ROW_H, borderBottom:"1px solid rgba(26,23,20,0.05)", padding:"0 8px 0 10px", display:"flex", alignItems:"center", gap:6, cursor:"pointer" }}
                  onClick={() => { const n = new Set(expanded); n.has(sprint.id) ? n.delete(sprint.id) : n.add(sprint.id); setExpanded(n); }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  <ChevronDown style={{ width:11, height:11, color:"#B0A9A4", transform:isExp ? "rotate(0deg)" : "rotate(-90deg)", transition:"transform 0.2s", flexShrink:0 }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:11, fontWeight:700, color:"#1A1714", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const }}>{sprint.name}</p>
                    <div style={{ display:"flex", alignItems:"center", gap:5, marginTop:2 }}>
                      <span style={{ fontSize:9, fontWeight:600, color:sm.color }}>{sm.label}</span>
                      <span style={{ fontSize:9, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{sprintProgress(sprint)}%</span>
                    </div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                    style={{ padding:4, borderRadius:5, border:"none", background:"transparent", cursor:"pointer", color:"#C9C4BB", flexShrink:0, display:"flex", alignItems:"center" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <ExternalLink style={{ width:11, height:11 }} />
                  </button>
                </div>
                {isExp && sprint.tickets.map(t => {
                  const isTodo = t.status === "todo";
                  const dotColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#C9C4BB";
                  const sBg = t.status === "done" ? "#ECFDF5" : t.status === "in-progress" ? "#FFF7ED" : "#FEF2F2";
                  const sColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#DC2626";
                  const sLabel = t.status === "done" ? "完了" : t.status === "in-progress" ? "進行中" : "未着手";
                  return (
                    <div key={t.id} onClick={() => onSelectTicket?.(t)}
                      style={{ height:TICK_ROW_H, borderBottom:"1px solid rgba(26,23,20,0.03)", padding:"0 8px 0 28px", display:"flex", alignItems:"center", gap:5, background:isTodo ? "rgba(220,38,38,0.03)" : "rgba(26,23,20,0.012)", cursor:"pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isTodo ? "rgba(220,38,38,0.07)" : "#F0F9F5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isTodo ? "rgba(220,38,38,0.03)" : "rgba(26,23,20,0.012)"; }}>
                      <div style={{ width:5, height:5, borderRadius:"50%", background:dotColor, flexShrink:0 }} />
                      <span style={{ fontSize:10, color:"#6B6458", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" as const, flex:1 }}>{t.title}</span>
                      <span style={{ fontSize:8, fontWeight:700, padding:"1px 5px", borderRadius:10, background:sBg, color:sColor, flexShrink:0, border:isTodo ? "1px solid rgba(220,38,38,0.25)" : "none" }}>{sLabel}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div style={{ flex:1, overflowX:"auto" }}>
          <div style={{ width: Math.max(totalDays * DAY_W, 600), position:"relative" }}>
            <div style={{ height:YEAR_H, background:"#EDEAE5", borderBottom:"1px solid rgba(26,23,20,0.08)", position:"relative" }}>
              {yearSpans.map((y, i) => (
                <div key={i} style={{ position:"absolute", left:y.left, width:y.width, height:"100%", display:"flex", alignItems:"center", padding:"0 8px", borderRight:"2px solid rgba(26,23,20,0.12)", boxSizing:"border-box" }}>
                  <span style={{ fontSize:10, fontWeight:800, color:"#6B6458", letterSpacing:"0.04em" }}>{y.year}</span>
                </div>
              ))}
            </div>
            <div style={{ height:MON_H, background:"#F4F5F6", borderBottom:"1px solid rgba(26,23,20,0.07)", position:"relative" }}>
              {months.map((m, i) => (
                <div key={i} style={{ position:"absolute", left:m.left, width:m.width, height:"100%", display:"flex", alignItems:"center", padding:"0 6px", borderRight:"1px solid rgba(26,23,20,0.08)", boxSizing:"border-box" }}>
                  <span style={{ fontSize:10, fontWeight:600, color:"#9E9690", whiteSpace:"nowrap" as const }}>{m.label}</span>
                </div>
              ))}
            </div>
            {sprints.map(sprint => {
              const isExp = expanded.has(sprint.id);
              const sm = getSprintStatusMeta(sprint.status);
              const barL = getLeft(sprint.startDate);
              const barW = getWidth(sprint.startDate, sprint.endDate);
              const prog = sprintProgress(sprint);
              return (
                <div key={sprint.id}>
                  <div style={{ height:ROW_H, borderBottom:"1px solid rgba(26,23,20,0.05)", position:"relative" }}>
                    <GridLines />
                    <div style={{ position:"absolute", left:barL, top:"50%", transform:"translateY(-50%)", display:"flex", alignItems:"center", gap:5, zIndex:1 }}>
                      <div style={{ width:Math.max(barW, 2), height:22, borderRadius:5, background:sm.barColor + "22", border:`1.5px solid ${sm.barColor}55`, overflow:"hidden", display:"flex", alignItems:"center", position:"relative", flexShrink:0 }}>
                        <div style={{ position:"absolute", height:"100%", width:`${prog}%`, background:sm.barColor + "55", borderRadius:4 }} />
                        <span style={{ position:"relative", paddingLeft:6, fontSize:9, fontWeight:700, color:sm.color, whiteSpace:"nowrap" as const }}>
                          {barW > 60 ? (sprint.name.length > 16 ? sprint.name.slice(0, 15) + "…" : sprint.name) : ""}
                        </span>
                      </div>
                      <span style={{ fontSize:9, fontFamily:"var(--font-mono)", color:sm.color, fontWeight:600, whiteSpace:"nowrap" as const }}>{formatDate(sprint.endDate)}</span>
                    </div>
                  </div>
                  {isExp && sprint.tickets.map(t => {
                    const tL = getLeft(t.startDate);
                    const tW = getWidth(t.startDate, t.dueDate);
                    const tColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#B0A9A4";
                    const isTodo = t.status === "todo";
                    const sBg = t.status === "done" ? "#ECFDF5" : t.status === "in-progress" ? "#FFF7ED" : "#FEF2F2";
                    const sColor = t.status === "done" ? "#059669" : t.status === "in-progress" ? "#D97706" : "#DC2626";
                    const sLabel = t.status === "done" ? "完了" : t.status === "in-progress" ? "進行中" : "未着手";
                    return (
                      <div key={t.id} style={{ height:TICK_ROW_H, borderBottom:"1px solid rgba(26,23,20,0.03)", position:"relative", background:isTodo ? "rgba(220,38,38,0.02)" : "rgba(26,23,20,0.012)" }}>
                        <GridLines />
                        <div style={{ position:"absolute", left:tL, top:"50%", transform:"translateY(-50%)", display:"flex", alignItems:"center", gap:4, zIndex:1 }}>
                          <div style={{ width:Math.max(tW, 2), height:12, borderRadius:3, background:tColor + "25", border:isTodo ? `1px dashed ${tColor}70` : `1px solid ${tColor}50`, overflow:"hidden", flexShrink:0, position:"relative" }}>
                            <div style={{ height:"100%", width:`${t.progress}%`, background:tColor + "55", borderRadius:2 }} />
                          </div>
                          <span style={{ fontSize:8, fontFamily:"var(--font-mono)", color:"#9E9690", whiteSpace:"nowrap" as const }}>{formatDate(t.dueDate)}</span>
                          <span style={{ fontSize:8, fontWeight:700, padding:"1px 4px", borderRadius:8, background:sBg, color:sColor, whiteSpace:"nowrap" as const, border:isTodo ? "1px solid rgba(220,38,38,0.25)" : "none" }}>{sLabel}</span>
                        </div>
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
