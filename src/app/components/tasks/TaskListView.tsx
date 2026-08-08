// ENHA2-032 タスクのリストビュー（既定・最軽量）。
//
// 表として読めるように列見出しを持つ。見出し・データ行・追加行（TaskQuickAddRow）は
// すべて TASK_COLS の同じ幅を使うので、3者が縦に揃う。
//
// サブタスク（子チケットと同じく1階層のみ）は親行の下にぶら下げる。
// 親行の ▸ で開閉し、開いた中に「サブタスクを追加」の入力行が生えている。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, CornerDownRight, Hash, FolderKanban, Plus, Undo2 } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { TASK_STATUSES, TASK_PRIORITIES, getTaskStatusMeta, getTaskPriorityMeta } from "@/app/lib/taskService";
import { truncateName } from "@/app/lib/helpers";
import type { Task, TaskStatus } from "@/app/types";

/** 見出し・データ行・追加行で共有する列幅 */
export const TASK_COLS = {
  toggle: 18,
  expand: 14,
  category: 104,
  priority: 48,
  project: 132,
  assignee: 112,
  start: 106,
  due: 106,
  status: 86,
  gap: 10,
  padX: 14,
};

/** サブタスク1段ぶんの字下げ */
const INDENT = 22;

/** 期限切れ判定。完了したタスクは対象外 */
export function isOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === "done") return false;
  return t.dueDate < new Date().toLocaleDateString("sv-SE");
}

