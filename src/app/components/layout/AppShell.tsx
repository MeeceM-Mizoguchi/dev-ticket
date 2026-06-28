import { Navigate, Outlet } from "react-router";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useVersionCheck } from "@/app/hooks/useVersionCheck";
import { usePushNotifications } from "@/app/hooks/usePushNotifications";

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
  return <AppShell />;
}
