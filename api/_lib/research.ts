// ENHA2-055-1 高度検索：AI が調査の開始・結果・失敗を Dev Ticket へ伝える API の本体。
//
//   POST /api/v1/research-start  {jobId}                          … 待機中 → 処理中。質問の文を返す
//   POST /api/v1/research-result {jobId, markdown, short, sources} … 結果を保存して完了にする
//   POST /api/v1/research-fail   {jobId, reason}                   … 失敗にする（AI が調べられなかったとき）
//
// 振り分けと APIキーの認証は api/v1/[resource].ts が行い、ここは中身だけを持つ。
// キーの権限は read / full のどちらでも使える（write だけのキーは振り分け側で 403 にする）。
//
// 受け付けるのは「キーと同じプロジェクトの調査」で、かつ「キーを発行した人＝調査を作った人」のときだけ。
// api_keys.created_by は profiles.name なので、キーの組織のメンバーから名前で引いて profiles.id に直す
// （api/github/[resource].ts の callerFromApiKey と同じ決め方）。
//
// テーブルは supabase/add_research_jobs.sql。マージ・デプロイのあとに手で流すので、
// 流す前に呼ばれたときは 503 と「SQL が未適用」の文を返す（ほかの API には影響しない）。
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApiKeyRow } from "./apiKeyAuth.js";

/** result・result_short・sources を合わせた大きさの上限（文字数） */
export const MAX_RESEARCH_RESULT_CHARS = 200_000;
/** 出典の数の上限 */
const MAX_SOURCES = 100;
/** 失敗の理由の長さの上限 */
const MAX_REASON_CHARS = 2_000;
/** 根拠の文（quote）1件の長さの上限 */
const MAX_QUOTE_CHARS = 2_000;

export const RESEARCH_STATUS_LABEL: Record<string, string> = {
  queued: "待機中", running: "処理中", done: "完了", failed: "失敗", cancelled: "キャンセル",
};
const TERMINAL = new Set(["done", "failed", "cancelled"]);

/** 出典の種類。AI が日本語で送ってきても受ける */
const SOURCE_KIND_BY_LABEL: Record<string, string> = {
  minutes: "minutes", minute: "minutes", "議事録": "minutes",
  wiki: "wiki",
  ticket: "ticket", "チケット": "ticket",
  comment: "comment", "コメント": "comment",
  backlog: "backlog", "バックログ": "backlog",
  // ENHA2-056 ファイルボックスのファイル
  file: "file", "ファイル": "file",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface KeyOwner { id: string; name: string; role: string; organizationId: string | null }

/**
 * キーを発行した人を profiles から引く。1人に決まらないときは、誰の調査として扱うか決められないので通さない。
 * 議事録の見られる人の判定（ENHA2-055-2）でも使う。
 */
export async function resolveKeyOwner(
  sb: SupabaseClient, key: ApiKeyRow,
): Promise<{ ok: true; owner: KeyOwner } | { ok: false; status: number; error: string }> {
  const name = String(key.created_by ?? "").trim();
  if (!name) {
    return { ok: false, status: 403, error: "このAPIキーには発行した人の記録が無いため、高度検索には使えません。APIキーを発行し直してください" };
  }
  const { data, error } = await sb
    .from("profiles").select("id, name, role, organization_id").eq("name", name)
    .order("id", { ascending: true });
  if (error) return { ok: false, status: 500, error: error.message };
  const rows = (data ?? []) as any[];
  const inOrg = rows.filter(p => String(p.organization_id ?? "") === String(key.organization_id ?? ""));
  const candidates = inOrg.length ? inOrg : rows.filter(p => p.role === "owner");
  if (candidates.length !== 1) {
    return {
      ok: false, status: 403,
      error: candidates.length
        ? `APIキーを発行した「${name}」と同じ名前のメンバーが複数いるため、誰の調査かを判定できません`
        : `APIキーを発行した「${name}」がメンバーに見つかりません。APIキーを発行し直してください`,
    };
  }
  const p = candidates[0];
  return {
    ok: true,
    owner: { id: String(p.id), name: String(p.name ?? name), role: String(p.role ?? ""), organizationId: (p.organization_id as string | null) ?? null },
  };
}

/** テーブルがまだ無い（add_research_jobs.sql 未適用）ときのエラーか */
function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /research_jobs/.test(error.message ?? "") && /does not exist|Could not find/i.test(error.message ?? "");
}

const MISSING_TABLE_ERROR = "高度検索の記録テーブル（supabase/add_research_jobs.sql）が、まだデータベースに作られていません。管理者に SQL の適用を依頼してください";

