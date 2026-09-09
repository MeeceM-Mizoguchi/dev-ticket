// GitHubタブの表示可否と、操作ごとの権限（docs/github-integration-design.md 8-3）。
//
// ProjectSubNav は全プロジェクト画面で共有されているので、8つの呼び出し側それぞれに
// GitHub権限を配線するのではなく、ここで解決して ProjectSubNav の中から使う。
// 解決の順序はサーバー側 resolveGithubPerms と同じ:
//   owner → 全権 / ① 個別(project_member_permissions) → ② グループ → ③ ロール既定 → none。
// 他のページ権限と違い admin・PM を無条件に許可とはしない（BRU13-034）。
// 付与はアサイン計画の画面だけで行う決まりなので、ここで暗黙に配ると
// 「権限なし」と表示されているのに GitHub タブが出る、という食い違いになる。
// ※ 実際の可否はサーバー側 (/api/github/*) で必ず再判定される。ここは表示の出し分け専用。
import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import {
  FULL_GITHUB_PERMS, NO_GITHUB_PERMS, canViewGithub, githubPermsFrom, strongerGithubPerms, toLegacyGithubLevel,
} from "@/app/lib/githubPerms";
import type { GithubAccessLevel, GithubPerms } from "@/app/types";

export interface GithubAccess {
  /**
   * 解決済みの権限を1段階に畳んだもの。未解決のうちは undefined（タブを出さない）。
   * 既存の呼び出し側との互換のために残してある。新しい判定は perms を見ること
   */
  level: GithubAccessLevel | undefined;
  /** 操作ごとの権限（BRU13-054）。未解決のうちは undefined */
  perms: GithubPerms | undefined;
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
 * サーバー側 api/github/[resource].ts の resolveGithubPerms と同じ判定。
 *
 * 「その階層に書かれていたら、そこで確定させる」のが要点。軸ごとに別々の階層から
 * 拾ってしまうと、個別で明示的に外した権限がグループ経由で復活する。
 */
async function resolvePerms(projectId: string, userId: string, role: string): Promise<GithubPerms> {
  const { data: perm } = await supabase!
    .from("project_member_permissions").select("permissions")
    .eq("project_id", projectId).eq("member_id", userId).maybeSingle();
  const fromIndividual = githubPermsFrom(perm?.permissions);
  if (fromIndividual) return fromIndividual;

  const { data: memberships } = await supabase!
    .from("group_members").select("group_id").eq("member_id", userId);
  const groupIds = (memberships ?? []).map(m => (m as any).group_id);
  if (groupIds.length) {
    const { data: groups } = await supabase!
      .from("permission_groups").select("permissions").in("id", groupIds);
    // 複数グループに属している場合は軸ごとに強いほうを採用する（サーバー側と同じ）
    let best: GithubPerms | null = null;
    for (const g of groups ?? []) {
      const p = githubPermsFrom((g as any).permissions);
      if (p) best = best ? strongerGithubPerms(best, p) : p;
    }
    if (best && canViewGithub(best)) return best;
  }

  const { data: roleRow } = await supabase!
    .from("roles").select("base_permissions").eq("name", role).maybeSingle();
  return githubPermsFrom(roleRow?.base_permissions) ?? { ...NO_GITHUB_PERMS };
}

export function useGithubAccess(projectSlug: string | undefined): GithubAccess {
  const { userId, userRole } = useAuth();
  const [state, setState] = useState<GithubAccess>({
    level: undefined, perms: undefined, linked: false, projectId: null, loading: true,
  });

  useEffect(() => {
    if (!projectSlug || !isSupabaseEnabled || !userId) {
      setState({ level: undefined, perms: undefined, linked: false, projectId: null, loading: false });
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
        setState({ level: undefined, perms: undefined, linked: false, projectId: null, loading: false });
        return;
      }

      const linked = !!(p as any).github_enabled && !!(p as any).github_repo_full_name;

      // owner だけは自分で自分を締め出せると詰むため常に全権
      const perms = userRole === "owner"
        ? { ...FULL_GITHUB_PERMS }
        : await resolvePerms((p as any).id as string, userId, userRole);

      const value = {
        level: toLegacyGithubLevel(perms), perms, linked, projectId: (p as any).id as string,
      };
      cache.set(key, { at: Date.now(), value });
      if (alive) setState({ ...value, loading: false });
    })();

    return () => { alive = false; };
  }, [projectSlug, userId, userRole]);

  return state;
}
