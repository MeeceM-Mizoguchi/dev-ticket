// WBSのマスタースケジュール。
//
// 大項目だけを1行ずつ並べ、その期間を矢羽根（右端がとがった横棒）で引く表。
// 期間は保存せず、一番右の段の行の日付から計算する（wbsCalc.buildWbsMasterRows）。
// 見るだけの表なので、WBS画面の表（WbsTable）のような編集・左右の枠の分割は持たない。
// 1つのスクロール枠の中で、見出しは上に、左の列は左に貼り付ける。
//
// 枠の大きさに合わせて描く:
//   ・横 … 目盛りの幅が枠より狭いときは、1日の幅を広げて枠の右端までちょうど使う
//          （月の目盛りは1日3pxなので、広げないと3か月で約270pxしか使わず右が空く）
//   ・縦 … 行が少ないときは、空の行を足して枠の下まで罫線と縞を続ける
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { dayDiff, parseDateStr, textColorOn, type WbsMasterRow, type WbsMasterStatus, type WbsMasterTimeline } from "@/app/lib/wbsCalc";
import { DEFAULT_WBS_STATUSES } from "@/app/lib/wbsService";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { WBS_GANTT_HEAD_ROW_H, useGanttTip } from "./WbsGantt";
import { WBS_ROW_H } from "./WbsTable";
import { WBS_COLORS } from "./wbsStyles";

const ROW_H = WBS_ROW_H + 4;
const COLS = [
  { key: "no", label: "No", width: 48, align: "center" },
  { key: "name", label: "大項目", width: 260, align: "flex-start" },
  { key: "start", label: "開始日", width: 104, align: "center" },
  { key: "end", label: "終了日", width: 104, align: "center" },
  { key: "status", label: "ステータス", width: 164, align: "center" },
] as const;
/** 左の列の幅。右の境目の線（2px）を含む。目盛りはこの右から始まる */
const LEFT_W = COLS.reduce((s, c) => s + c.width, 0) + 2;
const LEFT_TEMPLATE = COLS.map(c => `${c.width}px`).join(" ");
const HEAD_H = WBS_GANTT_HEAD_ROW_H * 2 + 4;
const BAR_H = 16;
const ARROW_COLOR = "#3E5F90";
const TODAY = "#059669";
/** マウスを乗せた行（押すとWBSの画面へ移る） */
const HOVER_BG = "#EAF7F1";
/** 月（「月」の目盛りでは年）の境目の線。日・週の区切りより濃くする */
const MAJOR_LINE = "#C9D2DE";

/** YYYY-MM-DD → YYYY/MM/DD。空なら「—」 */
function fmtDate(s: string): string { return s ? s.replace(/-/g, "/") : "—"; }

const headCell: CSSProperties = {
  boxSizing: "border-box", display: "flex", alignItems: "center",
  fontWeight: 700, color: WBS_COLORS.headText, whiteSpace: "nowrap", overflow: "hidden",
};

/** 矢羽根を引く範囲（列の番号）。日付が欠けている・終了が開始より前・範囲の外なら null */
function arrowRange(row: WbsMasterRow, tl: WbsMasterTimeline): { from: number; to: number } | null {
  const first = parseDateStr(tl.start);
  const s = parseDateStr(row.start);
  const e = parseDateStr(row.end);
  if (!first || !s || !e || e < s) return null;
  const from = Math.max(0, dayDiff(first, s));
  const to = Math.min(tl.length - 1, dayDiff(first, e));
  return from > to ? null : { from, to };
}

/**
 * ステータスのバッジ。色はそのWBSで同じ名前のステータスの色（WBS画面と同じ）。
 * 「完了（一部保留あり）」は「完了」の色。名前を変えて見つからないときは、はじめの5つの色を使う。
 */
function StatusBadge({ status, colors }: { status: WbsMasterStatus | null; colors: ReadonlyMap<string, string> }) {
  if (!status) return <span style={{ color: WBS_COLORS.ancestorText }}>—</span>;
  const base = status.startsWith("完了") ? "完了" : status;
  const bg = colors.get(base) ?? DEFAULT_WBS_STATUSES.find(s => s.name === base)?.color ?? "#EDECF4";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 10px", borderRadius: 11, maxWidth: "100%",
      background: bg, color: textColorOn(bg), fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
      boxShadow: "inset 0 0 0 1px rgba(30,41,58,0.08)" }}>
      {status}
    </span>
  );
}

