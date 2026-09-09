import { useState, type ElementType } from "react";
import { useNavigate } from "react-router";
import { Layers, ClipboardList, BookOpen, FileText, PenTool, FolderOpen, Github, Megaphone, Search } from "lucide-react";
import type { AccessLevel, GithubAccessLevel } from "@/app/types";
import { usePlan } from "@/app/contexts/PlanContext";
import { useGithubAccess } from "@/app/hooks/useGithubAccess";
import { TICKET_SEARCH_PATH } from "@/app/lib/ticketSearch";

type ProjectSubPage = "sprints" | "ticket-search" | "release-notes" | "backlog" | "tasks" | "wiki" | "minutes" | "whiteboard" | "files" | "knowledge" | "github";

// ファイルボックスは権限設定を持たない（プロジェクトメンバー全員が利用できる）ため permKey なし
const ITEMS: { id: ProjectSubPage; label: string; icon: ElementType; path: string; permKey?: "backlog" | "wiki" | "minutes" | "whiteboard" | "github" }[] = [
  { id: "sprints",    label: "スプリント管理", icon: Layers,       path: "" },
  // ENHA2-048 チケット一覧検索。スプリントをまたいでチケットを絞り込む画面。
  // スプリント一覧と同じく、プロジェクトメンバーなら誰でも見られる（個別の権限設定は持たない）
  { id: "ticket-search", label: "一覧検索",     icon: Search,       path: `/${TICKET_SEARCH_PATH}` },
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
  const [hovered, setHovered] = useState<ProjectSubPage | null>(null);
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

  // 🌟 BRU13-047: タブが増えてラベルが折り返していたのを、余白を詰めて1行に収める。
  //   - flexShrink:0（コンテナ／ボタン）… 見出しの長さや「閲覧のみ」バッジの有無で
  //     使える幅がページごとに違うため、縮むと画面ごとにタブ幅と位置が変わってしまう。
  //     縮まなくすることで、どの画面でもタブは同じ幅・同じ位置に出る。
  //   - whiteSpace:nowrap … 万一幅が足りなくてもラベルは改行させない（保険）。
  //   余白を詰めた分（左右padding 14→9 / ボタン間 4→2 / アイコン間 5→4）で約130px幅が縮む。
  return (
    <div style={{ display: "flex", gap: 2, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 3, marginBottom, width: "fit-content", flexShrink: 0 }}>
      {visibleItems.map(({ id, label, icon: Icon, path }) => {
        // マウスを乗せたときの見た目。共通CSS（styles/interactive.css）の薄い黒の膜だと
        // タブでは弱く、押せるかどうかが伝わらないので、ここは淡い緑ではっきり出す。
        // 共通の膜が重なると色が濁るため data-hover="off" で外している。
        const isActive = active === id;
        const isHover = hovered === id;
        return (
          <button key={id} onClick={() => navigate(`/${projectSlug}${path}`)} title={label} data-hover="off"
            onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(h => (h === id ? null : h))}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "7px 9px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap", flexShrink: 0,
              background: isActive ? (isHover ? "#047857" : "#059669") : (isHover ? "#ECFDF5" : "transparent"),
              color: isActive ? "#fff" : (isHover ? "#059669" : "#6B6458") }}>
            <Icon style={{ width: 13, height: 13, flexShrink: 0 }} />{label}
          </button>
        );
      })}
    </div>
  );
}
