// チケット詳細の「マージする」を押してから、マージ確認が開くまでの進捗画面。
//
// 押したPRの詳細に加えてオープンなPR全件も引き、CIが走っていれば終わるまで待つ（BRU17-007）ので、
// 数秒〜最大3分かかる。ボタンの文字（他のPRを確認中...）だけだと処理中なのか分かりにくいため、
// GitHubタブの更新と同じ大きなリング（RefreshProgressDialog の ProgressRing）を真ん中に出す。
//
// ％は経過時間から作った目安で、94%で頭打ちになる（実測値ではない）。
// 確認が終わるとこの画面は閉じ、そのままマージ確認が開く。
// 閉じる・キャンセルで準備をやめられる（返ってきた結果は呼び出し側で捨てる）。
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { ProgressRing, useCreepingPercent } from "@/app/components/github/RefreshProgressDialog";

export function MergePrepDialog({ number, waitNote, onCancel }: {
  /** 押したPRの番号 */
  number: number;
  /** CIの完了を待っている間の要約。null なら他のPRを確認している段 */
  waitNote: string | null;
  onCancel: () => void;
}) {
  const pct = useCreepingPercent(true);
  return (
    <DialogShell
      title="マージの準備をしています"
      size="sm"
      minHeight={0}
      onClose={onCancel}
      footer={<BtnSecondary onClick={onCancel}>キャンセル</BtnSecondary>}>
      <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "center", gap: 18, padding: "12px 0 4px" }}>
        <ProgressRing pct={pct} state="running" caption={waitNote ? "CI待ち" : "確認中"} />
        <p style={{ fontSize: 14, color: "#1A1714", lineHeight: 1.8, textAlign: "center" as const }}>
          {waitNote
            ? <>#{number} のCIが終わるのを待っています。<br />（{waitNote}）</>
            : <>#{number} をマージする前に、<br />他のオープンなPRを確認しています。</>}
        </p>
        <p style={{ fontSize: 12, color: "#A09790", lineHeight: 1.7, textAlign: "center" as const, marginTop: -10 }}>
          確認が終わると、マージの確認画面が開きます。
        </p>
      </div>
    </DialogShell>
  );
}
