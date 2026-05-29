import { useEffect, useState } from "react";
import { Plus, X, Check, UserCog, ChevronRight } from "lucide-react";
import { Navigate } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { RoleDefinition, UserPermissions } from "@/app/types";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";

const DEFAULT_PERMS: UserPermissions = {
  canCreateTicket: false, canCreateSprint: false,
  canEditDelete: false, canReview: false, canGeneratePrompt: false,
  canAccessMembers: false, canAccessRoles: false, canAccessGroups: false,
};

const PERM_FLAGS: { key: keyof UserPermissions; label: string; desc: string; color: string; bg: string }[] = [
  { key: "canGeneratePrompt", label: "プロンプト生成", desc: "ClaudeCode プロンプトの生成が可能",     color: "#DB2777", bg: "#FDF2F8" },
  { key: "canAccessMembers",  label: "メンバー管理",   desc: "メンバー管理画面へのアクセスが可能",    color: "#0891B2", bg: "#F0FDFE" },
  { key: "canAccessRoles",    label: "ロール設定",     desc: "ロール設定画面へのアクセスが可能",      color: "#9333EA", bg: "#FAF5FF" },
  { key: "canAccessGroups",   label: "アサイン計画",   desc: "アサイン計画画面へのアクセスが可能",    color: "#059669", bg: "#ECFDF5" },
];

