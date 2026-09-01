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
//   GET  /api/github/deploy-status?projectId=     … 本番反映の状態（遅れ・未反映PR・理由）
//   POST /api/github/deploy-check   { projectId } … 本番反映を今すぐ確認し直す
//   GET  /api/github/deploy-overview?orgId=       … 組織全体の診断（未保護・未設定・遅延）
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
import dns from "dns";

const GITHUB_API = "https://api.github.com";
const UA = "dev-ticket";

// @vercel/node の型チェックが auth.getUser を解決できないケースがあるため型だけ緩める
type AuthLike = { getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }> };

/** 応答に載せる表示用の段階。3軸の権限を1段階に畳んだもの（BRU13-054） */
type GithubLevel = "none" | "view" | "merge";

/** 操作ごとの権限（BRU13-054）。src/app/lib/githubPerms.ts と同じ判定をここにも置く */
type GithubActionLevel = "none" | "view" | "write";
interface GithubPerms {
  /** プルリクエストの作成 */
  pull: GithubActionLevel;
  /** マージ・レビュー承認・コメント投稿 */
  merge: GithubActionLevel;
  /** ブランチの作成 */
  branch: GithubActionLevel;
}

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
    if (e.status === 403 && raw.includes("archived")) {
      return { status: 403, message: "リポジトリがアーカイブされているため、書き込み操作はできません。" };
    }
    // 「Resource not accessible by integration」＝ GitHub App の権限不足。
    // 時間をおいても直らないので「再度お試しください」に混ぜず、設定変更へ誘導する。
    //
    // ただし、原因が「App の宣言」なのか「インストールの承認待ち」なのかは
    // ここでは分からない。断定すると直しに行く画面を誤って案内することになるため、
    // 書き込み系のハンドラは explainForbidden() で切り分けた文言に差し替える。
    // ここに残るのは、切り分けられなかったときの控えめな言い方だけ。
    if (e.status === 403) {
      return {
        status: 403,
        message: "GitHub App の権限が足りないため実行できませんでした。管理者に「外部連携」画面の確認を依頼してください。",
      };
    }
    // ブランチ保護（必須チェック・必須レビュー）に弾かれた場合も 405 で返る。
    // コンフリクトと同じ文言にすると、直しに行く場所を誤って案内することになるので分ける。
    if (e.status === 405 && /required status check|approving review|review is required|protected branch|changes must be made through a pull request/.test(raw)) {
      return {
        status: 422,
        message: "ブランチ保護の条件を満たしていないためマージできません（必須チェックが未完了か、必須レビューが未承認です）。",
      };
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

// ── App の権限（インストール単位） ───────────────────────────
/**
 * Dev Ticket が使う GitHub App の権限。
 *
 * マージは「マージ先ブランチに commit を積む」操作なので、Pull requests だけでなく
 * **Contents: Read & write** が要る。ここが Read のままだと GitHub は
 * 403 Resource not accessible by integration を返し、PR の閲覧・作成は通るのに
 * マージだけが必ず失敗する（原因が画面から分からない）。
 *
 * App 側の設定を変えても、インストール側が更新を承認するまで反映されないため、
 * 判定は App の宣言ではなく「インストールに実際に付いている権限」で行う。
 */
const REQUIRED_PERMISSIONS: { key: string; label: string; need: "read" | "write"; why: string }[] = [
  { key: "metadata", label: "Metadata", need: "read", why: "リポジトリ情報の取得" },
  { key: "pull_requests", label: "Pull requests", need: "write", why: "PRの作成・マージ・レビュー" },
  { key: "contents", label: "Contents", need: "write", why: "マージ（マージ先ブランチへの書き込み）" },
  { key: "issues", label: "Issues", need: "read", why: "Issue一覧" },
  { key: "checks", label: "Checks", need: "read", why: "CI状態の表示" },
];

/**
 * 「無くても機能は動くが、あると事故を検知できる」権限。
 *
 * 本番反映の確認（docs/deploy-verification-design.md）で使う。
 * Vercel の「Deployment was blocked」は Checks ではなく commit status 側に出ることがあり、
 * checks だけを見ていると失敗ですらなく「チェックなし」に見える。
 *
 * REQUIRED_PERMISSIONS に混ぜないのは、混ぜると既存のインストール全部に
 * 「その操作は実行しても必ず失敗します」という誤った警告が出るため。
 * こちらは「確認できていない」という別の弱い案内として出す。
 */
const OPTIONAL_PERMISSIONS: { key: string; label: string; need: "read" | "write"; why: string }[] = [
  { key: "statuses", label: "Commit statuses", need: "read", why: "Vercel等のデプロイ結果（blocked）の検知" },
  { key: "deployments", label: "Deployments", need: "read", why: "本番デプロイの成否の検知" },
];

const PERMISSION_RANK: Record<string, number> = { read: 1, write: 2, admin: 3 };

const PERMISSION_META = new Map(
  [...REQUIRED_PERMISSIONS, ...OPTIONAL_PERMISSIONS].map(p => [p.key, p]),
);

export interface MissingPermission { key: string; label: string; need: string; current: string; why: string }

/** 求めるレベルに届いていない権限だけを返す。読めなかったときは「不足」と決めつけない */
function shortage(
  perms: Record<string, string> | null | undefined,
  needs: { key: string; need: "read" | "write" }[],
): MissingPermission[] {
  if (!perms || typeof perms !== "object") return [];
  return needs
    .filter(n => (PERMISSION_RANK[perms[n.key]] ?? 0) < PERMISSION_RANK[n.need])
    .map(n => {
      const meta = PERMISSION_META.get(n.key);
      return {
        key: n.key,
        label: meta?.label ?? n.key,
        need: n.need === "write" ? "Read & write" : "Read",
        current: perms[n.key] === "write" ? "Read & write" : perms[n.key] === "read" ? "Read" : "なし",
        why: meta?.why ?? "",
      };
    });
}

function missingPermissions(perms: Record<string, string> | null | undefined): MissingPermission[] {
  return shortage(perms, REQUIRED_PERMISSIONS);
}

// ── 権限不足の切り分け（再発防止の中心） ─────────────────────
//
// 「Resource not accessible by integration」で失敗する原因は2段ある。
//
//   ① App 自体の宣言が足りない … GitHub の App 設定（所有者しか触れない）。
//      インストール側でいくら承認しても直らない。
//   ② 宣言は足りているが、インストールが更新を承認していない。
//
// ①と②で直しに行く画面が違うのに、以前は失敗後に②だけを案内していたため、
// 案内どおりに操作しても直らず同じ失敗を繰り返していた。
// ここで両方を見て、どちらが原因かと、直す場所のURLまで確定させる。

/** 操作ごとに「これが無いと必ず失敗する」権限 */
type OperationKey = "merge" | "create-pull" | "review" | "create-branch";

const OPERATION_NEEDS: Record<OperationKey, { key: string; need: "read" | "write" }[]> = {
  // マージはマージ先ブランチへ commit を積むため Contents: Read & write が要る
  merge: [{ key: "pull_requests", need: "write" }, { key: "contents", need: "write" }],
  "create-pull": [{ key: "pull_requests", need: "write" }, { key: "contents", need: "read" }],
  review: [{ key: "pull_requests", need: "write" }],
  // ブランチの作成は ref を1本足すだけなので Contents: Read & write で足りる
  "create-branch": [{ key: "contents", need: "write" }],
};

const OPERATION_LABELS: Record<OperationKey, string> = {
  merge: "マージ",
  "create-pull": "プルリクエストの作成",
  review: "レビューの送信",
  "create-branch": "ブランチの作成",
};

export interface PermissionBlock {
  /**
   * "app"     … App の設定そのものが足りない（承認では直らない）
   * "install" … 宣言は足りていて、承認がまだ
   * "repo"    … 権限は足りている。リポジトリ側（ブランチ保護など）で拒否された
   */
  scope: "app" | "install" | "repo";
  operation: OperationKey;
  missing: MissingPermission[];
  /** 直しに行くGitHubの画面 */
  fixUrl: string | null;
  message: string;
}

/** App 設定の権限ページ。App の所有者だけが開ける */
function appPermissionsUrl(): string | null {
  const slug = process.env.GITHUB_APP_SLUG;
  return slug ? `https://github.com/settings/apps/${slug}/permissions` : null;
}

/**
 * 権限は変わることが稀なので短くキャッシュする。
 * 承認した直後に古い判定を返し続けないよう、TTLは1分に留める。
 */
const PERMISSION_TTL = 60_000;
let appPermsCache: { perms: Record<string, string> | null; at: number } | null = null;
const installCache = new Map<string, { perms: Record<string, string> | null; manageUrl: string | null; at: number }>();

/** App が GitHub 上で宣言している権限（インストールとは別物） */
async function appPermissions(force = false): Promise<Record<string, string> | null> {
  if (!force && appPermsCache && Date.now() - appPermsCache.at < PERMISSION_TTL) return appPermsCache.perms;
  let perms: Record<string, string> | null = null;
  try {
    const app = await gh(appJwt(), "/app");
    perms = (app?.permissions as Record<string, string> | undefined) ?? null;
  } catch { /* 読めないときは判定しない（誤警告を出さない） */ }
  appPermsCache = { perms, at: Date.now() };
  return perms;
}

/** インストールに実際に付いている権限と、その設定画面のURL */
async function installationPermissions(installationId: string, force = false) {
  const hit = installCache.get(installationId);
  if (!force && hit && Date.now() - hit.at < PERMISSION_TTL) return hit;
  let entry = { perms: null as Record<string, string> | null, manageUrl: null as string | null, at: Date.now() };
  try {
    const inst = await gh(appJwt(), `/app/installations/${installationId}`);
    entry = {
      perms: (inst?.permissions as Record<string, string> | undefined) ?? null,
      manageUrl: (inst?.html_url as string | undefined) ?? null,
      at: Date.now(),
    };
  } catch { /* 同上 */ }
  installCache.set(installationId, entry);
  return entry;
}

/**
 * その操作が権限で止まるかを、実行前に判定する。
 * 止まらない（または判定できない）なら null。
 */
async function permissionBlock(installationId: string, operation: OperationKey, force = false): Promise<PermissionBlock | null> {
  const needs = OPERATION_NEEDS[operation];
  const label = OPERATION_LABELS[operation];

  const declared = await appPermissions(force);
  const declaredShort = shortage(declared, needs);
  if (declaredShort.length) {
    const names = declaredShort.map(m => `${m.label}（${m.need}）`).join("・");
    return {
      scope: "app",
      operation,
      missing: declaredShort,
      fixUrl: appPermissionsUrl(),
      message: `${label}に必要な ${names} が GitHub App 側に設定されていません。`
        + "インストール画面での承認では直りません。App の所有者が GitHub の App 設定で権限を追加し、"
        + "そのうえでインストール画面の更新を承認する必要があります。",
    };
  }

  const inst = await installationPermissions(installationId, force);
  const installShort = shortage(inst.perms, needs);
  if (installShort.length) {
    const names = installShort.map(m => `${m.label}（${m.need}）`).join("・");
    return {
      scope: "install",
      operation,
      missing: installShort,
      fixUrl: inst.manageUrl,
      message: `${label}に必要な ${names} の権限更新が、まだ承認されていません。`
        + "管理者が GitHub のインストール画面で権限の更新を承認すると使えるようになります。",
    };
  }
  return null;
}

/** 実行前の関門。ここで止めれば、まとめてマージが全件同じ理由で失敗することがなくなる */
async function assertPermitted(installationId: string, operation: OperationKey) {
  const block = await permissionBlock(installationId, operation);
  if (block) throw new HttpError(403, block.message, { permission: block });
}

/** GitHub が「App の権限が無い」と言っているか */
function isForbiddenByIntegration(e: unknown): boolean {
  return e instanceof GithubError && e.status === 403
    && (e.message || "").toLowerCase().includes("not accessible by integration");
}

/**
 * 書き込みを実行する。
 *
 * installation token は最大1時間キャッシュしているため、権限の承認直後は
 * 「権限は足りているのにトークンだけが古い」状態が起こり得る。
 * その1回だけを救うため、403 のときはトークンを捨てて取り直し、一度だけやり直す。
 * （403 は実行されなかったことを意味するので、やり直しても二重マージにはならない）
 */
async function runWithFreshToken<T>(
  installationId: string,
  state: { refreshed: boolean },
  run: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await run(await installationToken(installationId));
  } catch (e) {
    if (state.refreshed || !isForbiddenByIntegration(e)) throw e;
    state.refreshed = true;
    tokenCache.delete(installationId);
    return await run(await installationToken(installationId));
  }
}

/**
 * 実行してから 403 になったときの説明。
 * 事前判定を通っているのに弾かれた＝判定が古い可能性があるので、権限を取り直して見る。
 */
async function explainForbidden(installationId: string, operation: OperationKey, e: unknown) {
  if (!isForbiddenByIntegration(e)) return null;
  const block = await permissionBlock(installationId, operation, true);
  if (block) return block;
  // 権限は足りている。ブランチ保護やリポジトリの制限など、権限以外の理由。
  // ここで「承認してください」と言うと、直しようのない案内で時間を使わせてしまう
  return {
    scope: "repo" as const,
    operation,
    missing: [] as MissingPermission[],
    fixUrl: null,
    message: `GitHub 側で${OPERATION_LABELS[operation]}が拒否されました。`
      + "App の権限は足りているため、リポジトリのブランチ保護やルールセットの設定をご確認ください。",
  };
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

const NO_PERMS: GithubPerms = { pull: "none", merge: "none", branch: "none" };
const FULL_PERMS: GithubPerms = { pull: "write", merge: "write", branch: "write" };
const PERM_RANK: Record<GithubActionLevel, number> = { none: 0, view: 1, write: 2 };

function actionLevel(v: unknown): GithubActionLevel | undefined {
  return v === "none" || v === "view" || v === "write" ? v : undefined;
}

/** 旧 githubPermission (none/view/merge) を3軸へ展開する。移行SQLと同じ対応表 */
function fromLegacyLevel(v: unknown): GithubPerms | null {
  if (v === "merge") return { ...FULL_PERMS };
  if (v === "view") return { pull: "view", merge: "view", branch: "view" };
  if (v === "none") return { ...NO_PERMS };
  return null;
}

/**
 * 権限が入った jsonb 1件から3軸を取り出す。この階層に何も書かれていなければ null。
 * 新キーが1つでもあれば新形式とみなし、欠けた軸だけを旧キーで埋める
 * （移行SQLの適用前後で結論が変わらないようにするため）。
 */
function permsFrom(raw: unknown): GithubPerms | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const pull = actionLevel(o.githubPullPermission);
  const merge = actionLevel(o.githubMergePermission);
  const branch = actionLevel(o.githubBranchPermission);
  const legacy = fromLegacyLevel(o.githubPermission);
  if (pull === undefined && merge === undefined && branch === undefined) return legacy;
  // 3軸とも none なのに旧キーが none でない行は、正規の書き込み経路では作れない食い違い。
  // 旧キーのほうを正として読む（src/app/lib/githubPerms.ts と同じ扱い）
  if (pull === "none" && merge === "none" && branch === "none" && legacy && canView(legacy)) {
    return legacy;
  }
  return {
    pull: pull ?? legacy?.pull ?? "none",
    merge: merge ?? legacy?.merge ?? "none",
    branch: branch ?? legacy?.branch ?? "none",
  };
}

function strongerPerms(a: GithubPerms, b: GithubPerms): GithubPerms {
  const pick = (x: GithubActionLevel, y: GithubActionLevel) => (PERM_RANK[x] >= PERM_RANK[y] ? x : y);
  return { pull: pick(a.pull, b.pull), merge: pick(a.merge, b.merge), branch: pick(a.branch, b.branch) };
}

/**
 * GitHubタブ（＝参照系API）を使えるか。
 * 軸ごとに閲覧ゲートを持たせると「PRは見えるがマージ状況は見えない」という
 * 破綻した組み合わせが設定できてしまうので、閲覧だけは3軸の論理和で判定する。
 */
function canView(p: GithubPerms): boolean {
  return p.pull !== "none" || p.merge !== "none" || p.branch !== "none";
}

/** 3軸を旧形式の1段階へ畳む。応答の level は互換のためこの値を返し続ける */
function toLegacyLevel(p: GithubPerms): GithubLevel {
  if (p.merge === "write") return "merge";
  return canView(p) ? "view" : "none";
}

/**
 * GitHub権限の解決。
 *   ① project_member_permissions（個別）
 *   ② 所属している permission_groups
 *   ③ roles.base_permissions
 *   ④ owner は常に全部 write
 * PermissionsPage / AuthContext / useGithubAccess と同じ優先順位にしてある。
 *
 * どこにも書かれていなければ全部 "none"。role が admin / project-manager でも
 * 例外にしない（BRU13-034）。GitHub権限の付与はアサイン計画の画面だけで行う決まりなので、
 * ロールを根拠に暗黙で配ると、その画面の表示（＝未設定なら「権限なし」）と実際の挙動がずれる。
 * owner だけは自分で自分を締め出せると詰むため常に全権。
 *
 * BRU13-054 で1段階から3軸に分けた。ある階層に「GitHub権限が書かれていた」なら
 * その階層で確定させる（＝下位へ降りない）のは従来と同じ。軸ごとに別々の階層から
 * 拾うと、個別で明示的に外した権限がグループ経由で復活してしまう。
 */
async function resolveGithubPerms(sb: SupabaseClient, caller: Caller, projectId: string): Promise<GithubPerms> {
  if (caller.role === "owner") return { ...FULL_PERMS };

  const { data: individual } = await sb
    .from("project_member_permissions")
    .select("permissions")
    .eq("project_id", projectId)
    .eq("member_id", caller.id)
    .maybeSingle();
  const fromIndividual = permsFrom(individual?.permissions);
  if (fromIndividual) return fromIndividual;

  const { data: memberships } = await sb
    .from("group_members").select("group_id").eq("member_id", caller.id);
  const groupIds = (memberships ?? []).map(m => (m as any).group_id);
  if (groupIds.length) {
    const { data: groups } = await sb
      .from("permission_groups").select("permissions").in("id", groupIds);
    // 複数グループに属している場合は軸ごとに強いほうを採用する（既存の権限も同じ考え方）
    let best: GithubPerms | null = null;
    for (const g of groups ?? []) {
      const p = permsFrom((g as any).permissions);
      if (p) best = best ? strongerPerms(best, p) : p;
    }
    if (best && canView(best)) return best;
  }

  const { data: role } = await sb
    .from("roles").select("base_permissions").eq("name", caller.role).maybeSingle();
  return permsFrom(role?.base_permissions) ?? { ...NO_PERMS };
}

interface ProjectCtx {
  id: string;
  organizationId: string | null;
  repo: string;
  defaultBranch: string;
  installationId: string;
  /** 表示用の1段階。3軸を畳んだもの（応答の level はこれ） */
  level: GithubLevel;
  /** 操作ごとの権限（BRU13-054） */
  perms: GithubPerms;
  /** 本番反映の確認をどこまで効かせるか（docs/deploy-verification-design.md） */
  deployCheckMode: DeployCheckMode;
  /** マージ前に失敗チェックをどう扱うか（層A） */
  requireChecksMode: RequireChecksMode;
}

/**
 * projectContext が要求する権限。
 *   view        … GitHubタブを開ける（3軸のどれかが none 以外）。参照系すべて
 *   create-pull … PRの作成
 *   merge       … マージ・レビュー承認・コメント投稿・紐付けの手動編集
 *   branch      … ブランチの作成
 */
type GithubNeed = "view" | "create-pull" | "merge" | "branch";

const NEED_MESSAGE: Record<Exclude<GithubNeed, "view">, string> = {
  "create-pull": "GitHubのプルリクエスト作成権限がありません。管理者にご相談ください。",
  merge: "GitHubのマージ権限がありません。管理者にご相談ください。",
  branch: "GitHubのブランチ作成権限がありません。管理者にご相談ください。",
};

const NEED_AXIS: Record<Exclude<GithubNeed, "view">, keyof GithubPerms> = {
  "create-pull": "pull",
  merge: "merge",
  branch: "branch",
};

/**
 * プロジェクト配下のAPIで毎回行う一式:
 *   プロジェクトの実在 → 同一組織か → メンバーか → GitHub権限 → installation。
 * 足りなければ Error を投げ、呼び出し側が 4xx にして返す。
 */
/**
 * opts.installation … GitHub API を叩かない handler（links など）は false を渡す。
 * インストールIDの取得はSupabaseへの往復が1回増えるだけで、使わないなら丸ごと無駄になる。
 * チケット詳細を開くたびに走る handleLinks では、この1往復が体感に効く（BRU13-023）
 */
async function projectContext(
  sb: SupabaseClient, caller: Caller, projectId: string, need: GithubNeed,
  opts?: { installation?: boolean },
): Promise<ProjectCtx> {
  // 権限の解決はプロジェクト行を必要としないので、待たずに並行して走らせる。
  // 直列にすると、チケットを開くたびにSupabaseへの往復がそのぶん積み上がる（BRU13-023）。
  // アクセス不可で弾く場合に権限クエリが1回無駄になるが、判定順は下で従来どおり保つ
  const [{ data: project }, perms] = await Promise.all([
    sb.from("projects")
      .select("id, organization_id, members, github_repo_full_name, github_default_branch, github_enabled, deploy_check_mode, require_checks_mode")
      .eq("id", projectId)
      .maybeSingle(),
    resolveGithubPerms(sb, caller, projectId),
  ]);
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

  if (!canView(perms)) {
    throw new HttpError(403, "GitHubの閲覧権限が付与されていません。管理者にご相談ください。");
  }
  if (need !== "view" && perms[NEED_AXIS[need]] !== "write") {
    throw new HttpError(403, NEED_MESSAGE[need]);
  }

  const repo = (project.github_repo_full_name as string | null) ?? "";
  if (!repo || project.github_enabled !== true) {
    throw new HttpError(409, "このプロジェクトにはGitHubリポジトリが紐付いていません。");
  }

  const installationId = opts?.installation === false ? "" : await getInstallationId(sb, orgId);
  return {
    id: projectId,
    organizationId: orgId,
    repo,
    defaultBranch: (project.github_default_branch as string | null) || "",
    installationId,
    level: toLegacyLevel(perms),
    perms,
    deployCheckMode: deployMode((project as any).deploy_check_mode),
    requireChecksMode: requireChecksMode((project as any).require_checks_mode),
  };
}

