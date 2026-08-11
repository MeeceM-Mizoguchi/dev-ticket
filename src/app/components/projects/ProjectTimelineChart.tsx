import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import type { Project, Sprint, SprintTicket } from "@/app/types";
import { computeSprintStatus, formatDate, getSprintStatusMeta, getTicketStatusMeta, sprintProgress } from "@/app/lib/helpers";

// BRU11-020 プロジェクト推移（ガント）
// スプリント画面の SprintGanttView とは別物。
//  - 表示期間は常に「指定year の 1/1〜12/31」の1年分。年送りボタンで前後の年へ移動する
//  - 日/週/月の粒度切替を持つ
//  - 読み取り専用（作成・遷移の導線は持たない）
//  - 開閉状態は localStorage に保存しない（スプリント画面のガントと干渉させないため）

export type TimelineScale = "day" | "week" | "month";

const SCALE: Record<TimelineScale, { dayW: number; showDays: boolean; showWeeks: boolean }> = {
  day: { dayW: 22, showDays: true, showWeeks: false },
  week: { dayW: 6, showDays: false, showWeeks: true },
  month: { dayW: 2, showDays: false, showWeeks: false },
};

const LEFT_W = 264;
const YEAR_H = 20, MON_H = 22, SUB_H = 18;
const ROW_H = { project: 46, sprint: 40, ticket: 28, child: 26 } as const;
const BAR_H = { project: 24, sprint: 20, ticket: 12, child: 9 } as const;
// 実績バーを併記する行では、計画バーを少し薄くして上下2段に分ける
const PLAN_H2 = { project: 16, sprint: 14, ticket: 10, child: 8 } as const;
const ACTUAL_H = { project: 9, sprint: 8, ticket: 7, child: 6 } as const;
const DELAY_COLOR = "#DC2626";

const TERMINAL = ["done", "closed", "waiting-release", "released"];

