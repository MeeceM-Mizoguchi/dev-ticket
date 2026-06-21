import type { ElementType } from "react";
import { useNavigate } from "react-router";
import { Layers, ClipboardList, BookOpen, FileText } from "lucide-react";
import type { AccessLevel } from "@/app/types";

type ProjectSubPage = "sprints" | "backlog" | "wiki" | "minutes";

const ITEMS: { id: ProjectSubPage; label: string; icon: ElementType; path: string; permKey?: "backlog" | "wiki" | "minutes" }[] = [
  { id: "sprints",  label: "スプリント管理", icon: Layers,       path: "" },
  { id: "backlog",  label: "バックログ",     icon: ClipboardList, path: "/backlog",  permKey: "backlog" },
  { id: "wiki",     label: "Wiki",           icon: BookOpen,      path: "/wiki",     permKey: "wiki" },
  { id: "minutes",  label: "議事録",         icon: FileText,      path: "/minutes",  permKey: "minutes" },
];

interface ProjectSubNavProps {
  projectSlug: string;
  active: ProjectSubPage;
  marginBottom?: number;
  wikiPerm?: AccessLevel;
  backlogPerm?: AccessLevel;
  minutesPerm?: AccessLevel;
}

export function ProjectSubNav({ projectSlug, active, marginBottom = 20, wikiPerm, backlogPerm, minutesPerm }: ProjectSubNavProps) {
  const navigate = useNavigate();

  const permMap: Record<string, AccessLevel | undefined> = {
    wiki: wikiPerm, backlog: backlogPerm, minutes: minutesPerm,
  };

  const visibleItems = ITEMS.filter(item => {
    if (!item.permKey) return true;
    const p = permMap[item.permKey];
    return p === undefined || p !== "none";
  });

  return (
    <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 4, marginBottom, width: "fit-content" }}>
      {visibleItems.map(({ id, label, icon: Icon, path }) => (
        <button key={id} onClick={() => navigate(`/${projectSlug}${path}`)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: active === id ? "#059669" : "transparent", color: active === id ? "#fff" : "#6B6458" }}>
          <Icon style={{ width: 13, height: 13 }} />{label}
        </button>
      ))}
    </div>
  );
}
