import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";

function toMinuteSlug(createdAt: string | null | undefined): string {
  if (!createdAt) return "";
  const m = createdAt.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return "";
  return `${m[1]}${m[2]}${m[3]}-${m[4]}${m[5]}${m[6]}`;
}
import { FolderKanban, ChevronRight, ChevronDown, Plus, FileText, Trash2, Users, Check, X, Search, FileUp, Upload, Loader2, FolderPlus, FolderOpen, Link2 } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { ArticleExportButton } from "@/app/components/shared/ArticleExportButton";
import { exportMinuteArticle } from "@/app/lib/articleExport";
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { mapProject, mapMeetingMinute, mapActionMemo, mapSprintTicket } from "@/app/lib/mappers";
import type { Project, MeetingMinute, ActionMemo, AccessLevel, UserPermissions, SprintTicket } from "@/app/types";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { NotFoundView, projectAccessView } from "@/app/components/shared/NotFoundView";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { ImageAttachments } from "@/app/components/shared/ImageAttachments";
import { useLinkSuggestions } from "@/app/hooks/useLinkSuggestions";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/app/components/ui/dropdown-menu";
import { readMinutesMarkdownFiles, MINUTES_MD_ACCEPT } from "@/app/lib/minutesMdImport";
import { DocTree, FolderMoveModal, buildDocTree, isCyclicMove, type DocTreeNode } from "@/app/components/shared/DocTree";
import { useCopyShareLink } from "@/app/hooks/useCopyShareLink";

function formatDate(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
}

