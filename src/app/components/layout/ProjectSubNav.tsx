import type { ElementType } from "react";
import { useNavigate } from "react-router";
import { Layers, ClipboardList, BookOpen, FileText, PenTool, FolderOpen, Github, Megaphone } from "lucide-react";
import type { AccessLevel, GithubAccessLevel } from "@/app/types";
import { usePlan } from "@/app/contexts/PlanContext";
import { useGithubAccess } from "@/app/hooks/useGithubAccess";

type ProjectSubPage = "sprints" | "release-notes" | "backlog" | "tasks" | "wiki" | "minutes" | "whiteboard" | "files" | "knowledge" | "github";

// ファイルボックスは権限設定を持たない（プロジェクトメンバー全員が利用できる）ため permKey なし
const ITEMS: { id: ProjectSubPage; label: string; icon: ElementType; path: string; permKey?: "backlog" | "wiki" | "minutes" | "whiteboard" | "github" }[] = [
  { id: "sprints",    label: "スプリント管理", icon: Layers,       path: "" },
  // リリースノートはプロジェクト単位のカレンダー。権限設定は持たない（プロジェクトメンバー全員）
  { id: "release-notes", label: "リリースノート", icon: Megaphone, path: "/release-notes" },
  { id: "backlog",    label: "バックログ",     icon: ClipboardList, path: "/backlog",    permKey: "backlog" },
  // タスク（ENHA2-032）はサイドメニューの「タスク」に集約したため、プロジェクト内タブからは外している
  { id: "wiki",       label: "Wiki",           icon: BookOpen,      path: "/wiki",       permKey: "wiki" },
  { id: "minutes",    label: "議事録",         icon: FileText,      path: "/minutes",    permKey: "minutes" },
  { id: "files",      label: "ファイルボックス", icon: FolderOpen,  path: "/files" },
  { id: "whiteboard", label: "ホワイトボード", icon: PenTool,       path: "/whiteboard", permKey: "whiteboard" },
  // ナレッジノートはファイルボックスと同様に個別の権限設定を持たない（プロジェクトメンバー全員）。
  // 代わりにプラン（feature_knowledge_ai）で表示可否を切り替える。
  { id: "knowledge",  label: "ナレッジノート", icon: BookOpen,      path: "/knowledge" },
  // GitHubは既定が「権限なし」なので、付与された人にだけタブが出る
  { id: "github",     label: "GitHub",         icon: Github,        path: "/github",     permKey: "github" },
];

interface ProjectSubNavProps {
  projectSlug: string;
  active: ProjectSubPage;
  marginBottom?: number;
  wikiPerm?: AccessLevel;
  backlogPerm?: AccessLevel;
  minutesPerm?: AccessLevel;
  whiteboardPerm?: AccessLevel;
}

export function ProjectSubNav({ projectSlug, active, marginBottom = 20, wikiPerm, backlogPerm, minutesPerm, whiteboardPerm }: ProjectSubNavProps) {
  const navigate = useNavigate();
  const { plan } = usePlan();
  // GitHubの権限だけは呼び出し側から渡さず、ここで解決する。
  // 8つある呼び出し側すべてに配線すると漏れが出て、タブが画面ごとに出たり消えたりするため。
  const github = useGithubAccess(projectSlug);

  const permMap: Record<string, AccessLevel | GithubAccessLevel | undefined> = {
    wiki: wikiPerm, backlog: backlogPerm, minutes: minutesPerm, whiteboard: whiteboardPerm,
  };

  const visibleItems = ITEMS.filter(item => {
    if (item.id === "knowledge" && !plan.featureKnowledgeAi) return false;
    if (item.id === "github") {
      if (!plan.featureGithub) return false;
      // 権限が無い／未取得（undefined）のうちは出さない。他タブと違って
      // 「未指定＝許可」にすると、権限のない人に一瞬見えてしまう。
      if (!github.level || github.level === "none") return false;
      // リポジトリが紐付いていないプロジェクトでは出さない
      return github.linked;
    }
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
