import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { FolderKanban, ChevronRight, Plus, GitBranch, ClipboardList, Trash2, Ticket, Search, X, FolderPlus, FolderOpen, Link2 } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject, mapBacklogItem, mapTicketCategory, mapSprintTicket } from "@/app/lib/mappers";
import { getDefaultProgressForStatus } from "@/app/lib/helpers";
import type { Project, BacklogItem, BacklogStatus, Priority, Sprint, TicketCategory, AccessLevel, UserPermissions, SprintTicket } from "@/app/types";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { NotFoundView, projectAccessView } from "@/app/components/shared/NotFoundView";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";
import { NewSprintDialog } from "@/app/components/sprints/NewSprintDialog";
import { useLinkSuggestions } from "@/app/hooks/useLinkSuggestions";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import { DocTree, FolderMoveModal, buildDocTree, isCyclicMove, type DocTreeNode } from "@/app/components/shared/DocTree";
import { useCopyShareLink } from "@/app/hooks/useCopyShareLink";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";

const PRIORITY_META: Record<Priority, { label: string; color: string; bg: string }> = {
  high: { label: "高", color: "#DC2626", bg: "#FEF2F2" },
  medium: { label: "中", color: "#D97706", bg: "#FFF7ED" },
  low: { label: "低", color: "#0284C7", bg: "#F0F9FF" },
};

const STATUS_META: Record<BacklogStatus, { label: string; color: string; bg: string }> = {
  open: { label: "未対応", color: "#6B7280", bg: "#F3F4F6" },
  "in-progress": { label: "対応中", color: "#D97706", bg: "#FFF7ED" },
  converted: { label: "チケット化済", color: "#059669", bg: "#ECFDF5" },
  archived: { label: "アーカイブ", color: "#9CA3AF", bg: "#F4F5F6" },
};

async function nextBacklogId(projectId: string): Promise<string> {
  const { data } = await supabase!
    .from("backlog_items").select("id")
    .eq("project_id", projectId)
    .like("id", "B-%")
    .order("id", { ascending: false }).limit(1).maybeSingle();
  const next = (parseInt(data?.id?.slice(2) ?? "0", 10) || 0) + 1;
  return `B-${String(next).padStart(3, "0")}`;
}

// フォルダ行のIDは "BF-001" 形式。項目の採番(like 'B-%')とは前方一致しないので衝突しない。
async function nextBacklogFolderId(projectId: string): Promise<string> {
  const { data } = await supabase!
    .from("backlog_items").select("id")
    .eq("project_id", projectId)
    .like("id", "BF-%")
    .order("id", { ascending: false }).limit(1).maybeSingle();
  const next = (parseInt(data?.id?.slice(3) ?? "0", 10) || 0) + 1;
  return `BF-${String(next).padStart(3, "0")}`;
}

// ─── チケット化モーダル ─────────────────────────────────────
function ConvertToTicketModal({
  item, project, sprints: initialSprints, onClose, onConverted,
}: {
  item: BacklogItem;
  project: Project;
  sprints: Sprint[];
  onClose: () => void;
  onConverted: () => void;
}) {
  const [sprints, setSprints] = useState<Sprint[]>(initialSprints);
  const [sprintId, setSprintId] = useState(initialSprints[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [showNewSprint, setShowNewSprint] = useState(false);
  const { userName } = useAuth();
  const { toast } = useToast();

  const reloadSprints = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    const { data } = await supabase!
      .from("sprints")
      .select("id, project_id, name, goal, status, start_date, end_date, identifier")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false });
    const mapped: Sprint[] = (data ?? []).map((s: any) => ({
      id: s.id, projectId: s.project_id, name: s.name, goal: s.goal || "",
      status: s.status, startDate: s.start_date, endDate: s.end_date,
      identifier: s.identifier || "", tickets: [],
    }));
    setSprints(mapped);
    if (mapped.length > 0) setSprintId(mapped[0].id);
  }, [project.id]);

  const handleConvert = async () => {
    if (!sprintId) { toast("スプリントを選択してください", "error"); return; }
    setSaving(true);
    try {
      const sprint = sprints.find(s => s.id === sprintId);
      const prefix = sprint?.identifier || project.wbsPrefix || "T";
      const { data: maxRow } = await supabase!
        .from("sprint_tickets").select("wbs").in("sprint_id", sprints.map(s => s.id))
        .like("wbs", `${prefix}-%`).order("wbs", { ascending: false }).limit(1).maybeSingle();
      const nextNum = (parseInt(maxRow?.wbs?.slice(prefix.length + 1) ?? "0", 10) || 0) + 1;
      const wbs = `${prefix}-${String(nextNum).padStart(3, "0")}`;
      const ticketId = `T-${Date.now()}`;

      const { error: insErr } = await supabase!.from("sprint_tickets").insert({
        id: ticketId, sprint_id: sprintId, wbs, title: item.title, status: "todo",
        priority: item.priority, assignee: item.assignee || "", estimated_hours: item.estimatedHours || 0,
        progress: getDefaultProgressForStatus("todo"), description: item.description || "", created_by: userName || null,
        images: item.images?.length ? item.images : [],
      });
      if (insErr) { toast("チケット作成に失敗しました", "error"); setSaving(false); return; }

      await supabase!.from("backlog_items").update({
        status: "converted", converted_ticket_id: ticketId, converted_ticket_wbs: wbs,
        updated_at: new Date().toISOString(),
      }).eq("id", item.id).eq("project_id", project.id);

      emitLinkItemsChanged(project.id, "ticket"); // 他タブの # サジェストへ即時反映

      toast(`${wbs} としてチケットを作成しました`);
      onConverted();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogShell title={`${item.id} をチケット化`} onClose={onClose} size="sm"
        footer={<>
          <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
          <button type="button" onClick={handleConvert} disabled={saving}
            style={{ padding: "9px 20px", background: saving ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            {saving && <BtnSpinner />}{saving ? "作成中..." : "チケットを作成"}
          </button>
        </>}>
        <p style={{ fontSize: 13, color: "#1A1714", margin: 0 }}>{item.title}</p>
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 5 }}>追加先スプリント</label>
          {sprints.length === 0 ? (
            <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>スプリントがありません</p>
          ) : (
            <CustomSelect value={sprintId} onChange={setSprintId}
              options={sprints.map(s => ({ value: s.id, label: s.name }))} placeholder="スプリントを選択" />
          )}
          <button
            type="button"
            onClick={() => setShowNewSprint(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 7, cursor: "pointer" }}>
            <Plus style={{ width: 11, height: 11 }} />新規スプリントを作成
          </button>
        </div>
      </DialogShell>

      {showNewSprint && (
        <NewSprintDialog
          projectId={project.id}
          onClose={() => setShowNewSprint(false)}
          onCreated={() => { setShowNewSprint(false); reloadSprints(); }}
          currentSprintCount={sprints.length}
        />
      )}
    </>
  );
}

