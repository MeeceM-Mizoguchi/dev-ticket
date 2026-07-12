import { useEffect, useState, useMemo, useRef, type ElementType } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import { FolderKanban, ChevronRight, Plus, Layers, LayoutDashboard, BarChart2, Lock, Settings2 } from "lucide-react";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapProject, mapSprint } from "@/app/lib/mappers";
import type { Project, Sprint, SprintTicket, SprintView, AccessLevel, EnvMemo } from "@/app/types";
import { SprintListView } from "@/app/components/sprints/SprintListView";
import SprintBoardView from "@/app/components/sprints/SprintBoardView";
import { SprintGanttView } from "@/app/components/sprints/SprintGanttView";
import { NewSprintDialog } from "@/app/components/sprints/NewSprintDialog";
import { PlanTooltip } from "@/app/components/shared/PlanTooltip";
import { MyFilterModal } from "@/app/components/sprints/MyFilterModal";
import { EditSprintDialog } from "@/app/components/sprints/EditSprintDialog";
import { DeleteSprintDialog } from "@/app/components/sprints/DeleteSprintDialog";
import { NewTicketDialog } from "@/app/components/tickets/NewTicketDialog";
import { BulkTicketCreateDialog } from "@/app/components/tickets/BulkTicketCreateDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { ProjectSettingsDialog } from "@/app/components/projects/ProjectSettingsDialog";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";

function EnvMemoTag({ m }: { m: EnvMemo }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = () => { if (timer.current) clearTimeout(timer.current); setOpen(true); };
  const hide = () => { timer.current = setTimeout(() => setOpen(false), 120); };

  const chipStyle = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 600, color: "#0284C7", background: open ? "#E0F2FE" : "#F0F9FF", border: "1px solid rgba(2,132,199,0.2)", borderRadius: 6, padding: "2px 8px", textDecoration: "none", cursor: m.url ? "pointer" : "default" } as const;
  const icon = m.url
    ? <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
    : <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
  const label = m.name || m.url || "メモ";

  return (
    <div style={{ position: "relative", display: "inline-flex" }} onMouseEnter={show} onMouseLeave={hide}>
      {m.url ? (
        <a href={m.url} target="_blank" rel="noopener noreferrer" style={chipStyle}>
          {icon}{label}
        </a>
      ) : (
        <span style={chipStyle}>{icon}{label}</span>
      )}
      {open && m.memo && (
        <div onMouseEnter={show} onMouseLeave={hide}
          style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 9999, background: "#1A1714", color: "#F9FAFB", borderRadius: 9, padding: "8px 12px", fontSize: 11, lineHeight: 1.6, whiteSpace: "pre-wrap", minWidth: 160, maxWidth: 300, maxHeight: "calc(1.6em * 4 + 16px)", overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.28)", userSelect: "text", cursor: "text" }}>
          {m.name && <div style={{ fontWeight: 700, marginBottom: 4, color: "#D1FAE5", fontSize: 10 }}>{m.name}</div>}
          {m.memo}
        </div>
      )}
    </div>
  );
}

