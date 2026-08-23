// ============================================================
// GitHub連携（docs/github-integration-design.md）
//
//   GET  /api/github/install-start?orgId=xxx      … App のインストール画面へ飛ばす
//   GET  /api/github/install-callback             … GitHub から戻ってくる着地点
//   GET  /api/github/status                       … セットアップ状態（画面の分岐に使う）
//   GET  /api/github/repos                        … インストールで許可されたリポジトリ
//   GET  /api/github/pulls?projectId=             … PR一覧
//   GET  /api/github/pull?projectId=&number=      … PR詳細（マージ可否・チェック）
//   GET  /api/github/issues?projectId=
//   GET  /api/github/commits?projectId=&branch=
//   GET  /api/github/branches?projectId=
//   GET  /api/github/links?projectId=&ticketId=   … チケットに紐付いたPR/Issue
//   POST /api/github/merge     { projectId, number, method }
//   POST /api/github/review    { projectId, number, event, body }
//   POST /api/github/comment   { projectId, number, body }
//   POST /api/github/link      { projectId, ticketId, kind, number }
//   POST /api/github/unlink    { projectId, id }
//
// 認証は「ログイン中ユーザーの Supabase アクセストークン」。
//   Authorization: Bearer <supabase access_token>
//
// ★ 権限はここで必ずやり直す ★
//   ブラウザ側の githubPermission は表示の出し分け用でしかない。
//   installation token はリポジトリへの書き込み権限を持つため、
//   「読み取り=view以上 / 書き込み=merge」をサーバーで判定してから GitHub を叩く。
//
// ★ このファイルは自己完結させている ★
//   Vercel のサーバー関数は src/ を同梱しないため（api/v1/[resource].ts と同じ事情）。
//   エンドポイントを1ファイルにまとめているのも、認証と権限判定を複製しないため。
// ============================================================
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

const GITHUB_API = "https://api.github.com";
const UA = "dev-ticket";

// @vercel/node の型チェックが auth.getUser を解決できないケースがあるため型だけ緩める
type AuthLike = { getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }> };

type GithubLevel = "none" | "view" | "merge";

function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function publicUrl(): string {
  return process.env.PUBLIC_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");
}

function appConfigured(): boolean {
  return !!(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_SLUG);
}

function visibility(): "private" | "public" {
  return process.env.GITHUB_APP_VISIBILITY === "private" ? "private" : "public";
}

// ── GitHub App の認証 ────────────────────────────────────────
/**
 * 環境変数に貼られた PEM を整える。
 * ・Vercel に1行で入れると改行が `\n` のままになる
 * ・Windows で開いた .pem をコピーすると CRLF が混ざり、Node の PEM パーサが弾く
 * ・前後に引用符が付いたまま貼られることがある
 */
function privateKeyPem(): string {
  // PEM は改行が意味を持つため、環境変数に貼る過程で壊れやすい。
  // 壊れない入れ方として、PEM 全体を base64 にしたものを
  // GITHUB_APP_PRIVATE_KEY_BASE64 に入れる方法も受け付ける（こちらを優先）。
  const b64 = (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || "").trim();
  let pem = b64
    ? Buffer.from(b64.replace(/\s+/g, ""), "base64").toString("utf8")
    : (process.env.GITHUB_APP_PRIVATE_KEY || "").trim();

  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) {
    pem = pem.slice(1, -1);
  }

  // GITHUB_APP_PRIVATE_KEY 側に base64 を入れられていた場合も拾う
  if (!pem.includes("-----BEGIN") && pem.length > 100 && /^[A-Za-z0-9+/=\s]+$/.test(pem)) {
    const decoded = Buffer.from(pem.replace(/\s+/g, ""), "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) pem = decoded;
  }

  pem = pem.replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

  // 環境変数の入力欄に貼ったときに改行が空白へ潰されることがある。
  // 見出しは残っているのに改行が足りない場合は、64文字ごとに折り返して組み直す。
  const m = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END ([A-Z0-9 ]+)-----/);
  if (m && (pem.match(/\n/g) ?? []).length < 3) {
    const body = m[2].replace(/\s+/g, "");
    const lines = body.match(/.{1,64}/g) ?? [];
    pem = `-----BEGIN ${m[1]}-----\n${lines.join("\n")}\n-----END ${m[3]}-----\n`;
  } else if (m && !pem.endsWith("\n")) {
    pem += "\n";
  }
  return pem;
}

/**
 * 鍵の「形」だけを説明する。値そのものは絶対に出さない。
 * DECODER エラーは原因が分からないので、どこが壊れているかを管理者に伝えるためのもの。
 */
function privateKeyShape(): string {
  const b64 = (process.env.GITHUB_APP_PRIVATE_KEY_BASE64 || "").trim();
  const raw = (process.env.GITHUB_APP_PRIVATE_KEY || "").trim();
  const source = b64 ? "GITHUB_APP_PRIVATE_KEY_BASE64" : "GITHUB_APP_PRIVATE_KEY";
  const value = b64 || raw;
  if (!value) return `${source} が空です`;

  const pem = privateKeyPem();
  const head = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----/);
  const body = pem.replace(/-----[^-]*-----/g, "").replace(/\s+/g, "");
  const parts = [
    `変数=${source}`,
    `長さ=${value.length}`,
    head ? `見出し=${head[1]}` : "見出し=見つかりません",
    `終端=${/-----END [A-Z0-9 ]+-----/.test(pem) ? "あり" : "なし"}`,
    `改行=${(pem.match(/\n/g) ?? []).length}`,
    `本文=${body.length}文字`,
    `本文がbase64として妥当=${body.length > 0 && /^[A-Za-z0-9+/=]+$/.test(body) ? "はい" : "いいえ"}`,
  ];
  return parts.join(" / ");
}

