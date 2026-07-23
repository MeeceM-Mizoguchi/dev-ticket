// ホワイトボード画面。左にボード一覧、右にリアルタイム共同編集キャンバス（遅延ロード）。
// 権限は議事録と同型（owner/admin=edit固定、他は project_member_permissions を参照）。
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import { FolderKanban, ChevronRight, PenTool } from "lucide-react";
import { isSupabaseEnabled, supabase } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";
import { BoardListSidebar } from "@/app/components/whiteboard/BoardListSidebar";
import { listBoards, createBoard, renameBoard, deleteBoard, resolveProject } from "@/app/lib/whiteboardService";
import type { AccessLevel, UserPermissions, Whiteboard } from "@/app/types";

const WhiteboardCanvas = lazy(() => import("@/app/components/whiteboard/WhiteboardCanvas"));

// userId から安定した色を生成
function colorFromId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 70%, 45%)`;
}

interface Perms { whiteboard: AccessLevel; wiki: AccessLevel; backlog: AccessLevel; minutes: AccessLevel }

export function WhiteboardPage() {
  const { projectSlug, boardId } = useParams();
  const navigate = useNavigate();
  const { userId, userName, userRole } = useAuth();
  const isAdminRole = userRole === "owner" || userRole === "admin";

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [perms, setPerms] = useState<Perms>({ whiteboard: "view", wiki: "view", backlog: "view", minutes: "view" });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const p = await resolveProject(projectSlug);
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProjectId(p.id);
    setProjectName(p.name);

    const [boardRows, permRes] = await Promise.all([
      listBoards(p.id),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    setBoards(boardRows);
    if (isAdminRole) {
      setPerms({ whiteboard: "edit", wiki: "edit", backlog: "edit", minutes: "edit" });
    } else {
      const up = (permRes as any).data?.permissions as Partial<UserPermissions> | undefined;
      setPerms({
        whiteboard: (up?.whiteboardPermission as AccessLevel) ?? "none",
        wiki: (up?.wikiPermission as AccessLevel) ?? "none",
        backlog: (up?.backlogPermission as AccessLevel) ?? "none",
        minutes: (up?.minutesPermission as AccessLevel) ?? "none",
      });
    }
    setLoading(false);
  }, [projectSlug, isAdminRole, userId]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = perms.whiteboard === "edit";

  const handleCreate = useCallback(async () => {
    if (!projectId) return;
    const b = await createBoard(projectId, "無題のボード", userId);
    if (b) { setBoards((prev) => [b, ...prev]); navigate(`/${projectSlug}/whiteboard/${b.id}`); }
  }, [projectId, userId, projectSlug, navigate]);

  const handleRename = useCallback(async (id: string, title: string) => {
    await renameBoard(id, title, userId);
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, title } : b)));
  }, [userId]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteBoard(id);
    setBoards((prev) => prev.filter((b) => b.id !== id));
    if (boardId === id) navigate(`/${projectSlug}/whiteboard`);
  }, [boardId, projectSlug, navigate]);

  if (!loading && notFound) return <Navigate to="/projects" replace />;
  if (!loading && perms.whiteboard === "none") return <Navigate to="/dashboard" replace />;

  const user = { id: userId, name: userName || "匿名", color: colorFromId(userId || "anon") };

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{projectName || projectSlug || ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>ホワイトボード</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{projectName ? `${projectName} · ${boards.length} 件` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {!loading && perms.whiteboard === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? ""} active="whiteboard" marginBottom={0}
            whiteboardPerm={perms.whiteboard} wikiPerm={perms.wiki} backlogPerm={perms.backlog} minutesPerm={perms.minutes} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        <BoardListSidebar
          boards={boards} selectedId={boardId ?? null} canEdit={canEdit} loading={loading}
          onSelect={(id) => navigate(`/${projectSlug}/whiteboard/${id}`)}
          onCreate={handleCreate} onRename={handleRename} onDelete={handleDelete}
        />
        <div style={{ flex: 1, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", overflow: "hidden" }}>
          {boardId ? (
            // ボード切替時は resetKeys で境界を自動リセットし、前ボードの例外を持ち越さない（BRU7-043）。
            <ErrorBoundary resetKeys={[boardId]}>
              <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", fontSize: 13 }}>ホワイトボードを読み込み中…</div>}>
                <WhiteboardCanvas key={boardId} boardId={boardId} title={boards.find((b) => b.id === boardId)?.title ?? "whiteboard"} user={user} canEdit={canEdit} />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", gap: 10 }}>
              <PenTool style={{ width: 34, height: 34, color: "#D8D3CC" }} />
              <span style={{ fontSize: 13 }}>ボードを選択または作成してください</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
