// ENHA2-032 タスクの追加行（リストの見出しのすぐ下に生えている入力欄）。
//
// タスクは「思いついた瞬間に1行足す」ものなので、モーダルを開く・閉じるという
// 往復を挟まない。表の1行目にそのまま打ち込んで Enter で確定する
// （BRU13-044: 最終行だと件数が増えるほど遠くなり、足すたびに下へ送られてしまう）。
//
// Enter は「打ち終えた1件をそのまま登録」、Tab は「同じ行の右の列へ移る」。
// タイトルと詳細は body 直下に重ねた入力欄で打っているので、Tab は標準任せにできず
// TaskTextCell 側で次の欄へ渡している。
// 確定後もフォーカスと プロジェクト/担当者/優先度 は残るので、続けて何行でも打てる。
//
// 列幅は TASK_COLS を使う（見出し・データ行と縦を揃えるため）。
//
// 見た目は「表の続きの1行」に寄せてある。枠付きの入力欄を並べるとフォームに見えて
// タイトル欄だけ浮くので、どのセルも既定は素の文字（.task-cell）にして、
// マウスを乗せたときと入力中だけ枠を出す。
import { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TASK_STATUSES, TASK_PRIORITIES, type MemberOption, type ProjectOption } from "@/app/lib/taskService";
import type { NewTaskInput } from "@/app/lib/taskService";
import { TASK_COLS, TITLE_CELL, DESC_CELL, BODY_TEXT, CELL, ProgressCell } from "@/app/components/tasks/TaskListView";
import { ExpandingInput } from "@/app/components/tasks/TaskTextCell";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { PickerCell, type PickerOption } from "@/app/components/tasks/TaskPickerCell";
import { TaskCategoryField } from "@/app/components/tasks/TaskCategoryField";
import { textToDescription } from "@/app/lib/taskDescription";
import type { Priority, TaskStatus } from "@/app/types";

/** 行ごとに作り直す必要のない選択肢 */
const PRIORITY_OPTIONS: PickerOption[] = TASK_PRIORITIES.map(p => ({ value: p.value, label: p.label, color: p.color }));
const STATUS_OPTIONS: PickerOption[] = TASK_STATUSES.map(s => ({ value: s.value, label: s.label, color: s.color }));

