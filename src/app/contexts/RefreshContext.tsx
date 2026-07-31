// アプリ内ソフト更新。ブラウザのフルリロード(location.reload)は WebRTC 通話を必ず切断するため、
// 共通ヘッダーの「更新」ボタンは代わりにこの仕組みを使う。
// refreshNonce を増やすと:
//   - ページ描画のサブツリー(Outlet / タブのルート)が key 変更で再マウントされ、各ページの
//     初期 fetch(useEffect)が再実行される = 通話以外の全データを再取得する。
//   - Topbar 自身は再マウントされないので、通知/お知らせの再読込は nonce を監視して行う。
// CallProvider はこのプロバイダより上位に常駐するため、更新しても通話は一切影響を受けない。
import { createContext, useContext, useCallback, useRef, useState, type ReactNode } from "react";

interface RefreshCtxType {
  refreshNonce: number;   // 増えるたびにページを再マウントして再取得する
  refreshing: boolean;    // 更新中(ボタンのスピナー表示用)
  refresh: () => void;    // ソフト更新を実行する
}

const RefreshContext = createContext<RefreshCtxType>({
  refreshNonce: 0, refreshing: false, refresh: () => {},
});

export function useRefresh() { return useContext(RefreshContext); }

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(() => {
    setRefreshing(true);
    setRefreshNonce((n) => n + 1);
    // 再取得の完了をグローバルに追えないため、スピナーは一定時間で止める(視覚フィードバック)。
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setRefreshing(false), 900);
  }, []);

  return (
    <RefreshContext.Provider value={{ refreshNonce, refreshing, refresh }}>
      {children}
    </RefreshContext.Provider>
  );
}
