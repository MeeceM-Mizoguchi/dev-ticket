// ENHA2-032 タスクのリストビュー（既定・最軽量）。
//
// この表がタスク編集の場そのもの。詳細パネルは持たず、行のどのセルもその場で直せる。
// 見出し・追加行（TaskQuickAddRow）・データ行はすべて同じ列幅（taskColumns の Context）を使うので、
// 3者が縦に揃う。セルの見た目は「素の文字」で、枠は出さない（.task-cell）。
//
// 文字のセル（タイトル・詳細）は打っている間は保存せず、Enter か欄から離れたときに
// 確定する。選ぶだけのセル（PJ・優先度・担当・日付・ステータス）はその場で確定する。
// 文字のセルは列幅より長い文章が入るので、欄に入ったら広い入力欄を重ねて全文を出し、
// 入っていなくてもマウスを乗せれば全文をツールチップで出す（TaskTextCell）。
//
// サブタスク（子チケットと同じく1階層のみ）は親行の下にぶら下げる。
// 親行の ▸ で開閉し、開いた中に「サブタスクを追加」の入力行が生えている。
// その追加行も見出し下の追加行と同じ全項目ぶんの入力欄（renderSubtaskAdd で受け取る）。
//
// BRU15-005
//   ・「列幅を広げる」モード：全列を固定幅にして、表の中だけ横にスクロールさせる。
//     オンにした瞬間は中身の最長の文字数ぶんまで各列を広げ、あとは見出しの境目をドラッグで
//     自由に変えられる（ダブルクリックでその列だけ中身に合わせ直す）。
//     見出し＋追加行の上部固定はそのまま、タイトル列は左に固定する。
//   ・「折り返し表示」モード：列幅に収まらない中身を「…」で切らず、折り返して行を高くする。
//   ・縦の罫線は見出し用・本体用にそれぞれ1枚のレイヤーを敷いて、同じ計算（taskColRuleOffsets）
//     から引く。セルごとに線を持たせると、見出しと本体で数pxずれたり二重線になったりする。
//   ・マウスを乗せたときの説明はすべて data-tip（アプリのUI）。title 属性は使わない。
//   ・サブタスクを持つ親の担当者・開始日・期限は子から決まる（taskRollup）。その欄は読むだけ。
//   ・担当者の候補は、そのタスクのプロジェクトに参画しているメンバーだけ。個人タスクは作成者で固定。
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, CornerDownRight, Hash, Trash2, Users } from "lucide-react";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { PickerCell, type PickerOption } from "@/app/components/tasks/TaskPickerCell";
import {
  TASK_STATUSES, TASK_PRIORITIES, getTaskStatusMeta, clampTaskProgress,
  type MemberOption, type ProjectOption,
} from "@/app/lib/taskService";
import { descriptionToText, textToDescription } from "@/app/lib/taskDescription";
import { TextCell } from "@/app/components/tasks/TaskTextCell";
import { TaskCategoryField } from "@/app/components/tasks/TaskCategoryField";
import {
  TASK_COLS, TASK_COL_LABELS, DEFAULT_COL_WIDTHS, MIN_COL_WIDTHS, MAX_AUTO_COL_WIDTH,
  TASK_RULE_COLOR, taskColRuleOffsets,
  TaskColLayoutProvider, useTaskCols, type TaskColKey, type TaskColWidths,
} from "@/app/components/tasks/taskColumns";
import { useSyncedHScroll, StickyHScrollBar } from "@/app/components/tasks/useSyncedHScroll";
import { ASSIGNEE_SEP, type TaskRollup, type TaskRollups } from "@/app/lib/taskRollup";
import type { Task, TaskStatus, Priority } from "@/app/types";

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

/** 選ばせない担当者セルに渡す空の選択肢 */
const NO_OPTIONS: PickerOption[] = [];

