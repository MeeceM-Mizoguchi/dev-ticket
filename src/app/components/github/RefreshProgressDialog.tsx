// GitHubタブの「更新」を押したあとに出す進捗画面。
//
// これまで押しても変わるのはボタンの文字（更新中...）だけで、GitHub の応答が返るまでの
// 数秒間は画面が止まったままだった。取りに行っているものはタブごとに複数あるので、
// 何がもう終わっていて何が残っているかを出す。
//
// 取得は並行して走る（順に待たせるとその分だけ完了が遅れる）。なので走っている工程は
// まとめて running として出し、終わったものから緑に変える。1本ずつ順番に見せると、
// 実際にはもう終わっている工程が「待機中」に見えてしまう。
//
// 閉じても取得そのものは止まらない。結果は閉じたあとの一覧に反映される。
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { StepProgressPanel, type ProgressStep } from "@/app/components/shared/StepProgress";

/** 進捗の工程。GithubPage 側の取得処理が、終わった順にこのキーを報告する */
export type RefreshStepKey = "list" | "extra" | "deploy";
export type RefreshTab = "pulls" | "issues" | "commits" | "branches";
export type RefreshProgressState = "running" | "done" | "error";

interface StepSpec {
  key: RefreshStepKey;
  running: string;
  done: string;
  failed: string;
  hint?: string;
}

/** 本番反映の確認はどのタブでも走る（一覧とは別口で取っているため） */
const DEPLOY: StepSpec = {
  key: "deploy",
  running: "本番反映の状態を確認しています...",
  done: "本番反映の状態を確認しました",
  failed: "本番反映の状態は確認できませんでした",
};

/**
 * タブごとの工程。
 * 表示する文言は「何を取りに行っているか」まで書く。「読み込み中」だけだと、
 * 待っていてよいのか、もう一度押すべきなのかが判断できない。
 */
const STEPS: Record<RefreshTab, StepSpec[]> = {
  pulls: [
    {
      key: "list",
      running: "プルリクエストの一覧を取得しています...",
      done: "プルリクエストの一覧を取得しました",
      failed: "プルリクエストの一覧を取得できませんでした",
      hint: "CI・レビューの状況もあわせて取り直します",
    },
    {
      key: "extra",
      running: "プルリクエストがまだ無いブランチを確認しています...",
      done: "プルリクエストがまだ無いブランチを確認しました",
      failed: "プルリクエストがまだ無いブランチは確認できませんでした",
    },
    DEPLOY,
  ],
  issues: [
    {
      key: "list",
      running: "Issueの一覧を取得しています...",
      done: "Issueの一覧を取得しました",
      failed: "Issueの一覧を取得できませんでした",
    },
    DEPLOY,
  ],
  commits: [
    {
      key: "list",
      running: "コミットの履歴を取得しています...",
      done: "コミットの履歴を取得しました",
      failed: "コミットの履歴を取得できませんでした",
    },
    DEPLOY,
  ],
  branches: [
    {
      key: "list",
      running: "ブランチの一覧を取得しています...",
      done: "ブランチの一覧を取得しました",
      failed: "ブランチの一覧を取得できませんでした",
    },
    {
      key: "extra",
      running: "チケットとの紐付けを確認しています...",
      done: "チケットとの紐付けを確認しました",
      failed: "チケットとの紐付けは確認できませんでした",
    },
    DEPLOY,
  ],
};

export function RefreshProgressDialog({ tab, done, state, message, onClose }: {
  tab: RefreshTab;
  /** 完了した工程のキー */
  done: RefreshStepKey[];
  state: RefreshProgressState;
  /** 失敗したときの理由。取得側が拾ったものをそのまま出す */
  message?: string;
  onClose: () => void;
}) {
  const running = state === "running";

  const steps: ProgressStep[] = STEPS[tab].map(s => {
    // 完了扱いは「その工程が終わった」か「全体が終わった」か。
    // 全体の完了で埋めるのは、報告が届く前に取得が終わる速い経路でも
    // 半端な状態のまま消えないようにするため
    const finished = state === "done" || done.includes(s.key);
    return {
      key: s.key,
      state: finished ? "done" : state === "error" ? "failed" : "running",
      text: finished ? s.done : state === "error" ? s.failed : s.running,
      hint: finished || state === "error" ? undefined : s.hint,
    };
  });

  return (
    <DialogShell
      title={running ? "最新の情報に更新しています"
        : state === "error" ? "更新できませんでした"
          : "最新の情報に更新しました"}
      minHeight={0}
      onClose={onClose}
      footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
        <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.8 }}>
          {running ? "GitHubから最新の状態を取り直しています。"
            : state === "error"
              ? (message || "GitHubの情報を取得できませんでした。少し時間をおいて、もう一度お試しください。")
              : "画面はいま取得した内容に切り替わっています。"}
        </p>

        <StepProgressPanel
          steps={steps}
          note={running ? "取得が終わると、この画面は自動で閉じます。閉じても取得は続きます。" : undefined}
        />
      </div>
    </DialogShell>
  );
}
