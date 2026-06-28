import { useEffect, useMemo, useRef, useState, type ElementType, type CSSProperties, type ReactNode } from "react";
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
import { copyText } from "@/lib/clipboard";
import { TICKETS, PROJECTS, SPRINTS } from "@/app/data/mock";
import { mapSprintTicket } from "@/app/lib/mappers";
import { TicketDetailPanel } from "@/app/components/tickets/TicketDetailPanel";
import { calcTicketActualHours, formatPersonDays } from "@/app/lib/helpers";
import type { SprintTicket, SprintStatus } from "@/app/types";

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

const ISSUE_LEVEL = {
  high:   { label: "要対応", color: "#DC2626", bg: "#FEF2F2", border: "#FEE2E2" },
  medium: { label: "注意",   color: "#D97706", bg: "#FFFBEB", border: "#FDE68A" },
  low:    { label: "改善",   color: "#2563EB", bg: "#EFF6FF", border: "#DBEAFE" },
} as const;

type PeriodMode = "weekly" | "monthly" | "custom";

// レポート対象に紐づくチケット（プロジェクト情報を付与）
type RepTicket = SprintTicket & { projectId: string; projectName: string; sprintId?: string };
type RepSprintTicket = { id: string; wbs: string; title: string; status: string; startDate: string; dueDate: string };
type RepSprint = { id: string; projectId: string; name: string; identifier: string; status: SprintStatus; startDate: string; endDate: string; tickets: RepSprintTicket[] };

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
      sprintId: t.sprintId,
    } as RepTicket;
  });
}

