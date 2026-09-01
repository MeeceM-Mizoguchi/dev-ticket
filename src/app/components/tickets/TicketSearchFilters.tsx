import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import { DatePicker } from "@/app/components/shared/DatePicker";
import {
  DATE_FIELD_OPTIONS, hasAnyCriteria,
  type DateRange, type TicketSearchCriteria,
} from "@/app/lib/ticketSearch";

// ENHA2-048 チケット一覧検索の条件エリア。
// 条件はすべて即時反映（検索ボタンを押さなくても下の一覧が絞り込まれる）。

export interface FilterOption {
  value: string;
  label: string;
  /** バッジ色を持つ項目（ステータス・優先度）だけ指定する */
  color?: string;
  bg?: string;
}

const LABEL_STYLE: React.CSSProperties = {
  display: "block", fontSize: 10, fontWeight: 700, color: "#9E9690",
  letterSpacing: "0.06em", marginBottom: 6,
};

/**
 * 複数選択の絞り込み欄。
 * 選択なし＝「すべて」（絞り込まない）。CustomSelect は単一選択なのでここで用意する。
 */
function MultiSelect({
  label, options, selected, onChange, placeholder = "すべて", width,
}: {
  label: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (!open) setSearch(""); }, [open]);

  // 画面のどこかを触ったら閉じる。ドロップダウンの中は onMouseDown を止めてある
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selectedSet = new Set(selected);
  const visible = options.filter(o => search === "" || o.label.toLowerCase().includes(search.toLowerCase()));
  const allVisibleChecked = visible.length > 0 && visible.every(o => selectedSet.has(o.value));

  const toggleOne = (value: string) => {
    onChange(selectedSet.has(value) ? selected.filter(v => v !== value) : [...selected, value]);
  };
  const toggleAll = () => {
    if (visible.length === 0) return;
    if (allVisibleChecked) onChange(selected.filter(v => !visible.some(o => o.value === v)));
    else onChange([...new Set([...selected, ...visible.map(o => o.value)])]);
  };

  const summary = selected.length === 0
    ? placeholder
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} 件を選択`;

  return (
    <div style={{ width }}>
      <label style={LABEL_STYLE}>{label}</label>
      <div ref={wrapRef} style={{ position: "relative" }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, width: "100%",
            background: "#FFF", border: `1.5px solid ${open || selected.length > 0 ? "#059669" : "rgba(5,150,105,0.35)"}`,
            borderRadius: 10, padding: "8.5px 11.5px", cursor: "pointer", fontSize: 13,
            color: selected.length > 0 ? "#1A1714" : "#B0A9A4", textAlign: "left",
            boxShadow: open ? "0 0 0 3px rgba(5,150,105,0.12)" : "none", transition: "all 0.15s",
          }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
          <ChevronDown style={{ width: 14, height: 14, color: "#059669", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
        </button>

        {open && (
          <div onMouseDown={e => e.stopPropagation()}
            style={{
              position: "absolute", top: "calc(100% + 6px)", left: 0, minWidth: "100%", maxWidth: 340,
              background: "#fff", borderRadius: 10, border: "1px solid rgba(26,23,20,0.10)",
              boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: 6, zIndex: 300,
            }}>
            {options.length > 8 && (
              <div style={{ padding: "2px 4px 6px" }}>
                <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="絞り込み..."
                  style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(26,23,20,0.15)", fontSize: 11, outline: "none", boxSizing: "border-box", color: "#1A1714", background: "#FAFAF9" }} />
              </div>
            )}

            <button type="button" onClick={toggleAll}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, background: "transparent", color: "#1A1714", textAlign: "left" }}>
              <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: allVisibleChecked ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: allVisibleChecked ? "#059669" : "transparent" }}>
                {allVisibleChecked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
              </span>
              すべて
            </button>

            <div style={{ maxHeight: 240, overflowY: "auto", overscrollBehavior: "contain" }}>
              {visible.length === 0 ? (
                <div style={{ padding: 8, textAlign: "center", color: "#B0A9A4", fontSize: 11 }}>候補がありません</div>
              ) : visible.map(o => {
                const checked = selectedSet.has(o.value);
                return (
                  <button key={o.value || "__blank__"} type="button" onClick={() => toggleOne(o.value)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left", background: checked ? "#ECFDF5" : "transparent", color: checked ? "#059669" : "#1A1714" }}>
                    <span style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: checked ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: checked ? "#059669" : "transparent" }}>
                      {checked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                    </span>
                    {o.bg ? (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: o.bg, color: o.color, whiteSpace: "nowrap" }}>{o.label}</span>
                    ) : (
                      <span style={{ flex: 1, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {selected.length > 0 && (
              <>
                <div style={{ borderTop: "1px solid rgba(26,23,20,0.06)", margin: "4px 0" }} />
                <button type="button" onClick={() => onChange([])}
                  style={{ width: "100%", padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: 11, background: "transparent", color: "#B0A9A4", textAlign: "left" }}>
                  選択をクリア
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 1種類ぶんの期間欄。「いつから 〜 いつまで」。
 * 片方だけ入れてもよい（開始だけ＝以降、終了だけ＝以前）。
 */
function DateRangeField({
  label, range, onChange, fromPlaceholder, toPlaceholder,
}: {
  label: string;
  range: DateRange;
  onChange: (next: DateRange) => void;
  /** 左右で見る日付が違うとき（開始日〜期限日）に、どちらの日付かを欄の中に出す */
  fromPlaceholder?: string;
  toPlaceholder?: string;
}) {
  return (
    <div>
      <label style={LABEL_STYLE}>{label}</label>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ width: 138 }}>
          <DatePicker value={range.from} onChange={v => onChange({ ...range, from: v })}
            max={range.to || undefined} placeholder={fromPlaceholder} />
        </div>
        <span style={{ fontSize: 12, color: "#B0A9A4", flexShrink: 0 }}>〜</span>
        <div style={{ width: 138 }}>
          <DatePicker value={range.to} onChange={v => onChange({ ...range, to: v })}
            min={range.from || undefined} placeholder={toPlaceholder} />
        </div>
      </div>
    </div>
  );
}

export function TicketSearchFilters({
  criteria, onChange, onClear, columnFilterActive, statusOptions, priorityOptions, assigneeOptions, categoryOptions, sprintOptions,
  resultCount, totalCount,
}: {
  criteria: TicketSearchCriteria;
  onChange: (next: TicketSearchCriteria) => void;
  /** 「条件をクリア」。上部の条件だけでなく列見出しの絞り込みも一緒に落とす */
  onClear: () => void;
  /** 列見出し側で絞り込まれているか（クリアボタンの活性判定に混ぜる） */
  columnFilterActive: boolean;
  statusOptions: FilterOption[];
  priorityOptions: FilterOption[];
  assigneeOptions: FilterOption[];
  categoryOptions: FilterOption[];
  sprintOptions: FilterOption[];
  resultCount: number;
  totalCount: number;
}) {
  const patch = (p: Partial<TicketSearchCriteria>) => onChange({ ...criteria, ...p });
  const dirty = hasAnyCriteria(criteria) || columnFilterActive;

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "16px 18px", marginBottom: 14, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
      {/* 1段目: キーワード */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 320px", minWidth: 260 }}>
          <label style={LABEL_STYLE}>キーワード</label>
          <div style={{ position: "relative" }}>
            <Search style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#B0A9A4", pointerEvents: "none" }} />
            <input type="text" value={criteria.keyword} onChange={e => patch({ keyword: e.target.value })}
              placeholder="チケットNo・チケット名・詳細・担当者"
              style={{ width: "100%", boxSizing: "border-box", padding: "8.5px 30px 8.5px 32px", background: "#FFF", border: "1.5px solid rgba(5,150,105,0.35)", borderRadius: 10, fontSize: 13, color: "#1A1714", outline: "none" }} />
            {criteria.keyword && (
              <button type="button" onClick={() => patch({ keyword: "" })} title="キーワードを消す"
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", display: "flex", padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2段目: 期間。どれも同時に指定でき、入れたものはANDで効く */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", marginTop: 14 }}>
        {/* 作業期間。左＝開始日がこの日以降 / 右＝期限日がこの日以前 */}
        <DateRangeField label="開始日 〜 期限日"
          range={criteria.span}
          onChange={next => patch({ span: next })}
          fromPlaceholder="開始日" toPlaceholder="期限日" />
        {DATE_FIELD_OPTIONS.map(({ value, label }) => (
          <DateRangeField key={value} label={label}
            range={criteria.dateRanges[value] ?? { from: "", to: "" }}
            onChange={next => patch({ dateRanges: { ...criteria.dateRanges, [value]: next } })} />
        ))}
      </div>

      {/* 3段目: 選択式の条件 */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "flex-end", marginTop: 14 }}>
        <MultiSelect label="ステータス" options={statusOptions} selected={criteria.statuses}
          onChange={v => patch({ statuses: v })} width={190} />
        <MultiSelect label="優先度" options={priorityOptions} selected={criteria.priorities}
          onChange={v => patch({ priorities: v })} width={130} />
        <MultiSelect label="担当者" options={assigneeOptions} selected={criteria.assignees}
          onChange={v => patch({ assignees: v })} width={180} />
        <MultiSelect label="分類" options={categoryOptions} selected={criteria.categories}
          onChange={v => patch({ categories: v })} width={170} />
        <MultiSelect label="スプリント" options={sprintOptions} selected={criteria.sprintIds}
          onChange={v => patch({ sprintIds: v })} width={200} />

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#4B4744", cursor: "pointer", paddingBottom: 9, userSelect: "none" }}>
          <input type="checkbox" checked={criteria.includeChildren}
            onChange={e => patch({ includeChildren: e.target.checked })}
            style={{ width: 14, height: 14, accentColor: "#059669", cursor: "pointer" }} />
          子チケットを含む
        </label>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, paddingBottom: 7 }}>
          <span style={{ fontSize: 12, color: "#6B6458" }}>
            <strong style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{resultCount}</strong>
            <span style={{ color: "#B0A9A4" }}> / {totalCount} 件</span>
          </span>
          <button type="button" onClick={onClear} disabled={!dirty}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: dirty ? "pointer" : "not-allowed", border: `1px solid ${dirty ? "rgba(220,38,38,0.25)" : "rgba(156,163,175,0.30)"}`, background: dirty ? "#FEF2F2" : "#F3F4F6", color: dirty ? "#DC2626" : "#9CA3AF" }}>
            <X style={{ width: 12, height: 12 }} />条件をクリア
          </button>
        </div>
      </div>
    </div>
  );
}