export function RolesPage() {
  const { userPermissions } = useAuth();
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [editTarget, setEditTarget] = useState<RoleDefinition | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);

  if (!userPermissions.canAccessRoles) return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    supabase!.from("roles").select("*").order("id")
      .then(({ data }) => { if (data) setRoles(data as RoleDefinition[]); setLoading(false); });
  }, []);

  const handleCreate = async (name: string, label: string) => {
    const newPerms = { ...DEFAULT_PERMS };
    if (isSupabaseEnabled) {
      const { data, error } = await supabase!.from("roles")
        .insert({ name, label, base_permissions: newPerms }).select().single();
      if (error) { toast("ロールの作成に失敗しました", "error"); return; }
      if (data) setRoles(prev => [...prev, data as RoleDefinition]);
    } else {
      const newId = roles.length > 0 ? Math.max(...roles.map(r => r.id)) + 1 : 1;
      setRoles(prev => [...prev, { id: newId, name, label, base_permissions: newPerms }]);
    }
    toast(`ロール「${label}」を作成しました`);
  };

  const handleSave = async (roleId: number, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("roles").update({ base_permissions: perms }).eq("id", roleId);
      if (error) { toast("保存に失敗しました", "error"); return; }
    }
    setRoles(prev => prev.map(r => r.id === roleId ? { ...r, base_permissions: perms } : r));
    setEditTarget(null);
    toast("ロール権限を保存しました");
  };

  const permCount = (r: RoleDefinition) => PERM_FLAGS.filter(f => r.base_permissions?.[f.key]).length;

  return (
    <div style={{ padding: "28px 32px" }}>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 28 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg,#7C3AED,#6D28D9)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 10px rgba(124,58,237,0.30)" }}>
              <UserCog style={{ width: 16, height: 16, color: "#FFF" }} />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>ロール設定</h1>
          </div>
          <p style={{ fontSize: 12, color: "#A09790", marginLeft: 40 }}>ロールごとの管理画面アクセス権限を設定。プロジェクト操作権限はアサイン計画で管理します。</p>
        </div>
        <button onClick={() => setShowNewModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "9px 16px", background: "#7C3AED", color: "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: "pointer", boxShadow: "0 2px 8px rgba(124,58,237,0.30)", transition: "background 0.15s", whiteSpace: "nowrap" as const }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#6D28D9"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#7C3AED"; }}>
          <Plus style={{ width: 15, height: 15 }} />ロール追加
        </button>
      </div>

      {/* ── Info banner ── */}
      <div style={{ background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.15)", borderRadius: 10, padding: "10px 14px", marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#7C3AED", flexShrink: 0 }} />
        <p style={{ fontSize: 12, color: "#6D28D9", lineHeight: 1.5 }}>
          ここで設定した権限は<strong>管理画面へのアクセス制御</strong>に使われます。チケット・スプリント操作権限はアサイン計画のグループ設定で管理してください。
        </p>
      </div>

      {/* ── Role list ── */}
      {loading ? (
        <div style={{ textAlign: "center" as const, padding: "48px 0", color: "#A09790", fontSize: 13 }}>読み込み中...</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
          {roles.map(role => {
            const active = PERM_FLAGS.filter(f => role.base_permissions?.[f.key]);
            const inactive = PERM_FLAGS.filter(f => !role.base_permissions?.[f.key]);
            const count = permCount(role);
            return (
              <div key={role.id}
                style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "box-shadow 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"; }}>

                {/* Card header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <UserCog style={{ width: 18, height: 18, color: "#7C3AED" }} />
                    </div>
                    <div>
                      <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714" }}>{role.label}</p>
                      <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 2 }}>識別子: <code style={{ background: "#F4F5F6", padding: "1px 5px", borderRadius: 4, fontSize: 10 }}>{role.name}</code></p>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 11, color: count > 0 ? "#7C3AED" : "#B0A9A4", fontWeight: 600, background: count > 0 ? "rgba(124,58,237,0.08)" : "#F4F5F6", padding: "3px 10px", borderRadius: 20 }}>
                      {count}/{PERM_FLAGS.length} 権限
                    </span>
                    <button onClick={() => setEditTarget(role)}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 14px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer", transition: "all 0.15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.10)"; (e.currentTarget as HTMLElement).style.color = "#7C3AED"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}>
                      権限を編集 <ChevronRight style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                </div>

                {/* Permissions grid */}
                <div style={{ padding: "14px 20px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                  {PERM_FLAGS.map(f => {
                    const on = role.base_permissions?.[f.key];
                    return (
                      <div key={f.key} style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 6, padding: "10px 8px", borderRadius: 10, background: on ? f.bg : "#F9F8F6", border: `1px solid ${on ? f.color + "25" : "transparent"}`, transition: "all 0.15s" }}>
                        <div style={{ width: 24, height: 24, borderRadius: 7, background: on ? f.color : "rgba(26,23,20,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {on
                            ? <Check style={{ width: 13, height: 13, color: "#FFF" }} />
                            : <X style={{ width: 12, height: 12, color: "rgba(26,23,20,0.25)" }} />
                          }
                        </div>
                        <p style={{ fontSize: 10, fontWeight: 600, color: on ? f.color : "#C9C4BB", textAlign: "center" as const, lineHeight: 1.3 }}>{f.label}</p>
                      </div>
                    );
                  })}
                </div>

                {/* Active summary */}
                {active.length > 0 && (
                  <div style={{ padding: "0 20px 14px", display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                    {active.map(f => (
                      <span key={f.key} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: f.color + "15", color: f.color }}>✓ {f.label}</span>
                    ))}
                    {inactive.length > 0 && (
                      <span style={{ fontSize: 10, color: "#C9C4BB", padding: "2px 0" }}>+{inactive.length}項目は無効</span>
                    )}
                  </div>
                )}
                {active.length === 0 && (
                  <div style={{ padding: "0 20px 14px" }}>
                    <span style={{ fontSize: 11, color: "#C9C4BB" }}>基本権限なし（チケット参照・コメントのみ）</span>
                  </div>
                )}
              </div>
            );
          })}
          {roles.length === 0 && (
            <div style={{ textAlign: "center" as const, padding: "56px 0", background: "#FFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.08)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "rgba(124,58,237,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
                <UserCog style={{ width: 22, height: 22, color: "#7C3AED" }} />
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#6B6458", marginBottom: 4 }}>ロールがありません</p>
              <p style={{ fontSize: 12, color: "#B0A9A4" }}>「ロール追加」からロールを作成してください</p>
            </div>
          )}
        </div>
      )}

      {showNewModal && <NewRoleModal onClose={() => setShowNewModal(false)} onCreate={handleCreate} />}
      {editTarget && <RoleEditModal role={editTarget} onClose={() => setEditTarget(null)} onSave={perms => handleSave(editTarget.id, perms)} />}
    </div>
  );
}

