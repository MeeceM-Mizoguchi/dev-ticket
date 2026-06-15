import { useEffect, useState, useMemo, useRef } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, Trash2, ChevronDown, GitBranch, X, FolderOpen, BookmarkPlus } from "lucide-react";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { Project, Sprint, SprintTicket, TicketStatus, Priority, SortCol } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES, htmlToText, calcTicketActualHours, formatActualHours, formatPersonDays } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { MyFilterModal, addMyFilter, serializeFilters, checkDuplicateFilter } from "@/app/components/sprints/MyFilterModal";
import { SaveFilterDialog } from "@/app/components/sprints/SaveFilterDialog";
import { useAlert } from "@/app/contexts/AlertContext";

// あらゆるIDパターンに安全に対応するためのフォールバック付き辞書
const CATEGORY_MAP: Record<string, string> = {
  "CAT-1780106163889": "バグ",
  "CAT-1780106169442": "仕様確認",
  "CAT-1780106176626": "要望",
  "CAT-1780241120059": "改善",
  "CAT-1780293371590": "新規機能開発"
};

// 安全にカテゴリ名を取得するための共通ヘルパー
const getCategoryLabel = (ticket: SprintTicket): string => {
  const raw: string = (ticket as any).categoryName || (ticket as any).category?.name || ticket.categoryId || "";
  if (!raw) return "分類なし";
  if (CATEGORY_MAP[raw]) return CATEGORY_MAP[raw];
  return raw;
};

// 🌟 追加: 実績モニターのログから「リリース」または「クローズ」の最終完了日を動的に抽出するヘルパー関数
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

