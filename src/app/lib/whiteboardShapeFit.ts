// 素の図形（rectangle / ellipse / diamond）のバインドテキスト高さフィット（BRU6-011）。
//
// 症状: 図形にラベルを入れて改行を増やすと図形が縦に伸びるが、改行を削除しても元のサイズに
//   戻らない。原因は Excalidraw 本体の redrawTextBoundingBox が「テキストがはみ出す時に伸ばす
//   分岐しか持たず、縮む分岐が無い」こと（縮小して戻す originalContainerCache は "バインド解除"
//   操作でしか使われない）。表セルは reflowTables が高さを再計算して対処済みだが、素の図形には
//   一切対応が無かった。本モジュールがそれを補う。
//
// 方針: 図形の高さを常に「テキストにフィットする高さ」に合わせる。ただしユーザーが意図した高さ
//   （wbBaseH）より下には縮めない＝「わざと大きく描いた箱に短いラベル」を潰さない。
//     目標高さ = max(wbBaseH, フィット高さ)
//   - フィット高さは Excalidraw の computeContainerDimensionForBoundText と厳密一致させる。等値に
//     なると Excalidraw 側の伸長条件 (metrics.height > maxContainerHeight) が成立しないため、縮めた
//     直後に再度伸ばされる綱引き（＝白画面ループ）が構造的に起きない。
//   - wbBaseH は「テキスト要素が無い間（＝テキストで伸びようがない＝必ずユーザー意図の高さ）」に
//     追従記録し、文字入りの図形を角リサイズで確定した時にも焼き込む。図形を描いてから文字を入れる
//     通常フローで、文字入力前の高さが自然に基準になる。
//
// 幅は一切触らない（Excalidraw の折り返し幅管理／ユーザー設定幅を尊重）。高さ変更に伴い、バインド
// テキストの配置を Excalidraw と同じ式で中央へ置き直す（はみ出し自己修復に頼らず即整える）。
import { fontString, lineW, wrapText, getLiveEditing } from "./whiteboardText";
import { isTableCell } from "./whiteboardTable";

const PAD = 5;      // Excalidraw BOUND_TEXT_PADDING
const EPS = 0.5;    // 変化とみなす閾値
const rand = () => Math.floor(Math.random() * 0x7fffffff);

const FIT_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

// フィット対象の「バインドテキストを持ち得る素の図形」か。表セル・フレーム・矢印ラベルは除外。
function isFitShape(e: any): boolean {
  return !!e && !e.isDeleted && FIT_TYPES.has(e.type) && !isTableCell(e);
}

// Excalidraw computeContainerDimensionForBoundText と厳密一致（型別のコンテナ高さ）。
function containerHeightForText(textHeight: number, type: string): number {
  const dim = Math.ceil(textHeight);
  const pad = PAD * 2;
  if (type === "ellipse") return Math.round((dim + pad) / Math.sqrt(2) * 2);
  if (type === "diamond") return 2 * (dim + pad);
  return dim + pad; // rectangle
}

// Excalidraw getBoundTextMaxWidth と一致（折り返しに使う内側最大幅）。
function maxTextWidth(container: any): number {
  const w = container.width;
  if (container.type === "ellipse") return Math.round(w / 2 * Math.sqrt(2)) - PAD * 2;
  if (container.type === "diamond") return Math.round(w / 2) - PAD * 2;
  return w - PAD * 2;
}

// Excalidraw getBoundTextMaxHeight と一致（テキスト配置の基準に使う）。
function maxTextHeight(container: any): number {
  const h = container.height;
  if (container.type === "ellipse") return Math.round(h / 2 * Math.sqrt(2)) - PAD * 2;
  if (container.type === "diamond") return Math.round(h / 2) - PAD * 2;
  return h - PAD * 2;
}

// Excalidraw getContainerCoords と一致（テキスト原点の型別オフセット）。
function containerCoords(container: any): { x: number; y: number } {
  let ox = PAD, oy = PAD;
  if (container.type === "ellipse") {
    ox += container.width / 2 * (1 - Math.sqrt(2) / 2);
    oy += container.height / 2 * (1 - Math.sqrt(2) / 2);
  } else if (container.type === "diamond") {
    ox += container.width / 4;
    oy += container.height / 4;
  }
  return { x: container.x + ox, y: container.y + oy };
}

// Excalidraw computeBoundTextPosition と一致（align/valign を尊重してテキスト x/y を算出）。
function boundTextPos(container: any, t: any): { x: number; y: number } {
  const cc = containerCoords(container);
  const maxH = maxTextHeight(container);
  const maxW = maxTextWidth(container);
  const th = t.height ?? 0, tw = t.width ?? 0;
  const y = t.verticalAlign === "top" ? cc.y
    : t.verticalAlign === "bottom" ? cc.y + (maxH - th)
    : cc.y + (maxH / 2 - th / 2);
  const x = t.textAlign === "left" ? cc.x
    : t.textAlign === "right" ? cc.x + (maxW - tw)
    : cc.x + (maxW / 2 - tw / 2);
  return { x, y };
}

const rawTextOf = (t: any): string =>
  typeof t?.originalText === "string" ? t.originalText : (t?.text ?? "");

