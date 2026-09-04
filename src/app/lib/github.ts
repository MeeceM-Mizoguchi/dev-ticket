// GitHub連携のフロント側クライアント（docs/github-integration-design.md）。
//
// トークンはサーバーにしか無いので、GitHub API は必ず /api/github/* 経由で叩く。
// 権限判定もサーバーでやり直されるため、ここでの level は表示の出し分け用でしかない。
import { supabase } from "@/lib/supabase";
import type {
  GithubStatus, GithubRepo, GithubPull, GithubIssue, GithubCommit, GithubBranch,
  TicketGithubLink, TicketGithubLinkCandidate, GithubMergeMethod, GithubAccessLevel,
  GithubReleaseSyncResult, GithubPendingBranch, GithubBulkMergeResult, GithubPermissionBlock,
  GithubMergePrecheckResult, GithubRequireChecksMode, GithubDeployStatus, GithubDeployOverview,
  GithubDeployLevel, GithubDeployCheckMode, GithubRunProgress, GithubPerms, TicketGithubBranch,
} from "@/app/types";

export class GithubApiError extends Error {
  status: number;
  /** 権限で止められたときだけ入る。直しに行く画面のURLを画面から出すために使う */
  permission?: GithubPermissionBlock;
  /**
   * 実行直前のコンフリクトチェックで止められたときだけ入る。
   * 画面で確認したあとに状態が変わった場合に返るので、どのPRで止まったかをそのまま出す
   */
  precheck?: GithubMergePrecheckResult;
  constructor(status: number, message: string, permission?: GithubPermissionBlock, precheck?: GithubMergePrecheckResult) {
    super(message);
    this.status = status;
    this.permission = permission;
    this.precheck = precheck;
  }
}

