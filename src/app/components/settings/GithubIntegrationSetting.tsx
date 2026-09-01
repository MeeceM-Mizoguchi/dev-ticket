// GitHub連携の接続設定（docs/github-integration-design.md 8-1）。
//
// 設計方針: GitHub のインストールは Dev Ticket の外へ出る操作なので、
// 離れる前に「何が起きるか」を必ず出す。そして今どこまで終わっているかを常に見せる。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ExternalLink, RefreshCw, Search } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { copyText } from "@/lib/clipboard";
import { useToast } from "@/app/contexts/ToastContext";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { PageLoader } from "@/app/components/shared/PageLoader";
import {
  fetchGithubStatus, fetchGithubRepos, startGithubInstall, adoptGithubInstallation, syncReleasedTickets,
  backfillGithubLinks, fetchDeployOverview, runDeployCheck, elapsedSince, relativeTime, GithubApiError,
} from "@/app/lib/github";
import { GithubSetupSteps, GithubSetupDone, type SetupStepState } from "@/app/components/github/GithubSetupSteps";
import { invalidateGithubAccessCache } from "@/app/hooks/useGithubAccess";
import { githubPermsFrom, toLegacyGithubLevel } from "@/app/lib/githubPerms";
import type {
  GithubStatus, GithubRepo, GithubAccessLevel, GithubReleaseSyncResult, GithubDeployOverview,
  GithubDeployOverviewRow,
} from "@/app/types";

const GITHUB_BLACK = "#1F2328";

const GITHUB_MARK = (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  </svg>
);

interface ProjectRow {
  id: string;
  name: string;
  repo: string;          // "" = 未設定
  branch: string;
  enabled: boolean;
  /** 保存前の値。差分だけ更新するために持つ */
  savedRepo: string;
  savedBranch: string;
}

interface Props {
  isAdmin: boolean;
  orgId?: string | null;
  /** インストールから戻ってきた直後か（?github=success） */
  justConnected?: boolean;
}