/** jobId を読み、キーのプロジェクト・発行者の調査かを確かめて行を返す */
async function loadOwnJob(
  sb: SupabaseClient, key: ApiKeyRow, body: any,
): Promise<{ ok: true; job: any; owner: KeyOwner } | { ok: false; status: number; error: string }> {
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) return { ok: false, status: 400, error: "jobId（調査のID）は必須です。プロンプトに書かれている ID をそのまま送ってください" };
  if (!UUID_RE.test(jobId)) return { ok: false, status: 400, error: `jobId の形式が正しくありません: ${jobId}` };

  const ownerRes = await resolveKeyOwner(sb, key);
  if (!ownerRes.ok) return ownerRes;

  const { data, error } = await sb.from("research_jobs").select("*").eq("id", jobId).maybeSingle();
  if (error) {
    if (isMissingTable(error)) return { ok: false, status: 503, error: MISSING_TABLE_ERROR };
    return { ok: false, status: 500, error: error.message };
  }
  // ほかのプロジェクトの調査は、有るか無いかも明かさない
  if (!data || data.project_id !== key.project_id) {
    return { ok: false, status: 404, error: `調査「${jobId}」がこのAPIキーのプロジェクトに見つかりません` };
  }
  if (String(data.created_by) !== ownerRes.owner.id) {
    return { ok: false, status: 403, error: "この調査は、APIキーを発行した人の調査ではないため操作できません。調査を作った人のキーで送ってください" };
  }
  return { ok: true, job: data, owner: ownerRes.owner };
}

function terminalConflict(res: any, job: any) {
  return res.status(409).json({
    error: `この調査はすでに「${RESEARCH_STATUS_LABEL[job.status] ?? job.status}」のため、変更できません（記録は変えていません）`,
    status: RESEARCH_STATUS_LABEL[job.status] ?? job.status,
  });
}

// ── POST /api/v1/research-start ──────────────────────────────
export async function handleResearchStart(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const found = await loadOwnJob(sb, key, body);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const job = found.job;
  if (TERMINAL.has(job.status)) return terminalConflict(res, job);

  let changed = false;
  let startedAt: string | null = job.started_at ?? null;
  if (job.status === "queued") {
    startedAt = new Date().toISOString();
    // 画面でキャンセルされた直後と重なったときに上書きしないよう、待機中のときだけ進める
    const { data: updated, error } = await sb.from("research_jobs")
      .update({ status: "running", started_at: startedAt })
      .eq("id", job.id).eq("status", "queued")
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!updated || updated.length === 0) {
      const { data: now } = await sb.from("research_jobs").select("status").eq("id", job.id).maybeSingle();
      return terminalConflict(res, now ?? job);
    }
    changed = true;
  }

  const { data: project } = await sb.from("projects").select("name, slug").eq("id", key.project_id).maybeSingle();
  return res.status(200).json({
    ok: true,
    changed,
    jobId: job.id,
    status: RESEARCH_STATUS_LABEL.running,
    question: job.question,
    startedAt,
    project: { name: project?.name ?? null, slug: project?.slug ?? null },
  });
}

// ── POST /api/v1/research-result ─────────────────────────────
interface ResearchSource { no: number; kind: string; id: string; title: string; date: string | null; url: string | null; quote: string | null }