// ─── アクション項目 ─────────────────────────────────────────
function ActionItemsPanel({
  minuteId, projectId, projectSlug, members, canEdit, onPendingCountChange,
}: {
  minuteId: string; projectId: string; projectSlug: string; members: string[]; canEdit: boolean;
  onPendingCountChange?: (count: number) => void;
}) {
  const [items, setItems] = useState<ActionMemo[]>([]);
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState(members[0] ?? "");
  const { toast } = useToast();

  const load = useCallback(async () => {
    const { data } = await supabase!.from("action_memos").select("*").eq("meeting_minute_id", minuteId).order("created_at");
    setItems((data ?? []).map(mapActionMemo));
  }, [minuteId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    onPendingCountChange?.(items.filter(i => !i.isDone).length);
  }, [items, onPendingCountChange]);

  const handleAdd = async () => {
    if (!text.trim() || !assignee) return;
    const { error } = await supabase!.from("action_memos").insert({
      user_name: assignee, title: text.trim(), category: "todo",
      meeting_minute_id: minuteId, project_id: projectId, project_slug: projectSlug,
    });
    if (error) { toast("アクション項目の追加に失敗しました", "error"); return; }
    setText("");
    load();
  };

  const handleToggle = async (item: ActionMemo) => {
    await supabase!.from("action_memos").update({ is_done: !item.isDone, updated_at: new Date().toISOString() }).eq("id", item.id);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isDone: !i.isDone } : i));
  };

  const handleDelete = async (id: string) => {
    await supabase!.from("action_memos").delete().eq("id", id);
    setItems(prev => prev.filter(i => i.id !== id));
  };

  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#4A4540", marginBottom: 8 }}>アクション項目</p>
      {items.length === 0 ? (
        <p style={{ fontSize: 11, color: "#D4CEC8", marginBottom: 10 }}>なし</p>
      ) : (
        <div style={{ marginBottom: 10, maxHeight: 90, overflowY: "auto" }}>
          {items.map(item => (
            <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
              <button onClick={() => handleToggle(item)}
                style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${item.isDone ? "#059669" : "#D4CEC8"}`, background: item.isDone ? "#059669" : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {item.isDone && <Check style={{ width: 10, height: 10, color: "#fff" }} />}
              </button>
              <span style={{ flex: 1, fontSize: 12, color: item.isDone ? "#B0A9A4" : "#1A1714", textDecoration: item.isDone ? "line-through" : "none" }}>{item.title}</span>
              <span style={{ fontSize: 10, color: "#9E9690", flexShrink: 0 }}>{item.userName}</span>
              {canEdit && (
                <button onClick={() => handleDelete(item.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 2 }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {canEdit && (
        <div style={{ display: "flex", gap: 6 }}>
          <input value={text} onChange={e => setText(e.target.value)} placeholder="アクション項目を入力..."
            onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) handleAdd(); }}
            style={{ flex: 1, padding: "7px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
          <div style={{ width: 140 }}>
            <CustomSelect value={assignee} onChange={setAssignee} options={members.map(m => ({ value: m, label: m }))} />
          </div>
          <button onClick={handleAdd} style={{ padding: "7px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>追加</button>
        </div>
      )}
    </div>
  );
}

// ─── メインページ ─────────────────────────────────────────
export function MinutesPage() {
  const { projectSlug, minuteId: minuteIdParam, folderId: folderIdParam } =
    useParams<{ projectSlug: string; minuteId?: string; folderId?: string }>();
  const navigate = useNavigate();
  const { userPermissions, userName, userRole, userId, userOrgId } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [minutes, setMinutes] = useState<MeetingMinute[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [attendees, setAttendees] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MeetingMinute | null>(null);
  const [movingNodeTarget, setMovingNodeTarget] = useState<MeetingMinute | null>(null);
  const [isTreeDragOverRoot, setIsTreeDragOverRoot] = useState(false);
  // 作成直後のフォルダ/議事録を一時的にハイライトし、そこまでスクロールする（Wikiと同仕様）
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [scrollToId, setScrollToId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingActionsByMinute, setPendingActionsByMinute] = useState<Record<string, number>>({});
  const [showExternalInput, setShowExternalInput] = useState(false);
  const [externalInput, setExternalInput] = useState("");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("view");
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("view");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("view");
  const [effectiveWhiteboardPerm, setEffectiveWhiteboardPerm] = useState<AccessLevel>("view");
  // ENHA2-035: 後追い追加のため未設定時は "edit"（既存プロジェクトでも即使える）
  const [permsLoaded, setPermsLoaded] = useState(false);
  const [sidebarSearch, setSidebarSearch] = useState("");
  const [selectedTicket, setSelectedTicket] = useState<SprintTicket | null>(null);
  const [selectedTicketSprintId, setSelectedTicketSprintId] = useState<string | undefined>(undefined);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // MD取り込みの進捗（null=非実行中）。取り込み中は「新規議事録」ボタンを進捗表示へ差し替える。
  const [mdImportProgress, setMdImportProgress] = useState<{ done: number; total: number } | null>(null);
  const singleMdInputRef = useRef<HTMLInputElement | null>(null);
  const bulkMdInputRef = useRef<HTMLInputElement | null>(null);

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

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveMinutesPerm === "edit";
  const { open: openPreview } = usePreviewPanel();

  // $(Wiki/バックログ/議事録) / #(チケット) のサジェスト候補。
  // 別タブでの作成・改題に追随して再取得される。(BRU5-032)
  const suggest = useLinkSuggestions(project?.id);

  const handlePendingCountChange = useCallback((count: number) => {
    if (!selectedId) return;
    setPendingActionsByMinute(prev => ({ ...prev, [selectedId]: count }));
  }, [selectedId]);

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));
    const [{ data }, permResult, { data: actionData }] = await Promise.all([
      supabase!.from("meeting_minutes").select("*").eq("project_id", p.id).order("meeting_date", { ascending: false }),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
      supabase!.from("action_memos").select("meeting_minute_id, is_done").eq("project_id", p.id),
    ]);
    setMinutes((data ?? []).map(mapMeetingMinute));
    const pendingMap: Record<string, number> = {};
    for (const a of actionData ?? []) {
      if (!a.is_done && a.meeting_minute_id) {
        pendingMap[a.meeting_minute_id] = (pendingMap[a.meeting_minute_id] ?? 0) + 1;
      }
    }
    setPendingActionsByMinute(pendingMap);

    if (isAdminRole) {
      setEffectiveMinutesPerm("edit");
      setEffectiveWikiPerm("edit");
      setEffectiveBacklogPerm("edit");
      setEffectiveWhiteboardPerm("edit");
    } else {
      const perms = permResult.data?.permissions as Partial<UserPermissions> | null;
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWhiteboardPerm((perms?.whiteboardPermission as AccessLevel | undefined) ?? "none");
    }
    setPermsLoaded(true);
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  // URLパスパラメータからアイテム選択（UUID後方互換 + yyyymmdd-hhmmss スラグ対応 + フォルダ）
  useEffect(() => {
    if (minutes.length === 0) return;
    if (folderIdParam) {
      const folder = minutes.find(m => m.id.toLowerCase() === folderIdParam.toLowerCase());
      if (folder) setSelectedId(folder.id);
      return;
    }
    if (minuteIdParam) {
      const found = minutes.find(m => m.id === minuteIdParam)
        ?? minutes.find(m => toMinuteSlug(m.createdAt) === minuteIdParam);
      if (found) setSelectedId(found.id);
    }
  }, [minuteIdParam, folderIdParam, minutes]);

  const selected = minutes.find(m => m.id === selectedId) ?? null;

  // URLで名指しされた議事録/フォルダが実在しないとき（削除済みリンク等）。
  // 以前は黙って一覧が出るだけで、リンクが死んでいることに気づけなかった。
  //
  // 誤爆させないための条件が2つある:
  //   ・作成直後 … handleAdd/handleAddFolder が await load() を挟むので minutes に載っている
  //   ・PJ跨ぎの遷移 … 手元の minutes がまだ前のPJのものなので、URLのPJと一致するまで判定しない
  const projectMatchesUrl = !!project && (project.slug === projectSlug || project.id === projectSlug);
  const routeTargetMissing = !loading && projectMatchesUrl && (() => {
    if (folderIdParam) return !minutes.some(m => m.id.toLowerCase() === folderIdParam.toLowerCase());
    if (minuteIdParam) {
      return !minutes.some(m => m.id === minuteIdParam || toMinuteSlug(m.createdAt) === minuteIdParam);
    }
    return false;
  })();

  // ツリー用の並び。フォルダを先頭に、議事録は従来どおり開催日の新しい順。
  // 各階層の並びは buildDocTree がこの配列順をそのまま引き継ぐ。
  const orderedMinutes = useMemo(() => [...minutes].sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    if (a.isFolder) return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "ja");
    return (b.meetingDate || "").localeCompare(a.meetingDate || "")
      || (b.createdAt || "").localeCompare(a.createdAt || "");
  }), [minutes]);
  const tree = useMemo(() => buildDocTree(orderedMinutes), [orderedMinutes]);
  const minuteCount = useMemo(() => minutes.filter(m => !m.isFolder).length, [minutes]);
  const minuteById = useMemo(() => new Map(minutes.map(m => [m.id, m])), [minutes]);

  // パンくず用：選択中の祖先フォルダ一覧
  const ancestors = useMemo(() => {
    if (!selected) return [];
    const list: MeetingMinute[] = [];
    let current: MeetingMinute | undefined = selected;
    while (current?.parentId) {
      const parent: MeetingMinute | undefined = minuteById.get(current.parentId);
      if (!parent) break;
      list.unshift(parent);
      current = parent;
    }
    return list;
  }, [selected, minuteById]);

  const gotoMinute = useCallback((m: MeetingMinute) => {
    navigate(`/${projectSlug ?? project?.slug}/minutes/${toMinuteSlug(m.createdAt) || m.id}`);
  }, [navigate, projectSlug, project?.slug]);

  const gotoFolder = useCallback((id: string) => {
    navigate(`/${projectSlug ?? project?.slug}/minutes/folders/${id}`);
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

  useEffect(() => {
    setTitle(selected?.title ?? "");
    setMeetingDate(selected?.meetingDate ?? "");
    setAttendees(selected?.attendees ?? []);
    setContent(selected?.content ?? "");
    setImages(selected?.images ?? []);
    setShowExternalInput(false);
    setExternalInput("");
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const scheduleSave = useCallback((patch: Partial<{ title: string; meetingDate: string; attendees: string[]; content: string }>, immediate = false) => {
    if (!selectedId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const titleChanged = patch.title !== undefined && minutes.find(m => m.id === selectedId)?.title !== patch.title;
    const pid = project?.id;
    const run = async () => {
      await supabase!.from("meeting_minutes").update({
        title: patch.title, meeting_date: patch.meetingDate, attendees: patch.attendees, content: patch.content,
        updated_at: new Date().toISOString(),
      }).eq("id", selectedId);
      setMinutes(prev => prev.map(m => m.id === selectedId ? { ...m, ...patch } as MeetingMinute : m));
      // タイトルが変わったときだけ、他タブのサジェスト表示名を更新させる
      if (titleChanged) emitLinkItemsChanged(pid, "minute");
    };
    // ⌘/Ctrl + Enter の確定は自動保存(600ms待ち)を待たずに即書き込む
    if (immediate) void run();
    else saveTimer.current = setTimeout(run, 600);
  }, [selectedId, minutes, project?.id]);

  const handleImagesChange = useCallback(async (next: string[]) => {
    if (!selectedId) return;
    setImages(next);
    setMinutes(prev => prev.map(m => m.id === selectedId ? { ...m, images: next } : m));
    if (isSupabaseEnabled) {
      await supabase!.from("meeting_minutes").update({ images: next, updated_at: new Date().toISOString() }).eq("id", selectedId);
    }
  }, [selectedId]);

  const handleAdd = async (parentId: string | null = null) => {
    if (!project) return;
    const id = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    const { data: inserted, error } = await supabase!.from("meeting_minutes").insert({
      id, project_id: project.id, parent_id: parentId,
      title: "新規議事録", meeting_date: today, attendees: [], content: "",
      created_by: userName || null,
    }).select("created_at").single();
    if (error) { toast("議事録の作成に失敗しました", "error"); return; }
    await load();
    emitLinkItemsChanged(project.id, "minute"); // 他タブの $ サジェストへ即時反映
    const slug = toMinuteSlug(inserted?.created_at) || id;
    navigate(`/${projectSlug ?? project?.slug}/minutes/${slug}`);
    flashCreated([id]);
  };

  // ── フォルダ（Wikiと同仕様） ─────────────────────────────────
  const handleAddFolder = async (parentId: string | null = null) => {
    if (!project) return;
    const id = crypto.randomUUID();
    const { error } = await supabase!.from("meeting_minutes").insert({
      id, project_id: project.id, parent_id: parentId,
      title: "無題のフォルダ", is_folder: true, attendees: [], content: "",
      sort_order: minutes.filter(m => m.parentId === parentId).length,
      created_by: userName || null,
    });
    if (error) {
      console.error("[MinutesPage] folder insert error:", error);
      toast("フォルダの作成に失敗しました", "error");
      return;
    }
    await load();
    gotoFolder(id);
    flashCreated([id]);
  };

  const handleRenameNode = useCallback(async (id: string, nextTitle: string) => {
    setMinutes(prev => prev.map(m => m.id === id ? { ...m, title: nextTitle } : m));
    if (id === selectedId) setTitle(nextTitle);
    const { error } = await supabase!.from("meeting_minutes")
      .update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      console.error("[MinutesPage] rename error:", error);
      toast("名前の変更に失敗しました", "error");
      load();
      return;
    }
    emitLinkItemsChanged(project?.id, "minute"); // 他タブのサジェスト表示名を更新
  }, [selectedId, project?.id, load, toast]);

  const handleMoveNode = useCallback(async (draggedId: string, targetParentId: string | null) => {
    if (draggedId === targetParentId) return;
    const dragged = minutes.find(m => m.id === draggedId);
    if (!dragged || dragged.parentId === targetParentId) return;
    if (isCyclicMove(minutes, draggedId, targetParentId)) {
      toast("フォルダを自身の子孫フォルダ配下に移動することはできません", "error");
      return;
    }
    const sortOrder = minutes.filter(m => m.parentId === targetParentId).length;
    setMinutes(prev => prev.map(m => m.id === draggedId ? { ...m, parentId: targetParentId, sortOrder } : m));
    const { error } = await supabase!.from("meeting_minutes")
      .update({ parent_id: targetParentId, sort_order: sortOrder, updated_at: new Date().toISOString() })
      .eq("id", draggedId);
    if (error) {
      console.error("[MinutesPage] move error:", error);
      toast("移動に失敗しました", "error");
    } else {
      toast("配置を変更しました");
    }
    load();
  }, [minutes, load, toast]);

  const copyShareLink = useCopyShareLink(projectSlug ?? project?.slug);

  // フォルダはフォルダのURL、議事録は一覧と同じ yyyymmdd-hhmmss スラグでリンクを発行する
  const handleCopyLink = useCallback((node: { id: string; isFolder: boolean }) => {
    if (node.isFolder) { void copyShareLink({ kind: "minute-folder", id: node.id }); return; }
    const m = minuteById.get(node.id);
    void copyShareLink({ kind: "minute", id: toMinuteSlug(m?.createdAt) || node.id });
  }, [copyShareLink, minuteById]);

  // ── MDファイル取り込み（単体 / 一括） ──────────────────────────
  // 1ファイル = 1議事録。タイトル・開催日・出席者は本文の前置きから拾い、
  // 残りはすべて本文（貼り付けと同じ変換経路なので見出し・表・コードブロックまで揃う）。
  const handleImportMdFiles = useCallback(async (files: File[]) => {
    if (!project || files.length === 0) return;
    setMdImportProgress({ done: 0, total: files.length });

    const { minutes: imported, skipped } = await readMinutesMarkdownFiles(
      files, project.members ?? [], (done, total) => setMdImportProgress({ done, total }),
    );

    if (imported.length === 0) {
      setMdImportProgress(null);
      toast(skipped[0]?.reason ?? "取り込める内容がありませんでした", "error");
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const rows = imported.map(m => ({
      id: crypto.randomUUID(), project_id: project.id,
      title: m.title, meeting_date: m.meetingDate || today,
      attendees: m.attendees, content: m.content,
      created_by: userName || null,
    }));

    const { data: inserted, error } = await supabase!.from("meeting_minutes").insert(rows).select("id, created_at");
    setMdImportProgress(null);
    if (error) {
      console.error("[MinutesPage] md import insert error:", error);
      toast("議事録の作成に失敗しました", "error");
      return;
    }

    await load();
    emitLinkItemsChanged(project.id, "minute"); // 他タブの $ サジェストへ即時反映
    toast(`${rows.length}件の議事録を作成しました${skipped.length ? `（${skipped.length}件はスキップ）` : ""}`);
    const first = (inserted ?? []).find(r => r.id === rows[0].id);
    navigate(`/${projectSlug ?? project.slug}/minutes/${toMinuteSlug(first?.created_at) || rows[0].id}`);
  }, [project, userName, load, toast, navigate, projectSlug]);

  const handleMdInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    // 同じファイルを続けて選び直せるように値をクリアする
    e.target.value = "";
    if (picked.length > 0) void handleImportMdFiles(picked);
  };

  const handleDelete = async (m: MeetingMinute) => {
    await supabase!.from("meeting_minutes").delete().eq("id", m.id);
    emitLinkItemsChanged(project?.id, "minute");
    // フォルダを消すと配下も消える(cascade)ので、選択中が子孫なら選択を外す
    const isSelectionGone = selectedId === m.id
      || (!!selectedId && isCyclicMove(minutes, m.id, selectedId));
    if (isSelectionGone) {
      setSelectedId(null);
      navigate(`/${projectSlug ?? project?.slug}/minutes`);
    }
    toast(`「${m.title || (m.isFolder ? "無題のフォルダ" : "新規議事録")}」を削除しました`);
    load();
  };

  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;
  if (!loading && effectiveMinutesPerm === "none") return <NotFoundView kind="no-permission" label="議事録" />;
  if (routeTargetMissing) return (
    <NotFoundView kind="resource" label={folderIdParam ? "フォルダ" : "議事録"}
      backTo={{ label: "議事録一覧へ", to: `/${projectSlug ?? project?.slug}/minutes` }} />
  );

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <style>{"@keyframes minutes-md-spin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>議事録</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${minuteCount} 件` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {permsLoaded && effectiveMinutesPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="minutes" marginBottom={0} minutesPerm={effectiveMinutesPerm} wikiPerm={effectiveWikiPerm} backlogPerm={effectiveBacklogPerm} whiteboardPerm={effectiveWhiteboardPerm} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, height: "calc(100vh - 175px)", overflow: "hidden" }}>
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
            padding: 10, overflowY: "auto", transition: "all 0.15s",
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
            <>
              {/* MD取り込み用の隠しinput。単体/一括で multiple だけが違う。 */}
              <input ref={singleMdInputRef} type="file" accept={MINUTES_MD_ACCEPT} onChange={handleMdInputChange} style={{ display: "none" }} />
              <input ref={bulkMdInputRef} type="file" accept={MINUTES_MD_ACCEPT} multiple onChange={handleMdInputChange} style={{ display: "none" }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild disabled={!!mdImportProgress}>
                    <button
                      style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: mdImportProgress ? "default" : "pointer" }}>
                      {mdImportProgress ? (
                        <>
                          <Loader2 style={{ width: 12, height: 12, animation: "minutes-md-spin 1s linear infinite" }} />
                          取り込み中 {mdImportProgress.done}/{mdImportProgress.total}
                        </>
                      ) : (
                        <>
                          <Plus style={{ width: 12, height: 12 }} />新規議事録
                          <ChevronDown style={{ width: 11, height: 11 }} />
                        </>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" style={{ minWidth: 190 }}>
                    <DropdownMenuItem onSelect={() => handleAdd(null)}>
                      <FileText style={{ width: 14, height: 14 }} />新規議事録を作成
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => singleMdInputRef.current?.click()}>
                      <FileUp style={{ width: 14, height: 14 }} />MDファイルから作成
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => bulkMdInputRef.current?.click()}>
                      <Upload style={{ width: 14, height: 14 }} />一括MD取り込み
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button onClick={() => handleAddFolder(null)}
                  title="新規フォルダ"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, padding: "7px 10px", background: "#FFFBEB", color: "#D97706", border: "1.5px solid #FDE68A", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <FolderPlus style={{ width: 13, height: 13 }} />
                </button>
              </div>
            </>
          )}

          {sidebarSearch ? (
            (() => {
              // 検索中はフォルダ階層をたたんで、一致した議事録だけを平らに並べる（Wikiと同仕様）
              const q = sidebarSearch.toLowerCase();
              const matched = minutes.filter(m => !m.isFolder
                && ((m.title || "").toLowerCase().includes(q) || (m.content ?? "").toLowerCase().includes(q)));
              if (matched.length === 0) return (
                <div style={{ padding: "24px 8px", textAlign: "center" }}>
                  <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>「{sidebarSearch}」に一致する議事録がありません</p>
                </div>
              );
              return matched.map(m => {
                const parent = m.parentId ? minuteById.get(m.parentId) : null;
                const isSelected = selectedId === m.id;
                return (
                  <div key={m.id} onClick={() => gotoMinute(m)}
                    style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "7px 8px", borderRadius: 7, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 1 }}>
                    <FileText style={{ width: 12, height: 12, color: isSelected ? "#059669" : "#B0A9A4", flexShrink: 0, marginTop: 1 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.title || "新規議事録"}</div>
                      <div style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1 }}>
                        {formatDate(m.meetingDate)}{parent ? ` · ${parent.title || "無題のフォルダ"}` : ""}
                      </div>
                    </div>
                  </div>
                );
              });
            })()
          ) : tree.length === 0 ? (
            <div style={{ padding: "24px 8px", textAlign: "center" }}>
              <FileText style={{ width: 24, height: 24, color: "#D4CEC8", margin: "0 auto 8px" }} />
              <p style={{ fontSize: 11, color: "#B0A9A4", margin: 0 }}>議事録がありません</p>
            </div>
          ) : (
            <DocTree
              tree={tree}
              selectedId={selectedId}
              canEdit={canEdit}
              onSelect={(node: DocTreeNode) => {
                if (node.isFolder) gotoFolder(node.id);
                else {
                  const m = minuteById.get(node.id);
                  if (m) gotoMinute(m);
                }
              }}
              onAddChild={(parentId, isFolder) => { if (isFolder) handleAddFolder(parentId); else handleAdd(parentId); }}
              addItemLabel="議事録を追加"
              onRename={handleRenameNode}
              onDelete={node => { const m = minuteById.get(node.id); if (m) setDeleteTarget(m); }}
              onMove={handleMoveNode}
              onOpenMoveModal={node => { const m = minuteById.get(node.id); if (m) setMovingNodeTarget(m); }}
              onCopyLink={handleCopyLink}
              highlightIds={highlightIds}
              scrollToId={scrollToId}
              renderItemRow={(node, isSelected) => {
                const m = minuteById.get(node.id);
                const pending = pendingActionsByMinute[node.id] ?? 0;
                return (
                  <>
                    <FileText style={{ width: 12, height: 12, color: isSelected ? "#059669" : "#B0A9A4", flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: isSelected ? 700 : 500, color: isSelected ? "#059669" : "#1A1714", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.title || "新規議事録"}</p>
                      <p style={{ fontSize: 10, color: "#B0A9A4", margin: 0 }}>{formatDate(m?.meetingDate ?? "")}</p>
                    </div>
                    {pending > 0 && (
                      <span title={`未完了アクション ${pending} 件`}
                        style={{ width: 7, height: 7, borderRadius: "50%", background: "#F59E0B", flexShrink: 0 }} />
                    )}
                  </>
                );
              }}
            />
          )}
        </div>

        <div style={{ flex: 1, minWidth: 0, background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {!selected ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FileText style={{ width: 32, height: 32, color: "#D4CEC8", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>左の一覧から議事録を選択するか、新規作成してください</p>
            </div>
          ) : selected.isFolder ? (
            <div style={{ padding: "60px 0", textAlign: "center" }}>
              <FolderOpen style={{ width: 32, height: 32, color: "#FCD34D", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: "0 0 6px" }}>{selected.title || "無題のフォルダ"}</p>
              <p style={{ fontSize: 12, color: "#B0A9A4", margin: "0 0 16px" }}>
                {minutes.filter(m => m.parentId === selected.id).length} 件のアイテム
              </p>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button onClick={() => handleCopyLink(selected)}
                  style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                  <Link2 style={{ width: 13, height: 13 }} />リンクをコピー
                </button>
                {canEdit && (
                  <button onClick={() => handleAdd(selected.id)}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", background: "#FFFFFF", color: "#6B6458", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                    <Plus style={{ width: 13, height: 13 }} />このフォルダに議事録を追加
                  </button>
                )}
              </div>
            </div>
          ) : (
            <>
              {/* 固定ヘッダー: タイトル・削除・開催日・出席者 */}
              <div style={{ padding: "20px 20px 12px", flexShrink: 0, borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                {ancestors.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#9E9690", marginBottom: 8, flexWrap: "wrap" }}>
                    <span onClick={() => { setSelectedId(null); navigate(`/${projectSlug ?? project?.slug}/minutes`); }} style={{ color: "#059669", cursor: "pointer", fontWeight: 600 }}>議事録ホーム</span>
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
                    value={title} disabled={!canEdit}
                    onChange={e => { setTitle(e.target.value); scheduleSave({ title: e.target.value, meetingDate, attendees, content }); }}
                    placeholder="議事録タイトル"
                    style={{ flex: 1, boxSizing: "border-box", border: "none", outline: "none", fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", padding: 0 }} />
                  <button onClick={() => handleCopyLink(selected)} title="この議事録へのリンクをコピー"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, flexShrink: 0, display: "flex", alignItems: "center" }}>
                    <Link2 style={{ width: 14, height: 14 }} />
                  </button>
                  <ArticleExportButton onExport={f => exportMinuteArticle(selected, f)} />
                  {canEdit && (
                    <button onClick={() => setDeleteTarget(selected)} style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, flexShrink: 0 }}>
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 3 }}>開催日</label>
                    <input type="date" value={meetingDate} disabled={!canEdit}
                      onChange={e => { setMeetingDate(e.target.value); scheduleSave({ title, meetingDate: e.target.value, attendees, content }); }}
                      style={{ padding: "6px 10px", fontSize: 12, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", display: "flex", alignItems: "center", gap: 4, marginBottom: 3 }}><Users style={{ width: 10, height: 10 }} />出席者</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                      {(project?.members ?? []).map(member => {
                        const active = attendees.includes(member);
                        return (
                          <button key={member} disabled={!canEdit}
                            onClick={() => {
                              const next = active ? attendees.filter(a => a !== member) : [...attendees, member];
                              setAttendees(next);
                              scheduleSave({ title, meetingDate, attendees: next, content });
                            }}
                            style={{ padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: canEdit ? "pointer" : "default", border: `1.5px solid ${active ? "#059669" : "rgba(26,23,20,0.1)"}`, background: active ? "#ECFDF5" : "transparent", color: active ? "#059669" : "#9E9690" }}>
                            {member}
                          </button>
                        );
                      })}
                      {attendees.filter(a => !(project?.members ?? []).includes(a)).map(external => (
                        <span key={external} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", fontSize: 11, fontWeight: 600, borderRadius: 20, border: "1.5px solid #059669", background: "#ECFDF5", color: "#059669" }}>
                          {external}
                          {canEdit && (
                            <button onClick={() => {
                              const next = attendees.filter(a => a !== external);
                              setAttendees(next);
                              scheduleSave({ title, meetingDate, attendees: next, content });
                            }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", color: "#059669" }}>
                              <X style={{ width: 10, height: 10 }} />
                            </button>
                          )}
                        </span>
                      ))}
                      {canEdit && !showExternalInput && (
                        <button onClick={() => setShowExternalInput(true)}
                          style={{ width: 22, height: 22, borderRadius: "50%", border: "1.5px dashed rgba(26,23,20,0.2)", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#9E9690" }}>
                          <Plus style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                      {canEdit && showExternalInput && (
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input
                            autoFocus
                            value={externalInput}
                            onChange={e => setExternalInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === "Enter" && !e.nativeEvent.isComposing && externalInput.trim()) {
                                const name = externalInput.trim();
                                if (!attendees.includes(name)) {
                                  const next = [...attendees, name];
                                  setAttendees(next);
                                  scheduleSave({ title, meetingDate, attendees: next, content });
                                }
                                setExternalInput("");
                                setShowExternalInput(false);
                              } else if (e.key === "Escape") {
                                setExternalInput("");
                                setShowExternalInput(false);
                              }
                            }}
                            placeholder="名前を入力..."
                            style={{ padding: "3px 8px", fontSize: 11, border: "1.5px solid #059669", borderRadius: 20, outline: "none", fontFamily: "inherit", width: 100 }}
                          />
                          <button onClick={() => {
                            const name = externalInput.trim();
                            if (name && !attendees.includes(name)) {
                              const next = [...attendees, name];
                              setAttendees(next);
                              scheduleSave({ title, meetingDate, attendees: next, content });
                            }
                            setExternalInput("");
                            setShowExternalInput(false);
                          }} style={{ padding: "3px 8px", fontSize: 11, fontWeight: 600, background: "#059669", color: "#fff", border: "none", borderRadius: 20, cursor: "pointer" }}>追加</button>
                          <button onClick={() => { setExternalInput(""); setShowExternalInput(false); }}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "#9E9690" }}>
                            <X style={{ width: 11, height: 11 }} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              {/* エディター + アクション項目（内部でスクロール） */}
              <div style={{ flex: 1, minHeight: 0, overflow: "hidden", padding: "12px 20px 16px", display: "flex", flexDirection: "column" }}>
                <RichEditor value={content} readOnly={!canEdit}
                  onChange={v => { setContent(v); scheduleSave({ title, meetingDate, attendees, content: v }); }}
                  onSubmit={() => { if (canEdit) scheduleSave({ title, meetingDate, attendees, content }, true); }}
                  placeholder="議事内容を入力..." members={project?.members ?? []} minHeight={120}
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
                  onImageUpload={canEdit ? async (file) => {
                    if (plan.maxImagesPerItem !== null) {
                      const currentCount = (content.match(/<img/g) ?? []).length;
                      if (currentCount >= plan.maxImagesPerItem) { toast("現在のプランではこれ以上添付できません", "error"); return ""; }
                    }
                    if (!isSupabaseEnabled) return URL.createObjectURL(file);
                    const extMap: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
                    const ext = extMap[file.type] ?? "png";
                    const path = `minutes/${selected.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
                    const { data, error } = await supabase!.storage.from("ticket-images").upload(path, file, { upsert: true, contentType: file.type });
                    if (error || !data) return "";
                    return supabase!.storage.from("ticket-images").getPublicUrl(path).data.publicUrl;
                  } : undefined} />
                <ActionItemsPanel minuteId={selected.id} projectId={project.id} projectSlug={projectSlug ?? project.slug} members={project.members} canEdit={canEdit} onPendingCountChange={handlePendingCountChange} />
              </div>
            </>
          )}
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isFolder ? "フォルダの削除" : "議事録の削除"}
          message={deleteTarget.isFolder
            ? `「${deleteTarget.title || "無題のフォルダ"}」を削除します。フォルダ内の議事録も一緒に削除されます。`
            : `「${deleteTarget.title || "新規議事録"}」を削除します。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}

      {/* Googleドライブ風のフォルダ階層一覧選択移動モーダル */}
      {movingNodeTarget && (
        <FolderMoveModal
          node={movingNodeTarget}
          items={minutes}
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