export function ReportsPage() {
  const { userPermissions, userRole, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const { toast } = useToast();

  const [allTickets, setAllTickets] = useState<RepTicket[]>(isSupabaseEnabled ? [] : buildMockData());
  const [allSprints, setAllSprints] = useState<RepSprint[]>(
    isSupabaseEnabled ? [] : SPRINTS.map(s => ({
      id: s.id, projectId: s.projectId, name: s.name, identifier: s.identifier, status: s.status, startDate: s.startDate, endDate: s.endDate,
      tickets: s.tickets.map(t => ({ id: t.id, wbs: t.wbs, title: t.title, status: t.status, startDate: t.startDate, dueDate: t.dueDate })),
    }))
  );
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>(
    isSupabaseEnabled ? [] : PROJECTS.map(p => ({ id: p.id, name: p.name }))
  );
  const [loading, setLoading] = useState(isSupabaseEnabled);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedTicket, setSelectedTicket] = useState<RepTicket | null>(null);
  // チケットを id で開く（ガント・課題ポップアップなど、id しか持たない箇所から）
  const openTicketById = (id: string) => { const t = allTickets.find(x => x.id === id); if (t) setSelectedTicket(t); };

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
  const didInitialLoad = useRef(false);
  useEffect(() => {
    if (!isSupabaseEnabled || !canAccess) { setLoading(false); return; }
    // 初回だけ「読み込み中」を表示。以降の再取得は画面を出したまま裏で更新する（ブランクさせない）
    if (!didInitialLoad.current) setLoading(true);
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
          supabase!.from("sprints").select("id, project_id, name, identifier, status, start_date, end_date"),
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
            return { ...mapSprintTicket(r), projectId: pid, projectName: projName.get(pid) ?? "—", sprintId: r.sprint_id ?? undefined } as RepTicket;
          })
          .filter(t => allowedProjects.has(t.projectId));

        const ticketsBySprint = new Map<string, any[]>();
        for (const r of rawTickets) {
          if (!r.sprint_id) continue;
          const arr = ticketsBySprint.get(r.sprint_id) ?? [];
          arr.push(r);
          ticketsBySprint.set(r.sprint_id, arr);
        }
        const mappedSprints: RepSprint[] = sprints
          .filter(s => allowedProjects.has(s.project_id))
          .map(s => ({
            id: s.id, projectId: s.project_id, name: s.name ?? "", identifier: s.identifier ?? "", status: s.status as SprintStatus, startDate: s.start_date, endDate: s.end_date,
            tickets: (ticketsBySprint.get(s.id) ?? []).map(r => { const t = mapSprintTicket(r); return { id: t.id, wbs: t.wbs, title: t.title, status: t.status, startDate: t.startDate, dueDate: t.dueDate }; }),
          }));

        setAllTickets(mapped);
        setAllSprints(mappedSprints);
        setProjectOptions(projects.map(p => ({ id: p.id, name: p.name })));
      } catch (err) {
        console.error("Failed to load report data:", err);
        toast("レポートデータの取得に失敗しました", "error");
      } finally {
        didInitialLoad.current = true;
        setLoading(false);
      }
    })();
  }, [canAccess, userRole, userOrgId, selectedOrgId, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
    // 1日 = 1セルのグリッド表示。各チケットが「何日目から何日分」のセルを占めるかを算出する。
    const DAY_MS = 86400000;
    const tlDays = Math.max(1, Math.round(span / DAY_MS));
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
      // 開始日のセル〜終了日のセルを塗る（単日なら1セル、2日にまたがれば2セル）
      const dayStart = Math.min(tlDays - 1, Math.max(0, Math.floor((cs - tlStart) / DAY_MS)));
      const dayEnd = Math.min(tlDays - 1, Math.max(0, Math.floor((ce - tlStart) / DAY_MS)));
      return {
        id: t.id, wbs: t.wbs, title: t.title, assignee: t.assignee, status: t.status, isDone, isOverdue,
        dayStart,
        daySpan: dayEnd - dayStart + 1,
      };
    }).filter(Boolean).sort((a, b) => (a!.dayStart - b!.dayStart)) as any[];
    // ── ガント：対象期間（スポットライト）の前後にも文脈日を表示する広いウィンドウ用データ ──
    // スプリント単位で俯瞰する。表示しうる範囲だけ保持し、列数は描画側が表示幅に応じて決める。
    const ganttFloor = tlStart - 80 * DAY_MS;   // 過去側に表示しうる上限（週単位の月次ビューでも足りる範囲）
    const ganttCeil = tlEnd + 300 * DAY_MS;     // 未来側に表示しうる上限
    const scopedSprints = scope === "all" ? allSprints : allSprints.filter(s => s.projectId === scope);
    const ganttRows = scopedSprints.map(s => {
      const startMs = parseD(s.startDate);
      const endMs = parseD(s.endDate);
      if (startMs == null || endMs == null) return null;
      if (endMs < ganttFloor || startMs > ganttCeil) return null;
      const isDone = s.status === "completed";
      const isOverdue = !isDone && (s.status === "delayed" || endMs < nowMs);
      // 子チケット（アコーディオン展開用）。開始/期限が未入力のチケットはスプリント期間にフォールバックして必ずバーを出す。
      const children = s.tickets.map(t => {
        const ownStart = parseD(t.startDate) ?? parseD(t.dueDate);
        const ownEnd = parseD(t.dueDate) ?? parseD(t.startDate);
        const hasOwnDate = ownStart != null || ownEnd != null;
        const ts = ownStart ?? startMs;   // 無ければスプリント開始
        const te = ownEnd ?? endMs;       // 無ければスプリント終了
        const cIsDone = TERMINAL_STATUSES.includes(t.status);
        const cIsOverdue = !cIsDone && te < nowMs;
        return {
          id: t.id, wbs: t.wbs, title: t.title, isDone: cIsDone, isOverdue: cIsOverdue, hasOwnDate,
          startMs: Math.min(ts, te),
          endMs: Math.max(ts, te),
        };
      });
      return { id: s.id, wbs: s.identifier, title: s.name, status: s.status, isDone, isOverdue, startMs, endMs: Math.max(startMs, endMs), children };
    }).filter(Boolean).sort((a, b) => a!.startMs - b!.startMs) as any[];
    const spotlightLabel = periodMode === "weekly" ? "今週" : periodMode === "monthly" ? "今月" : "対象期間";

    // ── 現在の課題と対策（メトリクスから自動抽出） ──
    const fmtMD = (ms: number) => { const d = new Date(ms); return `${d.getMonth() + 1}/${d.getDate()}`; };
    const prevPeriodName = periodMode === "weekly" ? "前週" : periodMode === "monthly" ? "前月" : "前期間";
    const prevRangeLabel = `${fmtMD(prevStart.getTime())}〜${fmtMD(prevEnd.getTime() - 86400000)}`;
    const delayedSprintList = ganttRows.filter(s => s.isOverdue);
    const undatedList = activeTickets.filter(t => !t.dueDate);
    const tItems = (arr: RepTicket[], right: (t: RepTicket) => string, alert: boolean) =>
      arr.map(t => ({ id: t.id, ticketId: t.id, wbs: t.wbs, title: t.title, assignee: t.assignee, right: right(t), alert }));
    const issues: { level: "high" | "medium" | "low"; title: string; action: string; items?: { id: string; ticketId?: string; wbs: string; title: string; assignee?: string; right?: string; alert?: boolean }[] }[] = [];
    // チケット単位：個々のチケットが期限日を過ぎている
    if (overdue.length > 0) issues.push({ level: "high", title: `期限切れ（期限日を過ぎた）の未完了チケットが ${overdue.length}件 あります。`, action: "担当者と期限を再確認し、優先度を上げて即時対応してください。実態に合わない期限は現実的な日付へ再設定します。", items: tItems(overdue, t => t.dueDate || "", true) });
    // スプリント単位：スプリント全体が終了日を過ぎても完了していない
    if (delayedSprintList.length > 0) issues.push({ level: "high", title: `終了日を過ぎても完了していないスプリントが ${delayedSprintList.length}件 あります。`, action: "未完了タスクの次スプリントへの送り（スコープ調整）と、遅延要因の振り返りを行ってください。", items: delayedSprintList.map(s => ({ id: s.id, wbs: s.wbs, title: s.title, right: `終了 ${fmtMD(s.endMs)}`, alert: true })) });
    if (dueSoon.length > 0) issues.push({ level: "medium", title: `3日以内に期限を迎える未完了チケットが ${dueSoon.length}件 あります。`, action: "進捗を確認し、リスクのあるタスクは前倒し対応または応援を手配してください。", items: tItems(dueSoon, t => t.dueDate || "", false) });
    if (estimateAccuracy > 120) issues.push({ level: "medium", title: `実績工数が見積を ${estimateAccuracy - 100}% 上回っています。`, action: "見積基準を見直し、不確実性の高いタスクにはバッファを設定してください。" });
    if (memberLoad.length >= 2) {
      const top = memberLoad[0];
      const avgPd = memberLoad.reduce((a, m) => a + m.pd, 0) / memberLoad.length;
      if (top.name !== "未割当" && top.pd > avgPd * 1.5) issues.push({ level: "medium", title: `${top.name} に作業が集中しています（${formatPersonDays(top.hours)}）。`, action: "タスクの再分配やレビュー分担で負荷を平準化してください。" });
    }
    if (completedPrev.length > 0 && completed.length < completedPrev.length * 0.85) issues.push({ level: "medium", title: `完了件数が${prevPeriodName}（${prevRangeLabel}）より減少しています（${completed.length}件 ← ${completedPrev.length}件）。`, action: "レビュー待ち・仕様確認待ちなどの滞留ポイントを特定し、フローを改善してください。" });
    if (undatedList.length > 0) issues.push({ level: "low", title: `開始日・期限が未設定の未完了チケットが ${undatedList.length}件 あります。`, action: "スケジュール精度向上のため、各チケットに開始日・期限を設定してください（未設定はガントで推定表示になります）。", items: tItems(undatedList, () => "未設定", false) });

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
      scheduleTickets, ganttRows, spotlightLabel, periodStart: tlStart, periodEnd: tlEnd, nowMs, hoursPerTicket, pdPerTicket, memberStats, issues,
    };
  }, [periodMode, customStart, customEnd, scope, allTickets, allSprints]);

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
    if (await copyText(`${head}\n\n${kpi}\n\n${body}`)) {
      toast("報告文をコピーしました");
    } else {
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
            <SectionHead icon={CalendarRange} color="#0EA5E9" title="① 今週のスケジュール" desc="対象期間のスプリントを俯瞰（色＝状態：完了 / 進行中 / 遅延）" />
            <div style={{ display: "flex", gap: 20, alignItems: "stretch" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ReportGantt sprints={report.ganttRows} periodStart={report.periodStart} periodEnd={report.periodEnd} nowMs={report.nowMs} spotlightLabel={report.spotlightLabel} onPickTicket={openTicketById} unit={periodMode === "monthly" || (periodMode === "custom" && report.periodEnd - report.periodStart >= 28 * 86400000) ? "week" : "day"} />
              </div>
              <GanttSidePanel tickets={report.scheduleTickets} />
            </div>
          </section>

          {/* §2 進捗：終わった？終わってない？ */}
          <section style={cardStyle}>
            <SectionHead icon={CheckCircle2} color="#059669" title="② 進捗：終わった？終わってない？" desc="完了・進行中・未着手の内訳と完了チケット" />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20 }}>
              <div style={{ minWidth: 0 }}>
                <p style={subHeadStyle}>ステータス内訳</p>
                {report.statusBreakdown.length === 0 ? <Muted>データがありません</Muted> : (
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={report.statusBreakdown} layout="vertical" margin={{ left: 12, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="#F0F1F2" />
                      <XAxis type="number" tick={{ fontSize: 11, fill: "#9CA3AF" }} allowDecimals={false} />
                      <YAxis type="category" dataKey="label" width={78} tick={{ fontSize: 11, fill: "#6B7280" }} />
                      <Tooltip cursor={{ fill: "#F9FAFB" }} content={<ChartTooltip />} />
                      <Bar dataKey="count" name="件数" radius={[0, 5, 5, 0]} isAnimationActive={false}>
                        {report.statusBreakdown.map(s => <Cell key={s.key} fill={s.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ minWidth: 0 }}>
                <p style={subHeadStyle}>完了したチケット（{report.completed.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 250, overflowY: "auto", overflowX: "hidden" }}>
                  {report.completed.length === 0 && <Muted>この期間に完了したチケットはありません</Muted>}
                  {report.completed.slice(0, 40).map(t => (
                    <TicketRow key={t.id} t={t} right={STATUS_META[t.status]?.label} rightColor={STATUS_META[t.status]?.color} onClick={() => setSelectedTicket(t)} />
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
                    <Tooltip cursor={{ stroke: "#E5E7EB", strokeWidth: 1 }} content={<ChartTooltip />} />
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
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20 }}>
              <div>
                <p style={subHeadStyle}>期限超過（{report.overdue.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflow: "auto" }}>
                  {report.overdue.length === 0 && <Muted>期限超過はありません</Muted>}
                  {report.overdue.map(t => (
                    <TicketRow key={t.id} t={t} right={t.dueDate ?? ""} rightColor="#DC2626" alert onClick={() => setSelectedTicket(t)} />
                  ))}
                </div>
              </div>
              <div>
                <p style={subHeadStyle}>期限間近・3日以内（{report.dueSoon.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflow: "auto" }}>
                  {report.dueSoon.length === 0 && <Muted>期限間近のチケットはありません</Muted>}
                  {report.dueSoon.map(t => (
                    <TicketRow key={t.id} t={t} right={t.dueDate ?? ""} rightColor="#D97706" onClick={() => setSelectedTicket(t)} />
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
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20 }}>
              <div>
                <p style={subHeadStyle}>来期に期限を迎える（{report.upcoming.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
                  {report.upcoming.length === 0 && <Muted>該当チケットはありません</Muted>}
                  {report.upcoming.slice(0, 30).map(t => (
                    <TicketRow key={t.id} t={t} right={t.dueDate ?? ""} rightColor="#6B7280" onClick={() => setSelectedTicket(t)} />
                  ))}
                </div>
              </div>
              <div>
                <p style={subHeadStyle}>リリース予定（{report.releases.length}件）</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 240, overflow: "auto" }}>
                  {report.releases.length === 0 && <Muted>登録されたリリース予定はありません</Muted>}
                  {report.releases.slice(0, 30).map(t => (
                    <div key={t.id} onClick={() => setSelectedTicket(t)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "#F9FAFB", borderRadius: 8, cursor: "pointer" }}>
                      <Rocket style={{ width: 13, height: 13, color: "#0D9488", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#0D9488", flexShrink: 0, fontFamily: "monospace" }}>{t.releaseDate}</span>
                      <span style={{ fontSize: 12, color: "#374151", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* §8 現在の課題と対策 */}
          <section style={cardStyle}>
            <SectionHead icon={AlertTriangle} color="#DC2626" title="⑧ 現在の課題と対策" desc="メトリクスから自動抽出した課題と、推奨される対策" />
            {report.issues.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px", background: "#ECFDF5", border: "1px solid #D1FAE5", borderRadius: 10 }}>
                <CheckCircle2 style={{ width: 18, height: 18, color: "#059669", flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: "#065F46", fontWeight: 600 }}>現在、対応が必要な大きな課題はありません。計画通りに推移しています。</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {report.issues.map((iss, idx) => <IssueRow key={idx} iss={iss} onPick={openTicketById} />)}
              </div>
            )}
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

      {/* チケット詳細（右からスライドイン。画面遷移せずこの画面のまま表示） */}
      {selectedTicket && (
        <TicketDetailPanel
          ticket={selectedTicket}
          projectId={selectedTicket.projectId}
          sprintId={selectedTicket.sprintId}
          onClose={() => setSelectedTicket(null)}
          onUpdated={() => setRefreshKey(k => k + 1)}
          onDeleted={() => { setSelectedTicket(null); setRefreshKey(k => k + 1); }}
          onSelectTicket={(t) => openTicketById(t.id)}
        />
      )}
    </div>
  );
}

// グラフ共通のオリジナルツールチップ（ブラウザ標準っぽさを排除）
function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#FFF", border: "1px solid #ECEEF1", borderRadius: 10, boxShadow: "0 8px 24px rgba(16,24,40,0.14)", padding: "9px 12px" }}>
      {label != null && label !== "" && <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#111827" }}>{label}</p>}
      {payload.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color || p.payload?.color || "#6B7280", flexShrink: 0 }} />
          <span style={{ color: "#6B7280" }}>{p.name}</span>
          <span style={{ marginLeft: 14, fontWeight: 800, color: "#111827" }}>{p.value}<span style={{ fontSize: 10, fontWeight: 600, color: "#9CA3AF", marginLeft: 2 }}>件</span></span>
        </div>
      ))}
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

// 課題カード（対象がある場合はホバーで一覧表示。下に出すと見づらい位置では上に出す）
type IssueItem = { id: string; ticketId?: string; wbs: string; title: string; assignee?: string; right?: string; alert?: boolean };
function IssueRow({ iss, onPick }: { iss: { level: "high" | "medium" | "low"; title: string; action: string; items?: IssueItem[] }; onPick?: (id: string) => void }) {
  const [hover, setHover] = useState(false);
  const [placeTop, setPlaceTop] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const m = ISSUE_LEVEL[iss.level];
  const list = iss.items ?? [];
  const hasList = list.length > 0;
  const onEnter = () => {
    const el = rootRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      // 下に出すスペースが足りず、上の方が広いなら上に出す
      setPlaceTop(spaceBelow < 340 && rect.top > spaceBelow);
    }
    setHover(true);
  };
  return (
    <div ref={rootRef} style={{ position: "relative" }} onMouseEnter={onEnter} onMouseLeave={() => setHover(false)}>
      <div style={{ display: "flex", gap: 12, padding: "14px 16px", background: m.bg, border: `1px solid ${m.border}`, borderRadius: 10, cursor: hasList ? "help" : "default" }}>
        <span style={{ flexShrink: 0, alignSelf: "flex-start", marginTop: 1, fontSize: 11, fontWeight: 700, color: "#FFF", background: m.color, borderRadius: 6, padding: "2px 8px", whiteSpace: "nowrap" }}>{m.label}</span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#1F2937", margin: 0 }}>
            {iss.title}
            {hasList && <span style={{ fontSize: 11, fontWeight: 600, color: m.color, marginLeft: 6, opacity: 0.85 }}>（ホバーで対象を表示）</span>}
          </p>
          <p style={{ fontSize: 12.5, color: "#4B5563", margin: "5px 0 0", display: "flex", gap: 7 }}>
            <span style={{ color: m.color, fontWeight: 700, flexShrink: 0 }}>対策</span>
            <span>{iss.action}</span>
          </p>
        </div>
      </div>
      {hasList && hover && (
        <div style={{ position: "absolute", zIndex: 50, left: 0, right: 0, display: "flex", flexDirection: "column", ...(placeTop ? { bottom: "100%" } : { top: "100%" }) }}>
          {/* カードとの隙間を埋める透明ブリッジ（ここを通ってもホバーが切れない） */}
          {!placeTop && <div style={{ height: 4, flexShrink: 0 }} />}
          <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 10, boxShadow: "0 12px 28px rgba(16,24,40,0.16)", padding: 8, maxHeight: 300, overflowY: "auto" }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", margin: "2px 6px 8px" }}>対象（{list.length}件）</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.slice(0, 50).map(it => {
                const pick = it.ticketId && onPick ? () => onPick(it.ticketId!) : undefined;
                return (
                <div key={it.id} onClick={pick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: it.alert ? "#FEF2F2" : "#F9FAFB", borderRadius: 8, border: it.alert ? "1px solid #FEE2E2" : "1px solid transparent", cursor: pick ? "pointer" : "default" }}>
                  {it.alert && <AlertTriangle style={{ width: 13, height: 13, color: "#DC2626", flexShrink: 0 }} />}
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", fontFamily: "monospace", flexShrink: 0 }}>{it.wbs || "—"}</span>
                  <span style={{ fontSize: 12, color: "#374151", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</span>
                  {it.assignee && <span style={{ fontSize: 11, color: "#B0A9A4", flexShrink: 0, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.assignee}</span>}
                  {it.right && <span style={{ fontSize: 11, fontWeight: 600, color: it.right === "未設定" ? "#9CA3AF" : m.color, flexShrink: 0 }}>{it.right}</span>}
                </div>
                );
              })}
              {list.length > 50 && <p style={{ fontSize: 11, color: "#9CA3AF", margin: "4px 6px 2px" }}>ほか {list.length - 50}件</p>}
            </div>
          </div>
          {placeTop && <div style={{ height: 4, flexShrink: 0 }} />}
        </div>
      )}
    </div>
  );
}

