import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HotTable } from "@handsontable/react";
import { registerAllModules } from "handsontable/registry";
import { X, Plus, TableProperties, AlertCircle, Check } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, MEMBERS } from "@/app/data/mock";
import { useAuth } from "@/app/contexts/AuthContext";
import { escStack } from "@/app/lib/escStack";
import { getDefaultProgressForStatus } from "@/app/lib/helpers";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";

registerAllModules();

// ── Constants ────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, string> = {
  "未着手":     "todo",
  "進行中":     "in-progress",
  "レビュー中": "in-review",
  "レビュー完了": "review-done",
  "STG完了":   "stg-test",
  "UAT完了":   "uat",
  "クローズ":  "closed",
};
const STATUS_LABELS = Object.keys(STATUS_MAP);

const PRIORITY_MAP: Record<string, string> = { "高": "high", "中": "medium", "低": "low" };
const PRIORITY_LABELS = Object.keys(PRIORITY_MAP);

const STATUS_STYLES: Record<string, { color: string; bg: string }> = {
  "未着手":     { color: "#6B6458", bg: "#F4F5F6" },
  "進行中":     { color: "#D97706", bg: "#FFFBEB" },
  "レビュー中": { color: "#7C3AED", bg: "#F5F3FF" },
  "レビュー完了": { color: "#0284C7", bg: "#F0F9FF" },
  "STG完了":   { color: "#0D9488", bg: "#F0FDFA" },
  "UAT完了":   { color: "#4F46E5", bg: "#EEF2FF" },
  "クローズ":  { color: "#6B7280", bg: "#F3F4F6" },
};

const PRIORITY_STYLES: Record<string, { color: string; bg: string }> = {
  "高": { color: "#DC2626", bg: "#FEF2F2" },
  "中": { color: "#D97706", bg: "#FFFBEB" },
  "低": { color: "#0284C7", bg: "#F0F9FF" },
};

const INITIAL_ROW_COUNT = 5;

// ── Custom cell renderers ─────────────────────────────────────────────────────

function renderDropdownTd(
  TD: HTMLElement,
  value: string,
  badgeStyle: { color: string; bg: string } | null,
  placeholder: string,
  className?: string,
) {
  // This renderer fully replaces HOT's default rendering path (doesn't call baseRenderer),
  // so cellProperties.className (used for validation-error highlighting) must be applied here.
  TD.className = className || "";
  TD.innerHTML = "";
  TD.style.cursor = "pointer";
  TD.style.padding = "0";
  TD.style.overflow = "hidden";

  const wrap = document.createElement("div");
  // height:32px (not 100%) so Handsontable's measurement sees a fixed 32px, preventing row expansion
  wrap.style.cssText =
    "display:flex;align-items:center;justify-content:space-between;height:32px;padding:0 9px;box-sizing:border-box;gap:4px;overflow:hidden";

  if (value && badgeStyle) {
    const badge = document.createElement("span");
    badge.style.cssText =
      `display:inline-flex;align-items:center;gap:5px;padding:2px 4px;` +
      `font-size:11px;font-weight:700;color:${badgeStyle.color};` +
      `flex-shrink:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`;
    const dot = document.createElement("span");
    dot.style.cssText =
      `width:5px;height:5px;border-radius:50%;background:${badgeStyle.color};display:inline-block;flex-shrink:0`;
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(value));
    wrap.appendChild(badge);
  } else if (value) {
    const text = document.createElement("span");
    text.style.cssText =
      "font-size:12px;color:#1A1714;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0";
    text.textContent = value;
    wrap.appendChild(text);
  } else {
    const ph = document.createElement("span");
    ph.style.cssText = "font-size:12px;color:#C9C4BB;flex:1";
    ph.textContent = placeholder;
    wrap.appendChild(ph);
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "10");
  svg.setAttribute("height", "10");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "#B0A9A4");
  svg.setAttribute("stroke-width", "2.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.style.cssText = "flex-shrink:0";
  const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  poly.setAttribute("points", "6 9 12 15 18 9");
  svg.appendChild(poly);
  wrap.appendChild(svg);

  TD.appendChild(wrap);
}

function statusCellRenderer(_hot: any, TD: HTMLElement, _row: number, _col: number, _prop: any, value: string, cellProperties: any) {
  renderDropdownTd(TD, value, STATUS_STYLES[value] ?? null, "選択", cellProperties?.className);
}

function priorityCellRenderer(_hot: any, TD: HTMLElement, _row: number, _col: number, _prop: any, value: string, cellProperties: any) {
  renderDropdownTd(TD, value, PRIORITY_STYLES[value] ?? null, "選択", cellProperties?.className);
}

