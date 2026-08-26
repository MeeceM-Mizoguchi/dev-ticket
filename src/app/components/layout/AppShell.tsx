import { useEffect, useRef } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TabbedShell } from "./TabbedShell";
import { usePushNotifications } from "@/app/hooks/usePushNotifications";
import { useAutoLogout } from "@/app/hooks/useAutoLogout";
import { isNativeTabletApp } from "@/app/lib/platform";
import { CallProvider } from "@/app/contexts/CallContext";
import { RefreshProvider, useRefresh } from "@/app/contexts/RefreshContext";
import { CallLayer } from "@/app/components/call/CallLayer";
import { MlSetupGate } from "@/app/components/members/MlSetupGate";
import { clearRedirect, rememberRedirect } from "@/app/lib/authRedirect";

export function AppShell() {
  // バージョン監視(useVersionCheck)は App.tsx 直下で常時稼働させている。
  // ここに置くとログイン画面では止まってしまうため（BRU11-045）。
  usePushNotifications();
  const { refreshNonce } = useRefresh();
  
  const outerContainerRef = useRef<HTMLDivElement>(null);

  // 🌟 鉄壁の画面ブレ防止（AppShell版）:
  // チケット開閉時のエディタや一覧の自動スクロール・フォーカス暴走を検知し、
  // アプリ最外枠のスクロール位置（scrollTop）を強制的に「0」へ一瞬で引き戻します。
  useEffect(() => {
    const el = outerContainerRef.current;
    if (!el) return;

    const resetOuterScroll = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };

    el.addEventListener("scroll", resetOuterScroll, { passive: true });
    document.addEventListener("focusin", resetOuterScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", resetOuterScroll);
      document.removeEventListener("focusin", resetOuterScroll);
    };
  }, []);

  return (
    <div 
      ref={outerContainerRef}
      style={{ 
        display: "flex", 
        height: "100vh", 
        width: "100vw",
        overflow: "hidden", 
        background: "#F5F6F8", 
        paddingTop: "var(--app-safe-top, env(safe-area-inset-top))",
        position: "relative"
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
        <Topbar />
        {/* scrollbarGutter: スクロールバーの幅(theme.css で 5px)を常に確保する。
            確保しないと「スクロールが出る画面」だけ中身が5px左へ寄り、
            画面を移るたびに上部のタブ・ボタン類の位置がずれて見える。 */}
        <main style={{ flex: 1, overflow: "auto", position: "relative", scrollbarGutter: "stable" }}>
          {/* refreshNonce を key にして、ソフト更新時にページを再マウント→初期fetchを再実行する。
              display:contents でレイアウトには影響を与えない。 */}
          <div key={refreshNonce} style={{ display: "contents" }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export function ProtectedShell() {
  // 自動ログアウト(ENHA2-027)。Web/ネイティブ両シェルの親で常時マウントする
  // (早期returnより前にフックを呼ぶ。未ログイン時は内部で no-op)。
  useAutoLogout();

  // 共有されたURL(チケット/ホワイトボードのオブジェクトリンク等)を未ログインで開いた時、
  // ログイン後にそのURLへ戻れるよう退避しておく。isLoggedIn は sessionStorage＝タブ単位なので、
  // 「リンクを新しいタブで開く」は必ずここを通る。
  const location = useLocation();
  const loggedIn = sessionStorage.getItem("isLoggedIn") === "true";
  useEffect(() => { if (loggedIn) clearRedirect(); }, [loggedIn]);

  if (!loggedIn) {
    rememberRedirect(location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  return (
    <CallProvider>
      <RefreshProvider>
        {isNativeTabletApp() ? <TabbedShell /> : <AppShell />}
      </RefreshProvider>
      <CallLayer />
      {/* ENHA2-034 学習の初回セットアップ。ログイン直後・どの画面にいても走る。
          メンバー管理権限を持つ人以外には何も起きない（内部で判定）。 */}
      <MlSetupGate />
    </CallProvider>
  );
}