import { useEffect, useState, useMemo, type ElementType } from "react";
import { useNavigate, useParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, Layers, LayoutDashboard, BarChart2 } from "lucide-react";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { Project, Sprint, SprintView } from "@/app/types";
import { SprintListView } from "@/app/components/sprints/SprintListView";
import { SprintBoardView } from "@/app/components/sprints/SprintBoardView";
import { SprintGanttView } from "@/app/components/sprints/SprintGanttView";
import { NewSprintDialog } from "@/app/components/sprints/NewSprintDialog";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";

export function SprintPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast: _toast } = useToast();
  const { userRole, userPermissions } = useAuth();
  const isAdminOrPM = userRole === "admin" || userRole === "project-manager";
  const canCreateSprint = isAdminOrPM || userPermissions.canCreateSprint;
  const canCreateTicket = isAdminOrPM || userPermissions.canCreateTicket;
  const [project, setProject] = useState<Project | null>(PROJECTS.find(p => p.id === projectId) ?? null);
  const [sprints, setSprints] = useState<Sprint[]>(SPRINTS.filter(s => s.projectId === projectId));
  const [viewMode, setViewMode] = useState<SprintView>("list");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [createForSprintId, setCreateForSprintId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);

  // Derive selected ticket from live sprint data so it stays fresh after polling
  const selectedTicket = useMemo(() => {
    if (!selectedTicketId) return null;
    for (const sprint of sprints) {
      const t = sprint.tickets.find(t => t.id === selectedTicketId);
      if (t) return t;
    }
    return null;
  }, [selectedTicketId, sprints]);

  const createForSprint = useMemo(
    () => sprints.find(s => s.id === createForSprintId) ?? null,
    [createForSprintId, sprints]
  );

  const refreshSprints = () => {
    if (!isSupabaseEnabled || !projectId) return;
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", projectId).order("start_date")
      .then(({ data }) => { if (data?.length) setSprints(data.map(mapSprint)); });
  };

  // Initial load
  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) return;
    Promise.all([
      supabase!.from("projects").select("*").eq("id", projectId).single(),
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", projectId).order("start_date"),
    ]).then(([{ data: p }, { data: s }]) => {
      if (p) setProject(mapProject(p));
      if (s?.length) setSprints(s.map(mapSprint));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId]);

  // 10-second polling
  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) return;
    const id = setInterval(refreshSprints, 10000);
    return () => clearInterval(id);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteSprint = async (sprint: Sprint) => {
    if (isSupabaseEnabled) await supabase!.from("sprints").delete().eq("id", sprint.id);
    setSprints(prev => prev.filter(s => s.id !== sprint.id));
  };

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#A09790", fontSize: 13 }}>読み込み中...</div>;
  if (!project) return <Navigate to="/projects" replace />;

  const goToSprint = (sprint: Sprint) => navigate(`/projects/${projectId}/sprints/${sprint.id}`);

  const viewBtns: { mode: SprintView; label: string; Icon: ElementType }[] = [
    { mode: "list",  label: "リスト",        Icon: Layers },
    { mode: "board", label: "ボード",        Icon: LayoutDashboard },
    { mode: "gantt", label: "ガントチャート", Icon: BarChart2 },
  ];

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 16, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#B0A9A4" }}>{project.name}</span>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>スプリント</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>スプリント管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project.name} · {sprints.length} スプリント</p>
        </div>
        {canCreateSprint && (
          <button onClick={() => setShowCreate(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <Plus style={{ width: 15, height: 15 }} />新規スプリント
          </button>
        )}
      </div>

      <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 4, marginBottom: 20, width: "fit-content" }}>
        {viewBtns.map(({ mode, label, Icon }) => (
          <button key={mode} onClick={() => setViewMode(mode)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: viewMode === mode ? "#059669" : "transparent", color: viewMode === mode ? "#fff" : "#6B6458" }}>
            <Icon style={{ width: 13, height: 13 }} />{label}
          </button>
        ))}
      </div>

      {viewMode === "list"  && <SprintListView  sprints={sprints} onSelectSprint={goToSprint} onDeleteSprint={isAdminOrPM ? s => setDeleteTarget(s) : undefined} onSelectTicket={t => setSelectedTicketId(t.id)} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} />}
      {viewMode === "board" && <SprintBoardView sprints={sprints} onSelectSprint={goToSprint} onSelectTicket={t => setSelectedTicketId(t.id)} onUpdated={refreshSprints} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} />}
      {viewMode === "gantt" && <SprintGanttView sprints={sprints} onSelectSprint={goToSprint} onSelectTicket={t => setSelectedTicketId(t.id)} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} />}

      {showCreate && <NewSprintDialog onClose={() => setShowCreate(false)} projectId={projectId!} onCreated={refreshSprints} />}
      {createForSprintId && createForSprint && (
        <NewTicketDialog
          sprintId={createForSprintId}
          onClose={() => setCreateForSprintId(null)}
          onCreated={() => { refreshSprints(); setCreateForSprintId(null); }}
          sprintStartDate={createForSprint.startDate || undefined}
          sprintEndDate={createForSprint.endDate || undefined}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          message={`「${deleteTarget.name}」を削除しますか？関連するチケットもすべて削除されます。`}
          onConfirm={() => handleDeleteSprint(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
      <TicketDetailPanel ticket={selectedTicket} onClose={() => setSelectedTicketId(null)} onUpdated={refreshSprints} />
    </div>
  );
}
