// プロジェクト内 GitHub タブ（docs/github-integration-design.md 8-3）。
//
// 権限が無い人にはタブ自体が出ないが、URL直打ちには理由を出す
// （黙ってリダイレクトしない＝docs/not-found-page-design.md の方針）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ExternalLink, RefreshCw } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject } from "@/app/lib/mappers";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { NotFoundView, projectAccessView } from "@/app/components/shared/NotFoundView";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { PullRequestList, Empty } from "@/app/components/github/PullRequestList";
import { MergeConfirmDialog } from "@/app/components/github/MergeConfirmDialog";
import { useGithubAccess } from "@/app/hooks/useGithubAccess";
import {
  fetchPulls, fetchIssues, fetchCommits, fetchBranches, mergePull, relativeTime, GithubApiError,
} from "@/app/lib/github";
import type {
  Project, GithubPull, GithubIssue, GithubCommit, GithubBranch, TicketGithubLink,
  GithubAccessLevel, GithubMergeMethod,
} from "@/app/types";

const BLACK = "#1F2328";
type SubTab = "pulls" | "issues" | "commits" | "branches";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "pulls", label: "プルリクエスト" },
  { id: "issues", label: "Issue" },
  { id: "commits", label: "コミット" },
  { id: "branches", label: "ブランチ" },
];

export function GithubPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const { userRole, userName, userOrgId, userPermissions } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);

  const access = useGithubAccess(projectSlug);

  const [tab, setTab] = useState<SubTab>("pulls");
  const [level, setLevel] = useState<GithubAccessLevel>("none");
  const [repo, setRepo] = useState("");
  const [pulls, setPulls] = useState<GithubPull[]>([]);
  const [links, setLinks] = useState<TicketGithubLink[]>([]);
  const [issues, setIssues] = useState<GithubIssue[]>([]);
  const [commits, setCommits] = useState<GithubCommit[]>([]);
  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [loadedTabs, setLoadedTabs] = useState<Record<SubTab, boolean>>({ pulls: false, issues: false, commits: false, branches: false });
  const [fetching, setFetching] = useState(false);
  const [apiError, setApiError] = useState("");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [mergeTarget, setMergeTarget] = useState<GithubPull | null>(null);

  // ── プロジェクトの解決 ────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    let alive = true;
    // 404画面はリダイレクトせずその場に留まるので、PJを移ったときに前回の判定を引きずらない
    setNotFound(false);
    setLoading(true);
    (async () => {
      const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
      const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
      if (!alive) return;
      if (!p) { setNotFound(true); setLoading(false); return; }
      setProject(mapProject(p));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [projectSlug]);

  // ── データ取得（自動ポーリングはしない） ────────────────
  const loadTab = useCallback(async (which: SubTab, force = false) => {
    if (!project?.id) return;
    if (!force && loadedTabs[which]) return;
    setFetching(true);
    setApiError("");
    try {
      if (which === "pulls") {
        const r = await fetchPulls(project.id);
        setPulls(r.pulls); setLinks(r.links); setLevel(r.level); setRepo(r.repo);
      } else if (which === "issues") {
        const r = await fetchIssues(project.id);
        setIssues(r.issues); setLevel(r.level); setRepo(r.repo);
      } else if (which === "commits") {
        const r = await fetchCommits(project.id);
        setCommits(r.commits); setRepo(r.repo);
      } else {
        const r = await fetchBranches(project.id);
        setBranches(r.branches); setRepo(r.repo);
      }
      setLoadedTabs(prev => ({ ...prev, [which]: true }));
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      setApiError(e instanceof GithubApiError ? e.message : "GitHubの情報を取得できませんでした。");
    } finally {
      setFetching(false);
    }
  }, [project?.id, loadedTabs]);

  useEffect(() => {
    if (!project?.id || !access.linked || access.level === "none" || !access.level) return;
    void loadTab(tab);
  }, [project?.id, tab, access.linked, access.level, loadTab]);

  const handleMerge = async (method: GithubMergeMethod) => {
    if (!project?.id || !mergeTarget) return;
    await mergePull(project.id, mergeTarget.number, method);
    toast(`#${mergeTarget.number} をマージしました`, "success");
    setLoadedTabs(prev => ({ ...prev, pulls: false }));
    await loadTab("pulls", true);
  };

  const isManager = userPermissions.canAccessAdminSettings;

  // ── ガード ────────────────────────────────────────────────
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (notFound && accessBlocked) return accessBlocked;
  if (loading || !project) return <PageLoader label="プロジェクトを読み込み中..." />;
  if (accessBlocked) return accessBlocked;

  if (!plan.featureGithub) return (
    <NotFoundView kind="no-permission" label="GitHub"
      body="GitHub連携はご契約のプランに含まれていません。ご利用をご希望の場合は管理者へお問い合わせください。" />
  );

  if (!access.loading && (!access.level || access.level === "none")) return (
    <NotFoundView kind="no-permission" label="GitHub"
      body="GitHubの閲覧権限が付与されていません。管理者にご相談ください。" />
  );

  return (
    <div style={{ padding: "24px 24px 40px", minWidth: 900 }}>
      <ProjectSubNav projectSlug={projectSlug ?? project.slug} active="github" marginBottom={16} />

      {access.loading ? (
        <PageLoader label="読み込み中..." />
      ) : !access.linked ? (
        isManager ? <UnlinkedAdmin onOpenSettings={() => navigate("/admin-settings?tab=github")} /> : <UnlinkedMember />
      ) : (
        <>
          {/* リポジトリ帯 */}
          <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "12px 16px", marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-mono)" }}>
                  {repo || project.githubRepoFullName}
                </span>
                <a href={`https://github.com/${repo || project.githubRepoFullName}`} target="_blank" rel="noopener noreferrer"
                  title="GitHubのアカウントと権限が必要です"
                  style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#0284C7", textDecoration: "none" }}>
                  GitHubで開く <ExternalLink style={{ width: 10, height: 10 }} />
                </a>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {fetchedAt && <span style={{ fontSize: 11, color: "#B0A9A4" }}>{relativeTime(fetchedAt)}に取得</span>}
                <button onClick={() => loadTab(tab, true)} disabled={fetching}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#4B4540", cursor: fetching ? "default" : "pointer", opacity: fetching ? 0.6 : 1 }}>
                  <RefreshCw style={{ width: 11, height: 11 }} />{fetching ? "更新中..." : "更新"}
                </button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 4, marginTop: 12, background: "#F4F5F6", borderRadius: 9, padding: 3, width: "fit-content" }}>
              {SUB_TABS.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer", background: tab === t.id ? BLACK : "transparent", color: tab === t.id ? "#FFF" : "#6B6458" }}>
                  {t.label}
                  {t.id === "pulls" && pulls.length > 0 && ` ${pulls.length}`}
                  {t.id === "issues" && issues.length > 0 && ` ${issues.length}`}
                </button>
              ))}
            </div>
          </div>

          {apiError && (
            <div style={{ padding: "12px 16px", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.25)", borderRadius: 10, marginBottom: 12 }}>
              <p style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.7 }}>{apiError}</p>
            </div>
          )}

          {fetching && !loadedTabs[tab] ? (
            <PageLoader label="GitHubから取得中..." />
          ) : tab === "pulls" ? (
            <PullRequestList
              projectId={project.id} repo={repo} pulls={pulls} level={level} links={links}
              onMergeClick={setMergeTarget}
            />
          ) : tab === "issues" ? (
            <IssueList issues={issues} />
          ) : tab === "commits" ? (
            <CommitList commits={commits} />
          ) : (
            <BranchList branches={branches} />
          )}
        </>
      )}

      {mergeTarget && (
        <MergeConfirmDialog
          pull={mergeTarget}
          repo={repo}
          actorName={userName}
          onClose={() => setMergeTarget(null)}
          onMerge={handleMerge}
        />
      )}
    </div>
  );
}

