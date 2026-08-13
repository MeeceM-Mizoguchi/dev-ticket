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
import { useCallback, useEffect, useRef, useState } from "react";
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

interface MenuPos { top?: number; bottom?: number; left: number; width: number }

/**
 * ボタンの下（入りきらなければ上）にメニューを出すための土台。
 * 1つだけ選ぶ PickerCell と、複数を選ぶ MultiPickerCell で同じ挙動を共有する。
 */
function useAnchoredMenu(itemCount: number) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const open = pos !== null;
  const close = useCallback(() => setPos(null), []);

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const h = Math.min(itemCount * ITEM_H + 8, MENU_MAX_H);
    const w = Math.max(r.width, 140);
    // 下に入りきらなければ上へ出す（最終行でも選択肢が見える）
    const up = window.innerHeight - r.bottom < h + 8 && r.top > h + 8;
    setPos(up
      ? { bottom: window.innerHeight - r.top + 4, left: r.left, width: w }
      : { top: r.bottom + 4, left: r.left, width: w });
  };

  useEffect(() => {
    if (!open) return;
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
  }, [open, close]);

  return { pos, open, btnRef, menuRef, close, toggle: () => (open ? close() : place()) };
}

/** メニューの外枠。中身（行）は呼び出し側が描く */
function MenuPortal({ pos, menuRef, children }: {
  pos: MenuPos;
  menuRef: React.RefObject<HTMLDivElement>;
  children: React.ReactNode;
}) {
  return createPortal(
    <div ref={menuRef}
      style={{
        position: "fixed", top: pos.top, bottom: pos.bottom, left: pos.left, width: pos.width,
        zIndex: 400, background: "#FFF", border: "1px solid rgba(26,23,20,0.1)",
        borderRadius: 9, boxShadow: "0 10px 28px rgba(0,0,0,0.14)",
        maxHeight: MENU_MAX_H, overflowY: "auto", padding: 4,
      }}>
      {children}
    </div>,
    document.body,
  );
}

/** 自前のチェックボックス（標準の input はOSごとに見た目が変わるため） */
function CheckBox({ on }: { on: boolean }) {
  return (
    <span style={{
      width: 14, height: 14, borderRadius: 4, flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      background: on ? "#059669" : "#FFF",
      border: on ? "none" : "1.5px solid rgba(26,23,20,0.18)",
    }}>
      {on && <Check style={{ width: 10, height: 10, color: "#FFF" }} />}
    </span>
  );
}

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
  const { pos, open, btnRef, menuRef, close, toggle } = useAnchoredMenu(options.length);
  const selected = options.find(o => o.value === value);

  const chip = variant === "chip";

  return (
    <span className={chip ? undefined : "task-select"}
      style={{
        position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, width,
      }}>
      <button ref={btnRef} type="button" disabled={disabled} title={title}
        onClick={toggle}
        onKeyDown={e => { if (e.key === "Escape") close(); }}
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

      {pos && (
        <MenuPortal pos={pos} menuRef={menuRef}>
          {options.map(o => {
            const sel = o.value === value;
            return (
              <button key={o.value} type="button"
                onClick={() => { close(); if (!sel) onChange(o.value); }}
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
        </MenuPortal>
      )}
    </span>
  );
}

/**
 * 複数まとめて選ぶプルダウン（BRU11-046）。
 *
 * 共有相手のように「一度に何人も選びたい」欄のためのもの。
 * PickerCell と違い、行を押しても閉じない（続けてチェックできる）。
 * 閉じるのは外を押したときと Esc。
 */
export function MultiPickerCell({
  width, values, options, onChange, disabled, title, emptyLabel = "選択してください",
  /** 「すべて選択／解除」の行を出すか */
  showSelectAll = true,
}: {
  width?: number;
  values: string[];
  options: PickerOption[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  title?: string;
  emptyLabel?: string;
  showSelectAll?: boolean;
}) {
  const { pos, menuRef, btnRef, close, toggle } = useAnchoredMenu(options.length + (showSelectAll ? 1 : 0));
  const picked = new Set(values);
  const allOn = options.length > 0 && options.every(o => picked.has(o.value));

  // 選んだ順ではなく選択肢の並び順で出す（押すたびに文字が入れ替わらないように）
  const label = values.length === 0
    ? emptyLabel
    : values.length === 1
      ? (options.find(o => o.value === values[0])?.label ?? emptyLabel)
      : `${options.filter(o => picked.has(o.value))[0]?.label ?? ""} 他${values.length - 1}人`;

  const toggleValue = (v: string) => {
    onChange(picked.has(v) ? values.filter(x => x !== v) : [...values, v]);
  };

  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", flexShrink: 0, width }}>
      <button ref={btnRef} type="button" disabled={disabled} title={title}
        onClick={toggle}
        onKeyDown={e => { if (e.key === "Escape") close(); }}
        style={{
          width: width ? "100%" : undefined, fontFamily: "inherit",
          cursor: disabled ? "default" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 6,
          overflow: "hidden", whiteSpace: "nowrap",
          padding: "7px 10px", fontSize: 11.5, fontWeight: 600,
          color: values.length > 0 ? "#1A1714" : "#6B6458",
          background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 8,
        }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        {values.length > 1 && (
          <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#ECFDF5", border: "1px solid #A7F3D0", borderRadius: 99, padding: "0 6px", flexShrink: 0, fontFamily: "var(--font-mono)" }}>
            {values.length}
          </span>
        )}
        <ChevronDown style={{ width: 11, height: 11, color: "#B0A9A4", flexShrink: 0, marginLeft: "auto" }} />
      </button>

      {pos && (
        <MenuPortal pos={pos} menuRef={menuRef}>
          {showSelectAll && options.length > 1 && (
            <button type="button"
              onClick={() => onChange(allOn ? [] : options.map(o => o.value))}
              style={{
                display: "flex", alignItems: "center", gap: 7, width: "100%",
                padding: "7px 9px", border: "none", borderBottom: "1px solid rgba(26,23,20,0.06)",
                borderRadius: 6, cursor: "pointer", background: "transparent", textAlign: "left" as const,
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <CheckBox on={allOn} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458" }}>
                {allOn ? "すべて解除" : "すべて選択"}
              </span>
            </button>
          )}
          {options.map(o => {
            const on = picked.has(o.value);
            return (
              <button key={o.value} type="button" onClick={() => toggleValue(o.value)}
                style={{
                  display: "flex", alignItems: "center", gap: 7, width: "100%",
                  padding: "7px 9px", border: "none", borderRadius: 6, cursor: "pointer",
                  background: on ? "#ECFDF5" : "transparent", textAlign: "left" as const,
                }}
                onMouseEnter={e => { if (!on) (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = on ? "#ECFDF5" : "transparent"; }}>
                <CheckBox on={on} />
                {o.color && <span style={{ width: 7, height: 7, borderRadius: "50%", background: o.color, flexShrink: 0 }} />}
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 600, color: on ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {o.label}
                </span>
              </button>
            );
          })}
        </MenuPortal>
      )}
    </span>
  );
}
