// ENHA2-055-3 高度検索：調査の記録（research_jobs）を画面から読み書きする。
//
// 画面からできるのは、本人の調査を読む・作る（待機中）・キャンセルにすることだけ（RLS と列の権限で絞っている。
// supabase/add_research_jobs.sql）。処理中・完了・失敗へ進めるのは AI が APIキーで送る
// research-start / research-result / research-fail（api/_lib/research.ts）。
//
// BRU25-015-3 ブラウザの AI（Gemini・ChatGPT・Claude）で調べる調査は mode = 'browser' で作る。
// 資料ファイルは POST /api/research/materials、答えの取り込みは POST /api/research/import（api/research/[action].ts）。
// mode の列（supabase/add_research_jobs_mode.sql）が無い DB でもターミナルの AI の調査を作れるよう、
// mode はブラウザの AI のときだけ送る。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

export type ResearchStatus = "queued" | "running" | "done" | "failed" | "cancelled";
/** どちらの AI で調べたか。cli = ターミナルの AI（APIキーで結果を送る）／ browser = ブラウザの AI（答えを貼って取り込む） */
export type ResearchMode = "cli" | "browser";

export const RESEARCH_STATUS_META: Record<ResearchStatus, { label: string; color: string; bg: string }> = {
  queued: { label: "待機中", color: "#6B6458", bg: "#F3F1EE" },
  running: { label: "処理中", color: "#7C3AED", bg: "#F5F3FF" },
  done: { label: "完了", color: "#059669", bg: "#ECFDF5" },
  failed: { label: "失敗", color: "#DC2626", bg: "#FEF2F2" },
  cancelled: { label: "キャンセル", color: "#9E9690", bg: "#F3F1EE" },
};

export type ResearchSourceKind = "minutes" | "wiki" | "ticket" | "comment" | "backlog" | "file";

export const RESEARCH_SOURCE_KIND_LABEL: Record<string, string> = {
  minutes: "議事録", wiki: "Wiki", ticket: "チケット", comment: "コメント", backlog: "バックログ",
  // ENHA2-056 ファイルボックスのファイル
  file: "ファイル",
};

export interface ResearchSource {
  no: number;
  kind: ResearchSourceKind | string;
  /** 資料のID。チケット・コメントはチケットの WBS */
  id: string;
  title: string;
  date: string | null;
  url: string | null;
  /** 資料から書き写した根拠の文。移り先の画面で目立たせる */
  quote: string | null;
}

export interface ResearchJob {
  id: string;
  question: string;
  status: ResearchStatus;
  result: string | null;
  resultShort: string | null;
  sources: ResearchSource[];
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  mode: ResearchMode;
}

export const isActiveResearch = (j: Pick<ResearchJob, "status">) => j.status === "queued" || j.status === "running";

function mapJob(r: Record<string, any>): ResearchJob {
  const status = (["queued", "running", "done", "failed", "cancelled"].includes(r.status) ? r.status : "queued") as ResearchStatus;
  return {
    id: String(r.id),
    question: String(r.question ?? ""),
    status,
    result: r.result ?? null,
    resultShort: r.result_short ?? null,
    sources: Array.isArray(r.sources) ? (r.sources as ResearchSource[]) : [],
    error: r.error ?? null,
    createdAt: String(r.created_at ?? ""),
    startedAt: r.started_at ?? null,
    finishedAt: r.finished_at ?? null,
    // 列が無い DB（SQL 未適用）の行は、ターミナルの AI の調査
    mode: r.mode === "browser" ? "browser" : "cli",
  };
}

/** テーブルがまだ無い（SQL 未適用）ときに画面へ出す文 */
export const RESEARCH_TABLE_MISSING = "高度検索の記録テーブルが、まだデータベースに作られていません。管理者に supabase/add_research_jobs.sql の適用を依頼してください";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /research_jobs/.test(error.message ?? "");
}

/** 自分の調査を新しい順に（RLS で本人の行しか返らない） */
export async function listResearchJobs(projectId: string, userId: string): Promise<{ ok: true; jobs: ResearchJob[] } | { ok: false; error: string }> {
  if (!isSupabaseEnabled || !projectId || !userId) return { ok: true, jobs: [] };
  const { data, error } = await supabase!
    .from("research_jobs").select("*")
    .eq("project_id", projectId).eq("created_by", userId)
    // BUG-01: 並びを固定する
    .order("created_at", { ascending: false }).order("id", { ascending: true })
    .limit(200);
  if (error) return { ok: false, error: isMissingTable(error) ? RESEARCH_TABLE_MISSING : error.message };
  return { ok: true, jobs: (data ?? []).map(mapJob) };
}

