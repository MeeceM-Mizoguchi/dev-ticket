import { useEffect, useMemo, useState, type ElementType, type CSSProperties, type ReactNode } from "react";
import { Navigate } from "react-router";
import {
  FileBarChart2, Sparkles, Download, Loader2, Copy, CheckCircle2, Clock, ListTodo,
  TrendingUp, AlertTriangle, CalendarClock, CalendarRange, Gauge, Rocket, Users,
} from "lucide-react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, AreaChart, Area } from "recharts";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { useToast } from "@/app/contexts/ToastContext";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { TICKETS, PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapSprintTicket } from "@/app/lib/mappers";
import { calcTicketActualHours, formatPersonDays } from "@/app/lib/helpers";
import type { SprintTicket } from "@/app/types";

// ── 定数 ─────────────────────────────────────────────────────────────────────
const TERMINAL_STATUSES = ["done", "closed", "waiting-release", "released"];

const STATUS_META: Record<string, { label: string; color: string }> = {
  "todo":            { label: "未着手",       color: "#A09790" },
  "in-progress":     { label: "進行中",       color: "#D97706" },
  "in-review":       { label: "レビュー中",   color: "#2563EB" },
  "review-done":     { label: "レビュー完了", color: "#16A34A" },
  "stg-test":        { label: "STGテスト",    color: "#7C3AED" },
  "uat":             { label: "UAT",          color: "#EA580C" },
  "done":            { label: "完了",         color: "#059669" },
  "closed":          { label: "クローズ",     color: "#64748B" },
  "waiting-release": { label: "リリース待ち", color: "#7C3AED" },
  "released":        { label: "リリース済み", color: "#0D9488" },
};

