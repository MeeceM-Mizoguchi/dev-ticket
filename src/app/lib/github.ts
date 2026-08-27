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
  GithubDeployLevel, GithubDeployCheckMode,
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

/** インストール画面のURLを受け取って遷移する（サーバーが署名付き state を組み立てる） */
export async function startGithubInstall(orgId?: string | null): Promise<void> {
  const { url } = await call<{ url: string }>("install-start", { query: { orgId: orgId ?? undefined } });
  window.location.href = url;
}

export function fetchGithubRepos(orgId?: string | null) {
  return call<{ repos: GithubRepo[] }>("repos", { query: { orgId: orgId ?? undefined } }).then(r => r.repos);
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
  return call<{ branches: GithubBranch[]; defaultBranch: string; repo: string }>("branches", { query: { projectId } });
}

/**
 * まだプルリクエストが作られていないブランチ（新しい順）。
 * wbs を渡すと、その番号を含むブランチだけをサーバー側で絞ってから重い判定を掛ける。
 * チケット詳細のように1チケット分しか使わない場合は必ず渡すこと（応答が大幅に速くなる）
 */
export function fetchPendingBranches(projectId: string, wbs?: string) {
  return call<{ branches: GithubPendingBranch[]; defaultBranch: string; repo: string; level: GithubAccessLevel }>(
    "pending-branches", { query: { projectId, wbs } },
  );
}

export function fetchTicketLinks(projectId: string, ticketId: string) {
  return call<{
    links: TicketGithubLink[];
    /** 大文字小文字違いで自動紐付けを見送ったPR。人がどれか1件を選ぶ */
    candidates: TicketGithubLinkCandidate[];
    level: GithubAccessLevel;
    repo: string;
  }>("links", { query: { projectId, ticketId } });
}

// ── 書き込み ─────────────────────────────────────────────────

/** プルリクエストの作成。GitHub の画面へ行かずに Dev Ticket 側で完結させるためのもの */
export function createPull(projectId: string, input: {
  head: string; base: string; title: string; body: string; draft: boolean;
}) {
  return call<{ ok: true; number: number | null; url: string | null; title: string }>(
    "create-pull", { body: { projectId, ...input } },
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
export function mergePull(projectId: string, number: number, method: GithubMergeMethod, reason?: string) {
  return call<{ ok: true; sha: string | null }>("merge", { body: { projectId, number, method, reason } });
}

/** 選択した複数のPRを、1件ずつ順番にマージする */
export function mergePullsBulk(projectId: string, numbers: number[], method: GithubMergeMethod, reason?: string) {
  return call<GithubBulkMergeResult>("merge-bulk", { body: { projectId, numbers, method, reason } });
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
