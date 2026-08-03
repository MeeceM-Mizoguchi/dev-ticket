// 図形の「線」「背景」を自由な色に塗る（BRU10-045）。
//
// 標準UIの色変更は Excalidraw 内部の changeStrokeColor / changeBackgroundColor が担うが、
// 自前で差し込む“好きな色”スウォッチ（ShapeColorPalette）からはそこを呼べないので、
// 同じ結果になる更新をここで組み立てる。標準と揃えている点:
//   ・選択中の要素の strokeColor / backgroundColor を塗り替える
//   ・あわせて既定色（currentItemStrokeColor / currentItemBackgroundColor）も更新する
//     ＝これから描く図形にも同じ色が乗る
//
// 標準とわざと変えている点: **バウンドテキスト（図形内ラベル）は塗らない**。
// 標準の changeStrokeColor は includeBoundText でラベルまで巻き込み、それを
// pinBoundTextColor が毎tick元へ戻している（BRU7-056-2）。自前経路では最初から
// 触らないほうが素直で、色が一瞬ちらつくこともない。文字色の入口は「文字色」セクションだけ。
import { COMMIT } from "./whiteboardHistory";
import { isFrameDecorRect } from "./whiteboardFrameBg";
import { isTextBgRect } from "./whiteboardTextBoxBg";
import { isBoundText } from "./whiteboardTextColor";

const rand = () => Math.floor(Math.random() * 0x7fffffff);

/** 標準パネルのカラーピッカー2種。並び順（線 → 背景）と対応する。 */
export type ColorKind = "stroke" | "background";

const FIELD: Record<ColorKind, "strokeColor" | "backgroundColor"> = {
  stroke: "strokeColor",
  background: "backgroundColor",
};
const CURRENT_ITEM: Record<ColorKind, string> = {
  stroke: "currentItemStrokeColor",
  background: "currentItemBackgroundColor",
};

/**
 * 塗ってよい要素か。装飾用の実 rectangle（テキストボックスの影矩形／フレームの枠・背景）は
 * syncTextBoxBgRects / syncFrameDecorRects が書式から再生成するので触らない。
 * 図形内ラベルは上のコメントのとおり対象外。
 */
const isTarget = (e: any) =>
  !e?.isDeleted && !e?.locked && !isFrameDecorRect(e) && !isTextBgRect(e) && !isBoundText(e);

/**
 * 選択中の図形の線色／背景色を変更し、既定色も同じ色に合わせる。
 * 何も選択していない時（ツールだけ選んでいる時）は既定色だけを更新する。
 */
export function setShapeColor(api: any, kind: ColorKind, color: string): void {
  const sel = api.getAppState().selectedElementIds || {};
  const field = FIELD[kind];
  const appState = { [CURRENT_ITEM[kind]]: color };

  let changed = false;
  const els = (api.getSceneElements() as any[]).map((e) => {
    if (!sel[e.id] || !isTarget(e) || e[field] === color) return e;
    changed = true;
    return { ...e, [field]: color, version: (e.version ?? 1) + 1, versionNonce: rand() };
  });

  // 色の変更は 1 undo ステップとして記録する（BRU7-058）。
  // 既定色だけの更新は履歴に残す意味が無いので captureUpdate を渡さない（guardApi が NEVER にする）。
  if (changed) api.updateScene({ elements: els, appState, ...COMMIT });
  else api.updateScene({ appState });
}
