// ENHA2-032 タスク管理の本体。
//
// サイドバーの「タスク」（横断）と、プロジェクト配下の「タスク」の2つの入口が
// どちらもこのコンポーネントを描く。違いは scope と projectId だけ。
//
// データの流れは本アプリの他ページと同じ「マウント時に1回 fetch ＋ 楽観更新」。
// ヘッダーの更新ボタン（RefreshContext）はページごと再マウントするので、
// ここに購読やポーリングは要らない。
//
// 編集は詳細パネルを開かず、リストの行の中で完結する（TaskListView）。
// かんばん／ガントで押されたタスクは、編集できるリストへ送って行に目印を付ける。
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CheckSquare, FileText, Plus, Search, X, List, LayoutGrid, GanttChartSquare, RefreshCw, Layers, User, UserCheck, Users } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { TaskListView } from "@/app/components/tasks/TaskListView";
import { TaskBoardView, type TaskDropHandler } from "@/app/components/tasks/TaskBoardView";
import { TaskGanttView } from "@/app/components/tasks/TaskGanttView";
import { TaskQuickAddRow } from "@/app/components/tasks/TaskQuickAddRow";
import { MdTaskImportDialog } from "@/app/components/tasks/MdTaskImportDialog";
import { TaskShareDialog } from "@/app/components/tasks/TaskShareDialog";
import { PickerCell, MultiPickerCell } from "@/app/components/tasks/TaskPickerCell";
import {
  loadTasks, loadTaskProjects, loadTaskMembers, loadTaskShareMap, loadTaskShares,
  createTask, createSubtask, updateTask, deleteTask, syncAssigneeShare,
  addTaskShare, removeTaskShare,
  computeSortOrder, renumberColumn, SORT_GAP,
  type NewTaskInput, type ProjectOption, type MemberOption,
} from "@/app/lib/taskService";
import { notifyTaskAssigned, notifyTaskShared } from "@/app/lib/taskNotify";
import type { Task, TaskShare, TaskStatus, TaskView } from "@/app/types";

type OwnerFilter = "all" | "assigned" | "mine" | "shared";

const VIEWS: { value: TaskView; label: string; icon: React.ElementType }[] = [
  { value: "list",  label: "リスト",   icon: List },
  { value: "board", label: "かんばん", icon: LayoutGrid },
  { value: "gantt", label: "ガント",   icon: GanttChartSquare },
];

function viewStorageKey(scopeKey: string) { return `dt.taskView.${scopeKey}`; }

/**
 * 横断ビューのタブ（BRU11-046）。
 * 「自分に振られたもの」「自分が作ったもの」「人から共有されたもの」は目的がまるで違うので、
 * フィルタのプルダウンではなくタブで切り替える（いまどちらを見ているかが常に見える）。
 *
 * タブは互いに排他ではない。
 * 他人が作ったタスクを自分が担当していれば「自分に振られた」と「共有された」の両方に出る。
 */
const OWNER_TABS: { value: OwnerFilter; label: string; icon: React.ElementType }[] = [
  { value: "all",      label: "すべて",             icon: Layers },
  { value: "assigned", label: "自分に振られたタスク", icon: UserCheck },
  { value: "mine",     label: "自分が作成したタスク", icon: User },
  { value: "shared",   label: "共有されたタスク",     icon: Users },
];

