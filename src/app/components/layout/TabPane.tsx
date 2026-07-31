import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { Topbar } from "./Topbar";
import { ProtectedRoutes } from "./AppRoutes";
import { useTabs, type Tab } from "@/app/contexts/TabContext";
import { useRefresh } from "@/app/contexts/RefreshContext";

// アクティブタブ専用。実ルーターの現在地を TabContext へ報告し、
// タブ見出し・復元パスを最新化する(非アクティブタブは固定パスのため不要)。
function ActiveLocationReporter({ tabId }: { tabId: string }) {
  const location = useLocation();
  const tabs = useTabs();
  useEffect(() => {
    tabs?.setTabMeta(tabId, { path: location.pathname + location.search });
  }, [tabId, location.pathname, location.search, tabs]);
  return null;
}

// 1タブ分のペイン。全タブを常時マウント(keep-alive)し、
// 非アクティブは visibility/inert で隠してスクロール位置・入力中フォーム・
// Handsontable のグリッド状態などを保持する。
// アクティブタブは実ルーターの現在地、非アクティブタブは固定パスで描画する。
// 親(TabbedShell)は position:relative のコンテナを用意する前提。
export function TabPane({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const { refreshNonce } = useRefresh();

  // 非アクティブペインは inert にして、誤フォーカス・ESC/モーダルの
  // 誤発火を防ぐ(visibility:hidden でも操作不可)。
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
      {active && <ActiveLocationReporter tabId={tab.id} />}
      <Topbar />
      <main style={{ flex: 1, overflow: "auto" }}>
        {/* アクティブは location 未指定(=実ルーター現在地)、非アクティブは固定。
            refreshNonce を key にしてソフト更新時に再マウント→各ページの初期fetchを再実行する。 */}
        <div key={refreshNonce} style={{ display: "contents" }}>
          <ProtectedRoutes location={active ? undefined : tab.path} />
        </div>
      </main>
    </div>
  );
}
