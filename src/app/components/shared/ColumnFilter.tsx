import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

// 表の列見出し。押すと「昇順／降順／並び替えをクリア」と、その列の値のチェックボックス一覧が出る。
// スプリント一覧(SprintListView)とチケット一覧検索(TicketSearchResults)とWBSの表で同じものを使う。
// 開いているのはどの列か・絞り込みの中身は、呼び出し側が持つ。
//
// WBSの表向けの設定（指定しなければ今までどおり）:
//   sortable={false} … 並び替え（昇順・降順）を出さない
//   onDark           … 紺色の見出しの上に置くので、見出しの文字を白にする
//   portal           … 一覧を document.body に出す（見出しのセルが overflow で切る作りでも見えるように）。
//                      外を押す・一覧の外でスクロールする・画面の大きさが変わると閉じる

export interface ColumnFilterOption { value: string; label: string }

export function ColumnFilter<C extends string>({
  col, label, sortCol = "", sortDir = "asc", onSort, onClearSort,
  options, selected, onFilterChange,
  open, onToggle, onClose, alignRight,
  sortable = true, onDark = false, portal = false,
}: {
  col: C;
  label: string;
  sortCol?: C | "";
  sortDir?: "asc" | "desc";
  onSort?: (col: C, dir: "asc" | "desc") => void;
  onClearSort?: () => void;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onFilterChange: (s: Set<string>) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  alignRight?: boolean;
  sortable?: boolean;
  onDark?: boolean;
  portal?: boolean;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** portal のときの一覧の位置（見出しの下端に合わせる） */
  const [portalPos, setPortalPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useLayoutEffect(() => {
    if (!portal || !open) { setPortalPos(null); return; }
    const r = rootRef.current?.getBoundingClientRect();
    if (!r) return;
    // 右に入りきらないとき（一覧の最大幅 360px）は、見出しの右端に揃える
    const toRight = alignRight || r.left + 360 > window.innerWidth - 8;
    setPortalPos(toRight ? { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) } : { top: r.bottom + 6, left: Math.max(8, r.left) });
  }, [portal, open, alignRight]);

  // portal のときは、呼び出し側の「外を押したら閉じる」膜が届かないので、ここで閉じる
  useEffect(() => {
    if (!portal || !open) return;
    const inside = (t: EventTarget | null) =>
      t instanceof Node && (!!panelRef.current?.contains(t) || !!rootRef.current?.contains(t));
    const onDown = (e: MouseEvent) => { if (!inside(e.target)) onClose(); };
    // 一覧の中のスクロールでは閉じない
    const onScroll = (e: Event) => { if (!(e.target instanceof Node && panelRef.current?.contains(e.target))) onClose(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [portal, open, onClose]);

  const isSorted = sortable && sortCol === col;
  const isFiltered = selected.size > 0;
  const active = isSorted || isFiltered;
  // 紺色の見出しの上では、緑の文字は読めないので白にする（絞り込み中の印は明るい緑）
  const labelColor = onDark ? "#FFFFFF" : active ? "#059669" : "#B0A9A4";
  const markColor = onDark ? "#6EE7B7" : "#059669";
  const chevronColor = onDark ? (active ? "#6EE7B7" : "rgba(255,255,255,0.7)") : active ? "#059669" : "#C9C4BB";

  const filteredOptions = options.filter(opt =>
    search === "" || opt.label.toLowerCase().includes(search.toLowerCase())
  );
  const allFilteredChecked = filteredOptions.length > 0 && filteredOptions.every(o => selected.has(o.value));
  const someFilteredChecked = !allFilteredChecked && filteredOptions.some(o => selected.has(o.value));

  const toggleAll = () => {
    if (filteredOptions.length === 0) return;
    if (allFilteredChecked) {
      const next = new Set(selected); filteredOptions.forEach(o => next.delete(o.value)); onFilterChange(next);
    } else {
      const next = new Set(selected); filteredOptions.forEach(o => next.add(o.value)); onFilterChange(next);
    }
  };

  const toggleOne = (value: string) => {
    const next = new Set(selected);
    next.has(value) ? next.delete(value) : next.add(value);
    onFilterChange(next);
  };

  const panelPlace: CSSProperties = portal
    ? { position: "fixed", top: portalPos?.top ?? 0, left: portalPos?.left ?? "auto", right: portalPos?.right ?? "auto", zIndex: 9999 }
    : { position: "absolute", top: "calc(100% + 6px)", left: alignRight ? "auto" : 0, right: alignRight ? 0 : "auto", zIndex: 200 };

  const panel = (
    <div ref={panelRef}
      onClick={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
      style={{
        ...panelPlace,
        background: "#fff", borderRadius: 10, border: "1px solid rgba(26,23,20,0.10)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: "6px", minWidth: 190, maxWidth: 360,
        // 見出しのセルの文字の設定（太字・中央寄せ・nowrap）を、body へ出した一覧に持ち込まない
        ...(portal ? { fontWeight: 400, textAlign: "left", whiteSpace: "normal" } : null),
      }}>
      {sortable && (
        <>
          <button onClick={() => { onSort?.(col, "asc"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
            background: isSorted && sortDir === "asc" ? "#ECFDF5" : "transparent",
            color: isSorted && sortDir === "asc" ? "#059669" : "#1A1714", transition: "background 0.1s",
          }}>↑ 昇順</button>
          <button onClick={() => { onSort?.(col, "desc"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
            background: isSorted && sortDir === "desc" ? "#ECFDF5" : "transparent",
            color: isSorted && sortDir === "desc" ? "#059669" : "#1A1714", transition: "background 0.1s",
          }}>↓ 降順</button>
          {isSorted && (
            <button onClick={() => { onClearSort?.(); onClose(); }} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
              borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11,
              background: "transparent", color: "#B0A9A4", textAlign: "left" as const,
            }}>並び替えをクリア</button>
          )}

          <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", margin: "4px 0" }} />
        </>
      )}

      <div style={{ padding: "2px 4px 4px" }}>
        <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
          onClick={e => e.stopPropagation()} placeholder="検索..."
          style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(26,23,20,0.15)", fontSize: 11, outline: "none", boxSizing: "border-box" as const, color: "#1A1714", background: "#FAFAF9" }} />
      </div>

      <button onClick={toggleAll} style={{
        display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
        borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
        background: "transparent", color: "#1A1714", textAlign: "left" as const,
      }}>
        <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: (allFilteredChecked || someFilteredChecked) ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: allFilteredChecked ? "#059669" : someFilteredChecked ? "#9CA3AF" : "transparent" }}>
          {allFilteredChecked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
          {someFilteredChecked && <span style={{ color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: 1 }}>−</span>}
        </div>
        すべて
      </button>

      <div style={{ maxHeight: 200, overflowY: "auto", overscrollBehavior: "contain" }}>
        {filteredOptions.length === 0 ? (
          <div style={{ padding: 8, textAlign: "center" as const, color: "#B0A9A4", fontSize: 11 }}>一致する項目がありません</div>
        ) : filteredOptions.map(opt => {
          const checked = selected.has(opt.value);
          return (
            <button key={opt.value} onClick={() => toggleOne(opt.value)} style={{
              display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "5px 8px",
              borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
              background: checked ? "#ECFDF5" : "transparent",
              color: checked ? "#059669" : "#1A1714", transition: "background 0.1s",
              whiteSpace: "normal", wordBreak: "break-word",
            }}>
              <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: checked ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: checked ? "#059669" : "transparent", marginTop: 2 }}>
                {checked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ flex: 1, lineHeight: 1.4 }}>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {isFiltered && (
        <>
          <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", margin: "4px 0" }} />
          <button onClick={() => onFilterChange(new Set())} style={{ width: "100%", padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, background: "transparent", color: "#B0A9A4", textAlign: "left" as const }}>
            フィルターをクリア
          </button>
        </>
      )}
    </div>
  );

  return (
    <div ref={rootRef} style={{ position: "relative", width: "100%", ...(portal ? { height: "100%" } : null), cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onToggle}>
      {/* 見出しのホバー膜は外側（列セル全体＝クリック範囲）だけに出す。
          このボタンにも interactive.css の膜が乗ると、ラベルの周りだけ二重に暗くなって
          「グレーが2枚重なっている」ように見えるため data-hover="off" で片方を消す。 */}
      <button data-hover="off" onClick={e => { e.stopPropagation(); onToggle(); }} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none",
        cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700,
        color: labelColor,
        textTransform: "uppercase" as const, letterSpacing: "0.06em",
        // 紺色の見出しでは、ほかの列の見出しと同じ字の大きさにそろえる
        ...(onDark ? { fontSize: 11, letterSpacing: "normal", whiteSpace: "nowrap" } : null),
      }}>
        {label}
        {isSorted && <span style={{ fontSize: 9, color: markColor, fontWeight: 900 }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
        {isFiltered && <span style={{ width: 5, height: 5, borderRadius: "50%", background: markColor, display: "inline-block", flexShrink: 0 }} />}
        <ChevronDown style={{ width: 9, height: 9, color: chevronColor, flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (portal ? (portalPos && createPortal(panel, document.body)) : panel)}
    </div>
  );
}
