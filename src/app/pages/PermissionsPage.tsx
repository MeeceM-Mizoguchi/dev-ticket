import { useEffect, useState, type DragEvent } from "react";
import { Plus, Search, Settings, X, Check, Users, GripVertical } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapMember } from "@/app/lib/mappers";
import { getRoleMeta } from "@/app/lib/helpers";
import type { Member, PermissionGroup, UserPermissions } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { useToast } from "@/app/contexts/ToastContext";

const DEFAULT_GROUP_PERMS: UserPermissions = {
  canCreateTicket: false, canCreateSprint: false,
  canEditDelete: false, canReview: false, canGeneratePrompt: false,
  canAccessMembers: false, canAccessRoles: false,
};

const PERM_FLAGS: { key: keyof UserPermissions; label: string; desc: string; color: string }[] = [
  { key: "canCreateTicket",   label: "チケット作成",       desc: "チケットの新規作成が可能",             color: "#059669" },
  { key: "canCreateSprint",   label: "スプリント作成",     desc: "スプリントの新規作成が可能",           color: "#0284C7" },
  { key: "canEditDelete",     label: "編集・削除",         desc: "チケット・スプリントの編集・削除が可能", color: "#D97706" },
  { key: "canReview",         label: "レビュー権限",       desc: "レビュアーとして承認・差し戻しが可能",  color: "#7C3AED" },
  { key: "canGeneratePrompt", label: "プロンプト生成",     desc: "ClaudeCode プロンプトの生成が可能",     color: "#DB2777" },
  { key: "canAccessMembers",  label: "メンバー管理",       desc: "メンバー管理画面へのアクセスが可能",    color: "#0891B2" },
  { key: "canAccessRoles",    label: "ロール設定",         desc: "ロール設定画面へのアクセスが可能",      color: "#9333EA" },
];

