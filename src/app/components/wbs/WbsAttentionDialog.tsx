// BRU20-009 WBSを開いたときのお知らせ。
// 遅延している作業と、開始予定日を過ぎても着手していない作業を並べ、押すとその行へ移動する。
// 「今日1日表示しない」は、利用者ごと・WBSごとにブラウザへ保存する（値は今日の日付）。
import { useState, type ReactNode } from "react";
import { AlertTriangle, Clock, ChevronRight } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { dayDiff, parseDateStr, type WbsRow } from "@/app/lib/wbsCalc";
import { WBS_COLORS } from "./wbsStyles";

export interface WbsAttentionRow {
  row: WbsRow;
  /** 開始予定日が今日以前で、進捗率が0% */
  notStarted: boolean;
}

export interface WbsAttention {
  /** 遅延している作業（終了予定日の古い順）。未着手にも当てはまる行は notStarted が true */
  delayed: WbsAttentionRow[];
  /** 開始予定日を過ぎても着手していない作業（開始予定日の古い順）。遅延している行は入れない */
  notStarted: WbsAttentionRow[];
}

/**
 * お知らせに出す行を集める。対象は一番右の段の行だけ（集計の件数と同じ範囲）。
 * 遅延の判定は buildWbsRows の delayed をそのまま使う（表の赤い行と食い違わないように）。
 * 着手したかは、着手日の欄が無く、利用者が足したステータスは名前が変わりうるので、進捗率で見る。
 * 取下の行は、遅延にも未着手にも出さない（BRU20-015）。
 */
export function collectWbsAttention(rows: WbsRow[], today: string): WbsAttention {
  const delayed: WbsAttentionRow[] = [];
  const notStarted: WbsAttentionRow[] = [];
  for (const row of rows) {
    if (!row.isLeafLevel || row.withdrawn) continue;
    const ns = !!row.item.startDate && row.item.startDate <= today && row.item.progress === 0;
    if (row.delayed) delayed.push({ row, notStarted: ns });
    else if (ns) notStarted.push({ row, notStarted: true });
  }
  delayed.sort((a, b) => a.row.item.endDate.localeCompare(b.row.item.endDate) || a.row.no - b.row.no);
  notStarted.sort((a, b) => a.row.item.startDate.localeCompare(b.row.item.startDate) || a.row.no - b.row.no);
  return { delayed, notStarted };
}

/** 「今日1日表示しない」を保存する場所。利用者ごと・WBSごと */
function dismissKey(userId: string, sheetId: string) { return `devticket:wbs:startAlert:${userId}:${sheetId}`; }

/** 今日は「表示しない」にしてあるか */
export function isWbsAttentionDismissed(userId: string, sheetId: string, today: string): boolean {
  try {
    return localStorage.getItem(dismissKey(userId, sheetId)) === today;
  } catch { /* 保存領域が使えない環境では、毎回出す */ }
  return false;
}

function saveDismissed(userId: string, sheetId: string, today: string) {
  try { localStorage.setItem(dismissKey(userId, sheetId), today); } catch { /* 保存できなくても閉じる */ }
}

/** 10/10 の形。今年でなければ年も付ける */
function shortDate(s: string, today: string): string {
  const d = parseDateStr(s);
  if (!d) return s;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return s.slice(0, 4) === today.slice(0, 4) ? md : `${d.getFullYear()}/${md}`;
}

