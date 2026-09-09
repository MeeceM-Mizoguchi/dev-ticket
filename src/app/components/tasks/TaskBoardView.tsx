// ENHA2-032 タスクのかんばんビュー。
//
// 3列（未着手 / 進行中 / 完了）の D&D。SprintBoardView と同じ react-dnd + HTML5Backend。
// HTML5Backend は入れ子にできないので、DndProvider はこのコンポーネントが自前で1つ持つ
// （タスクのボードを他のボードの中に描かないこと）。
//
// カードの上に落とすと「そのカードの前」に挿入、列の余白に落とすと末尾に積む。
import { useRef, useState } from "react";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Hash, FolderKanban, CalendarDays, Plus, CornerDownRight } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { TASK_STATUSES, getTaskPriorityMeta } from "@/app/lib/taskService";
import { truncateName } from "@/app/lib/helpers";
import { isOverdue } from "@/app/components/tasks/TaskListView";
import type { Task, TaskStatus } from "@/app/types";

const DRAG_TYPE = "TASK";

interface DragItem { id: string; status: TaskStatus }

/** taskId を newStatus の列へ。beforeId の前（null なら末尾）に挿入する */
export type TaskDropHandler = (taskId: string, newStatus: TaskStatus, beforeId: string | null) => void;

function formatDue(d: string): string {
  if (!d) return "";
  const [, m, day] = d.split("-");
  return `${Number(m)}/${Number(day)}`;
}

function TaskCard({ task, status, canEdit, selected, showProject, projectName, parentTitle, onSelect, onDrop }: {
  task: Task; status: TaskStatus; canEdit: boolean; selected: boolean;
  showProject: boolean; projectName: string;
  /** サブタスクのとき、親タスクの名前 */
  parentTitle: string;
  onSelect: (t: Task) => void; onDrop: TaskDropHandler;
}) {
  const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>(() => ({
    type: DRAG_TYPE,
    canDrag: canEdit,
    item: { id: task.id, status: task.status },
    collect: m => ({ isDragging: m.isDragging() }),
  }), [task.id, task.status, canEdit]);

  // このカードの「前」へ挿入するための落とし所
  const [{ isOver }, drop] = useDrop<DragItem, void, { isOver: boolean }>(() => ({
    accept: DRAG_TYPE,
    canDrop: item => item.id !== task.id,
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      onDrop(item.id, status, task.id);
    },
    collect: m => ({ isOver: m.isOver({ shallow: true }) && m.canDrop() }),
  }), [task.id, status, onDrop]);

  const pri = getTaskPriorityMeta(task.priority);
  const overdue = isOverdue(task);
  const done = task.status === "done";

  return (
    <div ref={node => { drop(node); }}>
      {isOver && <div style={{ height: 3, borderRadius: 2, background: "#059669", margin: "0 0 5px" }} />}
      <div ref={node => { drag(node); }} onClick={() => onSelect(task)}
        style={{
          background: "#FFF", borderRadius: 9, padding: "10px 11px", marginBottom: 6,
          border: selected ? "1px solid #059669" : "1px solid rgba(26,23,20,0.08)",
          cursor: canEdit ? "grab" : "pointer",
          // 完了はリストと同じ扱い（打ち消し線ではなくカードごと減光）
          opacity: isDragging ? 0.35 : done ? 0.45 : 1,
          filter: done ? "grayscale(1)" : undefined,
          boxShadow: isDragging ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
          transition: "opacity 0.15s, box-shadow 0.15s",
        }}
        onMouseEnter={e => { if (!isDragging) (e.currentTarget as HTMLElement).style.boxShadow = "0 3px 10px rgba(0,0,0,0.10)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = isDragging ? "none" : "0 1px 3px rgba(0,0,0,0.04)"; }}>

        {task.parentId && (
          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "#9E9690", marginBottom: 4 }}>
            <CornerDownRight style={{ width: 9, height: 9, flexShrink: 0 }} />
            <TruncatedText text={parentTitle || "サブタスク"} />
          </div>
        )}
        {/* 2行で切っているので、それより長いものはマウスオーバーで全文を出す */}
        <TruncatedText as="p" text={task.title} style={{
          fontSize: 11.5, fontWeight: 600, marginBottom: 7, lineHeight: 1.35,
          color: "#1A1714",
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const, whiteSpace: "normal",
        }} />

        {(task.ticketWbs || (showProject && task.projectId)) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 7 }}>
            {task.ticketWbs && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 4, padding: "1px 4px", fontFamily: "var(--font-mono)" }}>
                <Hash style={{ width: 8, height: 8 }} />{task.ticketWbs}
              </span>
            )}
            {showProject && task.projectId && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9, color: "#6B6458", background: "#F4F5F6", borderRadius: 4, padding: "1px 5px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                <FolderKanban style={{ width: 8, height: 8, flexShrink: 0 }} />{projectName}
              </span>
            )}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
            <Avatar name={task.assignee} size="xs" />
            <span style={{ fontSize: 10, color: "#9E9690", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {truncateName(task.assignee, 8) || "未割当"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
            {task.dueDate && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 9, fontWeight: overdue ? 700 : 500, color: overdue ? "#DC2626" : "#9E9690", background: overdue ? "#FEF2F2" : "transparent", borderRadius: 4, padding: "1px 4px" }}>
                <CalendarDays style={{ width: 8, height: 8 }} />{formatDue(task.dueDate)}
              </span>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8, background: pri.bg, color: pri.color }}>{pri.label}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 列の末尾に生えている追加欄。モーダルを開かずにその列のステータスで1件足す */