/** mode の列がまだ無い（add_research_jobs_mode.sql 未適用）ときに画面へ出す文 */
export const RESEARCH_MODE_MISSING = "ブラウザの AI の調査を記録する列が、まだデータベースに作られていません。管理者に supabase/add_research_jobs_mode.sql の適用を依頼してください（ターミナルの AI は今までどおり使えます）";

function isMissingModeColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "PGRST204" || error.code === "42703" || /'mode' column|column .*mode/i.test(error.message ?? "");
}

/** 待機中の調査を1件作る（「プロンプトを生成してコピー」「プロンプトをコピー」を押したとき） */
export async function createResearchJob(params: {
  projectId: string; organizationId: string | null; userId: string; question: string; mode?: ResearchMode;
}): Promise<{ ok: true; job: ResearchJob } | { ok: false; error: string }> {
  if (!isSupabaseEnabled) return { ok: false, error: "この環境では高度検索を使えません" };
  const { data, error } = await supabase!
    .from("research_jobs")
    .insert({
      project_id: params.projectId,
      organization_id: params.organizationId,
      created_by: params.userId,
      question: params.question,
      // mode の列が無い DB でターミナルの AI の調査が失敗しないよう、ブラウザの AI のときだけ列を含める
      ...(params.mode === "browser" ? { mode: "browser" } : {}),
    })
    .select("*")
    .single();
  if (error || !data) {
    if (params.mode === "browser" && isMissingModeColumn(error)) return { ok: false, error: RESEARCH_MODE_MISSING };
    return { ok: false, error: isMissingTable(error) ? RESEARCH_TABLE_MISSING : `調査を作れませんでした: ${error?.message ?? ""}` };
  }
  return { ok: true, job: mapJob(data) };
}

// ── ブラウザの AI（BRU25-015） ───────────────────────────────
export type BrowserAi = "gemini" | "chatgpt" | "claude";
export const BROWSER_AI_LABEL: Record<BrowserAi, string> = { gemini: "Gemini", chatgpt: "ChatGPT", claude: "Claude" };

export interface ResearchMaterialsSummary {
  project: { name: string; slug: string };
  /** 量の目安（トークン） */
  totalTokens: number;
  counts: { minutes: number; wiki: number; ticket: number; comment: number; backlog: number; file: number };
  /** 入れなかった種類と理由（権限なし など） */
  excluded: { kind: string; reason: string }[];
  /** AI ごとの、一度に読める量・1ファイルの上限・分けるファイルの数 */
  plans: Record<BrowserAi, { label: string; contextTokens: number; perFileTokens: number; files: number }>;
}
export interface ResearchMaterialsFile { name: string; index: number; total: number; tokens: number; content: string }

async function postResearchApi<T>(action: "materials" | "import", body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  if (!isSupabaseEnabled) return { ok: false, error: "この環境では高度検索を使えません", status: 0 };
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) return { ok: false, error: "ログインしてから操作してください", status: 401 };
  try {
    const res = await fetch(`/api/research/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: String(json?.error || `リクエストに失敗しました（${res.status}）`), status: res.status };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, error: "ネットワークエラーで、サーバーに届きませんでした", status: 0 };
  }
}

/** 資料の量と、AI ごとの分け方だけを取る（中身は取らない） */
export async function fetchResearchMaterialsSummary(projectId: string): Promise<{ ok: true; summary: ResearchMaterialsSummary } | { ok: false; error: string }> {
  const r = await postResearchApi<ResearchMaterialsSummary>("materials", { projectId, ai: "gemini", summary: true });
  return r.ok ? { ok: true, summary: r.data } : { ok: false, error: r.error };
}

/** 資料ファイルの part 番目（1から）を取る */
export async function fetchResearchMaterialsFile(projectId: string, ai: BrowserAi, part: number): Promise<{ ok: true; summary: ResearchMaterialsSummary; file: ResearchMaterialsFile } | { ok: false; error: string }> {
  const r = await postResearchApi<ResearchMaterialsSummary & { file: ResearchMaterialsFile | null }>("materials", { projectId, ai, part });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data.file) return { ok: false, error: "資料ファイルを作れませんでした" };
  return { ok: true, summary: r.data, file: r.data.file };
}

/** 貼られた AI の答えを取り込んで、調査を完了にする */
export async function importResearchAnswer(params: { projectId: string; jobId: string; answer: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await postResearchApi<{ ok: true }>("import", params);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

/** 待機中・処理中の調査をキャンセルにする */
export async function cancelResearchJob(id: string): Promise<{ error?: string }> {
  if (!isSupabaseEnabled) return { error: "この環境では操作できません" };
  const { error } = await supabase!
    .from("research_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id).in("status", ["queued", "running"]);
  if (error) return { error: `キャンセルできませんでした: ${error.message}` };
  return {};
}
