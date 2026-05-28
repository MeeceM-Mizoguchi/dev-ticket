import { useEffect, useState, type DragEvent } from "react";
import { Plus, Search, Settings, X, Check, Users, Shield } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapMember } from "@/app/lib/mappers";
import { getRoleMeta } from "@/app/lib/helpers";
import type { Member, PermissionGroup, UserPermissions, RoleDefinition } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";

const DEFAULT_GROUP_PERMS: UserPermissions = {
  canCreateTicket: false,
  canCreateSprint: false,
  canEditDelete: false,
  canReview: false,
  canGeneratePrompt: false,
};

const PERM_FLAGS: { key: keyof UserPermissions; label: string; desc: string; color: string }[] = [
  { key: "canCreateTicket",    label: "チケット作成",        desc: "チケットの新規作成が可能", color: "#059669" },
  { key: "canCreateSprint",    label: "スプリント作成",      desc: "スプリントの新規作成が可能", color: "#0284C7" },
  { key: "canEditDelete",      label: "編集・削除",          desc: "チケット・スプリントの編集・削除が可能", color: "#D97706" },
  { key: "canReview",          label: "レビュー権限",        desc: "レビュアーとして承認・差し戻しが可能", color: "#7C3AED" },
  { key: "canGeneratePrompt",  label: "プロンプト生成",      desc: "ClaudeCode プロンプトの生成が可能", color: "#DB2777" },
];