function AttentionItem({ entry, kind, today, onPick }: {
  entry: WbsAttentionRow; kind: "delayed" | "notStarted"; today: string; onPick: () => void;
}) {
  const { row } = entry;
  const { item } = row;
  // 上の段の名前（例：基本設計 › DB設計）
  const parents = row.names.slice(0, Math.max(0, item.level - 1)).filter((n): n is string => !!n).join(" › ");
  const date = kind === "delayed" ? item.endDate : item.startDate;
  const today0 = parseDateStr(today);
  const day0 = parseDateStr(date);
  const diff = today0 && day0 ? dayDiff(day0, today0) : 0;
  const dateText = kind === "delayed"
    ? `${shortDate(date, today)} 終了予定（${diff}日超過）`
    : `${shortDate(date, today)} 開始予定（${diff > 0 ? `${diff}日経過` : "今日"}）`;
  const accent = kind === "delayed" ? WBS_COLORS.delayText : "#B45309";
  return (
    <button type="button" onClick={onPick} title="表のこの行へ移動します"
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", textAlign: "left", background: "#FFFFFF",
        border: "none", borderBottom: "1px solid rgba(26,23,20,0.06)", cursor: "pointer" }}>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.name || "（名前なし）"}
          </span>
          {kind === "delayed" && entry.notStarted && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 20, background: "#FFFBEB", color: "#D97706", border: "1px solid rgba(217,119,6,0.25)", whiteSpace: "nowrap", flexShrink: 0 }}>未着手</span>
          )}
        </span>
        {parents && (
          <span style={{ display: "block", fontSize: 11, color: "#A09790", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{parents}</span>
        )}
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "2px 10px", marginTop: 3, fontSize: 11, color: "#6B6458" }}>
          <span>担当：{item.assignee || "—"}</span>
          <span style={{ color: accent, fontWeight: 700 }}>{dateText}</span>
          {kind === "delayed" && <span>進捗 {row.progress ?? 0}%</span>}
        </span>
      </span>
      <ChevronRight style={{ width: 14, height: 14, color: "#C9CED6", flexShrink: 0 }} />
    </button>
  );
}

function Section({ icon, title, color, children }: { icon: ReactNode; title: string; color: string; children: ReactNode }) {
  return (
    <div>
      <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 800, color, marginBottom: 6 }}>{icon}{title}</p>
      <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>{children}</div>
    </div>
  );
}

export function WbsAttentionDialog({ attention, userId, sheetId, today, onJump, onClose }: {
  attention: WbsAttention;
  userId: string;
  sheetId: string;
  today: string;
  /** 行を押したとき。モーダルは閉じたうえで呼ぶ */
  onJump: (itemId: string) => void;
  onClose: () => void;
}) {
  const [dismiss, setDismiss] = useState(false);

  // 「閉じる」・✕・Esc・背景・行を押す、のどれで閉じても同じ扱いにする
  const close = () => {
    if (dismiss) saveDismissed(userId, sheetId, today);
    onClose();
  };
  const jump = (itemId: string) => {
    close();
    onJump(itemId);
  };

  return (
    <DialogShell title="対応が必要な作業があります" size="md" minHeight={0} onClose={close}
      footer={<>
        <label style={{ display: "flex", alignItems: "center", gap: 6, marginRight: "auto", fontSize: 12, color: "#6B6458", cursor: "pointer" }}>
          <input type="checkbox" checked={dismiss} onChange={e => setDismiss(e.target.checked)} style={{ accentColor: "#059669" }} />
          今日1日表示しない
        </label>
        <BtnSecondary onClick={close}>閉じる</BtnSecondary>
      </>}>
      <p style={{ fontSize: 12, color: "#6B6458" }}>行を押すと、表のその行へ移動します。</p>
      {attention.delayed.length > 0 && (
        <Section icon={<AlertTriangle style={{ width: 13, height: 13 }} />} title={`遅延している作業（${attention.delayed.length}件）`} color={WBS_COLORS.delayText}>
          {attention.delayed.map(e => (
            <AttentionItem key={e.row.item.id} entry={e} kind="delayed" today={today} onPick={() => jump(e.row.item.id)} />
          ))}
        </Section>
      )}
      {attention.notStarted.length > 0 && (
        <Section icon={<Clock style={{ width: 13, height: 13 }} />} title={`開始予定日を過ぎても着手していない作業（${attention.notStarted.length}件）`} color="#B45309">
          {attention.notStarted.map(e => (
            <AttentionItem key={e.row.item.id} entry={e} kind="notStarted" today={today} onPick={() => jump(e.row.item.id)} />
          ))}
        </Section>
      )}
    </DialogShell>
  );
}
