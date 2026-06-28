import { Navigate, Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { TabbedShell } from "./TabbedShell";
import { useVersionCheck } from "@/app/hooks/useVersionCheck";
import { usePushNotifications } from "@/app/hooks/usePushNotifications";
import { isNativeTabletApp } from "@/app/lib/platform";

export function AppShell() {
  useVersionCheck();
  usePushNotifications();
  return (
    <div style={{ display:"flex", height:"100vh", overflow:"hidden", background:"#F5F6F8", paddingTop:"var(--app-safe-top, env(safe-area-inset-top))" }}>
      <Sidebar />
      <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
        <Topbar />
        <main style={{ flex:1, overflow:"auto" }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function ProtectedShell() {
  if (sessionStorage.getItem("isLoggedIn") !== "true") return <Navigate to="/login" replace />;
  // Mac/iPad 版のみタブUIを使う。Web/iPhone は従来どおり。
  if (isNativeTabletApp()) return <TabbedShell />;
  return <AppShell />;
}
