// BRU25-015 高度検索：ブラウザの AI（Gemini・ChatGPT・Claude）で調べるときに、画面から呼ぶ API。
//
//   POST /api/research/materials {projectId, ai, part?, summary?}
//     … その人が見られる資料をまとめた .md の中身と量（BRU25-015-1。本体は api/_lib/researchMaterials.ts）
//
// 認証は、ログイン中の人の Supabase のアクセストークン（Authorization: Bearer <access_token>）だけ。
// APIキーは受けない（ブラウザの AI は APIキーを使わない。ターミナルの AI 用の API は api/v1 のまま変えない）。
// service_role で読むので RLS は効かない。プロジェクトを見てよいかは can_user_access_project()（projectAuth.ts）、
// 中の資料の見られる範囲は researchMaterials.ts（高度検索の API と同じ判定）で絞る。
import type { SupabaseClient } from "@supabase/supabase-js";
import { serviceClient, authenticateCaller, assertProjectAccess } from "../_lib/projectAuth.js";
import type { KeyOwner } from "../_lib/research.js";
import { buildMaterials, BROWSER_AIS, type BrowserAi } from "../_lib/researchMaterials.js";

/** 画面のオリジン。出典の URL に使う（api/v1 の appPublicOrigin と同じ環境変数。無ければ呼ばれたホスト） */
function appOrigin(req: any): string {
  const env = (process.env.PUBLIC_URL || process.env.VITE_PUBLIC_APP_ORIGIN || "").replace(/\/+$/, "");
  if (env) return env;
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0].trim();
  const proto = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
  return host ? `${proto}://${host}` : "";
}

/** ログイン中の人を、高度検索の判定に使う形（KeyOwner）で引く */
async function loginOwner(sb: SupabaseClient, req: any): Promise<{ ok: true; owner: KeyOwner } | { ok: false; status: number; error: string }> {
  const auth = await authenticateCaller(sb, req);
  if (!auth.ok) return auth;
  if (auth.caller.kind !== "user") {
    return { ok: false, status: 401, error: "この API は画面からだけ呼べます（APIキーでは呼べません）。ログインしてから操作してください" };
  }
  const { data: p, error } = await sb.from("profiles").select("id, name, role, organization_id").eq("id", auth.caller.userId).maybeSingle();
  if (error) return { ok: false, status: 500, error: error.message };
  if (!p) return { ok: false, status: 403, error: "メンバーの情報が見つかりません" };
  return {
    ok: true,
    owner: { id: String(p.id), name: String(p.name ?? ""), role: String(p.role ?? ""), organizationId: (p.organization_id as string | null) ?? null },
  };
}

// ── POST /api/research/materials ─────────────────────────────
async function handleMaterials(sb: SupabaseClient, req: any, owner: KeyOwner, body: any, res: any) {
  const projectId = typeof body?.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) return res.status(400).json({ error: "projectId は必須です" });
  const ai = String(body?.ai ?? "gemini").trim().toLowerCase();
  if (!(BROWSER_AIS as readonly string[]).includes(ai)) {
    return res.status(400).json({ error: `ai「${ai}」は使えません（${BROWSER_AIS.join(" / ")}）` });
  }
  let part: number | null = null;
  if (body?.summary !== true) {
    const raw = body?.part === undefined || body?.part === null ? 1 : Number(body.part);
    if (!Number.isInteger(raw) || raw < 1) return res.status(400).json({ error: "part は 1 以上の整数で指定してください" });
    part = raw;
  }

  const denied = await assertProjectAccess(sb, { kind: "user", userId: owner.id }, projectId);
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const r = await buildMaterials(sb, projectId, owner, appOrigin(req), { ai: ai as BrowserAi, part });
  if (!r.ok) return res.status(r.status).json({ error: r.error });
  return res.status(200).json({ ok: true, ai, ...r.summary, file: r.file });
}

export default async function handler(req: any, res: any) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });
  const action = String(req.query?.action ?? "");
  if (action !== "materials") {
    return res.status(404).json({ error: `不明なエンドポイントです: /api/research/${action}` });
  }
  const sb = serviceClient();
  if (!sb) return res.status(500).json({ error: "Supabase not configured" });

  let body: any;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});
  } catch {
    return res.status(400).json({ error: "リクエストボディが JSON として読めません" });
  }

  try {
    const who = await loginOwner(sb, req);
    if (!who.ok) return res.status(who.status).json({ error: who.error });
    return await handleMaterials(sb, req, who.owner, body, res);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "サーバーでエラーが起きました" });
  }
}
