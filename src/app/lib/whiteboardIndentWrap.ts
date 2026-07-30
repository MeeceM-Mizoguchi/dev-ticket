// インデントを折り返し行にも効かせる（BRU9-053）。
//
// 症状: 図形ラベル／テキストボックスの行頭にインデント（whiteboardIndent）を入れても、改行せず
//   枠の端で折り返した「続きの行」はインデントを無視して端から始まってしまう。
//
// 原因: 折り返し後の表示用テキスト（element.text）を作っているのは Excalidraw 本体
//   （wrapText → redrawTextBoundingBox）で、本体はインデントを「ただの空白文字」として扱うため、
//   折り返した続きの行に空白を足さない（そもそもインデントという概念を持たない）。
//
// 方針: 表セル（reflowTables）と同じく **折り返し済みの text をこちらで組み立てて書く**。
//   ・対象は「インデントが入っている段落を持つテキスト」だけ。それ以外は Excalidraw 本体の
//     折り返しをそのまま尊重し、余計な差分を作らない（＝既存の見た目を動かさない）。
//   ・originalText（ユーザーが打った生の文字）は一切触らない。表示用の text だけを組み直す。
//   ・行数が増えた分の図形の高さは reflowBoundTextShapes が同じ wrapText で追従するので、
//     「伸ばしては縮める」取り合いにならない（BRU6-011 と同じ計測式を共有している）。
//   ・Excalidraw が text を作り直すのは編集確定・リサイズ・書式変更の時だけ。毎tick同じ結果へ
//     収束するので churn は起きない（BRU5-063 / BRU7-043 の轍を踏まない）。
//   ・編集中（textarea が開いている間）は触らない。エディタの表示は本体が持っており、
//     確定した瞬間にこのパスが整える。
import { indentPadOf, indentSideOfAlign, type IndentSide } from "./whiteboardText";
import { measureWrapped } from "./whiteboardIndent";
import { boundTextPos } from "./whiteboardShapeFit";
import { isTableCell } from "./whiteboardTable";

const FIT_TYPES = new Set(["rectangle", "ellipse", "diamond"]); // ラベルが折り返る素の図形（矢印ラベルは対象外）
const EPS = 0.5;
const rand = () => Math.floor(Math.random() * 0x7fffffff);

let _wrapping = false; // 再入ガード（updateScene が同期的に onChange→本関数を呼び戻しても即 return）

// 計測（canvas measureText）を毎tick繰り返さないための署名キャッシュ。
// 署名に現在の text も含めるので「Excalidraw が text を作り直した」時は必ず再計算に入り、
// こちらの text で落ち着いた後は素通りする（＝変化が無い間は1文字も測らない）。
const _sig = new Map<string, string>();
const sigOf = (t: any, c: any | undefined): string => [
  t.originalText ?? t.text, t.text, t.fontSize, t.fontFamily, t.lineHeight, t.textAlign, t.verticalAlign,
  t.autoResize === false ? t.width : "",
  c ? `${c.type}:${c.x}:${c.y}:${c.width}:${c.height}` : "",
].join("\u0001"); // 区切りは本文に現れない制御文字

const rawTextOf = (t: any): string =>
  typeof t?.originalText === "string" ? t.originalText : (t?.text ?? "");

// 中身のある行にインデントが入っているか（＝ぶら下げインデントの対象か）。
function hasIndentedLine(raw: string, side: IndentSide): boolean {
  for (const para of raw.split("\n")) {
    if (para.trim() !== "" && indentPadOf(para, side) > 0) return true;
  }
  return false;
}

/**
 * インデントの入ったテキストの折り返し（text/width/height と、ラベルなら配置）を組み直す。
 * skip=true（リモート反映中・移動/リサイズ中など）のときは何もしない。1つでも変えたら true。
 */
export function reflowIndentWrap(api: any, skip: boolean): boolean {
  if (skip || _wrapping) return false;
  if (document.querySelector(".excalidraw-wysiwyg")) return false; // 編集中は Excalidraw が text を持つ

  const els = api.getSceneElements() as any[];
  const byId = new Map<string, any>(els.map((e) => [e.id, e]));
  const patch = new Map<string, any>();

  for (const t of els) {
    if (t.type !== "text" || t.isDeleted) continue;
    const side = indentSideOfAlign(t.textAlign);
    if (!side) continue; // 中央揃え＝インデント非対応
    const container = t.containerId ? byId.get(t.containerId) : undefined;
    if (t.containerId && (!container || container.isDeleted)) continue;
    // 表セルは reflowTables が text/寸法/位置を毎tick作り直すので二重制御にしない。
    // 矢印ラベルは本体の折り返し幅の求め方が図形と違うため対象外にする。
    if (container && (!FIT_TYPES.has(container.type) || isTableCell(container))) continue;
    // 折り返しが起きない素のテキストボックス（autoResize）は、そもそも端で折れないので対象外。
    if (!container && t.autoResize !== false) continue;

    const raw = rawTextOf(t);
    if (!hasIndentedLine(raw, side)) continue;

    const sig = sigOf(t, container);
    if (_sig.get(t.id) === sig) continue; // 前回「既に正しい」と確認した状態のまま＝計測不要

    const m = measureWrapped(t, raw, container);
    const nt: any = { ...t, ...m };
    let x = t.x ?? 0, y = t.y ?? 0;
    if (container) { const p = boundTextPos(container, nt); x = p.x; y = p.y; } // 幅が変わると右揃えラベルの x が動く

    if (t.text === m.text
      && Math.abs((t.width ?? 0) - m.width) < EPS && Math.abs((t.height ?? 0) - m.height) < EPS
      && Math.abs((t.x ?? 0) - x) < EPS && Math.abs((t.y ?? 0) - y) < EPS) {
      // 落ち着いた状態だけを記録する。書き換えた tick は記録しない（同tickの他ヘルパーの
      // updateScene に集約で負けても、次tickで必ず作り直せるようにする＝取りこぼさない）。
      if (_sig.size > 2000) _sig.clear(); // 長時間セッションでの積み上がりを防ぐ（作り直しても1tick）
      _sig.set(t.id, sig);
      continue;
    }

    patch.set(t.id, { ...nt, x, y, version: (t.version ?? 1) + 1, versionNonce: rand() });
  }

  if (!patch.size) return false;
  const next = els.map((e) => patch.get(e.id) ?? e);
  _wrapping = true;
  try { api.updateScene({ elements: next }); } finally { _wrapping = false; }
  return true;
}