class HttpError extends Error {
  status: number;
  /** error 以外に画面へ渡したいもの（権限不足の内訳と直し先URLなど） */
  payload?: Record<string, unknown>;
  constructor(status: number, message: string, payload?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
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
// WBS番号の接頭辞はプロジェクトが決めるもので、小文字（demo-071）のこともある。
// 突き合わせは大文字に正規化して行うが、大文字小文字の食い違いを見つけるために
// 原文の綴りも保持する。
const WBS_RE = /[A-Za-z][A-Za-z0-9]*-\d+/g;

interface WbsHit {
  /** 大文字に正規化したWBS番号 */
  list: string[];
  /** 正規化したWBS番号 → ブランチ名／タイトルに実際に書かれていた綴り */
  spellings: Record<string, string>;
  /** 自動検出の根拠。誤検出を人が判断できるようにする */
  reason: string | null;
}

/** ブランチ名とタイトルからWBS番号を拾う */
function detectWbs(head: string, title: string): WbsHit {
  const fromHead = head.match(WBS_RE) ?? [];
  const fromTitle = title.match(WBS_RE) ?? [];
  const spellings: Record<string, string> = {};
  // ブランチ名を先に見る。同じ番号ならブランチ名の綴りを正とする
  for (const w of [...fromHead, ...fromTitle]) {
    const key = w.toUpperCase();
    if (!spellings[key]) spellings[key] = w;
  }
  const list = Object.keys(spellings);
  if (!list.length) return { list, spellings, reason: null };
  const reason = fromHead.length ? `ブランチ名 ${fromHead[0]}` : `タイトル ${fromTitle[0]}`;
  return { list, spellings, reason };
}

function mapUser(u: any) {
  return { login: u?.login ?? "", avatarUrl: u?.avatar_url ?? "" };
}

/** マージ可否の再取得までの待ち時間。GitHub 側の計算が終わるのを少しだけ待つ */
const MERGEABLE_RETRY_MS = 1200;

/**
 * マージ実行の手前で「判定中」を待つときの間隔。
 *
 * 一覧・詳細は1回だけ引き直せば十分だが（待たせるより「判定中」と出した方がよい）、
 * マージの可否判定を諦めると、本当はマージできるものを失敗として記録してしまう。
 * 実行経路だけは決まるまで少しずつ長く待つ（BRU13-042）。
 */
const MERGEABLE_POLL_MS = [700, 1000, 1500, 2200];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * マージ可否が「判定中」かどうか。
 * オープンかつ Draft でないのに mergeable が決まっていないものだけを対象にする
 * （Draft や既にマージ済みは計算されないので、待っても変わらない）
 */
function needsMergeableRetry(detail: any): boolean {
  if (!detail) return false;
  if (detail.draft || detail.merged_at || detail.state !== "open") return false;
  return detail.mergeable === null || detail.mergeable === undefined || detail.mergeable_state === "unknown";
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
    detectedSpellings: det.spellings,
    autoReason: det.reason,
  };
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

// ============================================================
// 本番反映の確認（docs/deploy-verification-design.md）
//
// これまでは「PRが既定ブランチへマージされた＝リリース済み」としていた。
// マージは成功しているのにデプロイが止まっている（Vercel の blocked 等）と、
// 本番に何も届いていないのに Dev Ticket 上は全件「リリース済み」になり、
// 気づく手立てが無くなる。実際に11コミットが滞留した事故が起きている。
//
// 対策は3つ。
//   層A … マージの入口で「失敗しているチェック」を見て止める（checkGateOf）
//   層B … 本番に反映されたことを確認してから「リリース済み」にする（deploy_check_mode=gate）
//   層C … 反映の遅れを定期的に観測して知らせる（runDeployCheck → Slack）
//
// 判定の中心は「本番が公開しているバージョン情報」と「既定ブランチの先頭」の
// 突き合わせにしている。デプロイ先（Vercel / Netlify / 自前）に依存せず、
// ブロックでもビルド失敗でもキャッシュでも、原因を問わず「届いていない」事実を掴めるため。
// ============================================================

type DeployCheckMode = "off" | "warn" | "gate";
type RequireChecksMode = "off" | "warn" | "reason" | "block";

function deployMode(v: unknown): DeployCheckMode {
  return v === "warn" || v === "gate" ? v : "off";
}

/** 本番反映の確認が有効なプロジェクトか。URLが入っていても off なら確認しない */
function deployActive(project: any): boolean {
  return deployMode(project?.deploy_check_mode) !== "off"
    && !!String(project?.deploy_check_url ?? "").trim();
}
function requireChecksMode(v: unknown): RequireChecksMode {
  return v === "off" || v === "reason" || v === "block" ? v : "warn";
}

/** 本番への確認の待ち時間。長く待たせると画面が固まるので短くする */
const DEPLOY_PROBE_TIMEOUT_MS = 8000;
/** 応答が巨大でも読み切らない。バージョン情報は先頭にあれば足りる */
const DEPLOY_PROBE_MAX_CHARS = 200_000;

/**
 * 反映の遅れをどこから「異常」とみなすか（分）。
 * ビルドとデプロイには時間がかかるので、マージ直後を異常と呼ばない猶予を置く。
 */
const DEPLOY_GRACE_MIN = 30;
/** Slack に流す閾値 */
const DEPLOY_SLACK_MIN = 120;
/** 赤帯（重大）に切り替える閾値 */
const DEPLOY_CRITICAL_MIN = 1440;

/** deploy_check_key が未設定・的外れだったときに拾いにいくキー名の候補 */
const DEPLOY_REF_KEYS = [
  "buildId", "commit", "commitSha", "commit_sha", "gitCommitSha",
  "sha", "revision", "gitSha", "build", "version",
];

const SHA_RE = /^[0-9a-f]{7,40}$/i;

// ── 確認先URLの安全確認 ──────────────────────────────────────
//
// このURLは組織の管理者が入力し、サーバーが代わりに取りに行く。
// 社内アドレスやクラウドのメタデータ（169.254.169.254）を指されると、
// サーバーからしか見えないものを覗く踏み台になるため、名前解決の結果まで見て弾く。

function isPrivateIp(ip: string): boolean {
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true;
    // ::ffff:10.0.0.1 のような IPv4 射影アドレス
    const m = v.match(/(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateIp(m[1]) : false;
  }
  const p = ip.split(".").map(Number);
  // 判別できないものは通さない（安全側）
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;            // リンクローカル（メタデータ）
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
  if (a >= 224) return true;                          // マルチキャスト・予約
  return false;
}

async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { throw new Error("確認先URLの形式が正しくありません。"); }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("確認先URLは http または https で指定してください。");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.+\.local|.+\.internal|.+\.localdomain)$/i.test(host)) {
    throw new Error("社内・ローカル向けのURLは確認先に指定できません。");
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error("確認先URLのホスト名を解決できませんでした。");
  }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) {
    throw new Error("社内・ローカル向けのURLは確認先に指定できません。");
  }
  return url;
}

// ── 本番が今どのコミットで動いているか ───────────────────────
interface DeployProbe {
  /** 本番から取れた値そのもの（コミットSHAとは限らない） */
  ref: string | null;
  /** 実際に読めたキー名。設定値と違う場合は画面で直させる */
  usedKey: string | null;
  error: string | null;
}

