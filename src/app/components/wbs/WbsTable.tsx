// ENHA2-053 WBSの表。
//
// 作り:
//   ・左の枠（固定した列）と右の枠（固定していない列＋ガント）の2つに分ける。
//     左の枠は横スクロールさせず、列を枠の幅に合わせて縮める。右の枠だけが横にスクロールする。
//   ・縦のスクロールは2つの枠で同期させ、行がずれないようにする。見出しはそれぞれの枠の上端に固定。
//   ・行は table ではなく、高さを固定した div を並べる（2つの枠で行の高さを必ず揃えるため）。
//   ・進捗率の自動計算・予定日数・遅延の判定は保存せず、wbsCalc で計算した値を表示するだけ。
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { DatePicker } from "@/app/components/shared/DatePicker";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { submitOnEnter } from "@/app/lib/submitKey";
import { businessDays, textColorOn, type WbsGanttModel, type WbsRow } from "@/app/lib/wbsCalc";
import type { WbsItem, WbsStatus } from "@/app/types";
import { WBS_COLORS } from "./wbsStyles";
import { WBS_GANTT_HEAD_H, WbsGanttHeader, WbsGanttOverlay, WbsGanttStrip, ganttWidth } from "./WbsGantt";

export const WBS_ROW_H = 30;

export type WbsColKey = "no" | "l1" | "l2" | "l3" | "assignee" | "start" | "end" | "days" | "progress" | "status" | "tickets" | "note";

/** 列の定義。width は左の枠では比率、右の枠では px として使う */
export const WBS_COLUMNS: { key: WbsColKey; label: string; width: number; align?: "center" }[] = [
  { key: "no", label: "No.", width: 52, align: "center" },
  { key: "l1", label: "大項目", width: 120 },
  { key: "l2", label: "中項目", width: 130 },
  { key: "l3", label: "小項目", width: 220 },
  { key: "assignee", label: "担当者", width: 88 },
  { key: "start", label: "開始予定日", width: 88, align: "center" },
  { key: "end", label: "終了予定日", width: 88, align: "center" },
  { key: "days", label: "予定日数", width: 56, align: "center" },
  { key: "progress", label: "進捗率", width: 60, align: "center" },
  { key: "status", label: "ステータス", width: 84, align: "center" },
  { key: "tickets", label: "チケット", width: 120 },
  { key: "note", label: "備考", width: 140 },
];

/** 段数に応じて出す列。2段なら小項目を、1段なら中項目と小項目を出さない */
export function visibleWbsColumns(levels: number) {
  return WBS_COLUMNS.filter(c => !(c.key === "l3" && levels < 3) && !(c.key === "l2" && levels < 2));
}

export type WbsDropMode = "before" | "after" | "into";
export interface WbsEditing { id: string; field: "name" | "note" }

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
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  editing: WbsEditing | null;
  onEditingChange: (e: WbsEditing | null) => void;
  /** 段数を減らせない理由になっている行（赤く塗る） */
  highlightIds: ReadonlySet<string>;
  /** この行まで表をスクロールする。同じ行へもう一度飛べるよう nonce を変えて渡す */
  scrollTo: { id: string; nonce: number } | null;
  onUpdate: (id: string, patch: Partial<WbsItem>) => void;
  onMove: (dragId: string, targetId: string, mode: WbsDropMode) => void;
  /** 右の枠の末尾に出すガント */
  gantt: WbsGanttModel;
}

// ── セルの中の入力部品 ────────────────────────────────────────

/** 名前・備考。押すとその場で入力欄になる。Enter か欄の外を押すと確定、Esc で取り消し */
function InlineText({ value, editing, canEdit, placeholder, textStyle, onStart, onCommit, onCancel }: {
  value: string; editing: boolean; canEdit: boolean; placeholder: string; textStyle?: CSSProperties;
  onStart: () => void; onCommit: (v: string) => void; onCancel: () => void;
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
        onKeyDown={submitOnEnter(commit, { onCancel: cancel })}
        onMouseDown={e => e.stopPropagation()}
        style={{ width: "100%", height: 22, padding: "0 4px", fontSize: 12, color: WBS_COLORS.text, background: "#FFFFFF", border: "1px solid #059669", borderRadius: 4, outline: "none", boxSizing: "border-box" }} />
    );
  }
  return (
    <TruncatedText as="div" text={value || (canEdit ? placeholder : "")}
      style={{ width: "100%", cursor: canEdit ? "text" : "default", ...textStyle, ...(value ? null : { color: "#C9CED6", fontWeight: 400 }) }}>
      <span onClick={canEdit ? onStart : undefined} style={{ display: "block", minHeight: 18, overflow: "hidden", textOverflow: "ellipsis" }}>{value || (canEdit ? placeholder : "")}</span>
    </TruncatedText>
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
  editing: WbsEditing | null;
  onEditingChange: (e: WbsEditing | null) => void;
  onUpdate: (id: string, patch: Partial<WbsItem>) => void;
  onDragStart: (e: DragEvent, id: string) => void;
  onDragEnd: () => void;
}

