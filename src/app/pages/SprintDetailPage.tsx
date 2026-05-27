import { useEffect, useState } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { Project, Sprint, SprintTicket, TicketStatus, Priority, SortCol } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";

export function SprintDetailPage() {
  const { projectId, sprintId } = useParams<{ projectId: string; sprintId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [project, setProject] = useState<Project | null>(PROJECTS.find(p => p.id === projectId) || null);
  const [sprint, setSprint] = useState<Sprint | null>(SPRINTS.find(s => s.id === sprintId) || null);
  const [loading, setLoading] = useState(isSupabaseEnabled);

  const [sortCol, setSortCol] = useState<SortCol>("wbs");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [filterStatus, setFilterStatus] = useState<TicketStatus | "all">("all");
  const [filterPriority, setFilterPriority] = useState<Priority | "all">("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SprintTicket | null>(null);
  const [deleteTicketTarget, setDeleteTicketTarget] = useState<SprintTicket | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled || !sprintId || !projectId) return;
    Promise.all([
      supabase!.from("projects").select("*").eq("id", projectId).single(),
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintId).single(),
    ]).then(([{ data: p }, { data: s }]) => {
      if (p) setProject(mapProject(p));
      if (s) setSprint(mapSprint(s));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [sprintId, projectId]);

  const refreshSprint = () => {
    if (!isSupabaseEnabled || !sprintId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("id", sprintId).single()
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

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#A09790", fontSize: 13 }}>読み込み中...</div>;
  if (!project || !sprint) return <Navigate to="/projects" replace />;

  const done = sprint.tickets.filter(t => t.status === "done").length;
  const inProg = sprint.tickets.filter(t => t.status === "in-progress").length;
  const progress = sprintProgress(sprint);
  const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
  const sm = getSprintStatusMeta(sprint.status);

  const statusOrder: Record<TicketStatus, number> = { todo: 0, "in-progress": 1, done: 2 };
  const priorityOrder: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

  const displayTickets = [...sprint.tickets]
    .filter(t => (filterStatus === "all" || t.status === filterStatus) && (filterPriority === "all" || t.priority === filterPriority))
    .sort((a, b) => {
      let v = 0;
      if (sortCol === "wbs") v = a.wbs.localeCompare(b.wbs);
      else if (sortCol === "title") v = a.title.localeCompare(b.title);
      else if (sortCol === "status") v = statusOrder[a.status] - statusOrder[b.status];
      else if (sortCol === "priority") v = priorityOrder[a.priority] - priorityOrder[b.priority];
      else if (sortCol === "startDate") v = a.startDate.localeCompare(b.startDate);
      else if (sortCol === "dueDate") v = a.dueDate.localeCompare(b.dueDate);
      else if (sortCol === "estimatedHours") v = a.estimatedHours - b.estimatedHours;
      else if (sortCol === "progress") v = a.progress - b.progress;
      return sortDir === "asc" ? v : -v;
    });

  const SortTh = ({ col, label }: { col: SortCol; label: string }) => {
    const active = sortCol === col;
    return (
      <button
        onClick={() => { if (active) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("asc"); } }}
        style={{ display: "flex", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700, color: active ? "#059669" : "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>
        {label}{active && <span style={{ fontSize: 9 }}>{sortDir === "asc" ? " ↑" : " ↓"}</span>}
      </button>
    );
  };

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <button onClick={() => navigate(`/projects/${projectId}/sprints`)} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12 }}>
          スプリント一覧
        </button>
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
            {[
              { label: "チケット数", value: sprint.tickets.length },
              { label: "完了", value: done },
              { label: "進行中", value: inProg },
              { label: "総工数(h)", value: totalHours },
              { label: "進捗", value: `${progress}%` },
            ].map(({ label, value }) => (
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

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.05em" }}>ステータス</span>
          {([ ["all","すべて"], ["todo","未着手"], ["in-progress","進行中"], ["done","完了"] ] as [TicketStatus|"all", string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFilterStatus(v)}
              style={{ padding: "4px 10px", fontSize: 11, borderRadius: 7, border: "1px solid", cursor: "pointer", fontWeight: 500, transition: "all 0.12s",
                background: filterStatus === v ? "#059669" : "transparent",
                color: filterStatus === v ? "#fff" : "#6B6458",
                borderColor: filterStatus === v ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {l}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600, letterSpacing: "0.05em" }}>優先度</span>
          {([ ["all","すべて"], ["high","高"], ["medium","中"], ["low","低"] ] as [Priority|"all", string][]).map(([v, l]) => (
            <button key={v} onClick={() => setFilterPriority(v)}
              style={{ padding: "4px 10px", fontSize: 11, borderRadius: 7, border: "1px solid", cursor: "pointer", fontWeight: 500, transition: "all 0.12s",
                background: filterPriority === v ? "#059669" : "transparent",
                color: filterPriority === v ? "#fff" : "#6B6458",
                borderColor: filterPriority === v ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {l}
            </button>
          ))}
        </div>
        {displayTickets.length !== sprint.tickets.length && (
          <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{displayTickets.length} / {sprint.tickets.length} 件</span>
        )}
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 14, overflow: "hidden", border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "56px 1fr 90px 60px 100px 72px 72px 52px 130px 36px", padding: "10px 16px", background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.06)", gap: 8, alignItems: "center" }}>
          <SortTh col="wbs" label="WBS" />
          <SortTh col="title" label="チケット名" />
          <SortTh col="status" label="ステータス" />
          <SortTh col="priority" label="優先度" />
          <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em" }}>担当者</span>
          <SortTh col="startDate" label="開始日" />
          <SortTh col="dueDate" label="終了日" />
          <SortTh col="estimatedHours" label="工数" />
          <SortTh col="progress" label="進捗" />
          <span />
        </div>

        {displayTickets.length === 0 ? (
          <div style={{ padding: "40px 0", textAlign: "center" as const, color: "#B0A9A4", fontSize: 13 }}>条件に一致するチケットがありません</div>
        ) : displayTickets.map((ticket, i) => {
          const statusBg = ticket.status === "done" ? "#ECFDF5" : ticket.status === "in-progress" ? "#FFF7ED" : "#F4F5F6";
          const statusColor = ticket.status === "done" ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#9E9690";
          const statusLabel = ticket.status === "done" ? "完了" : ticket.status === "in-progress" ? "進行中" : "未着手";
          const priBg = ticket.priority === "high" ? "#FEF2F2" : ticket.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
          const priColor = ticket.priority === "high" ? "#DC2626" : ticket.priority === "medium" ? "#D97706" : "#0284C7";
          const priLabel = ticket.priority === "high" ? "高" : ticket.priority === "medium" ? "中" : "低";
          const barColor = ticket.progress === 100 ? "#059669" : ticket.status === "in-progress" ? "#D97706" : "#C9C4BB";
          return (
            <div key={ticket.id} onClick={() => setSelectedTicket(ticket)}
              style={{ display: "grid", gridTemplateColumns: "56px 1fr 90px 60px 100px 72px 72px 52px 130px 36px", padding: "11px 16px", alignItems: "center", gap: 8, borderBottom: i < displayTickets.length - 1 ? "1px solid rgba(26,23,20,0.04)" : "none", background: i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent", transition: "background 0.1s", cursor: "pointer" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFF7F3"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = i % 2 === 1 ? "rgba(26,23,20,0.012)" : "transparent"; }}>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "#B0A9A4", fontWeight: 600 }}>{ticket.wbs}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <div style={{ width: 4, height: 4, borderRadius: "50%", background: priColor, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{ticket.title}</span>
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: statusBg, color: statusColor, display: "inline-block" }}>{statusLabel}</span>
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

      {showCreate && <NewTicketDialog sprintId={sprintId!} onClose={() => setShowCreate(false)} onCreated={refreshSprint} />}
      {deleteTicketTarget && (
        <ConfirmDialog
          message={`「${deleteTicketTarget.title}」を削除しますか？`}
          onConfirm={() => handleDeleteTicket(deleteTicketTarget)}
          onClose={() => setDeleteTicketTarget(null)} />
      )}
      <TicketDetailPanel ticket={selectedTicket} onClose={() => setSelectedTicket(null)} onUpdated={refreshSprint} />
    </div>
  );
}
