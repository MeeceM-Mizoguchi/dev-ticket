// ENHA2-032 タスクのリストビュー（既定・最軽量）。
//
// この表がタスク編集の場そのもの。詳細パネルは持たず、行のどのセルもその場で直せる。
// 見出し・データ行・追加行（TaskQuickAddRow）はすべて TASK_COLS の同じ幅を使うので、
// 3者が縦に揃う。セルの見た目は「素の文字」で、枠は出さない（.task-cell）。
//
// 文字のセル（タイトル・詳細）は打っている間は保存せず、Enter か欄から離れたときに
// 確定する。選ぶだけのセル（PJ・優先度・担当・日付・ステータス）はその場で確定する。
//
// サブタスク（子チケットと同じく1階層のみ）は親行の下にぶら下げる。
// 親行の ▸ で開閉し、開いた中に「サブタスクを追加」の入力行が生えている。
// その追加行も表の最終行と同じ全項目ぶんの入力欄（renderSubtaskAdd で受け取る）。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, CornerDownRight, Hash, Trash2, Users } from "lucide-react";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { PickerCell, type PickerOption } from "@/app/components/tasks/TaskPickerCell";
import {
  TASK_STATUSES, TASK_PRIORITIES, getTaskStatusMeta,
  type MemberOption, type ProjectOption,
} from "@/app/lib/taskService";
import { descriptionToText, textToDescription } from "@/app/lib/taskDescription";
import { TaskCategoryField } from "@/app/components/tasks/TaskCategoryField";
import type { Task, TaskStatus, Priority } from "@/app/types";

/** 見出し・データ行・追加行で共有する列幅 */
export const TASK_COLS = {
  toggle: 18,
  expand: 14,
  category: 150,
  priority: 48,
  project: 132,
  assignee: 112,
  start: 106,
  due: 106,
  status: 86,
  /** 行末の共有ボタン。追加行・見出しでは空けておく */
  share: 26,
  /** 行末の削除ボタン。追加行・見出しでは空けておく */
  menu: 20,
  gap: 10,
  padX: 14,
};

/**
 * タイトルと詳細は幅を固定せず、余った横幅を分け合う。
 * 詳細のほうが長い文章が入るので、タイトルより広く取る（1 : 1.6）。
 */
export const TITLE_CELL: React.CSSProperties = { flex: "1 1 0", minWidth: 0 };
export const DESC_CELL: React.CSSProperties = { flex: "1.6 1 0", minWidth: 0 };

/** タイトルと詳細は同じ本文の文字。読むところなので、他のセルより大きく濃い */
export const BODY_TEXT: React.CSSProperties = { fontSize: 13, color: "#1A1714", fontWeight: 500 };

/** どのセルもタイトル欄と同じ「素の文字」。枠も背景も持たない（.task-cell） */
export const CELL: React.CSSProperties = {
  fontSize: 11, color: "#6B6458",
  padding: 0, outline: "none", cursor: "pointer",
  fontFamily: "inherit", flexShrink: 0, boxSizing: "border-box",
  appearance: "none" as const,
};

/**
 * 選択肢を持つセルの器。中身は素の文字のままで、マウスを乗せたときだけ ▼ を出す
 * （枠を出さない代わりに「ここは選べる」と分かるようにするため）。
 */
export function SelectCell({ width, children }: { width: number; children: React.ReactNode }) {
  return (
    <span className="task-select"
      style={{ position: "relative", display: "inline-flex", alignItems: "center", width, flexShrink: 0 }}>
      {children}
      <ChevronDown className="task-select-arrow"
        style={{ width: 10, height: 10, position: "absolute", right: 0, pointerEvents: "none", color: "#A09790" }} />
    </span>
  );
}

/** サブタスク1段ぶんの字下げ */
const INDENT = 22;

/** 優先度の選択肢。行ごとに作り直す必要はないので外に出す */
const PRIORITY_OPTIONS: PickerOption[] = TASK_PRIORITIES.map(p => ({ value: p.value, label: p.label, color: p.color }));

