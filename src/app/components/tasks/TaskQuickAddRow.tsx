// ENHA2-032 タスクの追加行（リストの最終行にそのまま生えている入力欄）。
//
// タスクは「思いついた瞬間に1行足す」ものなので、モーダルを開く・閉じるという
// 往復を挟まない。表の続きにそのまま打ち込んで Enter で確定する。
// 確定後もフォーカスと プロジェクト/担当者/優先度 は残るので、続けて何行でも打てる。
//
// 列幅は TASK_COLS を使う（見出し・データ行と縦を揃えるため）。
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TASK_STATUSES, TASK_PRIORITIES, type MemberOption, type ProjectOption } from "@/app/lib/taskService";
import type { NewTaskInput } from "@/app/lib/taskService";
import { TASK_COLS } from "@/app/components/tasks/TaskListView";
import type { Priority, TaskStatus } from "@/app/types";

const CATEGORY_LIST_ID = "task-quick-add-categories";

const CELL: React.CSSProperties = {
  fontSize: 11, color: "#6B6458", background: "#FFFFFF",
  border: "1px solid rgba(26,23,20,0.1)", borderRadius: 6,
  padding: "4px 5px", outline: "none", cursor: "pointer",
  fontFamily: "inherit", flexShrink: 0, boxSizing: "border-box",
};

export function TaskQuickAddRow({
  projects, members, categories, showProject, fixedProjectId, defaultStatus = "todo",
  focusSignal, onCreate,
}: {
  projects: ProjectOption[];
  members: MemberOption[];
  /** 既に使われている分類。入力欄の候補に出す（自由入力も可） */
  categories: string[];
  showProject: boolean;
  /** プロジェクト配下の画面では固定（選択欄を出さない） */
  fixedProjectId?: string | null;
  defaultStatus?: TaskStatus;
  /** 値が変わるたびにタイトル入力へフォーカスする（ヘッダーの「タスクを追加」から） */
  focusSignal?: number;
  onCreate: (input: Omit<NewTaskInput, "ownerId" | "createdBy">) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState(fixedProjectId ?? "");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState<TaskStatus>(defaultStatus);
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignee, setAssignee] = useState("");
  const [startDate, setStartDate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 初回マウントでは何もしない（ページを開いた瞬間に入力欄へ飛ばされてしまうため）。
  // ヘッダーのボタンが押されて合図が変わったときだけフォーカスする。
  const lastSignal = useRef(focusSignal);
  useEffect(() => {
    if (focusSignal === undefined || focusSignal === lastSignal.current) return;
    lastSignal.current = focusSignal;
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusSignal]);

  const submit = async () => {
    const v = title.trim();
    if (!v || saving) return;
    setSaving(true);
    const ok = await onCreate({
      title: v, projectId: projectId || null, category: category.trim(), status, priority, assignee, startDate, dueDate,
    });
    setSaving(false);
    if (!ok) return;
    // 続けて打てるように、行の性格（PJ・担当・優先度・ステータス）は残してタイトルだけ空にする
    setTitle("");
    setStartDate("");
    setDueDate("");
    inputRef.current?.focus();
  };

  const pri = TASK_PRIORITIES.find(p => p.value === priority)!;
  const filled = title.trim().length > 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: TASK_COLS.gap,
      padding: `8px ${TASK_COLS.padX}px`,
      borderTop: "1px solid rgba(26,23,20,0.05)",
      background: filled ? "#F0FDF4" : "#FAFAF9",
    }}>
      {/* ＋ 自体が確定ボタン（Enter が主、マウスだけでも完結できる） */}
      <button type="button" onClick={submit} disabled={!filled || saving} title="追加（Enter）"
        style={{
          width: TASK_COLS.toggle, height: TASK_COLS.toggle, flexShrink: 0, padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", borderRadius: 6, background: filled ? "#059669" : "transparent",
          cursor: filled && !saving ? "pointer" : "default",
        }}>
        <Plus style={{ width: 13, height: 13, color: filled ? "#FFF" : "#C9C4BB" }} />
      </button>

      <span style={{ width: TASK_COLS.expand, flexShrink: 0 }} />

      <input ref={inputRef} value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          if (e.key === "Escape") { setTitle(""); (e.currentTarget as HTMLInputElement).blur(); }
        }}
        placeholder="タスクを入力して Enter で追加"
        style={{
          flex: 1, minWidth: 0, fontSize: 13, color: "#1A1714", fontFamily: "inherit",
          background: "transparent", border: "none", outline: "none", padding: "3px 0",
        }} />

      {/* 分類は自由入力＋既存候補（datalist）。選ぶことも打ち込むこともできる */}
      <input list={CATEGORY_LIST_ID} value={category} onChange={e => setCategory(e.target.value)}
        placeholder="分類" title="分類"
        style={{ ...CELL, width: TASK_COLS.category, cursor: "text" }} />
      <datalist id={CATEGORY_LIST_ID}>
        {categories.map(c => <option key={c} value={c} />)}
      </datalist>

      {showProject && (
        <select value={projectId} onChange={e => setProjectId(e.target.value)} title="プロジェクト"
          disabled={!!fixedProjectId}
          style={{ ...CELL, width: TASK_COLS.project }}>
          <option value="">個人タスク</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      {/* 優先度は色で分かるように、選択肢の左に点を重ねる */}
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center", width: TASK_COLS.priority, flexShrink: 0 }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: pri.color, position: "absolute", left: 6, pointerEvents: "none" }} />
        <select value={priority} onChange={e => setPriority(e.target.value as Priority)} title="優先度"
          style={{ ...CELL, width: "100%", paddingLeft: 17, appearance: "none" as const }}>
          {TASK_PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </span>

      <select value={assignee} onChange={e => setAssignee(e.target.value)} title="担当者"
        style={{ ...CELL, width: TASK_COLS.assignee }}>
        <option value="">未割当</option>
        {members.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
      </select>

      <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} title="開始日"
        style={{ ...CELL, width: TASK_COLS.start }} />

      <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} title="期限"
        min={startDate || undefined}
        style={{ ...CELL, width: TASK_COLS.due }} />

      <select value={status} onChange={e => setStatus(e.target.value as TaskStatus)} title="ステータス"
        style={{ ...CELL, width: TASK_COLS.status }}>
        {TASK_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
    </div>
  );
}