/** 列見出しの文字と背景 */
const HEAD_TEXT: React.CSSProperties = { fontSize: 9.5, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", flexShrink: 0 };
const HEAD_BG = "#FAFAF9";

/**
 * 進捗率は右寄せなので、そのままだと数字の右端が列の右端＝縦罫線にくっついて見える。
 * 値と見出しの両方を同じだけ内側へ入れる（列幅は変えない＝box-sizing は border-box）。
 */
const PROGRESS_PAD = 6;

/** 広げるモードで、列幅の合計まで横に伸ばす器（狭いときは表の幅いっぱい） */
const WIDE_INNER: React.CSSProperties = { width: "max-content", minWidth: "100%", position: "relative" };

const ALL_COL_KEYS = Object.keys(DEFAULT_COL_WIDTHS) as TaskColKey[];

/** 中身の長さが変わらない列（3択・日付・数字）。自動調整では初期幅のまま */
const FIXED_CONTENT_KEYS = new Set<TaskColKey>(["priority", "start", "due", "progress", "status"]);

/** 期限切れ判定。完了したタスクは対象外 */
export function isOverdue(t: Task): boolean {
  if (!t.dueDate || t.status === "done") return false;
  return t.dueDate < new Date().toLocaleDateString("sv-SE");
}

// ── 列幅の自動調整（文字の実寸を測る） ────────────────────────────

let measureCanvas: HTMLCanvasElement | null = null;

function textWidth(text: string, font: string): number {
  if (!text) return 0;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * 13;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** 画面と同じ書体で測る（フォントは CSS 変数で差し替わるので決め打ちにしない） */
function measureFonts() {
  const body = getComputedStyle(document.body).fontFamily || "sans-serif";
  const mono = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() || "monospace";
  return {
    body: (size: number, weight = 400) => `${weight} ${size}px ${body}`,
    mono: (size: number, weight = 700) => `${weight} ${size}px ${mono}`,
  };
}

/** メニュー1件ぶんの高さ（見積り）。下に入りきるかの判定に使う */
const STATUS_MENU_ITEM_H = 33;

function StatusPill({ status, onChange, disabled }: {
  status: TaskStatus; onChange: (s: TaskStatus) => void; disabled?: boolean;
}) {
  const cols = useTaskCols();
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
    <div style={{ position: "relative", width: cols.w("status"), flexShrink: 0 }}>
      <button ref={btnRef} type="button" disabled={disabled}
        data-tip={disabled ? undefined : "ステータス（完了にすると進捗率も100%になります）"}
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
 * BRU11-041 進捗率のセル。
 *
 * 選ばせるのではなく、キーボードで数字を打ち込む欄（0〜100の％）。
 * 数字以外は打った端から落とし、100を超える値はその場で100に丸めるので、
 * 範囲外の値が表に出ることはない。
 * 確定のしかたは他の文字セルと同じ（Enter か欄から離れたときに保存、Esc で取り消し）。
 *
 * 欄に入っている間は、タイトル・詳細（ExpandingInput）と同じ「白地＋緑の枠」を出す。
 * 数字だけの狭い欄なので広い入力欄は重ねず、その場に枠を出すだけにする。
 * 枠は outline と box-shadow で描く（border や padding だと列幅と行の高さが動くため）。
 *
 * ステータスとの連動は「完了にしたら 100% に上書き」の一方向だけ（BRU15-005、
 * taskService.withDoneProgress）。未着手/進行中の3段階では表せない
 * 「どこまで進んだか」を自分で書き込むための欄なので、それ以外は勝手に書き換えない。
 */
export function ProgressCell({ value, onCommit, onEnter, disabled, textStyle }: {
  value: number;
  onCommit: (v: number) => void;
  /**
   * Enter で確定したときに、丸めたあとの値を渡す（追加行がそのまま登録に進むため）。
   * 渡さなければ Enter は「確定して欄から離れる」だけ。
   */
  onEnter?: (v: number) => void;
  disabled?: boolean;
  /** 完了行など、文字色の上書き */
  textStyle?: React.CSSProperties;
}) {
  const cols = useTaskCols();
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  /** 欄に入っているか。枠を出すためだけの状態 */
  const [focused, setFocused] = useState(false);
  /** Esc で捨てた直後の確定を止める（打ちかけを保存してしまわないように＝TextCell と同じ） */
  const canceled = useRef(false);

  // 打っていない間は外からの変更に追従する（TextCell と同じ）
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    setFocused(false);
    // Esc は blur を呼んでここへ来るが、その時点の draft はまだ打ちかけのまま。
    // 元の値へ戻すだけにして保存しない
    if (canceled.current) { canceled.current = false; setDraft(String(value)); return; }
    // 空欄のまま離れたら 0%（未入力）に戻す
    const next = draft === "" ? 0 : clampTaskProgress(draft);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };

  // 0% は日付の未設定と同じく薄く出す（打ってある値と見分けが付くように）。
  // ただし打っている間は薄いままだと読みにくいので、通常の文字色に戻す
  const tone: React.CSSProperties = value === 0 && !focused ? { color: "#C9C4BB" } : {};
  const text: React.CSSProperties = { ...CELL, ...tone, ...textStyle, fontFamily: "var(--font-mono)", fontWeight: 700 };

  // タイトル・詳細の重ねる入力欄と同じ見た目（白地・緑の枠・角丸・影）。
  // 幅と高さを変えないよう、内側の余白は box-shadow の白で、枠は outline で作る
  const frame: React.CSSProperties = focused
    ? {
      background: "#FFF",
      borderRadius: 8,
      boxShadow: "0 0 0 4px #FFF, 0 3px 10px rgba(5,150,105,0.18)",
      outline: "1px solid #059669",
      outlineOffset: 4,
    }
    : {};

  return (
    <span data-tip={disabled ? undefined : "進捗率（0〜100の数字を入力）"}
      style={{ width: cols.w("progress"), flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 1, paddingRight: PROGRESS_PAD, boxSizing: "border-box", ...frame }}>
      {disabled
        ? <span style={{ ...text, cursor: "default" }}>{value}</span>
        : (
          <input className="task-cell" value={draft}
            inputMode="numeric"
            onChange={e => {
              setEditing(true);
              // 数字以外（符号・小数点・全角も含む）は受け付けない。3桁を超えたぶんも捨てる
              const digits = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
              setDraft(digits === "" ? "" : String(clampTaskProgress(digits)));
            }}
            onFocus={e => { setEditing(true); setFocused(true); e.currentTarget.select(); }}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                // blur が commit を走らせる。追加行はそのまま登録まで進む
                (e.currentTarget as HTMLInputElement).blur();
                onEnter?.(draft === "" ? 0 : clampTaskProgress(draft));
              }
              if (e.key === "Escape") {
                canceled.current = true;
                setDraft(String(value)); setEditing(false); setFocused(false);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            style={{ ...text, width: "100%", minWidth: 0, textAlign: "right" as const, cursor: "text" }} />
        )}
      <span style={{ ...text, flexShrink: 0, cursor: "default" }}>%</span>
    </span>
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
  const cols = useTaskCols();
  const text = useMemo(() => descriptionToText(task.description), [task.description]);

  return (
    <TextCell
      value={text}
      disabled={!editable}
      placeholder="詳細"
      wrap={cols.wrap}
      onCommit={v => onCommit(textToDescription(v))}
      style={{ ...cols.cell("desc"), ...BODY_TEXT, ...textStyle }} />
  );
}

/**
 * 表全体の縦罫線。見出し用と本体用にそれぞれ1枚ずつ敷く。
 * 位置はどちらも taskColRuleOffsets（列幅から計算）なので、見出しと本体で必ず揃う。
 * タイトル列の右端だけは、左に固定した列の影が引く（同じ位置に2本引かない）。
 */
function ColumnRules({ showProject }: { showProject: boolean }) {
  const { wide, widths } = useTaskCols();
  if (!wide) return null;
  return (
    <div aria-hidden="true"
      style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, pointerEvents: "none", zIndex: 0 }}>
      {taskColRuleOffsets(widths, showProject).map(x => (
        <span key={x} style={{ position: "absolute", top: 0, bottom: 0, left: x, width: 1, background: TASK_RULE_COLOR }} />
      ))}
    </div>
  );
}

/**
 * 列幅を変えるつまみ（広げるモードの見出しにだけ出す）。
 * 線そのものは ColumnRules が引くので、ここは掴む場所と、触ったときの緑の線だけ。
 *
 * z-index は固定したタイトル列（2）より下にする。上にすると、横スクロールで
 * 流れてきた他の列のつまみが、固定しているタイトル見出しの上に描かれてしまう。
 */
function ColResizer({ colKey, onResize, onAutoFit }: {
  colKey: TaskColKey;
  onResize: (k: TaskColKey, width: number) => void;
  onAutoFit: (k: TaskColKey) => void;
}) {
  const { widths } = useTaskCols();

  const onPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widths[colKey];
    // ドラッグ中はつまみから外れても同じカーソルのまま、文字の選択も起こさない
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const move = (ev: PointerEvent) =>
      onResize(colKey, Math.max(MIN_COL_WIDTHS[colKey], Math.round(w0 + ev.clientX - x0)));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <span className="task-col-resizer" role="separator" aria-orientation="vertical"
      data-tip={"ドラッグで列幅を変更\nダブルクリックで中身に合わせる"}
      onPointerDown={onPointerDown}
      onDoubleClick={e => { e.stopPropagation(); onAutoFit(colKey); }}
      style={{
        // 中の線（幅1px）がちょうど列の右端＝罫線と重なる位置に置く
        position: "absolute", top: -TASK_COLS.padY, bottom: -TASK_COLS.padY, right: -5, width: 11,
        cursor: "col-resize", zIndex: 1, display: "flex", justifyContent: "center", touchAction: "none",
      }}>
      <span style={{ width: 1, height: "100%" }} />
    </span>
  );
}

