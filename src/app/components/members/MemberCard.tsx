import { Eye, Edit2, Mail, Trash2, Layers } from "lucide-react";
import type { Member, Role } from "@/app/types";
import { getRoleMeta } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";

const roleColors: Record<Role, { grad: string; badge: string; text: string }> = {
  admin:             { grad: "linear-gradient(135deg,#FB7185,#F43F5E)", badge: "#FFF1F2", text: "#F43F5E" },
  "project-manager": { grad: "linear-gradient(135deg,#34D399,#059669)", badge: "#ECFDF5", text: "#059669" },
  developer:         { grad: "linear-gradient(135deg,#38BDF8,#0284C7)", badge: "#F0F9FF", text: "#0284C7" },
  designer:          { grad: "linear-gradient(135deg,#A78BFA,#7C3AED)", badge: "#F5F3FF", text: "#7C3AED" },
};

export function MemberCard({ member, canEdit, canDelete, onEdit, onDetail, onDelete }: {
  member: Member; canEdit: boolean; canDelete: boolean;
  onEdit?: () => void; onDetail?: () => void; onDelete?: () => void;
}) {
  const rc = roleColors[member.role];
  const roleMeta = getRoleMeta(member.role);

  return (
    <div style={{ background: "#FFFFFF", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)", transition: "all 0.2s", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 28px rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(26,23,20,0.06), 0 4px 12px rgba(26,23,20,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
      <div style={{ height: 60, background: rc.grad, position: "relative", borderRadius: "16px 16px 0 0", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 80% 50%, rgba(255,255,255,0.12) 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", top: 12, right: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.18)", padding: "3px 8px", borderRadius: 20, letterSpacing: "0.04em" }}>
            {roleMeta.label.toUpperCase()}
          </span>
        </div>
      </div>
      <div style={{ position: "relative", height: 0 }}>
        <div style={{ position: "absolute", top: -20, left: 18, border: "3px solid #FFFFFF", borderRadius: "50%", boxShadow: "0 2px 8px rgba(26,23,20,0.15)", zIndex: 1 }}>
          <Avatar name={member.name} size="md" />
        </div>
      </div>
      <div style={{ padding: "28px 18px 18px" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>{member.name}</p>
            {member.status === "invited" && <span style={{ fontSize: 9, background: "#FFFBEB", color: "#D97706", padding: "2px 6px", borderRadius: 20, fontWeight: 600 }}>招待中</span>}
          </div>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
            <Mail style={{ width: 9, height: 9 }} />{member.email}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: rc.badge, color: rc.text }}>{roleMeta.label}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", display: "flex", alignItems: "center", gap: 3 }}>
              <Layers style={{ width: 9, height: 9 }} />{member.group}
            </span>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[{ value: member.projects, label: "PJ", accent: "#059669" }, { value: member.tickets, label: "チケット", accent: "#0284C7" }].map(({ value, label }) => (
            <div key={label} style={{ background: "#F4F5F6", borderRadius: 10, padding: "12px", textAlign: "center" as const }}>
              <p style={{ fontSize: 26, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: 9, color: "#B0A9A4", marginTop: 3, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>{label}</p>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <button onClick={e => { e.stopPropagation(); onDetail?.(); }}
            style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <Eye style={{ width: 12, height: 12 }} />詳細
          </button>
          {canEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit?.(); }}
              style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
              <Edit2 style={{ width: 12, height: 12 }} />編集
            </button>
          )}
          {canDelete && onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              style={{ padding: "9px 10px", fontSize: 12, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(220,38,38,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
