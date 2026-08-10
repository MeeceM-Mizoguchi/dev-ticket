// ENHA2-032 タスク画面の選択欄（プルダウン）。
//
// ブラウザ標準の <select> はOSごとに見た目が変わり、開いたときだけ他の画面と
// 雰囲気が違うものが出てしまう。ここでは他のプルダウン（CustomSelect・ステータス）
// と同じ見た目のメニューを自前で出す。
//
// variant:
//   cell = 表のセル。「素の文字」のままで、マウスを乗せたときだけ ▼ を出す
//          （枠は出さない＝タイトル欄と同じ見た目、という表全体の約束に合わせる）
//   chip = 表の外に単独で置くフィルタ。枠つきで ▼ は出しっぱなし
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface PickerOption {
  value: string;
  label: string;
  /** 左に付ける丸の色（優先度など） */
  color?: string;
}

/** メニュー1件ぶんの高さ（見積り）。上に出すか下に出すかの判定に使う */
const ITEM_H = 32;
const MENU_MAX_H = 260;

export function PickerCell({
  width, value, options, onChange, disabled, title, placeholder = "—", align = "left", textStyle,
  variant = "cell",
}: {
  /** 省略すると中身に合わせて伸びる（フィルタなど） */
  width?: number;
  value: string;
  options: PickerOption[];
  onChange: (v: string) => void;
  disabled?: boolean;
  title?: string;
  /** 値が選択肢に無いときに出す文字 */
  placeholder?: string;
  align?: "left" | "center";
  /** 文字色など、セルごとの味付け */
  textStyle?: React.CSSProperties;
  /**
   * cell = 表のセル（枠なし・▼はホバー時）
   * chip = 単独で置くフィルタ（枠つき・▼は常時）
   */
  variant?: "cell" | "chip";
}) {
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const selected = options.find(o => o.value === value);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(options.length * ITEM_H + 8, MENU_MAX_H);
    const w = Math.max(r.width, 140);
    // 下に入りきらなければ上へ出す（最終行でも選択肢が見える）
    const up = window.innerHeight - r.bottom < h + 8 && r.top > h + 8;
    setPos(up
      ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: w }
      : { top: r.bottom + 4, left: r.left, width: w });
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onScroll = (e: Event) => {
      // メニューの中のスクロールでは閉じない
      const t = e.target;
      if (t instanceof Node && menuRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const chip = variant === "chip";

  return (
    <span className={chip ? undefined : "task-select"}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, width,
      }}>
      <button ref={btnRef} type="button" disabled={disabled} title={title}
        onClick={() => (open ? setPos(null) : place())}
        onKeyDown={e => { if (e.key === "Escape") setPos(null); }}
        style={{
          width: width ? "100%" : undefined,
          fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
          display: "inline-flex", alignItems: "center", gap: chip ? 6 : 4,
          justifyContent: align === "center" ? "center" : "flex-start",
          overflow: "hidden", whiteSpace: "nowrap",
          ...(chip
            ? {
              padding: "7px 10px", fontSize: 11.5, fontWeight: 600, color: "#6B6458",
              background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8,
            }
            : {
              padding: 0, paddingRight: 12, fontSize: 11, border: "none", background: "transparent",
              color: selected ? "#6B6458" : "#B7B1AA",
            }),
          ...textStyle,
        }}>
        {selected?.color && (
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: selected.color, flexShrink: 0 }} />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{selected?.label ?? placeholder}</span>
        {chip && <ChevronDown style={{ width: 11, height: 11, color: "#B0A9A4", flexShrink: 0, marginLeft: "auto" }} />}
      </button>

      {!chip && !disabled && (
        <ChevronDown className="task-select-arrow"
          style={{ width: 10, height: 10, position: "absolute", right: 0, pointerEvents: "none", color: "#A09790" }} />
      )}

      {pos && createPortal(
        <div ref={menuRef}
          style={{
            position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width,
            zIndex: 400, background: "#FFF", border: "1px solid rgba(26,23,20,0.1)",
            borderRadius: 9, boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
            maxHeight: MENU_MAX_H, overflowY: "auto", padding: 4,
          }}>
          {options.map(o => {
            const sel = o.value === value;
            return (
              <button key={o.value} type="button"
                onClick={() => { setPos(null); if (!sel) onChange(o.value); }}
                style={{
                  display: "flex", alignItems: "center", gap: 7, width: "100%",
                  padding: "7px 9px", border: "none", borderRadius: 6, cursor: "pointer",
                  background: sel ? "#ECFDF5" : "transparent", textAlign: "left" as const,
                }}
                onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = sel ? "#ECFDF5" : "transparent"; }}>
                {o.color && <span style={{ width: 7, height: 7, borderRadius: "50%", background: o.color, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: sel ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {o.label}
                </span>
                {sel && <Check style={{ width: 11, height: 11, color: "#059669", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </span>
  );
}
