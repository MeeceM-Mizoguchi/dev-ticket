import { useState, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight, Trash2, ExternalLink, Plus, Pencil, GitBranch, X } from "lucide-react";
import type { Sprint, SprintTicket, SortCol } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES, computeSprintStatus, htmlToText } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";

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
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: "6px", zIndex: 200, minWidth: 190,
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

export function SprintListView({ sprints, onSelectSprint, onDeleteSprint, onEditSprint, onSelectTicket, onCreateTicket, targetTicketWbs }: {
  sprints: Sprint[];
  onSelectSprint: (s: Sprint) => void;
  onDeleteSprint?: (s: Sprint) => void;
  onEditSprint?: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onCreateTicket?: (sprintId: string) => void;
  targetTicketWbs?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(sprints.map(s => s.id)));

  useEffect(() => {
    setExpanded(prev => new Set([...prev, ...sprints.map(s => s.id)]));
  }, [sprints.map(s => s.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!targetTicketWbs) return;
    const sprint = sprints.find(s => s.tickets.some(t => t.wbs === targetTicketWbs));
    if (sprint) setExpanded(prev => new Set([...prev, sprint.id]));
  }, [targetTicketWbs, sprints]); // eslint-disable-line react-hooks/exhaustive-deps
  // 子チケット展開状態（チケットIDのSet）
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  const [sortCol, setSortCol] = useState<SortCol | "">("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colFilters, setColFilters] = useState<Record<string, Set<string>>>({});
  const [openCol, setOpenCol] = useState<string>("");

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // All tickets across all sprints for computing unique filter options
  const allTickets = useMemo(() => sprints.flatMap(s => s.tickets), [sprints]);

  const getColOptions = (col: string): Array<{ value: string; label: string }> => {
    switch (col) {
      case "wbs":
        return [...new Set(allTickets.map(t => t.wbs))].sort().map(v => ({ value: v, label: v }));
      case "title":
        return [...new Set(allTickets.map(t => t.title))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "description":
        return [...new Set(allTickets.map(t => htmlToText(t.description)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "status":
        return TICKET_STATUSES.map(s => ({ value: s.value, label: s.label }));
      case "priority":
        return [{ value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }];
      case "assignee":
        return [...new Set(allTickets.map(t => t.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "startDate":
        return [...new Set(allTickets.map(t => t.startDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
      case "dueDate":
        return [...new Set(allTickets.map(t => t.dueDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
      default: return [];
    }
  };

  const getSelected = (col: string): Set<string> => colFilters[col] ?? new Set();
  const setColFilter = (col: string) => (s: Set<string>) => setColFilters(prev => ({ ...prev, [col]: s }));

  // openCol uses "sprintId:col" key to avoid multiple open dropdowns across sprint tables
  const toggleCol = (sprintId: string, col: string) => {
    const key = `${sprintId}:${col}`;
    setOpenCol(prev => prev === key ? "" : key);
  };
  const closeCol = () => setOpenCol("");
  const handleSort = (col: SortCol, dir: "asc" | "desc") => { setSortCol(col); setSortDir(dir); };
  const clearSort = () => setSortCol("");

  const processTickets = (tickets: SprintTicket[]) => {
    // 親チケットのみをフィルタリング対象とする（子チケットはアコーディオンで表示）
    const parents = tickets.filter(t => !t.parentId);
    const filtered = parents.filter(t => {
      const checks: [string, string][] = [
        ["wbs", t.wbs], ["title", t.title], ["description", htmlToText(t.description)], ["status", t.status], ["priority", t.priority],
        ["assignee", t.assignee || ""], ["startDate", t.startDate || ""], ["dueDate", t.dueDate || ""],
      ];
      return checks.every(([col, val]) => { const f = colFilters[col]; return !f || f.size === 0 || f.has(val); });
    });
    if (!sortCol) return filtered;
    return [...filtered].sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      const av = (a[sortCol as keyof SprintTicket] ?? "") as string | number;
      const bv = (b[sortCol as keyof SprintTicket] ?? "") as string | number;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ja") * dir;
    });
  };

  if (!sprints.length) return (
    <div style={{ padding: "48px 0", textAlign: "center", color: "#C9C4BB", fontSize: 13 }}>スプリントがありません</div>
  );

  const COLS = ["wbs", "title", "description", "status", "priority", "assignee", "startDate", "dueDate"] as const;
  const COL_LABELS = ["スプリントNo", "チケット名", "チケット詳細", "ステータス", "優先度", "担当者", "開始日", "期限日"];
  const GRID = "72px 1fr 1fr 110px 56px 110px 68px 68px 32px";

  const commonSort = { sortCol, sortDir, onSort: handleSort, onClearSort: clearSort, onClose: closeCol };

  return (
    <div>
      {openCol && <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={closeCol} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sprints.map(sprint => {
          const isExp = expanded.has(sprint.id);
          const sm = getSprintStatusMeta(computeSprintStatus(sprint));
          const progress = sprintProgress(sprint);
          const done = sprint.tickets.filter(t => t.status === "done" || t.status === "closed").length;
          const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
          const displayTickets = processTickets(sprint.tickets);

          return (
            <div key={sprint.id} style={{ borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              {/* Sticky: sprint header + column headers */}
              <div style={{ position: "sticky", top: 0, zIndex: openCol.startsWith(`${sprint.id}:`) ? 100 : 10 }}>
                {/* Sprint header */}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", background: "#F9F8F6", cursor: "pointer", borderBottom: isExp ? "1px solid rgba(26,23,20,0.06)" : "none", borderRadius: isExp ? "12px 12px 0 0" : 12 }}
                  onClick={() => toggle(sprint.id)}>
                  <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4", transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{sprint.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
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
                    <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>
                    <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 7, cursor: "pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                      <ExternalLink style={{ width: 11, height: 11 }} />詳細
                    </button>
                    {onCreateTicket && (
                      <button onClick={e => { e.stopPropagation(); onCreateTicket(sprint.id); }}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#7C3AED", background: "#F5F3FF", border: "1px solid rgba(124,58,237,0.20)", borderRadius: 7, cursor: "pointer" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EDE9FE"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F5F3FF"; }}>
                        <Plus style={{ width: 11, height: 11 }} />新規チケット
                      </button>
                    )}
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
                {/* Column headers with filters */}
                {isExp && (
                  <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "7px 16px", background: "#F4F5F6", gap: 8, alignItems: "center", borderBottom: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 2px 4px rgba(0,0,0,0.04)" }}>
                    {COLS.map((col, idx) => (
                      <ColumnFilter key={col} col={col}
                        label={COL_LABELS[idx]}
                        {...commonSort}
                        options={getColOptions(col)}
                        selected={getSelected(col)}
                        onFilterChange={setColFilter(col)}
                        open={openCol === `${sprint.id}:${col}`}
                        onToggle={() => toggleCol(sprint.id, col)}
                        alignRight={idx >= 6}
                      />
                    ))}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {Object.values(colFilters).some(s => s.size > 0) && (
                        <button onClick={() => setColFilters({})} title="フィルタを全解除" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                          <X style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Ticket rows */}
              {isExp && (
                <div style={{ borderRadius: "0 0 12px 12px", overflow: "hidden", position: "relative", zIndex: 0 }}>
                  {displayTickets.length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center" as const, color: "#C9C4BB", fontSize: 12 }}>
                      {sprint.tickets.filter(t => !t.parentId).length === 0 ? "チケットがありません" : "条件に一致するチケットがありません"}
                    </div>
                  ) : displayTickets.map((t) => {
                    const tsm = TICKET_STATUSES.find(s => s.value === t.status) ?? TICKET_STATUSES[0];
                    const priBg = t.priority === "high" ? "#FEF2F2" : t.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                    const priColor = t.priority === "high" ? "#DC2626" : t.priority === "medium" ? "#D97706" : "#0284C7";
                    const priLabel = t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低";
                    const children = sprint.tickets.filter(c => c.parentId === t.id);
                    const hasChildren = children.length > 0;
                    const isTicketExpanded = expandedTickets.has(t.id);
                    const toggleTicket = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedTickets(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); };
                    return (
                      <div key={t.id}>
                        <div onClick={() => onSelectTicket?.(t)}
                          style={{ display: "grid", gridTemplateColumns: GRID, padding: "10px 16px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.05)", cursor: onSelectTicket ? "pointer" : "default", background: t.status === "closed" ? "#F5F5F4" : "#FFFFFF", transition: "background 0.1s", opacity: t.status === "closed" ? 0.65 : 1 }}
                          onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = t.status === "closed" ? "#ECECEB" : "#F0F9F5"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = t.status === "closed" ? "#F5F5F4" : "#FFFFFF"; }}>
                          <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
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
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tsm.bg, color: tsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{tsm.label}</span></div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor, width: "fit-content" }}>{priLabel}</span></div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                            <Avatar name={t.assignee} size="xs" />
                            <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.assignee || "—"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.startDate)}</span></div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.dueDate)}</span></div>
                        </div>
                        {/* 子チケット行（アコーディオン展開時） */}
                        {hasChildren && isTicketExpanded && children.map(child => {
                          const ctsm = TICKET_STATUSES.find(s => s.value === child.status) ?? TICKET_STATUSES[0];
                          const cPriBg = child.priority === "high" ? "#FEF2F2" : child.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                          const cPriColor = child.priority === "high" ? "#DC2626" : child.priority === "medium" ? "#D97706" : "#0284C7";
                          const cPriLabel = child.priority === "high" ? "高" : child.priority === "medium" ? "中" : "低";
                          return (
                            <div key={child.id} onClick={() => onSelectTicket?.(child)}
                              style={{ display: "grid", gridTemplateColumns: GRID, padding: "8px 16px 8px 32px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.04)", cursor: onSelectTicket ? "pointer" : "default", background: "#F9F8F6", transition: "background 0.1s", opacity: child.status === "closed" ? 0.65 : 1 }}
                              onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = "#EEF7F3"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}>
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                <span style={{ fontSize: 9, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{child.wbs}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: 4 }}>
                                <div style={{ width: 1, height: 12, background: "rgba(26,23,20,0.15)", flexShrink: 0 }} />
                                <span style={{ fontSize: 11, fontWeight: 400, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.title}</span>
                              </div>
                              <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(child.description) || "—"}</span>
                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: ctsm.bg, color: ctsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{ctsm.label}</span></div>
                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: cPriBg, color: cPriColor, width: "fit-content" }}>{cPriLabel}</span></div>
                              <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                                <Avatar name={child.assignee} size="xs" />
                                <span style={{ fontSize: 10, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.assignee || "—"}</span>
                              </div>
                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(child.startDate)}</span></div>
                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(child.dueDate)}</span></div>
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
    </div>
  );
}
