import { useEffect, useState } from "react";
import { Search, UserPlus } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { MEMBERS, GROUPS } from "@/app/data/mock";
import { mapMember } from "@/app/lib/mappers";
import type { Member } from "@/app/types";
import { MemberCard } from "@/app/components/members/MemberCard";
import { MemberDetailDialog } from "@/app/components/members/MemberDetailDialog";
import { MemberEditDialog } from "@/app/components/members/MemberEditDialog";
import { InviteDialog } from "@/app/components/members/InviteDialog";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";

export function MembersPage() {
  const { userRole, userId } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("すべて");
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers] = useState<Member[]>(isSupabaseEnabled ? [] : MEMBERS);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [detailTarget, setDetailTarget] = useState<Member | null>(null);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const canAdd = userRole === "admin" || userRole === "project-manager";
  const canEdit = userRole === "admin" || userRole === "project-manager";
  const canDelete = userRole === "admin";

  const refreshMembers = () => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("*").order("name")
      .then(({ data }) => setMembers((data ?? []).map(mapMember)));
  };

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!.from("profiles").select("*").order("name")
      .then(({ data }) => { if (data) setMembers(data.map(mapMember)); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // 10-second polling
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    const id = setInterval(refreshMembers, 10000);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteMember = async (member: Member) => {
    if (isSupabaseEnabled) {
      const res = await fetch("/api/delete-member", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, memberName: member.name }),
      });
      const json = await res.json();
      if (!res.ok) { toast(json.error || "削除に失敗しました", "error"); throw new Error(json.error); }
    }
    setMembers(prev => prev.filter(m => m.id !== member.id));
    toast(`「${member.name}」を削除しました`);
  };

  const filtered = members.filter(m => {
    return (m.name.includes(search) || m.email.includes(search)) && (group === "すべて" || m.group === group);
  });

  if (loading) return <PageLoader />;

  return (
    <div style={{ padding: "24px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>メンバー管理</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>総数 {members.length} 名 · アクティブ {members.filter(m => m.status === "active").length} 名</p>
        </div>
        {canAdd && (
          <button onClick={() => setShowInvite(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
            <UserPlus style={{ width: 15, height: 15 }} />メンバー招待
          </button>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 13, height: 13, color: "#B0A9A4" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名前、メールで検索..."
            style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, padding: "8px 12px 8px 30px", fontSize: 12, color: "#1A1714", outline: "none", width: 220 }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(5,150,105,0.40)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; }} />
        </div>
        <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, padding: 4 }}>
          {GROUPS.map(g => (
            <button key={g} onClick={() => setGroup(g)}
              style={{ padding: "5px 10px", fontSize: 11, fontWeight: 500, borderRadius: 6, border: "none", cursor: "pointer", transition: "all 0.15s", background: group === g ? "#059669" : "transparent", color: group === g ? "#fff" : "#6B6458" }}>
              {g === "すべて" ? "ALL" : g}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0
        ? <div style={{ textAlign: "center", padding: "80px 0" }}><p style={{ fontSize: 13, color: "#A09790" }}>メンバーが見つかりません</p></div>
        : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            {filtered.map(m => (
              <MemberCard key={m.id} member={m}
                canEdit={canEdit}
                canDelete={canDelete && m.id !== userId}
                onDetail={() => setDetailTarget(m)}
                onEdit={() => setEditTarget(m)}
                onDelete={() => setDeleteTarget(m)} />
            ))}
          </div>
      }

      {showInvite && <InviteDialog onClose={() => setShowInvite(false)} onInvited={refreshMembers} />}
      {detailTarget && <MemberDetailDialog member={detailTarget} onClose={() => setDetailTarget(null)} />}
      {editTarget && <MemberEditDialog member={editTarget} onClose={() => setEditTarget(null)} onSaved={refreshMembers} />}
      {deleteTarget && (
        <ConfirmDialog
          message={`「${deleteTarget.name}」をチームから削除しますか？担当チケットの割り当てもすべて解除されます。`}
          onConfirm={() => handleDeleteMember(deleteTarget)}
          onClose={() => setDeleteTarget(null)} />
      )}
    </div>
  );
}
