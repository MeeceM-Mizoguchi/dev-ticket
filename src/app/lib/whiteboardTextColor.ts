// 図形内ラベル（バウンドテキスト）の文字色を、図形の「線」の色から独立させる（BRU7-056-2）。
//
// 症状: 四角などの図形を選んで左メニューの「線」で色を変えると、枠線だけでなく中の文字まで
// 同じ色に変わってしまう。Excalidraw の changeStrokeColor は「コンテナとバインドテキストを
// まとめて塗る」仕様(includeBoundText)なので、標準UIのままでは枠線色と文字色を別々にできない。
//
// そこで文字色の“正”を customData.wbTextColor に持たせ、「線」の操作で塗り替えられたら
// 記録した色へ戻す（pinBoundTextColor）。wbTextColor は2箇所に置く:
//   ・テキスト要素     … その文字自身の色。strokeColor と常に一致させる。
//   ・図形(コンテナ)   … 「この図形のラベルの色」。まだ文字を入れていない図形でも先に
//                        文字色を決められるようにするため（BRU7-056-2 追補）。あとから
//                        ラベルを入れると pinBoundTextColor がこの色を引き継がせる。
// 文字色の変更は書式パネル（TextColorPanel / TextBoxFormatPanel）から setTextColor で行い、
// 図形とラベルの両方へ同時に書く。

import { COMMIT } from "./whiteboardHistory";

const SOFT_BLACK = "#343a40";
const rand = () => Math.floor(Math.random() * 0x7fffffff);

/** 文字色パレット（枠線色パレット＋白。白は濃い背景の図形で使う） */
export const TEXT_COLORS = [SOFT_BLACK, "#e5484d", "#1971c2", "#2f9e44", "#f08c00", "#ae3ec9", "#ffffff"];

/** バインドテキスト（図形・表セルの中のラベル）か */
export const isBoundText = (e: any) => e?.type === "text" && !e?.isDeleted && !!e?.containerId;

/**
 * ラベル（バウンドテキスト）を入れられる要素か。Excalidraw がテキストコンテナとして扱う型に合わせる。
 * まだ文字が入っていなくても文字色を決められるよう、書式パネルの表示条件にも使う。
 */
export const canHaveLabel = (e: any) =>
  !e?.isDeleted && (e?.type === "rectangle" || e?.type === "diamond" || e?.type === "ellipse" || e?.type === "arrow");

/** 要素に付いているバウンドテキストを返す（無ければ undefined）。 */
export function boundTextOf(el: any, byId: Map<string, any>): any | undefined {
  for (const b of el?.boundElements ?? []) {
    if (b?.type !== "text") continue;
    const t = byId.get(b.id);
    if (t && !t.isDeleted && t.type === "text") return t;
  }
  return undefined;
}

/**
 * 書式パネルに表示する文字色。記録済み(wbTextColor)ならそれを優先する。
 * 「線」で塗り替えられてから pinBoundTextColor が戻すまでの1tick、パネルが
 * 誤った色を光らせてチカチカするのを防ぐため。
 */
export const readTextColor = (t: any): string => t?.customData?.wbTextColor ?? t?.strokeColor ?? SOFT_BLACK;

/**
 * 図形（コンテナ）のラベル色 ＝「いま文字を入れたら何色になるか」。
 * 記録が無ければ現在のラベルの色、ラベルも無ければ枠線の色を返す。
 * ラベル未作成の図形で枠線色を初期値にするのは、Excalidraw が新しいラベルを
 * currentItemStrokeColor で作るため。ここを既定の黒にすると、枠線を色替えして描いた図形に
 * 文字を入れた瞬間に色が飛ぶ。初期値を実際の作られ方に合わせて“見た目を変えない”ようにする。
 * （記録した後は枠線の色を変えても文字色は追従しない＝本チケットの修正点）
 */
export function readLabelColor(el: any, byId: Map<string, any>): string {
  const own = el?.customData?.wbTextColor;
  if (typeof own === "string") return own;
  const t = boundTextOf(el, byId);
  return t ? readTextColor(t) : (el?.strokeColor ?? SOFT_BLACK);
}

// 文字要素: strokeColor と wbTextColor を同時に更新（この2つは常に一致させる）
function withColor(t: any, color: string): any {
  return {
    ...t,
    strokeColor: color,
    customData: { ...(t.customData ?? {}), wbTextColor: color },
    version: (t.version ?? 1) + 1,
    versionNonce: rand(),
  };
}

