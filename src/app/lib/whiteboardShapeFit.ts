// 素の図形（rectangle / ellipse / diamond）のバインドテキスト高さフィット（BRU6-011）。
//
// 症状: 図形にラベルを入れて改行を増やすと図形が縦に伸びるが、改行を削除しても元のサイズに
//   戻らない。原因は Excalidraw 本体の redrawTextBoundingBox が「テキストがはみ出す時に伸ばす
//   分岐しか持たず、縮む分岐が無い」こと。表セルは reflowTables が高さを再計算して対処済みだが、
//   素の図形には一切対応が無かった。本モジュールがそれを補う。
//   （補足・BRU10-054-2: 縮小して戻す originalContainerCache は "バインド解除" 専用ではなく、
//    テキスト編集中の textWysiwyg.updateWysiwygStyle でも使われる＝「記録した元の高さより高い
//    コンテナは文字ぴったりまで縮める」自動縮小がある。ただし記録されるのは「そのコンテナを
//    初めて編集した時の高さ」だけで、以後こちらが updateScene で高さを書いても更新されない。
//    素の図形は高さをフィット高と等値に保つため発火しないが、行高で決まる表セルは発火して
//    編集中に高さが暴れたため、表セルだけ pnpm patch で自動縮小の対象外にしてある
//    → patches/@excalidraw__excalidraw@0.18.1.patch / docs/whiteboard-table-cell-edit-height-bru10-054-2-design.md）
//
// 方針: 図形の高さを常に「テキストにフィットする高さ」に合わせる。ただしユーザーが意図した高さ
//   （wbBaseH）より下には縮めない＝「わざと大きく描いた箱に短いラベル」を潰さない。
//     目標高さ = max(wbBaseH, フィット高さ)
//   - フィット高さは Excalidraw の computeContainerDimensionForBoundText と厳密一致させる。等値に
//     なると Excalidraw 側の伸長条件 (metrics.height > maxContainerHeight) が成立しないため、縮めた
//     直後に再度伸ばされる綱引き（＝白画面ループ）が構造的に起きない。
//   - wbBaseH は「テキスト要素が無い間（＝テキストで伸びようがない＝必ずユーザー意図の高さ）」に
//     追従記録し、角リサイズを確定した時にも（文字の有無に関わらず）焼き込む。図形を描いてから
//     文字を入れる通常フローで、文字入力前の高さが自然に基準になる。
//   - さらに「文字を持たない図形の現在高さは定義上つねにユーザー意図」という不変条件を自己修復で
//     常時成立させる: 既に焼き込み済みの wbBaseH が実高さとズレていたら（remote拡大・undo/redo・
//     複製など経路を問わず）静穏フェーズで書き直す。これで「空図形を大きくした後に文字を入れると、
//     古い基準まで一気に縮む」不具合を構造的に断つ（BRU6-011 追加修正）。
//
// 幅は一切触らない（Excalidraw の折り返し幅管理／ユーザー設定幅を尊重）。高さ変更に伴い、バインド
// テキストの配置を Excalidraw と同じ式で中央へ置き直す（はみ出し自己修復に頼らず即整える）。
import { fontString, indentSideOfAlign, lineW, wrapText, getLiveEditing } from "./whiteboardText";
import { isTableCell } from "./whiteboardTable";
import { isRemoteEditing } from "./whiteboardRemoteEdit";

const PAD = 5;      // Excalidraw BOUND_TEXT_PADDING
const EPS = 0.5;    // 変化とみなす閾値
const rand = () => Math.floor(Math.random() * 0x7fffffff);

const FIT_TYPES = new Set(["rectangle", "ellipse", "diamond"]);

