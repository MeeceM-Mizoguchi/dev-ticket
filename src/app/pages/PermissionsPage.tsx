import { useEffect, useState, type DragEvent } from "react";
import { Plus, Settings, ShieldCheck, X, Check } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapMember, mapProject } from "@/app/lib/mappers";
import { getRoleMeta } from "@/app/lib/helpers";
import type { Member, Project, PermissionGroup, GroupProjectPermission, PermissionType } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";

type GroupFeaturePerms = {
  createTicket: boolean;   // チケット作成
  createSprint: boolean;   // スプリント作成
  editDelete: boolean;     // 編集・削除
  canReview: boolean;      // レビュー権限
};

const DEFAULT_PERMS: GroupFeaturePerms = {
  createTicket: true, createSprint: false, editDelete: false, canReview: false,
};

const FEATURE_FLAGS: { key: keyof GroupFeaturePerms; label: string; desc: string; color: string }[] = [
  { key: "createTicket", label: "チケット作成",   desc: "チケットの新規作成が可能", color: "#059669" },
  { key: "createSprint", label: "スプリント作成", desc: "スプリントの新規作成が可能", color: "#0284C7" },
  { key: "editDelete",   label: "編集・削除",     desc: "チケット・スプリントの編集・削除が可能", color: "#D97706" },
  { key: "canReview",    label: "レビュー権限",   desc: "レビュアーとして指定され承認・差し戻しが可能", color: "#7C3AED" },
];

