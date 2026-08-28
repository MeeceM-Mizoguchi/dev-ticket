import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus, Minus, Globe, Github } from "lucide-react";
import type {
  Project, EnvMemo, GithubRepo, GithubDeployCheckMode, GithubRequireChecksMode,
} from "@/app/types";
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
import {
  fetchGithubStatus, fetchGithubRepos, backfillGithubLinks,
  DEPLOY_MODE_LABELS, REQUIRE_CHECKS_LABELS,
} from "@/app/lib/github";
import { invalidateGithubAccessCache } from "@/app/hooks/useGithubAccess";
import { findSlugConflict, SLUG_CONFLICT_MESSAGE } from "@/app/lib/projectResolve";

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

  // ── 本番反映の確認（docs/deploy-verification-design.md） ──
  // 「マージした」と「本番に届いた」を別の事実として扱うための設定。
  // ここが未設定だと、デプロイが止まっていても全件「リリース済み」になる。
  const [deployUrl, setDeployUrl] = useState(project.deployCheckUrl ?? "");
  const [deployKey, setDeployKey] = useState(project.deployCheckKey ?? "");
  const [deployCheckMode, setDeployCheckMode] = useState<GithubDeployCheckMode>(project.deployCheckMode ?? "off");
  const [requireChecks, setRequireChecks] = useState<GithubRequireChecksMode>(project.requireChecksMode ?? "warn");
  const [deployError, setDeployError] = useState("");

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

    // 確認先URLが無いのに「反映まで待つ」を選ぶと、チケットが永久にリリース待ちで止まる。
    // 保存させてから気づくのでは遅いので、ここで弾く
    const trimmedDeployUrl = deployUrl.trim();
    if (!trimmedDeployUrl && deployCheckMode !== "off") {
      setDeployError("本番反映の確認先URLを入力してください（未入力なら「確認しない」を選んでください）。");
      return;
    }
    if (trimmedDeployUrl && !/^https?:\/\//i.test(trimmedDeployUrl)) {
      setDeployError("確認先URLは http:// または https:// から入力してください。");
      return;
    }
    setDeployError("");

    const cleanedMemos = envMemos.filter(m => m.name.trim() || m.url.trim() || (m.memo ?? "").trim());

    if (isSupabaseEnabled) {
      setSaving(true);
      if (finalSlug !== project.slug) {
        const conflict = await findSlugConflict(finalSlug, orgId, project.id);
        if (conflict) { setSlugError(SLUG_CONFLICT_MESSAGE[conflict]); setSaving(false); return; }
      }
      const { data, error } = await supabase!.from("projects").update({
        slug: finalSlug,
        env_memos: cleanedMemos,
        github_repo_full_name: ghRepo || null,
        github_default_branch: ghRepo ? (ghBranch || null) : null,
        github_enabled: !!ghRepo,
        deploy_check_url: trimmedDeployUrl || null,
        deploy_check_key: trimmedDeployUrl ? (deployKey.trim() || "buildId") : null,
        deploy_check_mode: trimmedDeployUrl ? deployCheckMode : "off",
        require_checks_mode: requireChecks,
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
      // 旧識別子は projects の UPDATE トリガーが project_slug_aliases に残す（lib/projectResolve.ts 参照）
      // 紐付けたリポジトリの過去PRを1回だけ遡って埋める。
      // 同じリポジトリで2回目以降はサーバー側が何もせずに返す
      if (ghRepo) {
        setSaving(true);
        try { await backfillGithubLinks(project.id); } catch { /* 穴埋めに失敗しても保存自体は済んでいる */ }
        setSaving(false);
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

                  {/* 本番反映の確認（docs/deploy-verification-design.md）。
                      リポジトリを紐付けているプロジェクトでだけ意味を持つのでここに置く */}
                  {ghRepo && (
                    <div style={{ marginTop: 14, paddingTop: 13, borderTop: "1px solid rgba(26,23,20,0.07)" }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", marginBottom: 4 }}>本番反映の確認</p>
                      <p style={{ fontSize: 11, color: "#9CA3AF", lineHeight: 1.75, marginBottom: 10 }}>
                        本番が公開しているバージョン情報を読み、いま動いているコミットと {ghBranch || "main"} を突き合わせます。
                        マージは成功しているのにデプロイが止まっている状態を、そのまま「リリース済み」にしないための設定です。
                      </p>

                      <label className={labelCls}>確認先URL</label>
                      <input
                        className={inputCls}
                        placeholder="https://example.com/version.json"
                        value={deployUrl}
                        onChange={e => { setDeployUrl(e.target.value); setDeployError(""); }}
                      />
                      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3, lineHeight: 1.7 }}>
                        JSON を返すURLを指定してください。社内・ローカル向けのアドレスは指定できません。
                      </p>

                      <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8 }}>
                        <div style={{ flex: "0 0 180px" }}>
                          <label className={labelCls}>コミットのキー名</label>
                          <input
                            className={inputCls}
                            placeholder="buildId"
                            value={deployKey}
                            disabled={!deployUrl.trim()}
                            onChange={e => setDeployKey(e.target.value)}
                          />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <label className={labelCls}>反映を確認できないとき</label>
                          <CustomSelect
                            value={deployCheckMode}
                            options={(Object.keys(DEPLOY_MODE_LABELS) as GithubDeployCheckMode[])
                              .map(v => ({ value: v, label: DEPLOY_MODE_LABELS[v] }))}
                            onChange={v => { setDeployCheckMode(v as GithubDeployCheckMode); setDeployError(""); }}
                          />
                        </div>
                      </div>
                      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3, lineHeight: 1.7 }}>
                        値がコミットSHA（先頭7桁以上）であれば比較できます。
                        {deployCheckMode === "gate" && (
                          <><br />
                            <span style={{ color: "#B45309" }}>
                              「リリース済みにしない」を選ぶと、本番への反映を確認できない間はチケットが「リリース待ち」のまま残ります。
                            </span>
                          </>
                        )}
                      </p>

                      <div style={{ marginTop: 10 }}>
                        <label className={labelCls}>マージ前に失敗しているチェックがあるとき</label>
                        <CustomSelect
                          value={requireChecks}
                          options={(Object.keys(REQUIRE_CHECKS_LABELS) as GithubRequireChecksMode[])
                            .map(v => ({ value: v, label: REQUIRE_CHECKS_LABELS[v] }))}
                          onChange={v => setRequireChecks(v as GithubRequireChecksMode)}
                        />
                        <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 3, lineHeight: 1.7 }}>
                          GitHub のブランチ保護が未設定でも、Dev Ticket 側で同じ関門を作ります。
                          「理由を入力しないとマージできない」を選ぶと、押し切った理由が監査ログに残ります。
                        </p>
                      </div>

                      {deployError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 6 }}>{deployError}</p>}
                    </div>
                  )}
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
