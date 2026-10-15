// ENHA2-053 WBSの表。
//
// 作り:
//   ・左の枠（固定した列）と右の枠（固定していない列＋ガント）の2つに分ける。
//     左の枠は横スクロールさせず、列を枠の幅に合わせて縮める。右の枠だけが横にスクロールする。
//   ・2つの枠の境目（固定の線）はドラッグで動かせる。離した位置にいちばん近い列の境目へ寄せる。
//   ・縦のスクロールは2つの枠で同期させ、行がずれないようにする。見出しはそれぞれの枠の上端に固定。
//   ・行は table ではなく、高さを固定した div を並べる（2つの枠で行の高さを必ず揃えるため）。
//   ・進捗率の自動計算・予定日数・遅延の判定は保存せず、wbsCalc で計算した値を表示するだけ。
//   ・名前の列は「項目」の1列。一番右の段より上の行（3段なら大項目・中項目）は、行全体に色を敷いた
//     見出し行にして、その下に1つ下の段の行を字下げして並べる。見出し行は三角で開閉できる。
//   ・行を選ぶ手段は、左端のチェックボックスだけ（行をクリックしても選ばれない）。
//     見出しのチェックボックスは全部の行を選ぶ／外す。選んだ行は、表の上のボタンでまとめて操作する。
//   ・行の追加は、行と行の間（行の境目）にマウスを乗せて行う。境目に緑の線と
//     「＋ 中項目を追加」などのボタンが出て、押すとその境目の位置に行が入る。
//     境目ごとに出す段:
//       ・すぐ上の行の、1つ下の段（上の行の最初の子として入る）
//       ・すぐ上の行と同じ段（上の行の次に入る。上の行に下の行があれば、そのまとまりの後ろ）
//     それより上の段は出さない（上の段を足したいときは、その段の行の下の境目から足す）。
//     行が1つも無いとき用に、いちばん下の空の行にも大項目を入力できる。
//     入力した場所と、結果が出る場所を必ず同じにすること（別の行に結果が出る作りは分かりにくい）。
//   ・セルのプルダウンはブラウザ標準の <select> を使わず、行の高さに合わせた WbsCellSelect を使う。
//   ・列の見出しを押すと、その列の値で絞り込める（BRU20-008-2。判定は wbsFilter）。
//     絞り込み中は、行の境目の追加ボタンとドラッグでの並べ替えを止める（隠れた行との位置関係が見えないため）。
//   ・列の見出しをドラッグすると、列の順番を入れ替えられる（BRU20-011。チェックボックスの列は動かさない）。
//     並びは WbsWorkspace がWBSごと・利用者ごとにブラウザへ保存する。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, GripVertical, Minus, Plus } from "lucide-react";
import { ColumnFilter, type ColumnFilterOption } from "@/app/components/shared/ColumnFilter";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { WbsCellSelect } from "./WbsCellSelect";
import { submitOnEnter } from "@/app/lib/submitKey";
import { businessDays, textColorOn, type WbsGanttModel, type WbsRow } from "@/app/lib/wbsCalc";
import type { WbsItem, WbsStatus } from "@/app/types";
import { WBS_COLORS } from "./wbsStyles";
import { WBS_GANTT_HEAD_H, WbsGanttHeader, WbsGanttOverlay, WbsGanttStrip, ganttWidth } from "./WbsGantt";
import { WBS_FILTER_COLS, type WbsFilterCol, type WbsFilters } from "./wbsFilter";

export const WBS_ROW_H = 30;
/** マスタースケジュールから移動した大項目のまとまりを光らせる時間。WbsWorkspace はこのあとに focusGroupId を外す */
export const FOCUS_PULSE_MS = 3000;
/** 光らせるときの色（黄色系）。枠線と外側のにじみ（中は塗らない） */
const FOCUS_EDGE = "#F59E0B";
const FOCUS_GLOW = "rgba(245,158,11,0.22)";

export type WbsColKey = "check" | "no" | "name" | "assignee" | "start" | "end" | "days" | "progress" | "status" | "tickets" | "note";

/**
 * 列の定義。width は左の枠では比率、右の枠では px として使う。
 * min は左の枠で縮めてよい下限（px）。左の枠は列を枠の幅に合わせて縮めるので、
 * 中身が切れては困る列にだけ付ける。
 */
export const WBS_COLUMNS: { key: WbsColKey; label: string; width: number; min?: number; align?: "center" }[] = [
  // 行を選ぶチェックボックス。編集できる人にだけ出す
  { key: "check", label: "", width: 34, min: 34, align: "center" },
  { key: "no", label: "No.", width: 52, align: "center" },
  // 大項目・中項目・小項目をまとめた1列。段は字下げと見出し行で表す
  { key: "name", label: "項目", width: 400, min: 220 },
  { key: "assignee", label: "担当者", width: 88 },
  // 日付は「2026/10/21」（西暦4桁・月2桁・日2桁）とカレンダーの絵が切れずに入る幅。これより縮めない
  { key: "start", label: "開始予定日", width: 108, min: 108, align: "center" },
  { key: "end", label: "終了予定日", width: 108, min: 108, align: "center" },
  // 見出しに絞り込みの ▼ が付くぶん、見出しが切れない幅にする
  { key: "days", label: "予定日数", width: 72, align: "center" },
  { key: "progress", label: "進捗率", width: 68, align: "center" },
  // 幅と下限は、ステータス名の長さから WbsTable で決め直す（statusColWidth）
  { key: "status", label: "ステータス", width: 84, align: "center" },
  // チップ1つ＋「+n」＋「＋」が切れずに並ぶ幅（120 だと2件目で見切れていた）
  { key: "tickets", label: "チケット", width: 150 },
  { key: "note", label: "備考", width: 140 },
];

/** ステータス列の幅の下限（見出しの「ステータス」が切れない幅）と上限（広がりすぎないように） */
const STATUS_COL_MIN = 84;
const STATUS_COL_MAX = 200;
/** チップの左右の余白 8＋▼印 13＋セルの左右の余白 12 */
const STATUS_COL_PAD = 8 + 13 + 12;

let measureCtx: CanvasRenderingContext2D | null = null;

/**
 * ステータス列の幅。ステータス名のうち最も長いものを、チップと同じ字体（11px・太字）で測って決める。
 * 固定の範囲（左の枠）では列が縮むので、同じ値を下限にもして名前が切れないようにする。
 */
function statusColWidth(names: string[]): number {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  const ctx = measureCtx;
  if (!ctx) return STATUS_COL_MIN;
  ctx.font = `700 11px ${window.getComputedStyle(document.body).fontFamily}`;
  const text = Math.max(0, ...names.map(n => ctx.measureText(n).width));
  return Math.min(STATUS_COL_MAX, Math.max(STATUS_COL_MIN, Math.ceil(text + STATUS_COL_PAD)));
}

/** 画面に出す列（段数によらず同じ。段は「項目」の列の中の字下げで表す） */
export function visibleWbsColumns() {
  return WBS_COLUMNS;
}

/**
 * 利用者が並べた順の列（BRU20-011）。チェックボックスの列は常に先頭。
 * 保存された並びに無い列（後から足した列）は末尾に足し、いまは無い列は無視する。
 */
export function orderWbsColumns(order: readonly string[]) {
  const byKey = new Map(WBS_COLUMNS.map(c => [c.key as string, c]));
  const picked = [...new Set(order)].filter(k => k !== "check" && byKey.has(k)).map(k => byKey.get(k)!);
  const rest = WBS_COLUMNS.filter(c => c.key !== "check" && !picked.includes(c));
  return [...WBS_COLUMNS.filter(c => c.key === "check"), ...picked, ...rest];
}

/** 見出しを押してから、この距離（px）を動かしたらドラッグとして扱う。これ未満はクリック（フィルタを開く） */
const COL_DRAG_THRESHOLD = 5;

