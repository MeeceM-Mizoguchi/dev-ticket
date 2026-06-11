import { useEffect, useState, useMemo, useRef, type ElementType } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, Layers, LayoutDashboard, BarChart2, Lock, Settings2 } from "lucide-react";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { Project, Sprint, SprintTicket, SprintView } from "@/app/types";
import { SprintListView } from "@/app/components/sprints/SprintListView";
import { SprintBoardView } from "@/app/components/sprints/SprintBoardView";
import { SprintGanttView } from "@/app/components/sprints/SprintGanttView";
import { NewSprintDialog } from "@/app/components/sprints/NewSprintDialog";
import { EditSprintDialog } from "@/app/components/sprints/EditSprintDialog";
import { DeleteSprintDialog } from "@/app/components/sprints/DeleteSprintDialog";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { BulkTicketCreateDialog } from "@/app/components/tickets/BulkTicketCreateDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { EditProjectIdentifiersDialog } from "@/app/components/projects/EditProjectIdentifiersDialog";

export function SprintPage() {
  const { projectSlug, ticketWbs } = useParams<{ projectSlug: string; ticketWbs?: string }>();
  const [searchParams] = useSearchParams();
  const anchor = searchParams.get("anchor") ?? undefined;
  const navigate = useNavigate();
  const { toast: _toast } = useToast();
  const { userName, userRole, userId, userPermissions } = useAuth();
  const isAdminOrPM = userRole === "admin" || userRole === "project-manager";
  const [projectPermissions, setProjectPermissions] = useState<import("@/app/types").UserPermissions | null>(null);
  const [projectPermissionsLoaded, setProjectPermissionsLoaded] = useState(false);
  // レコードあり → 全員レコード優先（admin/PM も個別制限を反映）
  // レコードなし → admin/PM はロール権限、それ以外は権限なし(all false)
  const NO_PERMS: import("@/app/types").UserPermissions = { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canSkipReview: false, canAccessMembers: false, canAccessRoles: false, canAccessGroups: false };
  const effectivePermissions = projectPermissionsLoaded
    ? (projectPermissions ?? (isAdminOrPM ? userPermissions : NO_PERMS))
    : NO_PERMS;
  const canCreateSprint = effectivePermissions.canCreateSprint;
  const canCreateTicket = effectivePermissions.canCreateTicket;
  const canEditDeleteSprint = effectivePermissions.canEditDelete;

  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [viewMode, setViewMode] = useState<SprintView>("list");
  const [showCreate, setShowCreate] = useState(false);
  const [createForSprintId, setCreateForSprintId] = useState<string | null>(null);
  const [bulkCreateForSprintId, setBulkCreateForSprintId] = useState<string | null>(null);
  const [showEditIdentifiers, setShowEditIdentifiers] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const [editTarget, setEditTarget] = useState<Sprint | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const projectId = project?.id ?? null;

  const refreshSprints = () => {
    if (!isSupabaseEnabled || !projectId) return;
    supabase!.from("projects").select("*").eq("id", projectId).single()
      .then(({ data: p }) => { if (p) setProject(mapProject(p)); });
    supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", projectId).order("start_date").order("created_at", { referencedTable: "sprint_tickets" }).order("id", { referencedTable: "sprint_tickets" })
      .then(({ data }) => {
        if (data) setSprints(data.map(mapSprint).filter(s => !deletedIdsRef.current.has(s.id)));
      });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) {
      // mock mode: find by slug or fall back
      const mock = PROJECTS.find(p => p.slug === projectSlug?.toUpperCase());
      if (mock) { setProject(mock); setSprints(SPRINTS.filter(s => s.projectId === mock.id)); }
      setLoading(false);
      return;
    }
    if (!projectSlug) { setLoading(false); return; }

    const lookupProject = async () => {
      // Try slug lookup first (new projects), then fall back to ID (old projects without slug)
      const { data: bySlugRows } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
      const p = bySlugRows?.[0]
        ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
      if (!p) { setNotFound(true); setLoading(false); return; }
      setProject(mapProject(p));
      const [{ data: s }, { data: pmp }] = await Promise.all([
        supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", p.id).order("start_date").order("created_at", { referencedTable: "sprint_tickets" }).order("id", { referencedTable: "sprint_tickets" }),
        userId ? supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle() : Promise.resolve({ data: null }),
      ]);
      if (s?.length) setSprints(s.map(mapSprint));
      if (pmp?.permissions) setProjectPermissions(pmp.permissions as import("@/app/types").UserPermissions);
      setProjectPermissionsLoaded(true);
      setLoading(false);
    };
    lookupProject().catch(() => { setNotFound(true); setProjectPermissionsLoaded(true); setLoading(false); });
  }, [projectSlug, userId]);

  useEffect(() => {
    if (!isSupabaseEnabled || !projectId) return;
    const id = setInterval(refreshSprints, 60000);
    return () => clearInterval(id);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedTicket = useMemo<SprintTicket | null>(() => {
    if (!ticketWbs) return null;
    for (const sprint of sprints) {
      const t = sprint.tickets.find(t => t.wbs === ticketWbs);
      if (t) return t;
    }
    return null;
  }, [ticketWbs, sprints]);

  const createForSprint = useMemo(
    () => sprints.find(s => s.id === createForSprintId) ?? null,
    [createForSprintId, sprints]
  );

  const handleDeleteSprint = async (sprint: Sprint) => {
    if (isSupabaseEnabled) await supabase!.from("sprints").delete().eq("id", sprint.id);
    setSprints(prev => prev.filter(s => s.id !== sprint.id));
  };

  const otherSprints = useMemo(
    () => deleteTarget ? sprints.filter(s => s.id !== deleteTarget.id) : [],
    [deleteTarget, sprints]
  );

  const handleSelectTicket = (ticket: SprintTicket) => {
    if (ticket.wbs) navigate(`/${projectSlug}/${ticket.wbs}`);
  };

  const goToSprint = (sprint: Sprint) => navigate(`/${projectSlug}/sprint/${sprint.id}`);

  if (loading) return <div style={{ padding: 48, textAlign: "center", color: "#A09790", fontSize: 13 }}>読み込み中...</div>;
  if (notFound) return <Navigate to="/projects" replace />;
  if (!project) return <Navigate to="/projects" replace />;

  const isMember = isAdminOrPM || (project.members ?? []).includes(userName);
  if (!isMember) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "70vh", padding: 24 }}>
      <div style={{ textAlign: "center" as const, maxWidth: 380 }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <Lock style={{ width: 24, height: 24, color: "#DC2626" }} />
        </div>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1A1714", marginBottom: 10, fontFamily: "var(--font-heading)" }}>アクセスできません</h2>
        <p style={{ fontSize: 13, color: "#9E9690", lineHeight: 1.65, marginBottom: 24 }}>
          このプロジェクトからアサイン解除されたため、<br />アクセスできません。
        </p>
        <button onClick={() => navigate("/projects")}
          style={{ padding: "10px 28px", background: "#059669", color: "#FFF", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
          プロジェクト一覧に戻る
        </button>
      </div>
    </div>
  );

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
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project.name}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>スプリント管理</h1>
            {project.slug && <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#9CA3AF", background: "#F3F4F6", padding: "2px 7px", borderRadius: 5, fontWeight: 600 }}>{project.slug}</span>}
            <button onClick={() => setShowEditIdentifiers(true)} title="識別子を編集"
              style={{ padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
              <Settings2 style={{ width: 13, height: 13 }} />
            </button>
          </div>
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

      {viewMode === "list"  && <SprintListView  sprints={sprints} onSelectSprint={goToSprint} onDeleteSprint={canEditDeleteSprint ? s => setDeleteTarget(s) : undefined} onEditSprint={canEditDeleteSprint ? s => setEditTarget(s) : undefined} onSelectTicket={handleSelectTicket} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} onBulkCreate={canCreateTicket ? setBulkCreateForSprintId : undefined} targetTicketWbs={ticketWbs} />}
      {viewMode === "board" && <SprintBoardView sprints={sprints} onSelectSprint={goToSprint} onSelectTicket={handleSelectTicket} onUpdated={refreshSprints} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} onBulkCreate={canCreateTicket ? setBulkCreateForSprintId : undefined} />}
      {viewMode === "gantt" && <SprintGanttView sprints={sprints} onSelectSprint={goToSprint} onSelectTicket={handleSelectTicket} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} onBulkCreate={canCreateTicket ? setBulkCreateForSprintId : undefined} />}

      {showCreate && <NewSprintDialog onClose={() => setShowCreate(false)} projectId={projectId!} onCreated={refreshSprints} />}
      {bulkCreateForSprintId && (() => {
        const bulkSprint = sprints.find(s => s.id === bulkCreateForSprintId);
        return (
          <BulkTicketCreateDialog
            sprintId={bulkCreateForSprintId}
            sprintName={bulkSprint?.name}
            projectId={projectId ?? undefined}
            projectSlug={projectSlug}
            sprintStartDate={bulkSprint?.startDate || undefined}
            sprintEndDate={bulkSprint?.endDate || undefined}
            onClose={() => setBulkCreateForSprintId(null)}
            onCreated={() => { refreshSprints(); setBulkCreateForSprintId(null); }}
          />
        );
      })()}
      {createForSprintId && createForSprint && (
        <NewTicketDialog
          sprintId={createForSprintId}
          projectId={projectId ?? undefined}
          projectSlug={projectSlug}
          onClose={() => setCreateForSprintId(null)}
          onCreated={() => { refreshSprints(); setCreateForSprintId(null); }}
          sprintStartDate={createForSprint.startDate || undefined}
          sprintEndDate={createForSprint.endDate || undefined}
        />
      )}
      {editTarget && (
        <EditSprintDialog
          sprint={editTarget}
          otherSprints={sprints.filter(s => s.id !== editTarget.id)}
          onClose={() => setEditTarget(null)}
          onUpdated={() => { refreshSprints(); setEditTarget(null); }} />
      )}
      {showEditIdentifiers && project && (
        <EditProjectIdentifiersDialog
          project={project}
          onClose={() => setShowEditIdentifiers(false)}
          onUpdated={(newSlug) => {
            setShowEditIdentifiers(false);
            navigate(`/${newSlug}`);
          }} />
      )}
      {deleteTarget && (
        <DeleteSprintDialog
          sprint={deleteTarget}
          otherSprints={otherSprints}
          projectId={projectId!}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            const deletedId = deleteTarget.id;
            deletedIdsRef.current.add(deletedId);
            setSprints(prev => prev.filter(s => s.id !== deletedId));
            setDeleteTarget(null);
            refreshSprints();
            setTimeout(() => deletedIdsRef.current.delete(deletedId), 15000);
          }} />
      )}

      <TicketDetailPanel
        ticket={selectedTicket}
        projectId={projectId ?? undefined}
        sprintId={selectedTicket ? sprints.find(s => s.tickets.some(t => t.id === selectedTicket.id))?.id : undefined}
        projectSlug={projectSlug}
        anchor={anchor}
        onClose={() => navigate(`/${projectSlug}`)}
        onUpdated={refreshSprints}
        onDeleted={() => { navigate(`/${projectSlug}`); refreshSprints(); }}
        onSelectTicket={t => t.wbs ? navigate(`/${projectSlug}/${t.wbs}`) : undefined}
        projectPermissions={projectPermissions ?? undefined}
      />
    </div>
  );
}
