import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

// 表の列見出し。押すと「昇順／降順／並び替えをクリア」と、その列の値のチェックボックス一覧が出る。
// スプリント一覧(SprintListView)とチケット一覧検索(TicketSearchResults)で同じものを使う。
// 開いているのはどの列か・絞り込みの中身は、呼び出し側が持つ。

export interface ColumnFilterOption { value: string; label: string }

export function ColumnFilter<C extends string>({
  col, label, sortCol, sortDir, onSort, onClearSort,
  options, selected, onFilterChange,
  open, onToggle, onClose, alignRight,
}: {
  col: C;
  label: string;
  sortCol: C | "";
  sortDir: "asc" | "desc";
  onSort: (col: C, dir: "asc" | "desc") => void;
  onClearSort: () => void;
  options: Array<{ value: string; label: string }>;
  selected: Set<string>;
  onFilterChange: (s: Set<string>) => void;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  alignRight?: boolean;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => { if (!open) setSearch(""); }, [open]);

  const isSorted = sortCol === col;
  const isFiltered = selected.size > 0;
  const active = isSorted || isFiltered;

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

  return (
    <div style={{ position: "relative", width: "100%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} onClick={onToggle}>
      <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 3, background: "none", border: "none",
        cursor: "pointer", padding: 0, fontSize: 10, fontWeight: 700,
        color: active ? "#059669" : "#B0A9A4",
        textTransform: "uppercase" as const, letterSpacing: "0.06em",
      }}>
        {label}
        {isSorted && <span style={{ fontSize: 9, color: "#059669", fontWeight: 900 }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
        {isFiltered && <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#059669", display: "inline-block", flexShrink: 0 }} />}
        <ChevronDown style={{ width: 9, height: 9, color: active ? "#059669" : "#C9C4BB", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          onWheel={e => e.stopPropagation()}
          style={{
            position: "absolute", top: "calc(100% + 6px)",
            left: alignRight ? "auto" : 0, right: alignRight ? 0 : "auto",
            background: "#fff", borderRadius: 10, border: "1px solid rgba(26,23,20,0.10)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: "6px", zIndex: 200, minWidth: 190, maxWidth: 360,
          }}>
          <button onClick={() => { onSort(col, "asc"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
            background: isSorted && sortDir === "asc" ? "#ECFDF5" : "transparent",
            color: isSorted && sortDir === "asc" ? "#059669" : "#1A1714", transition: "background 0.1s",
          }}>↑ 昇順</button>
          <button onClick={() => { onSort(col, "desc"); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px",
            borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
            background: isSorted && sortDir === "desc" ? "#ECFDF5" : "transparent",
            color: isSorted && sortDir === "desc" ? "#059669" : "#1A1714", transition: "background 0.1s",
          }}>↓ 降順</button>
          {isSorted && (
            <button onClick={() => { onClearSort(); onClose(); }} style={{
              display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px",
              borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11,
              background: "transparent", color: "#B0A9A4", textAlign: "left" as const,
            }}>並び替えをクリア</button>
          )}

          <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", margin: "4px 0" }} />

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
      )}
    </div>
  );
}