function formatDue(d: string): string {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

/** メニュー1件ぶんの高さ（見積り）。下に入りきるかの判定に使う */
const STATUS_MENU_ITEM_H = 33;

function StatusPill({ status, onChange, disabled, dim }: {
  status: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean;
  /** 完了行の減光。開いたメニューには掛けない */
  dim?: React.CSSProperties;
}) {
  // 表の外枠が overflow:hidden なので、メニューを行の中に描くと切れる。
  // CustomSelect と同じくポータルで body に出し、位置は実測して当てる。
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const meta = getTaskStatusMeta(status);
  const open = pos !== null;

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const menuH = TASK_STATUSES.length * STATUS_MENU_ITEM_H + 8;
    const width = Math.max(r.width, 118);
    // 下に入りきらなければ上へ出す（最終行でも選択肢が全部見える）
    const openUp = window.innerHeight - r.bottom < menuH + 8 && r.top > menuH + 8;
    setPos(openUp
      ? { bottom: window.innerHeight - r.top + 4, left: r.right - width, width }
      : { top: r.bottom + 4, left: r.right - width, width });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    // スクロールやリサイズで位置がずれるくらいなら閉じる
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  return (
    <div style={{ position: "relative", width: TASK_COLS.status, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => (open ? setPos(null) : place())}
        style={{
          ...dim,
          display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 7px",
          fontSize: 10, fontWeight: 700, borderRadius: 99, width: "100%",
          background: meta.bg, color: meta.color, border: `1px solid ${meta.border}`,
          cursor: disabled ? "default" : "pointer", justifyContent: "center",
        }}>
        {meta.label}
        {!disabled && <ChevronDown style={{ width: 9, height: 9 }} />}
      </button>
      {pos && createPortal(
        <div ref={menuRef}
          style={{
            position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width,
            zIndex: 400, background: "#FFF", border: "1px solid rgba(26,23,20,0.1)",
            borderRadius: 9, boxShadow: "0 10px 28px rgba(0,0,0,0.14)", overflow: "hidden",
          }}>
          {TASK_STATUSES.map(s => (
            <button key={s.value} type="button"
              onClick={() => { setPos(null); if (s.value !== status) onChange(s.value); }}
              style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "7px 10px", border: "none", background: s.value === status ? "#F7F8F9" : "transparent", cursor: "pointer", textAlign: "left" as const }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = s.value === status ? "#F7F8F9" : "transparent"; }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11.5, color: "#1A1714", fontWeight: 600 }}>{s.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

/** 親行の下に生える「サブタスクを追加」。タイトルだけ打って Enter */
function SubtaskAddRow({ parent, onCreate }: {
  parent: Task;
  onCreate: (parent: Task, title: string) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const v = title.trim();
    if (!v || saving) return;
    setSaving(true);
    const ok = await onCreate(parent, v);
    setSaving(false);
    if (ok) { setTitle(""); ref.current?.focus(); }
  };

  return (
    <div onClick={e => e.stopPropagation()}
      style={{
        display: "flex", alignItems: "center", gap: TASK_COLS.gap,
        padding: `6px ${TASK_COLS.padX}px 6px ${TASK_COLS.padX + INDENT}px`,
        borderTop: "1px solid rgba(26,23,20,0.04)", background: "#FCFCFB",
      }}>
      <Plus style={{ width: 13, height: 13, color: title ? "#059669" : "#C9C4BB", flexShrink: 0 }} />
      <input ref={ref} value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setTitle(""); (e.currentTarget as HTMLInputElement).blur(); }
        }}
        placeholder="サブタスクを入力して Enter で追加"
        style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#1A1714", fontFamily: "inherit", background: "transparent", border: "none", outline: "none", padding: "2px 0" }} />
    </div>
  );
}

function TaskRow({
  task, depth, expanded, childCount, doneCount, editable, selected,
  showProject, projectName, onToggleExpand, onSelect, onStatusChange,
}: {
  task: Task;
  depth: number;
  expanded: boolean;
  childCount: number;
  doneCount: number;
  editable: boolean;
  selected: boolean;
  showProject: boolean;
  projectName: string;
  onToggleExpand: () => void;
  onSelect: (t: Task) => void;
  onStatusChange: (t: Task, s: TaskStatus) => void;
}) {
  const done = task.status === "done";
  const overdue = isOverdue(task);
  const pri = getTaskPriorityMeta(task.priority);

  // 完了行は「行まるごとグレーアウト」で片付いたことを示す。
  // 文字だけ打ち消し線にすると行の左右で密度がちぐはぐに見えるので、
  // 中身のセルすべてに同じ減光をかけ、操作できる部分（チェック・取り消す）だけ素の色で残す。
  const dim: React.CSSProperties | undefined = done
    ? { opacity: 0.4, filter: "grayscale(1)" }
    : undefined;
  const baseBg = selected ? "#F0FDF4" : done ? "#FAFAF9" : depth > 0 ? "#FCFCFB" : "transparent";

  return (
    <div onClick={() => onSelect(task)}
      style={{
        display: "flex", alignItems: "center", gap: TASK_COLS.gap,
        padding: `10px ${TASK_COLS.padX}px`,
        borderTop: "1px solid rgba(26,23,20,0.05)",
        background: baseBg,
        cursor: "pointer", transition: "background 0.12s",
      }}
      onMouseEnter={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
      onMouseLeave={e => { if (!selected) (e.currentTarget as HTMLElement).style.background = baseBg; }}>

      {/* 完了トグル */}
      <button type="button" disabled={!editable}
        onClick={e => { e.stopPropagation(); onStatusChange(task, done ? "todo" : "done"); }}
        title={done ? "完了を取り消す" : "完了にする"}
        style={{
          width: TASK_COLS.toggle, height: TASK_COLS.toggle, borderRadius: 6, flexShrink: 0, padding: 0,
          border: done ? "none" : "1.5px solid rgba(26,23,20,0.18)",
          background: done ? "#059669" : "transparent",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: editable ? "pointer" : "default",
        }}>
        {done && <Check style={{ width: 12, height: 12, color: "#FFF" }} />}
      </button>

      {/* 開閉。サブタスクが0件でも押せる（開いた中に「追加」行があるため、
          ここを子持ちだけにすると最初の1件を足す入口が無くなる） */}
      <span style={{ width: TASK_COLS.expand, flexShrink: 0, display: "flex", justifyContent: "center" }}>
        {depth === 0 && (
          <button type="button" onClick={e => { e.stopPropagation(); onToggleExpand(); }}
            title={expanded ? "サブタスクを閉じる" : childCount > 0 ? "サブタスクを開く" : "サブタスクを追加"}
            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", color: childCount > 0 ? "#9E9690" : "#D5D0CB" }}>
            {expanded
              ? <ChevronDown style={{ width: 13, height: 13 }} />
              : <ChevronRight style={{ width: 13, height: 13 }} />}
          </button>
        )}
      </span>

      {/* タスク名 */}
      <span style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, paddingLeft: depth * INDENT, ...dim }}>
        {/* 親が絞り込みで消えている子は最上位に出るので、depth ではなく parentId で判定する */}
        {task.parentId && <CornerDownRight style={{ width: 11, height: 11, color: "#C9C4BB", flexShrink: 0 }} />}
        <span style={{
          minWidth: 0, fontSize: depth > 0 ? 12.5 : 13, color: "#1A1714", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
        }}>{task.title}</span>
        {childCount > 0 && (
          <span title="サブタスクの進捗"
            style={{ fontSize: 9.5, fontWeight: 700, color: doneCount === childCount ? "#059669" : "#9E9690", background: doneCount === childCount ? "#ECFDF5" : "#F4F5F6", borderRadius: 99, padding: "1px 6px", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
            {doneCount}/{childCount}
          </span>
        )}
        {task.ticketWbs && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            <Hash style={{ width: 9, height: 9 }} />{task.ticketWbs}
          </span>
        )}
      </span>

      {/* 取り消す。減光の外に置いて、完了行でも押せることが分かるようにする */}
      {done && editable && (
        <button type="button" onClick={e => { e.stopPropagation(); onStatusChange(task, "todo"); }}
          title="完了を取り消して未着手に戻す"
          style={{ display: "inline-flex", alignItems: "center", gap: 3, flexShrink: 0, padding: "2px 8px", fontSize: 9.5, fontWeight: 700, color: "#6B6458", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 99, cursor: "pointer", fontFamily: "inherit" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; }}>
          <Undo2 style={{ width: 9, height: 9 }} />取り消す
        </button>
      )}

      {/* 分類 */}
      <span style={{ width: TASK_COLS.category, flexShrink: 0, display: "inline-flex", alignItems: "center", ...dim }}>
        {task.category ? (
          <span title={task.category}
            style={{ fontSize: 10, fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.07)", borderRadius: 5, padding: "2px 6px", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {task.category}
          </span>
        ) : (
          <span style={{ fontSize: 10.5, color: "#D5D0CB" }}>—</span>
        )}
      </span>

      {/* プロジェクト */}
      {showProject && (
        <span style={{ width: TASK_COLS.project, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10.5, color: task.projectId ? "#6B6458" : "#C9C4BB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, ...dim }}>
          <FolderKanban style={{ width: 10, height: 10, flexShrink: 0 }} />
          {projectName || "個人"}
        </span>
      )}

      {/* 優先度 */}
      <span style={{ width: TASK_COLS.priority, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, ...dim }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: pri.color, flexShrink: 0 }} />
        <span style={{ fontSize: 10.5, color: "#6B6458" }}>{pri.label}</span>
      </span>

      {/* 担当 */}
      <span style={{ width: TASK_COLS.assignee, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, ...dim }}>
        {task.assignee ? (
          <>
            <Avatar name={task.assignee} size="xs" />
            <span style={{ fontSize: 10.5, color: "#9E9690", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {truncateName(task.assignee, 10)}
            </span>
          </>
        ) : (
          <span style={{ fontSize: 10.5, color: "#C9C4BB" }}>未割当</span>
        )}
      </span>

      {/* 開始日 */}
      <span style={{
        width: TASK_COLS.start, flexShrink: 0, display: "inline-flex", alignItems: "center",
        fontSize: 10.5, color: task.startDate ? "#6B6458" : "#D5D0CB",
        ...dim,
      }}>
        {task.startDate ? formatDue(task.startDate) : "—"}
      </span>

      {/* 期限 */}
      <span style={{
        width: TASK_COLS.due, flexShrink: 0, display: "inline-flex", alignItems: "center",
        fontSize: 10.5, fontWeight: overdue ? 700 : 500,
        color: overdue ? "#DC2626" : task.dueDate ? "#6B6458" : "#D5D0CB",
        ...dim,
      }}>
        {task.dueDate ? formatDue(task.dueDate) : "—"}
      </span>

      <StatusPill status={task.status} disabled={!editable} dim={dim} onChange={s => onStatusChange(task, s)} />
    </div>
  );
}

export function TaskListView({
  tasks, allTasks, projectNameOf, showProject, canEdit, selectedId,
  onSelect, onStatusChange, onCreateSubtask, quickAdd,
}: {
  /** 絞り込み後（画面に出す分） */
  tasks: Task[];
  /** 絞り込み前。サブタスクの件数を正しく数えるために使う */
  allTasks: Task[];
  projectNameOf: (id: string | null) => string;
  showProject: boolean;
  canEdit: (t: Task) => boolean;
  selectedId: string | null;
  onSelect: (t: Task) => void;
  onStatusChange: (t: Task, s: TaskStatus) => void;
  onCreateSubtask: (parent: Task, title: string) => Promise<boolean>;
  /** 表の最終行に生やす追加行（TaskQuickAddRow）。渡さなければ出ない */
  quickAdd?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // 子の件数・完了数は絞り込み前で数える（完了を隠していても 2/3 が正しく出るように）
  const counts = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const c = m.get(t.parentId) ?? { total: 0, done: 0 };
      c.total += 1;
      if (t.status === "done") c.done += 1;
      m.set(t.parentId, c);
    }
    return m;
  }, [allTasks]);

  // 親が絞り込みで消えている子は、行き場が無くなるので最上位に出す
  const { roots, childrenOf } = useMemo(() => {
    const ids = new Set(tasks.map(t => t.id));
    const kids = new Map<string, Task[]>();
    const top: Task[] = [];
    for (const t of tasks) {
      if (t.parentId && ids.has(t.parentId)) {
        const arr = kids.get(t.parentId);
        if (arr) arr.push(t); else kids.set(t.parentId, [t]);
      } else {
        top.push(t);
      }
    }
    return { roots: top, childrenOf: kids };
  }, [tasks]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const headCell: React.CSSProperties = {
    fontSize: 9.5, fontWeight: 700, color: "#A09790",
    letterSpacing: "0.08em", flexShrink: 0,
  };

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, overflow: "hidden" }}>
      {/* ── 列見出し ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: TASK_COLS.gap,
        padding: `8px ${TASK_COLS.padX}px`, background: "#FAFAF9",
        borderBottom: "1px solid rgba(26,23,20,0.07)",
      }}>
        <span style={{ width: TASK_COLS.toggle, flexShrink: 0 }} />
        <span style={{ width: TASK_COLS.expand, flexShrink: 0 }} />
        <span style={{ ...headCell, flex: 1, minWidth: 0 }}>タイトル</span>
        <span style={{ ...headCell, width: TASK_COLS.category }}>分類</span>
        {showProject && <span style={{ ...headCell, width: TASK_COLS.project }}>プロジェクト</span>}
        <span style={{ ...headCell, width: TASK_COLS.priority }}>優先度</span>
        <span style={{ ...headCell, width: TASK_COLS.assignee }}>担当者</span>
        <span style={{ ...headCell, width: TASK_COLS.start }}>開始日</span>
        <span style={{ ...headCell, width: TASK_COLS.due }}>期限</span>
        <span style={{ ...headCell, width: TASK_COLS.status, textAlign: "center" as const }}>ステータス</span>
      </div>

      {roots.map(t => {
        const c = counts.get(t.id) ?? { total: 0, done: 0 };
        const isOpen = expanded.has(t.id);
        const kids = childrenOf.get(t.id) ?? [];
        return (
          <div key={t.id}>
            <TaskRow task={t} depth={0} expanded={isOpen}
              childCount={c.total} doneCount={c.done}
              editable={canEdit(t)} selected={selectedId === t.id}
              showProject={showProject} projectName={projectNameOf(t.projectId)}
              onToggleExpand={() => toggle(t.id)}
              onSelect={onSelect} onStatusChange={onStatusChange} />

            {isOpen && t.parentId === null && (
              <>
                {kids.map(k => (
                  <TaskRow key={k.id} task={k} depth={1} expanded={false}
                    childCount={0} doneCount={0}
                    editable={canEdit(k)} selected={selectedId === k.id}
                    showProject={showProject} projectName={projectNameOf(k.projectId)}
                    onToggleExpand={() => {}}
                    onSelect={onSelect} onStatusChange={onStatusChange} />
                ))}
                {canEdit(t) && <SubtaskAddRow parent={t} onCreate={onCreateSubtask} />}
              </>
            )}
          </div>
        );
      })}

      {quickAdd}
    </div>
  );
}
