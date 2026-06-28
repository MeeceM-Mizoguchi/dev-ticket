import { useCallback, useRef } from "react";
import { useNavigate } from "react-router";
import { useTabs } from "@/app/contexts/TabContext";

// Mac/iPad のタブ対応ナビゲーションをまとめたフック。
// Web/iPhone(tabs===null)では従来どおり react-router の navigate にフォールバックする。
//
//  - linkProps(path): リンク/カードに展開する onClick / onAuxClick / onContextMenu /
//    タッチ長押し(iPad)ハンドラを返す。
//      * 通常クリック       → アクティブタブ内で遷移(Webは navigate)
//      * ⌘/Ctrl+クリック    → 新規タブ(Webは navigate)
//      * 中クリック         → 新規タブ
//      * 右クリック/長押し  → 新規タブ
export function useTabNavigation() {
  const tabs = useTabs();
  const navigate = useNavigate();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  const go = useCallback(
    (path: string) => {
      if (tabs) tabs.navigateActive(path);
      else navigate(path);
    },
    [tabs, navigate],
  );

  const openNewTab = useCallback(
    (path: string) => {
      if (tabs) tabs.openTab(path);
      else navigate(path);
    },
    [tabs, navigate],
  );

  const linkProps = useCallback(
    (path: string) => ({
      onClick: (e: { metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void }) => {
        if (longPressed.current) {
          // 長押し直後の click はキャンセル(誤遷移防止)
          longPressed.current = false;
          e.preventDefault?.();
          return;
        }
        if (e.metaKey || e.ctrlKey) openNewTab(path);
        else go(path);
      },
      onAuxClick: (e: { button: number; preventDefault?: () => void }) => {
        if (e.button === 1) {
          e.preventDefault?.();
          openNewTab(path);
        }
      },
      onContextMenu: tabs
        ? (e: { preventDefault?: () => void }) => {
            e.preventDefault?.();
            openNewTab(path);
          }
        : undefined,
      onTouchStart: tabs
        ? () => {
            longPressed.current = false;
            if (longPressTimer.current) clearTimeout(longPressTimer.current);
            longPressTimer.current = setTimeout(() => {
              longPressed.current = true;
              openNewTab(path);
            }, 500);
          }
        : undefined,
      onTouchEnd: tabs
        ? () => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }
        : undefined,
      onTouchMove: tabs
        ? () => {
            if (longPressTimer.current) {
              clearTimeout(longPressTimer.current);
              longPressTimer.current = null;
            }
          }
        : undefined,
    }),
    [tabs, go, openNewTab],
  );

  return { isTabMode: !!tabs, go, openNewTab, linkProps };
}
