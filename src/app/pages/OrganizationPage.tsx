import { useEffect, useState } from "react";
import { Plus, Globe, Users, ChevronRight, Pencil, Trash2, Building2, Sparkles } from "lucide-react";
import { useNavigate, Navigate } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import type { Organization } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";

interface OrgWithStats extends Organization {
  memberCount: number;
  activeCount: number;
  memberPreviews: { id: string; name: string }[];
}

function mapOrgWithStats(r: any): OrgWithStats {
  const profiles: { id: string; name: string; status: string }[] = r.profiles ?? [];
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at || "",
    representativeName: r.representative_name || "",
    contactName: r.contact_name || "",
    phone: r.phone || "",
    websiteUrl: r.website_url || "",
    address: r.address || "",
    industry: r.industry || "",
    description: r.description || "",
    memberCount: profiles.length,
    activeCount: profiles.filter(p => p.status === "active").length,
    memberPreviews: profiles.slice(0, 5).map(p => ({ id: p.id, name: p.name })),
  };
}

// ── セクションラベル ─────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 800, color: "#9E9690", letterSpacing: "0.09em", textTransform: "uppercase" as const, margin: "20px 0 10px", borderBottom: "1px solid rgba(26,23,20,0.07)", paddingBottom: 6 }}>
      {label}
    </p>
  );
}

// ── 新規 / 編集モーダル ──────────────────────────────────────────
function OrgFormDialog({ org, onClose, onSaved }: { org?: Organization; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name,               setName]               = useState(org?.name               ?? "");
  const [representativeName, setRepresentativeName] = useState(org?.representativeName ?? "");
  const [contactName,        setContactName]        = useState(org?.contactName        ?? "");
  const [phone,              setPhone]              = useState(org?.phone              ?? "");
  const [websiteUrl,         setWebsiteUrl]         = useState(org?.websiteUrl         ?? "");
  const [address,            setAddress]            = useState(org?.address            ?? "");
  const [industry,           setIndustry]           = useState(org?.industry           ?? "");
  const [description,        setDescription]        = useState(org?.description        ?? "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const payload = {
      name,
      representative_name: representativeName,
      contact_name:        contactName,
      phone,
      website_url:         websiteUrl,
      address,
      industry,
      description,
    };
    if (isSupabaseEnabled) {
      if (org) {
        const { error } = await supabase!.from("organizations").update(payload).eq("id", org.id);
        if (error) { toast("更新に失敗しました", "error"); setSaving(false); return; }
      } else {
        const { error } = await supabase!.from("organizations").insert(payload);
        if (error) { toast("作成に失敗しました", "error"); setSaving(false); return; }
      }
    }
    toast(org ? `「${name}」を更新しました` : `「${name}」を作成しました`);
    onSaved();
    onClose();
  };

  return (
    <DialogShell
      title={org ? "組織を編集" : "組織を新規作成"}
      size="xl"
      onClose={saving ? () => {} : onClose}
      footer={
        <>
          {!org && (
            <span style={{ fontSize: 11, color: "#A09790", marginRight: "auto" }}>作成後に詳細ページからメンバーを招待できます</span>
          )}
          <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
          <BtnPrimary onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "保存中..." : org ? "更新する" : "作成する"}
          </BtnPrimary>
        </>
      }
    >
      {/* 1行目: 組織名（全幅） */}
      <FieldInput label="組織名" placeholder="例: Meece株式会社" value={name} onChange={setName} required />

      {/* 2行目: 代表者名・担当者名・電話番号 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <FieldInput label="代表者名" placeholder="例: 溝口 雅登" value={representativeName} onChange={setRepresentativeName} />
        <FieldInput label="担当者名" placeholder="例: 佐藤 瑛" value={contactName} onChange={setContactName} />
        <FieldInput label="電話番号" placeholder="例: 03-1234-5678" value={phone} onChange={setPhone} />
      </div>

      {/* 3行目: 業界・ウェブサイト・住所 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <FieldInput label="業界" placeholder="例: IT・ソフトウェア" value={industry} onChange={setIndustry} />
        <FieldInput label="ウェブサイト URL" placeholder="例: https://example.com" value={websiteUrl} onChange={setWebsiteUrl} />
        <FieldInput label="住所" placeholder="例: 東京都渋谷区〇〇 1-2-3" value={address} onChange={setAddress} />
      </div>

      {/* 4行目: 概要（全幅・2行） */}
      <FieldTextarea label="概要・備考" placeholder="組織の概要や備考を入力..." value={description} onChange={setDescription} />
    </DialogShell>
  );
}

