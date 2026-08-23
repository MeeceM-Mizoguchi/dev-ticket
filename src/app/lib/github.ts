// GitHub連携のフロント側クライアント（docs/github-integration-design.md）。
//
// トークンはサーバーにしか無いので、GitHub API は必ず /api/github/* 経由で叩く。
// 権限判定もサーバーでやり直されるため、ここでの level は表示の出し分け用でしかない。
import { supabase } from "@/lib/supabase";
import type {
  GithubStatus, GithubRepo, GithubPull, GithubIssue, GithubCommit, GithubBranch,
  TicketGithubLink, GithubMergeMethod, GithubAccessLevel, GithubReleaseSyncResult, GithubPendingBranch,
} from "@/app/types";

export class GithubApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
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
  if (!res.ok) throw new GithubApiError(res.status, json?.error ?? "処理に失敗しました。");
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
export function fetchPulls(projectId: string) {
  return call<{ pulls: GithubPull[]; level: GithubAccessLevel; repo: string; links: TicketGithubLink[] }>("pulls", { query: { projectId } });
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

/** まだプルリクエストが作られていないブランチ（新しい順） */
export function fetchPendingBranches(projectId: string) {
  return call<{ branches: GithubPendingBranch[]; defaultBranch: string; repo: string; level: GithubAccessLevel }>(
    "pending-branches", { query: { projectId } },
  );
}

export function fetchTicketLinks(projectId: string, ticketId: string) {
  return call<{ links: TicketGithubLink[]; level: GithubAccessLevel; repo: string }>("links", { query: { projectId, ticketId } });
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

export function mergePull(projectId: string, number: number, method: GithubMergeMethod) {
  return call<{ ok: true; sha: string | null }>("merge", { body: { projectId, number, method } });
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