// ── ローカルタイムで完結する日付ユーティリティ ──
// new Date("YYYY-MM-DD") は UTC 解釈になり、負のオフセットの環境で日がずれるため使わない。
function parseIso(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function diffDays(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
}
function isIsoDate(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-\d{2}-\d{2}/.test(v);
}

// ── 実績（着手 → クローズ） ──
// マイルストーンはタイムスタンプなので、ローカル日付に落としてから軸に載せる。
function tsToDate(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : toIso(d);
}

/** チケット自身の完了日時。優先順は ReportsPage と揃える（closedAt → releasedAt） */
function closeDateOf(t: SprintTicket): string {
  return tsToDate(t.closedAt || t.releasedAt);
}

/**
 * 完了チケットの実績期間（着手 → 完了）。
 * 子チケットの完了日は BRU11-020 以前に完了したものには入っていないため、
 * その場合だけ親チケットの完了日で代替する（fallback=true でその旨を表示に出す）。
 * 着手日が無いものは推測しようがないので実績なし扱い。
 */
function actualSpan(t: SprintTicket, fallbackEnd = ""): { start: string; end: string; fallback: boolean } | null {
  if (!TERMINAL.includes(t.status)) return null;
  const start = tsToDate(t.startedAt);
  if (!start) return null;
  const own = closeDateOf(t);
  const end = own || fallbackEnd;
  if (!end) return null;
  return { start, end: end < start ? start : end, fallback: !own };
}

/** スプリント/プロジェクト行用。配下の実績を最早着手〜最終完了にまとめる */
function aggregateActual(tickets: SprintTicket[]): { start: string; end: string } | null {
  const closeById = new Map(tickets.map(t => [t.id, closeDateOf(t)]));
  let start = "", end = "";
  tickets.forEach(t => {
    const a = actualSpan(t, t.parentId ? (closeById.get(t.parentId) ?? "") : "");
    if (!a) return;
    if (!start || a.start < start) start = a.start;
    if (!end || a.end > end) end = a.end;
  });
  return start && end ? { start, end } : null;
}

/** 独自ツールチップの中身（ブラウザ標準の title は使わない） */
interface Tip {
  heading: string;
  badge?: { label: string; bg: string; color: string };
  rows: { label: string; value: string; accent?: string }[];
  notes?: string[];
}

interface Row {
  key: string;
  kind: "project" | "sprint" | "ticket" | "child";
  label: string;
  /** 左ペインのバッジ（ステータス） */
  badge?: { label: string; bg: string; color: string };
  /** バッジの右に出す補足（進捗%など） */
  note?: string;
  prefix?: string;
  start: string;
  end: string;
  /** 実績（着手〜完了）。無ければ空文字 */
  actualStart: string;
  actualEnd: string;
  /** 完了日を親チケットから借りている（＝子チケットの旧データ） */
  actualFallback: boolean;
  color: string;
  progress: number;
  delayed: boolean;
  hasChildren: boolean;
  expanded: boolean;
  onToggle?: () => void;
  tip: Tip;
}

/** 「04/12 – 05/20」。片方でも欠けていれば「未設定」 */
function spanLabel(s: string, e: string) {
  return s && e ? `${formatDate(s)} – ${formatDate(e)}` : "未設定";
}

/** チケット行（親・子共通）のツールチップ内容 */
function ticketTip(
  t: SprintTicket,
  meta: { label: string; bg: string; color: string },
  progress: number,
  actual: { start: string; end: string; fallback: boolean } | null,
): Tip {
  const today = toIso(new Date());
  const overdue = !!t.dueDate && t.dueDate < today && !TERMINAL.includes(t.status) && t.status !== "withdrawn";
  const notes: string[] = [];
  if (overdue) notes.push("期限を過ぎています");
  if (actual?.fallback) notes.push("完了日は親チケットの日付を使用しています");
  return {
    heading: `${t.wbs} ${t.title}`,
    badge: { label: meta.label, bg: meta.bg, color: meta.color },
    rows: [
      ...(t.assignee ? [{ label: "担当", value: t.assignee }] : []),
      { label: "計画", value: spanLabel(t.startDate, t.dueDate), accent: overdue ? DELAY_COLOR : undefined },
      ...(actual ? [{ label: "実績", value: spanLabel(actual.start, actual.end) }] : []),
      { label: "進捗", value: `${progress}%` },
      ...(t.estimatedHours || t.actualWorkHours != null
        ? [{ label: "工数", value: `見積 ${t.estimatedHours || 0}h${t.actualWorkHours != null ? ` / 実績 ${t.actualWorkHours}h` : ""}` }]
        : []),
    ],
    notes: notes.length ? notes : undefined,
  };
}

export function ProjectTimelineChart({ project, sprints, scale, year, focusNonce, overallProgress }: {
  project: Project;
  sprints: Sprint[];
  scale: TimelineScale;
  /** 表示する年（1/1〜12/31 を常に描く） */
  year: number;
  /** 値が変わるたびに「今日」へスクロールする */
  focusNonce: number;
  /** サマリ帯と同じ全体進捗（プロジェクト行のバーに使う） */
  overallProgress: number;
}) {
  const { dayW: baseDayW, showDays, showWeeks } = SCALE[scale];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedSprints, setExpandedSprints] = useState<Set<string>>(new Set());
  const [expandedTickets, setExpandedTickets] = useState<Set<string>>(new Set());
  // 1年分がコンテナ幅に満たないとき（主に「月」粒度）は引き伸ばして余白を作らない
  const [viewW, setViewW] = useState(0);
  // 独自ツールチップ。mousemove では更新せず、行に入った位置に出す（行数が多いので再描画を抑える）
  const [hover, setHover] = useState<{ tip: Tip; x: number; y: number } | null>(null);
  const showTip = (tip: Tip, x: number, y: number) => setHover({ tip, x, y });
  const hideTip = () => setHover(null);

  // 毎レンダーで new Date() を呼ばない（再計算による点滅を避ける）
  const todayStr = useMemo(() => toIso(new Date()), []);

  const toggleSprint = (id: string) => setExpandedSprints(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleTicket = (id: string) => setExpandedTickets(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ── 表示レンジ ＝ 指定年の1/1〜12/31（うるう年もそのまま） ──
  const minDate = `${year}-01-01`;
  const maxDate = `${year}-12-31`;
  const totalDays = diffDays(minDate, maxDate) + 1;

  // コンテナ幅の変化に追随（縦スクロールバーの出入りでも再計算される）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 1年分が収まりきらないときは横スクロール、余るときは幅いっぱいに引き伸ばす
  const dayW = Math.max(baseDayW, (Math.max(0, viewW - LEFT_W) - 2) / totalDays);
  const totalW = totalDays * dayW;
  const getLeft = (d: string) => Math.min(totalW, Math.max(0, diffDays(minDate, d)) * dayW);
  const getWidth = (s: string, e: string) => {
    const from = Math.max(0, diffDays(minDate, s));
    const to = Math.min(totalDays, diffDays(minDate, e) + 1);
    return Math.max((to - from) * dayW, 3);
  };

  const todayIn = diffDays(minDate, todayStr) >= 0 && diffDays(minDate, todayStr) < totalDays;
  const todayLeft = getLeft(todayStr);

  // ── カレンダーヘッダー（粒度ごとに必要な目盛りだけ作る） ──
  const months = useMemo(() => {
    const out: { label: string; year: number; left: number; width: number }[] = [];
    const cur = parseIso(minDate);
    cur.setDate(1);
    for (let guard = 0; guard < 500; guard++) {
      const from = diffDays(minDate, toIso(cur));
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const to = diffDays(minDate, toIso(next));
      const l = Math.max(0, from), r = Math.min(totalDays, to);
      if (r > l) out.push({ label: `${cur.getMonth() + 1}月`, year: cur.getFullYear(), left: l * dayW, width: (r - l) * dayW });
      if (to >= totalDays) break;
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, [minDate, totalDays, dayW]);

  const years = useMemo(() => {
    const out: { year: number; left: number; width: number }[] = [];
    months.forEach(m => {
      const last = out[out.length - 1];
      if (last && last.year === m.year) last.width += m.width;
      else out.push({ year: m.year, left: m.left, width: m.width });
    });
    return out;
  }, [months]);

  const weeks = useMemo(() => {
    if (!showWeeks) return [];
    const out: { label: string; left: number; width: number; isMonthHead: boolean }[] = [];
    const d = parseIso(minDate);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));  // 直近の月曜まで戻す
    for (let guard = 0; guard < 600; guard++) {
      const from = diffDays(minDate, toIso(d));
      if (from >= totalDays) break;
      const l = Math.max(0, from), r = Math.min(totalDays, from + 7);
      out.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, left: l * dayW, width: (r - l) * dayW, isMonthHead: d.getDate() <= 7 });
      d.setDate(d.getDate() + 7);
    }
    return out;
  }, [minDate, totalDays, dayW, showWeeks]);

  const days = useMemo(() => {
    if (!showDays) return [];
    const out: { iso: string; day: number; isFirst: boolean; isWeekStart: boolean; isWeekend: boolean }[] = [];
    const cur = parseIso(minDate);
    for (let i = 0; i < totalDays; i++) {
      const dow = cur.getDay();
      out.push({ iso: toIso(cur), day: cur.getDate(), isFirst: cur.getDate() === 1, isWeekStart: dow === 1, isWeekend: dow === 0 || dow === 6 });
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [minDate, totalDays, showDays]);

  // ── 縦のグリッド線（粒度に応じて間引く） ──
  const gridLines = useMemo(() => {
    if (showDays) return days.map((d, i) => ({ left: i * dayW, strong: d.isFirst, mid: d.isWeekStart }));
    if (showWeeks) return weeks.map(w => ({ left: w.left, strong: w.isMonthHead, mid: true }));
    return months.map(m => ({ left: m.left, strong: true, mid: false }));
  }, [showDays, showWeeks, days, weeks, months, dayW]);

  // ── 行の組み立て（左ペインと本体で同じ配列を使い、高さのズレを構造的に防ぐ） ──
  const rows = useMemo(() => {
    const out: Row[] = [];
    const projectActual = aggregateActual(sprints.flatMap(s => s.tickets));
    out.push({
      key: "project",
      kind: "project",
      label: "プロジェクト全体",
      note: `${overallProgress}%`,
      start: isIsoDate(project.startDate) ? project.startDate : "",
      end: isIsoDate(project.endDate) ? project.endDate : "",
      actualStart: projectActual?.start ?? "",
      actualEnd: projectActual?.end ?? "",
      actualFallback: false,
      color: "#059669",
      progress: overallProgress,
      delayed: isIsoDate(project.endDate) && project.endDate < todayStr && project.status !== "completed",
      hasChildren: false,
      expanded: false,
      tip: {
        heading: project.name,
        rows: [
          { label: "計画", value: spanLabel(project.startDate, project.endDate) },
          ...(projectActual ? [{ label: "実績", value: spanLabel(projectActual.start, projectActual.end) }] : []),
          { label: "進捗", value: `${overallProgress}%` },
        ],
      },
    });

    sprints.forEach(s => {
      const status = computeSprintStatus(s);
      const sm = getSprintStatusMeta(status);
      const prog = sprintProgress(s);
      const parents = s.tickets.filter(t => !t.parentId);
      const isExp = expandedSprints.has(s.id);
      const sActual = aggregateActual(s.tickets);
      out.push({
        key: `s:${s.id}`,
        kind: "sprint",
        label: s.name,
        badge: { label: sm.label, bg: sm.bg, color: sm.color },
        note: `${prog}% ・ ${s.tickets.length}件`,
        start: isIsoDate(s.startDate) ? s.startDate : "",
        end: isIsoDate(s.endDate) ? s.endDate : "",
        actualStart: sActual?.start ?? "",
        actualEnd: sActual?.end ?? "",
        actualFallback: false,
        color: sm.barColor,
        progress: prog,
        delayed: status === "delayed",
        hasChildren: parents.length > 0,
        expanded: isExp,
        onToggle: parents.length > 0 ? () => toggleSprint(s.id) : undefined,
        tip: {
          heading: s.name,
          badge: { label: sm.label, bg: sm.bg, color: sm.color },
          rows: [
            { label: "計画", value: spanLabel(s.startDate, s.endDate), accent: status === "delayed" ? DELAY_COLOR : undefined },
            ...(sActual ? [{ label: "実績", value: spanLabel(sActual.start, sActual.end) }] : []),
            { label: "進捗", value: `${prog}%` },
            { label: "チケット", value: `${s.tickets.length}件` },
          ],
          notes: status === "delayed" ? ["期限を過ぎています"] : undefined,
        },
      });
      if (!isExp) return;

      parents.forEach(t => {
        const tm = getTicketStatusMeta(t.status);
        const children = s.tickets.filter(c => c.parentId === t.id);
        const done = TERMINAL.includes(t.status);
        const prg = (t.status === "on-hold" || t.status === "withdrawn") ? 0 : done ? 100 : t.progress;
        const tExp = expandedTickets.has(t.id);
        const tActual = actualSpan(t);
        out.push({
          key: `t:${t.id}`,
          kind: "ticket",
          label: t.title,
          prefix: t.wbs,
          badge: { label: tm.label, bg: tm.bg, color: tm.color },
          start: isIsoDate(t.startDate) ? t.startDate : "",
          end: isIsoDate(t.dueDate) ? t.dueDate : "",
          actualStart: tActual?.start ?? "",
          actualEnd: tActual?.end ?? "",
          actualFallback: false,
          color: tm.color,
          progress: prg,
          delayed: isIsoDate(t.dueDate) && t.dueDate < todayStr && !done && t.status !== "withdrawn",
          hasChildren: children.length > 0,
          expanded: tExp,
          onToggle: children.length > 0 ? () => toggleTicket(t.id) : undefined,
          tip: ticketTip(t, tm, prg, tActual),
        });
        if (!tExp) return;

        children.forEach(c => {
          const cm = getTicketStatusMeta(c.status);
          const cDone = TERMINAL.includes(c.status);
          const cPrg = (c.status === "on-hold" || c.status === "withdrawn") ? 0 : cDone ? 100 : c.progress;
          // 旧データの子チケットは完了日が空なので、親チケットの完了日で代替する
          const cActual = actualSpan(c, closeDateOf(t));
          out.push({
            key: `c:${c.id}`,
            kind: "child",
            label: c.title,
            prefix: c.wbs,
            badge: { label: cm.label, bg: cm.bg, color: cm.color },
            start: isIsoDate(c.startDate) ? c.startDate : "",
            end: isIsoDate(c.dueDate) ? c.dueDate : "",
            actualStart: cActual?.start ?? "",
            actualEnd: cActual?.end ?? "",
            actualFallback: cActual?.fallback ?? false,
            color: cm.color,
            progress: cPrg,
            delayed: isIsoDate(c.dueDate) && c.dueDate < todayStr && !cDone && c.status !== "withdrawn",
            hasChildren: false,
            expanded: false,
            tip: ticketTip(c, cm, cPrg, cActual),
          });
        });
      });
    });
    return out;
  }, [project, sprints, expandedSprints, expandedTickets, todayStr, overallProgress]);

  // 「今日」が左から1/3の位置に来るようにスクロールする。粒度切替や「今日へ」でも走る
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const target = todayIn ? todayLeft - (el.clientWidth - LEFT_W) / 3 : 0;
    el.scrollLeft = Math.max(0, target);
  }, [scale, focusNonce, todayIn, todayLeft]);

  const headerH = YEAR_H + MON_H + (showDays || showWeeks ? SUB_H : 0);

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FFFFFF" }}>
      <div style={{ width: LEFT_W + totalW, position: "relative" }}>

        {/* カレンダーヘッダー（縦スクロールしても上に残る） */}
        <div style={{ position: "sticky", top: 0, zIndex: 30, display: "flex", boxShadow: "0 1px 0 rgba(26,23,20,0.08)" }}>
          <div style={{ width: LEFT_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 2, height: headerH, background: "#F4F5F6", borderRight: "1px solid rgba(26,23,20,0.09)", display: "flex", alignItems: "center", padding: "0 14px" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#B0A9A4", letterSpacing: "0.06em" }}>スプリント / チケット</span>
          </div>
          <div style={{ width: totalW, flexShrink: 0 }}>
            <div style={{ height: YEAR_H, background: "#EDEAE5", borderBottom: "1px solid rgba(26,23,20,0.08)", position: "relative" }}>
              {years.map(y => (
                <div key={y.year} style={{ position: "absolute", left: y.left, width: y.width, height: "100%", display: "flex", alignItems: "center", padding: "0 8px", borderRight: "2px solid rgba(26,23,20,0.12)", boxSizing: "border-box" }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: "#6B6458", letterSpacing: "0.04em" }}>{y.year}</span>
                </div>
              ))}
            </div>
            <div style={{ height: MON_H, background: "#F4F5F6", borderBottom: "1px solid rgba(26,23,20,0.07)", position: "relative" }}>
              {months.map((m, i) => (
                <div key={i} style={{ position: "absolute", left: m.left, width: m.width, height: "100%", display: "flex", alignItems: "center", justifyContent: scale === "month" ? "center" : "flex-start", padding: "0 5px", borderRight: "1px solid rgba(26,23,20,0.12)", boxSizing: "border-box", overflow: "hidden" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: "#9E9690", whiteSpace: "nowrap" }}>{m.label}</span>
                </div>
              ))}
            </div>
            {showDays && (
              <div style={{ height: SUB_H, background: "#FAFAF8", borderBottom: "1px solid rgba(26,23,20,0.07)", position: "relative" }}>
                {days.map((d, i) => (
                  <div key={i} style={{
                    position: "absolute", left: i * dayW, width: dayW, height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                    borderLeft: d.isFirst ? "1px solid rgba(26,23,20,0.15)" : "1px solid rgba(26,23,20,0.04)", boxSizing: "border-box",
                    background: d.iso === todayStr ? "rgba(5,150,105,0.12)" : d.isWeekend ? "rgba(26,23,20,0.035)" : "transparent",
                  }}>
                    <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", fontWeight: d.iso === todayStr ? 700 : 400, color: d.iso === todayStr ? "#059669" : d.isWeekend ? "#C9C4BB" : "#B0A9A4" }}>{d.day}</span>
                  </div>
                ))}
              </div>
            )}
            {showWeeks && (
              <div style={{ height: SUB_H, background: "#FAFAF8", borderBottom: "1px solid rgba(26,23,20,0.07)", position: "relative" }}>
                {weeks.map((w, i) => (
                  <div key={i} style={{ position: "absolute", left: w.left, width: w.width, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", borderLeft: "1px solid rgba(26,23,20,0.06)", boxSizing: "border-box", overflow: "hidden" }}>
                    <span style={{ fontSize: 8, fontFamily: "var(--font-mono)", color: "#B0A9A4", whiteSpace: "nowrap" }}>{w.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 本体（左ペイン＝横スクロールしても残る / 右＝バー） */}
        <div style={{ display: "flex", position: "relative" }}>
          <div style={{ width: LEFT_W, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: "#FFFFFF", borderRight: "1px solid rgba(26,23,20,0.09)" }}>
            {rows.map(r => <LabelCell key={r.key} row={r} onShowTip={showTip} onHideTip={hideTip} />)}
          </div>

          <div style={{ width: totalW, flexShrink: 0, position: "relative" }}>
            {/* グリッド線と今日ライン */}
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              {gridLines.map((g, i) => (
                <div key={i} style={{ position: "absolute", top: 0, bottom: 0, left: g.left, width: 1, background: g.strong ? "rgba(26,23,20,0.16)" : g.mid ? "rgba(26,23,20,0.07)" : "rgba(26,23,20,0.03)" }} />
              ))}
              {todayIn && <div style={{ position: "absolute", top: 0, bottom: 0, left: todayLeft, width: 2, background: "#059669", opacity: 0.55 }} />}
            </div>
            {rows.map(r => {
              const seg = (s: string, e: string) =>
                s && e && !(e < minDate || s > maxDate) ? { left: getLeft(s), width: getWidth(s, e) } : null;
              const plan = seg(r.start, r.end);
              const actual = seg(r.actualStart, r.actualEnd);
              // 計画・実績のどちらも表示年から外れている行は、どちら側にあるかを端に出す
              const anchorEnd = r.end || r.actualEnd;
              const outOf = anchorEnd && !plan && !actual ? (anchorEnd < minDate ? "before" : "after") : null;
              return <BarCell key={r.key} row={r} plan={plan} actual={actual} outOf={outOf} onShowTip={showTip} onHideTip={hideTip} />;
            })}
          </div>
        </div>

        {sprints.length === 0 && (
          <div style={{ position: "sticky", left: 0, width: LEFT_W + Math.min(totalW, 520), padding: "28px 20px", fontSize: 12, color: "#B0A9A4" }}>
            このプロジェクトにはスプリントがまだありません。
          </div>
        )}
      </div>

      {hover && <TimelineTooltip tip={hover.tip} x={hover.x} y={hover.y} />}
    </div>
  );
}

/** 行ホバー時の独自ツールチップ。position:fixed でモーダルの端に切られないようにする */
function TimelineTooltip({ tip, x, y }: { tip: Tip; x: number; y: number }) {
  const W = 300;
  const estH = 54 + tip.rows.length * 17 + (tip.notes?.length ?? 0) * 15;
  const left = Math.max(8, Math.min(x + 16, window.innerWidth - W - 12));
  const top = Math.max(8, Math.min(y + 18, window.innerHeight - estH - 12));
  return (
    <div style={{
      position: "fixed", left, top, width: W, zIndex: 9999, pointerEvents: "none",
      background: "#FFFFFF", borderRadius: 10, border: "1px solid rgba(26,23,20,0.08)",
      boxShadow: "0 12px 32px rgba(26,23,20,0.16), 0 2px 8px rgba(26,23,20,0.06)",
      padding: "10px 12px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 8 }}>
        <p style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 700, color: "#1A1714", lineHeight: 1.4, wordBreak: "break-word" }}>{tip.heading}</p>
        {tip.badge && (
          <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 10, background: tip.badge.bg, color: tip.badge.color }}>{tip.badge.label}</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {tip.rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ width: 44, flexShrink: 0, fontSize: 10, fontWeight: 600, color: "#B0A9A4" }}>{r.label}</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: r.accent ?? "#3D3732", fontFamily: "var(--font-mono)", wordBreak: "break-word" }}>{r.value}</span>
          </div>
        ))}
      </div>
      {tip.notes && tip.notes.length > 0 && (
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(26,23,20,0.06)", display: "flex", flexDirection: "column", gap: 3 }}>
          {tip.notes.map((n, i) => (
            <p key={i} style={{ fontSize: 10, color: "#A09790", lineHeight: 1.4 }}>※ {n}</p>
          ))}
        </div>
      )}
    </div>
  );
}

const rowBg = (kind: Row["kind"]) =>
  kind === "project" ? "#FAFAF8" : kind === "sprint" ? "#FFFFFF" : kind === "ticket" ? "rgba(26,23,20,0.012)" : "rgba(5,150,105,0.02)";

type TipHandlers = { onShowTip: (tip: Tip, x: number, y: number) => void; onHideTip: () => void };

function LabelCell({ row, onShowTip, onHideTip }: { row: Row } & TipHandlers) {
  const h = ROW_H[row.kind];
  const indent = row.kind === "project" ? 10 : row.kind === "sprint" ? 10 : row.kind === "ticket" ? 22 : 38;
  return (
    <div
      onClick={row.onToggle}
      style={{
        height: h, boxSizing: "border-box", borderBottom: "1px solid rgba(26,23,20,0.05)", background: rowBg(row.kind),
        padding: `0 8px 0 ${indent}px`, display: "flex", alignItems: "center", gap: 6, cursor: row.onToggle ? "pointer" : "default",
      }}
      onMouseEnter={e => {
        if (row.onToggle) (e.currentTarget as HTMLElement).style.background = "#F4F5F6";
        onShowTip(row.tip, e.clientX, e.clientY);
      }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = rowBg(row.kind); onHideTip(); }}>
      {row.hasChildren ? (
        row.expanded
          ? <ChevronDown style={{ width: 11, height: 11, color: "#B0A9A4", flexShrink: 0 }} />
          : <ChevronRight style={{ width: 11, height: 11, color: "#B0A9A4", flexShrink: 0 }} />
      ) : <span style={{ width: row.kind === "child" ? 0 : 11, flexShrink: 0 }} />}

      {row.kind === "child" && <div style={{ width: 1, height: 10, background: "rgba(26,23,20,0.15)", flexShrink: 0 }} />}
      {row.kind !== "project" && row.kind !== "sprint" && (
        <div style={{ width: 5, height: 5, borderRadius: "50%", background: row.color, flexShrink: 0 }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: row.kind === "project" ? 12 : row.kind === "sprint" ? 11 : row.kind === "ticket" ? 10 : 9,
          fontWeight: row.kind === "project" || row.kind === "sprint" ? 700 : 500,
          color: row.kind === "project" ? "#1A1714" : row.kind === "sprint" ? "#1A1714" : "#6B6458",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {row.prefix && <span style={{ fontFamily: "var(--font-mono)", color: "#B0A9A4", marginRight: 5 }}>{row.prefix}</span>}
          {row.label}
        </p>
        {(row.badge || row.note) && (row.kind === "project" || row.kind === "sprint") && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            {row.badge && <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: row.badge.bg, color: row.badge.color }}>{row.badge.label}</span>}
            {row.note && <span style={{ fontSize: 9, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{row.note}</span>}
          </div>
        )}
      </div>

      {row.hasChildren && row.kind === "ticket" && <GitBranch style={{ width: 8, height: 8, color: "#B0A9A4", flexShrink: 0 }} />}
      {row.badge && (row.kind === "ticket" || row.kind === "child") && (
        <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 10, background: row.badge.bg, color: row.badge.color, flexShrink: 0 }}>{row.badge.label}</span>
      )}
    </div>
  );
}

