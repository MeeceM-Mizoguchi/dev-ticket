// ファイルボックスの容量制限（サーバー側API共通）。
//
// 上限はプラン（plans.max_file_storage_gb）で決まり、使用量は組織の全プロジェクトの合計。
// 集計は DB の file_storage_quota()（supabase/add_file_box_storage_limit.sql）に寄せている。
// 画面側で合計すると、自分から見えない限定公開ファイルの分が抜けて数字が合わなくなるため。
//
// ★ storage に実体を増やす経路は、必ず fileQuotaBlocker を通すこと。
//   api/project-files（upload-url / register / restore-version）、api/dav-open（PUT）、
//   api/google（export-office）。1つでも抜けると、そこが上限の抜け道になる。
import type { SupabaseClient } from "@supabase/supabase-js";

export type FileQuota = { usedBytes: number; limitBytes: number | null };

const GB = 1024 * 1024 * 1024;

/**
 * 組織全体の使用量と上限。上限なしなら limitBytes は null。
 * 関数が無い（SQL 未適用）ときは null を返す＝呼び出し側は「上限なし」として扱う。
 * 容量の確認ができないだけでアップロードを全部止めてしまわないため。
 */
export async function getFileQuota(sb: SupabaseClient, projectId: string): Promise<FileQuota | null> {
  const { data, error } = await sb.rpc("file_storage_quota", { p_project_id: projectId });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return {
    usedBytes: Number(row.used_bytes) || 0,
    limitBytes: row.limit_bytes == null ? null : Number(row.limit_bytes),
  };
}

/**
 * addBytes を足すと上限を超えるなら、利用者に見せる理由を返す。超えないなら null。
 */
export async function fileQuotaBlocker(
  sb: SupabaseClient, projectId: string, addBytes: number,
): Promise<string | null> {
  const quota = await getFileQuota(sb, projectId);
  if (!quota || quota.limitBytes === null) return null;
  if (quota.usedBytes + Math.max(0, addBytes) <= quota.limitBytes) return null;
  const limitGb = Number((quota.limitBytes / GB).toFixed(1));
  return `ファイルボックスの容量が上限（${limitGb} GB）を超えるため保存できません。不要なファイルを削除してから、もう一度お試しください`;
}