const SIGNAL_META = {
  green:  { label: "順調", color: "#059669", bg: "#ECFDF5", border: "#A7F3D0" },
  yellow: { label: "注意", color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  red:    { label: "遅延", color: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
} as const;

type PeriodMode = "weekly" | "monthly" | "custom";

// レポート対象に紐づくチケット（プロジェクト情報を付与）
type RepTicket = SprintTicket & { projectId: string; projectName: string };

// ── 期間ウィンドウ計算 ─────────────────────────────────────────────────────────
function getWindow(mode: PeriodMode, customStart: string, customEnd: string) {
  const now = new Date();
  if (mode === "custom") {
    const start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = customEnd ? new Date(`${customEnd}T23:59:59`) : now;
    return { start, end };
  }
  if (mode === "weekly") {
    const day = now.getDay();
    const diffToMon = (day + 6) % 7;
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(now.getDate() - diffToMon);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

// 完了とみなすタイムスタンプ（クローズ / リリース）
function completionTs(t: SprintTicket): number | null {
  const raw = t.closedAt || t.releasedAt || null;
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function fmtDate(d: Date) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}
function daysDiff(aMs: number, bMs: number) {
  return Math.max(0, Math.round((bMs - aMs) / 86400000 * 10) / 10);
}
function pct(n: number, d: number) { return d === 0 ? 0 : Math.round((n / d) * 100); }
function deltaLabel(cur: number, prev: number) {
  if (prev === 0) return cur === 0 ? "±0" : "新規";
  const diff = Math.round(((cur - prev) / prev) * 100);
  return `${diff >= 0 ? "+" : ""}${diff}%`;
}

// ── データ取得 ───────────────────────────────────────────────────────────────
function buildMockData(): RepTicket[] {
  const sprintToProject = new Map(SPRINTS.map(s => [s.id, s.projectId]));
  const projName = new Map(PROJECTS.map(p => [p.id, p.name]));
  return TICKETS.map((t: any) => {
    const pid = sprintToProject.get(t.sprintId ?? "") ?? "";
    return {
      ...(t as SprintTicket),
      projectId: pid,
      projectName: t.project || projName.get(pid) || "—",
    } as RepTicket;
  });
}

export function ReportsPage() {
  const { userPermissions, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const { toast } = useToast();

  const [allTickets, setAllTickets] = useState<RepTicket[]>(isSupabaseEnabled ? [] : buildMockData());
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>(
    isSupabaseEnabled ? [] : PROJECTS.map(p => ({ id: p.id, name: p.name }))
  );
  const [loading, setLoading] = useState(isSupabaseEnabled);

  // コントロール（選択内容は画面遷移をまたいで保持）
  const [periodMode, setPeriodMode] = useState<PeriodMode>(() => (sessionStorage.getItem("reportPeriodMode") as PeriodMode) || "weekly");
  const [customStart, setCustomStart] = useState(() => sessionStorage.getItem("reportCustomStart") || "");
  const [customEnd, setCustomEnd] = useState(() => sessionStorage.getItem("reportCustomEnd") || "");
  const [scope, setScope] = useState<string>(() => sessionStorage.getItem("reportScope") || "all"); // "all" or projectId

  // 選択内容を保存（次回遷移時に同じ設定で表示する）
  useEffect(() => { sessionStorage.setItem("reportPeriodMode", periodMode); }, [periodMode]);
  useEffect(() => { sessionStorage.setItem("reportCustomStart", customStart); }, [customStart]);
  useEffect(() => { sessionStorage.setItem("reportCustomEnd", customEnd); }, [customEnd]);
  useEffect(() => { sessionStorage.setItem("reportScope", scope); }, [scope]);

  const canAccess = userPermissions.canAccessReports;

  // データロード
  useEffect(() => {
    if (!isSupabaseEnabled || !canAccess) { setLoading(false); return; }
    setLoading(true);
    (async () => {
      const isOwner = userRole === "owner";
      let projQ = supabase!.from("projects").select("id, name, organization_id");
      if (isOwner) {
        if (selectedOrgId) projQ = projQ.eq("organization_id", selectedOrgId);
      } else if (userOrgId) {
        projQ = (projQ as any).or(`organization_id.eq.${userOrgId},organization_id.is.null`);
      }
      try {
        const [pRes, sRes, tRes] = await Promise.all([
          projQ,
          supabase!.from("sprints").select("id, project_id"),
          supabase!.from("sprint_tickets").select("*"),
        ]);
        const projects = (pRes.data ?? []) as any[];
        const sprints = (sRes.data ?? []) as any[];
        const rawTickets = (tRes.data ?? []) as any[];

        const allowedProjects = new Set(projects.map(p => p.id));
        const sprintToProject = new Map(sprints.map(s => [s.id, s.project_id]));
        const projName = new Map(projects.map(p => [p.id, p.name]));

        const mapped: RepTicket[] = rawTickets
          .map(r => {
            const pid = sprintToProject.get(r.sprint_id ?? "") ?? "";
            return { ...mapSprintTicket(r), projectId: pid, projectName: projName.get(pid) ?? "—" } as RepTicket;
          })
          .filter(t => allowedProjects.has(t.projectId));

        setAllTickets(mapped);
        setProjectOptions(projects.map(p => ({ id: p.id, name: p.name })));
      } catch (err) {
        console.error("Failed to load report data:", err);
        toast("レポートデータの取得に失敗しました", "error");
      } finally {
        setLoading(false);
      }
    })();
  }, [canAccess, userRole, userOrgId, selectedOrgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── レポート集計（選択中の設定でリアルタイム算出） ──────────────────────────
  const report = useMemo(() => {
    // 任意期間は開始日・終了日が揃うまで算出しない
    if (periodMode === "custom" && (!customStart || !customEnd)) return null;
    const { start, end } = getWindow(periodMode, customStart, customEnd);
    const len = end.getTime() - start.getTime();
    const prevStart = new Date(start.getTime() - len);
    const prevEnd = new Date(start.getTime());
    const nextEnd = new Date(end.getTime() + len);
    const nowMs = Date.now();

    const scoped = scope === "all"
      ? allTickets
      : allTickets.filter(t => t.projectId === scope);

    const inRange = (ms: number | null, s: Date, e: Date) => ms != null && ms >= s.getTime() && ms < e.getTime();

    // 完了（実績）
    const completed = scoped.filter(t => inRange(completionTs(t), start, end));
    const completedPrev = scoped.filter(t => inRange(completionTs(t), prevStart, prevEnd));

    // スナップショット系（現時点）
    const activeTickets = scoped.filter(t => !TERMINAL_STATUSES.includes(t.status));
    const inProgress = activeTickets.filter(t => t.status !== "todo");
    const todo = scoped.filter(t => t.status === "todo");
    const totalScoped = scoped.length;
    const terminalAll = scoped.filter(t => TERMINAL_STATUSES.includes(t.status));
    const completionRate = pct(terminalAll.length, totalScoped);

    // ステータス内訳
    const statusBreakdown = Object.keys(STATUS_META).map(s => ({
      key: s,
      label: STATUS_META[s].label,
      color: STATUS_META[s].color,
      count: scoped.filter(t => t.status === s).length,
    })).filter(r => r.count > 0);

    // 生産性
    const cycleVals = completed.map(t => {
      const c = completionTs(t);
      return t.startedAt && c ? daysDiff(new Date(t.startedAt).getTime(), c) : null;
    }).filter((v): v is number => v != null);
    const leadVals = completed.map(t => {
      const c = completionTs(t);
      return t.createdAt && c ? daysDiff(new Date(t.createdAt).getTime(), c) : null;
    }).filter((v): v is number => v != null);
    const avg = (arr: number[]) => arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : 0;
    const cycleTime = avg(cycleVals);
    const leadTime = avg(leadVals);

    const estSum = completed.reduce((a, t) => a + (t.estimatedHours || 0), 0);
    const actSum = completed.reduce((a, t) => a + calcTicketActualHours(t), 0);
    const estimateAccuracy = estSum > 0 ? Math.round((actSum / estSum) * 100) : 0;

    // メンバー別負荷（期間内に着手 or 完了したチケットの実工数）
    const memberMap = new Map<string, { hours: number; count: number }>();
    completed.forEach(t => {
      const name = t.assignee || "未割当";
      const cur = memberMap.get(name) || { hours: 0, count: 0 };
      cur.hours += calcTicketActualHours(t);
      cur.count += 1;
      memberMap.set(name, cur);
    });
    const memberLoad = [...memberMap.entries()]
      .map(([name, v]) => ({ name, hours: v.hours, count: v.count, pd: Math.round((v.hours / 8) * 10) / 10 }))
      .sort((a, b) => b.hours - a.hours);

    // 直近8週のスループット推移
    const weekBuckets: { label: string; count: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const wEnd = new Date(); wEnd.setHours(0, 0, 0, 0);
      const dow = (wEnd.getDay() + 6) % 7;
      wEnd.setDate(wEnd.getDate() - dow - (i - 1) * 7); // 各週の月曜の翌週月曜
      const wStart = new Date(wEnd); wStart.setDate(wEnd.getDate() - 7);
      const count = scoped.filter(t => inRange(completionTs(t), wStart, wEnd)).length;
      weekBuckets.push({ label: `${wStart.getMonth() + 1}/${wStart.getDate()}`, count });
    }

    // フォーキャスト
    const parseDue = (t: SprintTicket) => t.dueDate ? new Date(`${t.dueDate}T23:59:59`).getTime() : null;
    const upcoming = activeTickets.filter(t => {
      const d = parseDue(t);
      return d != null && d >= end.getTime() && d < nextEnd.getTime();
    }).sort((a, b) => (parseDue(a)! - parseDue(b)!));
    const overdue = activeTickets.filter(t => {
      const d = parseDue(t);
      return d != null && d < nowMs;
    }).sort((a, b) => (parseDue(a)! - parseDue(b)!));
    const dueSoon = activeTickets.filter(t => {
      const d = parseDue(t);
      return d != null && d >= nowMs && d < nowMs + 3 * 86400000;
    });
    const releases = scoped.filter(t => {
      if (!t.releaseDate || t.isReleaseDateUndecided) return false;
      const d = new Date(`${t.releaseDate}T00:00:00`).getTime();
      return !Number.isNaN(d) && d >= start.getTime();
    }).sort((a, b) => new Date(a.releaseDate!).getTime() - new Date(b.releaseDate!).getTime());

    // 総合シグナル
    const overdueRatio = activeTickets.length ? overdue.length / activeTickets.length : 0;
    let signal: "green" | "yellow" | "red" = "green";
    if (overdue.length >= 5 || overdueRatio > 0.2) signal = "red";
    else if (overdue.length > 0) signal = "yellow";

    // ルールベース報告文
    const periodLabel = periodMode === "weekly" ? "今週" : periodMode === "monthly" ? "今月" : "対象期間";
    const sentences: string[] = [];
    sentences.push(`${periodLabel}は計 ${completed.length}件 のチケットを完了しました（前期比 ${deltaLabel(completed.length, completedPrev.length)}）。`);
    if (cycleTime > 0) {
      sentences.push(`平均サイクルタイムは ${cycleTime}日、平均リードタイムは ${leadTime}日 です。`);
    }
    if (overdue.length > 0) {
      sentences.push(`期限を超過している未完了チケットが ${overdue.length}件 あり、対応が必要です。`);
    } else {
      sentences.push("期限超過の未完了チケットはなく、計画通りに推移しています。");
    }
    if (estimateAccuracy > 120) {
      sentences.push(`実績工数が見積を ${estimateAccuracy - 100}% 上回っており、見積精度の見直し余地があります。`);
    } else if (estimateAccuracy > 0 && estimateAccuracy < 80) {
      sentences.push(`実績工数は見積を下回って推移しています（実績/見積 ${estimateAccuracy}%）。`);
    }
    if (memberLoad.length >= 2) {
      const top = memberLoad[0];
      const avgPd = memberLoad.reduce((a, m) => a + m.pd, 0) / memberLoad.length;
      if (top.pd > avgPd * 1.5 && top.name !== "未割当") {
        sentences.push(`${top.name} に作業が集中しています（${formatPersonDays(top.hours)}）。負荷分散を検討してください。`);
      }
    }
    if (upcoming.length > 0) {
      sentences.push(`来期は ${upcoming.length}件 のチケットが期限を迎える予定です。`);
    }

    // ── ガント（チケット単位）：対象期間に重なるチケットを期間バーで俯瞰 ──
    const parseD = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).getTime() : null);
    const tlStart = start.getTime();
    const tlEnd = end.getTime();
    const span = Math.max(1, tlEnd - tlStart);
    const scheduleTickets = scoped.map(t => {
      const s0 = parseD(t.startDate) ?? parseD(t.dueDate);
      const e0 = parseD(t.dueDate) ?? parseD(t.startDate);
      if (s0 == null || e0 == null) return null;
      const rawStart = Math.min(s0, e0);
      const rawEnd = Math.max(s0, e0);
      if (rawEnd < tlStart || rawStart > tlEnd) return null; // 期間に重ならない
      const isDone = TERMINAL_STATUSES.includes(t.status);
      const isOverdue = !isDone && rawEnd < nowMs;
      const cs = Math.max(rawStart, tlStart);
      const ce = Math.min(rawEnd, tlEnd);
      return {
        id: t.id, wbs: t.wbs, title: t.title, assignee: t.assignee, status: t.status, isDone, isOverdue,
        leftPct: ((cs - tlStart) / span) * 100,
        widthPct: Math.max(1.5, ((ce - cs) / span) * 100),
      };
    }).filter(Boolean).sort((a, b) => (a!.leftPct - b!.leftPct)) as any[];
    const todayPct = nowMs >= tlStart && nowMs <= tlEnd ? ((nowMs - tlStart) / span) * 100 : null;
    // タイムライン目盛り（最大8区切り）
    const tlTicks: { pct: number; label: string }[] = [];
    {
      const days = Math.round(span / 86400000);
      const step = days <= 10 ? 1 : Math.ceil(days / 8);
      for (let i = 0; i <= days; i += step) {
        const d = new Date(tlStart + i * 86400000);
        tlTicks.push({ pct: (i / Math.max(1, days)) * 100, label: `${d.getMonth() + 1}/${d.getDate()}` });
      }
    }

    // ── 1チケットあたりの効率 ──
    const hoursPerTicket = completed.length ? Math.round((actSum / completed.length) * 10) / 10 : 0;
    const pdPerTicket = completed.length ? Math.round((actSum / 8 / completed.length) * 10) / 10 : 0;

    // ── メンバー個別の生産性 ──
    const overdueByMember = new Map<string, number>();
    overdue.forEach(t => { const n = t.assignee || "未割当"; overdueByMember.set(n, (overdueByMember.get(n) || 0) + 1); });
    const msMap = new Map<string, { name: string; count: number; hours: number; cycleSum: number; cycleN: number }>();
    completed.forEach(t => {
      const name = t.assignee || "未割当";
      const cur = msMap.get(name) || { name, count: 0, hours: 0, cycleSum: 0, cycleN: 0 };
      cur.count += 1;
      cur.hours += calcTicketActualHours(t);
      const c = completionTs(t);
      if (t.startedAt && c) { cur.cycleSum += daysDiff(new Date(t.startedAt).getTime(), c); cur.cycleN += 1; }
      msMap.set(name, cur);
    });
    const memberStats = [...msMap.values()].map(m => ({
      name: m.name,
      count: m.count,
      personDays: Math.round((m.hours / 8) * 10) / 10,
      hours: m.hours,
      avgCycle: m.cycleN ? Math.round((m.cycleSum / m.cycleN) * 10) / 10 : 0,
      overdue: overdueByMember.get(m.name) || 0,
    })).sort((a, b) => b.count - a.count);

    return {
      start, end, prevStart, prevEnd, nextEnd, periodLabel,
      completed, completedPrev, inProgress, todo, activeTickets, totalScoped, completionRate,
      statusBreakdown, cycleTime, leadTime, estimateAccuracy, estSum, actSum,
      memberLoad, weekBuckets, upcoming, overdue, dueSoon, releases, signal, sentences,
      scheduleTickets, todayPct, tlTicks, hoursPerTicket, pdPerTicket, memberStats,
    };
  }, [periodMode, customStart, customEnd, scope, allTickets]);

  if (!canAccess) return <Navigate to="/dashboard" replace />;

  const scopeOptions = [
    { value: "all", label: "組織全体" },
    ...projectOptions.map(p => ({ value: p.id, label: p.name })),
  ];
  const scopeName = scope === "all" ? "組織全体" : (projectOptions.find(p => p.id === scope)?.name ?? "—");

  const handleCopy = async () => {
    if (!report) return;
    const head = `【業務レポート】${scopeName} / ${fmtDate(report.start)}〜${fmtDate(new Date(report.end.getTime() - 1))}`;
    const kpi = `■ サマリー\n・完了: ${report.completed.length}件（前期比 ${deltaLabel(report.completed.length, report.completedPrev.length)}）\n・進行中: ${report.inProgress.length}件 / 未着手: ${report.todo.length}件\n・完了率: ${report.completionRate}%\n・平均サイクルタイム: ${report.cycleTime}日 / リードタイム: ${report.leadTime}日`;
    const body = `■ 所感\n${report.sentences.map(s => `・${s}`).join("\n")}`;
    try {
      await navigator.clipboard.writeText(`${head}\n\n${kpi}\n\n${body}`);
      toast("報告文をコピーしました");
    } catch {
      toast("コピーに失敗しました", "error");
    }
  };

  const signalMeta = SIGNAL_META;

  // ── PDF出力（プレゼン資料形式：1280×720スライドを1ページずつ） ──────────────
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0 });

  const handleDownloadPdf = async () => {
    if (!report || pdfBusy) return;
    setPdfBusy(true);
    setPdfProgress({ current: 0, total: 0 });
    try {
      const { exportReportPdf } = await import("@/app/lib/reportPdf");
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
      await exportReportPdf(report, scopeName, `業務レポート_${scopeName}_${stamp}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast("PDFの生成に失敗しました", "error");
    } finally {
      setPdfBusy(false);
      setPdfProgress({ current: 0, total: 0 });
    }
  };

  return (
    <div style={{ padding: "28px 32px" }}>
      <style>{`
        @keyframes rep-spin { to { transform: rotate(360deg); } }
        .rep-spin { animation: rep-spin 0.8s linear infinite; }
      `}</style>

      {/* PDF生成中オーバーレイ（裏で描画中のスライドを隠す） */}
      {pdfBusy && (
        <div style={{ position: "fixed", inset: 0, zIndex: 2147483647, background: "rgba(255,255,255,0.94)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <Loader2 className="rep-spin" style={{ width: 40, height: 40, color: "#059669" }} />
          <p style={{ fontSize: 15, fontWeight: 700, color: "#374151" }}>
            PDFを生成しています{pdfProgress.total ? `（${pdfProgress.current}/${pdfProgress.total}）` : "..."}
          </p>
          <p style={{ fontSize: 12, color: "#9CA3AF" }}>スライドを順番に描画しています。しばらくお待ちください。</p>
        </div>
      )}

      {/* Header */}
      <div className="no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <FileBarChart2 style={{ width: 18, height: 18, color: "#FFF" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>レポート管理</h1>
            <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>進捗・予定・チーム生産性を週次／月次でまとめて出力します</p>
          </div>
        </div>
        {userRole === "owner" && <OrgSelector />}
      </div>

      {/* Controls */}
      <div className="no-print" style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 16, marginBottom: 20, display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14 }}>
        <Field label="期間">
          <div style={{ display: "flex", gap: 4, background: "#F3F4F6", borderRadius: 9, padding: 3 }}>
            {([["weekly", "週次"], ["monthly", "月次"], ["custom", "任意"]] as [PeriodMode, string][]).map(([m, l]) => (
              <button key={m} onClick={() => setPeriodMode(m)}
                style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "none", cursor: "pointer",
                  background: periodMode === m ? "#FFF" : "transparent", color: periodMode === m ? "#059669" : "#6B7280",
                  boxShadow: periodMode === m ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
                {l}
              </button>
            ))}
          </div>
        </Field>

        {periodMode === "custom" && (
          <>
            <Field label="開始日">
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                style={dateInputStyle} />
            </Field>
            <Field label="終了日">
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                style={dateInputStyle} />
            </Field>
          </>
        )}

        <Field label="対象">
          <div style={{ width: 220 }}>
            <CustomSelect value={scope} options={scopeOptions} onChange={setScope} />
          </div>
        </Field>
      </div>

      {loading ? (
        <p style={{ textAlign: "center", padding: 64, color: "#9CA3AF", fontSize: 13 }}>読み込み中...</p>
      ) : !report ? (
        <EmptyState />
      ) : (
        <div id="report-printable">
          {/* 印刷時タイトル */}
          <div style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#111827" }}>業務レポート</h2>
            <p style={{ fontSize: 13, color: "#6B7280", marginTop: 4 }}>
              {scopeName} ／ {fmtDate(report.start)} 〜 {fmtDate(new Date(report.end.getTime() - 1))}
            </p>
          </div>

          {/* §0 結論サマリー */}
          <section style={cardStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Sparkles style={{ width: 17, height: 17, color: "#059669" }} />
              <h3 style={sectionTitleStyle}>今週サマリー（結論）</h3>
              <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700, background: signalMeta[report.signal].bg, color: signalMeta[report.signal].color, border: `1px solid ${signalMeta[report.signal].border}` }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: signalMeta[report.signal].color }} />
                {signalMeta[report.signal].label}
              </span>
            </div>
            <div style={{ background: "#F9FAFB", border: "1px solid #F0F1F2", borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
              {report.sentences.map((s, i) => (
                <p key={i} style={{ fontSize: 13.5, color: "#374151", lineHeight: 1.8, display: "flex", gap: 8 }}>
                  <span style={{ color: "#059669" }}>•</span><span>{s}</span>
                </p>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <Kpi icon={CheckCircle2} color="#059669" label="完了" value={`${report.completed.length}`} unit="件" sub={`前期比 ${deltaLabel(report.completed.length, report.completedPrev.length)}`} />
              <Kpi icon={Clock} color="#D97706" label="進行中" value={`${report.inProgress.length}`} unit="件" sub={`未着手 ${report.todo.length}件`} />
              <Kpi icon={TrendingUp} color="#7C3AED" label="完了率" value={`${report.completionRate}`} unit="%" sub={`残 ${report.activeTickets.length}件`} />
              <Kpi icon={AlertTriangle} color="#DC2626" label="遅延" value={`${report.overdue.length}`} unit="件" sub={`期限間近 ${report.dueSoon.length}件`} />
            </div>
          </section>

          {/* §1 今週のスケジュール（ガント） */}
          <section style={cardStyle}>
            <SectionHead icon={CalendarRange} color="#0EA5E9" title="① 今週のスケジュール" desc="対象期間のチケットを俯瞰（色＝状態：完了 / 進行中 / 遅延）" />
            <div style={{ display: "flex", gap: 20, alignItems: "stretch" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ReportGantt tickets={report.scheduleTickets} ticks={report.tlTicks} todayPct={report.todayPct} />
              </div>
              <GanttSidePanel tickets={report.scheduleTickets} />
            </div>
          </section>

          {/* §2 進捗：終わった？終わってない？ */}
          <section style={cardStyle}>
            <SectionHead icon={CheckCircle2} color="#059669" title="② 進捗：終わった？終わってない？" desc="完了・進行中・未着手の内訳と完了チケット" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <p style={subHeadStyle}>ステータス内訳</p>
                {report.statusBreakdown.length === 0 ? <Muted>データがありません</Muted> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={report.statusBreakdown} layout="vertical" margin={{ left: 12, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="#F0F1F2" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                      <YAxis type="category" dataKey="label" width={78} tick={{ fontSize: 11, fill: "#6B7280" }} />
                      <Tooltip cursor={{ fill: "#F9FAFB" }} />
                      <Bar dataKey="count" name="件数" radius={[0, 5, 5, 0]} isAnimationActive={false}>
                        {report.statusBreakdown.map(s => <Cell key={s.key} fill={s.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div>
                <p style={subHeadStyle}>完了したチケット（{report.completed.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 250, overflow: "auto" }}>
                  {report.completed.length === 0 && <Muted>この期間に完了したチケットはありません</Muted>}
                  {report.completed.slice(0, 40).map(t => (
                    <TicketRow key={t.id} t={t} right={STATUS_META[t.status]?.label} rightColor={STATUS_META[t.status]?.color} />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* §3 効率：1チケットあたり */}
          <section style={cardStyle}>
            <SectionHead icon={Clock} color="#D97706" title="③ 効率：1チケットあたり" desc="1件をどれくらいの速さ・工数で終えているか" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
              <Metric label="平均サイクルタイム" value={report.cycleTime} unit="日" hint="着手→完了" />
              <Metric label="1件あたり工数" value={report.pdPerTicket} unit="人日" hint={`約 ${report.hoursPerTicket} 時間/件`} />
              <Metric label="平均リードタイム" value={report.leadTime} unit="日" hint="作成→完了" />
              <Metric label="見積精度" value={report.estimateAccuracy} unit="%" hint="実績/見積" />
            </div>
          </section>

          {/* §4 チーム全体の生産性 */}
          <section style={cardStyle}>
            <SectionHead icon={TrendingUp} color="#7C3AED" title="④ チーム全体の生産性" desc="完了数（スループット）・総工数・推移" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 18 }}>
              <Metric label="スループット" value={report.completed.length} unit="件" hint={`前期比 ${deltaLabel(report.completed.length, report.completedPrev.length)}`} />
              <Metric label="総工数" value={Math.round((report.actSum / 8) * 10) / 10} unit="人日" hint="完了分の実績" />
              <Metric label="完了率" value={report.completionRate} unit="%" hint={`全体 ${report.totalScoped}件`} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: 24 }}>
              <div>
                <p style={subHeadStyle}>スループット推移（直近8週・完了数）</p>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={report.weekBuckets} margin={{ left: -18, right: 8 }}>
                    <defs>
                      <linearGradient id="repTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="#F0F1F2" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9CA3AF" }} />
                    <YAxis tick={{ fontSize: 10, fill: "#9CA3AF" }} allowDecimals={false} width={28} />
                    <Tooltip />
                    <Area type="monotone" dataKey="count" name="完了" stroke="#7C3AED" strokeWidth={2} fill="url(#repTrend)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p style={subHeadStyle}>前期との比較（完了数）</p>
                <CompareBars prev={report.completedPrev.length} cur={report.completed.length} />
              </div>
            </div>
          </section>

          {/* §5 遅れ（リスク） */}
          <section style={cardStyle}>
            <SectionHead icon={AlertTriangle} color="#DC2626" title="⑤ 遅れ（リスク）" desc="期限超過・期限間近のチケット" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <p style={subHeadStyle}>期限超過（{report.overdue.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflow: "auto" }}>
                  {report.overdue.length === 0 && <Muted>期限超過はありません</Muted>}
                  {report.overdue.map(t => (
                    <TicketRow key={t.id} t={t} right={t.dueDate ?? ""} rightColor="#DC2626" alert />
                  ))}
                </div>
              </div>
              <div>
                <p style={subHeadStyle}>期限間近・3日以内（{report.dueSoon.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflow: "auto" }}>
                  {report.dueSoon.length === 0 && <Muted>期限間近のチケットはありません</Muted>}
                  {report.dueSoon.map(t => (
                    <TicketRow key={t.id} t={t} right={t.dueDate ?? ""} rightColor="#D97706" />
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* §6 メンバー個別の生産性 */}
          <section style={cardStyle}>
            <SectionHead icon={Users} color="#0D9488" title="⑥ メンバー個別の生産性" desc="人別の完了数・工数・サイクルタイム・遅延" />
            <MemberTable rows={report.memberStats} />
          </section>

          {/* §7 今後の予定 */}
          <section style={cardStyle}>
            <SectionHead icon={Rocket} color="#2563EB" title="⑦ 今後の予定" desc="来期に期限を迎えるチケットとリリース予定" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <div>
                <p style={subHeadStyle}>来期に期限を迎える（{report.upcoming.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
                  {report.upcoming.length === 0 && <Muted>該当チケットはありません</Muted>}
                  {report.upcoming.slice(0, 30).map(t => (
                    <TicketRow key={t.id} t={t} right={t.dueDate ?? ""} rightColor="#6B7280" />
                  ))}
                </div>
              </div>
              <div>
                <p style={subHeadStyle}>リリース予定（{report.releases.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
                  {report.releases.length === 0 && <Muted>登録されたリリース予定はありません</Muted>}
                  {report.releases.slice(0, 30).map(t => (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#F9FAFB", borderRadius: 8 }}>
                      <Rocket style={{ width: 13, height: 13, color: "#0D9488", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#0D9488", flexShrink: 0, fontFamily: "monospace" }}>{t.releaseDate}</span>
                      <span style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
          {/* アクション */}
          <div className="no-print" style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button onClick={handleDownloadPdf} disabled={pdfBusy}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", background: pdfBusy ? "#9CA3AF" : "#059669", color: "#FFF", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: pdfBusy ? "wait" : "pointer" }}>
              {pdfBusy
                ? <><Loader2 className="rep-spin" style={{ width: 15, height: 15 }} /> PDF生成中{pdfProgress.total ? `（${pdfProgress.current}/${pdfProgress.total}）` : "..."}</>
                : <><Download style={{ width: 15, height: 15 }} /> PDFダウンロード</>}
            </button>
            <button onClick={handleCopy}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "10px 20px", background: "#FFF", color: "#374151", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "1px solid #E5E7EB", cursor: "pointer" }}>
              <Copy style={{ width: 15, height: 15 }} /> 報告文をコピー
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

// ── 小コンポーネント ───────────────────────────────────────────────────────────
const cardStyle: CSSProperties = {
  background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 20, marginBottom: 18,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};
const sectionTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 700, color: "#111827" };
const subHeadStyle: CSSProperties = { fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 10 };
const dateInputStyle: CSSProperties = { padding: "8px 10px", border: "1px solid #E5E7EB", borderRadius: 9, fontSize: 13, color: "#374151", background: "#F9FAFB", outline: "none" };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, color: "#9CA3AF", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>{label}</p>
      {children}
    </div>
  );
}

function SectionHead({ icon: Icon, color, title, desc }: { icon: ElementType; color: string; title: string; desc: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
      <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}14`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon style={{ width: 15, height: 15, color }} />
      </div>
      <div>
        <h3 style={sectionTitleStyle}>{title}</h3>
        <p style={{ fontSize: 11.5, color: "#9CA3AF", marginTop: 1 }}>{desc}</p>
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, color, label, value, unit, sub }: { icon: ElementType; color: string; label: string; value: string; unit: string; sub: string }) {
  return (
    <div style={{ background: "#F9FAFB", border: "1px solid #F0F1F2", borderRadius: 11, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <Icon style={{ width: 14, height: 14, color }} />
        <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 26, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{value}</span>
        <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 600 }}>{unit}</span>
      </div>
      <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>{sub}</p>
    </div>
  );
}

function Metric({ label, value, unit, hint }: { label: string; value: number; unit: string; hint: string }) {
  return (
    <div style={{ background: "#F9FAFB", border: "1px solid #F0F1F2", borderRadius: 11, padding: "14px 16px" }}>
      <p style={{ fontSize: 11.5, color: "#6B7280", fontWeight: 600, marginBottom: 8 }}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 24, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{value}</span>
        <span style={{ fontSize: 12, color: "#9CA3AF", fontWeight: 600 }}>{unit}</span>
      </div>
      <p style={{ fontSize: 10.5, color: "#B0A9A4", marginTop: 4 }}>{hint}</p>
    </div>
  );
}

function TicketRow({ t, right, rightColor, alert }: { t: RepTicket; right?: string; rightColor?: string; alert?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: alert ? "#FEF2F2" : "#F9FAFB", borderRadius: 8, border: alert ? "1px solid #FEE2E2" : "1px solid transparent" }}>
      {alert && <AlertTriangle style={{ width: 13, height: 13, color: "#DC2626", flexShrink: 0 }} />}
      <span style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", fontFamily: "monospace", flexShrink: 0 }}>{t.wbs || "—"}</span>
      <span style={{ fontSize: 12, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
      <span style={{ fontSize: 11, color: "#B0A9A4", flexShrink: 0, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.assignee || ""}</span>
      {right && <span style={{ fontSize: 11, fontWeight: 600, color: rightColor || "#6B7280", flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 12, color: "#B0A9A4", padding: "16px 4px" }}>{children}</p>;
}

function EmptyState() {
  return (
    <div style={{ textAlign: "center", padding: "72px 24px", background: "#FFF", borderRadius: 14, border: "1px dashed #E5E7EB" }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: "#ECFDF5", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
        <FileBarChart2 style={{ width: 26, height: 26, color: "#059669" }} />
      </div>
      <p style={{ fontSize: 15, fontWeight: 700, color: "#374151", marginBottom: 6 }}>期間を指定してください</p>
      <p style={{ fontSize: 13, color: "#9CA3AF", lineHeight: 1.7 }}>
        「任意」を選んだ場合は、開始日と終了日の<br />両方を指定するとレポートが表示されます。
      </p>
    </div>
  );
}

// ── 今週のスケジュール（チケット単位ガント） ──────────────────────────────────
function ReportGantt({ tickets, ticks, todayPct }: { tickets: any[]; ticks: { pct: number; label: string }[]; todayPct: number | null }) {
  if (!tickets || tickets.length === 0) return <Muted>対象期間にスケジュールされたチケットはありません</Muted>;
  const LABEL_W = 240;
  const colorOf = (t: any) => (t.isOverdue ? "#DC2626" : t.isDone ? "#059669" : "#D97706");
  return (
    <div style={{ position: "relative" }}>
      {/* 目盛り */}
      <div style={{ position: "relative", height: 16, marginLeft: LABEL_W, marginBottom: 6 }}>
        {ticks.map((tk, i) => (
          <span key={i} style={{ position: "absolute", left: `${tk.pct}%`, transform: "translateX(-50%)", fontSize: 10, color: "#9CA3AF" }}>{tk.label}</span>
        ))}
      </div>
      <div style={{ maxHeight: 380, overflow: "auto" }}>
        {tickets.map(t => (
          <div key={t.id} style={{ display: "flex", alignItems: "center", height: 26 }}>
            <div style={{ width: LABEL_W, flexShrink: 0, paddingRight: 10, display: "flex", gap: 6, alignItems: "center", overflow: "hidden" }}>
              <span style={{ fontSize: 10, fontFamily: "monospace", color: "#9CA3AF", flexShrink: 0 }}>{t.wbs || "—"}</span>
              <span style={{ fontSize: 11, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
            </div>
            <div style={{ position: "relative", flex: 1, height: "100%" }}>
              <div style={{ position: "absolute", top: 6, left: `${t.leftPct}%`, width: `${t.widthPct}%`, height: 13, background: colorOf(t), borderRadius: 4, opacity: t.isDone ? 0.85 : 1 }} />
            </div>
          </div>
        ))}
      </div>
      {todayPct != null && (
        <div style={{ position: "absolute", top: 22, bottom: 28, left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${todayPct / 100})`, width: 2, background: "#DC2626", opacity: 0.5 }} />
      )}
      <div style={{ display: "flex", gap: 16, marginTop: 12, marginLeft: LABEL_W }}>
        {([["完了", "#059669"], ["進行中", "#D97706"], ["遅延", "#DC2626"]] as [string, string][]).map(([l, c]) => (
          <span key={l} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#6B7280" }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: c }} />{l}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── メンバー個別の生産性テーブル ──────────────────────────────────────────────
function MemberTable({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return <Muted>データがありません</Muted>;
  const cell: CSSProperties = { fontSize: 12, color: "#374151", padding: "9px 10px" };
  const head: CSSProperties = { fontSize: 11, fontWeight: 700, color: "#9CA3AF", padding: "6px 10px", textAlign: "left" };
  const num: CSSProperties = { ...cell, textAlign: "right" };
  return (
    <div style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #EEF0F1" }}>
            <th style={head}>メンバー</th>
            <th style={{ ...head, textAlign: "right" }}>完了数</th>
            <th style={{ ...head, textAlign: "right" }}>工数</th>
            <th style={{ ...head, textAlign: "right" }}>平均サイクル</th>
            <th style={{ ...head, textAlign: "right" }}>遅延</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(m => (
            <tr key={m.name} style={{ borderBottom: "1px solid #F4F5F6" }}>
              <td style={cell}>{m.name}</td>
              <td style={{ ...num, fontWeight: 700 }}>{m.count}件</td>
              <td style={num}>{formatPersonDays(m.hours)}</td>
              <td style={num}>{m.avgCycle}日</td>
              <td style={{ ...num, color: m.overdue > 0 ? "#DC2626" : "#9CA3AF", fontWeight: m.overdue > 0 ? 700 : 400 }}>{m.overdue}件</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── ガント右の「今週の状況」サマリーパネル ──────────────────────────────────
function GanttSidePanel({ tickets }: { tickets: any[] }) {
  const total = tickets.length;
  const done = tickets.filter(t => t.isDone).length;
  const overdue = tickets.filter(t => t.isOverdue).length;
  const inProgress = total - done - overdue;
  const rate = total ? Math.round((done / total) * 100) : 0;
  const items: [string, number, string][] = [
    ["完了", done, "#059669"],
    ["進行中", inProgress, "#D97706"],
    ["遅延", overdue, "#DC2626"],
  ];
  return (
    <div style={{ width: 240, flexShrink: 0, background: "#F9FAFB", border: "1px solid #F0F1F2", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", justifyContent: "center" }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "#6B7280", marginBottom: 10 }}>今週の状況</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 14 }}>
        <span style={{ fontSize: 30, fontWeight: 800, color: "#111827", letterSpacing: "-0.02em" }}>{total}</span>
        <span style={{ fontSize: 13, color: "#9CA3AF", fontWeight: 600 }}>件 が対象</span>
      </div>
      {items.map(([label, n, color]) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: "#6B7280", flex: 1 }}>{label}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{n}件</span>
        </div>
      ))}
      <div style={{ height: 1, background: "#EEF0F1", margin: "8px 0 10px" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#6B7280" }}>完了率</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: "#059669" }}>{rate}%</span>
      </div>
    </div>
  );
}

// ── 前期比較バー ──────────────────────────────────────────────────────────────
function CompareBars({ prev, cur }: { prev: number; cur: number }) {
  const max = Math.max(1, prev, cur);
  const rows: [string, number, string][] = [
    ["前期", prev, "#C9C4BB"],
    ["今期", cur, "#7C3AED"],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
      {rows.map(([label, n, color]) => (
        <div key={label}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>{n}件</span>
          </div>
          <div style={{ height: 16, background: "#F3F4F6", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ width: `${Math.max(2, (n / max) * 100)}%`, height: "100%", background: color, borderRadius: 6 }} />
          </div>
        </div>
      ))}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
        <span style={{ fontSize: 12, color: "#6B7280" }}>前期比</span>
        <span style={{ fontSize: 15, fontWeight: 800, color: cur >= prev ? "#059669" : "#DC2626" }}>{deltaLabel(cur, prev)}</span>
      </div>
    </div>
  );
}