// フィット対象の「バインドテキストを持ち得る素の図形」か。表セル・フレーム・矢印ラベルは除外。
// 【BRU12-031】装飾用の影矩形（フレーム背景・テキストボックス背景）も除外する。文字を持つことが
// 無いうえ、フレーム/テキストの追従で高さが毎回変わるため、基準高さ(wbBaseH)を書き続けて
// 無駄な版更新＝同期のノイズになる。
function isFitShape(e: any): boolean {
  return !!e && !e.isDeleted && FIT_TYPES.has(e.type) && !isTableCell(e)
    && !e.customData?.wbFrameBg && !e.customData?.wbBgFor;
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
// インデント（whiteboardIndent）も同じ式で折り返し幅を求めるため export する。
export function maxTextWidth(container: any): number {
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
// インデントで幅が変わった右揃えラベルの置き直しにも使うため export する（whiteboardIndent）。
export function boundTextPos(container: any, t: any): { x: number; y: number } {
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

// 【BRU12-031】基準高さの台帳は customData.wbBaseH（＝Yjsで同期される値）ただ1つにする。
//
// 以前はこれに加えて「テキストが無い間に見た高さ」をモジュール変数の Map（_emptyH）へ持ち、
// そちらを wbBaseH より優先していた。この Map はクライアントごとに独立で同期されないため、
// 共同編集では致命的だった:
//   ・図形を描いている最中の中間サイズは相手の画面へ逐次流れる。相手が「文字が入る前」に
//     見た高さは、描いた本人の最終高さとは限らない（相手が中間の高さを台帳に控える）。
//   ・その図形に文字を入れた瞬間、本人は「自分の台帳の高さ」へ、相手は「相手の台帳の高さ」へ
//     それぞれ図形を戻そうとする。どちらも版を上げて書き込むので永久に押し合う
//     ＝図形のサイズが2つの値の間でチカチカ切り替わり続ける（報告された不具合）。
// 同期される値だけから高さを決めれば、全員が同じ答えを出すので構造的に押し合いが起きない。
// 文字が無い図形の高さは定義上つねにユーザー意図なので、その間 wbBaseH を実高さへ追従させておけば
// セッション台帳と同じ役割を果たす。

// 角リサイズ確定時に、選択中の素の図形の現在高さを wbBaseH へ焼き込む（表の freezeSelectedTable と同発想）。
// 文字の有無は問わない: 空図形を大きくした場合もその高さを永続基準にしないと、後で文字を入れた瞬間に
// 古い（または存在しない）基準まで縮んでしまうため（BRU6-011 追加修正・G1）。
export function freezeSelectedShapeHeights(api: any): boolean {
  const st = api.getAppState();
  const sel = st.selectedElementIds || {};
  const els = api.getSceneElements() as any[];
  const patch = new Map<string, any>();
  for (const e of els) {
    if (!sel[e.id] || !isFitShape(e)) continue;
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
//
// undoing=true（undo/redo 直後の猶予窓・BRU10-073）は、復元された実高さを「ユーザー意図の高さ」の
// 正とみなして台帳（customData.wbBaseH）を書き直す。台帳は履歴に載らない NEVER 更新なので
// undo では戻らず、そのままだと直後の targetH = max(台帳, fitH) がリサイズ後の高さへ図形を押し戻して
// 「ラベル付きの図形はサイズを変えて戻るを押しても戻らない」ように見えていた。
export function reflowBoundTextShapes(api: any, skip: boolean, undoing = false): boolean {
  if (skip || _shapeReflowing) return false;
  const els = api.getSceneElements() as any[];

  // container.id -> バインドテキスト要素
  const textByContainer = new Map<string, any>();
  for (const e of els) { if (e.type === "text" && e.containerId && !e.isDeleted) textByContainer.set(e.containerId, e); }

  const { containerId: editingId, liveText } = getLiveEditing(api);
  const patch = new Map<string, any>();

  for (const c of els) {
    if (!isFitShape(c)) continue;
    // 他メンバーが文字入力中の図形は、こちらの手元にある1つ前の確定テキストで計算すると
    // 「伸びすぎ」と誤判定して縮めてしまい、編集者と押し合う（BRU12-031・whiteboardRemoteEdit）。
    if (isRemoteEditing(c.id)) continue;
    const t = textByContainer.get(c.id);

    // テキスト要素が無い図形は「テキストで伸びようがない＝現在高さは必ずユーザー意図」。
    // その高さを wbBaseH へ追従させる（remote拡大・undo/redo・複製など経路を問わず）。
    // 【BRU12-031】以前はセッションMapへ控え、wbBaseH は既に持っている図形しか書き直さなかった。
    // 台帳が同期されないため共同編集で押し合いが起きていた（冒頭の説明を参照）。基準は必ずここで
    // 同期される値へ書き、以後は全員がその1つの値を見る。差分がある時だけ patch するので churn は
    // 起きず1tickで収束する。新規作成中は onChange 側が newElement で本関数ごと skip 済みなので、
    // 描いている最中の要素を触ることはない。
    if (!t) {
      const savedBaseEmpty = typeof c.customData?.wbBaseH === "number" ? c.customData.wbBaseH : undefined;
      if (savedBaseEmpty == null || Math.abs(savedBaseEmpty - c.height) > EPS) {
        patch.set(c.id, { ...c, customData: { ...c.customData, wbBaseH: Math.round(c.height) }, version: (c.version ?? 1) + 1, versionNonce: rand() });
      }
      continue;
    }

    // フィット高さ = 折り返し後の行数から算出（編集中はライブ生テキスト、確定後は originalText）。
    const raw = (editingId && c.id === editingId && liveText != null) ? liveText : rawTextOf(t);
    const fontSize = t.fontSize ?? 16;
    const lineHeight = t.lineHeight ?? 1.25;
    const font = fontString(fontSize, t.fontFamily ?? 2);
    const innerW = Math.max(1, maxTextWidth(c));
    // ぶら下げインデント込みで折る（reflowIndentWrap が書く text と同じ行数＝同じ高さになる・BRU9-053）
    const wrapped = wrapText(raw, font, innerW, indentSideOfAlign(t.textAlign));
    const textH = wrapped.length * fontSize * lineHeight;
    const fitH = containerHeightForText(textH, c.type);

    // 基準高さ = 焼き込み済み wbBaseH ＞ 現在高さ。【BRU12-031】同期される値だけで決める。
    // wbBaseH は「テキストが無かった間」に上の分岐が実高さへ追従させているので、
    // 「文字を入れる直前の高さ」＝ユーザー意図がそのまま入っている（全クライアントで同じ値）。
    // ※現在高さを wbBaseH より前に置くと、テキストで既に伸びた高さを下限に焼いてしまい
    // 「改行を減らしても縮まない」＝BRU6-011 の核が壊れるため、この順序は変えないこと。
    // 改修前からの既存図形（wbBaseH 無し）は現在高さを下限にして縮めない（誤縮小の回帰を避ける）。
    // このとき targetH は単調増加にしかならないので、行数の計測が環境差でズレても押し合わない。
    // undo/redo 直後（undoing）は台帳を無視し、復元された実高さを基準にする＝台帳が undo に逆らわない。
    const savedBase = typeof c.customData?.wbBaseH === "number" ? c.customData.wbBaseH : undefined;
    const base = undoing ? c.height : (savedBase ?? c.height);
    const targetH = Math.max(base, fitH);

    const needH = Math.abs(c.height - targetH) > EPS;
    // undo 中は焼き込み済みの基準が実高さとズレていたら直す
    // （持っていない図形には書かない＝自動のままの図形を勝手に手動基準へ変質させない）。
    const needBaseWrite = undoing && savedBase != null && Math.abs(savedBase - c.height) > EPS;
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
