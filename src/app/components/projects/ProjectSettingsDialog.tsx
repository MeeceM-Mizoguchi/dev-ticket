import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Minus, Globe, Github } from "lucide-react";
import type { Project, EnvMemo, GithubRepo } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { inputCls, labelCls } from "@/app/lib/helpers";
import { submitOnModEnter } from "@/app/lib/submitKey";
import { fetchGithubStatus, fetchGithubRepos } from "@/app/lib/github";
import { invalidateGithubAccessCache } from "@/app/hooks/useGithubAccess";

const RESERVED_SLUGS = new Set(["login", "dashboard", "projects", "clients", "members", "permissions", "roles", "settings", "accept-invite"]);
const MAX_ENV_MEMOS = 10;

function sanitizeSlug(v: string) { return v.replace(/[^A-Z0-9]/g, ""); }

export function ProjectSettingsDialog({ project, onClose, onUpdated }: {
  project: Project;
  onClose: () => void;
  onUpdated?: (newSlug: string) => void;
}) {
  const { userOrgId, userPermissions } = useAuth();
  const { plan } = usePlan();
  const navigate = useNavigate();
  const orgId = project.organizationId ?? userOrgId;
  const [slug, setSlug] = useState(project.slug);
  const [slugError, setSlugError] = useState("");
  const [saving, setSaving] = useState(false);
  const [envMemos, setEnvMemos] = useState<EnvMemo[]>(
    project.envMemos?.length ? project.envMemos : []
  );

  // ── GitHubリポジトリ（docs/github-integration-design.md 8-6） ──
  // 書き込み先は「外部連携」画面の紐付け表と同じ projects.github_repo_full_name。
  // データが二重化しないので、どちらから編集しても食い違わない。
  const [ghInstalled, setGhInstalled] = useState<boolean | null>(null);
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([]);
  const [ghRepo, setGhRepo] = useState(project.githubRepoFullName ?? "");
  const [ghBranch, setGhBranch] = useState(project.githubDefaultBranch ?? "");

  useEffect(() => {
    if (!plan.featureGithub || !isSupabaseEnabled) { setGhInstalled(false); return; }
    let alive = true;
    (async () => {
      try {
        const s = await fetchGithubStatus();
        if (!alive) return;
        const ok = s.appConfigured && s.installed && !s.revoked;
        setGhInstalled(ok);
        if (ok) setGhRepos(await fetchGithubRepos());
      } catch {
        if (alive) setGhInstalled(false);
      }
    })();
    return () => { alive = false; };
  }, [plan.featureGithub]);

  const handleGhRepoChange = (v: string) => {
    setGhRepo(v);
    // リポジトリを選んだら既定ブランチを GitHub から拾って入れる
    setGhBranch(v ? (v === project.githubRepoFullName ? (project.githubDefaultBranch ?? "") : (ghRepos.find(r => r.fullName === v)?.defaultBranch ?? "")) : "");
  };

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

    const cleanedMemos = envMemos.filter(m => m.name.trim() || m.url.trim() || (m.memo ?? "").trim());

    if (isSupabaseEnabled) {
      setSaving(true);
      if (finalSlug !== project.slug) {
        let dupQ = supabase!.from("projects").select("id").eq("slug", finalSlug).neq("id", project.id);
        if (orgId) dupQ = dupQ.eq("organization_id", orgId);
        else dupQ = dupQ.is("organization_id", null);
        const { data: dup } = await dupQ.maybeSingle();
        if (dup) { setSlugError("この組織内ですでに使用されている識別子です。別の名前を使用してください。"); setSaving(false); return; }
      }
      const { data, error } = await supabase!.from("projects").update({
        slug: finalSlug,
        env_memos: cleanedMemos,
        github_repo_full_name: ghRepo || null,
        github_default_branch: ghRepo ? (ghBranch || null) : null,
        github_enabled: !!ghRepo,
      }).eq("id", project.id).select("id");
      setSaving(false);
      if (error) {
        setSlugError(error.code === "23505"
          ? "その識別子はすでに使用されています。別の名前を使用してください。"
          : "保存に失敗しました。時間をおいて再度お試しください。");
        return;
      }
      if (!data || data.length === 0) {
        setSlugError("保存できませんでした。編集権限をご確認ください。");
        return;
      }
    }
    // GitHubタブの表示可否をキャッシュしているので、保存したら捨てる
    invalidateGithubAccessCache();
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

        {/* GitHubリポジトリセクション（docs/github-integration-design.md 8-6） */}
        {plan.featureGithub && (
          <>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                <Github style={{ width: 13, height: 13, color: "#1F2328" }} />
                <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", textTransform: "uppercase", letterSpacing: "0.08em" }}>GitHubリポジトリ</p>
              </div>

              {ghInstalled === null ? (
                <p style={{ fontSize: 12, color: "#B0A9A4" }}>読み込み中...</p>
              ) : ghInstalled ? (
                <>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <label className={labelCls}>リポジトリ</label>
                      <CustomSelect
                        value={ghRepo}
                        options={[{ value: "", label: "未設定" }, ...ghRepos.map(r => ({ value: r.fullName, label: r.fullName }))]}
                        onChange={handleGhRepoChange}
                        placeholder="未設定"
                      />
                    </div>
                    <div style={{ flex: "0 0 150px" }}>
                      <label className={labelCls}>既定ブランチ</label>
                      <input
                        className={inputCls}
                        placeholder={ghRepo ? "main" : "—"}
                        value={ghBranch}
                        disabled={!ghRepo}
                        onChange={e => setGhBranch(e.target.value)}
                      />
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 6 }}>
                    選択すると、このプロジェクトに GitHub タブが表示されます（閲覧できるのは権限を付与されたメンバーだけです）。
                  </p>
                </>
              ) : (
                <div style={{ padding: "14px 16px", background: "#F9FAFB", borderRadius: 10, border: "1px dashed rgba(26,23,20,0.12)" }}>
                  <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
                    この組織はまだ GitHub に接続されていません。
                  </p>
                  {userPermissions.canAccessAdminSettings ? (
                    <button
                      onClick={() => { onClose(); navigate("/admin-settings?tab=github"); }}
                      style={{ marginTop: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: "#1F2328", cursor: "pointer" }}>
                      外部連携をひらく →
                    </button>
                  ) : (
                    <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                      管理者に GitHub 連携の設定を依頼してください。
                    </p>
                  )}
                </div>
              )}
            </div>

            <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)" }} />
          </>
        )}

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
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {envMemos.map((memo, idx) => (
                <div key={idx} style={{ background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "10px 10px 8px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
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
                  <div style={{ marginTop: 6 }}>
                    <label className={labelCls}>メモ（ログイン情報・注意点など）</label>
                    <textarea
                      className={inputCls}
                      placeholder="例: admin / password123&#10;本番DBに直接接続しているので注意"
                      value={memo.memo ?? ""}
                      onChange={e => updateMemo(idx, "memo", e.target.value)}
                      onKeyDown={submitOnModEnter(() => { if (!saving) void handleSave(); })}
                      rows={2}
                      style={{ resize: "vertical", minHeight: 48, fontFamily: "inherit" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
