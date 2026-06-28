import { useEffect, useRef, useState } from "react";
import { Plus, Globe, Users, ChevronLeft, ChevronRight, Pencil, Trash2, Building2, Sparkles, CreditCard, ToggleLeft, ToggleRight, Calendar } from "lucide-react";
import { useNavigate, Navigate } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import type { Organization, PlanSettings } from "@/app/types";
import { UNLIMITED_PLAN } from "@/app/contexts/PlanContext";
import { Avatar } from "@/app/components/shared/Avatar";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldTextarea } from "@/app/components/shared/FieldTextarea";
import { CustomSelect } from "@/app/components/shared/CustomSelect";

interface OrgWithStats extends Organization {
  memberCount: number;
  activeCount: number;
  memberPreviews: { id: string; name: string }[];
  planId: string | null;
  planName: string;
}

function mapOrgWithStats(r: Record<string, unknown>, planMap: Map<string, string>): OrgWithStats {
  const profiles = (r.profiles as { id: string; name: string; status: string }[]) ?? [];
  const planId = (r.plan_id as string | null) ?? null;
  return {
    id: r.id as string,
    name: r.name as string,
    createdAt: (r.created_at as string) || "",
    representativeName: (r.representative_name as string) || "",
    contactName: (r.contact_name as string) || "",
    phone: (r.phone as string) || "",
    websiteUrl: (r.website_url as string) || "",
    address: (r.address as string) || "",
    industry: (r.industry as string) || "",
    description: (r.description as string) || "",
    memberCount: profiles.length,
    activeCount: profiles.filter(p => p.status === "active").length,
    memberPreviews: profiles.slice(0, 5).map(p => ({ id: p.id, name: p.name })),
    planId,
    planName: planId ? (planMap.get(planId) ?? "—") : "無制限",
  };
}