/**
 * App 自身を名乗る JWT。
 * exp は GitHub 側の上限がちょうど10分なので、境界で弾かれないよう余裕を持たせている
 * （iat を60秒戻したうえで exp は +7分。iat からの幅は8分）。
 */
function appJwt(): string {
  const appId = process.env.GITHUB_APP_ID!;
  const now = Math.floor(Date.now() / 1000);
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iat: now - 60, exp: now + 420, iss: appId })}`;
  try {
    const sig = crypto.sign("RSA-SHA256", Buffer.from(data), privateKeyPem()).toString("base64url");
    return `${data}.${sig}`;
  } catch (e) {
    // 鍵の形式が壊れているとここで落ちる。原因が分かる文言にして上へ投げる
    throw new GithubError(500, `GITHUB_APP_PRIVATE_KEY を秘密鍵として読み込めませんでした（${(e as Error)?.message ?? ""}）`);
  }
}

/**
 * installation token は1時間有効。Vercel のインスタンスが使い回される間だけ効く
 * 軽いキャッシュを持たせる（毎回取り直しても動くが、レート制限に効く）。
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function installationToken(installationId: string): Promise<string> {
  const hit = tokenCache.get(installationId);
  // 残り5分を切ったら取り直す
  if (hit && hit.expiresAt - Date.now() > 5 * 60_000) return hit.token;

  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appJwt()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new GithubError(res.status, `installation token の取得に失敗しました: ${body.slice(0, 200)}`);
  }
  const json = await res.json() as { token: string; expires_at: string };
  tokenCache.set(installationId, { token: json.token, expiresAt: new Date(json.expires_at).getTime() });
  return json.token;
}

class GithubError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function gh(token: string, path: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(path.startsWith("http") ? path : `${GITHUB_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": UA,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => null) as any;
  if (!res.ok) throw new GithubError(res.status, json?.message || `GitHub API エラー (${res.status})`);
  return json;
}

/** GitHub の英語メッセージをそのまま出さない（docs/github-integration-design.md 8-7） */
function jaMessage(e: unknown): { status: number; message: string } {
  if (e instanceof GithubError) {
    const raw = (e.message || "").toLowerCase();
    if (e.status === 401 || e.status === 404) {
      if (raw.includes("installation")) {
        return { status: 502, message: "GitHubとの接続が解除されています。管理者に再接続を依頼してください。" };
      }
      return { status: 502, message: "リポジトリにアクセスできません。GitHub側で Dev Ticket の許可対象から外れた可能性があります。" };
    }
    if (e.status === 403 && raw.includes("rate limit")) {
      return { status: 429, message: "GitHubのリクエスト上限に達しました。しばらく待ってから「更新」を押してください。" };
    }
    if (e.status === 405 || raw.includes("not mergeable")) {
      return { status: 409, message: "コンフリクトがあるためマージできません。GitHub上で解消してください。" };
    }
    if (e.status === 409) {
      return { status: 409, message: "ベースブランチが更新されているためマージできません。最新化してから再度お試しください。" };
    }
    if (e.status === 422) {
      return { status: 422, message: "ブランチ保護の条件を満たしていないためマージできません（必須レビューまたは必須チェック）。" };
    }
    return { status: 502, message: "GitHubとの通信に失敗しました。時間をおいて再度お試しください。" };
  }
  return { status: 500, message: "処理に失敗しました。時間をおいて再度お試しください。" };
}

// ── 呼び出し元の特定 ─────────────────────────────────────────
interface Caller {
  id: string;
  name: string;
  role: string;
  organizationId: string | null;
}

async function getCaller(sb: SupabaseClient, req: any): Promise<Caller | null> {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  const { data, error } = await (sb.auth as unknown as AuthLike).getUser(token);
  if (error || !data?.user) return null;

  const { data: profile } = await sb
    .from("profiles").select("name, role, organization_id").eq("id", data.user.id).maybeSingle();
  if (!profile) return null;

  return {
    id: data.user.id,
    name: (profile.name as string) ?? "",
    role: (profile.role as string) ?? "",
    organizationId: (profile.organization_id as string | null) ?? null,
  };
}

/**
 * githubPermission の解決。
 *   ① project_member_permissions（個別）
 *   ② 所属している permission_groups
 *   ③ roles.base_permissions
 *   ④ owner は常に merge
 * PermissionsPage / AuthContext と同じ優先順位にしてある。
 */
async function resolveGithubLevel(sb: SupabaseClient, caller: Caller, projectId: string): Promise<GithubLevel> {
  if (caller.role === "owner") return "merge";

  const { data: individual } = await sb
    .from("project_member_permissions")
    .select("permissions")
    .eq("project_id", projectId)
    .eq("member_id", caller.id)
    .maybeSingle();
  const fromIndividual = (individual?.permissions as any)?.githubPermission as GithubLevel | undefined;
  if (fromIndividual) return fromIndividual;

  const { data: memberships } = await sb
    .from("group_members").select("group_id").eq("member_id", caller.id);
  const groupIds = (memberships ?? []).map(m => (m as any).group_id);
  if (groupIds.length) {
    const { data: groups } = await sb
      .from("permission_groups").select("permissions").in("id", groupIds);
    // 複数グループに属している場合は強いほうを採用する（既存の権限も同じ考え方）
    let best: GithubLevel = "none";
    for (const g of groups ?? []) {
      const lv = (g as any).permissions?.githubPermission as GithubLevel | undefined;
      if (lv === "merge") return "merge";
      if (lv === "view") best = "view";
    }
    if (best !== "none") return best;
  }

  const { data: role } = await sb
    .from("roles").select("base_permissions").eq("name", caller.role).maybeSingle();
  const fromRole = (role?.base_permissions as any)?.githubPermission as GithubLevel | undefined;
  if (fromRole) return fromRole;

  // roles テーブルが未seedの環境では admin / PM を merge にフォールバック（AuthContext と同じ）
  if (caller.role === "admin" || caller.role === "project-manager") return "merge";
  return "none";
}