export function GithubIntegrationSetting({ isAdmin, orgId, justConnected }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [status, setStatus] = useState<GithubStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [rows, setRows] = useState<ProjectRow[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<GithubReleaseSyncResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [grantCounts, setGrantCounts] = useState<{ merge: number; view: number; none: number } | null>(null);
  /**
   * 本番反映の診断（docs/deploy-verification-design.md 層D）。
   * 「main が未保護」「反映確認が未設定」「本番が遅れている」を1画面で見せる。
   */
  const [overview, setOverview] = useState<GithubDeployOverview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);

  const linkRef = useRef<HTMLDivElement>(null);
  const permRef = useRef<HTMLDivElement>(null);
  const connectRef = useRef<HTMLDivElement>(null);
  const deployRef = useRef<HTMLDivElement>(null);

  // ── 読み込み ──────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchGithubStatus(orgId);
      setStatus(s);
      setError("");
      return s;
    } catch (e) {
      setError(e instanceof GithubApiError ? e.message : "接続状態を取得できませんでした");
      return null;
    }
  }, [orgId]);

  const loadRepos = useCallback(async () => {
    try {
      setRepos(await fetchGithubRepos(orgId));
    } catch {
      setRepos([]);
    }
  }, [orgId]);

  const loadProjects = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    let q = supabase!
      .from("projects")
      .select("id, name, github_repo_full_name, github_default_branch, github_enabled")
      .order("name");
    if (orgId) q = q.eq("organization_id", orgId);
    const { data } = await q;
    setRows((data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      repo: p.github_repo_full_name ?? "",
      branch: p.github_default_branch ?? "",
      enabled: p.github_enabled ?? false,
      savedRepo: p.github_repo_full_name ?? "",
      savedBranch: p.github_default_branch ?? "",
    })));
  }, [orgId]);

  /**
   * ③の付与状況。個別設定 → グループ → ロール既定 の順で解決する
   * （サーバー側 resolveGithubPerms と同じ優先順位）。
   *
   * 操作ごとの権限（BRU13-054）は、ここでは1段階に畳んで数える。
   * この欄は「何人に配られているか」の概観で、内訳はアサイン計画の画面で見るため。
   */
  const loadGrantCounts = useCallback(async () => {
    if (!isSupabaseEnabled) return;
    let mq = supabase!.from("profiles").select("id, role").eq("status", "active");
    if (orgId) mq = mq.eq("organization_id", orgId);
    const { data: profiles } = await mq;
    if (!profiles) return;

    const levels = new Map<string, GithubAccessLevel>();
    const stronger = (a: GithubAccessLevel, b: GithubAccessLevel) =>
      (a === "merge" || b === "merge") ? "merge" : (a === "view" || b === "view") ? "view" : "none";

    // ロール既定（roles.base_permissions）
    const { data: roles } = await supabase!.from("roles").select("name, base_permissions");
    const roleLevel = new Map<string, GithubAccessLevel>();
    for (const r of roles ?? []) {
      const p = githubPermsFrom((r as any).base_permissions);
      if (p) roleLevel.set((r as any).name, toLegacyGithubLevel(p));
    }
    for (const p of profiles as any[]) {
      const role = p.role as string;
      // admin / PM でも既定は none。付与はアサイン計画でのみ行う（BRU13-034）
      const base: GithubAccessLevel = role === "owner" ? "merge" : roleLevel.get(role) ?? "none";
      levels.set(p.id, base);
    }

    // グループ
    let gq = supabase!.from("permission_groups").select("id, permissions");
    if (orgId) gq = gq.or(`organization_id.eq.${orgId},organization_id.is.null`);
    const { data: groups } = await gq;
    const groupLevel = new Map<number, GithubAccessLevel>();
    for (const g of groups ?? []) {
      const p = githubPermsFrom((g as any).permissions);
      const lv = p ? toLegacyGithubLevel(p) : undefined;
      if (lv && lv !== "none") groupLevel.set((g as any).id, lv);
    }
    if (groupLevel.size) {
      const { data: gm } = await supabase!
        .from("group_members").select("group_id, member_id").in("group_id", Array.from(groupLevel.keys()));
      for (const m of gm ?? []) {
        const id = (m as any).member_id as string;
        if (!levels.has(id)) continue;
        levels.set(id, stronger(levels.get(id)!, groupLevel.get((m as any).group_id)!));
      }
    }

    // 個別（プロジェクト単位。1つでも付いていれば「付与済み」として数える）
    const projectIds = rows.map(r => r.id);
    if (projectIds.length) {
      const { data: pmp } = await supabase!
        .from("project_member_permissions").select("member_id, permissions").in("project_id", projectIds);
      for (const row of pmp ?? []) {
        const id = (row as any).member_id as string;
        const p = githubPermsFrom((row as any).permissions);
        const lv = p ? toLegacyGithubLevel(p) : undefined;
        if (!lv || !levels.has(id)) continue;
        levels.set(id, stronger(levels.get(id)!, lv));
      }
    }

    let merge = 0, view = 0, none = 0;
    for (const lv of levels.values()) {
      if (lv === "merge") merge++;
      else if (lv === "view") view++;
      else none++;
    }
    setGrantCounts({ merge, view, none });
  }, [orgId, rows]);

  /**
   * 診断は GitHub をリポジトリ件数ぶん叩くので、接続済みのときだけ・別に読む。
   * 取れなくても他の設定は使えるため、失敗しても画面は止めない。
   */
  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      setOverview(await fetchDeployOverview(orgId));
    } catch {
      setOverview(null);
    } finally {
      setOverviewLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    let alive = true;
    (async () => {
      setLoading(true);
      const s = await loadStatus();
      if (!alive) return;
      await loadProjects();
      if (s?.installed && !s.revoked) await loadRepos();
      if (alive) setLoading(false);
      if (alive && s?.installed && !s.revoked) void loadOverview();
    })();
    return () => { alive = false; };
  }, [isAdmin, loadStatus, loadProjects, loadRepos, loadOverview]);

  useEffect(() => { void loadGrantCounts(); }, [loadGrantCounts]);

  // 接続直後は「次にリポジトリを紐付けてください」へ誘導する
  useEffect(() => {
    if (!justConnected || loading || !status?.installed) return;
    const t = setTimeout(() => linkRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    return () => clearTimeout(t);
  }, [justConnected, loading, status?.installed]);

  // ── 派生 ──────────────────────────────────────────────────
  const linkedCount = rows.filter(r => r.savedRepo).length;
  const grantedCount = (grantCounts?.merge ?? 0) + (grantCounts?.view ?? 0);
  const steps: SetupStepState = {
    installed: !!status?.installed && !status.revoked,
    linked: linkedCount > 0,
    granted: grantedCount > 0,
  };
  const allDone = steps.installed && steps.linked && steps.granted;
  const dirty = rows.some(r => r.repo !== r.savedRepo || r.branch !== r.savedBranch);

  const repoOptions = useMemo(() => [
    { value: "", label: "未設定" },
    ...repos.map(r => ({ value: r.fullName, label: r.fullName })),
  ], [repos]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => r.name.toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  /** 同じリポジトリを複数プロジェクトで使ってよい。エラーにせず件数だけ出す */
  const repoUsage = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.repo) m.set(r.repo, (m.get(r.repo) ?? 0) + 1);
    return m;
  }, [rows]);

  // ── 操作 ──────────────────────────────────────────────────
  const handleConnect = async () => {
    setConnecting(true);
    try {
      await startGithubInstall(orgId);
    } catch (e) {
      setConnecting(false);
      toast(e instanceof GithubApiError ? e.message : "接続を開始できませんでした", "error");
    }
  };

  const handleAdopt = async (installationId: string) => {
    setAdopting(true);
    try {
      const r = await adoptGithubInstallation(installationId, orgId);
      toast(`${r.accountLogin} の接続を取り込みました`, "success");
      invalidateGithubAccessCache();
      const s = await loadStatus();
      if (s?.installed && !s.revoked) await loadRepos();
      setTimeout(() => linkRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "取り込みに失敗しました", "error");
    } finally {
      setAdopting(false);
    }
  };

  const handleRepoChange = (id: string, repo: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      // リポジトリを選んだら既定ブランチを GitHub から拾って入れる
      const def = repos.find(x => x.fullName === repo)?.defaultBranch ?? "";
      return { ...r, repo, branch: repo ? (r.repo === repo ? r.branch : def) : "" };
    }));
  };

  const handleSave = async () => {
    if (!isSupabaseEnabled) return;
    setSaving(true);
    const changed = rows.filter(r => r.repo !== r.savedRepo || r.branch !== r.savedBranch);
    let failed = 0;
    const linked: string[] = [];
    for (const r of changed) {
      const { error: e } = await supabase!.from("projects").update({
        github_repo_full_name: r.repo || null,
        github_default_branch: r.repo ? (r.branch || null) : null,
        github_enabled: !!r.repo,
      }).eq("id", r.id);
      if (e) failed++;
      else if (r.repo) linked.push(r.id);
    }

    // 紐付けたリポジトリの過去PRを1回だけ遡って埋める。
    // リポジトリを紐付ける前にマージ・クローズされたPRは、Webhook でもPR一覧でも拾えないため。
    // 同じリポジトリで2回目以降はサーバー側が何もせずに返す
    let backfilled = 0;
    for (const id of linked) {
      try {
        const b = await backfillGithubLinks(id);
        if (!b.skipped) backfilled += b.scanned;
      } catch {
        // 穴埋めに失敗しても紐付けの保存自体は済んでいる。以後は Webhook で追従できる
      }
    }

    setSaving(false);
    if (failed) { toast("一部のプロジェクトを保存できませんでした", "error"); }
    else if (backfilled) { toast(`過去のプルリクエスト ${backfilled}件を確認して紐付けました`, "success"); }
    setRows(prev => prev.map(r => ({ ...r, savedRepo: r.repo, savedBranch: r.branch, enabled: !!r.repo })));
    // GitHubタブの表示可否はキャッシュしているので、紐付けを変えたら捨てる
    invalidateGithubAccessCache();

    const first = changed.find(r => r.repo);
    if (first && !failed) {
      toast(`${first.name} に ${first.repo} を紐付けました`, "success");
    } else if (!failed) {
      toast("紐付けを保存しました", "success");
    }
  };

  const handleDisconnect = async () => {
    if (!isSupabaseEnabled || !orgId) return;
    setDisconnecting(true);
    // Dev Ticket 側の接続情報だけを消す。GitHub 上の App インストールは残る
    await supabase!.from("github_installations").delete().eq("organization_id", orgId);
    await supabase!.from("projects").update({ github_enabled: false }).eq("organization_id", orgId);
    setDisconnecting(false);
    setRows(prev => prev.map(r => ({ ...r, enabled: false })));
    invalidateGithubAccessCache();
    await loadStatus();
    toast("GitHubとの接続を解除しました", "success");
  };

  // 定期実行と同じ処理を、この組織だけを対象に手動で走らせる
  const handleSyncReleased = async () => {
    setSyncing(true);
    try {
      const r = await syncReleasedTickets(orgId);
      setSyncResult(r);
      toast(r.released > 0 ? `${r.released}件をリリース済みにしました` : "対象のチケットはありませんでした", "success");
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "リリース反映に失敗しました", "error");
    } finally {
      setSyncing(false);
    }
  };

  /** 1プロジェクトだけ本番反映を確認し直す */
  const handleRecheckDeploy = async (row: GithubDeployOverviewRow) => {
    setRecheckingId(row.projectId);
    try {
      const r = await runDeployCheck(row.projectId);
      setOverview(prev => prev && ({
        ...prev,
        rows: prev.rows.map(x => (x.projectId === row.projectId ? { ...x, deploy: r.deploy } : x)),
      }));
      toast(
        r.deploy.state === "in-sync" ? `${row.projectName}: 本番は最新です`
          : r.deploy.state === "behind" ? `${row.projectName}: ${r.deploy.behindBy}コミット未反映です`
            : `${row.projectName}: ${r.deploy.message ?? "確認できませんでした"}`,
        r.deploy.state === "in-sync" ? "success" : "error",
      );
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "確認に失敗しました", "error");
    } finally {
      setRecheckingId(null);
    }
  };

  const handleCopyUrl = async () => {
    if (await copyText(window.location.href)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // GitHub App 側に登録する Webhook の宛先。設定しておくとマージした瞬間に反映される
  const webhookUrl = `${window.location.origin}/api/github/webhook`;
  const handleCopyWebhookUrl = async () => {
    if (await copyText(webhookUrl)) {
      setWebhookCopied(true);
      setTimeout(() => setWebhookCopied(false), 2000);
    }
  };

  const jumpTo = (key: keyof SetupStepState) => {
    setTimeout(() => {
      const el = key === "installed" ? connectRef.current : key === "linked" ? linkRef.current : permRef.current;
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  // ── 表示 ──────────────────────────────────────────────────
  if (!isAdmin) return <p style={{ fontSize: 12, color: "#A09790" }}>管理者またはプロジェクトマネージャーのみ変更できます。</p>;
  if (!isSupabaseEnabled) return <p style={{ fontSize: 12, color: "#A09790" }}>Supabase未接続のため利用できません。</p>;
  if (loading) return <PageLoader label="GitHub連携の状態を確認中..." />;

  // 8-1-A: サーバー側の設定がまだ
  if (status && !status.appConfigured) {
    return (
      <Notice tone="warn" title="GitHub連携がまだ有効化されていません">
        サーバー側の設定（GitHub App）が未登録のため、この機能は利用できません。システム管理者にお問い合わせください。
        <br />
        <span style={{ fontSize: 11, color: "#9CA3AF" }}>
          管理者向け: docs/github-integration-design.md の「12. GitHub App の作成と環境変数」を参照してください
        </span>
      </Notice>
    );
  }


  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 0 }}>
      {/* 完了しても設定は畳まない。設定画面なのに中身が消えると迷わせるため。 */}
      {allDone
        ? <GithubSetupDone linkedCount={linkedCount} grantedCount={grantedCount} />
        : <GithubSetupSteps state={steps} onJump={jumpTo} />}

      {error && <Notice tone="warn" title="接続状態を取得できませんでした">{error}</Notice>}

      {/* 接続ボタンを押す前に、App の資格情報が通るかをここで知らせる。
          通らないまま GitHub へ進むと、戻ってきてから失敗して原因が分からなくなる。 */}
      {status?.appConfigured && !status.appAuthOk && (
        <Notice tone="warn" title="GitHub App の資格情報が GitHub に通りませんでした">
          このまま接続しても失敗します。Vercel の環境変数をご確認ください。
          {status.appAuthError && (
            <>
              <br />
              <span style={{ fontSize: 11, color: "#B45309" }}>応答: {status.appAuthError}</span>
            </>
          )}
          {status.appKeyShape && (
            <>
              <br />
              <span style={{ fontSize: 11, color: "#B45309", fontFamily: "var(--font-mono)" }}>
                鍵の状態: {status.appKeyShape}
              </span>
            </>
          )}
          {/* 改行が潰れて鍵が読めないケースが多いので、確実な入れ方を画面に出しておく */}
          {status.appAuthError?.includes("秘密鍵") && (
            <>
              <br />
              <span style={{ fontSize: 11, color: "#92400E" }}>
                改行が失われている可能性があります。PEM をそのまま貼る代わりに、base64 にした1行の文字列を{" "}
                <code>GITHUB_APP_PRIVATE_KEY_BASE64</code> に登録する方法でも動きます（PowerShell:{" "}
                <code>[Convert]::ToBase64String([IO.File]::ReadAllBytes("鍵のパス.pem"))</code>）。
              </span>
            </>
          )}
        </Notice>
      )}

      {status?.appSlugMismatch && (
        <Notice tone="warn" title="GITHUB_APP_SLUG が実際の App と一致していません">
          {status.appSlugMismatch}。このままでは接続ボタンから正しい App のインストール画面へ遷移しません。
        </Notice>
      )}

      {/* 権限が足りないと、閲覧はできるのにマージだけが必ず失敗する。
          実行して初めて分かる状態にしないよう、ここで先に出す。

          直しに行く画面は原因で変わる。
            ・permissionScope="app"     … App の設定そのもの。承認しても直らない
            ・permissionScope="install" … 宣言は足りていて、承認がまだ
          以前は常に「承認してください」と案内していたため、App 側が原因のときは
          案内どおりに操作しても直らず、同じ失敗を繰り返していた。 */}
      {(status?.missingPermissions?.length ?? 0) > 0 && (
        <Notice tone="warn" title={status!.permissionScope === "app"
          ? "GitHub App の設定に権限がありません（承認では直りません）"
          : "GitHub App の権限更新が承認されていません"}>
          次の権限が足りないため、その操作は実行しても必ず失敗します。
          <br />
          {status!.missingPermissions.map(p => (
            <span key={p.key} style={{ display: "block", marginTop: 4, fontSize: 11 }}>
              ・<strong>{p.label}</strong>：{p.current} → <strong>{p.need}</strong> が必要（{p.why}）
            </span>
          ))}
          <br />
          {status!.permissionScope === "app" ? (
            <>
              App の所有者が GitHub の <strong>App 設定（Permissions）</strong>で権限を追加し、
              そのうえでインストール画面の更新を承認してください。
              インストール画面での承認だけでは直りません。
              {status!.appPermissionsUrl && (
                <>
                  {" "}
                  <a href={status!.appPermissionsUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: "#92400E", fontWeight: 700, textDecoration: "underline" }}>
                    App の権限設定をひらく
                  </a>
                </>
              )}
            </>
          ) : (
            <>
              GitHub の<strong>インストール画面で権限の更新を承認</strong>してください。
              {status!.manageUrl && (
                <>
                  {" "}
                  <a href={status!.manageUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: "#92400E", fontWeight: 700, textDecoration: "underline" }}>
                    インストール設定をひらく
                  </a>
                </>
              )}
            </>
          )}
        </Notice>
      )}

      {/* 無くても動くが、無いとデプロイの事故を取りこぼす権限。
          必須権限と同じ強さで出すと「操作が失敗する」と誤読されるので、青い案内にする。
          Vercel の「Deployment was blocked」は Checks ではなく commit status 側に出ることがあり、
          この権限が無いと失敗ですらなく「チェックなし」に見える */}
      {(status?.optionalMissingPermissions?.length ?? 0) > 0 && (
        <Notice tone="info" title="デプロイの失敗を検知するための権限が不足しています">
          この権限が無くても、閲覧・マージ・リリース反映はこれまでどおり動きます。
          ただし <strong>デプロイが止まっている（blocked）ことを検知できません</strong>。
          <br />
          {status!.optionalMissingPermissions!.map(p => (
            <span key={p.key} style={{ display: "block", marginTop: 4, fontSize: 11 }}>
              ・<strong>{p.label}</strong>：{p.current} → <strong>{p.need}</strong> があると検知できます（{p.why}）
            </span>
          ))}
          <br />
          App の所有者が権限を追加し、インストール画面で更新を承認してください。
          {status!.appPermissionsUrl && (
            <>
              {" "}
              <a href={status!.appPermissionsUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#075985", fontWeight: 700, textDecoration: "underline" }}>
                App の権限設定をひらく
              </a>
            </>
          )}
        </Notice>
      )}

      {!steps.installed ? (
        <div ref={connectRef}>
          {/* GitHub側にはインストール済みなのに、こちらに記録が無い状態からの復旧 */}
          {!status?.installed && (status?.unclaimedInstallations?.length ?? 0) > 0 && (
            <div style={{ background: "#F0F9FF", border: "1px solid rgba(2,132,199,0.28)", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#075985", marginBottom: 5 }}>
                GitHub 側にインストール済みの接続が見つかりました
              </p>
              <p style={{ fontSize: 12, color: "#075985", lineHeight: 1.7, marginBottom: 12 }}>
                インストールは完了していますが、Dev Ticket 側に接続情報が記録されていません。
                下の接続を取り込むと、インストールをやり直さずに続きから進められます。
              </p>
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
                {status!.unclaimedInstallations.map(inst => (
                  <div key={inst.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 9, padding: "10px 14px" }}>
                    <div>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{inst.accountLogin}</p>
                      <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>
                        {inst.accountType === "Organization" ? "Organization" : "アカウント"}
                        {inst.repoSelection === "all" ? " ・ 全リポジトリ" : " ・ 選択したリポジトリのみ"}
                      </p>
                    </div>
                    <button onClick={() => handleAdopt(inst.id)} disabled={adopting}
                      style={{ padding: "8px 18px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: adopting ? "#9CA3AF" : GITHUB_BLACK, color: "#FFF", cursor: adopting ? "default" : "pointer", whiteSpace: "nowrap" as const }}>
                      {adopting ? "取り込み中..." : "この接続を取り込む"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {status?.installed && status.revoked
            ? <RevokedCard onReconnect={handleConnect} connecting={connecting} />
            : <ConnectCard
                visibility={status?.visibility ?? "public"}
                connecting={connecting}
                copied={copied}
                onConnect={handleConnect}
                onCopyUrl={handleCopyUrl}
              />}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 16 }}>

          {/* ① 接続状態 */}
          <section ref={connectRef} style={cardStyle}>
            <SectionTitle no="①" title="接続状態" />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, padding: "11px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                </div>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>接続済み</span>
                  <span style={{ fontSize: 13, color: "#166534", marginLeft: 8, fontWeight: 700 }}>{status?.accountLogin}</span>
                  <span style={{ fontSize: 11, color: "#166534", marginLeft: 6 }}>（{status?.accountType === "Organization" ? "Organization" : "アカウント"}）</span>
                  <p style={{ fontSize: 11, color: "#166534", marginTop: 2 }}>
                    許可リポジトリ {status?.repoCount ?? repos.length}件
                    {status?.connectedAt && ` ・ ${new Date(status.connectedAt).toLocaleDateString("ja-JP")} に ${status.connectedByName ?? "―"} が接続`}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {status?.manageUrl && (
                  <a href={status.manageUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: GITHUB_BLACK, textDecoration: "none", whiteSpace: "nowrap" as const }}>
                    リポジトリを追加・変更 <ExternalLink style={{ width: 11, height: 11 }} />
                  </a>
                )}
                <button onClick={handleDisconnect} disabled={disconnecting}
                  style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: disconnecting ? "default" : "pointer", opacity: disconnecting ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
                  {disconnecting ? "解除中..." : "切断する"}
                </button>
              </div>
            </div>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 10, lineHeight: 1.7 }}>
              「リポジトリを追加・変更」を押すと GitHub の設定画面に移動します。新しいリポジトリを Dev Ticket から見えるようにする場合はこちらです。
              <br />
              GitHub側で変更したあとは
              <button onClick={() => { void loadRepos(); void loadStatus(); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, margin: "0 4px", padding: "1px 8px", fontSize: 11, fontWeight: 600, borderRadius: 6, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: "#4B4540", cursor: "pointer" }}>
                <RefreshCw style={{ width: 10, height: 10 }} />一覧を再取得
              </button>
              を押してください。
              <br />
              切断しても GitHub 上の App インストールは残ります（Dev Ticket 側の接続情報だけを消します）。
            </p>
          </section>

          {/* ② リポジトリの紐付け */}
          <section ref={linkRef} style={cardStyle}>
            <SectionTitle no="②" title="プロジェクトとリポジトリの紐付け" />
            <p style={{ fontSize: 12, color: "#6B6458", marginBottom: 12 }}>
              どのプロジェクトでどのリポジトリを表示するかを設定します。
            </p>

            {rows.length > 6 && (
              <div style={{ position: "relative", marginBottom: 10 }}>
                <Search style={{ width: 13, height: 13, color: "#B0A9A4", position: "absolute", left: 10, top: 9 }} />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="プロジェクトを検索"
                  style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 10px 7px 30px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#F9F8F6", outline: "none" }} />
              </div>
            )}

            {rows.length === 0 ? (
              <p style={{ fontSize: 12, color: "#B0A9A4", padding: "16px 0", textAlign: "center" as const }}>プロジェクトがありません。</p>
            ) : (
              <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "visible" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 260px 150px 46px", gap: 10, padding: "8px 12px", background: "#F9F8F6", borderBottom: "1px solid rgba(26,23,20,0.07)", fontSize: 10, fontWeight: 700, color: "#8A837B", letterSpacing: "0.06em" }}>
                  <span>プロジェクト</span><span>リポジトリ</span><span>既定ブランチ</span><span style={{ textAlign: "center" as const }}>状態</span>
                </div>
                {filteredRows.map((r, i) => {
                  const dup = r.repo ? (repoUsage.get(r.repo) ?? 0) - 1 : 0;
                  return (
                    <div key={r.id} style={{ display: "grid", gridTemplateColumns: "1fr 260px 150px 46px", gap: 10, padding: "9px 12px", alignItems: "center", borderBottom: i < filteredRows.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
                      <div style={{ minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{r.name}</p>
                        {dup > 0 && <p style={{ fontSize: 10, color: "#A09790", marginTop: 1 }}>他{dup}プロジェクトでも使用中</p>}
                      </div>
                      <CustomSelect value={r.repo} options={repoOptions} onChange={v => handleRepoChange(r.id, v)} placeholder="未設定" />
                      <input value={r.branch} onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, branch: e.target.value } : x))}
                        disabled={!r.repo} placeholder={r.repo ? "main" : "—"}
                        style={{ width: "100%", boxSizing: "border-box" as const, padding: "7px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: r.repo ? "#F9F8F6" : "#F4F5F6", color: r.repo ? "#1A1714" : "#C9C4BB", outline: "none" }} />
                      <span style={{ textAlign: "center" as const, fontSize: 13, color: r.savedRepo ? "#059669" : "#C9C4BB" }}>
                        {r.savedRepo ? "✔" : "○"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={handleSave} disabled={saving || !dirty}
                style={{ padding: "9px 22px", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: (saving || !dirty) ? "default" : "pointer", background: (saving || !dirty) ? "#E5E7EB" : "linear-gradient(135deg,#059669,#047857)", color: (saving || !dirty) ? "#9CA3AF" : "#fff", letterSpacing: "-0.01em" }}>
                {saving ? "保存中..." : "保存する"}
              </button>
            </div>

            <p style={{ fontSize: 11, color: "#A09790", marginTop: 10, lineHeight: 1.7, borderTop: "1px solid rgba(26,23,20,0.06)", paddingTop: 10 }}>
              プルダウンには、GitHub で許可したリポジトリだけが表示されます。
              目的のリポジトリが無い場合は、上の「リポジトリを追加・変更」から GitHub 側で許可を追加してください。
              <br />
              紐付けを「未設定」に戻すと GitHub タブは消えますが、チケットとPRの紐付けデータは保持されます。
            </p>
          </section>

          {/* ③ メンバーの権限 */}
          <section ref={permRef} style={cardStyle}>
            <SectionTitle no="③" title="メンバーの権限" />
            <div style={{ display: "flex", gap: 8, padding: "10px 13px", background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.22)", borderRadius: 10, marginBottom: 12 }}>
              <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 12, color: "#92400E", lineHeight: 1.7 }}>
                初期状態では、すべてのメンバーが「権限なし」です。
                権限を付けるまで、GitHub タブは本人の画面に表示されません。
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, color: "#8A837B", letterSpacing: "0.06em", marginBottom: 4 }}>現在の付与状況</p>
                <p style={{ fontSize: 13, color: "#1A1714" }}>
                  {grantCounts
                    ? <>マージ可 <strong>{grantCounts.merge}名</strong> ・ 閲覧のみ <strong>{grantCounts.view}名</strong> ・ 権限なし <strong>{grantCounts.none}名</strong></>
                    : "集計中..."}
                </p>
              </div>
              <button onClick={() => navigate("/permissions")}
                style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: "#1A1714", cursor: "pointer", whiteSpace: "nowrap" as const }}>
                アサイン計画をひらく →
              </button>
            </div>

            <p style={{ fontSize: 11, color: "#A09790", marginTop: 10, lineHeight: 1.7 }}>
              GitHub の閲覧・マージ権限は「アサイン計画」でメンバーまたはグループ単位に設定します。
            </p>
          </section>

          {/* ④ リリースノートへの自動反映 */}
          <section style={cardStyle}>
            <SectionTitle no="④" title="リリースノートへの自動反映" />
            <p style={{ fontSize: 12, color: "#6B6458", marginBottom: 12, lineHeight: 1.8 }}>
              チケットのプルリクエストが既定ブランチへマージされると、
              <strong>「リリース待ち」のチケットを自動で「リリース済み」に</strong>します。
              下のWebhookを設定していればマージした瞬間に、していなくても
              マージ直後・GitHubタブを開いたとき・定期実行のいずれかで反映されます。
              <br />
              判定に使うのは GitHub 上のPRの状態だけなので、そのプロジェクトのデプロイ先には依存しません。
              <br />
              あわせて、<strong>チケットとPRの紐付け（チケット詳細の「関連PR」）も自動で埋めます</strong>。
              こちらはステータスを問わないので、クローズ済み・リリース済みのチケットにも過去のPRが並びます。
            </p>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const }}>
              <div style={{ minWidth: 0 }}>
                {syncResult
                  ? <p style={{ fontSize: 13, color: syncResult.released > 0 ? "#15803D" : "#6B6458" }}>
                      {syncResult.released > 0
                        ? `${syncResult.released}件をリリース済みにしました`
                        : "リリース済みにできるチケットはありませんでした"}
                    </p>
                  : <p style={{ fontSize: 12, color: "#A09790" }}>すぐに反映したいときは、右のボタンで実行できます。</p>}
                {syncResult && syncResult.released > 0 && (
                  <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
                    {syncResult.details.flatMap(d => d.released.map(r => r.wbs)).filter(Boolean).join(" / ")}
                  </p>
                )}
                {/* 本番反映を確認できず前へ進めなかったものは、必ず理由まで出す。
                    黙って0件で返すと「対象が無かった」と読まれて放置される */}
                {syncResult?.details.filter(d => d.deployHold).map(d => (
                  <p key={d.projectId} style={{ fontSize: 11, color: "#B45309", marginTop: 3, lineHeight: 1.7 }}>
                    {d.projectName}: {d.deployHold}
                  </p>
                ))}
                {(syncResult?.behind ?? 0) > 0 && (
                  <p style={{ fontSize: 11, color: "#B91C1C", marginTop: 3, fontWeight: 600 }}>
                    本番へ反映されていないプロジェクトが {syncResult!.behind}件あります（下の⑤をご確認ください）。
                  </p>
                )}
              </div>
              <button onClick={handleSyncReleased} disabled={syncing}
                style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: "#1A1714", cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
                {syncing ? "反映中..." : "今すぐ反映する"}
              </button>
            </div>

            {/* GitHub App 側に登録する Webhook。任意だが、設定するとマージ直後に反映される */}
            <div style={{ marginTop: 14, borderTop: "1px solid rgba(26,23,20,0.06)", paddingTop: 12 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#1A1714", marginBottom: 6 }}>
                Webhook（任意）
              </p>
              <p style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.7, marginBottom: 8 }}>
                GitHub App の設定画面で下のURLを Webhook URL に登録し、Secret に環境変数
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}> GITHUB_WEBHOOK_SECRET </code>
                と同じ値を入れ、購読イベントに「Pull requests」を追加してください。
                設定するとマージした瞬間に反映されます。未設定でも動作します。
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                <code style={{ flex: 1, minWidth: 220, padding: "7px 10px", background: "#F9FAFB", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 11, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {webhookUrl}
                </code>
                <button onClick={handleCopyWebhookUrl}
                  style={{ padding: "7px 12px", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: "#1A1714", cursor: "pointer", whiteSpace: "nowrap" as const }}>
                  {webhookCopied ? "✓ コピーしました" : "URLをコピー"}
                </button>
              </div>
            </div>

            <p style={{ fontSize: 11, color: "#A09790", marginTop: 10, lineHeight: 1.7, borderTop: "1px solid rgba(26,23,20,0.06)", paddingTop: 10 }}>
              既定では、判定に使うのは GitHub 上のPRの状態だけです。
              <strong>本番へのデプロイが止まっていても「リリース済み」になります</strong>。
              これを防ぐには、下の⑤で本番反映の確認を設定してください。
              <br />
              前へ進めるのは「リリース待ち」からだけです。他のステータスのチケットは動かしません。
              <br />
              判定はブランチ名・PRタイトルの WBS 番号を根拠にしています（紐付けが無いマージ済みPRも遡って突き合わせます）。
              番号を含まないブランチのPRは自動では拾えないため、その場合はチケット詳細の「関連PR」から手動で紐付けてください。
              <br />
              未マージのまま閉じたPRは取り下げとみなして無視し、まだ開いているPRが残っているチケットは反映を見送ります。
            </p>
          </section>

          {/* ⑤ 本番反映の確認（docs/deploy-verification-design.md 層D） */}
          <section ref={deployRef} style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, marginBottom: 4 }}>
              <SectionTitle no="⑤" title="本番反映の確認" />
              <button onClick={() => void loadOverview()} disabled={overviewLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.15)", background: "#FFF", color: "#4B4540", cursor: overviewLoading ? "default" : "pointer", opacity: overviewLoading ? 0.6 : 1 }}>
                <RefreshCw style={{ width: 10, height: 10 }} />{overviewLoading ? "確認中..." : "診断を更新"}
              </button>
            </div>
            <p style={{ fontSize: 12, color: "#6B6458", marginBottom: 12, lineHeight: 1.8 }}>
              GitHub 上でマージが成功していても、デプロイが止まっていれば本番には何も届きません。
              その状態はマージの成否からは分からないため、
              <strong>本番が公開しているバージョン情報を読んで、既定ブランチと突き合わせます</strong>。
              <br />
              確認先URLと判定の強さは、各プロジェクトの「設定」ダイアログで指定します。
            </p>

            {overviewLoading && !overview ? (
              <p style={{ fontSize: 12, color: "#B0A9A4", padding: "12px 0" }}>診断中...</p>
            ) : !overview || overview.rows.length === 0 ? (
              <p style={{ fontSize: 12, color: "#B0A9A4", padding: "12px 0" }}>
                リポジトリを紐付けたプロジェクトがまだありません。
              </p>
            ) : (
              <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.2fr 110px 1fr 92px", gap: 10, padding: "8px 12px", background: "#F9F8F6", borderBottom: "1px solid rgba(26,23,20,0.07)", fontSize: 10, fontWeight: 700, color: "#8A837B", letterSpacing: "0.06em" }}>
                  <span>プロジェクト</span><span>ブランチ保護</span><span>本番反映</span><span />
                </div>
                {overview.rows.map((r, i) => (
                  <DeployOverviewRow
                    key={r.projectId}
                    row={r}
                    last={i === overview.rows.length - 1}
                    rechecking={recheckingId === r.projectId}
                    onRecheck={() => handleRecheckDeploy(r)}
                  />
                ))}
              </div>
            )}

            {/* 打ち切った件数は黙って隠さない。隠すと「全部見た」と読まれる */}
            {(overview?.truncated ?? 0) > 0 && (
              <p style={{ fontSize: 11, color: "#B45309", marginTop: 8 }}>
                プロジェクトが多いため、{overview!.truncated}件は診断していません。
              </p>
            )}

            <p style={{ fontSize: 11, color: "#A09790", marginTop: 10, lineHeight: 1.7, borderTop: "1px solid rgba(26,23,20,0.06)", paddingTop: 10 }}>
              <strong>ブランチ保護が未設定</strong>のリポジトリでは、チェックが失敗していても GitHub 側はマージを止めません。
              その場合は各プロジェクトの設定で「マージ前に失敗しているチェックがあるとき」を
              「理由を入力しないとマージできない」にすると、Dev Ticket 側で同じ関門を作れます。
              <br />
              遅れは{DEPLOY_GRACE_LABEL}を過ぎると画面に、{DEPLOY_SLACK_LABEL}を過ぎるとプロジェクトの Slack チャンネルに出ます
              （Slack通知が有効なプロジェクトのみ）。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

// ── 部品 ─────────────────────────────────────────────────────
const cardStyle = { background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "18px 20px" } as const;

// サーバー側の閾値（DEPLOY_GRACE_MIN / DEPLOY_SLACK_MIN）と合わせている。
// 数字がずれると案内が嘘になるので、変えるときは api/github/[resource].ts も直すこと。
const DEPLOY_GRACE_LABEL = "30分";
const DEPLOY_SLACK_LABEL = "2時間";

/** 診断の1行。状態は「良い／注意／悪い／確認できていない」の4つに落として出す */
function DeployOverviewRow({ row, last, rechecking, onRecheck }: {
  row: GithubDeployOverviewRow;
  last: boolean;
  rechecking: boolean;
  onRecheck: () => void;
}) {
  const d = row.deploy;
  const tone = d.state === "behind"
    ? (d.level === "critical" ? "bad" : d.level === "none" ? "info" : "warn")
    : d.state === "in-sync" ? "good"
      : d.state === "not-configured" ? "muted" : "warn";

  const color = tone === "good" ? "#059669"
    : tone === "bad" ? "#DC2626"
      : tone === "warn" ? "#D97706"
        : tone === "info" ? "#0284C7" : "#A09790";

  const text = d.state === "not-configured" ? "未設定（確認していません）"
    : d.state === "in-sync" ? "最新"
      : d.state === "behind"
        ? `${d.behindBy}コミット未反映${d.behindSince ? `（${elapsedSince(d.behindSince)}前から）` : ""}`
        : d.message ?? "確認できませんでした";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 110px 1fr 92px", gap: 10, padding: "9px 12px", alignItems: "center", borderBottom: last ? "none" : "1px solid rgba(26,23,20,0.05)" }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{row.projectName}</p>
        <p style={{ fontSize: 10, color: "#A09790", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{row.repo}</p>
      </div>

      {/* ブランチ保護。未保護＝「失敗していてもマージできる」ので、判定できたときは必ず出す */}
      <span style={{ fontSize: 11, fontWeight: 700, color: row.branchProtected === null ? "#A09790" : row.branchProtected ? "#059669" : "#D97706" }}>
        {row.branchProtected === null ? "判定できず" : row.branchProtected ? "✔ 保護あり" : "⚠ 未保護"}
      </span>

      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 12, color, fontWeight: tone === "good" || tone === "muted" ? 500 : 700, lineHeight: 1.5, wordBreak: "break-word" as const }}>
          {text}
        </p>
        {d.checkState === "failure" && d.checkSummary && (
          <p style={{ fontSize: 10, color: "#B91C1C", marginTop: 1 }}>{row.defaultBranch ?? "main"}: {d.checkSummary}</p>
        )}
        {d.checkedAt && d.state !== "not-configured" && (
          <p style={{ fontSize: 10, color: "#B0A9A4", marginTop: 1 }}>{relativeTime(d.checkedAt)}に確認</p>
        )}
      </div>

      {d.configured ? (
        <button onClick={onRecheck} disabled={rechecking}
          style={{ padding: "5px 8px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#4B4540", cursor: rechecking ? "default" : "pointer", opacity: rechecking ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
          {rechecking ? "確認中" : "今すぐ確認"}
        </button>
      ) : (
        <span style={{ fontSize: 10, color: "#B0A9A4", lineHeight: 1.4 }}>プロジェクト設定で指定</span>
      )}
    </div>
  );
}

function SectionTitle({ no, title }: { no: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "#059669" }}>{no}</span>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>{title}</p>
    </div>
  );
}

function Notice({ tone, title, children }: { tone: "warn" | "info"; title: string; children: React.ReactNode }) {
  const warn = tone === "warn";
  return (
    <div style={{ display: "flex", gap: 10, padding: "13px 16px", borderRadius: 10, marginBottom: 16, background: warn ? "#FFFBEB" : "#F0F9FF", border: `1px solid ${warn ? "rgba(217,119,6,0.25)" : "rgba(2,132,199,0.25)"}` }}>
      <AlertTriangle style={{ width: 15, height: 15, color: warn ? "#D97706" : "#0284C7", flexShrink: 0, marginTop: 1 }} />
      <div>
        <p style={{ fontSize: 13, fontWeight: 700, color: warn ? "#92400E" : "#075985", marginBottom: 4 }}>{title}</p>
        <p style={{ fontSize: 12, color: warn ? "#92400E" : "#075985", lineHeight: 1.7 }}>{children}</p>
      </div>
    </div>
  );
}

/** 8-1-B: 未接続。ここが一番説明を厚くする画面 */
function ConnectCard({ visibility, connecting, copied, onConnect, onCopyUrl }: {
  visibility: "private" | "public";
  connecting: boolean;
  copied: boolean;
  onConnect: () => void;
  onCopyUrl: () => void;
}) {
  const isPrivate = visibility === "private";
  const steps = [
    "下のボタンを押すと GitHub の画面に移動します",
    isPrivate
      ? "接続先のアカウントを確認します（選択肢は自社の GitHub 組織のみです）"
      : "接続先の Organization（またはアカウント）を選びます",
    "Dev Ticket から見せたいリポジトリを選んで Install を押します",
    "自動でこの画面に戻ります",
  ];

  return (
    <div style={{ background: "#FAFAF8", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "30px 24px", display: "flex", flexDirection: "column" as const, alignItems: "center" }}>
      <div style={{ width: 52, height: 52, borderRadius: 14, background: GITHUB_BLACK, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, color: "#fff", boxShadow: "0 4px 16px rgba(31,35,40,0.22)" }}>
        {GITHUB_MARK}
      </div>

      <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", marginBottom: 6, fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
        GitHubに接続する
      </p>
      <p style={{ fontSize: 12, color: "#6B6458", marginBottom: 22, lineHeight: 1.8, textAlign: "center" as const }}>
        接続すると、プルリクエスト・Issue・コミットを Dev Ticket の画面内で確認できるようになります。<br />
        閲覧するメンバーに GitHub アカウントは必要ありません。
      </p>

      {/* 画面幅を活かすため、広い画面では横2列・狭い画面では自動で縦積みにする */}
      <div style={{ width: "100%", maxWidth: 1240, display: "flex", flexWrap: "wrap" as const, gap: 14, alignItems: "stretch", marginBottom: 22 }}>
        <div style={{ flex: "1 1 420px", minWidth: 0, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "14px 18px" }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 10 }}>接続の流れ</p>
          {steps.map((text, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "7px 0", borderBottom: i < steps.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: GITHUB_BLACK, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 1 }}>
                {i + 1}
              </div>
              <div>
                <p style={{ fontSize: 12, color: "#374151", lineHeight: 1.6 }}>{text}</p>
                {i === 2 && (
                  <p style={{ fontSize: 11, color: "#A09790", marginTop: 3, lineHeight: 1.6 }}>
                    ・「All repositories」＝ 今後追加される分も自動で対象<br />
                    ・「Only select repositories」＝ 選んだものだけ
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column" as const, gap: 14 }}>
          <div style={{ background: "#FFFBEB", border: "1px solid rgba(217,119,6,0.22)", borderRadius: 10, padding: "13px 16px" }}>
            <div style={{ display: "flex", gap: 9 }}>
              <AlertTriangle style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 4 }}>GitHub の管理者権限が必要です</p>
                <p style={{ fontSize: 11, color: "#92400E", lineHeight: 1.7 }}>
                  {isPrivate
                    ? "この操作には、自社 GitHub 組織で App をインストールできる権限（Owner など）が必要です。"
                    : "この操作には、対象 Organization で App をインストールできる権限（Owner など）が必要です。権限が無い場合は、この画面の URL を管理者に共有して実施してもらってください。"}
                </p>
                {!isPrivate && (
                  <button onClick={onCopyUrl}
                    style={{ marginTop: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(217,119,6,0.3)", background: "#FFF", color: "#92400E", cursor: "pointer" }}>
                    {copied ? "✓ コピーしました" : "URLをコピー"}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 接続後に何ができるようになるかを先に見せる（右側の余白の活用も兼ねる） */}
          <div style={{ flex: 1, background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "14px 18px" }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 10 }}>接続してできること</p>
            {[
              { icon: "🔀", title: "プルリクエストの確認", desc: "オープンなPR・CI状態・レビュー状況をアプリ内で一覧" },
              { icon: "✅", title: "権限を持つ人だけのマージ", desc: "アサイン計画で「マージ可」にした人だけが実行できる" },
              { icon: "🔗", title: "チケットとPRの紐付け", desc: "ブランチ名のWBS番号から自動で対応付け" },
              { icon: "📄", title: "Issue・コミット・ブランチ", desc: "リポジトリの状況をタブで切り替えて確認" },
            ].map((f, i, arr) => (
              <div key={f.title} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "7px 0", borderBottom: i < arr.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
                <span style={{ fontSize: 13, lineHeight: 1.4, flexShrink: 0 }}>{f.icon}</span>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: "#374151" }}>{f.title}</p>
                  <p style={{ fontSize: 11, color: "#A09790", marginTop: 1, lineHeight: 1.6 }}>{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <button onClick={onConnect} disabled={connecting}
        style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 26px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: connecting ? "default" : "pointer", background: connecting ? "#6B7280" : GITHUB_BLACK, color: "#fff", boxShadow: "0 2px 10px rgba(31,35,40,0.25)", letterSpacing: "-0.01em" }}>
        <span style={{ color: "#fff", display: "flex" }}>{GITHUB_MARK}</span>
        {connecting ? "GitHubへ移動中..." : "GitHubに接続する"}
      </button>

      <p style={{ fontSize: 11, color: "#A09790", marginTop: 14, textAlign: "center" as const, lineHeight: 1.7 }}>
        接続は組織につき1回だけです。プロジェクトが増えても、この操作をやり直す必要はありません。
      </p>
    </div>
  );
}

/** 8-1-E: GitHub 側でアンインストールされた */
function RevokedCard({ onReconnect, connecting }: { onReconnect: () => void; connecting: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, padding: "16px 18px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12 }}>
      <AlertTriangle style={{ width: 16, height: 16, color: "#DC2626", flexShrink: 0, marginTop: 2 }} />
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#B91C1C", marginBottom: 5 }}>GitHub との接続が解除されています</p>
        <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7 }}>
          GitHub 側で Dev Ticket App がアンインストールされたか、権限が取り消された可能性があります。
          再接続すると復旧します。プロジェクトとリポジトリの紐付けは保持されています。
        </p>
        <button onClick={onReconnect} disabled={connecting}
          style={{ marginTop: 10, padding: "8px 18px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: connecting ? "#9CA3AF" : GITHUB_BLACK, color: "#FFF", cursor: connecting ? "default" : "pointer" }}>
          {connecting ? "GitHubへ移動中..." : "再接続する"}
        </button>
      </div>
    </div>
  );
}
