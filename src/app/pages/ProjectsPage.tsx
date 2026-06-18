import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, FolderKanban } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, CLIENTS } from "@/app/data/mock";
import { mapProject, mapClient, mapSprint } from "@/app/lib/mappers";
import { downloadProjectCsv } from "@/app/lib/csvExport";
import type { Project, Client } from "@/app/types";
import { ProjectCard } from "@/app/components/projects/ProjectCard";
import { NewProjectDialog } from "@/app/components/projects/NewProjectDialog";
import { EditProjectDialog } from "@/app/components/projects/EditProjectDialog";
import { CategorySettingsModal } from "@/app/components/projects/CategorySettingsModal";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";

export function ProjectsPage() {
  const { userRole, userName, userOrgId } = useAuth();
  const { toast } = useToast();
  const { selectedOrgId } = useOrg();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [projects, setProjects] = useState<Project[]>(isSupabaseEnabled ? [] : PROJECTS);
  const [clients, setClients] = useState<Client[]>(isSupabaseEnabled ? [] : CLIENTS);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [categoryTarget, setCategoryTarget] = useState<Project | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const isOwner = userRole === "owner";
  const canManage = isOwner || userRole === "admin" || userRole === "project-manager";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const computeTicketCounts = (sprints: any[]) => {
    const map = new Map<string, { done: number; inProgress: number; todo: number }>();
    for (const sprint of sprints) {
      const pid = sprint.project_id;
      if (!map.has(pid)) map.set(pid, { done: 0, inProgress: 0, todo: 0 });
      const counts = map.get(pid)!;
      for (const t of (sprint.sprint_tickets ?? [])) {
        if (t.status === "done" || t.status === "closed") counts.done++;
        else if (t.status === "todo") counts.todo++;
        else counts.inProgress++;
      }
    }
    return map;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mergeTicketCounts = (projectRows: any[], counts: Map<string, { done: number; inProgress: number; todo: number }>) =>
    projectRows.map(r => {
      const mapped = mapProject(r);
      const c = counts.get(r.id);
      if (c) { mapped.done = c.done; mapped.inProgress = c.inProgress; mapped.todo = c.todo; }
      return mapped;
    });

  const buildProjectQuery = () => {
    let q = supabase!.from("projects").select("*").order("id");
    if (isOwner) {
      // オーナーはOrgSelectorで選択した組織のみ
      if (selectedOrgId) q = q.eq("organization_id", selectedOrgId);
    } else if (userOrgId) {
      // 一般ユーザーは自分の組織のみ（organization_id未設定も暫定的に含む）
      q = q.or(`organization_id.eq.${userOrgId},organization_id.is.null`);
    }
    return q;
  };

  const refreshProjects = () => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      buildProjectQuery(),
      supabase!.from("sprints").select("project_id, sprint_tickets(status)").order("id"),
    ]).then(([{ data: p }, { data: s }]) => {
      if (p) setProjects(mergeTicketCounts(p, computeTicketCounts(s ?? [])));
    });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      buildProjectQuery(),
      supabase!.from("clients").select("*").order("id"),
      supabase!.from("sprints").select("project_id, sprint_tickets(status)").order("id"),
    ]).then(([{ data: p }, { data: c }, { data: s }]) => {
      if (p) setProjects(mergeTicketCounts(p, computeTicketCounts(s ?? [])));
      if (c) setClients(c.map(mapClient));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [isOwner, userOrgId, selectedOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteProject = async (project: Project) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("projects").delete().eq("id", project.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setProjects(prev => prev.filter(p => p.id !== project.id));
    toast(`「${project.name}」を削除しました`);
  };

  const handleDownloadProject = async (project: Project) => {
    if (!isSupabaseEnabled) return;
    const [{ data: sprintData }, { data: categoryData }] = await Promise.all([
      supabase!.from("sprints").select("*, sprint_tickets(*)").eq("project_id", project.id).order("id"),
      supabase!.from("ticket_categories").select("id, name").eq("project_id", project.id),
    ]);
    const sprints = (sprintData ?? []).map(mapSprint);
    const categories = (categoryData ?? []) as Array<{ id: string; name: string }>;
    downloadProjectCsv(project.name, sprints, categories);
  };

  const visibleProjects = (isOwner || userRole === "admin")
    ? projects
    : projects.filter(p => p.members.includes(userName));

  const filtered = visibleProjects.filter(p => {
    const ms = p.name.includes(search) || p.client.includes(search) || p.id.includes(search);
    return ms && (statusFilter === "all" || p.status === statusFilter);
  });

  const statusOpts = [
    { value: "all", label: "すべて", count: visibleProjects.length },
    { value: "in-progress", label: "進行中", count: visibleProjects.filter(p => p.status === "in-progress").length },
    { value: "planning", label: "計画中", count: visibleProjects.filter(p => p.status === "planning").length },
    { value: "on-hold", label: "保留中", count: visibleProjects.filter(p => p.status === "on-hold").length },
    { value: "completed", label: "完了", count: visibleProjects.filter(p => p.status === "completed").length },
  ];

  if (loading) return <PageLoader />;

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>プロジェクト管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>進行中のプロジェクトとスプリント</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <OrgSelector />
          {canManage && (
            <button onClick={() => setShowDialog(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
              <Plus style={{ width: 15, height: 15 }} />新規プロジェクト
            </button>
          )}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前、クライアントで検索..."
            style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", width: 240 }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {statusOpts.map(opt => (
            <button key={opt.value} onClick={() => setStatusFilter(opt.value)}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", fontSize: 12, fontWeight: 500, borderRadius: 8, border: "1px solid", cursor: "pointer", transition: "all 0.15s", background: statusFilter === opt.value ? "#059669" : "#FFFFFF", color: statusFilter === opt.value ? "#fff" : "#6B6458", borderColor: statusFilter === opt.value ? "#059669" : "rgba(26,23,20,0.10)" }}>
              {opt.label}
              <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", opacity: 0.7 }}>{opt.count}</span>
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0" }}>
          <div style={{ width: 56, height: 56, background: "#F4F5F6", borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <FolderKanban style={{ width: 24, height: 24, color: "#B0A9A4" }} />
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#3D3732" }}>プロジェクトが見つかりません</p>
          <p style={{ fontSize: 12, color: "#B0A9A4", marginTop: 4 }}>検索条件を変更してみてください</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p}
              onNavigate={() => navigate(p.slug ? `/${p.slug}` : `/${p.id}`)}
              onEdit={canManage ? () => setEditTarget(p) : undefined}
              onDelete={canManage ? () => setDeleteTarget(p) : undefined}
              onCategorySettings={canManage ? () => setCategoryTarget(p) : undefined}
              onDownload={() => handleDownloadProject(p)}
            />
          ))}
        </div>
      )}

      {showDialog && <NewProjectDialog onClose={() => setShowDialog(false)} clients={clients} onCreated={refreshProjects} />}
      {editTarget && <EditProjectDialog project={editTarget} onClose={() => setEditTarget(null)} onUpdated={() => { refreshProjects(); setEditTarget(null); }} />}
      {deleteTarget && (
        <ConfirmDialog
          message={`「${deleteTarget.name}」を削除しますか？関連するスプリントとチケットもすべて削除されます。`}
          onConfirm={() => handleDeleteProject(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
      {categoryTarget && (
        <CategorySettingsModal
          projectId={categoryTarget.id}
          projectName={categoryTarget.name}
          onClose={() => setCategoryTarget(null)} />
      )}
    </div>
  );
}