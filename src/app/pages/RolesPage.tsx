import { useEffect, useState } from "react";
import { Plus, X, UserCog, Pencil, Trash2, AlertCircle } from "lucide-react";
import { Navigate } from "react-router";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { RoleDefinition, UserPermissions } from "@/app/types";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";

const DEFAULT_PERMS: UserPermissions = {
  canCreateTicket: false, canCreateSprint: false,
  canEditDelete: false, canReview: false, canSkipReview: false, canGeneratePrompt: false,
  canAccessMembers: false, canAccessRoles: false, canAccessGroups: false,
};

const PERM_FLAGS: { key: keyof UserPermissions; label: string; desc: string }[] = [
  { key: "canSkipReview",     label: "レビュースキップ", desc: "レビューをスキップして次ステータスへ進められる" },
  { key: "canGeneratePrompt", label: "プロンプト生成",   desc: "ClaudeCode プロンプトの生成が可能" },
  { key: "canAccessMembers",  label: "メンバー管理",     desc: "メンバー管理画面へのアクセスが可能" },
  { key: "canAccessRoles",    label: "ロール設定",       desc: "ロール設定画面へのアクセスが可能" },
  { key: "canAccessGroups",   label: "アサイン計画",     desc: "アサイン計画画面へのアクセスが可能" },
];

export function RolesPage() {
  const { userPermissions } = useAuth();
  const { toast } = useToast();
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [editTarget, setEditTarget] = useState<RoleDefinition | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<RoleDefinition | null>(null);

  if (!userPermissions.canAccessRoles) return <Navigate to="/dashboard" replace />;

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    supabase!.from("roles").select("*").order("id")
      .then(({ data }) => { if (data) setRoles(data as RoleDefinition[]); setLoading(false); });
  }, []);

  const handleCreate = async (name: string, label: string, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { data, error } = await supabase!.from("roles")
        .insert({ name, label, base_permissions: perms }).select().single();
      if (error) { toast("ロールの作成に失敗しました", "error"); return; }
      if (data) setRoles(prev => [...prev, data as RoleDefinition]);
    } else {
      const newId = roles.length > 0 ? Math.max(...roles.map(r => r.id)) + 1 : 1;
      setRoles(prev => [...prev, { id: newId, name, label, base_permissions: perms }]);
    }
    setShowNewModal(false);
    toast(`ロール「${label}」を作成しました`);
  };

  const handleUpdate = async (roleId: number, name: string, label: string, perms: UserPermissions) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("roles")
        .update({ name, label, base_permissions: perms }).eq("id", roleId);
      if (error) { toast("保存に失敗しました", "error"); return; }
    }
    setRoles(prev => prev.map(r => r.id === roleId ? { ...r, name, label, base_permissions: perms } : r));
    setEditTarget(null);
    toast("ロールを更新しました");
  };

  const handleDelete = async (role: RoleDefinition) => {
    if (isSupabaseEnabled) {
      const { error } = await supabase!.from("roles").delete().eq("id", role.id);
      if (error) { toast("削除に失敗しました", "error"); return; }
    }
    setRoles(prev => prev.filter(r => r.id !== role.id));
    setDeleteConfirm(null);
    toast(`ロール「${role.label}」を削除しました`);
  };

  return (
    <div style={{ padding: "28px 32px" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#7C3AED", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <UserCog style={{ width: 18, height: 18, color: "#FFF" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>ロール設定</h1>
            <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>管理画面アクセス権限をロールごとに管理します</p>
          </div>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#7C3AED", color: "#FFF", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}
        >
          <Plus style={{ width: 14, height: 14 }} />
          ロール追加
        </button>
      </div>

      {/* Info note */}
      <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 8, padding: "10px 14px", marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: "#5B21B6" }}>
          ここで設定した権限は<strong>管理画面へのアクセス制御</strong>に使われます。チケット・スプリント操作権限はアサイン計画のグループ設定で管理してください。
        </p>
      </div>

      {/* Role list */}
      {loading ? (
        <p style={{ textAlign: "center" as const, padding: 48, color: "#9CA3AF", fontSize: 13 }}>読み込み中...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
          {roles.map(role => {
            const activePerms = PERM_FLAGS.filter(f => role.base_permissions?.[f.key]);
            return (
              <div
                key={role.id}
                style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{role.label}</span>
                    <code style={{ fontSize: 11, color: "#6B7280", background: "#F3F4F6", padding: "1px 6px", borderRadius: 4, fontFamily: "monospace" }}>
                      {role.name}
                    </code>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap" as const, gap: 4 }}>
                    {activePerms.length > 0 ? (
                      activePerms.map(f => (
                        <span key={f.key} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 12, background: "rgba(124,58,237,0.08)", color: "#7C3AED", fontWeight: 500 }}>
                          {f.label}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: 11, color: "#D1D5DB" }}>権限なし</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => setEditTarget(role)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#F9FAFB", border: "1px solid #E5E7EB", color: "#374151", fontSize: 12, fontWeight: 500, borderRadius: 7, cursor: "pointer" }}
                  >
                    <Pencil style={{ width: 12, height: 12 }} /> 編集
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(role)}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "6px 12px", background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", fontSize: 12, fontWeight: 500, borderRadius: 7, cursor: "pointer" }}
                  >
                    <Trash2 style={{ width: 12, height: 12 }} /> 削除
                  </button>
                </div>
              </div>
            );
          })}
          {roles.length === 0 && (
            <div style={{ textAlign: "center" as const, padding: 48, background: "#FFF", borderRadius: 12, border: "1px solid #E5E7EB" }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <UserCog style={{ width: 20, height: 20, color: "#9CA3AF" }} />
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 4 }}>ロールがありません</p>
              <p style={{ fontSize: 12, color: "#9CA3AF" }}>「ロール追加」からロールを作成してください</p>
            </div>
          )}
        </div>
      )}

      {showNewModal && (
        <RoleModal
          existingNames={roles.map(r => r.name)}
          onClose={() => setShowNewModal(false)}
          onSave={handleCreate}
        />
      )}
      {editTarget && (
        <RoleModal
          role={editTarget}
          existingNames={roles.filter(r => r.id !== editTarget.id).map(r => r.name)}
          onClose={() => setEditTarget(null)}
          onSave={(name, label, perms) => handleUpdate(editTarget.id, name, label, perms)}
        />
      )}
      {deleteConfirm && (
        <DeleteConfirmModal
          role={deleteConfirm}
          onClose={() => setDeleteConfirm(null)}
          onConfirm={() => handleDelete(deleteConfirm)}
        />
      )}
    </div>
  );
}