export function SprintPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [searchParams] = useSearchParams();
  const anchor = searchParams.get("anchor") ?? undefined;
  const navigate = useNavigate();
  const [highlightWbs] = useState<string | undefined>(() => {
    const v = sessionStorage.getItem('hl_wbs') ?? undefined;
    if (v) sessionStorage.removeItem('hl_wbs');
    return v;
  });
  const [closedHighlightWbs, setClosedHighlightWbs] = useState<string | null>(null);
  // 作成直後のチケットへスクロール&強調するための対象WBS（詳細は開かず一覧で強調のみ・BRU5-034）
  const [createdHighlightWbs, setCreatedHighlightWbs] = useState<string | null>(null);
  // 作成直後のスプリントへスクロール&強調するための対象スプリントID（BRU5-034）
  const [createdHighlightSprintId, setCreatedHighlightSprintId] = useState<string | null>(null);
  const { userName, userRole, userId, userOrgId, userPermissions } = useAuth();
  const { plan } = usePlan();
  const isAdminOrPM = userRole === "admin" || userRole === "project-manager" || userRole === "owner";
  const isAdmin = userRole === "owner" || userRole === "admin";
  const [projectPermissions, setProjectPermissions] = useState<import("@/app/types").UserPermissions | null>(null);
  const [projectPermissionsLoaded, setProjectPermissionsLoaded] = useState(false);
  const NO_PERMS: import("@/app/types").UserPermissions = { canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canSkipReview: false, canAccessMembers: false, canAccessRoles: false, canAccessGroups: false };
  const effectivePermissions = projectPermissionsLoaded
    ? (projectPermissions ?? (isAdminOrPM ? userPermissions : NO_PERMS))
    : NO_PERMS;
  const canCreateSprint = effectivePermissions.canCreateSprint;
  const canCreateTicket = effectivePermissions.canCreateTicket;
  const canEditDeleteSprint = effectivePermissions.canEditDelete;

  const [project, setProject] = useState<Project | null>(null);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [viewMode, setViewMode] = useState<SprintView>(() => {
    const v = searchParams.get("view");
    return (v === "gantt" || v === "board" || v === "list") ? v : "list";
  });
  const [showCreate, setShowCreate] = useState(false);
  const [createForSprintId, setCreateForSprintId] = useState<string | null>(null);
  const [bulkCreateForSprintId, setBulkCreateForSprintId] = useState<string | null>(null);
  const [showEditIdentifiers, setShowEditIdentifiers] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Sprint | null>(null);
  const [editTarget, setEditTarget] = useState<Sprint | null>(null);
  const [myFilterSprintId, setMyFilterSprintId] = useState<string | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [notFound, setNotFound] = useState(false);
  const [selectedTicketWbs, setSelectedTicketWbs] = useState<string | null>(null);
  const [backgroundParentWbs, setBackgroundParentWbs] = useState<string | null>(null);
  const [isParentNav, setIsParentNav] = useState(false);
  const deletedIdsRef = useRef<Set<string>>(new Set());

  // 🌟 BRU5-043: 上部ブロック(パンくず〜ビュー切替)を画面上部に固定し、その実高さを測って
  //             各ビューの sticky ヘッダーへオフセットとして渡す。高さは環境メモ折返し等で可変のため測定する。
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projectId = project?.id ?? null;

  useEffect(() => {
    if (isParentNav) {
      setIsParentNav(false);
    }
  }, [selectedTicketWbs, isParentNav]);

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
      const mock = PROJECTS.find(p => p.slug === projectSlug?.toUpperCase());
      if (mock) { setProject(mock); setSprints(SPRINTS.filter(s => s.projectId === mock.id)); }
      setLoading(false);
      return;
    }
    if (!projectSlug) { setLoading(false); return; }

    const lookupProject = async () => {
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
  }, [projectId]);

  useEffect(() => {
    const onPop = () => {
      const path = window.location.pathname;
      const match = path.match(new RegExp(`^/${projectSlug}/(.+)$`));
      setSelectedTicketWbs(match ? match[1] : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [projectSlug]);

  const selectedTicket = useMemo<SprintTicket | null>(() => {
    if (!selectedTicketWbs) return null;
    for (const sprint of sprints) {
      const t = sprint.tickets.find(t => t.wbs === selectedTicketWbs);
      if (t) return t;
    }
    return null;
  }, [selectedTicketWbs, sprints]);

  const createForSprint = useMemo(
    () => sprints.find(s => s.id === createForSprintId) ?? null,
    [createForSprintId, sprints]
  );

  const otherSprints = useMemo(
    () => deleteTarget ? sprints.filter(s => s.id !== deleteTarget.id) : [],
    [deleteTarget, sprints]
  );

  const handleSelectTicket = (ticket: SprintTicket) => {
    if (ticket.wbs) {
      setClosedHighlightWbs(null);
      window.history.pushState({ fromSprintList: true }, '', `/${projectSlug}/${ticket.wbs}`);
      setSelectedTicketWbs(ticket.wbs);
    }
  };

  const goToSprint = (sprint: Sprint) => navigate(`/${projectSlug}/${sprint.identifier || sprint.id}`);

  if (!loading && notFound) return <Navigate to="/projects" replace />;
  if (!loading && !project) return <Navigate to="/projects" replace />;

  if (project) {
    const sameOrg = userRole === "owner" || !project.organizationId || !userOrgId || project.organizationId === userOrgId;
    const isMember = userRole === "owner" || (sameOrg && (project.members ?? []).includes(userName));
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
  }

  const viewBtns: { mode: SprintView; label: string; Icon: ElementType }[] = [
    { mode: "list", label: "リスト", Icon: Layers },
    { mode: "board", label: "ボード", Icon: LayoutDashboard },
    { mode: "gantt", label: "ガントチャート", Icon: BarChart2 },
  ];

  const ticketSprint = selectedTicket ? sprints.find(s => s.tickets.some(t => t.id === selectedTicket.id)) : undefined;

  return (
    <div style={{ minWidth: 1100 }}>
      {/* 🌟 BRU5-043: パンくず〜ビュー切替までを画面上部に固定。下へスクロールしても
          バックログ/ホワイトボード等のタブとビュー切替へ常時アクセスできるようにする。
          headerRef の実高さ(headerH)を各ビューの sticky ヘッダーへオフセットとして渡し段重ねする。 */}
      <div ref={headerRef} style={{ position: "sticky", top: 0, zIndex: 200, background: "#F5F6F8", padding: "24px 24px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.01em" }}>スプリント管理</h1>
            {project?.slug && <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "#9CA3AF", background: "#F3F4F6", padding: "2px 7px", borderRadius: 5, fontWeight: 600 }}>{project.slug}</span>}
            <button onClick={() => setShowEditIdentifiers(true)} title="識別子を編集"
              style={{ padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
              <Settings2 style={{ width: 13, height: 13 }} />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 3 }}>
            <p style={{ fontSize: 12, color: "#A09790", margin: 0 }}>{project ? `${project.name} · ${sprints.length} スプリント` : "..."}</p>
            {project?.envMemos?.filter(m => m.url || m.memo).map((m, i) => (
              <EnvMemoTag key={i} m={m} />
            ))}
          </div>
        </div>
        <ProjectSubNav
          projectSlug={projectSlug ?? project?.slug ?? ""}
          active="sprints" marginBottom={0}
          wikiPerm={isAdmin ? "edit" : ((projectPermissions?.wikiPermission as AccessLevel | undefined) ?? (projectPermissionsLoaded ? "none" : "view"))}
          backlogPerm={isAdmin ? "edit" : ((projectPermissions?.backlogPermission as AccessLevel | undefined) ?? (projectPermissionsLoaded ? "none" : "view"))}
          minutesPerm={isAdmin ? "edit" : ((projectPermissions?.minutesPermission as AccessLevel | undefined) ?? (projectPermissionsLoaded ? "none" : "view"))}
          whiteboardPerm={isAdmin ? "edit" : ((projectPermissions?.whiteboardPermission as AccessLevel | undefined) ?? (projectPermissionsLoaded ? "none" : "view"))}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, marginBottom: 0 }}>
        <div style={{ display: "flex", gap: 2, background: "#F0F0EE", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 9, padding: 3 }}>
          {viewBtns.map(({ mode, label, Icon }) => (
            <button key={mode} onClick={() => setViewMode(mode)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 12px", fontSize: 11, fontWeight: 500, borderRadius: 6, border: "none", cursor: "pointer", transition: "all 0.15s", background: viewMode === mode ? "#FFFFFF" : "transparent", color: viewMode === mode ? "#1A1714" : "#9E9690", boxShadow: viewMode === mode ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
              <Icon style={{ width: 12, height: 12 }} />{label}
            </button>
          ))}
        </div>
        {canCreateSprint && (() => {
          const atLimit = plan.maxSprintsPerProject !== null && sprints.length >= plan.maxSprintsPerProject;
          return (
            <PlanTooltip text="現在のプランではこれ以上作成できません" active={atLimit}>
              <button onClick={atLimit ? undefined : () => setShowCreate(true)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: atLimit ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: atLimit ? "not-allowed" : "pointer", boxShadow: atLimit ? "none" : "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
                onMouseEnter={e => { if (!atLimit) (e.currentTarget as HTMLElement).style.background = "#047857"; }}
                onMouseLeave={e => { if (!atLimit) (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
                <Plus style={{ width: 15, height: 15 }} />新規スプリント
              </button>
            </PlanTooltip>
          );
        })()}
      </div>
      </div>{/* 🌟 BRU5-043: 固定バー(headerRef)ここまで */}

      {/* 🌟 BRU5-043: 固定バーより下＝通常スクロール領域。左右/下パディングはここで付与 */}
      <div style={{ padding: "0 24px 24px" }}>
      {viewMode === "list" && <SprintListView sprints={sprints} loading={loading} onSelectSprint={goToSprint} onDeleteSprint={canEditDeleteSprint ? s => setDeleteTarget(s) : undefined} onEditSprint={canEditDeleteSprint ? s => setEditTarget(s) : undefined} onSelectTicket={handleSelectTicket} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} onBulkCreate={canCreateTicket ? setBulkCreateForSprintId : undefined} targetTicketWbs={selectedTicketWbs ?? closedHighlightWbs ?? createdHighlightWbs ?? highlightWbs} targetSprintId={createdHighlightSprintId} onOpenMyFilter={setMyFilterSprintId} stickyTop={headerH} />}
      {viewMode === "board" && <SprintBoardView sprints={sprints} loading={loading} onSelectSprint={goToSprint} onSelectTicket={handleSelectTicket} onUpdated={refreshSprints} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} onBulkCreate={canCreateTicket ? setBulkCreateForSprintId : undefined} stickyTop={headerH} />}
      {viewMode === "gantt" && <SprintGanttView sprints={sprints} onSelectSprint={goToSprint} onSelectTicket={handleSelectTicket} onCreateTicket={canCreateTicket ? setCreateForSprintId : undefined} onBulkCreate={canCreateTicket ? setBulkCreateForSprintId : undefined} stickyTop={headerH} />}

      {showCreate && <NewSprintDialog onClose={() => setShowCreate(false)} projectId={projectId!} onCreated={(sid) => { refreshSprints(); if (sid) setCreatedHighlightSprintId(sid); }} currentSprintCount={sprints.length} />}
      
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
          onCreated={(createdWbs) => { refreshSprints(); if (createdWbs) { setClosedHighlightWbs(null); setSelectedTicketWbs(null); setCreatedHighlightWbs(createdWbs); } setCreateForSprintId(null); }}
          sprintStartDate={createForSprint.startDate || undefined}
          sprintEndDate={createForSprint.endDate || undefined}
          currentTicketCount={createForSprint.tickets.length}
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
        <ProjectSettingsDialog
          project={project}
          onClose={() => setShowEditIdentifiers(false)}
          onUpdated={(newSlug) => {
            setShowEditIdentifiers(false);
            if (project && newSlug !== project.slug) {
              navigate(`/${newSlug}`);
            } else {
              refreshSprints();
            }
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

      {myFilterSprintId && (
        <MyFilterModal
          onClose={() => setMyFilterSprintId(null)}
          onApply={(filters) => {
            console.log("Apply filter for sprint:", myFilterSprintId, filters);
            setMyFilterSprintId(null);
          }}
        />
      )}

      <TicketDetailPanel
        ticket={selectedTicket}
        projectId={projectId ?? undefined}
        sprintId={ticketSprint?.id}
        sprintSlug={ticketSprint?.identifier || undefined}
        projectSlug={projectSlug}
        anchor={anchor}
        onClose={() => {
          const currentTicketWbs = selectedTicketWbs;
          const parentWbsToRestore = backgroundParentWbs;

          setClosedHighlightWbs(currentTicketWbs);
          setBackgroundParentWbs(null);

          if (parentWbsToRestore) {
            window.history.pushState(null, '', `/${projectSlug}/${parentWbsToRestore}`);
            setSelectedTicketWbs(parentWbsToRestore);
            setIsParentNav(true);
          } else {
            window.history.pushState(null, '', `/${projectSlug}`);
            setSelectedTicketWbs(null);
          }
          if (currentTicketWbs) {
            requestAnimationFrame(() => {
              document.querySelector(`[data-wbs="${currentTicketWbs}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
          }
        }}
        onUpdated={refreshSprints}
        onDeleted={() => {
          setClosedHighlightWbs(null);
          setBackgroundParentWbs(null);
          window.history.pushState(null, '', `/${projectSlug}`);
          setSelectedTicketWbs(null);
          refreshSprints();
        }}
        onSelectTicket={t => {
          if (t.wbs) {
            const prevWbs = selectedTicketWbs;
            window.history.pushState({ fromSprintList: true }, '', `/${projectSlug}/${t.wbs}`);
            if (t.wbs === backgroundParentWbs) {
              setBackgroundParentWbs(null);
              setIsParentNav(true);
              setClosedHighlightWbs(prevWbs);
              if (prevWbs) {
                requestAnimationFrame(() => {
                  document.querySelector(`[data-wbs="${prevWbs}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                });
              }
            } else if (selectedTicket && t.parentId === selectedTicket.id) {
              setBackgroundParentWbs(selectedTicketWbs);
              setIsParentNav(false);
              setClosedHighlightWbs(null);
            } else {
              setBackgroundParentWbs(null);
              setIsParentNav(false);
              setClosedHighlightWbs(null);
            }
            setSelectedTicketWbs(t.wbs);
          }
        }}
        showParentBackground={!!backgroundParentWbs}
        projectPermissions={projectPermissions ?? undefined}
        forceNoAnim={isParentNav}
      />
      </div>{/* 🌟 BRU5-043: 通常スクロール領域ここまで */}
    </div>
  );
}