// ENHA2-053 WBS（作業分解表）。
//
// プロジェクトの計画と進み具合を、Excel のWBSと同じ形で管理する画面。
// 1プロジェクトに複数のWBSを作れ、URL の :wbsId で切り替える。
// ここでいう「WBS」は作業分解表のこと。チケット番号（SprintTicket.wbs）とは別物。
//
// ページ全体は縦にスクロールさせない。画面の残りの高さいっぱいを表とガントの領域にする。
//
// KAIZEN2611-004 バックアップの日付を選ぶと、表・ガント・集計がその時点のデータになる（編集はできない）。
// 「反映」でWBS全体をその時点に戻す。アーカイブしたWBSは、プルダウンの「アーカイブ済み」から戻せる。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { FolderKanban, ChevronRight, GanttChartSquare, Plus, Archive, History, LockKeyhole } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { copyText } from "@/lib/clipboard";
import { appOrigin } from "@/app/lib/appOrigin";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { AccessLevel, Project, Sprint, UserPermissions, WbsLevels, WbsSheet, WbsSnapshotContent, WbsSnapshotMeta } from "@/app/types";
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
  WBS_FOCUS_STATE_KEY, WBS_LEVEL_LABELS, createWbsSheet, deleteWbsSheet, loadWbsItemsBelowLevel, loadWbsPermission, loadWbsSheets, updateWbsSheet,
  archiveWbsSheet, loadWbsEditVersion, loadWbsSnapshotContent, loadWbsSnapshots, purgeWbsSheetFiles, restoreWbsSnapshot, unarchiveWbsSheet,
  wbsSnapshotLabel, type WbsRestoreConflict,
} from "@/app/lib/wbsService";
import { WbsArchivedView } from "@/app/components/wbs/WbsArchivedView";
import { WbsSheetBar } from "@/app/components/wbs/WbsSheetBar";
import { WbsSheetNameDialog } from "@/app/components/wbs/WbsSheetNameDialog";
import { WbsVisibilityDialog } from "@/app/components/wbs/WbsVisibilityDialog";
import { WbsManualDialog } from "@/app/components/wbs/WbsManualDialog";
import { WbsAiUpdateDialog } from "@/app/components/wbs/WbsAiUpdateDialog";
import { WbsWorkspace } from "@/app/components/wbs/WbsWorkspace";
import type { WbsTicketRef } from "@/app/components/wbs/WbsTicketLinkDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { WBS_COLORS, wbsToolBtn, wbsToolBtnDisabled } from "@/app/components/wbs/wbsStyles";

/** 段数を減らせなかったときに出すダイアログの中身 */
interface LevelBlock { message: string; itemIds: string[] }

/** KAIZEN2611-004 過去の時点を表示しているときの状態 */
interface SnapshotView {
  meta: WbsSnapshotMeta;
  content: WbsSnapshotContent;
  /** 表示を始めたときの版の番号。「反映」を押したときに、DB が今の版の番号と比べる */
  baseVersion: number;
}

/** ロック中に「反映」へ出す説明 */
const LOCKED_RESTORE_HINT = "このWBSはロックされているため反映できません。反映する場合は「今の状態に戻る」を押してから、ロックを解除してください";

