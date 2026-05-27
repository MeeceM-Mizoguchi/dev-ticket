import { useEffect, useState, type DragEvent } from "react";
import { Plus, ShieldCheck } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { mapMember, mapProject } from "@/app/lib/mappers";
import { getRoleMeta } from "@/app/lib/helpers";
import type { Member, Project, PermissionGroup, GroupProjectPermission, PermissionType } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";

export function PermissionsPage() {
  const [groups, setGroups] = useState<PermissionGroup[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [matrix, setMatrix] = useState<Record<string, PermissionType>>({});
  const [newGroupName, setNewGroupName] = useState("");
  const [dragOverTarget, setDragOverTarget] = useState<number | "unassigned" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    Promise.all([
      supabase!.from("permission_groups").select("*").order("id"),
      supabase!.from("profiles").select("*").order("name"),
      supabase!.from("projects").select("id, name").order("id"),
    ]).then(([{ data: gData }, { data: mData }, { data: pData }]) => {
      if (gData) setGroups(gData as PermissionGroup[]);
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
        .insert({ name: newGroupName.trim(), description: "" }).select().single();
      if (data) setGroups(prev => [...prev, data as PermissionGroup]);
    } else {
      const newId = groups.length > 0 ? Math.max(...groups.map(g => g.id)) + 1 : 1;
      setGroups(prev => [...prev, { id: newId, name: newGroupName.trim(), description: "" }]);
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

  const permTypes: { value: PermissionType; label: string; color: string; bg: string }[] = [
    { value: "none",  label: "なし", color: "#9E9690", bg: "#F4F5F6" },
    { value: "view",  label: "参照", color: "#D97706", bg: "#FFFBEB" },
    { value: "edit",  label: "編集", color: "#059669", bg: "#ECFDF5" },
    { value: "admin", label: "管理", color: "#7C3AED", bg: "#F5F3FF" },
  ];

  const unassigned = members.filter(m => !m.permission_group_id);
  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>権限管理</h1>
        <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>メンバーの権限グループとプロジェクトアクセスを設定</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 340px", gap: 16, alignItems: "start" }}>

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

        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>権限グループ</p>
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
                    <span style={{ fontSize: 10, background: "#F4F5F6", color: "#6B6458", padding: "2px 8px", borderRadius: 20, fontFamily: "var(--font-mono)" }}>{groupMembers.length}名</span>
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

        <div>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", textTransform: "uppercase" as const, letterSpacing: "0.06em", marginBottom: 8 }}>
            {selectedGroup ? `${selectedGroup.name} の権限` : "グループを選択"}
          </p>
          {!selectedGroup
            ? (
              <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "40px 20px", textAlign: "center" as const }}>
                <ShieldCheck style={{ width: 32, height: 32, color: "#C9C4BB", margin: "0 auto 12px" }} />
                <p style={{ fontSize: 13, color: "#B0A9A4" }}>左のグループをクリックして<br />権限を設定してください</p>
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
    </div>
  );
}