/** "build.commit" のようなドット区切りにも対応する */
function pickPath(obj: any, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

async function probeDeployedRef(rawUrl: string, key: string): Promise<DeployProbe> {
  let url: URL;
  try {
    url = await assertPublicUrl(rawUrl);
  } catch (e) {
    return { ref: null, usedKey: null, error: (e as Error).message };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DEPLOY_PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent": UA,
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        // CDN のキャッシュを掴むと「古いまま」に見えるので都度取り直す
        "Cache-Control": "no-cache",
      },
    });
    if (!res.ok) {
      return { ref: null, usedKey: null, error: `確認先URLが ${res.status} を返しました。` };
    }
    const text = (await res.text()).slice(0, DEPLOY_PROBE_MAX_CHARS);
    const parsed = (() => { try { return JSON.parse(text); } catch { return null; } })();

    if (parsed && typeof parsed === "object") {
      // 設定されたキーを最優先し、外れていたら定番のキー名も見る。
      // 「キー名だけ違って永久に未設定扱い」を避けるため
      const keys = Array.from(new Set([key.trim(), ...DEPLOY_REF_KEYS].filter(Boolean)));
      for (const k of keys) {
        const v = pickPath(parsed, k);
        if (typeof v === "string" && v.trim()) return { ref: v.trim(), usedKey: k, error: null };
        if (typeof v === "number" && Number.isFinite(v)) return { ref: String(v), usedKey: k, error: null };
      }
      return {
        ref: null, usedKey: null,
        error: `確認先の応答に「${key || DEPLOY_REF_KEYS[0]}」が見つかりませんでした。キー名をご確認ください。`,
      };
    }

    // JSON でない場合は、本文からコミットSHAらしき文字列を1つだけ拾う
    const m = text.match(/\b[0-9a-f]{7,40}\b/i);
    if (m) return { ref: m[0], usedKey: null, error: null };
    return { ref: null, usedKey: null, error: "確認先の応答からバージョンを読み取れませんでした。" };
  } catch (e) {
    const aborted = (e as Error)?.name === "AbortError";
    return {
      ref: null, usedKey: null,
      error: aborted ? "確認先URLへの接続がタイムアウトしました。" : "確認先URLへ接続できませんでした。",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── コミット1つ分のチェック状況（Checks / commit status / Deployments） ──
//
// check-runs だけを見ていると、Vercel の「Deployment was blocked」のように
// commit status 側に出るものを取りこぼし、失敗ですらなく「チェックなし」に見える。
// 3系統をまとめて見て、見られなかった系統は unavailable に残す
//（「問題なし」と「確認できていない」を混同しない）。

type ShaCheckState = "success" | "failure" | "pending" | "none";
type CheckSource = "check" | "status" | "deployment";

interface ShaCheck {
  name: string;
  state: ShaCheckState;
  source: CheckSource;
  description: string;
  url: string | null;
}

interface ShaCheckSummary {
  state: ShaCheckState;
  summary: string;
  checks: ShaCheck[];
  /** 見られなかった情報源（権限不足など） */
  unavailable: string[];
  /** 「ビルドされる前に止められている」疑い（Vercel の blocked など） */
  blocked: boolean;
}

const EMPTY_CHECK_SUMMARY: ShaCheckSummary = {
  state: "none", summary: "チェックなし", checks: [], unavailable: [], blocked: false,
};

/** blocked / canceled のように「実行されていない」ことを示す言い回し */
const BLOCKED_RE = /(blocked|canceled|cancelled|paused|suspend|not\s*built|skipped due)/i;

function statusState(s: string): ShaCheckState {
  if (s === "success" || s === "neutral" || s === "skipped" || s === "active") return "success";
  if (s === "pending" || s === "queued" || s === "in_progress" || s === "expected" || s === "waiting") return "pending";
  if (s === "failure" || s === "error" || s === "cancelled" || s === "timed_out" || s === "action_required") return "failure";
  return "none";
}

function rollUp(checks: ShaCheck[], unavailable: string[]): ShaCheckSummary {
  // 成功しているものは見ない。名前に "canceled" を含む正常なチェックを
  // 「止められている」と誤判定しないため
  const blocked = checks.some(c => c.state !== "success" && BLOCKED_RE.test(`${c.name} ${c.description}`));
  if (!checks.length) {
    return {
      state: "none",
      summary: unavailable.length ? "チェックを確認できませんでした" : "チェックなし",
      checks, unavailable, blocked: false,
    };
  }
  const failure = checks.filter(c => c.state === "failure").length;
  const pending = checks.filter(c => c.state === "pending").length;
  if (failure) {
    // 「blocked」は落ちたのではなく止められている。人がやることが違うので言い分ける
    const label = blocked ? `デプロイが止められています（${failure}件）` : `CI ${failure}件失敗`;
    return { state: "failure", summary: label, checks, unavailable, blocked };
  }
  if (pending) return { state: "pending", summary: `CI 実行中(${checks.length - pending}/${checks.length})`, checks, unavailable, blocked };
  return { state: "success", summary: `CI ${checks.length}件成功`, checks, unavailable, blocked };
}

async function summarizeSha(
  token: string, repo: string, sha: string, opts?: { deployments?: boolean },
): Promise<ShaCheckSummary> {
  if (!sha) return EMPTY_CHECK_SUMMARY;

  const [runsRes, statusRes, deploysRes] = await Promise.all([
    gh(token, `/repos/${repo}/commits/${sha}/check-runs?per_page=50`).then(r => ({ ok: true, data: r })).catch(() => ({ ok: false, data: null })),
    gh(token, `/repos/${repo}/commits/${sha}/status?per_page=50`).then(r => ({ ok: true, data: r })).catch(() => ({ ok: false, data: null })),
    opts?.deployments
      ? gh(token, `/repos/${repo}/deployments?sha=${sha}&per_page=10`).then(r => ({ ok: true, data: r })).catch(() => ({ ok: false, data: null }))
      : Promise.resolve({ ok: true, data: null as any }),
  ]);

  const checks: ShaCheck[] = [];
  const unavailable: string[] = [];

  if (runsRes.ok) {
    for (const r of ((runsRes.data as any)?.check_runs ?? []) as any[]) {
      checks.push({
        name: String(r?.name ?? ""),
        state: r?.status !== "completed" ? "pending" : statusState(String(r?.conclusion ?? "")),
        source: "check",
        description: String(r?.output?.title ?? r?.output?.summary ?? "").slice(0, 200),
        url: (r?.html_url as string) ?? null,
      });
    }
  } else {
    unavailable.push("Checks");
  }

  if (statusRes.ok) {
    for (const s of ((statusRes.data as any)?.statuses ?? []) as any[]) {
      checks.push({
        name: String(s?.context ?? ""),
        state: statusState(String(s?.state ?? "")),
        source: "status",
        description: String(s?.description ?? "").slice(0, 200),
        url: (s?.target_url as string) ?? null,
      });
    }
  } else {
    // Commit statuses は追加権限。無くても他で判定できるので機能は止めない
    unavailable.push("Commit statuses");
  }

  if (opts?.deployments) {
    if (deploysRes.ok) {
      const list = (Array.isArray(deploysRes.data) ? deploysRes.data : []) as any[];
      const withState = await Promise.all(list.slice(0, 5).map(async d => {
        const st = await gh(token, `/repos/${repo}/deployments/${d?.id}/statuses?per_page=1`).catch(() => null);
        const latest = Array.isArray(st) ? st[0] : null;
        return { d, latest };
      }));
      for (const { d, latest } of withState) {
        if (!latest) continue;
        checks.push({
          name: `デプロイ: ${String(d?.environment ?? "production")}`,
          state: statusState(String(latest?.state ?? "")),
          source: "deployment",
          description: String(latest?.description ?? "").slice(0, 200),
          url: (latest?.target_url as string) ?? (latest?.environment_url as string) ?? null,
        });
      }
    } else {
      unavailable.push("Deployments");
    }
  }

  return rollUp(checks, unavailable);
}

// ── 層A: マージ前の必須チェック ──────────────────────────────
//
// GitHub のブランチ保護（Required status checks）が未設定だと、チェックが失敗していても
// mergeable_state は clean のままで、Dev Ticket からも普通にマージできてしまう。
// 実際、失敗が積み上がったまま11件がマージされ、誰も気づかなかった。
// ブランチ保護の有無に関わらず、Dev Ticket 側で同じ関門を作る。

interface CheckGate {
  /** warn … 注意だけ／reason … 理由を書けば通す／block … 通さない */
  level: "warn" | "reason" | "block";
  summary: string;
  failed: string[];
  /** 「落ちた」ではなく「止められている」場合 */
  blockedDeploy: boolean;
}

function checkGateOf(mode: RequireChecksMode, sum: ShaCheckSummary | null): CheckGate | null {
  if (!sum || mode === "off") return null;
  // 実行中（pending）では止めない。日常の作業が回らなくなるため
  if (sum.state !== "failure") return null;
  const failed = sum.checks
    .filter(c => c.state === "failure")
    .map(c => (c.description ? `${c.name}（${c.description}）` : c.name));
  return {
    level: mode === "warn" ? "warn" : mode,
    summary: sum.summary,
    failed,
    blockedDeploy: sum.blocked,
  };
}

function checkGateMessage(gate: CheckGate, number: number): string {
  const head = gate.blockedDeploy
    ? `#${number} はデプロイが止められています`
    : `#${number} は失敗しているチェックがあります`;
  const tail = gate.level === "block"
    ? "このプロジェクトでは、失敗したままのマージを禁止しています。"
    : "このままマージしても本番に反映されない可能性があります。続ける場合は理由を入力してください。";
  return `${head}（${gate.failed.slice(0, 3).join(" / ") || gate.summary}）。${tail}`;
}

// ── 層B/C: 本番反映の観測 ────────────────────────────────────
interface DeployPendingPull { number: number; title: string; url: string }
interface DeployPendingTicket { wbs: string; title: string; status: string }

interface DeployEval {
  configured: boolean;
  /**
   * not-configured … 確認先URLが未設定（＝確認していない。成功扱いにはしない）
   * in-sync        … 本番に既定ブランチの先頭まで入っている
   * behind         … 本番が遅れている（＝今回の事故の状態）
   * unreachable    … 確認先URLに届かなかった
   * unknown        … 値は取れたがコミットとして突き合わせられなかった
   * error          … GitHub 側の取得に失敗
   */
  state: "not-configured" | "in-sync" | "behind" | "unreachable" | "unknown" | "error";
  ok: boolean;
  mode: DeployCheckMode;
  deployedRef: string | null;
  deployedSha: string | null;
  headSha: string | null;
  headMessage: string | null;
  headCommittedAt: string | null;
  behindBy: number;
  /** ずれ始めた時刻＝未反映コミットのうち最も古いもの。前回値に頼らず毎回導出する */
  behindSince: string | null;
  /** 未反映のコミット。リリース反映のゲートで使う */
  pendingShas: string[];
  pendingPulls: DeployPendingPull[];
  pendingTickets: DeployPendingTicket[];
  check: ShaCheckSummary | null;
  message: string;
  error: string | null;
}

function notConfigured(mode: DeployCheckMode): DeployEval {
  return {
    configured: false, state: "not-configured", ok: false, mode,
    deployedRef: null, deployedSha: null, headSha: null, headMessage: null, headCommittedAt: null,
    behindBy: 0, behindSince: null, pendingShas: [], pendingPulls: [], pendingTickets: [],
    check: null,
    message: "本番反映の確認が未設定です。マージ＝リリース済みとして扱っています。",
    error: null,
  };
}

/** マージコミットのメッセージからPR番号とタイトルを拾う */
function pullFromCommitMessage(message: string): { number: number; title: string } | null {
  const first = message.split("\n")[0] ?? "";
  const squash = first.match(/\(#(\d+)\)\s*$/);
  if (squash) return { number: Number(squash[1]), title: first.replace(/\s*\(#\d+\)\s*$/, "").trim() };
  const merge = first.match(/^Merge pull request #(\d+)/);
  if (merge) {
    // "Merge pull request #12 from owner/branch" の次行に本来のタイトルが入る
    const title = (message.split("\n").slice(1).find(l => l.trim()) ?? first).trim();
    return { number: Number(merge[1]), title };
  }
  return null;
}

/**
 * 本番に何が乗っているかを観測する。GitHub とプロジェクトの設定だけを使い、
 * 呼び出し側（画面・cron・リリース反映）で結果を使い分ける。
 */
async function evaluateDeploy(sb: SupabaseClient, project: any): Promise<DeployEval> {
  const mode = deployMode(project?.deploy_check_mode);
  const url = String(project?.deploy_check_url ?? "").trim();
  const key = String(project?.deploy_check_key ?? "").trim();
  const repo = String(project?.github_repo_full_name ?? "");
  if (!url || !repo) return notConfigured(mode);

  const base = notConfigured(mode);
  base.configured = true;

  let token: string;
  try {
    token = await installationToken(await getInstallationId(sb, project.organization_id));
  } catch (e) {
    return { ...base, state: "error", message: "GitHubとの接続が確認できませんでした。", error: String((e as Error)?.message ?? e).slice(0, 200) };
  }

  // 本番への確認と GitHub 側の取得は依存していないので同時に投げる
  const [probe, repoInfo] = await Promise.all([
    probeDeployedRef(url, key),
    gh(token, `/repos/${repo}`).catch(() => null),
  ]);

  const branch = repoInfo?.default_branch || project.github_default_branch || "main";
  const headCommit = await gh(token, `/repos/${repo}/commits/${encodeURIComponent(branch)}`).catch(() => null);
  const headSha = String(headCommit?.sha ?? "");
  const headMessage = String(headCommit?.commit?.message ?? "").split("\n")[0] || null;
  const headCommittedAt = headCommit?.commit?.committer?.date ?? headCommit?.commit?.author?.date ?? null;

  // 既定ブランチ先頭のチェックは、遅れている理由（blocked など）を出すために必ず取る
  const check = headSha ? await summarizeSha(token, repo, headSha, { deployments: true }) : null;
  const common = { ...base, headSha: headSha || null, headMessage, headCommittedAt, check };

  if (!headSha) {
    return { ...common, state: "error", message: `既定ブランチ（${branch}）の先頭を取得できませんでした。`, error: null };
  }
  if (probe.error || !probe.ref) {
    return {
      ...common, state: "unreachable",
      message: probe.error ?? "本番のバージョンを取得できませんでした。",
      error: probe.error,
    };
  }

  const ref = probe.ref;
  if (!SHA_RE.test(ref)) {
    return {
      ...common, state: "unknown", deployedRef: ref,
      message: `本番から取得した「${ref}」はコミットSHAではないため、${branch} と突き合わせられません。`
        + "確認先のキーにコミットSHA（先頭7桁以上）を出すよう変更してください。",
      error: null,
    };
  }

  let cmp: any = null;
  try {
    cmp = await gh(token, `/repos/${repo}/compare/${encodeURIComponent(ref)}...${encodeURIComponent(headSha)}`);
  } catch (e) {
    if (e instanceof GithubError && e.status === 404) {
      return {
        ...common, state: "unknown", deployedRef: ref,
        message: `本番のコミット ${ref.slice(0, 7)} がリポジトリに見つかりません（別リポジトリの値か、履歴が書き換えられた可能性があります）。`,
        error: null,
      };
    }
    return { ...common, state: "error", deployedRef: ref, message: "本番と既定ブランチの比較に失敗しました。", error: String((e as Error)?.message ?? e).slice(0, 200) };
  }

  const status = String(cmp?.status ?? "");
  const deployedSha = String(cmp?.base_commit?.sha ?? ref);

  // "behind"（本番の方が新しい）は、ホットフィックスや別経路のデプロイで起こり得る。
  // 未反映は無いので警告しない
  if (status === "identical" || status === "behind") {
    return {
      ...common, state: "in-sync", ok: true, deployedRef: ref, deployedSha,
      message: status === "identical"
        ? "本番は最新です。"
        : "本番の方が新しいコミットで動いています（未反映の変更はありません）。",
      error: null,
    };
  }

  const behindBy = Number(cmp?.ahead_by ?? 0);
  const commits = (Array.isArray(cmp?.commits) ? cmp.commits : []) as any[];
  const pendingShas = commits.map(c => String(c?.sha ?? "")).filter(Boolean);

  // ずれ始めた時刻＝未反映のうち最も古いコミットの日時。
  // 前回の観測値を引き継がないので、cron が止まっていた期間があっても正しく出る
  const dates = commits
    .map(c => c?.commit?.committer?.date ?? c?.commit?.author?.date)
    .filter(Boolean)
    .map((d: string) => new Date(d).getTime())
    .filter((t: number) => Number.isFinite(t));
  const behindSince = dates.length ? new Date(Math.min(...dates)).toISOString() : headCommittedAt;

  // 未反映のPR。マージコミットのメッセージから拾う（PR一覧を引き直すより桁違いに軽い）
  const pullMap = new Map<number, DeployPendingPull>();
  const wbsSet = new Set<string>();
  for (const c of commits) {
    const message = String(c?.commit?.message ?? "");
    const hit = pullFromCommitMessage(message);
    if (hit && !pullMap.has(hit.number)) {
      pullMap.set(hit.number, { number: hit.number, title: hit.title, url: `https://github.com/${repo}/pull/${hit.number}` });
    }
    for (const w of detectWbs("", message).list) wbsSet.add(w);
  }

  // 未反映のチケット。「リリース済みと言われているのに本番に無い」ものを名指しできるようにする
  let pendingTickets: DeployPendingTicket[] = [];
  if (wbsSet.size) {
    const { data: sprints } = await sb.from("sprints").select("id").eq("project_id", project.id);
    const sprintIds = (sprints ?? []).map(s => (s as any).id);
    const rows = await ticketsByWbs(sb, sprintIds, Array.from(wbsSet), "wbs, title, status");
    // 並び順を固定する。DBの返す順は一定でないため、放置すると
    // 更新のたびに未反映チケットの並びが入れ替わって見える（BUG-01）
    pendingTickets = rows
      .map(t => ({ wbs: String(t.wbs ?? ""), title: String(t.title ?? ""), status: String(t.status ?? "") }))
      .sort((a, b) => a.wbs.localeCompare(b.wbs));
  }

  const short = ref.slice(0, 7);
  return {
    ...common,
    state: "behind", ok: false, deployedRef: ref, deployedSha,
    behindBy, behindSince, pendingShas,
    pendingPulls: Array.from(pullMap.values()).sort((a, b) => a.number - b.number),
    pendingTickets,
    message: `本番は ${short} で動いており、${branch} より ${behindBy}コミット遅れています。`,
    error: null,
  };
}

/** 遅れの深刻度。時間で段階を上げる（マージ直後を異常と呼ばないため） */
function deployAlertLevel(ev: DeployEval): "none" | "notice" | "slack" | "critical" {
  if (ev.state !== "behind" || !ev.behindSince) return "none";
  const minutes = (Date.now() - new Date(ev.behindSince).getTime()) / 60_000;
  if (minutes >= DEPLOY_CRITICAL_MIN) return "critical";
  if (minutes >= DEPLOY_SLACK_MIN) return "slack";
  if (minutes >= DEPLOY_GRACE_MIN) return "notice";
  return "none";
}

/** プロジェクトの Slack チャンネルへ投稿する。設定が無ければ何もしない */
async function postProjectSlack(sb: SupabaseClient, projectId: string, text: string): Promise<boolean> {
  const { data } = await sb.from("projects")
    .select("slack_access_token, slack_channel, slack_notifications_enabled")
    .eq("id", projectId).maybeSingle();
  const token = (data as any)?.slack_access_token;
  const channel = (data as any)?.slack_channel;
  if (!token || !channel || (data as any)?.slack_notifications_enabled === false) return false;
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel, text }),
    });
    const json = await res.json() as { ok: boolean; error?: string };
    if (!json.ok) console.error("[github deploy-check] slack:", json.error);
    return json.ok;
  } catch (e) {
    console.error("[github deploy-check] slack:", (e as Error)?.message);
    return false;
  }
}

function slackAlertText(project: any, ev: DeployEval, level: "slack" | "critical"): string {
  const head = level === "critical"
    ? `:rotating_light: *本番に反映されていません（24時間以上）* — ${project.name}`
    : `:warning: *本番に反映されていません* — ${project.name}`;
  const lines = [
    head,
    `${ev.message}`,
    ev.deployedSha ? `本番: \`${ev.deployedSha.slice(0, 7)}\` / main: \`${(ev.headSha ?? "").slice(0, 7)}\`` : "",
    ev.pendingPulls.length ? `未反映のPR: ${ev.pendingPulls.map(p => `#${p.number}`).join(" ")}` : "",
    ev.pendingTickets.length ? `未反映のチケット: ${ev.pendingTickets.map(t => t.wbs).filter(Boolean).join(" / ")}` : "",
    ev.check?.state === "failure" ? `main のチェック: ${ev.check.summary}｜${ev.check.checks.filter(c => c.state === "failure").map(c => `${c.name}: ${c.description}`).join(" / ")}` : "",
    `<https://github.com/${project.github_repo_full_name}/commits|GitHubで確認する>`,
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * 観測して保存し、必要なら知らせる。
 * notify=false（画面からの取得）では通知しない。通知は定期実行に集約して重複を避ける。
 */
async function runDeployCheck(
  sb: SupabaseClient, project: any, opts?: { notify?: boolean },
): Promise<DeployEval> {
  const ev = await evaluateDeploy(sb, project);

  const { data: prev } = await sb.from("project_deploy_status")
    .select("alerted_level, alerted_sha").eq("project_id", project.id).maybeSingle();
  const prevLevel = String((prev as any)?.alerted_level ?? "none");
  const prevSha = String((prev as any)?.alerted_sha ?? "");

  const level = deployAlertLevel(ev);
  let alertedLevel = prevLevel;
  let alertedSha = prevSha;
  let alertedAt: string | null = null;

  if (opts?.notify) {
    if ((level === "slack" || level === "critical")
      && (prevLevel !== level || prevSha !== (ev.headSha ?? ""))) {
      const sent = await postProjectSlack(sb, project.id, slackAlertText(project, ev, level));
      if (sent) { alertedLevel = level; alertedSha = ev.headSha ?? ""; alertedAt = new Date().toISOString(); }
    } else if (ev.state === "in-sync" && (prevLevel === "slack" || prevLevel === "critical")) {
      // 直ったことも必ず言う。言わないと「まだ止まっているのか」を毎回確かめに行くことになる
      await postProjectSlack(sb, project.id,
        `:white_check_mark: *本番へ反映されました* — ${project.name}\n本番: \`${(ev.deployedSha ?? "").slice(0, 7)}\``);
      alertedLevel = "none"; alertedSha = ""; alertedAt = new Date().toISOString();
    }
  }

  const row: Record<string, unknown> = {
    project_id: project.id,
    checked_at: new Date().toISOString(),
    state: ev.state,
    ok: ev.ok,
    deployed_ref: ev.deployedRef,
    deployed_sha: ev.deployedSha,
    head_sha: ev.headSha,
    head_message: ev.headMessage,
    head_committed_at: ev.headCommittedAt,
    behind_by: ev.behindBy,
    behind_since: ev.behindSince,
    // 一覧に出すのは先頭だけで足りる。全部入れると行が肥大する
    pending_pulls: ev.pendingPulls.slice(0, 50),
    pending_tickets: ev.pendingTickets.slice(0, 50),
    check_state: ev.check?.state ?? null,
    check_summary: ev.check?.summary ?? null,
    check_detail: (ev.check?.checks ?? []).slice(0, 30),
    check_unavailable: ev.check?.unavailable ?? [],
    message: ev.message,
    error: ev.error,
    alerted_level: alertedLevel,
    alerted_sha: alertedSha || null,
    updated_at: new Date().toISOString(),
    ...(alertedAt ? { alerted_at: alertedAt } : {}),
  };
  const { error } = await sb.from("project_deploy_status").upsert(row, { onConflict: "project_id" });
  if (error) console.error("[github deploy-check] 保存に失敗:", error.message);

  return ev;
}

/** 保存済みの観測結果を画面向けの形に整える */
function mapDeployRow(row: any, project: any): Record<string, unknown> {
  const mode = deployMode(project?.deploy_check_mode);
  const level = row?.state === "behind" && row?.behind_since
    ? (() => {
        const m = (Date.now() - new Date(row.behind_since).getTime()) / 60_000;
        return m >= DEPLOY_CRITICAL_MIN ? "critical" : m >= DEPLOY_SLACK_MIN ? "slack" : m >= DEPLOY_GRACE_MIN ? "notice" : "none";
      })()
    : "none";
  return {
    // 「確認が有効か」。URLが入っていても mode=off なら確認していない
    configured: deployActive(project),
    mode,
    requireChecksMode: requireChecksMode(project?.require_checks_mode),
    checkUrl: project?.deploy_check_url ?? null,
    checkKey: project?.deploy_check_key ?? null,
    state: row?.state ?? "not-configured",
    ok: !!row?.ok,
    level,
    checkedAt: row?.checked_at ?? null,
    deployedRef: row?.deployed_ref ?? null,
    deployedSha: row?.deployed_sha ?? null,
    headSha: row?.head_sha ?? null,
    headMessage: row?.head_message ?? null,
    headCommittedAt: row?.head_committed_at ?? null,
    behindBy: row?.behind_by ?? 0,
    behindSince: row?.behind_since ?? null,
    pendingPulls: row?.pending_pulls ?? [],
    pendingTickets: row?.pending_tickets ?? [],
    checkState: row?.check_state ?? null,
    checkSummary: row?.check_summary ?? null,
    checkDetail: row?.check_detail ?? [],
    checkUnavailable: row?.check_unavailable ?? [],
    message: row?.message ?? null,
    error: row?.error ?? null,
    repo: project?.github_repo_full_name ?? null,
    defaultBranch: project?.github_default_branch ?? null,
  };
}

/** 画面から見て観測が古いか。開くたびに本番へ投げないための線引き */
const DEPLOY_FRESH_MS = 10 * 60_000;

const DEPLOY_PROJECT_COLUMNS =
  "id, name, organization_id, github_repo_full_name, github_default_branch, "
  + "deploy_check_url, deploy_check_key, deploy_check_mode, require_checks_mode";

async function handleDeployStatus(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view", { installation: false });
  const { data: project } = await sb.from("projects").select(DEPLOY_PROJECT_COLUMNS).eq("id", ctx.id).maybeSingle();
  if (!project) throw new HttpError(404, "プロジェクトが見つかりません。");

  const { data: row } = await sb.from("project_deploy_status").select("*").eq("project_id", ctx.id).maybeSingle();

  const active = deployActive(project);
  const stale = !row?.checked_at || Date.now() - new Date(row.checked_at as string).getTime() > DEPLOY_FRESH_MS;
  const force = req.query?.fresh === "1" || req.query?.fresh === 1;

  if (active && (stale || force)) {
    // 通知は定期実行に任せる。画面を開くたびに Slack が鳴ると誰も見なくなる
    await runDeployCheck(sb, project, { notify: false }).catch(e => {
      console.error("[github deploy-status]", ctx.id, (e as Error)?.message);
    });
    const { data: fresh } = await sb.from("project_deploy_status").select("*").eq("project_id", ctx.id).maybeSingle();
    return res.status(200).json({ deploy: mapDeployRow(fresh, project), level: ctx.level });
  }

  return res.status(200).json({ deploy: mapDeployRow(row, project), level: ctx.level });
}

/** 画面の「今すぐ確認する」。観測だけを強制的にやり直す */
async function handleDeployCheck(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "view", { installation: false });
  const { data: project } = await sb.from("projects").select(DEPLOY_PROJECT_COLUMNS).eq("id", ctx.id).maybeSingle();
  if (!project) throw new HttpError(404, "プロジェクトが見つかりません。");
  if (!deployActive(project)) {
    throw new HttpError(409, "このプロジェクトでは本番反映の確認が有効になっていません（設定でURLと確認の強さを指定してください）。");
  }
  await runDeployCheck(sb, project, { notify: false });
  const { data: row } = await sb.from("project_deploy_status").select("*").eq("project_id", ctx.id).maybeSingle();
  return res.status(200).json({ deploy: mapDeployRow(row, project), level: ctx.level });
}

/**
 * 外部連携画面の診断。組織のプロジェクトを横に並べて
 * 「未保護」「反映確認 未設定」「遅延中」を1画面で見せる。
 *
 * ブランチ保護の判定はリポジトリ1件につき1リクエストなので、件数に上限を置く。
 * 打ち切った場合は黙って隠さず、件数を返して画面に出す。
 */
const DEPLOY_OVERVIEW_MAX = 40;
/** 同時に GitHub へ投げるプロジェクト数（1件あたり2リクエスト） */
const DEPLOY_OVERVIEW_CHUNK = 5;

async function handleDeployOverview(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  await requireOrgAdmin(sb, caller);
  const orgId = targetOrgId(caller, req);

  let q = sb.from("projects").select(`${DEPLOY_PROJECT_COLUMNS}, github_enabled`).order("name");
  if (orgId) q = q.eq("organization_id", orgId);
  const { data: all } = await q;
  const projects = ((all ?? []) as any[]).filter(p => p.github_enabled && p.github_repo_full_name);

  const { data: statuses } = await sb.from("project_deploy_status").select("*");
  const byProject = new Map(((statuses ?? []) as any[]).map(s => [String(s.project_id), s]));

  // ブランチ保護は GitHub を叩かないと分からない。接続が無ければ判定不能のまま返す
  let token = "";
  let installationId = "";
  try {
    installationId = await getInstallationId(sb, orgId);
    token = await installationToken(installationId);
  } catch { /* 未接続。protected は null のまま */ }

  const targets = projects.slice(0, DEPLOY_OVERVIEW_MAX);
  const rows: any[] = [];
  // 全件を一度に投げると GitHub 側の連続アクセス制限に当たる。少しずつ進める
  for (let i = 0; i < targets.length; i += DEPLOY_OVERVIEW_CHUNK) {
    const chunk = await Promise.all(targets.slice(i, i + DEPLOY_OVERVIEW_CHUNK).map(async p => {
      let branchProtected: boolean | null = null;
      let defaultBranch: string = p.github_default_branch ?? "";
      if (token) {
        const info = await gh(token, `/repos/${p.github_repo_full_name}`).catch(() => null);
        defaultBranch = info?.default_branch || defaultBranch || "main";
        const branch = await gh(token, `/repos/${p.github_repo_full_name}/branches/${encodeURIComponent(defaultBranch)}`).catch(() => null);
        if (branch) branchProtected = !!branch.protected;
      }
      return {
        projectId: p.id,
        projectName: p.name,
        repo: p.github_repo_full_name,
        defaultBranch: defaultBranch || null,
        branchProtected,
        deploy: mapDeployRow(byProject.get(String(p.id)), p),
      };
    }));
    rows.push(...chunk);
  }

  // 追加権限が無いと commit status / Deployments が読めず、Vercel の blocked を取りこぼす。
  // 「不足している」と「確認していない」を分けるため、判定できたときだけ返す
  const optionalMissingPermissions = installationId
    ? shortage((await installationPermissions(installationId)).perms, OPTIONAL_PERMISSIONS)
    : [];

  return res.status(200).json({
    rows,
    truncated: Math.max(0, projects.length - targets.length),
    optionalMissingPermissions,
  });
}

// ── ハンドラ ─────────────────────────────────────────────────
export default async function handler(req: any, res: any) {
  const resource = String(req.query?.resource ?? "");

  // GitHub からの着地だけは Bearer が付けられないので、認証の前に処理する
  if (resource === "install-callback") return installCallback(req, res);

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "サーバー設定エラーが発生しました" }); }

  // GitHub からの Webhook もログイン中のユーザーが居ない。署名で検証する
  if (resource === "webhook") {
    try {
      return await githubWebhook(sb, req, res);
    } catch (e) {
      console.error("[github webhook]", (e as Error)?.message);
      // 500 を返すと GitHub 側で再送が積まれるので、受領だけは返しておく
      return res.status(200).json({ ok: false });
    }
  }

  // 定期実行からの呼び出し。ログイン中のユーザーが居ないので共有シークレットで通す。
  // Vercel Cron は CRON_SECRET を設定しておくと Authorization: Bearer で送ってくるが、
  // 中身はただのHTTPエンドポイントなので、他のスケジューラからでも同じように叩ける。
  if (resource === "sync-released" && isCronRequest(req)) {
    try {
      return await runReleaseSync(sb, null, res);
    } catch (e) {
      console.error("[github sync-released]", (e as Error)?.message);
      return res.status(500).json({ error: "リリース反映に失敗しました" });
    }
  }

  const caller = await getCaller(sb, req);
  if (!caller) return res.status(401).json({ error: "認証が必要です" });

  try {
    switch (resource) {
      case "install-start": return await installStart(sb, caller, req, res);
      case "sync-released": {
        // 画面からの手動実行。自分の組織だけを対象にする。
        // 押すたびに Slack が鳴ると誰も見なくなるので、通知は定期実行だけに任せる
        await requireOrgAdmin(sb, caller);
        return await runReleaseSync(
          sb, targetOrgId(caller, req) || String(caller.organizationId ?? ""), res, { notify: false });
      }
      case "adopt":    return await handleAdopt(sb, caller, req, res);
      case "status":   return await handleStatus(sb, caller, req, res);
      case "repos":    return await handleRepos(sb, caller, req, res);
      case "pulls":    return await handlePulls(sb, caller, req, res);
      case "pull":     return await handlePull(sb, caller, req, res);
      case "issues":   return await handleIssues(sb, caller, req, res);
      case "commits":  return await handleCommits(sb, caller, req, res);
      case "branches": return await handleBranches(sb, caller, req, res);
      case "pending-branches": return await handlePendingBranches(sb, caller, req, res);
      // ブランチ作成は数百ミリ秒で終わり、失敗しても作り直せる。
      // 「実行中」を残す3つ（create-pull / merge / merge-bulk）には入れない
      case "create-branch": return await handleCreateBranch(sb, caller, req, res);
      case "ticket-branches": return await handleTicketBranches(sb, caller, req, res);
      case "deploy-status":   return await handleDeployStatus(sb, caller, req, res);
      case "deploy-check":    return await handleDeployCheck(sb, caller, req, res);
      case "deploy-overview": return await handleDeployOverview(sb, caller, req, res);
      case "links":    return await handleLinks(sb, caller, req, res);
      // 取り消しの効かない3つだけは「実行中」を残す。閉じて開き直したときに
      // 結果まで見届けられるようにするため（withActionRun のコメント参照）
      case "create-pull":
        return await withActionRun(sb, caller, "create-pull", req, res, r => handleCreatePull(sb, caller, req, r));
      case "merge-precheck": return await handleMergePrecheck(sb, caller, req, res);
      case "merge":
        return await withActionRun(sb, caller, "merge", req, res, r => handleMerge(sb, caller, req, r));
      case "merge-bulk":
        return await withActionRun(sb, caller, "merge-bulk", req, res, r => handleMergeBulk(sb, caller, req, r));
      case "review":   return await handleReview(sb, caller, req, res);
      case "comment":  return await handleComment(sb, caller, req, res);
      case "link":     return await handleLink(sb, caller, req, res);
      case "unlink":   return await handleUnlink(sb, caller, req, res);
      case "backfill-links": return await handleBackfillLinks(sb, caller, req, res);
      case "resolve-candidate": return await handleResolveCandidate(sb, caller, req, res);
      default:         return res.status(404).json({ error: "Not Found" });
    }
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...(e.payload ?? {}) });
    const m = jaMessage(e);
    console.error("[github]", resource, (e as Error)?.message);
    return res.status(m.status).json({ error: m.message });
  }
}