// 🌟 追加: ISO形式などのタイムスタンプから mm/dd を安全に抽出する専用フォーマッター
const formatClosedMMDD = (isoString: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString.slice(0, 5); // パース不能な場合のフォールバック
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
};

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
    <div style={{ position: "relative", width: "100%", display: "flex", justifyContent: "center", alignItems: "center", cursor: "pointer" }} onClick={onToggle}>
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
            position: "absolute", top: "calc(100% + 8px)",
            left: alignRight ? "auto" : 0, right: alignRight ? 0 : "auto",
            background: "#fff", borderRadius: 10, border: "1px solid rgba(26,23,20,0.10)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: "6px", zIndex: 200, minWidth: 200,
          }}>
          {/* Sort */}
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

          {/* Search */}
          <div style={{ padding: "2px 4px 4px" }}>
            <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()} placeholder="検索..."
              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(26,23,20,0.15)", fontSize: 11, outline: "none", boxSizing: "border-box" as const, color: "#1A1714", background: "#FAFAF9" }} />
          </div>

          {/* Select all */}
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

          {/* Options */}
          <div style={{ maxHeight: 200, overflowY: "auto", overscrollBehavior: "contain" }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: 8, textAlign: "center" as const, color: "#B0A9A4", fontSize: 11 }}>一致する項目がありません</div>
            ) : filteredOptions.map(opt => {
              const checked = selected.has(opt.value);
              return (
                <button key={opt.value} onClick={() => toggleOne(opt.value)} style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
                  borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
                  background: checked ? "#ECFDF5" : "transparent",
                  color: checked ? "#059669" : "#1A1714", transition: "background 0.1s",
                }}>
                  <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: checked ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: checked ? "#059669" : "transparent" }}>
                    {checked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  {opt.label}
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

function parseSprintSegment(segment: string): { sprintIdentifier: string; ticketWbs: string | null } {
  // 子チケット: {sprintId}-{3桁以上の親番号}-{子番号}  例: BRU2-016-1
  const childMatch = segment.match(/^(.+)-\d{3,}-\d+$/);
  if (childMatch) return { sprintIdentifier: childMatch[1], ticketWbs: segment };
  // 親チケット: {sprintId}-{番号}  例: BRU2-016
  const parentMatch = segment.match(/^(.+)-\d+$/);
  if (parentMatch) return { sprintIdentifier: parentMatch[1], ticketWbs: segment };
  // スプリントのみ
  return { sprintIdentifier: segment, ticketWbs: null };
}

export function SprintDetailPage() {
  const { projectSlug, segment = "" } = useParams<{ projectSlug: string; segment?: string }>();
  const { sprintIdentifier, ticketWbs } = parseSprintSegment(segment);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { showAlert } = useAlert();
  const { userId, userPermissions, userRole } = useAuth();
  const isAdminOrPM = userRole === "admin" || userRole === "project-manager";
  const [project, setProject] = useState<Project | null>(null);
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [projectPermissions, setProjectPermissions] = useState<import("@/app/types").UserPermissions | null>(null);
  const [projectPermissionsLoaded, setProjectPermissionsLoaded] = useState(false);

  const NO_PERMS: import("@/app/types").UserPermissions = { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canSkipReview: false, canAccessMembers: false, canAccessRoles: false, canAccessGroups: false };
  const effectivePermissions = projectPermissionsLoaded
    ? (projectPermissions ?? (isAdminOrPM ? userPermissions : NO_PERMS))
    : NO_PERMS;
  const canCreateTicket = effectivePermissions.canCreateTicket;
  const canEditDelete = effectivePermissions.canEditDelete;
  const [loading, setLoading] = useState(isSupabaseEnabled);

  const [sortCol, setSortCol] = useState<SortCol | "closedDate" | "">("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [openCol, setOpenCol] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTicketTarget, setDeleteTicketTarget] = useState<SprintTicket | null>(null);
  const [showMyFilterModal, setShowMyFilterModal] = useState(false);
  const [showSaveFilterDialog, setShowSaveFilterDialog] = useState(false);
  const [lastOpenedWbs, setLastOpenedWbs] = useState<string | null>(() => {
    const v = sessionStorage.getItem('hl_wbs');
    if (v) sessionStorage.removeItem('hl_wbs');
    return v;
  });
  const [scrollTick, setScrollTick] = useState(0);
  const scrollWbsRef = useRef<string | null>(null);
  const [backgroundParentWbs, setBackgroundParentWbs] = useState<string | null>(null);
  const [isParentNav, setIsParentNav] = useState(false);

  useEffect(() => {
    if (isParentNav) {
      setIsParentNav(false);
    }
  }, [ticketWbs]);

  // データ読み込み完了後、sessionStorage由来のハイライト行へスクロール
  useEffect(() => {
    if (loading || !lastOpenedWbs) return;
    scrollWbsRef.current = lastOpenedWbs;
    setScrollTick(t => t + 1);
  }, [loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // scrollTick が変わるたびに（React DOM確定後）スクロール実行
  useEffect(() => {
    if (!scrollTick || !scrollWbsRef.current) return;
    document.querySelector(`[data-wbs="${scrollWbsRef.current}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [scrollTick]);

  const selectTicket = (wbs: string | null) => {
    if (wbs) {
      navigate(`/${projectSlug}/${wbs}`, { replace: false });
    } else {
      navigate(`/${projectSlug}/${sprintIdentifier}`);
    }
  };

  useEffect(() => {
    if (!isSupabaseEnabled || !sprintIdentifier) return;
    const base = supabase!.from("sprints").select("*, sprint_tickets(*)").order("created_at", { referencedTable: "sprint_tickets" }).order("id", { referencedTable: "sprint_tickets" });
    (async () => {
      // Try by identifier first, then by ID for backward compat
      const { data: byId } = await base.eq("identifier", sprintIdentifier).maybeSingle();
      const { data: byRawId } = byId ? { data: null } : await supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintIdentifier).order("created_at", { referencedTable: "sprint_tickets" }).order("id", { referencedTable: "sprint_tickets" }).maybeSingle();
      const s = byId ?? byRawId;
      if (!s) { setProjectPermissionsLoaded(true); setLoading(false); return; }
      setSprint(mapSprint(s));
      const pid = s.project_id;
      const [{ data: p }, { data: pmp }] = await Promise.all([
        supabase!.from("projects").select("*").eq("id", pid).single(),
        userId ? supabase!.from("project_member_permissions").select("permissions").eq("project_id", pid).eq("member_id", userId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (p) setProject(mapProject(p));
      if (pmp?.permissions) setProjectPermissions(pmp.permissions as import("@/app/types").UserPermissions);
      setProjectPermissionsLoaded(true);
      setLoading(false);
    })().catch(() => { setProjectPermissionsLoaded(true); setLoading(false); });
  }, [sprintIdentifier, userId]);

  const refreshSprint = () => {
    if (!isSupabaseEnabled || !sprint) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprint.id).order("created_at", { referencedTable: "sprint_tickets" }).order("id", { referencedTable: "sprint_tickets" }).single()
      .then(({ data }) => { if (data) setSprint(mapSprint(data)); });
  };

  const handleDeleteTicket = async (ticket: SprintTicket) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("sprint_tickets").delete().eq("id", ticket.id);
      if (error) { toast("削除に失敗しました", "error"); return; }
      toast(`「${ticket.title}」を削除しました`);
    }
    refreshSprint();
    if (!isSupabaseEnabled && sprint) {
      setSprint({ ...sprint, tickets: sprint.tickets.filter(t => t.id !== ticket.id) });
    }
  };

  const allAssignees = useMemo(() => {
    if (!sprint) return [] as string[];
    const names = new Set<string>();
    sprint.tickets.forEach(t => { if (t.assignee) names.add(t.assignee); });
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ja"));
  }, [sprint]);

  // 子チケットのアコーディオン展開状態（チケットIDのSet）
  const [expandedTicketIds, setExpandedTicketIds] = useState<Set<string>>(new Set());

  // 親チケット → 子チケットのマップ（親チケットのみをリスト表示し、子はアコーディオンで展開）
  const childrenByParent = useMemo(() => {
    if (!sprint) return {} as Record<string, SprintTicket[]>;
    const map: Record<string, SprintTicket[]> = {};
    sprint.tickets.filter(t => t.parentId).forEach(t => {
      if (!map[t.parentId!]) map[t.parentId!] = [];
      map[t.parentId!].push(t);
    });
    return map;
  }, [sprint]);

  const serializedColFilters = useMemo(() => serializeFilters(colFilters), [colFilters]);

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#A09790", fontSize: 13 }}>読み込み中...</div>;
  if (!project || !sprint) return <Navigate to="/projects" replace />;

  const selectedTicket = ticketWbs
    ? (sprint.tickets.find(t => t.wbs === ticketWbs) ?? null)
    : null;
  const showParentBackground = !!backgroundParentWbs;
  const done = sprint.tickets.filter(t => t.status === "done" || t.status === "closed").length;
  const inProg = sprint.tickets.filter(t => t.status === "in-progress").length;
  const progress = sprintProgress(sprint);
  const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
  const actualHours = Math.round(sprint.tickets.reduce((s, t) => s + calcTicketActualHours(t), 0) * 10) / 10;
  const sm = getSprintStatusMeta(sprint.status);

  const statusOrder: Record<TicketStatus, number> = {
    todo: 0, "in-progress": 1, "in-review": 2, "review-done": 3, "stg-test": 4, uat: 5, done: 6, closed: 7,
  };
  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

  // Compute unique options per column from current sprint tickets
  const getColOptions = (col: string): Array<{ value: string; label: string }> => {
    const ts = sprint.tickets;
    switch (col) {
      case "wbs":
        return [...new Set(ts.map(t => t.wbs))].sort().map(v => ({ value: v, label: v }));
      case "title":
        return [...new Set(ts.map(t => t.title))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "description":
        return [...new Set(ts.map(t => htmlToText(t.description)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "status":
        return TICKET_STATUSES.map(s => ({ value: s.value, label: s.label }));
      case "priority":
        return [{ value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }];
      case "assignee":
        return allAssignees.map(v => ({ value: v, label: v }));
      case "startDate":
        return [...new Set(ts.map(t => t.startDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
      case "dueDate":
        return [...new Set(ts.map(t => t.dueDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));

      // 🌟 修正: 実績モニター解析関数と連動し、formatClosedMMDD で mm/dd に整形して選択肢を生成
      case "closedDate":
        return [...new Set(ts.map(t => getClosedDateFromMonitor(t)).filter(Boolean))]
          .sort()
          .map(v => ({ value: v, label: formatClosedMMDD(v) }));

      case "estimatedHours":
        return [...new Set(ts.map(t => String(t.estimatedHours)))].sort((a, b) => Number(a) - Number(b)).map(v => ({ value: v, label: `${v}h` }));
      case "progress":
        return [...new Set(ts.map(t => String(t.progress)))].sort((a, b) => Number(a) - Number(b)).map(v => ({ value: v, label: `${v}%` }));
      case "category":
        return [...new Set(ts.map(t => getCategoryLabel(t)))]
          .sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      default: return [];
    }
  };

  const getSelected = (col: string): Set<string> => colFilters[col] ?? new Set();
  const setColFilter = (col: string) => (s: Set<string>) => setColFilters(prev => ({ ...prev, [col]: s }));
  const toggleCol = (col: string) => setOpenCol(prev => prev === col ? "" : col);
  const closeCol = () => setOpenCol("");
  const handleSort = (col: SortCol | "closedDate", dir: "asc" | "desc") => { setSortCol(col); setSortDir(dir); };
  const clearSort = () => setSortCol("");

  const displayTickets = [...sprint.tickets]
    .filter(t => !t.parentId) // 親チケットのみ表示（子チケットはアコーディオンで展開）
    .filter(t => {
      const catName = getCategoryLabel(t);
      const checks: [string, string][] = [
        ["wbs", t.wbs], ["title", t.title], ["description", htmlToText(t.description)], ["status", t.status], ["priority", t.priority],
        ["assignee", t.assignee || ""], ["startDate", t.startDate || ""], ["dueDate", t.dueDate || ""], ["closedDate", getClosedDateFromMonitor(t)],
        ["estimatedHours", String(t.estimatedHours)], ["progress", String(t.progress)],
        ["category", catName],
      ];
      return checks.every(([col, val]) => { const f = colFilters[col]; return !f || f.size === 0 || f.has(val); });
    })
    .sort((a, b) => {
      let v = 0;
      if (sortCol === "wbs") v = a.wbs.localeCompare(b.wbs);
      else if (sortCol === "title") v = a.title.localeCompare(b.title);
      else if (sortCol === "description") v = htmlToText(a.description).localeCompare(htmlToText(b.description), "ja");
      else if (sortCol === "status") v = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      else if (sortCol === "priority") v = priorityOrder[a.priority] - priorityOrder[b.priority];
      else if (sortCol === "assignee") v = (a.assignee || "").localeCompare(b.assignee || "", "ja");
      else if (sortCol === "startDate") v = (a.startDate || "").localeCompare(b.startDate || "");
      else if (sortCol === "dueDate") v = (a.dueDate || "").localeCompare(b.dueDate || "");
      else if (sortCol === "closedDate") v = getClosedDateFromMonitor(a).localeCompare(getClosedDateFromMonitor(b));
      else if (sortCol === "estimatedHours") v = a.estimatedHours - b.estimatedHours;
      else if (sortCol === "progress") v = a.progress - b.progress;
      else if (sortCol === "category") v = getCategoryLabel(a).localeCompare(getCategoryLabel(b), "ja");
      if (v === 0) v = a.id.localeCompare(b.id);
      return sortDir === "asc" ? v : -v;
    });

  const commonProps = { sortCol, sortDir, onSort: handleSort, onClearSort: clearSort, onClose: closeCol };
  const GRID = "76px 1fr 1fr 100px 90px 60px 100px 72px 72px 72px 60px 52px 130px 52px";

  const DETAIL_COL_DEFS = [
    { col: "wbs", label: "No" },
    { col: "title", label: "チケット名" },
    { col: "description", label: "チケット詳細" },
    { col: "category", label: "分類" },
    { col: "status", label: "ステータス" },
    { col: "priority", label: "優先度" },
    { col: "assignee", label: "担当者" },
    { col: "startDate", label: "開始日" },
    { col: "dueDate", label: "終了日" },
    { col: "closedDate", label: "クローズ日" },
    { col: "estimatedHours", label: "工数" },
    { col: "progress", label: "進捗" },
  ];

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <button onClick={() => { if (selectedTicket?.wbs) sessionStorage.setItem('hl_wbs', selectedTicket.wbs); navigate(`/${projectSlug}`); }} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>スプリント一覧</button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{sprint.name}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>{sprint.name}</h1>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 10px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
          </div>
          <p style={{ fontSize: 12, color: "#A09790" }}>{sprint.goal}</p>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 4, fontFamily: "var(--font-mono)" }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 10 }}>
            {[{ label: "チケット数", value: sprint.tickets.length, accent: false }, { label: "完了", value: done, accent: false }, { label: "進行中", value: inProg, accent: false }, { label: "総工数(h)", value: totalHours, accent: false }, { label: "実績(人日)", value: formatActualHours(actualHours), accent: actualHours > 0 }, { label: "進捗", value: `${progress}%`, accent: false }].map(({ label, value, accent }) => (
              <div key={label} style={{ background: "#FFFFFF", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(26,23,20,0.08)", textAlign: "center" as const, minWidth: 80 }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: accent ? "#059669" : "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>{value}</p>
                <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 2 }}>{label}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setShowMyFilterModal(true)}
            title="Myフィルタ"
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "#ECFDF5", color: "#059669", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid rgba(5,150,105,0.20)", cursor: "pointer", flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
            <FolderOpen style={{ width: 14, height: 14 }} />Myフィルタ
          </button>
          {canCreateTicket && (
            <button onClick={() => setShowCreate(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
              <Plus style={{ width: 15, height: 15 }} />チケット作成
            </button>
          )}
        </div>
      </div>

      {openCol && <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={closeCol} />}

      <div style={{ borderRadius: 14, border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "10px 16px", background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.06)", gap: 8, alignItems: "center", borderRadius: "14px 14px 0 0", position: "sticky", top: 0, zIndex: openCol ? 100 : 10, boxShadow: "0 2px 4px rgba(0,0,0,0.04)" }}>
          {(["wbs", "title", "description", "category", "status", "priority", "assignee", "startDate", "dueDate", "closedDate"] as const).map((col, idx) => (
            <ColumnFilter key={col} col={col}
              label={["No", "チケット名", "チケット詳細", "分類", "ステータス", "優先度", "担当者", "開始日", "終了日", "クローズ日"][idx]}
              {...commonProps}
              options={getColOptions(col)}
              selected={getSelected(col)}
              onFilterChange={setColFilter(col)}
              open={openCol === col}
              onToggle={() => toggleCol(col)}
              alignRight={false}
            />
          ))}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>実績</span>
          </div>
          {(["estimatedHours", "progress"] as const).map((col, idx) => (
            <ColumnFilter key={col} col={col}
              label={["工数", "進捗"][idx]}
              {...commonProps}
              options={getColOptions(col)}
              selected={getSelected(col)}
              onFilterChange={setColFilter(col)}
              open={openCol === col}
              onToggle={() => toggleCol(col)}
              alignRight={true}
            />
          ))}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            {Object.values(colFilters).some(s => s.size > 0) && (
              <button onClick={async () => {
                const dupName = await checkDuplicateFilter(sprint?.id!, userId, serializedColFilters);
                if (dupName) { showAlert(`「${dupName}」と同じ条件のフィルタが既に保存されています`, "重複するフィルタ"); return; }
                setShowSaveFilterDialog(true);
              }} title="現在のフィルタを保存" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(5,150,105,0.25)", background: "#ECFDF5", color: "#059669", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                <BookmarkPlus style={{ width: 11, height: 11 }} />
              </button>
            )}
            {Object.values(colFilters).some(s => s.size > 0) && (
              <button onClick={() => setColFilters({})} title="フィルタを全解除" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                <X style={{ width: 11, height: 11 }} />
              </button>
            )}
          </div>
        </div>

        {/* Data rows */}
        <div style={{ background: "#FFFFFF", borderRadius: "0 0 14px 14px", overflow: "hidden", position: "relative", zIndex: 0 }}>
          {displayTickets.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center" as const, color: "#B0A9A4", fontSize: 13 }}>
              {sprint.tickets.filter(t => !t.parentId).length === 0 ? "チケットがありません" : "条件に一致するチケットがありません"}
            </div>
          ) : displayTickets.map((ticket, i) => {
            const isTerminal = ticket.status === "closed" || ticket.status === "released";
            const tsm = TICKET_STATUSES.find(s => s.value === ticket.status) ?? TICKET_STATUSES[0];
            const priBg = ticket.priority === "high" ? "#FEF2F2" : ticket.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
            const priColor = ticket.priority === "high" ? "#DC2626" : ticket.priority === "medium" ? "#D97706" : "#0284C7";
            const priLabel = ticket.priority === "high" ? "高" : ticket.priority === "medium" ? "中" : "低";
            const ticketProgress = (ticket.status === "done" || ticket.status === "closed" || ticket.status === "released" || ticket.status === "waiting-release") ? 100 : ticket.progress;
            const barColor = ticketProgress === 100 ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#C9C4BB";
            const children = childrenByParent[ticket.id] ?? [];
            const hasChildren = children.length > 0;
            const isTicketExpanded = expandedTicketIds.has(ticket.id);
            const toggleTicketExpand = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedTicketIds(prev => { const n = new Set(prev); n.has(ticket.id) ? n.delete(ticket.id) : n.add(ticket.id); return n; }); };

            const displayCategory = getCategoryLabel(ticket);

            return (
              <div key={ticket.id}>
                <div onClick={() => selectTicket(ticket.wbs || ticket.id)}
                  data-wbs={ticket.wbs}
                  style={{ display: "grid", gridTemplateColumns: GRID, padding: "11px 16px", alignItems: "center", gap: 8, borderBottom: !isTicketExpanded && i < displayTickets.length - 1 ? "1px solid rgba(26,23,20,0.04)" : "none", background: ticket.wbs === lastOpenedWbs ? "#FFFBEB" : isTerminal ? "#F5F5F4" : "transparent", transition: "background 0.1s", cursor: "pointer", opacity: isTerminal ? 0.65 : 1 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = isTerminal ? "#ECECEB" : "#FFF7F3"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ticket.wbs === lastOpenedWbs ? "#FFFBEB" : isTerminal ? "#F5F5F4" : "transparent"; }}>
                  <div style={{ display: "flex", justifyContent: "center", gap: 3, alignItems: "center" }}>
                    {hasChildren ? (
                      <button onClick={toggleTicketExpand} style={{ padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
                        {isTicketExpanded ? <ChevronDown style={{ width: 10, height: 10 }} /> : <ChevronRight style={{ width: 10, height: 10 }} />}
                      </button>
                    ) : <span style={{ width: 14 }} />}
                    <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#059669", fontWeight: 700, whiteSpace: "nowrap" }}>{ticket.wbs}</span>
                  </div>
                  <div style={{ display: "grid", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div style={{ width: 4, height: 4, borderRadius: "50%", background: priColor, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{ticket.title}</span>
                      {hasChildren && <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 9, color: "#B0A9A4", flexShrink: 0 }}><GitBranch style={{ width: 9, height: 9 }} />{children.length}</span>}
                    </div>
                  </div>
                  <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(ticket.description) || "—"}</span>

                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{displayCategory}</span></div>

                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tsm.bg, color: tsm.color, display: "inline-block" }}>{tsm.label}</span></div>
                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor, display: "inline-block" }}>{priLabel}</span></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                    <Avatar name={ticket.assignee} size="xs" />
                    <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{ticket.assignee.split(/[\s ]/)[0]}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(ticket.startDate)}</span></div>
                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(ticket.dueDate)}</span></div>

                  {/* 🌟 修正: 親チケットのクローズ日表示を専用フォーマッタ(formatClosedMMDD)に切り替え */}
                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatClosedMMDD(getClosedDateFromMonitor(ticket)) || "—"}</span></div>

                  {(() => { const ah = calcTicketActualHours(ticket); return <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 600, color: ah > 0 ? "#059669" : "#B0A9A4" }}>{ah > 0 ? formatPersonDays(ah) : "—"}</span></div>; })()}

                  <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#6B6458", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{ticket.estimatedHours}h</span></div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                    <div style={{ flex: 1, height: 5, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${ticketProgress}%`, background: barColor, borderRadius: 99 }} />
                    </div>
                    <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#6B6458", fontWeight: 600, minWidth: 28 }}>{ticketProgress}%</span>
                  </div>
                  {canEditDelete ? (
                    <button onClick={e => { e.stopPropagation(); setDeleteTicketTarget(ticket); }}
                      style={{ padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                      <Trash2 style={{ width: 12, height: 12 }} />
                    </button>
                  ) : <span />}
                </div>
                {/* 子チケット行（アコーディオン展開時） */}
                {hasChildren && isTicketExpanded && children.map(child => {
                  const cIsTerminal = child.status === "closed" || child.status === "released";
                  const ctsm = TICKET_STATUSES.find(s => s.value === child.status) ?? TICKET_STATUSES[0];
                  const cPriBg = child.priority === "high" ? "#FEF2F2" : child.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                  const cPriColor = child.priority === "high" ? "#DC2626" : child.priority === "medium" ? "#D97706" : "#0284C7";
                  const cPriLabel = child.priority === "high" ? "高" : child.priority === "medium" ? "中" : "低";
                  const cProgress = (child.status === "done" || child.status === "closed" || child.status === "released" || child.status === "waiting-release") ? 100 : child.progress;
                  const cBarColor = cProgress === 100 ? "#059669" : child.status === "in-progress" ? "#D97706" : "#C9C4BB";

                  const childCategory = getCategoryLabel(child);

                  return (
                    <div key={child.id} onClick={() => selectTicket(child.wbs || child.id)}
                      style={{ display: "grid", gridTemplateColumns: GRID, padding: "9px 16px 9px 32px", alignItems: "center", gap: 8, borderBottom: "1px solid rgba(26,23,20,0.04)", background: "#F9F8F6", transition: "background 0.1s", cursor: "pointer", opacity: cIsTerminal ? 0.65 : 1 }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EEF7F3"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}>
                      <div style={{ display: "flex", justifyContent: "center" }}>
                        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#059669", fontWeight: 700, whiteSpace: "nowrap" }}>{child.wbs}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        <div style={{ width: 1, height: 12, background: "rgba(26,23,20,0.15)", flexShrink: 0 }} />
                        <span style={{ fontSize: 11, fontWeight: 400, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.title}</span>
                      </div>
                      <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(child.description) || "—"}</span>

                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{childCategory}</span></div>

                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: ctsm.bg, color: ctsm.color, display: "inline-block" }}>{ctsm.label}</span></div>
                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: cPriBg, color: cPriColor, display: "inline-block" }}>{cPriLabel}</span></div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                        <Avatar name={child.assignee} size="xs" />
                        <span style={{ fontSize: 10, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.assignee.split(/[\s ]/)[0]}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(child.startDate)}</span></div>
                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(child.dueDate)}</span></div>

                      {/* 🌟 修正: 子チケットのクローズ日表示を専用フォーマッタ(formatClosedMMDD)に切り替え */}
                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatClosedMMDD(getClosedDateFromMonitor(child)) || "—"}</span></div>

                      {(() => { const ah = calcTicketActualHours(child); return <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, color: ah > 0 ? "#059669" : "#B0A9A4" }}>{ah > 0 ? formatPersonDays(ah) : "—"}</span></div>; })()}

                      <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#6B6458", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{child.estimatedHours}h</span></div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                        <div style={{ flex: 1, height: 5, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${cProgress}%`, background: cBarColor, borderRadius: 99 }} />
                        </div>
                        <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#6B6458", fontWeight: 600, minWidth: 28 }}>{cProgress}%</span>
                      </div>
                      {canEditDelete ? (
                        <button onClick={e => { e.stopPropagation(); setDeleteTicketTarget(child); }}
                          style={{ padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                          <Trash2 style={{ width: 12, height: 12 }} />
                        </button>
                      ) : <span />}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {showCreate && <NewTicketDialog sprintId={sprint.id} projectId={project?.id} onClose={() => setShowCreate(false)} onCreated={refreshSprint} sprintStartDate={sprint.startDate || undefined} sprintEndDate={sprint.endDate || undefined} />}
      {deleteTicketTarget && (
        <ConfirmDialog message={`「${deleteTicketTarget.title}」を削除しますか？`} onConfirm={() => handleDeleteTicket(deleteTicketTarget)} onClose={() => setDeleteTicketTarget(null)} />
      )}
      <TicketDetailPanel
        ticket={selectedTicket}
        projectId={project?.id}
        sprintId={sprint?.id}
        sprintSlug={sprint?.identifier || undefined}
        projectSlug={projectSlug}
        onClose={() => {
          const wbs = selectedTicket?.wbs ?? null;
          if (wbs) {
            setLastOpenedWbs(wbs);
            scrollWbsRef.current = wbs;
            setScrollTick(t => t + 1);
          }
          setBackgroundParentWbs(null);
          navigate(`/${projectSlug}/${sprintIdentifier}`);
        }}
        onUpdated={refreshSprint}
        onDeleted={() => { setBackgroundParentWbs(null); selectTicket(null); refreshSprint(); }}
        onSelectTicket={t => {
          const wbs = t.wbs || t.id;
          if (wbs === backgroundParentWbs) {
            // strip/Esc: 背景の親に戻る → 背景解除
            setBackgroundParentWbs(null);
            setIsParentNav(true);
          } else if (selectedTicket && t.parentId === selectedTicket.id) {
            // 親から子を開く → 現在チケットを背景に
            setBackgroundParentWbs(ticketWbs ?? null);
            setIsParentNav(false);
          } else {
            setBackgroundParentWbs(null);
            setIsParentNav(false);
          }
          selectTicket(wbs);
        }}
        showParentBackground={showParentBackground}
        projectPermissions={projectPermissions ?? undefined}
        forceNoAnim={isParentNav}
      />

      {showMyFilterModal && (
        <MyFilterModal
          onClose={() => setShowMyFilterModal(false)}
          sprintId={sprint?.id!}
          userId={userId}
          cols={DETAIL_COL_DEFS}
          getColOptions={getColOptions}
          onApply={(filters, sc, sd) => {
            setColFilters(filters);
            setSortCol(sc);
            setSortDir(sd);
          }}
        />
      )}
      {showSaveFilterDialog && (
        <SaveFilterDialog
          onClose={() => setShowSaveFilterDialog(false)}
          onSave={async (title) => {
            await addMyFilter(sprint?.id!, userId, title, serializedColFilters, sortCol, sortDir);
            setShowSaveFilterDialog(false);
          }}
        />
      )}
    </div>
  );
}