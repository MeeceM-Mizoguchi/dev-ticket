import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TabbedShell } from "./TabbedShell";
import { useVersionCheck } from "@/app/hooks/useVersionCheck";
import { usePushNotifications } from "@/app/hooks/usePushNotifications";
import { isNativeTabletApp } from "@/app/lib/platform";
import { CallProvider } from "@/app/contexts/CallContext";
import { CallLayer } from "@/app/components/call/CallLayer";

export function AppShell() {
  useVersionCheck();
  usePushNotifications();
  
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
        <main style={{ flex: 1, overflow: "auto", position: "relative" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function ProtectedShell() {
  if (sessionStorage.getItem("isLoggedIn") !== "true") return <Navigate to="/login" replace />;
  return (
    <CallProvider>
      {isNativeTabletApp() ? <TabbedShell /> : <AppShell />}
      <CallLayer />
    </CallProvider>
  );
}