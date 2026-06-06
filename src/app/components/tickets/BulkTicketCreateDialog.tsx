import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HotTable } from "@handsontable/react";
import { registerAllModules } from "handsontable/registry";
import { X, Plus, TableProperties, AlertCircle, Check } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, MEMBERS } from "@/app/data/mock";
import { useAuth } from "@/app/contexts/AuthContext";

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

const INITIAL_ROW_COUNT = 10;

// ── Custom cell renderers ─────────────────────────────────────────────────────

function renderDropdownTd(
  TD: HTMLElement,
  value: string,
  badgeStyle: { color: string; bg: string } | null,
  placeholder: string,
) {
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

function statusCellRenderer(_hot: any, TD: HTMLElement, _row: number, _col: number, _prop: any, value: string) {
  renderDropdownTd(TD, value, STATUS_STYLES[value] ?? null, "選択");
}

function priorityCellRenderer(_hot: any, TD: HTMLElement, _row: number, _col: number, _prop: any, value: string) {
  renderDropdownTd(TD, value, PRIORITY_STYLES[value] ?? null, "選択");
}

function assigneeCellRenderer(_hot: any, TD: HTMLElement, _row: number, _col: number, _prop: any, value: string) {
  renderDropdownTd(TD, value, null, "担当者なし");
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

function makeEmptyRow(): RowData {
  return { title: "", status: "", priority: "", assignee: "", startDate: "", dueDate: "", estimatedHours: null, description: "" };
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

function validateRows(rows: RowData[]): string[] {
  const errors: string[] = [];
  rows.forEach((row, idx) => {
    const rowNum = idx + 1;
    const hasContent = !!(
      row.title.trim() || row.status || row.priority || row.assignee ||
      row.startDate || row.dueDate || row.description ||
      (typeof row.estimatedHours === "number" && !isNaN(row.estimatedHours) && row.estimatedHours > 0)
    );
    if (!hasContent) return;

    if (!row.title.trim()) {
      errors.push(`${rowNum}行目: タイトルが未入力です`);
    }
    if (row.startDate && row.dueDate) {
      const s = toDbDate(row.startDate);
      const d = toDbDate(row.dueDate);
      if (s && d && d < s) errors.push(`${rowNum}行目: 期限日が開始日より前です`);
    }
  });
  return errors;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const HOT_CSS = `
.bulk-hot-wrap .hot-display-license-info { display: none !important; }

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
  // Compute initial row count: modal height - dialog chrome (176px) - HOT col header (34px), floor so last row is never cut off
  const tableData = useRef<RowData[]>(
    Array.from({
      length: Math.max(INITIAL_ROW_COUNT, Math.floor((Math.floor(window.innerHeight * 0.9) - 212) / 32)),
    }, makeEmptyRow),
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
  // Escape guard: true while a cell editor is open (delayed false via rAF in afterEndEditing)
  const editorActiveRef = useRef(false);
  // Cleanup fn for date-cell character restriction listener
  const dateRestrictCleanupRef = useRef<(() => void) | null>(null);

  // Overlay for dropdown cells (col 1=status, 2=priority, 3=assignee)
  const [cellOverlay, setCellOverlay] = useState<OverlayState>(null);
  const cellOverlayRef = useRef<OverlayState>(null);
  const overlayPanelRef = useRef<HTMLDivElement>(null);
  const suppressOverlayCloseRef = useRef(false);

  useEffect(() => { cellOverlayRef.current = cellOverlay; }, [cellOverlay]);

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

  const runValidation = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    const data: RowData[] = hot ? (hot.getSourceData() as RowData[]) : tableData.current;
    setValidationErrors(validateRows(data));
  }, []);

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

  const afterEndEditing = useCallback(() => {
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

  // Auto-enter partial edit mode for text cells (col 0 = title, col 7 = description)
  const afterSelectionEnd = useCallback((r: number, c: number) => {
    if ((c === 0 || c === 7) && r >= 0) {
      requestAnimationFrame(() => {
        const hot = hotRef.current?.hotInstance;
        if (!hot) return;
        const editor = hot.getActiveEditor() as any;
        if (!editor || editor.isOpened?.()) return;
        editor.beginEditing("");
        requestAnimationFrame(() => {
          const ta: HTMLTextAreaElement | undefined = editor.TEXTAREA;
          if (ta && ta.value === "") {
            const existing = String(editor.originalValue ?? "");
            if (existing) {
              ta.value = existing;
              ta.setSelectionRange(existing.length, existing.length);
            }
          }
        });
      });
    }
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
      if (editor?.isOpened?.()) editor.close();  // exit partial/full edit mode first
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
    if (event.ctrlKey || event.metaKey) return;

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
  }, [openOverlay]);

  // Single-click (left only) opens overlay for dropdown cols; opens date picker for date cols
  const afterOnCellMouseDown = useCallback((event: MouseEvent, coords: { row: number; col: number }) => {
    if (coords.row < 0) return;
    // Right-click: close overlay and let context menu work normally
    if (event.button !== 0) {
      setCellOverlay(null);
      return;
    }

    if (coords.col === 1 || coords.col === 2 || coords.col === 3) {
      openOverlay(coords.row, coords.col);
      return;
    }

    // Close overlay when clicking any other cell
    setCellOverlay(null);

    if (coords.col === 4 || coords.col === 5) {
      setTimeout(() => {
        const hot = hotRef.current?.hotInstance;
        if (!hot) return;
        const editor = hot.getActiveEditor() as any;
        if (!editor) return;
        if (!editor.isOpened?.() && typeof editor.beginEditing === "function") editor.beginEditing();
        showPickerSafe(editor);
      }, 30);
    }
  }, [openOverlay, showPickerSafe]);

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
          hot.alter("remove_row", Math.min(r1, r2), Math.abs(r2 - r1) + 1);
        },
      },
      hsep1: { name: "---------" },
      copy: { name: "コピー" },
      cut:  { name: "切り取り" },
      hsep2: { name: "---------" },
      undo: { name: "元に戻す" },
      redo: { name: "やり直す" },
    },
  }), []); // callbacks access hotRef (stable ref) — no deps needed

  // ── Save ────────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
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
          estimated_hours: eh, progress: 0,
          description: row.description || null,
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
          <p style={{ fontSize: 11, color: "#9E9690", margin: 0 }}>
            <strong style={{ color: "#6B6458" }}>タイトル</strong> を入力した行のみ登録。日付は <strong style={{ color: "#6B6458" }}>YYYY/MM/DD</strong> で入力、セルクリックでカレンダー表示。複数行選択→右クリックでまとめて操作
          </p>
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
            rowHeights={32}
            autoRowSize={false}
            licenseKey="non-commercial-and-evaluation"
            contextMenu={contextMenu}
            autoWrapRow={true}
            autoWrapCol={true}
            manualColumnResize={true}
            afterSelectionEnd={afterSelectionEnd as any}
            beforeKeyDown={beforeKeyDown as any}
            beforeBeginEditing={beforeBeginEditing as any}
            afterBeginEditing={afterBeginEditing}
            afterEndEditing={afterEndEditing}
            afterChange={afterChange as any}
            afterOnCellMouseDown={afterOnCellMouseDown as any}
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