async function call<T>(resource: string, opts?: { query?: Record<string, string | number | undefined>; body?: unknown }): Promise<T> {
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) throw new GithubApiError(401, "ログインが必要です");

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(opts?.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
  }
  const url = `/api/github/${resource}${qs.toString() ? `?${qs}` : ""}`;

  const res = await fetch(url, {
    method: opts?.body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  const json = await res.json().catch(() => null) as any;
  if (!res.ok) throw new GithubApiError(res.status, json?.error ?? "処理に失敗しました。", json?.permission, json?.precheck);
  return json as T;
}

// ── セットアップ ─────────────────────────────────────────────
// orgId は owner が組織セレクタで他組織を扱うときだけ効く（サーバー側で owner 以外は無視される）。
export function fetchGithubStatus(orgId?: string | null) {
  return call<GithubStatus>("status", { query: { orgId: orgId ?? undefined } });
}

/**
 * インストール画面のURLを受け取って遷移する（サーバーが署名付き state を組み立てる）。
 *
 * 新規接続にも、2つ目以降のアカウントの追加にも、既に接続済みのアカウントの
 * 「リポジトリを追加・変更」にも、この1本を使う。GitHub の App インストール画面は
 * 誰が開いても 404 にならず、その人が管理できるアカウントだけを出してくれるため
 * （個別の /settings/installations/<id> は本人以外だと404になる。BRU14-014）。
 */
export async function startGithubInstall(orgId?: string | null): Promise<void> {
  const { url } = await call<{ url: string }>("install-start", { query: { orgId: orgId ?? undefined } });
  window.location.href = url;
}

/**
 * 接続しているアカウント全部のリポジトリ。
 * 一部のアカウントが切れていたら unavailableAccounts に入る（一覧は残りだけで返る）。
 */
export function fetchGithubReposDetail(orgId?: string | null) {
  return call<{ repos: GithubRepo[]; unavailableAccounts?: string[] }>(
    "repos", { query: { orgId: orgId ?? undefined } });
}

export function fetchGithubRepos(orgId?: string | null) {
  return fetchGithubReposDetail(orgId).then(r => r.repos);
}

/**
 * 接続を1つ解除する（installationId 省略で全部）。
 * GitHub 上の App インストールは残り、Dev Ticket 側の記録だけが消える。
 */
export function disconnectGithubInstallation(installationId?: string, orgId?: string | null) {
  return call<{ ok: true; removed: string[]; disabledProjects: number }>("disconnect", {
    query: { orgId: orgId ?? undefined },
    body: { installationId: installationId ?? "" },
  });
}

/**
 * GitHub 側に既にインストール済みの接続を、この組織の接続として取り込む。
 * コールバックが失敗して「GitHubには入っているのに Dev Ticket は未接続」になった状態からの復旧用。
 */
export function adoptGithubInstallation(installationId: string, orgId?: string | null) {
  return call<{ ok: true; accountLogin: string }>("adopt", {
    query: { orgId: orgId ?? undefined },
    body: { installationId },
  });
}

/**
 * 「リリース待ち」のうち、紐付いたPRが既定ブランチへマージ済みのチケットを
 * 「リリース済み」に反映する。定期実行と同じ処理を、この組織だけを対象に手動で走らせる。
 */
export function syncReleasedTickets(orgId?: string | null) {
  return call<GithubReleaseSyncResult>("sync-released", {
    query: { orgId: orgId ?? undefined },
    body: {},
  });
}

// ── 参照 ─────────────────────────────────────────────────────
/**
 * オープンなPRの一覧。
 * light を付けると CI・レビュー・マージ可否を引かない軽い応答になる。
 * 番号とタイトルだけあればよい用途（チケット詳細の紐付け候補）で使う
 */
export function fetchPulls(projectId: string, opts?: { light?: boolean }) {
  return call<{
    pulls: GithubPull[];
    level: GithubAccessLevel;
    repo: string;
    links: TicketGithubLink[];
    /** マージが権限で止まる状態なら入る（light では返らない） */
    writeBlock: GithubPermissionBlock | null;
    /** 失敗チェックをマージ前にどう扱うか（層A） */
    requireChecksMode?: GithubRequireChecksMode;
    /** 操作ごとの権限（BRU13-054）。SQL未適用のサーバーからは返らない */
    perms?: GithubPerms;
  }>("pulls", { query: { projectId, light: opts?.light ? 1 : undefined } });
}

export function fetchPull(projectId: string, number: number) {
  return call<{ pull: GithubPull; level: GithubAccessLevel }>("pull", { query: { projectId, number } });
}

export function fetchIssues(projectId: string) {
  return call<{ issues: GithubIssue[]; level: GithubAccessLevel; repo: string }>("issues", { query: { projectId } });
}

export function fetchCommits(projectId: string, branch?: string) {
  return call<{ commits: GithubCommit[]; branch: string; repo: string }>("commits", { query: { projectId, branch } });
}

export function fetchBranches(projectId: string) {
  return call<{ branches: GithubBranch[]; defaultBranch: string; repo: string; perms?: GithubPerms }>(
    "branches", { query: { projectId } },
  );
}

/**
 * まだプルリクエストが作られていないブランチ（新しい順）。
 * wbs を渡すと、その番号を含むブランチだけをサーバー側で絞ってから重い判定を掛ける。
 * チケット詳細のように1チケット分しか使わない場合は必ず渡すこと（応答が大幅に速くなる）
 *
 * ticketId も一緒に渡すこと。Dev Ticket から作ったブランチは名前を自由に決められるので、
 * 名前に WBS 番号が入っていないものは wbs だけでは絞り込みから漏れる（BRU13-054）。
 */
export function fetchPendingBranches(projectId: string, wbs?: string, ticketId?: string) {
  return call<{
    branches: GithubPendingBranch[]; defaultBranch: string; repo: string;
    level: GithubAccessLevel; perms?: GithubPerms;
  }>("pending-branches", { query: { projectId, wbs, ticketId } });
}

/**
 * Dev Ticket から作ったブランチとチケットの紐付け（BRU13-054）。
 * GitHub は叩かずDBだけを読むので、チケット詳細を開くたびに呼んでも軽い。
 */
export function fetchTicketBranches(projectId: string, ticketId?: string) {
  return call<{
    branches: TicketGithubBranch[]; level: GithubAccessLevel; perms?: GithubPerms;
    repo: string; defaultBranch: string;
  }>("ticket-branches", { query: { projectId, ticketId } });
}

export function fetchTicketLinks(projectId: string, ticketId: string) {
  return call<{
    links: TicketGithubLink[];
    /** 大文字小文字違いで自動紐付けを見送ったPR。人がどれか1件を選ぶ */
    candidates: TicketGithubLinkCandidate[];
    level: GithubAccessLevel;
    perms?: GithubPerms;
    repo: string;
  }>("links", { query: { projectId, ticketId } });
}

// ── 書き込み ─────────────────────────────────────────────────
//
// 取り消しの効かない操作（PR作成・マージ）には実行IDを付けて送る。
// サーバーは受け取った時点で「実行中」を1行残し、終わったら結果ごと書き換える
// （supabase/add_github_action_runs.sql）。
// タブを閉じても処理はサーバー側で走り切るので、開き直した画面はこの行を見て
// 進捗モーダルを出し直し、結果まで見届ける。

/**
 * 実行ID。記録の主キーになるので UUID の形で作る。
 * randomUUID が無い WebView 向けの受け皿も置く（形さえ合っていればよく、
 * 万一ぶつかっても記録の挿入が失敗して「記録なし」に落ちるだけで実行は通る）。
 */
export function newRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/**
 * 実行の記録に添える情報。
 * label は復帰したモーダルにそのまま出る一言、slug は「GitHubの画面をひらく」の行き先。
 */
function runFields(label: string, slug?: string, runId?: string) {
  return { runId: runId || newRunId(), runLabel: label, runSlug: slug };
}

/**
 * 実行の途中経過を引く（supabase/add_github_action_run_progress.sql）。
 *
 * まとめてマージはサーバー側の1リクエストで通しで走るので、応答が返るまで
 * 画面には何も届かない。実行中はこれを数秒おきに引いて「今どこか」を出す。
 * 途中経過は補助なので、列が未適用でも取れないだけ（null を返す）で実行には影響しない。
 */
export async function fetchRunProgress(runId: string): Promise<GithubRunProgress | null> {
  if (!supabase || !runId) return null;
  const { data, error } = await supabase
    .from("github_action_runs").select("progress").eq("id", runId).maybeSingle();
  if (error || !data?.progress) return null;
  return data.progress as GithubRunProgress;
}

/**
 * プルリクエストの作成。GitHub の画面へ行かずに Dev Ticket 側で完結させるためのもの。
 * projectSlug は実行の記録にだけ使う（復帰したモーダルからの戻り先）。
 */
export function createPull(projectId: string, input: {
  head: string; base: string; title: string; body: string; draft: boolean;
}, projectSlug?: string) {
  return call<{ ok: true; number: number | null; url: string | null; title: string }>(
    "create-pull", {
      body: {
        projectId, ...input,
        ...runFields(`プルリクエストを作成（${input.base} ← ${input.head}）`, projectSlug),
      },
    },
  );
}

/**
 * ブランチの作成（BRU13-054）。
 *
 * name は完全に自由。ticketId を渡すと「このブランチはこのチケットのもの」が
 * サーバー側に記録され、そのブランチから出たPRは名前が何であれチケットへ紐付く。
 * 逆に言えば ticketId を渡さないと、従来どおりブランチ名の WBS 番号頼みになる。
 *
 * 実行の記録（runId）は付けない。数百ミリ秒で終わるうえ、失敗しても作り直せるため。
 */
export function createBranch(projectId: string, input: { name: string; base: string; ticketId?: string }) {
  return call<{ ok: true; name: string; base: string; url: string; linked: boolean }>(
    "create-branch", { body: { projectId, ...input } },
  );
}

/**
 * マージ前のコンフリクトチェック。実行はしない。
 *
 * 1件でも通らなければ1件もマージしない、を画面から先に確かめるためのもの。
 * まとめてマージでも1件のマージでも、必ずこれを通してから実行する（BRU13-038）
 */
export function precheckMerge(projectId: string, numbers: number[]) {
  return call<GithubMergePrecheckResult>("merge-precheck", { body: { projectId, numbers } });
}

/**
 * reason は「失敗しているチェックがあるのに続ける」ときの理由（層A）。
 * 空のまま送ると、対象プロジェクトの設定によっては 409 が返って理由を求められる。
 * 書かれた理由は監査ログ（github_action_logs）に残る。
 */
export function mergePull(
  projectId: string, number: number, method: GithubMergeMethod, reason?: string, projectSlug?: string,
) {
  return call<{ ok: true; sha: string | null }>("merge", {
    body: { projectId, number, method, reason, ...runFields(`#${number} をマージ`, projectSlug) },
  });
}

/**
 * 選択した複数のPRを、確認してから1件ずつ順番にマージする。
 *
 * サーバー側では「単独のマージ可否 → 捨てブランチでの試しマージ → 本番のマージ」を
 * 通しで走らせる（BRU13-042）。数十秒かかることがあるので、呼ぶ側は runId を先に作って
 * 渡し、実行中は fetchRunProgress() で途中経過を引きながら待つ。
 */
export function mergePullsBulk(
  projectId: string, numbers: number[], method: GithubMergeMethod, reason?: string,
  projectSlug?: string, runId?: string,
) {
  return call<GithubBulkMergeResult>("merge-bulk", {
    body: {
      projectId, numbers, method, reason,
      ...runFields(`${numbers.length}件をまとめてマージ`, projectSlug, runId),
    },
  });
}

export function reviewPull(projectId: string, number: number, event: "APPROVE" | "REQUEST_CHANGES", body: string) {
  return call<{ ok: true }>("review", { body: { projectId, number, event, body } });
}

export function commentOnPull(projectId: string, number: number, body: string) {
  return call<{ ok: true }>("comment", { body: { projectId, number, body } });
}

export function linkTicket(projectId: string, ticketId: string, kind: "pull" | "issue", number: number) {
  return call<{ link: TicketGithubLink | null }>("link", { body: { projectId, ticketId, kind, number } });
}

export function unlinkTicket(projectId: string, id: number) {
  return call<{ ok: true }>("unlink", { body: { projectId, id } });
}

/**
 * 大文字小文字違いで割れていた候補から1件を選んで確定する。
 * 選ばれなかったPRの自動紐付けは外れ、以後この候補は出てこない。
 */
export function resolveLinkCandidate(projectId: string, ticketId: string, number: number) {
  return call<{ ok: true; number: number }>("resolve-candidate", { body: { projectId, ticketId, number } });
}

/**
 * リポジトリを紐付けた直後に、過去のPRを1回だけ遡って紐付ける。
 * 同じリポジトリで2回目以降は skipped:true が返るだけで、GitHub は叩かない。
 */
export function backfillGithubLinks(projectId: string) {
  return call<{ ok: true; skipped: boolean; scanned: number }>("backfill-links", { body: { projectId } });
}

// ── 本番反映の確認（docs/deploy-verification-design.md） ──────
//
// 「マージした」と「本番に届いた」は別の事実。
// GitHub 上のマージだけを見ていると、デプロイが止まっていても全件リリース済みに見える。

/**
 * このプロジェクトの本番反映の状態。
 * 観測結果はサーバー側に保存されていて、古ければ取得のついでに取り直される。
 * fresh を付けると必ず取り直す。
 */
export function fetchDeployStatus(projectId: string, opts?: { fresh?: boolean }) {
  return call<{ deploy: GithubDeployStatus; level: GithubAccessLevel }>(
    "deploy-status", { query: { projectId, fresh: opts?.fresh ? 1 : undefined } },
  );
}

/** 「今すぐ確認する」。本番へ問い合わせて観測をやり直す */
export function runDeployCheck(projectId: string) {
  return call<{ deploy: GithubDeployStatus; level: GithubAccessLevel }>(
    "deploy-check", { body: { projectId } },
  );
}

/** 外部連携画面の診断（組織全体の未保護・未設定・遅延） */
export function fetchDeployOverview(orgId?: string | null) {
  return call<GithubDeployOverview>("deploy-overview", { query: { orgId: orgId ?? undefined } });
}

/** 遅れ具合の見せ方。時間で色と言い方を変える */
export const DEPLOY_LEVEL_TONE: Record<GithubDeployLevel, { bg: string; border: string; text: string }> = {
  none:     { bg: "#F0F9FF", border: "rgba(2,132,199,0.28)", text: "#075985" },
  notice:   { bg: "#FFFBEB", border: "rgba(217,119,6,0.28)", text: "#92400E" },
  slack:    { bg: "#FFFBEB", border: "rgba(217,119,6,0.40)", text: "#92400E" },
  critical: { bg: "#FEF2F2", border: "rgba(220,38,38,0.35)", text: "#B91C1C" },
};

/** 「8時間前から」のような経過表示。遅れの重さは日数ではなく時間で伝わる */
export function elapsedSince(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(m, 1)}分`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}時間`;
  return `${Math.floor(h / 24)}日`;
}

