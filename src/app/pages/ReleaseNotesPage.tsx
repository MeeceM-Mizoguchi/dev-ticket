import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Info, CheckCircle2, X, GripVertical } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { mapSprintTicket } from "@/app/lib/mappers";
import { escStack } from "@/app/lib/escStack";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { useWindowSize } from "@/app/hooks/useWindowSize";
import type { SprintTicket } from "@/app/types";

interface ReleaseItem {
  ticket: SprintTicket;
  sprintId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
}

const MONTH_NAMES = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateStr(y: number, m: number, d: number) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

function truncateText(text: string, maxLen = 20): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

export function ReleaseNotesPage() {
  const todayObj = new Date();
  // 🌟 修正：UTCベースの toISOString() ではなく、ローカルのタイムゾーン（JST）で「今日」を生成
  const todayStr = toDateStr(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate());

  const [year, setYear] = useState(todayObj.getFullYear());
  const [month, setMonth] = useState(todayObj.getMonth());

  const { userId, userName, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const isOwner = userRole === "owner";
  const [myProjects, setMyProjects] = useState<{ id: string; name: string }[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    () => localStorage.getItem("releaseNotes:selectedProjectId") ?? ""
  );

  const { height } = useWindowSize();

  useEffect(() => {
    if (selectedProjectId) localStorage.setItem("releaseNotes:selectedProjectId", selectedProjectId);
  }, [selectedProjectId]);

  const [items, setItems] = useState<ReleaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const initializedRef = useRef(false);

  // Drag & drop
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null); // date string or "undecided"

  // Confirm dialog for DnD
  const [pendingDrop, setPendingDrop] = useState<{ id: string; targetDate: string | null; undecided: boolean } | null>(null);

  // Detail slide panels
  const [selectedDate, setSelectedDate] = useState<string | null>(null); // date cell for detail panel
  const [listPanelOpen, setListPanelOpen] = useState(false);
  const [listClosing, setListClosing] = useState(false);
  const [listNeedsSlideIn, setListNeedsSlideIn] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<SprintTicket | null>(null);
  const [selectedTicketMeta, setSelectedTicketMeta] = useState<{ sprintId: string; projectId: string; projectSlug: string } | null>(null);
  const [detailClosing, setDetailClosing] = useState(false);

  // Tooltip shown only while dragging a released ticket
  const [dragTooltipId, setDragTooltipId] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const isDraggingReleasedRef = useRef(false);

  // Confirm release (calendar cell リリース完了)
  const [pendingReleaseDateForAll, setPendingReleaseDateForAll] = useState<string | null>(null);

  // Month/Year picker
  const [showPicker, setShowPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(todayObj.getFullYear());
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    const h = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showPicker]);

  const openPicker = () => { setPickerYear(year); setShowPicker(s => !s); };
  const selectPickerMonth = (y: number, m: number) => { setYear(y); setMonth(m); setShowPicker(false); };
  const goToday = () => { setYear(todayObj.getFullYear()); setMonth(todayObj.getMonth()); };

  const load = useCallback(async () => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await (supabase as NonNullable<typeof supabase>)
        .from("sprint_tickets")
        .select("*, sprints!inner(id, project_id, projects!inner(id, slug, name))")
        .in("status", ["waiting-release", "released"])
        .order("created_at", { ascending: true });

      if (error) { console.error("[ReleaseNotes] load error:", error.message); return; }

      const mapped: ReleaseItem[] = (data ?? []).map((r: any) => ({
        ticket: mapSprintTicket(r),
        sprintId: r.sprints.id,
        projectId: r.sprints.projects.id,
        projectSlug: r.sprints.projects.slug,
        projectName: r.sprints.projects.name,
      }));
      setItems(mapped);
    } finally {
      setLoading(false);
      initializedRef.current = true;
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load projects (owner: all projects in selected org / others: assigned projects only)
  useEffect(() => {
    if (!isSupabaseEnabled || (!userId && !userName)) return;

    let q = (supabase as NonNullable<typeof supabase>)
      .from("projects")
      .select("id, name, members")
      .order("name");
    if (isOwner && selectedOrgId) {
      q = q.eq("organization_id", selectedOrgId);
    } else if (!isOwner && userOrgId) {
      q = q.or(`organization_id.eq.${userOrgId},organization_id.is.null`);
    }

    q.then(({ data }) => {
      if (data && data.length > 0) {
        const visibleProjects = isOwner
          ? data
          : data.filter((p: any) => {
              if (!p.members) return false;
              if (Array.isArray(p.members)) {
                return p.members.some((m: any) =>
                  m === userId || m === userName || m.id === userId || m.userId === userId
                );
              }
              if (typeof p.members === "string") {
                return p.members.includes(userId) || (userName && p.members.includes(userName));
              }
              return false;
            });

        if (visibleProjects.length > 0) {
          const projects = visibleProjects.map((p: any) => ({ id: p.id, name: p.name }));
          setMyProjects(projects);
          setSelectedProjectId(prev => {
            const exists = projects.some((p: any) => p.id === prev);
            return exists ? prev : projects[0].id;
          });
        } else {
          setMyProjects([]);
          setSelectedProjectId("");
        }
      } else {
        setMyProjects([]);
        setSelectedProjectId("");
      }
    });
  }, [userId, userName, isOwner, selectedOrgId, userOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Esc key: close list panel (TicketDetailPanel inside handles its own Esc via escStack)
  useEffect(() => {
    if (!listPanelOpen) return;
    escStack.push(closeList);
    return () => escStack.pop(closeList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listPanelOpen]);

  // Month navigation
  const prevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  };

  // Calendar grid construction
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();

  const calCells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) calCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) calCells.push(d);
  while (calCells.length % 7 !== 0) calCells.push(null);

  // アクセス可能なプロジェクトIDセット（組織フィルタ済み）
  const accessibleProjectIds = new Set(myProjects.map(p => p.id));
  // プロジェクトが0件のときは空 / 選択中プロジェクトがあれば単一絞り込み / なければ全アクセス可能プロジェクト
  const filteredItems = myProjects.length === 0
    ? []
    : selectedProjectId
      ? items.filter(i => i.projectId === selectedProjectId)
      : items.filter(i => accessibleProjectIds.has(i.projectId));

  // Group items by release_date
  // 明示的に is_release_date_undecided=true のチケットのみ未定エリアへ。
  // release_date も undecided フラグも未設定の旧チケットは表示しない。
  const byDate = new Map<string, ReleaseItem[]>();
  const undecidedItems: ReleaseItem[] = [];
  for (const item of filteredItems) {
    if (item.ticket.releaseDate) {
      const d = item.ticket.releaseDate;
      if (!byDate.has(d)) byDate.set(d, []);
      byDate.get(d)!.push(item);
    } else if (item.ticket.isReleaseDateUndecided) {
      undecidedItems.push(item);
    }
  }

  // Panel open helpers (no-flicker: delay state changes so animation runs)
  const openList = (dateStr: string) => {
    setSelectedDate(dateStr);
    setListClosing(false);
    setListNeedsSlideIn(true);
    setListPanelOpen(true);
    setSelectedTicket(null);
    setDetailClosing(false);
  };

  const closeDetail = () => {
    setDetailClosing(true);
    setListNeedsSlideIn(false); // don't re-animate list when returning from detail
    setTimeout(() => {
      setSelectedTicket(null);
      setDetailClosing(false);
    }, 260);
  };

  const closeList = () => {
    if (selectedTicket) { closeDetail(); return; }
    setListNeedsSlideIn(false);
    setListClosing(true);
    setTimeout(() => {
      setListPanelOpen(false);
      setListClosing(false);
      setSelectedDate(null);
    }, 260);
  };

  // DnD handlers
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };

  const handleDrop = (e: React.DragEvent, targetDate: string | null, undecided: boolean) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/plain") || dragId;
    if (!id) return;
    const item = items.find(i => i.ticket.id === id);
    if (!item) return;
    const currentDate = item.ticket.releaseDate ?? null;
    const currentUndecided = item.ticket.isReleaseDateUndecided ?? false;
    if (undecided === currentUndecided && targetDate === currentDate) return;
    setPendingDrop({ id, targetDate, undecided });
    setDragOverTarget(null);
    setDragId(null);
  };

  const confirmDrop = async () => {
    if (!pendingDrop || !isSupabaseEnabled) { setPendingDrop(null); return; }
    const { id, targetDate, undecided } = pendingDrop;
    const { error } = await (supabase as NonNullable<typeof supabase>)
      .from("sprint_tickets")
      .update({ release_date: undecided ? null : targetDate, is_release_date_undecided: undecided })
      .eq("id", id);
    if (!error) {
      setItems(prev => prev.map(i => i.ticket.id === id
        ? { ...i, ticket: { ...i.ticket, releaseDate: undecided ? null : targetDate, isReleaseDateUndecided: undecided } }
        : i
      ));
    }
    setPendingDrop(null);
  };

  // Release all tickets for a date
  const releaseAllOnDate = async (dateStr: string) => {
    const dateItems = byDate.get(dateStr) ?? [];
    const ids = dateItems.filter(i => i.ticket.status === "waiting-release").map(i => i.ticket.id);
    if (ids.length === 0) { setPendingReleaseDateForAll(null); return; }
    if (!isSupabaseEnabled) { setPendingReleaseDateForAll(null); return; }
    await (supabase as NonNullable<typeof supabase>)
      .from("sprint_tickets")
      .update({ status: "released", progress: 100 })
      .in("id", ids);
    setItems(prev => prev.map(i =>
      ids.includes(i.ticket.id) ? { ...i, ticket: { ...i.ticket, status: "released" as const, progress: 100 } } : i
    ));
    setPendingReleaseDateForAll(null);
  };

  const listItems = selectedDate ? (byDate.get(selectedDate) ?? []) : [];

  const isShowingSpinner = loading && !initializedRef.current;

  if (isShowingSpinner) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#FAFAF8" }}>
        <div style={{ width: 28, height: 28, border: "3px solid #E5E0DA", borderTopColor: "#059669", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#FAFAF8", overflow: "hidden" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideInRight { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes slideOutRight { from { transform: translateX(0); } to { transform: translateX(100%); } }
      `}</style>

      {/* Confirm: DnD */}
      {pendingDrop && (
        <ConfirmDialog
          title="リリース日変更の確認"
          message={pendingDrop.undecided
            ? "このチケットをリリース日未定に移動しますか？"
            : `${(pendingDrop.targetDate ?? "").replace(/-/g, "/")} にリリース日を変更しますか？`}
          confirmLabel="変更する"
          confirmColor="#7C3AED"
          hasWarningText={false}
          onConfirm={confirmDrop}
          onClose={() => setPendingDrop(null)}
        />
      )}

      {/* Confirm: Release all */}
      {pendingReleaseDateForAll && (
        <ConfirmDialog
          title="リリース完了の確認"
          message={`${pendingReleaseDateForAll.replace(/-/g, "/")} のチケットをすべてリリース済みに変更しますか？`}
          confirmLabel="リリース完了にする"
          confirmColor="#059669"
          hasWarningText={false}
          onConfirm={() => releaseAllOnDate(pendingReleaseDateForAll)}
          onClose={() => setPendingReleaseDateForAll(null)}
        />
      )}

      {/* Ticket detail panel (fixed overlay) */}
      {selectedTicket && selectedTicketMeta && (
        <TicketDetailPanel
          ticket={selectedTicket}
          sprintId={selectedTicketMeta.sprintId}
          projectId={selectedTicketMeta.projectId}
          projectSlug={selectedTicketMeta.projectSlug}
          onClose={closeDetail}
          onUpdated={() => load()}
          onSelectTicket={t => setSelectedTicket(t)}
        />
      )}

      {/* Ticket list panel (slide from right) — stays mounted while ticket detail is open to prevent re-animation */}
      {listPanelOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 190 }}>
          <div style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.28)", backdropFilter: "blur(3px)" }} onClick={closeList} />
          <div style={{
            position: "absolute", top: 0, right: 0, bottom: 0, width: 420,
            background: "#FAFAF8", boxShadow: "-12px 0 48px rgba(0,0,0,0.16)",
            display: "flex", flexDirection: "column",
            animation: listClosing
              ? "slideOutRight 0.26s cubic-bezier(0.4,0,1,1) forwards"
              : listNeedsSlideIn ? "slideInRight 0.28s cubic-bezier(0.16,1,0.3,1)"
                : "none",
          }}>
            <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFF", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>リリースノート</p>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
                    {selectedDate?.replace(/-/g, "/")} のチケット
                  </h2>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: "#EEF2FF", color: "#4F46E5", flexShrink: 0 }}>
                    {listItems.length}件
                  </span>
                </div>
              </div>
              <button onClick={closeList} style={{ padding: 7, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
                <X style={{ width: 16, height: 16 }} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
              {listItems.length === 0 ? (
                <p style={{ fontSize: 13, color: "#A09790", textAlign: "center", padding: "32px 0" }}>チケットがありません</p>
              ) : listItems.map(item => {
                const isReleased = item.ticket.status === "released";
                return (
                  <button key={item.ticket.id} onClick={() => {
                    setListNeedsSlideIn(false);
                    setSelectedTicketMeta({ sprintId: item.sprintId, projectId: item.projectId, projectSlug: item.projectSlug });
                    setSelectedTicket(item.ticket);
                  }}
                    style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(26,23,20,0.08)", background: isReleased ? "#F0FDF4" : "#FFF", marginBottom: 8, cursor: "pointer", textAlign: "left", transition: "box-shadow 0.15s" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <span style={{ fontSize: 10, color: "#B0A9A4", fontFamily: "var(--font-mono)", background: "#F4F5F6", padding: "1px 6px", borderRadius: 4, flexShrink: 0 }}>{item.ticket.wbs}</span>
                        {isReleased && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#DCFCE7", color: "#16A34A" }}>リリース済み</span>}
                        {isReleased && item.ticket.isOperationVerified && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: "#D1FAE5", color: "#059669", border: "1px solid rgba(5,150,105,0.25)" }}>動作確認済み</span>}
                      </div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.ticket.title}</p>
                      <p style={{ fontSize: 11, color: "#9E9690", marginTop: 2 }}>{item.projectName} ・ {item.ticket.assignee || "未定"}</p>
                    </div>
                    <ChevronRight style={{ width: 14, height: 14, color: "#B0A9A4", flexShrink: 0, marginTop: 2 }} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Released ticket drag tooltip */}
      {dragTooltipId && (
        <div style={{
          position: "fixed", zIndex: 300, pointerEvents: "none",
          left: tooltipPos.x + 12, top: tooltipPos.y - 34,
          background: "#1A1714", color: "#fff",
          fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 6,
          whiteSpace: "nowrap", boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
        }}>
          すでにリリース済みです
        </div>
      )}

      {/* Header */}
      <div style={{ padding: "16px 24px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FFF", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ flexShrink: 0 }}>
            <p style={{ fontSize: 9, color: "#B0A9A4", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 4 }}>Release Notes</p>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.025em" }}>リリースノート</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <OrgSelector />
            {/* Project selector */}
            <div style={{ width: 220 }}>
              <CustomSelect
                value={selectedProjectId}
                onChange={setSelectedProjectId}
                options={myProjects.length > 0
                  ? myProjects.map(p => ({ value: p.id, label: p.name }))
                  : [{ value: "", label: "アサイン済プロジェクトなし" }]}
                disabled={myProjects.length === 0}

                placeholder="プロジェクト選択"
              />
            </div>

            {/* Divider */}
            <div style={{ width: 1, height: 24, background: "rgba(26,23,20,0.10)", flexShrink: 0 }} />
            {/* 今日ボタン */}
            <button
              onClick={goToday}
              style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#FFF", cursor: "pointer", fontSize: 12, fontWeight: 700, color: "#059669", whiteSpace: "nowrap" as const }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F0FDF4"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FFF"; }}
            >
              今日
            </button>
            {/* Month navigation */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={prevMonth} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#FFF", cursor: "pointer", display: "flex", alignItems: "center", color: "#6B6458" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FFF"; }}>
                <ChevronLeft style={{ width: 16, height: 16 }} />
              </button>

              {/* Year/Month picker trigger */}
              <div ref={pickerRef} style={{ position: "relative" }}>
                <button
                  onClick={openPicker}
                  style={{
                    fontSize: 15, fontWeight: 700, color: "#1A1714", minWidth: 108, textAlign: "center" as const,
                    background: showPicker ? "#F4F5F6" : "transparent",
                    border: "1px solid transparent", borderRadius: 8, cursor: "pointer", padding: "5px 10px",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = showPicker ? "#F4F5F6" : "transparent"; }}
                >
                  {year}年 {MONTH_NAMES[month]}
                </button>

                {/* Picker popup */}
                {showPicker && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 8px)", left: "50%",
                    transform: "translateX(-50%)", zIndex: 100,
                    background: "#FFF", borderRadius: 14,
                    border: "1px solid rgba(26,23,20,0.10)",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.13)", padding: "14px 14px 10px",
                    width: 252,
                  }}>
                    {/* Year row */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <button
                        onClick={() => setPickerYear(y => y - 1)}
                        style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(26,23,20,0.10)", background: "#F4F5F6", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E8E4DF"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                      >
                        <ChevronLeft style={{ width: 14, height: 14 }} />
                      </button>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#1A1714" }}>{pickerYear}年</span>
                      <button
                        onClick={() => setPickerYear(y => y + 1)}
                        style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid rgba(26,23,20,0.10)", background: "#F4F5F6", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#E8E4DF"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                      >
                        <ChevronRight style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                    {/* Month grid: 3 cols × 4 rows */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
                      {MONTH_NAMES.map((name, i) => {
                        const isSel = pickerYear === year && i === month;
                        const isNow = pickerYear === todayObj.getFullYear() && i === todayObj.getMonth();
                        return (
                          <button
                            key={i}
                            onClick={() => selectPickerMonth(pickerYear, i)}
                            style={{
                              padding: "8px 0", borderRadius: 8, border: "none",
                              background: isSel ? "#059669" : isNow ? "#F0FDF4" : "transparent",
                              color: isSel ? "#FFF" : isNow ? "#059669" : "#1A1714",
                              fontWeight: isSel || isNow ? 700 : 500,
                              fontSize: 13, cursor: "pointer",
                              transition: "background 0.12s",
                            }}
                            onMouseEnter={e => { if (!isSel) (e.currentTarget as HTMLElement).style.background = isNow ? "#DCFCE7" : "#F4F5F6"; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSel ? "#059669" : isNow ? "#F0FDF4" : "transparent"; }}
                          >
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    {/* 今日へジャンプ */}
                    <div style={{ marginTop: 10, borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 8 }}>
                      <button
                        onClick={() => selectPickerMonth(todayObj.getFullYear(), todayObj.getMonth())}
                        style={{ width: "100%", padding: "7px 0", background: "#F0FDF4", color: "#059669", fontWeight: 700, fontSize: 12, border: "none", borderRadius: 8, cursor: "pointer", transition: "background 0.12s" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#DCFCE7"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F0FDF4"; }}
                      >
                        今月にジャンプ
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <button onClick={nextMonth} style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#FFF", cursor: "pointer", display: "flex", alignItems: "center", color: "#6B6458" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#FFF"; }}>
                <ChevronRight style={{ width: 16, height: 16 }} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Calendar body */}
      {myProjects.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#B0A9A4" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </div>
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#3D3732", marginBottom: 6 }}>アサインされたプロジェクトがありません</p>
            <p style={{ fontSize: 12, color: "#B0A9A4", lineHeight: 1.6 }}>選択中の組織にプロジェクトがないか、<br />まだアサインされていません</p>
          </div>
        </div>
      ) : (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "10px 20px 14px", minHeight: 0, minWidth: 0 }}>

        {/* Day-of-week header */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4, flexShrink: 0 }}>
          {DOW.map((d, i) => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#9E9690", padding: "4px 0" }}>{d}</div>
          ))}
        </div>

        {/* Calendar grid — flex: 1 で残りスペースを等分 */}
        <div style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: `repeat(${Math.ceil(calCells.length / 7)}, 1fr)`,
          gap: 4,
          minHeight: 0,
        }}>
          {calCells.map((day, i) => {
            if (!day) return <div key={i} />;
            const dow = (firstDow + day - 1) % 7;
            const dateStr = toDateStr(year, month, day);
            const dayItems = byDate.get(dateStr) ?? [];
            const allReleased = dayItems.length > 0 && dayItems.every(i => i.ticket.status === "released");

            // 🌟 修正：生成したJST基準の「今日」の文字列で比較
            const isToday = dateStr === todayStr;
            const isDragOver = dragOverTarget === dateStr;

            // 🌟 修正：ブレイクポイントをより安全な数値に変更
            const MAX_DISPLAY = height >= 960 ? 4 : height >= 760 ? 3 : height >= 600 ? 2 : 1;

            return (
              <div key={i}
                onDragOver={e => { e.preventDefault(); if (!isDraggingReleasedRef.current) setDragOverTarget(dateStr); }}
                onDragLeave={() => { if (dragOverTarget === dateStr) setDragOverTarget(null); }}
                onDrop={e => { if (!isDraggingReleasedRef.current) handleDrop(e, dateStr, false); }}
                onClick={dayItems.length > 0 ? () => openList(dateStr) : undefined}
                style={{
                  borderRadius: 10, padding: "5px 7px",
                  border: isDragOver ? "2px solid #7C3AED" : isToday ? "2px solid #16A34A" : "1px solid rgba(26,23,20,0.08)",
                  background: isDragOver ? "#F5F3FF" : isToday ? "#F0FDF4" : allReleased ? "#ECFDF5" : "#FFF",
                  boxShadow: isToday ? "0 0 0 3px rgba(22,163,74,0.12)" : "none",
                  transition: "border-color 0.15s, background 0.15s",
                  display: "flex", flexDirection: "column", gap: 2,
                  overflow: "hidden",
                  cursor: dayItems.length > 0 ? "pointer" : "default",
                }}>
                {/* Top row: date + buttons */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                    <span style={{ fontSize: 12, fontWeight: isToday ? 800 : 500, color: dow === 0 ? "#EF4444" : dow === 6 ? "#3B82F6" : isToday ? "#059669" : "#1A1714", lineHeight: 1 }}>{day}</span>
                    {dayItems.length > 0 && (
                      <span
                        title={`${dayItems.length}件のチケット`}
                        style={{
                          fontSize: 9, fontWeight: 700, lineHeight: 1,
                          padding: "2px 5px", borderRadius: 20,
                          background: allReleased ? "#DCFCE7" : "#EEF2FF",
                          color: allReleased ? "#16A34A" : "#4F46E5",
                          flexShrink: 0,
                        }}>
                        {dayItems.length}件
                      </span>
                    )}
                  </div>
                  {dayItems.length > 0 && (
                    <div style={{ display: "flex", gap: 3 }}>
                      <button
                        onClick={e => { e.stopPropagation(); openList(dateStr); }}
                        title="詳細"
                        style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "#EEF2FF", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#C7D2FE"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#EEF2FF"; }}>
                        <Info style={{ width: 11, height: 11, color: "#4F46E5" }} />
                      </button>
                      {!allReleased && (
                        <button
                          onClick={e => { e.stopPropagation(); setPendingReleaseDateForAll(dateStr); }}
                          title="リリース完了"
                          style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "#ECFDF5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#A7F3D0"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; }}>
                          <CheckCircle2 style={{ width: 11, height: 11, color: "#059669" }} />
                        </button>
                      )}
                      {allReleased && (
                        <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 6, background: "#DCFCE7", color: "#16A34A", display: "flex", alignItems: "center" }}>済</span>
                      )}
                    </div>
                  )}
                </div>

                {/* Ticket items Container — 領域を確保しつつはみ出さない設定 */}
                <div style={{
                  flex: 1, display: "flex", flexDirection: "column", gap: 2, minHeight: 0,
                  overflow: "hidden" // 🌟 修正: 万が一スペースが足りない場合は、潰さずに綺麗に隠す
                }}>
                  {dayItems.slice(0, MAX_DISPLAY).map(item => {
                    const isReleased = item.ticket.status === "released";
                    const label = `${item.ticket.wbs} ${item.ticket.title}`;
                    return (
                      <div key={item.ticket.id}
                        draggable
                        onDragStart={e => {
                          if (isReleased) {
                            isDraggingReleasedRef.current = true;
                            e.dataTransfer.setData("text/plain", "");
                            setDragTooltipId(item.ticket.id);
                            setTooltipPos({ x: e.clientX, y: e.clientY });
                          } else {
                            handleDragStart(e, item.ticket.id);
                          }
                        }}
                        onDragEnd={() => {
                          if (isReleased) {
                            isDraggingReleasedRef.current = false;
                            setDragTooltipId(null);
                          } else {
                            setDragId(null);
                            setDragOverTarget(null);
                          }
                        }}
                        onClick={e => {
                          e.stopPropagation();
                          setSelectedTicketMeta({ sprintId: item.sprintId, projectId: item.projectId, projectSlug: item.projectSlug });
                          setSelectedTicket(item.ticket);
                          setListPanelOpen(false);
                        }}
                        onMouseEnter={!isReleased ? (e => { (e.currentTarget as HTMLElement).style.background = "#E5E7EB"; }) : undefined}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isReleased ? "#F0FDF4" : "#F4F5F6"; }}
                        style={{
                          flex: "0 0 22px", // 🌟 修正: 高さを絶対に22pxに固定（Squish防止）
                          height: 22,
                          boxSizing: "border-box", // 🌟 修正: ボーダー等を高さに含める
                          fontSize: 10, fontWeight: 500, color: isReleased ? "#16A34A" : "#1A1714",
                          background: isReleased ? "#F0FDF4" : "#F4F5F6",
                          borderRadius: 5, padding: "0 6px", // 🌟 修正: 縦paddingをなくしflexのalignItemsで中央揃え
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          cursor: "pointer", userSelect: "none",
                          border: `1px solid ${isReleased ? "rgba(22,163,74,0.2)" : "transparent"}`,
                          display: "flex", alignItems: "center", gap: 3,
                          transition: "background 0.1s",
                        }}>
                        <GripVertical style={{ width: 9, height: 9, color: isReleased ? "rgba(22,163,74,0.4)" : "#B0A9A4", flexShrink: 0 }} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{truncateText(label, 16)}</span>
                      </div>
                    );
                  })}
                </div>

                {/* 🌟 修正：残りの省略バッジも高さを固定し、確実に最下部に表示 */}
                {dayItems.length > MAX_DISPLAY && (
                  <div
                    onClick={e => { e.stopPropagation(); openList(dateStr); }}
                    style={{
                      flex: "0 0 18px", // 🌟 追加: バッジの高さを18pxに固定
                      height: 18,
                      boxSizing: "border-box",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 600, color: "#9E9690",
                      background: "#F4F5F6", borderRadius: 5, padding: "0 5px",
                      cursor: "pointer", textAlign: "center",
                      border: "1px solid transparent",
                      marginTop: 2
                    }}
                  >
                    他 {dayItems.length - MAX_DISPLAY} 件...
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* リリース日未定 zone */}
        <div
          onDragOver={e => { e.preventDefault(); if (!isDraggingReleasedRef.current) setDragOverTarget("undecided"); }}
          onDragLeave={() => { if (dragOverTarget === "undecided") setDragOverTarget(null); }}
          onDrop={e => { if (!isDraggingReleasedRef.current) handleDrop(e, null, true); }}
          style={{
            marginTop: 8, flexShrink: 0, borderRadius: 12, padding: "10px 14px",
            border: dragOverTarget === "undecided" ? "2px dashed #7C3AED" : "2px dashed rgba(26,23,20,0.15)",
            background: dragOverTarget === "undecided" ? "#F5F3FF" : "#FAFAF8",
            transition: "border-color 0.15s, background 0.15s",
          }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#9E9690", marginBottom: undecidedItems.length > 0 ? 10 : 0, textTransform: "uppercase", letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 6 }}>
            リリース日未定エリア
            {undecidedItems.length > 0 && (
              <span style={{ fontWeight: 700, fontSize: 10, padding: "1px 7px", borderRadius: 20, background: "#EEF2FF", color: "#4F46E5", textTransform: "none", letterSpacing: 0 }}>
                {undecidedItems.length}件
              </span>
            )}
            {undecidedItems.length > 0 && <span style={{ fontWeight: 400, textTransform: "none" }}>— ここにドラッグして退避</span>}
          </p>
          {undecidedItems.length === 0 && (
            <p style={{ fontSize: 12, color: "#C9C4BB", textAlign: "center", padding: "8px 0" }}>チケットをここにドラッグして退避できます</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {undecidedItems.map(item => {
              const isReleased = item.ticket.status === "released";
              return (
                <div key={item.ticket.id}
                  draggable
                  onDragStart={e => {
                    if (isReleased) {
                      isDraggingReleasedRef.current = true;
                      e.dataTransfer.setData("text/plain", "");
                      setDragTooltipId(item.ticket.id);
                      setTooltipPos({ x: e.clientX, y: e.clientY });
                    } else {
                      handleDragStart(e, item.ticket.id);
                    }
                  }}
                  onDragEnd={() => {
                    if (isReleased) {
                      isDraggingReleasedRef.current = false;
                      setDragTooltipId(null);
                    } else {
                      setDragId(null);
                      setDragOverTarget(null);
                    }
                  }}
                  onClick={() => {
                    setSelectedTicketMeta({ sprintId: item.sprintId, projectId: item.projectId, projectSlug: item.projectSlug });
                    setSelectedTicket(item.ticket);
                  }}
                  onMouseEnter={!isReleased ? (e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.10)"; }) : undefined}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)"; }}
                  style={{
                    fontSize: 11, fontWeight: 500, color: isReleased ? "#16A34A" : "#1A1714",
                    background: isReleased ? "#F0FDF4" : "#FFF", borderRadius: 7, padding: "5px 10px",
                    border: isReleased ? "1px solid rgba(22,163,74,0.2)" : "1px solid rgba(26,23,20,0.12)",
                    cursor: "pointer", userSelect: "none",
                    display: "flex", alignItems: "center", gap: 4,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                    transition: "box-shadow 0.15s",
                    maxWidth: 200,
                  }}>
                  <GripVertical style={{ width: 10, height: 10, color: isReleased ? "rgba(22,163,74,0.4)" : "#B0A9A4", flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{truncateText(`${item.ticket.wbs} ${item.ticket.title}`, 18)}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}