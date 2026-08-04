import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TableProperties, FileText } from "lucide-react";
import { escStack } from "@/app/lib/escStack";

export type BulkCreateMode = "table" | "md";

const MENU_W = 268;

const ITEMS: { mode: BulkCreateMode; icon: typeof TableProperties; label: string; hint: string; color: string; bg: string }[] = [
  { mode: "table", icon: TableProperties, label: "表で作成", hint: "スプレッドシートに直接入力する", color: "#7C3AED", bg: "#F5F3FF" },
  { mode: "md", icon: FileText, label: "MDファイルから作成", hint: "AIが書いたMDを取り込んで一括登録", color: "#0284C7", bg: "#F0F9FF" },
];

/**
 * 「一括作成」ボタンの下に出す小メニュー。
 * ボタン側は矩形（getBoundingClientRect）を渡すだけでよく、見た目は各ビューの既存ボタンのまま。
 */
export function BulkCreateMenu({ anchorRect, onSelect, onClose }: {
  anchorRect: DOMRect;
  onSelect: (mode: BulkCreateMode) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>(() => ({
    top: anchorRect.bottom + 6,
    left: anchorRect.left,
  }));

  // 画面外にはみ出す場合は、上へ反転／内側へ寄せる
  useLayoutEffect(() => {
    const h = panelRef.current?.offsetHeight ?? 0;
    const below = anchorRect.bottom + 6;
    const flip = below + h > window.innerHeight - 8 && anchorRect.top - h - 6 > 8;
    setPos({
      top: flip ? anchorRect.top - h - 6 : below,
      left: Math.min(Math.max(8, anchorRect.left), window.innerWidth - MENU_W - 8),
    });
  }, [anchorRect]);

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    // 開いた直後の同一クリックで閉じないよう、次のフレームから監視する
    const id = requestAnimationFrame(() => document.addEventListener("mousedown", handleDown));
    const close = () => onClose();
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("mousedown", handleDown);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={panelRef}
      onClick={e => e.stopPropagation()}
      style={{
        position: "fixed", top: pos.top, left: pos.left, width: MENU_W, zIndex: 400,
        background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 12,
        boxShadow: "0 12px 36px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)",
        padding: 5, overflow: "hidden",
      }}
    >
      {ITEMS.map(({ mode, icon: Icon, label, hint, color, bg }) => (
        <button
          key={mode}
          type="button"
          onClick={() => { onSelect(mode); onClose(); }}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 10,
            padding: "9px 10px", border: "none", borderRadius: 9, background: "transparent",
            cursor: "pointer", textAlign: "left", transition: "background 0.12s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F7F6F4"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <span style={{
            width: 30, height: 30, borderRadius: 8, background: bg, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Icon style={{ width: 15, height: 15, color }} />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1A1714" }}>{label}</span>
            <span style={{ display: "block", fontSize: 10.5, color: "#9E9690", marginTop: 1 }}>{hint}</span>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
}

/**
 * 各ビューでメニューの開閉状態を持つための小さなフック。
 * ボタンの onClick で open(sprintId, e.currentTarget) を呼ぶだけでよい。
 */
export function useBulkCreateMenu() {
  const [menu, setMenu] = useState<{ sprintId: string; rect: DOMRect } | null>(null);
  return {
    menu,
    open: (sprintId: string, el: HTMLElement) => setMenu({ sprintId, rect: el.getBoundingClientRect() }),
    close: () => setMenu(null),
  };
}
