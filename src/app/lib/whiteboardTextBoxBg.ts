// テキストボックスの背景色・枠線を「実 Excalidraw 要素(rectangle)」で描く（BRU5-062）。
//
// 旧方式(TextBoxDecorLayer)は背景を z-index:-1 の別canvasへ、枠線を z-index:4 の別canvasへ描いていた。
// 背景canvasは Excalidraw本体canvas より必ず“後ろ”のため、本体canvasにある画像に重ねると
// 背景が画像の背面に回って隠れ、「背景が透明になって画像が透ける」バグになっていた。
// また DOM canvas はエクスポート(exportToBlob/Svg)に含まれず、書き出すと背景/枠線が消えていた。
//
// 本方式では、テキストの直下にロックした矩形(=影の背景板)を敷き、Excalidraw ネイティブの
// 重なり順（矩形 → その上に文字）で描く。これで画像の上でも背景が正しく塗られ、エクスポートにも出る。
// 書式の値は従来どおり text.customData.wbTextBox に保持（書式パネルの入出力・後方互換）。
// 影矩形は customData.wbBgFor=<textId> でテキストへ片方向リンクし、onChange 毎に
// syncTextBoxBgRects が「生成・幾何/色の追従・削除・重複の自己修復」を行う。
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { TEXT_BORDER_PAD } from "./whiteboardAutoConnect";

export interface WbTextBoxFormat { border?: boolean; borderColor?: string; bg?: string }

// 枠線・背景を持てるのは素のテキストボックスのみ（図形内ラベル=containerId ありは対象外）
export const isPlainTextBox = (e: any) => e?.type === "text" && !e?.isDeleted && !e?.containerId;

// 影の背景板（テキストの背景/枠線を描く矩形）か
export const isTextBgRect = (e: any) => e?.type === "rectangle" && typeof e?.customData?.wbBgFor === "string";

const SOFT_BLACK = "#343a40";
// 文字bboxの外側余白(scene単位)。接続の吸着位置(connectBBox)・旧枠線位置と一致させ、
// 線・矢印の端点が枠線ちょうどに貼り付く挙動を不変に保つ。
const PAD = TEXT_BORDER_PAD;
const rand = () => Math.floor(Math.random() * 0x7fffffff);

const hasFormat = (f?: WbTextBoxFormat) => !!f && (!!f.bg || !!f.border);

