// GitHubタブの表示可否（docs/github-integration-design.md 8-3）。
//
// ProjectSubNav は全プロジェクト画面で共有されているので、8つの呼び出し側それぞれに
// githubPermission を配線するのではなく、ここで解決して ProjectSubNav の中から使う。
// 解決の仕方は既存ページ（WikiPage 等）と同じで、
//   管理者/PM/owner → merge、それ以外は project_member_permissions の値（無ければ none）。
// ※ 実際の可否はサーバー側 (/api/github/*) で必ず再判定される。ここは表示の出し分け専用。
import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
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
      // スラッグでもIDでも開けるようにしている既存ページと同じ引き方
      const { data: bySlug } = await supabase!
        .from("projects").select("id, github_repo_full_name, github_enabled").eq("slug", projectSlug).limit(1);
      const p = bySlug?.[0]
        ?? (await supabase!.from("projects").select("id, github_repo_full_name, github_enabled").eq("id", projectSlug).maybeSingle()).data;
      if (!alive) return;
      if (!p) {
        setState({ level: undefined, linked: false, projectId: null, loading: false });
        return;
      }

      const linked = !!(p as any).github_enabled && !!(p as any).github_repo_full_name;
      const isManager = userRole === "owner" || userRole === "admin" || userRole === "project-manager";

      let level: GithubAccessLevel = "none";
      if (isManager) {
        level = "merge";
      } else {
        const { data: perm } = await supabase!
          .from("project_member_permissions").select("permissions")
          .eq("project_id", (p as any).id).eq("member_id", userId).maybeSingle();
        const perms = perm?.permissions as Partial<UserPermissions> | null;
        level = (perms?.githubPermission as GithubAccessLevel | undefined) ?? "none";
      }

      const value = { level, linked, projectId: (p as any).id as string };
      cache.set(key, { at: Date.now(), value });
      if (alive) setState({ ...value, loading: false });
    })();

    return () => { alive = false; };
  }, [projectSlug, userId, userRole]);

  return state;
}