function assigneeCellRenderer(_hot: any, TD: HTMLElement, _row: number, _col: number, _prop: any, value: string, cellProperties: any) {
  renderDropdownTd(TD, value, null, "担当者なし", cellProperties?.className);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RowData {
  title: string; status: string; priority: string; assignee: string;
  startDate: string; dueDate: string; estimatedHours: number | null; description: string;
}

type OverlayState = {
  col: 1 | 2 | 3;
  row: number;
  rect: { top: number; left: number; width: number; bottom: number };
} | null;

const FIELD_BY_COL = { 1: "status", 2: "priority", 3: "assignee" } as const;

function makeEmptyRow(defaultAssignee: string = ""): RowData {
  return { title: "", status: "未着手", priority: "中", assignee: defaultAssignee, startDate: "", dueDate: "", estimatedHours: null, description: "" };
}

// ── Columns (static — no longer depends on member source) ────────────────────

const DATE_PICKER_I18N = {
  previousMonth: "前月",
  nextMonth:     "翌月",
  months:        ["1月","2月","3月","4月","5月","6月","7月","8月","9月","10月","11月","12月"],
  weekdays:      ["日曜","月曜","火曜","水曜","木曜","金曜","土曜"],
  weekdaysShort: ["日","月","火","水","木","金","土"],
};

const DATE_COL_CFG = {
  type: "date" as const,
  dateFormat: "YYYY/MM/DD",
  correctFormat: true,
  allowInvalid: true,
  datePickerConfig: { i18n: DATE_PICKER_I18N, firstDay: 0 },
};

const COLUMNS = [
  { data: "title",          type: "text"    as const },
  { data: "status",         type: "text"    as const, renderer: statusCellRenderer },
  { data: "priority",       type: "text"    as const, renderer: priorityCellRenderer },
  { data: "assignee",       type: "text"    as const, renderer: assigneeCellRenderer },
  { data: "startDate",      ...DATE_COL_CFG },
  { data: "dueDate",        ...DATE_COL_CFG },
  { data: "estimatedHours", type: "numeric" as const, allowInvalid: true },
  { data: "description",    type: "text"    as const },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDbDate(d: string | null | undefined): string | null {
  if (!d?.trim()) return null;
  const n = d.trim().replace(/\//g, "-");
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(n)) return null;
  const [y, m, day] = n.split("-");
  return `${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Convert plain-text description (with \n) to TipTap-compatible HTML.
// Double newlines → paragraph break; single newlines → <br>.
function textToHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, "<br>")}</p>`).join("");
}

function validateRows(rows: RowData[]): { errors: string[]; errorCells: Set<string> } {
  const errors: string[] = [];
  const errorCells = new Set<string>();
  // Every row is validated, including untouched spare rows — only rows actually filled in
  // get registered, but the grid must not silently let a blank title sit there unflagged.
  rows.forEach((row, idx) => {
    const rowNum = idx + 1;

    if (!(row.title ?? "").trim()) {
      errors.push(`${rowNum}行目: タイトルが未入力です`);
      errorCells.add(`${idx}_0`);
    }
    if (!row.status) {
      errors.push(`${rowNum}行目: ステータスが未選択です`);
      errorCells.add(`${idx}_1`);
    }
    if (!row.priority) {
      errors.push(`${rowNum}行目: 優先度が未選択です`);
      errorCells.add(`${idx}_2`);
    }
    if (!row.assignee) {
      errors.push(`${rowNum}行目: 担当者が未選択です`);
      errorCells.add(`${idx}_3`);
    }
    if (row.startDate && row.dueDate) {
      const s = toDbDate(row.startDate);
      const d = toDbDate(row.dueDate);
      if (s && d && d < s) {
        errors.push(`${rowNum}行目: 期限日が開始日より前です`);
        errorCells.add(`${idx}_4`);
        errorCells.add(`${idx}_5`);
      }
    }
  });
  return { errors, errorCells };
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const HOT_CSS = `
.bulk-hot-wrap .hot-display-license-info { display: none !important; }

.bulk-hot-wrap .htCore td.cell-validation-error {
  background-color: #FFF7ED !important;
  box-shadow: inset 0 0 0 1px #F4D9B0 !important;
}

.handsontableInput,
.handsontableInputHolder textarea,
.htAreaInput {
  ime-mode: auto !important;
  -ms-ime-mode: auto !important;
}

.bulk-hot-wrap .handsontable,
.bulk-hot-wrap .htCore td,
.bulk-hot-wrap .htCore th {
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Yu Gothic UI', system-ui, sans-serif;
  font-size: 12px; color: #1A1714; box-sizing: border-box;
}

.bulk-hot-wrap .htCore tbody td {
  padding: 0 9px; height: 32px; line-height: 32px;
  border-right: 1px solid rgba(26,23,20,0.07) !important;
  border-bottom: 1px solid rgba(26,23,20,0.07) !important;
  background: #FFFFFF; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.bulk-hot-wrap .htCore thead th,
.bulk-hot-wrap .ht_clone_top .htCore thead th {
  background: #F4F5F6 !important; color: #6B6458 !important;
  font-size: 11px !important; font-weight: 700 !important;
  padding: 0 9px !important; height: 34px !important; line-height: 34px !important;
  border-right: 1px solid rgba(26,23,20,0.08) !important;
  border-bottom: 2px solid rgba(26,23,20,0.10) !important;
  text-align: left !important; letter-spacing: 0.03em !important;
}

.bulk-hot-wrap .htCore tbody th,
.bulk-hot-wrap .ht_clone_left .htCore tbody th {
  background: #FAFAF8 !important; color: #C9C4BB !important;
  font-size: 10px !important; font-weight: 500 !important;
  text-align: center !important; padding: 0 !important;
  height: 32px !important; line-height: 32px !important;
  border-right: 1px solid rgba(26,23,20,0.08) !important;
  border-bottom: 1px solid rgba(26,23,20,0.07) !important; min-width: 36px !important;
}

.bulk-hot-wrap .ht_clone_top_left_corner .htCore th {
  background: #F4F5F6 !important; border-bottom: 2px solid rgba(26,23,20,0.10) !important;
}

.bulk-hot-wrap .htCore tbody td.current  { background: rgba(5,150,105,0.06) !important; }
.bulk-hot-wrap .htCore tbody td.area     { background: rgba(5,150,105,0.04) !important; }
.bulk-hot-wrap .htCore thead th.selected { background: #ECFDF5 !important; color: #059669 !important; }
.bulk-hot-wrap .htCore tbody th.selected { background: #ECFDF5 !important; color: #059669 !important; }

.bulk-hot-wrap .handsontable .wtBorder.current { background: #059669 !important; }
.bulk-hot-wrap .handsontable .wtBorder.area    { background: rgba(5,150,105,0.55) !important; }
.bulk-hot-wrap .handsontable .wtBorder.fill    { background: #059669 !important; }

.bulk-hot-wrap .htCore td.htInvalid { background: #FFFFFF !important; color: #1A1714 !important; outline: none !important; }

/* Context menu */
.htContextMenu .wtHolder {
  background: #FFFFFF !important; border: 1px solid rgba(26,23,20,0.10) !important;
  border-radius: 10px !important; overflow: hidden !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06) !important;
  padding: 4px 0 !important; min-width: 164px !important;
}
.htContextMenu table.htCore { border: none !important; box-shadow: none !important; }
.htContextMenu table.htCore td {
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', system-ui, sans-serif !important;
  font-size: 12px !important; font-weight: 500 !important; color: #1A1714 !important;
  padding: 7px 16px !important; border: none !important; border-top: none !important;
  border-bottom: none !important; background: transparent !important;
  cursor: pointer !important; white-space: nowrap !important;
}
.htContextMenu table.htCore td.htDisabled { color: #C9C4BB !important; cursor: not-allowed !important; }
.htContextMenu table.htCore td:not(.htDisabled):not(.htSeparator):hover,
.htContextMenu table.htCore td.current:not(.htSeparator) { background: #F0FDF4 !important; color: #059669 !important; }
.htContextMenu table.htCore td.htSeparator { height: 1px !important; padding: 0 12px !important; cursor: default !important; background: transparent !important; }
.htContextMenu table.htCore td.htSeparator > div { height: 1px !important; background: rgba(26,23,20,0.07) !important; }

/* Pikaday */
.pika-single {
  font-family: -apple-system, BlinkMacSystemFont, 'Hiragino Sans', system-ui, sans-serif !important;
  border: 1px solid rgba(26,23,20,0.10) !important; border-radius: 12px !important;
  box-shadow: 0 8px 32px rgba(0,0,0,0.14) !important; color: #1A1714 !important; padding: 10px !important;
}
.pika-single .pika-title { font-weight: 700 !important; color: #1A1714 !important; }
.pika-single .pika-prev, .pika-single .pika-next { color: #6B6458 !important; }
.pika-single .pika-table th { color: #9E9690 !important; font-size: 10px !important; font-weight: 700 !important; letter-spacing: 0.06em !important; }
.pika-single .pika-table td .pika-button { border-radius: 7px !important; color: #1A1714 !important; font-size: 12px !important; }
.pika-single .pika-table td .pika-button:hover { background: #F0FDF4 !important; color: #059669 !important; }
.pika-single .pika-table td.is-today .pika-button { color: #059669 !important; font-weight: 700 !important; }
.pika-single .pika-table td.is-selected .pika-button {
  background: #059669 !important; color: white !important;
  box-shadow: 0 2px 6px rgba(5,150,105,0.3) !important;
}
`;

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkTicketCreateDialog({
  sprintId, sprintName, projectId, projectSlug,
  sprintStartDate: _spStart, sprintEndDate: _spEnd,
  onClose, onCreated,
}: {
  sprintId: string; sprintName?: string; projectId?: string; projectSlug?: string;
  sprintStartDate?: string; sprintEndDate?: string;
  onClose: () => void; onCreated: () => void;
}) {
  const { userName } = useAuth();
  const hotRef = useRef<InstanceType<typeof HotTable>>(null);
  const lastSelRef = useRef<number[][] | null>(null);
  const mouseDownCoordsRef = useRef<{ row: number; col: number } | null>(null);
  const tableData = useRef<RowData[]>(
    Array.from({ length: INITIAL_ROW_COUNT }, () => makeEmptyRow(userName || "")),
  );
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const hasErrors = validationErrors.length > 0 || !!error;
  // tableHeight shrinks when error strip is visible (76px for strip + separator)
  const tableHeight = useMemo(
    () => Math.max(200, Math.floor(window.innerHeight * 0.9) - 176 - (hasErrors ? 76 : 0)),
    [hasErrors],
  );

  // Date picker guard
  const pickerActiveRef = useRef(false);
  // Escape guard: true while a cell editor is open (delayed false via rAF in handleEditorClosed)
  const editorActiveRef = useRef(false);
  // Cleanup fn for date-cell character restriction listener
  const dateRestrictCleanupRef = useRef<(() => void) | null>(null);

  // Overlay for dropdown cells (col 1=status, 2=priority, 3=assignee)
  const [cellOverlay, setCellOverlay] = useState<OverlayState>(null);
  const cellOverlayRef = useRef<OverlayState>(null);
  const overlayPanelRef = useRef<HTMLDivElement>(null);
  const suppressOverlayCloseRef = useRef(false);

  useEffect(() => { cellOverlayRef.current = cellOverlay; }, [cellOverlay]);

  useEffect(() => {
    const fn = () => {
      setCellOverlay(null);
      if (!editorActiveRef.current && cellOverlayRef.current === null) onClose();
    };
    escStack.push(fn);
    return () => escStack.pop(fn);
  }, [onClose]);

  // Capturing listener: ← → in date cells → stop Pikaday/HOT, let browser move the text cursor
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      const sel = hot.getSelected();
      if (!sel?.length) return;
      const col = sel[0][1];
      if (col !== 4 && col !== 5) return;
      const editor = hot.getActiveEditor() as any;
      if (!editor?.isOpened?.()) return;
      e.stopImmediatePropagation();
    };
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, []);

  // Close overlay when clicking outside.
  // Deferred with setTimeout so context-menu item click fires BEFORE React re-renders.
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (suppressOverlayCloseRef.current) return;
      if (!cellOverlayRef.current) return;
      if (overlayPanelRef.current?.contains(e.target as Node)) return;
      setTimeout(() => setCellOverlay(null), 0);
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Load project members
  useEffect(() => {
    if (!isSupabaseEnabled) {
      const project = PROJECTS.find(p => p.id === projectId);
      const names: string[] = project?.members ?? MEMBERS.map(m => m.name);
      setMemberNames(names);
      return;
    }
    if (!projectId) return;
    supabase!.from("projects").select("members").eq("id", projectId).maybeSingle()
      .then(({ data }) => {
        const names: string[] = Array.isArray(data?.members) ? data.members : [];
        setMemberNames(names);
      });
  }, [projectId]);


  // ── Validation ──────────────────────────────────────────────────────────────

  // Cells flagged by the last validation run, read live by `cellsFn` below.
  // NOTE: writing the highlight via hot.setCellMeta() was tried and reverted — the
  // @handsontable/react wrapper's componentDidUpdate calls updateSettings(...) unconditionally
  // on *every* parent re-render (no prop diffing), and since `columns` is always part of that
  // settings object, Handsontable's updateSettings sees `settings.columns !== undefined` and
  // calls metaManager.clearCache() — wiping any per-cell meta set via setCellMeta moments
  // earlier. Since setValidationErrors() (called right below) triggers exactly that parent
  // re-render, the highlight was being cleared almost immediately after being applied.
  // The `cells` callback below is immune to this: it's a plain function reference stored in
  // settings, not cached per-cell state, so clearCache() just makes Handsontable call it again
  // — which it does, via the forced full re-render updateSettings performs right after — and it
  // reads errorCellsRef fresh each time.
  const errorCellsRef = useRef<Set<string>>(new Set());

  const runValidation = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    const data: RowData[] = hot ? (hot.getSourceData() as RowData[]) : tableData.current;
    const { errors, errorCells } = validateRows(data);
    errorCellsRef.current = errorCells;
    setValidationErrors(errors);
    hot?.render();
  }, []);

  const cellsFn = useCallback((row: number, col: number) => {
    const cellProperties: { className?: string } = {};
    if (col <= 5 && errorCellsRef.current.has(`${row}_${col}`)) {
      cellProperties.className = "cell-validation-error";
    }
    return cellProperties;
  }, []);

  // Run once on mount so an empty/invalid grid is flagged immediately, without waiting for
  // the user to make a change first.
  useEffect(() => { runValidation(); }, [runValidation]);

  // Block only programmatic internal updates — allow all user-initiated changes
  const afterChange = useCallback((_changes: any, source: string) => {
    if (source === "loadData" || source === "updateData") return;
    runValidation();
  }, [runValidation]);

  // ── Overlay helpers ─────────────────────────────────────────────────────────

  const openOverlay = useCallback((row: number, col: number) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const cellTd = hot.getCell(row, col);
    if (!cellTd) return;
    const rect = cellTd.getBoundingClientRect();
    // Force a single-cell selection: the mousedown->mouseup cycle that leads here can leave a
    // stray multi-cell range selected (native drag-select tracking reacting to the layout shift
    // when the overlay popup mounts), which then renders as a phantom drag/autofill highlight.
    hot.selectCell(row, col);
    suppressOverlayCloseRef.current = true;
    requestAnimationFrame(() => { suppressOverlayCloseRef.current = false; });
    setCellOverlay({ col: col as 1 | 2 | 3, row, rect: { top: rect.top, left: rect.left, width: rect.width, bottom: rect.bottom } });
  }, []);

  const handleOverlaySelect = useCallback((value: string) => {
    const overlay = cellOverlayRef.current;
    if (!overlay) return;
    const hot = hotRef.current?.hotInstance;
    if (hot) hot.setDataAtCell(overlay.row, overlay.col, value);
    setCellOverlay(null);
    // setDataAtCell triggers afterChange, but call directly as safety
    setTimeout(runValidation, 0);
  }, [runValidation]);

  const getOverlayOptions = useCallback((col: 1 | 2 | 3) => {
    if (col === 1) return STATUS_LABELS.map(label => ({ value: label, label, style: STATUS_STYLES[label] ?? null }));
    if (col === 2) return PRIORITY_LABELS.map(label => ({ value: label, label, style: PRIORITY_STYLES[label] ?? null }));
    return [
      { value: "", label: "", style: null },
      ...memberNames.map(n => ({ value: n, label: n, style: null })),
    ];
  }, [memberNames]);

  // ── Row operations ──────────────────────────────────────────────────────────

  const handleAddRow = () => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    hot.alter("insert_row_below", hot.countRows() - 1, 1);
  };

  // Newly inserted rows (via "1行追加" button or context-menu row insert) default to
  // status=未着手, priority=中, assignee=自分 — same as the initial set of rows.
  const afterCreateRow = useCallback((index: number, amount: number) => {
    // afterCreateRow fires mid-way through hot.alter(), while HOT is still busy inserting the
    // row — setDataAtRowProp's own afterChange/render (and the row's initial validation/
    // highlighting) can get swallowed by that in-progress operation, so defer the whole thing
    // (defaulting included) until the call stack (and alter()) has fully unwound.
    setTimeout(() => {
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      // A freshly inserted row only has the props actually written to it — Handsontable does
      // not back-fill it with makeEmptyRow's shape — so every RowData field needs an explicit
      // default here, not just the three "visible default" ones, otherwise validateRows'
      // (row.title ?? "") guard aside, other code reading these fields as plain strings would break.
      const changes: [number, string, any][] = [];
      for (let i = 0; i < amount; i++) {
        const r = index + i;
        changes.push(
          [r, "title", ""], [r, "status", "未着手"], [r, "priority", "中"], [r, "assignee", userName || ""],
          [r, "startDate", ""], [r, "dueDate", ""], [r, "estimatedHours", null], [r, "description", ""],
        );
      }
      hot.setDataAtRowProp(changes as any);
      runValidation();
    }, 0);
  }, [userName, runValidation]);

  // Row removal (context menu / Ctrl+D undo etc.) shifts every row index below the removed
  // one — validationErrors/cell highlighting must be recomputed against the new layout, and
  // (like afterCreateRow) this hook fires mid-alter(), so defer to let it finish first.
  const afterRemoveRow = useCallback(() => {
    setTimeout(runValidation, 0);
  }, [runValidation]);

  // ── Date picker helpers ─────────────────────────────────────────────────────

  const showPickerSafe = useCallback((editor: any) => {
    if (pickerActiveRef.current) return;
    if (editor?.datePickerStyle?.display === "block") return;
    if (typeof editor?.showDatepicker !== "function") return;
    pickerActiveRef.current = true;
    editor.showDatepicker(null);
  }, []);

  // ── Handsontable hooks ──────────────────────────────────────────────────────

  // Prevent HOT's native editor from opening for dropdown cols
  const beforeBeginEditing = useCallback((row: number, col: number): boolean | void => {
    if (col === 1 || col === 2 || col === 3) {
      openOverlay(row, col);
      return false;
    }
  }, [openOverlay]);

  // afterBeginEditing: date picker + safety net for dropdown cols
  const afterBeginEditing = useCallback((_row: number, col: number) => {
    // Mark editor as active immediately (before rAF) so Escape guard works
    editorActiveRef.current = true;

    requestAnimationFrame(() => {
      const textarea = document.querySelector(".handsontableInput") as HTMLTextAreaElement | null;
      if (textarea) textarea.setAttribute("inputmode", "text");

      if (col === 1 || col === 2 || col === 3) {
        const hot = hotRef.current?.hotInstance;
        (hot?.getActiveEditor() as any)?.close?.();
        return;
      }

      if (col === 4 || col === 5) {
        const hot = hotRef.current?.hotInstance;
        if (!hot) return;
        const editor = hot.getActiveEditor() as any;
        showPickerSafe(editor);

        // Attach character restriction directly to the textarea element.
        // This is the most reliable place: fires at target phase, before HOT/Pikaday.
        const ta: HTMLTextAreaElement | undefined = editor?.TEXTAREA;
        if (ta) {
          const restrictFn = (e: KeyboardEvent) => {
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && !/^[0-9/]$/.test(e.key)) {
              e.preventDefault();
            }
          };
          ta.addEventListener("keydown", restrictFn);
          dateRestrictCleanupRef.current = () => ta.removeEventListener("keydown", restrictFn);
        }
      }
    });
  }, [showPickerSafe]);

  // Handsontable has no real "after editing ends" hook — "afterEndEditing" doesn't exist
  // (confirmed empty match against the bundled source), so a prop with that name is silently
  // ignored. This runs instead from afterSelectionEnd/afterDeselect (which fire once HOT has
  // already committed the pending edit and moved/cleared selection) and from the Escape-cancel
  // branch in beforeKeyDown (which doesn't change selection, so the other two never fire for it).
  const handleEditorClosed = useCallback(() => {
    pickerActiveRef.current = false;
    dateRestrictCleanupRef.current?.();
    dateRestrictCleanupRef.current = null;
    runValidation();
    // Delay the flag reset: modal's onKeyDown fires in the same tick as HOT closing the editor,
    // so the flag must still be true when modal checks it.
    requestAnimationFrame(() => { editorActiveRef.current = false; });
  }, [runValidation]);

  const afterGetColHeader = useCallback((col: number, TH: HTMLElement) => {
    if (col === 0) {
      const span = TH.querySelector(".colHeader");
      if (span) (span as HTMLElement).style.color = "#DC2626";
    }
  }, []);

  const afterSelectionEnd = useCallback((r: number, c: number, r2: number, c2: number) => {
    // Selection only changes after HOT has already committed (or cancelled) any pending edit
    // on the previously selected cell, so this is a reliable point to run the editor-closed
    // cleanup/re-validation regardless of which key/mouse action ended the edit.
    handleEditorClosed();
    // Remember the selection even after it's released (cell deselected / focus moved away),
    // so Ctrl+V / Ctrl+X still have a target to paste/cut into.
    lastSelRef.current = [[r, c, r2, c2]];
  }, [handleEditorClosed]);

  // Full grid blur (e.g. clicking the footer's 登録する/キャンセル buttons directly while a
  // cell is still selected, without first selecting another HOT cell) doesn't fire
  // afterSelectionEnd, so this catches that path too.
  const afterDeselect = useCallback(() => {
    handleEditorClosed();
  }, [handleEditorClosed]);

  // Copy/Cut/Paste while the editor is pre-opened (text cols 0/7): HOT's CopyPaste plugin
  // returns early when isEditorOpened()=true, so we intercept the native clipboard events
  // directly at document level (capture phase — required because the dialog renders via a
  // portal, so events never pass through div#root where React's synthetic handlers listen).
  // clipboardData.setData/getData is synchronous and needs no permission, unlike
  // navigator.clipboard, so this works reliably without timing/permission issues.
  useEffect(() => {
    const buildTsv = (hot: any, sel: number[][]) => {
      const [r1, c1, r2, c2] = sel[0];
      const minR = Math.min(r1, r2), maxR = Math.max(r1, r2);
      const minC = Math.min(c1, c2), maxC = Math.max(c1, c2);
      const rows: string[] = [];
      for (let r = minR; r <= maxR; r++) {
        const cells: string[] = [];
        for (let col = minC; col <= maxC; col++) {
          cells.push(String(hot.getSourceDataAtCell(r, col) ?? ""));
        }
        rows.push(cells.join("\t"));
      }
      return rows.join("\n");
    };

    // If the user has selected a partial range of text inside the cell's textarea (cursor
    // drag-select), let the browser's native copy/cut/paste act on just that text instead of
    // us seizing the whole cell.
    const hasPartialTextSelection = (editor: any) => {
      const ta: HTMLTextAreaElement | undefined = editor?.TEXTAREA;
      return !!ta && document.activeElement === ta && ta.selectionStart !== ta.selectionEnd;
    };

    const handleCopy = (e: ClipboardEvent) => {
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      const editor = hot.getActiveEditor() as any;
      if (editor?.isOpened?.() && hasPartialTextSelection(editor)) return;
      const sel = hot.getSelected() ?? lastSelRef.current;
      if (!sel?.length) return;
      e.clipboardData?.setData("text/plain", buildTsv(hot, sel));
      e.preventDefault();
      e.stopImmediatePropagation();
    };

    const handleCut = (e: ClipboardEvent) => {
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      const editor = hot.getActiveEditor() as any;
      if (editor?.isOpened?.() && hasPartialTextSelection(editor)) return;
      const sel = hot.getSelected() ?? lastSelRef.current;
      if (!sel?.length) return;
      e.clipboardData?.setData("text/plain", buildTsv(hot, sel));
      e.preventDefault();
      e.stopImmediatePropagation();
      const [r1, c1, r2, c2] = sel[0];
      const changes: [number, number, string][] = [];
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
        for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) changes.push([r, col, ""]);
      }
      if (editor?.isOpened?.()) { editor.finishEditing(false); }
      hot.setDataAtCell(changes as any);
    };

    const handlePaste = (e: ClipboardEvent) => {
      const hot = hotRef.current?.hotInstance;
      if (!hot) return;
      const editor = hot.getActiveEditor() as any;
      if (editor?.isOpened?.() && hasPartialTextSelection(editor)) return;
      const sel = hot.getSelected() ?? lastSelRef.current;
      if (!sel?.length) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const [r1, c1, r2, c2] = sel[0];
      const startRow = Math.min(r1, r2);
      const startCol = Math.min(c1, c2);
      const destRowCount = Math.abs(r2 - r1) + 1;
      const destColCount = Math.abs(c2 - c1) + 1;
      // Only strip a single trailing newline (from the split), never trimEnd() — that would eat
      // trailing tab characters too, silently dropping blank trailing columns (e.g. 開始日~詳細
      // when only タイトル has a value) from the copied row before the fill below ever sees them.
      const pasteRows = text.replace(/\r?\n$/, "").split(/\r?\n/).map(line => line.split("\t"));
      const srcRowCount = pasteRows.length;
      // Excel-like fill: if the destination selection is larger than the clipboard content,
      // repeat the clipboard content to cover the whole selected range.
      const fillRowCount = Math.max(destRowCount, srcRowCount);
      const fillColCount = Math.max(destColCount, Math.max(...pasteRows.map(cols => cols.length)));
      const changes: [number, number, any][] = [];
      for (let ri = 0; ri < fillRowCount; ri++) {
        const srcCols = pasteRows[ri % srcRowCount];
        for (let ci = 0; ci < fillColCount; ci++) {
          changes.push([startRow + ri, startCol + ci, srcCols[ci % srcCols.length]]);
        }
      }
      if (editor?.isOpened?.()) { editor.finishEditing(false); }
      if (changes.length > 0) hot.setDataAtCell(changes as any);
    };

    document.addEventListener("copy", handleCopy, true);
    document.addEventListener("cut", handleCut, true);
    document.addEventListener("paste", handlePaste, true);
    return () => {
      document.removeEventListener("copy", handleCopy, true);
      document.removeEventListener("cut", handleCut, true);
      document.removeEventListener("paste", handlePaste, true);
    };
  }, []);

  // Keyboard: open overlay on Enter/Space for dropdown cols; restrict date cols
  const beforeKeyDown = useCallback((event: KeyboardEvent) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const selected = hot.getSelected();
    if (!selected?.length) return;
    const [row, c] = selected[0];

    // Delete: always clear selected cells (Excel-like — overrides partial-edit-mode too)
    // Backspace on dropdown cols (no editor): clear cell
    const isDropdownCol = (c === 1 || c === 2 || c === 3);
    const editor = hot.getActiveEditor() as any;

    if (event.key === "Delete" || (event.key === "Backspace" && isDropdownCol)) {
      event.stopImmediatePropagation();
      event.preventDefault();
      if (editor?.isOpened?.()) { editor.close(); }
      const allSelected = hot.getSelected() ?? [];
      const changes: [number, number, string][] = [];
      allSelected.forEach(([r1, c1, r2, c2]) => {
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
          for (let col = Math.min(c1, c2); col <= Math.max(c1, c2); col++) {
            changes.push([r, col, ""]);
          }
        }
      });
      if (changes.length > 0) hot.setDataAtCell(changes as any);
      setCellOverlay(null);
      return;
    }

    // Ctrl+D / Cmd+D: fill down (Excel-like)
    // Single-row selection → copy from the row above; multi-row → copy top row downward.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.stopImmediatePropagation();
      event.preventDefault();
      const allSel = hot.getSelected() ?? [];
      if (editor?.isOpened?.()) editor.finishEditing(false);
      const changes: [number, number, any][] = [];
      allSel.forEach(([r1, c1, r2, c2]: [number, number, number, number]) => {
        const minRow = Math.min(r1, r2), maxRow = Math.max(r1, r2);
        const minCol = Math.min(c1, c2), maxCol = Math.max(c1, c2);
        if (minRow === maxRow) {
          if (minRow === 0) return;
          for (let col = minCol; col <= maxCol; col++) {
            changes.push([minRow, col, hot.getSourceDataAtCell(minRow - 1, col)]);
          }
        } else {
          for (let col = minCol; col <= maxCol; col++) {
            const src = hot.getSourceDataAtCell(minRow, col);
            for (let r = minRow + 1; r <= maxRow; r++) changes.push([r, col, src]);
          }
        }
      });
      if (changes.length > 0) hot.setDataAtCell(changes as any);
      return;
    }

    if (c === 1 || c === 2 || c === 3) {
      if (event.key === "Escape") {
        event.stopImmediatePropagation();
        event.preventDefault();
        setCellOverlay(null);
        return;
      }
      if (event.key === "Enter" || event.key === " " || event.key === "F2") {
        event.stopImmediatePropagation();
        event.preventDefault();
        openOverlay(row, c);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Tab") {
        setCellOverlay(null);
        return;
      }
      if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
      return;
    }

    if (!editor?.isOpened?.()) return;

    // Escape: block afterSelectionEnd from re-opening the editor after HOT closes it.
    // Escape cancels the edit without changing selection, so afterSelectionEnd/afterDeselect
    // never fire for this case — run the editor-closed cleanup directly here instead.
    if (event.key === "Escape" && (c === 0 || c === 7)) {
      handleEditorClosed();
    }

    if (event.ctrlKey || event.metaKey) return;

    // タイトル(0)・詳細(7): 編集中は ←→ でセルを移動しない（テキストカーソル移動）
    if (c === 0 || c === 7) {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopImmediatePropagation();
        return;
      }
      // 詳細(7): ↑↓ もセル移動しない（複数行テキスト）。Enter で改行挿入。
      if (c === 7) {
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.stopImmediatePropagation();
          return;
        }
        if (event.key === "Enter") {
          event.stopImmediatePropagation();
          event.preventDefault();
          const ta = editor.TEXTAREA as HTMLTextAreaElement;
          if (ta) {
            const start = ta.selectionStart ?? ta.value.length;
            const end = ta.selectionEnd ?? ta.value.length;
            ta.value = ta.value.slice(0, start) + "\n" + ta.value.slice(end);
            ta.setSelectionRange(start + 1, start + 1);
            ta.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return;
        }
      }
    }

    if (c === 4 || c === 5) {
      const isPickerVisible = editor?.datePickerStyle?.display === "block";

      // ← → は常にテキストカーソル移動に委ねる（ピッカー表示中かどうかに関わらず）
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.stopImmediatePropagation();
        return;
      }

      // ↑ ↓ Tab: ピッカー表示中はピッカーを閉じてセル移動
      if (isPickerVisible && ["ArrowUp", "ArrowDown", "Tab"].includes(event.key)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        editor.finishEditing(false);
        pickerActiveRef.current = false;
        const sel = hot.getSelected()?.[0];
        if (sel) {
          const [r, col2] = sel;
          let nextRow = r, nextCol = col2;
          if (event.key === "ArrowUp") nextRow--;
          else if (event.key === "ArrowDown") nextRow++;
          else if (event.key === "Tab") nextCol += event.shiftKey ? -1 : 1;
          setTimeout(() => hot.selectCell(Math.max(0, nextRow), Math.max(0, nextCol)), 0);
        }
        return;
      }

      // Allow digits, '/', and all navigation keys; block everything else
      const isNavKey = event.key.length > 1;
      const isAllowedChar = /^[0-9/]$/.test(event.key);
      if (!isNavKey && !isAllowedChar) {
        event.stopImmediatePropagation();
        event.preventDefault();
      }
    }
  }, [openOverlay, handleEditorClosed]);

  // Mousedown: close any open overlay and remember where the click started (so mouseup can
  // tell a plain click apart from a drag-to-select).
  const afterOnCellMouseDown = useCallback((_event: MouseEvent, coords: { row: number; col: number }) => {
    if (coords.row < 0) return;
    mouseDownCoordsRef.current = { row: coords.row, col: coords.col };
    setCellOverlay(null);
  }, []);

  // Mouseup on a dropdown col (status/priority/assignee): open the overlay immediately if this
  // was a plain click (mouseup lands on the same cell as mousedown) rather than a drag-select,
  // so the dropdown opens on the first click instead of requiring a second click to "begin
  // editing" an already-selected cell. Drag-selects (mouseup on a different cell) still work
  // normally for multi-cell selection / batch context-menu operations.
  const afterOnCellMouseUp = useCallback((event: MouseEvent, coords: { row: number; col: number }) => {
    if (coords.row < 0) return;
    if (event.shiftKey || event.ctrlKey || event.metaKey) return; // range-extend clicks shouldn't pop the dropdown
    const down = mouseDownCoordsRef.current;
    if (down && down.row === coords.row && down.col === coords.col && (coords.col === 1 || coords.col === 2 || coords.col === 3)) {
      openOverlay(coords.row, coords.col);
    }
  }, [openOverlay]);

  // ── Context menu (memoized — stable ref prevents HotTable from calling updateSettings on every render) ──

  const contextMenu = useMemo(() => ({
    items: {
      custom_row_above: {
        name(this: void) {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          const sel = hot?.getSelected?.();
          if (!sel?.length) return "上に行を挿入";
          const count = Math.abs(sel[0][2] - sel[0][0]) + 1;
          return count > 1 ? `${count}行を上に挿入` : "上に行を挿入";
        },
        callback() {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          if (!hot) return;
          const sel = hot.getSelected?.();
          if (!sel?.length) return;
          const [r1, , r2] = sel[0];
          (hot.getActiveEditor?.() as any)?.finishEditing?.();
          hot.alter("insert_row_above", Math.min(r1, r2), Math.abs(r2 - r1) + 1);
        },
      },
      custom_row_below: {
        name(this: void) {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          const sel = hot?.getSelected?.();
          if (!sel?.length) return "下に行を挿入";
          const count = Math.abs(sel[0][2] - sel[0][0]) + 1;
          return count > 1 ? `${count}行を下に挿入` : "下に行を挿入";
        },
        callback() {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          if (!hot) return;
          const sel = hot.getSelected?.();
          if (!sel?.length) return;
          const [r1, , r2] = sel[0];
          (hot.getActiveEditor?.() as any)?.finishEditing?.();
          hot.alter("insert_row_below", Math.max(r1, r2), Math.abs(r2 - r1) + 1);
        },
      },
      custom_remove_row: {
        name(this: void) {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          const sel = hot?.getSelected?.();
          if (!sel?.length) return "行を削除";
          const count = Math.abs(sel[0][2] - sel[0][0]) + 1;
          return count > 1 ? `${count}行を削除` : "行を削除";
        },
        callback() {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          if (!hot) return;
          const sel = hot.getSelected?.();
          if (!sel?.length) return;
          const [r1, , r2] = sel[0];
          (hot.getActiveEditor?.() as any)?.finishEditing?.();
          hot.alter("remove_row", Math.min(r1, r2), Math.abs(r2 - r1) + 1);
        },
      },
      hsep1: { name: "---------" },
      copy: { name: "コピー" },
      cut:  { name: "切り取り" },
      custom_paste: {
        name: "貼り付け",
        callback() {
          const hot = (hotRef as React.RefObject<any>).current?.hotInstance;
          if (!hot) return;
          navigator.clipboard.readText().then(text => {
            if (!text) return;
            const sel = hot.getSelected();
            if (!sel?.length) return;
            const startRow = Math.min(sel[0][0], sel[0][2]);
            const startCol = Math.min(sel[0][1], sel[0][3]);
            const pasteRows = text.trimEnd().split(/\r?\n/).map((line: string) => line.split("\t"));
            const changes: [number, number, any][] = [];
            pasteRows.forEach((cols: string[], ri: number) => {
              cols.forEach((val: string, ci: number) => {
                changes.push([startRow + ri, startCol + ci, val]);
              });
            });
            if (changes.length > 0) hot.setDataAtCell(changes);
          }).catch(() => {});
        },
      },
      hsep2: { name: "---------" },
      undo: { name: "元に戻す" },
      redo: { name: "やり直す" },
    },
  }), []); // callbacks access hotRef (stable ref) — no deps needed

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    // Commit any cell still being edited (e.g. user clicked 登録する directly without first
    // moving to another cell) so its value isn't silently dropped from the saved data.
    const activeEditor = hot.getActiveEditor() as any;
    if (activeEditor?.isOpened?.()) activeEditor.finishEditing(false);
    const rawData = hot.getSourceData() as RowData[];
    const validRows = rawData.filter(row => typeof row.title === "string" && row.title.trim() !== "");
    if (validRows.length === 0) {
      setError("タイトルが入力された行がありません");
      return;
    }
    setError(null);
    setSaving(true);

    if (isSupabaseEnabled && projectId) {
      const { data: sprintRows } = await supabase!.from("sprints").select("id, identifier").eq("project_id", projectId);
      const sprintIds = sprintRows?.map(s => s.id) ?? [];
      const identifier = sprintRows?.find(s => s.id === sprintId)?.identifier;
      const prefix = identifier || "T";
      let nextNum = 1;
      if (sprintIds.length > 0) {
        const { data: maxRow } = await supabase!
          .from("sprint_tickets").select("wbs")
          .in("sprint_id", sprintIds)
          .like("wbs", `${prefix}-%`)
          .not("wbs", "like", `${prefix}-%-_%`)
          .order("wbs", { ascending: false }).limit(1).maybeSingle();
        nextNum = (parseInt(maxRow?.wbs?.slice(prefix.length + 1) ?? "0", 10) || 0) + 1;
      }

      const inserts = validRows.map(row => {
        const wbs = `${prefix}-${String(nextNum++).padStart(3, "0")}`;
        const id = `TKT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const eh = typeof row.estimatedHours === "number" && !isNaN(row.estimatedHours)
          ? row.estimatedHours : 0;
        return {
          id, sprint_id: sprintId, wbs,
          title: row.title.trim(),
          status: STATUS_MAP[row.status] ?? "todo",
          priority: PRIORITY_MAP[row.priority] ?? "medium",
          assignee: row.assignee || null,
          start_date: toDbDate(row.startDate),
          due_date: toDbDate(row.dueDate),
          estimated_hours: eh, progress: getDefaultProgressForStatus(STATUS_MAP[row.status] ?? "todo"),
          description: row.description ? textToHtml(row.description) : null,
          created_by: userName || null,
          images: [], parent_id: null,
        };
      });

      await supabase!.from("sprint_tickets").insert(inserts);

      const notifyInserts = inserts
        .filter(t => t.assignee)
        .map(t => ({
          user_name: t.assignee!, type: "assign",
          title: "チケットが割り当てられました",
          body: `${t.wbs}: ${t.title}`,
          ticket_id: t.id, ticket_wbs: t.wbs, ticket_title: t.title,
          project_slug: projectSlug, is_read: false,
        }));
      if (notifyInserts.length > 0) {
        await supabase!.from("notifications").insert(notifyInserts);
      }
      emitLinkItemsChanged(projectId, "ticket"); // 他タブの # サジェストへ即時反映
    }

    setSaving(false);
    onCreated();
    onClose();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{HOT_CSS}</style>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(10,14,12,0.35)", backdropFilter: "blur(3px)" }} />

      <div
        onKeyDown={e => {
          if (e.key !== "Escape") return;
          setCellOverlay(null);
          // editorActiveRef.current is true while a cell editor is open (reset is delayed via rAF).
          // cellOverlayRef.current is non-null while a dropdown overlay is open.
          // In either case, do not close the modal.
          if (!editorActiveRef.current && cellOverlayRef.current === null) onClose();
        }}
        style={{
          position: "fixed", top: "5vh", left: "50%", transform: "translateX(-50%)",
          width: "min(96vw, 1160px)", height: "90vh",
          background: "#FAFAF8", zIndex: 301,
          borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 9, background: "#F0FDF4", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <TableProperties style={{ width: 16, height: 16, color: "#059669" }} />
            </div>
            <div>
              <p style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const }}>一括チケット登録</p>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
                {sprintName ?? "チケット一括作成"}
              </h2>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>

        {/* Info bar */}
        <div style={{ padding: "7px 24px", background: "#F8F9FA", borderBottom: "1px solid rgba(26,23,20,0.05)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 11, color: "#9E9690", margin: 0 }}>
              <strong style={{ color: "#6B6458" }}>タイトル</strong> を入力した行のみ登録。日付はダブルクリックでカレンダー表示。<strong style={{ color: "#6B6458" }}>Ctrl+D</strong> で上のセルをコピー。複数行選択→右クリックでまとめて操作
            </p>
            <p style={{ fontSize: 11, color: "#9E9690", margin: 0 }}>
              タイトル、開始日、期限日、見積工数、詳細のセルはダブルクリックで入力可能
            </p>
          </div>
          <button
            onClick={handleAddRow}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", fontSize: 11, fontWeight: 600, color: "#6B6458", background: "#ECEAE6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 6, cursor: "pointer", flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E0DDD8"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECEAE6"; }}
          >
            <Plus style={{ width: 11, height: 11 }} />1行追加
          </button>
        </div>

        {/* Table */}
        <div className="bulk-hot-wrap" style={{ flex: 1, overflow: "hidden", borderBottom: "1px solid rgba(26,23,20,0.07)" }}>
          <HotTable
            ref={hotRef}
            data={tableData.current}
            colHeaders={["タイトル *", "ステータス", "優先度", "担当者", "開始日", "期限日", "見積工数 (h)", "詳細"]}
            columns={COLUMNS}
            rowHeaders={true}
            stretchH="last"
            width="100%"
            height={tableHeight}
            colWidths={[210, 110, 80, 130, 120, 120, 88, 200]}
            // Native drag-to-fill (the little square handle at a selection's corner) is what was
            // producing the "drag-and-drop happened without dragging" artifact and the wrapped
            // values landing in unrelated columns (開始日/期限日/見積工数/詳細) after copy-paste —
            // its hotspot is easy to brush against on a 32px row. Ctrl+D (custom, below) already
            // covers the fill-down use case, so the native handle is pure redundant risk here.
            fillHandle={false}
            rowHeights={32}
            autoRowSize={false}
            imeFastEdit={true}
            licenseKey="non-commercial-and-evaluation"
            contextMenu={contextMenu}
            cells={cellsFn as any}
            autoWrapRow={true}
            autoWrapCol={true}
            manualColumnResize={true}
            afterSelectionEnd={afterSelectionEnd as any}
            beforeKeyDown={beforeKeyDown as any}
            beforeBeginEditing={beforeBeginEditing as any}
            afterBeginEditing={afterBeginEditing}
            afterDeselect={afterDeselect as any}
            afterChange={afterChange as any}
            afterOnCellMouseDown={afterOnCellMouseDown as any}
            afterOnCellMouseUp={afterOnCellMouseUp as any}
            afterCreateRow={afterCreateRow as any}
            afterRemoveRow={afterRemoveRow as any}
            afterGetColHeader={afterGetColHeader}
          />
        </div>

        {/* Error strip — fixed height so table area doesn't shrink when errors appear */}
        {(validationErrors.length > 0 || error) && (
          <div style={{
            flexShrink: 0, borderTop: "1px solid rgba(220,38,38,0.15)",
            background: "#FEF2F2", padding: "6px 24px",
            maxHeight: 64, overflowY: "auto",
            display: "flex", flexDirection: "column", gap: 3,
          }}>
            {validationErrors.map((msg, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircle style={{ width: 12, height: 12, color: "#DC2626", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600, whiteSpace: "nowrap" }}>{msg}</span>
              </div>
            ))}
            {error && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <AlertCircle style={{ width: 12, height: 12, color: "#DC2626", flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{error}</span>
              </div>
            )}
          </div>
        )}

        {/* Footer — buttons only, fixed height */}
        <div style={{ padding: "12px 24px", background: "#FFFFFF", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, borderTop: "1px solid rgba(26,23,20,0.07)" }}>
          <button
            onClick={onClose}
            style={{ padding: "8px 20px", fontSize: 13, fontWeight: 600, color: "#6B6458", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, cursor: "pointer" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECEAE6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
          >
            キャンセル
          </button>
          <button
            onClick={handleSave}
            disabled={saving || validationErrors.length > 0}
            style={{
              padding: "8px 24px", fontSize: 13, fontWeight: 700, color: "#FFF",
              background: (saving || validationErrors.length > 0) ? "#9CA3AF" : "#059669",
              border: "none", borderRadius: 9,
              cursor: (saving || validationErrors.length > 0) ? "not-allowed" : "pointer",
              boxShadow: (saving || validationErrors.length > 0) ? "none" : "0 2px 8px rgba(5,150,105,0.25)",
              transition: "background 0.15s",
            }}
            onMouseEnter={e => { if (!saving && !validationErrors.length) (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { if (!saving && !validationErrors.length) (e.currentTarget as HTMLElement).style.background = "#059669"; }}
          >
            {saving ? "登録中..." : "登録する"}
          </button>
        </div>
      </div>

      {/* Dropdown overlay — CustomSelect と同じスタイル */}
      {cellOverlay && createPortal(
        <div
          ref={overlayPanelRef}
          style={{
            position: "fixed",
            top: cellOverlay.rect.bottom + 2,
            left: cellOverlay.rect.left,
            minWidth: Math.max(cellOverlay.rect.width, 140),
            background: "#FFF",
            border: "1px solid rgba(26,23,20,0.12)",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            overflow: "hidden",
            zIndex: 9999,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {getOverlayOptions(cellOverlay.col).map(({ value, label, style }) => {
            const currentValue = tableData.current[cellOverlay.row]?.[FIELD_BY_COL[cellOverlay.col]] ?? "";
            const isSelected = value === currentValue;
            return (
              <button
                key={value === "" ? "__empty__" : value}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleOverlaySelect(value)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "9px 12px",
                  background: isSelected ? "#ECFDF5" : "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left" as const,
                  transition: "background 0.1s",
                }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? "#ECFDF5" : "transparent"; }}
              >
                {style ? (
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: 5,
                    padding: "2px 4px", fontSize: 11, fontWeight: 700,
                    color: style.color, flex: 1,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: style.color, display: "inline-block", flexShrink: 0 }} />
                    {label}
                  </span>
                ) : label ? (
                  <span style={{ fontSize: 13, fontWeight: 500, color: isSelected ? "#059669" : "#1A1714", flex: 1 }}>{label}</span>
                ) : (
                  <span style={{ fontSize: 13, color: "#C9C4BB", flex: 1 }}>担当者なし</span>
                )}
                {isSelected && <Check style={{ width: 12, height: 12, color: "#059669", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
