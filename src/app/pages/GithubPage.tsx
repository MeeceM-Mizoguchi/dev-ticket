// プロジェクト内 GitHub タブ（docs/github-integration-design.md 8-3）。
//
// 権限が無い人にはタブ自体が出ないが、URL直打ちには理由を出す
// （黙ってリダイレクトしない＝docs/not-found-page-design.md の方針）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ExternalLink, RefreshCw, GitPullRequest, GitBranch, FolderKanban, ChevronRight } from "lucide-react";
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
import { CreateBranchDialog } from "@/app/components/github/CreateBranchDialog";
import { PendingBranches } from "@/app/components/github/PendingBranches";
import { BulkMergeDialog } from "@/app/components/github/BulkMergeDialog";
import { PermissionBlockNotice } from "@/app/components/github/PermissionBlockNotice";
import {
  RefreshProgressDialog, type RefreshStepKey, type RefreshProgressState,
} from "@/app/components/github/RefreshProgressDialog";
import { DeployStatusBanner } from "@/app/components/github/DeployStatusBanner";
import { useGithubAccess } from "@/app/hooks/useGithubAccess";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";
import {
  fetchPulls, fetchIssues, fetchCommits, fetchBranches, fetchPendingBranches, fetchTicketBranches,
  mergePull, mergePullsBulk, precheckMerge, mergeBlockReason, relativeTime, fetchDeployStatus,
  runDeployCheck, GithubApiError,
} from "@/app/lib/github";
import { NO_GITHUB_PERMS } from "@/app/lib/githubPerms";
import type {
  Project, GithubPull, GithubIssue, GithubCommit, GithubBranch, GithubPendingBranch, TicketGithubLink,
  GithubAccessLevel, GithubMergeMethod, GithubPermissionBlock, GithubDeployStatus, GithubPerms,
  TicketGithubBranch,
} from "@/app/types";

const BLACK = "#1F2328";
type SubTab = "pulls" | "issues" | "commits" | "branches";

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: "pulls", label: "プルリクエスト" },
  { id: "issues", label: "Issue" },
  { id: "commits", label: "コミット" },
  { id: "branches", label: "ブランチ" },
];

/** 「更新」の進捗画面に出す実行中の状態 */
interface RefreshRun {
  /** 押した時点のタブ。途中でタブを変えても工程の並びが入れ替わらないよう持っておく */
  tab: SubTab;
  done: RefreshStepKey[];
  state: RefreshProgressState;
}

/** 完了を見せてから閉じるまでの間。すぐ消すと更新できたのかが読み取れない */
const REFRESH_CLOSE_MS = 900;

/**
 * 並行して走る取得の「終わった」を、値をそのまま通しながら進捗へ伝える。
 * Promise.all の外で待つと全部揃うまで報告できず、1件ずつ緑になっていかない
 */
const reportStep = <T,>(onStep: ((key: RefreshStepKey) => void) | undefined, key: RefreshStepKey) =>
  (value: T) => { onStep?.(key); return value; };

