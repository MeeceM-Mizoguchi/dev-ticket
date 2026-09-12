// ENHA2-032 タスクのガントビュー（BRU15-005 で作り直し）。
//
// SprintGanttView は Sprint / SprintTicket 型に密結合しているのでコンポーネントは流用せず、
// 日付計算（helpers の daysBetween）とレイアウトの作り（左ペイン固定＋右が日グリッド）だけ踏襲する。
// スプリント側のコードには一切触れない。
//
// BRU15-005
//   ・プロジェクトごとにまとめ、親タスクの下にサブタスクをぶら下げる（▸ で開閉）
//   ・親の期間・担当者はサブタスクから決まる（taskRollup）。親の棒は「まとめ」の見た目で出す
//   ・棒をドラッグで移動、両端のつまみで開始日／期限を伸び縮みできる（編集できるタスクだけ）。
//     親の期間がサブタスクから決まっている場合は動かさない（サブタスク側を動かす）
//   ・棒の中は進捗率ぶんだけ塗る（完了は 100%）
//   ・表示の細かさを 日 / 週 / 月 で切り替える（画面をまたいで覚えておく）
//   ・月・日の見出しは画面上部に固定し、横スクロールは本体と揃える（useSyncedHScroll）
//
// 棒を押しただけ（動かさずに離した）ときは、これまでどおりリストでそのタスクを開く。
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FolderKanban, CalendarDays, ChevronDown, ChevronRight, CornerDownRight } from "lucide-react";
import { daysBetween } from "@/app/lib/helpers";
import { getTaskStatusMeta, getTaskPriorityMeta } from "@/app/lib/taskService";
import { effectiveDates, hasRolledUpDates, ASSIGNEE_SEP, type TaskRollups } from "@/app/lib/taskRollup";
import { isOverdue } from "@/app/components/tasks/TaskListView";
import { useSyncedHScroll, StickyHScrollBar } from "@/app/components/tasks/useSyncedHScroll";
import type { Task } from "@/app/types";

type Scale = "day" | "week" | "month";

const SCALES: { value: Scale; label: string; dayW: number }[] = [
  { value: "day",   label: "日", dayW: 28 },
  { value: "week",  label: "週", dayW: 12 },
  { value: "month", label: "月", dayW: 5 },
];

const SCALE_KEY = "dt.taskGanttScale";

/** 左ペイン（タスク名・担当者・期間） */
const LEFT_W = 380;
const ASSIGNEE_W = 88;
const PERIOD_W = 76;
const ROW_H = 34;
const GROUP_H = 28;
const MONTH_H = 22;
const DAY_H = 20;
const HEAD_H = MONTH_H + DAY_H;
/** サブタスク1段ぶんの字下げ */
const INDENT = 16;
/** これ未満の動きは「押しただけ」（リストで開く）として扱う */
const DRAG_THRESHOLD = 3;

type Span = { from: string; to: string };
type DragMode = "move" | "start" | "end";

interface DragState { id: string; mode: DragMode; startX: number; delta: number; moved: boolean }

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 期間の両端。開始だけ／期限だけのタスクは1日分の棒にする */
function spanOf(start: string, due: string): Span | null {
  const from = start || due;
  const to = due || start;
  if (!from || !to) return null;
  return from <= to ? { from, to } : { from: to, to: from };
}

/** ドラッグ中の期間。伸び縮みで開始と期限が入れ替わらないよう、反対側で止める */
function applyDrag(s: Span, mode: DragMode, delta: number): Span {
  if (mode === "move") return { from: addDays(s.from, delta), to: addDays(s.to, delta) };
  if (mode === "start") {
    const f = addDays(s.from, delta);
    return { from: f > s.to ? s.to : f, to: s.to };
  }
  const e = addDays(s.to, delta);
  return { from: s.from, to: e < s.from ? s.from : e };
}