// ── New role modal ────────────────────────────────────────────────────────────
function NewRoleModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, label: string) => void }) {
  const [label, setLabel] = useState("");
  const [name, setName] = useState("");

  const toAsciiSlug = (s: string) => s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");

  const handleLabelChange = (v: string) => {
    setLabel(v);
    const slug = toAsciiSlug(v);
    if (!name || name === toAsciiSlug(label)) setName(slug);
  };

  const canCreate = label.trim().length > 0 && name.trim().length > 0;

  const handleCreate = () => {
    if (!canCreate) return;
    onCreate(name.trim(), label.trim());
    onClose();
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 420 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(124,58,237,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <UserCog style={{ width: 15, height: 15, color: "#7C3AED" }} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", flex: 1 }}>新規ロール追加</h3>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>表示名 <span style={{ color: "#DC2626" }}>*</span></label>
            <input autoFocus value={label} onChange={e => handleLabelChange(e.target.value)}
              placeholder="例: QAエンジニア"
              style={{ width: "100%", padding: "10px 12px", background: "#F9F8F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, fontSize: 13, outline: "none", boxSizing: "border-box" as const, transition: "border 0.15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(124,58,237,0.40)"; e.currentTarget.style.background = "#FFF"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", display: "block", marginBottom: 6, letterSpacing: "0.04em" }}>識別子（英数字・ハイフンのみ）<span style={{ color: "#DC2626" }}>*</span></label>
            <input value={name} onChange={e => setName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
              placeholder="例: qa-engineer"
              style={{ width: "100%", padding: "10px 12px", background: "#F9F8F6", border: `1px solid ${name.length === 0 && label.length > 0 ? "rgba(220,38,38,0.40)" : "rgba(26,23,20,0.10)"}`, borderRadius: 9, fontSize: 13, outline: "none", boxSizing: "border-box" as const, fontFamily: "monospace", transition: "border 0.15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(124,58,237,0.40)"; e.currentTarget.style.background = "#FFF"; }}
              onBlur={e => { e.currentTarget.style.borderColor = name.length === 0 && label.length > 0 ? "rgba(220,38,38,0.40)" : "rgba(26,23,20,0.10)"; e.currentTarget.style.background = "#F9F8F6"; }} />
            <p style={{ fontSize: 10, color: name.length === 0 && label.length > 0 ? "#DC2626" : "#B0A9A4", marginTop: 4 }}>
              {name.length === 0 && label.length > 0
                ? "英数字・ハイフンで識別子を入力してください（例: qa-engineer）"
                : "DBで使われる内部識別子。英数字・ハイフン・アンダースコアのみ使用可"
              }
            </p>
          </div>
        </div>
        <div style={{ padding: "0 24px 22px", display: "flex", gap: 8 }}>
          <button onClick={handleCreate} disabled={!canCreate}
            style={{ flex: 1, padding: "10px 0", background: !canCreate ? "#F4F5F6" : "#7C3AED", color: !canCreate ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: !canCreate ? "not-allowed" : "pointer", transition: "background 0.15s" }}>
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

// ── Role edit modal ───────────────────────────────────────────────────────────
function RoleEditModal({ role, onClose, onSave }: { role: RoleDefinition; onClose: () => void; onSave: (perms: UserPermissions) => void }) {
  const [local, setLocal] = useState<UserPermissions>({ ...DEFAULT_PERMS, ...(role.base_permissions ?? {}) });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onSave(local);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 18, boxShadow: "0 24px 64px rgba(0,0,0,0.22)", width: 460 }}>
        <div style={{ padding: "22px 24px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(124,58,237,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <UserCog style={{ width: 15, height: 15, color: "#7C3AED" }} />
          </div>
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>権限設定</h3>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>{role.label}</p>
          </div>
          <button onClick={onClose} style={{ padding: 6, borderRadius: 8, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        <div style={{ padding: "16px 24px" }}>
          <p style={{ fontSize: 11, color: "#A09790", marginBottom: 14, background: "rgba(124,58,237,0.05)", padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.12)" }}>
            このロールを持つメンバーの管理画面アクセス権限を設定します。チケット・スプリント操作権限はアサイン計画で設定してください。
          </p>
          {PERM_FLAGS.map(f => {
            const active = local[f.key];
            return (
              <label key={f.key}
                onClick={() => setLocal(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderRadius: 10, cursor: "pointer", marginBottom: 6, background: active ? f.bg : "#F9F8F6", border: `1.5px solid ${active ? f.color + "30" : "transparent"}`, transition: "all 0.15s" }}>
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
            style={{ flex: 1, padding: "10px 0", background: saving ? "#F4F5F6" : "#7C3AED", color: saving ? "#B0A9A4" : "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 9, border: "none", cursor: saving ? "not-allowed" : "pointer", transition: "background 0.15s" }}>
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
