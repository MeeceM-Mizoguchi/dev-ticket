// 選択中の要素を画像(PNG)としてクリップボードへコピーする（Cmd/Ctrl+Shift+C）。
// エクスポートメニューの「画像をクリップボードにコピー」はボード全体だが、こちらは選択範囲のみ。
import { exportToBlob } from "@excalidraw/excalidraw";
import { copyImage } from "@/lib/clipboard";

type CopyResult = "copied" | "empty" | "failed";

// 選択された要素に加え、描画に必要な「連れ子」も一緒に集める（推移的に辿る）：
//  - コンテナに束縛されたテキスト（containerId が取込済み）… これが無いと文字が消える
//  - フレームの内包要素（wbParent / frameId が取込済み）… フレーム→入れ子フレーム→その中の図形まで
//  - テキストボックスの影の背景板（BRU5-062: customData.wbBgFor が取込済みテキスト）
//  - フレーム装飾の影矩形（BRU5-063: customData.wbFrameBg が取込済みフレーム）… 枠色/背景が消えないように
// ※wbParent は「直接の親」しか指さないため、入れ子フレームの孫要素を取りこぼさないよう
//   「取込済み集合が増えなくなるまで」繰り返し拡張する（不動点）。
function collectSelected(api: any): any[] {
  const all = api.getSceneElements() as any[];
  const sel: Record<string, boolean> = api.getAppState().selectedElementIds || {};
  const selectedIds = new Set(Object.keys(sel).filter((id) => sel[id]));
  if (selectedIds.size === 0) return [];

  const included = new Set<string>(selectedIds);
  const has = (id?: string | null) => !!id && included.has(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const el of all) {
      if (el.isDeleted || included.has(el.id)) continue;
      const cd = el.customData || {};
      if (has(el.containerId) || has(el.frameId) || has(cd.wbParent) || has(cd.wbBgFor) || has(cd.wbFrameBg)) {
        included.add(el.id);
        grew = true;
      }
    }
  }
  return all.filter((el) => !el.isDeleted && included.has(el.id));
}

// 成功: "copied" / 未選択: "empty" / 失敗: "failed"
export async function copySelectionAsImage(api: any): Promise<CopyResult> {
  const elements = collectSelected(api);
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
