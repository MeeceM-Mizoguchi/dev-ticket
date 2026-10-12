// ENHA2-053 WBSの表のセルに置くプルダウン。
//
// ブラウザ標準の <select> は、開いたときの一覧がOSの見た目そのままで（Mac では半透明の
// ネイティブメニュー）、アプリの他のプルダウンと揃わない。色も反映できないので、
// ステータスの一覧なのに色が見えなかった。
//
// 共通の CustomSelect は入力欄用で高さ34pxあり、22pxの行には入らない。そこで見た目の決まり
// （白いパネル／角丸10／選択中は #ECFDF5＋緑のチェック）はそのままに、表の行の高さに
// 合わせたものをここに作る。一覧は親セルの overflow:hidden に切られないようポータルで出す。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";
import { isPlainEnter } from "@/app/lib/submitKey";
import { textColorOn } from "@/app/lib/wbsCalc";

export type WbsCellOption = { value: string; label: string; color?: string };

/** 一覧の最小幅。セルが狭くても選択肢が読めるようにする */
const MIN_PANEL_W = 150;
const PANEL_MAX_H = 260;
const ITEM_H = 28;

/** 色つきの選択肢は、その色のチップで見せる（色そのものが選ぶ手がかりなので） */
function OptionLabel({ opt }: { opt: WbsCellOption }) {
  if (!opt.color) return <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{opt.label}</span>;
  const onDark = textColorOn(opt.color) === "#FFFFFF";
  return (
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{
        display: "inline-flex", alignItems: "center", height: 18, padding: "0 7px", borderRadius: 4,
        fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
        background: opt.color, color: textColorOn(opt.color),
        boxShadow: `inset 0 0 0 1px ${onDark ? "rgba(255,255,255,0.28)" : "rgba(30,41,58,0.16)"}`,
      }}>{opt.label}</span>
    </span>
  );
}

export function WbsCellSelect({ value, options, onChange, style, align = "left", title, disabled }: {
  value: string;
  options: WbsCellOption[];
  onChange: (value: string) => void;
  /** 閉じているときのボタンの見た目（ステータスは色チップ、担当者は素の文字） */
  style?: CSSProperties;
  align?: "left" | "center";
  title?: string;
  disabled?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  /** キーボードで移動している位置。マウスで開いたときは選択中から始める */
  const [active, setActive] = useState(0);

  const open = pos !== null;
  const selectedIdx = Math.max(0, options.findIndex(o => o.value === value));
  const selected = options[selectedIdx];

  const close = () => setPos(null);

  const place = () => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.max(rect.width, MIN_PANEL_W);
    const h = Math.min(PANEL_MAX_H, options.length * ITEM_H + 8);
    // 下に入らなければ上へ逃がす
    const below = rect.bottom + 4 + h <= window.innerHeight - 8;
    setPos({
      top: below ? rect.bottom + 4 : Math.max(8, rect.top - 4 - h),
      left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
      width,
    });
  };

  const toggle = () => {
    if (open) { close(); return; }
    setActive(selectedIdx);
    place();
  };

  const choose = (v: string) => {
    close();
    if (v !== value) onChange(v);
    btnRef.current?.focus();
  };

  // 開いている間は、外を押す・スクロールする・画面の大きさが変わるで閉じる
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    const onScroll = (e: Event) => {
      // 一覧の中のスクロールで閉じない
      if (e.target instanceof Node && panelRef.current?.contains(e.target)) return;
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

  // キーボードで動かした先が一覧から出ていたら、見えるところまで送る
  useLayoutEffect(() => {
    if (!open) return;
    panelRef.current?.querySelectorAll("[data-opt]")[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape") { if (open) { e.stopPropagation(); close(); } return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { toggle(); return; }
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive(i => (i + d + options.length) % options.length);
      return;
    }
    // 変換確定のEnterで勝手に選ばれないよう、IMEガードを通してから見る
    if (isPlainEnter(e) || e.key === " ") {
      e.preventDefault();
      if (!open) { toggle(); return; }
      const opt = options[active];
      if (opt) choose(opt.value);
    }
  };

  return (
    <>
      <button ref={btnRef} type="button" disabled={disabled} title={title}
        onClick={toggle} onKeyDown={onKeyDown}
        aria-haspopup="listbox" aria-expanded={open}
        style={{
          width: "100%", height: 22, display: "flex", alignItems: "center", gap: 2,
          justifyContent: align === "center" ? "center" : "space-between",
          padding: "0 4px", fontSize: 12, border: "none", borderRadius: 4, outline: "none",
          background: "transparent", cursor: disabled ? "default" : "pointer", boxSizing: "border-box",
          ...style,
        }}>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...(align === "center" ? null : { flex: 1, textAlign: "left" }) }}>
          {selected?.label ?? ""}
        </span>
        {!disabled && <ChevronDown style={{ width: 11, height: 11, flexShrink: 0, opacity: 0.55 }} />}
      </button>

      {pos && createPortal(
        <div ref={panelRef} role="listbox"
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 9999,
            maxHeight: PANEL_MAX_H, overflowY: "auto", padding: 4,
            background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.12)", borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}>
          {options.map((opt, i) => {
            const isSel = opt.value === value;
            return (
              <button key={opt.value} type="button" data-opt role="option" aria-selected={isSel}
                onClick={() => choose(opt.value)} onMouseEnter={() => setActive(i)}
                style={{
                  width: "100%", height: ITEM_H, display: "flex", alignItems: "center", gap: 8,
                  padding: "0 8px", fontSize: 12, fontWeight: 500, color: "#1A1714", textAlign: "left",
                  background: isSel ? "#ECFDF5" : i === active ? "#F4F5F6" : "transparent",
                  border: "none", borderRadius: 6, cursor: "pointer",
                }}>
                <OptionLabel opt={opt} />
                {isSel && <Check style={{ width: 12, height: 12, color: "#059669", flexShrink: 0 }} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