/** 期限切れ判定。完了したタスクは対象外 */
export function isOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === "done") return false;
  return t.dueDate < new Date().toLocaleDateString("sv-SE");
}

/** メニュー1件ぶんの高さ（見積り）。下に入りきるかの判定に使う */
const STATUS_MENU_ITEM_H = 33;

function StatusPill({ status, onChange, disabled }: {
  status: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean;
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
    <div style={{ position: "relative", width: TASK_COLS.status, flexShrink: 0 }}>
      <button ref={btnRef} type="button" disabled={disabled}
        onClick={() => (open ? setPos(null) : place())}
        style={{
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

/**
 * 文字のセル。1文字ごとに保存すると更新が飛びすぎるので、
 * Enter か欄から離れたときにだけ確定する（Esc で打ちかけを捨てる）。
 */
function TextCell({ value, onCommit, disabled, placeholder, allowEmpty = true, style }: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /** 空を許すか。タイトルは空にできないので、空のまま離れたら元に戻す */
  allowEmpty?: boolean;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);

  // 他の場所（かんばんの D&D など）で書き換わったら、打っていない間は追従する
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (!v && !allowEmpty) { setDraft(value); return; }
    if (v === value) return;
    onCommit(v);
  };

  if (disabled) {
    return (
      <span title={value} style={{ ...style, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value || "—"}
      </span>
    );
  }

  return (
    <input className="task-cell" value={draft} title={draft || placeholder}
      onChange={e => { setEditing(true); setDraft(e.target.value); }}
      onFocus={() => setEditing(true)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); }
        if (e.key === "Escape") { setDraft(value); setEditing(false); (e.currentTarget as HTMLInputElement).blur(); }
      }}
      placeholder={placeholder}
      style={{ ...style, cursor: "text" }} />
  );
}

/**
 * 詳細メモのセル。
 *
 * 追加行（TaskQuickAddRow）とまったく同じ1行の入力欄。追加も編集も同じ操作でできる。
 * 詳細メモは HTML で持っているので、表示するときは素のテキストへ潰し、
 * 確定するときに段落へ戻す（taskDescription）。
 *
 * 箇条書きなど書式つきのメモを1行に潰すと書式は落ちるが、打ち直さずに欄から
 * 離れただけなら TextCell が保存しないので、クリックしただけで消えることはない。
 */
function DescriptionCell({ task, editable, onCommit, textStyle }: {
  task: Task;
  editable: boolean;
  onCommit: (description: string) => void;
  /** 完了行など、文字色の上書き */
  textStyle?: React.CSSProperties;
}) {
  const text = useMemo(() => descriptionToText(task.description), [task.description]);

  return (
    <TextCell
      value={text}
      disabled={!editable}
      placeholder="詳細"
      onCommit={v => onCommit(textToDescription(v))}
      style={{ ...DESC_CELL, ...BODY_TEXT, ...textStyle }} />
  );
}

