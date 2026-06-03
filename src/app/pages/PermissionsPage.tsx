import { useEffect, useMemo, useState, type DragEvent } from "react";
import { Plus, X, Check, Users, GripVertical, Settings, AlertTriangle, CalendarRange, FolderKanban, ChevronDown, ChevronUp } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapMember, mapProject } from "@/app/lib/mappers";
import { getRoleMeta } from "@/app/lib/helpers";
import type { Member, PermissionGroup, UserPermissions, Project } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { Navigate } from "react-router";

// Project-level permission flags only (admin-level flags are in ロール設定)
const PROJECT_PERM_FLAGS: { key: keyof UserPermissions; label: string; desc: string; color: string }[] = [
  { key: "canCreateTicket",   label: "チケット作成",   desc: "チケットの新規作成が可能",             color: "#059669" },
  { key: "canCreateSprint",   label: "スプリント作成", desc: "スプリントの新規作成が可能",           color: "#0284C7" },
  { key: "canEditDelete",     label: "編集・削除",     desc: "チケット・スプリントの編集・削除が可能", color: "#D97706" },
  { key: "canReview",         label: "レビュー権限",   desc: "レビュアーとして承認・差し戻しが可能",  color: "#7C3AED" },
];

const DEFAULT_GROUP_PERMS: UserPermissions = {
  canCreateTicket: false, canCreateSprint: false,
  canEditDelete: false, canReview: false, canSkipReview: false, canGeneratePrompt: false,
  canAccessMembers: false, canAccessRoles: false, canAccessGroups: false,
};

// Drag payload type identifier
type DragType = "member" | "group";
interface DragPayload { type: DragType; id: string }

interface GroupMembership { group_id: number; member_id: string }

interface ConflictInfo {
  names: string[];
  resolution: null | "remove-individual" | "exclude-from-group";
  pendingGroupId?: number;
  pendingProjectId?: string;
}