// ── Unified Role Modal (create & edit) ───────────────────────────────────────
function RoleModal({
  role,
  existingNames,
  onClose,
  onSave,
}: {
  role?: RoleDefinition;
  existingNames: string[];
  onClose: () => void;
  onSave: (name: string, label: string, perms: UserPermissions) => Promise<void>;
}) {
  const isEdit = !!role;
  const [label, setLabel] = useState(role?.label ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [perms, setPerms] = useState<UserPermissions>({ ...DEFAULT_PERMS, ...(role?.base_permissions ?? {}) });
  const [saving, setSaving] = useState(false);
  const [nameTouched, setNameTouched] = useState(isEdit);

  const toSlug = (s: string) =>
    s.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");

  const handleLabelChange = (v: string) => {
    setLabel(v);
    if (!nameTouched) setName(toSlug(v));
  };

  const isDuplicate = name.trim().length > 0 && existingNames.includes(name.trim());
  const canSave = label.trim().length > 0 && name.trim().length > 0 && !isDuplicate;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    await onSave(name.trim(), label.trim(), perms);
    setSaving(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.20)", width: 500, maxHeight: "88vh", overflow: "auto" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", gap: 10, position: "sticky" as const, top: 0, background: "#FFF", zIndex: 1 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(124,58,237,0.10)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <UserCog style={{ width: 14, height: 14, color: "#7C3AED" }} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", flex: 1 }}>
            {isEdit ? "ロールを編集" : "新規ロール追加"}
          </h3>
          <button onClick={onClose} style={{ padding: 6, border: "none", background: "transparent", cursor: "pointer", color: "#9CA3AF", borderRadius: 6 }}>
            <X style={{ width: 15, height: 15 }} />
          </button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          {/* Name fields */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 24 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>
                表示名 <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <input
                autoFocus={!isEdit}
                value={label}
                onChange={e => handleLabelChange(e.target.value)}
                placeholder="例: QAエンジニア"
                style={{ width: "100%", padding: "9px 11px", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, fontSize: 13, outline: "none", boxSizing: "border-box" as const }}
                onFocus={e => { e.currentTarget.style.borderColor = "#7C3AED"; e.currentTarget.style.background = "#FFF"; }}
                onBlur={e => { e.currentTarget.style.borderColor = "#E5E7EB"; e.currentTarget.style.background = "#F9FAFB"; }}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: "#374151", display: "block", marginBottom: 5 }}>
                識別子 <span style={{ color: "#DC2626" }}>*</span>
              </label>
              <input
                value={name}
                onChange={e => { setName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, "")); setNameTouched(true); }}
                placeholder="例: qa-engineer"
                style={{ width: "100%", padding: "9px 11px", background: isDuplicate ? "#FEF2F2" : "#F9FAFB", border: `1px solid ${isDuplicate ? "#FECACA" : "#E5E7EB"}`, borderRadius: 8, fontSize: 12, outline: "none", boxSizing: "border-box" as const, fontFamily: "monospace", color: "#374151" }}
                onFocus={e => { if (!isDuplicate) { e.currentTarget.style.borderColor = "#7C3AED"; e.currentTarget.style.background = "#FFF"; } }}
                onBlur={e => { e.currentTarget.style.borderColor = isDuplicate ? "#FECACA" : "#E5E7EB"; e.currentTarget.style.background = isDuplicate ? "#FEF2F2" : "#F9FAFB"; }}
              />
              {isDuplicate ? (
                <p style={{ fontSize: 10, color: "#DC2626", marginTop: 4, display: "flex", alignItems: "center", gap: 3 }}>
                  <AlertCircle style={{ width: 10, height: 10 }} /> この識別子はすでに使用されています
                </p>
              ) : (
                <p style={{ fontSize: 10, color: "#9CA3AF", marginTop: 4 }}>英数字・ハイフン・アンダースコアのみ</p>
              )}
            </div>
          </div>

          {/* Permissions */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: "#374151", marginBottom: 10 }}>権限設定</p>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              {PERM_FLAGS.map(f => {
                const active = perms[f.key];
                return (
                  <label
                    key={f.key}
                    onClick={() => setPerms(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 8, cursor: "pointer", background: active ? "#F5F3FF" : "#F9FAFB", border: `1px solid ${active ? "#DDD6FE" : "transparent"}`, transition: "all 0.15s" }}
                  >
                    <div style={{ width: 32, height: 18, borderRadius: 9, background: active ? "#7C3AED" : "#D1D5DB", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                      <div style={{ position: "absolute", top: 2, left: active ? 14 : 2, width: 14, height: 14, borderRadius: "50%", background: "#FFF", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: active ? "#5B21B6" : "#374151" }}>{f.label}</p>
                      <p style={{ fontSize: 11, color: "#9CA3AF" }}>{f.desc}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "4px 24px 20px", display: "flex", gap: 8 }}>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{ flex: 1, padding: "10px 0", background: (!canSave || saving) ? "#F3F4F6" : "#7C3AED", color: (!canSave || saving) ? "#9CA3AF" : "#FFF", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: (!canSave || saving) ? "not-allowed" : "pointer" }}
          >
            {saving ? "保存中..." : isEdit ? "変更を保存" : "作成する"}
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F3F4F6", color: "#374151", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────
function DeleteConfirmModal({ role, onClose, onConfirm }: {
  role: RoleDefinition;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.40)", backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 401, background: "#FFF", borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,0.20)", width: 380 }}>
        <div style={{ padding: "24px 24px 20px" }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
            <Trash2 style={{ width: 18, height: 18, color: "#DC2626" }} />
          </div>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 8 }}>ロールを削除しますか？</h3>
          <p style={{ fontSize: 13, color: "#6B7280", lineHeight: 1.6 }}>
            <strong>{role.label}</strong>（<code style={{ fontSize: 11, background: "#F3F4F6", padding: "1px 5px", borderRadius: 4, fontFamily: "monospace" }}>{role.name}</code>）を削除します。この操作は元に戻せません。
          </p>
        </div>
        <div style={{ padding: "0 24px 20px", display: "flex", gap: 8 }}>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            style={{ flex: 1, padding: "10px 0", background: deleting ? "#F3F4F6" : "#DC2626", color: deleting ? "#9CA3AF" : "#FFF", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: deleting ? "not-allowed" : "pointer" }}
          >
            {deleting ? "削除中..." : "削除する"}
          </button>
          <button onClick={onClose} style={{ padding: "10px 18px", background: "#F3F4F6", color: "#374151", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </>
  );
}
