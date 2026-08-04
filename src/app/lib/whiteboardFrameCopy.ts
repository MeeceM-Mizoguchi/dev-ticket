// フレームをコピー/切り取りすると中身が付いてこない不具合の対策（BRU10-063）。
//
// このボードのフレーム所属は Excalidraw ネイティブの frameId ではなく customData.wbParent で
// 表している（理由は whiteboardFrames.ts の冒頭コメント参照）。一方 Excalidraw のコピーは
// getFrameChildren（＝frameId 一致）でしか中身を集めないため、フレームを選んでコピーすると
// 「空のフレームだけ」がクリップボードに載り、貼り付けても枠しか出てこなかった。
//
// そこで copy/cut を横取りし、wbParent の子孫まで含めた Excalidraw 形式のクリップボード JSON を
// 自前で書き込む。**貼り付けは Excalidraw 標準に任せる**（id の再採番と containerId/groupIds/
// boundElements の貼り替えは標準が行い、customData 側の参照は貼り付け後に
// remapDuplicatedCustomRefs（同一ボード）／captureFrameChildren（幾何から所属を再判定）が直す）。
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { copyText } from "@/lib/clipboard";
import { collectSelectionClosure } from "@/app/lib/whiteboardFrames";

// Excalidraw が貼り付け時に認識するクリップボード形式（EXPORT_DATA_TYPES.excalidrawClipboard）。
const CLIPBOARD_TYPE = "excalidraw/clipboard";
const MIME_TEXT = "text/plain";

const rand = () => Math.floor(Math.random() * 0x7fffffff);
const isFrame = (e: any) => e?.type === "frame" || e?.type === "magicframe";

function selectedIds(api: any): Set<string> {
  const sel: Record<string, boolean> = api.getAppState().selectedElementIds || {};
  return new Set(Object.keys(sel).filter((id) => sel[id]));
}

/**
 * 「フレームを選んでいる」＝標準のコピーでは中身が漏れる状況か。
 * フレームを含まない選択は標準の挙動（束縛テキストまで面倒を見てくれる）に任せ、横取りしない。
 */
export function isFrameSelected(api: any): boolean {
  const ids = selectedIds(api);
  if (ids.size === 0) return false;
  return (api.getSceneElements() as any[]).some((e) => isFrame(e) && !e.isDeleted && ids.has(e.id));
}

/**
 * 選択をフレームの中身まで広げる。**複製の直前**に呼ぶ。
 *
 * Alt(Option)+ドラッグ複製と Ctrl/Cmd+D は Excalidraw 内部の処理なので、コピーのように
 * 横取りして差し替えることができない。どちらも複製対象を
 * 「選択中の要素 ＋ その frameId の子」から決めるため、先に中身を選択へ入れてしまえば
 * 標準の複製処理（id の再採番・グループ/接続の貼り替え）にそのまま乗せられる。
 *  - バウンドテキスト(containerId 持ち)は標準側が必ず連れて行くので入れない
 *  - ロック要素（枠線/背景の影矩形）は選択できない。複製先には syncFrameDecorRects が作り直す
 * @returns 選択を広げたら true（広げる必要が無ければ false ＝ 標準の動作に任せてよい）
 */
export function expandSelectionToFrameChildren(api: any): boolean {
  if (!isFrameSelected(api)) return false;
  const cur = selectedIds(api);
  const add = collectSelectionClosure(api)
    .filter((e) => !e.locked && !e.containerId && !cur.has(e.id))
    .map((e) => e.id as string);
  if (add.length === 0) return false;
  const next: Record<string, boolean> = {};
  for (const id of cur) next[id] = true;
  for (const id of add) next[id] = true;
  api.updateScene({ appState: { selectedElementIds: next } });
  return true;
}

/**
 * 選択（＋フレームの中身などの連れ子）を Excalidraw のクリップボード JSON にする。
 * 対象が無ければ null。
 */
export function buildFrameAwareClipboardJson(api: any): string | null {
  const elements = collectSelectionClosure(api);
  if (elements.length === 0) return null;

  // 画像は fileId で実体を参照するので、使っている分だけ添える（別ボードへ貼っても絵が出るように）。
  const files = (api.getFiles?.() ?? {}) as Record<string, any>;
  const used: Record<string, any> = {};
  for (const el of elements) {
    const fid = el?.fileId;
    if (typeof fid === "string" && files[fid]) used[fid] = files[fid];
  }
  return JSON.stringify({ type: CLIPBOARD_TYPE, elements, files: used });
}

/**
 * 切り取りの実体。コピー済みの一群（フレーム＋中身）をまとめて削除する。
 * 標準の cut は選択中の要素しか消さないため、フレームだけ消えて中身が取り残される。
 * @returns 削除したら true
 */
export function cutFrameSelection(api: any): boolean {
  const elements = collectSelectionClosure(api);
  if (elements.length === 0) return false;
  const kill = new Set<string>(elements.map((e) => e.id));
  const next = (api.getSceneElements() as any[]).map((e) =>
    kill.has(e.id) && !e.isDeleted
      ? { ...e, isDeleted: true, version: (e.version ?? 1) + 1, versionNonce: rand() }
      : e,
  );
  api.updateScene({
    elements: next,
    appState: { selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY, // 1回の undo で戻せるようにする
  });
  return true;
}

/**
 * copy / cut イベントを横取りしてクリップボードへ書き込む。
 * イベントの clipboardData（同期・確実）を優先し、無ければ非同期APIへフォールバックする。
 * @returns 横取りしたら true（呼び出し側で preventDefault / stopImmediatePropagation する）
 */
export function writeFrameAwareClipboard(api: any, e: ClipboardEvent): boolean {
  const json = buildFrameAwareClipboardJson(api);
  if (!json) return false;
  try {
    e.clipboardData?.setData(MIME_TEXT, json);
    if (e.clipboardData?.getData(MIME_TEXT) === json) return true;
  } catch {
    /* 非同期APIへフォールバック */
  }
  void copyText(json);
  return true;
}

/**
 * 右クリックメニュー（ClipboardEvent を通らない経路）用。非同期APIへ書き込みを投げる。
 * @returns 書き込みを開始したら true（＝横取り成立。false なら標準の動作に任せる）
 */
export function writeFrameAwareClipboardViaApi(api: any): boolean {
  const json = buildFrameAwareClipboardJson(api);
  if (!json) return false;
  void copyText(json);
  return true;
}