export function PermissionsPage() {
  const { toast } = useToast();
  const [groups, setGroups]   = useState<PermissionGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [searchQuery, setSearchQuery]     = useState("");
  const [showNewGroupModal, setShowNewGroupModal] = useState(false);
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
        .from("profiles").update({ permission_group_id: groupId }).eq("id", memberId).select("id");
      if (error || !updated?.length) {
        toast("グループへの保存に失敗しました。RLSポリシーを確認してください。", "error");
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
        .from("permission_groups").update({ permissions: perms }).eq("id", groupId).select("id");
      if (error || !updated?.length) {
        toast("グループ権限の保存に失敗しました。RLSポリシーを確認してください。", "error");
        return;
      }
    }
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, permissions: perms } : g));
    setSettingsGroupId(null);
    toast("グループ権限を保存しました");
  };

  const filteredGroups = searchQuery.trim()
    ? groups.filter(g => g.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : groups;
  const settingsGroup = groups.find(g => g.id === settingsGroupId);
  const unassignedMembers = members.filter(m => !m.permission_group_id && m.role !== "admin");

  return (
    <div style={{ padding: "28px 32px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#059669,#047857)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(5,150,105,0.30)" }}>
              <Users style={{ width: 16, height: 16, color: "#FFF" }} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>グループ管理</h1>
          </div>
          <p style={{ fontSize: 12, color: "#A09790", marginLeft: 40 }}>グループを作成してメンバーを割り当て、グループ単位で権限を設定できます</p>
        </div>
        <button onClick={() => setShowNewGroupModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s", whiteSpace: "nowrap" as const }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
          <Plus style={{ width: 15, height: 15 }} />新規グループ追加
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>

        {/* ── Left: Members panel ── */}
        <div style={{ position: "sticky" as const, top: 24 }}>
          <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(26,23,20,0.06)", background: "#FAFAF9" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714" }}>メンバー一覧</p>
                <span style={{ fontSize: 11, color: "#A09790", background: "#F4F5F6", padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{members.filter(m => m.role !== "admin").length}名</span>
              </div>
              <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 4 }}>
                <GripVertical style={{ width: 10, height: 10, display: "inline", marginRight: 2 }} />
                グループにドラッグして割り当て
              </p>
            </div>

            {/* Unassigned drop zone */}
            <div
              style={{ padding: "10px", minHeight: 80, background: dragOverTarget === "unassigned" ? "rgba(5,150,105,0.04)" : "transparent", border: dragOverTarget === "unassigned" ? "2px dashed rgba(5,150,105,0.40)" : "2px dashed transparent", margin: "8px", borderRadius: 10, transition: "all 0.15s" }}
              onDragOver={e => { e.preventDefault(); setDragOverTarget("unassigned"); }}
              onDragLeave={() => setDragOverTarget(null)}
              onDrop={handleDropOnUnassigned}>
              {dragOverTarget === "unassigned" && (
                <p style={{ textAlign: "center" as const, fontSize: 11, color: "#059669", padding: "8px 0" }}>ここにドロップして未割り当てに戻す</p>
              )}
              {members.filter(m => m.role !== "admin").length === 0 && (
                <p style={{ textAlign: "center" as const, fontSize: 12, color: "#C9C4BB", padding: "12px 0" }}>メンバーなし</p>
              )}
              {members.map(m => {
                if (m.role === "admin") return (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, marginBottom: 3, background: "#F4F5F6", opacity: 0.5 }}>
                    <Avatar name={m.name} size="xs" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.name}</p>
                      <p style={{ fontSize: 10, color: "#B0A9A4" }}>管理者（全権限）</p>
                    </div>
                  </div>
                );
                const groupName = m.permission_group_id ? groups.find(g => g.id === m.permission_group_id)?.name : null;
                return (
                  <div key={m.id} draggable
                    onDragStart={e => handleDragStart(e as DragEvent<HTMLDivElement>, m.id)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", borderRadius: 8, cursor: "grab", marginBottom: 3, background: "#F9F8F6", userSelect: "none" as const, transition: "background 0.1s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F9F8F6"; }}>
                    <GripVertical style={{ width: 12, height: 12, color: "#C9C4BB", flexShrink: 0 }} />
                    <Avatar name={m.name} size="xs" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.name}</p>
                      <p style={{ fontSize: 10, color: "#B0A9A4" }}>{getRoleMeta(m.role).label}</p>
                    </div>
                    {groupName
                      ? <span style={{ fontSize: 9, background: "#ECFDF5", color: "#059669", padding: "2px 6px", borderRadius: 10, fontWeight: 700, flexShrink: 0 }}>{groupName}</span>
                      : <span style={{ fontSize: 9, background: "#F4F5F6", color: "#B0A9A4", padding: "2px 6px", borderRadius: 10, fontWeight: 600, flexShrink: 0 }}>未割り当て</span>
                    }
                  </div>
                );
              })}
            </div>

            {unassignedMembers.length > 0 && (
              <div style={{ padding: "8px 16px 12px", borderTop: "1px solid rgba(26,23,20,0.06)" }}>
                <p style={{ fontSize: 10, color: "#D97706", fontWeight: 600 }}>
                  未割り当て: {unassignedMembers.length}名
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Groups ── */}
        <div>
          {/* Search */}
          <div style={{ position: "relative", marginBottom: 16 }}>
            <Search style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#B0A9A4", pointerEvents: "none" }} />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="グループを検索..."
              style={{ width: "100%", background: "#FFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, padding: "9px 12px 9px 34px", fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const, transition: "border 0.15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
          </div>

          {/* Stats row */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            {[
              { label: "グループ数", value: groups.length, color: "#059669" },
              { label: "割り当て済み", value: members.filter(m => m.permission_group_id).length, color: "#0284C7" },
              { label: "未割り当て", value: unassignedMembers.length, color: unassignedMembers.length > 0 ? "#D97706" : "#B0A9A4" },
            ].map(s => (
              <div key={s.label} style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "10px 16px", flex: 1 }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: s.color, lineHeight: 1 }}>{s.value}</p>
                <p style={{ fontSize: 10, color: "#A09790", marginTop: 3 }}>{s.label}</p>
              </div>
            ))}
          </div>

          {/* Group cards */}
          {groups.length === 0 ? (
            <div style={{ background: "#FFF", border: "2px dashed rgba(26,23,20,0.10)", borderRadius: 14, padding: "56px 20px", textAlign: "center" as const }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <Users style={{ width: 22, height: 22, color: "#C9C4BB" }} />
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#6B6458", marginBottom: 4 }}>グループがありません</p>
              <p style={{ fontSize: 12, color: "#B0A9A4", marginBottom: 16 }}>「新規グループ追加」からグループを作成してください</p>
              <button onClick={() => setShowNewGroupModal(true)}
                style={{ padding: "8px 18px", background: "#059669", color: "#FFF", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", cursor: "pointer" }}>
                <Plus style={{ width: 12, height: 12, display: "inline", marginRight: 4 }} />グループを作成
              </button>
            </div>
          ) : filteredGroups.length === 0 ? (
            <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "40px 20px", textAlign: "center" as const }}>
              <Search style={{ width: 22, height: 22, color: "#C9C4BB", margin: "0 auto 10px" }} />
              <p style={{ fontSize: 13, color: "#B0A9A4" }}>「{searchQuery}」に一致するグループが見つかりません</p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 14 }}>
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
                    style={{ background: "#FFF", border: isOver ? "2px dashed #059669" : "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden", boxShadow: isOver ? "0 0 0 4px rgba(5,150,105,0.10)" : "0 1px 4px rgba(0,0,0,0.04)", transition: "all 0.15s" }}>

                    {/* Group header */}
                    <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(26,23,20,0.06)", background: "#FAFAF9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Users style={{ width: 15, height: 15, color: "#059669" }} />
                        </div>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{group.name}</p>
                          <p style={{ fontSize: 10, color: "#A09790", marginTop: 1 }}>{groupMembers.length}名のメンバー</p>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => setSettingsGroupId(group.id)}
                          style={{ padding: "5px 10px", borderRadius: 7, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4, transition: "all 0.15s" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(5,150,105,0.08)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.30)"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}>
                          <Settings style={{ width: 11, height: 11 }} />権限設定
                        </button>
                        <button onClick={() => handleDeleteGroup(group.id)}
                          style={{ padding: 5, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", transition: "all 0.15s" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                          <X style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    </div>

                    {/* Permissions */}
                    <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                      {activePerms.length > 0 ? (
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                          {activePerms.map(f => (
                            <span key={f.key} style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 20, background: f.color + "15", color: f.color }}>{f.label}</span>
                          ))}
                        </div>
                      ) : (
                        <p style={{ fontSize: 11, color: "#C9C4BB" }}>チケット参照・コメントのみ</p>
                      )}
                    </div>

                    {/* Drop zone + members */}
                    <div style={{ padding: "10px 16px 12px", minHeight: 60, background: isOver ? "rgba(5,150,105,0.03)" : "transparent" }}>
                      {isOver && (
                        <p style={{ textAlign: "center" as const, fontSize: 11, color: "#059669", marginBottom: 6, fontWeight: 600 }}>ここにドロップ</p>
                      )}
                      {groupMembers.length === 0 && !isOver ? (
                        <div style={{ padding: "10px 0", textAlign: "center" as const, border: "1.5px dashed rgba(26,23,20,0.10)", borderRadius: 8 }}>
                          <p style={{ fontSize: 11, color: "#C9C4BB" }}>メンバーをここにドラッグ</p>
                        </div>
                      ) : (
                        <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 5 }}>
                          {groupMembers.map(m => (
                            <div key={m.id} draggable
                              onDragStart={e => { e.stopPropagation(); handleDragStart(e as DragEvent<HTMLDivElement>, m.id); }}
                              style={{ display: "flex", alignItems: "center", gap: 5, background: "#F4F5F6", borderRadius: 20, padding: "4px 6px 4px 5px", cursor: "grab", userSelect: "none" as const, transition: "background 0.1s" }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}>
                              <Avatar name={m.name} size="xs" />
                              <span style={{ fontSize: 11, fontWeight: 600, color: "#3D3732" }}>{m.name}</span>
                              <button
                                onClick={e => { e.stopPropagation(); assignMemberToGroup(m.id, null); }}
                                style={{ padding: "1px 2px", border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", borderRadius: 4, transition: "color 0.1s" }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                                <X style={{ width: 10, height: 10 }} />
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
          )}
        </div>
      </div>

      {showNewGroupModal && (
        <NewGroupModal onClose={() => setShowNewGroupModal(false)} onCreate={handleCreateGroup} />
      )}
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

// ── New group modal ──────────────────────────────────────────────────────────
function NewGroupModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState("");
  const handleCreate = () => { if (!name.trim()) return; onCreate(name.trim()); onClose(); };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 420 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Users style={{ width: 15, height: 15, color: "#059669" }} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", flex: 1 }}>新規グループ追加</h3>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>グループ名 <span style={{ color: "#DC2626" }}>*</span></label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            placeholder="例: フロントエンドチーム"
            style={{ width: "100%", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#1A1714", outline: "none", boxSizing: "border-box" as const, transition: "border 0.15s" }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; e.currentTarget.style.background = "#FFF"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }} />
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

// ── Group settings modal ─────────────────────────────────────────────────────
function GroupSettingsModal({ group, onClose, onSave }: {
  group: PermissionGroup; onClose: () => void; onSave: (perms: UserPermissions) => void;
}) {
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_GROUP_PERMS, ...(group.permissions ?? {}) });
  const [saving, setSaving] = useState(false);
  const handleSave = async () => { setSaving(true); await onSave(local); setSaving(false); };
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 460 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(5,150,105,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Users style={{ width: 15, height: 15, color: "#059669" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>グループ権限設定</h3>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>{group.name}</p>
          </div>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "16px 24px" }}>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 14, background: "rgba(5,150,105,0.05)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(5,150,105,0.12)" }}>
            チケット参照・コメントはすべてのメンバーにデフォルトで付与されます。
          </p>
          {PERM_FLAGS.map(f => {
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