/** 矢羽根のツールチップ。大項目の下にある中項目を並べる */
function childrenTipText(row: WbsMasterRow): string {
  return [`${row.item.name || "（名前なし）"} の中項目（${row.children.length}件）`, ...row.children.map(c => `・${c || "（名前なし）"}`)].join("\n");
}

/** 日付が無くて矢羽根を引けない行に出す理由 */
function missingText(row: WbsMasterRow, leafLabel: string): string {
  if (!row.start && !row.end) return `${leafLabel}に予定日が入っていません`;
  if (!row.start) return `${leafLabel}に開始予定日が入っていません`;
  if (!row.end) return `${leafLabel}に終了予定日が入っていません`;
  return "終了日が開始日より前になっています";
}

export function WbsMasterSchedule({ rows, timeline, leafLabel, statusColors, onOpenItem }: {
  rows: WbsMasterRow[];
  timeline: WbsMasterTimeline;
  /** 期間を取っている段の名前（小項目・中項目・大項目）。日付が無い行の説明に使う */
  leafLabel: string;
  /** そのWBSのステータスの「名前 → 色」 */
  statusColors: ReadonlyMap<string, string>;
  /** 行を押したとき。WBSの画面へ戻って、その大項目の行を強調する */
  onOpenItem: (itemId: string) => void;
}) {
  const tip = useGanttTip();
  // マウスを乗せている行。押せることが分かるよう、行全体（左の列と矢羽根の側）の色を変える
  const [hoverId, setHoverId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // clientWidth / clientHeight はスクロールバーを除いた広さ
    const update = () => setBox(prev => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const isDay = timeline.scale === "day";
  // 枠より狭ければ広げる。狭めはしない（日・週の目盛りが詰まって読めなくなるので、その場合は横にスクロール）
  // 小数の幅の端数で1pxはみ出すと、横のスクロールバーが出て縦も足りなくなるので、少し内側に収める
  const fitPpd = box.w > LEFT_W ? (box.w - LEFT_W - 1) / timeline.length : 0;
  const ppd = Math.max(timeline.pxPerDay, fitPpd);
  const chartW = timeline.length * ppd;

  // 枠の下まで埋める空の行。最後の1行に満たない端数は、高さを合わせた行で埋める
  const bodyH = Math.max(0, box.h - HEAD_H);
  const fillerCount = Math.max(0, Math.floor(bodyH / ROW_H) - rows.length);
  const restH = Math.max(0, bodyH - (rows.length + fillerCount) * ROW_H);

  const firstUnit = new Set(timeline.top.map(t => t.from));
  const todayX = timeline.todayIndex === null ? null : timeline.todayIndex * ppd;

  const line = (key: string, i: number, d: number, last = false): ReactNode => (
    <div key={key} style={{ display: "flex", height: d }}>
      <div style={{ position: "sticky", left: 0, zIndex: 3, display: "grid", gridTemplateColumns: LEFT_TEMPLATE,
        background: i % 2 === 1 ? WBS_COLORS.stripeBg : "#FFFFFF", borderRight: `2px solid ${WBS_COLORS.headBg}` }}>
        {COLS.map(c => (
          <div key={c.key} style={{ borderRight: `1px solid ${WBS_COLORS.border}`, borderBottom: last ? undefined : `1px solid ${WBS_COLORS.border}` }} />
        ))}
      </div>
      <div style={{ flex: `0 0 ${chartW}px`, width: chartW, borderBottom: last ? undefined : `1px solid ${WBS_COLORS.border}`,
        background: i % 2 === 1 ? "rgba(248,249,251,0.6)" : undefined }} />
    </div>
  );

  return (
    <div ref={scrollRef} style={{ height: "100%", overflow: "auto", overscrollBehaviorX: "contain" }}>
      {rows.length === 0 && (
        <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#1A1714" }}>大項目がまだありません</p>
          <p style={{ fontSize: 12, color: "#A09790" }}>WBSの画面で大項目を追加すると、ここに表示されます。</p>
        </div>
      )}
      {rows.length > 0 && box.w > 0 && (
        <div style={{ position: "relative", width: LEFT_W + chartW }}>
          {/* 見出し。左の列の見出しは、横にスクロールしても左に残す */}
          <div style={{ position: "sticky", top: 0, zIndex: 5, display: "flex", height: HEAD_H, background: WBS_COLORS.headBg }}>
            <div style={{ position: "sticky", left: 0, zIndex: 6, display: "grid", gridTemplateColumns: LEFT_TEMPLATE, background: WBS_COLORS.headBg, borderRight: `2px solid ${WBS_COLORS.headBg}` }}>
              {COLS.map(c => (
                <div key={c.key} style={{ ...headCell, height: HEAD_H, padding: "0 10px", fontSize: 12, justifyContent: c.align,
                  borderRight: "1px solid rgba(255,255,255,0.14)" }}>{c.label}</div>
              ))}
            </div>
            <div style={{ position: "relative", flex: `0 0 ${chartW}px`, width: chartW }}>
              {/* 上の段（日・週＝年月 / 月＝年） */}
              <div style={{ position: "relative", height: WBS_GANTT_HEAD_ROW_H + 2, background: WBS_COLORS.ganttHeadBg }}>
                {timeline.top.map(u => (
                  <div key={`t-${u.from}`} style={{ ...headCell, position: "absolute", top: 0, bottom: 0, left: u.from * ppd, width: u.span * ppd,
                    padding: "0 8px", fontSize: 11, borderLeft: u.from > 0 ? "1px solid rgba(255,255,255,0.28)" : undefined }}>
                    {/* 狭くて収まらないときは出さない（日の目盛りで、月の列が数日ぶんしか無いとき） */}
                    {u.span * ppd >= 64 ? u.label : ""}
                  </div>
                ))}
              </div>
              {/* 下の段（日＝日付 / 週＝週の初めの日 / 月＝何月） */}
              <div style={{ position: "relative", height: WBS_GANTT_HEAD_ROW_H + 2, background: WBS_COLORS.ganttDowBg }}>
                {timeline.units.map(u => (
                  <div key={`u-${u.from}`} style={{ ...headCell, position: "absolute", top: 0, bottom: 0, left: u.from * ppd, width: u.span * ppd,
                    justifyContent: timeline.scale === "week" ? "flex-start" : "center", padding: timeline.scale === "week" ? "0 6px" : 0,
                    fontSize: isDay ? 10 : 11,
                    borderLeft: u.from > 0 ? `1px solid ${firstUnit.has(u.from) ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"}` : undefined,
                    ...(isDay && u.from === timeline.todayIndex ? { background: TODAY } : null) }}>
                    {u.label}
                  </div>
                ))}
                {/* 今日の位置の印（日の目盛りは、日付のマスを塗っているので出さない） */}
                {!isDay && todayX !== null && (
                  <div style={{ position: "absolute", bottom: 0, left: todayX + ppd / 2 - 7, width: 0, height: 0,
                    borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderBottom: `9px solid ${TODAY}` }} />
                )}
              </div>
            </div>
          </div>

          <div style={{ position: "relative" }}>
            {/* 目盛りの縦線・土日祝の列・今日の印。行の罫線より上、矢羽根より下に重ねる */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: LEFT_W, width: chartW, pointerEvents: "none", zIndex: 1 }}>
              {timeline.offDays.map(i => (
                <div key={`off-${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: i * ppd, width: ppd, background: "rgba(226,232,242,0.55)" }} />
              ))}
              {timeline.units.map(u => u.from > 0 ? (
                <div key={`line-${u.from}`} style={{ position: "absolute", top: 0, bottom: 0, left: u.from * ppd, width: 1,
                  background: firstUnit.has(u.from) ? MAJOR_LINE : WBS_COLORS.border }} />
              ) : null)}
              {/* 週の目盛りでは月の境目が週の途中に来るので、別に引く */}
              {timeline.scale === "week" && timeline.top.map(t => t.from > 0 ? (
                <div key={`major-${t.from}`} style={{ position: "absolute", top: 0, bottom: 0, left: t.from * ppd, width: 1, background: MAJOR_LINE }} />
              ) : null)}
              {todayX !== null && (isDay ? (
                <div style={{ position: "absolute", top: 0, bottom: 0, left: todayX, width: ppd, boxSizing: "border-box",
                  borderLeft: `2px solid ${TODAY}`, borderRight: `2px solid ${TODAY}`, background: "rgba(5,150,105,0.06)" }} />
              ) : (
                <div style={{ position: "absolute", top: 0, bottom: 0, left: todayX + ppd / 2 - 1, width: 2, background: TODAY, opacity: 0.85 }} />
              ))}
            </div>

            {rows.map((r, i) => {
              const range = arrowRange(r, timeline);
              const hovered = hoverId === r.item.id;
              const rowBg = hovered ? HOVER_BG : i % 2 === 1 ? WBS_COLORS.stripeBg : "#FFFFFF";
              const cells: Record<(typeof COLS)[number]["key"], ReactNode> = {
                no: r.no,
                name: <TruncatedText text={r.item.name || "（名前なし）"} />,
                start: fmtDate(r.start),
                end: fmtDate(r.end),
                status: <StatusBadge status={r.status} colors={statusColors} />,
              };
              // 1日だけの期間でも矢羽根の形が見えるよう、最低の幅を取る
              const barW = range ? Math.max((range.to - range.from + 1) * ppd - 2, 14) : 0;
              const pointW = Math.min(9, barW / 2);
              return (
                <div key={r.item.id} onClick={() => onOpenItem(r.item.id)}
                  onMouseEnter={() => setHoverId(r.item.id)} onMouseLeave={() => setHoverId(prev => (prev === r.item.id ? null : prev))}
                  style={{ display: "flex", height: ROW_H, cursor: "pointer" }}>
                  <div style={{ position: "sticky", left: 0, zIndex: 3, display: "grid", gridTemplateColumns: LEFT_TEMPLATE, background: rowBg, borderRight: `2px solid ${WBS_COLORS.headBg}` }}>
                    {COLS.map(c => (
                      <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: c.align, minWidth: 0,
                        height: ROW_H, padding: "0 10px", boxSizing: "border-box",
                        fontSize: c.key === "name" ? 13 : 12, fontWeight: c.key === "name" ? 700 : 400,
                        color: c.key === "name" ? WBS_COLORS.text : cells[c.key] === "—" ? WBS_COLORS.ancestorText : WBS_COLORS.subText,
                        fontVariantNumeric: "tabular-nums",
                        borderRight: `1px solid ${WBS_COLORS.border}`, borderBottom: `1px solid ${WBS_COLORS.border}` }}>
                        {cells[c.key]}
                      </div>
                    ))}
                  </div>
                  <div style={{ position: "relative", flex: `0 0 ${chartW}px`, width: chartW, height: ROW_H, boxSizing: "border-box",
                    borderBottom: `1px solid ${WBS_COLORS.border}`, background: hovered ? HOVER_BG : i % 2 === 1 ? "rgba(248,249,251,0.6)" : undefined }}>
                    {range ? (
                      // 乗せると中項目の一覧を出す（中項目が無い＝1段のWBSなどでは出さない）
                      <div data-master-arrow="" {...(r.children.length > 0 ? tip.bind(childrenTipText(r), "pointer") : null)}
                        style={{ position: "absolute", zIndex: 2, top: (ROW_H - BAR_H) / 2, height: BAR_H, left: range.from * ppd + 1, width: barW,
                          background: ARROW_COLOR, filter: "drop-shadow(0 1px 1px rgba(30,41,58,0.18))",
                          clipPath: `polygon(0 0, calc(100% - ${pointW}px) 0, 100% 50%, calc(100% - ${pointW}px) 100%, 0 100%)` }} />
                    ) : (
                      // 矢羽根を引けない理由。横にスクロールしても見えるよう、左の列のすぐ右に貼り付ける
                      // 今日の線・休日の色の上に重なっても読めるよう、行と同じ色の地を敷く
                      <span style={{ position: "sticky", left: LEFT_W + 12, zIndex: 2, display: "inline-flex", alignItems: "center",
                        height: 20, marginTop: (ROW_H - 21) / 2, marginLeft: 12, padding: "0 8px", borderRadius: 4,
                        background: rowBg, fontSize: 11, color: WBS_COLORS.ancestorText, whiteSpace: "nowrap" }}>
                        {missingText(r, leafLabel)}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {Array.from({ length: fillerCount }, (_, k) => line(`f${k}`, rows.length + k, ROW_H))}
            {restH > 0 && line("rest", rows.length + fillerCount, restH, true)}
          </div>
        </div>
      )}
      {tip.node}
    </div>
  );
}
