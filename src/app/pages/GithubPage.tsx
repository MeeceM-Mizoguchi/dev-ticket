// プロジェクト内 GitHub タブ（docs/github-integration-design.md 8-3）。
//
// 権限が無い人にはタブ自体が出ないが、URL直打ちには理由を出す
// （黙ってリダイレクトしない＝docs/not-found-page-design.md の方針）。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ExternalLink, RefreshCw, GitPullRequest, FolderKanban, ChevronRight } from "lucide-react";
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
import { CreatePullDialog } from "@/app/components/github/CreatePullDialog";
import { PendingBranches } from "@/app/components/github/PendingBranches";
import { BulkMergeDialog } from "@/app/components/github/BulkMergeDialog";
import { PermissionBlockNotice } from "@/app/components/github/PermissionBlockNotice";
import { useGithubAccess } from "@/app/hooks/useGithubAccess";
import {
  fetchPulls, fetchIssues, fetchCommits, fetchBranches, fetchPendingBranches, mergePull, mergePullsBulk,
  mergeBlockReason, relativeTime, GithubApiError,
} from "@/app/lib/github";
import type {
  Project, GithubPull, GithubIssue, GithubCommit, GithubBranch, GithubPendingBranch, TicketGithubLink,
  GithubAccessLevel, GithubMergeMethod, GithubPermissionBlock,
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
  const [defaultBranch, setDefaultBranch] = useState("");
  const [preparingCreate, setPreparingCreate] = useState(false);
  const [createTarget, setCreateTarget] = useState<{ branches: GithubBranch[]; defaultBranch: string; head?: string } | null>(null);
  const [pending, setPending] = useState<GithubPendingBranch[]>([]);
  /** コミットタブで見ているブランチ。空なら既定ブランチ（サーバー側でフォールバックする） */
  const [commitBranch, setCommitBranch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  /**
   * まとめてマージの対象。開いた時点の選択を「そのまま持つ」。
   * 選択（selected）から毎回導くと、実行後の一覧取り直しで選択が空になった瞬間に
   * ダイアログごと消えてしまい、結果表示を読む前に閉じてしまう。
   */
  const [bulkTargets, setBulkTargets] = useState<GithubPull[] | null>(null);
  /**
   * マージ・PR作成が GitHub App の権限で止まる状態。
   * 押してから全件失敗して初めて理由が出る、という繰り返しを断つために
   * 一覧を取った時点でサーバーから受け取り、実行の入口を閉じる。
   */
  const [writeBlock, setWriteBlock] = useState<GithubPermissionBlock | null>(null);

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
        // PR一覧と「PR未作成のブランチ」は並行して取り、まとめて反映する。
        // 別々に反映すると、PRを作った直後に「まだPRが作られていない」古い案内が
        // 一瞬だけ残り、そのあとマージの表示に切り替わって見えてしまう。
        // 未作成ブランチは付随情報なので、取れなくても一覧は表示する
        const [r, pendingBranches] = await Promise.all([
          fetchPulls(project.id),
          fetchPendingBranches(project.id).then(p => p.branches).catch(() => [] as GithubPendingBranch[]),
        ]);
        setPulls(r.pulls); setLinks(r.links); setLevel(r.level); setRepo(r.repo);
        setWriteBlock(r.writeBlock ?? null);
        setPending(pendingBranches);
        setSelected(new Set());
      } else if (which === "issues") {
        const r = await fetchIssues(project.id);
        setIssues(r.issues); setLevel(r.level); setRepo(r.repo);
      } else if (which === "commits") {
        const r = await fetchCommits(project.id, commitBranch || undefined);
        setCommits(r.commits); setRepo(r.repo);
        // 未指定ならサーバーが既定ブランチに寄せるので、その名前を受け取って選択欄に反映する
        setCommitBranch(r.branch);
      } else {
        const r = await fetchBranches(project.id);
        setBranches(r.branches); setDefaultBranch(r.defaultBranch); setRepo(r.repo);
      }
      setLoadedTabs(prev => ({ ...prev, [which]: true }));
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      setApiError(e instanceof GithubApiError ? e.message : "GitHubの情報を取得できませんでした。");
    } finally {
      setFetching(false);
    }
  }, [project?.id, loadedTabs, commitBranch]);

  useEffect(() => {
    if (!project?.id || !access.linked || access.level === "none" || !access.level) return;
    void loadTab(tab);
  }, [project?.id, tab, access.linked, access.level, loadTab]);

  /** ブランチ一覧を一度だけ取る。PR作成ダイアログとコミットタブの切り替え欄で共用する */
  const ensureBranches = useCallback(async () => {
    if (!project?.id) return { list: branches, def: defaultBranch };
    if (loadedTabs.branches && branches.length) return { list: branches, def: defaultBranch };
    const r = await fetchBranches(project.id);
    setBranches(r.branches); setDefaultBranch(r.defaultBranch);
    setLoadedTabs(prev => ({ ...prev, branches: true }));
    return { list: r.branches, def: r.defaultBranch };
  }, [project?.id, branches, defaultBranch, loadedTabs.branches]);

  // コミットタブの切り替え欄にブランチ名が要るので、タブを開いた時点で取っておく。
  // 取れなくてもコミット一覧そのものは出るため、失敗は握りつぶす
  useEffect(() => {
    if (tab !== "commits" || !project?.id) return;
    if (loadedTabs.branches && branches.length) return;
    void ensureBranches().catch(() => {});
  }, [tab, project?.id, loadedTabs.branches, branches.length, ensureBranches]);

  /** コミットタブで見るブランチを切り替える */
  const changeCommitBranch = async (nextBranch: string) => {
    if (!project?.id || !nextBranch || nextBranch === commitBranch) return;
    setCommitBranch(nextBranch);
    setFetching(true);
    setApiError("");
    try {
      const r = await fetchCommits(project.id, nextBranch);
      setCommits(r.commits); setRepo(r.repo); setCommitBranch(r.branch);
      setFetchedAt(new Date().toISOString());
    } catch (e) {
      setApiError(e instanceof GithubApiError ? e.message : "コミットを取得できませんでした。");
    } finally {
      setFetching(false);
    }
  };

  // PR作成ダイアログはブランチ一覧が要る。まだ取っていなければここで取る。
  // head を渡すと、そのブランチを選択済みの状態で開く（未作成ブランチからの導線）。
  const openCreatePull = async (head?: string) => {
    if (!project?.id) return;
    setPreparingCreate(true);
    try {
      const { list, def } = await ensureBranches();
      if (!list.length) { toast("ブランチを取得できませんでした", "error"); return; }
      setCreateTarget({ branches: list, defaultBranch: def || project.githubDefaultBranch || "main", head });
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "ブランチを取得できませんでした", "error");
    } finally {
      setPreparingCreate(false);
    }
  };

  const toggleSelect = (n: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  // マージできる状態のものだけを選択対象にする
  const mergeablePulls = useMemo(() => pulls.filter(p => !mergeBlockReason(p)), [pulls]);
  const selectedPulls = useMemo(() => pulls.filter(p => selected.has(p.number)), [pulls, selected]);

  const handleMerge = async (method: GithubMergeMethod) => {
    if (!project?.id || !mergeTarget) return;
    await mergePull(project.id, mergeTarget.number, method);
    toast(`#${mergeTarget.number} をマージしました`, "success");
    // loadedTabs は落とさない。落とすと取り直しの間だけページ全体がローダーに変わり、
    // 進捗を出しているダイアログの裏で表示が二度切り替わって見える
    await loadTab("pulls", true);
  };

  const isManager = userPermissions.canAccessAdminSettings;

  // パンくず・見出し・タブの並びは他のプロジェクト内ページ（バックログ／議事録など）に合わせる。
  // 読み込み中でも同じ枠を出したいので、先に組み立てて使い回す。
  const pageHead = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>GitHub</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project?.name ?? "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="github" marginBottom={0} />
        </div>
      </div>
    </>
  );

  // ── ガード ────────────────────────────────────────────────
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;

  if (!plan.featureGithub) return (
    <NotFoundView kind="no-permission" label="GitHub"
      body="GitHub連携はご契約のプランに含まれていません。ご利用をご希望の場合は管理者へお問い合わせください。" />
  );

  if (!access.loading && (!access.level || access.level === "none")) return (
    <NotFoundView kind="no-permission" label="GitHub"
      body="GitHubの閲覧権限が付与されていません。管理者にご相談ください。" />
  );

  // 読み込み中にページ全体を差し替えない。
  // 以前は <PageLoader /> だけを返していたため、他画面から来ると
  // 「見出しとサブナビが一度消えてまた出る」＝画面がチカつく状態だった（ナレッジノートと同じ対処）。
  if (loading || !project) return (
    <div style={{ padding: "24px 24px 40px", minWidth: 900 }}>
      {pageHead}
      <PageLoader label="読み込み中..." />
    </div>
  );

  return (
    <div style={{ padding: "24px 24px 40px", minWidth: 900 }}>
      {pageHead}

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

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" as const }}>
              <div style={{ display: "flex", gap: 4, background: "#F4F5F6", borderRadius: 9, padding: 3, width: "fit-content" }}>
                {SUB_TABS.map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    style={{ padding: "6px 14px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer", background: tab === t.id ? BLACK : "transparent", color: tab === t.id ? "#FFF" : "#6B6458" }}>
                    {t.label}
                    {t.id === "pulls" && pulls.length > 0 && ` ${pulls.length}`}
                    {t.id === "issues" && issues.length > 0 && ` ${issues.length}`}
                  </button>
                ))}
              </div>

              {/* PRの作成は書き込み操作なので「マージ可」の人にだけ出す。
                  権限で必ず失敗する状態では押させない（理由はすぐ下の帯に出ている） */}
              {tab === "pulls" && level === "merge" && (
                <button onClick={() => openCreatePull()} disabled={preparingCreate || !!writeBlock}
                  title={writeBlock ? writeBlock.message : undefined}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: preparingCreate || writeBlock ? "#9CA3AF" : BLACK, color: "#FFF", cursor: preparingCreate || writeBlock ? "not-allowed" : "pointer", whiteSpace: "nowrap" as const }}>
                  <GitPullRequest style={{ width: 13, height: 13 }} />
                  {preparingCreate ? "準備中..." : "プルリクエストを作成"}
                </button>
              )}
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
            <>
              {/* 権限が足りないと、閲覧はできるのにマージだけが必ず失敗する。
                  選んで押したあとに全件失敗させないよう、一覧の先頭で先に知らせる */}
              {writeBlock && <PermissionBlockNotice block={writeBlock} />}
              <PendingBranches
                branches={pending}
                canCreate={level === "merge"}
                onCreate={name => openCreatePull(name)}
              />
              {/* まとめてマージの操作バー。マージできるPRが2件以上あるときだけ出す */}
              {level === "merge" && !writeBlock && mergeablePulls.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, background: selected.size ? "#F0F9FF" : "#FFF", border: `1px solid ${selected.size ? "rgba(2,132,199,0.28)" : "rgba(26,23,20,0.09)"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, color: "#4B4540" }}>
                      <input type="checkbox"
                        checked={selected.size > 0 && selected.size === mergeablePulls.length}
                        onChange={e => setSelected(e.target.checked ? new Set(mergeablePulls.map(p => p.number)) : new Set())} />
                      マージできるもの全件を選択（{mergeablePulls.length}件）
                    </label>
                    {selected.size > 0 && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#0284C7" }}>{selected.size}件を選択中</span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    {selected.size > 0 && (
                      <button onClick={() => setSelected(new Set())}
                        style={{ padding: "6px 13px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#6B6458", cursor: "pointer" }}>
                        選択を解除
                      </button>
                    )}
                    <button onClick={() => setBulkTargets(selectedPulls)} disabled={selected.size === 0}
                      style={{ padding: "6px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", background: selected.size ? BLACK : "#E5E7EB", color: selected.size ? "#FFF" : "#9CA3AF", cursor: selected.size ? "pointer" : "not-allowed", whiteSpace: "nowrap" as const }}>
                      まとめてマージする
                    </button>
                  </div>
                </div>
              )}

              <PullRequestList
                projectId={project.id} projectSlug={projectSlug ?? project.slug} repo={repo}
                pulls={pulls} level={level} links={links}
                selected={selected} onToggleSelect={toggleSelect}
                onMergeClick={setMergeTarget}
                writeBlocked={writeBlock?.message ?? null}
                refreshedAt={fetchedAt}
              />
            </>
          ) : tab === "issues" ? (
            <IssueList issues={issues} />
          ) : tab === "commits" ? (
            <>
              <CommitBranchPicker
                branches={branches}
                value={commitBranch}
                disabled={fetching}
                onChange={changeCommitBranch}
              />
              <CommitList commits={commits} />
            </>
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

      {bulkTargets && bulkTargets.length > 0 && (
        <BulkMergeDialog
          pulls={bulkTargets}
          repo={repo}
          actorName={userName}
          onClose={() => setBulkTargets(null)}
          onMerge={(numbers, method) => mergePullsBulk(project.id, numbers, method)}
          onDone={async () => {
            await loadTab("pulls", true);
          }}
        />
      )}

      {createTarget && (
        <CreatePullDialog
          projectId={project.id}
          projectSlug={projectSlug ?? project.slug}
          repo={repo || project.githubRepoFullName || ""}
          branches={createTarget.branches}
          defaultBranch={createTarget.defaultBranch}
          initialHead={createTarget.head}
          onClose={() => setCreateTarget(null)}
          onCreated={async created => {
            toast(created.number ? `#${created.number} を作成しました` : "プルリクエストを作成しました", "success");
            // 一覧を取り直すと、ブランチ名のWBS番号からチケットへ自動で紐付く。
            // ここは await されていて、終わるまでダイアログは進捗を出したまま開いている。
            // loadedTabs を落とすとその裏でページ全体がローダーに変わってしまうので触らない
            setTab("pulls");
            await loadTab("pulls", true);
          }}
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

