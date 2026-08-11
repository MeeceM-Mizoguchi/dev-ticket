// API連携で使う「Dev Ticket が発行するAPIキー」の発行・一覧・復号・失効。
//
// キーの平文は、照合用の SHA-256 ハッシュとは別に、AES-256-GCM で暗号化して保存する。
// 暗号鍵はDBではなく Vercel の環境変数側から導出するため、DBのバックアップや
// ダンプだけが漏れてもキーは復元できない。
//
// この設計により、画面の「使用するキー」で選ぶだけでプロンプトへ平文を埋め込める
// （利用者がキーを控えて貼り直す必要がない）。
//
// ・発行 / 復号 … 暗号鍵がサーバーにしか無いので `api/api-keys/[action].ts` 経由
// ・一覧 / 失効 … 暗号鍵が不要なので、RLSで保護されたテーブルへブラウザから直接
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

/** 発行するキーの接頭辞。キー単体を見て発行元が分かるようにする（sk_live_=Stripe と同じ発想） */
export const API_KEY_PREFIX = "dvt_live_";

export interface ApiKeyRow {
  id: string;
  name: string;
  /** 例: "dvt_live_a1b2c3d4"。これ以降は復元できない */
  keyPrefix: string;
  projectId: string;
  organizationId: string | null;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

/** 失効しておらず、有効期限内のキーか */
export function isActiveKey(k: ApiKeyRow): boolean {
  if (k.revokedAt) return false;
  if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()) return false;
  return true;
}

/** 一覧の状態表示に使う */
export function keyStatus(k: ApiKeyRow): { label: string; kind: "active" | "expired" | "revoked" } {
  if (k.revokedAt) return { label: "失効", kind: "revoked" };
  if (k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()) return { label: "期限切れ", kind: "expired" };
  return { label: "有効", kind: "active" };
}

function mapRow(row: Record<string, unknown>): ApiKeyRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    keyPrefix: String(row.key_prefix ?? ""),
    projectId: String(row.project_id ?? ""),
    organizationId: (row.organization_id as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    expiresAt: (row.expires_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    lastUsedAt: (row.last_used_at as string | null) ?? null,
  };
}

// ── サーバー呼び出し ──────────────────────────────────────────

/**
 * `api/api-keys/[action]` を呼ぶ。認証はログイン中ユーザーのアクセストークン。
 *
 * Vite の開発サーバーは api/ を実行しないため、`npm run dev` ではHTMLが返る。
 * JSONとして読めなかった場合はその旨を伝えるメッセージにする。
 */
async function postApi<T>(action: "create" | "reveal", body: unknown): Promise<
  { ok: true; data: T } | { ok: false; error: string; code?: string }
> {
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "ログインが必要です" };

  let res: Response;
  try {
    res = await fetch(`/api/api-keys/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, error: "サーバーに接続できませんでした" };
  }

  const raw = await res.text();
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* HTML が返った */ }

  if (json === null) {
    return {
      ok: false,
      error: "APIサーバーが応答しませんでした。ローカルの開発サーバー（npm run dev）ではAPIが動かないため、デプロイした環境で操作してください",
    };
  }
  if (!res.ok) return { ok: false, error: json?.error || "リクエストに失敗しました", code: json?.code };
  return { ok: true, data: json as T };
}

// ── 取得 ──────────────────────────────────────────────────────

/** プロジェクトのAPIキー一覧。管理者以外は RLS により常に空が返る。 */
export async function listApiKeys(projectId: string): Promise<ApiKeyRow[]> {
  if (!isSupabaseEnabled || !projectId) return [];
  const { data, error } = await supabase!
    .from("api_keys")
    .select("id, name, key_prefix, project_id, organization_id, created_by, created_at, expires_at, revoked_at, last_used_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data.map(mapRow);
}

// ── 発行 ──────────────────────────────────────────────────────

export interface CreateApiKeyParams {
  name: string;
  projectId: string;
  /** 有効期限（日数）。null は無期限 */
  expiresInDays: number | null;
}

export interface CreateApiKeyResult {
  plainKey: string;
  row: ApiKeyRow;
}

/**
 * APIキーを発行する。
 *
 * 乱数の生成・ハッシュ化・暗号化はすべてサーバー側で行う（暗号鍵がサーバーにしか無いため）。
 * 組織IDと発行者名もサーバーがログイン情報から決めるので、ここから渡す必要はない。
 */
export async function createApiKey(
  params: CreateApiKeyParams,
): Promise<{ ok: true; result: CreateApiKeyResult } | { ok: false; error: string }> {
  const name = params.name.trim();
  if (!name) return { ok: false, error: "用途名を入力してください" };
  if (!isSupabaseEnabled) return { ok: false, error: "この環境ではAPIキーを発行できません" };
  if (!params.projectId) return { ok: false, error: "プロジェクトが特定できません" };

  const res = await postApi<{ plainKey: string; key: Record<string, unknown> }>("create", {
    name,
    projectId: params.projectId,
    expiresInDays: params.expiresInDays,
  });
  if (!res.ok) return { ok: false, error: res.error };

  return { ok: true, result: { plainKey: res.data.plainKey, row: mapRow(res.data.key) } };
}

// ── 復号 ──────────────────────────────────────────────────────

/**
 * 保存済みキーの平文を取り出す。「使用するキー」で選んだものをプロンプトへ埋め込むために使う。
 *
 * 暗号化して保存する前に発行されたキーは復元できず、`code: "no_cipher"` が返る。
 * この場合は再発行してもらうしかない。
 */
export async function revealApiKey(
  id: string,
): Promise<{ ok: true; plainKey: string } | { ok: false; error: string; needsReissue: boolean }> {
  if (!isSupabaseEnabled) return { ok: false, error: "この環境では利用できません", needsReissue: false };

  const res = await postApi<{ plainKey: string }>("reveal", { id });
  if (!res.ok) return { ok: false, error: res.error, needsReissue: res.code === "no_cipher" };
  return { ok: true, plainKey: res.data.plainKey };
}

// ── 失効 ──────────────────────────────────────────────────────

/** 失効させる。行は消さずに revoked_at を立てる（監査のため履歴を残す） */
export async function revokeApiKey(id: string): Promise<{ error?: string }> {
  if (!isSupabaseEnabled) return { error: "この環境では操作できません" };
  const { error } = await supabase!
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: `失効に失敗しました: ${error.message}` };
  return {};
}

/** 失効済みのキーを完全に削除する（一覧の掃除用） */
export async function deleteApiKey(id: string): Promise<{ error?: string }> {
  if (!isSupabaseEnabled) return { error: "この環境では操作できません" };
  const { error } = await supabase!.from("api_keys").delete().eq("id", id);
  if (error) return { error: `削除に失敗しました: ${error.message}` };
  return {};
}

// ── 表示ヘルパー ──────────────────────────────────────────────

/** "dvt_live_a1b2c3d4" → "dvt_live_a1b2c3d4••••••••" */
export function maskedKey(keyPrefix: string): string {
  return `${keyPrefix}${"•".repeat(12)}`;
}

/** "3分前" のような相対表記。未使用なら "—" */
export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (!isFinite(diff)) return "—";
  if (diff < 60_000) return "たった今";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}分前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}時間前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day}日前`;
  return new Date(iso).toLocaleDateString("ja-JP");
}

/** "2026/08/11" */
export function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
