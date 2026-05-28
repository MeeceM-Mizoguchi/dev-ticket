import { useEffect, useState, type DragEvent } from "react";
import { Plus, Settings, X, Check, Users } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapMember } from "@/app/lib/mappers";
import { getRoleMeta } from "@/app/lib/helpers";
import type { Member, PermissionGroup, UserPermissions } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";

const DEFAULT_GROUP_PERMS: UserPermissions = {
  canCreateTicket: false,
  canCreateSprint: false,
  canEditDelete: false,
  canReview: false,
};

const PERM_FLAGS: { key: keyof UserPermissions; label: string; desc: string; color: string }[] = [
  { key: "canCreateTicket", label: "チケット作成",   desc: "チケットの新規作成が可能", color: "#059669" },
  { key: "canCreateSprint", label: "スプリント作成", desc: "スプリントの新規作成が可能", color: "#0284C7" },
  { key: "canEditDelete",   label: "編集・削除",     desc: "チケット・スプリントの編集・削除が可能", color: "#D97706" },
  { key: "canReview",       label: "レビュー権限",   desc: "レビュアーとして承認・差し戻しが可能", color: "#7C3AED" },
];

export function PermissionsPage() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [dragOverTarget, setDragOverTarget] = useState<number | "unassigned" | null>(null);
  const [settingsGroupId, setSettingsGroupId] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("permission_groups").select("*").order("id"),
      supabase!.from("profiles").select("*").order("name"),
    ]).then(([{ data: gData }, { data: mData }]) => {
      if (gData) setGroups(gData as PermissionGroup[]);
      if (mData) setMembers(mData.map(mapMember));
    });
  }, []);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    const newPerms = { ...DEFAULT_GROUP_PERMS };
    if (isSupabaseEnabled) {
      const { data } = await supabase!.from("permission_groups")
        .insert({ name: newGroupName.trim(), description: "", permissions: newPerms }).select().single();
      if (data) setGroups(prev => [...prev, { ...(data as PermissionGroup), permissions: newPerms }]);
    } else {
      const newId = groups.length > 0 ? Math.max(...groups.map(g => g.id)) + 1 : 1;
      setGroups(prev => [...prev, { id: newId, name: newGroupName.trim(), description: "", permissions: newPerms }]);
    }
    setNewGroupName("");
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
      await supabase!.from("profiles").update({ permission_group_id: groupId }).eq("id", memberId);
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
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, permissions: perms } : g));
    if (isSupabaseEnabled) {
      await supabase!.from("permission_groups").update({ permissions: perms }).eq("id", groupId);
    }
    setSettingsGroupId(null);
  };

  const settingsGroup = groups.find(g => g.id === settingsGroupId);

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
            <input
              value={newGroupName}
              onChange={e => setNewGroupName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreateGroup(); }}
              placeholder="新しいグループ名..."
              style={{ flex: 1, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px", fontSize: 12, color: "#1A1714", outline: "none" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }}
            />
            <button onClick={handleCreateGroup}
              style={{ padding: "8px 14px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "none", cursor: "pointer", display: "flex", alignItems: "center" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
              <Plus style={{ width: 14, height: 14 }} />
            </button>
          </div>

          {groups.length === 0
            ? (
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "48px 20px", textAlign: "center" as const }}>
                <Users style={{ width: 28, height: 28, color: "#C9C4BB", margin: "0 auto 12px" }} />
                <p style={{ fontSize: 13, color: "#B0A9A4" }}>グループを作成して<br />メンバーを割り当てましょう</p>
              </div>
            )
            : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
                {groups.map(group => {
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

      {/* Group permissions settings modal */}
      {settingsGroupId !== null && settingsGroup && (
        <GroupSettingsModal
          group={settingsGroup}
          onClose={() => setSettingsGroupId(null)}
          onSave={perms => handleSaveGroupPerms(settingsGroupId, perms)}
        />
      )}
    </div>
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