const EMPTY_SET = new Set<string>();

/** 1段ぶんの字下げ（px） */
const INDENT = 18;

export type WbsDropMode = "before" | "after" | "into";
/**
 * いま入力中のセル。
 *   name / note … 既にある行の名前・備考
 *   add         … 見出し行のまとまりの最後の空の行（id はその見出し行、level に足す行の段を入れる）
 *   new         … いちばん下の空の行（id は WBS_NEW_ROW_ID。新しい大項目を足す）
 */
export interface WbsEditing { id: string; field: "name" | "note" | "add" | "new"; level?: number }
export const WBS_NEW_ROW_ID = "__new__";

const LEVEL_LABELS = ["大項目", "中項目", "小項目"];

interface WbsTableProps {
  rows: WbsRow[];
  levels: number;
  statuses: WbsStatus[];
  /** 担当者に選べる人（プロジェクトのメンバーの名前） */
  members: string[];
  /** 登録した祝日（YYYY-MM-DD）。予定日数から除く */
  holidays: ReadonlySet<string>;
  canEdit: boolean;
  /** ここまでの列を左に固定する */
  freezeKey: WbsColKey;
  /** 固定の線をドラッグで動かしたとき。新しく「ここまで固定」にする列を渡す */
  onFreezeChange: (key: WbsColKey) => void;
  /** 列の並び（チェックボックスの列を除く）。空なら定義順 */
  colOrder: readonly WbsColKey[];
  /**
   * 見出しをドラッグして列を並べ替えたとき。新しい並びと、固定の線を同じ列数の位置に残すための
   * 「ここまで固定」にする列を渡す
   */
  onColOrderChange: (order: WbsColKey[], freezeKey: WbsColKey) => void;
  /** チェックを付けた行 */
  checkedIds: ReadonlySet<string>;
  onToggleCheck: (id: string) => void;
  /** 見出しのチェックボックス。全部の行（絞り込み中は見えている行）を選ぶ／外す */
  onToggleAll: () => void;
  /** 見出しのチェックボックスの状態 */
  allCheckState: "on" | "off" | "some";
  /** 列ごとの絞り込み */
  filters: WbsFilters;
  filterOptions: Record<WbsFilterCol, ColumnFilterOption[]>;
  onFilterChange: (col: WbsFilterCol, selected: Set<string>) => void;
  /** 絞り込みで表に出す行。絞り込んでいないときは null */
  shownIds: ReadonlySet<string> | null;
  editing: WbsEditing | null;
  onEditingChange: (e: WbsEditing | null) => void;
  /** 段数を減らせない理由になっている行（赤く塗る） */
  highlightIds: ReadonlySet<string>;
  /** この行まで表をスクロールする。同じ行へもう一度飛べるよう nonce を変えて渡す */
  scrollTo: { id: string; nonce: number } | null;
  /**
   * お知らせから移動した行（薄い黄色に塗る）。scrollTo と同じ行なら、その行が中央に来るよう
   * なめらかにスクロールする。highlightIds（赤）とは別の値で、両方当たる行は赤を優先する
   */
  flashId?: string | null;
  /**
   * マスタースケジュールから移動した大項目。その大項目から下の行のまとまり全体を黄色く光らせる
   * （2回ふくらんで消える。消す時間は呼び出し側が決め、null に戻す）。
   * scrollTo と同じ行なら、まとまりが見えるようなめらかにスクロールする
   */
  focusGroupId?: string | null;
  onUpdate: (id: string, patch: Partial<WbsItem>) => void;
  onMove: (dragId: string, targetId: string, mode: WbsDropMode) => void;
  /**
   * 行の境目のボタンを押したとき。afterId の行のすぐ下（null なら先頭）に、level の段の行を足す。
   * どの親の下の何番目に入れるかは、呼び出し側が afterId と level から決める
   */
  onInsert: (afterId: string | null, level: number) => void;
  /** 見出し行の開閉をブラウザへ保存するときの名前（WBSごと・利用者ごとに変える） */
  collapseKey: string;
  /** いちばん下の空の行に入力したとき。新しい大項目を足す */
  onAddNew: (name: string) => void;
  /** 右の枠の末尾に出すガント */
  gantt: WbsGanttModel;
  /** 「チケット」列の中身（紐づいたチケットのチップと「＋」） */
  renderTickets: (row: WbsRow) => ReactNode;
}

// ── セルの中の入力部品 ────────────────────────────────────────

/**
 * 名前・備考。押すとその場で入力欄になる。Enter か欄の外を押すと確定、Esc で取り消し。
 * keepOpenOnEnter: Enter で確定しても入力欄を閉じず、空にして次の入力を待つ
 *   （空の行で、Enter を押すたびに続けて行を足していけるようにする）。
 */
function InlineText({ value, editing, canEdit, placeholder, textStyle, title, keepOpenOnEnter, onStart, onCommit, onCancel }: {
  value: string; editing: boolean; canEdit: boolean; placeholder: string; textStyle?: CSSProperties;
  title?: string; keepOpenOnEnter?: boolean;
  /** viaEnter: keepOpenOnEnter のとき、Enter で確定した（入力欄は開いたまま）なら true */
  onStart: () => void; onCommit: (v: string, viaEnter?: boolean) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  // Enter で確定した直後に、入力欄が消えることで blur がもう一度来る。二重に確定しないための印
  const doneRef = useRef(false);
  useEffect(() => { if (editing) { setDraft(value); doneRef.current = false; } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  if (editing) {
    const commit = () => { if (doneRef.current) return; doneRef.current = true; onCommit(draft.trim()); };
    const cancel = () => { if (doneRef.current) return; doneRef.current = true; onCancel(); };
    return (
      <input autoFocus value={draft} onChange={e => setDraft(e.target.value)} maxLength={200}
        onBlur={commit}
        onKeyDown={submitOnEnter(() => {
          if (keepOpenOnEnter && draft.trim()) { onCommit(draft.trim(), true); setDraft(""); return; }
          commit();
        }, { onCancel: cancel })}
        onMouseDown={e => e.stopPropagation()}
        style={{ width: "100%", height: 22, padding: "0 4px", fontSize: 12, color: WBS_COLORS.text, background: "#FFFFFF", border: "1px solid #059669", borderRadius: 4, outline: "none", boxSizing: "border-box" }} />
    );
  }
  // 「…」で切る要素そのものを TruncatedText にする（内側でさらに切ると、外から見て収まっている扱いになり
  // 全文のツールチップが出なかった）。押すと入力欄になる動きは、外側の div で受ける
  return (
    <div onClick={canEdit ? onStart : undefined} title={title}
      style={{ width: "100%", minWidth: 0, cursor: canEdit ? "text" : "default" }}>
      {/* ツールチップは入っている文字だけ。空の行の案内（placeholder）は出さない */}
      <TruncatedText as="div" text={value}
        style={{ minHeight: 18, ...textStyle, ...(value ? null : { color: "#C9CED6", fontWeight: 400 }) }}>
        {value || (canEdit ? placeholder : "")}
      </TruncatedText>
    </div>
  );
}

/** 進捗率（0〜100の整数）。0〜100以外は入力させない */
function ProgressInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = draft === "" ? 0 : Number(draft);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, width: "100%" }}>
      <input value={draft} inputMode="numeric" aria-label="進捗率"
        onChange={e => {
          const v = e.target.value;
          // 数字だけ・100まで。それ以外の入力は受け付けない（前の値のまま）
          if (v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 100)) setDraft(v);
        }}
        onFocus={e => { e.target.select(); e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.background = "#FFFFFF"; }}
        onBlur={e => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; commit(); }}
        // Enter は欄から抜けるだけ。確定は blur 側の1か所で行う（二重に保存しないため）
        onKeyDown={submitOnEnter(() => (document.activeElement as HTMLElement | null)?.blur())}
        style={{ width: 30, height: 22, textAlign: "right", fontSize: 12, color: WBS_COLORS.text, background: "transparent", border: "1px solid transparent", borderRadius: 4, outline: "none", padding: "0 2px", boxSizing: "border-box" }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.18)"; }}
        onMouseLeave={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.style.borderColor = "transparent"; }} />
      <span style={{ fontSize: 11, color: WBS_COLORS.subText }}>%</span>
    </div>
  );
}

