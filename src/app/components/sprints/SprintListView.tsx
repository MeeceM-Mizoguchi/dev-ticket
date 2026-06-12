import { useState, useMemo, useEffect } from "react";
import { ChevronDown, ChevronRight, Trash2, ExternalLink, Plus, Pencil, GitBranch, X } from "lucide-react";
import type { Sprint, SprintTicket, SortCol } from "@/app/types";
import { formatDate, getSprintStatusMeta, sprintProgress, TICKET_STATUSES, computeSprintStatus, htmlToText, calcTicketActualHours } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import { ProgressBar } from "@/app/components/shared/ProgressBar";
import { SprintActualHours } from "@/app/components/sprints/SprintActualHours";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// 🌟 復活: 実績モニターのログから「リリース」または「クローズ」の最終完了日を動的に抽出するヘルパー関数
const getClosedDateFromMonitor = (ticket: any): string => {
  if (!ticket) return "";
  const logs = ticket.monitorLogs || ticket.monitor_logs || ticket.ticket_monitor_logs || ticket.actualLogs || [];
  if (Array.isArray(logs) && logs.length > 0) {
    const closedLog = [...logs]
      .reverse()
      .find((log: any) => log && (
        log.process === "リリース" || log.process === "クローズ" ||
        log.status === "リリース" || log.status === "クローズ" ||
        log.phase === "リリース" || log.phase === "クローズ"
      ));
    if (closedLog) {
      return closedLog.completed_at || closedLog.completedAt || closedLog.created_at || closedLog.createdAt || closedLog.date || "";
    }
  }
  return ticket.releasedAt || ticket.released_at || ticket.closedAt || ticket.closed_at || "";
};

