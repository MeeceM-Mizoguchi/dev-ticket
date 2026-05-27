import type { Sprint, SprintStatus } from "@/app/types";
import { formatDate, sprintProgress } from "@/app/lib/helpers";
import { ProgressBar } from "@/app/components/shared/ProgressBar";

export function SprintBoardView({ sprints, onSelectSprint }: { sprints: Sprint[]; onSelectSprint: (s: Sprint) => void }) {
  const columns: { status: SprintStatus; label: string; color: string; bg: string }[] = [
    { status:"planning",  label:"計画中", color:"#6B6458", bg:"#F4F5F6" },
    { status:"active",    label:"進行中", color:"#059669", bg:"#ECFDF5" },
    { status:"completed", label:"完了",   color:"#0284C7", bg:"#F0F9FF" },
    { status:"cancelled", label:"中止",   color:"#DC2626", bg:"#FEF2F2" },
  ];
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16 }}>
      {columns.map(col => {
        const colSprints = sprints.filter(s => s.status === col.status);
        return (
          <div key={col.status}>
            <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:12 }}>
              <span style={{ fontSize:11, fontWeight:700, color:col.color }}>{col.label}</span>
              <span style={{ fontSize:10, background:col.bg, color:col.color, padding:"1px 7px", borderRadius:20, fontFamily:"var(--font-mono)", fontWeight:600 }}>{colSprints.length}</span>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {colSprints.map(sprint => {
                const progress = sprintProgress(sprint);
                return (
                  <div key={sprint.id} onClick={() => onSelectSprint(sprint)}
                    style={{ background:"#FFFFFF", borderRadius:12, padding:"14px", border:"1px solid rgba(26,23,20,0.08)", cursor:"pointer", transition:"all 0.2s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.10)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
                    <p style={{ fontSize:12, fontWeight:700, color:"#1A1714", marginBottom:6, lineHeight:1.3 }}>{sprint.name}</p>
                    <p style={{ fontSize:10, color:"#A09790", marginBottom:10, lineHeight:1.4 }}>{sprint.goal}</p>
                    <ProgressBar value={progress} />
                    <div style={{ display:"flex", justifyContent:"space-between", marginTop:8 }}>
                      <span style={{ fontSize:10, color:"#B0A9A4", fontFamily:"var(--font-mono)" }}>{sprint.tickets.length}チケット</span>
                      <span style={{ fontSize:10, color:"#6B6458", fontFamily:"var(--font-mono)", fontWeight:700 }}>{progress}%</span>
                    </div>
                    <p style={{ fontSize:10, color:"#B0A9A4", marginTop:6, fontFamily:"var(--font-mono)" }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</p>
                  </div>
                );
              })}
              {colSprints.length === 0 && <div style={{ padding:"24px 0", textAlign:"center" as const, color:"#C9C4BB", fontSize:12 }}>なし</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