interface ProjectCtx {
  id: string;
  organizationId: string | null;
  repo: string;
  defaultBranch: string;
  installationId: string;
  level: GithubLevel;
}

/**
 * プロジェクト配下のAPIで毎回行う一式:
 *   プロジェクトの実在 → 同一組織か → メンバーか → githubPermission → installation。
 * 足りなければ Error を投げ、呼び出し側が 4xx にして返す。
 */
async function projectContext(sb: SupabaseClient, caller: Caller, projectId: string, need: "view" | "merge"): Promise<ProjectCtx> {
  const { data: project } = await sb
    .from("projects")
    .select("id, organization_id, members, github_repo_full_name, github_default_branch, github_enabled")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) throw new HttpError(404, "プロジェクトが見つかりません。");

  const orgId = (project.organization_id as string | null) ?? null;
  if (caller.role !== "owner" && String(orgId) !== String(caller.organizationId)) {
    throw new HttpError(404, "プロジェクトが見つかりません。");
  }

  // projects.members は「メンバー名(profiles.name)の配列」。can_access_project() と同じ判定。
  const members = (project.members as string[] | null) ?? [];
  const isManager = caller.role === "owner" || caller.role === "admin" || caller.role === "project-manager";
  if (!isManager && !members.includes(caller.name)) {
    throw new HttpError(403, "このプロジェクトにアクセスできません。");
  }

  const level = await resolveGithubLevel(sb, caller, projectId);
  if (level === "none" || (need === "merge" && level !== "merge")) {
    throw new HttpError(403, need === "merge"
      ? "GitHubのマージ権限がありません。管理者にご相談ください。"
      : "GitHubの閲覧権限が付与されていません。管理者にご相談ください。");
  }

  const repo = (project.github_repo_full_name as string | null) ?? "";
  if (!repo || project.github_enabled !== true) {
    throw new HttpError(409, "このプロジェクトにはGitHubリポジトリが紐付いていません。");
  }

  const installationId = await getInstallationId(sb, orgId);
  return {
    id: projectId,
    organizationId: orgId,
    repo,
    defaultBranch: (project.github_default_branch as string | null) || "",
    installationId,
    level,
  };
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function getInstallationId(sb: SupabaseClient, orgId: string | null): Promise<string> {
  const { data } = await sb
    .from("github_installations")
    .select("installation_id, revoked_at")
    .eq("organization_id", String(orgId ?? ""))
    .maybeSingle();
  if (!data || data.revoked_at) {
    throw new HttpError(409, "GitHubとの接続が解除されています。管理者に再接続を依頼してください。");
  }
  return data.installation_id as string;
}

// ── 変換 ─────────────────────────────────────────────────────
const WBS_RE = /[A-Z][A-Z0-9]*-\d+/g;

/** ブランチ名とタイトルからWBS番号を拾う。誤検出を人が判断できるよう根拠も返す */
function detectWbs(head: string, title: string): { list: string[]; reason: string | null } {
  const fromHead = (head.toUpperCase().match(WBS_RE) ?? []);
  const fromTitle = (title.toUpperCase().match(WBS_RE) ?? []);
  const list = Array.from(new Set([...fromHead, ...fromTitle]));
  if (!list.length) return { list, reason: null };
  const reason = fromHead.length ? `ブランチ名 ${fromHead[0]}` : `タイトル ${fromTitle[0]}`;
  return { list, reason };
}

function mapUser(u: any) {
  return { login: u?.login ?? "", avatarUrl: u?.avatar_url ?? "" };
}

function mapPull(p: any) {
  const head = p.head?.ref ?? "";
  const det = detectWbs(head, p.title ?? "");
  return {
    number: p.number,
    title: p.title ?? "",
    url: p.html_url ?? "",
    state: p.state,
    draft: !!p.draft,
    merged: !!p.merged_at,
    user: mapUser(p.user),
    base: p.base?.ref ?? "",
    head,
    // check-runs はブランチ名でも引けるが、fork からのPRだと base 側に同名ブランチが
    // 無く 404 になる。SHA なら常に引けるのでこちらを使う。
    headSha: p.head?.sha ?? "",
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    mergeable: p.mergeable ?? null,
    mergeableState: p.mergeable_state ?? null,
    checkState: "none" as const,
    checkSummary: "",
    reviewState: "pending" as const,
    reviewSummary: "",
    detectedWbs: det.list,
    autoReason: det.reason,
  };
}

