import { useCallback, useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";

// 自分のGoogleアカウントの紐づけ状態（BRU17-028）。
//
// 右上のメニューと、Googleファイルを開く前の確認（useGoogleLinkGate）が同じものを見る。
// 片方で紐づけ・再読込したらもう片方にも反映されるよう、状態はモジュールで1つだけ持つ。
//
// profiles.google_email は連携の成立時にサーバーが書く表示用のミラー
// （トークン本体は service_role しか読めない google_drive_tokens にある）。

export interface GoogleAccountLink {
  /** null = まだ読み込めていない */
  linked: boolean | null;
  googleEmail: string | null;
  /** 自分の組織でGoogleドライブ連携が有効か。null = まだ読み込めていない */
  driveEnabled: boolean | null;
}

const EMPTY: GoogleAccountLink = { linked: null, googleEmail: null, driveEnabled: null };

let current: GoogleAccountLink = EMPTY;
let loadedFor = "";
let inflight: Promise<void> | null = null;
const listeners = new Set<(v: GoogleAccountLink) => void>();

function publish(next: GoogleAccountLink) {
  current = next;
  for (const l of listeners) l(next);
}

async function load(userId: string, orgId: string | null, force: boolean): Promise<void> {
  const key = `${userId}:${orgId ?? ""}`;
  if (!force && loadedFor === key) return;
  if (!force && inflight) return inflight;
  // 別のユーザーに切り替わったときは、前の人の状態を見せない
  if (loadedFor !== key) publish(EMPTY);
  loadedFor = key;

  inflight = (async () => {
    const [{ data: me }, org] = await Promise.all([
      supabase!.from("profiles").select("google_email").eq("id", userId).maybeSingle(),
      orgId
        ? supabase!.from("organizations").select("google_drive_mode").eq("id", orgId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const email = (me?.google_email as string | null | undefined) ?? null;
    publish({
      linked: !!email,
      googleEmail: email,
      driveEnabled: (org.data?.google_drive_mode ?? "off") !== "off",
    });
  })()
    // 読めなかったときは次の呼び出しで取り直せるようにしておく
    .catch(e => { loadedFor = ""; throw e; })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useGoogleAccountLink(): GoogleAccountLink & { reload: () => Promise<void> } {
  const { userId, userOrgId } = useAuth();
  const [state, setState] = useState<GoogleAccountLink>(current);

  useEffect(() => {
    listeners.add(setState);
    setState(current);
    return () => { listeners.delete(setState); };
  }, []);

  useEffect(() => {
    if (!isSupabaseEnabled || !userId) return;
    void load(userId, userOrgId, false).catch(e => console.warn("[googleAccountLink] load failed", e));
  }, [userId, userOrgId]);

  const reload = useCallback(async () => {
    if (!isSupabaseEnabled || !userId) return;
    await load(userId, userOrgId, true);
  }, [userId, userOrgId]);

  return { ...state, reload };
}