// 図形: 「ラベルの色」を覚えるだけ（枠線色 strokeColor には触らない）
function withLabelColor(el: any, color: string): any {
  if (el.customData?.wbTextColor === color) return el;
  return {
    ...el,
    customData: { ...(el.customData ?? {}), wbTextColor: color },
    version: (el.version ?? 1) + 1,
    versionNonce: rand(),
  };
}

/**
 * 文字色を変更する（書式パネルから呼ぶ）。ids にはテキスト要素と図形のどちらを混ぜてもよい。
 * テキストは実際に塗り、図形は「ラベルの色」として記録する（ラベルがまだ無くても設定できる）。
 * @param currentItem 素のテキストが対象の時だけ true。Excalidraw の既定色(currentItemStrokeColor)
 *   ＝新しいテキストの文字色も同時に更新する（入力中のテキストは既定色を見て描かれるため、
 *   これが無いと入力しながら色を変えても反映されない）。図形の枠線既定色を巻き込むので、
 *   図形のラベルが対象の時は渡さない。
 */
export function setTextColor(api: any, ids: string[], color: string, currentItem = false): void {
  if (!ids.length) {
    if (currentItem) api.updateScene({ appState: { currentItemStrokeColor: color } });
    return;
  }
  const set = new Set(ids);
  const els = (api.getSceneElements() as any[]).map((e) =>
    !set.has(e.id) ? e : e.type === "text" ? withColor(e, color) : withLabelColor(e, color));
  // 文字色の変更は 1 undo ステップとして記録する（BRU7-058）
  api.updateScene(currentItem
    ? { elements: els, appState: { currentItemStrokeColor: color }, ...COMMIT }
    : { elements: els, ...COMMIT });
}

/**
 * 「線」の色変更に巻き込まれたラベルの色を元へ戻す。onChange の静穏フェーズから毎tick呼ぶ。
 *  - 図形: 記録が無ければ現在のラベル色（ラベルが無ければ既定色）を「ラベルの色」として記録する。
 *    選択中のものだけに限り、無関係な要素の版を上げない。以後この色が“正”になる。
 *  - ラベル: 記録があれば strokeColor をそこへ戻す。記録が無く図形側に記録があれば引き継ぐ
 *    （＝文字色を決めてから文字を入れた場合）。どちらも無ければ現在の色を記録するだけ（見た目は不変）。
 * remote反映中・新規描画中・テキスト編集中は何もしない（次tickで収束）。
 * @returns updateScene で反映したら true（onChangeの二重適用回避に使う）
 */
export function pinBoundTextColor(api: any, remote: boolean, appState?: any): boolean {
  if (remote || appState?.newElement) return false;
  if (document.querySelector(".excalidraw-wysiwyg")) return false; // 編集中は Excalidraw に任せる

  const els = api.getSceneElements() as any[];
  const byId = new Map<string, any>(els.map((e) => [e.id, e]));
  const sel = appState?.selectedElementIds ?? {};

  const patch = new Map<string, any>();

  // 図形側: 選択された時点で「ラベルの色」を確定させる。これでラベルを後から入れても
  // 「線」の色（currentItemStrokeColor）ではなく、ここで決めた色が使われる。
  for (const c of els) {
    if (!canHaveLabel(c) || !sel[c.id]) continue;
    if (typeof c.customData?.wbTextColor === "string") continue;
    patch.set(c.id, withLabelColor(c, readLabelColor(c, byId)));
  }

  // ラベル側: 記録した色へ揃える
  for (const t of els) {
    if (!isBoundText(t)) continue;
    const c = byId.get(t.containerId);
    if (!c || c.isDeleted) continue;
    const own = t.customData?.wbTextColor;
    if (typeof own === "string") {
      if (t.strokeColor !== own) patch.set(t.id, withColor(t, own));
    } else if (typeof c.customData?.wbTextColor === "string") {
      patch.set(t.id, withColor(t, c.customData.wbTextColor)); // 図形に決めておいた色を引き継ぐ
    } else if (sel[c.id] && typeof t.strokeColor === "string") {
      patch.set(t.id, withColor(t, t.strokeColor));            // 既存ラベルは現在の色をそのまま記録
    }
  }

  if (!patch.size) return false;
  api.updateScene({ elements: els.map((e) => patch.get(e.id) ?? e) });
  return true;
}