// ── 組織カード ───────────────────────────────────────────────────
function OrgCard({
  org,
  onNavigate,
  onEdit,
  onDelete,
}: {
  org: OrgWithStats;
  onNavigate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const formatDate = (iso: string) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <div
      onClick={onNavigate}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "#FFFFFF",
        border: hovered ? "1.5px solid rgba(5,150,105,0.30)" : "1.5px solid rgba(26,23,20,0.07)",
        borderRadius: 20,
        padding: "0",
        cursor: "pointer",
        transition: "all 0.20s",
        boxShadow: hovered ? "0 12px 36px rgba(5,150,105,0.13)" : "0 2px 8px rgba(0,0,0,0.04)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column" as const,
      }}
    >
      {/* カード上部グラデーション帯 */}
      <div style={{ height: 6, background: hovered ? "linear-gradient(90deg, #059669, #34D399)" : "linear-gradient(90deg, #D1FAE5, #A7F3D0)", transition: "all 0.20s" }} />

      <div style={{ padding: "22px 24px 20px" }}>
        {/* ヘッダー行 */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: hovered ? "linear-gradient(135deg, #059669, #047857)" : "linear-gradient(135deg, #ECFDF5, #D1FAE5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: hovered ? "none" : "1px solid rgba(5,150,105,0.12)", transition: "all 0.20s" }}>
              <Globe style={{ width: 22, height: 22, color: hovered ? "#FFFFFF" : "#059669", transition: "color 0.20s" }} />
            </div>
            <div>
              <p style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", margin: 0, letterSpacing: "-0.01em" }}>{org.name}</p>
              <p style={{ fontSize: 11, color: "#A09790", margin: "4px 0 0" }}>作成日 {formatDate(org.createdAt)}</p>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {/* 操作ボタン */}
            <button onClick={e => { e.stopPropagation(); onEdit(); }} title="編集"
              style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid rgba(26,23,20,0.09)", background: "#FAFAF9", cursor: "pointer", color: "#9E9690", transition: "all 0.15s", flexShrink: 0 }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#ECFDF5"; el.style.color = "#059669"; el.style.borderColor = "rgba(5,150,105,0.25)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FAFAF9"; el.style.color = "#9E9690"; el.style.borderColor = "rgba(26,23,20,0.09)"; }}>
              <Pencil style={{ width: 12, height: 12 }} />
            </button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }} title="削除"
              style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8, border: "1px solid rgba(26,23,20,0.09)", background: "#FAFAF9", cursor: "pointer", color: "#C9C4BB", transition: "all 0.15s", flexShrink: 0 }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FEF2F2"; el.style.color = "#DC2626"; el.style.borderColor = "rgba(220,38,38,0.20)"; }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FAFAF9"; el.style.color = "#C9C4BB"; el.style.borderColor = "rgba(26,23,20,0.09)"; }}>
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
            <ChevronRight style={{ width: 16, height: 16, color: hovered ? "#059669" : "#D1CEC9", transition: "color 0.20s", marginLeft: 2 }} />
          </div>
        </div>

        {/* 統計バー */}
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[
            { label: "総メンバー", value: org.memberCount, icon: Users },
            { label: "アクティブ",  value: org.activeCount,  color: "#059669" },
            { label: "招待中",      value: org.memberCount - org.activeCount, color: "#D97706" },
          ].map(({ label, value, color, icon: Icon }) => (
            <div key={label} style={{ flex: 1, padding: "9px 10px", background: "#F9FAFB", borderRadius: 10, textAlign: "center" as const, border: "1px solid rgba(26,23,20,0.05)" }}>
              <p style={{ fontSize: 18, fontWeight: 800, color: color ?? "#1A1714", margin: 0 }}>{value}</p>
              <p style={{ fontSize: 10, color: "#A09790", margin: "2px 0 0", fontWeight: 600 }}>{label}</p>
            </div>
          ))}
        </div>

        {/* メンバーアバター */}
        {org.memberPreviews.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              {org.memberPreviews.map((m, i) => (
                <div key={m.id} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: org.memberPreviews.length - i, position: "relative" }}>
                  <div style={{ border: "2px solid #FFFFFF", borderRadius: "50%" }}>
                    <Avatar name={m.name} size="sm" />
                  </div>
                </div>
              ))}
              {org.memberCount > 5 && (
                <div style={{ marginLeft: -8, zIndex: 0, position: "relative", width: 28, height: 28, borderRadius: "50%", background: "#F4F5F6", border: "2px solid #FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#6B6458" }}>
                  +{org.memberCount - 5}
                </div>
              )}
              <span style={{ fontSize: 11, color: "#A09790", marginLeft: 10, fontWeight: 500 }}>
                {org.memberCount}名が所属
              </span>
            </div>
            <span style={{ fontSize: 11, color: hovered ? "#059669" : "#B0A9A4", fontWeight: 600, display: "flex", alignItems: "center", gap: 4, transition: "color 0.20s" }}>
              詳細を見る <ChevronRight style={{ width: 12, height: 12 }} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────
