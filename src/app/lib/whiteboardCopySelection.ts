// 選択中の要素を画像(PNG)としてクリップボードへコピーする（Cmd/Ctrl+Shift+C）。
// エクスポートメニューの「画像をクリップボードにコピー」はボード全体だが、こちらは選択範囲のみ。
import { exportToBlob } from "@excalidraw/excalidraw";
import { copyImage } from "@/lib/clipboard";
import { collectSelectionClosure } from "@/app/lib/whiteboardFrames";

type CopyResult = "copied" | "empty" | "failed";

// 成功: "copied" / 未選択: "empty" / 失敗: "failed"
export async function copySelectionAsImage(api: any): Promise<CopyResult> {
  // 選択された要素に加え、描画に必要な「連れ子」（束縛テキスト・フレームの中身・影矩形）も一緒に書き出す
  const elements = collectSelectionClosure(api);
  if (elements.length === 0) return "empty";
  try {
    const blob = await exportToBlob({
      elements,
      // メニューのエクスポートと同じく白背景で書き出す（画面は透明背景のため上書き）。
      appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
      files: api.getFiles(),
      mimeType: "image/png",
      quality: 1,
    });
    const ok = await copyImage(blob);
    return ok ? "copied" : "failed";
  } catch {
    return "failed";
  }
}
