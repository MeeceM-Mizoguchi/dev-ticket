// ホワイトボード画面。左にボード一覧、右にリアルタイム共同編集キャンバス（遅延ロード）。
// 権限は議事録と同型（owner/admin=edit固定、他は project_member_permissions を参照）。
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, PenTool } from "lucide-react";
import { isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";
import { BoardListSidebar } from "@/app/components/whiteboard/BoardListSidebar";
import { BoardListToggle } from "@/app/components/whiteboard/BoardListToggle";
import { listBoards, createBoard, renameBoard, deleteBoard, resolveProject, loadWhiteboardPerms, wbUserColor } from "@/app/lib/whiteboardService";
import { ELEMENT_LINK_PARAM } from "@/app/lib/whiteboardLink";
import type { AccessLevel, Whiteboard } from "@/app/types";

const WhiteboardCanvas = lazy(() => import("@/app/components/whiteboard/WhiteboardCanvas"));

// ボード一覧をたたんだ状態の保存キー（BRU9-046）。プロジェクト横断の「好み」として1キーで持つ。
const COLLAPSE_LS_KEY = "wb_board_list_collapsed";

interface Perms { whiteboard: AccessLevel; wiki: AccessLevel; backlog: AccessLevel; minutes: AccessLevel }

export function WhiteboardPage() {
  const { projectSlug, boardId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { userId, userName, userRole } = useAuth();
  const isAdminRole = userRole === "owner" || userRole === "admin";
  // オブジェクトへのディープリンク（?element=）。着地したら消費して URL から取り除く
  // （残すとボードを切り替えたりリロードするたびに再フォーカスが暴発するため・FileBoxPageと同型）。
  const focusElementId = searchParams.get(ELEMENT_LINK_PARAM);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [perms, setPerms] = useState<Perms>({ whiteboard: "view", wiki: "view", backlog: "view", minutes: "view" });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // 初期値は useState 初期化関数で同期的に読む。useEffect で後から反映すると
  // リロード時にサイドバーが一瞬出て消える（チカチカ）ため。
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_LS_KEY) === "1"; } catch { return false; }
  });

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const p = await resolveProject(projectSlug);
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProjectId(p.id);
    setProjectName(p.name);

    // 権限判定はリンクプレビュー（WhiteboardLinkPreview）と共通の関数に集約している。
    // whiteboards の RLS は authenticated 全許可なので、ここがアクセス制御の実体。
    const [boardRows, nextPerms] = await Promise.all([
      listBoards(p.id),
      loadWhiteboardPerms(p.id, userId, isAdminRole),
    ]);
    setBoards(boardRows);
    setPerms(nextPerms);
    setLoading(false);
  }, [projectSlug, isAdminRole, userId]);

  useEffect(() => { void load(); }, [load]);

  const canEdit = perms.whiteboard === "edit";

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSE_LS_KEY, next ? "1" : "0"); } catch { /* プライベートモード等では保存だけ諦める */ }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!projectId) return;
    const b = await createBoard(projectId, "無題のボード", userId);
    if (b) { setBoards((prev) => [b, ...prev]); navigate(`/${projectSlug}/whiteboard/${b.id}`); }
  }, [projectId, userId, projectSlug, navigate]);

  const handleRename = useCallback(async (id: string, title: string) => {
    await renameBoard(id, title, userId);
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, title } : b)));
  }, [userId]);

  // リンク着地の結果。見つからなければ理由を伝え、いずれにせよ ?element= は URL から消す。
  const handleFocusResult = useCallback((found: boolean) => {
    if (!found) toast("リンク先のオブジェクトが見つかりませんでした（削除された可能性があります）", "info");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete(ELEMENT_LINK_PARAM);
      return next;
    }, { replace: true });
  }, [toast, setSearchParams]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteBoard(id);
    setBoards((prev) => prev.filter((b) => b.id !== id));
    if (boardId === id) navigate(`/${projectSlug}/whiteboard`);
  }, [boardId, projectSlug, navigate]);

  if (!loading && notFound) return <Navigate to="/projects" replace />;
  if (!loading && perms.whiteboard === "none") return <Navigate to="/dashboard" replace />;

  const user = { id: userId, name: userName || "匿名", color: wbUserColor(userId || "anon") };

  // ボード選択状態にかかわらず、collapsed が true のときはサイドバーを折りたたむ
  // （折りたたんだ状態でも再展開用のボタン BoardListToggle が表示されるため展開可能）
  const sidebarHidden = collapsed;

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
        {/* たたんだ時は width:0 で残さず外す（非表示の検索inputにTabフォーカスが入るのを防ぐ）。
            アニメーションは付けない: transition 中に Excalidraw の ResizeObserver が毎フレーム
            発火してcanvas再描画がジャンクするため、即時切替にする（BRU9-046）。 */}
        {!sidebarHidden && (
          <BoardListSidebar
            boards={boards} selectedId={boardId ?? null} canEdit={canEdit} loading={loading}
            onSelect={(id) => navigate(`/${projectSlug}/whiteboard/${id}`)}
            onCreate={handleCreate} onRename={handleRename} onDelete={handleDelete}
            onCollapse={toggleCollapsed}
          />
        )}
        <div style={{ position: "relative", flex: 1, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", overflow: "hidden" }}>
          {boardId ? (
            // ボード切替時は resetKeys で境界を自動リセットし、前ボードの例外を持ち越さない（BRU7-043）。
            <ErrorBoundary resetKeys={[boardId]}>
              <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", fontSize: 13 }}>ホワイトボードを読み込み中…</div>}>
                <WhiteboardCanvas
                  key={boardId}
                  boardId={boardId}
                  title={boards.find((b) => b.id === boardId)?.title ?? "whiteboard"}
                  user={user}
                  canEdit={canEdit}
                  projectSlug={projectSlug ?? ""}
                  focusElementId={focusElementId}
                  onFocusResult={handleFocusResult}
                />
              </Suspense>
            </ErrorBoundary>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", gap: 10 }}>
              <PenTool style={{ width: 34, height: 34, color: "#D8D3CC" }} />
              <span style={{ fontSize: 13 }}>ボードを選択または作成してください</span>
            </div>
          )}
          {/* たたんだ状態の展開ボタン。キャンバス左上（Excalidraw標準ハンバーガーはCSSで非表示・
              左プロパティ島は margin-top:52px）に浮かせる。Canvasルートは isolation:isolate なので
              zIndex:1 で十分に前面へ出るうえ、疑似全画面(zIndex:3000)時は自動的に隠れる。 */}
          {sidebarHidden && (
            <BoardListToggle collapsed onToggle={toggleCollapsed} variant="floating" />
          )}
        </div>
      </div>
    </div>
  );
}