function normalizeSources(raw: unknown): { ok: true; sources: ResearchSource[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, sources: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "sources は出典の配列で指定してください" };
  if (raw.length > MAX_SOURCES) return { ok: false, error: `sources が多すぎます（${MAX_SOURCES}件まで）` };
  const out: ResearchSource[] = [];
  const seenNo = new Set<number>();
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] as any;
    const at = `sources[${i}]`;
    if (!s || typeof s !== "object") return { ok: false, error: `${at} はオブジェクトで指定してください` };
    const no = Number(s.no);
    if (!Number.isInteger(no) || no < 1) return { ok: false, error: `${at}.no は本文の [1] [2] と同じ、1以上の整数で指定してください` };
    if (seenNo.has(no)) return { ok: false, error: `${at}.no（${no}）が重複しています` };
    seenNo.add(no);
    const kind = SOURCE_KIND_BY_LABEL[String(s.kind ?? "").trim().toLowerCase()] ?? SOURCE_KIND_BY_LABEL[String(s.kind ?? "").trim()];
    if (!kind) return { ok: false, error: `${at}.kind「${String(s.kind ?? "")}」は使えません（minutes / wiki / ticket / comment / backlog / file）` };
    const id = String(s.id ?? "").trim();
    if (!id) return { ok: false, error: `${at}.id（資料のID。チケット・コメントはチケットの WBS）は必須です` };
    const title = String(s.title ?? "").trim();
    if (!title) return { ok: false, error: `${at}.title は必須です` };
    const url = typeof s.url === "string" && s.url.trim() ? s.url.trim() : null;
    // 画面で <a href> に入れるので、http(s) と画面内のパス以外は受けない（javascript: などを入れさせない）
    if (url && !/^https?:\/\//i.test(url) && !url.startsWith("/")) {
      return { ok: false, error: `${at}.url は http(s) の URL で指定してください` };
    }
    const quote = typeof s.quote === "string" && s.quote.trim() ? s.quote.trim() : null;
    if (quote && quote.length > MAX_QUOTE_CHARS) return { ok: false, error: `${at}.quote が長すぎます（${MAX_QUOTE_CHARS}文字まで）` };
    const date = typeof s.date === "string" && s.date.trim() ? s.date.trim().slice(0, 40) : null;
    out.push({ no, kind, id: id.slice(0, 200), title: title.slice(0, 500), date, url, quote });
  }
  out.sort((a, b) => a.no - b.no);
  return { ok: true, sources: out };
}

export async function handleResearchResult(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  // 中身の誤りは、記録を読む前に返す（400 のときは記録を変えない）
  const markdown = typeof body?.markdown === "string" ? body.markdown.trim() : "";
  const short = typeof body?.short === "string" ? body.short.trim() : "";
  if (!markdown) return res.status(400).json({ error: "markdown（レポート型の結果：結論・経緯（時系列）・未決事項・出典）は必須です" });
  if (!short) return res.status(400).json({ error: "short（短い回答型の結果：回答の2〜3文）は必須です" });
  const normalized = normalizeSources(body?.sources);
  if (!normalized.ok) return res.status(400).json({ error: normalized.error });
  const total = markdown.length + short.length + JSON.stringify(normalized.sources).length;
  if (total > MAX_RESEARCH_RESULT_CHARS) {
    return res.status(400).json({ error: `結果が大きすぎます（markdown・short・sources を合わせて${MAX_RESEARCH_RESULT_CHARS.toLocaleString()}文字まで。今回は${total.toLocaleString()}文字）` });
  }

  const found = await loadOwnJob(sb, key, body);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const job = found.job;
  if (TERMINAL.has(job.status)) return terminalConflict(res, job);

  const now = new Date().toISOString();
  const { data: updated, error } = await sb.from("research_jobs")
    .update({
      status: "done", result: markdown, result_short: short, sources: normalized.sources,
      error: null, finished_at: now, ...(job.started_at ? {} : { started_at: now }),
    })
    .eq("id", job.id).in("status", ["queued", "running"])
    .select("id");
  if (error) return res.status(500).json({ error: error.message });
  if (!updated || updated.length === 0) {
    const { data: cur } = await sb.from("research_jobs").select("status").eq("id", job.id).maybeSingle();
    return terminalConflict(res, cur ?? job);
  }
  return res.status(200).json({ ok: true, jobId: job.id, status: RESEARCH_STATUS_LABEL.done, sources: normalized.sources.length, finishedAt: now });
}

// ── POST /api/v1/research-fail ───────────────────────────────
export async function handleResearchFail(sb: SupabaseClient, key: ApiKeyRow, body: any, res: any) {
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!reason) return res.status(400).json({ error: "reason（調べられなかった理由）は必須です" });
  if (reason.length > MAX_REASON_CHARS) return res.status(400).json({ error: `reason が長すぎます（${MAX_REASON_CHARS}文字まで）` });

  const found = await loadOwnJob(sb, key, body);
  if (!found.ok) return res.status(found.status).json({ error: found.error });
  const job = found.job;
  if (TERMINAL.has(job.status)) return terminalConflict(res, job);

  const now = new Date().toISOString();
  const { data: updated, error } = await sb.from("research_jobs")
    .update({ status: "failed", error: reason, finished_at: now })
    .eq("id", job.id).in("status", ["queued", "running"])
    .select("id");
  if (error) return res.status(500).json({ error: error.message });
  if (!updated || updated.length === 0) {
    const { data: cur } = await sb.from("research_jobs").select("status").eq("id", job.id).maybeSingle();
    return terminalConflict(res, cur ?? job);
  }
  return res.status(200).json({ ok: true, jobId: job.id, status: RESEARCH_STATUS_LABEL.failed, finishedAt: now });
}
