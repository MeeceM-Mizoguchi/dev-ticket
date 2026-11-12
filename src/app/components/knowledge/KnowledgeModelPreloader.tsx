// BRU25-011 ナレッジノートの検索用モデル（約266MB）を、ログイン後に裏で読み込み始める。
//
// 以前はナレッジノートの画面を開いた時点で読み込みを始めていたため、初回は画面を開いても
// しばらく検索が使えず「検索の準備中… ◯%」のまま待たされた。
// ログイン後に必ず通る ProtectedShell に1つだけ置き、どの画面にいても先に読み込みを始める。
//
// ・プランを読み終えてから判定する（読み終える前の plan は仮の「全機能 true」のため）
// ・ナレッジノートが使えないプラン（featureKnowledgeAi が false）では始めない
// ・ログイン直後は各画面のデータ取得と通信がぶつかるので、数秒待ち、ブラウザが空いたときに始める
// ・読み込みは Web Worker の中で行うので、画面の操作は妨げない（embed.ts）
// ・KnowledgePage 側の warmup() も保険として残している。何度呼んでも読み込みは1回だけ

import { useEffect, useRef } from "react";
import { usePlan } from "@/app/contexts/PlanContext";
import { warmup } from "@/app/lib/knowledge/embed";

/** ログイン後、先読みを始めるまで待つ時間 */
const START_DELAY_MS = 3000;
/** ブラウザが空くのを待つ上限（ずっと忙しくても、これを過ぎたら始める） */
const IDLE_TIMEOUT_MS = 5000;

export function KnowledgeModelPreloader() {
  const { plan, planLoaded } = usePlan();
  const startedRef = useRef(false);
  const enabled = planLoaded && plan.featureKnowledgeAi;

  useEffect(() => {
    if (!enabled || startedRef.current) return;

    let idleId: number | null = null;
    const start = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      warmup();
    };
    const timer = window.setTimeout(() => {
      const w = window as Window & {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      };
      if (typeof w.requestIdleCallback === "function") {
        idleId = w.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
      } else {
        // Safari（iPad を含む）は requestIdleCallback が無い
        start();
      }
    }, START_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      const w = window as Window & { cancelIdleCallback?: (id: number) => void };
      if (idleId !== null && typeof w.cancelIdleCallback === "function") w.cancelIdleCallback(idleId);
    };
  }, [enabled]);

  return null;
}
