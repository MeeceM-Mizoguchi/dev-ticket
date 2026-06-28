import { createContext, useContext, useState, useRef, useCallback, useEffect, type ReactNode } from "react";

// アプリ内タブ(Mac/iPad版のみ)の状態管理。
// 各タブは TabPane 内の MemoryRouter で独立した履歴を持つため、
// ここでは「どんなタブが何枚あり、どれがアクティブか」と、
// アクティブタブの MemoryRouter へナビゲーションを橋渡しする仕組みのみを持つ。

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
  /** アクティブタブの中で遷移する(MemoryRouter へ橋渡し) */
  navigateActive: (path: string) => void;
  /** 各 TabPane が自分の現在地を報告して見出し・復元パスを最新化する */
  setTabMeta: (id: string, meta: { path: string }) => void;
  /** TabPane 内の useNavigate を登録/解除(クロスルーター遷移用) */
  registerNavigator: (id: string, fn: NavFn) => void;
  unregisterNavigator: (id: string) => void;
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

/** アクティブタブ内で遷移。タブモードでなければ false を返す(呼び出し側でフォールバック)。 */
export function navigateInActiveTab(path: string): boolean {
  if (globalActiveNav) {
    globalActiveNav(path);
    return true;
  }
  return false;
}

/** アクティブタブの現在パス。タブモードでなければ null。 */
export function getActiveTabPath(): string | null {
  return globalActivePath;
}

// 同時に開けるタブの上限(複数 MemoryRouter 常時マウントの負荷対策)。
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
  const navigators = useRef<Map<string, NavFn>>(new Map());

  const makeTab = useCallback((path: string): Tab => {
    idCounter.current += 1;
    const id = `tab-${idCounter.current}`;
    return { id, title: titleForPath(path), path };
  }, []);

  const initial = useRef<Tab | null>(null);
  if (initial.current === null) initial.current = makeTab("/dashboard");

  const [tabs, setTabs] = useState<Tab[]>([initial.current]);
  const [activeId, setActiveId] = useState<string>(initial.current.id);

  const openTab = useCallback((path: string) => {
    setTabs((prev) => {
      if (prev.length >= MAX_TABS) return prev; // 上限超過時は開かない
      const tab = makeTab(path);
      setActiveId(tab.id);
      return [...prev, tab];
    });
  }, [makeTab]);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev; // 最後の1枚は閉じない
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      navigators.current.delete(id);
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
    setActiveId((curActive) => {
      const nav = navigators.current.get(curActive);
      if (nav) nav(path);
      return curActive;
    });
  }, []);

  const setTabMeta = useCallback((id: string, meta: { path: string }) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, path: meta.path, title: titleForPath(meta.path) } : t,
      ),
    );
  }, []);

  const registerNavigator = useCallback((id: string, fn: NavFn) => {
    navigators.current.set(id, fn);
  }, []);
  const unregisterNavigator = useCallback((id: string) => {
    navigators.current.delete(id);
  }, []);

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
    registerNavigator,
    unregisterNavigator,
  };

  return <TabContext.Provider value={value}>{children}</TabContext.Provider>;
}
