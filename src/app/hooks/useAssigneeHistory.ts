// 一覧の担当者セルに「引き継いだ人ぜんぶ」を出すための履歴読み込み。
//
// 返るのは「2人以上が関わったチケット」だけ（ticketId → 古い順の担当者名）。
// 載っていないチケットは呼び出し側で今までどおり ticket.assignee を出せばよい。

import { useEffect, useState } from "react";
import { fetchAssigneeHistory } from "@/app/lib/handover";

export function useAssigneeHistory(ticketIds: string[]): Map<string, string[]> {
  const [history, setHistory] = useState<Map<string, string[]>>(new Map());

  // 配列は毎レンダー新しい参照になるので、中身をキーにして無駄な再取得を止める。
  // 一覧は10秒ポーリングで再描画されるため、参照で比較すると毎回叩きに行ってしまう
  const key = ticketIds.join(",");

  useEffect(() => {
    if (!key) { setHistory(new Map()); return; }
    let alive = true;
    // BUG-02/03: 取得中にセルを空にしない。取れたぶんだけ静かに差し替える
    fetchAssigneeHistory(key.split(",")).then(m => { if (alive) setHistory(m); });
    return () => { alive = false; };
  }, [key]);

  return history;
}
