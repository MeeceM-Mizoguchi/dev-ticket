import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react";

// アプリ内タブ(Mac/iPad版のみ)の状態管理。
//
// react-router 7 は Router の入れ子を禁止するため、タブごとに MemoryRouter は
// 作れない。代わりに単一の BrowserRouter を使い、
//   - アクティブタブ … 実ルーターの現在地で描画(遷移が効く)
//   - 非アクティブタブ … <Routes location> でパスを固定して keep-alive(状態保持)
// とする。タブ切替時は「アクティブタブの保存パス」へ実ルーターを navigate する。
// よってナビゲーションは TabPane ごとではなく、単一の navigate を共有する。

export type Tab = { id: string; title: string; path: string };

type NavFn = (path: string) => void;

type TabContextValue = {
  tabs: Tab[];
  activeId: string;
  activePath: string;
  /** 新規タブを開いてアクティブ化する */
  openTab: (path: string) => void;
  /** タブを閉じる(最後の1枚は閉じない) */
  closeTab: (id: string) => void;
  /** 指定タブをアクティブ化する */
  activateTab: (id: string) => void;
  /** アクティブタブの中で遷移する(共有 navigate を呼ぶ) */
  navigateActive: (path: string) => void;
  /** アクティブタブが現在地を報告して見出し・復元パスを最新化する */
  setTabMeta: (id: string, meta: { path: string }) => void;
  /** TabbedShell が単一 BrowserRouter の navigate を登録する */
  setNavigate: (fn: NavFn) => void;
};

const TabContext = createContext<TabContextValue | null>(null);

// Web/iPhone では Provider が存在しないため null を返す。
// Sidebar 等は戻り値が null かどうかでタブモードを判定する。
export function useTabs(): TabContextValue | null {
  return useContext(TabContext);
}

// --- TabProvider の外側に描画されるグローバル UI 用のブリッジ ---
// 例: LinkPreviewPanel は App.tsx 直下(TabProvider の外)にあり useTabs() が
// null になるため、モジュールレベルの参照経由でアクティブタブを操作する。
let globalActiveNav: NavFn | null = null;
let globalActivePath: string | null = null;
// Web(非タブ)環境で SPA 遷移するための BrowserRouter navigate ブリッジ。
// これが登録されていれば window.location.href によるフルリロードを回避でき、
// 通話中に画面遷移しても CallProvider がアンマウントされず通話が維持される。
let globalWebNav: NavFn | null = null;

/** Web(非タブ)環境の BrowserRouter navigate を登録する(App 直下の WebNavBridge が呼ぶ)。 */
export function setWebNavigate(fn: NavFn | null): void {
  globalWebNav = fn;
}

/**
 * アプリ内 SPA 遷移を行う。タブモードならアクティブタブ内で、Web なら BrowserRouter で遷移する。
 * どちらのルーターも未登録のときだけ false を返す(呼び出し側が window.location へフォールバック)。
 */
export function navigateInActiveTab(path: string): boolean {
  if (globalActiveNav) {
    globalActiveNav(path);
    return true;
  }
  if (globalWebNav) {
    globalWebNav(path);
    return true;
  }
  return false;
}

/** アクティブタブの現在パス。タブモードでなければ null。 */
export function getActiveTabPath(): string | null {
  return globalActivePath;
}

// 同時に開けるタブの上限(全タブ常時マウントの負荷対策)。
export const MAX_TABS = 8;

const PAGE_TITLES: Record<string, string> = {
  "/dashboard": "ダッシュ",
  "/projects": "PJ一覧",
  "/my-actions": "アクション",
  "/release-notes": "リリースノート",
  "/reports": "レポート管理",
  "/clients": "クライアント",
  "/members": "メンバー",
  "/permissions": "アサイン計画",
  "/roles": "ロール設定",
  "/admin-settings": "通知管理",
  "/announcement-settings": "お知らせ設定",
  "/organization": "組織管理",
  "/bug-reports": "バグ報告",
};