export function PermissionsPage() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionType>>({});
  const [groupFeaturePerms, setGroupFeaturePerms] = useState<Record<number, GroupFeaturePerms>>({});
  const [newGroupName, setNewGroupName] = useState("");
  const [dragOverTarget, setDragOverTarget] = useState<number | "unassigned" | null>(null);
  const [saving, setSaving] = useState(false);
  const [settingsGroupId, setSettingsGroupId] = useState<number | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("permission_groups").select("*").order("id"),
      supabase!.from("profiles").select("*").order("name"),
      supabase!.from("projects").select("id, name").order("id"),
    ]).then(([{ data: gData }, { data: mData }, { data: pData }]) => {
      if (gData) {
        setGroups(gData as PermissionGroup[]);
        // Load feature permissions from each group's `permissions` JSON column (if present)
        const permsMap: Record<number, GroupFeaturePerms> = {};
        (gData as (PermissionGroup & { permissions?: GroupFeaturePerms })[]).forEach(g => {
          permsMap[g.id] = g.permissions ? { ...DEFAULT_PERMS, ...g.permissions } : { ...DEFAULT_PERMS };
        });
        setGroupFeaturePerms(permsMap);
      }
      if (mData) setMembers(mData.map(mapMember));
      if (pData) setProjects(pData.map(mapProject));
    });
  }, []);

  const handleSelectGroup = async (groupId: number) => {
    setSelectedGroupId(groupId);
    const base: Record<string, PermissionType> = {};
    projects.forEach(p => { base[p.id] = "none"; });
    if (isSupabaseEnabled) {
      const { data } = await supabase!.from("group_project_permissions")
        .select("*").eq("group_id", groupId);
      (data || []).forEach((r: GroupProjectPermission) => { base[r.project_id] = r.permission_type; });
    }
    setMatrix(base);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    if (isSupabaseEnabled) {
      const { data } = await supabase!.from("permission_groups")
        .insert({ name: newGroupName.trim(), description: "", permissions: DEFAULT_PERMS }).select().single();
      if (data) {
        setGroups(prev => [...prev, data as PermissionGroup]);
        setGroupFeaturePerms(prev => ({ ...prev, [(data as PermissionGroup).id]: { ...DEFAULT_PERMS } }));
      }
    } else {
      const newId = groups.length > 0 ? Math.max(...groups.map(g => g.id)) + 1 : 1;
      setGroups(prev => [...prev, { id: newId, name: newGroupName.trim(), description: "" }]);
      setGroupFeaturePerms(prev => ({ ...prev, [newId]: { ...DEFAULT_PERMS } }));
    }
    setNewGroupName("");
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

  const handleSaveMatrix = async () => {
    if (selectedGroupId === null) return;
    setSaving(true);
    if (isSupabaseEnabled) {
      await supabase!.from("group_project_permissions").delete().eq("group_id", selectedGroupId);
      const rows = Object.entries(matrix)
        .filter(([, pt]) => pt !== "none")
        .map(([project_id, permission_type]) => ({ group_id: selectedGroupId, project_id, permission_type }));
      if (rows.length > 0) await supabase!.from("group_project_permissions").insert(rows);
    }
    setSaving(false);
  };

  const handleSaveFeaturePerms = async (groupId: number, perms: GroupFeaturePerms) => {
    setGroupFeaturePerms(prev => ({ ...prev, [groupId]: perms }));
    if (isSupabaseEnabled) {
      await supabase!.from("permission_groups").update({ permissions: perms }).eq("id", groupId);
    }
    setSettingsGroupId(null);
  };

  const permTypes: { value: PermissionType; label: string; color: string; bg: string }[] = [
    { value: "none",  label: "なし", color: "#9E9690", bg: "#F4F5F6" },
    { value: "view",  label: "参照", color: "#D97706", bg: "#FFFBEB" },
    { value: "edit",  label: "編集", color: "#059669", bg: "#ECFDF5" },
    { value: "admin", label: "管理", color: "#7C3AED", bg: "#F5F3FF" },
  ];

  const unassigned = members.filter(m => !m.permission_group_id);
  const selectedGroup = groups.find(g => g.id === selectedGroupId);
  const settingsGroup = groups.find(g => g.id === settingsGroupId);

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>グループ管理</h1>
        <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>メンバーのグループ割り当てと機能権限を設定</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 340px", gap: 16, alignItems: "start" }}>

        {/* ── Unassigned members ── */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>未割り当て</p>
          <div
            style={{ background: "#FFFFFF", border: dragOverTarget === "unassigned" ? "2px dashed #059669" : "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 10, minHeight: 100, transition: "border 0.15s" }}
            onDragOver={e => { e.preventDefault(); setDragOverTarget("unassigned"); }}
            onDragLeave={() => setDragOverTarget(null)}
            onDrop={handleDropOnUnassigned}>
            {unassigned.length === 0
              ? <div style={{ textAlign: "center" as const, padding: "20px 0", color: "#B0A9A4", fontSize: 12 }}>なし</div>
              : unassigned.map(m => (
                <div key={m.id} draggable onDragStart={e => handleDragStart(e as DragEvent<HTMLDivElement>, m.id)}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, cursor: "grab", marginBottom: 4, background: "#F4F5F6", userSelect: "none" as const }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}>
                  <Avatar name={m.name} size="xs" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{m.name}</p>
                    <p style={{ fontSize: 10, color: "#B0A9A4" }}>{getRoleMeta(m.role).label}</p>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* ── Groups ── */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>グループ</p>
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
            ? <div style={{ textAlign: "center" as const, padding: "40px 0", color: "#B0A9A4", fontSize: 12 }}>グループがありません。作成してください。</div>
            : groups.map(group => {
              const groupMembers = members.filter(m => m.permission_group_id === group.id);
              const isSelected = selectedGroupId === group.id;
              const perms = groupFeaturePerms[group.id] ?? DEFAULT_PERMS;
              return (
                <div key={group.id}
                  onClick={() => handleSelectGroup(group.id)}
                  onDragOver={e => { e.preventDefault(); setDragOverTarget(group.id); }}
                  onDragLeave={() => setDragOverTarget(null)}
                  onDrop={e => handleDropOnGroup(e as DragEvent<HTMLDivElement>, group.id)}
                  style={{ background: "#FFFFFF", border: dragOverTarget === group.id ? "2px dashed #059669" : isSelected ? "2px solid #059669" : "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "14px 16px", marginBottom: 10, cursor: "pointer", transition: "all 0.15s" }}
                  onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 12px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{group.name}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 10, background: "#F4F5F6", color: "#6B6458", padding: "2px 8px", borderRadius: 20, fontFamily: "var(--font-mono)" }}>{groupMembers.length}名</span>
                      {/* ⚙ Permission settings button */}
                      <button
                        onClick={e => { e.stopPropagation(); setSettingsGroupId(group.id); }}
                        style={{ padding: 4, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}
                        title="権限設定">
                        <Settings style={{ width: 13, height: 13 }} />
                      </button>
                    </div>
                  </div>
                  {/* Feature permission badges */}
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4, marginBottom: 8 }}>
                    {FEATURE_FLAGS.map(f => perms[f.key] && (
                      <span key={f.key} style={{ fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: f.color + "15", color: f.color }}>{f.label}</span>
                    ))}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                    {groupMembers.slice(0, 4).map(m => (
                      <div key={m.id} draggable
                        onDragStart={e => { e.stopPropagation(); handleDragStart(e as DragEvent<HTMLDivElement>, m.id); }}
                        onClick={e => e.stopPropagation()}
                        style={{ display: "flex", alignItems: "center", gap: 5, background: "#F4F5F6", borderRadius: 20, padding: "3px 8px 3px 4px", cursor: "grab", userSelect: "none" as const }}>
                        <Avatar name={m.name} size="xs" />
                        <span style={{ fontSize: 10, color: "#3D3732" }}>{m.name}</span>
                      </div>
                    ))}
                    {groupMembers.length > 4 && <span style={{ fontSize: 10, color: "#B0A9A4", alignSelf: "center" }}>+{groupMembers.length - 4}</span>}
                    {groupMembers.length === 0 && <span style={{ fontSize: 11, color: "#C9C4BB" }}>メンバーをここにドラッグ</span>}
                  </div>
                </div>
              );
            })
          }
        </div>

        {/* ── Project permissions for selected group ── */}
        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
            {selectedGroup ? `${selectedGroup.name} — プロジェクト権限` : "グループを選択"}
          </p>
          {!selectedGroup
            ? (
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "40px 20px", textAlign: "center" as const }}>
                <ShieldCheck style={{ width: 32, height: 32, color: "#C9C4BB", margin: "0 auto 12px" }} />
                <p style={{ fontSize: 13, color: "#B0A9A4" }}>左のグループをクリックして<br />プロジェクト権限を設定してください</p>
              </div>
            )
            : (
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 12 }}>
                  {permTypes.map(pt => (
                    <div key={pt.value} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 2, background: pt.color }} />
                      <span style={{ fontSize: 10, color: "#B0A9A4" }}>{pt.label}</span>
                    </div>
                  ))}
                </div>
                {projects.length === 0 && (
                  <p style={{ fontSize: 12, color: "#B0A9A4", textAlign: "center" as const, padding: "20px 0" }}>プロジェクトがありません</p>
                )}
                {projects.map(p => (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                    <div style={{ flex: 1, minWidth: 0, marginRight: 10 }}>
                      <p style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.name}</p>
                      <p style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{p.id}</p>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {permTypes.map(pt => {
                        const isActive = (matrix[p.id] || "none") === pt.value;
                        return (
                          <button key={pt.value}
                            onClick={() => setMatrix(prev => ({ ...prev, [p.id]: pt.value }))}
                            style={{ padding: "4px 8px", fontSize: 10, fontWeight: 600, borderRadius: 6, border: `1.5px solid ${isActive ? pt.color : "rgba(26,23,20,0.10)"}`, background: isActive ? pt.bg : "transparent", color: isActive ? pt.color : "#B0A9A4", cursor: "pointer", transition: "all 0.12s" }}>
                            {pt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <button onClick={handleSaveMatrix} disabled={saving}
                  style={{ width: "100%", marginTop: 14, padding: "10px 0", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
                  onMouseEnter={e => { if (!saving) (e.currentTarget as HTMLElement).style.background = "#047857"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
                  {saving ? "保存中..." : "権限を保存"}
                </button>
              </div>
            )
          }
        </div>
      </div>

      {/* ── Feature permissions settings modal ── */}
      {settingsGroupId !== null && settingsGroup && (
        <GroupSettingsModal
          group={settingsGroup}
          perms={groupFeaturePerms[settingsGroupId] ?? DEFAULT_PERMS}
          onClose={() => setSettingsGroupId(null)}
          onSave={(p) => handleSaveFeaturePerms(settingsGroupId, p)} />
      )}
    </div>
  );
}

// ── Group feature permissions modal ─────────────────────────────────────────
function GroupSettingsModal({ group, perms, onClose, onSave }: {
  group: PermissionGroup;
  perms: GroupFeaturePerms;
  onClose: () => void;
  onSave: (perms: GroupFeaturePerms) => void;
}) {
  const [local, setLocal] = useState<GroupFeaturePerms>({ ...perms });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(local);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.20)", width: 440 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>権限フラグ設定</h3>
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
            コメント権限はすべてのメンバーにデフォルトで付与されます。
          </p>
          {FEATURE_FLAGS.map(f => {
            const active = local[f.key];
            return (
              <label key={f.key} onClick={() => setLocal(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
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
