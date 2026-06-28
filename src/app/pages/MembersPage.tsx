import { useEffect, useState, useRef } from "react";
import { Search, UserPlus, Globe, Users, ArrowLeft, Sparkles } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { MEMBERS, GROUPS } from "@/app/data/mock";
import { mapMember } from "@/app/lib/mappers";
import type { Member, Organization } from "@/app/types";
import { MemberCard } from "@/app/components/members/MemberCard";
import { MemberDetailDialog } from "@/app/components/members/MemberDetailDialog";
import { MemberEditDialog } from "@/app/components/members/MemberEditDialog";
import { InviteDialog } from "@/app/components/members/InviteDialog";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PlanTooltip } from "@/app/components/shared/PlanTooltip";
import { PageLoader } from "@/app/components/shared/PageLoader";

export function MembersPage() {
  const { userRole, userId, isSystemAdmin } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const paramOrgId = searchParams.get("orgId");

  const highlightMemberId: string | undefined = (location.state as { highlightMemberId?: string } | null)?.highlightMemberId;
  const [highlightId, setHighlightId] = useState<string | undefined>(highlightMemberId);
  const highlightCardRef = useRef<HTMLDivElement | null>(null);

  const [search, setSearch] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [members, setMembers] = useState<Member[]>(isSupabaseEnabled ? [] : MEMBERS);
  const [deleteTarget, setDeleteTarget] = useState<Member | null>(null);
  const [detailTarget, setDetailTarget] = useState<Member | null>(null);
  const [editTarget, setEditTarget] = useState<Member | null>(null);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [group, setGroup] = useState("すべて");
  const [myOrg, setMyOrg] = useState<(Organization & { memberCount: number }) | null>(null);
  const [effectiveOrgId, setEffectiveOrgId] = useState<string | null>(paramOrgId);

  const isOwner = userRole === "owner";
  const canAdd = isOwner || userRole === "admin" || userRole === "project-manager";
  const canEdit = isOwner || userRole === "admin" || userRole === "project-manager";

  // ownerはorgIdなしで直接アクセスした場合は組織一覧へリダイレクト
  useEffect(() => {
    if (isOwner && !paramOrgId) {
      navigate("/organization", { replace: true });
    }
  }, [isOwner, paramOrgId, navigate]);

  const refreshMembers = (orgId: string | null = effectiveOrgId) => {
    if (!isSupabaseEnabled) return;
    (orgId
      ? supabase!.from("profiles").select("*").eq("organization_id", orgId).order("name")
      : supabase!.from("profiles").select("*").order("name")
    ).then(({ data }) => setMembers((data ?? []).map(mapMember)));
  };

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }

    const fetchData = async () => {
      try {
        let orgId = paramOrgId;

        if (!orgId) {
          // 管理者以下: 自分の所属組織を取得
          const { data: profileData } = await supabase!
            .from("profiles").select("organization_id").eq("id", userId).maybeSingle();
          orgId = profileData?.organization_id ?? null;
        }

        setEffectiveOrgId(orgId);

        if (orgId) {
          const [{ data: orgData }, { data: membersData }] = await Promise.all([
            supabase!.from("organizations").select("id, name, created_at").eq("id", orgId).maybeSingle(),
            supabase!.from("profiles").select("*").eq("organization_id", orgId).order("name"),
          ]);
          if (orgData) setMyOrg({ id: orgData.id, name: orgData.name, createdAt: orgData.created_at || "", memberCount: (membersData ?? []).length });
          if (membersData) setMembers(membersData.map(mapMember));
        } else {
          const { data } = await supabase!.from("profiles").select("*").order("name");
          if (data) setMembers(data.map(mapMember));
        }
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [userId, paramOrgId]);

  // 10秒ポーリング
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    const id = setInterval(() => refreshMembers(), 10000);
    return () => clearInterval(id);
  }, [effectiveOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => {
      highlightCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
    const clear = setTimeout(() => setHighlightId(undefined), 3000);
    return () => { clearTimeout(timer); clearTimeout(clear); };
  }, [highlightId]);

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
    if (!isOwner && m.role === "owner") return false;
    return (m.name.includes(search) || m.email.includes(search)) && (group === "すべて" || m.group === group);
  });

  if (loading) return <PageLoader />;

  const visibleMembers = members.filter(m => isOwner || m.role !== "owner");
  const activeCount  = visibleMembers.filter(m => m.status === "active").length;
  const invitedCount = visibleMembers.filter(m => m.status === "invited").length;

  return (
    <div style={{ padding: 0, minWidth: 900 }}>

      {/* ── 組織バナー ── */}
      {myOrg && (
        <div style={{ background: "linear-gradient(135deg, #065F46 0%, #047857 50%, #059669 100%)", padding: "22px 28px 24px", position: "sticky", top: 0, zIndex: 10, overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -30, right: -30, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
          <div style={{ position: "absolute", bottom: -50, right: 120, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />

          {/* ownerは組織一覧に戻るボタン */}
          {isOwner && (
            <button
              onClick={() => navigate("/organization")}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: 8, padding: "5px 11px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", cursor: "pointer", marginBottom: 14, transition: "background 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.22)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.14)"; }}
            >
              <ArrowLeft style={{ width: 11, height: 11 }} />
              組織一覧に戻る
            </button>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", position: "relative" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 13, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Globe style={{ width: 21, height: 21, color: "#FFFFFF" }} />
              </div>
              <div>
                <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" as const, margin: "0 0 3px" }}>Organization</p>
                <p style={{ fontSize: 20, fontWeight: 800, color: "#FFFFFF", margin: 0, letterSpacing: "-0.02em" }}>{myOrg.name}</p>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {[
                { label: "総メンバー", value: visibleMembers.length },
                { label: "アクティブ",  value: activeCount },
                { label: "招待中",      value: invitedCount },
              ].map(({ label, value }) => (
                <div key={label} style={{ padding: "8px 14px", background: "rgba(255,255,255,0.13)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)", textAlign: "center" as const }}>
                  <p style={{ fontSize: 18, fontWeight: 800, color: "#FFFFFF", margin: 0 }}>{value}</p>
                  <p style={{ fontSize: 10, color: "rgba(255,255,255,0.65)", margin: "2px 0 0", fontWeight: 600 }}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>メンバー管理</h1>
              {isSystemAdmin && (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700, color: "#047857", background: "#D1FAE5", padding: "3px 9px", borderRadius: 999 }}>
                  <Sparkles style={{ width: 11, height: 11 }} />システム管理会社
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>総数 {visibleMembers.length} 名 · アクティブ {activeCount} 名</p>
          </div>
          {canAdd && (() => {
            const atLimit = plan.maxMembers !== null && members.length >= plan.maxMembers;
            return (
              <PlanTooltip text="現在のプランではこれ以上作成できません" active={atLimit}>
                <button onClick={atLimit ? undefined : () => setShowInvite(true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: atLimit ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: atLimit ? "not-allowed" : "pointer", boxShadow: atLimit ? "none" : "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
                  onMouseEnter={e => { if (!atLimit) (e.currentTarget as HTMLElement).style.background = "#047857"; }}
                  onMouseLeave={e => { if (!atLimit) (e.currentTarget as HTMLElement).style.background = "#059669"; }}>
                  <UserPlus style={{ width: 15, height: 15 }} />メンバー招待
                </button>
              </PlanTooltip>
            );
          })()}
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
                  canDelete={m.id !== userId && (m.role === "admin" ? userRole === "admin" : (userRole === "admin" || userRole === "project-manager"))}
                  highlighted={m.id === highlightId}
                  cardRef={m.id === highlightId ? highlightCardRef : undefined}
                  onDetail={() => setDetailTarget(m)}
                  onEdit={() => setEditTarget(m)}
                  onDelete={() => setDeleteTarget(m)} />
              ))}
            </div>
        }

        {showInvite && (
          <InviteDialog
            onClose={() => setShowInvite(false)}
            onInvited={() => refreshMembers()}
            fixedOrganizationId={effectiveOrgId ?? undefined}
            fixedOrganizationName={myOrg?.name}
            currentMemberCount={members.length}
          />
        )}
        {detailTarget && <MemberDetailDialog member={detailTarget} onClose={() => setDetailTarget(null)} />}
        {editTarget && <MemberEditDialog member={editTarget} onClose={() => setEditTarget(null)} onSaved={() => refreshMembers()} />}
        {deleteTarget && (
          <ConfirmDialog
            message={`「${deleteTarget.name}」をチームから削除しますか？担当チケットの割り当てもすべて解除されます。`}
            onConfirm={() => handleDeleteMember(deleteTarget)}
            onClose={() => setDeleteTarget(null)} />
        )}
      </div>
    </div>
  );
}
