import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { Search, Plus, FolderKanban, X, Check, AlertTriangle, ShieldCheck, Users } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { PROJECTS, CLIENTS, MEMBERS } from "@/app/data/mock";
import { mapProject, mapClient, mapMember } from "@/app/lib/mappers";
import type { Project, Client, Member, PermissionGroup, UserPermissions } from "@/app/types";
import { ProjectCard } from "@/app/components/projects/ProjectCard";
import { NewProjectDialog } from "@/app/components/projects/NewProjectDialog";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { Avatar } from "@/app/components/shared/Avatar";

const PERM_FLAGS: { key: keyof UserPermissions; label: string; color: string }[] = [
  { key: "canCreateTicket",    label: "チケット作成",   color: "#059669" },
  { key: "canCreateSprint",    label: "スプリント作成", color: "#0284C7" },
  { key: "canEditDelete",      label: "編集・削除",     color: "#D97706" },
  { key: "canReview",          label: "レビュー権限",   color: "#7C3AED" },
  { key: "canGeneratePrompt",  label: "プロンプト生成", color: "#DB2777" },
];

const DEFAULT_PERMS: UserPermissions = {
  canCreateTicket: false, canCreateSprint: false, canEditDelete: false, canReview: false, canGeneratePrompt: false,
};

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
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
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
      supabase!.from("permission_groups").select("*").order("id"),
    ]).then(([{ data: p }, { data: c }, { data: m }, { data: g }]) => {
      if (p) setProjects(p.map(mapProject));
      if (c) setClients(c.map(mapClient));
      if (m) setAllMembers(m.map(mapMember));
      if (g) setGroups(g as PermissionGroup[]);
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

  const handleSaveAssign = async (
    project: Project,
    memberNames: string[],
    groupIds: number[],
    removedFromGroup: string[],
  ) => {
    if (isSupabaseEnabled) {
      // Remove excluded members from their groups in DB (set permission_group_id = null)
      for (const name of removedFromGroup) {
        const m = allMembers.find(mb => mb.name === name);
        if (m?.permission_group_id != null) {
          await supabase!.from("profiles").update({ permission_group_id: null }).eq("id", m.id);
        }
      }
      await supabase!.from("projects").update({ members: memberNames, group_ids: groupIds }).eq("id", project.id);
    }
    // Update local allMembers so next modal open has correct group membership
    if (removedFromGroup.length > 0) {
      setAllMembers(prev => prev.map(m =>
        removedFromGroup.includes(m.name) ? { ...m, permission_group_id: null } : m
      ));
    }
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, members: memberNames, groupIds } : p));
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
          groups={groups}
          onClose={() => setAssignTarget(null)}
          onSave={(names, groupIds, rfg) => handleSaveAssign(assignTarget, names, groupIds, rfg)} />
      )}
    </div>
  );
}

