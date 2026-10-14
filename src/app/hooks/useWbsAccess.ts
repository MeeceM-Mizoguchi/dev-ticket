// ENHA2-053 WBSタブの表示可否（権限なし／閲覧のみ／編集可）。
//
// ProjectSubNav は全プロジェクト画面で共有されているので、呼び出し側それぞれに
// WBS権限を配線するのではなく、ここで解決して ProjectSubNav の中から使う
// （useGithubAccess と同じ理由。配線漏れがあると、タブが画面ごとに出たり消えたりする）。
import { useEffect, useState } from "react";
import { isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { loadWbsPermission } from "@/app/lib/wbsService";
import type { AccessLevel } from "@/app/types";

// 画面を移動するたびに毎回クエリを投げないよう、スラッグ単位で短時間だけ覚えておく。
// 権限を変えた直後に反映されないと混乱するので、寿命は短め（60秒）にしている。
const CACHE_TTL = 60_000;
const cache = new Map<string, { at: number; value: AccessLevel }>();

export function invalidateWbsAccessCache() { cache.clear(); }

/** 未解決のうちは undefined（タブを出さない） */
export function useWbsAccess(projectSlug: string | undefined): AccessLevel | undefined {
  const { userId, userRole } = useAuth();
  const isAdminRole = userRole === "owner" || userRole === "admin";
  const [level, setLevel] = useState<AccessLevel | undefined>(isAdminRole ? "edit" : undefined);

  useEffect(() => {
    if (isAdminRole) { setLevel("edit"); return; }
    if (!projectSlug || !isSupabaseEnabled || !userId) { setLevel(undefined); return; }

    const key = `${projectSlug}:${userId}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL) { setLevel(hit.value); return; }

    let cancelled = false;
    (async () => {
      const found = await findProjectBySlug<{ id: string }>(projectSlug, "id");
      const value = found ? await loadWbsPermission(found.row.id, userId, false) : "none";
      cache.set(key, { at: Date.now(), value });
      if (!cancelled) setLevel(value);
    })().catch(() => { if (!cancelled) setLevel(undefined); });
    return () => { cancelled = true; };
  }, [projectSlug, userId, isAdminRole]);

  return level;
}
