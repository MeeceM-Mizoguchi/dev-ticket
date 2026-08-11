import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CalendarCheck2, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { Project, Sprint } from "@/app/types";
import { mapSprint } from "@/app/lib/mappers";
import { applySprintOrder, fetchSprintOrder } from "@/app/lib/sprintOrder";
import { SPRINTS } from "@/app/data/mock";
import { formatDate } from "@/app/lib/helpers";
import { escStack } from "@/app/lib/escStack";
import { useAuth } from "@/app/contexts/AuthContext";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { ProjectTimelineChart, type TimelineScale } from "@/app/components/projects/ProjectTimelineChart";

// BRU11-020 プロジェクト推移
// プロジェクトカードの3点メニューから開く読み取り専用のガント。
const SCALE_KEY = "project_timeline_scale";
const SCALES: { value: TimelineScale; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "週" },
  { value: "month", label: "月" },
];

const TERMINAL = ["done", "closed", "waiting-release", "released", "withdrawn"];

export function ProjectTimelineModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const { userId } = useAuth();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  // 一度でも読み終わったら、以後の再取得でチャートをスピナーに差し替えない
  const initializedRef = useRef(false);
  const [scale, setScale] = useState<TimelineScale>(() => {
    const saved = localStorage.getItem(SCALE_KEY);
    return saved === "day" || saved === "week" || saved === "month" ? saved : "week";
  });
  const [focusNonce, setFocusNonce] = useState(0);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  // 初回ロード時だけ、データのある年へ寄せる（更新やユーザーの年送りは上書きしない）
  const yearAdjustedRef = useRef(false);

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  useEffect(() => { localStorage.setItem(SCALE_KEY, scale); }, [scale]);

  const load = async () => {
    setLoading(true);
    if (!isSupabaseEnabled) {
      setSprints(SPRINTS.filter(s => s.projectId === project.id));
      initializedRef.current = true;
      setLoading(false);
      return;
    }
    try {
      const [{ data }, order] = await Promise.all([
        // 表示順が毎回変わらないよう、ネストも含めて .order() を必ず付ける
        supabase!.from("sprints")
          .select("*, sprint_tickets(*)")
          .eq("project_id", project.id)
          .order("start_date")
          .order("id")
          .order("created_at", { referencedTable: "sprint_tickets" })
          .order("id", { referencedTable: "sprint_tickets" }),
        fetchSprintOrder(project.id, userId || null),
      ]);
      // スプリント画面で保存された並び順があればそれに合わせる
      setSprints(applySprintOrder((data ?? []).map(mapSprint), order));
    } finally {
      initializedRef.current = true;
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 今年にデータが無いプロジェクトを開いたときは、データのある年に寄せてから表示する
  useEffect(() => {
    if (yearAdjustedRef.current || !initializedRef.current) return;
    yearAdjustedRef.current = true;
    const ys: number[] = [];
    const push = (v: string | null | undefined) => { if (v && /^\d{4}-\d{2}-\d{2}/.test(v)) ys.push(Number(v.slice(0, 4))); };
    push(project.startDate); push(project.endDate);
    sprints.forEach(s => {
      push(s.startDate); push(s.endDate);
      s.tickets.forEach(t => { push(t.startDate); push(t.dueDate); });
    });
    if (ys.length === 0) return;
    const min = Math.min(...ys), max = Math.max(...ys);
    if (thisYear < min) setYear(min);
    else if (thisYear > max) setYear(max);
  }, [sprints]); // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo(() => {
    const tickets = sprints.flatMap(s => s.tickets);
    const done = tickets.filter(t => TERMINAL.includes(t.status)).length;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const delayed = tickets.filter(t => t.dueDate && t.dueDate < todayStr && !TERMINAL.includes(t.status)).length;
    return {
      progress: tickets.length === 0 ? 0 : Math.round(done / tickets.length * 100),
      sprintCount: sprints.length,
      ticketCount: tickets.length,
      doneCount: done,
      delayed,
    };
  }, [sprints]);

  const showSpinner = loading && !initializedRef.current;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(10,14,12,0.45)", backdropFilter: "blur(4px)" }} />

      <div style={{ position: "relative", zIndex: 10, width: "min(1280px, 94vw)", height: "86vh", background: "#FFFFFF", borderRadius: 16, boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)", display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* ヘッダー */}
        <div style={{ flexShrink: 0, padding: "16px 20px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 15, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>プロジェクト推移</h2>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {project.name}{project.client ? ` / ${project.client}` : ""}
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {/* 年送り。表示は常に1年分（1/1〜12/31） */}
            <div style={{ display: "flex", alignItems: "center", gap: 2, background: "#F4F5F6", borderRadius: 9, padding: 3 }}>
              <YearNavButton label="前の年" onClick={() => setYear(y => y - 1)}><ChevronLeft style={{ width: 14, height: 14 }} /></YearNavButton>
              <span style={{ minWidth: 46, textAlign: "center", fontSize: 12, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-mono)" }}>{year}</span>
              <YearNavButton label="次の年" onClick={() => setYear(y => y + 1)}><ChevronRight style={{ width: 14, height: 14 }} /></YearNavButton>
            </div>
            <div style={{ display: "flex", gap: 3, background: "#F4F5F6", borderRadius: 9, padding: 3 }}>
              {SCALES.map(s => (
                <button key={s.value} onClick={() => setScale(s.value)}
                  style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: scale === s.value ? "#059669" : "transparent", color: scale === s.value ? "#FFFFFF" : "#6B6458" }}>
                  {s.label}
                </button>
              ))}
            </div>
            <button onClick={() => { setYear(thisYear); setFocusNonce(n => n + 1); }} title="今日へ"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 11px", fontSize: 11, fontWeight: 600, color: "#059669", background: "#ECFDF5", border: "1px solid rgba(5,150,105,0.18)", borderRadius: 9, cursor: "pointer" }}>
              <CalendarCheck2 style={{ width: 12, height: 12 }} />今日
            </button>
            <button onClick={() => { if (!loading) load(); }} title="更新" disabled={loading}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 30, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "#FFFFFF", cursor: loading ? "default" : "pointer", color: "#6B6458" }}>
              <RefreshCw style={{ width: 13, height: 13, animation: loading ? "pageloader-spin 0.75s linear infinite" : undefined }} />
            </button>
            <button onClick={onClose} title="閉じる"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 30, borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; (e.currentTarget as HTMLElement).style.color = "#1A1714"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
              <X style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>

        {/* サマリ帯 */}
        <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 20, padding: "10px 20px", background: "#FAFAF8", borderBottom: "1px solid rgba(26,23,20,0.06)", flexWrap: "wrap" }}>
          <Stat label="期間" value={`${formatDate(project.startDate)} – ${formatDate(project.endDate)}`} />
          <Stat label="進捗" value={`${summary.progress}%`} color="#059669" />
          <Stat label="スプリント" value={`${summary.sprintCount}`} />
          <Stat label="チケット" value={`${summary.doneCount} / ${summary.ticketCount}`} />
          <Stat label="遅延" value={`${summary.delayed}`} color={summary.delayed > 0 ? "#DC2626" : "#6B6458"} />

          {/* 凡例。実績は完了したものだけに出る */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 20, height: 9, borderRadius: 3, background: "rgba(107,100,88,0.13)", border: "1px solid rgba(107,100,88,0.35)" }} />
              <span style={{ fontSize: 10, color: "#A09790" }}>計画（開始〜期限）</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 20, height: 6, borderRadius: 2, background: "rgba(107,100,88,0.8)", border: "1px solid #6B6458" }} />
              <span style={{ fontSize: 10, color: "#A09790" }}>実績（着手〜クローズ）</span>
            </div>
          </div>
        </div>

        {/* チャート */}
        {showSpinner ? (
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <PageLoader label="プロジェクト推移を読み込み中..." />
          </div>
        ) : (
          <ProjectTimelineChart project={project} sprints={sprints} scale={scale} year={year} focusNonce={focusNonce} overallProgress={summary.progress} />
        )}
        {/* 更新ボタンのスピナー用。PageLoader が出ていないときも回るように自前で持つ */}
        <style>{`@keyframes pageloader-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

function YearNavButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 7, border: "none", background: "transparent", cursor: "pointer", color: "#6B6458" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFFFFF"; (e.currentTarget as HTMLElement).style.color = "#059669"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; }}>
      {children}
    </button>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span style={{ fontSize: 10, color: "#B0A9A4", fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: color ?? "#3D3732", fontFamily: "var(--font-mono)" }}>{value}</span>
    </div>
  );
}