function ColumnQuickAdd({ status, onCreate }: {
  status: TaskStatus;
  onCreate: (title: string, status: TaskStatus) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // refocus=false は blur 経由（他所をクリックした人を引き戻さない）
  const submit = async (refocus: boolean) => {
    const v = title.trim();
    if (!v || saving) return;
    setSaving(true);
    const ok = await onCreate(v, status);
    setSaving(false);
    if (!ok) return;
    setTitle("");
    if (refocus) ref.current?.focus();
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", marginTop: 2,
      background: title ? "#FFFFFF" : "transparent",
      border: `1px ${title ? "solid" : "dashed"} ${title ? "#A7F3D0" : "rgba(26,23,20,0.12)"}`,
      borderRadius: 9,
    }}>
      <Plus style={{ width: 12, height: 12, color: title ? "#059669" : "#C9C4BB", flexShrink: 0 }} />
      <input ref={ref} value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(true); }
          if (e.key === "Escape") { setTitle(""); (e.currentTarget as HTMLInputElement).blur(); }
        }}
        onBlur={() => submit(false)}
        placeholder="タスクを追加"
        style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: "#1A1714", fontFamily: "inherit", background: "transparent", border: "none", outline: "none" }} />
    </div>
  );
}

function BoardColumn({ col, tasks, canEdit, selectedId, showProject, projectNameOf, parentTitleOf, onSelect, onDrop, onQuickCreate }: {
  col: typeof TASK_STATUSES[number];
  tasks: Task[];
  canEdit: (t: Task) => boolean;
  selectedId: string | null;
  showProject: boolean;
  projectNameOf: (id: string | null) => string;
  parentTitleOf: (id: string | null) => string;
  onSelect: (t: Task) => void;
  onDrop: TaskDropHandler;
  onQuickCreate: (title: string, status: TaskStatus) => Promise<boolean>;
}) {
  // 列の余白へ落としたら末尾に積む（カード上で処理済みなら didDrop で抜ける）
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DRAG_TYPE,
    drop: (item, monitor) => {
      if (monitor.didDrop()) return;
      onDrop(item.id, col.value, null);
    },
    collect: m => ({ isOver: m.isOver({ shallow: true }), canDrop: m.canDrop() }),
  }), [col.value, onDrop]);

  const active = isOver && canDrop;

  return (
    <div style={{ flex: 1, minWidth: 240, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px 8px" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: col.color }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>{col.label}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: col.color, background: col.bg, borderRadius: 99, padding: "1px 7px" }}>{tasks.length}</span>
      </div>
      <div ref={node => { drop(node); }}
        style={{
          flex: 1, borderRadius: 10, padding: 8, minHeight: 160,
          background: active ? col.bg : "rgba(26,23,20,0.02)",
          border: `1.5px ${active ? "solid" : "dashed"} ${active ? col.color + "55" : "rgba(26,23,20,0.08)"}`,
          transition: "background 0.15s, border-color 0.15s",
        }}>
        {tasks.map(t => (
          <TaskCard key={t.id} task={t} status={col.value} canEdit={canEdit(t)}
            selected={selectedId === t.id} showProject={showProject}
            projectName={projectNameOf(t.projectId)}
            parentTitle={parentTitleOf(t.parentId)}
            onSelect={onSelect} onDrop={onDrop} />
        ))}
        <ColumnQuickAdd status={col.value} onCreate={onQuickCreate} />
      </div>
    </div>
  );
}

export function TaskBoardView(props: {
  tasks: Task[];
  canEdit: (t: Task) => boolean;
  selectedId: string | null;
  showProject: boolean;
  projectNameOf: (id: string | null) => string;
  parentTitleOf: (id: string | null) => string;
  onSelect: (t: Task) => void;
  onDrop: TaskDropHandler;
  onQuickCreate: (title: string, status: TaskStatus) => Promise<boolean>;
}) {
  return (
    <DndProvider backend={HTML5Backend}>
      <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
        {TASK_STATUSES.map(col => (
          <BoardColumn key={col.value} col={col}
            tasks={props.tasks.filter(t => t.status === col.value)}
            canEdit={props.canEdit} selectedId={props.selectedId}
            showProject={props.showProject} projectNameOf={props.projectNameOf}
            parentTitleOf={props.parentTitleOf}
            onSelect={props.onSelect} onDrop={props.onDrop}
            onQuickCreate={props.onQuickCreate} />
        ))}
      </div>
    </DndProvider>
  );
}