// ── リリースノートへの自動反映 ───────────────────────────────
//
// 「リリース待ち」のチケットのうち、PRが既定ブランチへマージ済みのものを
// 「リリース済み」にする。見ているのは GitHub 上のPRの状態だけなので、
// そのプロジェクトのデプロイ先（Vercel / AWS / オンプレ）に依存しない。
//
// 判定材料を ticket_github_links だけに頼らないこと。紐付けは PR一覧
// （open のみ取得）を開いたときにしか作られないため、GitHub 側でPRを作って
// そのままマージすると紐付けが1件も残らず、いつまでもリリース待ちのまま
// 取り残される。ここでは閉じたPRも遡ってブランチ名／タイトルの WBS 番号で
// 突き合わせ、見つかった紐付けは保存し直す。

/**
 * 走査の深さ。呼ばれる場所によって変える。
 *
 * 画面（PR一覧・チケット詳細の関連PR）からは表示を待たせるので浅く。
 * 「更新の新しい順」に見るのでマージ直後のPRは必ず1ページ目に入る。
 * 取りこぼしは定期実行と手動実行の深い走査で拾う。
 */
interface ReleaseSyncDepth {
  /** PRを遡るページ数（100件／ページ） */
  pages: number;
  /** 走査範囲外だった紐付けを、番号指定で引き直す上限 */
  lookups: number;
}
const SYNC_INTERACTIVE: ReleaseSyncDepth = { pages: 1, lookups: 10 };
const SYNC_FULL: ReleaseSyncDepth = { pages: 10, lookups: 50 };

/** 番号指定の引き直しを同時に投げる本数 */
const LOOKUP_CHUNK = 10;

/** 過去PRの穴埋めで遡るページ数（100件／ページ） */
const LINK_BACKFILL_PAGES = 10;

/** 紐付けの埋め直しを一度に処理するPR数。WBS番号を条件に並べるためURL長の上限に当たらないようにする */
const LINK_BACKFILL_CHUNK = 100;

/** 自動実行なので実行者が居ない。監査ログ用の固定ID */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/**
 * 定期実行からの呼び出しか。
 *
 * CRON_SECRET を設定してあれば Bearer で突き合わせる（Vercel Cron は設定して
 * おくと自動で付けてくる）。未設定の環境では突き合わせようがないので、
 * Vercel Cron が付けるヘッダで判定したうえで警告を残す。
 * ここで黙って false を返すと定期実行が 401 になり続け、
 * 「マージしたのにリリース待ちのまま」の原因に気づけないため。
 */
function isCronRequest(req: any): boolean {
  const secret = process.env.CRON_SECRET;
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (secret) {
    if (token.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(secret));
  }

  const ua = String(req.headers?.["user-agent"] ?? "").toLowerCase();
  if (req.headers?.["x-vercel-cron"] != null || ua.startsWith("vercel-cron")) {
    console.warn("[github sync-released] CRON_SECRET が未設定のため、ヘッダだけで定期実行と判定した");
    return true;
  }
  return false;
}

/** 判定に使うPRの状態 */
interface PrState {
  number: number;
  merged: boolean;
  base: string;
  open: boolean;
  title: string;
  url: string;
  /** マージ結果のコミット。本番へ反映済みかの判定に使う（docs/deploy-verification-design.md） */
  mergeCommitSha: string;
  /** 自動紐付けの根拠（ブランチ名／タイトルのどちらで WBS を拾ったか） */
  reason: string | null;
}

function toPrState(p: any): PrState {
  const head = p?.head?.ref ?? "";
  const title = p?.title ?? "";
  return {
    number: Number(p?.number ?? 0),
    merged: !!p?.merged_at,
    base: p?.base?.ref ?? "",
    open: p?.state === "open",
    title,
    url: p?.html_url ?? "",
    mergeCommitSha: String(p?.merge_commit_sha ?? ""),
    reason: detectWbs(head, title).reason,
  };
}

interface ReleaseSyncDetail {
  projectId: string;
  projectName: string;
  released: { wbs: string; title: string; pulls: number[] }[];
  /** 本番反映を確認できなかったので前へ進めなかった場合の理由（deploy_check_mode=gate） */
  deployHold?: string;
  /** 本番反映の観測結果。遅れているプロジェクトを一覧で返すために持つ */
  deployState?: string;
  deployMessage?: string;
  error?: string;
}

async function runReleaseSync(sb: SupabaseClient, orgId: string | null, res: any, opts?: { notify?: boolean }) {
  let q = sb.from("projects")
    .select(DEPLOY_PROJECT_COLUMNS)
    .eq("github_enabled", true)
    .not("github_repo_full_name", "is", null);
  if (orgId) q = q.eq("organization_id", orgId);
  const { data: projects, error: projectsError } = await q;
  // 対象0件と「引けなかった」を混同すると、何も起きないのに成功に見えてしまう
  if (projectsError) throw new Error(projectsError.message);

  const details: ReleaseSyncDetail[] = [];
  let released = 0;
  let behind = 0;

  for (const p of (projects ?? []) as any[]) {
    const detail: ReleaseSyncDetail = { projectId: p.id, projectName: p.name, released: [] };

    // ① 先に本番反映を観測する（層C）。
    //    リリース待ちのチケットが1件も無くても必ず走らせる。
    //    「リリース済みにしたものが無い＝問題なし」ではないため、ここを条件付きにしない。
    //    ここで得た結果を②へ渡し、同じ確認を二度走らせない。
    let ev: DeployEval | undefined;
    if (deployMode(p.deploy_check_mode) !== "off") {
      try {
        ev = await runDeployCheck(sb, p, { notify: opts?.notify !== false });
        detail.deployState = ev.state;
        detail.deployMessage = ev.message;
        if (ev.state === "behind") behind++;
      } catch (e) {
        console.error("[github deploy-check]", p.id, (e as Error)?.message);
      }
    }

    // ② リリース待ち → リリース済み
    try {
      await syncProjectReleases(sb, p, detail, SYNC_FULL, ev);
      released += detail.released.length;
    } catch (e) {
      // 1プロジェクトの失敗で全体を止めない（接続が切れている組織などがあり得る）
      detail.error = String((e as Error)?.message ?? e).slice(0, 200);
      console.error("[github sync-released]", p.id, detail.error);
    }

    if (detail.released.length || detail.error || detail.deployHold || detail.deployState === "behind") {
      details.push(detail);
    }
  }

  return res.status(200).json({ ok: true, released, behind, details });
}

/**
 * 層B: 「本番に反映されたか」で前へ進めてよいかを決める材料を用意する。
 *
 * mode が gate のときだけ効く。返すのは
 *   hold    … 反映を確認できていない理由（入っていたら1件も進めない）
 *   pending … まだ本番に入っていないマージコミット
 *
 * ★ 保存済みの観測結果で済ませない ★
 *   マージ直後にも呼ばれる経路（syncReleasesNow）があるため、数分前の
 *   「本番は最新」をそのまま使うと、たった今マージしたぶんまで反映済みと判定してしまう。
 *   定期実行からは直前の観測結果を pre で渡して二度手間を避ける。
 */
async function deployGateFor(
  sb: SupabaseClient, project: any, pre?: DeployEval,
): Promise<{ pending: Set<string>; hold: string } | null> {
  if (deployMode(project?.deploy_check_mode) !== "gate") return null;
  if (!String(project?.deploy_check_url ?? "").trim()) {
    return { pending: new Set(), hold: "本番反映の確認先URLが未設定のため、リリース済みにできません。" };
  }

  const ev = pre ?? await runDeployCheck(sb, project, { notify: false });

  if (ev.state === "in-sync") return { pending: new Set(), hold: "" };
  if (ev.state === "behind") {
    // compare が返すコミットは最大250件。それを超えると未反映の一覧が欠け、
    // 「入っていないのに入っている」と誤判定する。数が合わないときは進めない
    if (ev.behindBy > ev.pendingShas.length) {
      return { pending: new Set(), hold: `未反映が${ev.behindBy}コミットあり、内訳を取り切れないため保留しています。` };
    }
    return { pending: new Set(ev.pendingShas), hold: "" };
  }
  // unreachable / unknown / error / not-configured。
  // 確認できないまま「リリース済み」にすると、確認する仕組みを入れた意味が無くなる
  return { pending: new Set(), hold: ev.message || "本番への反映を確認できないため保留しています。" };
}

async function syncProjectReleases(
  sb: SupabaseClient, project: any, detail: ReleaseSyncDetail, depth: ReleaseSyncDepth,
  /** 直前に観測済みなら渡す。同じ確認を二度走らせないため */
  preDeploy?: DeployEval,
) {
  const { data: sprints } = await sb.from("sprints").select("id").eq("project_id", project.id);
  const sprintIds = (sprints ?? []).map(s => (s as any).id);
  if (!sprintIds.length) return;

  // 前へ進めるのは「リリース待ち」からだけ。他のステータスには一切触らない
  const { data: tickets } = await sb
    .from("sprint_tickets").select("id, wbs, title")
    .in("sprint_id", sprintIds).eq("status", "waiting-release");
  // 対象が無ければ GitHub は一切叩かない（PR一覧の表示のたびに呼ばれるため）
  if (!tickets?.length) return;

  // 層B: 本番へ反映されたことを確認できるまで「リリース済み」にしない。
  // hold が入っているプロジェクトは、この回は1件も進めない
  const gate = await deployGateFor(sb, project, preDeploy);
  if (gate?.hold) {
    detail.deployHold = gate.hold;
    return;
  }

  const installationId = await getInstallationId(sb, project.organization_id);
  const token = await installationToken(installationId);
  const repo = String(project.github_repo_full_name ?? "");

  const ticketIds = (tickets ?? []).map(t => (t as any).id);
  const { data: links } = ticketIds.length
    ? await sb.from("ticket_github_links").select("ticket_id, number")
      .eq("project_id", project.id).eq("kind", "pull").in("ticket_id", ticketIds)
    : { data: [] as any[] };

  // ① 更新の新しい順にPRを遡り、WBS番号で突き合わせる。
  //    紐付けが1件も無いチケットはここで拾う（マージ済みPRは open の一覧に出ないため）。
  //    リリース待ちのチケットが全て見つかった時点で打ち切る
  const prState = new Map<number, PrState>();
  const byWbs = new Map<string, number[]>();
  const unmatched = new Set(
    (tickets ?? []).map(t => String((t as any).wbs ?? "").toUpperCase()).filter(Boolean),
  );
  let repoInfo: any = null;

  for (let page = 1; page <= depth.pages; page++) {
    // 既定ブランチの確認（1ページ目のときだけ）は走査と同時に投げて往復を増やさない
    const [info, chunk] = await Promise.all([
      page === 1 ? gh(token, `/repos/${repo}`).catch(() => null) : Promise.resolve(repoInfo),
      gh(token, `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`)
        .catch(() => []),
    ]);
    repoInfo = info;

    const list: any[] = Array.isArray(chunk) ? chunk : [];
    for (const p of list) {
      const st = toPrState(p);
      if (!st.number) continue;
      prState.set(st.number, st);
      for (const w of detectWbs(p?.head?.ref ?? "", p?.title ?? "").list) {
        byWbs.set(w, [...(byWbs.get(w) ?? []), st.number]);
        unmatched.delete(w);
      }
    }
    if (list.length < 100) break;
    if (!unmatched.size) break;
  }

  // 既定ブランチはリポジトリ側を正とする（接続時に保存した値が古いことがある）
  const defaultBranch = repoInfo?.default_branch || project.github_default_branch || "main";

  // ② 明示的に紐付いているのに走査範囲の外だったPRは、番号を指定して引き直す。
  //    存在しない番号（手で紐付けを間違えた等）は判定から外す。ここで「状態不明」の
  //    まま残すと、そのチケットが永久にリリース待ちから動かなくなるため
  const gone = new Set<number>();
  const missing = Array.from(new Set((links ?? []).map(l => Number((l as any).number))))
    .filter(n => Number.isInteger(n) && n > 0 && !prState.has(n))
    .slice(0, depth.lookups);
  for (let i = 0; i < missing.length; i += LOOKUP_CHUNK) {
    await Promise.all(missing.slice(i, i + LOOKUP_CHUNK).map(async n => {
      try {
        prState.set(n, toPrState(await gh(token, `/repos/${repo}/pulls/${n}`)));
      } catch (e) {
        if (e instanceof GithubError && e.status === 404) gone.add(n);
        // それ以外（レート制限・一時的な失敗）は状態不明のまま次回に持ち越す
      }
    }));
  }

  const targets: { id: string; wbs: string; title: string; pulls: number[] }[] = [];
  const newLinks: Record<string, unknown>[] = [];

  for (const t of tickets as any[]) {
    const wbs = String(t.wbs ?? "").toUpperCase();
    const linked = (links ?? [])
      .filter(l => (l as any).ticket_id === t.id).map(l => Number((l as any).number));
    const numbers = Array.from(new Set([...linked, ...(wbs ? byWbs.get(wbs) ?? [] : [])]))
      .filter(n => !gone.has(n));
    if (!numbers.length) continue;

    const states = numbers.map(n => prState.get(n));
    // 1つでも状態を確認できなかったら見送る（誤って完了扱いにしない）
    if (states.some(s => !s)) continue;
    // まだ開いているPRがあるなら作業の途中とみなして触らない
    if (states.some(s => s!.open)) continue;

    // マージされずに閉じただけのPR（取り下げ・作り直し）は判定から外す。
    // 1件でも既定ブランチへ入っていればリリース済みとして良い
    const merged = (states as PrState[]).filter(s => s.merged && s.base === defaultBranch);
    if (!merged.length) continue;

    // マージ済みでも、そのマージコミットがまだ本番に入っていなければ進めない（層B）。
    // マージコミットが分からないものも「確認できていない」として見送る
    if (gate) {
      const notDeployed = merged.some(m => !m.mergeCommitSha || gate.pending.has(m.mergeCommitSha));
      if (notDeployed) continue;
    }

    targets.push({
      id: t.id, wbs: t.wbs ?? "", title: t.title ?? "",
      pulls: merged.map(m => m.number).sort((a, b) => a - b),
    });
    // 走査で見つけた分は紐付けとしても残す（チケットから辿れるようにするため）
    for (const m of merged) {
      if (linked.includes(m.number)) continue;
      newLinks.push({
        project_id: project.id,
        ticket_id: t.id,
        kind: "pull",
        number: m.number,
        title: m.title,
        state: "merged",
        url: m.url,
        auto_linked: true,
        auto_reason: m.reason,
      });
    }
  }
  if (!targets.length) return;

  // 更新内容はリリースノートの一括リリースと同じにそろえる。
  // 条件に status を残しているのは、判定中に人が別のステータスへ動かしていた場合に
  // 上書きしないため。
  const { error } = await sb.from("sprint_tickets")
    .update({ status: "released", progress: 100 })
    .in("id", targets.map(t => t.id))
    .eq("status", "waiting-release");
  if (error) throw new Error(error.message);

  if (newLinks.length) {
    await sb.from("ticket_github_links")
      .upsert(newLinks, { onConflict: "project_id,ticket_id,kind,number" });
  }

  // 一覧の表示に使う紐付けの状態も合わせておく
  const mergedNumbers = Array.from(new Set(targets.flatMap(t => t.pulls)));
  if (mergedNumbers.length) {
    await sb.from("ticket_github_links").update({ state: "merged" })
      .eq("project_id", project.id).eq("kind", "pull").in("number", mergedNumbers);
  }

  await sb.from("github_action_logs").insert(targets.map(t => ({
    project_id: project.id,
    actor_id: SYSTEM_ACTOR_ID,
    actor_name: "システム（PRマージによる自動反映）",
    action: "auto_release",
    repo: project.github_repo_full_name,
    pr_number: t.pulls[0] ?? null,
    result: "ok",
    detail: `${t.wbs} ${t.title} / PR #${t.pulls.join(", #")}`.slice(0, 500),
  })));

  detail.released = targets.map(t => ({ wbs: t.wbs, title: t.title, pulls: t.pulls }));
}

/**
 * 1プロジェクトだけその場で反映する。マージ直後とPR一覧の表示時に呼ぶ。
 *
 * 定期実行だけに任せると、Cron の設定漏れやプランの実行間隔の制約で
 * 「マージしたのにリリース待ちのまま」になるため、人がGitHubを触った
 * タイミングでも必ず1回は走らせる。表示や操作の本筋は止めない。
 *
 * 表示を待たせる経路なので走査は1ページ（＝直近100PR）まで。
 * リリース待ちのチケットが1件も無ければ GitHub は一切叩かない。
 */
async function syncReleasesNow(sb: SupabaseClient, projectId: string) {
  try {
    const { data: project } = await sb.from("projects")
      .select(DEPLOY_PROJECT_COLUMNS)
      .eq("id", projectId).maybeSingle();
    if (!project || !(project as any).github_repo_full_name) return;
    await syncProjectReleases(sb, project, {
      projectId, projectName: (project as any).name ?? "", released: [],
    }, SYNC_INTERACTIVE);
  } catch (e) {
    console.error("[github sync-released] immediate", projectId, (e as Error)?.message);
  }
}

// ── Webhook ──────────────────────────────────────────────────
//
// PRが作られた／閉じられた瞬間に紐付けとリリース反映を走らせる。
// これが動いていれば、定期実行やGitHubタブを開く操作を待たずに反映される。
//
// GitHub App 側の設定（Webhook URL と Secret、Pull requests の購読）が必要。
// 未設定でも他の経路（定期実行・マージ直後・PR一覧の表示）で反映されるので、
// この受け口が無くても機能は成立する。

/** 反応するイベント。synchronize（push のたび）等は紐付けに影響しないので無視する */
const WEBHOOK_ACTIONS = new Set([
  "opened", "reopened", "edited", "closed", "ready_for_review", "converted_to_draft",
]);

/**
 * 生のリクエストボディを取り出す。
 *
 * 署名は「GitHubが送ってきたバイト列そのもの」に対して計算されているため、
 * 一度 JSON にしたものを stringify し直すと（エスケープの流儀が違って）一致しない。
 * 実行環境が先にボディを読んでしまっている場合は空文字を返し、呼び出し側で
 * 「署名を検証できなかった」として扱う。
 */
async function readRawBody(req: any): Promise<string> {
  // req.body に触れる前にストリームを試す。実装によっては body を参照した時点で
  // 解析が走り、生のバイト列を取り直せなくなるため順番が重要
  try {
    if (!req.readableEnded) {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
      if (chunks.length) return Buffer.concat(chunks).toString("utf8");
    }
  } catch {
    // 読めなければ下の fallback へ
  }
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return "";
}

type SignatureResult = "ok" | "invalid" | "unverifiable";

function verifyWebhookSignature(raw: string, header: unknown): SignatureResult {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return "unverifiable";
  if (!raw) return "unverifiable";

  const sent = String(header ?? "");
  if (!sent.startsWith("sha256=")) return "invalid";
  const expect = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  if (sent.length !== expect.length) return "invalid";
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expect)) ? "ok" : "invalid";
}

async function githubWebhook(sb: SupabaseClient, req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const event = String(req.headers?.["x-github-event"] ?? "");
  if (event === "ping") return res.status(200).json({ ok: true });
  if (event !== "pull_request") return res.status(200).json({ ok: true, skipped: event || "unknown" });

  const raw = await readRawBody(req);
  const payload = raw ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : parseBody(req);
  if (!payload) return res.status(400).json({ error: "payload を解釈できませんでした" });

  const signature = verifyWebhookSignature(raw, req.headers?.["x-hub-signature-256"]);
  if (signature === "invalid") return res.status(401).json({ error: "署名が一致しません" });
  if (signature === "unverifiable") {
    // 署名を確かめられない場合も、payload の中身は一切信用しない。
    // 使うのは「どのリポジトリの何番か」だけで、状態は必ず GitHub から引き直すため、
    // 偽の通知を受けても間違ったステータス更新にはならない
    console.warn("[github webhook] 署名を検証できなかった（GITHUB_WEBHOOK_SECRET 未設定か、生ボディを取得できず）");
  }

  const action = String(payload?.action ?? "");
  if (!WEBHOOK_ACTIONS.has(action)) return res.status(200).json({ ok: true, skipped: action });

  const repo = String(payload?.repository?.full_name ?? "");
  const number = Number(payload?.pull_request?.number ?? 0);
  if (!repo || !Number.isInteger(number) || number <= 0) {
    return res.status(200).json({ ok: true, skipped: "対象を特定できませんでした" });
  }

  const { data: projects } = await sb.from("projects")
    .select(DEPLOY_PROJECT_COLUMNS)
    .eq("github_repo_full_name", repo).eq("github_enabled", true);
  if (!projects?.length) return res.status(200).json({ ok: true, skipped: "未接続のリポジトリ" });

  for (const p of projects as any[]) {
    try {
      await applyPullRequestEvent(sb, p, number);
    } catch (e) {
      // 1プロジェクトの失敗で他を止めない。GitHub には受領を返す
      console.error("[github webhook]", p.id, (e as Error)?.message);
    }
  }
  return res.status(200).json({ ok: true, projects: projects.length });
}

