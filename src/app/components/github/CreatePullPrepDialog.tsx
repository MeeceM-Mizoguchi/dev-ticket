// PR作成ボタンを押してから、作成ダイアログが開くまでの進捗（BRU13-019）。
//
// チケット詳細を開いた時点では GitHub を一切叩かないようにしたため、
// 「ブランチ一覧の取得」と「このチケットのブランチ探し」は押してから走る。
// どちらも数秒かかることがあるので、何を待っているのかをここで出す
// （出さないと「押したのに何も起きない」に見える）。
import { Check, Loader2, Minus } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";

/** running … 実行中／done … 完了／none … 完了したが該当なし／failed … 失敗（作成は続行できる）／skipped … 行ごと出さない */
export type PrepStepState = "running" | "done" | "none" | "failed" | "skipped";

export interface PrepState {
  /** ブランチ一覧の取得。PR作成に必須 */
  branches: PrepStepState;
  /** このチケットのWBS番号を含む、まだPRが無いブランチ探し。head の初期選択に使うだけ */
  candidates: PrepStepState;
}

const ROWS: Array<{ key: keyof PrepState; label: string; done: string; none: string; failed: string }> = [
  {
    key: "branches",
    label: "ブランチを読み込んでいます...",
    done: "ブランチを読み込みました",
    none: "ブランチを読み込みました",
    failed: "ブランチを読み込めませんでした",
  },
  {
    key: "candidates",
    label: "このチケットのブランチを探しています...",
    done: "このチケットのブランチが見つかりました",
    none: "このチケットのブランチは見つかりませんでした（作成画面で選べます）",
    failed: "ブランチの検索に失敗しました（作成画面で選べます）",
  },
];

export function CreatePullPrepDialog({ state, onCancel }: { state: PrepState; onCancel: () => void }) {
  return (
    <DialogShell title="プルリクエストの準備" size="sm" onClose={onCancel}
      footer={<BtnSecondary onClick={onCancel}>キャンセル</BtnSecondary>}>
      <style>{"@keyframes cpp-spin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
        {ROWS.map(row => {
          const s = state[row.key];
          if (s === "skipped") return null;
          const text = s === "running" ? row.label : s === "failed" ? row.failed : s === "none" ? row.none : row.done;
          const color = s === "running" ? "#1A1714" : s === "failed" ? "#B45309" : "#6B6458";
          return (
            <div key={row.key} style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
              <span style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {s === "running"
                  ? <Loader2 style={{ width: 13, height: 13, color: "#059669", animation: "cpp-spin 1s linear infinite" }} />
                  : s === "failed"
                    ? <Minus style={{ width: 13, height: 13, color: "#B45309" }} />
                    : <Check style={{ width: 13, height: 13, color: "#059669" }} />}
              </span>
              <p style={{ fontSize: 12, fontWeight: s === "running" ? 700 : 600, color, lineHeight: 1.6 }}>{text}</p>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "#A09790", lineHeight: 1.7 }}>
        準備ができ次第、プルリクエストの作成画面を開きます。
      </p>
    </DialogShell>
  );
}
