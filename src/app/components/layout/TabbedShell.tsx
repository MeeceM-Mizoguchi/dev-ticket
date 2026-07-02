import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TabPane } from "./TabPane";
import { useVersionCheck } from "@/app/hooks/useVersionCheck";
import { usePushNotifications } from "@/app/hooks/usePushNotifications";
import { TabProvider, useTabs } from "@/app/contexts/TabContext";

export function TabbedShell() {
  return (
    <TabProvider>
      <TabbedShellInner />
    </TabProvider>
  );
}

function TabbedShellInner() {
  useVersionCheck();
  usePushNotifications();
  const tabs = useTabs()!;
  const navigate = useNavigate();
  const tabbedOuterRef = useRef<HTMLDivElement>(null);

  // 🌟 鉄壁の画面ブレ防止（TabbedShell版）:
  // タブシェル環境下においても、裏で発生するあらゆる不意の突き上げスクロールを
  // 完全に検知・遮断し、画面の最上部位置をミリ単位で死守します。
  useEffect(() => {
    const el = tabbedOuterRef.current;
    if (!el) return;

    const resetTabbedScroll = () => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
      if (el.scrollLeft !== 0) el.scrollLeft = 0;
    };

    el.addEventListener("scroll", resetTabbedScroll, { passive: true });
    document.addEventListener("focusin", resetTabbedScroll, { passive: true });

    return () => {
      el.removeEventListener("scroll", resetTabbedScroll);
      document.removeEventListener("focusin", resetTabbedScroll);
    };
  }, []);

  useEffect(() => {
    tabs.setNavigate((path) => navigate(path));
  }, [navigate, tabs]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        tabs.openTab("/dashboard");
        return;
      }
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        tabs.closeTab(tabs.activeId);
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        const idx = Number(e.key) - 1;
        const target = tabs.tabs[idx];
        if (target) {
          e.preventDefault();
          tabs.activateTab(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tabs]);

  return (
    <div
      ref={tabbedOuterRef}
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
        <TabBar />
        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          {tabs.tabs.map((t) => (
            <TabPane key={t.id} tab={t} active={t.id === tabs.activeId} />
          ))}
        </div>
      </div>
    </div>
  );
}