/** 通知されたPRを GitHub から引き直し、紐付けとリリース反映を行う */
async function applyPullRequestEvent(sb: SupabaseClient, project: any, number: number) {
  const installationId = await getInstallationId(sb, project.organization_id);
  const token = await installationToken(installationId);
  // payload を信用せず必ず引き直す。ここが偽の通知に対する歯止めになっている
  const pr = await gh(token, `/repos/${project.github_repo_full_name}/pulls/${number}`);
  if (!pr?.number) return;

  await autoLink(sb, project.id, String(project.github_repo_full_name ?? ""), [mapPull(pr)]);
  await syncProjectReleases(sb, project, {
    projectId: project.id, projectName: project.name ?? "", released: [],
  }, SYNC_INTERACTIVE);
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

  if (!appConfigured()) return fail("サーバーに GitHub App が設定されていません（GITHUB_APP_ID / GITHUB_APP_SLUG / GITHUB_APP_PRIVATE_KEY）");

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return fail("サーバー設定エラーが発生しました"); }

  // 「リポジトリを追加・変更」→ Save で戻ってきた場合（Redirect on update）、
  // この着地は Dev Ticket 側の接続ボタンを経由していないので state が付かない。
  // 接続済みのインストールなら、これは新規接続ではなく更新なので正常系として扱う。
  const parsed = verifyState(String(state ?? ""));
  let orgId = parsed?.orgId ?? "";
  let connectedBy = parsed?.userId ?? null;
  const isUpdate = !parsed;

  if (!parsed) {
    const { data: existing } = await sb
      .from("github_installations")
      .select("organization_id, connected_by")
      .eq("installation_id", String(installationId))
      .maybeSingle();
    if (existing) {
      orgId = String((existing as any).organization_id);
      connectedBy = (existing as any).connected_by ?? null;
    }
  }

  if (!orgId) {
    return fail("接続情報が確認できませんでした。Dev Ticket の「GitHubに接続する」からやり直してください");
  }

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

  // ④ 保存。supabase-js は例外を投げず error を返すので、必ず中身を見る。
  // 更新（リポジトリの追加・変更）のときは、最初に接続した人と日時を上書きしない。
  const row: Record<string, unknown> = {
    organization_id: orgId,
    installation_id: String(installationId),
    account_login: account?.account?.login ?? "",
    account_type: account?.account?.type ?? "",
    repo_selection: account?.repository_selection ?? "",
    revoked_at: null,
  };
  if (!isUpdate) {
    row.connected_by = connectedBy;
    row.connected_at = new Date().toISOString();
  }

  const { error: dbError } = await sb
    .from("github_installations").upsert(row, { onConflict: "organization_id" });

  if (dbError) {
    console.error("[github install-callback] db upsert failed:", dbError.message);
    return fail(`接続情報の保存に失敗しました / ${dbError.message.slice(0, 300)}`);
  }

  const kind = isUpdate ? "updated" : "success";
  return res.redirect(302, `${back}&github=${kind}&repos=${repoCount}&action=${encodeURIComponent(String(setupAction ?? "install"))}`);
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
    /**
     * インストールに足りていない権限。空でなければ、その操作は必ず失敗する。
     * 実行して初めて分かる状態にしないため、接続状態と並べてここで出す。
     */
    missingPermissions: [] as MissingPermission[],
    /**
     * 不足がどちら側にあるか。
     *   "app"     … App の設定そのもの（承認では直らない）
     *   "install" … 宣言は足りていて、インストールの承認がまだ
     * 直しに行く画面が違うため、まとめずに分けて持つ。
     */
    permissionScope: null as "app" | "install" | null,
    /**
     * 無くても動くが、あるとデプロイの事故を検知できる権限（Commit statuses / Deployments）。
     * 不足していても操作は失敗しないので、missingPermissions とは分けて弱く案内する。
     */
    optionalMissingPermissions: [] as MissingPermission[],
    /** App の権限設定ページ。所有者だけが開ける */
    appPermissionsUrl: appPermissionsUrl(),
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
    // ここで引いた宣言を権限判定でも使う（同じ画面で /app を二度叩かない）
    appPermsCache = { perms: (app?.permissions as Record<string, string> | undefined) ?? null, at: Date.now() };
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

  // App の宣言とインストール実体の両方を見る。
  //   ・App 側が足りない … 承認しても直らないので、App 設定へ案内する
  //   ・App 側は足りている … 承認待ち。インストール画面へ案内する
  // どちらか一方しか見ないと、案内どおりに操作しても直らない状態が続く。
  // 判定できなくても接続そのものは使えるので、失敗は握って空のままにする
  if (!revoked) {
    const declared = await appPermissions();
    const declaredShort = missingPermissions(declared);
    const inst = await installationPermissions(String(data.installation_id), true);
    if (declaredShort.length) {
      base.missingPermissions = declaredShort;
      base.permissionScope = "app";
    } else {
      const installShort = missingPermissions(inst.perms);
      if (installShort.length) {
        base.missingPermissions = installShort;
        base.permissionScope = "install";
      }
    }
    // 任意の権限は App の宣言とインストールの両方を見て、足りない側を出す。
    // 足りなくても操作は失敗しないので、警告の強さは変える
    base.optionalMissingPermissions = shortage(declared, OPTIONAL_PERMISSIONS).length
      ? shortage(declared, OPTIONAL_PERMISSIONS)
      : shortage(inst.perms, OPTIONAL_PERMISSIONS);
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

  // light=1 … 番号・タイトル・検出WBSだけあればよい呼び出し（チケット詳細の紐付け候補）。
  // チケットを開くたびに走るため、CI・レビューの取得（PR1件あたり3リクエスト）と
  // リリース反映は行わない。GitHub API の呼び出し回数を抑えるためのもの
  const light = req.query?.light === "1" || req.query?.light === 1;

  // マージが権限で止まる状態なら、一覧を出す時点で知らせる（選んで押してから気づかせない）。
  // 一覧の取得と並行して引くので待ち時間は増やさない
  const [list, writeBlock] = await Promise.all([
    gh(token, `/repos/${ctx.repo}/pulls?state=open&per_page=50&sort=updated&direction=desc`),
    !light && ctx.level === "merge"
      ? permissionBlock(ctx.installationId, "merge").catch(() => null)
      : Promise.resolve(null),
  ]);

  // CI・レビュー・マージ可否は一覧APIでは取れないので、上位15件だけ実データを引く。
  // mergeable_state を持たせないと一覧のマージボタンが常に無効になり、
  // 毎回「詳細」を開かせることになるため、ここで一緒に取る。
  const pulls = (list ?? []).map(mapPull);
  const enriched = light ? pulls : await Promise.all(pulls.map(async (p: any, i: number) => {
    if (i >= 15) return p;
    try {
      // チェックは check-runs だけでなく commit status も見る。
      // Vercel の「Deployment was blocked」は status 側に出ることがあり、
      // check-runs しか見ていないと失敗ですらなく「チェックなし」に化ける（BRU13-041）
      const [detail0, c, reviews] = await Promise.all([
        gh(token, `/repos/${ctx.repo}/pulls/${p.number}`).catch(() => null),
        summarizeSha(token, ctx.repo, p.headSha),
        gh(token, `/repos/${ctx.repo}/pulls/${p.number}/reviews?per_page=50`).catch(() => null),
      ]);
      // GitHub のマージ可否は「聞かれてから」計算される。しばらく触られていないPRは
      // 1回目が unknown（mergeable=null）で返り、その要求をきっかけに計算される。
      // ここで諦めると一覧では「判定中＝マージ不可」のまま出てしまい、
      // 詳細を開いた人にだけマージできるように見える（BRU13-036）ので、一度だけ引き直す
      const detail = needsMergeableRetry(detail0)
        ? await sleep(MERGEABLE_RETRY_MS).then(() =>
            gh(token, `/repos/${ctx.repo}/pulls/${p.number}`).catch(() => detail0))
        : detail0;
      const r = summarizeReviews(reviews ?? []);
      return {
        ...p,
        mergeable: detail?.mergeable ?? p.mergeable,
        mergeableState: detail?.mergeable_state ?? p.mergeableState,
        checkState: c.state, checkSummary: c.summary,
        checkBlocked: c.blocked, checkUnavailable: c.unavailable,
        reviewState: r.state, reviewSummary: r.summary,
      };
    } catch { return p; }
  }));

  await autoLink(sb, ctx.id, ctx.repo, enriched);
  // 一覧を開いた時点でマージ済みのPRを拾い直す。
  // 「リリース待ち」が無ければ GitHub は叩かないので、通常は追加の負荷にならない
  if (!light) await syncReleasesNow(sb, ctx.id);
  const links = await loadLinksForProject(sb, ctx.id);
  return res.status(200).json({
    pulls: enriched, level: ctx.level, perms: ctx.perms, repo: ctx.repo, links, writeBlock,
    // 画面が「失敗チェックのままマージしようとしている」を先に出せるようにする
    requireChecksMode: ctx.requireChecksMode,
  });
}

async function handlePull(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const number = Number(req.query?.number ?? 0);
  if (!number) throw new HttpError(400, "PR番号が不正です。");

  const token = await installationToken(ctx.installationId);
  const first = await gh(token, `/repos/${ctx.repo}/pulls/${number}`);
  // 一覧と同じく、判定中なら一度だけ引き直す（BRU13-036）
  const p = needsMergeableRetry(first)
    ? await sleep(MERGEABLE_RETRY_MS).then(() => gh(token, `/repos/${ctx.repo}/pulls/${number}`).catch(() => first))
    : first;
  // 詳細では Deployments まで見る。「なぜ本番に出ないのか」を1画面で読ませるため
  const [c, reviews] = await Promise.all([
    summarizeSha(token, ctx.repo, String(p.head?.sha ?? ""), { deployments: true }),
    gh(token, `/repos/${ctx.repo}/pulls/${number}/reviews?per_page=50`).catch(() => null),
  ]);
  const r = summarizeReviews(reviews ?? []);

  return res.status(200).json({
    pull: {
      ...mapPull(p),
      body: p.body ?? "",
      changedFiles: p.changed_files ?? 0,
      additions: p.additions ?? 0,
      deletions: p.deletions ?? 0,
      checkState: c.state, checkSummary: c.summary,
      checks: c.checks.map(x => ({ name: x.name, state: x.state, description: x.description, url: x.url })),
      checkBlocked: c.blocked, checkUnavailable: c.unavailable,
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
  // 1ページ（100件）で打ち切ると、ブランチ数が多いリポジトリで新しいブランチが一覧にも
  // PR作成ダイアログの選択肢にも出てこないため、全ページ辿る
  const [list, repo] = await Promise.all([
    ghPaged(token, `/repos/${ctx.repo}/branches`, PENDING_SCAN_PAGES),
    gh(token, `/repos/${ctx.repo}`),
  ]);
  const def = repo?.default_branch ?? ctx.defaultBranch;
  const branches = (list ?? []).map((b: any) => ({
    name: b.name,
    protected: !!b.protected,
    isDefault: b.name === def,
    lastCommitSha: b.commit?.sha ?? "",
  })).sort((a: any, b: any) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1));
  return res.status(200).json({ branches, defaultBranch: def, level: ctx.level, perms: ctx.perms, repo: ctx.repo });
}

/**
 * まだプルリクエストが作られていないブランチの一覧。
 *
 * 判定は2段構え。片方だけだと、マージ後もブランチを消さない運用で過去のブランチが全部並ぶ。
 *  1. そのブランチを head にした PR が「一度でも」作られていないこと
 *     （open だけを見ると、マージ済みPRを持つブランチが「未作成」に化ける）
 *  2. 既定ブランチにまだ取り込まれていないこと（ahead_by > 0）
 *
 * ブランチを「最後にコミットした順」で並べたいが、REST のブランチ一覧は日時も PR 有無も返さない。
 * 1本ずつ引くと本数分の呼び出しになるため、GraphQL で全ページ辿って一度に取る。
 * GraphQL が使えない場合は、日時なし・名前順の簡易版にフォールバックする。
 */
async function ghGraphql(token: string, query: string, variables: Record<string, unknown>) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null) as any;
  if (!res.ok || json?.errors?.length) {
    throw new GithubError(res.status, json?.errors?.[0]?.message || `GraphQL エラー (${res.status})`);
  }
  return json?.data;
}

// orderBy の TAG_COMMIT_DATE は refs/tags/ にしか効かず、refs/heads/ では並び順が保証されない。
// ページングを安定させるために ALPHABETICAL で取り、コミット日時の並べ替えは取得後に自前で行う。
const PENDING_BRANCH_QUERY = `
query($owner:String!,$name:String!,$n:Int!,$after:String){
  repository(owner:$owner,name:$name){
    refs(refPrefix:"refs/heads/",first:$n,after:$after,orderBy:{field:ALPHABETICAL,direction:ASC}){
      pageInfo{ hasNextPage endCursor }
      nodes{
        name
        associatedPullRequests(first:1){ totalCount }
        target{ ... on Commit { oid committedDate messageHeadline author{ name } } }
      }
    }
  }
}`;

/** 100件×このページ数まで走査する。これを超えるリポジトリは実質ない */
const PENDING_SCAN_PAGES = 10;
/** 取り込み済み判定（compare）を掛ける上限。PR有無で絞った後なので通常は数本 */
const PENDING_COMPARE_MAX = 100;
/** compare を同時に投げる本数 */
const PENDING_COMPARE_CHUNK = 10;

/** ページングして全件取る。100件未満が返ったところで打ち切る */
async function ghPaged(token: string, path: string, pages: number): Promise<any[]> {
  const out: any[] = [];
  for (let p = 1; p <= pages; p++) {
    const sep = path.includes("?") ? "&" : "?";
    const chunk = await gh(token, `${path}${sep}per_page=100&page=${p}`).catch(() => []);
    const arr = Array.isArray(chunk) ? chunk : [];
    out.push(...arr);
    if (arr.length < 100) break;
  }
  return out;
}

async function handlePendingBranches(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view");
  const token = await installationToken(ctx.installationId);
  const [owner, name] = ctx.repo.split("/");

  // チケット詳細から呼ぶときだけ渡ってくる。そのチケットのブランチしか使わないので、
  // 重い判定を掛ける前にここまで絞る（GitHub画面からの呼び出しは従来どおり全件）
  const wbsFilter = String(req.query?.wbs ?? "").trim().toUpperCase();
  const ticketFilter = String(req.query?.ticketId ?? "").trim();

  // 既定ブランチの取得はブランチ走査と依存関係が無いので、待たずに同時に投げる
  const repoInfoPromise = gh(token, `/repos/${ctx.repo}`).catch(() => null);

  // 名前で絞る際の逃し道。Dev Ticket から作ったブランチは名前が自由なので、
  // WBS 番号を含まないものがある。そのチケットに紐付いた名前を先に控えておき、
  // 名前一致に加えてこれも残す（BRU13-054）
  const linkedNamesPromise: Promise<Set<string>> = ticketFilter
    ? (async () => {
      const { data } = await sb.from("ticket_github_branches").select("branch_name")
        .eq("project_id", ctx.id).eq("repo", ctx.repo).eq("ticket_id", ticketFilter);
      return new Set((data ?? []).map((r: any) => String(r.branch_name)));
    })()
    : Promise.resolve(new Set<string>());

  type Row = {
    name: string; sha: string; message: string; committedDate: string | null; authorName: string;
    /** そのブランチを head にした PR の数。open/closed/merged すべて数える */
    prCount: number;
  };
  let rows: Row[] = [];

  try {
    let after: string | null = null;
    for (let page = 0; page < PENDING_SCAN_PAGES; page++) {
      const data = await ghGraphql(token, PENDING_BRANCH_QUERY, { owner, name, n: 100, after });
      const refs = data?.repository?.refs;
      rows.push(...((refs?.nodes ?? []) as any[]).map(n => ({
        name: n?.name ?? "",
        sha: n?.target?.oid ?? "",
        message: n?.target?.messageHeadline ?? "",
        committedDate: n?.target?.committedDate ?? null,
        authorName: n?.target?.author?.name ?? "",
        prCount: n?.associatedPullRequests?.totalCount ?? 0,
      })));
      if (!refs?.pageInfo?.hasNextPage) { after = null; break; }
      after = refs.pageInfo.endCursor as string;
    }
    if (after) console.warn(`[github pending-branches] ${ctx.repo}: ブランチが多すぎて全件は走査していない`);
  } catch (e) {
    // GraphQL が使えない環境向けの簡易版。日時が取れないので名前順のまま返す。
    // PR の有無は state=all を全ページ辿って自前で突き合わせる（open だけでは判定できない）
    console.error("[github pending-branches] graphql failed:", (e as Error)?.message);
    const [list, pulls] = await Promise.all([
      ghPaged(token, `/repos/${ctx.repo}/branches`, PENDING_SCAN_PAGES),
      ghPaged(token, `/repos/${ctx.repo}/pulls?state=all`, PENDING_SCAN_PAGES),
    ]);
    const withPr = new Set(pulls.map((p: any) => p.head?.ref).filter(Boolean));
    rows = list.map((b: any) => ({
      name: b.name, sha: b.commit?.sha ?? "", message: "", committedDate: null, authorName: "",
      prCount: withPr.has(b.name) ? 1 : 0,
    }));
  }

  const repoInfo = await repoInfoPromise;
  const defaultBranch = repoInfo?.default_branch ?? ctx.defaultBranch ?? "main";

  // 0段目：チケット詳細からの呼び出しは、その番号を含むブランチしか表示に使わない。
  // ここで先に落としておくと、この後の「取り込み済み判定」(compare は1本につき1リクエスト)が
  // 最大100本から通常0〜数本に減る。チケットを開いたときの待ち時間はここが支配的だった
  if (wbsFilter || ticketFilter) {
    const linkedNames = await linkedNamesPromise;
    rows = rows.filter(r =>
      (wbsFilter && r.name.toUpperCase().includes(wbsFilter)) || linkedNames.has(r.name));
  }

  // 1段目：PR が一度も作られていないブランチだけ残す。
  // 表示は新しい順、新着バナーは先頭を使うので、ここで最終コミット日時の降順に並べ直す
  // （ISO8601 は文字列比較で時系列順になる。日時が取れないフォールバック時は末尾に寄る）
  const noPr = rows
    .filter(r => r.name && r.name !== defaultBranch && r.prCount === 0)
    .sort((a, b) => (b.committedDate ?? "").localeCompare(a.committedDate ?? ""));

  // 2段目：既定ブランチに取り込み済みのものを落とす。
  // 中間ブランチなど、自身にPRが無いまま別経路で main に入っているものがここで消える
  const checked = noPr.slice(0, PENDING_COMPARE_MAX);
  const unmerged: Row[] = [];
  for (let i = 0; i < checked.length; i += PENDING_COMPARE_CHUNK) {
    const chunk = checked.slice(i, i + PENDING_COMPARE_CHUNK);
    const kept = await Promise.all(chunk.map(async r => {
      const cmp = await gh(
        token,
        `/repos/${ctx.repo}/compare/${encodeURIComponent(defaultBranch)}...${encodeURIComponent(r.name)}`,
      ).catch(() => null);
      // 比較できなかったものは伏せずに残す（見落とすより出しすぎるほうがまし）
      return typeof cmp?.ahead_by === "number" && cmp.ahead_by === 0 ? null : r;
    }));
    unmerged.push(...kept.filter((r): r is Row => !!r));
  }
  // 上限を超えた分は判定を掛けられないので、そのまま残す
  const candidates = [...unmerged, ...noPr.slice(PENDING_COMPARE_MAX)];

  // ブランチ名の WBS 番号から、このプロジェクトのチケット名を引いて添える
  const wbsByBranch = new Map<string, string>();
  for (const c of candidates) {
    const m = c.name.toUpperCase().match(/[A-Z][A-Z0-9]*-\d+/);
    if (m) wbsByBranch.set(c.name, m[0]);
  }
  const titleByWbs = new Map<string, string>();
  const wbsList = Array.from(new Set(wbsByBranch.values()));
  if (wbsList.length) {
    const { data: sprints } = await sb.from("sprints").select("id").eq("project_id", ctx.id);
    const sprintIds = (sprints ?? []).map(s => (s as any).id);
    if (sprintIds.length) {
      const tickets = await ticketsByWbs(sb, sprintIds, wbsList, "wbs, title");
      for (const t of tickets) titleByWbs.set(String(t.wbs).toUpperCase(), t.title);
    }
  }

  // Dev Ticket から作ったブランチは、名前に WBS 番号が無くてもチケットが分かる（BRU13-054）。
  // 名前から拾えた WBS より、作成時に残した記録のほうが確かなので、こちらを優先する
  const ticketByBranch = await branchTicketMap(sb, ctx.id, ctx.repo, candidates.map(c => c.name));
  const linkedTickets = new Map<string, { wbs: string | null; title: string | null }>();
  if (ticketByBranch.size) {
    const { data: rows } = await sb.from("sprint_tickets")
      .select("id, wbs, title").in("id", Array.from(new Set(ticketByBranch.values())));
    for (const t of (rows ?? []) as any[]) {
      linkedTickets.set(String(t.id), { wbs: t.wbs ?? null, title: t.title ?? null });
    }
  }

  return res.status(200).json({
    level: ctx.level,
    perms: ctx.perms,
    repo: ctx.repo,
    defaultBranch,
    branches: candidates.map(({ prCount: _prCount, ...c }) => {
      const ticketId = ticketByBranch.get(c.name) ?? null;
      const linked = ticketId ? linkedTickets.get(ticketId) : undefined;
      if (linked) return { ...c, wbs: linked.wbs, ticketTitle: linked.title, ticketId };
      const wbs = wbsByBranch.get(c.name) ?? null;
      return { ...c, wbs, ticketTitle: wbs ? (titleByWbs.get(wbs) ?? null) : null, ticketId: null };
    }),
  });
}