export function GithubPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const navigate = useNavigate();
  const { userRole, userName, userOrgId, userPermissions } = useAuth();
  const { plan } = usePlan();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);

  const access = useGithubAccess(projectSlug);

  const [tab, setTab] = useState<SubTab>("pulls");
  const [level, setLevel] = useState<GithubAccessLevel>("none");
  /**
   * サーバーが返した操作ごとの権限（BRU13-054）。
   * 判定はサーバーが正なので、応答を受け取ったらそちらを使う。
   * 受け取るまでの間は hook の解決結果（同じ判定をクライアントでやり直したもの）で出し分ける
   */
  const [apiPerms, setApiPerms] = useState<GithubPerms | null>(null);
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
  /** 「更新」の進捗画面。押していないあいだは null（初回の読み込みでは出さない） */
  const [refresh, setRefresh] = useState<RefreshRun | null>(null);
  /** 完了を見せてから閉じるまでのタイマー */
  const refreshCloseRef = useRef<number | null>(null);
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
  /**
   * 本番反映の状態（docs/deploy-verification-design.md 層C）。
   *
   * PR一覧とは別に取る。一覧の取得を待たせないためと、
   * 「マージは全部済んでいるのに本番に届いていない」はPRの一覧を見ても分からないため。
   */
  const [deploy, setDeploy] = useState<GithubDeployStatus | null>(null);
  const [deployChecking, setDeployChecking] = useState(false);
  /** ブランチ作成ダイアログ。開くときに分岐元の選択肢を持たせる */
  const [branchTarget, setBranchTarget] = useState<{ branches: GithubBranch[]; defaultBranch: string } | null>(null);
  const [preparingBranch, setPreparingBranch] = useState(false);
  /** Dev Ticket から作ったブランチとチケットの紐付け。ブランチタブの表示に使う */
  const [ticketBranches, setTicketBranches] = useState<TicketGithubBranch[]>([]);

  const perms = apiPerms ?? access.perms ?? NO_GITHUB_PERMS;
  const ticketByBranch = useMemo(
    () => new Map(ticketBranches.map(b => [b.branchName, b])),
    [ticketBranches],
  );

  // ── プロジェクトの解決 ────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    let alive = true;
    // 404画面はリダイレクトせずその場に留まるので、PJを移ったときに前回の判定を引きずらない
    setNotFound(false);
    setLoading(true);
    (async () => {
      const found = await findProjectBySlug(projectSlug);
      if (!alive) return;
      if (!found) { setNotFound(true); setLoading(false); return; }
      setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
      setProject(mapProject(found.row));
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [projectSlug]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

  // ── データ取得（自動ポーリングはしない） ────────────────
  /**
   * タブの中身を取る。取得できたら true を返す
   * （「更新」の進捗画面が、成功で閉じるか理由を出して留まるかを決めるのに使う）。
   *
   * onStep は工程が1つ終わるたびに呼ぶ。渡さなければ何も起きないので、
   * 進捗画面を出さない経路（タブを開いたときの取得など）はこれまでどおり動く。
   */
  const loadTab = useCallback(async (which: SubTab, force = false, onStep?: (key: RefreshStepKey) => void) => {
    if (!project?.id) return false;
    if (!force && loadedTabs[which]) return true;
    setFetching(true);
    setApiError("");
    try {
      if (which === "pulls") {
        // PR一覧と「PR未作成のブランチ」は並行して取り、まとめて反映する。
        // 別々に反映すると、PRを作った直後に「まだPRが作られていない」古い案内が
        // 一瞬だけ残り、そのあとマージの表示に切り替わって見えてしまう。
        // 未作成ブランチは付随情報なので、取れなくても一覧は表示する
        const [r, pendingBranches] = await Promise.all([
          fetchPulls(project.id).then(reportStep(onStep, "list")),
          fetchPendingBranches(project.id).then(p => p.branches).catch(() => [] as GithubPendingBranch[])
            .then(reportStep(onStep, "extra")),
        ]);
        setPulls(r.pulls); setLinks(r.links); setLevel(r.level); setRepo(r.repo);
        if (r.perms) setApiPerms(r.perms);
        setWriteBlock(r.writeBlock ?? null);
        setPending(pendingBranches);
        setSelected(new Set());
      } else if (which === "issues") {
        const r = await fetchIssues(project.id);
        onStep?.("list");
        setIssues(r.issues); setLevel(r.level); setRepo(r.repo);
      } else if (which === "commits") {
        const r = await fetchCommits(project.id, commitBranch || undefined);
        onStep?.("list");
        setCommits(r.commits); setRepo(r.repo);
        // 未指定ならサーバーが既定ブランチに寄せるので、その名前を受け取って選択欄に反映する
        setCommitBranch(r.branch);
      } else {
        // ブランチとチケットの紐付けも一緒に取る。名前が自由になった以上、
        // 一覧に「何のブランチか」が出ていないと読めない（BRU13-054）。
        // 紐付けは付随情報なので、取れなくても一覧そのものは出す
        const [r, linked] = await Promise.all([
          fetchBranches(project.id).then(reportStep(onStep, "list")),
          fetchTicketBranches(project.id).then(t => t.branches).catch(() => [] as TicketGithubBranch[])
            .then(reportStep(onStep, "extra")),
        ]);
        setBranches(r.branches); setDefaultBranch(r.defaultBranch); setRepo(r.repo);
        setTicketBranches(linked);
        if (r.perms) setApiPerms(r.perms);
      }
      setLoadedTabs(prev => ({ ...prev, [which]: true }));
      setFetchedAt(new Date().toISOString());
      return true;
    } catch (e) {
      setApiError(e instanceof GithubApiError ? e.message : "GitHubの情報を取得できませんでした。");
      return false;
    } finally {
      setFetching(false);
    }
  }, [project?.id, loadedTabs, commitBranch]);

  useEffect(() => {
    if (!project?.id || !access.linked || access.level === "none" || !access.level) return;
    void loadTab(tab);
  }, [project?.id, tab, access.linked, access.level, loadTab]);

  /**
   * 本番反映の状態を取る。取れなくても画面は成立するので、失敗は握って何も出さない
   * （押していない処理の失敗をトーストで知らせても直しようがない。BRU13-015 と同じ方針）。
   */
  const loadDeploy = useCallback(async () => {
    if (!project?.id) return;
    try {
      const r = await fetchDeployStatus(project.id);
      setDeploy(r.deploy);
    } catch {
      // すでに出している帯は消さない。取得に失敗しただけで消えると
      // 「直った」と誤って読まれる（BUG-02 と同じ考え方）
    }
  }, [project?.id]);

  useEffect(() => {
    if (!project?.id || !access.linked || access.level === "none" || !access.level) return;
    void loadDeploy();
  }, [project?.id, access.linked, access.level, loadDeploy]);

  /**
   * リポジトリ帯の「更新」。押した直後に進捗画面を出す。
   *
   * これまではボタンの文字が「更新中...」に変わるだけで、GitHub の応答が返るまでの
   * 数秒は画面が止まって見えていた。取りに行くものはタブごとに複数あり、しかも
   * 本番反映の確認は一覧とは別口なので、どこまで済んだかを工程で出す。
   *
   * 一覧と本番反映は並行して取る（順に待たせるとその分だけ完了が遅れる）。
   * 一覧の取得は中身を差し替えるだけでコンテンツを隠さないので、
   * 進捗画面を閉じてもそのまま最新に切り替わる（BUG-02／BUG-03 と同じ方針）。
   */
  const handleRefresh = useCallback(() => {
    if (fetching || !project?.id) return;
    if (refreshCloseRef.current) {
      window.clearTimeout(refreshCloseRef.current);
      refreshCloseRef.current = null;
    }
    setRefresh({ tab, done: [], state: "running" });
    // 閉じたあとに遅れて届いた報告で開き直さないよう、実行中のときだけ書き込む
    const mark = (key: RefreshStepKey) => setRefresh(prev => (
      prev && prev.state === "running" && !prev.done.includes(key)
        ? { ...prev, done: [...prev.done, key] }
        : prev
    ));
    void (async () => {
      const [ok] = await Promise.all([
        loadTab(tab, true, mark),
        // 失敗は loadDeploy が握って帯を残すので、ここでは終わったことだけ伝える
        loadDeploy().then(() => mark("deploy")),
      ]);
      setRefresh(prev => (prev ? { ...prev, state: ok ? "done" : "error" } : prev));
      // 失敗したときは閉じない。理由を読ませるため（マージの確認と同じ扱い）
      if (!ok) return;
      refreshCloseRef.current = window.setTimeout(() => {
        refreshCloseRef.current = null;
        setRefresh(null);
      }, REFRESH_CLOSE_MS);
    })();
  }, [fetching, project?.id, tab, loadTab, loadDeploy]);

  // 閉じる前に画面を離れたときのタイマー始末
  useEffect(() => () => {
    if (refreshCloseRef.current) window.clearTimeout(refreshCloseRef.current);
  }, []);

  /** 帯の「今すぐ確認」。本番へ問い合わせ直す */
  const handleDeployRecheck = async () => {
    if (!project?.id || deployChecking) return;
    setDeployChecking(true);
    try {
      const r = await runDeployCheck(project.id);
      setDeploy(r.deploy);
      if (r.deploy.state === "in-sync") toast("本番は最新です", "success");
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "本番反映を確認できませんでした", "error");
    } finally {
      setDeployChecking(false);
    }
  };

  /**
   * ブランチ一覧を一度だけ取る。PR作成ダイアログとコミットタブの切り替え欄で共用する。
   *
   * ここで loadedTabs.branches を立てるので、チケットとの紐付けも一緒に取っておく。
   * 取らないと「PR作成を開いてからブランチタブへ移る」経路で loadTab が
   * 「取得済み」と判断して素通りし、一覧に紐付いたチケットが出ないままになる
   */
  const ensureBranches = useCallback(async () => {
    if (!project?.id) return { list: branches, def: defaultBranch };
    if (loadedTabs.branches && branches.length) return { list: branches, def: defaultBranch };
    const [r, linked] = await Promise.all([
      fetchBranches(project.id),
      fetchTicketBranches(project.id).then(t => t.branches).catch(() => [] as TicketGithubBranch[]),
    ]);
    setBranches(r.branches); setDefaultBranch(r.defaultBranch); setTicketBranches(linked);
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

  // ブランチ作成ダイアログも分岐元の選択肢が要る。PR作成と同じくここで揃えてから開く
  const openCreateBranch = async () => {
    if (!project?.id) return;
    setPreparingBranch(true);
    try {
      const { list, def } = await ensureBranches();
      setBranchTarget({ branches: list, defaultBranch: def || project.githubDefaultBranch || "main" });
    } catch (e) {
      toast(e instanceof GithubApiError ? e.message : "ブランチを取得できませんでした", "error");
    } finally {
      setPreparingBranch(false);
    }
  };

  const toggleSelect = (n: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n); else next.add(n);
      return next;
    });
  };

  /**
   * 行を開いたときに引いた詳細を一覧側へ取り込む（BRU13-036）。
   *
   * GitHub の mergeable_state は要求されてから計算されるため、一覧の取得では
   * "unknown"（＝マージ可否は判定中）で返ってくることがある。行はその後に引き直した
   * 詳細を優先して出すので、取り込まないと「行のチェックボックスは押せるのに
   * 全件選択の母数には入っていない」という食い違いが残る。
   */
  const applyPullDetail = useCallback((detail: GithubPull) => {
    setPulls(prev => prev.map(p => (p.number === detail.number ? { ...p, ...detail } : p)));
  }, []);

  // マージできる状態のものだけを選択対象にする
  const mergeablePulls = useMemo(() => pulls.filter(p => !mergeBlockReason(p)), [pulls]);
  const selectedPulls = useMemo(() => pulls.filter(p => selected.has(p.number)), [pulls, selected]);
  const allMergeableSelected = useMemo(
    () => mergeablePulls.length > 0 && mergeablePulls.every(p => selected.has(p.number)),
    [mergeablePulls, selected],
  );

  // onMerged は「GitHub 側のマージが終わった」合図。ダイアログの進捗を次の段
  //（一覧の取り直し）へ進めるために呼ぶ
  const handleMerge = async (method: GithubMergeMethod, onMerged: () => void, reason: string) => {
    if (!project?.id || !mergeTarget) return;
    await mergePull(project.id, mergeTarget.number, method, reason, projectSlug ?? project.slug);
    onMerged();
    toast(`#${mergeTarget.number} をマージしました`, "success");
    // loadedTabs は落とさない。落とすと取り直しの間だけページ全体がローダーに変わり、
    // 進捗を出しているダイアログの裏で表示が二度切り替わって見える
    await loadTab("pulls", true);
    // マージした直後は必ず未反映になる。ここで取り直しておくと
    // 「マージしたのに本番に出ない」に最短で気づける
    void loadDeploy();
  };

  const isManager = userPermissions.canAccessAdminSettings;

  // パンくず・見出し・タブの並びは他のプロジェクト内ページ（バックログ／議事録など）に合わせる。
  // 読み込み中でも同じ枠を出したいので、先に組み立てて使い回す。
  // 🌟 パンくず〜プロジェクト内タブを画面上部に固定（スプリント管理と同じ扱い）。
  //   PRやIssueが増えると下スクロールでタブが見切れ、他画面へ移動できなくなっていた。
  //   margin の -24px は外側の padding を打ち消すため（背景を左右いっぱいに敷く）。
  //   padding の下 12px は詰めない。0にすると中の marginBottom がはみ出して
  //   背景の外に12pxの隙間ができ、そこをスクロール中の中身が通り抜けて見える。
  const pageHead = (
    <div style={{ position: "sticky", top: 0, zIndex: 200, background: "#F5F6F8", margin: "-24px -24px 0", padding: "24px 24px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 0 }}>
        {/* 🌟 BRU13-047: タブ(ProjectSubNav)は固定幅。幅が足りない時はこの見出し側が先に縮む */}
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>GitHub</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project?.name ?? "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="github" marginBottom={0} />
        </div>
      </div>
    </div>
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
          {/* 本番反映の状態（層C）。
              PRの一覧より上に置く。「マージは全部済んでいるのに本番に届いていない」は
              一覧をいくら眺めても分からず、この帯だけが伝えられる情報のため */}
          <DeployStatusBanner
            deploy={deploy}
            onRecheck={handleDeployRecheck}
            checking={deployChecking}
            canManage={isManager}
            onOpenSettings={() => navigate("/admin-settings?tab=github")}
          />

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
                <button onClick={handleRefresh} disabled={fetching}
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

              {/* 作成の入口は操作ごとの権限で出し分ける（BRU13-054）。
                  権限で必ず失敗する状態では押させない（理由はすぐ下の帯に出ている） */}
              {tab === "pulls" && perms.pull === "write" && (
                <button onClick={() => openCreatePull()} disabled={preparingCreate || !!writeBlock}
                  title={writeBlock ? writeBlock.message : undefined}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: preparingCreate || writeBlock ? "#9CA3AF" : BLACK, color: "#FFF", cursor: preparingCreate || writeBlock ? "not-allowed" : "pointer", whiteSpace: "nowrap" as const }}>
                  <GitPullRequest style={{ width: 13, height: 13 }} />
                  {preparingCreate ? "準備中..." : "プルリクエストを作成"}
                </button>
              )}

              {tab === "branches" && perms.branch === "write" && (
                <button onClick={openCreateBranch} disabled={preparingBranch}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 9, border: "none", background: preparingBranch ? "#9CA3AF" : BLACK, color: "#FFF", cursor: preparingBranch ? "not-allowed" : "pointer", whiteSpace: "nowrap" as const }}>
                  <GitBranch style={{ width: 13, height: 13 }} />
                  {preparingBranch ? "準備中..." : "ブランチを作成"}
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
                canCreate={perms.pull === "write"}
                onCreate={name => openCreatePull(name)}
              />
              {/* まとめてマージの操作バー。マージできるPRが2件以上あるときだけ出す */}
              {perms.merge === "write" && !writeBlock && mergeablePulls.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" as const, background: selected.size ? "#F0F9FF" : "#FFF", border: `1px solid ${selected.size ? "rgba(2,132,199,0.28)" : "rgba(26,23,20,0.09)"}`, borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" as const }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", fontSize: 12, color: "#4B4540" }}>
                      {/* 件数の一致で判定すると、母数（マージできるもの）に入っていないPRを
                          手で選んだ瞬間にチェックが外れて見える。「マージできるものが
                          全部入っているか」で判定し、外すときも自分の分だけ外す（BRU13-036） */}
                      <input type="checkbox"
                        checked={allMergeableSelected}
                        ref={el => { if (el) el.indeterminate = !allMergeableSelected && mergeablePulls.some(p => selected.has(p.number)); }}
                        onChange={e => {
                          // 更新関数は後で走ることがあるので、押した時点の状態を先に取り出す
                          const on = e.target.checked;
                          setSelected(prev => {
                            const next = new Set(prev);
                            for (const p of mergeablePulls) {
                              if (on) next.add(p.number); else next.delete(p.number);
                            }
                            return next;
                          });
                        }} />
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
                onMergeClick={setMergeTarget} onDetailLoaded={applyPullDetail}
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
            <BranchList branches={branches} ticketByBranch={ticketByBranch} />
          )}
        </>
      )}

      {refresh && (
        <RefreshProgressDialog
          tab={refresh.tab}
          done={refresh.done}
          state={refresh.state}
          message={apiError}
          onClose={() => setRefresh(null)}
        />
      )}

      {mergeTarget && (
        <MergeConfirmDialog
          pull={mergeTarget}
          repo={repo}
          actorName={userName}
          onClose={() => setMergeTarget(null)}
          onPrecheck={n => precheckMerge(project.id, [n])}
          onMerge={handleMerge}
        />
      )}

      {branchTarget && (
        <CreateBranchDialog
          projectId={project.id}
          repo={repo || project.githubRepoFullName || ""}
          branches={branchTarget.branches}
          defaultBranch={branchTarget.defaultBranch}
          onClose={() => setBranchTarget(null)}
          onCreated={async created => {
            toast(`ブランチ「${created.name}」を作成しました`, "success");
            await loadTab("branches", true);
          }}
        />
      )}

      {bulkTargets && bulkTargets.length > 0 && (
        <BulkMergeDialog
          pulls={bulkTargets}
          repo={repo}
          actorName={userName}
          onClose={() => setBulkTargets(null)}
          onPrecheck={numbers => precheckMerge(project.id, numbers)}
          onMerge={(numbers, method, reason, runId) =>
            mergePullsBulk(project.id, numbers, method, reason, projectSlug ?? project.slug, runId)}
          onDone={async () => {
            await loadTab("pulls", true);
            void loadDeploy();
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

/**
 * ブランチ一覧。Dev Ticket から作ったブランチには紐付いたチケットを添える（BRU13-054）。
 * ブランチ名を自由に決められるようにした以上、名前だけでは何のブランチか分からない。
 */
function BranchList({ branches, ticketByBranch }: {
  branches: GithubBranch[];
  ticketByBranch: Map<string, TicketGithubBranch>;
}) {
  if (branches.length <= 1) return <Empty>既定ブランチ以外のブランチはありません。</Empty>;
  return (
    <div style={{ background: "#FFF", border: "1px solid rgba(26,23,20,0.09)", borderRadius: 12, overflow: "hidden" }}>
      {branches.map((b, i) => {
        const linked = ticketByBranch.get(b.name);
        return (
          <div key={b.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 14px", borderBottom: i < branches.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", fontFamily: "var(--font-mono)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{b.name}</span>
              {linked && (
                <p style={{ fontSize: 11, color: "#0284C7", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
                  {linked.ticketWbs ?? "チケット"}{linked.ticketTitle ? ` ${linked.ticketTitle}` : ""}
                </p>
              )}
            </div>
            {b.isDefault && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#ECFDF5", color: "#059669" }}>既定</span>}
            {b.protected && <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10, background: "#FFFBEB", color: "#D97706" }}>保護</span>}
            <span style={{ fontSize: 11, color: "#B0A9A4", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{b.lastCommitSha.slice(0, 7)}</span>
          </div>
        );
      })}
    </div>
  );
}