// パスから人間可読なタブ見出しを算出する。
export function titleForPath(path: string): string {
  const clean = (path.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  if (clean === "/" || clean === "") return "ダッシュ";
  if (PAGE_TITLES[clean]) return PAGE_TITLES[clean];
  const seg = clean.split("/").filter(Boolean);
  const slug = seg[0];
  if (seg.length >= 2) {
    const sub = seg[1];
    if (sub === "backlog") return `${slug} / バックログ`;
    if (sub === "wiki") return `${slug} / Wiki`;
    if (sub === "minutes") return `${slug} / 議事録`;
    return `${slug} / ${sub}`;
  }
  return slug;
}

export function TabProvider({ children }: { children: ReactNode }) {
  const idCounter = useRef(0);
  const navRef = useRef<NavFn | null>(null);

  const makeTab = useCallback((path: string): Tab => {
    idCounter.current += 1;
    const id = `tab-${idCounter.current}`;
    return { id, title: titleForPath(path), path };
  }, []);

  const initial = useRef<Tab | null>(null);
  if (initial.current === null) initial.current = makeTab("/dashboard");

  const [tabs, setTabs] = useState<Tab[]>([initial.current]);
  const [activeId, setActiveId] = useState<string>(initial.current.id);

  // 最新の tabs を effect から参照するための ref。
  const tabsRef = useRef<Tab[]>(tabs);
  tabsRef.current = tabs;

  const setNavigate = useCallback((fn: NavFn) => {
    navRef.current = fn;
  }, []);

  const openTab = useCallback((path: string) => {
    setTabs((prev) => {
      if (prev.length >= MAX_TABS) return prev; // 上限超過時は開かない
      const tab = makeTab(path);
      setActiveId(tab.id); // activeId 変化 → 同期 effect が navigate(path) する
      return [...prev, tab];
    });
  }, [makeTab]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // 最後の1枚は閉じない
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      // 閉じたのがアクティブタブなら、隣(右優先、なければ左)へ移す
      setActiveId((curActive) => {
        if (curActive !== id) return curActive;
        const neighbor = next[idx] ?? next[idx - 1] ?? next[0];
        return neighbor.id;
      });
      return next;
    });
  }, []);

  const activateTab = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const navigateActive = useCallback((path: string) => {
    navRef.current?.(path);
  }, []);

  const setTabMeta = useCallback((id: string, meta: { path: string }) => {
    setTabs((prev) => {
      const t = prev.find((x) => x.id === id);
      if (!t || t.path === meta.path) return prev; // 変化なしなら据え置き
      return prev.map((x) =>
        x.id === id ? { ...x, path: meta.path, title: titleForPath(meta.path) } : x,
      );
    });
  }, []);

  // アクティブタブが変わったら、そのタブの保存パスへ実ルーターを移動する。
  // (在タブ内の遷移は activeId を変えないのでここは発火せず、二重 navigate しない)
  useEffect(() => {
    const t = tabsRef.current.find((x) => x.id === activeId);
    if (t) navRef.current?.(t.path);
  }, [activeId]);

  const activePath = tabs.find((t) => t.id === activeId)?.path ?? "/dashboard";

  // TabProvider 外のグローバル UI(LinkPreviewPanel 等)から参照できるよう
  // モジュールレベルのブリッジを最新化する。
  useEffect(() => {
    globalActiveNav = navigateActive;
    return () => {
      if (globalActiveNav === navigateActive) globalActiveNav = null;
    };
  }, [navigateActive]);
  useEffect(() => {
    globalActivePath = activePath;
    return () => {
      if (globalActivePath === activePath) globalActivePath = null;
    };
  }, [activePath]);

  const value: TabContextValue = {
    tabs,
    activeId,
    activePath,
    openTab,
    closeTab,
    activateTab,
    navigateActive,
    setTabMeta,
    setNavigate,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
