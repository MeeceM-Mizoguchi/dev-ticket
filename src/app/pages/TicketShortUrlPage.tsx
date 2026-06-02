import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

export function TicketShortUrlPage() {
  const { projectSlug, ticketWbs } = useParams<{ projectSlug: string; ticketWbs: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectSlug || !ticketWbs) { navigate("/dashboard", { replace: true }); return; }
    if (!isSupabaseEnabled) { navigate("/dashboard", { replace: true }); return; }

    (async () => {
      // 1. プロジェクトをslugで検索
      const { data: project, error: pErr } = await supabase!
        .from("projects")
        .select("id, name, slug")
        .eq("slug", projectSlug.toUpperCase())
        .single();

      if (pErr || !project) {
        setError(`プロジェクト「${projectSlug}」が見つかりません。`);
        return;
      }

      // 2. プロジェクト配下のスプリントIDを取得
      const { data: sprintRows } = await supabase!
        .from("sprints")
        .select("id")
        .eq("project_id", project.id);

      if (!sprintRows?.length) {
        setError(`プロジェクト「${projectSlug}」にスプリントがありません。`);
        return;
      }

      const sprintIds = sprintRows.map(s => s.id);

      // 3. WBS番号でチケットを検索
      const { data: ticket } = await supabase!
        .from("sprint_tickets")
        .select("sprint_id, wbs")
        .eq("wbs", ticketWbs)
        .in("sprint_id", sprintIds)
        .single();

      if (!ticket) {
        setError(`チケット「${ticketWbs}」が見つかりません。`);
        return;
      }

      // 4. スプリント詳細ページへリダイレクト
      navigate(`/projects/${project.id}/sprints/${ticket.sprint_id}/${ticket.wbs}`, { replace: true });
    })();
  }, [projectSlug, ticketWbs, navigate]);

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: 24 }}>
        <div style={{ textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 36, marginBottom: 16 }}>🔍</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1A1714", marginBottom: 8 }}>見つかりません</h2>
          <p style={{ fontSize: 13, color: "#9E9690", lineHeight: 1.65, marginBottom: 24 }}>{error}</p>
          <button onClick={() => navigate("/projects")}
            style={{ padding: "10px 28px", background: "#059669", color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            プロジェクト一覧へ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: 24 }}>
      <div style={{ textAlign: "center", color: "#A09790", fontSize: 13 }}>
        <div style={{ width: 32, height: 32, border: "3px solid #059669", borderTopColor: "transparent", borderRadius: "50%", margin: "0 auto 16px", animation: "spin 0.8s linear infinite" }} />
        チケットを読み込み中...
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