export function PermissionsPage() {
  const { userPermissions, userName, userRole } = useAuth();
  const { toast } = useToast();

  if (!userPermissions.canAccessGroups) return <Navigate to="/dashboard" replace />;

  const [groups, setGroups]             = useState<PermissionGroup[]>([]);
  const [members, setMembers]           = useState<Member[]>([]);
  const [projects, setProjects]         = useState<Project[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<GroupMembership[]>([]);
  const [dragOver, setDragOver]         = useState<{ type: "group" | "project"; id: number | string } | null>(null);
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [settingsGroupId, setSettingsGroupId]     = useState<number | null>(null);
  const [conflict, setConflict]         = useState<ConflictInfo | null>(null);
  const [permTarget, setPermTarget]     = useState<{ member: Member; projectId: string } | null>(null);
  const [loading, setLoading]           = useState(isSupabaseEnabled);
  const [needsMigration, setNeedsMigration] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    // Load base tables first, then group_members separately with fallback
    Promise.all([
      supabase!.from("permission_groups").select("*").order("id"),
      supabase!.from("profiles").select("*").order("name"),
      supabase!.from("projects").select("*").order("id"),
    ]).then(([{ data: gData }, { data: mData }, { data: pData }]) => {
      if (gData) setGroups(gData as PermissionGroup[]);
      if (mData) setMembers(mData.map(mapMember));
      if (pData) setProjects(pData.map(mapProject));
      // Load group_members separately — table may not exist yet (migration required)
      return supabase!.from("group_members").select("*");
    }).then(({ data: gmData, error: gmError }) => {
      if (gmError) {
        // 404 = table doesn't exist yet. Show migration notice but don't crash.
        setNeedsMigration(true);
      } else if (gmData) {
        setGroupMemberships(gmData as GroupMembership[]);
      }
      setLoading(false);
    }).catch(() => {
      setNeedsMigration(true);
      setLoading(false);
    });
  }, []);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getMemberGroupIds = (memberId: string) =>
    groupMemberships.filter(gm => gm.member_id === memberId).map(gm => gm.group_id);

  const getGroupMemberIds = (groupId: number) =>
    groupMemberships.filter(gm => gm.group_id === groupId).map(gm => gm.member_id);

  // Names of members individually assigned (not via any group) to a project
  const getIndividualMemberNames = (project: Project): string[] => {
    const groupCovered = new Set<string>();
    for (const gid of project.groupIds ?? []) {
      getGroupMemberIds(gid).forEach(mid => {
        const m = members.find(m => m.id === mid);
        if (m) groupCovered.add(m.name);
      });
    }
    return (project.members ?? []).filter(name => !groupCovered.has(name));
  };

  // All member names in a project (individual + group-based)
  const getAllProjectMemberNames = (project: Project, gIds?: number[], indivNames?: string[]): string[] => {
    const grpIds = gIds ?? project.groupIds ?? [];
    const individual = indivNames ?? getIndividualMemberNames(project);
    const all = new Set(individual);
    for (const gid of grpIds) {
      getGroupMemberIds(gid).forEach(mid => {
        const m = members.find(m => m.id === mid);
        if (m) all.add(m.name);
      });
    }
    return [...all];
  };

  // ── Drag & Drop ──────────────────────────────────────────────────────────────

  const startDrag = (e: DragEvent, payload: DragPayload) => {
    e.dataTransfer.setData("payload", JSON.stringify(payload));
    e.dataTransfer.effectAllowed = "move";
  };

  const getPayload = (e: DragEvent): DragPayload | null => {
    try { return JSON.parse(e.dataTransfer.getData("payload")); } catch { return null; }
  };

  // Drop on group → add member to group
  const handleDropOnGroup = async (e: DragEvent, groupId: number) => {
    e.preventDefault();
    setDragOver(null);
    if (needsMigration) {
      toast("DBマイグレーションが必要です。画面上部の案内に従ってください。", "error");
      return;
    }
    const payload = getPayload(e);
    if (!payload || payload.type !== "member") return;
    const memberId = payload.id;
    if (groupMemberships.some(gm => gm.group_id === groupId && gm.member_id === memberId)) return;

    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("group_members")
        .insert({ group_id: groupId, member_id: memberId });
      if (error) { toast("グループへの追加に失敗しました", "error"); return; }
    }
    setGroupMemberships(prev => [...prev, { group_id: groupId, member_id: memberId }]);
    toast("グループにメンバーを追加しました");
  };

  const removeMemberFromGroup = async (groupId: number, memberId: string) => {
    if (isSupabaseEnabled) {
      await supabase!.from("group_members")
        .delete().eq("group_id", groupId).eq("member_id", memberId);
    }
    setGroupMemberships(prev => prev.filter(gm => !(gm.group_id === groupId && gm.member_id === memberId)));
  };

  // Drop on project
  const handleDropOnProject = async (e: DragEvent, project: Project) => {
    e.preventDefault();
    setDragOver(null);
    const payload = getPayload(e);
    if (!payload) return;

    if (payload.type === "member") {
      await handleAddMemberToProject(payload.id, project);
    } else if (payload.type === "group") {
      await handleAddGroupToProject(Number(payload.id), project);
    }
  };

  const handleAddMemberToProject = async (memberId: string, project: Project) => {
    const member = members.find(m => m.id === memberId);
    if (!member) return;

    if (member.role === "admin" && userRole !== "admin") {
      toast("管理者メンバーをアサインする権限がありません", "error");
      return;
    }

    // Check double assignment: already via group?
    const memberGroupIds = getMemberGroupIds(memberId);
    const projectGroupIds = project.groupIds ?? [];
    const alreadyViaGroup = memberGroupIds.some(gid => projectGroupIds.includes(gid));
    if (alreadyViaGroup) {
      toast(`「${member.name}」はすでにグループ経由でこのプロジェクトにアサイン済みです`, "error");
      return;
    }

    // Already individually?
    const indivNames = getIndividualMemberNames(project);
    if (indivNames.includes(member.name)) return;

    const newMembers = getAllProjectMemberNames(project, undefined, [...indivNames, member.name]);
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("projects")
        .update({ members: newMembers }).eq("id", project.id);
      if (error) { toast("アサインの保存に失敗しました", "error"); return; }
      // Create an explicit all-false permissions record so role defaults don't leak through
      // (admin/PM keep role fallback — they always have full access)
      if (member.role !== "admin" && member.role !== "project-manager") {
        await supabase!.from("project_member_permissions")
          .upsert({ project_id: project.id, member_id: member.id, permissions: { ...DEFAULT_GROUP_PERMS } });
      }
    }
    setProjects(prev => prev.map(p => p.id === project.id ? { ...p, members: newMembers } : p));
    toast(`「${member.name}」を「${project.name}」に追加しました`);
    if (isSupabaseEnabled && member.name !== userName) {
      supabase!.from("notifications").insert({
        user_name: member.name,
        type: "assign",
        title: `「${project.name}」にアサインされました`,
        body: `${userName}さんがプロジェクトに追加しました`,
        ticket_id: null,
        ticket_wbs: "",
        ticket_title: "",
        project_slug: project.slug ?? "",
        is_read: false,
      }).then(({ error }) => {
        if (error) console.error("[notifications] project assign failed:", error.message);
      });
    }
  };

  const handleAddGroupToProject = async (groupId: number, project: Project) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;

    // Already assigned?
    if ((project.groupIds ?? []).includes(groupId)) return;

    // Conflict check: any member of this group is individually in this project?
    const groupMemberIds = getGroupMemberIds(groupId);
    const indivNames = getIndividualMemberNames(project);
    const indivMemberIds = members.filter(m => indivNames.includes(m.name)).map(m => m.id);
    const conflictMemberIds = groupMemberIds.filter(mid => indivMemberIds.includes(mid));

    if (conflictMemberIds.length > 0) {
      const conflictNames = conflictMemberIds.map(mid => members.find(m => m.id === mid)?.name ?? "").filter(Boolean);
      setConflict({ names: conflictNames, resolution: null, pendingGroupId: groupId, pendingProjectId: project.id });
      return;
    }

    await commitGroupToProject(groupId, project);
  };

  const commitGroupToProject = async (groupId: number, project: Project) => {
    const newGroupIds = [...new Set([...(project.groupIds ?? []), groupId])];
    const newMembers = getAllProjectMemberNames(project, newGroupIds, getIndividualMemberNames(project));
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("projects")
        .update({ group_ids: newGroupIds, members: newMembers }).eq("id", project.id);
      if (error) { toast("グループアサインの保存に失敗しました", "error"); return; }
      // Apply group permissions to each member in project_member_permissions
      const group = groups.find(g => g.id === groupId);
      if (group?.permissions) {
        const memberIds = getGroupMemberIds(groupId);
        for (const mid of memberIds) {
          await supabase!.from("project_member_permissions")
            .upsert({ project_id: project.id, member_id: mid, permissions: group.permissions });
        }
      }
    }
    setProjects(prev => prev.map(p =>
      p.id === project.id ? { ...p, groupIds: newGroupIds, members: newMembers } : p
    ));
    const g = groups.find(g => g.id === groupId);
    toast(`グループ「${g?.name}」を「${project.name}」にアサインしました`);
    if (isSupabaseEnabled) {
      const groupMemberNames = getGroupMemberIds(groupId)
        .map(mid => members.find(m => m.id === mid)?.name)
        .filter((name): name is string => !!name && name !== userName);
      for (const name of groupMemberNames) {
        supabase!.from("notifications").insert({
          user_name: name,
          type: "assign",
          title: `「${project.name}」にアサインされました`,
          body: `${userName}さんがグループ経由でアサインしました`,
          ticket_id: null,
          ticket_wbs: "",
          ticket_title: "",
          project_slug: project.slug ?? "",
          is_read: false,
        }).then(({ error }) => {
          if (error) console.error("[notifications] group project assign failed:", error.message);
        });
      }
    }
  };

  const resolveConflict = async (resolution: "remove-individual" | "exclude-from-group") => {
    if (!conflict || !conflict.pendingGroupId || !conflict.pendingProjectId) return;
    const project = projects.find(p => p.id === conflict.pendingProjectId);
    if (!project) return;

    if (resolution === "remove-individual") {
      // Remove conflicting members from individual assignments
      const indivNames = getIndividualMemberNames(project).filter(name => !conflict.names.includes(name));
      const newMembers = getAllProjectMemberNames(project, undefined, indivNames);
      if (isSupabaseEnabled) {
        await supabase!.from("projects").update({ members: newMembers }).eq("id", project.id);
      }
      setProjects(prev => prev.map(p => p.id === project.id ? { ...p, members: newMembers } : p));
      await commitGroupToProject(conflict.pendingGroupId, { ...project, members: newMembers });
    } else {
      // Remove conflicting members from the group
      for (const name of conflict.names) {
        const member = members.find(m => m.name === name);
        if (member) await removeMemberFromGroup(conflict.pendingGroupId, member.id);
      }
      const updatedProject = projects.find(p => p.id === conflict.pendingProjectId) ?? project;
      await commitGroupToProject(conflict.pendingGroupId, updatedProject);
    }
    setConflict(null);
  };

  const removeGroupFromProject = async (groupId: number, project: Project) => {
    const newGroupIds = (project.groupIds ?? []).filter(id => id !== groupId);
    const newMembers = getAllProjectMemberNames(project, newGroupIds, getIndividualMemberNames(project));
    if (isSupabaseEnabled) {
      await supabase!.from("projects").update({ group_ids: newGroupIds, members: newMembers }).eq("id", project.id);
    }
    setProjects(prev => prev.map(p =>
      p.id === project.id ? { ...p, groupIds: newGroupIds, members: newMembers } : p
    ));
  };

  const removeMemberFromProject = async (memberName: string, project: Project) => {
    const newIndiv = getIndividualMemberNames(project).filter(n => n !== memberName);
    const newMembers = getAllProjectMemberNames(project, undefined, newIndiv);
    if (isSupabaseEnabled) {
      await supabase!.from("projects").update({ members: newMembers }).eq("id", project.id);
    }
    setProjects(prev => prev.map(p =>
      p.id === project.id ? { ...p, members: newMembers } : p
    ));
  };

  // ── Group CRUD ────────────────────────────────────────────────────────────────

  const handleCreateGroup = async (name: string, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase!.from("permission_groups")
        .insert({ name, description: "", permissions: perms }).select().single();
      if (error) { toast("グループの作成に失敗しました", "error"); return; }
      if (data) setGroups(prev => [...prev, data as PermissionGroup]);
    } else {
      const newId = groups.length > 0 ? Math.max(...groups.map(g => g.id)) + 1 : 1;
      setGroups(prev => [...prev, { id: newId, name, description: "", permissions: perms }]);
    }
    toast(`グループ「${name}」を作成しました`);
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (isSupabaseEnabled) {
      await supabase!.from("group_members").delete().eq("group_id", groupId);
      await supabase!.from("permission_groups").delete().eq("id", groupId);
    }
    // Remove group from all projects
    const affectedProjects = projects.filter(p => (p.groupIds ?? []).includes(groupId));
    for (const project of affectedProjects) {
      const newGroupIds = (project.groupIds ?? []).filter(id => id !== groupId);
      const newMembers = getAllProjectMemberNames(project, newGroupIds, getIndividualMemberNames(project));
      if (isSupabaseEnabled) {
        await supabase!.from("projects").update({ group_ids: newGroupIds, members: newMembers }).eq("id", project.id);
      }
      setProjects(prev => prev.map(p =>
        p.id === project.id ? { ...p, groupIds: newGroupIds, members: newMembers } : p
      ));
    }
    setGroupMemberships(prev => prev.filter(gm => gm.group_id !== groupId));
    setGroups(prev => prev.filter(g => g.id !== groupId));
    toast("グループを削除しました");
  };

  const handleSaveGroup = async (groupId: number, name: string, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("permission_groups")
        .update({ name, permissions: perms }).eq("id", groupId);
      if (error) { toast("グループ設定の保存に失敗しました", "error"); return; }
    }
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, name, permissions: perms } : g));
    setSettingsGroupId(null);
    toast("グループ設定を保存しました");
  };

  // ── Computed ──────────────────────────────────────────────────────────────────

  const nonAdminMembers = useMemo(() => members.filter(m => m.role !== "admin"), [members]);
  const allMembersForList = members;
  const settingsGroup = groups.find(g => g.id === settingsGroupId);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "60vh", color: "#A09790", fontSize: 13 }}>
        読み込み中...
      </div>
    );
  }

  return (
    <div style={{ padding: "28px 24px", height: "100%", display: "flex", flexDirection: "column" as const }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, flexShrink: 0 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#059669,#047857)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(5,150,105,0.30)" }}>
              <CalendarRange style={{ width: 16, height: 16, color: "#FFF" }} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>アサイン計画</h1>
          </div>
          <p style={{ fontSize: 12, color: "#A09790", marginLeft: 40 }}>グループを作成してメンバーを追加し、プロジェクトにアサインできます</p>
        </div>
        <button onClick={() => setShowNewGroupModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s", whiteSpace: "nowrap" as const }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
          <Plus style={{ width: 15, height: 15 }} />新規グループ作成
        </button>
      </div>

      {/* Migration notice — shown when group_members table doesn't exist yet */}
      {needsMigration && (
        <div style={{ background: "#FFF7ED", border: "1.5px solid rgba(234,88,12,0.35)", borderRadius: 10, padding: "12px 16px", marginBottom: 16, flexShrink: 0, display: "flex", gap: 10, alignItems: "flex-start" }}>
          <AlertTriangle style={{ width: 16, height: 16, color: "#EA580C", flexShrink: 0, marginTop: 1 }} />
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#9A3412", marginBottom: 3 }}>DBマイグレーションが必要です</p>
            <p style={{ fontSize: 12, color: "#C2410C", lineHeight: 1.6 }}>
              <code style={{ background: "rgba(234,88,12,0.12)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>group_members</code> テーブルがまだ作成されていません。<br />
              Supabase Dashboard → SQL Editor で{" "}
              <code style={{ background: "rgba(234,88,12,0.12)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>supabase/fix_all.sql</code> を実行してください。<br />
              実行後、ページを再読み込みすると機能が有効になります。
            </p>
          </div>
        </div>
      )}

      {/* How-to banner */}
      <div style={{ background: "rgba(5,150,105,0.05)", border: "1px solid rgba(5,150,105,0.15)", borderRadius: 10, padding: "10px 16px", marginBottom: 20, flexShrink: 0, display: "flex", gap: 16, alignItems: "center" }}>
        {[
          { step: "1", text: "グループを作成し、権限を設定" },
          { step: "2", text: "メンバー一覧からグループにドラッグ" },
          { step: "3", text: "グループまたはメンバーをプロジェクトにドラッグ" },
        ].map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#059669", color: "#FFF", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{s.step}</div>
            <span style={{ fontSize: 11, color: "#374151" }}>{s.text}</span>
            {i < 2 && <span style={{ color: "#C9C4BB", fontSize: 14, marginLeft: 4 }}>→</span>}
          </div>
        ))}
      </div>

      {/* 3-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 260px 1fr", gap: 16, flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* ── Column 1: Members ── */}
        <MembersColumn
          members={allMembersForList}
          groups={groups}
          groupMemberships={groupMemberships}
          onDragStart={startDrag}
          currentUserRole={userRole}
        />

        {/* ── Column 2: Groups ── */}
        <GroupsColumn
          groups={groups}
          members={members}
          groupMemberships={groupMemberships}
          dragOver={dragOver}
          onDragStart={startDrag}
          onDragOver={(e, id) => { e.preventDefault(); setDragOver({ type: "group", id }); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={handleDropOnGroup}
          onRemoveMember={removeMemberFromGroup}
          onSettings={(id) => setSettingsGroupId(id)}
          onDelete={handleDeleteGroup}
        />

        {/* ── Column 3: Projects ── */}
        <ProjectsColumn
          projects={projects}
          groups={groups}
          members={members}
          groupMemberships={groupMemberships}
          dragOver={dragOver}
          conflict={conflict}
          onDragOver={(e, id) => { e.preventDefault(); setDragOver({ type: "project", id }); }}
          onDragLeave={() => setDragOver(null)}
          onDrop={handleDropOnProject}
          onRemoveGroup={removeGroupFromProject}
          onRemoveMember={removeMemberFromProject}
          onResolveConflict={resolveConflict}
          onCancelConflict={() => setConflict(null)}
          onPermClick={(member, projectId) => setPermTarget({ member, projectId })}
          getIndividualMemberNames={getIndividualMemberNames}
          getGroupMemberIds={getGroupMemberIds}
        />
      </div>

      {showNewGroupModal && (
        <NewGroupModal onClose={() => setShowNewGroupModal(false)} onCreate={handleCreateGroup} />
      )}
      {settingsGroupId !== null && settingsGroup && (
        <GroupSettingsModal
          group={settingsGroup}
          onClose={() => setSettingsGroupId(null)}
          onSave={(name, perms) => handleSaveGroup(settingsGroupId, name, perms)}
        />
      )}
      {permTarget && (
        <IndividualMemberPermModal
          member={permTarget.member}
          projectId={permTarget.projectId}
          onClose={() => setPermTarget(null)}
        />
      )}
    </div>
  );
}

// ── Members Column ────────────────────────────────────────────────────────────
const MEMBERS_INITIAL_COUNT = 8;

function MembersColumn({ members, groups, groupMemberships, onDragStart, currentUserRole }: {
  members: Member[];
  groups: PermissionGroup[];
  groupMemberships: GroupMembership[];
  onDragStart: (e: DragEvent, payload: DragPayload) => void;
  currentUserRole: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = members.length > MEMBERS_INITIAL_COUNT;
  const displayMembers = expanded ? members : members.slice(0, MEMBERS_INITIAL_COUNT);
  const isCurrentUserAdmin = currentUserRole === "admin";

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" as const, height: "100%" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,23,20,0.06)", background: "#FAFAF9", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>メンバー一覧</p>
            <span style={{ fontSize: 11, color: "#A09790", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{members.length}名</span>
          </div>
          <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
            <GripVertical style={{ width: 10, height: 10 }} />グループかプロジェクトにドラッグ
          </p>
        </div>
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "8px" }}>
          {members.length === 0 && (
            <p style={{ textAlign: "center" as const, fontSize: 12, color: "#C9C4BB", padding: "24px 0" }}>メンバーなし</p>
          )}
          {displayMembers.map(m => {
            const memberGroupIds = groupMemberships.filter(gm => gm.member_id === m.id).map(gm => gm.group_id);
            const memberGroupNames = memberGroupIds.map(gid => groups.find(g => g.id === gid)?.name).filter(Boolean);
            const isAdmin = m.role === "admin";
            const canDrag = isCurrentUserAdmin || !isAdmin;
            return (
              <div key={m.id}
                draggable={canDrag}
                onDragStart={canDrag ? e => onDragStart(e as DragEvent, { type: "member", id: m.id }) : undefined}
                title={!canDrag ? "管理者メンバーをアサインする権限がありません" : undefined}
                style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 8px", borderRadius: 8, cursor: canDrag ? "grab" : "not-allowed", marginBottom: 3, background: "#F9F8F6", userSelect: "none" as const, transition: "background 0.1s", opacity: canDrag ? 1 : 0.55 }}
                onMouseEnter={e => { if (canDrag) (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}>
                <GripVertical style={{ width: 11, height: 11, color: canDrag ? "#C9C4BB" : "#E0DDD9", flexShrink: 0 }} />
                <Avatar name={m.name} size="xs" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.name}</p>
                  <p style={{ fontSize: 10, color: "#B0A9A4" }}>{getRoleMeta(m.role).label}</p>
                </div>
                {isAdmin && (
                  <span style={{ fontSize: 9, background: "#FEF2F2", color: "#DC2626", padding: "2px 5px", borderRadius: 8, fontWeight: 700, flexShrink: 0 }}>管理者</span>
                )}
                {!isAdmin && (memberGroupNames.length > 0
                  ? <span style={{ fontSize: 9, background: "#ECFDF5", color: "#059669", padding: "2px 5px", borderRadius: 8, fontWeight: 700, flexShrink: 0, maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}
                    title={memberGroupNames.join(", ")}>{memberGroupNames.length}G</span>
                  : <span style={{ fontSize: 9, background: "#F4F5F6", color: "#B0A9A4", padding: "2px 5px", borderRadius: 8, fontWeight: 600, flexShrink: 0 }}>未</span>
                )}
              </div>
            );
          })}

          {/* アコーディオン展開ボタン */}
          {hasMore && (
            <button
              onClick={() => setExpanded(v => !v)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "7px 8px", marginTop: 2, borderRadius: 8, border: "1.5px dashed rgba(26,23,20,0.12)", background: "transparent", cursor: "pointer", fontSize: 11, fontWeight: 600, color: "#6B6458", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.30)"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}>
              {expanded
                ? <><ChevronUp style={{ width: 12, height: 12 }} />折りたたむ</>
                : <><ChevronDown style={{ width: 12, height: 12 }} />全メンバーを見る（残り{members.length - MEMBERS_INITIAL_COUNT}名）</>
              }
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Groups Column ─────────────────────────────────────────────────────────────
function GroupsColumn({ groups, members, groupMemberships, dragOver, onDragStart, onDragOver, onDragLeave, onDrop, onRemoveMember, onSettings, onDelete }: {
  groups: PermissionGroup[];
  members: Member[];
  groupMemberships: GroupMembership[];
  dragOver: { type: "group" | "project"; id: number | string } | null;
  onDragStart: (e: DragEvent, payload: DragPayload) => void;
  onDragOver: (e: DragEvent, id: number) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent, groupId: number) => void;
  onRemoveMember: (groupId: number, memberId: string) => void;
  onSettings: (groupId: number) => void;
  onDelete: (groupId: number) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, minHeight: 0 }}>
      <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" as const, height: "100%" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(26,23,20,0.06)", background: "#FAFAF9", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>グループ一覧</p>
            <span style={{ fontSize: 11, color: "#A09790", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{groups.length}件</span>
          </div>
          <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 3, display: "flex", alignItems: "center", gap: 3 }}>
            <GripVertical style={{ width: 10, height: 10 }} />プロジェクトにドラッグしてアサイン
          </p>
        </div>
        <div style={{ flex: 1, overflowY: "auto" as const, padding: "8px" }}>
          {groups.length === 0 && (
            <p style={{ textAlign: "center" as const, fontSize: 12, color: "#C9C4BB", padding: "24px 0" }}>グループなし</p>
          )}
          {groups.map(group => {
            const isOver = dragOver?.type === "group" && dragOver.id === group.id;
            const gmIds = groupMemberships.filter(gm => gm.group_id === group.id).map(gm => gm.member_id);
            const groupMemberList = members.filter(m => gmIds.includes(m.id));
            const activePerms = PROJECT_PERM_FLAGS.filter(f => group.permissions?.[f.key]);

            return (
              <div key={group.id} draggable
                onDragStart={e => onDragStart(e as DragEvent, { type: "group", id: String(group.id) })}
                onDragOver={e => onDragOver(e as DragEvent, group.id)}
                onDragLeave={onDragLeave}
                onDrop={e => onDrop(e as DragEvent, group.id)}
                style={{ background: isOver ? "#F0FDF4" : "#F9F8F6", border: isOver ? "1.5px dashed #059669" : "1.5px solid transparent", borderRadius: 10, marginBottom: 8, overflow: "hidden", transition: "all 0.15s", cursor: "grab" }}>

                {/* Group header */}
                <div style={{ padding: "9px 10px", display: "flex", alignItems: "center", gap: 8 }}>
                  <GripVertical style={{ width: 11, height: 11, color: "#C9C4BB", flexShrink: 0 }} />
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Users style={{ width: 13, height: 13, color: "#059669" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{group.name}</p>
                    <p style={{ fontSize: 10, color: "#A09790" }}>{groupMemberList.length}名</p>
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    <button onClick={e => { e.stopPropagation(); onSettings(group.id); }}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", transition: "all 0.15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(5,150,105,0.08)"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}>
                      <Settings style={{ width: 11, height: 11 }} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); onDelete(group.id); }}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", transition: "all 0.15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <X style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                </div>

                {/* Permissions */}
                {activePerms.length > 0 && (
                  <div style={{ padding: "0 10px 6px 10px", display: "flex", flexWrap: "wrap" as const, gap: 3 }}>
                    {activePerms.map(f => (
                      <span key={f.key} style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: f.color + "15", color: f.color }}>{f.label}</span>
                    ))}
                  </div>
                )}

                {/* Drop zone + members */}
                <div style={{ padding: "6px 10px 8px", minHeight: 40, background: isOver ? "rgba(5,150,105,0.04)" : "transparent" }}>
                  {isOver && (
                    <p style={{ textAlign: "center" as const, fontSize: 11, color: "#059669", marginBottom: 4, fontWeight: 600 }}>ここにドロップ</p>
                  )}
                  {groupMemberList.length === 0 && !isOver ? (
                    <div style={{ padding: "6px 0", textAlign: "center" as const, border: "1px dashed rgba(26,23,20,0.10)", borderRadius: 6 }}>
                      <p style={{ fontSize: 10, color: "#C9C4BB" }}>メンバーをドラッグ</p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                      {groupMemberList.map(m => (
                        <div key={m.id}
                          style={{ display: "flex", alignItems: "center", gap: 4, background: "#FFF", borderRadius: 20, padding: "3px 5px 3px 4px", border: "1px solid rgba(26,23,20,0.08)", userSelect: "none" as const }}>
                          <Avatar name={m.name} size="xs" />
                          <span style={{ fontSize: 10, fontWeight: 600, color: "#3D3732" }}>{m.name}</span>
                          <button onClick={e => { e.stopPropagation(); onRemoveMember(group.id, m.id); }}
                            style={{ padding: "1px", border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", borderRadius: 3, transition: "color 0.1s" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                            <X style={{ width: 9, height: 9 }} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Projects Column ───────────────────────────────────────────────────────────
function ProjectsColumn({ projects, groups, members, groupMemberships, dragOver, conflict, onDragOver, onDragLeave, onDrop, onRemoveGroup, onRemoveMember, onResolveConflict, onCancelConflict, onPermClick, getIndividualMemberNames, getGroupMemberIds }: {
  projects: Project[];
  groups: PermissionGroup[];
  members: Member[];
  groupMemberships: GroupMembership[];
  dragOver: { type: "group" | "project"; id: number | string } | null;
  conflict: ConflictInfo | null;
  onDragOver: (e: DragEvent, id: string) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent, project: Project) => void;
  onRemoveGroup: (groupId: number, project: Project) => void;
  onRemoveMember: (name: string, project: Project) => void;
  onResolveConflict: (resolution: "remove-individual" | "exclude-from-group") => void;
  onCancelConflict: () => void;
  onPermClick: (member: Member, projectId: string) => void;
  getIndividualMemberNames: (project: Project) => string[];
  getGroupMemberIds: (groupId: number) => string[];
}) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const toggleExpand = (projectId: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId); else next.add(projectId);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" as const, minHeight: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <FolderKanban style={{ width: 14, height: 14, color: "#6B6458" }} />
          <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>プロジェクト</p>
          <span style={{ fontSize: 11, color: "#A09790", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{projects.length}件</span>
        </div>
        <p style={{ fontSize: 10, color: "#B0A9A4" }}>グループまたはメンバーをドロップしてアサイン</p>
      </div>

      {/* Conflict banner */}
      {conflict && (
        <div style={{ background: "#FFFBEB", border: "1.5px solid rgba(217,119,6,0.30)", borderRadius: 10, padding: "12px 14px", marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
            <div>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E" }}>二重登録の競合があります</p>
              <p style={{ fontSize: 11, color: "#B45309", marginTop: 2 }}>
                以下のメンバーは個別でアサイン済みです：{conflict.names.join("、")}
              </p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onResolveConflict("remove-individual")}
              style={{ flex: 1, padding: "6px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1.5px solid rgba(217,119,6,0.40)", background: "#FEF3C7", color: "#92400E", cursor: "pointer" }}>
              個別割り当てを解除してグループ適用
            </button>
            <button onClick={() => onResolveConflict("exclude-from-group")}
              style={{ flex: 1, padding: "6px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1.5px solid rgba(26,23,20,0.12)", background: "#FFF", color: "#6B6458", cursor: "pointer" }}>
              グループから除外・個別を維持
            </button>
            <button onClick={onCancelConflict}
              style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "none", background: "transparent", color: "#B0A9A4", cursor: "pointer" }}>
              <X style={{ width: 13, height: 13 }} />
            </button>
          </div>
        </div>
      )}

      {/* List layout — full width, each project is one row */}
      <div style={{ flex: 1, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 8 }}>
        {projects.length === 0 && (
          <div style={{ textAlign: "center" as const, padding: "56px 0", color: "#B0A9A4", fontSize: 12 }}>
            プロジェクトが登録されていません
          </div>
        )}
        {projects.map(project => {
          const isOver = dragOver?.type === "project" && dragOver.id === project.id;
          const isExpanded = expandedProjects.has(project.id);
          const assignedGroupIds = project.groupIds ?? [];
          const assignedGroups = groups.filter(g => assignedGroupIds.includes(g.id));
          const individualNames = getIndividualMemberNames(project);
          const individualMembers = members.filter(m => individualNames.includes(m.name));
          const isEmpty = assignedGroups.length === 0 && individualMembers.length === 0;

          // Truncation limits (collapsed only)
          const MAX_G = 3;
          // グループがある場合はメンバーを少なく抑えて +N バッジが確実に表示されるようにする
          const MAX_M = assignedGroups.length > 0 ? 2 : 4;
          const visibleGroups  = assignedGroups.slice(0, MAX_G);
          const hiddenGroups   = Math.max(0, assignedGroups.length - MAX_G);
          const visibleMembers = individualMembers.slice(0, MAX_M);
          const hiddenMembers  = Math.max(0, individualMembers.length - MAX_M);
          const hasHidden = (hiddenGroups > 0 || hiddenMembers > 0) && !isEmpty;

          const displayGroups  = isExpanded ? assignedGroups  : visibleGroups;
          const displayMembers = isExpanded ? individualMembers : visibleMembers;

          return (
            <div key={project.id}
              onDragOver={e => onDragOver(e as DragEvent, project.id)}
              onDragLeave={onDragLeave}
              onDrop={e => onDrop(e as DragEvent, project)}
              style={{ background: "#FFF", border: isOver ? "2px dashed #059669" : "1px solid rgba(26,23,20,0.08)", borderRadius: 12, overflow: "hidden", boxShadow: isOver ? "0 0 0 3px rgba(5,150,105,0.10)" : "0 1px 3px rgba(0,0,0,0.04)", transition: "all 0.15s" }}>

              {/* Single-row layout: icon + name/client + assignments */}
              <div style={{ display: "flex", alignItems: isExpanded ? "flex-start" : "center", gap: 10, padding: "12px 14px", minHeight: 72 }}>

                {/* Project icon + name */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, width: 160, paddingTop: isExpanded ? 3 : 0 }}>
                  <div style={{ width: 26, height: 26, borderRadius: 7, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <FolderKanban style={{ width: 12, height: 12, color: "#059669" }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{project.name}</p>
                    <p style={{ fontSize: 10, color: "#A09790", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{project.client}</p>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ width: 1, alignSelf: "stretch", background: "rgba(26,23,20,0.07)", flexShrink: 0, margin: isExpanded ? "3px 0" : 0 }} />

                {/* Assignment chips area */}
                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6 }}>
                  {isOver && (
                    <span style={{ fontSize: 11, color: "#059669", fontWeight: 600, whiteSpace: "nowrap" as const }}>ここにドロップ ↓</span>
                  )}
                  {!isOver && isEmpty && (
                    <span style={{ fontSize: 11, color: "#C9C4BB" }}>グループ・メンバーをドラッグしてアサイン</span>
                  )}
                  {!isOver && !isEmpty && (
                    // position:relative でメンバー +N バッジを絶対配置できるようにする
                    <div style={{ flex: 1, minWidth: 0, position: "relative" as const }}>
                      {/* チップ列（overflow:hidden でクリップ、+N バッジ分の右余白を確保） */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: isExpanded ? "visible" : "hidden", flexWrap: isExpanded ? "wrap" as const : "nowrap" as const, paddingRight: !isExpanded && hiddenMembers > 0 ? 40 : 0, paddingTop: isExpanded ? 3 : 0, paddingBottom: isExpanded ? 3 : 0 }}>
                        {/* Groups */}
                        {displayGroups.map(g => {
                          const gmIds = groupMemberships.filter(gm => gm.group_id === g.id).map(gm => gm.member_id);
                          const gMembers = members.filter(m => gmIds.includes(m.id));
                          return (
                            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 4, background: "#F0FDF4", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 20, padding: "3px 6px 3px 5px", flexShrink: 0 }}>
                              <Users style={{ width: 10, height: 10, color: "#059669", flexShrink: 0 }} />
                              <span style={{ fontSize: 10, fontWeight: 700, color: "#065F46", whiteSpace: "nowrap" as const }}>{g.name}</span>
                              <span style={{ fontSize: 9, color: "#059669" }}>{gMembers.length}名</span>
                              <button onClick={e => { e.stopPropagation(); onRemoveGroup(g.id, project); }}
                                style={{ padding: "1px", border: "none", background: "transparent", cursor: "pointer", color: "#A7F3D0", display: "flex", borderRadius: 3, transition: "color 0.1s", flexShrink: 0 }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#A7F3D0"; }}>
                                <X style={{ width: 10, height: 10 }} />
                              </button>
                            </div>
                          );
                        })}
                        {!isExpanded && hiddenGroups > 0 && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#F0FDF4", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 20, padding: "3px 7px", flexShrink: 0 }}>+{hiddenGroups}</span>
                        )}

                        {/* Separator */}
                        {assignedGroups.length > 0 && individualMembers.length > 0 && (
                          <div style={{ width: 1, height: 18, background: "rgba(26,23,20,0.08)", flexShrink: 0, margin: "0 2px" }} />
                        )}

                        {/* Individual members */}
                        {displayMembers.map(m => (
                          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 0, background: "#F4F5F6", borderRadius: 20, border: "1px solid transparent", overflow: "hidden", transition: "all 0.12s", flexShrink: 0 }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(124,58,237,0.30)"; (e.currentTarget as HTMLElement).style.background = "#FAF5FF"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "transparent"; (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}>
                            <button title="クリックで権限設定"
                              onClick={e => { e.stopPropagation(); onPermClick(m, project.id); }}
                              style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 5px 3px 4px", border: "none", background: "transparent", cursor: "pointer" }}>
                              <Avatar name={m.name} size="xs" />
                              <span style={{ fontSize: 10, fontWeight: 600, color: "#3D3732", whiteSpace: "nowrap" as const, maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</span>
                            </button>
                            <button onClick={e => { e.stopPropagation(); onRemoveMember(m.name, project); }}
                              style={{ padding: "3px 6px 3px 2px", border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center", transition: "color 0.1s", flexShrink: 0 }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                              <X style={{ width: 11, height: 11 }} />
                            </button>
                          </div>
                        ))}
                      </div>

                      {/* メンバー +N バッジ — 常に右端に表示（絶対配置） */}
                      {!isExpanded && hiddenMembers > 0 && (
                        <>
                          {/* グラデーションフェード */}
                          <div style={{ position: "absolute" as const, right: 34, top: 0, bottom: 0, width: 24, background: "linear-gradient(to right, transparent, #FFF)", pointerEvents: "none" as const }} />
                          <span style={{ position: "absolute" as const, right: 0, top: "50%", transform: "translateY(-50%)", fontSize: 10, fontWeight: 700, color: "#6B6458", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 20, padding: "3px 7px", whiteSpace: "nowrap" as const }}>
                            +{hiddenMembers}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Accordion toggle button */}
                {!isOver && hasHidden && (
                  <button onClick={e => { e.stopPropagation(); toggleExpand(project.id); }}
                    title={isExpanded ? "折りたたむ" : "全員を表示"}
                    style={{ flexShrink: 0, padding: "4px 6px", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 6, background: "transparent", cursor: "pointer", color: "#A09790", display: "flex", alignItems: "center", transition: "all 0.15s", marginLeft: 2, alignSelf: isExpanded ? "flex-start" : "center", marginTop: isExpanded ? 3 : 0 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.30)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#A09790"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
                    {isExpanded
                      ? <ChevronUp style={{ width: 13, height: 13 }} />
                      : <ChevronDown style={{ width: 13, height: 13 }} />
                    }
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── New group modal ────────────────────────────────────────────────────────────
function NewGroupModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, perms: UserPermissions) => void }) {
  const [name, setName] = useState("");
  const [perms, setPerms] = useState<UserPermissions>({ ...DEFAULT_GROUP_PERMS });

  const toggle = (key: keyof UserPermissions) => setPerms(prev => ({ ...prev, [key]: !prev[key] }));

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), perms);
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 440 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Users style={{ width: 15, height: 15, color: "#059669" }} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", flex: 1 }}>新規グループ作成</h3>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "18px 24px", display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>グループ名 <span style={{ color: "#DC2626" }}>*</span></label>
            <input autoFocus value={name} onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
              placeholder="例: フロントエンドチーム"
              style={{ width: "100%", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const, transition: "border 0.15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; e.currentTarget.style.background = "#FFF"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 8, letterSpacing: "0.04em" }}>プロジェクト操作権限</label>
            {PROJECT_PERM_FLAGS.map(f => {
              const active = perms[f.key];
              return (
                <label key={f.key}
                  onClick={() => toggle(f.key)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9, cursor: "pointer", marginBottom: 5, background: active ? f.color + "0D" : "#F9F8F6", border: `1.5px solid ${active ? f.color + "30" : "transparent"}`, transition: "all 0.15s" }}>
                  <div style={{ width: 18, height: 18, borderRadius: 5, border: `2px solid ${active ? f.color : "rgba(26,23,20,0.15)"}`, background: active ? f.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                    {active && <Check style={{ width: 10, height: 10, color: "#FFF" }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: active ? f.color : "#1A1714", marginBottom: 1 }}>{f.label}</p>
                    <p style={{ fontSize: 10, color: "#A09790" }}>{f.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
        <div style={{ padding: "0 24px 22px", display: "flex", gap: 8 }}>
          <button onClick={handleCreate} disabled={!name.trim()}
            style={{ flex: 1, padding: "10px 0", background: !name.trim() ? "#F4F5F6" : "#059669", color: !name.trim() ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: !name.trim() ? "not-allowed" : "pointer" }}>
            作成する
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ── Group settings modal ───────────────────────────────────────────────────────
function GroupSettingsModal({ group, onClose, onSave }: {
  group: PermissionGroup; onClose: () => void; onSave: (name: string, perms: UserPermissions) => void;
}) {
  const [groupName, setGroupName] = useState(group.name);
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_GROUP_PERMS, ...(group.permissions ?? {}) });
  const [saving, setSaving] = useState(false);
  const handleSave = async () => { setSaving(true); await onSave(groupName.trim() || group.name, local); setSaving(false); };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 440 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Users style={{ width: 15, height: 15, color: "#059669" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>グループ設定</h3>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>{group.name}</p>
          </div>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "16px 24px" }}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>グループ名</label>
            <input value={groupName} onChange={e => setGroupName(e.target.value)}
              style={{ width: "100%", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const, transition: "border 0.15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; e.currentTarget.style.background = "#FFF"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }} />
          </div>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 14, background: "rgba(5,150,105,0.05)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(5,150,105,0.12)" }}>
            このグループのメンバーがプロジェクトで持つ操作権限を設定します。
          </p>
          {PROJECT_PERM_FLAGS.map(f => {
            const active = local[f.key];
            return (
              <label key={f.key}
                onClick={() => setLocal(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, cursor: "pointer", marginBottom: 6, background: active ? f.color + "0D" : "#F9F8F6", border: `1.5px solid ${active ? f.color + "30" : "transparent"}`, transition: "all 0.15s" }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${active ? f.color : "rgba(26,23,20,0.15)"}`, background: active ? f.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                  {active && <Check style={{ width: 12, height: 12, color: "#FFF" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : "#1A1714", marginBottom: 1 }}>{f.label}</p>
                  <p style={{ fontSize: 11, color: "#A09790" }}>{f.desc}</p>
                </div>
                <div style={{ width: 32, height: 18, borderRadius: 9, background: active ? f.color : "rgba(26,23,20,0.12)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 2, left: active ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: "#FFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.20)" }} />
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ padding: "14px 24px 22px", display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#059669", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : "保存する"}
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ── Individual member permission modal ───────────────────────────────────────
function IndividualMemberPermModal({ member, projectId, onClose }: {
  member: Member; projectId: string; onClose: () => void;
}) {
  const { toast } = useToast();
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_GROUP_PERMS });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoaded(true); return; }
    supabase!.from("project_member_permissions")
      .select("permissions")
      .eq("project_id", projectId)
      .eq("member_id", member.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.permissions) {
          setLocal({ ...DEFAULT_GROUP_PERMS, ...(data.permissions as Partial<UserPermissions>) });
        }
        setLoaded(true);
      });
  }, [member.id, projectId]);

  const toggle = (key: keyof UserPermissions) =>
    setLocal(prev => ({ ...prev, [key]: !prev[key] }));

  const handleSave = async () => {
    setSaving(true);
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("project_member_permissions")
        .upsert({ project_id: projectId, member_id: member.id, permissions: local });
      if (error) { toast("権限の保存に失敗しました", "error"); setSaving(false); return; }
    }
    toast(`「${member.name}」のプロジェクト権限を保存しました`);
    setSaving(false);
    onClose();
  };

  const activeCount = PROJECT_PERM_FLAGS.filter(f => local[f.key]).length;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 440 }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar name={member.name} size="sm" />
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{member.name}</h3>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>
              個別プロジェクト権限
              {activeCount > 0
                ? <span style={{ marginLeft: 6, background: "rgba(124,58,237,0.10)", color: "#7C3AED", padding: "1px 7px", borderRadius: 10, fontWeight: 700, fontSize: 10 }}>{activeCount}件 有効</span>
                : <span style={{ marginLeft: 6, background: "#F4F5F6", color: "#B0A9A4", padding: "1px 7px", borderRadius: 10, fontWeight: 600, fontSize: 10 }}>権限なし</span>
              }
            </p>
          </div>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: "14px 24px" }}>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 14, background: "rgba(124,58,237,0.05)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.12)" }}>
            このメンバーがこのプロジェクト内で持つ操作権限を設定します。チケット閲覧・コメントは常に可能です。
          </p>
          {!loaded ? (
            <p style={{ textAlign: "center" as const, color: "#B0A9A4", fontSize: 13, padding: "24px 0" }}>読み込み中...</p>
          ) : PROJECT_PERM_FLAGS.map(f => {
            const active = local[f.key];
            return (
              <label key={f.key}
                onClick={() => toggle(f.key)}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, cursor: "pointer", marginBottom: 6, background: active ? f.color + "0D" : "#F9F8F6", border: `1.5px solid ${active ? f.color + "30" : "transparent"}`, transition: "all 0.15s" }}>
                <div style={{ width: 22, height: 22, borderRadius: 7, border: `2px solid ${active ? f.color : "rgba(26,23,20,0.15)"}`, background: active ? f.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                  {active && <Check style={{ width: 12, height: 12, color: "#FFF" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : "#1A1714", marginBottom: 1 }}>{f.label}</p>
                  <p style={{ fontSize: 11, color: "#A09790" }}>{f.desc}</p>
                </div>
                <div style={{ width: 32, height: 18, borderRadius: 9, background: active ? f.color : "rgba(26,23,20,0.12)", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 2, left: active ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: "#FFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.20)" }} />
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px 20px", display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving || !loaded}
            style={{ flex: 1, padding: "10px 0", background: (saving || !loaded) ? "#F4F5F6" : "#7C3AED", color: (saving || !loaded) ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: (saving || !loaded) ? "not-allowed" : "pointer", transition: "background 0.15s" }}>
            {saving ? "保存中..." : "保存する"}
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}