const cellSelect: CSSProperties = {
  width: "100%", height: 22, fontSize: 12, color: WBS_COLORS.text, background: "transparent",
  border: "none", borderRadius: 4, outline: "none", padding: 0, cursor: "pointer", textOverflow: "ellipsis",
};

// ── 1行ぶんのセル ─────────────────────────────────────────────

interface RowCtx {
  levels: number;
  statuses: WbsStatus[];
  members: string[];
  holidays: ReadonlySet<string>;
  canEdit: boolean;
  /** No. の列をドラッグして並べ替えられるか（絞り込み中は止める） */
  canDrag: boolean;
  editing: WbsEditing | null;
  onEditingChange: (e: WbsEditing | null) => void;
  onUpdate: (id: string, patch: Partial<WbsItem>) => void;
  onDragStart: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
  renderTickets: (row: WbsRow) => ReactNode;
  /** 閉じている見出し行 */
  collapsed: ReadonlySet<string>;
  onToggle: (id: string) => void;
  checkedIds: ReadonlySet<string>;
  onToggleCheck: (id: string) => void;
}

/** 自前のチェックボックス（標準の input はOSごとに見た目が変わるため）。some = 一部だけ選ばれている */
function CheckBox({ state, label, onClick, onDark }: { state: "on" | "off" | "some"; label: string; onClick: () => void; onDark?: boolean }) {
  const filled = state !== "off";
  return (
    <button type="button" role="checkbox" aria-checked={state === "on" ? true : state === "some" ? "mixed" : false} aria-label={label}
      onClick={onClick}
      // 押しやすいよう、見た目の四角より広い範囲で受ける
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, padding: 0, background: "transparent", border: "none", cursor: "pointer", flexShrink: 0 }}>
      <span style={{ width: 15, height: 15, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box",
        background: filled ? "#059669" : "#FFFFFF", border: filled ? "none" : `1.5px solid ${onDark ? "rgba(255,255,255,0.75)" : "rgba(26,23,20,0.28)"}` }}>
        {state === "on" && <Check style={{ width: 11, height: 11, color: "#FFF" }} />}
        {state === "some" && <Minus style={{ width: 11, height: 11, color: "#FFF" }} />}
      </span>
    </button>
  );
}

function renderCell(key: WbsColKey, row: WbsRow, ctx: RowCtx): ReactNode {
  const { item } = row;
  const { canEdit } = ctx;
  switch (key) {
    case "check":
      return (
        <CheckBox state={ctx.checkedIds.has(item.id) ? "on" : "off"} label={`No.${row.no} の行を選ぶ`}
          onClick={() => ctx.onToggleCheck(item.id)} />
      );
    case "no":
      return (
        <div draggable={ctx.canDrag} onDragStart={e => ctx.onDragStart(e, item.id)} onDragEnd={ctx.onDragEnd}
          title={ctx.canDrag ? "ドラッグで並べ替え" : undefined}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, width: "100%", cursor: ctx.canDrag ? "grab" : "default", color: WBS_COLORS.subText, fontSize: 11 }}>
          {ctx.canDrag && <GripVertical style={{ width: 11, height: 11, color: "#C9CED6", flexShrink: 0 }} />}
          {row.no}
        </div>
      );
    case "name": {
      // 一番右の段より上の行（3段なら大項目・中項目）は見出し行。左の三角で下の行を開閉する
      const heading = item.level < ctx.levels;
      const closed = heading && ctx.collapsed.has(item.id);
      const isEditing = ctx.editing?.id === item.id && ctx.editing.field === "name";
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", minWidth: 0, paddingLeft: (item.level - 1) * INDENT }}>
          {heading && (
            <button type="button" onClick={() => ctx.onToggle(item.id)}
              aria-expanded={!closed} aria-label={closed ? "下の行を開く" : "下の行を閉じる"}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 18, height: 18, padding: 0, background: "transparent", border: "none", borderRadius: 4, cursor: "pointer", color: WBS_COLORS.headBg, flexShrink: 0 }}>
              {closed ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineText value={item.name} editing={isEditing} canEdit={canEdit} placeholder="（名前を入力）"
              textStyle={{ color: WBS_COLORS.text, fontWeight: heading ? (item.level === 1 ? 800 : 700) : 400 }}
              onStart={() => ctx.onEditingChange({ id: item.id, field: "name" })}
              onCommit={v => { ctx.onEditingChange(null); if (v !== item.name) ctx.onUpdate(item.id, { name: v }); }}
              onCancel={() => ctx.onEditingChange(null)} />
          </div>
          {/* 閉じているときは、隠れている行の数を出す */}
          {closed && row.descendantCount > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, color: WBS_COLORS.subText, flexShrink: 0 }}>{row.descendantCount}行</span>
          )}
        </div>
      );
    }
    case "assignee": {
      if (!canEdit) return <TruncatedText as="div" text={item.assignee} style={{ width: "100%" }} />;
      // プロジェクトから外れた人が担当のままでも、選択肢から消えて空に見えないようにする
      const options = item.assignee && !ctx.members.includes(item.assignee) ? [...ctx.members, item.assignee] : ctx.members;
      return (
        <WbsCellSelect value={item.assignee}
          options={[{ value: "", label: "—" }, ...options.map(m => ({ value: m, label: m }))]}
          onChange={v => ctx.onUpdate(item.id, { assignee: v })}
          style={{ ...cellSelect, color: item.assignee ? WBS_COLORS.text : "#C9CED6" }} />
      );
    }
    case "start":
    case "end": {
      const field = key === "start" ? "startDate" : "endDate";
      const delayed = key === "end" && row.delayed;
      return (
        <div style={{ width: "100%" }}>
          <DatePicker variant="cell" value={item[field]} disabled={!canEdit} placeholder={canEdit ? "年/月/日" : ""}
            onChange={v => ctx.onUpdate(item.id, { [field]: v })}
            cellStyle={{ fontSize: 12, color: delayed ? WBS_COLORS.delayText : item[field] ? WBS_COLORS.text : "#C9CED6", fontWeight: delayed ? 700 : 400 }} />
        </div>
      );
    }
    case "days": {
      const d = businessDays(item.startDate, item.endDate, ctx.holidays);
      return <span style={{ width: "100%", textAlign: "center" }}>{d === null ? "" : d}</span>;
    }
    case "progress":
      // 手で入力できるのは一番右の段の行だけ。左の段は下の行の平均を表示する
      if (row.isLeafLevel && canEdit) return <ProgressInput value={item.progress} onCommit={v => ctx.onUpdate(item.id, { progress: v })} />;
      return (
        <span title={row.isLeafLevel ? undefined : "下にある行の平均（自動計算）"}
          style={{ width: "100%", textAlign: "center", color: row.isLeafLevel ? WBS_COLORS.text : WBS_COLORS.subText }}>
          {row.progress === null ? "—" : `${row.progress}%`}
        </span>
      );
    case "status": {
      // status_id が空の行は、先頭のステータスとして扱う
      const current = ctx.statuses.find(s => s.id === item.statusId) ?? ctx.statuses[0];
      if (!current) return null;
      // 薄い色は行の背景（白／#F8F9FB）に埋もれるので、内側に細い枠を描いて輪郭を出す
      const onDark = textColorOn(current.color) === "#FFFFFF";
      const chip: CSSProperties = {
        background: current.color, color: textColorOn(current.color), fontSize: 11, fontWeight: 700, borderRadius: 4, height: 20,
        boxShadow: `inset 0 0 0 1px ${onDark ? "rgba(255,255,255,0.28)" : "rgba(30,41,58,0.16)"}`,
      };
      if (!canEdit) return <TruncatedText as="div" text={current.name} style={{ ...chip, width: "100%", textAlign: "center", lineHeight: "20px", padding: "0 4px", boxSizing: "border-box" }} />;
      return (
        <WbsCellSelect value={current.id} align="center"
          options={ctx.statuses.map(s => ({ value: s.id, label: s.name, color: s.color }))}
          onChange={v => ctx.onUpdate(item.id, { statusId: v })}
          style={{ ...cellSelect, ...chip, padding: "0 4px" }} />
      );
    }
    case "tickets":
      return ctx.renderTickets(row);
    case "note": {
      const isEditing = ctx.editing?.id === item.id && ctx.editing.field === "note";
      return (
        <InlineText value={item.note} editing={isEditing} canEdit={canEdit} placeholder=""
          textStyle={{ color: WBS_COLORS.text }}
          onStart={() => ctx.onEditingChange({ id: item.id, field: "note" })}
          onCommit={v => { ctx.onEditingChange(null); if (v !== item.note) ctx.onUpdate(item.id, { note: v }); }}
          onCancel={() => ctx.onEditingChange(null)} />
      );
    }
  }
}

