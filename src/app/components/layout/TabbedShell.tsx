import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { TabPane } from "./TabPane";
import { useVersionCheck } from "@/app/hooks/useVersionCheck";
import { usePushNotifications } from "@/app/hooks/usePushNotifications";
import { TabProvider, useTabs } from "@/app/contexts/TabContext";

// Mac/iPad 版のシェル。Sidebar と TabBar は全タブで共有し、
// ページ本体(Topbar + ルーティング)はタブごとの MemoryRouter で描画する。
// Web/iPhone では使わず、従来の AppShell をそのまま使う(App.tsx で分岐)。
export function TabbedShell() {
  return (
    <TabProvider>
      <TabbedShellInner />
    </TabProvider>
  );
}

function TabbedShellInner() {
  // バージョンチェック・プッシュ通知登録はアプリ全体で1回だけ
  // (各タブの Topbar では実行せず、ここでまとめて呼ぶ)。
  useVersionCheck();
  usePushNotifications();
  const tabs = useTabs()!;

  // ⌘T / ⌘W / ⌘1〜9 のキーボードショートカット(Phase4)。
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      // 新規タブ
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        tabs.openTab("/dashboard");
        return;
      }
      // タブを閉じる
      if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        tabs.closeTab(tabs.activeId);
        return;
      }
      // ⌘1〜9 で n 番目のタブへ
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
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "#F5F6F8",
        paddingTop: "var(--app-safe-top, env(safe-area-inset-top))",
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
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
