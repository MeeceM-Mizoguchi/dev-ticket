import { useEffect, useState } from "react";
import { useParams, useNavigate, Navigate } from "react-router";
import { ArrowLeft, Globe, Users, UserPlus, Mail, Crown, ShieldCheck, Code2, Palette, BadgeCheck, Phone, Link2, MapPin, User, Briefcase, FileText } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapMember } from "@/app/lib/mappers";
import type { Member, Organization } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { InviteDialog } from "@/app/components/members/InviteDialog";

// ── ロールのメタデータ ────────────────────────────────────────────
const ROLE_META: Record<string, { label: string; color: string; bg: string; icon: typeof Crown }> = {
  owner:           { label: "オーナー",               color: "#7C3AED", bg: "#F5F3FF", icon: Crown },
  admin:           { label: "管理者",                 color: "#DC2626", bg: "#FFF1F2", icon: ShieldCheck },
  "project-manager": { label: "プロジェクトマネージャー", color: "#059669", bg: "#ECFDF5", icon: BadgeCheck },
  developer:       { label: "開発者",                 color: "#0284C7", bg: "#F0F9FF", icon: Code2 },
  designer:        { label: "デザイナー",             color: "#9333EA", bg: "#FAF5FF", icon: Palette },
};
function getRoleMeta(role: string) {
  return ROLE_META[role] ?? { label: role, color: "#6B6458", bg: "#F4F5F6", icon: BadgeCheck };
}

const STATUS_META = {
  active:   { label: "アクティブ", color: "#059669", bg: "#ECFDF5", dot: "#059669" },
  inactive: { label: "非アクティブ", color: "#9E9690", bg: "#F4F5F6", dot: "#C9C4BB" },
  invited:  { label: "招待中",    color: "#D97706", bg: "#FFFBEB", dot: "#D97706" },
};

// ── メンバーカード ────────────────────────────────────────────────
function MemberCard({ member }: { member: Member }) {
  const role = getRoleMeta(member.role);
  const status = STATUS_META[member.status as keyof typeof STATUS_META] ?? STATUS_META.active;
  const RoleIcon = role.icon;

  return (
    <div style={{ background: "#FFFFFF", border: "1.5px solid rgba(26,23,20,0.07)", borderRadius: 16, padding: "20px 20px 18px", display: "flex", flexDirection: "column", gap: 14, transition: "box-shadow 0.18s" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(0,0,0,0.07)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.20)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.07)"; }}
    >
      {/* 上段: アバター + 名前 + ステータス */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Avatar name={member.name} size="lg" />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{member.name}</p>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 4, padding: "3px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: status.bg, color: status.color }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: status.dot }} />
            {status.label}
          </span>
        </div>
      </div>

      {/* メール */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 10px", background: "#F9FAFB", borderRadius: 9 }}>
        <Mail style={{ width: 12, height: 12, color: "#A09790", flexShrink: 0 }} />
        <span style={{ fontSize: 12, color: "#6B6458", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{member.email}</span>
      </div>

      {/* ロールバッジ */}
      <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 10, background: role.bg, border: `1px solid ${role.color}22`, alignSelf: "flex-start" }}>
        <RoleIcon style={{ width: 12, height: 12, color: role.color }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: role.color }}>{role.label}</span>
      </div>
    </div>
  );
}

// ── 統計バッジ ────────────────────────────────────────────────────
function StatChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ padding: "10px 18px", background: "rgba(255,255,255,0.14)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", textAlign: "center" as const }}>
      <p style={{ fontSize: 22, fontWeight: 800, color: "#FFFFFF", margin: 0 }}>{value}</p>
      <p style={{ fontSize: 11, color: `rgba(255,255,255,0.70)`, margin: "2px 0 0", fontWeight: 600 }}>{label}</p>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────
