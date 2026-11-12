// ENHA2-055-3 高度検索：調査の記録（research_jobs）を画面から読み書きする。
//
// 画面からできるのは、本人の調査を読む・作る（待機中）・キャンセルにすることだけ（RLS と列の権限で絞っている。
// supabase/add_research_jobs.sql）。処理中・完了・失敗へ進めるのは AI が APIキーで送る
// research-start / research-result / research-fail（api/_lib/research.ts）。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

export type ResearchStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export const RESEARCH_STATUS_META: Record<ResearchStatus, { label: string; color: string; bg: string }> = {
  queued: { label: "待機中", color: "#6B6458", bg: "#F3F1EE" },
  running: { label: "処理中", color: "#7C3AED", bg: "#F5F3FF" },
  done: { label: "完了", color: "#059669", bg: "#ECFDF5" },
  failed: { label: "失敗", color: "#DC2626", bg: "#FEF2F2" },
  cancelled: { label: "キャンセル", color: "#9E9690", bg: "#F3F1EE" },
};

export type ResearchSourceKind = "minutes" | "wiki" | "ticket" | "comment" | "backlog";

export const RESEARCH_SOURCE_KIND_LABEL: Record<string, string> = {
  minutes: "議事録", wiki: "Wiki", ticket: "チケット", comment: "コメント", backlog: "バックログ",
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

/** 待機中の調査を1件作る（「プロンプトを生成してコピー」を押したとき） */
export async function createResearchJob(params: {
  projectId: string; organizationId: string | null; userId: string; question: string;
}): Promise<{ ok: true; job: ResearchJob } | { ok: false; error: string }> {
  if (!isSupabaseEnabled) return { ok: false, error: "この環境では高度検索を使えません" };
  const { data, error } = await supabase!
    .from("research_jobs")
    .insert({
      project_id: params.projectId,
      organization_id: params.organizationId,
      created_by: params.userId,
      question: params.question,
    })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: isMissingTable(error) ? RESEARCH_TABLE_MISSING : `調査を作れませんでした: ${error?.message ?? ""}` };
  return { ok: true, job: mapJob(data) };
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