// ── 未紐付け ─────────────────────────────────────────────────
function UnlinkedAdmin({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div style={{ background: "#FAFAF8", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "36px 24px", textAlign: "center" as const }}>
      <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", marginBottom: 8, fontFamily: "var(--font-heading)" }}>
        このプロジェクトにリポジトリが紐付いていません
      </p>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.8, marginBottom: 20 }}>
        「外部連携」からリポジトリを選ぶと、PR・Issue・コミットがここに表示されます。
      </p>
      <button onClick={onOpenSettings}
        style={{ padding: "10px 22px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", background: BLACK, color: "#FFF", cursor: "pointer" }}>
        外部連携をひらく →
      </button>
    </div>
  );
}

function UnlinkedMember() {
  return (
    <div style={{ background: "#FAFAF8", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "36px 24px", textAlign: "center" as const }}>
      <p style={{ fontSize: 13, color: "#6B6458", lineHeight: 1.8 }}>
        このプロジェクトにはまだ GitHub リポジトリが紐付いていません。<br />
        表示するには管理者による設定が必要です。
      </p>
    </div>
  );
}

// ── 一覧 ─────────────────────────────────────────────────────
function IssueList({ issues }: { issues: GithubIssue[] }) {
  if (!issues.length) return <Empty>オープンな Issue はありません。</Empty>;
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 8 }}>
      {issues.map(i => (
        <div key={i.number} style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#8A837B", fontFamily: "var(--font-mono)" }}>#{i.number}</span>
            <a href={i.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", textDecoration: "none", wordBreak: "break-word" as const }}>{i.title}</a>
            {i.labels.map(l => (
              <span key={l} style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 10, background: "#F0F9FF", color: "#0284C7" }}>{l}</span>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#A09790", marginTop: 4 }}>
            {i.user.login} が {relativeTime(i.createdAt)}に作成{i.comments > 0 && ` ・ コメント${i.comments}件`}
          </p>
        </div>
      ))}
    </div>
  );
}

function CommitList({ commits }: { commits: GithubCommit[] }) {
  if (!commits.length) return <Empty>コミットがありません。</Empty>;
  return (
    <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, overflow: "hidden" }}>
      {commits.map((c, i) => (
        <div key={c.sha} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderBottom: i < commits.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <a href={c.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
              {c.message}
            </a>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>
              {c.authorLogin ?? c.authorName} ・ {relativeTime(c.date)}
            </p>
          </div>
          <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{c.sha.slice(0, 7)}</span>
        </div>
      ))}
    </div>
  );
}

function BranchList({ branches }: { branches: GithubBranch[] }) {
  if (branches.length <= 1) return <Empty>既定ブランチ以外のブランチはありません。</Empty>;
  return (
    <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, overflow: "hidden" }}>
      {branches.map((b, i) => (
        <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: i < branches.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", fontFamily: "var(--font-mono)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{b.name}</span>
          {b.isDefault && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#ECFDF5", color: "#059669" }}>既定</span>}
          {b.protected && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#FFFBEB", color: "#D97706" }}>保護</span>}
          <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{b.lastCommitSha.slice(0, 7)}</span>
        </div>
      ))}
    </div>
  );
}
