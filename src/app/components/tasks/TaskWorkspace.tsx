// ENHA2-032 タスク管理の本体。
//
// サイドバーの「タスク」（横断）と、プロジェクト配下の「タスク」の2つの入口が
// どちらもこのコンポーネントを描く。違いは scope と projectId だけ。
//
// データの流れは本アプリの他ページと同じ「マウント時に1回 fetch ＋ 楽観更新」。
// ヘッダーの更新ボタン（RefreshContext）はページごと再マウントするので、
// ここに購読やポーリングは要らない。
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckSquare, Plus, Search, X, List, LayoutGrid, GanttChartSquare, RefreshCw } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { TaskListView } from "@/app/components/tasks/TaskListView";
import { TaskBoardView, type TaskDropHandler } from "@/app/components/tasks/TaskBoardView";
import { TaskGanttView } from "@/app/components/tasks/TaskGanttView";
import { TaskDetailPanel } from "@/app/components/tasks/TaskDetailPanel";
import { TaskQuickAddRow } from "@/app/components/tasks/TaskQuickAddRow";
import {
  loadTasks, loadTaskProjects, loadTaskMembers, loadMyShareFlags,
  createTask, createSubtask, updateTask, deleteTask, syncAssigneeShare,
  computeSortOrder, renumberColumn, SORT_GAP,
  type NewTaskInput, type ProjectOption, type MemberOption,
} from "@/app/lib/taskService";
import { notifyTaskAssigned, notifyTaskShared } from "@/app/lib/taskNotify";
import type { Task, TaskStatus, TaskView } from "@/app/types";

type OwnerFilter = "all" | "mine" | "shared";

const VIEWS: { value: TaskView; label: string; icon: React.ElementType }[] = [
  { value: "list",  label: "リスト",   icon: List },
  { value: "board", label: "かんばん", icon: LayoutGrid },
  { value: "gantt", label: "ガント",   icon: GanttChartSquare },
];

function viewStorageKey(scopeKey: string) { return `dt.taskView.${scopeKey}`; }