/**
 * コミット一覧で見るブランチの切り替え。
 * 既定ブランチしか見られないと、PR前のブランチに積んだコミットを画面から確認できないため。
 */
function CommitBranchPicker({ branches, value, disabled, onChange }: {
  branches: GithubBranch[];
  value: string;
  disabled: boolean;
  onChange: (name: string) => void;
}) {
  // 選んでいる値が一覧に無いと <select> は先頭の項目を表示してしまい、
  // 画面に出ているブランチと実際に取得したブランチがずれる。必ず選択肢に含めておく
  const options = useMemo<GithubBranch[]>(() => (
    !value || branches.some(b => b.name === value)
      ? branches
      : [{ name: value, protected: false, isDefault: true, lastCommitSha: "" }, ...branches]
  ), [branches, value]);

  if (!options.length) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" as const }}>
      <label htmlFor="commit-branch" style={{ fontSize: 12, fontWeight: 700, color: "#4B4540" }}>ブランチ</label>
      <select id="commit-branch" value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)}
        style={{ padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.14)", background: "#FFF", color: "#1A1714", fontFamily: "var(--font-mono)", maxWidth: 380, cursor: disabled ? "default" : "pointer" }}>
        {options.map(b => (
          <option key={b.name} value={b.name}>{b.name}{b.isDefault ? "（既定）" : ""}</option>
        ))}
      </select>
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
