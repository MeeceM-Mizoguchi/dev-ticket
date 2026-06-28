import { useEffect, useRef } from "react";
import { MemoryRouter, useNavigate, useLocation } from "react-router";
import { Topbar } from "./Topbar";
import { ProtectedRoutes } from "./AppRoutes";
import { useTabs, type Tab } from "@/app/contexts/TabContext";

// 各タブの MemoryRouter 内に置き、
//  1. useNavigate を TabContext へ登録(サイドバー等からのクロスルーター遷移用)
//  2. 現在地を TabContext へ報告(タブ見出し・復元パスの同期)
// を行う。表示には影響しない。
function TabRouterBridge({ tabId }: { tabId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = useTabs();

  useEffect(() => {
    if (!tabs) return;
    tabs.registerNavigator(tabId, (path) => navigate(path));
    return () => tabs.unregisterNavigator(tabId);
  }, [tabId, navigate, tabs]);

  useEffect(() => {
    if (!tabs) return;
    tabs.setTabMeta(tabId, { path: location.pathname + location.search });
  }, [tabId, location.pathname, location.search, tabs]);

  return null;
}

// 1タブ分のペイン。非アクティブでもアンマウントせず(keep-alive)、
// visibility/inert で隠すことでスクロール位置・入力中フォーム・
// Handsontable のグリッド状態などを保持する。
// 親(TabbedShell)は position:relative のコンテナを用意する前提。
export function TabPane({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  // 非アクティブペインは inert にして、誤フォーカス・ESC/モーダルの
  // 誤発火を防ぐ(WKWebView は inert 対応。visibility:hidden でも操作不可)。
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active) el.removeAttribute("inert");
    else el.setAttribute("inert", "");
  }, [active]);

  return (
    <div
      ref={ref}
      aria-hidden={!active}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        visibility: active ? "visible" : "hidden",
        pointerEvents: active ? "auto" : "none",
        zIndex: active ? 1 : 0,
      }}
    >
      <MemoryRouter initialEntries={[tab.path]}>
        <TabRouterBridge tabId={tab.id} />
        <Topbar />
        <main style={{ flex: 1, overflow: "auto" }}>
          <ProtectedRoutes />
        </main>
      </MemoryRouter>
    </div>
  );
}