const FILTER_SELECT: React.CSSProperties = {
  padding: "7px 10px", fontSize: 11.5, fontWeight: 600, color: "#6B6458",
  background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8,
  cursor: "pointer", outline: "none",
};

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
  const [shareFlags, setShareFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [view, setView] = useState<TaskView>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(viewStorageKey(scopeKey)) : null;
    return (saved === "board" || saved === "gantt" || saved === "list") ? saved : "list";
  });
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all");
  const [projectFilter, setProjectFilter] = useState("");   // "" = すべて / "none" = 個人 / id
  const [assigneeFilter, setAssigneeFilter] = useState("");  // "" = すべて / "@me" / "@none" / 名前
  // 完了しても一覧から消さない（どれだけ片付いたか分からなくなるため）。
  // 溜まって邪魔になった人だけが明示的に隠す。
  const [hideDone, setHideDone] = useState(false);
  const [search, setSearch] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // ヘッダーの「タスクを追加」から、表の追加行へフォーカスを飛ばすための合図
  const [addFocus, setAddFocus] = useState(0);

  useEffect(() => { localStorage.setItem(viewStorageKey(scopeKey), view); }, [view, scopeKey]);

  // ── 読み込み ────────────────────────────────────────────────
  const reload = useCallback(async (spinner = true) => {
    if (spinner) setLoading(true); else setRefreshing(true);
    const [t, flags] = await Promise.all([loadTasks(projectId), loadMyShareFlags(userId)]);
    setTasks(t);
    setShareFlags(flags);
    if (spinner) setLoading(false); else setRefreshing(false);
  }, [projectId, userId]);

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
      setSelectedId(hit.id);
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

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter(t => {
      if (hideDone && t.status === "done") return false;
      if (!isProjectScope) {
        if (ownerFilter === "mine" && t.ownerId !== userId) return false;
        if (ownerFilter === "shared" && t.ownerId === userId) return false;
        if (projectFilter === "none" && t.projectId) return false;
        if (projectFilter && projectFilter !== "none" && t.projectId !== projectFilter) return false;
      }
      if (assigneeFilter === "@me" && t.assignee !== userName) return false;
      if (assigneeFilter === "@none" && t.assignee) return false;
      if (assigneeFilter && !assigneeFilter.startsWith("@") && t.assignee !== assigneeFilter) return false;
      if (q && !t.title.toLowerCase().includes(q) && !t.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tasks, hideDone, isProjectScope, ownerFilter, projectFilter, assigneeFilter, search, userId, userName]);

  const doneCount = useMemo(() => tasks.filter(t => t.status === "done").length, [tasks]);

  /** 分類の候補。既に使われている値をそのまま出す（自由入力なのでマスタは持たない） */
  const categories = useMemo(
    () => Array.from(new Set(tasks.map(t => t.category).filter(Boolean))).sort(),
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
    return shareFlags[t.id] === true;
  }, [userId, shareFlags]);

  const selected = useMemo(() => tasks.find(t => t.id === selectedId) ?? null, [tasks, selectedId]);
  // 詳細パネルは onClose を escStack に積むので、毎レンダー作り直さない
  const closeDetail = useCallback(() => setSelectedId(null), []);

  // ── 更新 ────────────────────────────────────────────────────
  const applyLocal = useCallback((id: string, patch: Partial<Task>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);

  const patchTask = useCallback(async (task: Task, patch: Partial<Task>) => {
    if (!canEdit(task)) { toast("このタスクを編集する権限がありません", "error"); return; }
    applyLocal(task.id, patch);
    const ok = await updateTask(task.id, patch);
    if (!ok) {
      toast("更新に失敗しました", "error");
      reload(false);
      return;
    }
    // 担当者に指名した相手には自動で共有を張る（振ったのに見えない事故を防ぐ）
    if (patch.assignee) {
      await syncAssigneeShare(task.id, patch.assignee, members, task.createdBy);
    }
  }, [canEdit, applyLocal, toast, reload, members]);

  const handleStatusChange = useCallback((task: Task, status: TaskStatus) => {
    patchTask(task, { status, completedAt: status === "done" ? new Date().toISOString() : null });
  }, [patchTask]);

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
    setSelectedId(null);
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
      await syncAssigneeShare(created.id, created.assignee, members, userName);
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
  const handleCreateSubtask = useCallback(async (parent: Task, subTitle: string) => {
    if (parent.parentId) { toast("サブタスクはさらに分割できません", "error"); return false; }
    if (!canEdit(parent)) { toast("このタスクを編集する権限がありません", "error"); return false; }
    const minSort = tasks
      .filter(t => t.parentId === parent.id)
      .reduce<number | null>((min, t) => (min === null || t.sortOrder < min ? t.sortOrder : min), null);
    const child = await createSubtask(parent, subTitle, userId, userName, minSort ?? SORT_GAP);
    if (!child) { toast("サブタスクの作成に失敗しました", "error"); return false; }
    setTasks(prev => [...prev, child]);
    // 親の共有をコピーしたので、自分に対する編集可フラグも手元に反映しておく
    setShareFlags(prev => ({ ...prev, [child.id]: true }));
    return true;
  }, [tasks, canEdit, userId, userName, toast]);

  /** かんばんの列末尾からの追加。プロジェクトは画面のスコープに従う */
  const handleColumnCreate = useCallback((quickTitle: string, status: TaskStatus) =>
    handleCreate({ title: quickTitle, status, projectId, priority: "medium", assignee: "" }),
  [handleCreate, projectId]);

  // ヘッダーの「タスクを追加」は、モーダルではなく表の追加行へ誘導する
  const focusQuickAdd = useCallback(() => {
    setView(v => (v === "gantt" ? "list" : v));
    setAddFocus(n => n + 1);
  }, []);

  // ── 描画 ────────────────────────────────────────────────────
  if (loading) return <PageLoader label="タスクを読み込み中..." />;

  const assigneeNames = Array.from(new Set(tasks.map(t => t.assignee).filter(Boolean))).sort();

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
          <button type="button" onClick={focusQuickAdd}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, color: "#FFF", background: "#059669", border: "none", borderRadius: 10, cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
            <Plus style={{ width: 14, height: 14 }} />タスクを追加
          </button>
        </div>
      </div>

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
          <>
            <select value={ownerFilter} onChange={e => setOwnerFilter(e.target.value as OwnerFilter)} style={FILTER_SELECT}>
              <option value="all">自分＋共有</option>
              <option value="mine">自分のタスク</option>
              <option value="shared">共有されたもの</option>
            </select>
            <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} style={FILTER_SELECT}>
              <option value="">すべてのPJ</option>
              <option value="none">個人タスク</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </>
        )}

        <select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)} style={FILTER_SELECT}>
          <option value="">担当: すべて</option>
          <option value="@me">自分の担当</option>
          <option value="@none">未割当</option>
          {assigneeNames.filter(n => n !== userName).map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#6B6458", cursor: "pointer", padding: "7px 10px", background: "#FFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8 }}>
          <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} style={{ accentColor: "#059669" }} />
          完了を隠す
        </label>

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
        <TaskListView tasks={visible} allTasks={tasks} projectNameOf={projectNameOf} showProject={!isProjectScope}
          canEdit={canEdit} selectedId={selectedId}
          onSelect={t => setSelectedId(t.id)} onStatusChange={handleStatusChange}
          onCreateSubtask={handleCreateSubtask}
          quickAdd={
            <TaskQuickAddRow
              projects={projects} members={members} categories={categories}
              showProject={!isProjectScope} fixedProjectId={projectId}
              focusSignal={addFocus} onCreate={handleCreate}
            />
          } />
      ) : view === "board" ? (
        <TaskBoardView tasks={visible} canEdit={canEdit} selectedId={selectedId}
          showProject={!isProjectScope} projectNameOf={projectNameOf}
          parentTitleOf={parentTitleOf}
          onSelect={t => setSelectedId(t.id)} onDrop={handleDrop}
          onQuickCreate={handleColumnCreate} />
      ) : visible.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px dashed rgba(26,23,20,0.12)", borderRadius: 12, padding: "56px 20px", textAlign: "center" as const }}>
          <CheckSquare style={{ width: 26, height: 26, color: "#D5D0CB", marginBottom: 10 }} />
          <p style={{ fontSize: 13, color: "#6B6458", fontWeight: 600, margin: 0 }}>表示できるタスクがありません</p>
        </div>
      ) : (
        <TaskGanttView tasks={visible} projectNameOf={projectNameOf}
          selectedId={selectedId} onSelect={t => setSelectedId(t.id)} />
      )}

      {selected && (
        <TaskDetailPanel
          task={selected}
          projects={projects}
          members={members}
          categories={categories}
          subtasks={tasks.filter(t => t.parentId === selected.id).sort((a, b) => a.sortOrder - b.sortOrder)}
          parentTask={selected.parentId ? tasks.find(t => t.id === selected.parentId) ?? null : null}
          currentUserId={userId}
          currentUserName={userName}
          canEdit={canEdit(selected)}
          onPatch={patch => patchTask(selected, patch)}
          onDelete={() => handleDelete(selected)}
          onClose={closeDetail}
          onCreateSubtask={handleCreateSubtask}
          onPatchTask={patchTask}
          onOpenTask={t => setSelectedId(t.id)}
          onShared={name => notifyTaskShared(
            { taskId: selected.id, taskTitle: selected.title, fromUserName: userName, projectSlug: projectSlugOf(selected.projectId) },
            name,
          )}
          onAssigned={name => notifyTaskAssigned(
            { taskId: selected.id, taskTitle: selected.title, fromUserName: userName, projectSlug: projectSlugOf(selected.projectId) },
            name,
          )}
        />
      )}

    </div>
  );
}
