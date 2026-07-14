import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { subscribeLinkItems } from "@/app/lib/linkSuggestSync";

// リンクサジェスト($ = wiki/バックログ/議事録、# = チケット、@ = メンバー)の
// 候補をプロジェクト単位で取得する共通フック。(BRU5-032)
//
// 以前は TicketDetailPanel と NewTicketDialog が同じクエリを個別に持ち、
// どちらも [projectId] 依存で1回だけ取得していたため、別タブで wiki 等を
// 作成しても画面をリロードするまで候補に出てこなかった。
//
// ここでは取得を集約したうえで、次の3つの契機で再取得する:
//   A. タブ復帰(visibilitychange / focus) … Web の別タブ・別端末での作成も拾える主軸
//   B. linkSuggestSync のローカル通知     … Mac/iPad のアプリ内タブ(同一ランタイム)へ即時反映
//   C. BroadcastChannel(B の中で処理)     … 同一オリジンの別ブラウザタブへ即時反映
//
// 候補は RichEditor の props としてそのまま渡せる形で返す。RichEditor は props を
// editor.storage へ同期しているだけなので、再取得した瞬間に $ 検索へ反映される。

export interface TicketSuggestion { wbs: string; title: string }
export interface ItemSuggestion { id: string; title: string }

export interface LinkSuggestions {
  tickets: TicketSuggestion[];
  backlogItems: ItemSuggestion[];
  wikiItems: ItemSuggestion[];
  minuteItems: ItemSuggestion[];
  /** projects.members(プロジェクト参加メンバー名) */
  members: string[];
  /** プロジェクト内のチケットに使われている接頭辞ラベル一覧 */
  prefixLabels: string[];
  /** 明示的に再取得する */
  refresh: () => void;
}

const EMPTY: {
  tickets: TicketSuggestion[]; backlogItems: ItemSuggestion[];
  wikiItems: ItemSuggestion[]; minuteItems: ItemSuggestion[];
  members: string[]; prefixLabels: string[];
} = { tickets: [], backlogItems: [], wikiItems: [], minuteItems: [], members: [], prefixLabels: [] };

// タブ復帰時に visibilitychange と focus が連続で発火するため、
// 同じ復帰で2回投げないよう最小間隔を設ける。
const REFETCH_MIN_INTERVAL_MS = 1000;

export function useLinkSuggestions(projectId: string | null | undefined): LinkSuggestions {
  const [data, setData] = useState(EMPTY);

  // 遅れて返ってきた古いレスポンスで新しい結果を上書きしないためのガード
  const runIdRef = useRef(0);
  const lastFetchAtRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!isSupabaseEnabled || !projectId) {
      setData(EMPTY);
      return;
    }
    const runId = ++runIdRef.current;
    lastFetchAtRef.current = Date.now();

    const ticketsPromise = (async () => {
      const { data: sprintData } = await supabase!.from("sprints").select("id").eq("project_id", projectId);
      if (!sprintData?.length) return { tickets: [] as TicketSuggestion[], prefixLabels: [] as string[] };
      const { data } = await supabase!.from("sprint_tickets")
        .select("wbs, title, prefixes")
        .in("sprint_id", sprintData.map((s: { id: string }) => s.id))
        .order("wbs");
      const rows = (data ?? []) as { wbs: string; title: string; prefixes?: string[] | null }[];
      return {
        tickets: rows.map(r => ({ wbs: r.wbs, title: r.title })),
        prefixLabels: [...new Set(rows.flatMap(r => r.prefixes ?? []))].sort(),
      };
    })();

    const [ticketResult, backlogRes, wikiRes, minuteRes, projectRes] = await Promise.all([
      ticketsPromise,
      supabase!.from("backlog_items").select("id, title").eq("project_id", projectId).order("id"),
      supabase!.from("wiki_pages").select("id, title").eq("project_id", projectId).eq("is_folder", false),
      supabase!.from("meeting_minutes").select("id, title").eq("project_id", projectId).order("meeting_date", { ascending: false }),
      supabase!.from("projects").select("members").eq("id", projectId).maybeSingle(),
    ]);

    if (runId !== runIdRef.current) return; // 追い越された古い結果は捨てる

    setData({
      tickets: ticketResult.tickets,
      prefixLabels: ticketResult.prefixLabels,
      backlogItems: (backlogRes.data ?? []) as ItemSuggestion[],
      wikiItems: (wikiRes.data ?? []) as ItemSuggestion[],
      minuteItems: (minuteRes.data ?? []) as ItemSuggestion[],
      members: ((projectRes.data?.members ?? []) as string[]),
    });
  }, [projectId]);

  // 初回 / プロジェクト切替
  useEffect(() => { fetchAll(); }, [fetchAll]);

  // B/C: 他タブ(アプリ内タブ・ブラウザ別タブ)での作成・改題・削除を即時反映
  useEffect(() => {
    if (!projectId) return;
    return subscribeLinkItems(projectId, () => { fetchAll(); });
  }, [projectId, fetchAll]);

  // A: タブ復帰時に再取得。別端末・別ユーザーの作成もここで拾える
  useEffect(() => {
    if (!projectId) return;
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastFetchAtRef.current < REFETCH_MIN_INTERVAL_MS) return;
      fetchAll();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => {
      document.removeEventListener("visibilitychange", onBack);
      window.removeEventListener("focus", onBack);
    };
  }, [projectId, fetchAll]);

  return { ...data, refresh: fetchAll };
}
