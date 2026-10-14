// ENHA2-053 WBSのガント（1日1列）。
//
// 表の右の枠（WbsTable）の中に、見出し・行ごとの帯・土日祝の縦帯を差し込む部品。
// 塗る範囲と並行タスク数は保存せず、行のデータと祝日から計算した WbsGanttModel を描くだけ。
//
// 列が多くなっても重くならないよう、行ごとにセルを日数ぶん並べない:
//   ・縦の罫線は背景の繰り返しで引く
//   ・期間は、稼働日の続きごとに四角を1つずつ置く（土日・祝日をまたぐところで分かれる）
//   ・土日・祝日は全行を貫く縦帯を列ごとに1本だけ重ねてグレーにする
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { Tip, type TipAnchor } from "@/app/components/shared/HoverTip";
import { ganttIndexOf, textColorOn, type WbsGanttDay, type WbsGanttModel, type WbsRow } from "@/app/lib/wbsCalc";
import type { WbsStatus } from "@/app/types";
import { WBS_COLORS } from "./wbsStyles";

export const WBS_DAY_W = 24;
/** 見出しは「年月／日付／曜日／並行タスク数」の4段 */
export const WBS_GANTT_HEAD_ROW_H = 22;
export const WBS_GANTT_HEAD_H = WBS_GANTT_HEAD_ROW_H * 4;

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

export function ganttWidth(model: WbsGanttModel) { return model.days.length * WBS_DAY_W; }

/** 並行タスク数のセルの色（参考の Excel に合わせる。3以上は高負荷として赤） */
function countColors(count: number): { bg: string; color: string } {
  if (count >= 3) return { bg: WBS_COLORS.delayBg, color: WBS_COLORS.delayText };
  if (count === 2) return { bg: "#FFD8BF", color: "#BF3300" };
  if (count === 1) return { bg: "#E0F2E5", color: "#19723F" };
  return { bg: "#F4F7F9", color: "#A5B2BF" };
}

const headCellBase = {
  flex: `0 0 ${WBS_DAY_W}px`, width: WBS_DAY_W, height: WBS_GANTT_HEAD_ROW_H, boxSizing: "border-box",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700,
  borderRight: "1px solid rgba(255,255,255,0.14)",
} as const;

/** 休日の列に出す説明。1行目に日付、2行目に休日設定で付けた名前 */
function holidayTipText(d: WbsGanttDay): string {
  const [, m, day] = d.str.split("-").map(Number);
  return `${m}/${day}（${DOW[d.dow]}）\n${d.holidayName || "休日"}`;
}

/**
 * マウスを乗せたときの説明を、アプリのツールチップ（HoverTip の Tip）で出す。
 * ブラウザ標準の title は使わない（文字のある要素では見切れているときしか出ず、見た目もOS任せになる）。
 *
 * at:
 *   element … 乗せた要素のすぐ下に出す（見出しのセル）
 *   pointer … マウスの位置に出す（表の下まで伸びる縦帯。要素の端に出すと画面の外になる）
 */
function useGanttTip() {
  const [shown, setShown] = useState<{ anchor: TipAnchor; text: string } | null>(null);
  const timer = useRef<number | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const hide = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    setShown(null);
  };
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const bind = (text: string, at: "element" | "pointer") => ({
    onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
      hide();
      pointer.current = { x: e.clientX, y: e.clientY };
      const el = e.currentTarget;
      // すぐ出すと、通り過ぎただけで点滅する
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        const { x, y } = pointer.current;
        setShown({
          text,
          anchor: at === "element"
            ? { top: r.top, bottom: r.bottom, left: r.left }
            : { top: y - 8, bottom: y + 12, left: x - 14 },
        });
      }, 200);
    },
    onMouseMove: (e: ReactMouseEvent<HTMLElement>) => { pointer.current = { x: e.clientX, y: e.clientY }; },
    onMouseLeave: hide,
  });

  return { bind, node: shown ? createPortal(<Tip anchor={shown.anchor} text={shown.text} />, document.body) : null };
}