/** チェック結果を1つの状態にまとめる */
function summarizeChecks(runs: any[]): { state: "success" | "failure" | "pending" | "none"; summary: string; checks: { name: string; state: any }[] } {
  if (!runs.length) return { state: "none", summary: "チェックなし", checks: [] };
  const checks = runs.map(r => ({
    name: r.name as string,
    state: r.status !== "completed"
      ? "pending"
      : (r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped") ? "success" : "failure",
  }));
  const failure = checks.filter(c => c.state === "failure").length;
  const pending = checks.filter(c => c.state === "pending").length;
  if (failure) return { state: "failure", summary: `CI ${failure}件失敗`, checks };
  if (pending) return { state: "pending", summary: `CI 実行中(${checks.length - pending}/${checks.length})`, checks };
  return { state: "success", summary: `CI ${checks.length}件成功`, checks };
}

function summarizeReviews(reviews: any[]): { state: "approved" | "changes_requested" | "pending"; summary: string } {
  // 同じ人が複数回レビューしている場合は最後のものだけを見る
  const latest = new Map<string, string>();
  for (const r of reviews) {
    if (r.state === "COMMENTED") continue;
    latest.set(r.user?.login ?? "", r.state);
  }
  const states = Array.from(latest.values());
  const changes = states.filter(s => s === "CHANGES_REQUESTED").length;
  const approved = states.filter(s => s === "APPROVED").length;
  if (changes) return { state: "changes_requested", summary: `変更依頼 ${changes}件` };
  if (approved) return { state: "approved", summary: `${approved}件承認` };
  return { state: "pending", summary: "未承認" };
}

// ── ハンドラ ─────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const resource = String(req.query?.resource ?? "");

  // GitHub からの着地だけは Bearer が付けられないので、認証の前に処理する
  if (resource === "install-callback") return installCallback(req, res);

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "サーバー設定エラーが発生しました" }); }

  const caller = await getCaller(sb, req);
  if (!caller) return res.status(401).json({ error: "認証が必要です" });

  try {
    switch (resource) {
      case "install-start": return await installStart(sb, caller, req, res);
      case "adopt":    return await handleAdopt(sb, caller, req, res);
      case "status":   return await handleStatus(sb, caller, req, res);
      case "repos":    return await handleRepos(sb, caller, req, res);
      case "pulls":    return await handlePulls(sb, caller, req, res);
      case "pull":     return await handlePull(sb, caller, req, res);
      case "issues":   return await handleIssues(sb, caller, req, res);
      case "commits":  return await handleCommits(sb, caller, req, res);
      case "branches": return await handleBranches(sb, caller, req, res);
      case "links":    return await handleLinks(sb, caller, req, res);
      case "merge":    return await handleMerge(sb, caller, req, res);
      case "review":   return await handleReview(sb, caller, req, res);
      case "comment":  return await handleComment(sb, caller, req, res);
      case "link":     return await handleLink(sb, caller, req, res);
      case "unlink":   return await handleUnlink(sb, caller, req, res);
      default:         return res.status(404).json({ error: "Not Found" });
    }
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    const m = jaMessage(e);
    console.error("[github]", resource, (e as Error)?.message);
    return res.status(m.status).json({ error: m.message });
  }
}

// ── インストール ─────────────────────────────────────────────
/**
 * state は「どのDev Ticket組織の接続か」を GitHub 経由で持ち回るために使う。
 * 改ざんされると別組織に接続情報を書き込めてしまうため HMAC で署名する。
 */