/** 反映を止めたときに出す編集の時刻。今日なら「14:03」、それ以外は「11/17 14:03」 */
function editedAtText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function WbsPage() {
  const { projectSlug, wbsId } = useParams<{ projectSlug: string; wbsId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { userId, userName, userRole, userOrgId } = useAuth();
  // マスタースケジュールの行を押して来たときの、強調する行（大項目）
  const focusItemId = ((location.state as Record<string, unknown> | null)?.[WBS_FOCUS_STATE_KEY] as string | undefined) ?? null;
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [sheets, setSheets] = useState<WbsSheet[]>([]);
  const [perm, setPerm] = useState<AccessLevel>("none");
  // チケットの紐づけ用。スプリントをまたいで、そのプロジェクトのチケットを全部持つ
  const [sprints, setSprints] = useState<Sprint[]>([]);
  // チケット詳細パネルへ渡す、このプロジェクトでの権限（チケットの編集可否の判定に使われる）
  const [projectPermissions, setProjectPermissions] = useState<UserPermissions | null>(null);
  // 詳細パネルで開いているチケット。URL は変えない（スプリント画面へは遷移しない）
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  // 一度でもデータを読んだら、以後は再読み込みでスピナーに差し替えない（画面のちらつき防止）
  const initializedRef = useRef(false);

  const [nameDialog, setNameDialog] = useState<"create" | "rename" | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // BRU22-008 ロック解除の確認
  const [unlockOpen, setUnlockOpen] = useState(false);
  // BUG-05 ロックの付け外しは await を含むので ref で二重起動を止める
  const lockingRef = useRef(false);
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  // KAIZEN2611-013 「AIで更新」の手順書
  const [aiUpdateOpen, setAiUpdateOpen] = useState(false);
  const [levelBlock, setLevelBlock] = useState<LevelBlock | null>(null);
  // 段数を減らせない理由になっている行。消すか「強調を消す」を押すまで残す
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const levelChangingRef = useRef(false);

  // ── KAIZEN2611-004 バックアップ・反映・アーカイブ ──
  const [snapshots, setSnapshots] = useState<WbsSnapshotMeta[]>([]);
  const [viewing, setViewing] = useState<SnapshotView | null>(null);
  // 中身を読み込み中のバックアップ。読み込みの途中で別の日付を選んだら、前の結果は捨てる
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null);
  const viewSeqRef = useRef(0);
  const [restoreOpen, setRestoreOpen] = useState(false);
  // ほかの人の編集で反映を止めたときの、編集した人と時刻
  const [conflict, setConflict] = useState<WbsRestoreConflict | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [unarchivingId, setUnarchivingId] = useState<string | null>(null);
  // BUG-05 反映・アーカイブ・アーカイブから戻すは await を含むので ref で二重起動を止める
  const busyRef = useRef(false);
  // 反映したあと・今の状態に戻ったあと、今のデータを読み直すために作業領域を作り直す
  const [liveKey, setLiveKey] = useState(0);

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

    const [level, list, { data: s }, { data: pmp }] = await Promise.all([
      loadWbsPermission(p.id, userId, isAdminRole),
      loadWbsSheets(p.id),
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", p.id)
        .order("start_date")
        .order("id")
        .order("created_at", { referencedTable: "sprint_tickets" })
        .order("id", { referencedTable: "sprint_tickets" }),
      userId
        ? supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setPerm(level);
    setSheets(list);
    setSprints((s ?? []).map(mapSprint));
    if (pmp?.permissions) setProjectPermissions(pmp.permissions as UserPermissions);
    initializedRef.current = true;
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]);

  useEffect(() => {
    load().catch(() => { setNotFound(true); setLoading(false); });
  }, [load]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  const current = sheets.find(s => s.id === wbsId) ?? null;
  // アーカイブしたWBSは切り替えの候補に出さず、「アーカイブ済み」の一覧にまとめる
  const activeSheets = useMemo(() => sheets.filter(s => !s.archivedAt), [sheets]);
  const archivedSheets = useMemo(() => sheets.filter(s => !!s.archivedAt), [sheets]);
  const currentArchived = !!current?.archivedAt;
  // 公開設定の変更と削除ができるのは、作成者とオーナー
  const canManage = canEdit && !!current && (userRole === "owner" || (!!userId && current.createdBy === userId));

  // /:projectSlug/wbs で来たとき、または :wbsId が見られないWBSのときは、見られる先頭へ寄せる。
  // アーカイブ済みのWBSの id で来たときは、そのまま「アーカイブ済み」の一覧を出す
  useEffect(() => {
    if (loading || !projectSlug) return;
    if (wbsId && sheets.some(s => s.id === wbsId)) return;
    if (activeSheets.length > 0) navigate(`/${projectSlug}/wbs/${activeSheets[0].id}`, { replace: true });
    else if (wbsId) navigate(`/${projectSlug}/wbs`, { replace: true });
  }, [loading, projectSlug, wbsId, sheets, activeSheets, navigate]);

  // ── チケット ────────────────────────────────────────────────
  const tickets = useMemo<WbsTicketRef[]>(
    () => sprints.flatMap(sp => sp.tickets.map(ticket => ({ ticket, sprintId: sp.id, sprintName: sp.name }))),
    [sprints],
  );
  const openTicket = useMemo(() => {
    if (!openTicketId) return null;
    for (const sp of sprints) {
      const ticket = sp.tickets.find(t => t.id === openTicketId);
      if (ticket) return { ticket, sprint: sp };
    }
    return null;
  }, [openTicketId, sprints]);
  const handleOpenTicket = useCallback((id: string) => setOpenTicketId(id), []);

  // WBSを切り替えたら、前のWBSの強調は持ち越さない
  useEffect(() => { setHighlightIds([]); }, [wbsId]);

  // ── バックアップ（KAIZEN2611-004） ──────────────────────────
  const backupOn = !!current && current.backupEnabled && !currentArchived;
  const currentId = current?.id ?? null;

  // 一覧を読んでいる間にWBSを切り替えたら、前のWBSの一覧で上書きしない
  const snapshotSheetRef = useRef<string | null>(null);
  snapshotSheetRef.current = backupOn ? currentId : null;
  const reloadSnapshots = useCallback(async () => {
    if (!backupOn || !currentId) { setSnapshots([]); return; }
    const list = await loadWbsSnapshots(currentId);
    if (snapshotSheetRef.current === currentId) setSnapshots(list);
  }, [backupOn, currentId]);

  useEffect(() => {
    // WBSを切り替えたら、前のWBSの一覧は持ち越さない
    setSnapshots([]);
    reloadSnapshots().catch(() => { });
  }, [reloadSnapshots]);

  // WBSを切り替えたら、表示中の時点も持ち越さない
  useEffect(() => {
    viewSeqRef.current += 1;
    setViewing(null);
    setViewLoadingId(null);
    setRestoreOpen(false);
    setConflict(null);
  }, [wbsId]);

  /** 日付を選んだ。その時点の中身と、いまの版の番号を読んで、読み取り専用で表示する */
  const handleSelectSnapshot = async (id: string) => {
    if (!current) return;
    if (!id) { backToLive(); return; }
    const meta = snapshots.find(s => s.id === id);
    if (!meta) return;
    const seq = ++viewSeqRef.current;
    setViewLoadingId(id);
    const [version, r] = await Promise.all([loadWbsEditVersion(current.id), loadWbsSnapshotContent(meta)]);
    if (seq !== viewSeqRef.current) return;
    setViewLoadingId(null);
    if (!r.ok) { toast(`バックアップを表示できませんでした（${r.error}）`, "error"); return; }
    if (version === null) { toast("バックアップを表示できませんでした（WBSの状態を読めませんでした）", "error"); return; }
    setViewing({ meta, content: r.content, baseVersion: version });
  };

  /** 今の状態に戻る（反映はしない） */
  function backToLive() {
    viewSeqRef.current += 1;
    setViewLoadingId(null);
    setViewing(null);
    setConflict(null);
    // 表示していた間のほかの人の編集も見えるよう、今のデータを読み直す
    setLiveKey(k => k + 1);
  }

  /** 反映（その時点に戻す）。版の番号が変わっていたら DB が止め、編集した人と時刻を返す */
  const handleRestore = async () => {
    if (!viewing || !current || busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await restoreWbsSnapshot(viewing.meta.id, viewing.baseVersion);
      if (r.ok) {
        toast(`${wbsSnapshotLabel(viewing.meta)} 時点の状態に戻しました`);
        setViewing(null);
        setLiveKey(k => k + 1);
        reloadSnapshots().catch(() => { });
        return;
      }
      if (r.conflict) { setConflict(r.conflict); return; }
      toast(`反映できませんでした（${r.error}）`, "error");
      // 直前にロックされた・権限が変わった などに合わせて読み直す
      load().catch(() => { });
    } finally {
      busyRef.current = false;
    }
  };

  /** WBSをアーカイブする。中身とバックアップを Storage へ移し、一覧から外す */
  const handleArchive = async () => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    try {
      const r = await archiveWbsSheet(current.id);
      if (!r.ok) { toast(`アーカイブできませんでした（${r.error}）`, "error"); return; }
      const rest = activeSheets.filter(s => s.id !== current.id);
      navigate(rest.length ? `/${projectSlug}/wbs/${rest[0].id}` : `/${projectSlug}/wbs`, { replace: true });
      toast(`「${current.name}」をアーカイブしました`);
      await load();
    } finally {
      busyRef.current = false;
    }
  };

  /** アーカイブから戻す。戻したWBSを開く */
  const handleUnarchive = async (sheet: WbsSheet) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setUnarchivingId(sheet.id);
    try {
      const r = await unarchiveWbsSheet(sheet.id);
      if (!r.ok) { toast(`アーカイブから戻せませんでした（${r.error}）`, "error"); return; }
      await load();
      navigate(`/${projectSlug}/wbs/${sheet.id}`, { replace: true });
      toast(`「${sheet.name}」をアーカイブから戻しました`);
    } finally {
      busyRef.current = false;
      setUnarchivingId(null);
    }
  };

  const openArchived = () => {
    if (projectSlug && archivedSheets.length) navigate(`/${projectSlug}/wbs/${archivedSheets[0].id}`);
  };

  // ── WBS本体の操作 ───────────────────────────────────────────
  const selectSheet = (id: string) => { if (projectSlug && id) navigate(`/${projectSlug}/wbs/${id}`); };

  /** いま開いているWBSのURL（/{プロジェクト}/wbs/{WBSのID} の完全なURL）をコピーする */
  const handleCopyUrl = async () => {
    if (!projectSlug || !current) return;
    // 共有できる形で出す。ネイティブの capacitor:// は appOrigin() が弾く（NotFoundView と同じ）
    if (await copyText(`${appOrigin()}/${projectSlug}/wbs/${current.id}`)) toast("URLをコピーしました");
    else toast("URLのコピーに失敗しました", "error");
  };

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
    // ロック中は削除させない（ボタンも押せないが、念のためここでも止める。DB も拒否する）
    if (current.isLocked) { toast("このWBSはロックされているため削除できません。削除する場合はロックを解除してください", "error"); return; }
    const ok = await deleteWbsSheet(current.id);
    if (ok === "locked") {
      // 別の人が直前にロックした。画面の状態を読み直して合わせる
      toast("このWBSはロックされているため削除できません。削除する場合はロックを解除してください", "error");
      load().catch(() => { });
      return;
    }
    if (!ok) { toast("WBSを削除できませんでした", "error"); return; }
    setSheets(prev => prev.filter(s => s.id !== current.id));
    const rest = activeSheets.filter(s => s.id !== current.id);
    navigate(rest.length ? `/${projectSlug}/wbs/${rest[0].id}` : `/${projectSlug}/wbs`, { replace: true });
    toast(`「${current.name}」を削除しました`);
    // KAIZEN2611-004 DB のバックアップは一緒に消えている。Storage へ移したバックアップのファイルもここで消す
    if (current.backupEnabled && project) void purgeWbsSheetFiles(project.id, current.id);
  };

  /** BRU22-008 ロックする／解除する。ロックの状態はDBに持つので、再読み込みや別の人が開いても残る */
  const handleSetLock = async (isLocked: boolean) => {
    if (!current || lockingRef.current) return;
    lockingRef.current = true;
    try {
      const ok = await updateWbsSheet(current.id, { isLocked });
      if (!ok) { toast(isLocked ? "ロックできませんでした" : "ロックを解除できませんでした", "error"); return; }
      setSheets(prev => prev.map(s => (s.id === current.id ? { ...s, isLocked } : s)));
      toast(isLocked
        ? `「${current.name}」をロックしました。ロックを解除するまで削除できません`
        : `「${current.name}」のロックを解除しました`);
    } finally {
      lockingRef.current = false;
    }
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
            {project ? `${project.name} · 作業分解表 ${activeSheets.length} 件` : "..."}
          </p>
        </div>
        <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="wbs" marginBottom={0} />
      </div>

      {activeSheets.length === 0 && !currentArchived ? (
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
          {/* WBSが1つも無いときは上の操作列が出ないので、マニュアルはここから開けるようにする */}
          <button type="button" onClick={() => setManualOpen(true)} style={wbsToolBtn}>マニュアルを見る</button>
          {archivedSheets.length > 0 && (
            <button type="button" onClick={openArchived} style={wbsToolBtn}>
              <Archive style={{ width: 12, height: 12 }} />アーカイブ済み（{archivedSheets.length}件）を見る
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ flexShrink: 0 }}>
            <WbsSheetBar
              sheets={activeSheets} current={currentArchived ? null : current}
              // 過去の時点を表示している間は、WBSの変更の操作（名前変更・段数・ロック・削除など）も使えなくする
              canEdit={canEdit && !viewing} canManage={canManage && !viewing}
              archivedCount={archivedSheets.length} archivedSelected={currentArchived} onOpenArchived={openArchived}
              onArchive={current?.backupEnabled ? () => setArchiveOpen(true) : undefined}
              snapshots={snapshots} snapshotId={viewing?.meta.id ?? ""} snapshotLoadingId={viewLoadingId}
              onSelectSnapshot={backupOn ? (id => { void handleSelectSnapshot(id); }) : undefined}
              // KAIZEN2611-013 API の更新は版の番号（バックアップの仕組み）を使うので、その仕組みがある環境だけで出す
              onOpenAiUpdate={backupOn ? () => setAiUpdateOpen(true) : undefined}
              onSelect={selectSheet}
              onCreate={() => setNameDialog("create")}
              onRename={() => setNameDialog("rename")}
              onDelete={() => { if (!current?.isLocked) setDeleteOpen(true); }}
              onLock={() => { void handleSetLock(true); }}
              onUnlock={() => setUnlockOpen(true)}
              onChangeLevels={handleChangeLevels}
              onOpenVisibility={() => setVisibilityOpen(true)}
              onOpenManual={() => setManualOpen(true)}
              onCopyUrl={handleCopyUrl}
              onOpenMaster={() => { if (current) navigate(`/${projectSlug}/wbs/${current.id}/master`); }}
            />
          </div>

          {currentArchived && (
            <WbsArchivedView sheets={archivedSheets} selectedId={current?.id ?? null} canEdit={canEdit}
              busyId={unarchivingId} onUnarchive={s => { void handleUnarchive(s); }} />
          )}

          {/* KAIZEN2611-004 過去の時点を表示している間の帯 */}
          {viewing && current && !currentArchived && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "7px 12px", background: "#EFF6FF", border: "1px solid #BFDBFE", borderRadius: 8, flexWrap: "wrap" }}>
              <History style={{ width: 14, height: 14, color: "#1D4ED8", flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "#1E3A8A" }}>
                📅 {wbsSnapshotLabel(viewing.meta)} 時点を表示中（編集できません）
              </span>
              <div style={{ flex: 1 }} />
              {canEdit && (current.isLocked ? (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#B45309" }}>
                    <LockKeyhole style={{ width: 11, height: 11 }} />{LOCKED_RESTORE_HINT}
                  </span>
                  {/* 押せないボタンにはマウスを乗せても説明が出ないブラウザがあるので、外側の span に持たせる */}
                  <span title={LOCKED_RESTORE_HINT} style={{ display: "inline-flex", flexShrink: 0 }}>
                    <button type="button" disabled aria-label={`反映（${LOCKED_RESTORE_HINT}）`} style={{ ...wbsToolBtnDisabled, pointerEvents: "none" }}>反映</button>
                  </span>
                </>
              ) : (
                <button type="button" onClick={() => setRestoreOpen(true)}
                  title="WBS全体を、この時点の状態に戻します（今の状態は「反映前に保存」としてバックアップに残ります）"
                  style={{ ...wbsToolBtn, color: "#FFFFFF", background: "#059669", border: "1px solid #059669" }}>
                  反映
                </button>
              ))}
              <button type="button" onClick={backToLive} title="反映せずに、いつもの編集できる画面に戻ります" style={wbsToolBtn}>今の状態に戻る</button>
            </div>
          )}

          {!currentArchived && highlightIds.length > 0 && (
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, marginBottom: 8, padding: "6px 10px", background: WBS_COLORS.delayBg, borderRadius: 8, fontSize: 12, color: WBS_COLORS.delayText }}>
              <span>段数を減らせない理由になっている行（{highlightIds.length}行）を赤く表示しています。</span>
              <button type="button" onClick={() => setHighlightIds([])} style={{ ...wbsToolBtn, height: 24 }}>強調を消す</button>
            </div>
          )}

          {/* 表とガントの領域。画面の残りの高さいっぱいを使う */}
          {!currentArchived && (
          <div style={{ flex: 1, minHeight: 0, background: "#FFFFFF", border: `1px solid ${viewing ? "#BFDBFE" : WBS_COLORS.border}`, borderRadius: 12, overflow: "hidden" }}>
            {current && project && (
              // 表示する時点を切り替えたら作り直す（今のデータと、その時点のデータを混ぜない）
              <WbsWorkspace key={`${current.id}:${viewing?.meta.id ?? "live"}:${liveKey}`} sheet={current} project={project}
                canEdit={canEdit && !viewing} snapshot={viewing?.content ?? null}
                tickets={tickets} onOpenTicket={handleOpenTicket}
                highlightIds={highlightIds} onHighlightChange={setHighlightIds}
                focusItemId={focusItemId}
                // KAIZEN2611-013 画面に戻ったときに API などでの更新を読み直したら、バックアップの一覧も読み直す
                onExternalChange={() => { reloadSnapshots().catch(() => { }); }}
                // 強調したら履歴から外す（ブラウザの再読み込みで、もう一度強調し直さないように）
                onFocusDone={() => navigate(`${location.pathname}${location.search}`, { replace: true, state: null })} />
            )}
          </div>
          )}
        </>
      )}

      {/* 紐づけたチケットの詳細。WBS画面のまま右から開く（使い方は一覧検索の画面と同じ）。
          URL を変えないので、閉じれば表のスクロール位置もそのまま残る */}
      <TicketDetailPanel
        ticket={openTicket?.ticket ?? null}
        projectId={project?.id}
        sprintId={openTicket?.sprint.id}
        sprintSlug={openTicket?.sprint.identifier || undefined}
        projectSlug={projectSlug}
        projectPermissions={projectPermissions ?? undefined}
        onClose={() => setOpenTicketId(null)}
        onUpdated={load}
        onDeleted={() => { setOpenTicketId(null); load().catch(() => { }); }}
        // 子チケット・親チケットへの移動も、このパネルの中で切り替える
        onSelectTicket={t => { if (t.id) setOpenTicketId(t.id); }}
      />

      {nameDialog && (
        <WbsSheetNameDialog
          mode={nameDialog}
          initialName={nameDialog === "rename" ? current?.name ?? "" : ""}
          // 名前変更のときは、変更するWBS自身の名前は重複に数えない（同じ名前のまま保存できるように）
          existingNames={sheets.filter(s => nameDialog === "create" || s.id !== current?.id).map(s => s.name)}
          onSubmit={nameDialog === "create" ? handleCreate : handleRename}
          onClose={() => setNameDialog(null)}
        />
      )}

      {unlockOpen && current && (
        <ConfirmDialog
          title="ロックの解除"
          message={`「${current.name}」のロックを解除しますか？\n解除すると、このWBSを削除できるようになります。`}
          confirmLabel="ロックを解除する"
          confirmColor="#D97706"
          hasWarningText={false}
          onConfirm={() => handleSetLock(false)}
          onClose={() => setUnlockOpen(false)}
        />
      )}

      {deleteOpen && current && !current.isLocked && (
        <ConfirmDialog
          title="WBSの削除"
          message={`「${current.name}」を削除しますか？\nこのWBSの行・ステータス・チケットの紐づけもすべて削除されます（チケット自体は消えません）。`}
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}

      {restoreOpen && viewing && current && (
        <ConfirmDialog
          title="この時点に戻す（反映）"
          message={`「${current.name}」を、${wbsSnapshotLabel(viewing.meta)} 時点の状態に戻しますか？\n行・並び順・ステータスの種類と色・チケットの紐づけ・このWBSだけの休日が、その時点の状態になります。\n今の状態は「反映前に保存」としてバックアップに残るので、それを選んで反映すれば元に戻せます。`}
          confirmLabel="反映する"
          confirmColor="#059669"
          hasWarningText={false}
          onConfirm={handleRestore}
          onClose={() => setRestoreOpen(false)}
        />
      )}

      {conflict && viewing && (
        <DialogShell title="反映を止めました" size="sm" minHeight={0} onClose={() => setConflict(null)}
          footer={<>
            <BtnSecondary onClick={() => setConflict(null)}>やめる</BtnSecondary>
            <BtnPrimary onClick={backToLive}>今の状態を見る</BtnPrimary>
          </>}>
          <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>
            {conflict.editedByName
              ? `表示を始めたあとに、${conflict.editedByName}さんが ${editedAtText(conflict.editedAt)} にこの WBS を編集しました。`
              : `表示を始めたあとに、${editedAtText(conflict.editedAt)} にこの WBS が編集されました。`}
          </p>
          <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.7 }}>今の状態を確かめてから、もう一度反映してください。</p>
        </DialogShell>
      )}

      {archiveOpen && current && !currentArchived && (
        <ConfirmDialog
          title="WBSのアーカイブ"
          message={`「${current.name}」をアーカイブしますか？\nこのWBSの行・ステータス・チケットの紐づけ・バックアップを圧縮して保管し、WBSの一覧から外します。\nWBSを切り替えるプルダウンの「アーカイブ済み」から、いつでも元に戻せます。`}
          confirmLabel="アーカイブする"
          confirmColor="#4B5563"
          hasWarningText={false}
          onConfirm={handleArchive}
          onClose={() => setArchiveOpen(false)}
        />
      )}

      {manualOpen && <WbsManualDialog canEdit={canEdit} onClose={() => setManualOpen(false)} />}

      {aiUpdateOpen && current && project && (
        <WbsAiUpdateDialog sheet={current} projectId={project.id} projectName={project.name} onClose={() => setAiUpdateOpen(false)} />
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