/** ガントの見出し（年月・日付・曜日・日ごとの並行タスク数） */
export function WbsGanttHeader({ model }: { model: WbsGanttModel }) {
  const tip = useGanttTip();
  // 休日設定で登録した日は、見出しのどの段に乗せても休日の名前を出す
  const holidayProps = (d: WbsGanttDay) => (d.isHoliday ? tip.bind(holidayTipText(d), "element") : null);
  return (
    <div style={{ flex: `0 0 ${ganttWidth(model)}px`, width: ganttWidth(model) }}>
      <div style={{ display: "flex", background: WBS_COLORS.ganttHeadBg }}>
        {model.months.map((m, i) => (
          <div key={`${m.label}-${i}`} style={{ ...headCellBase, flex: `0 0 ${m.span * WBS_DAY_W}px`, width: m.span * WBS_DAY_W, justifyContent: "flex-start", padding: "0 6px", fontSize: 11, color: WBS_COLORS.headText, whiteSpace: "nowrap", overflow: "hidden" }}>
            {/* 月の列が狭いと収まらないので、3列ぶん以上あるときだけ出す */}
            {m.span >= 3 ? m.label : ""}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", background: WBS_COLORS.ganttHeadBg }}>
        {model.days.map(d => (
          <div key={d.str} {...holidayProps(d)}
            style={{ ...headCellBase, color: WBS_COLORS.headText, ...(d.isToday ? { background: "#059669" } : null) }}>
            {d.day}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", background: WBS_COLORS.ganttDowBg }}>
        {model.days.map(d => (
          <div key={d.str} {...holidayProps(d)}
            style={{ ...headCellBase,
              color: d.isHoliday ? "#CC3333" : d.dow === 6 ? "#93C6FF" : d.dow === 0 ? "#FFA5A5" : WBS_COLORS.headText,
              ...(d.isHoliday ? { background: "#FFEAEA" } : null) }}>
            {DOW[d.dow]}
          </div>
        ))}
      </div>
      <div style={{ display: "flex" }}>
        {model.days.map(d => {
          const c = countColors(d.count);
          return (
            <div key={d.str} {...holidayProps(d)}
              style={{ ...headCellBase, background: c.bg, color: c.color, borderRight: `1px solid ${WBS_COLORS.border}`, borderBottom: `1px solid ${WBS_COLORS.border}` }}>
              {d.count}
            </div>
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}

const stripBase = (model: WbsGanttModel, rowH: number) => ({
  position: "relative", flex: `0 0 ${ganttWidth(model)}px`, width: ganttWidth(model), height: rowH, boxSizing: "border-box",
  borderBottom: `1px solid ${WBS_COLORS.border}`,
  // 1日ごとの縦の罫線
  backgroundImage: `linear-gradient(to right, transparent ${WBS_DAY_W - 1}px, ${WBS_COLORS.border} ${WBS_DAY_W - 1}px)`,
  backgroundSize: `${WBS_DAY_W}px 100%`,
} as const);

/**
 * 1行ぶんの帯。その行自身の開始予定日〜終了予定日を、その行のステータスの色で塗る
 * （大項目・中項目の行も同じ）。row を渡さなければ罫線だけの空の行。
 *
 * 土日・祝日をまたぐときは、1本の帯を上から隠すのではなく、稼働日の続きごとに
 * 四角を分けて描く（休みの手前で一度閉じ、休み明けからまた始める）。
 * 1本の帯を隠すだけだと、休みの前後で角が切り落とされて、つなぎ目が不自然に見える。
 * 区切りは曜日ではなく「その日が休みかどうか」で決めるので、祝日が平日に挟まっても、
 * 連休で金曜より前に終わる／月曜より後に始まる場合でも、同じ規則で分かれる。
 */
export function WbsGanttStrip({ model, row, statuses, rowH, fill }: {
  model: WbsGanttModel; row?: WbsRow; statuses?: WbsStatus[]; rowH: number;
  /**
   * 見出し行（大項目・中項目）用。渡した色で帯全体を塗りつぶす。
   * 日付の罫線も引かず、土日・休日の縦帯と今日の印より手前に重ねて隠す（行の色がひと続きに見えるように）。
   */
  fill?: string;
}) {
  if (fill) {
    return (
      <div style={{ position: "relative", zIndex: 3, flex: `0 0 ${ganttWidth(model)}px`, width: ganttWidth(model), height: rowH, boxSizing: "border-box",
        background: fill, borderBottom: `1px solid ${WBS_COLORS.border}` }} />
    );
  }
  // 稼働日が続く範囲（列の番号で from〜to）
  const segments: { from: number; to: number }[] = [];
  let color = "#D6E2F9";
  if (row && row.item.startDate && row.item.endDate && row.item.endDate >= row.item.startDate) {
    // 範囲は行の日付を含む月から作っているので、通常は必ず中に入る。
    // 表示日数の上限で切られた先は、見えている端まで塗る
    const from = ganttIndexOf(model, row.item.startDate);
    const to = ganttIndexOf(model, row.item.endDate) ?? (from !== null ? model.days.length - 1 : null);
    if (from !== null && to !== null) {
      color = (statuses?.find(s => s.id === row.item.statusId) ?? statuses?.[0])?.color ?? color;
      let start: number | null = null;
      for (let i = from; i <= to; i++) {
        if (!model.days[i].off) {
          if (start === null) start = i;
        } else if (start !== null) {
          segments.push({ from: start, to: i - 1 });
          start = null;
        }
      }
      if (start !== null) segments.push({ from: start, to });
    }
  }
  const outline = `inset 0 0 0 1px ${textColorOn(color) === "#FFFFFF" ? "rgba(255,255,255,0.25)" : "rgba(30,41,58,0.14)"}`;
  return (
    <div style={stripBase(model, rowH)}>
      {segments.map(seg => (
        // 左右に1pxずつ余白を取り、日付の罫線と四角の端が重ならないようにする
        <div key={seg.from} title={row ? `${row.item.startDate} 〜 ${row.item.endDate}` : undefined}
          style={{ position: "absolute", top: 5, left: seg.from * WBS_DAY_W + 1, width: (seg.to - seg.from + 1) * WBS_DAY_W - 3, height: rowH - 11,
            background: color, borderRadius: 3, boxShadow: outline }} />
      ))}
    </div>
  );
}

/**
 * 全行を貫く縦帯。土日・祝日の列をグレーにし、今日の列に印を付ける。
 * left はガントの左端の位置、top は見出しの高さ。右の枠の中身（position: relative）の中に置く。
 */
export function WbsGanttOverlay({ model, left, top, rowH }: { model: WbsGanttModel; left: number; top: number; rowH: number }) {
  const tip = useGanttTip();
  return (
    <div style={{ position: "absolute", top, bottom: 0, left, width: ganttWidth(model), pointerEvents: "none", zIndex: 2 }}>
      {model.days.map((d, i) => d.off ? (
        // 休日設定で登録した日の列だけ、マウスを受けて休日の名前を出す（土日の列は素通しのまま）
        <div key={d.str} {...(d.isHoliday ? tip.bind(holidayTipText(d), "pointer") : null)} style={{
          pointerEvents: d.isHoliday ? "auto" : "none",
          position: "absolute", top: 0, bottom: 0, left: i * WBS_DAY_W, width: WBS_DAY_W, boxSizing: "border-box",
          backgroundColor: WBS_COLORS.offDayBg, borderRight: `1px solid ${WBS_COLORS.border}`,
          // 覆った列にも行の罫線を引き直す
          backgroundImage: `linear-gradient(to bottom, transparent ${rowH - 1}px, ${WBS_COLORS.border} ${rowH - 1}px)`,
          backgroundSize: `100% ${rowH}px`,
        }} />
      ) : null)}
      {model.days.map((d, i) => d.isToday ? (
        <div key={`today-${d.str}`} style={{
          position: "absolute", top: 0, bottom: 0, left: i * WBS_DAY_W, width: WBS_DAY_W - 1, boxSizing: "border-box",
          borderLeft: "2px solid #059669", borderRight: "2px solid #059669", background: "rgba(5,150,105,0.06)",
        }} />
      ) : null)}
      {tip.node}
    </div>
  );
}