// ── 表示ヘルパー ─────────────────────────────────────────────

/** 「まだマージできない理由」。null ならマージ可能（docs 7-2 の表） */
export function mergeBlockReason(p: Pick<GithubPull, "draft" | "merged" | "mergeable" | "mergeableState">): string | null {
  if (p.merged) return "すでにマージされています";
  if (p.draft) return "Draft のためマージできません";
  switch (p.mergeableState) {
    case "clean": return null;
    case "dirty": return "コンフリクトがあります";
    case "blocked": return "必須チェックまたはレビュー承認が不足しています";
    case "behind": return "ベースブランチより古いため更新が必要です";
    case "draft": return "Draft のためマージできません";
    case "unknown": return "GitHub側で判定中です";
    default:
      if (p.mergeable === false) return "コンフリクトがあります";
      // 一覧の下位（実データを引いていない分）は状態が不明。
      // ここでボタンを塞ぐと「詳細を開かないとマージできない」体験になるので通す。
      // マージ可否はサーバー側の merge が実行前に必ず引き直して判定する。
      return null;
  }
}

const MERGE_METHOD_KEY = "github_merge_method";

export function loadMergeMethod(): GithubMergeMethod {
  const v = localStorage.getItem(MERGE_METHOD_KEY);
  return v === "merge" || v === "rebase" || v === "squash" ? v : "squash";
}