export function PermissionsPage() {
  const { toast } = useToast();
  const { userRole } = useAuth();
  const isAdmin = userRole === "admin";
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
  const [dragOverTarget, setDragOverTarget] = useState<number | "unassigned" | null>(null);
  const [settingsGroupId, setSettingsGroupId] = useState<number | null>(null);
  const [roleSettingsId, setRoleSettingsId] = useState<number | null>(null);
  const [showNewRoleModal, setShowNewRoleModal] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("permission_groups").select("*").order("id"),
      supabase!.from("profiles").select("*").order("name"),
      supabase!.from("roles").select("*").order("id"),
    ]).then(([{ data: gData }, { data: mData }, { data: rData }]) => {
      if (gData) setGroups(gData as PermissionGroup[]);
      if (mData) setMembers(mData.map(mapMember));
      if (rData) setRoles(rData as RoleDefinition[]);
    });
  }, []);

  const handleCreateGroup = async (name: string) => {
    const newPerms = { ...DEFAULT_GROUP_PERMS };
    if (isSupabaseEnabled) {
      const { data } = await supabase!.from("permission_groups")
        .insert({ name, description: "", permissions: newPerms }).select().single();
      if (data) setGroups(prev => [...prev, { ...(data as PermissionGroup), permissions: newPerms }]);
    } else {
      const newId = groups.length > 0 ? Math.max(...groups.map(g => g.id)) + 1 : 1;
      setGroups(prev => [...prev, { id: newId, name, description: "", permissions: newPerms }]);
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    if (isSupabaseEnabled) {
      await supabase!.from("profiles").update({ permission_group_id: null }).eq("permission_group_id", groupId);
      await supabase!.from("permission_groups").delete().eq("id", groupId);
    }
    setMembers(prev => prev.map(m => m.permission_group_id === groupId ? { ...m, permission_group_id: null } : m));
    setGroups(prev => prev.filter(g => g.id !== groupId));
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, memberId: string) => {
    e.dataTransfer.setData("memberId", memberId);
    e.dataTransfer.effectAllowed = "move";
  };

  const assignMemberToGroup = async (memberId: string, groupId: number | null) => {
    if (isSupabaseEnabled) {
      const { data: updated, error } = await supabase!
        .from("profiles")
        .update({ permission_group_id: groupId })
        .eq("id", memberId)
        .select("id");
      if (error || !updated?.length) {
        toast("グループへの保存に失敗しました。SupabaseのRLSポリシーを確認してください。", "error");
        return;
      }
    }
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, permission_group_id: groupId } : m));
  };

  const handleDropOnGroup = async (e: DragEvent<HTMLDivElement>, groupId: number) => {
    e.preventDefault();
    const memberId = e.dataTransfer.getData("memberId");
    if (memberId) await assignMemberToGroup(memberId, groupId);
    setDragOverTarget(null);
  };

  const handleDropOnUnassigned = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const memberId = e.dataTransfer.getData("memberId");
    if (memberId) await assignMemberToGroup(memberId, null);
    setDragOverTarget(null);
  };

  const handleSaveGroupPerms = async (groupId: number, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { data: updated, error } = await supabase!
        .from("permission_groups")
        .update({ permissions: perms })
        .eq("id", groupId)
        .select("id");
      if (error || !updated?.length) {
        toast("グループ権限の保存に失敗しました。SupabaseのRLSポリシーを確認してください。", "error");
        return;
      }
    }
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, permissions: perms } : g));
    setSettingsGroupId(null);
  };

  const filteredGroups = searchQuery.trim()
    ? groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups;
  const settingsGroup = groups.find(g => g.id === settingsGroupId);
  const roleSettingsTarget = roles.find(r => r.id === roleSettingsId);

  const handleCreateRole = async (name: string, label: string) => {
    const newPerms = { ...DEFAULT_GROUP_PERMS };
    if (isSupabaseEnabled) {
      const { data } = await supabase!.from("roles")
        .insert({ name, label, base_permissions: newPerms }).select().single();
      if (data) setRoles(prev => [...prev, data as RoleDefinition]);
    } else {
      const newId = roles.length > 0 ? Math.max(...roles.map(r => r.id)) + 1 : 1;
      setRoles(prev => [...prev, { id: newId, name, label, base_permissions: newPerms }]);
    }
  };

  const handleSaveRolePerms = async (roleId: number, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("roles").update({ base_permissions: perms }).eq("id", roleId);
      if (error) { toast("ロール権限の保存に失敗しました", "error"); return; }
    }
    setRoles(prev => prev.map(r => r.id === roleId ? { ...r, base_permissions: perms } : r));
    setRoleSettingsId(null);
    toast("ロール権限を保存しました");
  };

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>グループ管理</h1>
        <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>グループを作成してメンバーを割り当て、グループ単位で権限を設定</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>

        {/* ── Left: All members ── */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
            メンバー ({members.length})
          </p>
          <div
            style={{ background: "#FFFFFF", border: dragOverTarget === "unassigned" ? "2px dashed #059669" : "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 10, minHeight: 120, transition: "border 0.15s" }}
            onDragOver={e => { e.preventDefault(); setDragOverTarget("unassigned"); }}
            onDragLeave={() => setDragOverTarget(null)}
            onDrop={handleDropOnUnassigned}>
            {members.length === 0
              ? <div style={{ textAlign: "center" as const, padding: "20px 0", color: "#B0A9A4", fontSize: 12 }}>メンバーなし</div>
              : members.map(m => {
                const groupName = m.permission_group_id ? groups.find(g => g.id === m.permission_group_id)?.name : null;
                const isAdmin = m.role === "admin";
                return (
                  <div key={m.id} draggable={!isAdmin} onDragStart={e => !isAdmin && handleDragStart(e as DragEvent<HTMLDivElement>, m.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: isAdmin ? "default" : "grab", marginBottom: 4, background: "#F4F5F6", userSelect: "none" as const, opacity: isAdmin ? 0.5 : 1 }}
                    title={isAdmin ? "管理者は全アクセス権があります" : ""}
                    onMouseEnter={e => { if (!isAdmin) (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}>
                    <Avatar name={m.name} size="xs" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.name}</p>
                      <p style={{ fontSize: 10, color: "#B0A9A4" }}>{getRoleMeta(m.role).label}</p>
                    </div>
                    {groupName && (
                      <span style={{ fontSize: 9, background: "#ECFDF5", color: "#059669", padding: "1px 6px", borderRadius: 10, fontWeight: 600, flexShrink: 0, maxWidth: 72, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{groupName}</span>
                    )}
                  </div>
                );
              })
            }
          </div>
          <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 8, textAlign: "center" as const }}>グループにドラッグして割り当て</p>
        </div>

        {/* ── Right: Groups ── */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
            グループ ({groups.length})
          </p>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4", pointerEvents: "none" }} />
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="グループを検索..."
                style={{ width: "100%", background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", boxSizing: "border-box" as const }}
                onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }}
              />
            </div>
            <button onClick={() => setShowNewGroupModal(true)}
              style={{ padding: "8px 14px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" as const }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
              <Plus style={{ width: 13, height: 13 }} />新規グループ追加
            </button>
          </div>

          {groups.length === 0
            ? (
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "48px 20px", textAlign: "center" as const }}>
                <Users style={{ width: 28, height: 28, color: "#C9C4BB", margin: "0 auto 12px" }} />
                <p style={{ fontSize: 13, color: "#B0A9A4" }}>グループを作成して<br />メンバーを割り当てましょう</p>
              </div>
            )
            : filteredGroups.length === 0
            ? (
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "32px 20px", textAlign: "center" as const }}>
                <Search style={{ width: 22, height: 22, color: "#C9C4BB", margin: "0 auto 10px" }} />
                <p style={{ fontSize: 13, color: "#B0A9A4" }}>「{searchQuery}」に一致するグループが見つかりません</p>
              </div>
            )
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {filteredGroups.map(group => {
                  const groupMembers = members.filter(m => m.permission_group_id === group.id);
                  const isOver = dragOverTarget === group.id;
                  const perms = group.permissions ?? DEFAULT_GROUP_PERMS;
                  const activePerms = PERM_FLAGS.filter(f => perms[f.key]);
                  return (
                    <div key={group.id}
                      onDragOver={e => { e.preventDefault(); setDragOverTarget(group.id); }}
                      onDragLeave={() => setDragOverTarget(null)}
                      onDrop={e => handleDropOnGroup(e as DragEvent<HTMLDivElement>, group.id)}
                      style={{ background: "#FFFFFF", border: isOver ? "2px dashed #059669" : "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px", transition: "all 0.15s" }}>

                      {/* Group header */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{group.name}</p>
                          <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1 }}>{groupMembers.length}名</p>
                        </div>
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => setSettingsGroupId(group.id)}
                            style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}
                            title="権限設定">
                            <Settings style={{ width: 13, height: 13 }} />
                          </button>
                          <button onClick={() => handleDeleteGroup(group.id)}
                            style={{ padding: 5, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB", display: "flex" }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                            <X style={{ width: 13, height: 13 }} />
                          </button>
                        </div>
                      </div>

                      {/* Active permission badges */}
                      {activePerms.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, marginBottom: 8 }}>
                          {activePerms.map(f => (
                            <span key={f.key} style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: f.color + "15", color: f.color }}>{f.label}</span>
                          ))}
                        </div>
                      )}
                      {activePerms.length === 0 && (
                        <p style={{ fontSize: 10, color: "#C9C4BB", marginBottom: 8 }}>チケット参照・コメントのみ</p>
                      )}

                      {/* Member chips */}
                      {groupMembers.length === 0
                        ? (
                          <div style={{ padding: "12px 0", textAlign: "center" as const, border: "1.5px dashed rgba(26,23,20,0.10)", borderRadius: 8 }}>
                            <p style={{ fontSize: 11, color: "#C9C4BB" }}>メンバーをここにドラッグ</p>
                          </div>
                        )
                        : (
                          <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
                            {groupMembers.map(m => (
                              <div key={m.id} draggable
                                onDragStart={e => { e.stopPropagation(); handleDragStart(e as DragEvent<HTMLDivElement>, m.id); }}
                                style={{ display: "flex", alignItems: "center", gap: 4, background: "#F4F5F6", borderRadius: 20, padding: "3px 4px 3px 5px", cursor: "grab", userSelect: "none" as const }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}>
                                <Avatar name={m.name} size="xs" />
                                <span style={{ fontSize: 10, fontWeight: 600, color: "#3D3732" }}>{m.name}</span>
                                <button
                                  onClick={e => { e.stopPropagation(); assignMemberToGroup(m.id, null); }}
                                  style={{ padding: "1px 3px", border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", borderRadius: 4 }}
                                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                                  <X style={{ width: 10, height: 10 }} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )
                      }
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      </div>

      {/* New group modal */}
      {showNewGroupModal && (
        <NewGroupModal
          onClose={() => setShowNewGroupModal(false)}
          onCreate={handleCreateGroup}
        />
      )}

      {/* Group permissions settings modal */}
      {settingsGroupId !== null && settingsGroup && (
        <GroupSettingsModal
          group={settingsGroup}
          onClose={() => setSettingsGroupId(null)}
          onSave={perms => handleSaveGroupPerms(settingsGroupId, perms)}
        />
      )}

      {/* ── Role management section (admin only) ── */}
      {isAdmin && (
        <div style={{ marginTop: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", display: "flex", alignItems: "center", gap: 6 }}>
                <Shield style={{ width: 16, height: 16, color: "#7C3AED" }} />ロール設定
              </h2>
              <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>ロールごとの基本権限を設定。メンバー招待時のロール選択肢にも反映されます。</p>
            </div>
            <button onClick={() => setShowNewRoleModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", background: "#7C3AED", color: "#FFF", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", cursor: "pointer" }}>
              <Plus style={{ width: 13, height: 13 }} />ロール追加
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
            {roles.map(role => {
              const activePerms = PERM_FLAGS.filter(f => role.base_permissions?.[f.key]);
              return (
                <div key={role.id} style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{role.label}</p>
                      <p style={{ fontSize: 10, color: "#B0A9A4" }}>{role.name}</p>
                    </div>
                    <button onClick={() => setRoleSettingsId(role.id)}
                      style={{ padding: 6, borderRadius: 7, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                      <Settings style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                    {activePerms.length === 0
                      ? <span style={{ fontSize: 10, color: "#B0A9A4" }}>基本権限なし</span>
                      : activePerms.map(f => (
                        <span key={f.key} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: f.color + "15", color: f.color }}>{f.label}</span>
                      ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showNewRoleModal && (
        <NewRoleModal onClose={() => setShowNewRoleModal(false)} onCreate={handleCreateRole} />
      )}
      {roleSettingsId !== null && roleSettingsTarget && (
        <RoleSettingsModal
          role={roleSettingsTarget}
          onClose={() => setRoleSettingsId(null)}
          onSave={perms => handleSaveRolePerms(roleSettingsId, perms)}
        />
      )}
    </div>
  );
}

// ── New group modal ──────────────────────────────────────────────────────────
function NewGroupModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");

  const handleCreate = () => {
    if (!name.trim()) return;
    onCreate(name.trim());
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 400 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>新規グループ追加</h3>
          <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>グループ名</label>
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            placeholder="例: フロントエンドチーム"
            style={{ width: "100%", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; e.currentTarget.style.background = "#FFF"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }}
          />
        </div>
        <div style={{ padding: "0 24px 20px", display: "flex", gap: 8 }}>
          <button onClick={handleCreate} disabled={!name.trim()}
            style={{ flex: 1, padding: "10px 0", background: !name.trim() ? "#F4F5F6" : "#059669", color: !name.trim() ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: !name.trim() ? "not-allowed" : "pointer" }}>
            作成
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

// ── New role modal ───────────────────────────────────────────────────────────
function NewRoleModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, label: string) => void }) {
  const [name, setName] = useState("");
  const [label, setLabel] = useState("");

  const handleCreate = () => {
    if (!name.trim() || !label.trim()) return;
    onCreate(name.trim().toLowerCase().replace(/\s+/g, "-"), label.trim());
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 400 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>新規ロール追加</h3>
          <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "16px 24px", display: "flex", flexDirection: "column" as const, gap: 12 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 5 }}>表示名</p>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="例: QAエンジニア"
              style={{ width: "100%", padding: "9px 12px", border: "1px solid rgba(26,23,20,0.15)", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
          </div>
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 5 }}>識別子（英数字・ハイフン）</p>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="例: qa-engineer"
              style={{ width: "100%", padding: "9px 12px", border: "1px solid rgba(26,23,20,0.15)", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }} />
          </div>
        </div>
        <div style={{ padding: "14px 24px 20px", display: "flex", gap: 8 }}>
          <button onClick={handleCreate} disabled={!name.trim() || !label.trim()}
            style={{ flex: 1, padding: "10px 0", background: !name.trim() || !label.trim() ? "#F4F5F6" : "#7C3AED", color: !name.trim() || !label.trim() ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: !name.trim() || !label.trim() ? "not-allowed" : "pointer" }}>
            追加
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ── Role settings modal ──────────────────────────────────────────────────────
function RoleSettingsModal({ role, onClose, onSave }: {
  role: RoleDefinition;
  onClose: () => void;
  onSave: (perms: UserPermissions) => void;
}) {
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_GROUP_PERMS, ...(role.base_permissions ?? {}) });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(local);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 440 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>ロール基本権限設定</h3>
            <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{role.label}</p>
          </div>
          <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "16px 24px" }}>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 14 }}>
            このロールを持つメンバーのデフォルト権限を設定します。プロジェクト個別設定で上書き可能です。
          </p>
          {PERM_FLAGS.map(f => {
            const active = local[f.key];
            return (
              <label key={f.key}
                onClick={() => setLocal(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, cursor: "pointer", marginBottom: 6, background: active ? f.color + "0D" : "#F9F8F6", border: `1.5px solid ${active ? f.color + "33" : "transparent"}`, transition: "all 0.15s" }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${active ? f.color : "rgba(26,23,20,0.15)"}`, background: active ? f.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                  {active && <Check style={{ width: 12, height: 12, color: "#FFF" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : "#1A1714", marginBottom: 2 }}>{f.label}</p>
                  <p style={{ fontSize: 11, color: "#A09790" }}>{f.desc}</p>
                </div>
              </label>
            );
          })}
        </div>
        <div style={{ padding: "14px 24px 20px", display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#7C3AED", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : "保存"}
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F4F5F6", color: "#6B6458", fontSize: 13, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ── Group permissions modal ──────────────────────────────────────────────────
function GroupSettingsModal({ group, onClose, onSave }: {
  group: PermissionGroup;
  onClose: () => void;
  onSave: (perms: UserPermissions) => void;
}) {
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_GROUP_PERMS, ...(group.permissions ?? {}) });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(local);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 440 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>グループ権限設定</h3>
            <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{group.name}</p>
          </div>
          <button onClick={onClose} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        <div style={{ padding: "16px 24px" }}>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 14 }}>
            チケット参照・コメントはすべてのメンバーにデフォルトで付与されます。
          </p>
          {PERM_FLAGS.map(f => {
            const active = local[f.key];
            return (
              <label key={f.key}
                onClick={() => setLocal(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 10, cursor: "pointer", marginBottom: 6, background: active ? f.color + "0D" : "#F9F8F6", border: `1.5px solid ${active ? f.color + "33" : "transparent"}`, transition: "all 0.15s" }}>
                <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${active ? f.color : "rgba(26,23,20,0.15)"}`, background: active ? f.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                  {active && <Check style={{ width: 12, height: 12, color: "#FFF" }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: active ? f.color : "#1A1714", marginBottom: 2 }}>{f.label}</p>
                  <p style={{ fontSize: 11, color: "#A09790" }}>{f.desc}</p>
                </div>
              </label>
            );
          })}
        </div>

        <div style={{ padding: "14px 24px 20px", display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#059669", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer" }}>
            {saving ? "保存中..." : "保存"}
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
