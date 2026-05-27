import { Building2, Calendar, CheckCircle2, Circle, MoreHorizontal, Trash2, Zap } from "lucide-react";
import type { Project } from "@/app/types";
import { calcProgress, formatDate, getStatusMeta } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";

export function ProjectCard({ project, onNavigate, onDelete }: { project: Project; onNavigate: () => void; onDelete?: () => void }) {
  const progress = calcProgress(project.done, project.inProgress, project.todo);
  const total = project.done + project.inProgress + project.todo;
  const sm = getStatusMeta(project.status);
  const dotColor = project.status === "in-progress" ? "#FB923C" : project.status === "completed" ? "#10B981" : project.status === "on-hold" ? "#F59E0B" : "#C9C4BB";

  return (
    <div onClick={onNavigate} style={{ background: "#FFFFFF", borderRadius: 16, overflow: "hidden", cursor: "pointer", transition: "all 0.2s", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 28px rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(26,23,20,0.06), 0 4px 12px rgba(26,23,20,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
      <div style={{ height: 5, background: `linear-gradient(90deg, ${dotColor}, ${dotColor}CC)` }} />
      <div style={{ padding: "16px 18px 18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{project.id}</span>
              <span style={{ fontSize: 9, background: project.status === "in-progress" ? "#ECFDF5" : project.status === "completed" ? "#ECFDF5" : project.status === "on-hold" ? "#FFFBEB" : "#F4F5F6", color: project.status === "in-progress" ? "#059669" : project.status === "completed" ? "#059669" : project.status === "on-hold" ? "#D97706" : "#A09790", padding: "2px 7px", borderRadius: 20, fontWeight: 600 }}>{sm.label}</span>
            </div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", lineHeight: 1.3, marginBottom: 3 }}>{project.name}</h3>
            <p style={{ fontSize: 11, color: "#B0A9A4", display: "flex", alignItems: "center", gap: 4 }}>
              <Building2 style={{ width: 10, height: 10 }} />{project.client}
            </p>
          </div>
          {onDelete ? (
            <button onClick={e => { e.stopPropagation(); onDelete(); }} style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
              <Trash2 style={{ width: 13, height: 13 }} />
            </button>
          ) : (
            <button onClick={e => e.stopPropagation()} style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <MoreHorizontal style={{ width: 14, height: 14 }} />
            </button>
          )}
        </div>
        {project.description && (
          <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.6, marginBottom: 14, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, overflow: "hidden" }}>{project.description}</p>
        )}
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600 }}>進捗</span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: "#3D3732" }}>{progress}%</span>
          </div>
          <ProgressBar value={progress} />
          <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
            <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}><CheckCircle2 style={{ width: 10, height: 10 }} />{project.done}</span>
            <span style={{ fontSize: 10, color: "#D97706", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}><Zap style={{ width: 10, height: 10 }} />{project.inProgress}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}><Circle style={{ width: 10, height: 10 }} />{project.todo}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", fontFamily: "var(--font-mono)", marginLeft: "auto" }}>{total}件</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid rgba(26,23,20,0.05)" }}>
          <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", display: "flex", alignItems: "center", gap: 4 }}>
            <Calendar style={{ width: 10, height: 10 }} />{formatDate(project.startDate)} – {formatDate(project.endDate)}
          </span>
          <div style={{ display: "flex" }}>
            {project.members.slice(0, 3).map((name, i) => (
              <div key={name} style={{ marginLeft: i === 0 ? 0 : -8, border: "2px solid #fff", borderRadius: "50%" }}>
                <Avatar name={name} size="xs" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