// ─── 左サイドバー アイテム行の中身 ─────────────────────────────
// ツリー(DocTree)の行と、検索結果の平坦な一覧の両方から使う。
// 行そのもの（選択・ドラッグ・メニュー）は呼び出し側が持つ。
function BacklogRowContent({
  item, isSelected, projectSlug,
}: {
  item: BacklogItem; isSelected: boolean; projectSlug: string;
}) {
  const navigate = useNavigate();
  const pMeta = PRIORITY_META[item.priority];
  const sMeta = STATUS_META[item.status];
  const isConverted = item.status === "converted" && !!(item.convertedTicketWbs || item.convertedTicketId);
  const isDone = item.status === "converted" || item.status === "archived";

  const handleOpenTicket = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.convertedTicketWbs) {
      navigate(`/${projectSlug}/${item.convertedTicketWbs}`);
      return;
    }
    if (item.convertedTicketId && isSupabaseEnabled) {
      const { data } = await supabase!.from("sprint_tickets").select("wbs").eq("id", item.convertedTicketId).maybeSingle();
      if (data?.wbs) navigate(`/${projectSlug}/${data.wbs}`);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 0, opacity: isDone ? 0.65 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
        <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)", background: isSelected ? "#A7F3D0" : "#EDE9FE", color: isSelected ? "#065F46" : "#6D28D9", padding: "1px 5px", borderRadius: 4, flexShrink: 0 }}>{item.id}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title || "無題"}</span>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: pMeta.bg, color: pMeta.color }}>{pMeta.label}</span>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: sMeta.bg, color: sMeta.color }}>{sMeta.label}</span>
        {item.isUserInquiry && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: "#FFF7ED", color: "#D97706" }}>問い合わせ</span>
        )}
        {isConverted && (
          <button
            onClick={handleOpenTicket}
            title={`チケット ${item.convertedTicketWbs ?? ""} を開く`}
            style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 5px", fontSize: 9, fontWeight: 700, borderRadius: 8, background: "#F5F3FF", color: "#6D28D9", border: "none", cursor: "pointer" }}>
            <Ticket style={{ width: 9, height: 9 }} />{item.convertedTicketWbs ?? "開く"}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────
export function BacklogPage() {
  const { projectSlug, itemId: itemIdParam, folderId: folderIdParam } =
    useParams<{ projectSlug: string; itemId?: string; folderId?: string }>();
  const navigate = useNavigate();
  const { userPermissions, userName, userRole, userId, userOrgId } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [items, setItems] = useState<BacklogItem[]>([]);
  const [categories, setCategories] = useState<TicketCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("view");
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("view");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("view");
  const [effectiveWhiteboardPerm, setEffectiveWhiteboardPerm] = useState<AccessLevel>("view");
  // ENHA2-035: 後追い追加のため未設定時は "edit"（既存プロジェクトでも即使える）
  const [permsLoaded, setPermsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BacklogItem | null>(null);
  const [convertTarget, setConvertTarget] = useState<BacklogItem | null>(null);
  const [movingNodeTarget, setMovingNodeTarget] = useState<BacklogItem | null>(null);
  const [isTreeDragOverRoot, setIsTreeDragOverRoot] = useState(false);
  // 作成直後のフォルダ/項目を一時的にハイライトし、そこまでスクロールする（Wikiと同仕様）
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<SprintTicket | null>(null);
  const [selectedTicketSprintId, setSelectedTicketSprintId] = useState<string | undefined>(undefined);

  const handleSelectTicketByWbs = useCallback(async (wbs: string) => {
    if (!isSupabaseEnabled || !project) {
      setSelectedTicket({
        id: wbs, wbs, title: wbs, status: "todo", priority: "medium", assignee: "", startDate: "", dueDate: "", estimatedHours: 0, progress: 0
      });
      return;
    }
    const { data: sprintRows } = await supabase!
      .from("sprints")
      .select("id")
      .eq("project_id", project.id);
    const sprintIds = sprintRows?.map(s => s.id) ?? [];

    let ticketRow: any = null;
    if (sprintIds.length > 0) {
      const { data } = await supabase!
        .from("sprint_tickets")
        .select("*")
        .in("sprint_id", sprintIds)
        .eq("wbs", wbs)
        .maybeSingle();
      ticketRow = data;
    }

    if (!ticketRow) {
      const { data } = await supabase!
        .from("sprint_tickets")
        .select("*")
        .eq("wbs", wbs)
        .maybeSingle();
      ticketRow = data;
    }

    if (ticketRow) {
      setSelectedTicket(mapSprintTicket(ticketRow));
      setSelectedTicketSprintId(ticketRow.sprint_id);
    } else {
      toast("該当するチケットが見つかりませんでした", "error");
    }
  }, [project, toast]);

  // 右パネル編集ステート
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState<Priority>("medium");
  const [editStatus, setEditStatus] = useState<BacklogStatus>("open");
  const [editAssignee, setEditAssignee] = useState("");
  const [editHours, setEditHours] = useState(0);
  const [editCategoryId, setEditCategoryId] = useState<string | null>(null);
  const [editImages, setEditImages] = useState<string[]>([]);
  const editImagesRef = useRef<string[]>([]);
  editImagesRef.current = editImages;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveBacklogPerm === "edit";
  const { open: openPreview } = usePreviewPanel();
  const canCreate = userPermissions.canCreateTicket;

  // $(Wiki/バックログ/議事録) / #(チケット) のサジェスト候補。
  // 別タブでの作成・改題に追随して再取得される。(BRU5-032)
  const suggest = useLinkSuggestions(project?.id);

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

    const [{ data: itemRows }, { data: sprintRows }, { data: catRows }, { data: permData }] = await Promise.all([
      supabase!.from("backlog_items").select("*").eq("project_id", p.id).order("rank"),
      supabase!.from("sprints").select("id, project_id, name, goal, status, start_date, end_date, identifier").eq("project_id", p.id),
      supabase!.from("ticket_categories").select("*").eq("project_id", p.id).order("name"),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    setItems((itemRows ?? []).map(mapBacklogItem));
    setSprints((sprintRows ?? []).map((s: any) => ({ id: s.id, projectId: s.project_id, name: s.name, goal: s.goal || "", status: s.status, startDate: s.start_date, endDate: s.end_date, identifier: s.identifier || "", tickets: [] })));
    setCategories((catRows ?? []).map(mapTicketCategory));

    if (isAdminRole) {
      setEffectiveBacklogPerm("edit");
      setEffectiveWikiPerm("edit");
      setEffectiveMinutesPerm("edit");
      setEffectiveWhiteboardPerm("edit");
    } else {
      const perms = permData?.permissions as Partial<UserPermissions> | null;
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWhiteboardPerm((perms?.whiteboardPermission as AccessLevel | undefined) ?? "none");
    }
    setPermsLoaded(true);
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  // URLパスパラメータからアイテム/フォルダ選択
  useEffect(() => {
    if (items.length === 0) return;
    const wanted = folderIdParam ?? itemIdParam;
    if (!wanted) return;
    const found = items.find(i => i.id === wanted);
    if (found) setSelectedId(found.id);
  }, [itemIdParam, folderIdParam, items]);

  // URLで名指しされた項目/フォルダが実在しないとき（削除済みリンク等）。
  // 以前は黙って一覧が出るだけで、リンクが死んでいることに気づけなかった。
  // PJを跨いで遷移した直後は手元の items がまだ前のPJのものなので、
  // URLのPJと読み込み済みのPJが一致するまで判定しない（一瞬404が出るのを防ぐ）。
  const projectMatchesUrl = !!project && (project.slug === projectSlug || project.id === projectSlug);
  const routeTargetMissing = !loading && projectMatchesUrl && (() => {
    const wanted = folderIdParam ?? itemIdParam;
    if (!wanted) return false;
    return !items.some(i => i.id === wanted);
  })();

  const selectedItem = useMemo(() => items.find(i => i.id === selectedId) ?? null, [items, selectedId]);
  // チケット化済・アーカイブ済の項目は編集不可
  const itemCanEdit = canEdit && selectedItem != null && !selectedItem.isFolder
    && selectedItem.status !== "converted" && selectedItem.status !== "archived";

  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const itemCount = useMemo(() => items.filter(i => !i.isFolder).length, [items]);

  // ツリー用の並び。各階層で「フォルダ → 未完了 → 完了/アーカイブ」の順、同種内は rank 昇順。
  // buildDocTree はこの配列順をそのまま各階層に引き継ぐ。
  const orderedItems = useMemo(() => {
    const doneRank = (i: BacklogItem) => (i.status === "converted" || i.status === "archived") ? 1 : 0;
    return [...items].sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      if (a.isFolder) return a.rank - b.rank || a.title.localeCompare(b.title, "ja");
      return doneRank(a) - doneRank(b) || a.rank - b.rank;
    });
  }, [items]);
  const tree = useMemo(() => buildDocTree(orderedItems), [orderedItems]);

  // パンくず用：選択中の祖先フォルダ一覧
  const ancestors = useMemo(() => {
    if (!selectedItem) return [];
    const list: BacklogItem[] = [];
    let current: BacklogItem | undefined = selectedItem;
    while (current?.parentId) {
      const parent: BacklogItem | undefined = itemById.get(current.parentId);
      if (!parent) break;
      list.unshift(parent);
      current = parent;
    }
    return list;
  }, [selectedItem, itemById]);

  const gotoItem = useCallback((id: string) => {
    navigate(`/${projectSlug ?? project?.slug}/backlog/${id}`);
  }, [navigate, projectSlug, project?.slug]);

  const gotoFolder = useCallback((id: string) => {
    navigate(`/${projectSlug ?? project?.slug}/backlog/folders/${id}`);
  }, [navigate, projectSlug, project?.slug]);

  // 作成したノードまでスクロールして数秒ハイライトする（Wikiと同仕様）
  const flashCreated = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    setHighlightIds(ids);
    setScrollToId(ids[0]);
    highlightTimer.current = setTimeout(() => { setHighlightIds([]); setScrollToId(null); }, 2400);
  }, []);

  useEffect(() => () => { if (highlightTimer.current) clearTimeout(highlightTimer.current); }, []);

  // 選択アイテムが変わったら編集ステートを同期
  useEffect(() => {
    setEditTitle(selectedItem?.title ?? "");
    setEditDescription(selectedItem?.description ?? "");
    setEditPriority(selectedItem?.priority ?? "medium");
    setEditStatus(selectedItem?.status ?? "open");
    setEditAssignee(selectedItem?.assignee ?? "");
    setEditHours(selectedItem?.estimatedHours ?? 0);
    setEditCategoryId(selectedItem?.categoryId ?? null);
    setEditImages(selectedItem?.images ?? []);
  }, [selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback((patch: {
    title?: string; description?: string; priority?: Priority;
    status?: BacklogStatus; assignee?: string; estimatedHours?: number; categoryId?: string | null;
  }, immediate = false) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const titleChanged = patch.title !== undefined && items.find(i => i.id === selectedId)?.title !== patch.title;
    const pid = project?.id;
    const run = async () => {
      const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.title !== undefined) updateData.title = patch.title;
      if (patch.description !== undefined) updateData.description = patch.description;
      if (patch.priority !== undefined) updateData.priority = patch.priority;
      if (patch.status !== undefined) updateData.status = patch.status;
      if (patch.assignee !== undefined) updateData.assignee = patch.assignee;
      if (patch.estimatedHours !== undefined) updateData.estimated_hours = patch.estimatedHours;
      if ("categoryId" in patch) updateData.category_id = patch.categoryId ?? null;
      await supabase!.from("backlog_items").update(updateData).eq("id", selectedId).eq("project_id", pid);
      setItems(prev => prev.map(i => i.id === selectedId ? { ...i, ...patch } : i));
      // タイトルが変わったときだけ、他タブのサジェスト表示名を更新させる
      if (titleChanged) emitLinkItemsChanged(pid, "backlog");
    };
    // ⌘/Ctrl + Enter の確定は自動保存(600ms待ち)を待たずに即書き込む
    if (immediate) void run();
    else saveTimer.current = setTimeout(run, 600);
  }, [selectedId, items, project?.id]);

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setEditImages(next);
    setItems(prev => prev.map(i => i.id === selectedId ? { ...i, images: next } : i));
    if (isSupabaseEnabled && project) {
      await supabase!.from("backlog_items").update({ images: next, updated_at: new Date().toISOString() }).eq("id", selectedId).eq("project_id", project.id);
    }
  }, [selectedId]);

  // RichEditor上でのペースト・ドロップ画像をImageAttachmentsに追加（インライン挿入しない）
  const onEditorImageUpload = useCallback(async (file: File): Promise<string> => {
    if (!selectedId) return "";
    let url: string;
    if (!isSupabaseEnabled) {
      url = URL.createObjectURL(file);
    } else {
      const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
      const ext = extMap[file.type] ?? "png";
      const path = `backlog/${selectedId}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
      const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type || "image/png" });
      if (error || !data) return "";
      url = supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
    }
    if (url) {
      const next = [...editImagesRef.current, url];
      editImagesRef.current = next;
      handleImagesChange(next);
    }
    return ""; // インライン挿入を抑制
  }, [selectedId, handleImagesChange]);

  // 検索中はフォルダ階層をたたんで、一致した項目だけを平らに並べる（Wikiと同仕様）
  const searchMatched = useMemo(() => {
    const q = sidebarSearch.trim().toLowerCase();
    if (!q) return [] as BacklogItem[];
    return orderedItems.filter(i => !i.isFolder
      && (i.title.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q)));
  }, [orderedItems, sidebarSearch]);

  const handleAddItem = async (parentId: string | null = null) => {
    if (!project) return;
    const id = await nextBacklogId(project.id);
    const { error } = await supabase!.from("backlog_items").insert({
      id, project_id: project.id, parent_id: parentId,
      title: "新規バックログ項目", description: "", priority: "medium",
      assignee: "", estimated_hours: 0, status: "open", rank: Date.now(), created_by: userName || null,
    });
    if (error) { toast("作成に失敗しました", "error"); return; }
    await load();
    emitLinkItemsChanged(project.id, "backlog"); // 他タブの $ サジェストへ即時反映
    gotoItem(id);
    flashCreated([id]);
  };

  // ── フォルダ（Wikiと同仕様） ─────────────────────────────────
  const handleAddFolder = async (parentId: string | null = null) => {
    if (!project) return;
    const id = await nextBacklogFolderId(project.id);
    const { error } = await supabase!.from("backlog_items").insert({
      id, project_id: project.id, parent_id: parentId,
      title: "無題のフォルダ", description: "", is_folder: true,
      priority: "medium", assignee: "", estimated_hours: 0, status: "open",
      rank: items.filter(i => (i.parentId ?? null) === parentId && i.isFolder).length,
      created_by: userName || null,
    });
    if (error) {
      console.error("[BacklogPage] folder insert error:", error);
      toast("フォルダの作成に失敗しました", "error");
      return;
    }
    await load();
    gotoFolder(id);
    flashCreated([id]);
  };

  const handleRenameNode = useCallback(async (id: string, nextTitle: string) => {
    if (!project) return;
    setItems(prev => prev.map(i => i.id === id ? { ...i, title: nextTitle } : i));
    if (id === selectedId) setEditTitle(nextTitle);
    const { error } = await supabase!.from("backlog_items")
      .update({ title: nextTitle, updated_at: new Date().toISOString() })
      .eq("id", id).eq("project_id", project.id);
    if (error) {
      console.error("[BacklogPage] rename error:", error);
      toast("名前の変更に失敗しました", "error");
      load();
      return;
    }
    emitLinkItemsChanged(project.id, "backlog"); // 他タブのサジェスト表示名を更新
  }, [project, selectedId, load, toast]);

  const handleMoveNode = useCallback(async (draggedId: string, targetParentId: string | null) => {
    if (!project || draggedId === targetParentId) return;
    const dragged = items.find(i => i.id === draggedId);
    if (!dragged || (dragged.parentId ?? null) === targetParentId) return;
    if (isCyclicMove(items, draggedId, targetParentId)) {
      toast("フォルダを自身の子孫フォルダ配下に移動することはできません", "error");
      return;
    }
    setItems(prev => prev.map(i => i.id === draggedId ? { ...i, parentId: targetParentId } : i));
    const { error } = await supabase!.from("backlog_items")
      .update({ parent_id: targetParentId, updated_at: new Date().toISOString() })
      .eq("id", draggedId).eq("project_id", project.id);
    if (error) {
      console.error("[BacklogPage] move error:", error);
      toast("移動に失敗しました", "error");
    } else {
      toast("配置を変更しました");
    }
    load();
  }, [items, project, load, toast]);

  // 同じ階層内での並べ替え。別階層の項目へドロップされたら、その階層へ移しつつ位置を合わせる。
  const reorderItems = useCallback(async (fromId: string, toId: string) => {
    if (!project || fromId === toId) return;
    const from = items.find(i => i.id === fromId);
    const to = items.find(i => i.id === toId);
    if (!from || !to || from.isFolder) return;
    const targetParentId = to.parentId ?? null;
    const siblings = items
      .filter(i => !i.isFolder && (i.parentId ?? null) === targetParentId && i.id !== fromId)
      .sort((a, b) => a.rank - b.rank);
    const toIdx = siblings.findIndex(i => i.id === toId);
    if (toIdx === -1) return;
    const reordered = [...siblings];
    reordered.splice(toIdx, 0, from);
    const newRanks = reordered.map((item, idx) => ({ id: item.id, rank: (idx + 1) * 1000 }));
    setItems(prev => prev.map(i => {
      const r = newRanks.find(u => u.id === i.id);
      if (!r) return i;
      return i.id === fromId ? { ...i, rank: r.rank, parentId: targetParentId } : { ...i, rank: r.rank };
    }));
    await Promise.all(newRanks.map(({ id, rank }) =>
      supabase!.from("backlog_items")
        .update(id === fromId ? { rank, parent_id: targetParentId } : { rank })
        .eq("id", id).eq("project_id", project.id)
    ));
  }, [items, project]);

  const copyShareLink = useCopyShareLink(projectSlug ?? project?.slug);
  const handleCopyLink = useCallback((node: { id: string; isFolder: boolean }) => {
    void copyShareLink({ kind: node.isFolder ? "backlog-folder" : "backlog", id: node.id });
  }, [copyShareLink]);

  const handleDelete = async (item: BacklogItem) => {
    if (!project) return;
    // backlog_items は複合主キーのため parent_id に FK(on delete cascade) を張れない。
    // フォルダを消すときは配下を再帰的に集めて、ここでまとめて削除する。
    const collectIds = (id: string, acc: string[]): string[] => {
      acc.push(id);
      for (const child of items.filter(i => i.parentId === id)) collectIds(child.id, acc);
      return acc;
    };
    const targetIds = item.isFolder ? collectIds(item.id, []) : [item.id];
    const { error } = await supabase!.from("backlog_items")
      .delete().in("id", targetIds).eq("project_id", project.id);
    if (error) {
      console.error("[BacklogPage] delete error:", error);
      toast("削除に失敗しました", "error");
      return;
    }
    emitLinkItemsChanged(project.id, "backlog");
    // 配下もまとめて消えるので、選択中が子孫なら選択を外す
    const isSelectionGone = !!selectedId && targetIds.includes(selectedId);
    if (isSelectionGone) {
      setSelectedId(null);
      navigate(`/${projectSlug ?? project?.slug}/backlog`);
    }
    toast(item.isFolder
      ? `フォルダ「${item.title || "無題のフォルダ"}」を削除しました`
      : `${item.id} を削除しました`);
    load();
  };

  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;
  if (!loading && effectiveBacklogPerm === "none") return <NotFoundView kind="no-permission" label="バックログ" />;
  if (routeTargetMissing) return (
    <NotFoundView kind="resource" label={folderIdParam ? "フォルダ" : "バックログ項目"}
      backTo={{ label: "バックログ一覧へ", to: `/${projectSlug ?? project?.slug}/backlog` }} />
  );

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>バックログ</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${itemCount} 件` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {permsLoaded && effectiveBacklogPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="backlog" marginBottom={0} backlogPerm={effectiveBacklogPerm} wikiPerm={effectiveWikiPerm} minutesPerm={effectiveMinutesPerm} whiteboardPerm={effectiveWhiteboardPerm} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
        {/* ─── 左サイドバー ─── */}
        <div
          onDragOver={e => { if (!canEdit || sidebarSearch) return; e.preventDefault(); setIsTreeDragOverRoot(true); }}
          onDragLeave={() => setIsTreeDragOverRoot(false)}
          onDrop={async e => {
            if (!canEdit || sidebarSearch) return;
            e.preventDefault();
            setIsTreeDragOverRoot(false);
            const draggedId = e.dataTransfer.getData("text/plain");
            if (draggedId) await handleMoveNode(draggedId, null);
          }}
          style={{
            width: 260, flexShrink: 0, background: "#FFFFFF", borderRadius: 14,
            border: isTreeDragOverRoot ? "1px dashed #059669" : "1px solid rgba(26,23,20,0.07)",
            padding: 10, overflowY: "auto", display: "flex", flexDirection: "column", transition: "all 0.15s",
          }}>
          {/* 検索バー */}
          <div style={{ position: "relative", marginBottom: 8 }}>
            <Search style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 11, height: 11, color: sidebarSearch ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
            <input
              value={sidebarSearch}
              onChange={e => setSidebarSearch(e.target.value)}
              placeholder="検索..."
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 26px 6px 26px", fontSize: 11, background: "#F4F5F6", border: `1px solid ${sidebarSearch ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 7, outline: "none", fontFamily: "inherit" }}
            />
            {sidebarSearch && (
              <button onClick={() => setSidebarSearch("")} style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex", alignItems: "center" }}>
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>

          {canEdit && (
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {canCreate && (
                <button onClick={() => handleAddItem(null)}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Plus style={{ width: 12, height: 12 }} />新規追加
                </button>
              )}
              <button onClick={() => handleAddFolder(null)}
                title="新規フォルダ"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "7px 10px", background: "#FFFBEB", color: "#D97706", border: "1.5px solid #FDE68A", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", flex: canCreate ? "0 0 auto" : 1 }}>
                <FolderPlus style={{ width: 13, height: 13 }} />
              </button>
            </div>
          )}

          {items.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <ClipboardList style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>バックログ項目がありません</p>
            </div>
          ) : sidebarSearch ? (
            searchMatched.length === 0 ? (
              <div style={{ padding: "24px 8px", textAlign: "center" }}>
                <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>「{sidebarSearch}」に一致する項目がありません</p>
              </div>
            ) : (
              searchMatched.map(item => {
                const parent = item.parentId ? itemById.get(item.parentId) : null;
                const isSelected = selectedId === item.id;
                return (
                  <div key={item.id} onClick={() => gotoItem(item.id)}
                    style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 2 }}>
                    <BacklogRowContent item={item} isSelected={isSelected} projectSlug={projectSlug ?? project?.slug ?? ""} />
                    {parent && (
                      <span style={{ fontSize: 9, color: "#B0A9A4", flexShrink: 0, marginTop: 2 }}>{parent.title || "無題のフォルダ"}</span>
                    )}
                  </div>
                );
              })
            )
          ) : (
            <DocTree
              tree={tree}
              selectedId={selectedId}
              canEdit={canEdit}
              onSelect={(node: DocTreeNode) => { if (node.isFolder) gotoFolder(node.id); else gotoItem(node.id); }}
              onAddChild={(parentId, isFolder) => { if (isFolder) handleAddFolder(parentId); else if (canCreate) handleAddItem(parentId); }}
              addItemLabel="バックログ項目を追加"
              onRename={handleRenameNode}
              onDelete={node => { const i = itemById.get(node.id); if (i) setDeleteTarget(i); }}
              onMove={handleMoveNode}
              onReorder={reorderItems}
              onOpenMoveModal={node => { const i = itemById.get(node.id); if (i) setMovingNodeTarget(i); }}
              onCopyLink={handleCopyLink}
              highlightIds={highlightIds}
              scrollToId={scrollToId}
              renderItemRow={(node, isSelected) => {
                const item = itemById.get(node.id);
                if (!item) return null;
                return <BacklogRowContent item={item} isSelected={isSelected} projectSlug={projectSlug ?? project?.slug ?? ""} />;
              }}
            />
          )}
        </div>

        {/* ─── 右パネル ─── */}
        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selectedItem ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <ClipboardList style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左の一覧から項目を選択するか、新規追加してください</p>
            </div>
          ) : selectedItem.isFolder ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FolderOpen style={{ width: 32, height: 32, color: "#FCD34D", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: "0 0 6px" }}>{selectedItem.title || "無題のフォルダ"}</p>
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: "0 0 16px" }}>
                {items.filter(i => i.parentId === selectedItem.id).length} 件のアイテム
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button onClick={() => handleCopyLink(selectedItem)}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Link2 style={{ width: 13, height: 13 }} />リンクをコピー
                </button>
                {canEdit && canCreate && (
                  <button onClick={() => handleAddItem(selectedItem.id)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#FFFFFF", color: "#6B6458", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    <Plus style={{ width: 13, height: 13 }} />このフォルダに項目を追加
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* 固定ヘッダー: タイトル + アクションボタン + フィールド行 */}
              <div style={{ padding: "20px 20px 14px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                {ancestors.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9E9690", marginBottom: 8, flexWrap: "wrap" }}>
                    <span onClick={() => { setSelectedId(null); navigate(`/${projectSlug ?? project?.slug}/backlog`); }} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>バックログホーム</span>
                    {ancestors.map(folder => (
                      <div key={folder.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span>&gt;</span>
                        <span onClick={() => gotoFolder(folder.id)} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>
                          {folder.title || "無題のフォルダ"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 14 }}>
                  <input
                    value={editTitle}
                    disabled={!itemCanEdit}
                    onChange={e => { setEditTitle(e.target.value); scheduleSave({ title: e.target.value }); }}
                    placeholder="バックログ項目のタイトル"
                    style={{ flex: 1, boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0 }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => handleCopyLink(selectedItem)} title="この項目へのリンクをコピー"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, display: "flex", alignItems: "center" }}>
                      <Link2 style={{ width: 14, height: 14 }} />
                    </button>
                    {canCreate && selectedItem.status !== "converted" && (
                      <button onClick={() => setConvertTarget(selectedItem)} title="チケット化"
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#EDE9FE", color: "#6D28D9", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        <GitBranch style={{ width: 12, height: 12 }} />チケット化
                      </button>
                    )}
                    {selectedItem.status === "converted" && !!(selectedItem.convertedTicketWbs || selectedItem.convertedTicketId) && (
                      <button
                        onClick={async () => {
                          if (selectedItem.convertedTicketWbs) {
                            navigate(`/${projectSlug ?? project?.slug ?? ""}/${selectedItem.convertedTicketWbs}`);
                            return;
                          }
                          if (selectedItem.convertedTicketId && isSupabaseEnabled) {
                            const { data } = await supabase!.from("sprint_tickets").select("wbs").eq("id", selectedItem.convertedTicketId).maybeSingle();
                            if (data?.wbs) navigate(`/${projectSlug ?? project?.slug ?? ""}/${data.wbs}`);
                          }
                        }}
                        title={`チケット ${selectedItem.convertedTicketWbs ?? ""} を開く`}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "#ECFDF5", color: "#059669", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        <Ticket style={{ width: 12, height: 12 }} />{selectedItem.convertedTicketWbs ?? "チケットを開く"}
                      </button>
                    )}
                    {canEdit && (
                      <button onClick={() => setDeleteTarget(selectedItem)} title="削除"
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4 }}>
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 160, flex: 1, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>分類</label>
                    <CustomSelect
                      value={editCategoryId ?? ""}
                      onChange={v => { setEditCategoryId(v || null); scheduleSave({ categoryId: v || null }); }}
                      options={[{ value: "", label: "分類なし" }, ...categories.map(c => ({ value: c.id, label: c.name }))]}
                      placeholder="分類なし" />
                  </div>
                  <div style={{ width: 110, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>優先度</label>
                    <CustomSelect
                      value={editPriority}
                      onChange={v => { setEditPriority(v as Priority); scheduleSave({ priority: v as Priority }); }}
                      options={[
                        { value: "high", label: "高", color: PRIORITY_META.high.color },
                        { value: "medium", label: "中", color: PRIORITY_META.medium.color },
                        { value: "low", label: "低", color: PRIORITY_META.low.color },
                      ]} />
                  </div>
                  <div style={{ width: 155, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>状態</label>
                    <CustomSelect
                      value={editStatus}
                      onChange={v => { setEditStatus(v as BacklogStatus); scheduleSave({ status: v as BacklogStatus }); }}
                      options={[
                        { value: "open", label: "未対応", color: STATUS_META.open.color },
                        { value: "in-progress", label: "対応中", color: STATUS_META["in-progress"].color },
                        { value: "converted", label: "チケット化済", color: STATUS_META.converted.color },
                        { value: "archived", label: "アーカイブ", color: STATUS_META.archived.color },
                      ]} />
                  </div>
                  <div style={{ minWidth: 140, pointerEvents: itemCanEdit ? "auto" : "none", opacity: itemCanEdit ? 1 : 0.6 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>担当者</label>
                    <CustomSelect
                      value={editAssignee}
                      onChange={v => { setEditAssignee(v); scheduleSave({ assignee: v }); }}
                      options={(project?.members ?? []).map(m => ({ value: m, label: m }))}
                      placeholder="未割当" />
                  </div>
                  <div style={{ width: 90 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>見積(h)</label>
                    <input
                      type="number" min={0} value={editHours} disabled={!itemCanEdit}
                      onChange={e => { const v = Number(e.target.value); setEditHours(v); scheduleSave({ estimatedHours: v }); }}
                      style={{ width: "100%", boxSizing: "border-box", padding: "7px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 9, outline: "none", fontFamily: "inherit" }} />
                  </div>
                </div>
              </div>

              {/* エディター + 画像添付（エディター内部でスクロール） */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px 20px 16px", display: "flex", flexDirection: "column" }}>
                <RichEditor
                  value={editDescription}
                  readOnly={!itemCanEdit}
                  onChange={v => { setEditDescription(v); scheduleSave({ description: v }); }}
                  onSubmit={() => { if (itemCanEdit) scheduleSave({ description: editDescription }, true); }}
                  placeholder="背景や要件を入力..."
                  members={project?.members ?? []}
                  minHeight={120}
                  style={{ flex: 1, minHeight: 0 }}
                  tickets={suggest.tickets}
                  backlogItems={suggest.backlogItems}
                  wikiItems={suggest.wikiItems}
                  minuteItems={suggest.minuteItems}
                  fileItems={suggest.fileItems}
                  onTicketClick={handleSelectTicketByWbs}
                  onBacklogClick={id => openPreview("backlog", id)}
                  onWikiClick={id => openPreview("wiki", id)}
                  onMinuteClick={id => openPreview("minute", id)}
                  onFileClick={id => openPreview("file", id)}
                  onImageUpload={itemCanEdit ? onEditorImageUpload : undefined} />
                <div style={{ marginTop: 16, flexShrink: 0 }}>
                  <ImageAttachments
                    images={editImages}
                    onImagesChange={handleImagesChange}
                    uploadPathPrefix={`backlog/${selectedItem.id}`}
                    readOnly={!itemCanEdit}
                    maxImages={plan.maxImagesPerItem}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {convertTarget && project && (
        <ConvertToTicketModal item={convertTarget} project={project} sprints={sprints}
          onClose={() => setConvertTarget(null)}
          onConverted={() => { setConvertTarget(null); load(); }} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isFolder ? "フォルダの削除" : "バックログ項目の削除"}
          message={deleteTarget.isFolder
            ? `「${deleteTarget.title || "無題のフォルダ"}」を削除します。フォルダ内の項目も一緒に削除されます。`
            : `${deleteTarget.id}「${deleteTarget.title}」を削除します。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}

      {/* Googleドライブ風のフォルダ階層一覧選択移動モーダル */}
      {movingNodeTarget && (
        <FolderMoveModal
          node={movingNodeTarget}
          items={items}
          onClose={() => setMovingNodeTarget(null)}
          onConfirm={async targetParentId => {
            await handleMoveNode(movingNodeTarget.id, targetParentId);
            setMovingNodeTarget(null);
          }}
        />
      )}

      {/* チケット詳細パネル */}
      {selectedTicket && (
        <TicketDetailPanel
          ticket={selectedTicket}
          projectId={project?.id}
          sprintId={selectedTicketSprintId}
          projectSlug={projectSlug}
          onClose={() => setSelectedTicket(null)}
          onUpdated={load}
          onSelectTicket={t => handleSelectTicketByWbs(t.wbs)}
        />
      )}
    </div>
  );
}
