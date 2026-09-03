import { useEffect, useRef, useState } from "react";
import { GitBranch, Search, X } from "lucide-react";
import { Avatar } from "@/app/components/shared/Avatar";
import { SelBox } from "@/app/components/sprints/SelBox";
import { ColumnFilter } from "@/app/components/shared/ColumnFilter";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { formatDate, getTicketStatusMeta, formatPersonDays } from "@/app/lib/helpers";
import type { ColumnFilters, SearchSortCol, SortDir, TicketSearchRow } from "@/app/lib/ticketSearch";
import { hasColumnFilters } from "@/app/lib/ticketSearch";

// ENHA2-048 チケット一覧検索の結果表。
//
// 列見出しはスプリント一覧と同じ ColumnFilter（昇順／降順＋その列の値のチェックボックス）。
// 見出し行は position:sticky。表の上（条件エリア・見出し・タブ）は普通にスクロールし、
// 見出し行が画面の一番上まで来たところで貼り付き、上へ戻すと自然に剥がれる。
// 貼り付いている間だけ影を出したいので、見出しの直前に置いた番人(sentinel)を
// IntersectionObserver で見張る。

const COLS: { col: SearchSortCol; label: string }[] = [
  { col: "wbs", label: "No" },
  // スプリント横断の一覧なので、どのスプリントのチケットかはチケット名より先に見せる
  { col: "sprint", label: "スプリント" },
  { col: "title", label: "チケット名" },
  { col: "category", label: "分類" },
  { col: "status", label: "ステータス" },
  { col: "priority", label: "優先度" },
  { col: "assignee", label: "担当者" },
  { col: "startDate", label: "開始日" },
  { col: "dueDate", label: "期限日" },
  { col: "closedDate", label: "クローズ日" },
  { col: "actual", label: "実績" },
];

// 先頭の32pxは一括操作のチェックボックス、末尾の30pxは「列の絞り込みを全解除」ボタンの席
// （どちらもスプリント一覧の表と同じ作り）
const GRID = "32px 84px 150px 1.7fr 104px 104px 52px 124px 68px 68px 76px 70px 30px";

// 期限日当日以降かつ未完了なら赤字にする（スプリント一覧と同じ判定）
function isOverdueOrToday(dueDate: string, status: string): boolean {
  if (!dueDate.trim()) return false;
  if (status === "closed" || status === "done" || status === "released" || status === "withdrawn") return false;
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return today >= dueDate.slice(0, 10);
}

function SkeletonRow({ index }: { index: number }) {
  const titleW = ["62%", "44%", "70%", "38%", "55%"][index % 5];
  return (
    <div style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "11px 16px", borderTop: "1px solid rgba(26,23,20,0.05)", opacity: 1 - index * 0.13 }}>
      {/* チェックボックス → No・スプリント → チケット名（幅広） → 残りの列 の順。実際の列並びに合わせる */}
      <span />
      <div className="skeleton-shimmer" style={{ height: 11, borderRadius: 5 }} />
      <div className="skeleton-shimmer" style={{ height: 10, borderRadius: 5 }} />
      <div className="skeleton-shimmer" style={{ height: 12, width: titleW, borderRadius: 5 }} />
      {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
        <div key={i} className="skeleton-shimmer" style={{ height: 10, borderRadius: 5 }} />
      ))}
      <span />
    </div>
  );
}

