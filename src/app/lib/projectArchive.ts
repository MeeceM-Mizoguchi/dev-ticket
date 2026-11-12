// BRU25-012 プロジェクトのアーカイブ（共通の判定）
//
// ・アーカイブは projects.archived_at / archived_by で持つ（supabase/add_project_archive.sql）。
//   ステータス（status）の値にはしない（手動設定OFFのプロジェクトはステータスが再計算されて戻るため）
// ・列が無い環境（SQL 未適用）でも動くよう、列を名指しせず select("*") で読み、
//   値が無ければ「アーカイブされていない」として扱う
// ・入れなくするのは画面とAPIの入口まで。DB の権限設定（RLS）は変えていない
import { findProjectBySlug } from "@/app/lib/projectResolve";

/** DB の行（select("*") の結果）がアーカイブ済みか。列が無ければ false */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isArchivedRow(row: any): boolean {
  return !!row?.archived_at;
}

/** アーカイブした日付（例: 2026/11/11）。日時が読めなければ空 */
export function formatArchivedDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export interface ProjectArchiveState {
  /** 見つからなかった・読めなかったときは null（判定せず、各画面の 404 などに任せる） */
  archived: { name: string; archivedAt: string; archivedBy: string | null } | null;
}

// プロジェクトの中で画面を移るたびに問い合わせて待たせないよう、結果を覚えておく。
// 覚えた結果はすぐに使い、裏で確かめ直す（ProjectArchiveGuard）。
const cache = new Map<string, ProjectArchiveState>();

export function getCachedProjectArchive(slugOrId: string): ProjectArchiveState | undefined {
  return cache.get(slugOrId);
}

/**
 * プロジェクト一覧で読んだ結果を覚えさせる。一覧からプロジェクトに入るとき、
 * 問い合わせを待たずに中の画面を出せるようにする。アーカイブ・戻したときも呼ぶ。
 */
export function rememberProjectArchive(projects: { id: string; slug?: string; name: string; archivedAt?: string | null; archivedBy?: string | null }[]): void {
  for (const p of projects) {
    const state: ProjectArchiveState = {
      archived: p.archivedAt ? { name: p.name, archivedAt: p.archivedAt, archivedBy: p.archivedBy ?? null } : null,
    };
    cache.set(p.id, state);
    if (p.slug) cache.set(p.slug, state);
  }
}

/** URL の先頭（slug・ID・旧slug）から、プロジェクトがアーカイブ済みかを調べる */
export async function fetchProjectArchive(slugOrId: string): Promise<ProjectArchiveState> {
  try {
    const found = await findProjectBySlug(slugOrId);
    const row = found?.row;
    const state: ProjectArchiveState = {
      archived: row && isArchivedRow(row)
        ? { name: String(row.name ?? ""), archivedAt: String(row.archived_at), archivedBy: row.archived_by ?? null }
        : null,
    };
    cache.set(slugOrId, state);
    return state;
  } catch {
    // 読めなければ止めない（今までどおり各画面が表示・判定する）
    return { archived: null };
  }
}
