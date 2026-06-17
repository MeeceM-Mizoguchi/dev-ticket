import type { ElementType } from "react";
import { useNavigate } from "react-router";
import { Layers, ClipboardList, BookOpen, FileText } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import type { UserPermissions } from "@/app/types";

type ProjectSubPage = "sprints" | "backlog" | "wiki" | "minutes";

const ITEMS: { id: ProjectSubPage; label: string; icon: ElementType; path: string; permission?: keyof UserPermissions }[] = [
  { id: "sprints", label: "スプリント管理", icon: Layers, path: "" },
  { id: "backlog", label: "バックログ", icon: ClipboardList, path: "/backlog", permission: "canAccessBacklog" },
  { id: "wiki", label: "Wiki", icon: BookOpen, path: "/wiki", permission: "canAccessWiki" },
  { id: "minutes", label: "議事録", icon: FileText, path: "/minutes", permission: "canAccessMinutes" },
];

export function ProjectSubNav({ projectSlug, active, marginBottom = 20 }: { projectSlug: string; active: ProjectSubPage; marginBottom?: number }) {
  const navigate = useNavigate();
  const { userPermissions } = useAuth();
  const visible = ITEMS.filter(i => !i.permission || userPermissions[i.permission]);

  return (
    <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 4, marginBottom, width: "fit-content" }}>
      {visible.map(({ id, label, icon: Icon, path }) => (
        <button key={id} onClick={() => navigate(`/${projectSlug}${path}`)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: active === id ? "#059669" : "transparent", color: active === id ? "#fff" : "#6B6458" }}>
          <Icon style={{ width: 13, height: 13 }} />{label}
        </button>
      ))}
    </div>
  );
}
