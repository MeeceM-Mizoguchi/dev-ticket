// Dev Ticket の APIキー（dvt_live_…）を確かめる共通処理（BRU21-001）。
//
// 公開API（api/v1/[resource].ts）と、APIキーで bot 名義のPR作成・マージを行う
// GitHub連携（api/github/[resource].ts の ticket-pull-create / ticket-merge）の両方から使う。
// 以前は api/v1 の中にあったものを、そのまま移した（判定・エラー文・レート制限は変えていない）。
//
// projectAuth.ts の authenticateCaller も APIキーを受けるが、あちらは「どのプロジェクトか」だけを返し、
// 権限（scope）・発行者（created_by）・レート制限を見ない。公開APIとしての入口はこちらを使う。
//
//   ・supabase/add_api_keys.sql        （consume_api_key_rate）
//   ・supabase/add_api_key_scopes.sql  （api_keys.scope）
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

const KEY_PREFIX = "dvt_live_";
/** 1キーあたり: RATE_WINDOW_SEC 秒間に RATE_LIMIT 回まで */
const RATE_LIMIT = 60;
const RATE_WINDOW_SEC = 60;

// ── キーの権限 ────────────────────────────────────────────────
export type KeyScope = "write" | "read" | "full";
export const SCOPE_LABEL: Record<KeyScope, string> = { write: "登録のみ", read: "読み取りのみ", full: "すべて" };
/** scope 列が無い（add_api_key_scopes.sql 未適用）・未知の値は、従来どおりの「登録のみ」に倒す */
function scopeOf(raw: unknown): KeyScope {
  return raw === "read" || raw === "full" ? raw : "write";
}

export interface ApiKeyRow {
  id: string;
  name: string;
  project_id: string;
  organization_id: string | null;
  created_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  scope: KeyScope;
}

export type ApiKeyAuthResult =
  | { ok: true; key: ApiKeyRow }
  | { ok: false; status: number; error: string };

/**
 * Authorization ヘッダの APIキーを検証する。
 *
 * service_role で接続するため RLS は効かない。ここで引いた key.project_id が
 * 唯一のテナント境界になるので、この先の処理は必ず project_id で絞ること。
 */
export async function authenticateApiKey(sb: SupabaseClient, req: any): Promise<ApiKeyAuthResult> {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (!token) {
    return { ok: false, status: 401, error: "APIキーがありません。Authorization: Bearer <APIキー> を付けてください" };
  }
  if (!token.startsWith(KEY_PREFIX)) {
    return { ok: false, status: 401, error: `APIキーの形式が正しくありません（${KEY_PREFIX}… で始まります）` };
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");
  // 列を名指しせず * で引く。scope 列は後から足したもので、名指しすると
  // add_api_key_scopes.sql を流す前の環境では全キーが「無効」になってしまう。
  const { data: key } = await sb
    .from("api_keys")
    .select("*")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!key) return { ok: false, status: 401, error: "APIキーが無効です" };
  if (key.revoked_at) return { ok: false, status: 401, error: "このAPIキーは失効しています" };
  if (key.expires_at && new Date(key.expires_at).getTime() < Date.now()) {
    return { ok: false, status: 401, error: "このAPIキーは有効期限が切れています" };
  }

  // レート制限（last_used_at の更新もここで行われる）
  const { data: allowed, error: rateError } = await sb.rpc("consume_api_key_rate", {
    p_key_id: key.id,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SEC,
  });
  if (rateError) {
    return { ok: false, status: 500, error: `レート制限の判定に失敗しました: ${rateError.message}` };
  }
  if (allowed === false) {
    return { ok: false, status: 429, error: `リクエストが多すぎます（${RATE_WINDOW_SEC}秒あたり${RATE_LIMIT}回まで）。少し待ってから再試行してください` };
  }

  return {
    ok: true,
    key: {
      id: key.id, name: key.name, project_id: key.project_id,
      organization_id: key.organization_id ?? null, created_by: key.created_by ?? null,
      expires_at: key.expires_at ?? null, revoked_at: key.revoked_at ?? null,
      scope: scopeOf(key.scope),
    },
  };
}