export function saveMergeMethod(v: GithubMergeMethod) {
  localStorage.setItem(MERGE_METHOD_KEY, v);
}

export const MERGE_METHOD_LABELS: Record<GithubMergeMethod, string> = {
  merge: "マージコミットを作成",
  squash: "スカッシュしてマージ",
  rebase: "リベースしてマージ",
};

/** マージ前に失敗チェックをどう扱うか（層A）。プロジェクト設定のセレクトに出す */
export const REQUIRE_CHECKS_LABELS: Record<GithubRequireChecksMode, string> = {
  off: "何もしない",
  warn: "警告を出す（マージは可能）",
  reason: "理由を入力しないとマージできない",
  block: "マージさせない",
};

/** 本番反映の確認をどこまで効かせるか（層B）。プロジェクト設定のセレクトに出す */
export const DEPLOY_MODE_LABELS: Record<GithubDeployCheckMode, string> = {
  off: "確認しない（マージ＝リリース済み）",
  warn: "確認して警告を出す（ステータスは進める）",
  gate: "本番へ反映されるまで「リリース済み」にしない",
};

/** 「3分前」形式。GitHub の日時をそのまま出すと読みにくいため */
export function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.floor((Date.now() - d) / 1000);
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}日前`;
  const dt = new Date(iso);
  return `${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}`;
}
