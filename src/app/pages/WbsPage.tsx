// ENHA2-053 WBS（作業分解表）。
//
// プロジェクトの計画と進み具合を、Excel のWBSと同じ形で管理する画面。
// 1プロジェクトに複数のWBSを作れ、URL の :wbsId で切り替える。
// ここでいう「WBS」は作業分解表のこと。チケット番号（SprintTicket.wbs）とは別物。
//
// ページ全体は縦にスクロールさせない。画面の残りの高さいっぱいを表とガントの領域にする。
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { FolderKanban, ChevronRight, GanttChartSquare, Plus } from "lucide-react";
import { isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject } from "@/app/lib/mappers";
import type { AccessLevel, Project, WbsLevels, WbsSheet } from "@/app/types";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { NotFoundView, projectAccessView } from "@/app/components/shared/NotFoundView";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import {
  WBS_LEVEL_LABELS, createWbsSheet, deleteWbsSheet, loadWbsItemsBelowLevel, loadWbsPermission, loadWbsSheets, updateWbsSheet,
} from "@/app/lib/wbsService";
import { WbsSheetBar } from "@/app/components/wbs/WbsSheetBar";
import { WbsSheetNameDialog } from "@/app/components/wbs/WbsSheetNameDialog";
import { WbsVisibilityDialog } from "@/app/components/wbs/WbsVisibilityDialog";
import { WbsWorkspace } from "@/app/components/wbs/WbsWorkspace";
import { WBS_COLORS, wbsToolBtn } from "@/app/components/wbs/wbsStyles";

/** 段数を減らせなかったときに出すダイアログの中身 */
interface LevelBlock { message: string; itemIds: string[] }