function TaskRow({
  task, depth, expanded, childCount, doneCount, editable, deletable, highlighted,
  showProject, projectOptions, assigneeOptions, categoryOptions,
  shareable, shareCount,
  onToggleExpand, onPatch, onDelete, onShare,
}: {
  task: Task;
  depth: number;
  expanded: boolean;
  childCount: number;
  doneCount: number;
  editable: boolean;
  deletable: boolean;
  /** お知らせやかんばんから飛んできた行。目印に色を付けるだけ */
  highlighted: boolean;
  showProject: boolean;
  projectOptions: PickerOption[];
  assigneeOptions: PickerOption[];
  categoryOptions: string[];
  /** 共有を付け外しできるか（＝自分が持ち主か）。RLS の task_shares_write と同じ */
  shareable: boolean;
  /** いま共有している人数。0 でなければボタンを出しっぱなしにする */
  shareCount: number;
  onToggleExpand: () => void;
  onPatch: (t: Task, patch: Partial<Task>) => void;
  onDelete: (t: Task) => void;
  onShare: (t: Task) => void;
}) {
  const done = task.status === "done";
  const overdue = isOverdue(task);

  // 完了行は「背景をはっきりグレーにする」だけで示す。
  // 透かしたり取り消し線を引いたりすると読みづらくなるので、文字は落ち着いた色に
  // 変えるにとどめ、値はそのまま読めて触れる状態を保つ。
  // ステータスの「完了」バッジとチェックは合図そのものなので色を落とさない。
  const doneTitle: React.CSSProperties | undefined = done ? { color: "#6B6458" } : undefined;
  const doneText: React.CSSProperties | undefined = done ? { color: "#8A837B" } : undefined;
  const doneSub: React.CSSProperties | undefined = done ? { color: "#9E9690" } : undefined;
  const baseBg = highlighted ? "#F0FDF4" : done ? "#E8E6E1" : depth > 0 ? "#FCFCFB" : "transparent";

  return (
    <div className="task-row" data-task-id={task.id}
      style={{
        display: "flex", alignItems: "center", gap: TASK_COLS.gap,
        padding: `8px ${TASK_COLS.padX}px`,
        borderTop: "1px solid rgba(26,23,20,0.05)",
        background: baseBg,
        transition: "background 0.12s",
      }}>

      {/* 完了トグル */}
      <button type="button" disabled={!editable}
        onClick={() => onPatch(task, { status: done ? "todo" : "done" })}
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
          <button type="button" onClick={onToggleExpand}
            title={expanded ? "サブタスクを閉じる" : childCount > 0 ? "サブタスクを開く" : "サブタスクを追加"}
            style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", color: childCount > 0 ? "#9E9690" : "#D5D0CB" }}>
            {expanded
              ? <ChevronDown style={{ width: 13, height: 13 }} />
              : <ChevronRight style={{ width: 13, height: 13 }} />}
          </button>
        )}
      </span>

      {/* タイトル */}
      <span style={{ ...TITLE_CELL, display: "flex", alignItems: "center", gap: 6, paddingLeft: depth * INDENT }}>
        {/* 親が絞り込みで消えている子は最上位に出るので、depth ではなく parentId で判定する */}
        {task.parentId && <CornerDownRight style={{ width: 11, height: 11, color: "#C9C4BB", flexShrink: 0 }} />}
        <TextCell
          value={task.title} disabled={!editable} allowEmpty={false} placeholder="タイトル"
          onCommit={v => onPatch(task, { title: v })}
          style={{ ...BODY_TEXT, ...doneTitle, flex: 1, minWidth: 0, fontSize: depth > 0 ? 12.5 : 13 }} />
        {childCount > 0 && (
          <span title="サブタスクの進捗"
            style={{ fontSize: 9.5, fontWeight: 700, color: doneCount === childCount ? "#059669" : "#9E9690", background: doneCount === childCount ? "#ECFDF5" : "#F4F5F6", borderRadius: 99, padding: "1px 6px", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
            {doneCount}/{childCount}
          </span>
        )}
        {task.ticketWbs && (
          <span title="紐付いているチケット"
            style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
            <Hash style={{ width: 9, height: 9 }} />{task.ticketWbs}
          </span>
        )}
      </span>

      {/* 詳細メモ */}
      <DescriptionCell task={task} editable={editable} textStyle={doneText}
        onCommit={description => onPatch(task, { description })} />

      {/* 分類（複数） */}
      <span title="分類"
        style={{ width: TASK_COLS.category, flexShrink: 0, display: "inline-flex", alignItems: "center", boxSizing: "border-box" }}>
        <TaskCategoryField
          values={task.categories} options={categoryOptions} disabled={!editable} wrap={false}
          placeholder="分類"
          onChange={next => onPatch(task, { categories: next })} />
      </span>

      {/* プロジェクト。付け替えるとチケット候補が変わるので、紐付けは外す */}
      {showProject && (
        <PickerCell width={TASK_COLS.project} value={task.projectId ?? ""} disabled={!editable} title="プロジェクト"
          options={projectOptions} placeholder={task.projectId ? "プロジェクト" : "個人タスク"}
          textStyle={doneSub}
          onChange={v => onPatch(task, { projectId: v || null, ticketId: null, ticketWbs: "" })} />
      )}

      <PickerCell width={TASK_COLS.priority} value={task.priority} disabled={!editable} title="優先度"
        options={PRIORITY_OPTIONS} textStyle={doneSub}
        onChange={v => onPatch(task, { priority: v as Priority })} />

      <PickerCell width={TASK_COLS.assignee} value={task.assignee} disabled={!editable} title="担当者"
        options={assigneeOptions} placeholder={task.assignee || "未割当"} textStyle={doneSub}
        onChange={v => onPatch(task, { assignee: v })} />

      <span style={{ width: TASK_COLS.start, flexShrink: 0 }}>
        <DatePicker variant="cell" value={task.startDate} disabled={!editable}
          cellStyle={doneSub}
          onChange={v => onPatch(task, { startDate: v })} />
      </span>

      <span style={{ width: TASK_COLS.due, flexShrink: 0 }}>
        <DatePicker variant="cell" value={task.dueDate} disabled={!editable}
          min={task.startDate || undefined}
          onChange={v => onPatch(task, { dueDate: v })}
          cellStyle={overdue ? { color: "#DC2626", fontWeight: 700 } : doneSub} />
      </span>

      <StatusPill status={task.status} disabled={!editable}
        onChange={s => onPatch(task, { status: s })} />

      {/* 共有。誰かに共有していれば人数を出しっぱなしにし（見せている相手がいることを
          一覧のまま気付けるように）、0人のときは行にマウスを乗せたときだけ出す。 */}
      <span style={{ width: TASK_COLS.share, flexShrink: 0, display: "flex", justifyContent: "center" }}>
        {shareable && (
          <button type="button" className={shareCount > 0 ? undefined : "task-row-share"}
            onClick={() => onShare(task)}
            title={shareCount > 0 ? `${shareCount}人に共有中（共有先を変更）` : "このタスクを共有する"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 2, padding: "1px 4px",
              border: "none", borderRadius: 5, cursor: "pointer",
              background: shareCount > 0 ? "#ECFDF5" : "transparent",
              color: shareCount > 0 ? "#059669" : "#C9C4BB",
            }}
            onMouseEnter={e => { if (shareCount === 0) (e.currentTarget as HTMLElement).style.color = "#059669"; }}
            onMouseLeave={e => { if (shareCount === 0) (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
            <Users style={{ width: 12, height: 12 }} />
            {shareCount > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "var(--font-mono)" }}>{shareCount}</span>
            )}
          </button>
        )}
      </span>

      {/* 削除。行にマウスを乗せたときだけ出す（誤爆を減らす） */}
      <span style={{ width: TASK_COLS.menu, flexShrink: 0, display: "flex", justifyContent: "center" }}>
        {deletable && (
          <button type="button" className="task-row-del" onClick={() => onDelete(task)} title="このタスクを削除"
            style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "flex", color: "#C9C4BB" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
            <Trash2 style={{ width: 12, height: 12 }} />
          </button>
        )}
      </span>
    </div>
  );
}