export function TaskQuickAddRow({
  projects, members, categoryOptions, showProject, fixedProjectId, lockProject, defaultStatus,
  indent = 0, placeholder = "タスクを入力して Enter で追加", focusSignal, creatorName = "",
  atTop = false, onCreate,
}: {
  projects: ProjectOption[];
  members: MemberOption[];
  /** 既に使われている分類。入力するたびに候補として出す（新しい要素も足せる） */
  categoryOptions: string[];
  showProject: boolean;
  /** プロジェクト配下の画面では固定 */
  fixedProjectId?: string | null;
  /** プロジェクトを変えさせない（サブタスクは親と同じPJでないと見える人が食い違う） */
  lockProject?: boolean;
  /** 最初から選んだ状態にしておくステータス。省略すると「未選択」（登録時は未着手になる） */
  defaultStatus?: TaskStatus;
  /** タイトル欄の字下げ。サブタスクの追加行で親の下にぶら下げるのに使う */
  indent?: number;
  /** タイトル欄の案内文 */
  placeholder?: string;
  /** 値が変わるたびにタイトル入力へフォーカスする（ヘッダーの「タスクを追加」から） */
  focusSignal?: number;
  /** 起票者の列に出す自分の名前（BRU11-040）。追加した瞬間にこの名前で入るので先に見せる */
  creatorName?: string;
  /** 見出しのすぐ下に置くとき。区切り線を下側に出す（見出しの線と二重にしないため） */
  atTop?: boolean;
  onCreate: (input: Omit<NewTaskInput, "ownerId" | "createdBy">) => Promise<boolean>;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(fixedProjectId ?? "");
  const [categories, setCategories] = useState<string[]>([]);
  /**
   * BRU14-013 ステータスは初期値を持たせない（"" = 未選択）。
   * 「未着手」を出しておくと自分で選んだように見えてしまうため、選ぶまでは「未選択」と出す。
   * 登録するときは未着手として扱う（DB 側も status は必須）。
   */
  const [status, setStatus] = useState<TaskStatus | "">(defaultStatus ?? "");
  const [priority, setPriority] = useState<Priority>("medium");
  const [progress, setProgress] = useState(0);
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

  /**
   * 1行ぶんを登録する。
   * 進捗率の欄で Enter を押した場合は、state の反映を待たずに済むよう
   * 打ち終えた値を override で受け取る（同じ描画の中で読むと1つ前の値になるため）。
   */
  const submit = async (override?: { progress?: number }) => {
    const v = title.trim();
    if (!v || saving) return;
    setSaving(true);
    const ok = await onCreate({
      title: v, description: textToDescription(description),
      projectId: projectId || null, categories, status: status || "todo", priority,
      progress: override?.progress ?? progress,
      assignee, startDate, dueDate,
    });
    setSaving(false);
    if (!ok) return;
    // 続けて打てるように、行の性格（PJ・担当・優先度・ステータス・分類）は残して
    // その1件ぶんの中身（タイトル・詳細・日付・進捗率）だけ空にする
    setTitle("");
    setDescription("");
    setStartDate("");
    setDueDate("");
    setProgress(0);
    inputRef.current?.focus();
  };

  // 未選択のときは色を付けない（PickerCell の「値なし」の薄い文字のまま出す）
  const statusMeta = TASK_STATUSES.find(s => s.value === status);
  const projectOptions: PickerOption[] = [
    { value: "", label: "個人タスク" },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ];
  const assigneeOptions: PickerOption[] = [
    { value: "", label: "未割当" },
    ...members.map(m => ({ value: m.name, label: m.name })),
  ];
  const filled = title.trim().length > 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: TASK_COLS.gap,
      padding: `8px ${TASK_COLS.padX}px`,
      ...(atTop
        ? { borderBottom: "1px solid rgba(26,23,20,0.07)" }
        : { borderTop: "1px solid rgba(26,23,20,0.05)" }),
      background: filled ? "#F0FDF4" : indent > 0 ? "#FCFCFB" : "#FAFAF9",
    }}>
      {/* ＋ 自体が確定ボタン（Enter が主、マウスだけでも完結できる） */}
      <button type="button" onClick={() => submit()} disabled={!filled || saving} title="追加（Enter）"
        style={{
          width: TASK_COLS.toggle, height: TASK_COLS.toggle, flexShrink: 0, padding: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          border: "none", borderRadius: 6, background: filled ? "#059669" : "transparent",
          cursor: filled && !saving ? "pointer" : "default",
        }}>
        <Plus style={{ width: 13, height: 13, color: filled ? "#FFF" : "#C9C4BB" }} />
      </button>

      <span style={{ width: TASK_COLS.expand, flexShrink: 0 }} />

      {/* データ行と同じく、欄に入ると広がる（狭い列のままだと打った先が見えないため）。
          Enter はここでも「1件足す」なので、足したあとも欄は開けたままにする */}
      <ExpandingInput inputRef={inputRef} value={title}
        onChange={setTitle}
        onEnter={() => submit()}
        onEscape={() => setTitle("")}
        placeholder={placeholder}
        style={{
          ...TITLE_CELL, ...BODY_TEXT, fontFamily: "inherit",
          background: "transparent", border: "none", outline: "none",
          padding: "3px 0", paddingLeft: indent,
        }} />

      {/* 詳細メモ。1行ぶんのテキスト（データ行と同じ扱い） */}
      <ExpandingInput className="task-cell" value={description}
        onChange={setDescription}
        onEnter={() => submit()}
        onEscape={() => setDescription("")}
        placeholder="詳細"
        style={{ ...CELL, ...DESC_CELL, ...BODY_TEXT, cursor: "text" }} />

      {/* 分類は要素を足していく形。打つたびに過去の分類が候補に出る */}
      <span title="分類"
        style={{ ...CELL, width: TASK_COLS.category, cursor: "text", display: "inline-flex", alignItems: "center" }}>
        <TaskCategoryField
          values={categories} options={categoryOptions}
          placeholder="分類" wrap={false}
          onChange={setCategories}
          onEnterWhenEmpty={submit} />
      </span>

      {showProject && (
        <PickerCell width={TASK_COLS.project} value={projectId} title="プロジェクト"
          disabled={lockProject || !!fixedProjectId} options={projectOptions} placeholder="個人タスク"
          onChange={setProjectId} />
      )}

      <PickerCell width={TASK_COLS.priority} value={priority} title="優先度"
        options={PRIORITY_OPTIONS} onChange={v => setPriority(v as Priority)} />

      <PickerCell width={TASK_COLS.assignee} value={assignee} title="担当者"
        options={assigneeOptions} placeholder="未割当" onChange={setAssignee} />

      {/* 起票者は追加した人で決まるので選ばせない。自分の名前を薄く出しておく */}
      <span title={creatorName ? `起票者: ${creatorName}` : "起票者"}
        style={{
          ...CELL, width: TASK_COLS.creator, cursor: "default", color: "#B0A9A4",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
        {creatorName || "—"}
      </span>

      <span style={{ width: TASK_COLS.start, flexShrink: 0 }}>
        <DatePicker variant="cell" value={startDate} onChange={setStartDate} />
      </span>

      <span style={{ width: TASK_COLS.due, flexShrink: 0 }}>
        <DatePicker variant="cell" value={dueDate} min={startDate || undefined} onChange={setDueDate} />
      </span>

      {/* 進捗率。データ行と同じ「数字だけを打ち込む欄」 */}
      <ProgressCell value={progress} onCommit={setProgress}
        onEnter={v => { setProgress(v); submit({ progress: v }); }} />

      <PickerCell width={TASK_COLS.status} value={status} title="ステータス" align="center"
        options={STATUS_OPTIONS} onChange={v => setStatus(v as TaskStatus)}
        placeholder="未選択"
        textStyle={statusMeta ? { color: statusMeta.color, fontWeight: 700 } : undefined} />

      {/* 共有・削除のぶんは空けておく（まだ存在しないタスクなので押せる操作が無い） */}
      <span style={{ width: TASK_COLS.share, flexShrink: 0 }} />
      <span style={{ width: TASK_COLS.menu, flexShrink: 0 }} />
    </div>
  );
}
