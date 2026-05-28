import { useState, useMemo } from "react";
import { ChevronDown, Trash2, ExternalLink, Filter, ArrowUpDown, Plus } from "lucide-react";
import type { Sprint, SprintTicket, TicketStatus, Priority, SortCol } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES, computeSprintStatus } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";

const selStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 12, padding: "5px 10px", borderRadius: 8,
  border: `1px solid ${active ? "rgba(5,150,105,0.30)" : "rgba(26,23,20,0.12)"}`,
  background: active ? "#ECFDF5" : "#F7F8F9",
  color: active ? "#059669" : "#6B6458",
  cursor: "pointer", outline: "none",
});

export function SprintListView({ sprints, onSelectSprint, onDeleteSprint, onSelectTicket, onCreateTicket }: {
  sprints: Sprint[];
  onSelectSprint: (s: Sprint) => void;
  onDeleteSprint?: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onCreateTicket?: (sprintId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(sprints.map(s => s.id)));
  const [filterStatus, setFilterStatus]   = useState<TicketStatus | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Priority | "all">("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [sortCol, setSortCol]   = useState<SortCol | "">("");
  const [sortDir, setSortDir]   = useState<"asc" | "desc">("asc");

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const allAssignees = useMemo(() => {
    const names = new Set<string>();
    sprints.forEach(s => s.tickets.forEach(t => { if (t.assignee) names.add(t.assignee); }));
    return Array.from(names).sort((a, b) => a.localeCompare(b, "ja"));
  }, [sprints]);

  const anyFilter = filterStatus !== "all" || filterPriority !== "all" || filterAssignee !== "all" || !!sortCol;

  const processTickets = (tickets: SprintTicket[]) => {
    const filtered = tickets.filter(t => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (filterPriority !== "all" && t.priority !== filterPriority) return false;
      if (filterAssignee !== "all" && t.assignee !== filterAssignee) return false;
      return true;
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

  const resetFilters = () => {
    setFilterStatus("all"); setFilterPriority("all");
    setFilterAssignee("all"); setSortCol(""); setSortDir("asc");
  };

  if (!sprints.length) return (
    <div style={{ padding: "48px 0", textAlign: "center", color: "#C9C4BB", fontSize: 13 }}>スプリントがありません</div>
  );

  return (
    <div>
      {/* Filter / Sort toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0 14px", flexWrap: "wrap" as const }}>
        <Filter style={{ width: 13, height: 13, color: "#B0A9A4", flexShrink: 0 }} />

        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as TicketStatus | "all")} style={selStyle(filterStatus !== "all")}>
          <option value="all">ステータス: すべて</option>
          {TICKET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value as Priority | "all")} style={selStyle(filterPriority !== "all")}>
          <option value="all">優先度: すべて</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>

        <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} style={selStyle(filterAssignee !== "all")}>
          <option value="all">担当者: すべて</option>
          {allAssignees.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <div style={{ width: 1, height: 16, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ArrowUpDown style={{ width: 12, height: 12, color: "#B0A9A4", flexShrink: 0 }} />
          <select value={sortCol} onChange={e => setSortCol(e.target.value as SortCol | "")}
            style={{ ...selStyle(!!sortCol), color: sortCol ? "#D97706" : "#6B6458", background: sortCol ? "#FFFBEB" : "#F7F8F9", border: `1px solid ${sortCol ? "rgba(217,119,6,0.30)" : "rgba(26,23,20,0.12)"}` }}>
            <option value="">並び替え: デフォルト</option>
            <option value="wbs">WBS</option>
            <option value="title">チケット名</option>
            <option value="status">ステータス</option>
            <option value="priority">優先度</option>
            <option value="startDate">開始日</option>
            <option value="dueDate">期限日</option>
            <option value="estimatedHours">工数</option>
            <option value="progress">進捗</option>
          </select>
          {sortCol && (
            <button onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
              style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(217,119,6,0.30)", background: "#FFFBEB", color: "#D97706", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              {sortDir === "asc" ? "↑ 昇順" : "↓ 降順"}
            </button>
          )}
        </div>

        {anyFilter && (
          <button onClick={resetFilters}
            style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#B0A9A4", fontSize: 11, cursor: "pointer" }}>
            リセット
          </button>
        )}
      </div>

      {/* Sprint accordion list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sprints.map(sprint => {
          const isExp = expanded.has(sprint.id);
          const sm = getSprintStatusMeta(computeSprintStatus(sprint));
          const progress = sprintProgress(sprint);
          const done = sprint.tickets.filter(t => t.status === "done" || t.status === "closed").length;
          const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
          const displayTickets = processTickets(sprint.tickets);

          return (
            <div key={sprint.id} style={{ background: "#FFFFFF", borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)", overflow: "hidden", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              {/* Sprint header */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", background: "#F9F8F6", cursor: "pointer", borderBottom: isExp ? "1px solid rgba(26,23,20,0.06)" : "none" }}
                onClick={() => toggle(sprint.id)}>
                <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4", transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{sprint.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                  </div>
                  {sprint.goal && <p style={{ fontSize: 11, color: "#A09790", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sprint.goal}</p>}
                  <div style={{ marginTop: 6 }}>
                    <ProgressBar value={progress} />
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0, marginLeft: 16 }}>
                  {[
                    { label: "チケット", value: sprint.tickets.length },
                    { label: "完了",     value: done },
                    { label: "工数(h)",  value: totalHours },
                    { label: "進捗",     value: `${progress}%` },
                  ].map(({ label, value }) => (
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

              {/* Ticket list */}
              {isExp && (
                <div>
                  {/* Table header */}
                  <div style={{ display: "grid", gridTemplateColumns: "52px 1fr 110px 56px 110px 68px 68px", padding: "7px 16px", background: "#F4F5F6", gap: 8, alignItems: "center" }}>
                    {["WBS", "チケット名", "ステータス", "優先度", "担当者", "開始日", "期限日"].map(h => (
                      <span key={h} style={{ fontSize: 9, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>{h}</span>
                    ))}
                  </div>
                  {displayTickets.length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center" as const, color: "#C9C4BB", fontSize: 12 }}>
                      {sprint.tickets.length === 0 ? "チケットがありません" : "条件に一致するチケットがありません"}
                    </div>
                  ) : displayTickets.map((t, i) => {
                    const tsm = TICKET_STATUSES.find(s => s.value === t.status) ?? TICKET_STATUSES[0];
                    const priBg = t.priority === "high" ? "#FEF2F2" : t.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                    const priColor = t.priority === "high" ? "#DC2626" : t.priority === "medium" ? "#D97706" : "#0284C7";
                    const priLabel = t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低";
                    return (
                      <div key={t.id} onClick={() => onSelectTicket?.(t)}
                        style={{ display: "grid", gridTemplateColumns: "52px 1fr 110px 56px 110px 68px 68px", padding: "10px 16px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.05)", cursor: onSelectTicket ? "pointer" : "default", background: i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent", transition: "background 0.1s" }}
                        onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = "#F0F9F5"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent"; }}>
                        <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", fontWeight: 600 }}>{t.wbs}</span>
                        <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.title}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tsm.bg, color: tsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{tsm.label}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor, width: "fit-content" }}>{priLabel}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                          <Avatar name={t.assignee} size="xs" />
                          <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.assignee || "—"}</span>
                        </div>
                        <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.startDate)}</span>
                        <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.dueDate)}</span>
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