export function OrganizationPage() {
  const { userPermissions } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!userPermissions.canAccessOrganization) return <Navigate to="/dashboard" replace />;

  const [orgs, setOrgs] = useState<OrgWithStats[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Organization | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);

  const refresh = () => {
    if (!isSupabaseEnabled) return;
    supabase!
      .from("organizations")
      .select("id, name, created_at, representative_name, contact_name, phone, website_url, address, industry, description, profiles(id, name, status)")
      .order("created_at")
      .then(({ data }) => { if (data) setOrgs(data.map(mapOrgWithStats)); });
  };

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    supabase!
      .from("organizations")
      .select("id, name, created_at, representative_name, contact_name, phone, website_url, address, industry, description, profiles(id, name, status)")
      .order("created_at")
      .then(({ data }) => { if (data) setOrgs(data.map(mapOrgWithStats)); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const handleDelete = async (org: Organization) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("organizations").delete().eq("id", org.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setOrgs(prev => prev.filter(o => o.id !== org.id));
    toast(`「${org.name}」を削除しました`);
  };

  const totalMembers = orgs.reduce((sum, o) => sum + o.memberCount, 0);
  const totalActive  = orgs.reduce((sum, o) => sum + o.activeCount,  0);

  if (loading) return <PageLoader />;

  return (
    <div style={{ minHeight: "100%", background: "#F5F6F8" }}>

      {/* ── ヒーローヘッダー ── */}
      <div style={{ background: "linear-gradient(135deg, #022c22 0%, #064E3B 40%, #065F46 70%, #047857 100%)", padding: "40px 40px 44px", position: "relative", overflow: "hidden" }}>
        {/* 装飾 */}
        <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
        <div style={{ position: "absolute", bottom: -80, right: 200, width: 200, height: 200, borderRadius: "50%", background: "rgba(52,211,153,0.08)" }} />
        <div style={{ position: "absolute", top: 20, right: 160, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />

        {/* ラベル */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: 20, padding: "5px 12px", marginBottom: 20 }}>
          <Sparkles style={{ width: 11, height: 11, color: "#34D399" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.80)", letterSpacing: "0.10em" }}>PLATFORM MANAGEMENT</span>
        </div>

        {/* タイトル行 + 新規作成ボタン（DetailPageと同じ構成） */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 54, height: 54, borderRadius: 16, background: "rgba(255,255,255,0.16)", border: "1px solid rgba(255,255,255,0.25)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Globe style={{ width: 26, height: 26, color: "#FFFFFF" }} />
            </div>
            <div>
              <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.16em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase" as const, margin: "0 0 4px" }}>Organization</p>
              <h1 style={{ fontSize: 28, fontWeight: 900, color: "#FFFFFF", margin: 0, letterSpacing: "-0.03em", lineHeight: 1.1 }}>組織管理</h1>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", margin: "5px 0 0" }}>プラットフォームに登録された組織の統合管理</p>
            </div>
          </div>

          <button
            onClick={() => setShowCreate(true)}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 18px", background: "rgba(255,255,255,0.16)", border: "1.5px solid rgba(255,255,255,0.35)", borderRadius: 12, fontSize: 13, fontWeight: 700, color: "#FFFFFF", cursor: "pointer", transition: "all 0.15s", flexShrink: 0, position: "relative", zIndex: 1 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.26)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.16)"; }}
          >
            <Plus style={{ width: 15, height: 15 }} />
            新規組織を作成
          </button>
        </div>

        {/* 統計チップ行（DetailPageと同じ位置・スタイル） */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, position: "relative" }}>
          {[
            { label: "登録組織",   value: orgs.length  },
            { label: "総メンバー", value: totalMembers },
            { label: "アクティブ", value: totalActive  },
            { label: "招待中",     value: totalMembers - totalActive },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: "10px 18px", background: "rgba(255,255,255,0.14)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", textAlign: "center" as const }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#FFFFFF", margin: 0 }}>{value}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.70)", margin: "2px 0 0", fontWeight: 600 }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 組織リスト ── */}
      <div style={{ padding: "32px 40px 48px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
          <Building2 style={{ width: 16, height: 16, color: "#6B6458" }} />
          <h2 style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: 0 }}>登録済み組織</h2>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "2px 9px", borderRadius: 20 }}>{orgs.length}</span>
        </div>

        {orgs.length === 0 ? (
          <div style={{ background: "#FFFFFF", border: "1.5px dashed rgba(26,23,20,0.12)", borderRadius: 20, padding: "80px 0", textAlign: "center" as const }}>
            <div style={{ width: 60, height: 60, borderRadius: 18, background: "linear-gradient(135deg, #ECFDF5, #D1FAE5)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}>
              <Globe style={{ width: 28, height: 28, color: "#059669" }} />
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#1A1714", margin: "0 0 8px" }}>組織がまだありません</p>
            <p style={{ fontSize: 13, color: "#A09790", margin: "0 0 24px" }}>「新規組織を作成」から最初の組織を登録してください</p>
            <button
              onClick={() => setShowCreate(true)}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "11px 22px", background: "linear-gradient(135deg, #059669, #047857)", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 11, border: "none", cursor: "pointer", boxShadow: "0 4px 14px rgba(5,150,105,0.30)" }}
            >
              <Plus style={{ width: 15, height: 15 }} />
              組織を作成する
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
            {orgs.map(org => (
              <OrgCard
                key={org.id}
                org={org}
                onNavigate={() => navigate(`/organization/${org.id}`)}
                onEdit={() => setEditTarget(org)}
                onDelete={() => setDeleteTarget(org)}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && <OrgFormDialog onClose={() => setShowCreate(false)} onSaved={refresh} />}
      {editTarget && <OrgFormDialog org={editTarget} onClose={() => setEditTarget(null)} onSaved={refresh} />}
      {deleteTarget && (
        <ConfirmDialog
          message={`「${deleteTarget.name}」を削除しますか？\n所属メンバーのorganization_idがNULLになります。`}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