// ── 紐付け ───────────────────────────────────────────────────
/**
 * WBS番号でチケットを引く。
 *
 * ブランチ名／タイトルから拾った WBS は大文字に正規化してある（detectWbs）が、
 * チケット側の wbs はプロジェクトが決めた接頭辞そのままで、小文字のこともある
 * （demo-071 など）。`in("wbs", …)` は完全一致なので、大文字の接頭辞を使って
 * いるプロジェクトだけ紐付き、小文字のプロジェクトは1件も当たらなかった。
 * 大文字小文字を無視して引くために ilike を使う。
 * WBS は英数字とハイフンだけなので、ワイルドカードの混入は起きない。
 */
async function ticketsByWbs(
  sb: SupabaseClient, sprintIds: string[], wbsList: string[], columns: string,
): Promise<any[]> {
  if (!sprintIds.length || !wbsList.length) return [];
  const { data } = await sb
    .from("sprint_tickets").select(columns)
    .in("sprint_id", sprintIds)
    .or(wbsList.map(w => `wbs.ilike.${w}`).join(","));
  return (data ?? []) as any[];
}

/** PostgREST が1リクエストで返す上限。これを超える件数は分割して読む */
const REST_PAGE_SIZE = 1000;

/** このプロジェクトのPR紐付けを全件。件数が上限を超えても取りこぼさないよう分割して読む */
async function allPullLinks(sb: SupabaseClient, projectId: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += REST_PAGE_SIZE) {
    const { data } = await sb
      .from("ticket_github_links")
      .select("id, ticket_id, number, auto_linked, state, title, url, wbs_spelling")
      .eq("project_id", projectId).eq("kind", "pull")
      .order("id").range(from, from + REST_PAGE_SIZE - 1);
    const page = (data ?? []) as any[];
    out.push(...page);
    if (page.length < REST_PAGE_SIZE) break;
  }
  return out;
}

/**
 * ブランチ名 → チケット の紐付けを引く（supabase/add_ticket_github_branches.sql）。
 *
 * Dev Ticket からブランチを作ったときに残した記録。ブランチ名に WBS 番号が
 * 入っていなくてもチケットが分かる、唯一の手がかりになる。
 * repo も条件に入れるのは、プロジェクトのリポジトリを別のものへ張り替えたときに、
 * 旧リポジトリの同名ブランチへ誤って紐付けないため。
 */
async function branchTicketMap(
  sb: SupabaseClient, projectId: string, repo: string, names: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = Array.from(new Set(names.filter(Boolean)));
  if (!repo || !uniq.length) return out;
  const { data } = await sb
    .from("ticket_github_branches")
    .select("branch_name, ticket_id")
    .eq("project_id", projectId).eq("repo", repo)
    .in("branch_name", uniq);
  for (const r of (data ?? []) as any[]) out.set(String(r.branch_name), String(r.ticket_id));
  return out;
}

/**
 * Dev Ticket で作ったブランチから出たPRを、そのブランチのチケットへ紐付ける（BRU13-054）。
 *
 * WBS 番号による紐付けと違い、こちらは作成時に残した事実そのものなので迷う余地がない。
 * 綴り違いの候補出しにも回さず、そのまま紐付ける。
 * 手で外した紐付け（auto_linked = false）は上書きしない、という扱いは WBS 側と揃える。
 */
async function linkByBranch(sb: SupabaseClient, projectId: string, repo: string, pulls: any[]) {
  const byBranch = await branchTicketMap(sb, projectId, repo, pulls.map(p => String(p.head ?? "")));
  if (!byBranch.size) return;

  const existing = await allPullLinks(sb, projectId);
  const before = new Map(existing.map(e => [`${e.ticket_id}#${e.number}`, e]));

  const toUpsert: Record<string, unknown>[] = [];
  for (const p of pulls) {
    const ticketId = byBranch.get(String(p.head ?? ""));
    if (!ticketId) continue;
    const row = {
      project_id: projectId,
      ticket_id: ticketId,
      kind: "pull",
      number: p.number,
      title: p.title,
      state: p.merged ? "merged" : p.state,
      url: p.url,
      auto_linked: true,
      auto_reason: `ブランチ ${p.head}（Dev Ticketで作成）`,
    };
    const prev = before.get(`${ticketId}#${p.number}`);
    const next = prev?.auto_linked === false ? { ...row, auto_linked: false, auto_reason: null } : row;
    // 中身が変わっていない行は書かない（全PRを渡して呼ばれることがあるため）
    if (prev && prev.state === next.state && prev.title === next.title && prev.url === next.url) continue;
    toUpsert.push(next);
  }
  if (!toUpsert.length) return;
  await sb.from("ticket_github_links").upsert(toUpsert, { onConflict: "project_id,ticket_id,kind,number" });
}

/**
 * ブランチ名／タイトルの WBS からチケットへ自動で紐付ける。
 * 表示のためだけの紐付けで、チケットのステータスには一切触らない
 * （既存のチケット更新経路に手を入れると、順番が入れ替わる等の既知不具合を踏むため）。
 *
 * チケットのステータスは問わない。クローズ済みでもリリース済みでも、
 * WBS が一致すれば紐付ける（履歴として「このチケットのPRはどれか」を残すため）。
 *
 * ただし、同じWBS番号に対して大文字小文字だけが違う綴りが混ざっている場合
 * （SEIBUN/demo-071 と SEIBUN/DEMO-071 の両方にPRがある等）は、どちらが正しいか
 * 機械では決められない。自動では紐付けず、候補として残して人に選ばせる。
 * 同じ綴り同士で複数PRがあるのは正常なので、そちらは今まで通り全件紐付ける。
 *
 * 全PRを渡して呼ばれることがあるので、中身が変わっていない行は書かない。
 * 毎回全件を upsert すると、実質は同じ内容の書き込みが延々と走ることになる。
 */
async function autoLink(sb: SupabaseClient, projectId: string, repo: string, pulls: any[]) {
  // ブランチ経由の紐付けを先に済ませる。WBS が1件も拾えないPR（＝命名を外したブランチ）でも
  // ここまでは必ず通す必要があるため、下の早期 return より前に置く
  await linkByBranch(sb, projectId, repo, pulls).catch(() => {});

  const wbsList = Array.from(new Set(pulls.flatMap(p => p.detectedWbs as string[])));
  if (!wbsList.length) return;

  const { data: sprints } = await sb.from("sprints").select("id").eq("project_id", projectId);
  const sprintIds = (sprints ?? []).map(s => (s as any).id);
  if (!sprintIds.length) return;

  const tickets = await ticketsByWbs(sb, sprintIds, wbsList, "id, wbs");
  if (!tickets.length) return;

  // WBS番号（大文字）ごとに当たったチケットを集める。
  // 接頭辞の大小を途中で変えた等で、同じ番号のチケットが2件当たることもある
  const ticketsByKey = new Map<string, any[]>();
  for (const t of tickets) {
    const k = String(t.wbs).toUpperCase();
    ticketsByKey.set(k, [...(ticketsByKey.get(k) ?? []), t]);
  }

  const pullsByKey = new Map<string, any[]>();
  for (const p of pulls) {
    for (const w of p.detectedWbs as string[]) {
      if (ticketsByKey.has(w)) pullsByKey.set(w, [...(pullsByKey.get(w) ?? []), p]);
    }
  }
  if (!pullsByKey.size) return;

  const existing = await allPullLinks(sb, projectId);
  const before = new Map(existing.map(e => [`${e.ticket_id}#${e.number}`, e]));

  // WBS番号ごとに、綴りが何通りあるかを数える。
  // 既に紐付いている行の綴りも見る。前回のWebhookで入った demo-071 と、
  // 今回来た DEMO-071 の食い違いは、今回のPRだけを見ていても分からないため。
  // 同じPR番号の行は今回のデータのほうが新しいので数えない（ブランチ名の改名を誤検出しないため）
  const spellingsByKey = new Map<string, Set<string>>();
  const add = (k: string, s: string | null | undefined) => {
    if (!s) return;
    if (!spellingsByKey.has(k)) spellingsByKey.set(k, new Set());
    spellingsByKey.get(k)!.add(s);
  };
  for (const [k, ps] of pullsByKey) {
    const incoming = new Set(ps.map(p => p.number));
    for (const p of ps) add(k, (p.detectedSpellings ?? {})[k]);
    const ticketIds = new Set((ticketsByKey.get(k) ?? []).map(t => t.id));
    for (const e of existing) {
      if (ticketIds.has(e.ticket_id) && !incoming.has(e.number)) add(k, e.wbs_spelling);
    }
  }

  const rows: Record<string, unknown>[] = [];
  const candidates: Record<string, unknown>[] = [];
  const withdrawIds: number[] = [];

  for (const [k, ps] of pullsByKey) {
    const ts = ticketsByKey.get(k) ?? [];
    const ambiguous = (spellingsByKey.get(k)?.size ?? 0) > 1 || ts.length > 1;

    for (const t of ts) {
      for (const p of ps) {
        const row = {
          project_id: projectId,
          ticket_id: t.id,
          kind: "pull",
          number: p.number,
          title: p.title,
          state: p.merged ? "merged" : p.state,
          url: p.url,
        };
        if (!ambiguous) {
          rows.push({ ...row, auto_linked: true, auto_reason: p.autoReason ?? null, wbs_spelling: (p.detectedSpellings ?? {})[k] ?? null });
          continue;
        }
        candidates.push({ ...row, wbs_key: k, spelling: (p.detectedSpellings ?? {})[k] ?? null, auto_reason: p.autoReason ?? null });
        // 綴りが割れる前に自動で付けてしまった紐付けは引っ込める。
        // 人が選んだもの・手で付けたもの（auto_linked=false）はそのまま残す
        const prev = before.get(`${t.id}#${p.number}`);
        if (prev?.auto_linked === true) withdrawIds.push(prev.id);
      }
    }
  }

  if (candidates.length) {
    // 既にある候補は上書きしない。人が選び終えた印（resolved_at）を消さないため
    await sb.from("ticket_github_link_candidates")
      .upsert(candidates, { onConflict: "project_id,ticket_id,kind,number", ignoreDuplicates: true });
  }
  if (withdrawIds.length) {
    await sb.from("ticket_github_links").delete().in("id", withdrawIds);
  }

  const toUpsert: Record<string, unknown>[] = [];
  for (const r of rows) {
    const prev = before.get(`${r.ticket_id}#${r.number}`);
    // 手動で付けた紐付け（auto_linked=false）を自動で上書きしない
    const row = prev?.auto_linked === false ? { ...r, auto_linked: false, auto_reason: null } : r;
    if (prev && prev.state === row.state && prev.title === row.title && prev.url === row.url
      && prev.wbs_spelling === row.wbs_spelling) continue;
    toUpsert.push(row);
  }
  if (!toUpsert.length) return;

  await sb.from("ticket_github_links").upsert(toUpsert, { onConflict: "project_id,ticket_id,kind,number" });
}

/**
 * 過去PRの穴埋め。全PRを遡ってWBS番号で紐付け直す。
 *
 * PR一覧（openのみ）と Webhook だけでは、リポジトリを紐付ける前にマージ・クローズ
 * されたPRが永久に紐付かない。リポジトリを紐付けた直後に1回だけ走らせて過去分を埋める。
 * 全PRの走査を伴うので、定期実行では行わない。
 */
async function backfillProjectLinks(sb: SupabaseClient, project: any): Promise<number> {
  const installationId = await getInstallationId(sb, (project.organization_id as string | null) ?? null);
  const token = await installationToken(installationId);
  const repo = String(project.github_repo_full_name ?? "");

  const scanned: any[] = [];
  for (let page = 1; page <= LINK_BACKFILL_PAGES; page++) {
    const chunk = await gh(
      token, `/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=100&page=${page}`,
    ).catch(() => []);
    const list: any[] = Array.isArray(chunk) ? chunk : [];
    for (const p of list) scanned.push(mapPull(p));
    if (list.length < 100) break;
  }
  // WBS番号を条件に並べて引くので、URLが長くなりすぎないよう小分けにする
  for (let i = 0; i < scanned.length; i += LINK_BACKFILL_CHUNK) {
    await autoLink(sb, project.id, repo, scanned.slice(i, i + LINK_BACKFILL_CHUNK));
  }
  return scanned.length;
}

/**
 * リポジトリを紐付けた直後の穴埋め。画面から保存のたびに呼ばれるので、
 * 同じリポジトリでは1回しか走らせない。別のリポジトリへ付け替えたときは
 * 対象のPRが変わるので、もう一度だけ走らせる。
 */
async function handleBackfillLinks(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");

  const { data: project } = await sb.from("projects")
    .select("id, organization_id, github_repo_full_name, github_links_backfilled_repo")
    .eq("id", ctx.id).maybeSingle();
  if (!project) throw new HttpError(404, "プロジェクトが見つかりません。");

  const repo = String((project as any).github_repo_full_name ?? "");
  if (String((project as any).github_links_backfilled_repo ?? "") === repo) {
    return res.status(200).json({ ok: true, skipped: true, scanned: 0 });
  }

  const scanned = await backfillProjectLinks(sb, project);
  await sb.from("projects").update({
    github_links_backfilled_repo: repo,
    github_links_backfilled_at: new Date().toISOString(),
  }).eq("id", ctx.id);

  return res.status(200).json({ ok: true, skipped: false, scanned });
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

/**
 * チケット詳細の「関連PR」が開くたびに叩く。GitHub API は一切使わず、DBだけで返る。
 *
 * チケットを開く速度に直結するので、Supabaseへの往復を最小限にしてある（BRU13-023）:
 *  ・インストールIDは使わないので引かない
 *  ・ticketId 指定のときは withWbs を飛ばす。「どのチケットのPRか」は
 *    呼び出し側が最初から知っているうえ、チケット詳細では使っていない
 *    （使うのは GitHub画面のPR一覧＝ticketId 指定なしの呼び出しだけ）
 */
async function handleLinks(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view", { installation: false });
  const ticketId = String(req.query?.ticketId ?? "");

  let q = sb.from("ticket_github_links").select("*").eq("project_id", ctx.id);
  if (ticketId) q = q.eq("ticket_id", ticketId);
  let cq = sb.from("ticket_github_link_candidates").select("*")
    .eq("project_id", ctx.id).is("resolved_at", null);
  if (ticketId) cq = cq.eq("ticket_id", ticketId);

  const [{ data }, { data: cand }] = await Promise.all([q, cq]);
  return res.status(200).json({
    links: ticketId ? (data ?? []).map(mapLink) : await withWbs(sb, data ?? []),
    candidates: (cand ?? []).map(mapCandidate),
    level: ctx.level,
    perms: ctx.perms,
    repo: ctx.repo,
  });
}

/**
 * Dev Ticket から作ったブランチの一覧（BRU13-054）。
 *
 * ticketId を渡すとそのチケットのぶんだけ。渡さなければプロジェクト全体。
 * GitHub API は叩かない（DBに残した紐付けを読むだけ）ので、
 * チケット詳細を開くたびに走っても handleLinks と同じくらい軽い。
 */
async function handleTicketBranches(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  const ctx = await projectContext(sb, caller, String(req.query?.projectId ?? ""), "view", { installation: false });
  const ticketId = String(req.query?.ticketId ?? "");

  let q = sb.from("ticket_github_branches").select("*")
    .eq("project_id", ctx.id).eq("repo", ctx.repo)
    .order("created_at", { ascending: false });
  if (ticketId) q = q.eq("ticket_id", ticketId);
  const { data } = await q;
  const rows = (data ?? []) as any[];

  // 一覧に「どのチケットのブランチか」を出せるよう、WBS番号とタイトルを添える。
  // ticketId 指定のとき（チケット詳細）は呼び出し側が最初から知っているので引かない
  const titles = new Map<string, { wbs: string | null; title: string | null }>();
  if (!ticketId && rows.length) {
    const { data: tickets } = await sb.from("sprint_tickets")
      .select("id, wbs, title").in("id", Array.from(new Set(rows.map(r => String(r.ticket_id)))));
    for (const t of (tickets ?? []) as any[]) {
      titles.set(String(t.id), { wbs: t.wbs ?? null, title: t.title ?? null });
    }
  }

  return res.status(200).json({
    branches: rows.map(r => {
      const t = titles.get(String(r.ticket_id));
      return { ...mapTicketBranch(r), ticketWbs: t?.wbs ?? null, ticketTitle: t?.title ?? null };
    }),
    level: ctx.level,
    perms: ctx.perms,
    repo: ctx.repo,
    defaultBranch: ctx.defaultBranch,
  });
}

function mapTicketBranch(r: any) {
  return {
    id: r.id,
    projectId: r.project_id,
    ticketId: r.ticket_id,
    repo: r.repo,
    branchName: r.branch_name,
    baseBranch: r.base_branch ?? "",
    createdBy: r.created_by ?? null,
    createdByName: r.created_by_name ?? null,
    createdAt: r.created_at,
  };
}

function mapCandidate(r: any) {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    wbsKey: r.wbs_key,
    kind: r.kind,
    number: r.number,
    spelling: r.spelling ?? null,
    title: r.title ?? null,
    state: r.state ?? null,
    url: r.url ?? null,
    autoReason: r.auto_reason ?? null,
  };
}

/**
 * 大文字小文字違いで割れていた候補から、人が1件を選んで確定する。
 *
 * 選ばれた1件だけを紐付け、同じWBS番号で自動的に付いていた他の紐付けは外す。
 * 選ばれなかった候補も含めて resolved_at を入れ、次の走査で再び出てこないようにする
 * （GitHub 側のブランチは残ったままなので、印を残さないと毎回また候補になる）。
 */