const cellBase: CSSProperties = {
  display: "flex", alignItems: "center", minWidth: 0, height: WBS_ROW_H, padding: "0 6px", boxSizing: "border-box",
  borderRight: `1px solid ${WBS_COLORS.border}`, borderBottom: `1px solid ${WBS_COLORS.border}`,
  fontSize: 12, color: WBS_COLORS.text, overflow: "hidden", whiteSpace: "nowrap",
};

/** 見出し行に敷く色。大項目は濃いめ、中項目は薄め */
const HEADING_BG = ["#D9E2F6", "#EDF1FA"];

function rowBackground(row: WbsRow, levels: number, selected: boolean, highlighted: boolean, flashed = false): string {
  if (highlighted) return WBS_COLORS.highlightBg;
  // お知らせから移動した行。スプリント一覧の強調と同じ色
  if (flashed) return "#FFFBEB";
  if (selected) return "#ECFDF5";
  if (row.item.level < levels) return HEADING_BG[row.item.level - 1] ?? HEADING_BG[1];
  if (row.delayed) return "#FFF5F6";
  return "#FFFFFF";
}

type Col = (typeof WBS_COLUMNS)[number];

/**
 * 行の境目に重ねる、行を追加するための帯。マウスを乗せると、境目に緑の線と追加ボタンが出る。
 * at=bottom はその行の下の境目、at=top は上の境目（先頭の行の上にだけ使う）。
 */
