import { useState, useMemo, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Trash2, ExternalLink, Plus, Pencil, GitBranch, X, FolderKanban, Save, Download } from "lucide-react";
import type { Sprint, SprintTicket, SortCol, DevScale } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES, getTicketStatusMeta, computeSprintStatus, sprintHasPending, htmlToText, calcTicketActualHours, formatPersonDays } from "@/app/lib/helpers";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { MoveToSprintDialog } from "@/app/components/sprints/MoveToSprintDialog";
import { BulkActionBar } from "@/app/components/sprints/BulkActionBar";
import { BulkAssignProgress, type BulkAssignPhase } from "@/app/components/sprints/BulkAssignProgress";
import { bulkDeleteTickets, bulkMoveTickets } from "@/app/lib/bulkTicketOps";
import { fetchSkills, fetchBulkRecommendations, logRecommendationAccepted } from "@/app/lib/skillsApi";
import { detectSkillKeywords, ticketSearchText } from "@/app/lib/skills";
import { fireSlackNotify } from "@/app/utils/slackNotify";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";
import { SprintActualHours } from "@/app/components/sprints/SprintActualHours";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { copyText } from "@/lib/clipboard";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { MyFilterModal, addMyFilter, SaveFilterDialog, checkDuplicateFilter } from "@/app/components/sprints/MyFilterModal";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { PlanTooltip } from "@/app/components/shared/PlanTooltip";
import { downloadSprintCsv } from "@/app/lib/csvExport";
import { useAlert } from "@/app/contexts/AlertContext";
import { BulkCreateMenu, useBulkCreateMenu, type BulkCreateMode } from "@/app/components/sprints/BulkCreateMenu";

// 🌟 今日の日付（YYYY-MM-DD）を取得するヘルパー
function getTodayString(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 🌟 期限日当日以降かつ未完了（Done/Closed/Released/取下以外）か判定する関数
function isOverdueOrToday(dueDate?: string, status?: string, progress?: number): boolean {
  if (!dueDate || !dueDate.trim()) return false;
  if (status === "closed" || status === "done" || status === "released" || progress === -2) {
    return false;
  }
  const today = getTodayString();
  const targetDate = dueDate.slice(0, 10);
  return today >= targetDate;
}

const getClosedDateFromMonitor = (ticket: any): string => {
  if (!ticket) return "";
  const logs = ticket.monitorLogs || ticket.monitor_logs || ticket.ticket_monitor_logs || ticket.actualLogs || [];

  if (Array.isArray(logs) && logs.length > 0) {
    const closedLog = [...logs]
      .reverse()
      .find((log: any) => log && (
        log.process === "リリース" || log.process === "クローズ" ||
        log.status === "リリース" || log.status === "クローズ" ||
        log.phase === "リリース" || log.phase === "クローズ"
      ));

    if (closedLog) {
      return closedLog.completed_at || closedLog.completedAt || closedLog.created_at || closedLog.createdAt || closedLog.date || "";
    }
  }
  return ticket.releasedAt || ticket.released_at || ticket.closedAt || ticket.closed_at || "";
};

const formatClosedMMDD = (isoString: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString.slice(0, 5);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
};

const BASE_CATEGORY_MAP: Record<string, string> = {
  "CAT-1780106163889": "バグ",
  "CAT-1780106169442": "仕様確認",
  "CAT-1780106176626": "要望",
  "CAT-1780241120059": "改善",
  "CAT-1780293371590": "新規機能開発"
};

function estimateScale(hours: number): DevScale | null {
  if (!hours || hours <= 0) return null;
  if (hours <= 3) return "S";
  if (hours <= 8) return "M";
  if (hours <= 40) return "L";
  return "XL";
}

function SelBox({ checked, indeterminate, onClick }: { checked: boolean; indeterminate?: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <div onClick={onClick} title="選択" style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", width: "100%" }}>
      <div style={{ width: 15, height: 15, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", border: (checked || indeterminate) ? "none" : "1.5px solid rgba(26,23,20,0.28)", background: checked ? "#059669" : indeterminate ? "#9CA3AF" : "transparent", transition: "all 0.1s" }}>
        {checked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 800, lineHeight: 1 }}>✓</span>}
        {indeterminate && !checked && <span style={{ color: "#fff", fontSize: 11, fontWeight: 900, lineHeight: 1 }}>−</span>}
      </div>
    </div>
  );
}

function ColumnFilter({
  col, label, sortCol, sortDir, onSort, onClearSort,
  options, selected, onFilterChange,
  open, onToggle, onClose, alignRight,
}: {
  col: SortCol | "closedDate";
  label: string;
  sortCol: SortCol | "closedDate" | "";
  sortDir: "asc" | "desc";
  onSort: (col: SortCol | "closedDate", dir: "asc" | "desc") => void;
  onClearSort: () => void;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onFilterChange: (s: Set<string>) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  alignRight?: boolean;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  const isSorted = sortCol === col;
  const isFiltered = selected.size > 0;
  const active = isSorted || isFiltered;

  const filteredOptions = options.filter(opt =>
    search === "" || opt.label.toLowerCase().includes(search.toLowerCase())
  );
  const allFilteredChecked = filteredOptions.length > 0 && filteredOptions.every(o => selected.has(o.value));
  const someFilteredChecked = !allFilteredChecked && filteredOptions.some(o => selected.has(o.value));

  const toggleAll = () => {
    if (filteredOptions.length === 0) return;
    if (allFilteredChecked) {
      const next = new Set(selected); filteredOptions.forEach(o => next.delete(o.value)); onFilterChange(next);
    } else {
      const next = new Set(selected); filteredOptions.forEach(o => next.add(o.value)); onFilterChange(next);
    }
  };

  const toggleOne = (value: string) => {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    onFilterChange(next);
  };

  return (
    <div style={{ position: "relative", width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onToggle}>
      <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none",
        cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700,
        color: active ? "#059669" : "#B0A9A4",
        textTransform: "uppercase" as const, letterSpacing: "0.06em",
      }}>
        {label}
        {isSorted && <span style={{ fontSize: 9, color: "#059669", fontWeight: 900 }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
        {isFiltered && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#059669", display: "inline-block", flexShrink: 0 }} />}
        <ChevronDown style={{ width: 9, height: 9, color: active ? "#059669" : "#C9C4BB", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          onWheel={e => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 6px)",
            left: alignRight ? "auto" : 0, right: alignRight ? 0 : "auto",
            background: "#fff", borderRadius: 10, border: "1px solid rgba(26,23,20,0.10)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: "6px", zIndex: 200, minWidth: 190, maxWidth: 360,
          }}>
          <button onClick={() => { onSort(col, "asc"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
            background: isSorted && sortDir === "asc" ? "#ECFDF5" : "transparent",
            color: isSorted && sortDir === "asc" ? "#059669" : "#1A1714", transition: "background 0.1s",
          }}>↑ 昇順</button>
          <button onClick={() => { onSort(col, "desc"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
            background: isSorted && sortDir === "desc" ? "#ECFDF5" : "transparent",
            color: isSorted && sortDir === "desc" ? "#059669" : "#1A1714", transition: "background 0.1s",
          }}>↓ 降順</button>
          {isSorted && (
            <button onClick={() => { onClearSort(); onClose(); }} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
              borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11,
              background: "transparent", color: "#B0A9A4", textAlign: "left" as const,
            }}>並び替えをクリア</button>
          )}

          <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", margin: "4px 0" }} />

          <div style={{ padding: "2px 4px 4px" }}>
            <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()} placeholder="検索..."
              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(26,23,20,0.15)", fontSize: 11, outline: "none", boxSizing: "border-box" as const, color: "#1A1714", background: "#FAFAF9" }} />
          </div>

          <button onClick={toggleAll} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
            background: "transparent", color: "#1A1714", textAlign: "left" as const,
          }}>
            <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: (allFilteredChecked || someFilteredChecked) ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: allFilteredChecked ? "#059669" : someFilteredChecked ? "#9CA3AF" : "transparent" }}>
              {allFilteredChecked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
              {someFilteredChecked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>−</span>}
            </div>
            すべて
          </button>

          <div style={{ maxHeight: 200, overflowY: "auto", overscrollBehavior: "contain" }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: 8, textAlign: "center" as const, color: "#B0A9A4", fontSize: 11 }}>一致する項目がありません</div>
            ) : filteredOptions.map(opt => {
              const checked = selected.has(opt.value);
              return (
                <button key={opt.value} onClick={() => toggleOne(opt.value)} style={{
                  display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "5px 8px",
                  borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
                  background: checked ? "#ECFDF5" : "transparent",
                  color: checked ? "#059669" : "#1A1714", transition: "background 0.1s",
                  whiteSpace: "normal", wordBreak: "break-word",
                }}>
                  <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: checked ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: checked ? "#059669" : "transparent", marginTop: 2 }}>
                    {checked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  <span style={{ flex: 1, lineHeight: 1.4 }}>{opt.label}</span>
                </button>
              );
            })}
          </div>

          {isFiltered && (
            <>
              <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", margin: "4px 0" }} />
              <button onClick={() => onFilterChange(new Set())} style={{ width: "100%", padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, background: "transparent", color: "#B0A9A4", textAlign: "left" as const }}>
                フィルターをクリア
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const LOCAL_STORAGE_KEY = "sprint_accordion_states";

function SkeletonBlock({ w, h, radius }: { w: number | string; h: number; radius?: number }) {
  return <div className="skeleton-shimmer" style={{ width: w, height: h, borderRadius: radius ?? 6, flexShrink: 0 }} />;
}

function SkeletonSprintCard({ index }: { index: number }) {
  const widths = [160, 200, 140];
  const titleW = widths[index % widths.length];
  return (
    <div style={{ borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", overflow: "hidden", animationDelay: `${index * 0.12}s` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", background: "#F9F8F6" }}>
        <SkeletonBlock w={13} h={13} radius={3} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <SkeletonBlock w={titleW} h={15} />
            <SkeletonBlock w={50} h={18} radius={20} />
          </div>
          <SkeletonBlock w="55%" h={4} radius={4} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0, marginLeft: 16 }}>
          {[36, 36, 44, 52].map((w, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              <SkeletonBlock w={w} h={18} />
              <SkeletonBlock w={24} h={10} />
            </div>
          ))}
          <SkeletonBlock w={110} h={12} radius={6} />
          <SkeletonBlock w={72} h={28} radius={7} />
          <SkeletonBlock w={58} h={28} radius={7} />
          <SkeletonBlock w={90} h={28} radius={7} />
        </div>
      </div>
    </div>
  );
}

