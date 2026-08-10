// ENHA2-032 タスクの分類（複数の要素）を打ち込む欄。
//
// 1つの自由入力ではなく「要素を足していく」形にしてある。打つたびに過去の分類が
// 候補に出て、選べば同じ綴りが付く（表記ゆれをこれ以上増やさないため）。
// 候補に無いものは、そのまま Enter で新しい要素として足せる。
//
// 表の行の中でも使うので、候補の一覧は body へポータルで出す
// （表の外枠が overflow:hidden なので、行の中に描くと切れてしまう）。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { normalizeCategories } from "@/app/lib/taskService";

const MENU_ITEM_H = 30;
const MENU_MAX = 8;

export function TaskCategoryField({
  values, options, disabled, placeholder = "分類を追加", autoFocus, wrap = true,
  onChange, onEnterWhenEmpty, onEscape,
}: {
  values: string[];
  /** 候補（既に使われている分類） */
  options: string[];
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * 要素を折り返すか。広い場所では true。
   * 表の狭いセルでは false にして1行のまま横スクロールさせる
   * （折り返すと行の高さが伸びて、下の行ごと押し下げてしまうため）
   */
  wrap?: boolean;
  onChange: (next: string[]) => void;
  /** 入力欄が空のまま Enter を押したとき（追加行では行そのものの確定に使う） */
  onEnterWhenEmpty?: () => void;
  /** Esc。行の中でのその場編集を閉じるのに使う */
  onEscape?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase();
    const rest = options.filter(o => !values.includes(o));
    const hit = q ? rest.filter(o => o.toLowerCase().includes(q)) : rest;
    return hit.slice(0, MENU_MAX);
  }, [draft, options, values]);

  /**
   * 候補の下に出す一言。
   * 「候補にも無い＝新しく作る」のか「もう付いている」のかが分からないと、
   * 打ったのに何も起きない（空の箱だけ出る）ように見えてしまう。
   */
  const hint = useMemo(() => {
    const v = draft.trim();
    if (!v) return "";
    if (values.includes(v)) return `「${v}」は追加済みです`;
    if (!options.includes(v)) return `Enter で「${v}」を新しく追加`;
    return "";
  }, [draft, values, options]);

  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  useEffect(() => { setActive(0); }, [draft]);

  // 候補の位置は実測して当てる。チップが増えて欄の高さが変わるので毎回測り直す
  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const h = Math.min(suggestions.length, MENU_MAX) * MENU_ITEM_H + 8;
      const up = window.innerHeight - r.bottom < h + 8 && r.top > h + 8;
      setPos({ top: up ? r.top - h - 4 : r.bottom + 4, left: r.left, width: Math.max(r.width, 180) });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, suggestions.length, values.length]);

  const add = (v: string) => {
    const next = normalizeCategories([...values, v]);
    setDraft("");
    if (next.length !== values.length) onChange(next);
    inputRef.current?.focus();
  };

  const removeAt = (i: number) => onChange(values.filter((_, n) => n !== i));

  const commitDraft = () => {
    const v = draft.trim();
    if (v) add(v);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;   // 変換中の Enter は確定であって追加ではない
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && suggestions[active] && draft.trim()) { add(suggestions[active]); return; }
      if (draft.trim()) { commitDraft(); return; }
      onEnterWhenEmpty?.();
      return;
    }
    if (e.key === "," || e.key === "、") { e.preventDefault(); commitDraft(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, suggestions.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); return; }
    if (e.key === "Backspace" && !draft && values.length > 0) { e.preventDefault(); removeAt(values.length - 1); return; }
    if (e.key === "Escape") {
      if (open) { setOpen(false); return; }
      setDraft("");
      onEscape?.();
    }
  };

  return (
    <div ref={wrapRef}
      onClick={() => { if (!disabled) { inputRef.current?.focus(); setOpen(true); } }}
      style={{
        display: "flex", alignItems: "center", gap: 3,
        flexWrap: wrap ? "wrap" : "nowrap",
        overflowX: wrap ? "visible" : "auto",
        width: "100%", minWidth: 0, minHeight: 20, cursor: disabled ? "default" : "text",
      }}>
      {values.map((v, i) => (
        <span key={v} title={v}
          style={{
            display: "inline-flex", alignItems: "center", gap: 3, maxWidth: "100%", flexShrink: 0,
            fontSize: 10, fontWeight: 600, color: "#6B6458", background: "#F4F5F6",
            border: "1px solid rgba(26,23,20,0.07)", borderRadius: 5, padding: "1px 4px 1px 6px",
          }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
          {!disabled && (
            <button type="button" title={`${v} を外す`}
              onClick={e => { e.stopPropagation(); removeAt(i); }}
              style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "flex", color: "#A09790" }}>
              <X style={{ width: 9, height: 9 }} />
            </button>
          )}
        </span>
      ))}

      {!disabled && (
        <input ref={inputRef} value={draft}
          onChange={e => { setDraft(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          // 打ちかけの文字は捨てずに要素にしてから閉じる（＋ を押したときに消えないように）
          onBlur={e => {
            if (menuRef.current?.contains(e.relatedTarget as Node)) return;
            setOpen(false);
            commitDraft();
          }}
          onKeyDown={onKeyDown}
          placeholder={values.length === 0 ? placeholder : ""}
          style={{
            flex: 1, minWidth: 56, fontSize: 11, color: "#1A1714", fontFamily: "inherit",
            background: "transparent", border: "none", outline: "none", padding: "2px 0",
          }} />
      )}

      {/* 出すものが何も無いときは開かない（空の白い箱だけが出てしまうため） */}
      {open && pos && (suggestions.length > 0 || hint) && createPortal(
        <div ref={menuRef}
          // mousedown で input の blur が走る前に握りつぶす（候補を押した瞬間に閉じないように）
          onMouseDown={e => e.preventDefault()}
          style={{
            position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 400,
            background: "#FFF", border: "1px solid rgba(26,23,20,0.1)", borderRadius: 9,
            boxShadow: "0 10px 28px rgba(0,0,0,0.14)", overflow: "hidden", padding: 4,
          }}>
          {suggestions.map((s, i) => (
            <button key={s} type="button"
              onClick={() => add(s)}
              onMouseEnter={() => setActive(i)}
              style={{
                display: "block", width: "100%", textAlign: "left" as const,
                padding: "6px 8px", border: "none", borderRadius: 6, cursor: "pointer",
                background: i === active ? "#F0FDF4" : "transparent",
                fontSize: 11.5, fontWeight: 600, color: "#1A1714",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
              {s}
            </button>
          ))}
          {hint && (
            // 区切り線は候補の下に敷くもの。候補が無いときに引くと線だけが浮く
            <div style={{
              fontSize: 10, color: "#A09790", padding: "4px 8px 2px",
              borderTop: suggestions.length > 0 ? "1px solid rgba(26,23,20,0.06)" : "none",
              marginTop: suggestions.length > 0 ? 2 : 0,
            }}>
              {hint}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
