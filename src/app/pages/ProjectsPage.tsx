import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, FolderKanban, X, Check } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, CLIENTS, MEMBERS } from "@/app/data/mock";
import { mapProject, mapClient, mapMember } from "@/app/lib/mappers";
import type { Project, Client, Member } from "@/app/types";
import { ProjectCard } from "@/app/components/projects/ProjectCard";
import { NewProjectDialog } from "@/app/components/projects/NewProjectDialog";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { Avatar } from "@/app/components/shared/Avatar";

export function ProjectsPage() {
  const { userRole, userName } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showDialog, setShowDialog] = useState(false);
  const [projects, setProjects] = useState<Project[]>(isSupabaseEnabled ? [] : PROJECTS);
  const [clients, setClients] = useState<Client[]>(isSupabaseEnabled ? [] : CLIENTS);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [assignTarget, setAssignTarget] = useState<Project | null>(null);
  const [allMembers, setAllMembers] = useState<Member[]>(isSupabaseEnabled ? [] : MEMBERS);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const canManage = userRole === "admin" || userRole === "project-manager";

  const refreshProjects = () => {
    if (!isSupabaseEnabled) return;
    supabase!.from("projects").select("*").order("id")
      .then(({ data }) => setProjects((data ?? []).map(mapProject)));
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("projects").select("*").order("id"),
      supabase!.from("clients").select("*").order("id"),
      supabase!.from("profiles").select("*").order("name"),
    ]).then(([{ data: p }, { data: c }, { data: m }]) => {
      if (p) setProjects(p.map(mapProject));
      if (c) setClients(c.map(mapClient));
      if (m) setAllMembers(m.map(mapMember));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleDeleteProject = async (project: Project) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("projects").delete().eq("id", project.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setProjects(prev => prev.filter(p => p.id !== project.id));
    toast(`「${project.name}」を削除しました`);
  };

  const handleSaveAssign = async (project: Project, memberNames: string[]) => {
    if (isSupabaseEnabled) {
      await supabase!.from("projects").update({ members: memberNames }).eq("id", project.id);
    }
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, members: memberNames } : p));
    toast(`「${project.name}」のメンバーを更新しました`);
    setAssignTarget(null);
  };

  const isAdminOrPM = userRole === "admin" || userRole === "project-manager";
  const visibleProjects = isAdminOrPM
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
        {canManage && (
          <button onClick={() => setShowDialog(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <Plus style={{ width: 15, height: 15 }} />新規プロジェクト
          </button>
        )}
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
              onNavigate={() => navigate(`/projects/${p.id}/sprints`)}
              onDelete={canManage ? () => setDeleteTarget(p) : undefined}
              onAssign={canManage ? () => setAssignTarget(p) : undefined}
            />
          ))}
        </div>
      )}

      {showDialog && <NewProjectDialog onClose={() => setShowDialog(false)} clients={clients} onCreated={refreshProjects} />}
      {deleteTarget && (
        <ConfirmDialog
          message={`「${deleteTarget.name}」を削除しますか？関連するスプリントとチケットもすべて削除されます。`}
          onConfirm={() => handleDeleteProject(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
      {assignTarget && (
        <AssignMembersModal
          project={assignTarget}
          allMembers={allMembers}
          onClose={() => setAssignTarget(null)}
          onSave={(names) => handleSaveAssign(assignTarget, names)} />
      )}
    </div>
  );
}

// ── Assign members modal ────────────────────────────────────────────────────
function AssignMembersModal({ project, allMembers, onClose, onSave }: {
  project: Project;
  allMembers: Member[];
  onClose: () => void;
  onSave: (names: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(project.members));
  const [saving, setSaving] = useState(false);

  const toggle = (name: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave([...selected]);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 460, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>メンバー割り当て</h3>
            <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project.name}</p>
          </div>
          <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
          {allMembers.filter(m => m.role !== "admin").length === 0 ? (
            <p style={{ textAlign: "center", color: "#B0A9A4", fontSize: 13, padding: "24px 0" }}>メンバーが登録されていません</p>
          ) : allMembers.filter(m => m.role !== "admin").map(m => {
            const isSelected = selected.has(m.name);
            return (
              <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 2, transition: "background 0.1s" }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? "#ECFDF5" : "transparent"; }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggle(m.name)}
                  style={{ accentColor: "#059669", width: 15, height: 15, cursor: "pointer" }} />
                <Avatar name={m.name} size="xs" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</p>
                  <p style={{ fontSize: 10, color: "#B0A9A4" }}>{m.email}</p>
                </div>
                {isSelected && <Check style={{ width: 13, height: 13, color: "#059669", flexShrink: 0 }} />}
              </label>
            );
          })}
        </div>

        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(26,23,20,0.07)", display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#059669", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : `${selected.size}名を割り当て`}
          </button>
          <button onClick={onClose}
            style={{ padding: "10px 18px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}