export function TicketSearchResults({
  rows, loading, sortCol, sortDir, onSort, onClearSort,
  columnFilters, onColumnFilterChange, onClearColumnFilters, getColumnOptions,
  onSelect, highlightWbs, hasCriteria, stickyTop = 0,
  selectedIds, onToggleTicket, onSetSelection,
}: {
  rows: TicketSearchRow[];
  loading?: boolean;
  sortCol: SearchSortCol | "";
  sortDir: SortDir;
  onSort: (col: SearchSortCol, dir: SortDir) => void;
  onClearSort: () => void;
  columnFilters: ColumnFilters;
  onColumnFilterChange: (col: SearchSortCol, values: string[]) => void;
  onClearColumnFilters: () => void;
  /** その列の候補。上部の条件で絞ったあとの一覧から作る */
  getColumnOptions: (col: SearchSortCol) => { value: string; label: string }[];
  onSelect: (row: TicketSearchRow) => void;
  /** 直前に開いていたチケット。戻ってきたときに見失わないよう色を付ける */
  highlightWbs?: string | null;
  hasCriteria: boolean;
  /** 見出し行を貼り付ける位置（画面上端からの距離） */
  stickyTop?: number;
  /** 一括操作で選択中のチケットID（スプリント一覧の表と同じ操作） */
  selectedIds: Set<string>;
  onToggleTicket: (ticketId: string) => void;
  /** 見出しのチェックボックス。いま表示している行をまとめて選択／解除する */
  onSetSelection: (rows: TicketSearchRow[], checked: boolean) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(false);
  // いま開いている列の見出しメニュー（同時に1つだけ）
  const [openCol, setOpenCol] = useState<SearchSortCol | "">("");

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    // スクロールしているのはシェルの <main>（AppShell / TabPane）
    const scroller = el.closest("main");
    const io = new IntersectionObserver(
      ([entry]) => setPinned(!entry.isIntersecting),
      { root: scroller ?? null, rootMargin: `-${stickyTop}px 0px 0px 0px`, threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [stickyTop]);

  const anyColumnFilter = hasColumnFilters(columnFilters);
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.ticket.id));
  const someSelected = !allSelected && rows.some(r => selectedIds.has(r.ticket.id));

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
      {/* 見出しメニューを開いている間、外側のどこを触っても閉じる（見出しより下に敷く） */}
      {openCol && <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={() => setOpenCol("")} />}

      {/* 見出しが貼り付いたかを検知するための番人。1px分は下マージンで打ち消すのでレイアウトは変わらない
          （高さ0だと環境によって交差判定が安定しないため 1px にしてある） */}
      <div ref={sentinelRef} style={{ height: 1, marginBottom: -1 }} />

      <div style={{
        position: "sticky", top: stickyTop, zIndex: 20,
        display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center",
        padding: "9px 16px", background: "#F4F5F6",
        borderBottom: "1px solid rgba(26,23,20,0.08)",
        borderRadius: pinned ? 0 : "12px 12px 0 0",
        boxShadow: pinned ? "0 4px 12px rgba(0,0,0,0.10)" : "none",
        transition: "box-shadow 0.15s, border-radius 0.15s",
      }}>
        <SelBox checked={allSelected} indeterminate={someSelected}
          onClick={e => { e.stopPropagation(); onSetSelection(rows, !allSelected); }} />
        {COLS.map(({ col, label }, idx) => (
          <ColumnFilter
            key={col}
            col={col}
            label={label}
            sortCol={sortCol}
            sortDir={sortDir}
            onSort={onSort}
            onClearSort={onClearSort}
            options={getColumnOptions(col)}
            selected={new Set(columnFilters[col] ?? [])}
            onFilterChange={next => onColumnFilterChange(col, [...next])}
            open={openCol === col}
            onToggle={() => setOpenCol(prev => (prev === col ? "" : col))}
            onClose={() => setOpenCol("")}
            // 右端に近い列は、メニューが画面外へはみ出さないよう右寄せで開く
            alignRight={idx >= 7}
          />
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {anyColumnFilter && (
            <button type="button" onClick={onClearColumnFilters} title="列の絞り込みを全解除"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", padding: 0 }}>
              <X style={{ width: 11, height: 11 }} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div>{[0, 1, 2, 3, 4].map(i => <SkeletonRow key={i} index={i} />)}</div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "56px 0", textAlign: "center", color: "#B0A9A4" }}>
          <Search style={{ width: 22, height: 22, marginBottom: 8, opacity: 0.5 }} />
          <p style={{ fontSize: 13, margin: 0 }}>
            {hasCriteria ? "条件に一致するチケットがありません" : "このプロジェクトにはチケットがありません"}
          </p>
          {hasCriteria && <p style={{ fontSize: 11, marginTop: 4, color: "#C9C4BB" }}>条件をゆるめて試してください</p>}
        </div>
      ) : rows.map(row => {
        const t = row.ticket;
        const sm = getTicketStatusMeta(t.status, t.progress);
        const priBg = t.priority === "high" ? "#FEF2F2" : t.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
        const priColor = t.priority === "high" ? "#DC2626" : t.priority === "medium" ? "#D97706" : "#0284C7";
        const priLabel = t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低";
        const isDone = t.status === "closed" || t.status === "released" || t.status === "on-hold" || t.status === "withdrawn";
        const isHighlighted = !!highlightWbs && t.wbs === highlightWbs;
        // 選択中はスプリント一覧の表と同じ薄緑
        const baseBg = selectedIds.has(t.id) ? "#F0FDF4" : isHighlighted ? "#FFFBEB" : isDone ? "#F5F5F4" : "#FFFFFF";
        const isDueAlert = isOverdueOrToday(t.dueDate || "", t.status);

        return (
          <div key={t.id} data-wbs={t.wbs} onClick={() => onSelect(row)}
            style={{ display: "grid", gridTemplateColumns: GRID, gap: 8, alignItems: "center", padding: "10px 16px", borderTop: "1px solid rgba(26,23,20,0.05)", cursor: "pointer", background: baseBg, opacity: isDone ? 0.7 : 1, transition: "background 0.1s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECECEB"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = baseBg; }}>
            <SelBox checked={selectedIds.has(t.id)}
              onClick={e => { e.stopPropagation(); onToggleTicket(t.id); }} />

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{t.wbs}</span>
            </div>

            <TruncatedText text={row.sprint.name} style={{ fontSize: 11, color: "#6B6458" }} />

            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
              {row.isChild && (
                <span title="子チケット" style={{ display: "flex", alignItems: "center", color: "#B0A9A4", flexShrink: 0 }}>
                  <GitBranch style={{ width: 10, height: 10 }} />
                </span>
              )}
              <span style={{ width: 4, height: 4, borderRadius: "50%", background: priColor, flexShrink: 0 }} />
              {/* 説明文は今まで通りブラウザ標準の title で。ツールチップはタイトルの全文 */}
              <TruncatedText text={t.title} title={row.descriptionText || undefined}
                style={{ fontSize: 12, fontWeight: 500, color: "#1A1714" }} />
            </div>

            <span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.categoryLabel}</span>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color, whiteSpace: "nowrap" }}>{sm.label}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor }}>{priLabel}</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
              <Avatar name={t.assignee} size="xs" />
              <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.assignee || "—"}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.startDate)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: isDueAlert ? "#DC2626" : "#B0A9A4", fontWeight: isDueAlert ? 800 : 400 }}>
                {t.dueDate ? formatDate(t.dueDate) : "—"}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{row.closedDate ? formatDate(row.closedDate) : "—"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "center" }}>
              <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600, color: row.actualHours > 0 ? "#059669" : "#B0A9A4" }}>
                {row.actualHours > 0 ? formatPersonDays(row.actualHours) : "—"}
              </span>
            </div>
            <span />
          </div>
        );
      })}
    </div>
  );
}
