// ホワイトボード画面。左にボード一覧、右にリアルタイム共同編集キャンバス（遅延ロード）。
// 権限は議事録と同型（owner/admin=edit固定、他は project_member_permissions を参照）。
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router";
import { FolderKanban, ChevronRight, PenTool } from "lucide-react";
import { isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ErrorBoundary } from "@/app/components/ErrorBoundary";
import { BoardListSidebar } from "@/app/components/whiteboard/BoardListSidebar";
import { BoardListToggle } from "@/app/components/whiteboard/BoardListToggle";
import { PrivateBadge } from "@/app/components/whiteboard/PrivateBadge";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { NotFoundView } from "@/app/components/shared/NotFoundView";
import { checkProjectAccess } from "@/app/lib/projectAccess";
import { listBoards, createBoard, renameBoard, deleteBoard, resolveProject, loadWhiteboardPerms, wbUserColor, setBoardVisibility, broadcastBoardEvicted } from "@/app/lib/whiteboardService";
import { getWbControl } from "@/app/lib/whiteboardControlBus";
import { COMMENT_LINK_PARAM, ELEMENT_LINK_PARAM, REPLY_LINK_PARAM } from "@/app/lib/whiteboardLink";
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
  const { userId, userName, userRole, userOrgId } = useAuth();
  const isAdminRole = userRole === "owner" || userRole === "admin";
  // オブジェクトへのディープリンク（?element=）。着地したら消費して URL から取り除く
  // （残すとボードを切り替えたりリロードするたびに再フォーカスが暴発するため・FileBoxPageと同型）。
  const focusElementId = searchParams.get(ELEMENT_LINK_PARAM);
  // コメントへのディープリンク（?comment=&reply=・ENHA2-039）。同じく着地したら URL から消す。
  const focusCommentId = searchParams.get(COMMENT_LINK_PARAM);
  const focusReplyId = searchParams.get(REPLY_LINK_PARAM);

  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  // 権限なし画面の文言を出し分けるためだけに持つ（未アサインか、権限が無いだけか）。
  const [projectAccessInfo, setProjectAccessInfo] =
    useState<{ members: string[]; organizationId: string | null } | null>(null);
  const [boards, setBoards] = useState<Whiteboard[]>([]);
  const [perms, setPerms] = useState<Perms>({ whiteboard: "view", wiki: "view", backlog: "view", minutes: "view" });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // 初期値は useState 初期化関数で同期的に読む。useEffect で後から反映すると
  // リロード時にサイドバーが一瞬出て消える（チカチカ）ため。
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_LS_KEY) === "1"; } catch { return false; }
  });
  // プライベート解除の確認（公開する側だけ確認する。プライベート化は取り返しがつくので即実行）
  const [unprivateTarget, setUnprivateTarget] = useState<Whiteboard | null>(null);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
    const p = await resolveProject(projectSlug);
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProjectId(p.id);
    setProjectName(p.name);
    setProjectAccessInfo({ members: p.members ?? [], organizationId: p.organizationId });

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

  // リンク着地の結果。見つからなければ理由を伝え、いずれにせよ着地パラメータは URL から消す。
  const handleFocusResult = useCallback((found: boolean, kind: "element" | "comment" = "element") => {
    if (!found) {
      toast(kind === "comment"
        ? "リンク先のコメントが見つかりませんでした（削除された可能性があります）"
        : "リンク先のオブジェクトが見つかりませんでした（削除された可能性があります）", "info");
    }
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (kind === "comment") { next.delete(COMMENT_LINK_PARAM); next.delete(REPLY_LINK_PARAM); }
      else next.delete(ELEMENT_LINK_PARAM);
      return next;
    }, { replace: true });
  }, [toast, setSearchParams]);

  // ── プライベートモードの切替 ───────────────────────────────
  // 実際の可否は RLS（wb_update の with check）が決める。作成者以外が叩くと update が 0 行になる。
  const applyVisibility = useCallback(async (board: Whiteboard, makePrivate: boolean) => {
    // 1) 保存デバウンス(1.5s)の取りこぼしを吐き出す。この直後にチャンネル名が変わり、
    //    キャンバスが張り直って doc_state を読み直すため、待たせたままだとその分が消える。
    const control = getWbControl(board.id);
    await control?.flushSave();
    // 2) 今このボードを開いている他メンバーを退去させる。
    //    放置すると編集はできるのに保存だけ RLS に弾かれ、書いた内容が黙って消える。
    //    自分がそのボードを開いていれば張ってあるチャンネルから、開いていなければ単発で送る。
    if (makePrivate) {
      if (control) control.broadcastEvict();
      else await broadcastBoardEvicted(board.id, userId);
    }
    const next = await setBoardVisibility(board, makePrivate, userId);
    if (!next) {
      toast("切り替えできませんでした（ボードの作成者のみ変更できます）", "error");
      return;
    }
    setBoards((prev) => prev.map((b) => (b.id === next.id ? next : b)));
    toast(makePrivate
      ? "プライベートモードにしました。このボードはあなただけが見られます"
      : "プライベートモードを解除しました。プロジェクトのメンバーが見られます", "success");
  }, [userId, toast]);

  const handleTogglePrivate = useCallback((id: string) => {
    const board = boards.find((b) => b.id === id);
    if (!board) return;
    if (board.visibility === "private") setUnprivateTarget(board);  // 公開に戻すので確認する
    else void applyVisibility(board, true);
  }, [boards, applyVisibility]);

  // 開いている最中に、そのボードの作成者がプライベート化した（＝自分は締め出された）
  const handleEvicted = useCallback(() => {
    toast("このボードはプライベートモードに変更されました", "info");
    navigate(`/${projectSlug}/whiteboard`);
    void load();
  }, [toast, navigate, projectSlug, load]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteBoard(id);
    setBoards((prev) => prev.filter((b) => b.id !== id));
    if (boardId === id) navigate(`/${projectSlug}/whiteboard`);
  }, [boardId, projectSlug, navigate]);

  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  if (!loading && notFound) return <NotFoundView kind="project" />;
  // 権限が無いときの理由を出し分ける（アクセスできる範囲は従来どおり。文言だけを正確にする）。
  // 未アサインなら「権限が無い」ではなく「アサインされていない」と伝えたほうが次の行動につながる。
  if (!loading && perms.whiteboard === "none") {
    const access = checkProjectAccess(projectAccessInfo, { userRole, userName, userOrgId });
    if (access === "not-found") return <NotFoundView kind="project" />;   // 別組織は存在を明かさない
    return access === "no-access"
      ? <NotFoundView kind="no-access" projectLabel={projectName} />
      : <NotFoundView kind="no-permission" label="ホワイトボード" />;
  }
  // ボード単体が見つからない場合は、ボード一覧を残したまま右ペインに
  // 「ボードが見つかりませんでした」を出す既存の作りをそのまま使う（下の JSX）。

  const user = { id: userId, name: userName || "匿名", color: wbUserColor(userId || "anon") };
  const currentBoard = boardId ? boards.find((b) => b.id === boardId) ?? null : null;
  const currentIsPrivate = currentBoard?.visibility === "private";

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
          {!loading && currentIsPrivate && <PrivateBadge />}
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
            boards={boards} selectedId={boardId ?? null} canEdit={canEdit} loading={loading} userId={userId}
            onSelect={(id) => navigate(`/${projectSlug}/whiteboard/${id}`)}
            onCreate={handleCreate} onRename={handleRename} onDelete={handleDelete}
            onTogglePrivate={handleTogglePrivate}
            onCollapse={toggleCollapsed}
          />
        )}
        <div style={{ position: "relative", flex: 1, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", overflow: "hidden" }}>
          {!boardId ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", gap: 10 }}>
              <PenTool style={{ width: 34, height: 34, color: "#D8D3CC" }} />
              <span style={{ fontSize: 13 }}>ボードを選択または作成してください</span>
            </div>
          ) : loading || !currentBoard ? (
            // ボード行が揃うまでキャンバスをマウントしない。
            // プライベートボードは行に入っている private_key がチャンネル名の一部なので、
            // 先にマウントすると一瞬だけ公開チャンネル(wb:{id})へ繋がり、そこへ図形を配信してしまう。
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", fontSize: 13 }}>
              {loading ? "ホワイトボードを読み込み中…" : "ボードが見つかりませんでした"}
            </div>
          ) : (
            // ボード切替時は resetKeys で境界を自動リセットし、前ボードの例外を持ち越さない（BRU7-043）。
            <ErrorBoundary resetKeys={[boardId]}>
              <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#A09790", fontSize: 13 }}>ホワイトボードを読み込み中…</div>}>
                <WhiteboardCanvas
                  // プライベート切替でチャンネル名が変わるので、キーに含めて丸ごと張り直す
                  // （中途半端に生き残ったオーバーレイが古い api を掴むのを避ける）。
                  key={`${boardId}:${currentBoard.visibility}`}
                  boardId={boardId}
                  title={currentBoard.title}
                  user={user}
                  canEdit={canEdit}
                  projectSlug={projectSlug ?? ""}
                  projectId={projectId}
                  isPrivate={currentIsPrivate}
                  channelKey={currentBoard.privateKey || null}
                  onEvicted={handleEvicted}
                  focusElementId={focusElementId}
                  focusCommentId={focusCommentId}
                  focusReplyId={focusReplyId}
                  onFocusResult={handleFocusResult}
                />
              </Suspense>
            </ErrorBoundary>
          )}
          {/* たたんだ状態の展開ボタン。キャンバス左上（Excalidraw標準ハンバーガーはCSSで非表示・
              左プロパティ島は margin-top:52px）に浮かせる。Canvasルートは isolation:isolate なので
              zIndex:1 で十分に前面へ出るうえ、疑似全画面(zIndex:3000)時は自動的に隠れる。 */}
          {sidebarHidden && (
            <BoardListToggle collapsed onToggle={toggleCollapsed} variant="floating" />
          )}
        </div>
      </div>

      {unprivateTarget && (
        <ConfirmDialog
          title="プライベートモードの解除"
          message={`「${unprivateTarget.title}」をプロジェクトのメンバー全員が見られる状態に戻します。`}
          confirmLabel="解除する"
          confirmColor="#059669"
          hasWarningText={false}
          onConfirm={() => applyVisibility(unprivateTarget, false)}
          onClose={() => setUnprivateTarget(null)} />
      )}
    </div>
  );
}