/** 列見出し。Context の列幅を読むので、TaskColLayoutProvider の内側に置くこと */
function ListHeader({ showProject, onResize, onAutoFit }: {
  showProject: boolean;
  onResize: (k: TaskColKey, width: number) => void;
  onAutoFit: (k: TaskColKey) => void;
}) {
  const cols = useTaskCols();

  const head = (k: TaskColKey, align?: "right" | "center") => (
    <span style={{
      ...HEAD_TEXT, ...cols.cell(k), position: "relative", boxSizing: "border-box",
      // 値（ProgressCell）と同じだけ内側へ入れて、見出しと数字の右端を揃える
      paddingRight: k === "progress" ? PROGRESS_PAD : undefined,
    }}>
      <span style={{ display: "block", textAlign: align, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {TASK_COL_LABELS[k]}
      </span>
      {cols.wide && <ColResizer colKey={k} onResize={onResize} onAutoFit={onAutoFit} />}
    </span>
  );

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: TASK_COLS.gap,
      padding: `${TASK_COLS.padY}px ${TASK_COLS.padX}px`, background: HEAD_BG,
      borderBottom: "1px solid rgba(26,23,20,0.07)",
      position: "relative",
    }}>
      <span style={cols.lead(HEAD_BG)}>
        <span style={{ width: TASK_COLS.toggle, flexShrink: 0 }} />
        <span style={{ width: TASK_COLS.expand, flexShrink: 0 }} />
        {head("title")}
      </span>
      {head("desc")}
      {head("category")}
      {showProject && head("project")}
      {head("priority")}
      {head("assignee")}
      {head("creator")}
      {head("start")}
      {head("due")}
      {head("progress", "right")}
      {head("status", "center")}
      <span style={{ width: TASK_COLS.share, flexShrink: 0 }} />
      <span style={{ width: TASK_COLS.menu, flexShrink: 0 }} />
    </div>
  );
}