export function TaskWorkspace({
  scopeKey, projectId = null, projectSlug, title, subtitle, initialTaskId, onConsumeInitialTask,
}: {
  /** ビュー選択の保存キー。横断は "all"、プロジェクト配下は projectId */
  scopeKey: string;
  /** プロジェクト配下ならその id。null なら横断ビュー */
  projectId?: string | null;
  projectSlug?: string;
  title: string;
  subtitle?: string;
  /** お知らせから飛んできたときに開くタスク */
  initialTaskId?: string | null;
  onConsumeInitialTask?: () => void;
}) {
  const { userId, userName, userRole, userOrgId } = useAuth();
  const { toast } = useToast();
  const isProjectScope = !!projectId;
  const isAdminRole = userRole === "owner" || userRole === "admin" || userRole === "project-manager";

  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [members, setMembers] = useState<MemberOption[]>([]);
  // taskId → 共有相手。自分が持っているタスクは全件、他人のタスクは自分の行だけ入る（RLS）
  const [shareMap, setShareMap] = useState<Record<string, TaskShare[]>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [view, setView] = useState<TaskView>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(viewStorageKey(scopeKey)) : null;
    return (saved === "board" || saved === "gantt" || saved === "list") ? saved : "list";
  });
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [projectFilter, setProjectFilter] = useState("");   // "" = すべて / "none" = 個人 / id
  // 担当者は複数選べる（空 = すべて）。"@me" = 自分 / "@none" = 未割当 / それ以外は名前。
  // 複数選んだときは「どれかに当てはまる」（OR）で絞る
  const [assigneeFilters, setAssigneeFilters] = useState<string[]>([]);
  // 完了しても一覧から消さない（どれだけ片付いたか分からなくなるため）。
  // 溜まって邪魔になった人だけが明示的に隠す。
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState("");

  // 詳細パネルは持たない（行の中で直接直す）。
  // これは「かんばん／ガント／お知らせから飛んできた行」に色を付けて送るための目印
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  // 共有ダイアログを開いているタスク。行を編集しても中身が古くならないよう id で持つ
  const [shareTargetId, setShareTargetId] = useState<string | null>(null);
  // ヘッダーの「タスクを追加」から、表の追加行へフォーカスを飛ばすための合図
  const [addFocus, setAddFocus] = useState(0);
  const [showMdImport, setShowMdImport] = useState(false);

  useEffect(() => { localStorage.setItem(viewStorageKey(scopeKey), view); }, [view, scopeKey]);

  // ── 読み込み ────────────────────────────────────────────────
  const reload = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true); else setRefreshing(true);
    const [t, shares] = await Promise.all([loadTasks(projectId), loadTaskShareMap()]);
    setTasks(t);
    setShareMap(shares);
    if (spinner) setLoading(false); else setRefreshing(false);
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    let alive = true;
    Promise.all([
      loadTaskProjects(userName, isAdminRole),
      loadTaskMembers(userOrgId),
    ]).then(([p, m]) => { if (alive) { setProjects(p); setMembers(m); } });
    return () => { alive = false; };
  }, [userName, isAdminRole, userOrgId]);

  // お知らせからの着地（?task=...）
  useEffect(() => {
    if (!initialTaskId || tasks.length === 0) return;
    const hit = tasks.find(t => t.id === initialTaskId);
    if (hit) {
      // 編集できるのはリストだけなので、そこへ送って行に色を付ける
      setView("list");
      setHighlightId(hit.id);
      // 完了を隠している最中でも開けるようにする
      if (hit.status === "done") setHideDone(false);
    } else {
      toast("タスクが見つかりません（削除されたか、権限がありません）", "error");
    }
    onConsumeInitialTask?.();
  }, [initialTaskId, tasks, onConsumeInitialTask, toast]);

  // ── 表示用の絞り込み ────────────────────────────────────────
  const projectNameOf = useCallback((id: string | null) => {
    if (!id) return "";
    return projects.find(p => p.id === id)?.name ?? "プロジェクト";
  }, [projects]);

  const parentTitleOf = useCallback((id: string | null) => {
    if (!id) return "";
    return tasks.find(t => t.id === id)?.title ?? "";
  }, [tasks]);

  const projectSlugOf = useCallback((id: string | null) => {
    if (!id) return projectSlug ?? "";
    return projects.find(p => p.id === id)?.slug ?? (projectSlug ?? "");
  }, [projects, projectSlug]);

  /** そのPJにアサインされている人の名前。共有ダイアログの一括公開に渡す */
  const projectMembersOf = useCallback((id: string | null) => {
    if (!id) return [];
    return projects.find(p => p.id === id)?.members ?? [];
  }, [projects]);

  /**
   * タブ（自分／共有）以外の条件だけで絞ったもの。
   * タブの件数バッジはこれを数える＝「そのタブに切り替えたら何件見えるか」と一致する。
   */
  const filteredExceptTab = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (hideDone && t.status === "done") return false;
      if (!isProjectScope) {
        if (projectFilter === "none" && t.projectId) return false;
        if (projectFilter && projectFilter !== "none" && t.projectId !== projectFilter) return false;
      }
      // 複数選択のときは「どれかに当てはまれば残す」。1つも選んでいなければ絞らない
      if (assigneeFilters.length > 0 && !assigneeFilters.some(f =>
        f === "@me" ? t.assignee === userName
          : f === "@none" ? !t.assignee
            : t.assignee === f)) return false;
      if (q
        && !t.title.toLowerCase().includes(q)
        && !t.description.toLowerCase().includes(q)
        && !t.categories.some(c => c.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [tasks, hideDone, isProjectScope, projectFilter, assigneeFilters, search, userName]);

  /**
   * タブの条件。互いに排他ではない（担当も共有もされていれば両方に出る）。
   *   assigned = 自分が担当者（他人が作ったものも含む）
   *   mine     = 自分が作成した
   *   shared   = 他の人が作成して自分に見えている（共有された／PJで見えている）
   */
  const matchTab = useCallback((t: Task, tab: OwnerFilter) => {
    if (tab === "assigned") return t.assignee === userName;
    if (tab === "mine") return t.ownerId === userId;
    if (tab === "shared") return t.ownerId !== userId;
    return true;
  }, [userId, userName]);

  const visible = useMemo(
    () => (isProjectScope ? filteredExceptTab : filteredExceptTab.filter(t => matchTab(t, ownerFilter))),
    [filteredExceptTab, isProjectScope, ownerFilter, matchTab]);

  const tabCounts = useMemo(() => ({
    all:      filteredExceptTab.length,
    assigned: filteredExceptTab.filter(t => matchTab(t, "assigned")).length,
    mine:     filteredExceptTab.filter(t => matchTab(t, "mine")).length,
    shared:   filteredExceptTab.filter(t => matchTab(t, "shared")).length,
  }), [filteredExceptTab, matchTab]);

  const doneCount = useMemo(() => tasks.filter(t => t.status === "done").length, [tasks]);

  /** 分類の候補。既に使われている値をそのまま出す（自由入力なのでマスタは持たない） */
  const categoryOptions = useMemo(
    () => Array.from(new Set(tasks.flatMap(t => t.categories).filter(Boolean))).sort(),
    [tasks],
  );

  /**
   * 編集できるか。
   *   所有者 / プロジェクトタスク（PJメンバー）/ 編集可で共有された人
   * RLS の tasks_update と同じ条件。
   */
  const canEdit = useCallback((t: Task) => {
    if (t.ownerId === userId) return true;
    if (t.projectId) return true;
    return shareMap[t.id]?.some(s => s.profileId === userId && s.canEdit) === true;
  }, [userId, shareMap]);

  /** 消せるのは持ち主だけ（サブタスクも一緒に消えるため） */
  const canDelete = useCallback((t: Task) => t.ownerId === userId, [userId]);

  /** 共有を付け外しできるのも持ち主だけ（RLS の task_shares_write と同じ） */
  const canShare = useCallback((t: Task) => t.ownerId === userId, [userId]);

  /** いま何人に共有しているか。持ち主にしか正しく出せない（RLS で他人の行が見えないため） */
  const shareCountOf = useCallback((t: Task) => shareMap[t.id]?.length ?? 0, [shareMap]);

  // ── 共有 ────────────────────────────────────────────────────
  /**
   * そのタスクの共有相手を引き直して手元へ入れる。
   * 持ち主のときだけ呼ぶこと（他人のタスクだと RLS で自分の行しか返らず、人数を取り違える）。
   */
  const refreshShares = useCallback(async (taskId: string) => {
    const list = await loadTaskShares(taskId);
    setShareMap(prev => ({ ...prev, [taskId]: list }));
  }, []);

  /**
   * 選んだ相手へまとめて共有を張る（1人でも配列で来る）。
   * 1件でも失敗したら、成功したぶんだけを手元へ入れて残りは知らせる
   * （全部やり直させるより、誰に張れたかが分かるほうが混乱しない）。
   */
  const handleAddShares = useCallback(async (task: Task, targets: MemberOption[], canEditFlag: boolean) => {
    if (targets.length === 0) return;
    const results = await Promise.all(
      targets.map(async m => ({ m, ok: await addTaskShare(task.id, m.id, canEditFlag) })),
    );
    const added = results.filter(r => r.ok).map(r => r.m);
    const failed = results.filter(r => !r.ok).map(r => r.m);

    if (added.length > 0) {
      setShareMap(prev => ({
        ...prev,
        [task.id]: [
          ...(prev[task.id] ?? []),
          ...added.map(m => ({ profileId: m.id, name: m.name, canEdit: canEditFlag })),
        ],
      }));
      // 担当に振ったときと同じお知らせ経路（ベル＋Slack）に乗せる
      const base = { taskId: task.id, taskTitle: task.title, fromUserName: userName, projectSlug: projectSlugOf(task.projectId) };
      await Promise.all(added.map(m => notifyTaskShared(base, m.name, canEditFlag)));
    }

    if (failed.length > 0) {
      toast(`${failed.map(m => m.name).join("、")}さんには共有できませんでした`, "error");
    } else if (added.length === 1) {
      toast(`${added[0].name}さんに共有しました`);
    } else {
      toast(`${added.length}人に共有しました`);
    }
  }, [toast, userName, projectSlugOf]);

  /** 編集可 ⇄ 閲覧のみ。upsert なので同じ addTaskShare で足りる */
  const handleChangeSharePermission = useCallback(async (task: Task, share: TaskShare, canEditFlag: boolean) => {
    const ok = await addTaskShare(task.id, share.profileId, canEditFlag);
    if (!ok) { toast("権限を変更できませんでした", "error"); return; }
    setShareMap(prev => ({
      ...prev,
      [task.id]: (prev[task.id] ?? []).map(s => s.profileId === share.profileId ? { ...s, canEdit: canEditFlag } : s),
    }));
    toast(canEditFlag ? "編集できるようにしました" : "閲覧のみにしました");
  }, [toast]);

  const handleRemoveShare = useCallback(async (task: Task, share: TaskShare) => {
    const ok = await removeTaskShare(task.id, share.profileId);
    if (!ok) { toast("共有を解除できませんでした", "error"); return; }
    setShareMap(prev => ({
      ...prev,
      [task.id]: (prev[task.id] ?? []).filter(s => s.profileId !== share.profileId),
    }));
    // 担当者の共有を外すと「振ったのに相手から見えない」に逆戻りする。黙って外さない
    const name = share.name || members.find(m => m.id === share.profileId)?.name || "";
    if (name && name === task.assignee) {
      toast("共有を解除しました。担当者のままでは相手からこのタスクが見えません", "error");
    } else {
      toast("共有を解除しました");
    }
  }, [toast, members]);

  // ── 更新 ────────────────────────────────────────────────────
  const applyLocal = useCallback((id: string, patch: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  /**
   * 行のセルからの更新はすべてここを通る。
   * 完了時刻の付け外しと、担当を振ったときの共有・お知らせもここでまとめて面倒を見る
   * （詳細パネルが無くなったので、経路はこの1本だけ）。
   */
  const patchTask = useCallback(async (task: Task, patch: Partial<Task>) => {
    if (!canEdit(task)) { toast("このタスクを編集する権限がありません", "error"); return; }
    const full: Partial<Task> = { ...patch };
    if (patch.status !== undefined) {
      // 完了に入った時刻を残す。戻したら消す（ガント／振り返りで使う）
      full.completedAt = patch.status === "done" ? new Date().toISOString() : null;
    }
    applyLocal(task.id, full);
    const ok = await updateTask(task.id, full);
    if (!ok) {
      toast("更新に失敗しました", "error");
      reload(false);
      return;
    }
    // 担当者に指名した相手には自動で共有を張る（振ったのに見えない事故を防ぐ）＋お知らせ
    if (patch.assignee && patch.assignee !== task.assignee) {
      const shared = await syncAssigneeShare(task.id, patch.assignee, members, task.createdBy);
      // 共有バッジの人数を合わせる（引き直せるのは自分が持ち主のときだけ）
      if (shared && task.ownerId === userId) await refreshShares(task.id);
      if (patch.assignee !== userName) {
        await notifyTaskAssigned(
          { taskId: task.id, taskTitle: task.title, fromUserName: userName, projectSlug: projectSlugOf(task.projectId) },
          patch.assignee,
        );
      }
    }
  }, [canEdit, applyLocal, toast, reload, members, userId, userName, projectSlugOf, refreshShares]);

  // かんばんの D&D。落とした位置の前後から新しい sort_order を決める
  const handleDrop = useCallback<TaskDropHandler>(async (taskId, newStatus, beforeId) => {
    const moving = tasks.find(t => t.id === taskId);
    if (!moving) return;
    if (!canEdit(moving)) { toast("このタスクを移動する権限がありません", "error"); return; }

    const col = visible
      .filter(t => t.status === newStatus && t.id !== taskId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = beforeId ? col.findIndex(t => t.id === beforeId) : col.length;
    const at = idx < 0 ? col.length : idx;
    const prev = at > 0 ? col[at - 1].sortOrder : null;
    const next = at < col.length ? col[at].sortOrder : null;

    const so = computeSortOrder(prev, next);
    if (so === null) {
      // 中点が潰れた列は 1024 刻みで採番し直してから取り直す
      const reordered = [...col.slice(0, at), moving, ...col.slice(at)];
      await renumberColumn(reordered);
      await updateTask(taskId, { status: newStatus });
      reload(false);
      return;
    }

    const patch: Partial<Task> = { status: newStatus, sortOrder: so };
    if (newStatus !== moving.status) patch.completedAt = newStatus === "done" ? new Date().toISOString() : null;
    applyLocal(taskId, patch);
    const ok = await updateTask(taskId, patch);
    if (!ok) { toast("移動に失敗しました", "error"); reload(false); }
  }, [tasks, visible, canEdit, applyLocal, toast, reload]);

  const handleDelete = useCallback(async (task: Task) => {
    setPendingDelete(null);
    // 親を消すと DB 側でサブタスクも cascade で消えるので、手元からも一緒に落とす
    setTasks(prev => prev.filter(t => t.id !== task.id && t.parentId !== task.id));
    const ok = await deleteTask(task.id);
    if (!ok) { toast("削除に失敗しました", "error"); reload(false); return; }
    toast("タスクを削除しました");
  }, [toast, reload]);

  const handleCreate = useCallback(async (input: Omit<NewTaskInput, "ownerId" | "createdBy">) => {
    // 同じ列の先頭に積む
    const minSort = tasks
      .filter(t => t.status === (input.status ?? "todo"))
      .reduce<number | null>((min, t) => (min === null || t.sortOrder < min ? t.sortOrder : min), null);
    const created = await createTask({
      ...input,
      ownerId: userId,
      createdBy: userName,
      minSortOrder: minSort ?? SORT_GAP,
    });
    if (!created) { toast("タスクの作成に失敗しました", "error"); return false; }
    setTasks(prev => [created, ...prev]);
    if (created.assignee && created.assignee !== userName) {
      const shared = await syncAssigneeShare(created.id, created.assignee, members, userName);
      if (shared) setShareMap(prev => ({ ...prev, [created.id]: [{ profileId: shared.id, name: shared.name, canEdit: true }] }));
      await notifyTaskAssigned(
        { taskId: created.id, taskTitle: created.title, fromUserName: userName, projectSlug: projectSlugOf(created.projectId) },
        created.assignee,
      );
    }
    // 追加した行がそのまま表に出るので、成功トーストは出さない（連続入力の邪魔になる）
    if (created.status === "done") setHideDone(false);
    return true;
  }, [tasks, userId, userName, members, projectSlugOf, toast]);

  /**
   * サブタスクを足す。可視性（project_id と共有）は親から引き継ぐ（taskService 側）。
   * 子チケットと同じく1階層のみなので、子に対しては呼ばせない。
   */
  const handleCreateSubtask = useCallback(async (
    parent: Task, input: Omit<NewTaskInput, "ownerId" | "createdBy">,
  ) => {
    if (parent.parentId) { toast("サブタスクはさらに分割できません", "error"); return false; }
    if (!canEdit(parent)) { toast("このタスクを編集する権限がありません", "error"); return false; }
    const minSort = tasks
      .filter(t => t.parentId === parent.id)
      .reduce<number | null>((min, t) => (min === null || t.sortOrder < min ? t.sortOrder : min), null);
    const child = await createSubtask(parent, input, userId, userName, minSort ?? SORT_GAP);
    if (!child) { toast("サブタスクの作成に失敗しました", "error"); return false; }
    setTasks(prev => [...prev, child]);
    // 親タスクと同じく、担当に指名した相手には共有とお知らせを回す
    if (child.assignee && child.assignee !== userName) {
      await syncAssigneeShare(child.id, child.assignee, members, userName);
      await notifyTaskAssigned(
        { taskId: child.id, taskTitle: child.title, fromUserName: userName, projectSlug: projectSlugOf(child.projectId) },
        child.assignee,
      );
    }
    // 親の共有をコピーしたうえに担当ぶんも足したので、手元へは引き直して入れる
    await refreshShares(child.id);
    return true;
  }, [tasks, canEdit, userId, userName, members, projectSlugOf, toast, refreshShares]);

  /** いま手元にあるタスクの最小 sort_order。MD取り込みぶんはこれより手前（＝先頭）へ積む */
  const minSortOrder = useMemo(
    () => tasks.reduce<number | null>((min, t) => (min === null || t.sortOrder < min ? t.sortOrder : min), null),
    [tasks],
  );

  /**
   * MDファイルから取り込んだぶんを手元へ足す。
   * sort_order は登録時に一覧の先頭へ来るよう振ってあるので、そのまま前に付ければ
   * 読み込み直したときと同じ並びになる（取り込んだ直後に順番が入れ替わらない）。
   */
  const handleMdImported = useCallback((created: Task[]) => {
    if (created.length === 0) return;
    setTasks(prev => [...created, ...prev]);
    // 取り込みでも担当者ぶんの共有が張られるので、共有バッジを合わせる
    loadTaskShareMap().then(setShareMap);
    if (created.some(t => t.status === "done")) setHideDone(false);
    // ガントは日付のあるタスクしか出ないので、取り込んだものが必ず見えるリストへ寄せる
    setView(v => (v === "gantt" ? "list" : v));
    toast(`${created.length}件のタスクを取り込みました`);
  }, [toast]);

  /** かんばんの列末尾からの追加。プロジェクトは画面のスコープに従う */
  const handleColumnCreate = useCallback((quickTitle: string, status: TaskStatus) =>
    handleCreate({ title: quickTitle, status, projectId, priority: "medium", assignee: "" }),
  [handleCreate, projectId]);

  /**
   * かんばん／ガントで押されたタスクをリストで開く。
   * 編集できるのはリストの行だけなので、そこへ送って目印を付ける。
   */
  const openInList = useCallback((t: Task) => {
    setView("list");
    setHighlightId(t.id);
  }, []);

  // ヘッダーの「タスクを追加」は、モーダルではなく表の追加行へ誘導する
  const focusQuickAdd = useCallback(() => {
    setView(v => (v === "gantt" ? "list" : v));
    setAddFocus(n => n + 1);
  }, []);

  // 共有ダイアログの対象。id で持っているので、開いている間に行を直しても中身が追従する
  // （消えたら null になり、ダイアログはそのまま閉じる）
  const shareTask = shareTargetId ? tasks.find(t => t.id === shareTargetId) ?? null : null;

  // ── 描画 ────────────────────────────────────────────────────
  if (loading) return <PageLoader label="タスクを読み込み中..." />;

  const assigneeNames: string[] = tasks
    .map(t => t.assignee)
    .filter((n, i, all) => n && all.indexOf(n) === i)
    .sort();

  return (
    <div style={{ padding: "0 4px 40px" }}>
      {/* ── ヘッダー ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <CheckSquare style={{ width: 18, height: 18, color: "#059669" }} />
            {title}
          </h1>
          <p style={{ fontSize: 12, color: "#A09790", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
            <span>{subtitle ?? "チケットとは別に、未着手・進行中・完了だけを管理する軽いタスク"}</span>
            {tasks.length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 99, padding: "1px 8px", fontFamily: "var(--font-mono)" }}>
                完了 {doneCount}/{tasks.length}
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={() => reload(false)} disabled={refreshing} title="再読み込み"
            style={{ width: 34, height: 34, borderRadius: 9, border: "1px solid rgba(26,23,20,0.1)", background: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#6B6458" }}>
            <RefreshCw style={{ width: 14, height: 14, animation: refreshing ? "pageloader-spin 0.75s linear infinite" : undefined }} />
          </button>
          <button type="button" onClick={() => setShowMdImport(true)} title="MDファイルからタスクをまとめて作る"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", fontSize: 12.5, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 10, cursor: "pointer" }}>
            <FileText style={{ width: 14, height: 14 }} />MDから作成
          </button>
          <button type="button" onClick={focusQuickAdd}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#FFF", background: "#059669", border: "none", borderRadius: 10, cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
            <Plus style={{ width: 14, height: 14 }} />タスクを追加
          </button>
        </div>
      </div>

      {/* ── タブ（横断ビューのみ） ──
          自分のタスクと、人から共有されたタスクを分けて見るためのもの。
          プロジェクト配下は「そのPJのタスク」しか無いので出さない。 */}
      {!isProjectScope && (
        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid rgba(26,23,20,0.09)", marginBottom: 14 }}>
          {OWNER_TABS.map(({ value, label, icon: Icon }) => {
            const on = ownerFilter === value;
            return (
              <button key={value} type="button" onClick={() => setOwnerFilter(value)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "9px 14px",
                  fontSize: 12.5, fontWeight: on ? 800 : 600, fontFamily: "inherit",
                  border: "none", background: "transparent", cursor: "pointer",
                  color: on ? "#059669" : "#6B6458",
                  borderBottom: on ? "2px solid #059669" : "2px solid transparent",
                  marginBottom: -1,
                }}>
                <Icon style={{ width: 13, height: 13 }} />
                {label}
                <span style={{
                  fontSize: 10, fontWeight: 700, fontFamily: "var(--font-mono)",
                  borderRadius: 99, padding: "1px 7px",
                  color: on ? "#059669" : "#A09790",
                  background: on ? "#ECFDF5" : "#F4F5F6",
                  border: `1px solid ${on ? "#A7F3D0" : "rgba(26,23,20,0.06)"}`,
                }}>
                  {tabCounts[value]}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* ── ビュー切替＋フィルタ ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 3, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, padding: 3 }}>
          {VIEWS.map(({ value, label, icon: Icon }) => (
            <button key={value} type="button" onClick={() => setView(value)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer", background: view === value ? "#059669" : "transparent", color: view === value ? "#FFF" : "#6B6458" }}>
              <Icon style={{ width: 12, height: 12 }} />{label}
            </button>
          ))}
        </div>

        {!isProjectScope && (
          <PickerCell variant="chip" width={168} value={projectFilter} title="プロジェクト"
            options={[
              { value: "", label: "すべてのPJ" },
              { value: "none", label: "個人タスク" },
              ...projects.map(p => ({ value: p.id, label: p.name })),
            ]}
            onChange={setProjectFilter} />
        )}

        <MultiPickerCell width={160} values={assigneeFilters} title="担当者（複数選べます）"
          emptyLabel="担当: すべて" showSelectAll={false}
          options={[
            { value: "@me", label: "自分の担当" },
            { value: "@none", label: "未割当" },
            ...assigneeNames.filter(n => n !== userName).map(n => ({ value: n, label: n })),
          ]}
          onChange={setAssigneeFilters} />

        {/* 標準のチェックボックスはOSごとに見た目が違うので自前で描く */}
        <button type="button" onClick={() => setHideDone(v => !v)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: "#6B6458", cursor: "pointer", padding: "7px 10px", background: "#FFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8, fontFamily: "inherit" }}>
          <span style={{
            width: 14, height: 14, borderRadius: 4, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: hideDone ? "#059669" : "#FFF",
            border: hideDone ? "none" : "1.5px solid rgba(26,23,20,0.18)",
          }}>
            {hideDone && <Check style={{ width: 10, height: 10, color: "#FFF" }} />}
          </span>
          完了を隠す
        </button>

        <div style={{ position: "relative", marginLeft: "auto" }}>
          <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "#B0A9A4" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="タスクを検索"
            style={{ padding: "7px 26px 7px 26px", fontSize: 11.5, color: "#1A1714", background: "#FFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8, outline: "none", width: 190 }} />
          {search && (
            <button type="button" onClick={() => setSearch("")}
              style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", border: "none", background: "transparent", cursor: "pointer", padding: 2, color: "#B0A9A4", display: "flex" }}>
              <X style={{ width: 11, height: 11 }} />
            </button>
          )}
        </div>
      </div>

      {/* ── 本体 ──
          リストとかんばんは「表の中に追加行がある」ので、0件でも枠ごと出す
          （空状態の案内で入力欄を隠してしまうと、結局モーダルと同じ往復になる）。 */}
      {visible.length === 0 && (
        <p style={{ fontSize: 11.5, color: "#A09790", margin: "0 0 8px 2px" }}>
          {tasks.length === 0
            ? "まだタスクがありません。下の行にそのまま入力して Enter で追加できます。"
            : "条件に合うタスクがありません。フィルタを見直してみてください。"}
        </p>
      )}
      {view === "list" ? (
        <TaskListView tasks={visible} allTasks={tasks} showProject={!isProjectScope}
          canEdit={canEdit} canDelete={canDelete}
          canShare={canShare} shareCountOf={shareCountOf} highlightId={highlightId}
          projects={projects} members={members} categoryOptions={categoryOptions}
          onPatch={patchTask} onDelete={setPendingDelete}
          onShare={t => setShareTargetId(t.id)}
          renderSubtaskAdd={parent => (
            <TaskQuickAddRow
              projects={projects} members={members} categoryOptions={categoryOptions}
              showProject={!isProjectScope} fixedProjectId={parent.projectId} lockProject
              indent={22} placeholder="サブタスクを入力して Enter で追加" creatorName={userName}
              onCreate={input => handleCreateSubtask(parent, input)}
            />
          )}
          quickAdd={
            <TaskQuickAddRow
              projects={projects} members={members} categoryOptions={categoryOptions}
              showProject={!isProjectScope} fixedProjectId={projectId}
              focusSignal={addFocus} creatorName={userName} onCreate={handleCreate}
            />
          } />
      ) : view === "board" ? (
        <TaskBoardView tasks={visible} canEdit={canEdit} selectedId={highlightId}
          showProject={!isProjectScope} projectNameOf={projectNameOf}
          parentTitleOf={parentTitleOf}
          onSelect={openInList} onDrop={handleDrop}
          onQuickCreate={handleColumnCreate} />
      ) : visible.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px dashed rgba(26,23,20,0.12)", borderRadius: 12, padding: "56px 20px", textAlign: "center" as const }}>
          <CheckSquare style={{ width: 26, height: 26, color: "#D5D0CB", marginBottom: 10 }} />
          <p style={{ fontSize: 13, color: "#6B6458", fontWeight: 600, margin: 0 }}>表示できるタスクがありません</p>
        </div>
      ) : (
        <TaskGanttView tasks={visible} projectNameOf={projectNameOf}
          selectedId={highlightId} onSelect={openInList} />
      )}

      {showMdImport && (
        <MdTaskImportDialog
          projectId={projectId}
          projectSlug={projectSlug}
          projects={projects}
          members={members}
          categoryOptions={categoryOptions}
          minSortOrder={minSortOrder}
          onClose={() => setShowMdImport(false)}
          onCreated={handleMdImported}
        />
      )}

      {shareTask && (
        <TaskShareDialog
          task={shareTask}
          shares={shareMap[shareTask.id] ?? []}
          members={members}
          currentUserId={userId}
          projectName={shareTask.projectId ? projectNameOf(shareTask.projectId) : undefined}
          projectMemberNames={shareTask.projectId ? projectMembersOf(shareTask.projectId) : undefined}
          onAdd={(targets, canEditFlag) => handleAddShares(shareTask, targets, canEditFlag)}
          onChangePermission={(s, canEditFlag) => handleChangeSharePermission(shareTask, s, canEditFlag)}
          onRemove={s => handleRemoveShare(shareTask, s)}
          onClose={() => setShareTargetId(null)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="タスクの削除"
          message={(() => {
            const kids = tasks.filter(t => t.parentId === pendingDelete.id).length;
            return kids > 0
              ? `「${pendingDelete.title}」を削除します。\nサブタスク ${kids}件も一緒に削除されます。`
              : `「${pendingDelete.title}」を削除します。`;
          })()}
          onConfirm={() => handleDelete(pendingDelete)}
          onClose={() => setPendingDelete(null)}
          zIndex={300}
        />
      )}

    </div>
  );
}