function InsertZone({ at, levels, onPick }: { at: "top" | "bottom"; levels: number[]; onPick: (level: number) => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);
  return (
    <div
      // すぐ出すと、行の上をマウスが通り過ぎただけで線とボタンが点滅する
      onMouseEnter={() => { clear(); timer.current = window.setTimeout(() => setOpen(true), 180); }}
      onMouseLeave={() => { clear(); setOpen(false); }}
      style={{ position: "absolute", left: 0, right: 0, height: 10, [at]: -5, zIndex: 2 }}>
      {open && (
        <>
          <div style={{ position: "absolute", left: 0, right: 0, top: 4, height: 2, background: "#059669", pointerEvents: "none" }} />
          <div style={{ position: "absolute", left: 92, top: -7, display: "flex", gap: 4 }}>
            {levels.map(lv => (
              <button key={lv} type="button" onClick={() => { setOpen(false); onPick(lv); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 3, height: 24, padding: "0 10px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
                  color: "#FFFFFF", background: "#059669", border: "none", borderRadius: 12, cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.35)" }}>
                <Plus style={{ width: 11, height: 11 }} />{LEVEL_LABELS[lv - 1]}を追加
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}


/** 1行。side=left は枠の幅に合わせて縮む格子、side=right は px 幅の並び */
function WbsTableRow({ row, cols, side, template, selected, highlighted, flashed, dropMode, ctx, onDragOverRow, onDropRow, tail, insertBelow, insertAbove, onInsert }: {
  row: WbsRow; cols: Col[]; side: "left" | "right"; template: string;
  selected: boolean; highlighted: boolean; flashed: boolean; dropMode: WbsDropMode | null; ctx: RowCtx;
  onDragOverRow?: (e: DragEvent, row: WbsRow) => void;
  onDropRow?: (e: DragEvent) => void;
  /** セルの後ろに続けて出すもの（右の枠のガントの帯） */
  tail?: ReactNode;
  /** この行の下の境目に入れられる段。空なら、境目のボタンを出さない */
  insertBelow?: number[];
  /** この行の上の境目に入れられる段（先頭の行にだけ渡す） */
  insertAbove?: number[];
  onInsert?: (afterId: string | null, level: number) => void;
}) {
  const { item } = row;
  // 見出し行（大項目・中項目）は No. と項目だけを出し、ほかの欄は色で塗りつぶす
  const heading = item.level < ctx.levels;
  return (
    <div data-wbs-row={item.id}
      onDragOver={onDragOverRow ? e => onDragOverRow(e, row) : undefined} onDrop={onDropRow}
      style={{ position: "relative", height: WBS_ROW_H, background: rowBackground(row, ctx.levels, selected, highlighted, flashed),
        ...(side === "left" ? { display: "grid", gridTemplateColumns: template } : { display: "flex" }) }}>
      {cols.map(c => {
        const blank = heading && c.key !== "check" && c.key !== "no" && c.key !== "name";
        return (
          <div key={c.key}
            style={{
              ...cellBase,
              ...(side === "right" ? { flex: `0 0 ${c.width}px`, width: c.width } : null),
              justifyContent: c.align === "center" ? "center" : "flex-start",
              // 塗りつぶす欄は縦の罫線も引かず、行の色がひと続きに見えるようにする
              ...(heading && c.key !== "no" && c.key !== "check" ? { borderRight: "none" } : null),
              ...(c.key === "check" ? { padding: 0 } : null),
              ...(!heading && c.key === "end" && row.delayed ? { background: WBS_COLORS.delayBg } : null),
              ...(!heading && c.key === "no" && row.delayed ? { boxShadow: `inset 3px 0 0 ${WBS_COLORS.delayText}` } : null),
            }}>
            {blank ? null : renderCell(c.key, row, ctx)}
          </div>
        );
      })}
      {tail}
      {onInsert && insertAbove && insertAbove.length > 0 && (
        <InsertZone at="top" levels={insertAbove} onPick={lv => onInsert(null, lv)} />
      )}
      {onInsert && insertBelow && insertBelow.length > 0 && (
        <InsertZone at="bottom" levels={insertBelow} onPick={lv => onInsert(item.id, lv)} />
      )}
      {dropMode && (
        // 落とす先の目印。before/after は線、into（下の段として入れる）は枠
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1,
          ...(dropMode === "before" ? { borderTop: "2px solid #059669" }
            : dropMode === "after" ? { borderBottom: "2px solid #059669" }
            : { border: "2px solid #059669", background: "rgba(5,150,105,0.08)" }) }} />
      )}
    </div>
  );
}

// ── 表の本体 ──────────────────────────────────────────────────

export function WbsTable({
  rows, levels, statuses, members, holidays, canEdit, freezeKey, checkedIds, onToggleCheck, onToggleAll, allCheckState, editing, onEditingChange,
  highlightIds, scrollTo, flashId = null, focusGroupId = null, onUpdate, onMove, gantt, renderTickets, onFreezeChange, onInsert, onAddNew, collapseKey,
  filters, filterOptions, onFilterChange, shownIds, colOrder, onColOrderChange,
}: WbsTableProps) {
  // 絞り込み中は、行の追加（境目のボタン）とドラッグでの並べ替えを止める
  const filtering = shownIds !== null;
  const canArrange = canEdit && !filtering;
  const rootRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [viewH, setViewH] = useState(0);
  /** 右の枠の横スクロールバーの高さ。左の枠の下に同じだけ余白を足して、縦の移動量を揃える */
  const [hBarH, setHBarH] = useState(0);
  /** 左の枠の幅（＝固定の線の位置）。線のつまみを重ねる位置に使う */
  const [leftW, setLeftW] = useState(0);
  /** 右の枠の縦スクロールバーの幅。まとまりの枠の右端を、スクロールバーの手前で止めるのに使う */
  const [vBarW, setVBarW] = useState(0);

  // 列は利用者が並べた順。チェックボックスの列は、編集できる人にだけ出す。
  // ステータス列は、ステータス名の長さに合わせた幅と下限に置き換える（閲覧のみの人も同じ幅）
  const cols = useMemo(() => {
    const statusW = statusColWidth(statuses.map(s => s.name));
    return orderWbsColumns(colOrder)
      .filter(c => canEdit || c.key !== "check")
      .map(c => (c.key === "status" ? { ...c, width: statusW, min: statusW } : c));
  }, [canEdit, statuses, colOrder]);
  const freezeIdx = Math.max(0, cols.findIndex(c => c.key === freezeKey));
  // freezeKey の列が段数の変更で消えていたら（例：小項目まで固定 → 2段へ）、全列を固定に戻す
  const frozen = cols.some(c => c.key === freezeKey) ? cols.slice(0, freezeIdx + 1) : cols;
  const scrolling = cols.slice(frozen.length);
  // 見出しの高さは、ガントの見出し（4段）に揃える。左右の枠で必ず同じ高さにすること
  const headH = WBS_GANTT_HEAD_H;

  const leftTemplate = frozen.map(c => `minmax(${c.min ?? 0}px, ${c.width}fr)`).join(" ");
  const leftBasis = frozen.reduce((a, c) => a + c.width, 0);
  const colsWidth = scrolling.reduce((a, c) => a + c.width, 0);
  const rightWidth = colsWidth + ganttWidth(gantt);

  // ── 高さの計測（空の行で画面の下まで罫線を引くため） ──
  useLayoutEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      setLeftW(el.offsetWidth);
      const r = rightRef.current;
      setHBarH(r ? r.offsetHeight - r.clientHeight : 0);
      setVBarW(r ? r.offsetWidth - r.clientWidth : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (rightRef.current) ro.observe(rightRef.current);
    return () => ro.disconnect();
  }, []);

  // ── 見出し行の開閉 ──
  // 閉じている見出し行の id。WBSごと・利用者ごとにブラウザへ保存する
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      const raw = localStorage.getItem(collapseKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch { /* 保存領域が使えない・壊れているときは、すべて開いた状態で始める */ }
    return new Set<string>();
  });
  const saveCollapsed = (next: ReadonlySet<string>) => {
    setCollapsed(next);
    try { localStorage.setItem(collapseKey, JSON.stringify([...next])); } catch { /* 保存できなくても表示は切り替える */ }
  };
  const toggleCollapsed = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    saveCollapsed(next);
  };

  // 画面に並べる行。絞り込みで外れた行と、閉じている見出し行の下の行は並べない。
  // insertBelow は、その行の下の境目に入れられる段（境目のボタンに出す）。
  const display = useMemo(() => {
    const visible: WbsRow[] = [];
    // 閉じている見出し行の段。これより深い行は、次に同じ段以上の行が来るまで隠す
    let hiddenBelow = 0;
    for (const row of rows) {
      if (shownIds && !shownIds.has(row.item.id)) continue;
      if (hiddenBelow && row.item.level > hiddenBelow) continue;
      hiddenBelow = 0;
      visible.push(row);
      if (row.item.level < levels && collapsed.has(row.item.id)) hiddenBelow = row.item.level;
    }
    return visible.map(row => {
      const lv = row.item.level;
      const insertBelow: number[] = [];
      // 1つ下の段：この行の最初の子として入る（閉じている見出し行では、入れても見えないので出さない）
      if (lv < levels && !collapsed.has(row.item.id)) insertBelow.push(lv + 1);
      // 同じ段：いつでも出す。この行に下の行があるときは、足した行は下の行のまとまりの後ろに入る
      // （行のすぐ下の境目で「同じ段をもう1つ」と考えるのが自然、という利用者の指摘による）
      insertBelow.push(lv);
      // それより上の段は出さない。出すのは「すぐ上の行」から決まる2つまで
      // （まとまりの最後で上の段のボタンまで並べると、ボタンが3つになって選びにくい）。
      // 上の段を足したいときは、その段の行の下の境目から足す
      return { kind: "row" as const, row, insertBelow };
    });
  }, [rows, levels, collapsed, shownIds]);

  // 光らせる、大項目のまとまり（表に並んでいる行の、何行目から何行ぶんか）。
  // まとまりは buildWbsRows の group（大項目ごとの番号）が同じ行。閉じた見出し行の下の行は並んでいないので数えない
  const focusSpan = useMemo(() => {
    if (!focusGroupId) return null;
    const start = display.findIndex(d => d.row.item.id === focusGroupId);
    if (start < 0) return null;
    const group = display[start].row.group;
    let count = 1;
    while (start + count < display.length && display[start + count].row.group === group) count++;
    return { start, count };
  }, [display, focusGroupId]);

  const focusFrameRef = useRef<HTMLDivElement>(null);
  const moveFocusFrame = () => {
    if (focusFrameRef.current && leftRef.current) focusFrameRef.current.style.transform = `translateY(${-leftRef.current.scrollTop}px)`;
  };

  // 編集できる人には、入力用の空の行を必ず1行は出す（行が画面いっぱいまで増えても足せるように）
  const fillerCount = Math.max(canEdit ? 1 : 0, Math.ceil((viewH - headH) / WBS_ROW_H) - display.length);

  // ── 縦スクロールの同期 ──
  // 相手の枠を合わせるのは、「いま利用者が動かしている側」の枠から届いた通知のときだけにする。
  //
  // 以前は、左右どちらの通知でも「ずれていたら相手に合わせる」をしていた。すると、
  //   左をホイールで動かす → 右を合わせる → 右の通知が少し遅れて届く →
  //   その間に左は先へ進んでいるので「ずれている」と判定 → 左を古い位置へ引き戻す
  // となり、位置を書き換えた時点でブラウザのなめらかなスクロールも打ち切られて、
  // ホイール1回ぶんが数pxしか進まなかった（たくさん回さないとスクロールしない）。
  // 動かしている側を決めておけば、合わせられた側の通知は無視できるので、引き戻しが起きない。
  const activePaneRef = useRef<"left" | "right" | null>(null);
  /** ホイール・押下・タッチ・フォーカスが来た枠を「動かしている側」にする */
  const paneHandlers = (pane: "left" | "right") => {
    const activate = () => { activePaneRef.current = pane; };
    return { onWheel: activate, onPointerDown: activate, onTouchStart: activate, onFocus: activate };
  };
  const syncScroll = (from: "left" | "right") => {
    // 動かしている側ではない枠の通知は、こちらが合わせた結果なので何もしない
    if (activePaneRef.current && activePaneRef.current !== from) return;
    const a = from === "left" ? leftRef.current : rightRef.current;
    const b = from === "left" ? rightRef.current : leftRef.current;
    if (a && b && b.scrollTop !== a.scrollTop) b.scrollTop = a.scrollTop;
  };

  // ── 指定の行までスクロール ──
  // 閉じた見出し行の下にある行なら、先に上の見出し行を開く。開いた結果が画面に並んでから動かす
  // smooth: お知らせから移動した行（flashId と同じ行）。見えていても中央へなめらかに動かす
  const pendingScrollRef = useRef<{ id: string; smooth: boolean } | null>(null);
  useEffect(() => {
    if (!scrollTo) return;
    pendingScrollRef.current = { id: scrollTo.id, smooth: flashId === scrollTo.id || focusGroupId === scrollTo.id };
    const byId = new Map(rows.map(r => [r.item.id, r]));
    const next = new Set(collapsed);
    for (let p = byId.get(scrollTo.id)?.item.parentId; p; p = byId.get(p)?.item.parentId) next.delete(p);
    if (next.size !== collapsed.size) saveCollapsed(next);
  }, [scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pending = pendingScrollRef.current;
    if (!pending) return;
    const idx = display.findIndex(d => d.kind === "row" && d.row.item.id === pending.id);
    const el = leftRef.current;
    if (idx < 0 || !el) return;
    pendingScrollRef.current = null;
    const top = idx * WBS_ROW_H;
    const visibleH = el.clientHeight - headH;
    if (pending.id === focusGroupId && focusSpan) {
      // まとまり全体が収まるなら、まとまりを中央に。収まらないなら、大項目の行を上端の少し下に置く
      const spanH = focusSpan.count * WBS_ROW_H;
      const target = spanH <= visibleH - WBS_ROW_H ? top - (visibleH - spanH) / 2 : top - WBS_ROW_H / 2;
      activePaneRef.current = "left";
      el.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
      return;
    }
    if (pending.smooth) {
      // 左の枠だけをなめらかに動かし、右の枠は左の onScroll の同期でついてこさせる
      // （両方を別々になめらかに動かすと、途中で左右の行がずれる）
      activePaneRef.current = "left";
      el.scrollTo({ top: Math.max(0, top - Math.max(0, (visibleH - WBS_ROW_H) / 2)), behavior: "smooth" });
      return;
    }
    // 見出しのぶんを除いた見えている範囲に入っていれば動かさない
    if (top < el.scrollTop || top + WBS_ROW_H > el.scrollTop + visibleH) {
      el.scrollTop = Math.max(0, top - Math.max(0, (visibleH - WBS_ROW_H) / 2));
      // こちらで動かしたときは、右の枠も直接そろえる（右が「動かしている側」だと、左の通知は無視されるため）
      if (rightRef.current) rightRef.current.scrollTop = el.scrollTop;
    }
  }, [display, scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── ドラッグで並べ替え ──
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; mode: WbsDropMode } | null>(null);
  const rowById = useMemo(() => new Map(rows.map(r => [r.item.id, r])), [rows]);

  /**
   * 落とす先を決める。段は変えない（下の行の深さが崩れないようにするため）。
   *   同じ段の行の上      → その行の前か後ろ（別の親の下へも移せる）
   *   1つ上の段の行の上   → その行の下の段の末尾へ入れる
   *   もっと下の段の行の上 → その行が属している「同じ段の行」の後ろ
   */
  const resolveDrop = (e: DragEvent, target: WbsRow): { id: string; mode: WbsDropMode } | null => {
    const drag = dragId ? rowById.get(dragId) : undefined;
    if (!drag || target.item.id === drag.item.id) return null;
    const dl = drag.item.level;
    if (target.item.level === dl) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      return { id: target.item.id, mode: e.clientY < rect.top + rect.height / 2 ? "before" : "after" };
    }
    if (target.item.level === dl - 1) return { id: target.item.id, mode: "into" };
    if (target.item.level > dl) {
      let cur: WbsRow | undefined = target;
      while (cur && cur.item.level > dl) cur = cur.item.parentId ? rowById.get(cur.item.parentId) : undefined;
      if (cur && cur.item.level === dl && cur.item.id !== drag.item.id) return { id: cur.item.id, mode: "after" };
    }
    return null;
  };

  const handleDragOverRow = (e: DragEvent, target: WbsRow) => {
    if (!dragId) return;
    const next = resolveDrop(e, target);
    if (!next) { if (drop) setDrop(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!drop || drop.id !== next.id || drop.mode !== next.mode) setDrop(next);
  };

  const handleDropRow = (e: DragEvent) => {
    e.preventDefault();
    if (dragId && drop) onMove(dragId, drop.id, drop.mode);
    setDragId(null); setDrop(null);
  };

  const ctx: RowCtx = {
    levels, statuses, members, holidays, canEdit, canDrag: canArrange, editing, onEditingChange, onUpdate, renderTickets,
    collapsed, onToggle: toggleCollapsed, checkedIds, onToggleCheck,
    onDragStart: (e, id) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setDragId(id);
    },
    onDragEnd: () => { setDragId(null); setDrop(null); },
  };

  // ── 固定の線をドラッグで動かす ──
  // ドラッグ中は、いま画面に見えている列の右端を候補にして、ポインタにいちばん近い候補へ線を寄せる。
  // 離したときに、その列までを固定にする。見出しのセルの実際の位置を測るので、
  // 左の枠の縮み具合や右の枠の横スクロール位置に関係なく、見た目どおりの場所に落ちる。
  const [freezeDrag, setFreezeDrag] = useState<{ key: WbsColKey; left: number } | null>(null);
  const [freezeHover, setFreezeHover] = useState(false);
  const freezeCandidatesRef = useRef<{ key: WbsColKey; x: number }[]>([]);

  const nearestFreeze = (clientX: number) => {
    let best: { key: WbsColKey; x: number } | null = null;
    for (const c of freezeCandidatesRef.current) {
      if (!best || Math.abs(c.x - clientX) < Math.abs(best.x - clientX)) best = c;
    }
    return best;
  };

  const handleFreezeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!root || e.button !== 0) return;
    e.preventDefault();
    const rootRect = root.getBoundingClientRect();
    freezeCandidatesRef.current = Array.from(root.querySelectorAll<HTMLElement>("[data-wbs-col]"))
      .map(el => ({ key: el.dataset.wbsCol as WbsColKey, x: el.getBoundingClientRect().right }))
      // 横スクロールで枠の外へ出ている列は候補にしない（見えない場所へは落とせない）
      // チェックボックスの列だけを固定する位置（No. より左）には落とせない
      .filter(c => c.key !== "check" && c.x > rootRect.left + 8 && c.x < rootRect.right - 8);
    const hit = nearestFreeze(e.clientX);
    if (!hit) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setFreezeDrag({ key: hit.key, left: hit.x - rootRect.left });
  };

  const handleFreezeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const root = rootRef.current;
    if (!freezeDrag || !root) return;
    const hit = nearestFreeze(e.clientX);
    if (hit && hit.key !== freezeDrag.key) setFreezeDrag({ key: hit.key, left: hit.x - root.getBoundingClientRect().left });
  };

  const handleFreezeUp = () => {
    if (!freezeDrag) return;
    if (freezeDrag.key !== freezeKey) onFreezeChange(freezeDrag.key);
    setFreezeDrag(null);
  };

  // ── 列の見出しをドラッグで並べ替える（BRU20-011） ──
  // 押して5px以上動かしたらドラッグにする（それ未満はクリックで、フィルタの一覧が開く）。
  // ドラッグ中は、つかんだ見出しを半透明でポインタに追従させ、落とす先の列の境目に緑の線を出す。
  // 落とし先の候補は、固定の線と同じく「いま画面に見えている列の境目」だけ。
  // クリックの判定を残すため、ポインタは捕まえず window で受ける（捕まえるとフィルタのボタンに click が届かない）。
  const [colDrag, setColDrag] = useState<{ key: WbsColKey; label: string; width: number; ghostLeft: number; lineLeft: number | null } | null>(null);
  // ドラッグを離した直後の click を、フィルタの一覧を開くクリックとして扱わないための印
  const suppressClickRef = useRef(false);
  const colDragCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => colDragCleanupRef.current?.(), []);

  /** 落とせる列の境目。idx は「その位置に入れる」cols の添字 */
  const colDropTargets = (): { idx: number; x: number }[] => {
    const root = rootRef.current, left = leftRef.current, right = rightRef.current;
    if (!root || !left || !right) return [];
    const lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect();
    // チェックボックスの列より左には入れられない
    const minIdx = cols[0]?.key === "check" ? 1 : 0;
    const out: { idx: number; x: number }[] = [];
    cols.forEach((c, i) => {
      const r = root.querySelector<HTMLElement>(`[data-wbs-col="${c.key}"]`)?.getBoundingClientRect();
      if (!r) return;
      // 横スクロールで枠の外へ出ている境目は候補にしない（見えない場所へは落とせない）
      const pane = i < frozen.length ? lr : rr;
      const within = (x: number) => x >= pane.left - 1 && x <= pane.right + 1;
      // 左端。右の枠の先頭の列の左端は固定の線と同じ位置なので、固定側の右端（下）で代表させる
      if (i >= minIdx && i !== frozen.length && within(r.left)) out.push({ idx: i, x: r.left });
      // 右端は、固定の線の位置（固定側の最後の列）と、いちばん右の列だけ
      if ((i === frozen.length - 1 || i === cols.length - 1) && within(r.right)) out.push({ idx: i + 1, x: r.right });
    });
    return out;
  };

  /** from の列を to の位置へ移す。固定の線は「左から何列目まで」を保つ */
  const moveColumn = (from: number, to: number) => {
    if (to === from || to === from + 1) return;
    const keys = cols.map(c => c.key);
    const [key] = keys.splice(from, 1);
    keys.splice(to > from ? to - 1 : to, 0, key);
    onColOrderChange(keys.filter(k => k !== "check"), keys[frozen.length - 1]);
  };

  const handleColDown = (e: ReactPointerEvent<HTMLDivElement>, c: Col) => {
    const root = rootRef.current;
    if (!root || e.button !== 0 || c.key === "check") return;
    const pointerId = e.pointerId;
    const startX = e.clientX, startY = e.clientY;
    const cellRect = e.currentTarget.getBoundingClientRect();
    const grabOffset = startX - cellRect.left;
    const from = cols.findIndex(x => x.key === c.key);
    // ドラッグを始めたら候補を測る。null のあいだはまだクリックの扱い
    let targets: { idx: number; x: number }[] | null = null;
    let to: number | null = null;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!targets) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < COL_DRAG_THRESHOLD) return;
        targets = colDropTargets();
        document.body.style.cursor = "grabbing";
      }
      let hit: { idx: number; x: number } | null = null;
      for (const t of targets) if (!hit || Math.abs(t.x - ev.clientX) < Math.abs(hit.x - ev.clientX)) hit = t;
      to = hit?.idx ?? null;
      const rootLeft = root.getBoundingClientRect().left;
      setColDrag({ key: c.key, label: c.label, width: cellRect.width, ghostLeft: ev.clientX - rootLeft - grabOffset, lineLeft: hit ? hit.x - rootLeft : null });
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      colDragCleanupRef.current = null;
      if (targets) document.body.style.cursor = "";
    };
    const end = (ev: PointerEvent, commit: boolean) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (!targets) return;
      // 離した直後の click は捨てる。click が来ない（別の要素の上で離した）ときに備えて、すぐ印を外す
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 0);
      setColDrag(null);
      if (commit && to !== null) moveColumn(from, to);
    };
    const up = (ev: PointerEvent) => end(ev, true);
    const cancel = (ev: PointerEvent) => end(ev, false);
    colDragCleanupRef.current?.();
    colDragCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // 絞り込みの一覧を開いている列
  const [openFilter, setOpenFilter] = useState<WbsFilterCol | "">("");
  const closeFilter = useCallback(() => setOpenFilter(""), []);
  const isFilterCol = (key: WbsColKey): key is WbsFilterCol => (WBS_FILTER_COLS as readonly string[]).includes(key);

  const headCell = (c: Col, side: "left" | "right"): ReactNode => (
    <div key={c.key} data-wbs-col={c.key}
      onPointerDown={c.key === "check" ? undefined : e => handleColDown(e, c)}
      onClickCapture={e => { if (suppressClickRef.current) { suppressClickRef.current = false; e.stopPropagation(); e.preventDefault(); } }}
      style={{
      display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, height: headH, padding: "0 4px", boxSizing: "border-box",
      fontSize: 11, fontWeight: 700, color: WBS_COLORS.headText, borderRight: "1px solid rgba(255,255,255,0.18)",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      // ドラッグで見出しの文字が選択されないようにする
      userSelect: "none", cursor: c.key === "check" ? undefined : "grab",
      // ドラッグ中の列は、元の位置を薄くする
      opacity: colDrag?.key === c.key ? 0.35 : 1,
      ...(side === "right" ? { flex: `0 0 ${c.width}px`, width: c.width } : null),
    }}>
      {c.key === "check" ? (
        <CheckBox onDark label={filtering ? "見えている行を選ぶ／外す" : "すべての行を選ぶ／外す"} onClick={onToggleAll} state={allCheckState} />
      ) : isFilterCol(c.key) ? (
        // 並び替えは出さない（WBSの並びそのものに意味があるため）。
        // 見出しのセルと左の枠は overflow で切るので、一覧は body へ出す
        <ColumnFilter col={c.key} label={c.label} sortable={false} onDark portal
          options={filterOptions[c.key]} selected={filters[c.key] ?? EMPTY_SET}
          onFilterChange={sel => onFilterChange(c.key as WbsFilterCol, sel)}
          open={openFilter === c.key} onToggle={() => setOpenFilter(o => (o === c.key ? "" : c.key as WbsFilterCol))} onClose={closeFilter} />
      ) : c.label}
    </div>
  );

  /** 入力用のセル（空の行の中の1マス）。押すとその場で入力欄になり、確定するとその行に入る */
  const entryCell = (id: string, field: "add" | "new", lv: number, onAdd: (name: string) => void): ReactNode => {
    const start = () => onEditingChange({ id, field, level: lv });
    return (
      <InlineText value="" canEdit keepOpenOnEnter placeholder={`${LEVEL_LABELS[lv - 1]}を入力`}
        editing={editing?.id === id && editing.field === field && editing.level === lv}
        onStart={start}
        // Enter で確定したときは入力欄を残して、続けて次の行を打てるようにする
        onCommit={(v, viaEnter) => { if (v) onAdd(v); if (!v || !viaEnter) onEditingChange(null); }}
        onCancel={() => onEditingChange(null)} />
    );
  };

  /** いちばん下の空の行。先頭の1行に入力すると、新しい大項目が足される */
  const fillers = (side: "left" | "right", list: Col[]) =>
    Array.from({ length: fillerCount }, (_, i) => (
      <div key={`f${i}`} style={{ height: WBS_ROW_H, ...(side === "left" ? { display: "grid", gridTemplateColumns: leftTemplate } : { display: "flex" }) }}>
        {list.map(c => {
          const isEntry = canEdit && i === 0 && c.key === "name";
          return (
            <div key={c.key} style={{ ...cellBase, ...(side === "right" ? { flex: `0 0 ${c.width}px`, width: c.width } : null), ...(isEntry ? { cursor: "text" } : null) }}>
              {isEntry && (
                <div style={{ width: "100%", minWidth: 0, paddingLeft: levels > 1 ? 22 : 0 }}>{entryCell(WBS_NEW_ROW_ID, "new", 1, onAddNew)}</div>
              )}
            </div>
          );
        })}
        {side === "right" && <WbsGanttStrip model={gantt} rowH={WBS_ROW_H} />}
      </div>
    ));

  return (
    <div ref={rootRef} style={{ position: "relative", display: "flex", height: "100%", minHeight: 0 }}>
      <style>{`.wbs-vscroll-hide{scrollbar-width:none}.wbs-vscroll-hide::-webkit-scrollbar{display:none}`
        // まとまりの光り方。2回ふくらんで（濃く→薄く→濃く）、最後に消える
        + `@keyframes wbs-focus-pulse{0%{opacity:0}15%{opacity:1}35%{opacity:.3}55%{opacity:1}100%{opacity:0}}`}</style>

      {/* マスタースケジュールから移動した大項目のまとまりを光らせる。左右の枠をまたいで1つに見せるため、
          表の外側に重ねる。見出しと横スクロールバーには掛からないよう、その内側で切り取る。
          縦の位置は、スクロールのたびに再描画せず、左の枠のスクロールに合わせて直接ずらす（moveFocusFrame） */}
      {focusSpan && (
        <div style={{ position: "absolute", top: headH, left: 0, right: vBarW, bottom: hBarH, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}>
          <div ref={focusFrameRef} style={{ position: "absolute", left: 0, right: 0, top: 0, transform: `translateY(${-(leftRef.current?.scrollTop ?? 0)}px)` }}>
            <div style={{ position: "absolute", left: 2, right: 2, top: focusSpan.start * WBS_ROW_H, height: focusSpan.count * WBS_ROW_H,
              boxSizing: "border-box", borderRadius: 6, border: `3px solid ${FOCUS_EDGE}`,
              boxShadow: `0 0 0 5px ${FOCUS_GLOW}`, opacity: 0,
              animation: `wbs-focus-pulse ${FOCUS_PULSE_MS}ms ease-in-out forwards` }} />
          </div>
        </div>
      )}

      {/* 固定の線のつまみ。線の上に重ねてあり、左右にドラッグすると固定する列の位置が変わる */}
      <div role="separator" aria-orientation="vertical" aria-label="固定する列の位置"
        title="左右にドラッグして、固定する列の位置を変える"
        onPointerDown={handleFreezeDown} onPointerMove={handleFreezeMove} onPointerUp={handleFreezeUp} onPointerCancel={() => setFreezeDrag(null)}
        onMouseEnter={() => setFreezeHover(true)} onMouseLeave={() => setFreezeHover(false)}
        style={{ position: "absolute", top: 0, bottom: 0, left: leftW - 6, width: 10, zIndex: 6, cursor: "col-resize", touchAction: "none",
          display: "flex", justifyContent: "center" }}>
        <div style={{ width: 4, height: "100%", borderRadius: 2, background: "#059669", opacity: freezeHover && !freezeDrag ? 0.9 : 0, transition: "opacity 0.12s" }} />
      </div>
      {/* ドラッグ中の落とし先。離すとここが新しい固定の線になる */}
      {freezeDrag && (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: freezeDrag.left - 2, width: 4, zIndex: 7, background: "#059669", borderRadius: 2, pointerEvents: "none", boxShadow: "0 0 0 3px rgba(5,150,105,0.18)" }} />
      )}
      {/* 列の見出しのドラッグ中：落とす先の境目（固定の線のドラッグと同じ見た目）と、ポインタに追従する見出し */}
      {colDrag && colDrag.lineLeft !== null && (
        <div style={{ position: "absolute", top: 0, bottom: 0, left: colDrag.lineLeft - 2, width: 4, zIndex: 7, background: "#059669", borderRadius: 2, pointerEvents: "none", boxShadow: "0 0 0 3px rgba(5,150,105,0.18)" }} />
      )}
      {colDrag && (
        <div style={{ position: "absolute", top: 0, left: colDrag.ghostLeft, width: colDrag.width, height: headH, zIndex: 8, pointerEvents: "none",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px", boxSizing: "border-box",
          fontSize: 11, fontWeight: 700, color: WBS_COLORS.headText, background: WBS_COLORS.headBg, opacity: 0.7,
          borderRadius: 4, boxShadow: "0 4px 12px rgba(15,23,42,0.25)", whiteSpace: "nowrap", overflow: "hidden" }}>
          {colDrag.label}
        </div>
      )}

      {/* 左の枠：固定した列。横スクロールなしで枠の幅に収める */}
      <div ref={leftRef} onScroll={() => { syncScroll("left"); moveFocusFrame(); }} {...paneHandlers("left")}
        className="wbs-vscroll-hide"
        style={{ position: "relative", overflowX: "hidden", overflowY: "auto", minWidth: 0,
          flex: `0 1 ${leftBasis}px`, maxWidth: "70%", borderRight: `2px solid ${WBS_COLORS.headBg}` }}>
        <div style={{ position: "sticky", top: 0, zIndex: 3, display: "grid", gridTemplateColumns: leftTemplate, background: WBS_COLORS.headBg }}>
          {frozen.map(c => headCell(c, "left"))}
        </div>
        {display.map((d, i) => (
          <WbsTableRow key={d.row.item.id} row={d.row} cols={frozen} side="left" template={leftTemplate}
            // 行の境目の追加ボタンは、左の枠にだけ出す。先頭の行の上には、大項目を入れられる
            onInsert={canArrange ? onInsert : undefined} insertBelow={d.insertBelow} insertAbove={i === 0 ? [1] : undefined}
            selected={checkedIds.has(d.row.item.id)} highlighted={highlightIds.has(d.row.item.id)} flashed={flashId === d.row.item.id}
            dropMode={drop?.id === d.row.item.id ? drop.mode : null}
            ctx={ctx}
            onDragOverRow={canArrange ? handleDragOverRow : undefined} onDropRow={canArrange ? handleDropRow : undefined} />
        ))}
        {fillers("left", frozen)}
        {hBarH > 0 && <div style={{ height: hBarH }} />}
      </div>

      {/* 右の枠：固定していない列とガント。ここだけが横にスクロールする */}
      <div ref={rightRef} onScroll={() => syncScroll("right")} {...paneHandlers("right")} data-wbs-hpane=""
        // 端まで送ったあとの横スクロールを、ブラウザの「戻る／進む」へ渡さない
        style={{ position: "relative", flex: 1, minWidth: 0, overflow: "auto", overscrollBehaviorX: "contain" }}>
        <div style={{ position: "relative", width: rightWidth, minHeight: "100%" }}>
          {/* 塗りつぶした見出し行（zIndex 3）が、スクロールしたときにこの見出しの上へ出ないよう 4 にする */}
          <div style={{ position: "sticky", top: 0, zIndex: 4, display: "flex", background: WBS_COLORS.headBg }}>
            {scrolling.map(c => headCell(c, "right"))}
            <WbsGanttHeader model={gantt} />
          </div>
          {display.map(d => (
            <WbsTableRow key={d.row.item.id} row={d.row} cols={scrolling} side="right" template=""
              selected={checkedIds.has(d.row.item.id)} highlighted={highlightIds.has(d.row.item.id)} flashed={flashId === d.row.item.id}
              dropMode={null} ctx={ctx}
              // 見出し行（大項目・中項目）は日付を持たせないので、ガントの側も行の色で塗りつぶす
              tail={d.row.item.level < levels
                ? <WbsGanttStrip model={gantt} rowH={WBS_ROW_H} fill={rowBackground(d.row, levels, checkedIds.has(d.row.item.id), highlightIds.has(d.row.item.id), flashId === d.row.item.id)} />
                : <WbsGanttStrip model={gantt} row={d.row} statuses={statuses} rowH={WBS_ROW_H} />} />
          ))}
          {fillers("right", scrolling)}
          {/* 土日・祝日の縦帯と今日の印。行の帯より上、見出しより下に重ねる */}
          <WbsGanttOverlay model={gantt} left={colsWidth} top={headH} rowH={WBS_ROW_H} />
        </div>
      </div>
    </div>
  );
}
