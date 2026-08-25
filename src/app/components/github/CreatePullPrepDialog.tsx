// PR作成ボタンを押してから、作成ダイアログが開くまでの進捗（BRU13-019）。
//
// チケット詳細を開いた時点では GitHub を一切叩かないようにしたため、
// 「ブランチ一覧の取得」と「このチケットのブランチ探し」は押してから走る。
// どちらも数秒かかることがあるので、何を待っているのかをここで出す
// （出さないと「押したのに何も起きない」に見える）。
//
// 行の見た目・％の輪・つなぎの棒は共通の StepProgress に寄せてある（マージ側と揃えるため）。
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { StepProgressPanel, type ProgressStep, type StepState } from "@/app/components/shared/StepProgress";

/** running … 実行中／done … 完了／none … 完了したが該当なし／failed … 失敗（作成は続行できる）／skipped … 行ごと出さない */
export type PrepStepState = StepState;

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
  const steps: ProgressStep[] = ROWS.map(row => {
    const s = state[row.key];
    return {
      key: row.key,
      state: s,
      text: s === "running" ? row.label : s === "failed" ? row.failed : s === "none" ? row.none : row.done,
    };
  });

  return (
    <DialogShell title="プルリクエストの準備" size="sm" onClose={onCancel}
      footer={<BtnSecondary onClick={onCancel}>キャンセル</BtnSecondary>}>
      <StepProgressPanel steps={steps} note="準備ができ次第、プルリクエストの作成画面を開きます。" />
    </DialogShell>
  );
}