/** 担当者セルの中身。行ごとに TaskListView が決める */
interface AssigneeCell {
  /** 表に出す文字。サブタスクを持つ親は「A/B/C」 */
  display: string;
  /** 選ばせない（親は子から決まる・個人タスクは作成者で固定） */
  locked: boolean;
  /** 選ばせない理由。マウスを乗せたときに出す */
  lockReason?: string;
  /** 選べるときの候補（そのPJに参画しているメンバー） */
  options: PickerOption[];
}

function TaskRow({
  task, depth, expanded, childCount, doneCount, editable, deletable, highlighted,
  showProject, projectOptions, assignee, rollup, categoryOptions,
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
  assignee: AssigneeCell;
  /** サブタスクから集計した値（子を持つ親だけ） */
  rollup: TaskRollup | undefined;
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
  const cols = useTaskCols();
  const done = task.status === "done";

  // サブタスクを持つ親は、期間を子から決める（一番早い開始日〜一番遅い期限）。
  // 子から決まっている側の欄は読むだけにする（直すのはサブタスク側）
  const startLocked = !!rollup?.startDate;
  const dueLocked = !!rollup?.dueDate;
  const startDate = rollup?.startDate || task.startDate;
  const dueDate = rollup?.dueDate || task.dueDate;
  const overdue = isOverdue({ ...task, dueDate });

  // 完了行は「背景をはっきりグレーにする」だけで示す。
  // 透かしたり取り消し線を引いたりすると読みづらくなるので、文字は落ち着いた色に
  // 変えるにとどめ、値はそのまま読めて触れる状態を保つ。
  // ステータスの「完了」バッジとチェックは合図そのものなので色を落とさない。
  const doneTitle: React.CSSProperties | undefined = done ? { color: "#6B6458" } : undefined;
  const doneText: React.CSSProperties | undefined = done ? { color: "#8A837B" } : undefined;
  const doneSub: React.CSSProperties | undefined = done ? { color: "#9E9690" } : undefined;
  const baseBg = highlighted ? "#F0FDF4" : done ? "#E8E6E1" : depth > 0 ? "#FCFCFB" : "transparent";
  // 広げるモードで左に固定するタイトル列は、下を流れる列が透けないよう不透明に塗る
  const leadBg = baseBg === "transparent" ? "#FFFFFF" : baseBg;

  return (
    <div className="task-row" data-task-id={task.id}
      style={{
        display: "flex", alignItems: cols.wrap ? "flex-start" : "center", gap: TASK_COLS.gap,
        padding: `${TASK_COLS.padY}px ${TASK_COLS.padX}px`,
        borderTop: "1px solid rgba(26,23,20,0.05)",
        background: baseBg,
        transition: "background 0.12s",
      }}>

      {/* 行頭（完了トグル＋開閉＋タイトル）。広げるモードではここを左に固定する */}
      <span style={cols.lead(leadBg)}>
        {/* 完了トグル */}
        <button type="button" disabled={!editable}
          onClick={() => onPatch(task, { status: done ? "todo" : "done" })}
          data-tip={editable ? (done ? "完了を取り消す" : "完了にする（進捗率も100%になります）") : undefined}
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
              data-tip={expanded ? "サブタスクを閉じる" : childCount > 0 ? "サブタスクを開く" : "サブタスクを追加"}
              style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", color: childCount > 0 ? "#9E9690" : "#D5D0CB" }}>
              {expanded
                ? <ChevronDown style={{ width: 13, height: 13 }} />
                : <ChevronRight style={{ width: 13, height: 13 }} />}
            </button>
          )}
        </span>

        {/* タイトル */}
        <span style={{ ...cols.cell("title"), display: "flex", alignItems: cols.wrap ? "flex-start" : "center", gap: 6, paddingLeft: depth * INDENT, boxSizing: "border-box" }}>
          {/* 親が絞り込みで消えている子は最上位に出るので、depth ではなく parentId で判定する */}
          {task.parentId && <CornerDownRight style={{ width: 11, height: 11, color: "#C9C4BB", flexShrink: 0, marginTop: cols.wrap ? 3 : 0 }} />}
          <TextCell
            value={task.title} disabled={!editable} allowEmpty={false} placeholder="タイトル"
            wrap={cols.wrap}
            onCommit={v => onPatch(task, { title: v })}
            style={{ ...BODY_TEXT, ...doneTitle, flex: 1, minWidth: 0, fontSize: depth > 0 ? 12.5 : 13 }} />
          {childCount > 0 && (
            <span data-tip={`サブタスク ${doneCount}/${childCount} 件が完了`}
              style={{ fontSize: 9.5, fontWeight: 700, color: doneCount === childCount ? "#059669" : "#9E9690", background: doneCount === childCount ? "#ECFDF5" : "#F4F5F6", borderRadius: 99, padding: "1px 6px", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
              {doneCount}/{childCount}
            </span>
          )}
          {task.ticketWbs && (
            <span data-tip={`紐付いているチケット ${task.ticketWbs}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-mono)", flexShrink: 0 }}>
              <Hash style={{ width: 9, height: 9 }} />{task.ticketWbs}
            </span>
          )}
        </span>
      </span>

      {/* 詳細メモ */}
      <DescriptionCell task={task} editable={editable} textStyle={doneText}
        onCommit={description => onPatch(task, { description })} />

      {/* 分類（複数） */}
      <span data-tip="分類"
        style={{ width: cols.w("category"), flexShrink: 0, display: "inline-flex", alignItems: cols.wrap ? "flex-start" : "center", boxSizing: "border-box" }}>
        <TaskCategoryField
          values={task.categories} options={categoryOptions} disabled={!editable} wrap={cols.wrap}
          placeholder="分類"
          onChange={next => onPatch(task, { categories: next })} />
      </span>

      {/* プロジェクト。付け替えるとチケット候補が変わるので、紐付けは外す
          （担当者を新しいPJで選べる人に合わせるのは TaskWorkspace.patchTask） */}
      {showProject && (
        <PickerCell width={cols.w("project")} value={task.projectId ?? ""} disabled={!editable} title="プロジェクト"
          options={projectOptions} placeholder={task.projectId ? "プロジェクト" : "個人タスク"}
          textStyle={doneSub}
          onChange={v => onPatch(task, { projectId: v || null, ticketId: null, ticketWbs: "" })} />
      )}

      <PickerCell width={cols.w("priority")} value={task.priority} disabled={!editable} title="優先度"
        options={PRIORITY_OPTIONS} textStyle={doneSub}
        onChange={v => onPatch(task, { priority: v as Priority })} />

      {/* 担当者。親は子の担当者全員（A/B/C）、個人タスクは作成者で固定なので選ばせない */}
      {assignee.locked ? (
        <span data-tip={assignee.lockReason ? `${assignee.display || "未割当"}\n${assignee.lockReason}` : assignee.display}
          style={{
            ...CELL, ...doneSub, ...cols.clamp, width: cols.w("assignee"), cursor: "default",
            color: assignee.display ? (doneSub?.color ?? CELL.color) : "#B0A9A4",
          }}>
          {assignee.display || "未割当"}
        </span>
      ) : (
        <PickerCell width={cols.w("assignee")} value={task.assignee} disabled={!editable} title="担当者"
          options={assignee.options} placeholder={task.assignee || "未割当"} textStyle={doneSub}
          onChange={v => onPatch(task, { assignee: v })} />
      )}

      {/* 起票者。作った人は後から変えられないので、選べない素の文字で出す */}
      <span data-tip={task.createdBy ? `起票者: ${task.createdBy}` : "起票者不明"}
        style={{
          ...CELL, ...doneSub, ...cols.clamp, width: cols.w("creator"), cursor: "default",
          color: task.createdBy ? (doneSub?.color ?? CELL.color) : "#B0A9A4",
        }}>
        {task.createdBy || "—"}
      </span>

      <span style={{ width: cols.w("start"), flexShrink: 0 }}
        data-tip={startLocked ? "開始日\nサブタスクの一番早い開始日です（変更はサブタスク側で）" : undefined}>
        <DatePicker variant="cell" value={startDate} disabled={!editable || startLocked}
          cellStyle={doneSub}
          onChange={v => onPatch(task, { startDate: v })} />
      </span>

      <span style={{ width: cols.w("due"), flexShrink: 0 }}
        data-tip={dueLocked ? "期限\nサブタスクの一番遅い期限です（変更はサブタスク側で）" : undefined}>
        <DatePicker variant="cell" value={dueDate} disabled={!editable || dueLocked}
          min={startDate || undefined}
          onChange={v => onPatch(task, { dueDate: v })}
          cellStyle={overdue ? { color: "#DC2626", fontWeight: 700 } : doneSub} />
      </span>

      <ProgressCell value={task.progress} disabled={!editable} textStyle={doneSub}
        onCommit={v => onPatch(task, { progress: v })} />

      <StatusPill status={task.status} disabled={!editable}
        onChange={s => onPatch(task, { status: s })} />

      {/* 共有。誰かに共有していれば人数を出しっぱなしにし（見せている相手がいることを
          一覧のまま気付けるように）、0人のときは行にマウスを乗せたときだけ出す。 */}
      <span style={{ width: TASK_COLS.share, flexShrink: 0, display: "flex", justifyContent: "center" }}>
        {shareable && (
          <button type="button" className={shareCount > 0 ? undefined : "task-row-share"}
            onClick={() => onShare(task)}
            data-tip={shareCount > 0 ? `${shareCount}人に共有中（共有先を変更）` : "このタスクを共有する"}
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
          <button type="button" className="task-row-del" onClick={() => onDelete(task)} data-tip="このタスクを削除"
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
  projects, selectableProjects, categoryOptions, rollups, assigneesOf, assigneeCandidatesOf,
  wide, wrap, colWidths, onColWidthsChange,
  onPatch, onDelete, onShare, renderSubtaskAdd, quickAdd, stickyTop = 0,
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
  /** 見えているプロジェクト全部（名前を出すため） */
  projects: ProjectOption[];
  /** プルダウンに出すプロジェクト（自分が参画しているもの。オーナーは全件） */
  selectableProjects: ProjectOption[];
  /** 分類の候補（既に使われている値） */
  categoryOptions: string[];
  /** サブタスクから親へ集計した担当者・期間 */
  rollups: TaskRollups;
  /** 画面に出す担当者（親は子の担当者全員） */
  assigneesOf: (t: Task) => string[];
  /** 担当者の候補。null = 選ばせない（個人タスク） */
  assigneeCandidatesOf: (projectId: string | null) => MemberOption[] | null;
  /** 列幅を広げるモード */
  wide: boolean;
  /** 折り返し表示モード（列幅に収まらない中身を折り返して行を高くする） */
  wrap: boolean;
  /** 広げるモードの列幅 */
  colWidths: TaskColWidths;
  onColWidthsChange: React.Dispatch<React.SetStateAction<TaskColWidths>>;
  onPatch: (t: Task, patch: Partial<Task>) => void;
  onDelete: (t: Task) => void;
  /** 共有ダイアログを開く */
  onShare: (t: Task) => void;
  /** 親を開いたときに下へ生やす「サブタスクを追加」行（TaskQuickAddRow） */
  renderSubtaskAdd: (parent: Task) => React.ReactNode;
  /** 見出しの下に生やす追加行（TaskQuickAddRow）。渡さなければ出ない */
  quickAdd?: React.ReactNode;
  /**
   * 列見出し＋追加行を固定する位置（スクロール領域の上端からの px）。
   * 上に固定されている見出し・フィルタ（TaskWorkspace）の高さを渡すと、その真下に続く。
   */
  stickyTop?: number;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const boxRef = useRef<HTMLDivElement>(null);
  const hs = useSyncedHScroll();
  const layout = useMemo(() => ({ wide, wrap, widths: colWidths }), [wide, wrap, colWidths]);

  const projectNameOf = useMemo(() => {
    const m = new Map(projects.map(p => [p.id, p.name]));
    return (id: string | null) => (id ? m.get(id) ?? "プロジェクト" : "");
  }, [projects]);

  // 選択肢は行ごとに作り直さない
  const projectOptions = useMemo<PickerOption[]>(
    () => [{ value: "", label: "個人タスク" }, ...selectableProjects.map(p => ({ value: p.id, label: p.name }))],
    [selectableProjects]);
  const selectableIds = useMemo(() => new Set(selectableProjects.map(p => p.id)), [selectableProjects]);

  /**
   * その行のプロジェクトの選択肢。
   * 参画していないPJのタスク（admin が見えているだけのもの）は候補に無いので、
   * 今の値だけ足して名前が出るようにする（選び直しはできる）。
   */
  const projectOptionsFor = (t: Task): PickerOption[] =>
    (!t.projectId || selectableIds.has(t.projectId)
      ? projectOptions
      : [...projectOptions, { value: t.projectId, label: projectNameOf(t.projectId) }]);

  /** PJごとの担当者の選択肢。同じPJの行で使い回す */
  const assigneeOptionsFor = useMemo(() => {
    const cache = new Map<string, PickerOption[]>();
    return (pid: string): PickerOption[] => {
      let o = cache.get(pid);
      if (!o) {
        o = [
          { value: "", label: "未割当" },
          ...(assigneeCandidatesOf(pid) ?? []).map(m => ({ value: m.name, label: m.name })),
        ];
        cache.set(pid, o);
      }
      return o;
    };
  }, [assigneeCandidatesOf]);

  const assigneeCellOf = (t: Task): AssigneeCell => {
    const r = rollups.get(t.id);
    if (r && r.assignees.length > 0) {
      return {
        display: r.assignees.join(ASSIGNEE_SEP), locked: true, options: NO_OPTIONS,
        lockReason: "サブタスクの担当者をまとめて表示しています（変更はサブタスク側で）",
      };
    }
    if (!t.projectId) {
      return {
        display: assigneesOf(t).join(ASSIGNEE_SEP), locked: true, options: NO_OPTIONS,
        lockReason: "個人タスクの担当者は作成者で固定です",
      };
    }
    return { display: t.assignee, locked: false, options: assigneeOptionsFor(t.projectId) };
  };

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
    el?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
  }, [highlightId, tasks]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── 列幅（広げるモード） ─────────────────────────────────────
  /**
   * 表示中のタスクの中身を実寸で測って、各列の幅を出す。
   * floorAtDefault = オンにした直後の「広げる」。初期幅より狭くはしない。
   * false はダブルクリックの「中身に合わせる」。見出しが読める幅までは縮める。
   *
   * 値は必ず整数にする。小数のままだと列の境目が半端な位置に来て、縦罫線が
   * ぼやけて二重線のように見える。
   */
  const measureWidths = (keys: TaskColKey[], floorAtDefault: boolean): Partial<TaskColWidths> => {
    const f = measureFonts();
    const ids = new Set(tasks.map(t => t.id));
    const content: TaskColWidths = {
      title: 0, desc: 0, category: 0, project: 0, priority: 0, assignee: 0,
      creator: 0, start: 0, due: 0, progress: 0, status: 0,
    };
    const bump = (k: TaskColKey, v: number) => { if (v > content[k]) content[k] = v; };

    // 追加行の案内文も切れないように
    bump("title", textWidth("タスクを入力して Enter で追加", f.body(13, 500)));
    bump("title", INDENT + textWidth("サブタスクを入力して Enter で追加", f.body(13, 500)));

    for (const t of tasks) {
      const nested = !!t.parentId && ids.has(t.parentId);
      let tw = textWidth(t.title, f.body(nested ? 12.5 : 13, 500));
      if (nested) tw += INDENT;
      if (t.parentId) tw += 17;                                    // ↳ の印＋間隔
      const c = counts.get(t.id);
      if (c && c.total > 0) tw += textWidth(`${c.done}/${c.total}`, f.mono(9.5)) + 18;
      if (t.ticketWbs) tw += textWidth(t.ticketWbs, f.mono(10)) + 29;
      bump("title", tw);

      bump("desc", textWidth(descriptionToText(t.description), f.body(13, 500)));
      // 分類はチップの並び＋打ち込み欄（最低 56px）
      bump("category", t.categories.reduce((s, c) => s + textWidth(c, f.body(10, 600)) + 27, 0) + 56);
      if (showProject) bump("project", textWidth(t.projectId ? projectNameOf(t.projectId) : "個人タスク", f.body(11)) + 14);
      bump("assignee", textWidth(assigneeCellOf(t).display || "未割当", f.body(11)) + 14);
      bump("creator", textWidth(t.createdBy || "—", f.body(11)) + 4);
    }

    const out: Partial<TaskColWidths> = {};
    for (const k of keys) {
      const label = TASK_COL_LABELS[k];
      // 見出しは字間 0.08em ぶん広い。つまみの分も空ける
      const head = textWidth(label, f.body(9.5, 700)) + label.length * 9.5 * 0.08 + 10;
      const floor = Math.max(MIN_COL_WIDTHS[k], head, floorAtDefault ? DEFAULT_COL_WIDTHS[k] : 0);
      const need = FIXED_CONTENT_KEYS.has(k) ? DEFAULT_COL_WIDTHS[k] : content[k] + 6;
      out[k] = Math.round(Math.min(MAX_AUTO_COL_WIDTH, Math.max(floor, need)));
    }
    return out;
  };

  // 広げるモードに切り替わった瞬間だけ、中身の最長に合わせて広げる。
  // 開き直した画面（モードがオンのまま保存されている）では、前回の幅をそのまま使う
  const prevWide = useRef(wide);
  useEffect(() => {
    if (wide && !prevWide.current) {
      const fitted = measureWidths(ALL_COL_KEYS, true);
      onColWidthsChange(prev => ({ ...prev, ...fitted }));
    }
    prevWide.current = wide;
  }, [wide]); // eslint-disable-line react-hooks/exhaustive-deps

  const resizeColumn = (k: TaskColKey, width: number) =>
    onColWidthsChange(prev => (prev[k] === width ? prev : { ...prev, [k]: width }));

  const autoFitColumn = (k: TaskColKey) => {
    const fitted = measureWidths([k], false);
    onColWidthsChange(prev => ({ ...prev, ...fitted }));
  };

  // 広げるモードでは、見出し・本体をそれぞれ横スクロールの枠に入れて横位置を揃える（useSyncedHScroll）
  const scrollBox: React.CSSProperties | undefined = wide ? { overflowX: "auto", overflowY: "hidden" } : undefined;
  const scrollClass = wide ? "task-hscroll-hide" : undefined;
  const inner: React.CSSProperties | undefined = wide ? WIDE_INNER : undefined;

  return (
    <TaskColLayoutProvider value={layout}>
      <div ref={boxRef} style={{
        background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12,
        // BRU14-013 中の見出し・追加行を画面に固定するため hidden ではなく clip で切る。
        // overflow:hidden はスクロール領域そのものになるので、内側の position:sticky が
        // 「動かない箱」に対して吸着してしまい効かなくなる（clip は領域を作らずに切るだけ）。
        overflow: "clip",
      }}>
        {/* ── 列見出し＋追加行（BRU14-013 で画面上部に固定） ──
            下スクロールすると見出しと追加行が上へ消え、どの列を見ているのか分からず
            追加もページ先頭へ戻らないとできなかった。上の見出し・フィルタ（TaskWorkspace）の
            高さぶんだけ下げた位置に、続けて貼り付ける。
            z-index は上のブロック（100）より小さくして、その下へ潜り込ませる。 */}
        <div style={{ position: "sticky", top: stickyTop, zIndex: 20 }}>
          <div ref={wide ? hs.head : undefined} className={scrollClass} style={scrollBox}
            onScroll={wide ? hs.onScroll : undefined}>
            <div style={inner}>
              <ListHeader showProject={showProject} onResize={resizeColumn} onAutoFit={autoFitColumn} />

              {/* 追加行は見出しのすぐ下（BRU13-044）。
                  件数が増えるほど最終行は遠くなり、足すたびに一番下まで送られてしまうため */}
              {quickAdd}

              {/* 罫線は最後に置く。先に置くと、見出し行・追加行の背景（不透明）に隠れてしまう */}
              <ColumnRules showProject={showProject} />
            </div>
          </div>
        </div>

        <div ref={wide ? hs.bodyRef : undefined} className={scrollClass} style={scrollBox}
          onScroll={wide ? hs.onScroll : undefined}>
          <div ref={wide ? hs.contentRef : undefined} style={inner}>
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
                    projectOptions={projectOptionsFor(t)} assignee={assigneeCellOf(t)}
                    rollup={rollups.get(t.id)}
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
                          projectOptions={projectOptionsFor(k)} assignee={assigneeCellOf(k)}
                          rollup={undefined}
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

            {/* 罫線は行の上に引く（完了行など背景が不透明な行でも途切れないように） */}
            <ColumnRules showProject={showProject} />
          </div>
        </div>

        {/* 本体のスクロールバーは表の一番下に付いて見えないので、画面の下端に貼り付くバーを出す */}
        {wide && <StickyHScrollBar hs={hs} />}
      </div>
    </TaskColLayoutProvider>
  );
}
