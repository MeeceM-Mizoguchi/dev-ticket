import { useEffect, useState, useMemo } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, Trash2, ChevronDown } from "lucide-react";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { Project, Sprint, SprintTicket, TicketStatus, Priority, SortCol } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";

function ColumnFilter({
  col, label, sortCol, sortDir, onSort, onClearSort,
  options, selected, onFilterChange,
  open, onToggle, onClose, alignRight,
}: {
  col: SortCol;
  label: string;
  sortCol: SortCol | "";
  sortDir: "asc" | "desc";
  onSort: (col: SortCol, dir: "asc" | "desc") => void;
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
    <div style={{ position: "relative", width: "100%" }}>
      <button onClick={onToggle} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none",
        cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700, width: "100%",
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

export function SprintDetailPage() {
  const { projectId, sprintId } = useParams<{ projectId: string; sprintId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const { userId } = useAuth();
  const [project, setProject] = useState<Project | null>(PROJECTS.find(p => p.id === projectId) || null);
  const [sprint, setSprint] = useState<Sprint | null>(SPRINTS.find(s => s.id === sprintId) || null);
  const [projectPermissions, setProjectPermissions] = useState<import("@/app/types").UserPermissions | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);

  const [sortCol, setSortCol] = useState<SortCol | "">("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [openCol, setOpenCol] = useState<string>("");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(searchParams.get("ticket"));
  const [deleteTicketTarget, setDeleteTicketTarget] = useState<SprintTicket | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !sprintId || !projectId) return;
    Promise.all([
      supabase!.from("projects").select("*").eq("id", projectId).single(),
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintId).order("created_at", { referencedTable: "sprint_tickets" }).single(),
      userId ? supabase!.from("project_member_permissions").select("permissions").eq("project_id", projectId).eq("member_id", userId).maybeSingle() : Promise.resolve({ data: null }),
    ]).then(([{ data: p }, { data: s }, { data: pmp }]) => {
      if (p) setProject(mapProject(p));
      if (s) setSprint(mapSprint(s));
      if (pmp?.permissions) setProjectPermissions(pmp.permissions as import("@/app/types").UserPermissions);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sprintId, projectId, userId]);

  const refreshSprint = () => {
    if (!isSupabaseEnabled || !sprintId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintId).order("created_at", { referencedTable: "sprint_tickets" }).single()
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

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#A09790", fontSize: 13 }}>読み込み中...</div>;
  if (!project || !sprint) return <Navigate to="/projects" replace />;

  const selectedTicket = sprint.tickets.find(t => t.id === selectedTicketId) ?? null;
  const done = sprint.tickets.filter(t => t.status === "done").length;
  const inProg = sprint.tickets.filter(t => t.status === "in-progress").length;
  const progress = sprintProgress(sprint);
  const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
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
      case "estimatedHours":
        return [...new Set(ts.map(t => String(t.estimatedHours)))].sort((a, b) => Number(a) - Number(b)).map(v => ({ value: v, label: `${v}h` }));
      case "progress":
        return [...new Set(ts.map(t => String(t.progress)))].sort((a, b) => Number(a) - Number(b)).map(v => ({ value: v, label: `${v}%` }));
      default: return [];
    }
  };

  const getSelected = (col: string): Set<string> => colFilters[col] ?? new Set();
  const setColFilter = (col: string) => (s: Set<string>) => setColFilters(prev => ({ ...prev, [col]: s }));
  const toggleCol = (col: string) => setOpenCol(prev => prev === col ? "" : col);
  const closeCol = () => setOpenCol("");
  const handleSort = (col: SortCol, dir: "asc" | "desc") => { setSortCol(col); setSortDir(dir); };
  const clearSort = () => setSortCol("");

  const displayTickets = [...sprint.tickets]
    .filter(t => {
      const checks: [string, string][] = [
        ["wbs", t.wbs], ["title", t.title], ["status", t.status], ["priority", t.priority],
        ["assignee", t.assignee || ""], ["startDate", t.startDate || ""], ["dueDate", t.dueDate || ""],
        ["estimatedHours", String(t.estimatedHours)], ["progress", String(t.progress)],
      ];
      return checks.every(([col, val]) => { const f = colFilters[col]; return !f || f.size === 0 || f.has(val); });
    })
    .sort((a, b) => {
      let v = 0;
      if (sortCol === "wbs") v = a.wbs.localeCompare(b.wbs);
      else if (sortCol === "title") v = a.title.localeCompare(b.title);
      else if (sortCol === "status") v = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
      else if (sortCol === "priority") v = priorityOrder[a.priority] - priorityOrder[b.priority];
      else if (sortCol === "assignee") v = (a.assignee || "").localeCompare(b.assignee || "", "ja");
      else if (sortCol === "startDate") v = (a.startDate || "").localeCompare(b.startDate || "");
      else if (sortCol === "dueDate") v = (a.dueDate || "").localeCompare(b.dueDate || "");
      else if (sortCol === "estimatedHours") v = a.estimatedHours - b.estimatedHours;
      else if (sortCol === "progress") v = a.progress - b.progress;
      if (v === 0) v = a.id.localeCompare(b.id);
      return sortDir === "asc" ? v : -v;
    });

  const commonProps = { sortCol, sortDir, onSort: handleSort, onClearSort: clearSort, onClose: closeCol };
  const GRID = "56px 1fr 90px 60px 100px 72px 72px 52px 130px 36px";

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <button onClick={() => navigate(`/projects/${projectId}/sprints`)} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>スプリント一覧</button>
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
            {[{ label: "チケット数", value: sprint.tickets.length }, { label: "完了", value: done }, { label: "進行中", value: inProg }, { label: "総工数(h)", value: totalHours }, { label: "進捗", value: `${progress}%` }].map(({ label, value }) => (
              <div key={label} style={{ background: "#FFFFFF", borderRadius: 10, padding: "10px 14px", border: "1px solid rgba(26,23,20,0.08)", textAlign: "center" as const }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.03em" }}>{value}</p>
                <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 2 }}>{label}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setShowCreate(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <Plus style={{ width: 15, height: 15 }} />チケット作成
          </button>
        </div>
      </div>

      {openCol && <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={closeCol} />}

      <div style={{ borderRadius: 14, border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
        {/* Column headers */}
        <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "10px 16px", background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.06)", gap: 8, alignItems: "center", borderRadius: "14px 14px 0 0" }}>
          {(["wbs","title","status","priority","assignee","startDate","dueDate","estimatedHours","progress"] as const).map((col, idx) => (
            <ColumnFilter key={col} col={col}
              label={["WBS","チケット名","ステータス","優先度","担当者","開始日","終了日","工数","進捗"][idx]}
              {...commonProps}
              options={getColOptions(col)}
              selected={getSelected(col)}
              onFilterChange={setColFilter(col)}
              open={openCol === col}
              onToggle={() => toggleCol(col)}
              alignRight={idx >= 7}
            />
          ))}
          <span />
        </div>

        {/* Data rows */}
        <div style={{ background: "#FFFFFF", borderRadius: "0 0 14px 14px", overflow: "hidden" }}>
          {displayTickets.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center" as const, color: "#B0A9A4", fontSize: 13 }}>
              {sprint.tickets.length === 0 ? "チケットがありません" : "条件に一致するチケットがありません"}
            </div>
          ) : displayTickets.map((ticket, i) => {
            const tsm = TICKET_STATUSES.find(s => s.value === ticket.status) ?? TICKET_STATUSES[0];
            const priBg = ticket.priority === "high" ? "#FEF2F2" : ticket.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
            const priColor = ticket.priority === "high" ? "#DC2626" : ticket.priority === "medium" ? "#D97706" : "#0284C7";
            const priLabel = ticket.priority === "high" ? "高" : ticket.priority === "medium" ? "中" : "低";
            const barColor = ticket.progress === 100 ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#C9C4BB";
            return (
              <div key={ticket.id} onClick={() => setSelectedTicketId(ticket.id)}
                style={{ display: "grid", gridTemplateColumns: GRID, padding: "11px 16px", alignItems: "center", gap: 8, borderBottom: i < displayTickets.length - 1 ? "1px solid rgba(26,23,20,0.04)" : "none", background: i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent", transition: "background 0.1s", cursor: "pointer" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF7F3"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent"; }}>
                <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#B0A9A4", fontWeight: 600 }}>{ticket.wbs}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: priColor, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{ticket.title}</span>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tsm.bg, color: tsm.color, display: "inline-block" }}>{tsm.label}</span>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor, display: "inline-block" }}>{priLabel}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                  <Avatar name={ticket.assignee} size="xs" />
                  <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{ticket.assignee.split(/[\s　]/)[0]}</span>
                </div>
                <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(ticket.startDate)}</span>
                <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(ticket.dueDate)}</span>
                <span style={{ fontSize: 11, color: "#6B6458", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{ticket.estimatedHours}h</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ flex: 1, height: 5, background: "#EDE9E0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${ticket.progress}%`, background: barColor, borderRadius: 99 }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#6B6458", fontWeight: 600, minWidth: 28 }}>{ticket.progress}%</span>
                </div>
                <button onClick={e => { e.stopPropagation(); setDeleteTicketTarget(ticket); }}
                  style={{ padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                  <Trash2 style={{ width: 12, height: 12 }} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {showCreate && <NewTicketDialog sprintId={sprintId!} projectId={projectId} onClose={() => setShowCreate(false)} onCreated={refreshSprint} sprintStartDate={sprint.startDate || undefined} sprintEndDate={sprint.endDate || undefined} />}
      {deleteTicketTarget && (
        <ConfirmDialog message={`「${deleteTicketTarget.title}」を削除しますか？`} onConfirm={() => handleDeleteTicket(deleteTicketTarget)} onClose={() => setDeleteTicketTarget(null)} />
      )}
      <TicketDetailPanel ticket={selectedTicket} projectId={projectId} onClose={() => setSelectedTicketId(null)} onUpdated={refreshSprint} onDeleted={() => { setSelectedTicketId(null); refreshSprint(); }} projectPermissions={projectPermissions ?? undefined} />
    </div>
  );
}