export function SprintListView({ sprints, loading, onSelectSprint, onDeleteSprint, onEditSprint, onSelectTicket, onCreateTicket, onBulkCreate, targetTicketWbs, targetSprintId, highlightWbsList, stickyTop, onUpdated, projectMembers, projectSlug }: {
  sprints: Sprint[];
  loading?: boolean;
  onSelectSprint: (s: Sprint) => void;
  onDeleteSprint?: (s: Sprint) => void;
  onEditSprint?: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onCreateTicket?: (sprintId: string) => void;
  onBulkCreate?: (sprintId: string, mode: BulkCreateMode) => void;
  targetTicketWbs?: string;
  targetSprintId?: string | null;
  /** 一括作成の直後に強調表示するWBS（複数） */
  highlightWbsList?: string[];
  stickyTop?: number;
  onUpdated?: () => void | Promise<void>;
  projectMembers?: string[];
  projectSlug?: string;
}) {
  const { userId, userOrgId } = useAuth();
  const { plan } = usePlan();
  const { showAlert } = useAlert();

  const [filterCounts, setFilterCounts] = useState<Record<string, number>>({});
  const refreshFilterCount = (sprintId: string) => {
    if (!isSupabaseEnabled || !userId || !sprintId) return;
    supabase!.from("my_filters").select("*", { count: "exact", head: true })
      .eq("sprint_id", sprintId).eq("member_id", userId)
      .then(({ count }) => { setFilterCounts(prev => ({ ...prev, [sprintId]: count ?? 0 })); });
  };

  const [saveFilterTarget, setSaveFilterTarget] = useState<{
    sprintId: string;
    serializedFilters: Record<string, string[]>;
    sortCol: string;
    sortDir: "asc" | "desc";
  } | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<null | "delete" | "move">(null);
  const [assignState, setAssignState] = useState<{ phase: BulkAssignPhase; current: number; total: number; message?: string } | null>(null);
  const [highlightedTicketIds, setHighlightedTicketIds] = useState<Set<string>>(new Set());

  const bulkMenu = useBulkCreateMenu();
  // 一括作成の直後に強調表示するWBS。毎レンダーで作り直さないよう memo 化する（点滅防止）
  const bulkHighlight = useMemo(() => new Set(highlightWbsList ?? []), [highlightWbsList]);

  useEffect(() => {
    if (!isSupabaseEnabled || !userId || sprints.length === 0) return;
    sprints.forEach(s => {
      supabase!.from("my_filters").select("*", { count: "exact", head: true })
        .eq("sprint_id", s.id).eq("member_id", userId)
        .then(({ count }) => { setFilterCounts(prev => ({ ...prev, [s.id]: count ?? 0 })); });
    });
  }, [sprints, userId]);

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    let savedStates: Record<string, boolean> = {};
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) savedStates = JSON.parse(saved);
    } catch (e) { }

    const initial = new Set<string>();
    sprints.forEach(s => {
      if (savedStates[s.id] !== false) {
        initial.add(s.id);
      }
    });
    return initial;
  });

  useEffect(() => {
    let savedStates: Record<string, boolean> = {};
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) savedStates = JSON.parse(saved);
    } catch (e) { }

    setExpanded(prev => {
      const next = new Set(prev);
      sprints.forEach(s => {
        if (savedStates[s.id] === false) {
          next.delete(s.id);
        } else {
          next.add(s.id);
        }
      });
      return next;
    });
  }, [sprints.map(s => s.id).join(",")]);

  useEffect(() => {
    if (!targetTicketWbs) return;
    const sprint = sprints.find(s => s.tickets.some(t => t.wbs === targetTicketWbs));
    if (sprint) {
      setExpanded(prev => {
        const n = new Set(prev);
        if (!n.has(sprint.id)) {
          n.add(sprint.id);
          try {
            const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
            const savedStates = saved ? JSON.parse(saved) : {};
            savedStates[sprint.id] = true;
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedStates));
          } catch (e) { }
        }
        return n;
      });
    }
  }, [targetTicketWbs, sprints]);

  const scrolledForWbs = useRef<string | null>(null);
  useEffect(() => {
    if (!targetTicketWbs) { scrolledForWbs.current = null; return; }
    if (scrolledForWbs.current === targetTicketWbs) return;
    const el = document.querySelector(`[data-wbs="${targetTicketWbs}"]`);
    if (!el) return;
    scrolledForWbs.current = targetTicketWbs;
    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [targetTicketWbs, expanded]);

  const scrolledForSprint = useRef<string | null>(null);
  const [flashSprintId, setFlashSprintId] = useState<string | null>(null);
  useEffect(() => {
    if (!targetSprintId) { scrolledForSprint.current = null; return; }
    if (scrolledForSprint.current === targetSprintId) return;
    const el = document.querySelector(`[data-sprint-id="${targetSprintId}"]`);
    if (!el) return;
    scrolledForSprint.current = targetSprintId;
    requestAnimationFrame(() => { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    setFlashSprintId(targetSprintId);
    const t = setTimeout(() => setFlashSprintId(null), 2500);
    return () => clearTimeout(t);
  }, [targetSprintId, sprints]);

  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());

  // 一括作成の直後: 対象スプリントと、強調対象の子を持つ親を開いてから先頭のチケットへスクロールする
  const scrolledForBulk = useRef<string | null>(null);
  useEffect(() => {
    const first = highlightWbsList?.[0];
    if (!first) { scrolledForBulk.current = null; return; }

    const sprint = sprints.find(s => s.tickets.some(t => bulkHighlight.has(t.wbs)));
    if (!sprint) return;

    setExpanded(prev => (prev.has(sprint.id) ? prev : new Set(prev).add(sprint.id)));
    const parentIds = sprint.tickets
      .filter(t => t.parentId && bulkHighlight.has(t.wbs))
      .map(t => t.parentId!);
    if (parentIds.length > 0) {
      setExpandedTickets(prev => {
        if (parentIds.every(id => prev.has(id))) return prev;
        const next = new Set(prev);
        parentIds.forEach(id => next.add(id));
        return next;
      });
    }

    if (scrolledForBulk.current === first) return;
    const el = document.querySelector(`[data-wbs="${first}"]`);
    if (!el) return;
    scrolledForBulk.current = first;
    requestAnimationFrame(() => { el.scrollIntoView({ behavior: "smooth", block: "center" }); });
  }, [highlightWbsList, bulkHighlight, sprints, expanded, expandedTickets]);

  const [sprintSorts, setSprintSorts] = useState<Record<string, { col: SortCol | "closedDate" | ""; dir: "asc" | "desc" }>>({});
  const [sprintFilters, setSprintFilters] = useState<Record<string, Record<string, Set<string>>>>({});
  const [openCol, setOpenCol] = useState<string>("");

  const [myFilterSprintId, setMyFilterSprintId] = useState<string | null>(null);

  const [dbCategories, setDbCategories] = useState<Array<{ id: string; projectId: string; name: string }>>([]);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!
      .from("ticket_categories")
      .select("*")
      .then(({ data }) => {
        if (data) setDbCategories(data);
      })
      .catch((err) => console.error("Failed to load category master:", err));
  }, [sprints]);

  const toggle = (id: string) => {
    setExpanded(prev => {
      const n = new Set(prev);
      const willBeOpen = !n.has(id);

      if (willBeOpen) {
        n.add(id);
      } else {
        n.delete(id);
      }

      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        const savedStates = saved ? JSON.parse(saved) : {};
        savedStates[id] = willBeOpen;
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(savedStates));
      } catch (e) { }

      return n;
    });
  };

  const unifiedCategoryMap = useMemo(() => {
    const registry = { ...BASE_CATEGORY_MAP };
    dbCategories.forEach(c => {
      if (c.id && c.name) {
        registry[c.id] = c.name;
      }
    });
    sprints.flatMap(s => s.tickets).forEach(t => {
      const id = t.categoryId || "";
      const name = (t as any).categoryName || (t as any).category?.name;
      if (id && name && !name.startsWith("CAT-") && !registry[id]) {
        registry[id] = name;
      }
    });
    return registry;
  }, [dbCategories, sprints]);

  const getCategoryLabel = (ticket: SprintTicket): string => {
    const id = ticket.categoryId || "";
    if (unifiedCategoryMap[id]) return unifiedCategoryMap[id];

    const rawName = (ticket as any).categoryName || (ticket as any).category?.name || "";
    if (rawName && !rawName.startsWith("CAT-")) return rawName;
    if (rawName && unifiedCategoryMap[rawName]) return unifiedCategoryMap[rawName];

    return "分類なし";
  };

  const dynamicCategoryColumnWidth = useMemo(() => {
    let maxChars = 4;

    dbCategories.forEach(c => {
      if (c.name && c.name.length > maxChars) maxChars = c.name.length;
    });
    sprints.flatMap(s => s.tickets).forEach(t => {
      const label = getCategoryLabel(t);
      if (label && label.length > maxChars) maxChars = label.length;
    });

    const computedPx = Math.ceil(maxChars * 13.5) + 26;
    return Math.max(80, Math.min(180, computedPx));
  }, [dbCategories, sprints]);

  const getColOptions = (currentSprint: Sprint, col: string): Array<{ value: string; label: string }> => {
    const sprintTickets = currentSprint.tickets || [];

    switch (col) {
      case "wbs":
        return [...new Set(sprintTickets.map(t => t.wbs))].sort().map(v => ({ value: v, label: v }));
      case "title":
        return [...new Set(sprintTickets.map(t => t.title))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "description":
        return [...new Set(sprintTickets.map(t => htmlToText(t.description)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "status":
        return TICKET_STATUSES.map(s => ({ value: s.value, label: s.label }));
      case "priority":
        return [{ value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }];
      case "assignee":
        return [...new Set(sprintTickets.map(t => t.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "startDate": {
        const opts = [...new Set(sprintTickets.map(t => t.startDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
        if (sprintTickets.some(t => !(t.startDate || ""))) opts.push({ value: "", label: "（空白）" });
        return opts;
      }
      case "dueDate": {
        const opts = [...new Set(sprintTickets.map(t => t.dueDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
        if (sprintTickets.some(t => !(t.dueDate || ""))) opts.push({ value: "", label: "（空白）" });
        return opts;
      }
      case "closedDate": {
        const opts = [...new Set(sprintTickets.map(t => getClosedDateFromMonitor(t)).filter(Boolean))]
          .sort()
          .map(v => ({ value: v, label: formatClosedMMDD(v) }));
        if (sprintTickets.some(t => !getClosedDateFromMonitor(t))) opts.push({ value: "", label: "（空白）" });
        return opts;
      }
      case "category":
        const optionSet = new Set<string>();
        sprintTickets.forEach(t => optionSet.add(getCategoryLabel(t)));
        return Array.from(optionSet)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "ja"))
          .map(v => ({ value: v, label: v }));
      default: return [];
    }
  };

  const getSelected = (sprintId: string, col: string): Set<string> => {
    return sprintFilters[sprintId]?.[col] ?? new Set();
  };

  const setColFilter = (sprintId: string, col: string) => (nextSet: Set<string>) => {
    setSprintFilters(prev => ({
      ...prev,
      [sprintId]: {
        ...(prev[sprintId] || {}),
        [col]: nextSet
      }
    }));
  };

  const toggleCol = (sprintId: string, col: string) => {
    const key = `${sprintId}:${col}`;
    setOpenCol(prev => prev === key ? "" : key);
  };
  const closeCol = () => setOpenCol("");

  const handleSort = (sprintId: string, col: SortCol | "closedDate", dir: "asc" | "desc") => {
    setSprintSorts(prev => ({ ...prev, [sprintId]: { col, dir } }));
  };
  const clearSort = (sprintId: string) => {
    setSprintSorts(prev => {
      const next = { ...prev };
      delete next[sprintId];
      return next;
    });
  };

  const processTickets = (sprintId: string, tickets: SprintTicket[]) => {
    const parents = tickets.filter(t => !t.parentId);
    const activeFilters = sprintFilters[sprintId] || {};

    const filtered = parents.filter(t => {
      const catName = getCategoryLabel(t);
      const checks: Record<string, string> = {
        wbs: t.wbs,
        title: t.title,
        description: htmlToText(t.description),
        status: t.progress === -1 ? "pending" : t.progress === -2 ? "withdrawn" : t.status,
        priority: t.priority,
        assignee: t.assignee || "",
        startDate: t.startDate || "",
        dueDate: t.dueDate || "",
        closedDate: getClosedDateFromMonitor(t),
        category: catName
      };

      return Object.keys(activeFilters).every(col => {
        const filterSet = activeFilters[col];
        if (!filterSet || filterSet.size === 0) return true;
        return filterSet.has(checks[col] || "");
      });
    });

    const currentSort = sprintSorts[sprintId];
    if (!currentSort || !currentSort.col) return filtered;
    return [...filtered].sort((a, b) => {
      const dir = currentSort.dir === "asc" ? 1 : -1;
      const col = currentSort.col;
      const getVal = (tick: SprintTicket, c: string) => {
        if (c === "category") return getCategoryLabel(tick);
        if (c === "closedDate") return getClosedDateFromMonitor(tick);
        return tick[c as keyof SprintTicket] ?? "";
      };

      const av = getVal(a, col) as string | number;
      const bv = getVal(b, col) as string | number;

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ja") * dir;
    });
  };

  const allTickets = useMemo(() => sprints.flatMap(s => s.tickets), [sprints]);
  const selectedTickets = useMemo(() => allTickets.filter(t => selectedTicketIds.has(t.id)), [allTickets, selectedTicketIds]);
  const bulkProjectId = sprints[0]?.projectId ?? null;

  const clearSelection = () => setSelectedTicketIds(new Set());
  const toggleTicketSel = (id: string) => setSelectedTicketIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const setSprintSelection = (tickets: SprintTicket[], checked: boolean) => setSelectedTicketIds(prev => {
    const n = new Set(prev); tickets.forEach(t => { checked ? n.add(t.id) : n.delete(t.id); }); return n;
  });

  const flashTickets = (ids: string[]) => {
    setHighlightedTicketIds(new Set(ids));
    window.setTimeout(() => setHighlightedTicketIds(new Set()), 6000);
  };

  const impliedChildCount = useMemo(
    () => allTickets.filter(t => t.parentId && selectedTicketIds.has(t.parentId) && !selectedTicketIds.has(t.id)).length,
    [allTickets, selectedTicketIds],
  );

  const runBulkDelete = async () => {
    const ids = Array.from(selectedTicketIds);
    const n = selectedTickets.length;
    try {
      await bulkDeleteTickets(ids);
      clearSelection();
      onUpdated?.();
      setSuccessMessage(`${n}件のチケットを削除しました。`);
    } catch (e) {
      showAlert("削除に失敗しました。\n\n" + String(e), "エラー");
    }
  };

  const runBulkCopyLinks = async () => {
    if (!projectSlug) { showAlert("プロジェクト情報が取得できませんでした。", "エラー"); return; }
    const targets = selectedTickets;
    if (targets.length === 0) return;
    const links = targets.map(t => `${window.location.origin}/${projectSlug}/${t.wbs}`).join("\n");
    if (await copyText(links)) {
      setSuccessMessage(`${targets.length}件のチケットのリンクをコピーしました。`);
    } else {
      showAlert("リンクのコピーに失敗しました。", "エラー");
    }
  };

  const runBulkMove = async (targetSprintId: string) => {
    if (!bulkProjectId) return;
    const ids = Array.from(selectedTicketIds);
    try {
      const moved = await bulkMoveTickets({ ticketIds: ids, targetSprintId, projectId: bulkProjectId });
      const target = sprints.find(s => s.id === targetSprintId);
      await onUpdated?.();
      clearSelection();
      setBulkAction(null);
      setSuccessMessage(`${moved}件のチケットを「${target?.name ?? "スプリント"}」へ移動しました。`);
    } catch (e) {
      showAlert("移動に失敗しました。\n\n" + String(e), "エラー");
    }
  };

  const runBulkAssign = async () => {
    if (!userOrgId) { showAlert("組織情報が取得できませんでした。", "エラー"); return; }
    const targets = selectedTickets.slice();
    if (targets.length === 0) return;

    setAssignState({ phase: "analyzing", current: 0, total: targets.length });
    try {
      const skills = await fetchSkills(userOrgId);

      const ids = targets.map(t => t.id);
      const { data: savedSkills } = isSupabaseEnabled
        ? await supabase!.from("ticket_required_skills").select("ticket_id, skill_id, importance").in("ticket_id", ids)
        : { data: [] as any[] };
      const savedByTicket = new Map<string, { skillId: string; importance: number }[]>();
      for (const r of savedSkills ?? []) {
        const arr = savedByTicket.get(r.ticket_id) ?? [];
        arr.push({ skillId: r.skill_id, importance: r.importance ?? 3 });
        savedByTicket.set(r.ticket_id, arr);
      }

      const resolved = targets.map(t => {
        let required = savedByTicket.get(t.id) ?? [];
        if (required.length === 0) {
          required = detectSkillKeywords(
            ticketSearchText({ title: t.title, description: (t.description ?? "").replace(/<[^>]*>/g, " "), prefixes: t.prefixes ?? [] }),
            skills,
          ).map(id => ({ skillId: id, importance: 3 }));
        }
        const scale = t.devScale ?? estimateScale(t.estimatedHours || 0);
        return { ticket: t, required, scale };
      });

      const { results } = await fetchBulkRecommendations({
        organizationId: userOrgId,
        candidateNames: projectMembers,
        tickets: resolved.map(r => ({
          ticketId: r.ticket.id,
          requiredSkillIds: r.required,
          devScale: r.scale,
          estimatedHours: r.ticket.estimatedHours || 0,
          priority: r.ticket.priority,
          startDate: r.ticket.startDate || null,
          dueDate: r.ticket.dueDate || null,
        })),
      });
      const byTicket = new Map(results.map(r => [r.ticketId, r]));

      setAssignState({ phase: "saving", current: 0, total: targets.length });
      const assignedIds: string[] = [];
      const notifRows: Record<string, unknown>[] = [];
      let done = 0;
      for (const r of resolved) {
        const rec = byTicket.get(r.ticket.id);
        const chosen = rec?.chosen ?? null;
        if (chosen && chosen.name && isSupabaseEnabled) {
          const prev = r.ticket.assignee;
          await supabase!.from("sprint_tickets")
            .update({ assignee: chosen.name, assignees: [chosen.name], dev_scale: r.scale })
            .eq("id", r.ticket.id);
          // ★ 自動付与行(source='auto')は消さない ★ 消すと夜間バッチが翌日また生やして
          //   「消したのに戻る」ように見える。人が確定した行だけを入れ替える。
          await supabase!.from("ticket_required_skills")
            .delete().eq("ticket_id", r.ticket.id).eq("source", "manual");
          if (r.required.length > 0) {
            // 同じスキルが自動付与済みのことがあるので upsert（insert だと主キー衝突する）
            await supabase!.from("ticket_required_skills").upsert(
              r.required.map(s => ({ ticket_id: r.ticket.id, skill_id: s.skillId, importance: s.importance, source: "manual" })),
              { onConflict: "ticket_id,skill_id" },
            );
          }
          if (rec) void logRecommendationAccepted({ organizationId: userOrgId, ticketId: r.ticket.id, candidates: rec.candidates, chosen, source: rec.source });
          if (chosen.name !== prev && projectSlug) {
            notifRows.push({
              user_name: chosen.name, type: "assign", title: "チケットが割り当てられました",
              body: `${r.ticket.wbs}: ${r.ticket.title}（担当: ${prev || "未割り当て"} → ${chosen.name}）`,
              ticket_id: r.ticket.id, ticket_wbs: r.ticket.wbs, ticket_title: r.ticket.title,
              project_slug: projectSlug, is_read: false,
            });
            fireSlackNotify({ recipientUserNames: [chosen.name], projectSlug, title: "チケットが割り当てられました", body: `${r.ticket.wbs}: ${r.ticket.title}` });
          }
          assignedIds.push(r.ticket.id);
        }
        done++;
        setAssignState({ phase: "saving", current: done, total: targets.length });
      }
      if (notifRows.length > 0 && isSupabaseEnabled) {
        await supabase!.from("notifications").insert(notifRows);
      }

      setAssignState(null);
      clearSelection();
      onUpdated?.();
      flashTickets(assignedIds);
      setSuccessMessage(assignedIds.length === 0
        ? "推奨できる担当者が見つかりませんでした。スキルマスタや条件をご確認ください。"
        : `${assignedIds.length}件のチケットに担当者を自動アサインしました。`);
    } catch (e) {
      setAssignState({ phase: "error", current: 0, total: 0, message: String(e) });
    }
  };

  if (loading) return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 18px", marginBottom: 12, background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 5 }}>
          <span className="loading-dot" />
          <span className="loading-dot" />
          <span className="loading-dot" />
        </div>
        <span style={{ fontSize: 12, color: "#A09790", fontWeight: 500 }}>スプリントデータを読み込んでいます...</span>
        <div className="loading-bar-track" style={{ flex: 1, height: 5 }}>
          <div className="loading-bar-fill" />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SkeletonSprintCard index={0} />
        <SkeletonSprintCard index={1} />
        <SkeletonSprintCard index={2} />
      </div>
    </div>
  );

  if (!sprints.length) return (
    <div style={{ padding: "48px 0", textAlign: "center", color: "#C9C4BB", fontSize: 13 }}>スプリントがありません</div>
  );

  const COLS = ["wbs", "title", "description", "category", "status", "priority", "assignee", "startDate", "dueDate", "closedDate"] as const;
  const COL_LABELS = ["No", "チケット名", "チケット詳細", "分類", "ステータス", "優先度", "担当者", "開始日", "期限日", "クローズ日"];
  const GRID = `32px 72px 1fr 1fr ${dynamicCategoryColumnWidth}px 110px 56px 110px 68px 68px 68px 60px 32px`;

  return (
    <div>
      {openCol && <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={closeCol} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sprints.map(sprint => {
          const isExp = expanded.has(sprint.id);
          const computedStatus = computeSprintStatus(sprint);
          const sm = getSprintStatusMeta(computedStatus);
          const showPendingBadge = computedStatus === "completed" && sprintHasPending(sprint);
          const progress = sprintProgress(sprint);
          const terminalStatuses = ["done", "closed", "waiting-release", "released"];
          const done = sprint.tickets.filter(t => terminalStatuses.includes(t.status) || t.progress === -2).length;
          const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
          const actualHours = Math.round(sprint.tickets.reduce((s, t) => s + calcTicketActualHours(t), 0) * 10) / 10;

          const displayTickets = processTickets(sprint.id, sprint.tickets);
          const currentFilters = sprintFilters[sprint.id] || {};
          const hasAnyFilter = Object.values(currentFilters).some(set => set && set.size > 0);

          const sprintSort = sprintSorts[sprint.id] || { col: "", dir: "asc" };

          return (
            <div key={sprint.id} data-sprint-id={sprint.id} style={{ borderRadius: 12, border: flashSprintId === sprint.id ? "1px solid #F59E0B" : "1px solid rgba(26,23,20,0.08)", boxShadow: flashSprintId === sprint.id ? "0 0 0 3px rgba(245,158,11,0.35)" : "0 1px 2px rgba(0,0,0,0.04)", transition: "box-shadow 0.3s, border-color 0.3s" }}>
              <div style={{ position: "sticky", top: stickyTop ?? 0, zIndex: openCol.startsWith(`${sprint.id}:`) ? 100 : 10 }}>
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", background: "#F9F8F6", cursor: "pointer", borderBottom: isExp ? "1px solid rgba(26,23,20,0.06)" : "none", borderRadius: isExp ? "12px 12px 0 0" : 12 }}
                  onClick={() => toggle(sprint.id)}>
                  <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4", transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, minWidth: 0, overflow: "hidden" }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sprint.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                      {showPendingBadge && (
                        <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#FEF2F2", color: "#DC2626", whiteSpace: "nowrap" }}>保留あり</span>
                      )}
                    </div>
                    {sprint.goal && <p style={{ fontSize: 11, color: "#A09790", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sprint.goal}</p>}
                    <div style={{ marginTop: 6 }}><ProgressBar value={progress} /></div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0, marginLeft: 16 }}>
                    {[{ label: "チケット", value: sprint.tickets.length }, { label: "完了", value: done }, { label: "工数(h)", value: totalHours }, { label: "進捗", value: `${progress}%` }].map(({ label, value }) => (
                      <div key={label} style={{ textAlign: "center" as const }}>
                        <p style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>{value}</p>
                        <p style={{ fontSize: 10, color: "#B0A9A4" }}>{label}</p>
                      </div>
                    ))}
                    {plan.featureActualMonitor && <SprintActualHours actualHours={actualHours} />}
                    <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>

                    <button onClick={e => { e.stopPropagation(); setMyFilterSprintId(sprint.id); }}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 7, cursor: "pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                      <FolderKanban style={{ width: 11, height: 11 }} />Myフィルタ
                    </button>

                    <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 7, cursor: "pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                      <ExternalLink style={{ width: 11, height: 11 }} />詳細
                    </button>
                    <PlanTooltip text="現在のプランではご利用できません" active={!plan.featureCsvExport} placement="bottom-left">
                      <button onClick={e => { e.stopPropagation(); if (plan.featureCsvExport) downloadSprintCsv(sprint, displayTickets, getCategoryLabel); }}
                        style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: plan.featureCsvExport ? "#059669" : "#9CA3AF", background: plan.featureCsvExport ? "#ECFDF5" : "#F3F4F6", border: `1px solid ${plan.featureCsvExport ? "rgba(5,150,105,0.20)" : "rgba(156,163,175,0.30)"}`, borderRadius: 7, cursor: plan.featureCsvExport ? "pointer" : "not-allowed" }}
                        onMouseEnter={e => { if (plan.featureCsvExport) (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                        onMouseLeave={e => { if (plan.featureCsvExport) (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                        <Download style={{ width: 11, height: 11 }} />CSVダウンロード
                      </button>
                    </PlanTooltip>
                    {onBulkCreate && (
                      <PlanTooltip text="現在のプランではご利用できません" active={!plan.featureBulkCreate} placement="bottom-left">
                        <button onClick={e => { e.stopPropagation(); if (plan.featureBulkCreate) bulkMenu.open(sprint.id, e.currentTarget); }}
                          style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: plan.featureBulkCreate ? "#7C3AED" : "#9CA3AF", background: plan.featureBulkCreate ? "#F5F3FF" : "#F3F4F6", border: `1px solid ${plan.featureBulkCreate ? "rgba(124,58,237,0.20)" : "rgba(156,163,175,0.30)"}`, borderRadius: 7, cursor: plan.featureBulkCreate ? "pointer" : "not-allowed" }}
                          onMouseEnter={e => { if (plan.featureBulkCreate) (e.currentTarget as HTMLElement).style.background = "#EDE9FE"; }}
                          onMouseLeave={e => { if (plan.featureBulkCreate) (e.currentTarget as HTMLElement).style.background = "#F5F3FF"; }}>
                          <Plus style={{ width: 11, height: 11 }} />一括作成
                        </button>
                      </PlanTooltip>
                    )}
                    {onCreateTicket && (() => {
                      const ticketAtLimit = plan.maxTicketsPerSprint !== null && sprint.tickets.length >= plan.maxTicketsPerSprint;
                      return (
                        <PlanTooltip text="現在のプランではこれ以上作成できません" active={ticketAtLimit}>
                          <button onClick={e => { e.stopPropagation(); if (!ticketAtLimit) onCreateTicket(sprint.id); }}
                            style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: ticketAtLimit ? "#9CA3AF" : "#7C3AED", background: ticketAtLimit ? "#F3F4F6" : "#F5F3FF", border: `1px solid ${ticketAtLimit ? "rgba(156,163,175,0.30)" : "rgba(124,58,237,0.20)"}`, borderRadius: 7, cursor: ticketAtLimit ? "not-allowed" : "pointer" }}
                            onMouseEnter={e => { if (!ticketAtLimit) (e.currentTarget as HTMLElement).style.background = "#EDE9FE"; }}
                            onMouseLeave={e => { if (!ticketAtLimit) (e.currentTarget as HTMLElement).style.background = "#F5F3FF"; }}>
                            <Plus style={{ width: 11, height: 11 }} />新規チケット
                          </button>
                        </PlanTooltip>
                      );
                    })()}
                    {onEditSprint && (
                      <button onClick={e => { e.stopPropagation(); onEditSprint(sprint); }}
                        style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EFF6FF"; (e.currentTarget as HTMLElement).style.color = "#2563EB"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                        <Pencil style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                    {onDeleteSprint && (
                      <button onClick={e => { e.stopPropagation(); onDeleteSprint(sprint); }}
                        style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                  </div>
                </div>
                {isExp && (() => {
                  const visibleIds = displayTickets.map(t => t.id);
                  const allSel = visibleIds.length > 0 && visibleIds.every(id => selectedTicketIds.has(id));
                  const someSel = !allSel && visibleIds.some(id => selectedTicketIds.has(id));
                  return (
                  <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "7px 16px", background: "#F4F5F6", gap: 8, alignItems: "center", borderBottom: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 2px 4px rgba(0,0,0,0.04)" }}>
                    <SelBox checked={allSel} indeterminate={someSel}
                      onClick={e => { e.stopPropagation(); setSprintSelection(displayTickets, !allSel); }} />
                    {COLS.map((col, idx) => (
                      <ColumnFilter key={col} col={col}
                        label={COL_LABELS[idx]}
                        sortCol={sprintSort.col as SortCol | "closedDate" | ""}
                        sortDir={sprintSort.dir}
                        onSort={(c, d) => handleSort(sprint.id, c, d)}
                        onClearSort={() => clearSort(sprint.id)}
                        onClose={closeCol}
                        options={getColOptions(sprint, col)}
                        selected={getSelected(sprint.id, col)}
                        onFilterChange={setColFilter(sprint.id, col)}
                        open={openCol === `${sprint.id}:${col}`}
                        onToggle={() => toggleCol(sprint.id, col)}
                        alignRight={idx >= 7}
                      />
                    ))}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>実績</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                      {hasAnyFilter && (
                        <button onClick={() => setSprintFilters(prev => ({ ...prev, [sprint.id]: {} }))} title="このテーブルのフィルタを全解除" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                          <X style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                      {(hasAnyFilter || sprintSort.col) && (() => {
                        const filterAtLimit = plan.maxFiltersPerSprint !== null && (filterCounts[sprint.id] ?? 0) >= plan.maxFiltersPerSprint;
                        return (
                          <PlanTooltip text="現在のプランではこれ以上作成できません" active={filterAtLimit} placement="bottom-left">
                            <button
                              onClick={filterAtLimit ? undefined : async (e) => {
                                e.stopPropagation();
                                const serialized: Record<string, string[]> = {};
                                Object.entries(currentFilters).forEach(([k, v]) => {
                                  if (v && v.size > 0) serialized[k] = Array.from(v);
                                });
                                const dupTitle = await checkDuplicateFilter(sprint.id, userId ?? "", serialized);
                                if (dupTitle) {
                                  showAlert(`同じ条件のフィルタ「${dupTitle}」がすでに保存されています。`, "重複エラー");
                                  return;
                                }
                                setSaveFilterTarget({
                                  sprintId: sprint.id,
                                  serializedFilters: serialized,
                                  sortCol: sprintSort.col,
                                  sortDir: sprintSort.dir as "asc" | "desc",
                                });
                              }}
                              title={filterAtLimit ? undefined : "現在の絞り込み・並び替えを保存"}
                              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: `1px solid ${filterAtLimit ? "rgba(156,163,175,0.30)" : "rgba(5,150,105,0.25)"}`, background: filterAtLimit ? "#F3F4F6" : "#ECFDF5", color: filterAtLimit ? "#9CA3AF" : "#059669", cursor: filterAtLimit ? "not-allowed" : "pointer", padding: 0, flexShrink: 0 }}
                            >
                              <Save style={{ width: 11, height: 11 }} />
                            </button>
                          </PlanTooltip>
                        );
                      })()}
                    </div>
                  </div>
                  );
                })()}
              </div>

              {isExp && (
                <div style={{ borderRadius: "0 0 12px 12px", overflow: "hidden", position: "relative", zIndex: 0 }}>
                  {displayTickets.length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center" as const, color: "#C9C4BB", fontSize: 12 }}>
                      {sprint.tickets.filter(t => !t.parentId).length === 0 ? "チケットがありません" : "条件に一致するチケットがありません"}
                    </div>
                  ) : displayTickets.map((t) => {
                    const tsm = getTicketStatusMeta(t.status, t.progress);
                    const priBg = t.priority === "high" ? "#FEF2F2" : t.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                    const priColor = t.priority === "high" ? "#DC2626" : t.priority === "medium" ? "#D97706" : "#0284C7";
                    const priLabel = t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低";
                    const children = sprint.tickets.filter(c => c.parentId === t.id);
                    const hasChildren = children.length > 0;
                    const isTicketExpanded = expandedTickets.has(t.id);
                    const toggleTicket = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedTickets(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); };

                    const displayCategory = getCategoryLabel(t);
                    const isHighlighted = t.wbs === targetTicketWbs || highlightedTicketIds.has(t.id) || bulkHighlight.has(t.wbs);
                    const baseBg = isHighlighted ? "#FFFBEB" : (t.status === "closed" || t.status === "released" || t.progress === -1 || t.progress === -2) ? "#F5F5F4" : "#FFFFFF";
                    const needsHours = t.status === "waiting-release" && (t.actualWorkHours == null);
                    const isSel = selectedTicketIds.has(t.id);

                    // 🌟 期限日当日の赤文字判定
                    const isDueAlert = isOverdueOrToday(t.dueDate, t.status, t.progress);

                    return (
                      <div key={t.id}>
                        <div onClick={() => onSelectTicket?.(t)}
                          data-wbs={t.wbs}
                          style={{ display: "grid", gridTemplateColumns: GRID, padding: "10px 16px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.05)", cursor: onSelectTicket ? "pointer" : "default", background: needsHours ? "#FFF5F5" : isSel ? "#F0FDF4" : baseBg, transition: "background 0.1s", opacity: (t.status === "closed" || t.status === "released" || t.progress === -1 || t.progress === -2) ? 0.65 : 1, outline: needsHours ? "1.5px solid rgba(239,68,68,0.30)" : "none", outlineOffset: "-1px" }}
                          onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = "#ECECEB"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = needsHours ? "#FFF5F5" : isSel ? "#F0FDF4" : baseBg; }}>
                          <SelBox checked={isSel} onClick={e => { e.stopPropagation(); toggleTicketSel(t.id); }} />
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            {needsHours && (
                              <span
                                title="工数が未入力です"
                                style={{ fontSize: 11, fontWeight: 800, color: "#EF4444", lineHeight: 1, flexShrink: 0, cursor: "default", userSelect: "none" }}
                              >!</span>
                            )}
                            {hasChildren ? (
                              <button onClick={toggleTicket} style={{ padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", alignItems: "center" }}>
                                {isTicketExpanded ? <ChevronDown style={{ width: 10, height: 10 }} /> : <ChevronRight style={{ width: 10, height: 10 }} />}
                              </button>
                            ) : <span style={{ width: 14 }} />}
                            <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{t.wbs}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <div style={{ width: 4, height: 4, borderRadius: "50%", background: priColor, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.title}</span>
                            {hasChildren && <span style={{ fontSize: 9, color: "#B0A9A4", flexShrink: 0 }}><GitBranch style={{ width: 9, height: 9, display: "inline" }} /> {children.length}</span>}
                          </div>
                          <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(t.description) || "—"}</span>

                          <div style={{ display: "flex", justifyContent: "start", minWidth: 0, paddingLeft: 4 }}>
                            <span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "left" }}>
                              {displayCategory}
                            </span>
                          </div>

                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tsm.bg, color: tsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{tsm.label}</span></div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor, width: "fit-content" }}>{priLabel}</span></div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                            <Avatar name={t.assignee} size="xs" />
                            <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.assignee || "—"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.startDate)}</span></div>

                          {/* 🌟 期限日の表示（当日以降かつ未完了なら赤文字・太字 / 未設定は『—』） */}
                          <div style={{ display: "flex", justifyContent: "center" }}>
                            <span style={{ 
                              fontSize: 10, 
                              color: isDueAlert ? "#DC2626" : "#B0A9A4", 
                              fontWeight: isDueAlert ? 800 : 400, 
                              fontFamily: "var(--font-mono)" 
                            }}>
                              {t.dueDate ? formatDate(t.dueDate) : "—"}
                            </span>
                          </div>

                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatClosedMMDD(getClosedDateFromMonitor(t)) || "—"}</span></div>
                          {(() => { const ah = calcTicketActualHours(t); return <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, color: ah > 0 ? "#059669" : "#B0A9A4" }}>{ah > 0 ? formatPersonDays(ah) : "—"}</span></div>; })()}
                        </div>

                        {/* 子チケット行 */}
                        {hasChildren && isTicketExpanded && children.map(child => {
                          const ctsm = getTicketStatusMeta(child.status, child.progress);
                          const cPriBg = child.priority === "high" ? "#FEF2F2" : child.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                          const cPriColor = child.priority === "high" ? "#DC2626" : child.priority === "medium" ? "#D97706" : "#0284C7";
                          const cPriLabel = child.priority === "high" ? "高" : child.priority === "medium" ? "中" : "低";
                          const childCategory = getCategoryLabel(child);
                          const isChildHighlighted = child.wbs === targetTicketWbs || highlightedTicketIds.has(child.id) || bulkHighlight.has(child.wbs);
                          const isChildSel = selectedTicketIds.has(child.id);
                          const childBaseBg = isChildHighlighted ? "#FFFBEB" : isChildSel ? "#F0FDF4" : (child.status === "released" || child.progress === -1 || child.progress === -2) ? "#F5F5F4" : "#F9F8F6";
                          
                          // 子チケットの期限日赤文字判定
                          const isChildDueAlert = isOverdueOrToday(child.dueDate, child.status, child.progress);

                          return (
                            <div key={child.id} onClick={() => onSelectTicket?.(child)}
                              data-wbs={child.wbs}
                              style={{ display: "grid", gridTemplateColumns: GRID, padding: "8px 16px 8px 32px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.04)", cursor: onSelectTicket ? "pointer" : "default", background: childBaseBg, transition: "background 0.1s", opacity: (child.status === "closed" || child.status === "released" || child.progress === -1 || child.progress === -2) ? 0.65 : 1 }}
                              onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = (child.progress === -1 || child.progress === -2) ? "#ECECEB" : "#EEF7F3"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = childBaseBg; }}>
                              <SelBox checked={isChildSel} onClick={e => { e.stopPropagation(); toggleTicketSel(child.id); }} />
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                <span style={{ fontSize: 9, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{child.wbs}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: 4 }}>
                                <div style={{ width: 1, height: 12, background: "rgba(26,23,20,0.15)", flexShrink: 0 }} />
                                <span style={{ fontSize: 11, fontWeight: 400, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.title}</span>
                              </div>
                              <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(child.description) || "—"}</span>

                              <div style={{ display: "flex", justifyContent: "start", minWidth: 0, paddingLeft: 4 }}>
                                <span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "left" }}>
                                  {childCategory}
                                </span>
                              </div>

                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: ctsm.bg, color: ctsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{ctsm.label}</span></div>
                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: cPriBg, color: cPriColor, width: "fit-content" }}>{cPriLabel}</span></div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {myFilterSprintId && (
        <MyFilterModal
          onClose={() => { refreshFilterCount(myFilterSprintId); setMyFilterSprintId(null); }}
          sprintId={myFilterSprintId}
          userId={userId ?? ""}
          cols={COLS.map((col, idx) => ({ col, label: COL_LABELS[idx] }))}
          getColOptions={(col) => getColOptions(sprints.find(s => s.id === myFilterSprintId)!, col)}
          onApply={(filters, sortCol, sortDir) => {
            setSprintFilters(prev => ({ ...prev, [myFilterSprintId]: filters }));
            if (sortCol) {
              setSprintSorts(prev => ({ ...prev, [myFilterSprintId]: { col: sortCol, dir: sortDir } }));
            } else {
              clearSort(myFilterSprintId);
            }
            setExpanded(prev => new Set(prev).add(myFilterSprintId));
          }}
        />
      )}

      {saveFilterTarget && (
        <SaveFilterDialog
          onClose={() => setSaveFilterTarget(null)}
          sprintId={saveFilterTarget.sprintId}
          userId={userId ?? ""}
          filters={saveFilterTarget.serializedFilters}
          onSave={async (title) => {
            const sprintId = saveFilterTarget.sprintId;
            const result = await addMyFilter(
              sprintId,
              userId ?? "",
              title,
              saveFilterTarget.serializedFilters,
              saveFilterTarget.sortCol,
              saveFilterTarget.sortDir
            );
            setSaveFilterTarget(null);
            if (result && !result.success) {
              showAlert("保存に失敗しました。\n\nエラー詳細: " + result.error, "エラー");
            } else {
              refreshFilterCount(sprintId);
              setSuccessMessage("フィルタを保存しました。「Myフィルタ」から呼び出せます。");
            }
          }}
        />
      )}

      {successMessage && (
        <DialogShell
          title="保存完了"
          onClose={() => setSuccessMessage(null)}
          size="sm"
          footer={
            <BtnPrimary onClick={() => setSuccessMessage(null)}>OK</BtnPrimary>
          }
        >
          <p style={{ fontSize: 13, color: "#1A1714", margin: 0, lineHeight: 1.5 }}>
            {successMessage}
          </p>
        </DialogShell>
      )}

      <BulkActionBar
        count={selectedTicketIds.size}
        disabled={!!assignState}
        onAssign={runBulkAssign}
        onMove={() => setBulkAction("move")}
        onCopyLinks={runBulkCopyLinks}
        onDelete={() => setBulkAction("delete")}
        onClear={clearSelection}
      />

      {bulkAction === "delete" && (
        <ConfirmDialog
          title="チケットの一括削除"
          message={`選択した ${selectedTickets.length}件 のチケットを削除します。`
            + (impliedChildCount > 0 ? `\n（子チケット ${impliedChildCount}件 も一緒に削除されます）` : "")}
          confirmLabel="削除する"
          onConfirm={runBulkDelete}
          onClose={() => setBulkAction(null)}
        />
      )}

      {bulkAction === "move" && (
        <MoveToSprintDialog
          sprints={sprints}
          count={selectedTickets.length}
          onClose={() => setBulkAction(null)}
          onConfirm={runBulkMove}
        />
      )}

      {assignState && (
        <BulkAssignProgress
          phase={assignState.phase}
          current={assignState.current}
          total={assignState.total}
          message={assignState.message}
          onClose={() => setAssignState(null)}
        />
      )}

      {bulkMenu.menu && (
        <BulkCreateMenu
          anchorRect={bulkMenu.menu.rect}
          onClose={bulkMenu.close}
          onSelect={mode => onBulkCreate?.(bulkMenu.menu!.sprintId, mode)}
        />
      )}
    </div>
  );
}