async function handleResolveCandidate(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const ticketId = String(body.ticketId ?? "");
  const number = Number(body.number ?? 0);
  if (!ticketId || !number) throw new HttpError(400, "選択された候補が不正です。");

  const { data: group } = await sb.from("ticket_github_link_candidates").select("*")
    .eq("project_id", ctx.id).eq("ticket_id", ticketId).is("resolved_at", null);
  const chosen = (group ?? []).find(c => Number((c as any).number) === number);
  if (!chosen) throw new HttpError(404, "候補が見つかりません。すでに解決済みの可能性があります。");

  const wbsKey = String((chosen as any).wbs_key ?? "");
  const siblings = (group ?? []).filter(c => String((c as any).wbs_key ?? "") === wbsKey);

  // 選ばれなかったPRの自動紐付けを外す。人が付けたもの（auto_linked=false）は触らない
  const drop = siblings.filter(c => Number((c as any).number) !== number).map(c => Number((c as any).number));
  if (drop.length) {
    await sb.from("ticket_github_links").delete()
      .eq("project_id", ctx.id).eq("ticket_id", ticketId).eq("kind", "pull")
      .eq("auto_linked", true).in("number", drop);
  }

  // 人が選んだ紐付けは auto_linked=false で残す。以後の自動処理で書き換えられない
  await sb.from("ticket_github_links").upsert({
    project_id: ctx.id,
    ticket_id: ticketId,
    kind: (chosen as any).kind ?? "pull",
    number,
    title: (chosen as any).title ?? "",
    state: (chosen as any).state ?? "",
    url: (chosen as any).url ?? "",
    linked_by: caller.id,
    auto_linked: false,
    auto_reason: null,
    wbs_spelling: (chosen as any).spelling ?? null,
  }, { onConflict: "project_id,ticket_id,kind,number" });

  const now = new Date().toISOString();
  await sb.from("ticket_github_link_candidates")
    .update({ resolved_at: now, resolved_by: caller.id, chosen: false })
    .in("id", siblings.map(c => (c as any).id));
  await sb.from("ticket_github_link_candidates")
    .update({ chosen: true }).eq("id", (chosen as any).id);

  return res.status(200).json({ ok: true, number });
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

// ── 実行中の記録（supabase/add_github_action_runs.sql） ───────
//
// マージもPR作成も、GitHubの呼び出しからリリース反映まで全部この関数の中で終わる。
// クライアントが切断されても実行は止まらないので、タブやブラウザを閉じても
// 処理そのものは最後まで走り切る。止まるのは「画面の取り直し」だけ。
//
// ただし github_action_logs は終わったことしか書かないため、開き直した画面からは
// 「まだ実行中」と「もう終わった」を見分けられなかった。
// そこで開始時に running を1行置き、終わったら結果ごと書き換える。
// 画面はログイン直後にこの行を見て、実行中なら進捗モーダルを出し直す。

/** 記録に使う実行ID。画面が作った UUID をそのまま主キーにする */
const RUN_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 記録を残す日数を超えた行は消す。復帰にしか使わないので溜め込まない */
const RUN_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * 実行の途中経過（supabase/add_github_action_run_progress.sql）。
 *
 * まとめてマージは押してから終わるまで数十秒かかることがあり、その間クライアントには
 * 何も返らない。「今どこを走っているか」を画面から読めるように、段ごとにここへ書く。
 */
interface RunProgress {
  step: "precheck" | "trial" | "merge";
  /** step の中で終わった件数 */
  done: number;
  total: number;
  /** いま扱っているPR番号 */
  current?: number;
  /** 試しマージが不要だったので省いた（変更ファイルが重ならない等） */
  trialSkipped?: boolean;
}

/**
 * 途中経過を記録へ書く。
 *
 * 記録は補助なので、書けなくても実行は止めない（列が未適用の環境では毎回失敗するが、
 * 画面がこれまでどおりの大まかな表示に落ちるだけで、マージ自体は従来どおり動く）。
 */
async function reportProgress(sb: SupabaseClient, runId: string, progress: RunProgress) {
  if (!runId) return;
  try {
    await sb.from("github_action_runs").update({ progress }).eq("id", runId);
  } catch { /* 記録は補助。落ちても実行結果には影響させない */ }
}

async function finishActionRun(
  sb: SupabaseClient, runId: string, actorId: string,
  state: "done" | "error", message: string, result: unknown,
) {
  // 記録の書き込みで実行そのものを失敗させない。ここが落ちても
  // GitHub 側の処理は終わっているので、応答は必ず返す
  try {
    await sb.from("github_action_runs").update({
      state,
      message: message ? message.slice(0, 500) : null,
      result: result ?? null,
      finished_at: new Date().toISOString(),
    }).eq("id", runId);
    // 復帰にしか使わない記録なので溜め込まない。
    // 実行した本人の古い行だけを消す（そのぶん索引がそのまま効く）
    await sb.from("github_action_runs").delete()
      .eq("actor_id", actorId)
      .lt("started_at", new Date(Date.now() - RUN_KEEP_MS).toISOString());
  } catch { /* 記録は補助。落ちても実行結果には影響させない */ }
}

/**
 * 実行を running で記録してから中身を走らせ、終わったら結果を書き戻す。
 *
 * 画面が runId を付けてこなかった場合（古い版・記録用の表が未適用）は、
 * 何も記録せずそのまま実行する。記録の有無で実行の可否を変えない。
 */
async function withActionRun(
  sb: SupabaseClient, caller: Caller, kind: string, req: any, res: any,
  run: (res: any) => Promise<any>,
): Promise<any> {
  const body = parseBody(req);
  const runId = String(body.runId ?? "");
  if (!RUN_ID_RE.test(runId)) return await run(res);

  const tracked = await sb.from("github_action_runs").insert({
    id: runId,
    project_id: String(body.projectId ?? ""),
    project_slug: String(body.runSlug ?? "") || null,
    actor_id: caller.id,
    kind,
    label: String(body.runLabel ?? "").slice(0, 200) || null,
  }).then(r => !r.error, () => false);
  if (!tracked) return await run(res);

  // 応答をそのまま記録へ写すために、書き出しを一度こちらで受ける。
  // 3つのハンドラはどれも res.status(...).json(...) しか使わない
  const sent = { status: 200, body: null as any };
  const recorder = {
    status(code: number) { sent.status = code; return this; },
    json(payload: any) { sent.body = payload; return res.status(sent.status).json(payload); },
    setHeader: (k: string, v: string) => res.setHeader(k, v),
  };

  try {
    const out = await run(recorder);
    // ハンドラが自分でエラー応答を返すことがある（権限・GitHub側の失敗）。
    // 投げられたかどうかではなく、返したステータスで成否を決める
    const failed = sent.status >= 400;
    await finishActionRun(sb, runId, caller.id, failed ? "error" : "done",
      failed ? String(sent.body?.error ?? "") : "", sent.body);
    return out;
  } catch (e) {
    const m = e instanceof HttpError ? { message: e.message } : jaMessage(e);
    await finishActionRun(sb, runId, caller.id, "error", m.message, null);
    throw e;
  }
}

/**
 * ブランチ名として使えるかを Git の規則で判定する（git check-ref-format 相当）。
 *
 * GitHub に投げれば 422 は返るが、理由が英語1行で「どこが悪いのか」が分からない。
 * 名前を自由に決められるようにする以上、ここで日本語の理由まで出す。
 * 返り値が null なら使える。
 */
function branchNameError(name: string): string | null {
  if (!name) return "ブランチ名を入力してください。";
  if (name.length > 244) return "ブランチ名が長すぎます。";
  if (/\s/.test(name)) return "ブランチ名に空白は使えません。";
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return "ブランチ名に ~ ^ : ? * [ \\ と制御文字は使えません。";
  if (name.startsWith("/") || name.endsWith("/")) return "ブランチ名の先頭と末尾に / は使えません。";
  if (name.includes("//")) return "ブランチ名に / を続けて書くことはできません。";
  if (name.includes("..")) return "ブランチ名に .. は使えません。";
  if (name.includes("@{")) return "ブランチ名に @{ は使えません。";
  if (name === "@") return "ブランチ名を @ だけにすることはできません。";
  if (name.endsWith(".") || name.endsWith(".lock")) return "ブランチ名の末尾に . や .lock は使えません。";
  if (name.split("/").some(seg => seg.startsWith(".") || seg.endsWith(".lock"))) {
    return "ブランチ名の各区切りを . で始めたり .lock で終えたりはできません。";
  }
  return null;
}

/**
 * ブランチの作成（BRU13-054）。
 *
 * ブランチ名は完全に自由。チケットとの紐付けは名前ではなく
 * ticket_github_branches に残した記録で行うので、命名規則に縛る必要がない。
 * この記録があるおかげで、そのブランチから出たPRは名前が何であれチケットへ辿れる
 * （linkByBranch）。
 *
 * 要求する権限は githubBranchPermission = write。マージと分けてあるのは、
 * ブランチは消せば済むのに対し main へのマージは戻せないため。
 */
async function handleCreateBranch(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "branch");

  // refs/heads/ を付けて書く人がいるので、受け取り側で剥がす（弾くほどのことではない）
  const name = String(body.name ?? "").trim().replace(/^refs\/heads\//, "");
  const ticketId = String(body.ticketId ?? "").trim();

  const nameError = branchNameError(name);
  if (nameError) throw new HttpError(400, nameError);

  await assertPermitted(ctx.installationId, "create-branch");
  const token = await installationToken(ctx.installationId);

  // 分岐元。指定が無ければ既定ブランチ。プロジェクト設定より GitHub 側の現在値を優先する
  const repoInfo = await gh(token, `/repos/${ctx.repo}`).catch(() => null);
  const base = String(body.base ?? "").trim()
    || (repoInfo?.default_branch as string | undefined)
    || ctx.defaultBranch || "main";
  if (name === base) throw new HttpError(400, "分岐元と同じ名前のブランチは作成できません。");

  // 分岐元の先端。ここで 404 なら分岐元の指定が間違っている
  const baseRef = await gh(token, `/repos/${ctx.repo}/git/ref/heads/${encodeURIComponent(base)}`)
    .catch(() => null);
  const sha = baseRef?.object?.sha as string | undefined;
  if (!sha) throw new HttpError(400, `分岐元のブランチ「${base}」が見つかりません。`);

  try {
    await gh(token, `/repos/${ctx.repo}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${name}`, sha },
    });
  } catch (e) {
    let { status, message } = jaMessage(e);
    const raw = String((e as Error)?.message ?? "").toLowerCase();
    if (e instanceof GithubError && e.status === 422) {
      status = 409;
      message = raw.includes("already exists")
        ? `ブランチ「${name}」はすでに存在します。別の名前を入力してください。`
        : `ブランチ「${name}」を作成できませんでした。名前をご確認ください。`;
    }
    const block = await explainForbidden(ctx.installationId, "create-branch", e);
    console.error("[github create-branch]", (e as Error)?.message);
    await writeLog(sb, ctx, caller, "create_branch", 0, "error", (e as Error)?.message ?? "");
    if (block) return res.status(403).json({ error: block.message, permission: block });
    return res.status(status).json({ error: message });
  }

  await writeLog(sb, ctx, caller, "create_branch", 0, "ok", `${base} → ${name}`);

  // チケットとの紐付け。ここが「名前を自由にしても紐付きが切れない」ことの本体。
  // 記録に失敗してもブランチ自体は出来ているので、作成そのものは成功として返す
  let linked = false;
  if (ticketId) {
    const { error } = await sb.from("ticket_github_branches").upsert({
      project_id: ctx.id,
      ticket_id: ticketId,
      repo: ctx.repo,
      branch_name: name,
      base_branch: base,
      created_by: caller.id,
      created_by_name: caller.name,
    }, { onConflict: "project_id,repo,branch_name" });
    linked = !error;
    if (error) console.error("[github create-branch link]", error.message);
  }

  return res.status(200).json({
    ok: true,
    name,
    base,
    linked,
    url: `https://github.com/${ctx.repo}/tree/${name.split("/").map(encodeURIComponent).join("/")}`,
  });
}

/**
 * プルリクエストの作成。GitHub の画面へ行かずに Dev Ticket 側で完結させるためのもの。
 * 要求する権限は githubPullPermission = write（BRU13-054 でマージ権限から分離）。
 */
async function handleCreatePull(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "create-pull");

  const head = String(body.head ?? "").trim();
  const base = String(body.base ?? "").trim() || ctx.defaultBranch || "main";
  const title = String(body.title ?? "").trim();
  const draft = body.draft === true;

  if (!head) throw new HttpError(400, "比較するブランチを選択してください。");
  if (!title) throw new HttpError(400, "タイトルを入力してください。");
  if (head === base) throw new HttpError(400, "比較するブランチとマージ先が同じです。");

  await assertPermitted(ctx.installationId, "create-pull");

  const token = await installationToken(ctx.installationId);
  const text = String(body.body ?? "").trim();

  try {
    const pr = await gh(token, `/repos/${ctx.repo}/pulls`, {
      method: "POST",
      body: {
        title,
        head,
        base,
        draft,
        // 誰が Dev Ticket から作ったのかを本文に残す（GitHub上は App 名義になるため）
        body: `${text}${text ? "\n\n" : ""}---\n_Dev Ticket の ${caller.name} が作成_`,
      },
    });
    await writeLog(sb, ctx, caller, "create_pull", pr?.number ?? 0, "ok", `${head} → ${base} / ${title}`);
    // 作成した時点で紐付けておく。PR一覧を開かないまま GitHub 側でマージされると、
    // 紐付けが残らずリリース反映の判定材料が無くなるため
    if (pr?.number) await autoLink(sb, ctx.id, ctx.repo, [mapPull(pr)]).catch(() => {});
    return res.status(200).json({
      ok: true,
      number: pr?.number ?? null,
      url: pr?.html_url ?? null,
      title: pr?.title ?? title,
    });
  } catch (e) {
    // 作成時の 422 は「差分が無い」「既にPRがある」が大半で、
    // マージ時の 422（ブランチ保護）とは意味が違うので専用に訳す
    const raw = String((e as Error)?.message ?? "").toLowerCase();
    let message = jaMessage(e).message;
    let status = jaMessage(e).status;
    if (e instanceof GithubError && e.status === 422) {
      status = 409;
      if (raw.includes("no commits between")) {
        message = `「${head}」には「${base}」との差分がありません。コミットを push してから作成してください。`;
      } else if (raw.includes("already exists")) {
        message = `「${head}」のプルリクエストはすでに作成されています。`;
      } else if (raw.includes("field head") || raw.includes("invalid")) {
        message = `ブランチ「${head}」が見つかりません。一覧を更新して選び直してください。`;
      } else {
        message = "プルリクエストを作成できませんでした。ブランチとマージ先をご確認ください。";
      }
    }
    console.error("[github create-pull]", (e as Error)?.message);
    await writeLog(sb, ctx, caller, "create_pull", 0, "error", (e as Error)?.message ?? "");
    return res.status(status).json({ error: message });
  }
}

/**
 * マージできない理由。null ならマージできる。
 * 判定は src/app/lib/github.ts の mergeBlockReason と揃えてある（画面と結論が食い違わないように）。
 *
 * conflict を分けて持つのは、まとめてマージを止めた理由が「コンフリクト」なのか
 * 「CI・レビュー待ち」なのかで、人がやることが変わるため。
 */
function mergeBlockReasonOf(p: any): { conflict: boolean; pending: boolean; message: string } | null {
  const at = (conflict: boolean, message: string) => ({ conflict, pending: false, message });
  if (!p) return at(false, "プルリクエストを取得できませんでした。");
  if (p.merged_at || p.merged) return at(false, "すでにマージされています。");
  if (p.state && p.state !== "open") return at(false, "クローズ済みのためマージできません。");
  if (p.draft) return at(false, "Draft のためマージできません。");
  if (p.mergeable === false || p.mergeable_state === "dirty") {
    return at(true, "コンフリクトがあります。GitHub上で解消してください。");
  }
  switch (p.mergeable_state) {
    case "blocked": return at(false, "必須チェックまたはレビュー承認が不足しています。");
    case "behind": return at(false, "ベースブランチより古いため更新が必要です。");
    case "draft": return at(false, "Draft のためマージできません。");
    // 「まだ計算が終わっていない」だけで、マージできないと決まったわけではない。
    // 呼ぶ側が pending を見て、待つのか先へ進むのかを決める（BRU13-042）
    case "unknown":
      return { conflict: false, pending: true, message: "GitHub側でマージ可否を判定中です。少し待ってから再度お試しください。" };
    default: return null;
  }
}

/** マージ前チェックの1件分の結果 */
interface PrecheckRow {
  number: number;
  title: string;
  ok: boolean;
  /** コンフリクトが理由かどうか */
  conflict: boolean;
  reason?: string;
  /**
   * 失敗しているチェックがある場合（層A）。
   *
   * ok とは別に持つ。ブランチ保護が無いリポジトリでは GitHub が clean を返すので
   * ok は true のままだが、そのままマージすると本番に届かない。
   * level が "block" のときだけ ok も false にする。
   */
  checkGate?: CheckGate;
  /** 権限不足などでチェックを確認できなかった情報源。空でなければ「問題なし」と言い切らない */
  checkUnavailable?: string[];
  /**
   * 試しマージで分かった「このPRより先に積んだPR」（BRU13-042）。
   * 単体では通るのに、この順番だと通らない、を画面で言い分けるために持つ。
   */
  conflictAfter?: number[];
  /** 試しマージに使う。画面では使わないがサーバー内で持ち回る */
  headSha?: string;
  /** マージ先ブランチ。マージ先ごとに試しマージを分けるために持つ */
  base?: string;
}

/**
 * マージ前の状態チェック（1件）。
 *
 * GitHub のマージ可否は「聞かれてから」計算されるため、判定中（unknown）なら引き直す。
 * それでも決まらないものは「判定中」として止める。分からないまま実行すると、
 * まとめてマージの途中でコンフリクトに当たり、一部だけ入った状態になる（BRU13-038）。
 *
 * poll=false は「決まっていなくても待たない」。まとめてマージの実行ループで使う。
 * 1件マージするたびにマージ先が動き、残り全部の計算がやり直しになるため、
 * ここで毎回待つと件数ぶんの待ち時間が積み上がる。ループ側は捨てブランチでの
 * 試しマージを通してあるので、判定中でもそのまま実行してよい（BRU13-042）。
 */
async function fetchPullForMerge(token: string, repo: string, number: number, poll = true) {
  let last = await gh(token, `/repos/${repo}/pulls/${number}`);
  if (!poll) return last;
  for (const wait of MERGEABLE_POLL_MS) {
    if (!needsMergeableRetry(last)) return last;
    await sleep(wait);
    last = await gh(token, `/repos/${repo}/pulls/${number}`).catch(() => last);
  }
  return last;
}

async function precheckPull(
  token: string, repo: string, number: number, mode: RequireChecksMode = "off",
): Promise<PrecheckRow> {
  try {
    const p = await fetchPullForMerge(token, repo, number);
    const blocked = mergeBlockReasonOf(p);

    // 失敗チェックの判定（層A）。コンフリクト等で既に止まっているなら見に行かない
    // （余計なリクエストを増やさない。止める理由はもう決まっている）。
    // Deployments までは見ない。まとめてマージでPR件数ぶん走るので、
    // 1件あたりのリクエストを増やさない（blocked は commit status 側に出る）
    let gate: CheckGate | null = null;
    let unavailable: string[] = [];
    if (!blocked && mode !== "off") {
      const sum = await summarizeSha(token, repo, String(p?.head?.sha ?? ""));
      gate = checkGateOf(mode, sum);
      unavailable = sum.unavailable;
    }

    return {
      number,
      title: p?.title ?? `#${number}`,
      // "block" のときだけマージ自体を止める。warn / reason は画面で判断させる
      ok: !blocked && gate?.level !== "block",
      conflict: !!blocked?.conflict,
      headSha: String(p?.head?.sha ?? ""),
      base: String(p?.base?.ref ?? ""),
      ...(blocked ? { reason: blocked.message } : {}),
      ...(gate ? { checkGate: gate, ...(gate.level === "block" ? { reason: checkGateMessage(gate, number) } : {}) } : {}),
      ...(unavailable.length ? { checkUnavailable: unavailable } : {}),
    };
  } catch (e) {
    // 取得そのものに失敗したものも「確認できていない」ので通さない
    return { number, title: `#${number}`, ok: false, conflict: false, reason: jaMessage(e).message };
  }
}

/** リクエストで渡されたPR番号の配列を検証して重複を潰す */
function parseMergeNumbers(raw: unknown): number[] {
  const numbers = Array.from(new Set((Array.isArray(raw) ? raw : [])
    .map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0)));
  if (!numbers.length) throw new HttpError(400, "マージする対象が選択されていません。");
  if (numbers.length > MAX_BULK_MERGE) {
    throw new HttpError(400, `一度にマージできるのは${MAX_BULK_MERGE}件までです。`);
  }
  return numbers;
}

/**
 * マージ前のコンフリクトチェックだけを行う（実行はしない）。
 *
 * 1件でもコンフリクトしていたら1件もマージしない、を画面側から確かめるための入口。
 * マージ本体（merge / merge-bulk）も同じチェックを実行直前に必ずやり直す。
 */
async function handleMergePrecheck(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const numbers = parseMergeNumbers(body.numbers);

  const token = await installationToken(ctx.installationId);
  const results = await Promise.all(numbers.map(n => precheckPull(token, ctx.repo, n, ctx.requireChecksMode)));

  return res.status(200).json({
    ok: results.every(r => r.ok),
    conflicts: results.filter(r => r.conflict).length,
    blocked: results.filter(r => !r.ok && !r.conflict).length,
    // 失敗チェックがあり、理由を書けば通せる状態（層A）。画面はここを見て入力欄を出す
    needsReason: results.some(r => r.checkGate?.level === "reason"),
    checkWarnings: results.filter(r => r.checkGate).length,
    requireChecksMode: ctx.requireChecksMode,
    results,
  });
}

/**
 * 層A: 失敗しているチェックのままマージしようとしていないかを、実行直前にもう一度見る。
 *
 * ブランチ保護（Required status checks）が未設定のリポジトリでは、チェックが真っ赤でも
 * GitHub は mergeable_state=clean を返す。つまり GitHub 側には関門が無く、
 * ここが唯一の関門になる。実際に、失敗が積み上がったまま11件がマージされて
 * 本番へ何も届かない状態が11日間続いた。
 *
 * 止める場合は HttpError を投げる。理由を書いて押し切った場合は監査ログに必ず残す
 *（残さないと「毎回みんな押し切っている」ことに誰も気付けない）。
 */
async function enforceCheckGate(
  sb: SupabaseClient, ctx: ProjectCtx, caller: Caller,
  token: string, pull: any, number: number, reason: string,
): Promise<CheckGate | null> {
  if (ctx.requireChecksMode === "off") return null;

  const sum = await summarizeSha(token, ctx.repo, String(pull?.head?.sha ?? ""));
  const gate = checkGateOf(ctx.requireChecksMode, sum);
  if (!gate) return null;

  const row: PrecheckRow = {
    number,
    title: pull?.title ?? `#${number}`,
    ok: gate.level !== "block",
    conflict: false,
    reason: checkGateMessage(gate, number),
    checkGate: gate,
    checkUnavailable: sum.unavailable,
  };
  // 形は merge-precheck と揃える。画面側が同じ表示を使い回せるように
  const payload = (needsReason: boolean) => ({
    precheck: {
      ok: false, conflicts: 0, blocked: 1,
      needsReason, checkWarnings: 1, requireChecksMode: ctx.requireChecksMode,
      results: [row],
    },
  });

  if (gate.level === "block") {
    await writeLog(sb, ctx, caller, "merge", number, "blocked", `checks / ${gate.failed.join(" / ")}`);
    throw new HttpError(409, checkGateMessage(gate, number), payload(false));
  }
  if (gate.level === "reason" && !reason) {
    throw new HttpError(409, checkGateMessage(gate, number), payload(true));
  }

  await writeLog(sb, ctx, caller, "merge", number, "override",
    `checks / ${gate.failed.slice(0, 3).join(" / ")}${reason ? ` / 理由: ${reason}` : ""}`);
  return gate;
}

/** 押し切るときの理由。長すぎるものは監査ログの都合で切る */
function overrideReason(body: Record<string, any>): string {
  return String(body?.reason ?? "").trim().slice(0, 300);
}