// テキスト要素から、対の影矩形が持つべき幾何・色を導出する。
// 影矩形の中心はテキストの中心と一致するため（x-PAD, width+2PAD より中心不変）、
// 回転(angle)を転写するだけで文字とぴったり重なる。
function targetProps(t: any) {
  const f: WbTextBoxFormat = t.customData?.wbTextBox ?? {};
  return {
    x: t.x - PAD,
    y: t.y - PAD,
    width: (t.width ?? 0) + PAD * 2,
    height: (t.height ?? 0) + PAD * 2,
    angle: t.angle || 0,
    backgroundColor: f.bg || "transparent",
    strokeColor: f.border ? (f.borderColor || SOFT_BLACK) : "transparent",
  };
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
function rectMatches(r: any, p: ReturnType<typeof targetProps>): boolean {
  return near(r.x, p.x) && near(r.y, p.y) && near(r.width, p.width) && near(r.height, p.height)
    && near(r.angle || 0, p.angle) && r.backgroundColor === p.backgroundColor && r.strokeColor === p.strokeColor
    && !r.roundness; // 角丸は付けない（書式パネルに設定項目が無く、丸角は想定外の見た目のため）。既存の丸角も補正する
}

// 新しい影矩形を1枚作る。文字の外側 PAD だけ広い、同じ中心・同じ回転の矩形。
function makeRect(t: any): any {
  const p = targetProps(t);
  const els = convertToExcalidrawElements([
    {
      type: "rectangle",
      id: `wb_txbg_${t.id}_${rand().toString(36)}`,
      x: p.x, y: p.y, width: p.width, height: p.height,
      backgroundColor: p.backgroundColor, fillStyle: "solid",
      strokeColor: p.strokeColor, strokeWidth: 2, roughness: 0,
    } as any,
  ], { regenerateIds: false }) as any[];
  const rect = els[0];
  rect.angle = p.angle;
  rect.locked = true;                    // 単独選択/移動不可の“影”。ユーザーはテキストを操作する。
  rect.roundness = null;                 // 角丸なし（シャープ）。書式に設定項目が無いため丸めない。
  rect.customData = { ...(rect.customData ?? {}), wbBgFor: t.id };
  // フレーム所属(wbParent)はテキストへ常にミラーする。orderFramesBehindChildren が
  // フレームの子を wbParent 単位でまとめ直すため、所属を合わせないと影矩形と文字の
  // z-order が別クライアントで分離してしまう（フレーム内テキストで背景が画像に隠れ得る）。
  if (t.customData?.wbParent) rect.customData.wbParent = t.customData.wbParent;
  return rect;
}

/**
 * テキストボックスの背景/枠線を実 rectangle 要素で描くための同期。onChange から毎tick呼ぶ。
 *  - 生成: 書式(bg/border)ありでまだ影矩形が無いテキストの直前へ矩形を挿入（＝文字の背面z-order）
 *  - 追従: 位置/サイズ/回転/色をテキストから同期
 *  - 削除: 書式が消えた/テキストが消えた影矩形を削除
 *  - 自己修復: 対象テキストが無い/書式が消えた/重複した影矩形は所有権(先勝ち)で正規化して削除。
 *            コピペ・複製・複数人同時編集で生じた重複を収束させる。
 *  - z-order修復: 影矩形が文字より前面に来ていたら背面へ入れ直す。
 * remote反映中・新規描画中は何もしない（次tickで収束）。最新シーンを内部で取り直すため、
 * 同tickで他ヘルパーが updateScene 済みでも安全に上書きなく適用できる。
 * @returns updateScene で反映したら true（onChangeの二重適用回避に使う）
 */
export function syncTextBoxBgRects(api: any, appState: any, remote: boolean): boolean {
  if (remote || appState?.newElement) return false;
  const elements = api.getSceneElements();

  const textById = new Map<string, any>();
  for (const e of elements) if (isPlainTextBox(e)) textById.set(e.id, e);

  // 影矩形を「有効(=書式付きテキストに1対1で対応)」と「孤児(削除対象)」に仕分け（先勝ち）。
  const validByText = new Map<string, string>(); // textId -> rectId
  const orphan = new Set<string>();
  for (const e of elements) {
    if (!isTextBgRect(e) || e.isDeleted) continue;
    const forId = e.customData.wbBgFor as string;
    const t = textById.get(forId);
    if (t && hasFormat(t.customData?.wbTextBox) && !validByText.has(forId)) validByText.set(forId, e.id);
    else orphan.add(e.id);
  }

  // 書式ありで影矩形が無いテキスト → 生成対象
  const needCreate: any[] = [];
  for (const t of textById.values()) {
    if (hasFormat(t.customData?.wbTextBox) && !validByText.has(t.id)) needCreate.push(t);
  }

  // まず配列順を変えずに「孤児の削除」「色/幾何の追従」を適用する。
  let dirty = false;
  let next: any[] = elements.map((e: any) => {
    if (isTextBgRect(e) && !e.isDeleted && orphan.has(e.id)) {
      dirty = true;
      return { ...e, isDeleted: true, version: (e.version ?? 1) + 1, versionNonce: rand() };
    }
    if (isTextBgRect(e) && validByText.get(e.customData.wbBgFor) === e.id) {
      const t = textById.get(e.customData.wbBgFor);
      const p = targetProps(t);
      // 所属(wbParent)はテキストへ常にミラー（フレーム内でのz-order分離を防ぐ・上記 makeRect 参照）
      const wbParent = t.customData?.wbParent;
      const parentDiff = (e.customData?.wbParent ?? undefined) !== (wbParent ?? undefined);
      if (!rectMatches(e, p) || parentDiff) {
        dirty = true;
        return {
          ...e, ...p, locked: true, roundness: null,
          customData: { ...e.customData, wbParent },
          version: (e.version ?? 1) + 1, versionNonce: rand(),
        };
      }
    }
    return e;
  });

  if (needCreate.length) {
    // 生成: 各テキストの直前へ影矩形を挿入（配列で前＝index小＝背面）。
    const created = new Map<string, any>();
    for (const t of needCreate) created.set(t.id, makeRect(t));
    const rebuilt: any[] = [];
    for (const e of next) {
      const r = isPlainTextBox(e) ? created.get(e.id) : undefined;
      if (r) rebuilt.push(r);
      rebuilt.push(e);
    }
    next = rebuilt;
    dirty = true;
  } else {
    // z-order自己修復: 影矩形が対のテキストより後ろ(配列で後方＝前面)に来ていたら背面へ入れ直す。
    const pos = new Map<string, number>();
    next.forEach((e, i) => pos.set(e.id, i));
    const disorder = next.some((e) =>
      isTextBgRect(e) && !e.isDeleted && validByText.get(e.customData.wbBgFor) === e.id
      && (pos.get(e.customData.wbBgFor) ?? Infinity) < (pos.get(e.id) ?? 0));
    if (disorder) {
      const rectFor = new Map<string, any>(); // textId -> rect
      for (const e of next) {
        if (isTextBgRect(e) && !e.isDeleted && validByText.get(e.customData.wbBgFor) === e.id) rectFor.set(e.customData.wbBgFor, e);
      }
      const placed = new Set<string>();
      const rebuilt: any[] = [];
      for (const e of next) {
        if (isTextBgRect(e) && rectFor.get(e.customData.wbBgFor)?.id === e.id) continue; // 元位置から抜く
        if (isPlainTextBox(e)) {
          const r = rectFor.get(e.id);
          if (r && !placed.has(r.id)) { rebuilt.push(r); placed.add(r.id); }
        }
        rebuilt.push(e);
      }
      next = rebuilt;
      dirty = true;
    }
  }

  if (!dirty) return false;
  api.updateScene({ elements: next });
  return true;
}