// ── カスタム日付ピッカー ─────────────────────────────────────────
function DatePickerInput({ value, onChange, disabled = false }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [viewYear, setViewYear] = useState(() => value ? parseInt(value.split("-")[0]) : today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => value ? parseInt(value.split("-")[1]) - 1 : today.getMonth());

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const displayValue = value ? (() => {
    const d = new Date(value + "T00:00:00");
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  })() : "";

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => { if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1); };

  const toYMD = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const handleDayClick = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    if (d < today) return;
    onChange(toYMD(d));
    setOpen(false);
  };

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const isSelected = (day: number) => {
    if (!value) return false;
    const d = new Date(value + "T00:00:00");
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth && d.getDate() === day;
  };
  const isToday = (day: number) => new Date(viewYear, viewMonth, day).getTime() === today.getTime();
  const isPast  = (day: number) => new Date(viewYear, viewMonth, day) < today;

  const DOW = ["日", "月", "火", "水", "木", "金", "土"];

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button onClick={() => { if (!disabled) setOpen(o => !o); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13, border: `1.5px solid ${open ? "#059669" : "rgba(26,23,20,0.12)"}`, borderRadius: 8, background: "#FAFAF8", cursor: disabled ? "not-allowed" : "pointer", color: value ? "#1A1714" : "#B0A9A4", minWidth: 180, fontFamily: "inherit" }}>
        <Calendar style={{ width: 13, height: 13, color: "#6B6458", flexShrink: 0 }} />
        {displayValue || "未設定（無期限）"}
      </button>

      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 9999, background: "#fff", borderRadius: 12, boxShadow: "0 8px 28px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.08)", border: "1px solid rgba(26,23,20,0.09)", padding: 14, width: 256 }}>
          {/* ヘッダー */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <button onClick={prevMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, color: "#6B6458", display: "flex", alignItems: "center" }}>
              <ChevronLeft style={{ width: 14, height: 14 }} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{viewYear}年{viewMonth + 1}月</span>
            <button onClick={nextMonth} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 6px", borderRadius: 6, color: "#6B6458", display: "flex", alignItems: "center" }}>
              <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          </div>
          {/* 曜日ヘッダー */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center" as const, marginBottom: 4 }}>
            {DOW.map((d, i) => (
              <span key={d} style={{ fontSize: 10, fontWeight: 700, padding: "2px 0", color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#9E9690" }}>{d}</span>
            ))}
          </div>
          {/* 日付グリッド */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 }}>
            {cells.map((day, i) => {
              if (day === null) return <div key={`e-${i}`} />;
              const past = isPast(day);
              const sel  = isSelected(day);
              const tod  = isToday(day);
              const col  = (i % 7);
              return (
                <button key={day} onClick={() => handleDayClick(day)} disabled={past}
                  style={{ padding: "5px 2px", fontSize: 12, border: "none", borderRadius: 6, background: sel ? "#059669" : "transparent", color: past ? "#D4CFC9" : sel ? "#fff" : col === 0 ? "#EF4444" : col === 6 ? "#3B82F6" : "#1A1714", fontWeight: tod ? 700 : 400, cursor: past ? "not-allowed" : "pointer", outline: tod && !sel ? "2px solid #059669" : "none", outlineOffset: "-2px", fontFamily: "inherit" }}
                  onMouseEnter={e => { if (!past && !sel) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { if (!past && !sel) (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                  {day}
                </button>
              );
            })}
          </div>
          {/* フッター */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(26,23,20,0.07)" }}>
            {value
              ? <button onClick={() => { onChange(""); setOpen(false); }} style={{ fontSize: 11, fontWeight: 600, color: "#DC2626", background: "none", border: "none", cursor: "pointer", padding: "3px 6px", borderRadius: 5 }}>クリア</button>
              : <span />
            }
            <button onClick={() => { onChange(toYMD(today)); setOpen(false); }} style={{ fontSize: 11, fontWeight: 600, color: "#059669", background: "none", border: "none", cursor: "pointer", padding: "3px 6px", borderRadius: 5 }}>今日</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── セクションラベル ─────────────────────────────────────────────
function SectionLabel({ label }: { label: string }) {
  return (
    <p style={{ fontSize: 11, fontWeight: 800, color: "#9E9690", letterSpacing: "0.09em", textTransform: "uppercase" as const, margin: "20px 0 10px", borderBottom: "1px solid rgba(26,23,20,0.07)", paddingBottom: 6 }}>
      {label}
    </p>
  );
}

// ── トグルスイッチ ────────────────────────────────────────────────
function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center" }}>
      {value
        ? <ToggleRight style={{ width: 28, height: 28, color: "#059669" }} />
        : <ToggleLeft style={{ width: 28, height: 28, color: "#C9C4BB" }} />}
    </button>
  );
}

// ── 数値入力（空=無制限） ─────────────────────────────────────────
function LimitInput({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: "#6B6458" }}>{label}</label>
      <input
        type="number" min={1}
        value={value ?? ""}
        placeholder="無制限"
        onChange={e => onChange(e.target.value === "" ? null : Math.max(1, parseInt(e.target.value) || 1))}
        style={{ width: "100%", padding: "8px 10px", fontSize: 13, border: "1.5px solid rgba(26,23,20,0.12)", borderRadius: 8, outline: "none", color: "#1A1714", background: "#FAFAF8" }}
      />
    </div>
  );
}

// ── プラン作成/編集モーダル ───────────────────────────────────────
function PlanFormDialog({ plan, onClose, onSaved }: { plan?: PlanSettings; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState(plan?.name ?? "");
  const [expiresAt, setExpiresAt] = useState(plan?.accountExpiresAt ? plan.accountExpiresAt.slice(0, 10) : "");
  const [maxMembers, setMaxMembers] = useState<number | null>(plan?.maxMembers ?? null);
  const [maxProjects, setMaxProjects] = useState<number | null>(plan?.maxProjects ?? null);
  const [maxSprintsPerProject, setMaxSprintsPerProject] = useState<number | null>(plan?.maxSprintsPerProject ?? null);
  const [maxTicketsPerSprint, setMaxTicketsPerSprint] = useState<number | null>(plan?.maxTicketsPerSprint ?? null);
  const [maxImagesPerItem, setMaxImagesPerItem] = useState<number | null>(plan?.maxImagesPerItem ?? null);
  const [maxCommentsPerTicket, setMaxCommentsPerTicket] = useState<number | null>(plan?.maxCommentsPerTicket ?? null);
  const [maxFiltersPerSprint, setMaxFiltersPerSprint] = useState<number | null>(plan?.maxFiltersPerSprint ?? null);
  const [featureNotifications, setFeatureNotifications] = useState(plan?.featureNotifications ?? true);
  const [featureCsvExport, setFeatureCsvExport] = useState(plan?.featureCsvExport ?? true);
  const [featureActualMonitor, setFeatureActualMonitor] = useState(plan?.featureActualMonitor ?? true);
  const [featureChildTickets, setFeatureChildTickets] = useState(plan?.featureChildTickets ?? true);
  const [featureBulkCreate, setFeatureBulkCreate] = useState(plan?.featureBulkCreate ?? true);
  const [saving, setSaving] = useState(false);
  const [nameErr, setNameErr] = useState(false);

  const isSystem = !!plan?.isSystem;
  const isEdit = !!plan && !isSystem;

  const handleSave = async () => {
    if (!name.trim()) { setNameErr(true); return; }
    setSaving(true);
    const payload = {
      name: name.trim(),
      account_expires_at: expiresAt ? new Date(expiresAt + "T23:59:59").toISOString() : null,
      max_members: maxMembers,
      max_projects: maxProjects,
      max_sprints_per_project: maxSprintsPerProject,
      max_tickets_per_sprint: maxTicketsPerSprint,
      max_images_per_item: maxImagesPerItem,
      max_comments_per_ticket: maxCommentsPerTicket,
      max_filters_per_sprint: maxFiltersPerSprint,
      feature_notifications: featureNotifications,
      feature_csv_export: featureCsvExport,
      feature_actual_monitor: featureActualMonitor,
      feature_child_tickets: featureChildTickets,
      // feature_bulk_create は supabase/add_bulk_create_to_plans.sql 適用後に追加
    };
    if (isSupabaseEnabled) {
      if (isEdit) {
        const { error } = await supabase!.from("plans").update(payload).eq("id", plan!.id);
        if (error) { toast("更新に失敗しました", "error"); setSaving(false); return; }
      } else {
        const { error } = await supabase!.from("plans").insert({ id: `plan-${Date.now()}`, ...payload });
        if (error) { toast("作成に失敗しました", "error"); setSaving(false); return; }
      }
    }
    toast(isEdit ? `「${name}」を更新しました` : `「${name}」を作成しました`);
    onSaved();
    onClose();
  };

  const FeatureRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
      <span style={{ fontSize: 13, color: "#1A1714", fontWeight: 500 }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, color: value ? "#059669" : "#9E9690", fontWeight: 600 }}>{value ? "ON" : "OFF"}</span>
        <Toggle value={value} onChange={onChange} />
      </div>
    </div>
  );

  return (
    <DialogShell
      title={isSystem ? `プラン詳細：${plan!.name}` : isEdit ? `プランを編集：${plan!.name}` : "新規プランを作成"}
      size="xl"
      onClose={saving ? () => {} : onClose}
      footer={
        isSystem ? (
          <BtnSecondary onClick={onClose}>閉じる</BtnSecondary>
        ) : (
          <>
            <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
            <BtnPrimary onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "保存中..." : isEdit ? "更新する" : "作成する"}
            </BtnPrimary>
          </>
        )
      }
    >
      {/* プラン名 */}
      <FieldInput label="プラン名" placeholder="例: スタータープラン" value={name} onChange={isSystem ? () => {} : v => { setName(v); setNameErr(false); }} required />
      {nameErr && <p style={{ fontSize: 11, color: "#DC2626", marginTop: -8 }}>プラン名は必須です</p>}

      {/* 有効期限 */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}>
          <Calendar style={{ width: 12, height: 12 }} />
          アカウント有効期限
          <span style={{ fontSize: 11, color: "#A09790", fontWeight: 400 }}>（未設定の場合は無期限）</span>
        </label>
        <DatePickerInput value={expiresAt} onChange={setExpiresAt} disabled={isSystem} />
      </div>

      <SectionLabel label="数制限（空欄 = 無制限）" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <LimitInput label="メンバー招待数（組織の総メンバー数上限）" value={maxMembers} onChange={setMaxMembers} />
        <LimitInput label="プロジェクト作成数（組織全体）" value={maxProjects} onChange={setMaxProjects} />
        <LimitInput label="スプリント数（1プロジェクトあたり）" value={maxSprintsPerProject} onChange={setMaxSprintsPerProject} />
        <LimitInput label="チケット数（1スプリントあたり）" value={maxTicketsPerSprint} onChange={setMaxTicketsPerSprint} />
        <LimitInput label="添付画像枚数（1アイテムあたり）" value={maxImagesPerItem} onChange={setMaxImagesPerItem} />
        <LimitInput label="コメント投稿数（1チケットあたり）" value={maxCommentsPerTicket} onChange={setMaxCommentsPerTicket} />
        <LimitInput label="Myフィルタ保存数（1スプリントあたり）" value={maxFiltersPerSprint} onChange={setMaxFiltersPerSprint} />
      </div>

      <SectionLabel label="機能 ON/OFF" />
      <div style={{ background: "#FAFAF8", borderRadius: 10, padding: "0 12px", border: "1px solid rgba(26,23,20,0.07)" }}>
        <FeatureRow label="通知管理（Slack連携・通知設定）" value={featureNotifications} onChange={setFeatureNotifications} />
        <FeatureRow label="CSV出力" value={featureCsvExport} onChange={setFeatureCsvExport} />
        <FeatureRow label="実績モニタ" value={featureActualMonitor} onChange={setFeatureActualMonitor} />
        <FeatureRow label="子チケット作成" value={featureChildTickets} onChange={setFeatureChildTickets} />
        <FeatureRow label="チケット一括作成" value={featureBulkCreate} onChange={setFeatureBulkCreate} />
      </div>
    </DialogShell>
  );
}

// ── プランカード（コンパクト正方形） ──────────────────────────────
function PlanCard({ plan, onClick, onDelete }: { plan: PlanSettings; onClick: () => void; onDelete?: () => void }) {
  const [hovered, setHovered] = useState(false);
  const limits = [
    { label: "メンバー", val: plan.maxMembers },
    { label: "PJ", val: plan.maxProjects },
    { label: "スプリント", val: plan.maxSprintsPerProject },
    { label: "チケット", val: plan.maxTicketsPerSprint },
    { label: "画像", val: plan.maxImagesPerItem },
    { label: "コメント", val: plan.maxCommentsPerTicket },
    { label: "フィルタ", val: plan.maxFiltersPerSprint },
  ];
  const featuresOff = [
    !plan.featureNotifications && "通知",
    !plan.featureCsvExport && "CSV",
    !plan.featureActualMonitor && "実績",
    !plan.featureChildTickets && "子TK",
    !plan.featureBulkCreate && "一括作成",
  ].filter(Boolean) as string[];
  const isAllUnlimited = limits.every(l => l.val === null) && featuresOff.length === 0;

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: "#FFFFFF", border: hovered ? "1.5px solid rgba(5,150,105,0.35)" : "1.5px solid rgba(26,23,20,0.08)", borderRadius: 16, padding: "16px", cursor: "pointer", transition: "all 0.18s", boxShadow: hovered ? "0 8px 24px rgba(5,150,105,0.12)" : "0 2px 6px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" as const, gap: 10, position: "relative" as const }}
    >
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: plan.isSystem ? "linear-gradient(135deg,#ECFDF5,#D1FAE5)" : "linear-gradient(135deg,#EFF6FF,#DBEAFE)", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${plan.isSystem ? "rgba(5,150,105,0.15)" : "rgba(37,99,235,0.15)"}`, flexShrink: 0 }}>
          <CreditCard style={{ width: 16, height: 16, color: plan.isSystem ? "#059669" : "#2563EB" }} />
        </div>
        {!plan.isSystem && onDelete && (
          <button onClick={e => { e.stopPropagation(); onDelete(); }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 6, border: "1px solid rgba(26,23,20,0.09)", background: "#FAFAF9", cursor: "pointer", color: "#C9C4BB", opacity: hovered ? 1 : 0, transition: "opacity 0.15s" }}
            onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FEF2F2"; el.style.color = "#DC2626"; el.style.borderColor = "rgba(220,38,38,0.20)"; }}
            onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#FAFAF9"; el.style.color = "#C9C4BB"; el.style.borderColor = "rgba(26,23,20,0.09)"; }}>
            <Trash2 style={{ width: 10, height: 10 }} />
          </button>
        )}
      </div>

      {/* プラン名 */}
      <div>
        <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", margin: 0, lineHeight: 1.2 }}>{plan.name}</p>
        <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" as const }}>
          {plan.isSystem && <span style={{ fontSize: 9, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 20, padding: "1px 6px" }}>システム</span>}
          {plan.accountExpiresAt && <span style={{ fontSize: 9, fontWeight: 600, color: "#D97706", background: "#FEF3C7", border: "1px solid rgba(217,119,6,0.20)", borderRadius: 20, padding: "1px 6px" }}>期限あり</span>}
        </div>
      </div>

      {/* 制限サマリー */}
      <div style={{ flex: 1 }}>
        {isAllUnlimited ? (
          <span style={{ fontSize: 11, color: "#B0A9A4", fontWeight: 500 }}>すべて無制限</span>
        ) : (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" as const }}>
            {limits.filter(l => l.val !== null).map(l => (
              <span key={l.label} style={{ fontSize: 10, fontWeight: 600, color: "#92400E", background: "#FEF3C7", borderRadius: 5, padding: "2px 6px" }}>{l.label}: {l.val}</span>
            ))}
            {featuresOff.map(f => (
              <span key={f} style={{ fontSize: 10, fontWeight: 600, color: "#991B1B", background: "#FEF2F2", borderRadius: 5, padding: "2px 6px" }}>{f} OFF</span>
            ))}
          </div>
        )}
      </div>

      {/* フッター */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, opacity: hovered ? 1 : 0, transition: "opacity 0.15s" }}>
        <Pencil style={{ width: 10, height: 10, color: "#6B6458" }} />
        <span style={{ fontSize: 11, color: "#6B6458", fontWeight: 600 }}>{plan.isSystem ? "詳細を見る" : "クリックして編集"}</span>
      </div>
    </div>
  );
}

// ── プラン追加カード ───────────────────────────────────────────
function AddPlanCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "#F0FDF4" : "#FAFAFA", border: `1.5px dashed ${hovered ? "rgba(5,150,105,0.45)" : "rgba(26,23,20,0.13)"}`, borderRadius: 16, cursor: "pointer", transition: "all 0.18s", display: "flex", flexDirection: "column" as const, alignItems: "center", justifyContent: "center", gap: 8, minHeight: 130 }}
    >
      <div style={{ width: 36, height: 36, borderRadius: 10, background: hovered ? "linear-gradient(135deg,#059669,#047857)" : "rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.18s" }}>
        <Plus style={{ width: 16, height: 16, color: hovered ? "#FFFFFF" : "#B0A9A4", transition: "color 0.18s" }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: hovered ? "#059669" : "#A09790", transition: "color 0.18s" }}>新規プランを作成</span>
    </div>
  );
}

// ── 組織グリッド末尾の追加カード ───────────────────────────────
function AddOrgCard({ onClick }: { onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: hovered ? "#F0FDF4" : "#FAFAFA", border: `1.5px dashed ${hovered ? "rgba(5,150,105,0.40)" : "rgba(26,23,20,0.13)"}`, borderRadius: 20, padding: "0", cursor: "pointer", transition: "all 0.20s", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 180 }}
    >
      <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: 13, background: hovered ? "linear-gradient(135deg, #059669, #047857)" : "rgba(26,23,20,0.06)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.20s" }}>
          <Plus style={{ width: 20, height: 20, color: hovered ? "#FFFFFF" : "#B0A9A4", transition: "color 0.20s" }} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, color: hovered ? "#059669" : "#9E9690", transition: "color 0.20s" }}>新規組織を作成</span>
      </div>
    </div>
  );
}

// ── 組織フォームモーダル（プラン選択含む） ──────────────────────
function OrgFormDialog({ org, plans, onClose, onSaved }: { org?: OrgWithStats; plans: PlanSettings[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name,               setName]               = useState(org?.name               ?? "");
  const [representativeName, setRepresentativeName] = useState(org?.representativeName ?? "");
  const [contactName,        setContactName]        = useState(org?.contactName        ?? "");
  const [phone,              setPhone]              = useState(org?.phone              ?? "");
  const [websiteUrl,         setWebsiteUrl]         = useState(org?.websiteUrl         ?? "");
  const [address,            setAddress]            = useState(org?.address            ?? "");
  const [industry,           setIndustry]           = useState(org?.industry           ?? "");
  const [description,        setDescription]        = useState(org?.description        ?? "");
  const [planId,             setPlanId]             = useState<string>(org?.planId ?? "");
  const [isSystemAdmin,      setIsSystemAdmin]      = useState(org?.isSystemAdmin ?? false);
  const [saving, setSaving] = useState(false);
  const [planErr, setPlanErr] = useState(false);

  const isNew = !org;
  const allPlans = [UNLIMITED_PLAN, ...plans.filter(p => !p.isSystem)];

  const handleSave = async () => {
    if (!name.trim()) return;
    if (isNew && !planId) { setPlanErr(true); return; }
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
      plan_id:             (planId && planId !== "system-unlimited") ? planId : null,
      is_system_admin:     isSystemAdmin,
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
      <FieldInput label="組織名" placeholder="例: サンプル株式会社" value={name} onChange={setName} required />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <FieldInput label="代表者名" placeholder="例: 山田 太郎" value={representativeName} onChange={setRepresentativeName} />
        <FieldInput label="担当者名" placeholder="例: 鈴木 花子" value={contactName} onChange={setContactName} />
        <FieldInput label="電話番号" placeholder="例: 03-1234-5678" value={phone} onChange={setPhone} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <FieldInput label="業界" placeholder="例: IT・ソフトウェア" value={industry} onChange={setIndustry} />
        <FieldInput label="ウェブサイト URL" placeholder="例: https://example.com" value={websiteUrl} onChange={setWebsiteUrl} />
        <FieldInput label="住所" placeholder="例: 東京都渋谷区〇〇 1-2-3" value={address} onChange={setAddress} />
      </div>

      <FieldTextarea label="概要・備考" placeholder="組織の概要や備考を入力..." value={description} onChange={setDescription} />

      {/* システム管理会社フラグ（Meece）。ONにした組織のメンバーだけがバージョン履歴を閲覧できる */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", background: isSystemAdmin ? "#ECFDF5" : "#F8F8F7", border: `1px solid ${isSystemAdmin ? "rgba(5,150,105,0.25)" : "rgba(26,23,20,0.08)"}`, borderRadius: 10 }}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles style={{ width: 13, height: 13, color: "#059669" }} />
            システム管理会社
          </span>
          <span style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.5 }}>ONにすると、この組織のメンバーがバージョン履歴を閲覧できます（Meece株式会社のみONにしてください）。</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: isSystemAdmin ? "#059669" : "#9E9690", fontWeight: 600 }}>{isSystemAdmin ? "ON" : "OFF"}</span>
          <Toggle value={isSystemAdmin} onChange={setIsSystemAdmin} />
        </div>
      </div>

      {/* プラン選択 */}
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", display: "flex", alignItems: "center", gap: 4 }}>
          <CreditCard style={{ width: 12, height: 12 }} />
          適用プラン
          {isNew && <span style={{ color: "#DC2626" }}> *</span>}
        </label>
        <div style={{ outline: planErr ? "1.5px solid #DC2626" : "none", borderRadius: 9 }}>
          <CustomSelect
            value={planId}
            onChange={v => { setPlanId(v); setPlanErr(false); }}
            placeholder="プランを選択してください"
            options={allPlans.map(p => ({ value: p.id!, label: p.name + (p.isSystem ? "（システム）" : "") }))}
          />
        </div>
        {planErr && <p style={{ fontSize: 11, color: "#DC2626" }}>プランは必須です</p>}
      </div>
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
      <div style={{ height: 6, background: hovered ? "linear-gradient(90deg, #059669, #34D399)" : "linear-gradient(90deg, #D1FAE5, #A7F3D0)", transition: "all 0.20s" }} />

      <div style={{ padding: "22px 24px 20px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: hovered ? "linear-gradient(135deg, #059669, #047857)" : "linear-gradient(135deg, #ECFDF5, #D1FAE5)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, border: hovered ? "none" : "1px solid rgba(5,150,105,0.12)", transition: "all 0.20s" }}>
              <Globe style={{ width: 22, height: 22, color: hovered ? "#FFFFFF" : "#059669", transition: "color 0.20s" }} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <p style={{ fontSize: 17, fontWeight: 800, color: "#1A1714", margin: 0, letterSpacing: "-0.01em", whiteSpace: "nowrap" }}>{org.name}</p>
                {org.isSystemAdmin && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 700, color: "#047857", background: "#D1FAE5", padding: "2px 7px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0 }}>
                    <Sparkles style={{ width: 10, height: 10, flexShrink: 0 }} />システム管理会社
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11, color: "#A09790", margin: "4px 0 0" }}>作成日 {formatDate(org.createdAt)}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                <CreditCard style={{ width: 10, height: 10, color: "#6B6458" }} />
                <span style={{ fontSize: 10, color: "#6B6458", fontWeight: 600 }}>{org.planName}</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
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
  const [plans, setPlans] = useState<PlanSettings[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<OrgWithStats | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Organization | null>(null);
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [editPlan, setEditPlan] = useState<PlanSettings | null>(null);
  const [deletePlan, setDeletePlan] = useState<PlanSettings | null>(null);

  const loadPlans = async (): Promise<Map<string, string>> => {
    if (!isSupabaseEnabled) return new Map();
    const { data } = await supabase!.from("plans").select("id, name").order("created_at");
    const map = new Map<string, string>();
    if (data) data.forEach((p: { id: string; name: string }) => map.set(p.id, p.name));
    return map;
  };

  const loadFullPlans = async () => {
    if (!isSupabaseEnabled) return;
    const { data } = await supabase!.from("plans").select("*").order("created_at");
    if (data) {
      setPlans(data.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        name: row.name as string,
        isSystem: (row.is_system as boolean) ?? false,
        accountExpiresAt: (row.account_expires_at as string | null) ?? null,
        maxMembers: (row.max_members as number | null) ?? null,
        maxProjects: (row.max_projects as number | null) ?? null,
        maxSprintsPerProject: (row.max_sprints_per_project as number | null) ?? null,
        maxTicketsPerSprint: (row.max_tickets_per_sprint as number | null) ?? null,
        maxImagesPerItem: (row.max_images_per_item as number | null) ?? null,
        maxCommentsPerTicket: (row.max_comments_per_ticket as number | null) ?? null,
        maxFiltersPerSprint: (row.max_filters_per_sprint as number | null) ?? null,
        featureNotifications: (row.feature_notifications as boolean) ?? true,
        featureCsvExport: (row.feature_csv_export as boolean) ?? true,
        featureActualMonitor: (row.feature_actual_monitor as boolean) ?? true,
        featureChildTickets: (row.feature_child_tickets as boolean) ?? true,
        featureBulkCreate: (row.feature_bulk_create as boolean) ?? true,
      })));
    }
  };

  const fetchOrgs = async (planMap: Map<string, string>) => {
    const { data: orgsData } = await supabase!
      .from("organizations")
      .select("id, name, created_at, representative_name, contact_name, phone, website_url, address, industry, description, plan_id, is_system_admin")
      .order("created_at");
    if (!orgsData) return;

    const orgIds = orgsData.map((o: any) => o.id as string);
    let profileRows: { id: string; name: string; status: string; organization_id: string }[] = [];
    if (orgIds.length > 0) {
      const { data: pd } = await supabase!
        .from("profiles")
        .select("id, name, status, organization_id")
        .in("organization_id", orgIds);
      profileRows = (pd ?? []) as typeof profileRows;
    }

    const profilesByOrg = new Map<string, typeof profileRows>();
    for (const p of profileRows) {
      if (!profilesByOrg.has(p.organization_id)) profilesByOrg.set(p.organization_id, []);
      profilesByOrg.get(p.organization_id)!.push(p);
    }

    setOrgs(orgsData.map((r: any) => {
      const profiles = profilesByOrg.get(r.id as string) ?? [];
      const planId = (r.plan_id as string | null) ?? null;
      return {
        id: r.id as string,
        name: r.name as string,
        createdAt: (r.created_at as string) || "",
        representativeName: (r.representative_name as string) || "",
        contactName: (r.contact_name as string) || "",
        phone: (r.phone as string) || "",
        websiteUrl: (r.website_url as string) || "",
        address: (r.address as string) || "",
        industry: (r.industry as string) || "",
        description: (r.description as string) || "",
        isSystemAdmin: (r.is_system_admin as boolean) ?? false,
        memberCount: profiles.length,
        activeCount: profiles.filter(p => p.status === "active").length,
        memberPreviews: profiles.slice(0, 5).map(p => ({ id: p.id, name: p.name })),
        planId,
        planName: planId ? (planMap.get(planId) ?? "—") : "無制限",
      } as OrgWithStats;
    }));
  };

  const refresh = async () => {
    if (!isSupabaseEnabled) return;
    const planMap = await loadPlans();
    await fetchOrgs(planMap);
  };

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    Promise.all([
      loadFullPlans(),
      (async () => {
        const planMap = await loadPlans();
        await fetchOrgs(planMap);
      })(),
    ]).finally(() => setLoading(false));
  }, []);

  const handleDeleteOrg = async (org: Organization) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("organizations").delete().eq("id", org.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setOrgs(prev => prev.filter(o => o.id !== org.id));
    toast(`「${org.name}」を削除しました`);
  };

  const handleDeletePlan = async (plan: PlanSettings) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("plans").delete().eq("id", plan.id);
      if (error) { toast("削除に失敗しました", "error"); throw error; }
    }
    setPlans(prev => prev.filter(p => p.id !== plan.id));
    toast(`「${plan.name}」を削除しました`);
  };

  const handleRefreshAll = () => { refresh(); loadFullPlans(); };

  const totalMembers = orgs.reduce((sum, o) => sum + o.memberCount, 0);
  const totalActive  = orgs.reduce((sum, o) => sum + o.activeCount,  0);
  const nonSystemPlans = plans.filter(p => !p.isSystem);

  if (loading) return <PageLoader />;

  return (
    <div style={{ minHeight: "100%", background: "#F5F6F8" }}>

      {/* ── ヒーローヘッダー ── */}
      <div style={{ background: "linear-gradient(135deg, #022c22 0%, #064E3B 40%, #065F46 70%, #047857 100%)", padding: "40px 40px 44px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -60, right: -60, width: 280, height: 280, borderRadius: "50%", background: "rgba(255,255,255,0.04)" }} />
        <div style={{ position: "absolute", bottom: -80, right: 200, width: 200, height: 200, borderRadius: "50%", background: "rgba(52,211,153,0.08)" }} />
        <div style={{ position: "absolute", top: 20, right: 160, width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />

        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.20)", borderRadius: 20, padding: "5px 12px", marginBottom: 20 }}>
          <Sparkles style={{ width: 11, height: 11, color: "#34D399" }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.80)", letterSpacing: "0.10em" }}>PLATFORM MANAGEMENT</span>
        </div>

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

          <div />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" as const, position: "relative" }}>
          {[
            { label: "登録組織",   value: orgs.length  },
            { label: "総メンバー", value: totalMembers },
            { label: "アクティブ", value: totalActive  },
            { label: "招待中",     value: totalMembers - totalActive },
            { label: "プラン数",   value: plans.length },
          ].map(({ label, value }) => (
            <div key={label} style={{ padding: "10px 18px", background: "rgba(255,255,255,0.14)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.18)", textAlign: "center" as const }}>
              <p style={{ fontSize: 22, fontWeight: 800, color: "#FFFFFF", margin: 0 }}>{value}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.70)", margin: "2px 0 0", fontWeight: 600 }}>{label}</p>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "32px 40px 48px" }}>
        {/* ── プラン一覧 ── */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <CreditCard style={{ width: 16, height: 16, color: "#6B6458" }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: 0 }}>プラン一覧</h2>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#2563EB", background: "#EFF6FF", padding: "2px 9px", borderRadius: 20 }}>{plans.length}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
            <PlanCard plan={UNLIMITED_PLAN} onClick={() => setEditPlan(UNLIMITED_PLAN)} />
            {nonSystemPlans.map(p => (
              <PlanCard key={p.id} plan={p}
                onClick={() => setEditPlan(p)}
                onDelete={() => setDeletePlan(p)}
              />
            ))}
            <AddPlanCard onClick={() => setShowCreatePlan(true)} />
          </div>
        </div>

        {/* ── 組織リスト ── */}
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
            <Building2 style={{ width: 16, height: 16, color: "#6B6458" }} />
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", margin: 0 }}>登録済み組織</h2>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", background: "#ECFDF5", padding: "2px 9px", borderRadius: 20 }}>{orgs.length}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
            {orgs.map(org => (
              <OrgCard
                key={org.id}
                org={org}
                onNavigate={() => navigate(`/members?orgId=${org.id}`)}
                onEdit={() => setEditTarget(org)}
                onDelete={() => setDeleteTarget(org)}
              />
            ))}
            {/* 末尾：新規組織追加カード */}
            <AddOrgCard onClick={() => setShowCreate(true)} />
          </div>
        </div>
      </div>

      {showCreate && <OrgFormDialog plans={plans} onClose={() => setShowCreate(false)} onSaved={handleRefreshAll} />}
      {editTarget && <OrgFormDialog org={editTarget} plans={plans} onClose={() => setEditTarget(null)} onSaved={handleRefreshAll} />}
      {deleteTarget && (
        <ConfirmDialog
          message={`「${deleteTarget.name}」を削除しますか？\n所属メンバーのorganization_idがNULLになります。`}
          onConfirm={() => handleDeleteOrg(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
      {showCreatePlan && <PlanFormDialog onClose={() => setShowCreatePlan(false)} onSaved={handleRefreshAll} />}
      {editPlan && <PlanFormDialog plan={editPlan} onClose={() => setEditPlan(null)} onSaved={handleRefreshAll} />}
      {deletePlan && (
        <ConfirmDialog
          message={`プラン「${deletePlan.name}」を削除しますか？\nこのプランを使用している組織のプランが外れます。`}
          onConfirm={() => handleDeletePlan(deletePlan)}
          onClose={() => setDeletePlan(null)}
        />
      )}
    </div>
  );
}