interface Seg { left: number; width: number }

function BarCell({ row, plan, actual, outOf, onShowTip, onHideTip }: { row: Row; plan: Seg | null; actual: Seg | null; outOf: "before" | "after" | null } & TipHandlers) {
  const h = ROW_H[row.kind];
  // 実績を併記する行は計画バーを細くして2段にする
  const twoRow = !!plan && !!actual;
  const planH = twoRow ? PLAN_H2[row.kind] : BAR_H[row.kind];
  const actualH = ACTUAL_H[row.kind];
  const planTop = twoRow ? h / 2 - planH - 1 : (h - planH) / 2;
  // 計画が無い（未設定 or 表示年の外）行では実績を中央に置く
  const actualTop = twoRow ? h / 2 + 1 : (h - actualH) / 2;
  const fontSm = row.kind === "child" ? 7 : 8;
  const outLabel = row.start && row.end
    ? `${formatDate(row.start)} – ${formatDate(row.end)}`
    : `${formatDate(row.actualStart)} – ${formatDate(row.actualEnd)}`;

  return (
    // バーの無い行の注記は sticky にして、横スクロールしても常に見えるようにする
    <div
      onMouseEnter={e => onShowTip(row.tip, e.clientX, e.clientY)}
      onMouseLeave={onHideTip}
      style={{ height: h, boxSizing: "border-box", borderBottom: "1px solid rgba(26,23,20,0.05)", background: rowBg(row.kind), position: "relative", display: "flex", alignItems: "center" }}>
      {outOf === "before" && <EdgeNote side="left">◀ {outLabel}</EdgeNote>}
      {outOf === "after" && <EdgeNote side="right">{outLabel} ▶</EdgeNote>}

      {/* 計画（開始日〜期限） */}
      {plan && (
        <div style={{ position: "absolute", left: plan.left, top: planTop, display: "flex", alignItems: "center", gap: 5, zIndex: 1 }}>
          <div
            style={{
              width: plan.width, height: planH, borderRadius: planH > 14 ? 5 : 3, flexShrink: 0, position: "relative", overflow: "hidden",
              background: row.color + "22",
              border: row.delayed ? `1.5px dashed ${DELAY_COLOR}` : `1px solid ${row.color}55`,
              display: "flex", alignItems: "center",
            }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${Math.max(0, Math.min(100, row.progress))}%`, background: row.color + "55" }} />
            {planH > 14 && plan.width > 64 && (
              <span style={{ position: "relative", paddingLeft: 6, fontSize: 9, fontWeight: 700, color: row.color, whiteSpace: "nowrap", overflow: "hidden" }}>
                {row.label.length > 18 ? row.label.slice(0, 17) + "…" : row.label}
              </span>
            )}
          </div>
          <span style={{ fontSize: fontSm, fontFamily: "var(--font-mono)", color: row.delayed ? DELAY_COLOR : "#B0A9A4", whiteSpace: "nowrap" }}>
            {formatDate(row.end)}
          </span>
          {row.delayed && (
            <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 8, background: "#FEF2F2", color: DELAY_COLOR, whiteSpace: "nowrap" }}>遅延</span>
          )}
        </div>
      )}

      {/* 実績（着手〜クローズ）。完了しているものだけに出る */}
      {actual && (
        <div style={{ position: "absolute", left: actual.left, top: actualTop, display: "flex", alignItems: "center", gap: 4, zIndex: 2 }}>
          <div
            style={{
              width: actual.width, height: actualH, borderRadius: 2, flexShrink: 0,
              // 完了日を親から借りている行は、確定値と区別できるよう点線＋薄めにする
              background: row.actualFallback ? row.color + "66" : row.color + "CC",
              border: row.actualFallback ? `1px dotted ${row.color}` : `1px solid ${row.color}`,
            }} />
          <span style={{ fontSize: fontSm, fontFamily: "var(--font-mono)", color: "#9E9690", whiteSpace: "nowrap" }}>
            実 {formatDate(row.actualEnd)}{row.actualFallback ? "（親）" : ""}
          </span>
        </div>
      )}

      {!plan && !actual && !outOf && (
        <EdgeNote side="left" italic>日程未設定</EdgeNote>
      )}
    </div>
  );
}

/**
 * バーが無い行に出す注記。横スクロールしても消えないよう sticky で貼り付ける。
 * 幅0の箱を sticky にして、中の文字だけを絶対配置ではみ出させることで行の高さ・配置に影響させない。
 */
function EdgeNote({ side, italic, children }: { side: "left" | "right"; italic?: boolean; children: ReactNode }) {
  const box: CSSProperties = side === "left"
    ? { position: "sticky", left: 8, width: 0, height: 0, zIndex: 3 }
    : { position: "sticky", right: 8, width: 0, height: 0, zIndex: 3, marginLeft: "auto" };
  const text: CSSProperties = {
    position: "absolute", top: 0, transform: "translateY(-50%)", whiteSpace: "nowrap",
    fontSize: 8, fontFamily: "var(--font-mono)", color: italic ? "#D5D0CB" : "#C9C4BB",
    fontStyle: italic ? "italic" : undefined,
    ...(side === "left" ? { left: 0 } : { right: 0 }),
  };
  return (
    <div style={box}>
      <span style={text}>{children}</span>
    </div>
  );
}