function renderCell(key: WbsColKey, row: WbsRow, ctx: RowCtx): ReactNode {
  const { item } = row;
  const { canEdit } = ctx;
  switch (key) {
    case "no":
      return (
        <div draggable={canEdit} onDragStart={e => ctx.onDragStart(e, item.id)} onDragEnd={ctx.onDragEnd}
          title={canEdit ? "ドラッグで並べ替え" : undefined}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 2, width: "100%", cursor: canEdit ? "grab" : "default", color: WBS_COLORS.subText, fontSize: 11 }}>
          {canEdit && <GripVertical style={{ width: 11, height: 11, color: "#C9CED6", flexShrink: 0 }} />}
          {row.no}
        </div>
      );
    case "l1": case "l2": case "l3": {
      const lv = key === "l1" ? 1 : key === "l2" ? 2 : 3;
      const name = row.names[lv - 1];
      if (name === null) return null;
      if (lv !== item.level) {
        // 属している上の段の名前は薄い灰色で出す（空欄にしない）
        return <TruncatedText as="div" text={name} style={{ width: "100%", color: WBS_COLORS.ancestorText }} />;
      }
      const isEditing = ctx.editing?.id === item.id && ctx.editing.field === "name";
      return (
        <InlineText value={item.name} editing={isEditing} canEdit={canEdit} placeholder="（名前を入力）"
          textStyle={{ color: WBS_COLORS.text, fontWeight: item.level === 1 ? 700 : 400 }}
          onStart={() => ctx.onEditingChange({ id: item.id, field: "name" })}
          onCommit={v => { ctx.onEditingChange(null); if (v !== item.name) ctx.onUpdate(item.id, { name: v }); }}
          onCancel={() => ctx.onEditingChange(null)} />
      );
    }
    case "assignee": {
      if (!canEdit) return <TruncatedText as="div" text={item.assignee} style={{ width: "100%" }} />;
      // プロジェクトから外れた人が担当のままでも、選択肢から消えて空に見えないようにする
      const options = item.assignee && !ctx.members.includes(item.assignee) ? [...ctx.members, item.assignee] : ctx.members;
      return (
        <select value={item.assignee} onChange={e => ctx.onUpdate(item.id, { assignee: e.target.value })} title={item.assignee || undefined}
          style={{ ...cellSelect, color: item.assignee ? WBS_COLORS.text : "#C9CED6" }}>
          <option value="">—</option>
          {options.map(m => <option key={m} value={m} style={{ color: WBS_COLORS.text }}>{m}</option>)}
        </select>
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
      const chip: CSSProperties = { background: current.color, color: textColorOn(current.color), fontSize: 11, fontWeight: 700, borderRadius: 4, height: 20 };
      if (!canEdit) return <TruncatedText as="div" text={current.name} style={{ ...chip, width: "100%", textAlign: "center", lineHeight: "20px", padding: "0 4px", boxSizing: "border-box" }} />;
      return (
        <select value={current.id} onChange={e => ctx.onUpdate(item.id, { statusId: e.target.value })}
          style={{ ...cellSelect, ...chip, textAlign: "center", padding: "0 2px" }}>
          {ctx.statuses.map(s => <option key={s.id} value={s.id} style={{ background: "#FFFFFF", color: WBS_COLORS.text }}>{s.name}</option>)}
        </select>
      );
    }
    case "tickets":
      return null;
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

function rowBackground(row: WbsRow, selected: boolean, highlighted: boolean): string {
  if (highlighted) return WBS_COLORS.highlightBg;
  if (selected) return "#ECFDF5";
  if (row.delayed) return "#FFF5F6";
  return row.group % 2 === 1 ? WBS_COLORS.stripeBg : "#FFFFFF";
}

type Col = (typeof WBS_COLUMNS)[number];

/** 1行。side=left は枠の幅に合わせて縮む格子、side=right は px 幅の並び */
function WbsTableRow({ row, cols, side, template, selected, highlighted, dropMode, ctx, onSelect, onDragOverRow, onDropRow, tail }: {
  row: WbsRow; cols: Col[]; side: "left" | "right"; template: string;
  selected: boolean; highlighted: boolean; dropMode: WbsDropMode | null; ctx: RowCtx;
  onSelect: (id: string) => void;
  onDragOverRow?: (e: DragEvent, row: WbsRow) => void;
  onDropRow?: (e: DragEvent) => void;
  /** セルの後ろに続けて出すもの（右の枠のガントの帯） */
  tail?: ReactNode;
}) {
  const { item } = row;
  return (
    <div data-wbs-row={item.id} onMouseDown={() => onSelect(item.id)}
      onDragOver={onDragOverRow ? e => onDragOverRow(e, row) : undefined} onDrop={onDropRow}
      style={{ position: "relative", height: WBS_ROW_H, background: rowBackground(row, selected, highlighted),
        ...(side === "left" ? { display: "grid", gridTemplateColumns: template } : { display: "flex" }) }}>
      {cols.map(c => (
        <div key={c.key}
          style={{
            ...cellBase,
            ...(side === "right" ? { flex: `0 0 ${c.width}px`, width: c.width } : null),
            justifyContent: c.align === "center" ? "center" : "flex-start",
            ...(c.key === "end" && row.delayed ? { background: WBS_COLORS.delayBg } : null),
            ...(c.key === "no" && row.delayed ? { boxShadow: `inset 3px 0 0 ${WBS_COLORS.delayText}` } : null),
          }}>
          {renderCell(c.key, row, ctx)}
        </div>
      ))}
      {tail}
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
  rows, levels, statuses, members, holidays, canEdit, freezeKey, selectedId, onSelect, editing, onEditingChange,
  highlightIds, scrollTo, onUpdate, onMove, gantt,
}: WbsTableProps) {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [viewH, setViewH] = useState(0);
  /** 右の枠の横スクロールバーの高さ。左の枠の下に同じだけ余白を足して、縦の移動量を揃える */
  const [hBarH, setHBarH] = useState(0);

  const cols = useMemo(() => visibleWbsColumns(levels), [levels]);
  const freezeIdx = Math.max(0, cols.findIndex(c => c.key === freezeKey));
  // freezeKey の列が段数の変更で消えていたら（例：小項目まで固定 → 2段へ）、全列を固定に戻す
  const frozen = cols.some(c => c.key === freezeKey) ? cols.slice(0, freezeIdx + 1) : cols;
  const scrolling = cols.slice(frozen.length);
  // 見出しの高さは、ガントの見出し（4段）に揃える。左右の枠で必ず同じ高さにすること
  const headH = WBS_GANTT_HEAD_H;

  const leftTemplate = frozen.map(c => `minmax(0, ${c.width}fr)`).join(" ");
  const leftBasis = frozen.reduce((a, c) => a + c.width, 0);
  const colsWidth = scrolling.reduce((a, c) => a + c.width, 0);
  const rightWidth = colsWidth + ganttWidth(gantt);

  // ── 高さの計測（空の行で画面の下まで罫線を引くため） ──
  useLayoutEffect(() => {
    const el = leftRef.current;
    if (!el) return;
    const measure = () => {
      setViewH(el.clientHeight);
      const r = rightRef.current;
      setHBarH(r ? r.offsetHeight - r.clientHeight : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (rightRef.current) ro.observe(rightRef.current);
    return () => ro.disconnect();
  }, []);

  const fillerCount = Math.max(0, Math.ceil((viewH - headH) / WBS_ROW_H) - rows.length);

  // ── 縦スクロールの同期 ──
  const syncScroll = (from: "left" | "right") => {
    const a = from === "left" ? leftRef.current : rightRef.current;
    const b = from === "left" ? rightRef.current : leftRef.current;
    if (a && b && b.scrollTop !== a.scrollTop) b.scrollTop = a.scrollTop;
  };

  // ── 指定の行までスクロール ──
  useEffect(() => {
    if (!scrollTo) return;
    const idx = rows.findIndex(r => r.item.id === scrollTo.id);
    const el = leftRef.current;
    if (idx < 0 || !el) return;
    const top = idx * WBS_ROW_H;
    // 見出しのぶんを除いた見えている範囲に入っていれば動かさない
    const visibleH = el.clientHeight - headH;
    if (top < el.scrollTop || top + WBS_ROW_H > el.scrollTop + visibleH) {
      el.scrollTop = Math.max(0, top - Math.max(0, (visibleH - WBS_ROW_H) / 2));
    }
  }, [scrollTo]); // eslint-disable-line react-hooks/exhaustive-deps

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
    levels, statuses, members, holidays, canEdit, editing, onEditingChange, onUpdate,
    onDragStart: (e, id) => {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", id);
      setDragId(id);
    },
    onDragEnd: () => { setDragId(null); setDrop(null); },
  };

  const headCell = (c: Col, side: "left" | "right"): ReactNode => (
    <div key={c.key} style={{
      display: "flex", alignItems: "center", justifyContent: "center", minWidth: 0, height: headH, padding: "0 4px", boxSizing: "border-box",
      fontSize: 11, fontWeight: 700, color: WBS_COLORS.headText, borderRight: "1px solid rgba(255,255,255,0.18)",
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
      ...(side === "right" ? { flex: `0 0 ${c.width}px`, width: c.width } : null),
    }}>{c.label}</div>
  );

  const fillers = (side: "left" | "right", list: Col[]) =>
    Array.from({ length: fillerCount }, (_, i) => (
      <div key={`f${i}`} style={{ height: WBS_ROW_H, ...(side === "left" ? { display: "grid", gridTemplateColumns: leftTemplate } : { display: "flex" }) }}>
        {list.map(c => (
          <div key={c.key} style={{ ...cellBase, ...(side === "right" ? { flex: `0 0 ${c.width}px`, width: c.width } : null) }} />
        ))}
        {side === "right" && <WbsGanttStrip model={gantt} rowH={WBS_ROW_H} />}
      </div>
    ));

  return (
    <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
      <style>{`.wbs-vscroll-hide{scrollbar-width:none}.wbs-vscroll-hide::-webkit-scrollbar{display:none}`}</style>

      {/* 左の枠：固定した列。横スクロールなしで枠の幅に収める */}
      <div ref={leftRef} onScroll={() => syncScroll("left")}
        className="wbs-vscroll-hide"
        style={{ position: "relative", overflowX: "hidden", overflowY: "auto", minWidth: 0,
          flex: `0 1 ${leftBasis}px`, maxWidth: "70%", borderRight: `2px solid ${WBS_COLORS.headBg}` }}>
        <div style={{ position: "sticky", top: 0, zIndex: 3, display: "grid", gridTemplateColumns: leftTemplate, background: WBS_COLORS.headBg }}>
          {frozen.map(c => headCell(c, "left"))}
        </div>
        {rows.map(row => (
          <WbsTableRow key={row.item.id} row={row} cols={frozen} side="left" template={leftTemplate}
            selected={selectedId === row.item.id} highlighted={highlightIds.has(row.item.id)}
            dropMode={drop?.id === row.item.id ? drop.mode : null}
            ctx={ctx} onSelect={onSelect}
            onDragOverRow={canEdit ? handleDragOverRow : undefined} onDropRow={canEdit ? handleDropRow : undefined} />
        ))}
        {fillers("left", frozen)}
        {hBarH > 0 && <div style={{ height: hBarH }} />}
      </div>

      {/* 右の枠：固定していない列とガント。ここだけが横にスクロールする */}
      <div ref={rightRef} onScroll={() => syncScroll("right")}
        style={{ position: "relative", flex: 1, minWidth: 0, overflow: "auto" }}>
        <div style={{ position: "relative", width: rightWidth, minHeight: "100%" }}>
          <div style={{ position: "sticky", top: 0, zIndex: 3, display: "flex", background: WBS_COLORS.headBg }}>
            {scrolling.map(c => headCell(c, "right"))}
            <WbsGanttHeader model={gantt} />
          </div>
          {rows.map(row => (
            <WbsTableRow key={row.item.id} row={row} cols={scrolling} side="right" template=""
              selected={selectedId === row.item.id} highlighted={highlightIds.has(row.item.id)}
              dropMode={null} ctx={ctx} onSelect={onSelect}
              tail={<WbsGanttStrip model={gantt} row={row} statuses={statuses} rowH={WBS_ROW_H} />} />
          ))}
          {fillers("right", scrolling)}
          {/* 土日・祝日の縦帯と今日の印。行の帯より上、見出しより下に重ねる */}
          <WbsGanttOverlay model={gantt} left={colsWidth} top={headH} rowH={WBS_ROW_H} />
        </div>
      </div>
    </div>
  );
}
