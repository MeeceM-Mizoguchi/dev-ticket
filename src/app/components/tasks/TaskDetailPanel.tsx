// ENHA2-032 タスクの詳細パネル（右からのスライドイン）。
//
// TicketDetailPanel はチケット固有の処理（レビュー往復・工数・子チケット等）で
// 3000行級になっているため流用せず、同じ見た目の軽量版をここに作る。
//
// 編集は即時反映（楽観更新）。タイトルと詳細メモだけはローカル state を持ち、
// blur / ⌘Enter で確定する（1文字ごとに update を投げないため）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, Trash2, Hash, FolderKanban, Ticket as TicketIcon, Share2, Calendar, ListChecks, CornerLeftUp, Check, Plus, Tag } from "lucide-react";
import { RichEditor } from "@/app/components/shared/RichEditor";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { Avatar } from "@/app/components/shared/Avatar";
import { TaskShareField } from "@/app/components/tasks/TaskShareField";
import { escStack } from "@/app/lib/escStack";
import {
  TASK_STATUSES, TASK_PRIORITIES, getTaskStatusMeta,
  loadTaskShares, loadProjectTickets,
  type MemberOption, type ProjectOption, type TicketOption,
} from "@/app/lib/taskService";
import type { Task, TaskShare, TaskStatus, Priority } from "@/app/types";

const DETAIL_CATEGORY_LIST_ID = "task-detail-categories";

const LABEL: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, color: "#9E9690",
  letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6, display: "block",
};

function Row({ icon: Icon, label, children }: { icon?: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={LABEL}>
        {Icon && <Icon style={{ width: 10, height: 10, marginRight: 4, display: "inline", verticalAlign: "-1px" }} />}
        {label}
      </label>
      {children}
    </div>
  );
}

/** サブタスクの一覧＋追加。子チケットと同じく1階層のみなので、子には出さない */
function SubtaskSection({ subtasks, canEdit, onCreate, onToggle, onOpen }: {
  subtasks: Task[];
  canEdit: boolean;
  onCreate: (title: string) => Promise<boolean>;
  onToggle: (child: Task, status: TaskStatus) => void;
  onOpen: (child: Task) => void;
}) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const v = title.trim();
    if (!v || saving) return;
    setSaving(true);
    const ok = await onCreate(v);
    setSaving(false);
    if (ok) { setTitle(""); ref.current?.focus(); }
  };

  return (
    <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
      {subtasks.length === 0 && (
        <p style={{ fontSize: 11.5, color: "#B0A9A4", margin: 0, padding: "10px 12px" }}>
          サブタスクはありません
        </p>
      )}
      {subtasks.map((s, i) => {
        const done = s.status === "done";
        return (
          <div key={s.id}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: i === 0 ? "none" : "1px solid rgba(26,23,20,0.05)" }}>
            <button type="button" disabled={!canEdit}
              onClick={() => onToggle(s, done ? "todo" : "done")}
              title={done ? "完了を取り消す" : "完了にする"}
              style={{
                width: 16, height: 16, borderRadius: 5, flexShrink: 0, padding: 0,
                border: done ? "none" : "1.5px solid rgba(26,23,20,0.18)",
                background: done ? "#059669" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: canEdit ? "pointer" : "default",
              }}>
              {done && <Check style={{ width: 11, height: 11, color: "#FFF" }} />}
            </button>
            <button type="button" onClick={() => onOpen(s)}
              style={{
                flex: 1, minWidth: 0, textAlign: "left" as const, border: "none", background: "transparent",
                cursor: "pointer", padding: 0, fontSize: 12.5, fontFamily: "inherit",
                color: "#1A1714", opacity: done ? 0.4 : 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
              }}>
              {s.title}
            </button>
          </div>
        );
      })}
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderTop: "1px solid rgba(26,23,20,0.05)", background: "#FAFAF9" }}>
          <Plus style={{ width: 13, height: 13, color: title ? "#059669" : "#C9C4BB", flexShrink: 0 }} />
          <input ref={ref} value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
              if (e.key === "Escape") { setTitle(""); (e.currentTarget as HTMLInputElement).blur(); }
            }}
            placeholder="サブタスクを入力して Enter で追加"
            style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#1A1714", fontFamily: "inherit", background: "transparent", border: "none", outline: "none" }} />
        </div>
      )}
    </div>
  );
}