let _shapeReflowing = false; // 再入ガード（updateScene が同期的に onChange→本関数を呼び戻しても即 return）
// セッション内: テキストが無い間に見た図形の高さ（＝テキストで伸びる前のユーザー意図の高さ）。
// 空図形へ updateScene すると新規作成中の要素を壊すため、基準はここへローカル保持し、
// 図形がテキストを持った瞬間に一度だけ customData.wbBaseH へ焼き込んで永続化する。
const _emptyH = new Map<string, number>();

// 角リサイズ確定時に、選択中の素の図形（バインドテキスト付き）の現在高さを wbBaseH へ焼き込む。
// これで「文字入りの箱を手で大きくしたら、その高さが新しい下限になる」（表の freezeSelectedTable と同発想）。
export function freezeSelectedShapeHeights(api: any): boolean {
  const st = api.getAppState();
  const sel = st.selectedElementIds || {};
  const els = api.getSceneElements() as any[];
  const hasBoundText = (c: any) => els.some((e) => e.type === "text" && e.containerId === c.id && !e.isDeleted);
  const patch = new Map<string, any>();
  for (const e of els) {
    if (!sel[e.id] || !isFitShape(e) || !hasBoundText(e)) continue;
    const baseH = e.customData?.wbBaseH;
    if (typeof baseH === "number" && Math.abs(baseH - e.height) < EPS) continue;
    patch.set(e.id, { ...e, customData: { ...e.customData, wbBaseH: Math.round(e.height) }, version: (e.version ?? 1) + 1, versionNonce: rand() });
  }
  if (!patch.size) return false;
  const next = els.map((e) => patch.get(e.id) ?? e);
  api.updateScene({ elements: next });
  return true;
}

// 素の図形の高さをテキストにフィットさせる。1つでも変えたら true。
// skip=true（リモート反映中・移動/リサイズ中・elbow 修復直後）のときは何もしない。
// 編集中の図形は「高さのみ」調整する（テキスト配置は Excalidraw のエディタが管理するため触らない）。
export function reflowBoundTextShapes(api: any, skip: boolean): boolean {
  if (skip || _shapeReflowing) return false;
  const els = api.getSceneElements() as any[];

  // container.id -> バインドテキスト要素
  const textByContainer = new Map<string, any>();
  for (const e of els) { if (e.type === "text" && e.containerId && !e.isDeleted) textByContainer.set(e.containerId, e); }

  const { containerId: editingId, liveText } = getLiveEditing(api);
  const patch = new Map<string, any>();

  for (const c of els) {
    if (!isFitShape(c)) continue;
    const t = textByContainer.get(c.id);

    // テキスト要素が無い図形は「テキストで伸びようがない＝現在高さは必ずユーザー意図」。
    // updateScene せず（＝新規作成中の要素を壊さない）、その高さをセッションMapへ控えるだけ。
    if (!t) {
      _emptyH.set(c.id, c.height);
      continue;
    }

    // フィット高さ = 折り返し後の行数から算出（編集中はライブ生テキスト、確定後は originalText）。
    const raw = (editingId && c.id === editingId && liveText != null) ? liveText : rawTextOf(t);
    const fontSize = t.fontSize ?? 16;
    const lineHeight = t.lineHeight ?? 1.25;
    const font = fontString(fontSize, t.fontFamily ?? 2);
    const innerW = Math.max(1, maxTextWidth(c));
    const wrapped = wrapText(raw, font, innerW);
    const textH = wrapped.length * fontSize * lineHeight;
    const fitH = containerHeightForText(textH, c.type);

    // 基準高さ = 焼き込み済み wbBaseH ＞ セッション記録（テキスト前の高さ）＞ 現在高さ。
    // 改修前からの既存図形（どちらも無い）は現在高さを下限にして縮めない（誤縮小の回帰を避ける）。
    const savedBase = typeof c.customData?.wbBaseH === "number" ? c.customData.wbBaseH : undefined;
    const base = savedBase ?? _emptyH.get(c.id) ?? c.height;
    const targetH = Math.max(base, fitH);

    const needH = Math.abs(c.height - targetH) > EPS;
    const needBaseWrite = savedBase == null && _emptyH.has(c.id); // テキスト獲得時に一度だけ基準を永続化
    if (!needH && !needBaseWrite) continue;

    const nc = {
      ...c, height: targetH,
      customData: needBaseWrite ? { ...c.customData, wbBaseH: Math.round(base) } : c.customData,
      version: (c.version ?? 1) + 1, versionNonce: rand(),
    };
    patch.set(c.id, nc);

    // 高さが変わったらバインドテキストを中央へ置き直す（編集中の図形は Excalidraw 管理なので触らない）。
    if (c.id !== editingId) {
      const pos = boundTextPos(nc, t);
      if (Math.abs((t.x ?? 0) - pos.x) > EPS || Math.abs((t.y ?? 0) - pos.y) > EPS) {
        patch.set(t.id, { ...t, x: pos.x, y: pos.y, version: (t.version ?? 1) + 1, versionNonce: rand() });
      }
    }
  }

  if (!patch.size) return false;
  const next = els.map((e) => patch.get(e.id) ?? e);
  _shapeReflowing = true;
  try { api.updateScene({ elements: next }); } finally { _shapeReflowing = false; }
  return true;
}