function signState(orgId: string, userId: string): string {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const payload = Buffer.from(JSON.stringify({ o: orgId, u: userId, t: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", `dev-ticket:github-state:${secret}`).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

function verifyState(state: string): { orgId: string; userId: string } | null {
  const [payload, sig] = String(state).split(".");
  if (!payload || !sig) return null;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const expect = crypto.createHmac("sha256", `dev-ticket:github-state:${secret}`).update(payload).digest("base64url");
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    // 30分で失効させる（放置されたタブからの着地を防ぐ）
    if (Date.now() - Number(json.t) > 30 * 60_000) return null;
    return { orgId: String(json.o ?? ""), userId: String(json.u ?? "") };
  } catch { return null; }
}

/**
 * インストール先URLを組み立てて返す（リダイレクトはブラウザ側で行う）。
 * サーバーが 302 する形にすると、アクセストークンをクエリに載せる必要が出て
 * URL やアクセスログに残ってしまうため、JSON で返している。
 */
/**
 * 対象組織の決定。owner は組織セレクタで他組織も扱えるので、明示された orgId を許す。
 * それ以外は自分の組織に固定する（クエリを差し替えても他組織は触れない）。
 */
function targetOrgId(caller: Caller, req: any): string {
  const requested = String(req.query?.orgId ?? "");
  if (requested && caller.role === "owner") return requested;
  return String(caller.organizationId ?? "");
}

/** 組織の外部連携を書き換えてよい人か（画面側の canAccessAdminSettings と同じ判定） */
async function requireOrgAdmin(sb: SupabaseClient, caller: Caller) {
  if (caller.role === "owner" || caller.role === "admin") return;
  const { data } = await sb.from("roles").select("base_permissions").eq("name", caller.role).maybeSingle();
  if ((data?.base_permissions as any)?.canAccessAdminSettings === true) return;
  throw new HttpError(403, "外部連携の設定を変更する権限がありません。");
}

async function installStart(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  await requireOrgAdmin(sb, caller);
  if (!appConfigured()) throw new HttpError(500, "GitHub App がサーバーに設定されていません。");
  const orgId = targetOrgId(caller, req);
  if (!orgId) throw new HttpError(400, "組織が特定できません。");

  const state = signState(orgId, caller.id);
  const url = `https://github.com/apps/${encodeURIComponent(process.env.GITHUB_APP_SLUG!)}/installations/new`
    + `?state=${encodeURIComponent(state)}`;
  return res.status(200).json({ url });
}

async function installCallback(req: any, res: any) {
  const back = `${publicUrl()}/admin-settings?tab=github`;
  const fail = (msg: string) => res.redirect(302, `${back}&github=error&message=${encodeURIComponent(msg)}`);

  const { installation_id: installationId, state, setup_action: setupAction } = req.query ?? {};
  if (!installationId) return fail("インストールがキャンセルされました");

  const parsed = verifyState(String(state ?? ""));
  if (!parsed) return fail("接続情報の検証に失敗しました。もう一度お試しください");

  if (!appConfigured()) return fail("サーバーに GitHub App が設定されていません（GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_PRIVATE_KEY）");

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return fail("サーバー設定エラーが発生しました"); }

  // 失敗の原因を切り分けられるよう、段階ごとに文言を分ける。
  // まとめて catch すると「保存に失敗」としか出せず、GitHub側の認証エラーなのか
  // DB側のエラーなのかが管理者に分からない。
  const brief = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

  // ① インストール先のアカウント情報（App自身のJWTでしか引けない）
  let account: any;
  try {
    account = await gh(appJwt(), `/app/installations/${installationId}`);
  } catch (e) {
    console.error("[github install-callback] app auth failed:", brief(e));
    return fail(`GitHubの認証に失敗しました。App ID と秘密鍵の設定をご確認ください / ${brief(e)}`);
  }

  // ② installation token（ここが通れば以後のAPI呼び出しも通る）
  let token: string;
  try {
    token = await installationToken(String(installationId));
  } catch (e) {
    console.error("[github install-callback] installation token failed:", brief(e));
    return fail(`インストールのトークンを取得できませんでした / ${brief(e)}`);
  }

  // ③ リポジトリ数は表示用なので、取れなくても接続自体は成立させる
  let repoCount = 0;
  try {
    const info = await gh(token, "/installation/repositories?per_page=1");
    repoCount = info?.total_count ?? 0;
  } catch (e) {
    console.error("[github install-callback] repo count failed (非致命):", brief(e));
  }

  // ④ 保存。supabase-js は例外を投げず error を返すので、必ず中身を見る
  const { error: dbError } = await sb.from("github_installations").upsert({
    organization_id: parsed.orgId,
    installation_id: String(installationId),
    account_login: account?.account?.login ?? "",
    account_type: account?.account?.type ?? "",
    repo_selection: account?.repository_selection ?? "",
    connected_by: parsed.userId,
    connected_at: new Date().toISOString(),
    revoked_at: null,
  }, { onConflict: "organization_id" });

  if (dbError) {
    console.error("[github install-callback] db upsert failed:", dbError.message);
    return fail(`接続情報の保存に失敗しました / ${dbError.message.slice(0, 300)}`);
  }

  return res.redirect(302, `${back}&github=success&repos=${repoCount}&action=${encodeURIComponent(String(setupAction ?? "install"))}`);
}

// ── 参照系 ───────────────────────────────────────────────────
async function handleStatus(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const orgId = targetOrgId(caller, req);
  const base = {
    appConfigured: appConfigured(),
    visibility: visibility(),
    // App の資格情報が実際に GitHub に通るか。通らないまま接続に進むと
    // コールバックで初めて失敗して原因が分からなくなるため、ここで先に確かめる。
    appAuthOk: false,
    appAuthError: null as string | null,
    /** 鍵が読めないときの切り分け用。値そのものは含めない */
    appKeyShape: null as string | null,
    appSlugMismatch: null as string | null,
    /**
     * GitHub 側にインストール済みだが、どの組織にも記録されていないもの。
     * コールバックが失敗したときに「GitHubには入っているのにDev Ticketは未接続」で
     * 詰まるため、そこから復旧するための候補。
     */
    unclaimedInstallations: [] as { id: string; accountLogin: string; accountType: string; repoSelection: string }[],
    installed: false,
    revoked: false,
    accountLogin: null as string | null,
    accountType: null as string | null,
    repoSelection: null as string | null,
    connectedAt: null as string | null,
    connectedByName: null as string | null,
    repoCount: null as number | null,
    manageUrl: null as string | null,
  };
  if (!base.appConfigured) return res.status(200).json(base);

  // GET /app は App 自身のJWTでのみ通る。App ID と秘密鍵の組み合わせの検証になる。
  try {
    const app = await gh(appJwt(), "/app");
    base.appAuthOk = true;
    const expected = process.env.GITHUB_APP_SLUG;
    if (app?.slug && expected && app.slug !== expected) {
      base.appSlugMismatch = `GITHUB_APP_SLUG は「${expected}」ですが、この App の実際のスラッグは「${app.slug}」です`;
    }
  } catch (e) {
    base.appAuthError = String((e as Error)?.message ?? e).slice(0, 300);
    try { base.appKeyShape = privateKeyShape(); } catch { /* 形の説明で落ちても本題ではないので握る */ }
  }

  const { data } = await sb
    .from("github_installations").select("*").eq("organization_id", orgId).maybeSingle();

  if (!data) {
    base.unclaimedInstallations = await listUnclaimedInstallations(sb);
    return res.status(200).json(base);
  }

  let connectedByName: string | null = null;
  if (data.connected_by) {
    const { data: p } = await sb.from("profiles").select("name").eq("id", data.connected_by).maybeSingle();
    connectedByName = (p?.name as string | null) ?? null;
  }

  const login = (data.account_login as string) ?? "";
  const manageUrl = data.account_type === "Organization"
    ? `https://github.com/organizations/${login}/settings/installations/${data.installation_id}`
    : `https://github.com/settings/installations/${data.installation_id}`;

  // トークンが通るかで「GitHub側で消されていないか」を判定する
  let repoCount: number | null = null;
  let revoked = !!data.revoked_at;
  try {
    const token = await installationToken(String(data.installation_id));
    const repos = await gh(token, "/installation/repositories?per_page=1");
    repoCount = repos?.total_count ?? 0;
    if (revoked) {
      await sb.from("github_installations").update({ revoked_at: null }).eq("organization_id", orgId);
      revoked = false;
    }
  } catch {
    revoked = true;
    if (!data.revoked_at) {
      await sb.from("github_installations").update({ revoked_at: new Date().toISOString() }).eq("organization_id", orgId);
    }
  }

  return res.status(200).json({
    ...base,
    installed: true,
    revoked,
    accountLogin: login,
    accountType: (data.account_type as string) ?? null,
    repoSelection: (data.repo_selection as string) ?? null,
    connectedAt: (data.connected_at as string) ?? null,
    connectedByName,
    repoCount,
    manageUrl,
  });
}

/**
 * App にインストール済みで、まだどの組織にも紐付いていないものを返す。
 *
 * App が public のときは他社の GitHub 組織のインストールが混ざり得るため、
 * 取り込みの候補には出さない（署名付き state を通る通常の接続フローだけを使う）。
 * private なら、インストール先は App の所有アカウント配下に限られる。
 */
async function listUnclaimedInstallations(sb: SupabaseClient) {
  if (visibility() !== "private") return [];
  try {
    const list = await gh(appJwt(), "/app/installations?per_page=100");
    if (!Array.isArray(list) || !list.length) return [];

    const { data: claimed } = await sb.from("github_installations").select("installation_id");
    const taken = new Set((claimed ?? []).map(r => String((r as any).installation_id)));

    return list
      .filter((i: any) => !taken.has(String(i.id)))
      .map((i: any) => ({
        id: String(i.id),
        accountLogin: i.account?.login ?? "",
        accountType: i.account?.type ?? "",
        repoSelection: i.repository_selection ?? "",
      }));
  } catch {
    // 候補が出せなくても通常の接続はできるので、ここでは黙って空にする
    return [];
  }
}

/** GitHub 側に既にあるインストールを、この組織の接続として取り込む */
async function handleAdopt(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  await requireOrgAdmin(sb, caller);

  const body = parseBody(req);
  const installationId = String(body.installationId ?? "");
  if (!installationId) throw new HttpError(400, "取り込む対象が指定されていません。");

  const orgId = targetOrgId(caller, req) || String(caller.organizationId ?? "");
  if (!orgId) throw new HttpError(400, "組織が特定できません。");

  if (visibility() !== "private") {
    throw new HttpError(403, "この App は公開設定のため、既存インストールの取り込みはできません。「GitHubに接続する」からやり直してください。");
  }

  const candidates = await listUnclaimedInstallations(sb);
  const target = candidates.find(c => c.id === installationId);
  if (!target) {
    throw new HttpError(409, "対象のインストールが見つからないか、既に別の組織に接続されています。");
  }

  const { error } = await sb.from("github_installations").upsert({
    organization_id: orgId,
    installation_id: target.id,
    account_login: target.accountLogin,
    account_type: target.accountType,
    repo_selection: target.repoSelection,
    connected_by: caller.id,
    connected_at: new Date().toISOString(),
    revoked_at: null,
  }, { onConflict: "organization_id" });
  if (error) throw new HttpError(500, `接続情報の保存に失敗しました / ${error.message.slice(0, 200)}`);

  return res.status(200).json({ ok: true, accountLogin: target.accountLogin });
}

async function handleRepos(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const installationId = await getInstallationId(sb, targetOrgId(caller, req));
  const token = await installationToken(installationId);

  const out: { fullName: string; defaultBranch: string; private: boolean }[] = [];
  for (let page = 1; page <= 5; page++) {
    const json = await gh(token, `/installation/repositories?per_page=100&page=${page}`);
    const items = json?.repositories ?? [];
    for (const r of items) {
      out.push({ fullName: r.full_name, defaultBranch: r.default_branch ?? "main", private: !!r.private });
    }
    if (items.length < 100) break;
  }
  out.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return res.status(200).json({ repos: out });
}

async function handlePulls(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const token = await installationToken(ctx.installationId);
  const list = await gh(token, `/repos/${ctx.repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`);

  // 一覧のCI/レビューは件数が多いと重いので、上位20件だけ実データを引く
  const pulls = (list ?? []).map(mapPull);
  const enriched = await Promise.all(pulls.map(async (p: any, i: number) => {
    if (i >= 20) return p;
    try {
      const [runs, reviews] = await Promise.all([
        p.headSha ? gh(token, `/repos/${ctx.repo}/commits/${p.headSha}/check-runs?per_page=50`).catch(() => null) : null,
        gh(token, `/repos/${ctx.repo}/pulls/${p.number}/reviews?per_page=50`).catch(() => null),
      ]);
      const c = summarizeChecks(runs?.check_runs ?? []);
      const r = summarizeReviews(reviews ?? []);
      return { ...p, checkState: c.state, checkSummary: c.summary, reviewState: r.state, reviewSummary: r.summary };
    } catch { return p; }
  }));

  await autoLink(sb, ctx, enriched);
  const links = await loadLinksForProject(sb, ctx.id);
  return res.status(200).json({ pulls: enriched, level: ctx.level, repo: ctx.repo, links });
}

async function handlePull(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const number = Number(req.query?.number ?? 0);
  if (!number) throw new HttpError(400, "PR番号が不正です。");

  const token = await installationToken(ctx.installationId);
  const p = await gh(token, `/repos/${ctx.repo}/pulls/${number}`);
  const [runs, reviews] = await Promise.all([
    gh(token, `/repos/${ctx.repo}/commits/${p.head?.sha}/check-runs?per_page=50`).catch(() => null),
    gh(token, `/repos/${ctx.repo}/pulls/${number}/reviews?per_page=50`).catch(() => null),
  ]);
  const c = summarizeChecks(runs?.check_runs ?? []);
  const r = summarizeReviews(reviews ?? []);

  return res.status(200).json({
    pull: {
      ...mapPull(p),
      body: p.body ?? "",
      changedFiles: p.changed_files ?? 0,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      checkState: c.state, checkSummary: c.summary, checks: c.checks,
      reviewState: r.state, reviewSummary: r.summary,
    },
    level: ctx.level,
  });
}

async function handleIssues(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const token = await installationToken(ctx.installationId);
  const list = await gh(token, `/repos/${ctx.repo}/issues?state=open&per_page=50&sort=updated&direction=desc`);
  // /issues は PR も返すので、pull_request を持つものを外す
  const issues = (list ?? []).filter((i: any) => !i.pull_request).map((i: any) => ({
    number: i.number,
    title: i.title ?? "",
    url: i.html_url ?? "",
    state: i.state,
    user: mapUser(i.user),
    createdAt: i.created_at,
    labels: (i.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
    comments: i.comments ?? 0,
  }));
  return res.status(200).json({ issues, level: ctx.level, repo: ctx.repo });
}

async function handleCommits(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const token = await installationToken(ctx.installationId);
  const branch = String(req.query?.branch ?? "") || ctx.defaultBranch;
  const q = branch ? `&sha=${encodeURIComponent(branch)}` : "";
  const list = await gh(token, `/repos/${ctx.repo}/commits?per_page=30${q}`);
  const commits = (list ?? []).map((c: any) => ({
    sha: c.sha,
    message: (c.commit?.message ?? "").split("\n")[0],
    url: c.html_url ?? "",
    authorName: c.commit?.author?.name ?? "",
    authorLogin: c.author?.login ?? null,
    avatarUrl: c.author?.avatar_url ?? null,
    date: c.commit?.author?.date ?? "",
  }));
  return res.status(200).json({ commits, branch, level: ctx.level, repo: ctx.repo });
}

async function handleBranches(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const token = await installationToken(ctx.installationId);
  const [list, repo] = await Promise.all([
    gh(token, `/repos/${ctx.repo}/branches?per_page=100`),
    gh(token, `/repos/${ctx.repo}`),
  ]);
  const def = repo?.default_branch ?? ctx.defaultBranch;
  const branches = (list ?? []).map((b: any) => ({
    name: b.name,
    protected: !!b.protected,
    isDefault: b.name === def,
    lastCommitSha: b.commit?.sha ?? "",
  })).sort((a: any, b: any) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1));
  return res.status(200).json({ branches, defaultBranch: def, level: ctx.level, repo: ctx.repo });
}

// ── 紐付け ───────────────────────────────────────────────────
/**
 * ブランチ名／タイトルの WBS からチケットへ自動で紐付ける。
 * 表示のためだけの紐付けで、チケットのステータスには一切触らない
 * （既存のチケット更新経路に手を入れると、順番が入れ替わる等の既知不具合を踏むため）。
 */
async function autoLink(sb: SupabaseClient, ctx: ProjectCtx, pulls: any[]) {
  const wbsList = Array.from(new Set(pulls.flatMap(p => p.detectedWbs as string[])));
  if (!wbsList.length) return;

  const { data: sprints } = await sb.from("sprints").select("id").eq("project_id", ctx.id);
  const sprintIds = (sprints ?? []).map(s => (s as any).id);
  if (!sprintIds.length) return;

  const { data: tickets } = await sb
    .from("sprint_tickets").select("id, wbs").in("sprint_id", sprintIds).in("wbs", wbsList);
  if (!tickets?.length) return;

  const byWbs = new Map<string, string>();
  for (const t of tickets as any[]) byWbs.set(String(t.wbs).toUpperCase(), t.id);

  const rows: Record<string, unknown>[] = [];
  for (const p of pulls) {
    for (const w of p.detectedWbs as string[]) {
      const ticketId = byWbs.get(w);
      if (!ticketId) continue;
      rows.push({
        project_id: ctx.id,
        ticket_id: ticketId,
        kind: "pull",
        number: p.number,
        title: p.title,
        state: p.merged ? "merged" : p.state,
        url: p.url,
        auto_linked: true,
        auto_reason: p.autoReason ?? null,
      });
    }
  }
  if (!rows.length) return;

  // 手動で付けた紐付け（auto_linked=false）を自動で上書きしないよう、
  // 既にある組み合わせは title/state の更新だけに留める。
  const { data: existing } = await sb
    .from("ticket_github_links").select("id, ticket_id, number, auto_linked")
    .eq("project_id", ctx.id).eq("kind", "pull");
  const manual = new Set((existing ?? [])
    .filter(e => (e as any).auto_linked === false)
    .map(e => `${(e as any).ticket_id}#${(e as any).number}`));

  const toUpsert = rows.map(r => manual.has(`${r.ticket_id}#${r.number}`)
    ? { ...r, auto_linked: false, auto_reason: null }
    : r);

  await sb.from("ticket_github_links").upsert(toUpsert, { onConflict: "project_id,ticket_id,kind,number" });
}

async function loadLinksForProject(sb: SupabaseClient, projectId: string) {
  const { data } = await sb
    .from("ticket_github_links").select("*").eq("project_id", projectId);
  return withWbs(sb, data ?? []);
}

/**
 * 画面に出すのは内部IDではなくWBS番号。
 * ticket_github_links は ticket_id しか持たないので、ここで引き直して添える。
 */
async function withWbs(sb: SupabaseClient, rows: any[]) {
  const mapped = rows.map(mapLink);
  const ids = Array.from(new Set(mapped.map(l => l.ticketId)));
  if (!ids.length) return mapped;
  const { data: tickets } = await sb.from("sprint_tickets").select("id, wbs, title").in("id", ids);
  const byId = new Map((tickets ?? []).map(t => [(t as any).id, t as any]));
  return mapped.map(l => ({
    ...l,
    ticketWbs: byId.get(l.ticketId)?.wbs ?? null,
    ticketTitle: byId.get(l.ticketId)?.title ?? null,
  }));
}

function mapLink(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    ticketId: r.ticket_id,
    kind: r.kind,
    number: r.number,
    title: r.title ?? null,
    state: r.state ?? null,
    url: r.url ?? null,
    autoLinked: !!r.auto_linked,
    autoReason: r.auto_reason ?? null,
  };
}

async function handleLinks(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const ticketId = String(req.query?.ticketId ?? "");

  let q = sb.from("ticket_github_links").select("*").eq("project_id", ctx.id);
  if (ticketId) q = q.eq("ticket_id", ticketId);
  const { data } = await q;
  return res.status(200).json({ links: await withWbs(sb, data ?? []), level: ctx.level, repo: ctx.repo });
}

async function handleLink(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const ticketId = String(body.ticketId ?? "");
  const kind = body.kind === "issue" ? "issue" : "pull";
  const number = Number(body.number ?? 0);
  if (!ticketId || !number) throw new HttpError(400, "紐付ける対象が不正です。");

  const token = await installationToken(ctx.installationId);
  const path = kind === "pull" ? `/repos/${ctx.repo}/pulls/${number}` : `/repos/${ctx.repo}/issues/${number}`;
  const item = await gh(token, path);

  const { data, error } = await sb.from("ticket_github_links").upsert({
    project_id: ctx.id,
    ticket_id: ticketId,
    kind,
    number,
    title: item?.title ?? "",
    state: item?.merged_at ? "merged" : (item?.state ?? ""),
    url: item?.html_url ?? "",
    linked_by: caller.id,
    auto_linked: false,
    auto_reason: null,
  }, { onConflict: "project_id,ticket_id,kind,number" }).select("*").maybeSingle();
  if (error) throw new HttpError(500, "紐付けの保存に失敗しました。");

  return res.status(200).json({ link: data ? mapLink(data) : null });
}

async function handleUnlink(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const id = Number(body.id ?? 0);
  if (!id) throw new HttpError(400, "対象が不正です。");

  await sb.from("ticket_github_links").delete().eq("id", id).eq("project_id", ctx.id);
  return res.status(200).json({ ok: true });
}

// ── 書き込み系 ───────────────────────────────────────────────
function parseBody(req: any): Record<string, any> {
  if (!req.body) return {};
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body as Record<string, any>;
}

async function writeLog(sb: SupabaseClient, ctx: ProjectCtx, caller: Caller, action: string, prNumber: number, result: string, detail: string) {
  // GitHub上は App(bot) 名義になるため、実行者はここに必ず残す
  await sb.from("github_action_logs").insert({
    project_id: ctx.id,
    actor_id: caller.id,
    actor_name: caller.name,
    action,
    repo: ctx.repo,
    pr_number: prNumber,
    result,
    detail: detail.slice(0, 500),
  });
}

async function handleMerge(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const number = Number(body.number ?? 0);
  const method = ["merge", "squash", "rebase"].includes(body.method) ? body.method : "squash";
  if (!number) throw new HttpError(400, "PR番号が不正です。");

  const token = await installationToken(ctx.installationId);
  const p = await gh(token, `/repos/${ctx.repo}/pulls/${number}`);

  if (p.merged) throw new HttpError(409, "このプルリクエストは既にマージされています。");
  if (p.draft) throw new HttpError(409, "Draft のためマージできません。");
  if (p.mergeable === false) throw new HttpError(409, "コンフリクトがあるためマージできません。GitHub上で解消してください。");

  try {
    const result = await gh(token, `/repos/${ctx.repo}/pulls/${number}/merge`, {
      method: "PUT",
      body: {
        merge_method: method,
        // rebase は commit_title/message を受け付けないため付けない
        ...(method === "rebase" ? {} : {
          commit_title: `${p.title} (#${number})`,
          commit_message: `Merged via Dev Ticket by ${caller.name}`,
        }),
        sha: p.head?.sha,
      },
    });
    await writeLog(sb, ctx, caller, "merge", number, "ok", `${method} / ${result?.sha ?? ""}`);
    return res.status(200).json({ ok: true, sha: result?.sha ?? null });
  } catch (e) {
    const m = jaMessage(e);
    await writeLog(sb, ctx, caller, "merge", number, "error", (e as Error)?.message ?? "");
    return res.status(m.status).json({ error: m.message });
  }
}

async function handleReview(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const number = Number(body.number ?? 0);
  const event = body.event === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "APPROVE";
  if (!number) throw new HttpError(400, "PR番号が不正です。");
  if (event === "REQUEST_CHANGES" && !String(body.body ?? "").trim()) {
    throw new HttpError(400, "変更を依頼する場合はコメントを入力してください。");
  }

  const token = await installationToken(ctx.installationId);
  const text = String(body.body ?? "").trim();
  const signature = `\n\n---\n_Dev Ticket の ${caller.name} が実行_`;

  try {
    await gh(token, `/repos/${ctx.repo}/pulls/${number}/reviews`, {
      method: "POST",
      body: { event, body: (text || (event === "APPROVE" ? "承認しました。" : "")) + signature },
    });
    await writeLog(sb, ctx, caller, event === "APPROVE" ? "approve" : "request_changes", number, "ok", "");
    return res.status(200).json({ ok: true });
  } catch (e) {
    const m = jaMessage(e);
    await writeLog(sb, ctx, caller, event === "APPROVE" ? "approve" : "request_changes", number, "error", (e as Error)?.message ?? "");
    return res.status(m.status).json({ error: m.message });
  }
}

async function handleComment(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const number = Number(body.number ?? 0);
  const text = String(body.body ?? "").trim();
  if (!number || !text) throw new HttpError(400, "コメントを入力してください。");

  const token = await installationToken(ctx.installationId);
  try {
    await gh(token, `/repos/${ctx.repo}/issues/${number}/comments`, {
      method: "POST",
      body: { body: `${text}\n\n---\n_Dev Ticket の ${caller.name} が投稿_` },
    });
    await writeLog(sb, ctx, caller, "comment", number, "ok", "");
    return res.status(200).json({ ok: true });
  } catch (e) {
    const m = jaMessage(e);
    await writeLog(sb, ctx, caller, "comment", number, "error", (e as Error)?.message ?? "");
    return res.status(m.status).json({ error: m.message });
  }
}