function TicketRow({ t, right, rightColor, alert, onClick }: { t: RepTicket; right?: string; rightColor?: string; alert?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: alert ? "#FEF2F2" : "#F9FAFB", borderRadius: 8, border: alert ? "1px solid #FEE2E2" : "1px solid transparent", cursor: onClick ? "pointer" : "default" }}>
      {alert && <AlertTriangle style={{ width: 13, height: 13, color: "#DC2626", flexShrink: 0 }} />}
      <span style={{ fontSize: 11, fontWeight: 700, color: "#9CA3AF", fontFamily: "monospace", flexShrink: 0 }}>{t.wbs || "—"}</span>
      <span style={{ fontSize: 12, color: "#374151", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
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
function ReportGantt({ sprints, periodStart, periodEnd, nowMs, spotlightLabel, onPickTicket, unit = "day" }: { sprints: any[]; periodStart: number; periodEnd: number; nowMs: number; spotlightLabel: string; onPickTicket?: (id: string) => void; unit?: "day" | "week" }) {
  const DAY = 86400000;
  const LABEL_W = 240;
  const CELL = 28;            // セルは縦横同じ長さ（正方形）
  const ACCENT = "#3B82F6";   // 対象期間（スポットライト）のアクセント色
  const UNIT_DAYS = unit === "week" ? 7 : 1;       // 1セルの粒度（週次=1日 / 月次=1週間）
  const UNIT = UNIT_DAYS * DAY;
  const PAST_UNITS = unit === "week" ? 9 : 14;     // 対象期間の前に出す文脈（週単位なら約2ヶ月、日単位なら2週間）

  // 表示幅を実測し、未来側の列数を「幅が許す限り」に決める
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set()); // 展開中のスプリントID（初期は全て閉じる）
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // 列構成：過去（PAST_UNITS）＋ 対象期間 ＋ 未来（表示幅が許す限り、最低3列）。横スクロールは出さない。
  const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const startOfUnit = (ms: number) => {
    const d0 = startOfDay(ms);
    if (unit !== "week") return d0;
    const dow = (new Date(d0).getDay() + 6) % 7; // 月曜=0 に揃える
    return d0 - dow * DAY;
  };
  const winStart = startOfUnit(periodStart) - PAST_UNITS * UNIT;
  const colOf = (ms: number) => Math.floor((ms - winStart) / UNIT);
  const spotStart = Math.max(0, colOf(periodStart));
  const spotEnd = Math.max(spotStart, colOf(periodEnd - 1));
  const spotCols = spotEnd - spotStart + 1;
  const minCols = spotEnd + 1 + 3;
  const fitCols = avail > LABEL_W ? Math.floor((avail - LABEL_W) / CELL) : minCols + 7;
  const totalCols = Math.max(minCols, fitCols);
  const winEnd = winStart + totalCols * UNIT;
  const todayCol = nowMs >= winStart && nowMs < winEnd ? colOf(nowMs) : -1;

  const columns = Array.from({ length: totalCols }, (_, i) => {
    const ms = winStart + i * UNIT;
    const d = new Date(ms);
    return {
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      spotlight: i >= spotStart && i <= spotEnd,
      today: i === todayCol,
      first: i === spotStart,
      last: i === spotEnd,
    };
  });

  // 占有セル範囲（ウィンドウ内にクランプ）。日付なし／範囲外は null（バー無し）。
  const cellsOf = (startMs: number | null, endMs: number | null) => {
    if (startMs == null || endMs == null || endMs < winStart || startMs >= winEnd) return null;
    const dayStart = Math.max(0, colOf(startMs));
    const dayEnd = Math.min(totalCols - 1, colOf(endMs));
    return { dayStart, daySpan: Math.max(1, dayEnd - dayStart + 1) };
  };

  // 可視ウィンドウに重なるスプリントだけ表示。展開中はその子チケット行を続けて並べる。
  const visibleSprints = sprints
    .filter(s => s.endMs >= winStart && s.startMs < winEnd)
    .sort((a, b) => a.startMs - b.startMs);

  const rows: any[] = [];
  for (const s of visibleSprints) {
    const open = expanded.has(s.id);
    rows.push({ kind: "sprint", key: s.id, id: s.id, wbs: s.wbs, title: s.title, isDone: s.isDone, isOverdue: s.isOverdue, cells: cellsOf(s.startMs, s.endMs), childCount: s.children?.length ?? 0, open });
    if (open) {
      for (const c of (s.children ?? [])) {
        rows.push({ kind: "ticket", key: `${s.id}/${c.id}`, id: c.id, wbs: c.wbs, title: c.title, isDone: c.isDone, isOverdue: c.isOverdue, hasOwnDate: c.hasOwnDate, cells: cellsOf(c.startMs, c.endMs) });
      }
    }
  }

  const colorOf = (t: any) => (t.isOverdue ? "#E5484D" : t.isDone ? "#30A46C" : "#E08C00");
  const trackW = totalCols * CELL;
  const gridLine = `repeating-linear-gradient(to right, #EEF1F4 0, #EEF1F4 1px, transparent 1px, transparent ${CELL}px)`;

  return (
    <div ref={ref} style={{ overflowX: "hidden", position: "relative", paddingTop: 22 }}>
      {visibleSprints.length === 0 ? (
        <div style={{ marginTop: 8 }}><Muted>表示範囲にスケジュールされたスプリントはありません</Muted></div>
      ) : (
        <div style={{ width: "max-content" }}>
          {/* 対象期間ピル（ヘッダー上） */}
          <div style={{ position: "absolute", top: 0, left: LABEL_W + spotStart * CELL, width: spotCols * CELL, display: "flex", justifyContent: "center" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: ACCENT, background: "#EFF6FF", border: "1px solid #DBEAFE", borderRadius: 999, padding: "1px 10px", whiteSpace: "nowrap" }}>{spotlightLabel}</span>
          </div>

          {/* 日付ヘッダー */}
          <div style={{ display: "flex", paddingBottom: 7 }}>
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            {columns.map((c, i) => (
              <div key={i} style={{ width: CELL, flexShrink: 0, textAlign: "center", lineHeight: "14px", fontSize: 9.5, color: c.today ? "#E5484D" : c.spotlight ? ACCENT : "#A6ADBA", fontWeight: c.today || c.spotlight ? 700 : 500 }}>{c.label}</div>
            ))}
          </div>

          {/* グリッド本体 */}
          <div style={{ maxHeight: 430, overflowY: "auto", overflowX: "hidden", border: "1px solid #ECEEF1", borderRadius: 12, background: "#FAFBFC" }}>
            <div style={{ position: "relative", width: LABEL_W + trackW }}>
              {/* 今週スポットライト帯 */}
              <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W + spotStart * CELL, width: spotCols * CELL, background: "#FFFFFF", boxShadow: "inset 0 0 0 1px rgba(59,130,246,0.16)", zIndex: 0, pointerEvents: "none" }} />
              {/* 今日の列ハイライト */}
              {todayCol >= 0 && (
                <div style={{ position: "absolute", top: 0, bottom: 0, left: LABEL_W + todayCol * CELL, width: CELL, background: "rgba(229,72,77,0.07)", zIndex: 0, pointerEvents: "none" }} />
              )}

              {rows.map(r => {
                const isSprint = r.kind === "sprint";
                const clickable = isSprint && r.childCount > 0;       // スプリント：子があれば展開
                const pickable = !isSprint && !!onPickTicket;          // チケット：クリックで詳細
                const color = colorOf(r);
                const barH = isSprint ? 15 : 10;
                const dim = !isSprint && !r.hasOwnDate; // 日付未入力（スプリント期間で推定）
                return (
                  <div
                    key={r.key}
                    onClick={isSprint ? (clickable ? () => toggle(r.id) : undefined) : () => onPickTicket?.(r.id)}
                    style={{ position: "relative", zIndex: 1, display: "flex", height: CELL, cursor: (clickable || pickable) ? "pointer" : "default" }}
                  >
                    {/* 行ラベル */}
                    <div style={{ width: LABEL_W, height: CELL, flexShrink: 0, paddingRight: 10, paddingLeft: isSprint ? 10 : 30, display: "flex", gap: 7, alignItems: "center", overflow: "hidden", boxSizing: "border-box", background: "#FFFFFF", borderRight: "1px solid #ECEEF1", borderBottom: "1px solid #F1F3F5" }}>
                      {isSprint && (
                        <span style={{ flexShrink: 0, fontSize: 9, color: r.childCount > 0 ? "#9AA2AF" : "transparent", transform: r.open ? "rotate(90deg)" : "none", transition: "transform .12s ease", display: "inline-block", width: 8 }}>▶</span>
                      )}
                      <span style={{ fontSize: 9.5, fontFamily: "ui-monospace, monospace", color: "#AEB4BE", flexShrink: 0 }}>{r.wbs || "—"}</span>
                      <span style={{ fontSize: isSprint ? 11.5 : 10.5, fontWeight: isSprint ? 600 : 400, color: isSprint ? "#384150" : "#6B7280", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
                    </div>
                    {/* タイムライン・トラック（薄いグリッド線＋連続バー） */}
                    <div style={{ position: "relative", width: trackW, height: CELL, flexShrink: 0, borderBottom: "1px solid #F1F3F5", boxSizing: "border-box", backgroundImage: gridLine }}>
                      {r.cells && (
                        <div
                          title={isSprint ? r.title : (r.hasOwnDate ? r.title : `${r.title}（期限未入力・スプリント期間で表示）`)}
                          style={{
                            position: "absolute",
                            left: r.cells.dayStart * CELL + 2,
                            width: Math.max(CELL - 4, r.cells.daySpan * CELL - 4),
                            top: (CELL - barH) / 2,
                            height: barH,
                            // 自分の日付を持つ＝塗りバー / 日付未入力＝枠線のみのゴーストバー
                            background: dim ? `${color}14` : color,
                            borderRadius: barH / 2,
                            boxShadow: dim ? "none" : "0 1px 2px rgba(16,24,40,0.12)",
                            border: dim ? `1.5px dashed ${color}` : undefined,
                            boxSizing: "border-box",
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 凡例 */}
          <div style={{ display: "flex", gap: 16, marginTop: 12, marginLeft: LABEL_W }}>
            {([["完了", "#30A46C"], ["進行中", "#E08C00"], ["遅延", "#E5484D"]] as [string, string][]).map(([l, c]) => (
              <span key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6B7280" }}>
                <span style={{ width: 11, height: 7, borderRadius: 4, background: c }} />{l}
              </span>
            ))}
          </div>
        </div>
      )}
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