export function WbsPage() {
  const { projectSlug, wbsId } = useParams<{ projectSlug: string; wbsId?: string }>();
  const navigate = useNavigate();
  const { userId, userName, userRole, userOrgId } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [sheets, setSheets] = useState<WbsSheet[]>([]);
  const [perm, setPerm] = useState<AccessLevel>("none");
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  // 一度でもデータを読んだら、以後は再読み込みでスピナーに差し替えない（画面のちらつき防止）
  const initializedRef = useRef(false);

  const [nameDialog, setNameDialog] = useState<"create" | "rename" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [levelBlock, setLevelBlock] = useState<LevelBlock | null>(null);
  // 段数を減らせない理由になっている行。消すか「強調を消す」を押すまで残す
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const levelChangingRef = useRef(false);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = perm === "edit";

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
    const found = await findProjectBySlug(projectSlug);
    if (!found) { setNotFound(true); setLoading(false); return; }
    const p = found.row;
    setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
    setProject(mapProject(p));

    const [level, list] = await Promise.all([
      loadWbsPermission(p.id, userId, isAdminRole),
      loadWbsSheets(p.id),
    ]);
    setPerm(level);
    setSheets(list);
    initializedRef.current = true;
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]);

  useEffect(() => {
    load().catch(() => { setNotFound(true); setLoading(false); });
  }, [load]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  const current = sheets.find(s => s.id === wbsId) ?? null;
  // 公開設定の変更と削除ができるのは、作成者とオーナー
  const canManage = canEdit && !!current && (userRole === "owner" || (!!userId && current.createdBy === userId));

  // /:projectSlug/wbs で来たとき、または :wbsId が見られないWBSのときは、見られる先頭へ寄せる
  useEffect(() => {
    if (loading || !projectSlug) return;
    if (sheets.length === 0) {
      if (wbsId) navigate(`/${projectSlug}/wbs`, { replace: true });
      return;
    }
    if (!wbsId || !sheets.some(s => s.id === wbsId)) {
      navigate(`/${projectSlug}/wbs/${sheets[0].id}`, { replace: true });
    }
  }, [loading, projectSlug, wbsId, sheets, navigate]);

  // WBSを切り替えたら、前のWBSの強調は持ち越さない
  useEffect(() => { setHighlightIds([]); }, [wbsId]);

  // ── WBS本体の操作 ───────────────────────────────────────────
  const selectSheet = (id: string) => { if (projectSlug && id) navigate(`/${projectSlug}/wbs/${id}`); };

  const handleCreate = async (name: string): Promise<boolean> => {
    if (!project) return false;
    const maxSortOrder = sheets.length ? Math.max(...sheets.map(s => s.sortOrder)) : null;
    const created = await createWbsSheet({ projectId: project.id, name, userId, userName, maxSortOrder });
    if (!created) { toast("WBSを作成できませんでした", "error"); return false; }
    setSheets(prev => [...prev, created]);
    navigate(`/${projectSlug}/wbs/${created.id}`);
    toast(`「${created.name}」を作成しました`);
    return true;
  };

  const handleRename = async (name: string): Promise<boolean> => {
    if (!current) return false;
    if (name === current.name) return true;
    const ok = await updateWbsSheet(current.id, { name });
    if (!ok) { toast("名前を変更できませんでした", "error"); return false; }
    setSheets(prev => prev.map(s => (s.id === current.id ? { ...s, name } : s)));
    return true;
  };

  const handleDelete = async () => {
    if (!current) return;
    const ok = await deleteWbsSheet(current.id);
    if (!ok) { toast("WBSを削除できませんでした", "error"); return; }
    const rest = sheets.filter(s => s.id !== current.id);
    setSheets(rest);
    navigate(rest.length ? `/${projectSlug}/wbs/${rest[0].id}` : `/${projectSlug}/wbs`, { replace: true });
    toast(`「${current.name}」を削除しました`);
  };

  const handleChangeLevels = async (levels: WbsLevels) => {
    if (!current || levels === current.levels || levelChangingRef.current) return;
    levelChangingRef.current = true;
    try {
      if (levels < current.levels) {
        // 減らす段に行が1つでもあれば減らせない。理由と件数を伝える
        const below = await loadWbsItemsBelowLevel(current.id, levels);
        if (below.length > 0) {
          const parts = [2, 3]
            .map(lv => ({ lv, count: below.filter(b => b.level === lv).length }))
            .filter(x => x.count > 0)
            .map(x => `${WBS_LEVEL_LABELS[x.lv - 1]}に${x.count}行`);
          setLevelBlock({ message: `${parts.join("、")}あるため、段数を減らせません。`, itemIds: below.map(b => b.id) });
          return;
        }
      }
      const ok = await updateWbsSheet(current.id, { levels });
      if (!ok) { toast("段数を変更できませんでした", "error"); return; }
      setSheets(prev => prev.map(s => (s.id === current.id ? { ...s, levels } : s)));
    } finally {
      levelChangingRef.current = false;
    }
  };

  // ── ガード ─────────────────────────────────────────────────
  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;
  if (loading && !initializedRef.current) return <PageLoader label="WBSを読み込み中..." />;
  if (!loading && perm === "none") return <NotFoundView kind="no-permission" label="WBS" />;

  return (
    <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "24px 24px 16px", minWidth: 1280, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12, flexShrink: 0 }}>
        <button onClick={() => navigate("/projects")}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <button onClick={() => navigate(`/${projectSlug}`)}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
          {project?.name ?? projectSlug ?? ""}
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>WBS</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14, flexShrink: 0 }}>
        {/* タブ(ProjectSubNav)は固定幅。幅が足りない時はこの見出し側が先に縮む */}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 8 }}>
            WBS
            {!canEdit && <span style={{ fontSize: 10, fontWeight: 700, color: "#6B6458", background: "#EFEDE9", borderRadius: 6, padding: "2px 7px" }}>閲覧のみ</span>}
          </h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {project ? `${project.name} · 作業分解表 ${sheets.length} 件` : "..."}
          </p>
        </div>
        <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="wbs" marginBottom={0} />
      </div>

      {sheets.length === 0 ? (
        // 1つも無いときは作成を促す
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 12 }}>
          <GanttChartSquare style={{ width: 36, height: 36, color: "#C9C4BB" }} />
          <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714" }}>WBSがまだありません</p>
          <p style={{ fontSize: 12, color: "#A09790" }}>
            {canEdit ? "最初のWBSを作成して、計画と進み具合の管理を始めましょう。" : "編集できる人がWBSを作成すると、ここに表示されます。"}
          </p>
          {canEdit && (
            <button type="button" onClick={() => setNameDialog("create")}
              style={{ ...wbsToolBtn, height: 36, padding: "0 16px", fontSize: 13, color: "#FFFFFF", background: "#059669", border: "1px solid #059669" }}>
              <Plus style={{ width: 14, height: 14 }} />WBSを作成
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ flexShrink: 0 }}>
            <WbsSheetBar
              sheets={sheets} current={current} canEdit={canEdit} canManage={canManage}
              onSelect={selectSheet}
              onCreate={() => setNameDialog("create")}
              onRename={() => setNameDialog("rename")}
              onDelete={() => setDeleteOpen(true)}
              onChangeLevels={handleChangeLevels}
              onOpenVisibility={() => setVisibilityOpen(true)}
            />
          </div>

          {highlightIds.length > 0 && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "6px 10px", background: WBS_COLORS.delayBg, borderRadius: 8, fontSize: 12, color: WBS_COLORS.delayText }}>
              <span>段数を減らせない理由になっている行（{highlightIds.length}行）を赤く表示しています。</span>
              <button type="button" onClick={() => setHighlightIds([])} style={{ ...wbsToolBtn, height: 24 }}>強調を消す</button>
            </div>
          )}

          {/* 表とガントの領域。画面の残りの高さいっぱいを使う */}
          <div style={{ flex: 1, minHeight: 0, background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            {current && project && (
              <WbsWorkspace key={current.id} sheet={current} project={project} canEdit={canEdit}
                highlightIds={highlightIds} onHighlightChange={setHighlightIds} />
            )}
          </div>
        </>
      )}

      {nameDialog && (
        <WbsSheetNameDialog
          mode={nameDialog}
          initialName={nameDialog === "rename" ? current?.name ?? "" : ""}
          onSubmit={nameDialog === "create" ? handleCreate : handleRename}
          onClose={() => setNameDialog(null)}
        />
      )}

      {deleteOpen && current && (
        <ConfirmDialog
          title="WBSの削除"
          message={`「${current.name}」を削除しますか？\nこのWBSの行・ステータス・チケットの紐づけもすべて削除されます（チケット自体は消えません）。`}
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {visibilityOpen && current && (
        <WbsVisibilityDialog sheet={current} orgId={userOrgId} onSaved={load} onClose={() => setVisibilityOpen(false)} />
      )}

      {levelBlock && (
        <DialogShell title="段数を減らせません" size="sm" minHeight={0} onClose={() => setLevelBlock(null)}
          footer={<>
            <BtnSecondary onClick={() => setLevelBlock(null)}>閉じる</BtnSecondary>
            <BtnPrimary onClick={() => { setHighlightIds(levelBlock.itemIds); setLevelBlock(null); }}>対象の行を確認する</BtnPrimary>
          </>}>
          <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>{levelBlock.message}</p>
          <p style={{ fontSize: 12, color: "#A09790", lineHeight: 1.7 }}>対象の行を削除するか、上の段へ作り直してから、もう一度お試しください。</p>
        </DialogShell>
      )}
    </div>
  );
}