// ── Assign members modal ────────────────────────────────────────────────────
function AssignMembersModal({ project, allMembers, groups, onClose, onSave }: {
  project: Project;
  allMembers: Member[];
  groups: PermissionGroup[];
  onClose: () => void;
  onSave: (names: string[], groupIds: number[], removedFromGroup: string[]) => void;
}) {
  // ── Initial state (computed once on mount) ──────────────────────────────
  const initialGroupIds = new Set<number>(project.groupIds || []);
  const initGroupCovered = new Set<string>();
  for (const gid of initialGroupIds) {
    allMembers.filter(m => m.permission_group_id === gid).forEach(m => initGroupCovered.add(m.name));
  }

  // ── State ────────────────────────────────────────────────────────────────
  // Individually selected members (excludes those covered by groups on open)
  const [selected, setSelected] = useState<Set<string>>(
    new Set(project.members.filter(name => !initGroupCovered.has(name)))
  );
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(initialGroupIds);
  // Members removed from their group this session (treated as permission_group_id=null)
  const [removedFromGroup, setRemovedFromGroup] = useState<Set<string>>(new Set());
  const [conflict, setConflict] = useState<{ groupId: number; groupName: string; names: string[] } | null>(null);
  const [permTarget, setPermTarget] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Derived: treat removedFromGroup members as ungrouped ─────────────────
  const effectiveAllMembers = useMemo(() =>
    removedFromGroup.size === 0
      ? allMembers
      : allMembers.map(m => removedFromGroup.has(m.name) ? { ...m, permission_group_id: null as null } : m),
    [allMembers, removedFromGroup]
  );

  const nonAdminMembers = effectiveAllMembers.filter(m => m.role !== "admin");

  // Names covered by currently selected groups (using effectiveAllMembers)
  const groupCoveredNames = useMemo(() => {
    const names = new Set<string>();
    for (const gid of selectedGroupIds) {
      effectiveAllMembers
        .filter(m => m.permission_group_id === gid)
        .forEach(m => names.add(m.name));
    }
    return names;
  }, [selectedGroupIds, effectiveAllMembers]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const toggleMember = (name: string) => {
    setSelected(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n; });
  };

  const toggleGroup = (groupId: number, groupName: string) => {
    if (selectedGroupIds.has(groupId)) {
      setSelectedGroupIds(prev => { const n = new Set(prev); n.delete(groupId); return n; });
      return;
    }
    // Conflict = members in this group that are also individually selected
    const groupMemberNames = effectiveAllMembers.filter(m => m.permission_group_id === groupId).map(m => m.name);
    const conflicts = groupMemberNames.filter(n => selected.has(n));
    if (conflicts.length > 0) {
      setConflict({ groupId, groupName, names: conflicts });
      return;
    }
    setSelectedGroupIds(prev => new Set([...prev, groupId]));
  };

  const resolveConflict = (resolution: "remove-individual" | "exclude-from-group") => {
    if (!conflict) return;
    const groupId = conflict.groupId;
    const names = [...conflict.names];

    if (resolution === "remove-individual") {
      // Remove from individual selection → they become group-only
      setSelected(prev => {
        const n = new Set(prev);
        names.forEach(name => n.delete(name));
        return n;
      });
    } else {
      // Mark as removed from group → effectiveAllMembers treats them as ungrouped
      // so count decreases immediately and groupCoveredNames excludes them
      setRemovedFromGroup(prev => new Set([...prev, ...names]));
    }
    setSelectedGroupIds(prev => new Set([...prev, groupId]));
    setConflict(null);
  };

  const getEffectiveNames = (): string[] => {
    const all = new Set([...selected]);
    for (const gid of selectedGroupIds) {
      effectiveAllMembers.filter(m => m.permission_group_id === gid).forEach(m => all.add(m.name));
    }
    return [...all];
  };

  const handleSave = async () => {
    setSaving(true);
    if (isSupabaseEnabled) {
      for (const gid of selectedGroupIds) {
        const grp = groups.find(g => g.id === gid);
        if (grp?.permissions) {
          const memberIds = effectiveAllMembers.filter(m => m.permission_group_id === gid).map(m => m.id);
          for (const mid of memberIds) {
            await supabase!.from("profiles").update({ permissions: grp.permissions }).eq("id", mid);
          }
        }
      }
    }
    await onSave(getEffectiveNames(), [...selectedGroupIds], [...removedFromGroup]);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 500, maxHeight: "82vh", display: "flex", flexDirection: "column" }}>

        {/* Header */}
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
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

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>

          {/* Conflict resolution banner */}
          {conflict && (
            <div style={{ background: "#FFFBEB", border: "1.5px solid rgba(217,119,6,0.30)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <AlertTriangle style={{ width: 15, height: 15, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
                <div>
                  <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>
                    グループ「{conflict.groupName}」に重複があります
                  </p>
                  <p style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>
                    以下のメンバーはすでに個別でアサインされています：{conflict.names.join("、")}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => resolveConflict("remove-individual")}
                  style={{ flex: 1, padding: "7px 10px", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1.5px solid rgba(217,119,6,0.40)", background: "#FEF3C7", color: "#92400E", cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FDE68A"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FEF3C7"; }}>
                  個別割り当てを外してグループ適用
                </button>
                <button onClick={() => resolveConflict("exclude-from-group")}
                  style={{ flex: 1, padding: "7px 10px", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1.5px solid rgba(26,23,20,0.12)", background: "#FFF", color: "#6B6458", cursor: "pointer" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FFF"; }}>
                  グループから除外・個別を維持
                </button>
              </div>
            </div>
          )}

          {/* Groups section */}
          {groups.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
                <Users style={{ width: 11, height: 11 }} />グループ
              </p>
              {groups.map(group => {
                const groupMembers = effectiveAllMembers.filter(m => m.permission_group_id === group.id);
                const isSelected = selectedGroupIds.has(group.id);
                const activePerms = PERM_FLAGS.filter(f => group.permissions?.[f.key]);
                return (
                  <div key={group.id}
                    onClick={() => toggleGroup(group.id, group.name)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, cursor: "pointer", background: isSelected ? "#ECFDF5" : "#F9F8F6", marginBottom: 4, transition: "background 0.1s", border: `1px solid ${isSelected ? "rgba(5,150,105,0.25)" : "transparent"}`, userSelect: "none" as const }}
                    onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? "#ECFDF5" : "#F9F8F6"; }}>
                    <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${isSelected ? "#059669" : "rgba(26,23,20,0.25)"}`, background: isSelected ? "#059669" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                      {isSelected && <Check style={{ width: 10, height: 10, color: "#FFF" }} />}
                    </div>
                    <div style={{ width: 30, height: 30, borderRadius: 8, background: isSelected ? "#D1FAE5" : "#F4F5F6", border: `1px solid ${isSelected ? "rgba(5,150,105,0.25)" : "rgba(26,23,20,0.08)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                      <Users style={{ width: 14, height: 14, color: isSelected ? "#059669" : "#B0A9A4" }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{group.name}</p>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const, marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: "#B0A9A4" }}>{groupMembers.length}名</span>
                        {activePerms.map(f => (
                          <span key={f.key} style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: f.color + "15", color: f.color }}>{f.label}</span>
                        ))}
                        {activePerms.length === 0 && <span style={{ fontSize: 9, color: "#C9C4BB" }}>チケット参照のみ</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Individual members section */}
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
            個別メンバー
          </p>
          {nonAdminMembers.length === 0 ? (
            <p style={{ textAlign: "center" as const, color: "#B0A9A4", fontSize: 13, padding: "16px 0" }}>メンバーが登録されていません</p>
          ) : nonAdminMembers.map(m => {
            // Hide members already covered by a selected group
            if (groupCoveredNames.has(m.name)) {
              return (
                <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, marginBottom: 2, background: "#F0FDF8", border: "1px solid rgba(5,150,105,0.15)", opacity: 0.7 }}>
                  <div style={{ width: 16, height: 16, borderRadius: 4, border: "2px solid rgba(5,150,105,0.30)", background: "transparent", flexShrink: 0 }} />
                  <Avatar name={m.name} size="xs" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714" }}>{m.name}</p>
                    <p style={{ fontSize: 10, color: "#059669", display: "flex", alignItems: "center", gap: 3 }}>
                      <Users style={{ width: 9, height: 9 }} />グループ経由でアサイン済み
                    </p>
                  </div>
                </div>
              );
            }
            const isSelected = selected.has(m.name);
            return (
              <div key={m.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 9, cursor: "pointer", background: isSelected ? "#ECFDF5" : "transparent", marginBottom: 2, transition: "background 0.1s", border: `1px solid ${isSelected ? "rgba(5,150,105,0.15)" : "transparent"}` }}
                onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? "#ECFDF5" : "transparent"; }}>
                <input type="checkbox" checked={isSelected} onChange={() => toggleMember(m.name)}
                  style={{ accentColor: "#059669", width: 15, height: 15, cursor: "pointer" }} />
                <Avatar name={m.name} size="xs" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.name}</p>
                  <p style={{ fontSize: 10, color: "#B0A9A4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.email}</p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setPermTarget(m); }}
                  style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, borderRadius: 6, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", gap: 3 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.borderColor = "#059669"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}>
                  <ShieldCheck style={{ width: 10, height: 10 }} />権限
                </button>
                {isSelected && <Check style={{ width: 13, height: 13, color: "#059669", flexShrink: 0 }} />}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(26,23,20,0.07)", display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#059669", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : "アサイン"}
          </button>
          <button onClick={onClose}
            style={{ flex: 1, padding: "10px 0", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>

      {/* Per-user permission modal */}
      {permTarget && (
        <MemberPermModal
          member={permTarget}
          projectId={project.id}
          onClose={() => setPermTarget(null)}
        />
      )}
    </>
  );
}

// ── Per-user permission modal (from assign modal) ────────────────────────────
function MemberPermModal({ member, projectId, onClose }: { member: Member; projectId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_PERMS });
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoaded(true); return; }
    // Load: role base_permissions → merge project-specific override if exists
    Promise.all([
      supabase!.from("roles").select("base_permissions").eq("name", member.role).single(),
      supabase!.from("project_member_permissions")
        .select("permissions").eq("project_id", projectId).eq("member_id", member.id).maybeSingle(),
    ]).then(([{ data: roleData }, { data: projData }]) => {
      const base = { ...DEFAULT_PERMS, ...(roleData?.base_permissions as Partial<UserPermissions> ?? {}) };
      if (projData?.permissions) {
        setLocal({ ...base, ...(projData.permissions as Partial<UserPermissions>) });
      } else {
        setLocal(base);
      }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [member.id, member.role, projectId]);

  const toggle = (key: keyof UserPermissions) => setLocal(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    setSaving(true);
    if (isSupabaseEnabled) {
      const { error } = await supabase!
        .from("project_member_permissions")
        .upsert({ project_id: projectId, member_id: member.id, permissions: local });
      if (error) {
        toast("権限の保存に失敗しました。", "error");
        setSaving(false);
        return;
      }
    }
    onClose();
    setSaving(false);
  };

  const PERM_FLAGS_FULL = [
    { key: "canCreateTicket"   as keyof UserPermissions, label: "チケット作成",   desc: "チケットの新規作成が可能", color: "#059669" },
    { key: "canCreateSprint"   as keyof UserPermissions, label: "スプリント作成", desc: "スプリントの新規作成が可能", color: "#0284C7" },
    { key: "canEditDelete"     as keyof UserPermissions, label: "編集・削除",     desc: "チケット・スプリントの編集・削除が可能", color: "#D97706" },
    { key: "canReview"         as keyof UserPermissions, label: "レビュー権限",   desc: "レビュアーとして承認・差し戻しが可能", color: "#7C3AED" },
    { key: "canGeneratePrompt" as keyof UserPermissions, label: "プロンプト生成", desc: "ClaudeCode プロンプトの生成が可能", color: "#DB2777" },
  ];

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(10,14,12,0.25)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 501, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.25)", width: 420 }}>
        <div style={{ padding: "20px 22px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Avatar name={member.name} size="sm" />
            <div>
              <h3 style={{ fontSize: 14, fontWeight: 800, color: "#1A1714" }}>{member.name}</h3>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>個別権限設定</p>
            </div>
          </div>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <X style={{ width: 14, height: 14 }} />
          </button>
        </div>
        <div style={{ padding: "14px 22px" }}>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 12 }}>チケット参照・コメントはデフォルトで付与されます。</p>
          {!loaded
            ? <p style={{ textAlign: "center" as const, color: "#B0A9A4", fontSize: 13, padding: "16px 0" }}>読み込み中...</p>
            : PERM_FLAGS_FULL.map(f => {
              const active = local[f.key];
              return (
                <label key={f.key}
                  onClick={() => toggle(f.key)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 9, cursor: "pointer", marginBottom: 5, background: active ? f.color + "0D" : "#F9F8F6", border: `1.5px solid ${active ? f.color + "33" : "transparent"}`, transition: "all 0.15s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${active ? f.color : "rgba(26,23,20,0.15)"}`, background: active ? f.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                    {active && <Check style={{ width: 10, height: 10, color: "#FFF" }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: active ? f.color : "#1A1714", marginBottom: 1 }}>{f.label}</p>
                    <p style={{ fontSize: 10, color: "#A09790" }}>{f.desc}</p>
                  </div>
                </label>
              );
            })
          }
        </div>
        <div style={{ padding: "12px 22px 18px", display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving || !loaded}
            style={{ flex: 1, padding: "9px 0", background: (saving || !loaded) ? "#F4F5F6" : "#059669", color: (saving || !loaded) ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: (saving || !loaded) ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button onClick={onClose}
            style={{ padding: "9px 16px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}