export function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { userPermissions } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!userPermissions.canAccessOrganization) return <Navigate to="/dashboard" replace />;

  const [org, setOrg] = useState<Organization | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  const refresh = () => {
    if (!isSupabaseEnabled || !id) return;
    supabase!.from("profiles").select("*").eq("organization_id", id).order("name")
      .then(({ data }) => { if (data) setMembers(data.map(mapMember)); });
  };

  useEffect(() => {
    if (!isSupabaseEnabled || !id) { setLoading(false); return; }
    Promise.all([
      supabase!.from("organizations").select("*").eq("id", id).maybeSingle(),
      supabase!.from("profiles").select("*").eq("organization_id", id).order("name"),
    ]).then(([{ data: orgData }, { data: membersData }]) => {
      if (orgData) setOrg({
        id: orgData.id,
        name: orgData.name,
        createdAt: orgData.created_at || "",
        representativeName: orgData.representative_name || "",
        contactName:        orgData.contact_name || "",
        phone:              orgData.phone || "",
        websiteUrl:         orgData.website_url || "",
        address:            orgData.address || "",
        industry:           orgData.industry || "",
        description:        orgData.description || "",
      });
      if (membersData) setMembers(membersData.map(mapMember));
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  const formatDate = (iso: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  // ロール別カウント
  const roleCounts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});
  const activeCount = members.filter(m => m.status === "active").length;
  const invitedCount = members.filter(m => m.status === "invited").length;

  if (loading) return <PageLoader />;
  if (!org) return (
    <div style={{ padding: 28 }}>
      <button onClick={() => navigate("/organization")} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "#6B6458" }}>
        <ArrowLeft style={{ width: 14, height: 14 }} />戻る
      </button>
      <p style={{ marginTop: 40, textAlign: "center" as const, color: "#A09790" }}>組織が見つかりませんでした</p>
    </div>
  );

  return (
    <div style={{ padding: "0 0 48px" }}>
      {/* ── ヒーローヘッダー ── */}
      <div style={{ background: "linear-gradient(135deg, #065F46 0%, #047857 50%, #059669 100%)", padding: "28px 32px 32px", position: "relative", overflow: "hidden" }}>
        {/* 装飾円 */}
        <div style={{ position: "absolute", top: -40, right: -40, width: 200, height: 200, borderRadius: "50%", background: "rgba(255,255,255,0.05)" }} />
        <div style={{ position: "absolute", bottom: -60, right: 80, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />

        {/* 戻るボタン */}
        <button
          onClick={() => navigate("/organization")}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", cursor: "pointer", marginBottom: 20, transition: "background 0.15s" }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.22)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.14)"; }}
        >
          <ArrowLeft style={{ width: 12, height: 12 }} />
          組織一覧に戻る
        </button>

        {/* 組織名 + 日付 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: 15, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Globe style={{ width: 24, height: 24, color: "#FFFFFF" }} />
            </div>
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" as const, margin: "0 0 4px" }}>Organization</p>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "#FFFFFF", margin: 0, letterSpacing: "-0.02em" }}>{org.name}</h1>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.60)", margin: "5px 0 0" }}>作成日 {formatDate(org.createdAt)}</p>
            </div>
          </div>

          {/* 招待ボタン */}
          <button
            onClick={() => setShowInvite(true)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "rgba(255,255,255,0.16)", border: "1.5px solid rgba(255,255,255,0.35)", borderRadius: 12, fontSize: 13, fontWeight: 700, color: "#FFFFFF", cursor: "pointer", transition: "all 0.15s", flexShrink: 0, position: "relative", zIndex: 1 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.26)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.16)"; }}
          >
            <UserPlus style={{ width: 15, height: 15 }} />
            メンバーを招待
          </button>
        </div>

        {/* 統計チップ */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, position: "relative" }}>
          <StatChip label="総メンバー" value={members.length} color="#FFFFFF" />
          <StatChip label="アクティブ" value={activeCount} color="#FFFFFF" />
          <StatChip label="招待中" value={invitedCount} color="#FFFFFF" />
          {Object.entries(roleCounts).filter(([r]) => r !== "owner").slice(0, 3).map(([role, count]) => (
            <StatChip key={role} label={getRoleMeta(role).label} value={count} color="#FFFFFF" />
          ))}
        </div>
      </div>

      {/* ── 会社情報セクション ── */}
      {org && (org.representativeName || org.contactName || org.phone || org.websiteUrl || org.address || org.industry || org.description) && (
        <div style={{ padding: "24px 32px 0" }}>
          <div style={{ background: "#FFFFFF", borderRadius: 18, border: "1.5px solid rgba(26,23,20,0.07)", padding: "20px 24px", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <p style={{ fontSize: 12, fontWeight: 800, color: "#6B6458", letterSpacing: "0.08em", textTransform: "uppercase" as const, margin: "0 0 16px", display: "flex", alignItems: "center", gap: 7 }}>
              <Briefcase style={{ width: 13, height: 13 }} />
              会社情報
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
              {[
                { icon: User,      label: "代表者名",   value: org.representativeName },
                { icon: User,      label: "担当者名",   value: org.contactName },
                { icon: Briefcase, label: "業界",       value: org.industry },
                { icon: Phone,     label: "電話番号",   value: org.phone },
                { icon: Link2,     label: "ウェブサイト", value: org.websiteUrl, isUrl: true },
                { icon: MapPin,    label: "住所",       value: org.address },
              ].filter(item => item.value).map(({ icon: Icon, label, value, isUrl }) => (
                <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", background: "#F9FAFB", borderRadius: 10, border: "1px solid rgba(26,23,20,0.05)" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon style={{ width: 12, height: 12, color: "#059669" }} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 10, color: "#A09790", fontWeight: 600, margin: "0 0 2px" }}>{label}</p>
                    {isUrl ? (
                      <a href={value} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#059669", fontWeight: 600, textDecoration: "none", wordBreak: "break-all" as const }}>{value}</a>
                    ) : (
                      <p style={{ fontSize: 12, color: "#1A1714", fontWeight: 600, margin: 0, wordBreak: "break-all" as const }}>{value}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            {org.description && (
              <div style={{ marginTop: 12, padding: "12px 14px", background: "#F9FAFB", borderRadius: 10, border: "1px solid rgba(26,23,20,0.05)", display: "flex", gap: 10 }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <FileText style={{ width: 12, height: 12, color: "#059669" }} />
                </div>
                <div>
                  <p style={{ fontSize: 10, color: "#A09790", fontWeight: 600, margin: "0 0 4px" }}>概要・備考</p>
                  <p style={{ fontSize: 12, color: "#1A1714", margin: 0, lineHeight: 1.6 }}>{org.description}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── メンバーセクション ── */}
      <div style={{ padding: "28px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Users style={{ width: 16, height: 16, color: "#059669" }} />
            <h2 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", margin: 0 }}>メンバー一覧</h2>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "2px 8px", borderRadius: 20 }}>{members.length}</span>
          </div>
          <button
            onClick={() => setShowInvite(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "#059669", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#047857"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#059669"; }}
          >
            <UserPlus style={{ width: 13, height: 13 }} />
            招待する
          </button>
        </div>

        {members.length === 0 ? (
          <div style={{ background: "#FFFFFF", border: "1.5px dashed rgba(26,23,20,0.12)", borderRadius: 18, padding: "56px 0", textAlign: "center" as const }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: "linear-gradient(135deg, #ECFDF5, #D1FAE5)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
              <Users style={{ width: 22, height: 22, color: "#059669" }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: "0 0 6px" }}>まだメンバーがいません</p>
            <p style={{ fontSize: 13, color: "#A09790", margin: "0 0 20px" }}>「メンバーを招待」から招待メールを送ってください</p>
            <button
              onClick={() => setShowInvite(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", background: "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer" }}
            >
              <UserPlus style={{ width: 14, height: 14 }} />
              招待する
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
            {members.map(member => (
              <MemberCard key={member.id} member={member} />
            ))}
          </div>
        )}
      </div>

      {showInvite && (
        <InviteDialog
          onClose={() => setShowInvite(false)}
          onInvited={refresh}
          fixedOrganizationId={id}
          fixedOrganizationName={org.name}
        />
      )}
    </div>
  );
}
