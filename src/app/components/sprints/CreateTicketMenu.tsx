// 「新規チケット」ボタンの下に出す作成メニュー。
//
// 以前は「一括作成」ボタン側のメニュー（表で作成 / MDファイルから作成）だったが、
// スプリント帯のボタンが増えすぎたため、チケットの作り方を全部ここへ集約した。
// 「一括作成」ボタンは廃止し、この中の1項目になっている。
//
// プランや権限で使えない項目は非表示にせず、理由を出してグレー表示する
// （開発者にも手段の存在が伝わり、管理者に依頼できるようにするため）。
// ボタン自体を無効化するのは、プランのチケット数上限に達したとき＝4項目すべてが
// 使えないときだけ。呼び出し側（各ビュー）で判定している。
import { useEffect, useLayoutEffect, useRef, useState, type ElementType } from "react";
import { createPortal } from "react-dom";
import { Ticket, TableProperties, FileText, KeyRound } from "lucide-react";
import { escStack } from "@/app/lib/escStack";

/** メニューから選べる作成方法 */
export type CreateTicketMode = "single" | "md" | "table" | "api";

/** 一括作成ダイアログ側のモード（SprintPage の onBulkCreate と対になっている） */
export type BulkCreateMode = "table" | "md";

/** モード → 無効化の理由。値が入っている項目はグレー表示になり、選べない */
export type CreateTicketDisabled = Partial<Record<CreateTicketMode, string>>;

const MENU_W = 288;

const ITEMS: { mode: CreateTicketMode; icon: ElementType; label: string; hint: string; color: string; bg: string }[] = [
  { mode: "single", icon: Ticket, label: "チケット作成", hint: "1件ずつ入力して登録する", color: "#7C3AED", bg: "#F5F3FF" },
  { mode: "md", icon: FileText, label: "MDファイルから取り込み", hint: "AIが書いたMDを取り込んで一括登録", color: "#0284C7", bg: "#F0F9FF" },
  { mode: "table", icon: TableProperties, label: "一括作成", hint: "表に直接入力してまとめて登録", color: "#7C3AED", bg: "#F5F3FF" },
  { mode: "api", icon: KeyRound, label: "API連携", hint: "AIやCIから直接登録できるようにする", color: "#059669", bg: "#ECFDF5" },
];

/**
 * ボタン側は矩形（getBoundingClientRect）を渡すだけでよく、見た目は各ビューの既存ボタンのまま。
 */
export function CreateTicketMenu({ anchorRect, disabled, onSelect, onClose }: {
  anchorRect: DOMRect;
  disabled?: CreateTicketDisabled;
  onSelect: (mode: CreateTicketMode) => void;
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
      {ITEMS.map(({ mode, icon: Icon, label, hint, color, bg }, i) => {
        const reason = disabled?.[mode];
        const isDisabled = !!reason;
        return (
          <div key={mode}>
            {i > 0 && <div style={{ height: 1, background: "rgba(26,23,20,0.06)", margin: "3px 8px" }} />}
            <button
              type="button"
              disabled={isDisabled}
              title={reason}
              onClick={() => { if (!isDisabled) { onSelect(mode); onClose(); } }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "9px 10px", border: "none", borderRadius: 9, background: "transparent",
                cursor: isDisabled ? "not-allowed" : "pointer", textAlign: "left", transition: "background 0.12s",
                opacity: isDisabled ? 0.55 : 1,
              }}
              onMouseEnter={e => { if (!isDisabled) (e.currentTarget as HTMLElement).style.background = "#F7F6F4"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
            >
              <span style={{
                width: 30, height: 30, borderRadius: 8, background: isDisabled ? "#F3F4F6" : bg, flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Icon style={{ width: 15, height: 15, color: isDisabled ? "#9CA3AF" : color }} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: isDisabled ? "#9CA3AF" : "#1A1714" }}>
                  {label}
                  {isDisabled && <span style={{ marginLeft: 6, fontSize: 10 }}>🔒</span>}
                </span>
                <span style={{ display: "block", fontSize: 10.5, color: isDisabled ? "#B0A9A4" : "#9E9690", marginTop: 1 }}>
                  {reason ?? hint}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

/**
 * 4つのビューで同じ無効化ルールを使うためのヘルパー。
 *
 * ・プランで一括作成がOFF → MD取り込み／一括作成／API連携が使えない
 *   （APIからの作成も同じ機能とみなす。api/v1/[resource].ts でも同じ判定をしている）
 * ・管理者以外 → API連携だけ使えない
 * ・「チケット作成」は常に有効。ボタン自体がチケット数上限で無効化されるため、
 *   ここまで来ている＝1件は作れる状態。
 */
export function buildCreateTicketDisabled(opts: {
  featureBulkCreate: boolean;
  canManageApiKeys: boolean;
}): CreateTicketDisabled {
  const disabled: CreateTicketDisabled = {};
  if (!opts.featureBulkCreate) {
    disabled.md = "現在のプランではご利用できません";
    disabled.table = "現在のプランではご利用できません";
    disabled.api = "現在のプランではご利用できません";
  } else if (!opts.canManageApiKeys) {
    disabled.api = "管理者のみ設定できます";
  }
  return disabled;
}

/**
 * 各ビューでメニューの開閉状態を持つための小さなフック。
 * ボタンの onClick で open(sprintId, e.currentTarget) を呼ぶだけでよい。
 */
export function useCreateTicketMenu() {
  const [menu, setMenu] = useState<{ sprintId: string; rect: DOMRect } | null>(null);
  return {
    menu,
    open: (sprintId: string, el: HTMLElement) => setMenu({ sprintId, rect: el.getBoundingClientRect() }),
    close: () => setMenu(null),
  };
}
