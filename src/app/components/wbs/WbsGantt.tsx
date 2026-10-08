// ENHA2-053 WBSのガント（1日1列）。
//
// 表の右の枠（WbsTable）の中に、見出し・行ごとの帯・土日祝の縦帯を差し込む部品。
// 塗る範囲と並行タスク数は保存せず、行のデータと祝日から計算した WbsGanttModel を描くだけ。
//
// 列が多くなっても重くならないよう、行ごとにセルを日数ぶん並べない:
//   ・縦の罫線は背景の繰り返しで引く
//   ・期間は行ごとに帯を1本だけ置く
//   ・土日・祝日は全行を貫く縦帯を列ごとに1本だけ重ね、帯の上から隠す（＝その日は塗らない）
import { ganttIndexOf, textColorOn, type WbsGanttModel, type WbsRow } from "@/app/lib/wbsCalc";
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

/** ガントの見出し（年月・日付・曜日・日ごとの並行タスク数） */
export function WbsGanttHeader({ model }: { model: WbsGanttModel }) {
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
          <div key={d.str} title={d.isToday ? "今日" : undefined}
            style={{ ...headCellBase, color: WBS_COLORS.headText, ...(d.isToday ? { background: "#059669" } : null) }}>
            {d.day}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", background: WBS_COLORS.ganttDowBg }}>
        {model.days.map(d => (
          <div key={d.str} title={d.holidayName || undefined}
            style={{ ...headCellBase,
              color: d.holidayName ? "#CC3333" : d.dow === 6 ? "#93C6FF" : d.dow === 0 ? "#FFA5A5" : WBS_COLORS.headText,
              ...(d.holidayName ? { background: "#FFEAEA" } : null) }}>
            {DOW[d.dow]}
          </div>
        ))}
      </div>
      <div style={{ display: "flex" }}>
        {model.days.map(d => {
          const c = countColors(d.count);
          return (
            <div key={d.str} title={`並行タスク数 ${d.count}`}
              style={{ ...headCellBase, background: c.bg, color: c.color, borderRight: `1px solid ${WBS_COLORS.border}`, borderBottom: `1px solid ${WBS_COLORS.border}` }}>
              {d.count}
            </div>
          );
        })}
      </div>
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
 */
export function WbsGanttStrip({ model, row, statuses, rowH }: {
  model: WbsGanttModel; row?: WbsRow; statuses?: WbsStatus[]; rowH: number;
}) {
  let bar: { left: number; width: number; color: string } | null = null;
  if (row && row.item.startDate && row.item.endDate && row.item.endDate >= row.item.startDate) {
    // 範囲は行の日付の最小〜最大から作っているので、通常は必ず中に入る。
    // 表示日数の上限で切られた先は、見えている端まで塗る
    const from = ganttIndexOf(model, row.item.startDate);
    const to = ganttIndexOf(model, row.item.endDate) ?? (from !== null ? model.days.length - 1 : null);
    if (from !== null && to !== null) {
      const status = statuses?.find(s => s.id === row.item.statusId) ?? statuses?.[0];
      bar = { left: from * WBS_DAY_W, width: (to - from + 1) * WBS_DAY_W - 1, color: status?.color ?? "#D6E2F9" };
    }
  }
  return (
    <div style={stripBase(model, rowH)}>
      {bar && (
        <div title={row ? `${row.item.startDate} 〜 ${row.item.endDate}` : undefined}
          style={{ position: "absolute", top: 5, left: bar.left, width: bar.width, height: rowH - 11, background: bar.color, borderRadius: 3,
            boxShadow: `inset 0 0 0 1px ${textColorOn(bar.color) === "#FFFFFF" ? "rgba(255,255,255,0.25)" : "rgba(30,41,58,0.14)"}` }} />
      )}
    </div>
  );
}

/**
 * 全行を貫く縦帯。土日・祝日の列をグレーで覆い（帯の上から隠す）、今日の列に印を付ける。
 * left はガントの左端の位置、top は見出しの高さ。右の枠の中身（position: relative）の中に置く。
 */
export function WbsGanttOverlay({ model, left, top, rowH }: { model: WbsGanttModel; left: number; top: number; rowH: number }) {
  return (
    <div style={{ position: "absolute", top, bottom: 0, left, width: ganttWidth(model), pointerEvents: "none", zIndex: 2 }}>
      {model.days.map((d, i) => d.off ? (
        <div key={d.str} style={{
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
    </div>
  );
}
