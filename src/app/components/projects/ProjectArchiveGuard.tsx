// BRU25-012 アーカイブ済みのプロジェクトの中（/:projectSlug 以下）に入れなくする。
//
// AppRoutes.tsx で /:projectSlug で始まるすべての経路をこの部品で包む（各画面に個別の判定は足さない）。
// ブックマーク・通知・ほかのチケットに貼られたリンクから開いた場合も、ここを通る。
//
// ・プロジェクトを読み終わるまでは中の画面を出さない（一瞬でも中身を見せないため）
// ・一度調べたプロジェクトは結果を覚えておき、画面を移るたびに待たせない（裏で確かめ直す）
// ・見つからない・読めないときは判定せず、そのまま中の画面に任せる（404 は各画面が出す）
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { Archive } from "lucide-react";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { isSupabaseEnabled } from "@/lib/supabase";
import {
  fetchProjectArchive, formatArchivedDate, getCachedProjectArchive, type ProjectArchiveState,
} from "@/app/lib/projectArchive";

export function ProjectArchiveGuard({ children }: { children: ReactNode }) {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<{ slug: string; value: ProjectArchiveState } | null>(() => {
    const cached = getCachedProjectArchive(projectSlug);
    return cached ? { slug: projectSlug, value: cached } : null;
  });

  useEffect(() => {
    if (!isSupabaseEnabled || !projectSlug) return;
    let alive = true;
    const cached = getCachedProjectArchive(projectSlug);
    if (cached) setState({ slug: projectSlug, value: cached });
    void fetchProjectArchive(projectSlug).then(value => {
      if (alive) setState({ slug: projectSlug, value });
    });
    return () => { alive = false; };
  }, [projectSlug]);

  if (!isSupabaseEnabled || !projectSlug) return <>{children}</>;
  // 読み終わるまでは中の画面を出さない
  if (!state || state.slug !== projectSlug) return <PageLoader label="読み込み中..." />;

  const archived = state.value.archived;
  if (!archived) return <>{children}</>;

  const date = formatArchivedDate(archived.archivedAt);
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60vh", padding: 24 }}>
      <div style={{ textAlign: "center", maxWidth: 440 }}>
        <div style={{ width: 56, height: 56, background: "#F1F1EF", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <Archive style={{ width: 24, height: 24, color: "#6B6458" }} />
        </div>
        <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", marginBottom: 8 }}>このプロジェクトはアーカイブされています</p>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#3D3732", marginBottom: 6 }}>{archived.name}</p>
        <p style={{ fontSize: 12, color: "#8A847C", marginBottom: 20 }}>
          {date}{date ? " に " : ""}{archived.archivedBy ?? "（不明）"} がアーカイブしました
        </p>
        <button type="button" onClick={() => navigate("/projects")}
          style={{ padding: "9px 18px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer" }}>
          プロジェクト一覧へ戻る
        </button>
      </div>
    </div>
  );
}