async function handleMerge(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const number = Number(body.number ?? 0);
  const method = ["merge", "squash", "rebase"].includes(body.method) ? body.method : "squash";
  if (!number) throw new HttpError(400, "PR番号が不正です。");

  // GitHub を叩く前に権限で止める。実行して初めて分かる状態にしない。
  // 止めた事実もログに残す。残さないと「誰も直さないまま何度も起きている」ことに気付けない
  const pre = await permissionBlock(ctx.installationId, "merge");
  if (pre) {
    await writeLog(sb, ctx, caller, "merge", number, "blocked", `permission:${pre.scope} / ${pre.missing.map(m => m.key).join(",")}`);
    throw new HttpError(403, pre.message, { permission: pre });
  }

  const token = await installationToken(ctx.installationId);
  // 判定中のまま実行しない。1件のマージでも、実行してから初めてコンフリクトに気付く状態は作らない
  const p = await fetchPullForMerge(token, ctx.repo, number);

  const preBlock = mergeBlockReasonOf(p);
  if (preBlock) {
    await writeLog(sb, ctx, caller, "merge", number, "blocked", `precheck / ${preBlock.message}`);
    // 形は merge-precheck と揃える。画面側が同じ表示を使い回せるように
    throw new HttpError(409, preBlock.message, {
      precheck: {
        ok: false,
        conflicts: preBlock.conflict ? 1 : 0,
        blocked: preBlock.conflict ? 0 : 1,
        results: [{ number, title: p?.title ?? `#${number}`, ok: false, conflict: preBlock.conflict, reason: preBlock.message }],
      },
    });
  }

  // 層A。ここを通さないと、失敗したままのPRが黙って本番ブランチへ入る
  await enforceCheckGate(sb, ctx, caller, token, p, number, overrideReason(body));

  const retry = { refreshed: false };
  try {
    const result = await runWithFreshToken(ctx.installationId, retry, t =>
      gh(t, `/repos/${ctx.repo}/pulls/${number}/merge`, {
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
      }));
    await writeLog(sb, ctx, caller, "merge", number, "ok", `${method} / ${result?.sha ?? ""}`);
    // マージした直後に「リリース待ち → リリース済み」を反映する
    await syncReleasesNow(sb, ctx.id);
    return res.status(200).json({ ok: true, sha: result?.sha ?? null });
  } catch (e) {
    const block = await explainForbidden(ctx.installationId, "merge", e);
    const m = jaMessage(e);
    await writeLog(sb, ctx, caller, "merge", number, "error", (e as Error)?.message ?? "");
    return res.status(block ? 403 : m.status).json(
      block ? { error: block.message, permission: block } : { error: m.message },
    );
  }
}

/** 一度に扱えるPRの上限。多すぎると実行時間が読めなくなるため */
const MAX_BULK_MERGE = 20;

// ── 試しマージ（BRU13-042） ──────────────────────────────────────
//
// GitHub の mergeable は「今のマージ先の先端に対して」しか計算されない。
// まとめてマージは1件入れるたびにマージ先が動くので、押した時点で全件 clean でも
// 2件目以降がコンフリクトになることがある。これは何回聞いても分からないので、
// 実際に同じ順番で積んでみるしかない。
//
// 積むのは本番のマージ先ではなく、その場で作って必ず消す捨てブランチ。
// 途中で失敗しても本番側には何も残らないので、戻す作業が発生しない。

/** 捨てブランチの名前の頭。GitHub 上で見かけたときに用途が分かるようにしておく */
const TRIAL_BRANCH_PREFIX = "dev-ticket/merge-trial";

/**
 * 試しマージに使ってよい時間。
 *
 * 関数全体の上限は 60 秒（vercel.json）。使い切ったら「確認しきれなかった」として
 * 1件もマージしない。確認できていないものを通す方向には倒さない。
 */
const TRIAL_BUDGET_MS = 32_000;

/** 変更ファイル一覧を見に行くページ数の上限（100件×3ページ） */
const TRIAL_FILE_PAGES = 3;

/** 試しマージで止まった1件 */
interface TrialFailure {
  number: number;
  /** このPRより先に積み終わっていたPR。「#50〜#52 のあとだと通らない」と言うために持つ */
  after: number[];
  conflict: boolean;
  reason: string;
}

/**
 * PRが変更したファイルの一覧。
 * 取り切れなかったときは null を返す（「重なっていない」と言い切れないため）。
 */
async function changedFiles(token: string, repo: string, number: number): Promise<Set<string> | null> {
  const files = new Set<string>();
  for (let page = 1; page <= TRIAL_FILE_PAGES; page++) {
    const list = await gh(token, `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`) as any[];
    for (const f of list ?? []) {
      if (f?.filename) files.add(String(f.filename));
      // リネームは元の名前でも衝突しうるので両方入れる
      if (f?.previous_filename) files.add(String(f.previous_filename));
    }
    if (!list || list.length < 100) return files;
  }
  return null;
}

/**
 * 試しマージが要るかどうか。
 *
 * 変更ファイルが1つも重ならないPR同士は、順番を入れ替えても結果が変わらない。
 * 後から入れる側が触るファイルを、先に入れた側が動かしていないためで、
 * 「前のマージでマージ先が進んだせいで衝突する」が起こりえない。
 * この場合は捨てブランチを作らずに済ませる（GitHub 側に余計な痕跡を残さない）。
 *
 * 判断がつかないときは true を返す。確認を省く方向には倒さない。
 */
async function needsTrial(token: string, repo: string, numbers: number[]): Promise<boolean> {
  const sets = await Promise.all(numbers.map(n => changedFiles(token, repo, n).catch(() => null)));
  if (sets.some(x => x === null)) return true;
  const seen = new Set<string>();
  for (const set of sets as Set<string>[]) {
    for (const f of set) {
      if (seen.has(f)) return true;
      seen.add(f);
    }
  }
  return false;
}

/**
 * squash / rebase を捨てブランチ上で再現する。
 *
 * どちらも「PRのブランチとのつながりを残さず、中身だけをマージ先に載せる」方式。
 * 試しマージの結果（本物のマージコミット）をそのまま積むと、つながりが残るぶん
 * 後続が実際より通りやすくなる。特に前のブランチの上に積んで作ったPRで差が出る。
 * マージ結果のツリーだけを引き継いだ、親が1つのコミットへ置き換えて先端を進める。
 */
async function flattenTrialTip(
  token: string, repo: string, branch: string, parent: string, merged: any, number: number,
): Promise<string> {
  const tree = String(merged?.commit?.tree?.sha ?? "");
  if (!tree) return String(merged?.sha ?? parent);
  const commit = await gh(token, `/repos/${repo}/git/commits`, {
    method: "POST",
    body: { message: `dev-ticket trial squash #${number}`, tree, parents: [parent] },
  });
  await gh(token, `/repos/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH", body: { sha: commit.sha, force: true },
  });
  return String(commit.sha);
}

/**
 * 選んだPRを、実際に入れる順番どおりに捨てブランチへ積んでみる。
 *
 * failure が null なら全件通った＝本番でも同じ順番で通る。
 * baseSha は試した時点のマージ先の先端。実行に移る直前、ここが動いていないかを見る
 * （動いていたら試した結果はもう当てにならない）。
 */
async function trialMerge(
  token: string, repo: string, base: string,
  rows: { number: number; headSha: string }[],
  method: string, deadline: number,
  /** 1件積むごとに呼ぶ。画面の進捗に出すためだけのもので、失敗させない */
  onStacked?: (number: number) => Promise<void>,
): Promise<{ baseSha: string; failure: TrialFailure | null }> {
  const ref = await gh(token, `/repos/${repo}/git/ref/heads/${encodeURI(base)}`);
  const baseSha = String(ref?.object?.sha ?? "");
  if (!baseSha) throw new HttpError(502, `マージ先ブランチ「${base}」を取得できませんでした。`);

  const branch = `${TRIAL_BRANCH_PREFIX}/${crypto.randomBytes(6).toString("hex")}`;
  await gh(token, `/repos/${repo}/git/refs`, {
    method: "POST", body: { ref: `refs/heads/${branch}`, sha: baseSha },
  });

  let tip = baseSha;
  const done: number[] = [];
  try {
    for (const r of rows) {
      if (Date.now() > deadline) {
        return {
          baseSha,
          failure: {
            number: r.number, after: [...done], conflict: false,
            reason: "確認に時間がかかりすぎたため中断しました。件数を減らしてお試しください。",
          },
        };
      }
      let merged: any;
      try {
        merged = await gh(token, `/repos/${repo}/merges`, {
          method: "POST",
          body: { base: branch, head: r.headSha, commit_message: `dev-ticket trial merge #${r.number}` },
        });
      } catch (e) {
        // 409 = コンフリクト。それ以外（404 など）は確認そのものができなかった側
        const conflict = e instanceof GithubError && (e.status === 409 || e.status === 405);
        return {
          baseSha,
          failure: {
            number: r.number, after: [...done], conflict,
            reason: conflict
              ? "この順番で入れるとコンフリクトします。GitHub上で解消してください。"
              : jaMessage(e).message,
          },
        };
      }
      // 204（取り込むものが無い）のときは先端が動かない
      if (merged?.sha) {
        tip = method === "merge"
          ? String(merged.sha)
          : await flattenTrialTip(token, repo, branch, tip, merged, r.number);
      }
      done.push(r.number);
      await onStacked?.(r.number);
    }
    return { baseSha, failure: null };
  } finally {
    // 捨てブランチは必ず消す。消せなくても本処理は止めない（残っても実害は無い）
    await gh(token, `/repos/${repo}/git/refs/heads/${branch}`, { method: "DELETE" }).catch(() => null);
  }
}

/**
 * 複数のPRをまとめてマージする。
 *
 * 手順は3段階。押すのは1回で、途中の確認はすべてこの中で完結する。
 *
 *   1. 全件のマージ可否チェック（BRU13-038）
 *        今のマージ先に対して、1件ずつ単独で見る。1件でも通らなければ1件もマージしない。
 *   2. 捨てブランチでの試しマージ（BRU13-042）
 *        1 で見ているのは「今のマージ先に対して」だけ。1件マージするたびにマージ先が
 *        進むので、2件目以降が通るかどうかは実際に同じ順番で積んでみないと分からない。
 *        本番には触らず捨てブランチの上で積み、1件でも失敗したら1件もマージしない。
 *   3. 本番のマージ
 *        ここまで来て初めてマージ先へ入れる。
 *
 * 3 でもなお失敗した場合（マージ先が第三者に動かされた、CIが走り直して落ちた等）は、
 * そこで打ち切って残りは実行しない。
 */
async function handleMergeBulk(sb: SupabaseClient, caller: Caller, req: any, res: any) {
  if (req.method !== "POST") throw new HttpError(405, "Method Not Allowed");
  // 試しマージに使ってよい時間はここから数える。関数全体の上限（60秒）のうち、
  // 本番のマージに回すぶんを必ず残すため、確認の側に先に締め切りを置く
  const startedAt = Date.now();
  const body = parseBody(req);
  const ctx = await projectContext(sb, caller, String(body.projectId ?? ""), "merge");
  const method = ["merge", "squash", "rebase"].includes(body.method) ? body.method : "squash";

  const numbers = parseMergeNumbers(body.numbers);

  // 1件ずつ同じ理由で全滅するのを防ぐため、1件目を叩く前に権限で止める。
  // ここで 403 を投げると1件もマージされないまま、直し先つきの理由が1つだけ返る
  const pre = await permissionBlock(ctx.installationId, "merge");
  if (pre) {
    await writeLog(sb, ctx, caller, "merge", 0, "blocked", `bulk / permission:${pre.scope} / ${pre.missing.map(m => m.key).join(",")}`);
    throw new HttpError(403, pre.message, { permission: pre });
  }

  const token = await installationToken(ctx.installationId);

  // 押してから終わるまでの間、何をしている最中かを画面へ流す。
  // 記録が無い環境（列が未適用・古い画面）では書かないだけで、実行は変わらない
  const runId = RUN_ID_RE.test(String(body.runId ?? "")) ? String(body.runId) : "";
  const total = numbers.length;
  await reportProgress(sb, runId, { step: "precheck", done: 0, total });

  // 全件チェック。画面側でも事前に同じことを確かめているが、
  // 確認してから押すまでの間に状態が変わることがあるのでサーバー側でもやり直す
  const checks = await Promise.all(numbers.map(n => precheckPull(token, ctx.repo, n, ctx.requireChecksMode)));
  const bad = checks.filter(c => !c.ok);
  if (bad.length) {
    const label = bad.map(b => `#${b.number}`).join("、");
    await writeLog(sb, ctx, caller, "merge", 0, "blocked", `bulk precheck / ${bad.map(b => `#${b.number}:${b.reason ?? ""}`).join(" / ")}`);
    throw new HttpError(409,
      `${label} がマージできない状態のため、1件もマージしていません。解消してからやり直してください。`,
      {
        precheck: {
          ok: false,
          conflicts: bad.filter(b => b.conflict).length,
          blocked: bad.filter(b => !b.conflict).length,
          needsReason: false,
          checkWarnings: checks.filter(c => c.checkGate).length,
          requireChecksMode: ctx.requireChecksMode,
          results: checks,
        },
      });
  }

  // 層A: 失敗チェックがあるものは、理由を書かないと1件も実行しない。
  // 全件チェックと同じ「1件でも引っかかれば1件もマージしない」の考え方に揃える（BRU13-038）
  const reason = overrideReason(body);
  const needReason = checks.filter(c => c.checkGate?.level === "reason");
  if (needReason.length && !reason) {
    const label = needReason.map(b => `#${b.number}`).join("、");
    throw new HttpError(409,
      `${label} に失敗しているチェックがあります。このままマージすると本番に反映されない可能性があるため、1件もマージしていません。続ける場合は理由を入力してください。`,
      {
        precheck: {
          ok: false, conflicts: 0, blocked: needReason.length,
          needsReason: true,
          checkWarnings: checks.filter(c => c.checkGate).length,
          requireChecksMode: ctx.requireChecksMode,
          results: checks,
        },
      });
  }

  // ── 試しマージ。ここを通るまで本番のマージ先には一切触らない ──────────
  // マージ先ごとに分ける。マージ先が違うPR同士は互いに影響しないため、
  // 1本の捨てブランチにまとめて積むと実際とは違う結果になる
  const byBase = new Map<string, { number: number; headSha: string }[]>();
  for (const n of numbers) {
    const c = checks.find(x => x.number === n);
    if (!c?.headSha || !c.base) continue;
    byBase.set(c.base, [...(byBase.get(c.base) ?? []), { number: n, headSha: c.headSha }]);
  }

  await reportProgress(sb, runId, { step: "precheck", done: total, total });

  // 何本の捨てブランチで何件を試すのかを先に決める。進捗に総数を出すため
  const plan: { base: string; rows: { number: number; headSha: string }[] }[] = [];
  for (const [base, rows] of byBase) {
    // 1件だけならマージ先が動く前に終わるので、順番の影響が無い
    if (rows.length < 2) continue;
    // 変更ファイルが1つも重ならない同士も、順番で結果が変わらないので試す必要が無い
    if (!(await needsTrial(token, ctx.repo, rows.map(r => r.number)))) continue;
    plan.push({ base, rows });
  }
  const trialTotal = plan.reduce((n, g) => n + g.rows.length, 0);
  await reportProgress(sb, runId, {
    step: "trial", done: 0, total: trialTotal, ...(trialTotal ? {} : { trialSkipped: true }),
  });

  const deadline = startedAt + TRIAL_BUDGET_MS;
  /** 試した時点のマージ先の先端。実行に移る直前、動いていないかを見るために持つ */
  const trialedBase = new Map<string, string>();
  /** 進捗に出す「積み終わった件数」。捨てブランチをまたいで通しで数える */
  let stacked = 0;

  for (const { base, rows } of plan) {
    let trial: { baseSha: string; failure: TrialFailure | null };
    try {
      trial = await trialMerge(token, ctx.repo, base, rows, method, deadline, async n => {
        stacked += 1;
        await reportProgress(sb, runId, { step: "trial", done: stacked, total: trialTotal, current: n });
      });
    } catch (e) {
      // 試しマージ自体ができなかった（捨てブランチを作れない等）。
      // 確認できていない以上、通す方向には倒さない
      await writeLog(sb, ctx, caller, "merge", 0, "blocked", `bulk trial / failed / ${(e as Error)?.message ?? ""}`);
      throw new HttpError(jaMessage(e).status,
        `マージできるかどうかの確認ができなかったため、1件もマージしていません。（${jaMessage(e).message}）`);
    }
    const { baseSha, failure } = trial;
    trialedBase.set(base, baseSha);
    if (!failure) continue;

    const after = failure.after;
    const head = after.length
      ? `#${failure.number} は ${after.map(n => `#${n}`).join("、")} のあとに入れるとマージできません`
      : `#${failure.number} をマージできません`;
    await writeLog(sb, ctx, caller, "merge", 0, "blocked",
      `bulk trial / #${failure.number} after:${after.join(",") || "-"} / ${failure.reason}`);
    throw new HttpError(409, `${head}。1件もマージしていません。`, {
      precheck: {
        ok: false,
        conflicts: failure.conflict ? 1 : 0,
        blocked: failure.conflict ? 0 : 1,
        needsReason: false,
        checkWarnings: checks.filter(c => c.checkGate).length,
        requireChecksMode: ctx.requireChecksMode,
        // 単独では通ったが、この順番だと通らなかった、と画面で言い分けるための印
        trial: true,
        results: checks.map(c => c.number === failure.number
          ? { ...c, ok: false, conflict: failure.conflict, reason: failure.reason, conflictAfter: after }
          : c),
      },
    });
  }

  // 試している間にマージ先が動いていたら、試した結果はもう当てにならない。
  // そのまま流すと「一部だけ入る」に逆戻りするので、1件もマージせずに戻す
  for (const [base, sha] of trialedBase) {
    const now = await gh(token, `/repos/${ctx.repo}/git/ref/heads/${encodeURI(base)}`).catch(() => null);
    if (now?.object?.sha && String(now.object.sha) !== sha) {
      await writeLog(sb, ctx, caller, "merge", 0, "blocked", `bulk trial / base moved / ${base}`);
      throw new HttpError(409,
        `確認している間にマージ先「${base}」が更新されました。1件もマージしていません。一覧を更新してから、もう一度お試しください。`);
    }
  }

  const results: { number: number; ok: boolean; title: string; sha?: string | null; error?: string; skipped?: boolean }[] = [];
  const retry = { refreshed: false };
  /** 権限で止まったと分かった時点で、残りは叩かずに同じ理由を並べる */
  let blocked: PermissionBlock | null = null;
  /** 1件でも失敗したら以降は実行しない。中途半端に入る件数を増やさないため */
  let stopped = false;

  await reportProgress(sb, runId, { step: "merge", done: 0, total });

  for (const number of numbers) {
    const checked = checks.find(c => c.number === number);
    let title = checked?.title ?? `#${number}`;
    if (blocked || stopped) {
      results.push({
        number, ok: false, title, skipped: true,
        error: blocked ? blocked.message : "前のPRが失敗したため実行していません。",
      });
      continue;
    }
    try {
      // 直前の状態を必ず引き直す。前のマージでマージ先が進んでいる可能性があるため。
      // ただし「判定中」を待つことはしない（poll=false）。1件マージするたびに
      // 残り全部の計算がやり直しになるので、待つと件数ぶんの待ち時間が積み上がる
      const p = await fetchPullForMerge(token, ctx.repo, number, false);
      title = p?.title ?? title;

      const nowBlocked = mergeBlockReasonOf(p);
      // 「判定中」では止めない。中身が衝突しないことは試しマージで確かめてあり、
      // GitHub 側の再計算が追いついていないだけ。ここで失敗にすると、直す必要の無い
      // ものを直しに行かせてしまう（BRU13-042）。本当にマージできなければ
      // マージAPI自体が理由を返すので、判断はそちらに任せる
      if (nowBlocked && !nowBlocked.pending) throw new HttpError(409, nowBlocked.message);

      // 実行直前にもう一度チェックを見る。前のマージで走り直したCIが落ちていることがある
      await enforceCheckGate(sb, ctx, caller, token, p, number, reason);

      const result = await runWithFreshToken(ctx.installationId, retry, t =>
        gh(t, `/repos/${ctx.repo}/pulls/${number}/merge`, {
          method: "PUT",
          body: {
            merge_method: method,
            ...(method === "rebase" ? {} : {
              commit_title: `${p.title} (#${number})`,
              commit_message: `Merged via Dev Ticket by ${caller.name}`,
            }),
            sha: p.head?.sha,
          },
        }));
      await writeLog(sb, ctx, caller, "merge", number, "ok", `bulk / ${method} / ${result?.sha ?? ""}`);
      results.push({ number, ok: true, title, sha: result?.sha ?? null });
      await reportProgress(sb, runId, {
        step: "merge", done: results.filter(r => r.ok).length, total, current: number,
      });
    } catch (e) {
      blocked = await explainForbidden(ctx.installationId, "merge", e);
      const message = blocked ? blocked.message : e instanceof HttpError ? e.message : jaMessage(e).message;
      await writeLog(sb, ctx, caller, "merge", number, "error", `bulk / ${(e as Error)?.message ?? ""}`);
      results.push({ number, ok: false, title, error: message });
      // ここから先は実行しない。事前チェックを通ったのに落ちたということは、
      // 前のマージでベースが動いた影響が濃い。続けるほど「入った分」と
      // 「残った分」が混ざって直しにくくなる（BRU13-038）
      stopped = true;
    }
  }

  // まとめてマージしたぶんも、最後に1回だけ反映する
  if (results.some(r => r.ok)) await syncReleasesNow(sb, ctx.id);

  return res.status(200).json({
    ok: true,
    merged: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    /** 失敗を受けて実行を打ち切ったかどうか（結果画面の案内を変えるために返す） */
    aborted: stopped || !!blocked,
    results,
    // 全件が同じ理由（権限）で落ちたときは、直し先を画面に出すために添える
    ...(blocked ? { permission: blocked } : {}),
  });
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

  await assertPermitted(ctx.installationId, "review");

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
