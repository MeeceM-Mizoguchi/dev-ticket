import { useEffect, useRef, useState } from "react";
import { Building2, Calendar, CheckCircle2, Circle, MoreHorizontal, Pencil, Trash2, UserPlus, Zap } from "lucide-react";
import type { Project } from "@/app/types";
import { calcProgress, formatDate, getStatusMeta } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";

export function ProjectCard({
  project, onNavigate, onEdit, onDelete, onAssign,
}: {
  project: Project;
  onNavigate: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onAssign?: () => void;
}) {
  const progress = calcProgress(project.done, project.inProgress, project.todo);
  const total = project.done + project.inProgress + project.todo;
  const sm = getStatusMeta(project.status);
  const dotColor = project.status === "in-progress" ? "#FB923C" : project.status === "completed" ? "#10B981" : project.status === "on-hold" ? "#F59E0B" : "#C9C4BB";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

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

          {/* Three-dot menu */}
          <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setMenuOpen(o => !o)}
              style={{ padding: 6, borderRadius: 7, border: "none", background: menuOpen ? "#F4F5F6" : "transparent", cursor: "pointer", color: menuOpen ? "#1A1714" : "#C9C4BB", display: "flex", alignItems: "center", justifyContent: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { if (!menuOpen) { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; } }}>
              <MoreHorizontal style={{ width: 15, height: 15 }} />
            </button>

            {menuOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 50, background: "#FFF", borderRadius: 10, boxShadow: "0 8px 24px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)", border: "1px solid rgba(26,23,20,0.09)", padding: "4px", minWidth: 140, overflow: "hidden" }}>
                {onEdit && (
                  <MenuItem icon={<Pencil style={{ width: 12, height: 12 }} />} label="編集" onClick={() => { setMenuOpen(false); onEdit(); }} color="#1A1714" />
                )}
                {onAssign && (
                  <MenuItem icon={<UserPlus style={{ width: 12, height: 12 }} />} label="メンバー割り当て" onClick={() => { setMenuOpen(false); onAssign(); }} color="#059669" />
                )}
                {onDelete && (
                  <MenuItem icon={<Trash2 style={{ width: 12, height: 12 }} />} label="削除" onClick={() => { setMenuOpen(false); onDelete(); }} color="#DC2626" />
                )}
                {!onEdit && !onDelete && !onAssign && (
                  <div style={{ padding: "8px 10px", fontSize: 12, color: "#B0A9A4" }}>操作なし</div>
                )}
              </div>
            )}
          </div>
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
          {/* Member avatar group */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {project.members.slice(0, 4).map((name, i) => (
              <div key={name} style={{ marginLeft: i === 0 ? 0 : -8, border: "2px solid #fff", borderRadius: "50%", zIndex: 4 - i }}>
                <Avatar name={name} size="xs" />
              </div>
            ))}
            {project.members.length > 4 && (
              <div style={{ marginLeft: -8, width: 24, height: 24, borderRadius: "50%", background: "#F4F5F6", border: "2px solid #fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#6B6458" }}>
                +{project.members.length - 4}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MenuItem({ icon, label, onClick, color }: { icon: React.ReactNode; label: string; onClick: () => void; color: string }) {
  return (
    <button onClick={onClick}
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "transparent", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 500, color, textAlign: "left" as const, transition: "background 0.1s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = color === "#DC2626" ? "#FEF2F2" : "#F4F5F6"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
      {icon}{label}
    </button>
  );
}
