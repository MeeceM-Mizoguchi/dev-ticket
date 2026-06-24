import { useState } from "react";
import { Plus, Minus, Globe } from "lucide-react";
import type { Project, EnvMemo } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { inputCls, labelCls } from "@/app/lib/helpers";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);
const MAX_ENV_MEMOS = 10;

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }

export function ProjectSettingsDialog({ project, onClose, onUpdated }: {
  project: Project;
  onClose: () => void;
  onUpdated?: (newSlug: string) => void;
}) {
  const { userOrgId } = useAuth();
  const orgId = project.organizationId ?? userOrgId;
  const [slug, setSlug] = useState(project.slug);
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);
  const [envMemos, setEnvMemos] = useState<EnvMemo[]>(
    project.envMemos?.length ? project.envMemos : []
  );

  const addMemo = () => {
    if (envMemos.length >= MAX_ENV_MEMOS) return;
    setEnvMemos(prev => [...prev, { name: "", url: "" }]);
  };

  const removeMemo = (idx: number) => {
    setEnvMemos(prev => prev.filter((_, i) => i !== idx));
  };

  const updateMemo = (idx: number, field: keyof EnvMemo, value: string) => {
    setEnvMemos(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
  };

  const handleSave = async () => {
    const finalSlug = sanitizeSlug(slug.trim().toUpperCase());

    if (!finalSlug) { setSlugError("識別子を入力してください。"); return; }
    if (RESERVED_SLUGS.has(finalSlug.toLowerCase())) {
      setSlugError("その識別子は予約済みです。別の名前を使用してください。");
      return;
    }
    setSlugError("");

    const cleanedMemos = envMemos.filter(m => m.name.trim() || m.url.trim());

    if (isSupabaseEnabled) {
      setSaving(true);
      if (finalSlug !== project.slug) {
        let dupQ = supabase!.from("projects").select("id").eq("slug", finalSlug).neq("id", project.id);
        if (orgId) dupQ = dupQ.eq("organization_id", orgId);
        else dupQ = dupQ.is("organization_id", null);
        const { data: dup } = await dupQ.maybeSingle();
        if (dup) { setSlugError("この組織内ですでに使用されている識別子です。別の名前を使用してください。"); setSaving(false); return; }
      }
      const { error } = await supabase!.from("projects").update({ slug: finalSlug, env_memos: cleanedMemos }).eq("id", project.id);
      setSaving(false);
      if (error?.code === "23505") {
        setSlugError("その識別子はすでに使用されています。別の名前を使用してください。");
        return;
      }
    }
    onUpdated?.(finalSlug);
    onClose();
  };

  return (
    <DialogShell title="設定" onClose={onClose}
      footer={<><BtnSecondary onClick={onClose}>キャンセル</BtnSecondary><BtnPrimary onClick={handleSave}>{saving ? "保存中..." : "保存する"}</BtnPrimary></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* 識別子セクション */}
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>識別子の設定</p>
          <FieldInput
            label="プロジェクト識別子"
            placeholder="例: TEST"
            value={slug}
            onChange={v => setSlug(sanitizeSlug(v.toUpperCase()))}
          />
          <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
            URLに使用されます: <code style={{ background: "#F3F4F6", padding: "1px 6px", borderRadius: 4, fontSize: 11 }}>{slug || "TEST"}/TS-00001</code>
          </p>
          {slugError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{slugError}</p>}
        </div>

        {/* 区切り線 */}
        <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)" }} />

        {/* 環境メモセクション */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Globe style={{ width: 13, height: 13, color: "#059669" }} />
              <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", textTransform: "uppercase", letterSpacing: "0.08em" }}>環境メモ</p>
              <span style={{ fontSize: 10, color: "#9CA3AF" }}>（最大{MAX_ENV_MEMOS}件）</span>
            </div>
            {envMemos.length < MAX_ENV_MEMOS && (
              <button
                onClick={addMemo}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 7, cursor: "pointer", color: "#059669", fontSize: 11, fontWeight: 600, transition: "background 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                <Plus style={{ width: 11, height: 11 }} />追加
              </button>
            )}
          </div>

          {envMemos.length === 0 ? (
            <div style={{ padding: "20px 16px", background: "#F9FAFB", borderRadius: 10, border: "1px dashed rgba(26,23,20,0.12)", textAlign: "center" }}>
              <p style={{ fontSize: 12, color: "#B0A9A4" }}>環境URLを追加できます（本番・テスト・ステージングなど）</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {envMemos.map((memo, idx) => (
                <div key={idx} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ flex: "0 0 120px" }}>
                    <label className={labelCls}>項目名</label>
                    <input
                      className={inputCls}
                      placeholder="例: 本番環境"
                      value={memo.name}
                      onChange={e => updateMemo(idx, "name", e.target.value)}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className={labelCls}>URL</label>
                    <input
                      className={inputCls}
                      placeholder="https://example.com"
                      value={memo.url}
                      onChange={e => updateMemo(idx, "url", e.target.value)}
                    />
                  </div>
                  <button
                    onClick={() => removeMemo(idx)}
                    style={{ marginTop: 22, flexShrink: 0, width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.15)", borderRadius: 7, cursor: "pointer", color: "#DC2626", transition: "background 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEE2E2"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}>
                    <Minus style={{ width: 11, height: 11 }} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
