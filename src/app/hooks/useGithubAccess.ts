// GitHubタブの表示可否（docs/github-integration-design.md 8-3）。
//
// ProjectSubNav は全プロジェクト画面で共有されているので、8つの呼び出し側それぞれに
// githubPermission を配線するのではなく、ここで解決して ProjectSubNav の中から使う。
// 解決の順序はサーバー側 resolveGithubLevel と同じ:
//   owner → merge / ① 個別(project_member_permissions) → ② グループ → ③ ロール既定 → none。
// 他のページ権限と違い admin・PM を無条件に merge とはしない（BRU13-034）。
// 付与はアサイン計画の画面だけで行う決まりなので、ここで暗黙に配ると
// 「権限なし」と表示されているのに GitHub タブが出る、という食い違いになる。
// ※ 実際の可否はサーバー側 (/api/github/*) で必ず再判定される。ここは表示の出し分け専用。
import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import type { GithubAccessLevel, UserPermissions } from "@/app/types";

export interface GithubAccess {
  /** 解決済みの権限。未解決のうちは undefined（タブを出さない） */
  level: GithubAccessLevel | undefined;
  /** リポジトリが紐付いているか */
  linked: boolean;
  projectId: string | null;
  loading: boolean;
}

// 画面を移動するたびに毎回2クエリ投げないよう、スラッグ単位で短時間だけ覚えておく。
// 権限を変えた直後に反映されないと混乱するので、寿命は短め（60秒）にしている。
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; value: Omit<GithubAccess, "loading"> }>();

export function invalidateGithubAccessCache() { cache.clear(); }

/**
 * ① 個別 → ② グループ → ③ ロール既定 の順に、最初に見つかった値を採用する。
 * サーバー側 api/github/[resource].ts の resolveGithubLevel と同じ判定。
 */
async function resolveLevel(projectId: string, userId: string, role: string): Promise<GithubAccessLevel> {
  const { data: perm } = await supabase!
    .from("project_member_permissions").select("permissions")
    .eq("project_id", projectId).eq("member_id", userId).maybeSingle();
  const fromIndividual = (perm?.permissions as Partial<UserPermissions> | null)?.githubPermission as GithubAccessLevel | undefined;
  if (fromIndividual) return fromIndividual;

  const { data: memberships } = await supabase!
    .from("group_members").select("group_id").eq("member_id", userId);
  const groupIds = (memberships ?? []).map(m => (m as any).group_id);
  if (groupIds.length) {
    const { data: groups } = await supabase!
      .from("permission_groups").select("permissions").in("id", groupIds);
    // 複数グループに属している場合は強いほうを採用する（サーバー側と同じ）
    let best: GithubAccessLevel = "none";
    for (const g of groups ?? []) {
      const lv = (g as any).permissions?.githubPermission as GithubAccessLevel | undefined;
      if (lv === "merge") return "merge";
      if (lv === "view") best = "view";
    }
    if (best !== "none") return best;
  }

  const { data: roleRow } = await supabase!
    .from("roles").select("base_permissions").eq("name", role).maybeSingle();
  return ((roleRow?.base_permissions as any)?.githubPermission as GithubAccessLevel | undefined) ?? "none";
}

export function useGithubAccess(projectSlug: string | undefined): GithubAccess {
  const { userId, userRole } = useAuth();
  const [state, setState] = useState<GithubAccess>({ level: undefined, linked: false, projectId: null, loading: true });

  useEffect(() => {
    if (!projectSlug || !isSupabaseEnabled || !userId) {
      setState({ level: undefined, linked: false, projectId: null, loading: false });
      return;
    }

    const key = `${projectSlug}:${userId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) {
      setState({ ...hit.value, loading: false });
      return;
    }

    let alive = true;
    (async () => {
      // スラッグでもIDでも旧スラッグでも開けるようにしている既存ページと同じ引き方
      const p = (await findProjectBySlug(projectSlug, "id, github_repo_full_name, github_enabled"))?.row;
      if (!alive) return;
      if (!p) {
        setState({ level: undefined, linked: false, projectId: null, loading: false });
        return;
      }

      const linked = !!(p as any).github_enabled && !!(p as any).github_repo_full_name;

      const level = userRole === "owner"
        ? "merge" as GithubAccessLevel
        : await resolveLevel((p as any).id as string, userId, userRole);

      const value = { level, linked, projectId: (p as any).id as string };
      cache.set(key, { at: Date.now(), value });
      if (alive) setState({ ...value, loading: false });
    })();

    return () => { alive = false; };
  }, [projectSlug, userId, userRole]);

  return state;
}
