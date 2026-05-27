import { CheckCircle2, Circle, Trash2, Zap } from "lucide-react";
import type { Sprint } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";

export function SprintListView({ sprints, onSelectSprint, onDeleteSprint }: {
  sprints: Sprint[]; onSelectSprint: (s: Sprint) => void; onDeleteSprint?: (s: Sprint) => void;
}) {
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
      {sprints.map(sprint => {
        const sm = getSprintStatusMeta(sprint.status);
        const progress = sprintProgress(sprint);
        const done = sprint.tickets.filter(t => t.status === "done").length;
        const inProg = sprint.tickets.filter(t => t.status === "in-progress").length;
        const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
        return (
          <div key={sprint.id} onClick={() => onSelectSprint(sprint)}
            style={{ background:"#FFFFFF", borderRadius:14, padding:"18px 20px", border:"1px solid rgba(26,23,20,0.08)", cursor:"pointer", transition:"all 0.2s", boxShadow:"0 1px 2px rgba(0,0,0,0.04)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.10)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 2px rgba(0,0,0,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
            <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:9, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{sprint.id}</span>
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20, background:sm.bg, color:sm.color }}>{sm.label}</span>
                </div>
                <h3 style={{ fontSize:15, fontWeight:700, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.02em", marginBottom:4 }}>{sprint.name}</h3>
                <p style={{ fontSize:11, color:"#A09790" }}>{sprint.goal}</p>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:16, flexShrink:0, marginLeft:20 }}>
                {[{ label:"チケット", value:sprint.tickets.length }, { label:"完了", value:done }, { label:"進行中", value:inProg }, { label:"工数(h)", value:totalHours }].map(({ label, value }) => (
                  <div key={label} style={{ textAlign:"center" as const }}>
                    <p style={{ fontSize:18, fontWeight:800, color:"#1A1714", fontFamily:"var(--font-heading)", letterSpacing:"-0.03em" }}>{value}</p>
                    <p style={{ fontSize:10, color:"#B0A9A4" }}>{label}</p>
                  </div>
                ))}
                {onDeleteSprint && (
                  <button onClick={e => { e.stopPropagation(); onDeleteSprint(sprint); }}
                    style={{ padding:6, borderRadius:7, border:"none", background:"transparent", cursor:"pointer", color:"#C9C4BB", flexShrink:0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                    <Trash2 style={{ width:14, height:14 }} />
                  </button>
                )}
              </div>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
                <span style={{ fontSize:10, color:"#B0A9A4" }}>進捗 <span style={{ fontFamily:"var(--font-mono)", color:"#6B6458", fontWeight:700 }}>{progress}%</span></span>
                <span style={{ fontSize:10, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>
              </div>
              <ProgressBar value={progress} />
            </div>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", paddingTop:10, borderTop:"1px solid rgba(26,23,20,0.05)" }}>
              <div style={{ display:"flex", gap:12 }}>
                <span style={{ fontSize:10, color:"#059669", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:4 }}><CheckCircle2 style={{ width:10, height:10 }} />{done}</span>
                <span style={{ fontSize:10, color:"#D97706", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:4 }}><Zap style={{ width:10, height:10 }} />{inProg}</span>
                <span style={{ fontSize:10, color:"#C9C4BB", fontFamily:"var(--font-mono)", display:"flex", alignItems:"center", gap:4 }}><Circle style={{ width:10, height:10 }} />{sprint.tickets.filter(t => t.status === "todo").length}</span>
              </div>
              <div style={{ display:"flex" }}>
                {[...new Set(sprint.tickets.map(t => t.assignee))].slice(0, 4).map((name, i) => (
                  <div key={name} style={{ marginLeft:i === 0 ? 0 : -6, border:"2px solid #fff", borderRadius:"50%" }}>
                    <Avatar name={name} size="xs" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