export function TaskListView({
  tasks, allTasks, showProject, canEdit, canDelete, canShare, shareCountOf, highlightId,
  projects, members, categoryOptions,
  onPatch, onDelete, onShare, renderSubtaskAdd, quickAdd,
}: {
  /** 絞り込み後（画面に出す分） */
  tasks: Task[];
  /** 絞り込み前。サブタスクの件数を正しく数えるために使う */
  allTasks: Task[];
  showProject: boolean;
  canEdit: (t: Task) => boolean;
  canDelete: (t: Task) => boolean;
  /** 共有を付け外しできるか（＝持ち主か）。false の行にはボタンを出さない */
  canShare: (t: Task) => boolean;
  /** いま共有している人数 */
  shareCountOf: (t: Task) => number;
  /** お知らせやかんばんから飛んできた行。色を付けてその位置まで送る */
  highlightId: string | null;
  projects: ProjectOption[];
  members: MemberOption[];
  /** 分類の候補（既に使われている値） */
  categoryOptions: string[];
  onPatch: (t: Task, patch: Partial<Task>) => void;
  onDelete: (t: Task) => void;
  /** 共有ダイアログを開く */
  onShare: (t: Task) => void;
  /** 親を開いたときに下へ生やす「サブタスクを追加」行（TaskQuickAddRow） */
  renderSubtaskAdd: (parent: Task) => React.ReactNode;
  /** 表の最終行に生やす追加行（TaskQuickAddRow）。渡さなければ出ない */
  quickAdd?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);

  // 選択肢は行ごとに作り直さない
  const projectOptions = useMemo<PickerOption[]>(
    () => [{ value: "", label: "個人タスク" }, ...projects.map(p => ({ value: p.id, label: p.name }))],
    [projects]);
  const assigneeOptions = useMemo<PickerOption[]>(
    () => [{ value: "", label: "未割当" }, ...members.map(m => ({ value: m.name, label: m.name }))],
    [members]);

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

  // かんばん／ガント／お知らせから指定された行までスクロールする
  useEffect(() => {
    if (!highlightId) return;
    const el = boxRef.current?.querySelector(`[data-task-id="${highlightId}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, tasks]);

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
    <div ref={boxRef} style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, overflow: "hidden" }}>
      {/* ── 列見出し ── */}
      <div style={{
        display: "flex", alignItems: "center", gap: TASK_COLS.gap,
        padding: `8px ${TASK_COLS.padX}px`, background: "#FAFAF9",
        borderBottom: "1px solid rgba(26,23,20,0.07)",
      }}>
        <span style={{ width: TASK_COLS.toggle, flexShrink: 0 }} />
        <span style={{ width: TASK_COLS.expand, flexShrink: 0 }} />
        <span style={{ ...headCell, ...TITLE_CELL }}>タイトル</span>
        <span style={{ ...headCell, ...DESC_CELL }}>詳細</span>
        <span style={{ ...headCell, width: TASK_COLS.category }}>分類</span>
        {showProject && <span style={{ ...headCell, width: TASK_COLS.project }}>プロジェクト</span>}
        <span style={{ ...headCell, width: TASK_COLS.priority }}>優先度</span>
        <span style={{ ...headCell, width: TASK_COLS.assignee }}>担当者</span>
        <span style={{ ...headCell, width: TASK_COLS.start }}>開始日</span>
        <span style={{ ...headCell, width: TASK_COLS.due }}>期限</span>
        <span style={{ ...headCell, width: TASK_COLS.status, textAlign: "center" as const }}>ステータス</span>
        <span style={{ width: TASK_COLS.share, flexShrink: 0 }} />
        <span style={{ width: TASK_COLS.menu, flexShrink: 0 }} />
      </div>

      {roots.map(t => {
        const c = counts.get(t.id) ?? { total: 0, done: 0 };
        const isOpen = expanded.has(t.id);
        const kids = childrenOf.get(t.id) ?? [];
        return (
          <div key={t.id}>
            <TaskRow task={t} depth={0} expanded={isOpen}
              childCount={c.total} doneCount={c.done}
              editable={canEdit(t)} deletable={canDelete(t)} highlighted={highlightId === t.id}
              showProject={showProject}
              projectOptions={projectOptions} assigneeOptions={assigneeOptions}
              categoryOptions={categoryOptions}
              shareable={canShare(t)} shareCount={shareCountOf(t)}
              onToggleExpand={() => toggle(t.id)}
              onPatch={onPatch} onDelete={onDelete} onShare={onShare} />

            {isOpen && t.parentId === null && (
              <>
                {kids.map(k => (
                  <TaskRow key={k.id} task={k} depth={1} expanded={false}
                    childCount={0} doneCount={0}
                    editable={canEdit(k)} deletable={canDelete(k)} highlighted={highlightId === k.id}
                    showProject={showProject}
                    projectOptions={projectOptions} assigneeOptions={assigneeOptions}
                    categoryOptions={categoryOptions}
                    shareable={canShare(k)} shareCount={shareCountOf(k)}
                    onToggleExpand={() => {}}
                    onPatch={onPatch} onDelete={onDelete} onShare={onShare} />
                ))}
                {canEdit(t) && renderSubtaskAdd(t)}
              </>
            )}
          </div>
        );
      })}

      {quickAdd}
    </div>
  );
}
