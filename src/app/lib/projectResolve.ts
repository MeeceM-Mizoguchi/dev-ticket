// プロジェクトの引き当てを1箇所に集約する。
//
// これまで各ページが同じ 2 段引き（slug → id）を手書きしていたため、
// 「旧slugでも開けるようにする」変更が 13 箇所に散る状態だった。ここへ寄せて
// 3 段目（project_slug_aliases = 旧slug）を足す。
//
// 旧slugを救う理由:
//   プロジェクト識別子は URL の先頭セグメントに入る。変更すると、本文に貼られた
//   内部リンクだけでなく Slack通知・メール・GitHubのPR本文・ブックマークなど
//   「すでにアプリの外へ出たURL」も一斉に無効になる。DB を直しても書き換えられない
//   これらを救えるのは、旧slugを引き当てるこの経路だけ。
//
// 対応するテーブルは supabase/add_project_slug_aliases.sql。
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

/** 旧slugを記録するテーブル名（タイポ防止のため定数化） */
const ALIAS_TABLE = "project_slug_aliases";

export interface ProjectLookup<T> {
  /** 取得したプロジェクト行（呼び出し側が指定した columns のまま） */
  row: T;
  /** 現行の projects.slug。旧slugで着地したときのURL付け替えに使う */
  canonicalSlug: string;
  /** 旧slug（エイリアス）で引き当てたら true。呼び出し側はURLを正へ寄せる */
  viaAlias: boolean;
}

/**
 * canonicalSlug を返すために slug 列は必ず要る。
 * 呼び出し側が絞り込んだ columns を渡してきた場合だけ足す。
 */
function withSlugColumn(columns: string): string {
  const c = columns.trim();
  if (c === "*" || c.split(",").some(x => x.trim() === "slug")) return c;
  return `${c}, slug`;
}

/** 大文字小文字の食い違いを吸収するための候補（slugは英数大文字で保存している） */
function slugCandidates(value: string): string[] {
  const upper = value.toUpperCase();
  return value === upper ? [value] : [value, upper];
}

/**
 * URL の先頭セグメントからプロジェクトを引き当てる。
 *
 * 優先順位は「現行slug → プロジェクトID → 旧slug」。
 * 現行slugを先に見るので、旧slugが他プロジェクトの現行slugと衝突していても
 * 現役のほうが勝つ（アプリ側の重複チェックでそもそも衝突させない: findSlugConflict）。
 *
 * 見つからなければ null。呼び出し側はこれまでどおり 404 を出せばよい。
 */
export async function findProjectBySlug<T = any>(
  slugOrId: string,
  columns = "*",
): Promise<ProjectLookup<T> | null> {
  if (!isSupabaseEnabled || !supabase || !slugOrId) return null;
  const cols = withSlugColumn(columns);

  const { data: bySlug } = await supabase.from("projects").select(cols).eq("slug", slugOrId).limit(1);
  const direct = (bySlug?.[0] as any)
    ?? (await supabase.from("projects").select(cols).eq("id", slugOrId).maybeSingle()).data as any;
  if (direct) return { row: direct as T, canonicalSlug: direct.slug ?? "", viaAlias: false };

  // ここから先は「旧URLで来た」可能性の確認。1回の追加クエリで済ませる。
  const { data: aliases } = await supabase
    .from(ALIAS_TABLE)
    .select("project_id")
    .in("old_slug", slugCandidates(slugOrId))
    .limit(1);
  const projectId = (aliases?.[0] as { project_id?: string } | undefined)?.project_id;
  if (!projectId) return null;

  const { data: byAlias } = await supabase.from("projects").select(cols).eq("id", projectId).maybeSingle();
  if (!byAlias) return null; // 参照先が消えている（ON DELETE CASCADE の取りこぼし等）
  return { row: byAlias as T, canonicalSlug: (byAlias as any).slug ?? "", viaAlias: true };
}

/** findSlugConflict の戻り値。どちらに取られているかで文言を変えるため区別する。 */
export type SlugConflict = "project" | "alias";

/** 重複時にユーザーへ出す文言。3つの編集ダイアログで同じものを使う。 */
export const SLUG_CONFLICT_MESSAGE: Record<SlugConflict, string> = {
  project: "この組織内ですでに使用されている識別子です。別の名前を使用してください。",
  alias: "この識別子は別のプロジェクトが以前に使っていたため、使用できません（配布済みの古いURLがどちらを指すか決められなくなるため）。",
};

/**
 * その識別子が組織内ですでに使われているか。
 *
 * 現行slugだけでなく旧slugも「予約済み」として弾く。旧slugを別プロジェクトに
 * 渡してしまうと、配布済みの旧URLがどちらを指すのか決められなくなるため。
 */
export async function findSlugConflict(
  slug: string,
  orgId: string | null | undefined,
  excludeProjectId?: string,
): Promise<SlugConflict | null> {
  if (!isSupabaseEnabled || !supabase || !slug) return null;

  let projectQ = supabase.from("projects").select("id").eq("slug", slug);
  if (excludeProjectId) projectQ = projectQ.neq("id", excludeProjectId);
  projectQ = orgId ? projectQ.eq("organization_id", orgId) : projectQ.is("organization_id", null);
  const { data: project } = await projectQ.limit(1);
  if (project?.length) return "project";

  // 自分自身の旧slugへ戻すのは許す（トリガーがその行を消す: add_project_slug_aliases.sql）
  let aliasQ = supabase.from(ALIAS_TABLE).select("id, organization_id").in("old_slug", slugCandidates(slug));
  if (excludeProjectId) aliasQ = aliasQ.neq("project_id", excludeProjectId);
  const { data: alias } = await aliasQ.limit(100);
  // 組織の絞り込みはクエリではなくここで行う。organization_id が NULL の古い行
  // （組織を導入する前のプロジェクト）を取りこぼすと、その旧URLの行き先を
  // 別プロジェクトに奪われてしまうため、NULL は常に衝突扱いにする。
  // 他組織の行は RLS で見えないか、見えても organization_id が一致しないので素通りする。
  const taken = (alias ?? []).some((a: any) => !a.organization_id || a.organization_id === orgId);
  return taken ? "alias" : null;
}

// 旧識別子の「記録」はここには無い。projects の UPDATE に張ったトリガー
// （record_project_slug_alias / add_project_slug_aliases.sql）が行う。
// 識別子を更新する画面は3つあり、将来増えることもあるので、クライアント側で足すと
// どれか1つ漏らした時点で旧URLが失われる。DB側に置けば取りこぼしようがない。
