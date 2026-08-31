// サーバー側API(api/*)で「呼び出し元が、そのプロジェクトを見てよいか」を判定する共通処理。
//
// ── なぜ必要か（BRU14-001） ──────────────────────────────────
// api/* は service_role キーで Supabase に繋ぐ。service_role は BYPASSRLS なので
// RLS が一切効かない。つまり「認証を書かなければ、誰でも全プロジェクトを読める」。
// 実際 /api/projects/[projectId]/actual-hours と /api/sprints/[sprintId]/actual-hours は
// 認証が無く、未ログインでも projectId さえ判れば工数が取れる状態だった。
//
// ── 判定をDBに寄せる理由 ────────────────────────────────────
// 「どのプロジェクトを見てよいか」の規則は supabase/fix_project_level_rls_BRU14-001.sql の
// project_visible_to() に1本化してある。ここでその規則をTSに書き写すと、
// 片方だけ直したときに静かにズレる。そこで can_user_access_project(uuid, text) を
// RPC で呼んで、DB側の判断をそのまま使う。
//
// 受け付ける資格情報は2種類。どちらも Authorization: Bearer <token> で渡す。
//   1. Supabase のアクセストークン（画面からの呼び出し）
//   2. dvt_live_ で始まる dev-ticket の APIキー（外部連携。api/v1 と同じもの）
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

const API_KEY_PREFIX = "dvt_live_";

export type Caller =
  /** Supabase のログインユーザー */
  | { kind: "user"; userId: string }
  /** プロジェクトに紐付いた APIキー */
  | { kind: "api-key"; projectId: string };

export type AuthFailure = { ok: false; status: number; error: string };
export type AuthSuccess = { ok: true; caller: Caller };

/** service_role クライアント。RLS は効かないので、必ず本モジュールで絞ること。 */
export function serviceClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function bearer(req: any): string {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Authorization ヘッダを検証して呼び出し元を特定する。
 * ここでは「誰か」を決めるだけで、「何を見てよいか」は assertProjectAccess で決める。
 */
export async function authenticateCaller(
  sb: SupabaseClient,
  req: any,
): Promise<AuthSuccess | AuthFailure> {
  const token = bearer(req);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "認証情報がありません。Authorization: Bearer <アクセストークン または APIキー> を付けてください",
    };
  }

  // ── APIキー ──
  if (token.startsWith(API_KEY_PREFIX)) {
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const { data: key } = await sb
      .from("api_keys")
      .select("project_id, expires_at, revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();

    if (!key) return { ok: false, status: 401, error: "APIキーが無効です" };
    if (key.revoked_at) return { ok: false, status: 401, error: "このAPIキーは失効しています" };
    if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) {
      return { ok: false, status: 401, error: "このAPIキーは有効期限が切れています" };
    }
    return { ok: true, caller: { kind: "api-key", projectId: key.project_id as string } };
  }

  // ── Supabase のアクセストークン ──
  // service_role クライアントの getUser(jwt) は、渡した JWT を GoTrue に検証させる。
  // 期限切れ・改ざん・ログアウト済みならここで data.user が null になる。
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) {
    return { ok: false, status: 401, error: "アクセストークンが無効か、有効期限が切れています" };
  }
  return { ok: true, caller: { kind: "user", userId: data.user.id } };
}

/**
 * 呼び出し元がそのプロジェクトを見てよいかを判定する。
 * 見てよくない場合も 403 ではなく 404 を返す。プロジェクトIDの存在有無を
 * 総当たりで探れないようにするため（画面側の404/403の出し分けとは別方針）。
 */
export async function assertProjectAccess(
  sb: SupabaseClient,
  caller: Caller,
  projectId: string,
): Promise<AuthFailure | null> {
  if (caller.kind === "api-key") {
    // APIキーは発行時に1プロジェクトへ固定されている。
    return caller.projectId === projectId
      ? null
      : { ok: false, status: 404, error: "プロジェクトが見つかりません" };
  }

  const { data, error } = await sb.rpc("can_user_access_project", {
    p_user_id: caller.userId,
    p_project_id: projectId,
  });

  if (error) {
    // 関数が無い＝マイグレーション未適用。素通しにすると穴が空くので閉じる。
    return {
      ok: false,
      status: 500,
      error: `アクセス判定に失敗しました: ${error.message}。supabase/fix_project_level_rls_BRU14-001.sql が適用されているか確認してください`,
    };
  }
  return data === true ? null : { ok: false, status: 404, error: "プロジェクトが見つかりません" };
}

/**
 * 認証 → プロジェクト権限確認 をまとめて行う。
 * 通れば null、弾くべきならレスポンスを返して呼び出し側で終了する。
 */
export async function requireProjectAccess(
  sb: SupabaseClient,
  req: any,
  projectId: string,
): Promise<AuthFailure | null> {
  const auth = await authenticateCaller(sb, req);
  if (!auth.ok) return auth;
  return assertProjectAccess(sb, auth.caller, projectId);
}