// 🌟 復活: ISO形式などのタイムスタンプから mm/dd を安全に抽出する専用フォーマッター
const formatClosedMMDD = (isoString: string) => {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString.slice(0, 5); // パース不能な場合のフォールバック
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}/${dd}`;
};

// プロジェクト共通の分類ベースマスター
const BASE_CATEGORY_MAP: Record<string, string> = {
  "CAT-1780106163889": "バグ",
  "CAT-1780106169442": "仕様確認",
  "CAT-1780106176626": "要望",
  "CAT-1780241120059": "改善",
  "CAT-1780293371590": "新規機能開発"
};

function ColumnFilter({
  col, label, sortCol, sortDir, onSort, onClearSort,
  options, selected, onFilterChange,
  open, onToggle, onClose, alignRight,
}: {
  col: SortCol;
  label: string;
  sortCol: SortCol | "";
  sortDir: "asc" | "desc";
  onSort: (col: SortCol, dir: "asc" | "desc") => void;
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
        display: "flex", alignItems: "center", center: "center", gap: 3, background: "none", border: "none",
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
            // 🌟 修正: maxWidth: 360 を追加して横幅の広がりすぎを防止
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", padding: "6px", zIndex: 200, minWidth: 190, maxWidth: 360,
          }}>
          {/* Sort */}
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

          {/* Search */}
          <div style={{ padding: "2px 4px 4px" }}>
            <input autoFocus type="text" value={search} onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()} placeholder="検索..."
              style={{ width: "100%", padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(26,23,20,0.15)", fontSize: 11, outline: "none", boxSizing: "border-box" as const, color: "#1A1714", background: "#FAFAF9" }} />
          </div>

          {/* Select all */}
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

          {/* Options */}
          <div style={{ maxHeight: 200, overflowY: "auto", overscrollBehavior: "contain" }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: 8, textAlign: "center" as const, color: "#B0A9A4", fontSize: 11 }}>一致する項目がありません</div>
            ) : filteredOptions.map(opt => {
              const checked = selected.has(opt.value);
              return (
                <button key={opt.value} onClick={() => toggleOne(opt.value)} style={{
                  // 🌟 修正: alignItems を flex-start に変更し、折り返しを許可 (whiteSpace, wordBreak)
                  display: "flex", alignItems: "flex-start", gap: 8, width: "100%", padding: "5px 8px",
                  borderRadius: 7, border: "none", cursor: "pointer", fontSize: 12, textAlign: "left" as const,
                  background: checked ? "#ECFDF5" : "transparent",
                  color: checked ? "#059669" : "#1A1714", transition: "background 0.1s",
                  whiteSpace: "normal", wordBreak: "break-word",
                }}>
                  <div style={{ width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", border: checked ? "none" : "1.5px solid rgba(26,23,20,0.20)", background: checked ? "#059669" : "transparent", marginTop: 2 }}>
                    {checked && <span style={{ color: "#fff", fontSize: 9, fontWeight: 700, lineHeight: 1 }}>✓</span>}
                  </div>
                  {/* 🌟 修正: テキストを span で囲み、lineHeight を整えて flex: 1 を付与 */}
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

export function SprintListView({ sprints, onSelectSprint, onDeleteSprint, onEditSprint, onSelectTicket, onCreateTicket, targetTicketWbs }: {
  sprints: Sprint[];
  onSelectSprint: (s: Sprint) => void;
  onDeleteSprint?: (s: Sprint) => void;
  onEditSprint?: (s: Sprint) => void;
  onSelectTicket?: (t: SprintTicket) => void;
  onCreateTicket?: (sprintId: string) => void;
  targetTicketWbs?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(sprints.map(s => s.id)));

  useEffect(() => {
    setExpanded(prev => new Set([...prev, ...sprints.map(s => s.id)]));
  }, [sprints.map(s => s.id).join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!targetTicketWbs) return;
    const sprint = sprints.find(s => s.tickets.some(t => t.wbs === targetTicketWbs));
    if (sprint) setExpanded(prev => new Set([...prev, sprint.id]));
  }, [targetTicketWbs, sprints]); // eslint-disable-line react-hooks/exhaustive-deps

  // 子チケット展開状態（チケットIDのSet）
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());

  // 🌟 修正: ソートの状態保持を「スプリントID」ごとに完全独立化
  const [sprintSorts, setSprintSorts] = useState<Record<string, { col: SortCol | ""; dir: "asc" | "desc" }>>({});

  // フィルターの状態保持を「スプリントID」ごとに完全独立化
  const [sprintFilters, setSprintFilters] = useState<Record<string, Record<string, Set<string>>>>({});
  const [openCol, setOpenCol] = useState<string>("");

  // 設定画面から、本物の分類データを直接保持するステート
  const [dbCategories, setDbCategories] = useState<Array<{ id: string; projectId: string; name: string }>>([]);

  // マウント時にSupabaseのマスターテーブルからアサイン設定の分類をロード
  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!
      .from("ticket_categories")
      .select("*")
      .then(({ data }) => {
        if (data) setDbCategories(data);
      })
      .catch((err) => console.error("Failed to load category master:", err));
  }, [sprints]);

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // 指定されたスプリントと同じプロジェクトに属する、画面内の全チケットを抽出するヘルパー
  const getTicketsInSameProject = (currentSprint: Sprint): SprintTicket[] => {
    return sprints
      .filter(s => s.projectId === currentSprint.projectId)
      .flatMap(s => s.tickets);
  };

  // 手動マッピングと、設定データを完全に融合させた最強のマスターマップを生成
  const unifiedCategoryMap = useMemo(() => {
    const registry = { ...BASE_CATEGORY_MAP };
    dbCategories.forEach(c => {
      if (c.id && c.name) {
        registry[c.id] = c.name;
      }
    });
    sprints.flatMap(s => s.tickets).forEach(t => {
      const id = t.categoryId || "";
      const name = (t as any).categoryName || (t as any).category?.name;
      if (id && name && !name.startsWith("CAT-") && !registry[id]) {
        registry[id] = name;
      }
    });
    return registry;
  }, [dbCategories, sprints]);

  // セル表示およびフィルタリング比較用の名前取得共通ヘルパー
  const getCategoryLabel = (ticket: SprintTicket): string => {
    const id = ticket.categoryId || "";
    if (unifiedCategoryMap[id]) return unifiedCategoryMap[id];

    const rawName = (ticket as any).categoryName || (ticket as any).category?.name || "";
    if (rawName && !rawName.startsWith("CAT-")) return rawName;
    if (rawName && unifiedCategoryMap[rawName]) return unifiedCategoryMap[rawName];

    return "分類なし";
  };

  // 自動幅調整ロジック（現在登録されている最大文字数からpx幅を動的に算出）
  const dynamicCategoryColumnWidth = useMemo(() => {
    let maxChars = 4; // 最低基準幅（4文字分）

    dbCategories.forEach(c => {
      if (c.name && c.name.length > maxChars) maxChars = c.name.length;
    });
    sprints.flatMap(s => s.tickets).forEach(t => {
      const label = getCategoryLabel(t);
      if (label && label.length > maxChars) maxChars = label.length;
    });

    const computedPx = Math.ceil(maxChars * 13.5) + 26;
    return Math.max(80, Math.min(180, computedPx));
  }, [dbCategories, sprints]);

  // 選択肢（オプション）の生成スコープを、プロジェクト全体ではなく、該当「スプリント（テーブル）単体」のチケットに厳密に限定
  const getColOptions = (currentSprint: Sprint, col: string): Array<{ value: string; label: string }> => {
    // スプリント内のチケット（親チケットのみ対象とする従来の仕様とも完全連動）
    const sprintTickets = currentSprint.tickets || [];

    switch (col) {
      case "wbs":
        return [...new Set(sprintTickets.map(t => t.wbs))].sort().map(v => ({ value: v, label: v }));
      case "title":
        return [...new Set(sprintTickets.map(t => t.title))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "description":
        return [...new Set(sprintTickets.map(t => htmlToText(t.description)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "status":
        return TICKET_STATUSES.map(s => ({ value: s.value, label: s.label }));
      case "priority":
        return [{ value: "high", label: "高" }, { value: "medium", label: "中" }, { value: "low", label: "低" }];
      case "assignee":
        return [...new Set(sprintTickets.map(t => t.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja")).map(v => ({ value: v, label: v }));
      case "startDate":
        return [...new Set(sprintTickets.map(t => t.startDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
      case "dueDate":
        return [...new Set(sprintTickets.map(t => t.dueDate || "").filter(Boolean))].sort().map(v => ({ value: v, label: formatDate(v) }));
      case "category":
        // 分類に関しては、前述の「該当チケットが実在する場合のみ出す」仕様に従い、スプリント内チケットから安全に抽出
        const optionSet = new Set<string>();
        sprintTickets.forEach(t => optionSet.add(getCategoryLabel(t)));

        return Array.from(optionSet)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b, "ja"))
          .map(v => ({ value: v, label: v }));
      default: return [];
    }
  };

  const getSelected = (sprintId: string, col: string): Set<string> => {
    return sprintFilters[sprintId]?.[col] ?? new Set();
  };

  const setColFilter = (sprintId: string, col: string) => (nextSet: Set<string>) => {
    setSprintFilters(prev => ({
      ...prev,
      [sprintId]: {
        ...(prev[sprintId] || {}),
        [col]: nextSet
      }
    }));
  };

  const toggleCol = (sprintId: string, col: string) => {
    const key = `${sprintId}:${col}`;
    setOpenCol(prev => prev === key ? "" : key);
  };
  const closeCol = () => setOpenCol("");

  // 🌟 修正: どのスプリントのソートを変更するか、引数に sprintId を追加
  const handleSort = (sprintId: string, col: SortCol, dir: "asc" | "desc") => {
    setSprintSorts(prev => ({ ...prev, [sprintId]: { col, dir } }));
  };
  const clearSort = (sprintId: string) => {
    setSprintSorts(prev => {
      const next = { ...prev };
      delete next[sprintId];
      return next;
    });
  };

  // 複数条件のAND掛け合わせ抽出ロジック
  const processTickets = (sprintId: string, tickets: SprintTicket[]) => {
    const parents = tickets.filter(t => !t.parentId);
    const activeFilters = sprintFilters[sprintId] || {};

    const filtered = parents.filter(t => {
      const catName = getCategoryLabel(t);
      const checks: Record<string, string> = {
        wbs: t.wbs,
        title: t.title,
        description: htmlToText(t.description),
        status: t.progress === -1 ? "pending" : t.status, // 🌟 修正: progress === -1 なら "pending" としてフィルタリングさせる
        priority: t.priority,
        assignee: t.assignee || "",
        startDate: t.startDate || "",
        dueDate: t.dueDate || "",
        closedDate: getClosedDateFromMonitor(t),
        category: catName
      };

      return Object.keys(activeFilters).every(col => {
        const filterSet = activeFilters[col];
        if (!filterSet || filterSet.size === 0) return true;
        return filterSet.has(checks[col] || "");
      });
    });

    // 🌟 修正: 対象のスプリントのソート設定を抜き出して適用する
    const currentSort = sprintSorts[sprintId];
    if (!currentSort || !currentSort.col) return filtered;
    return [...filtered].sort((a, b) => {
      const dir = currentSort.dir === "asc" ? 1 : -1;
      const col = currentSort.col;
      // 🌟 修正: 並び替え処理でも closedDate などを安全に取得できるように条件分岐を追加
      const getVal = (tick: SprintTicket, c: string) => {
        if (c === "category") return getCategoryLabel(tick);
        if (c === "closedDate") return getClosedDateFromMonitor(tick);
        return tick[c as keyof SprintTicket] ?? "";
      };

      const av = getVal(a, col) as string | number;
      const bv = getVal(b, col) as string | number;

      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ja") * dir;
    });
  };

  if (!sprints.length) return (
    <div style={{ padding: "48px 0", textAlign: "center", color: "#C9C4BB", fontSize: 13 }}>スプリントがありません</div>
  );

  const COLS = ["wbs", "title", "description", "category", "status", "priority", "assignee", "startDate", "dueDate"] as const;
  const COL_LABELS = ["No", "チケット名", "チケット詳細", "分類", "ステータス", "優先度", "担当者", "開始日", "期限日"];

  // 動的自動幅（dynamicCategoryColumnWidth）pxを流し込み、上下の縦ラインをピシッとシンクロ
  const GRID = `72px 1fr 1fr ${dynamicCategoryColumnWidth}px 110px 56px 110px 68px 68px 32px`;

  return (
    <div>
      {openCol && <div style={{ position: "fixed", inset: 0, zIndex: 9 }} onClick={closeCol} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {sprints.map(sprint => {
          const isExp = expanded.has(sprint.id);
          const sm = getSprintStatusMeta(computeSprintStatus(sprint));
          const progress = sprintProgress(sprint);
          const done = sprint.tickets.filter(t => t.status === "done" || t.status === "closed").length;
          const totalHours = sprint.tickets.reduce((s, t) => s + t.estimatedHours, 0);
          const actualHours = Math.round(sprint.tickets.reduce((s, t) => s + calcTicketActualHours(t), 0) * 10) / 10;

          const displayTickets = processTickets(sprint.id, sprint.tickets);
          const currentFilters = sprintFilters[sprint.id] || {};
          const hasAnyFilter = Object.values(currentFilters).some(set => set && set.size > 0);

          // 🌟 修正: このスプリント専用のソート設定を取り出す
          const sprintSort = sprintSorts[sprint.id] || { col: "", dir: "asc" };

          return (
            <div key={sprint.id} style={{ borderRadius: 12, border: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}>
              {/* Sticky: sprint header + column headers */}
              <div style={{ position: "sticky", top: 0, zIndex: openCol.startsWith(`${sprint.id}:`) ? 100 : 10 }}>
                {/* Sprint header */}
                <div
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", background: "#F9F8F6", cursor: "pointer", borderBottom: isExp ? "1px solid rgba(26,23,20,0.06)" : "none", borderRadius: isExp ? "12px 12px 0 0" : 12 }}
                  onClick={() => toggle(sprint.id)}>
                  <ChevronDown style={{ width: 13, height: 13, color: "#B0A9A4", transform: isExp ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s", flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)" }}>{sprint.name}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color }}>{sm.label}</span>
                    </div>
                    {sprint.goal && <p style={{ fontSize: 11, color: "#A09790", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{sprint.goal}</p>}
                    <div style={{ marginTop: 6 }}><ProgressBar value={progress} /></div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 20, flexShrink: 0, marginLeft: 16 }}>
                    {[{ label: "チケット", value: sprint.tickets.length }, { label: "完了", value: done }, { label: "工数(h)", value: totalHours }, { label: "進捗", value: `${progress}%` }].map(({ label, value }) => (
                      <div key={label} style={{ textAlign: "center" as const }}>
                        <p style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>{value}</p>
                        <p style={{ fontSize: 10, color: "#B0A9A4" }}>{label}</p>
                      </div>
                    ))}
                    <SprintActualHours actualHours={actualHours} />
                    <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" as const }}>{formatDate(sprint.startDate)} → {formatDate(sprint.endDate)}</span>
                    <button onClick={e => { e.stopPropagation(); onSelectSprint(sprint); }}
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.20)", borderRadius: 7, cursor: "pointer" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#D1FAE5"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                      <ExternalLink style={{ width: 11, height: 11 }} />詳細
                    </button>
                    {onCreateTicket && (
                      <button onClick={e => { e.stopPropagation(); onCreateTicket(sprint.id); }}
                        style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", fontSize: 11, fontWeight: 600, color: "#7C3AED", background: "#F5F3FF", border: "1px solid rgba(124,58,237,0.20)", borderRadius: 7, cursor: "pointer" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EDE9FE"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F5F3FF"; }}>
                        <Plus style={{ width: 11, height: 11 }} />新規チケット
                      </button>
                    )}
                    {onEditSprint && (
                      <button onClick={e => { e.stopPropagation(); onEditSprint(sprint); }}
                        style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#EFF6FF"; (e.currentTarget as HTMLElement).style.color = "#2563EB"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                        <Pencil style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                    {onDeleteSprint && (
                      <button onClick={e => { e.stopPropagation(); onDeleteSprint(sprint); }}
                        style={{ padding: 6, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#C9C4BB" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                        <Trash2 style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                  </div>
                </div>
                {/* Column headers with filters */}
                {isExp && (
                  <div style={{ display: "grid", gridTemplateColumns: GRID, padding: "7px 16px", background: "#F4F5F6", gap: 8, alignItems: "center", borderBottom: "1px solid rgba(26,23,20,0.08)", boxShadow: "0 2px 4px rgba(0,0,0,0.04)" }}>
                    {COLS.map((col, idx) => (
                      <ColumnFilter key={col} col={col}
                        label={COL_LABELS[idx]}
                        // 🌟 修正: このスプリント固有のソート設定・関数を渡す
                        sortCol={sprintSort.col as SortCol | ""}
                        sortDir={sprintSort.dir}
                        onSort={(c, d) => handleSort(sprint.id, c, d)}
                        onClearSort={() => clearSort(sprint.id)}
                        onClose={closeCol}
                        options={getColOptions(sprint, col)}
                        selected={getSelected(sprint.id, col)}
                        onFilterChange={setColFilter(sprint.id, col)}
                        open={openCol === `${sprint.id}:${col}`}
                        onToggle={() => toggleCol(sprint.id, col)}
                        alignRight={idx >= 7}
                      />
                    ))}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {hasAnyFilter && (
                        <button onClick={() => setSprintFilters(prev => ({ ...prev, [sprint.id]: {} }))} title="このテーブルのフィルタを全解除" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                          <X style={{ width: 11, height: 11 }} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Ticket rows */}
              {isExp && (
                <div style={{ borderRadius: "0 0 12px 12px", overflow: "hidden", position: "relative", zIndex: 0 }}>
                  {displayTickets.length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center" as const, color: "#C9C4BB", fontSize: 12 }}>
                      {sprint.tickets.filter(t => !t.parentId).length === 0 ? "チケットがありません" : "条件に一致するチケットがありません"}
                    </div>
                  ) : displayTickets.map((t) => {
                    // 🌟 修正: progress が -1 なら強制的に「保留中」のスタイルを適用する
                    const tsm = t.progress === -1
                      ? { value: "pending", label: "保留中", color: "#DC2626", bg: "#FEF2F2" }
                      : TICKET_STATUSES.find(s => s.value === t.status) ?? TICKET_STATUSES[0];
                    const priBg = t.priority === "high" ? "#FEF2F2" : t.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                    const priColor = t.priority === "high" ? "#DC2626" : t.priority === "medium" ? "#D97706" : "#0284C7";
                    const priLabel = t.priority === "high" ? "高" : t.priority === "medium" ? "中" : "低";
                    const children = sprint.tickets.filter(c => c.parentId === t.id);
                    const hasChildren = children.length > 0;
                    const isTicketExpanded = expandedTickets.has(t.id);
                    const toggleTicket = (e: React.MouseEvent) => { e.stopPropagation(); setExpandedTickets(prev => { const n = new Set(prev); n.has(t.id) ? n.delete(t.id) : n.add(t.id); return n; }); };

                    const displayCategory = getCategoryLabel(t);

                    return (
                      <div key={t.id}>
                        <div onClick={() => onSelectTicket?.(t)}
                          // 🌟 修正: closed だけでなく progress === -1 の時もグレーアウト＆半透明にする
                          style={{ display: "grid", gridTemplateColumns: GRID, padding: "10px 16px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.05)", cursor: onSelectTicket ? "pointer" : "default", background: (t.status === "closed" || t.progress === -1) ? "#F5F5F4" : "#FFFFFF", transition: "background 0.1s", opacity: (t.status === "closed" || t.progress === -1) ? 0.65 : 1 }}
                          onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = "#ECECEB"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = (t.status === "closed" || t.progress === -1) ? "#F5F5F4" : "#FFFFFF"; }}>
                          <div style={{ display: "flex", justifyContent: "center", gap: 4 }}>
                            {hasChildren ? (
                              <button onClick={toggleTicket} style={{ padding: 2, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", display: "flex", alignItems: "center" }}>
                                {isTicketExpanded ? <ChevronDown style={{ width: 10, height: 10 }} /> : <ChevronRight style={{ width: 10, height: 10 }} />}
                              </button>
                            ) : <span style={{ width: 14 }} />}
                            <span style={{ fontSize: 10, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{t.wbs}</span>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <div style={{ width: 4, height: 4, borderRadius: "50%", background: priColor, flexShrink: 0 }} />
                            <span style={{ fontSize: 12, fontWeight: 500, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.title}</span>
                            {hasChildren && <span style={{ fontSize: 9, color: "#B0A9A4", flexShrink: 0 }}><GitBranch style={{ width: 9, height: 9, display: "inline" }} /> {children.length}</span>}
                          </div>
                          <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(t.description) || "—"}</span>

                          {/* 左詰め配置・動的固定幅での美表示 */}
                          <div style={{ display: "flex", justifyContent: "start", minWidth: 0, paddingLeft: 4 }}>
                            <span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "left" }}>
                              {displayCategory}
                            </span>
                          </div>

                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: tsm.bg, color: tsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{tsm.label}</span></div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: priBg, color: priColor, width: "fit-content" }}>{priLabel}</span></div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                            <Avatar name={t.assignee} size="xs" />
                            <span style={{ fontSize: 11, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.assignee || "—"}</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.startDate)}</span></div>
                          <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{formatDate(t.dueDate)}</span></div>
                        </div>
                        {/* 子チケット行（アコーディオン展開時） */}
                        {hasChildren && isTicketExpanded && children.map(child => {
                          // 🌟 修正: progress が -1 なら強制的に「保留中」のスタイルを適用する
                          const ctsm = child.progress === -1
                            ? { value: "pending", label: "保留中", color: "#DC2626", bg: "#FEF2F2" }
                            : TICKET_STATUSES.find(s => s.value === child.status) ?? TICKET_STATUSES[0];
                          const cPriBg = child.priority === "high" ? "#FEF2F2" : child.priority === "medium" ? "#FFFBEB" : "#F0F9FF";
                          const cPriColor = child.priority === "high" ? "#DC2626" : child.priority === "medium" ? "#D97706" : "#0284C7";
                          const cPriLabel = child.priority === "high" ? "高" : child.priority === "medium" ? "中" : "低";
                          const childCategory = getCategoryLabel(child);
                          return (
                            <div key={child.id} onClick={() => onSelectTicket?.(child)}
                              // 🌟 修正: closed だけでなく progress === -1 の時もグレーアウト＆半透明にする
                              style={{ display: "grid", gridTemplateColumns: GRID, padding: "8px 16px 8px 32px", gap: 8, alignItems: "center", borderTop: "1px solid rgba(26,23,20,0.04)", cursor: onSelectTicket ? "pointer" : "default", background: child.progress === -1 ? "#F5F5F4" : "#F9F8F6", transition: "background 0.1s", opacity: (child.status === "closed" || child.progress === -1) ? 0.65 : 1 }}
                              onMouseEnter={e => { if (onSelectTicket) (e.currentTarget as HTMLElement).style.background = child.progress === -1 ? "#ECECEB" : "#EEF7F3"; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = child.progress === -1 ? "#F5F5F4" : "#F9F8F6"; }}>
                              <div style={{ display: "flex", justifyContent: "center" }}>
                                <span style={{ fontSize: 9, color: "#059669", fontFamily: "var(--font-mono)", fontWeight: 700, whiteSpace: "nowrap" }}>{child.wbs}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, paddingLeft: 4 }}>
                                <div style={{ width: 1, height: 12, background: "rgba(26,23,20,0.15)", flexShrink: 0 }} />
                                <span style={{ fontSize: 11, fontWeight: 400, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{child.title}</span>
                              </div>
                              <span style={{ fontSize: 11, color: "#9C9490", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{htmlToText(child.description) || "—"}</span>

                              <div style={{ display: "flex", justifyContent: "start", minWidth: 0, paddingLeft: 4 }}>
                                <span style={{ fontSize: 11, color: "#4B4744", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", width: "100%", textAlign: "left" }}>
                                  {childCategory}
                                </span>
                              </div>

                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: ctsm.bg, color: ctsm.color, width: "fit-content", whiteSpace: "nowrap" as const }}>{ctsm.label}</span></div>
                              <div style={{ display: "flex", justifyContent: "center" }}><span style={{ fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 20, background: cPriBg, color: cPriColor, width: "fit-content" }}>{cPriLabel}</span></div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}