export function TaskDetailPanel({
  task, projects, members, categories, subtasks, parentTask, currentUserId, currentUserName, canEdit,
  onPatch, onDelete, onClose, onShared, onAssigned, onCreateSubtask, onPatchTask, onOpenTask,
}: {
  task: Task;
  projects: ProjectOption[];
  members: MemberOption[];
  /** 既に使われている分類。入力欄の候補に出す（自由入力も可） */
  categories: string[];
  /** このタスクのサブタスク（親タスクのときだけ中身が入る） */
  subtasks: Task[];
  /** このタスクがサブタスクのときの親 */
  parentTask: Task | null;
  currentUserId: string;
  currentUserName: string;
  canEdit: boolean;
  onPatch: (patch: Partial<Task>) => void;
  onDelete: () => void;
  onClose: () => void;
  onShared: (name: string) => void;
  onAssigned: (name: string) => void;
  onCreateSubtask: (parent: Task, title: string) => Promise<boolean>;
  /** サブタスク行のチェックなど、表示中のタスク以外を更新する */
  onPatchTask: (target: Task, patch: Partial<Task>) => void;
  onOpenTask: (target: Task) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [category, setCategory] = useState(task.category);
  const [shares, setShares] = useState<TaskShare[]>(task.shares);
  const [tickets, setTickets] = useState<TicketOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const taskIdRef = useRef(task.id);

  const isOwner = task.ownerId === currentUserId;

  // 別のタスクへ切り替わったら編集中の値を作り直す
  useEffect(() => {
    if (taskIdRef.current === task.id) return;
    taskIdRef.current = task.id;
    setTitle(task.title);
    setDescription(task.description);
    setCategory(task.category);
    setShares(task.shares);
  }, [task.id, task.title, task.description, task.category, task.shares]);

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  // 共有相手は詳細を開いたときだけ引く（一覧では引かない）
  useEffect(() => {
    let alive = true;
    loadTaskShares(task.id).then(s => { if (alive) setShares(s); });
    return () => { alive = false; };
  }, [task.id]);

  // チケット候補はプロジェクトが決まっているときだけ
  useEffect(() => {
    let alive = true;
    if (!task.projectId) { setTickets([]); return; }
    loadProjectTickets(task.projectId).then(t => { if (alive) setTickets(t); });
    return () => { alive = false; };
  }, [task.projectId]);

  const commitTitle = useCallback(() => {
    const v = title.trim();
    if (!v || v === task.title) { setTitle(task.title); return; }
    onPatch({ title: v });
  }, [title, task.title, onPatch]);

  const commitDescription = useCallback(() => {
    if (description === task.description) return;
    onPatch({ description });
  }, [description, task.description, onPatch]);

  const commitCategory = useCallback(() => {
    const v = category.trim();
    if (v === task.category) return;
    onPatch({ category: v });
  }, [category, task.category, onPatch]);

  const handleAssignee = (name: string) => {
    onPatch({ assignee: name });
    if (name && name !== currentUserName) onAssigned(name);
  };

  const handleProject = (id: string) => {
    // プロジェクトを変えるとチケット候補が変わるため、紐付けを外す
    onPatch({ projectId: id || null, ticketId: null, ticketWbs: "" });
  };

  const handleTicket = (id: string) => {
    const t = tickets.find(x => x.id === id);
    onPatch({ ticketId: id || null, ticketWbs: t?.wbs ?? "" });
  };

  const statusMeta = getTaskStatusMeta(task.status);
  const project = useMemo(() => projects.find(p => p.id === task.projectId) ?? null, [projects, task.projectId]);
  const memberNames = useMemo(() => members.map(m => m.name), [members]);
  const ticketSuggestions = useMemo(() => tickets.map(t => ({ wbs: t.wbs, title: t.title })), [tickets]);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,12,0.35)", zIndex: 290 }} onClick={onClose} />
      <aside style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(520px, 92vw)", zIndex: 291,
        background: "#FFFFFF", boxShadow: "-12px 0 40px rgba(0,0,0,0.14)",
        display: "flex", flexDirection: "column",
      }}>
        {/* ── ヘッダー ── */}
        <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 99, background: statusMeta.bg, color: statusMeta.color, border: `1px solid ${statusMeta.border}` }}>
                {statusMeta.label}
              </span>
              {task.projectId ? (
                <span style={{ fontSize: 10, color: "#6B6458", display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <FolderKanban style={{ width: 10, height: 10 }} />{project?.name ?? "プロジェクト"}
                </span>
              ) : (
                <span style={{ fontSize: 10, color: "#B0A9A4" }}>個人タスク</span>
              )}
            </div>
            <textarea
              value={title}
              readOnly={!canEdit}
              onChange={e => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); } }}
              rows={1}
              style={{ width: "100%", border: "none", outline: "none", resize: "none" as const, fontSize: 16, fontWeight: 700, color: "#1A1714", lineHeight: 1.4, fontFamily: "inherit", background: "transparent", overflow: "hidden" }}
              onInput={e => {
                const el = e.currentTarget as HTMLTextAreaElement;
                el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`;
              }}
              ref={el => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }}
            />
          </div>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            {isOwner && (
              <button type="button" onClick={() => setConfirmDelete(true)} title="削除"
                style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(26,23,20,0.1)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#DC2626" }}>
                <Trash2 style={{ width: 13, height: 13 }} />
              </button>
            )}
            <button type="button" onClick={onClose} title="閉じる"
              style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(26,23,20,0.1)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#6B6458" }}>
              <X style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>

        {/* ── 本文 ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <Row label="ステータス">
              <CustomSelect value={task.status} onChange={v => canEdit && onPatch({ status: v as TaskStatus })}
                options={TASK_STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color, bg: s.bg }))} />
            </Row>
            <Row label="優先度">
              <CustomSelect value={task.priority} onChange={v => canEdit && onPatch({ priority: v as Priority })}
                options={TASK_PRIORITIES.map(p => ({ value: p.value, label: p.label, color: p.color, bg: p.bg }))} />
            </Row>
            <Row label="担当者">
              <CustomSelect value={task.assignee} onChange={v => canEdit && handleAssignee(v)}
                placeholder="未割当"
                options={[{ value: "", label: "未割当" }, ...memberNames.map(n => ({ value: n, label: n }))]} />
            </Row>
            <Row label="作成者">
              <div style={{ display: "flex", alignItems: "center", gap: 6, height: 38 }}>
                <Avatar name={task.createdBy} size="xs" />
                <span style={{ fontSize: 12.5, color: "#1A1714" }}>{task.createdBy || "—"}</span>
              </div>
            </Row>
            <Row icon={Calendar} label="開始日">
              <DatePicker value={task.startDate} onChange={v => canEdit && onPatch({ startDate: v })} disabled={!canEdit} />
            </Row>
            <Row icon={Calendar} label="期限">
              <DatePicker value={task.dueDate} onChange={v => canEdit && onPatch({ dueDate: v })} disabled={!canEdit} />
            </Row>
          </div>

          <Row icon={Tag} label="分類">
            <input list={DETAIL_CATEGORY_LIST_ID} value={category}
              readOnly={!canEdit}
              onChange={e => setCategory(e.target.value)}
              onBlur={commitCategory}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); (e.currentTarget as HTMLInputElement).blur(); } }}
              placeholder="未分類（自由に入力できます）"
              style={{ width: "100%", padding: "9px 11px", fontSize: 13, color: "#1A1714", background: "#F7F8F9", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 9, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }} />
            <datalist id={DETAIL_CATEGORY_LIST_ID}>
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
          </Row>

          <Row icon={FolderKanban} label="プロジェクト">
            <CustomSelect value={task.projectId ?? ""} onChange={v => canEdit && handleProject(v)}
              placeholder="なし（個人タスク）"
              options={[{ value: "", label: "なし（個人タスク）" }, ...projects.map(p => ({ value: p.id, label: p.name }))]} />
            {task.projectId && (
              <p style={{ fontSize: 10.5, color: "#A09790", margin: "6px 0 0" }}>
                このプロジェクトのメンバー全員に公開されます
              </p>
            )}
          </Row>

          <Row icon={TicketIcon} label="関連チケット">
            {task.projectId ? (
              <CustomSelect value={task.ticketId ?? ""} onChange={v => canEdit && handleTicket(v)}
                placeholder="なし"
                options={[{ value: "", label: "なし" }, ...tickets.map(t => ({ value: t.id, label: `${t.wbs} ${t.title}` }))]} />
            ) : task.ticketWbs ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 5, padding: "2px 7px", fontFamily: "var(--font-mono)" }}>
                <Hash style={{ width: 10, height: 10 }} />{task.ticketWbs}
              </span>
            ) : (
              <p style={{ fontSize: 11.5, color: "#B0A9A4", margin: 0 }}>プロジェクトを選ぶとチケットを紐付けられます</p>
            )}
          </Row>

          {/* サブタスク。1階層のみなので、自分が子なら親へのリンクだけ出す */}
          {parentTask ? (
            <Row icon={CornerLeftUp} label="親タスク">
              <button type="button" onClick={() => onOpenTask(parentTask)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 11px", fontSize: 12.5, color: "#1A1714", background: "#F7F8F9", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 9, cursor: "pointer", maxWidth: "100%", fontFamily: "inherit" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{parentTask.title}</span>
              </button>
              <p style={{ fontSize: 10.5, color: "#A09790", margin: "6px 0 0" }}>
                サブタスクはさらに分割できません（1階層のみ）
              </p>
            </Row>
          ) : (
            <Row icon={ListChecks}
              label={subtasks.length > 0
                ? `サブタスク（${subtasks.filter(s => s.status === "done").length}/${subtasks.length}）`
                : "サブタスク"}>
              <SubtaskSection
                subtasks={subtasks}
                canEdit={canEdit}
                onCreate={t => onCreateSubtask(task, t)}
                onToggle={(child, status) => onPatchTask(child, { status })}
                onOpen={onOpenTask}
              />
            </Row>
          )}

          <Row icon={Share2} label="共有">
            <TaskShareField
              taskId={task.id}
              shares={shares}
              members={members}
              canManage={isOwner}
              ownerName={task.createdBy}
              onChange={setShares}
              onShared={onShared}
            />
            {!task.projectId && shares.length === 0 && (
              <p style={{ fontSize: 10.5, color: "#A09790", margin: "6px 0 0" }}>
                共有していないタスクは自分だけが見られます
              </p>
            )}
          </Row>

          <Row label="詳細メモ">
            <RichEditor
              value={description}
              onChange={setDescription}
              onSubmit={commitDescription}
              readOnly={!canEdit}
              placeholder="メモ・手順・参考リンクなど（⌘/Ctrl + Enter で確定）"
              minHeight={140}
              members={memberNames}
              tickets={ticketSuggestions}
            />
            {canEdit && description !== task.description && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button type="button" onClick={commitDescription}
                  style={{ padding: "7px 16px", fontSize: 12, fontWeight: 700, color: "#FFF", background: "#059669", border: "none", borderRadius: 9, cursor: "pointer" }}>
                  メモを保存
                </button>
              </div>
            )}
          </Row>
        </div>
      </aside>

      {confirmDelete && (
        <ConfirmDialog
          title="タスクの削除"
          message={subtasks.length > 0
            ? `「${task.title}」を削除します。\nサブタスク ${subtasks.length}件も一緒に削除されます。`
            : `「${task.title}」を削除します。`}
          onConfirm={onDelete}
          onClose={() => setConfirmDelete(false)}
          zIndex={300}
        />
      )}
    </>
  );
}
