// ENHA2-053 WBS画面の部品で共通に使う見た目。
// 色は参考の Excel（WBS.xlsx のシート「WBS」）に合わせてある。
import type { CSSProperties } from "react";

export const WBS_COLORS = {
  /** 表の見出し（紺） */
  headBg: "#1E3989",
  /** ガントの日付の見出し */
  ganttHeadBg: "#19355D",
  /** ガントの曜日の見出し */
  ganttDowBg: "#3E5F90",
  headText: "#FFFFFF",
  /** 大項目のまとまりごとに交互に敷く背景 */
  stripeBg: "#F8F9FB",
  border: "#E2E6EC",
  /** 属している上の段の名前（薄い灰色） */
  ancestorText: "#A5B2BF",
  text: "#1E293A",
  subText: "#63748A",
  /** 土日・祝日の列 */
  offDayBg: "#F2F4F9",
  /** 遅延（終了予定日を過ぎていて進捗率が100%でない） */
  delayBg: "#FDE3E6",
  delayText: "#9F1239",
  /** 段数を減らせない理由になっている行の強調 */
  highlightBg: "#FECACA",
} as const;

/** 上部の操作列に並べる小さなボタン */
export const wbsToolBtn: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 10px",
  fontSize: 12, fontWeight: 600, color: "#4B5563", background: "#FFFFFF",
  border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
};

export const wbsToolBtnDisabled: CSSProperties = { ...wbsToolBtn, color: "#C9C4BB", cursor: "not-allowed" };

/** 上部の操作列に並べるプルダウン */
export const wbsToolSelect: CSSProperties = {
  height: 30, padding: "0 8px", fontSize: 12, fontWeight: 600, color: "#1A1714", background: "#FFFFFF",
  border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8, cursor: "pointer", flexShrink: 0,
};

export const wbsToolLabel: CSSProperties = { fontSize: 11, fontWeight: 700, color: "#A09790", whiteSpace: "nowrap", flexShrink: 0 };