/** ドラッグ後の期間を DB へ書く形にする */
function dragPatch(t: Task, mode: DragMode, next: Span): Partial<Task> {
  if (mode === "move") {
    // 片方しか持っていないタスクは、その片方だけを動かす（移動しただけで期間を作らない）
    if (!t.startDate) return { dueDate: next.to };
    if (!t.dueDate) return { startDate: next.from };
  }
  return { startDate: next.from, dueDate: next.to };
}

function readScale(): Scale {
  try {
    const s = localStorage.getItem(SCALE_KEY);
    return s === "week" || s === "month" || s === "day" ? s : "day";
  } catch {
    return "day";
  }
}

export function TaskGanttView({
  tasks, rollups, assigneesOf, projectNameOf, canEdit, selectedId, onSelect, onPatch, stickyTop = 0,
}: {
  /** 絞り込み後（画面に出す分） */
  tasks: Task[];
  /** サブタスクから親へ集計した担当者・期間 */
  rollups: TaskRollups;
  /** 画面に出す担当者（親は子の担当者全員） */
  assigneesOf: (t: Task) => string[];
  projectNameOf: (id: string | null) => string;
  canEdit: (t: Task) => boolean;
  selectedId: string | null;
  /** 棒・行を押したとき（リストで開く） */
  onSelect: (t: Task) => void;
  /** 棒のドラッグで日程を変えたとき */
  onPatch: (t: Task, patch: Partial<Task>) => void;
  /** 月・日の見出しを固定する位置（上に固定されている見出し・フィルタの高さ） */
  stickyTop?: number;
}) {
  const today = useMemo(() => new Date().toLocaleDateString("sv-SE"), []);
  const [scale, setScale] = useState<Scale>(readScale);
  useEffect(() => {
    try { localStorage.setItem(SCALE_KEY, scale); } catch { /* 保存できなくても表示は続ける */ }
  }, [scale]);
  const dayW = SCALES.find(s => s.value === scale)?.dayW ?? 28;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const hs = useSyncedHScroll();

  // 表示に使う期間（親はサブタスクから決まる）
  const spanById = useMemo(() => {
    const m = new Map<string, Span | null>();
    for (const t of tasks) {
      const d = effectiveDates(t, rollups.get(t.id));
      m.set(t.id, spanOf(d.startDate, d.dueDate));
    }
    return m;
  }, [tasks, rollups]);

  // プロジェクトごと → 親 → サブタスク の順に並べる。日付の無いものは棒を描けないので先頭の一覧へ
  const { groups, undated, kidsOf } = useMemo(() => {
    const dated = tasks.filter(t => spanById.get(t.id));
    const undatedList = tasks.filter(t => !spanById.get(t.id));
    const datedIds = new Set(dated.map(t => t.id));
    const kids = new Map<string, Task[]>();
    const roots: Task[] = [];
    for (const t of dated) {
      // 親が出ていない子（絞り込みで消えた／親に日付が無い）は最上位に出す
      if (t.parentId && datedIds.has(t.parentId)) {
        const arr = kids.get(t.parentId);
        if (arr) arr.push(t); else kids.set(t.parentId, [t]);
      } else {
        roots.push(t);
      }
    }
    const byStart = (a: Task, b: Task) =>
      spanById.get(a.id)!.from.localeCompare(spanById.get(b.id)!.from) || a.sortOrder - b.sortOrder;
    kids.forEach(list => list.sort(byStart));

    const map = new Map<string, Task[]>();
    for (const t of roots) {
      const key = t.projectId ?? "";
      const arr = map.get(key);
      if (arr) arr.push(t); else map.set(key, [t]);
    }
    const list = [...map.entries()].map(([id, rs]) => ({
      id,
      name: id ? projectNameOf(id) : "個人タスク",
      roots: rs.sort(byStart),
      count: rs.reduce((n, r) => n + 1 + (kids.get(r.id)?.length ?? 0), 0),
    })).sort((a, b) => (a.id === "" ? 1 : b.id === "" ? -1 : a.name.localeCompare(b.name)));
    return { groups: list, undated: undatedList, kidsOf: kids };
  }, [tasks, spanById, projectNameOf]);

  // 表示範囲。前後に余白を足して、棒が端に貼り付かず、外へ伸ばす余地も残す
  const { minDate, totalDays } = useMemo(() => {
    let lo = today, hi = today;
    for (const s of spanById.values()) {
      if (!s) continue;
      if (s.from < lo) lo = s.from;
      if (s.to > hi) hi = s.to;
    }
    const pad = scale === "month" ? 45 : scale === "week" ? 21 : 10;
    const start = addDays(lo, -pad);
    return { minDate: start, totalDays: daysBetween(start, addDays(hi, pad)) + 1 };
  }, [spanById, today, scale]);

  const days = useMemo(
    () => Array.from({ length: totalDays }, (_, i) => addDays(minDate, i)),
    [minDate, totalDays],
  );

  // 月の見出し（同じ月が続く分だけ結合する）
  const months = useMemo(() => {
    const out: { label: string; start: number; days: number }[] = [];
    days.forEach((d, i) => {
      const [y, m] = d.split("-");
      const label = `${y}/${Number(m)}`;
      const last = out[out.length - 1];
      if (last && last.label === label) last.days += 1;
      else out.push({ label, start: i, days: 1 });
    });
    return out;
  }, [days]);

  const gridW = totalDays * dayW;
  const todayOffset = daysBetween(minDate, today);

  // 初回と表示の細かさを変えたときは、今日が左から 1/3 あたりに来るよう送る。
  // 日程を動かして表示範囲の左端が変わったときは、見ていた位置がずれないよう差分だけ戻す
  const prevRange = useRef<{ minDate: string; dayW: number } | null>(null);
  useLayoutEffect(() => {
    const body = hs.body.current;
    if (!body) return;
    const prev = prevRange.current;
    if (!prev || prev.dayW !== dayW) {
      body.scrollLeft = Math.max(0, todayOffset * dayW - (body.clientWidth - LEFT_W) / 3);
    } else if (prev.minDate !== minDate) {
      body.scrollLeft += daysBetween(minDate, prev.minDate) * dayW;
    }
    prevRange.current = { minDate, dayW };
  }, [minDate, dayW, todayOffset, hs.body]);

  // ── ドラッグ ─────────────────────────────────────────────────
  const beginDrag = (e: React.PointerEvent, t: Task, mode: DragMode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const base = spanById.get(t.id);
    if (!base) return;
    const first: DragState = { id: t.id, mode, startX: e.clientX, delta: 0, moved: false };
    dragRef.current = first;
    setDrag(first);

    const move = (ev: PointerEvent) => {
      const cur = dragRef.current;
      if (!cur) return;
      const dx = ev.clientX - cur.startX;
      const delta = Math.round(dx / dayW);
      const moved = cur.moved || Math.abs(dx) >= DRAG_THRESHOLD;
      if (delta === cur.delta && moved === cur.moved) return;
      const next = { ...cur, delta, moved };
      dragRef.current = next;
      setDrag(next);
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!cur || !commit) return;
      // 動かさずに離した＝押しただけ。これまでどおりリストで開く
      if (!cur.moved) { onSelect(t); return; }
      if (cur.delta === 0) return;
      const next = applyDrag(base, cur.mode, cur.delta);
      if (next.from === base.from && next.to === base.to) return;
      onPatch(t, dragPatch(t, cur.mode, next));
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const toggleCollapse = (id: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // ── 日グリッドの背景（土日の網掛け・日の区切り）。1枚の背景で描いて要素数を増やさない ──
  const firstDow = new Date(`${minDate}T00:00:00`).getDay();
  const satOffset = ((6 - firstDow + 7) % 7) * dayW;
  const gridLayers: { image: string; size: string; pos: string }[] = [];
  if (scale === "day") {
    gridLayers.push({ image: "linear-gradient(90deg, rgba(26,23,20,0.045) 1px, transparent 1px)", size: `${dayW}px 100%`, pos: "0 0" });
  }
  if (scale !== "month") {
    gridLayers.push({
      image: `linear-gradient(90deg, rgba(26,23,20,0.03) 0, rgba(26,23,20,0.03) ${2 * dayW}px, transparent ${2 * dayW}px)`,
      size: `${7 * dayW}px 100%`, pos: `${satOffset}px 0`,
    });
  }
  const gridBg: React.CSSProperties = gridLayers.length > 0
    ? {
      backgroundImage: gridLayers.map(l => l.image).join(", "),
      backgroundSize: gridLayers.map(l => l.size).join(", "),
      backgroundPosition: gridLayers.map(l => l.pos).join(", "),
    }
    : {};

  const stickyCell: React.CSSProperties = {
    position: "sticky", left: 0, zIndex: 2, width: LEFT_W, minWidth: LEFT_W, boxSizing: "border-box",
    background: "#FFFFFF", borderRight: "1px solid rgba(26,23,20,0.08)",
  };

  const totalRows = groups.reduce((n, g) => n + g.count, 0);

  // ── 1行ぶん ─────────────────────────────────────────────────
  const renderRow = (t: Task, depth: number) => {
    const baseSpan = spanById.get(t.id)!;
    const dragging = drag?.id === t.id;
    const s = dragging && drag ? applyDrag(baseSpan, drag.mode, drag.delta) : baseSpan;
    const rollup = rollups.get(t.id);
    const kids = depth === 0 ? kidsOf.get(t.id) ?? [] : [];
    const isParent = (rollup?.childCount ?? 0) > 0;
    const open = !collapsed.has(t.id);
    // 親の期間がサブタスクから決まっているなら動かさない（動かすのはサブタスク側）
    const locked = hasRolledUpDates(rollup);
    const draggable = !locked && canEdit(t);

    const offset = daysBetween(minDate, s.from);
    const len = daysBetween(s.from, s.to) + 1;
    const barLeft = offset * dayW + 1;
    const barW = Math.max(len * dayW - 2, 4);

    const meta = getTaskStatusMeta(t.status);
    const pri = getTaskPriorityMeta(t.priority);
    const due = effectiveDates(t, rollup).dueDate;
    const overdue = isOverdue({ ...t, dueDate: due });
    const done = t.status === "done";
    const progress = done ? 100 : t.progress;
    const selected = selectedId === t.id;
    const assignees = assigneesOf(t);
    const period = s.from === s.to ? shortDate(s.from) : `${shortDate(s.from)}–${shortDate(s.to)}`;

    const barColor = overdue ? "#DC2626" : meta.color;
    const barTitle = [
      t.title,
      `${s.from} 〜 ${s.to}`,
      `進捗 ${progress}%`,
      locked ? "期間はサブタスクから決まります（サブタスク側を動かしてください）"
        : draggable ? "ドラッグで移動・両端で開始日／期限を変更" : "",
    ].filter(Boolean).join("\n");

    const handle = (side: "start" | "end") => (
      <span onPointerDown={e => beginDrag(e, t, side)}
        style={{
          position: "absolute", top: 0, bottom: 0, [side === "start" ? "left" : "right"]: 0, width: 7,
          cursor: "ew-resize", zIndex: 2, touchAction: "none",
        }} />
    );

    return (
      <div key={t.id} style={{
        display: "flex", position: "relative",
        borderBottom: "1px solid rgba(26,23,20,0.04)",
        background: selected ? "rgba(5,150,105,0.07)" : "transparent",
      }}>
        {/* 左ペイン：開閉・タスク名・担当者・期間 */}
        <div onClick={() => onSelect(t)} data-tip={t.title}
          style={{
            ...stickyCell, background: selected ? "#F0FDF4" : "#FFFFFF", height: ROW_H,
            display: "flex", alignItems: "center", gap: 6, padding: "0 10px", cursor: "pointer",
          }}>
          <span style={{ width: 14, flexShrink: 0, display: "flex", justifyContent: "center", marginLeft: depth * INDENT }}>
            {depth === 0 && kids.length > 0 && (
              <button type="button" onClick={e => { e.stopPropagation(); toggleCollapse(t.id); }}
                title={open ? "サブタスクを閉じる" : "サブタスクを開く"}
                style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, display: "flex", color: "#9E9690" }}>
                {open ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
              </button>
            )}
          </span>
          {t.parentId && <CornerDownRight style={{ width: 10, height: 10, color: "#C9C4BB", flexShrink: 0 }} />}
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: pri.color, flexShrink: 0 }} />
          <span style={{
            flex: 1, minWidth: 0, fontSize: depth > 0 ? 11 : 11.5, fontWeight: isParent ? 700 : 500,
            color: done ? "#9E9690" : "#1A1714",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
          }}>{t.title}</span>
          <span data-tip={assignees.join(ASSIGNEE_SEP) || "未割当"}
            style={{ width: ASSIGNEE_W, flexShrink: 0, fontSize: 10, color: assignees.length ? "#6B6458" : "#C9C4BB", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>
            {assignees.join(ASSIGNEE_SEP) || "未割当"}
          </span>
          <span style={{ width: PERIOD_W, flexShrink: 0, fontSize: 9.5, fontFamily: "var(--font-mono)", color: overdue ? "#DC2626" : "#9E9690", textAlign: "right" as const, whiteSpace: "nowrap" as const }}>
            {period}
          </span>
        </div>

        {/* 右：棒 */}
        <div style={{ width: gridW, height: ROW_H, position: "relative" }}>
          <div data-tip={dragging ? undefined : barTitle}
            onPointerDown={draggable ? e => beginDrag(e, t, "move") : undefined}
            onClick={draggable ? undefined : () => onSelect(t)}
            style={{
              position: "absolute", left: barLeft, width: barW,
              top: isParent ? 11 : 8, height: isParent ? 12 : ROW_H - 16,
              borderRadius: isParent ? 3 : 5, boxSizing: "border-box" as const, overflow: "hidden",
              // 親（まとめ）は濃い枠の細い棒、通常のタスクはステータスの色
              background: isParent ? "rgba(26,23,20,0.07)" : overdue ? "#FEE2E2" : meta.bg,
              border: isParent ? "1px solid rgba(26,23,20,0.38)" : `1px solid ${overdue ? "#FCA5A5" : meta.border}`,
              cursor: draggable ? (dragging ? "grabbing" : "grab") : "pointer",
              boxShadow: dragging ? "0 4px 14px rgba(0,0,0,0.16)" : undefined,
              zIndex: dragging ? 3 : 1,
              touchAction: "none",
            }}>
            {/* 進捗率ぶんを塗る */}
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0, width: `${progress}%`,
              background: isParent ? "rgba(26,23,20,0.28)" : `${barColor}33`,
            }} />
            {!isParent && barW >= 40 && (
              <span style={{ position: "relative", display: "block", padding: "0 6px", lineHeight: `${ROW_H - 18}px`, fontSize: 9, fontWeight: 700, color: barColor, whiteSpace: "nowrap" as const, pointerEvents: "none" }}>
                {progress}%
              </span>
            )}
            {draggable && handle("start")}
            {draggable && handle("end")}
          </div>

          {/* 棒の右：ドラッグ中は新しい期間、それ以外はタスク名（遠くへスクロールしても何の棒か分かるように） */}
          <span style={{
            position: "absolute", left: barLeft + barW + 6, top: 0, lineHeight: `${ROW_H}px`,
            fontSize: dragging ? 10 : 10, fontWeight: dragging ? 700 : 500,
            fontFamily: dragging ? "var(--font-mono)" : undefined,
            color: dragging ? "#059669" : "#9E9690",
            whiteSpace: "nowrap" as const, pointerEvents: "none", maxWidth: 260,
            overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {dragging ? `${shortDate(s.from)} → ${shortDate(s.to)}` : t.title}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div style={{
      background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12,
      // 見出しを画面上部に固定するため hidden ではなく clip で切る（TaskListView と同じ理由）
      overflow: "clip",
    }}>
      {/* 日付未設定（棒は描かない。先頭にまとめて出す） */}
      {undated.length > 0 && (
        <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(26,23,20,0.07)", background: "#FAFAF9" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
            <CalendarDays style={{ width: 12, height: 12, color: "#A09790" }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458" }}>日付未設定</span>
            <span style={{ fontSize: 10, color: "#A09790" }}>{undated.length}件</span>
            <span style={{ fontSize: 10, color: "#B0A9A4" }}>（リストで開始日か期限を入れると棒が出ます）</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {undated.map(t => (
              <button key={t.id} type="button" onClick={() => onSelect(t)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", fontSize: 11, borderRadius: 99, border: selectedId === t.id ? "1px solid #059669" : "1px solid rgba(26,23,20,0.1)", background: "#FFF", color: "#1A1714", cursor: "pointer", maxWidth: 260 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: getTaskStatusMeta(t.status).color, flexShrink: 0 }} />
                {t.parentId && <CornerDownRight style={{ width: 9, height: 9, color: "#C9C4BB", flexShrink: 0 }} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{t.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 見出し（月 / 日）。画面上部に固定し、横位置は本体と揃える ── */}
      <div style={{ position: "sticky", top: stickyTop, zIndex: 20, display: "flex", background: "#FFFFFF", borderBottom: "1px solid rgba(26,23,20,0.08)" }}>
        <div style={{ width: LEFT_W, flexShrink: 0, height: HEAD_H, boxSizing: "border-box", borderRight: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "0 10px 0 12px", background: "#FAFAF9" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#9E9690", letterSpacing: "0.06em" }}>タスク <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500 }}>{totalRows}</span></div>
            <div style={{ fontSize: 9, color: "#C9C4BB", whiteSpace: "nowrap" as const }}>棒をドラッグで日程を変更</div>
          </div>
          {/* 表示の細かさ */}
          <div style={{ display: "flex", gap: 2, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 7, padding: 2, flexShrink: 0 }}>
            {SCALES.map(sc => (
              <button key={sc.value} type="button" onClick={() => setScale(sc.value)}
                data-tip={`${sc.label}単位で表示`}
                style={{
                  padding: "3px 9px", fontSize: 10.5, fontWeight: 700, borderRadius: 5, border: "none", cursor: "pointer",
                  background: scale === sc.value ? "#059669" : "transparent",
                  color: scale === sc.value ? "#FFF" : "#6B6458",
                }}>
                {sc.label}
              </button>
            ))}
          </div>
        </div>
        <div ref={hs.head} className="task-hscroll-hide" onScroll={hs.onScroll}
          style={{ flex: 1, minWidth: 0, overflowX: "auto", overflowY: "hidden" }}>
          <div style={{ width: gridW, height: HEAD_H, position: "relative", background: "#FFFFFF" }}>
            {/* 月 */}
            {months.map(m => (
              <div key={m.label} style={{
                position: "absolute", top: 0, left: m.start * dayW, width: m.days * dayW, height: MONTH_H,
                boxSizing: "border-box" as const, borderLeft: "1px solid rgba(26,23,20,0.10)",
                padding: "5px 0 0 6px", fontSize: 10, fontWeight: 700, color: "#6B6458",
                overflow: "hidden", whiteSpace: "nowrap" as const,
              }}>
                {m.label}
              </div>
            ))}
            {/* 日。日単位は毎日、週・月単位は月曜だけ番号を出す */}
            {days.map((d, i) => {
              const dow = new Date(`${d}T00:00:00`).getDay();
              const isToday = d === today;
              if (scale !== "day" && dow !== 1 && !isToday) return null;
              const weekend = dow === 0 || dow === 6;
              return (
                <div key={d} style={{
                  position: "absolute", top: MONTH_H, left: i * dayW, width: scale === "day" ? dayW : 7 * dayW, height: DAY_H,
                  fontSize: 8.5, fontFamily: "var(--font-mono)", lineHeight: `${DAY_H - 4}px`,
                  textAlign: scale === "day" ? "center" as const : "left" as const,
                  paddingLeft: scale === "day" ? 0 : 2, boxSizing: "border-box" as const,
                  color: isToday ? "#059669" : weekend ? "#C9C4BB" : "#9E9690",
                  fontWeight: isToday ? 800 : 500,
                  background: scale === "day" && weekend ? "rgba(26,23,20,0.03)" : "transparent",
                  borderLeft: scale === "day" ? undefined : "1px solid rgba(26,23,20,0.06)",
                  whiteSpace: "nowrap" as const,
                }}>{Number(d.split("-")[2])}</div>
              );
            })}
            {/* 今日 */}
            {todayOffset >= 0 && todayOffset < totalDays && (
              <div style={{ position: "absolute", left: todayOffset * dayW + dayW / 2 - 1, bottom: 0, width: 2, height: 4, background: "#059669", borderRadius: 1 }} />
            )}
          </div>
        </div>
      </div>

      {/* ── 本体 ── */}
      <div ref={hs.bodyRef} className="task-hscroll-hide" onScroll={hs.onScroll}
        style={{ overflowX: "auto", overflowY: "hidden" }}>
        <div ref={hs.contentRef}
          style={{ width: LEFT_W + gridW, position: "relative", userSelect: drag ? "none" : undefined }}>

          {/* 日グリッド（土日の網掛け・月の区切り・今日の線）。行の後ろに敷く */}
          <div style={{ position: "absolute", top: 0, bottom: 0, left: LEFT_W, width: gridW, pointerEvents: "none", ...gridBg }}>
            {months.slice(1).map(m => (
              <div key={m.label} style={{ position: "absolute", top: 0, bottom: 0, left: m.start * dayW, width: 1, background: "rgba(26,23,20,0.10)" }} />
            ))}
            {todayOffset >= 0 && todayOffset < totalDays && (
              <div style={{ position: "absolute", top: 0, bottom: 0, left: todayOffset * dayW + dayW / 2 - 1, width: 2, background: "rgba(5,150,105,0.45)" }} />
            )}
          </div>

          {groups.map(g => (
            <div key={g.id || "none"} style={{ position: "relative" }}>
              <div style={{ display: "flex", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                <div style={{ ...stickyCell, height: GROUP_H, background: "#FAFAF9", display: "flex", alignItems: "center", gap: 5, padding: "0 12px" }}>
                  <FolderKanban style={{ width: 11, height: 11, color: "#A09790", flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6B6458", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{g.name}</span>
                  <span style={{ fontSize: 9.5, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>{g.count}</span>
                </div>
                <div style={{ width: gridW, height: GROUP_H, background: "rgba(250,250,249,0.7)" }} />
              </div>

              {g.roots.map(t => (
                <div key={t.id}>
                  {renderRow(t, 0)}
                  {!collapsed.has(t.id) && (kidsOf.get(t.id) ?? []).map(k => renderRow(k, 1))}
                </div>
              ))}
            </div>
          ))}

          {groups.length === 0 && (
            <div style={{ position: "relative", padding: "40px 0", textAlign: "center" as const, fontSize: 12, color: "#B0A9A4", width: "100%" }}>
              <div style={{ position: "sticky", left: 0, width: "min(100%, 100vw)" }}>期間が設定されたタスクがありません</div>
            </div>
          )}
        </div>
      </div>

      {/* 本体のスクロールバーは表の一番下に付いて見えないので、画面の下端に貼り付くバーを出す */}
      <StickyHScrollBar hs={hs} />
    </div>
  );
}
