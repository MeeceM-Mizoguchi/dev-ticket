// Mermaid 定義 → ホワイトボードの要素 への変換を1箇所に集約する。
//
// ツールバーの「Mermaid」ボタン（MermaidToolButton）と、Markdown 貼り付けの ```mermaid
// （whiteboardPasteMarkdown）の両方から使う。
//
// 生成方針（MermaidToolButton から引き継ぎ）: @excalidraw/mermaid-to-excalidraw で編集可能な
// ネイティブ図形に変換し、変換に対応しない図種は SVG→PNG 化して画像要素として配置する。
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import { renderMermaid, mermaidSvgToPngDataUrl, runWithMermaidConfig } from "@/app/lib/mermaid";

// mermaid-to-excalidraw が本来使う設定（同ライブラリの MERMAID_CONFIG と同値）。
// 同ライブラリは initialize をキャッシュで省くことがあり、その隙にプレビュー(MermaidView)側の設定が
// 残っていると変換結果がずれるため、変換の直前にこちらから入れ直す（runWithMermaidConfig 参照）。
const CONVERT_CONFIG = {
  startOnLoad: false,
  flowchart: { curve: "linear" },
  themeVariables: { fontSize: "20px" },
  maxEdges: 500,
  maxTextSize: 50000,
};

/**
 * mermaid-to-excalidraw が「内部フォールバック」を返したかを判定する。
 *
 * 同ライブラリは 未対応の図種(gantt/pie/mindmap 等) や 変換中の例外 を内部で握りつぶし
 * （console に "Error processing Mermaid diagram" だけ出す）、図を焼いたSVG画像1枚を *正常値として*
 * 返す。例外にならないのでこのファイルのPNGフォールバックが働かない。
 * しかもその dataURL は outerHTML（HTML直列化）なので、Excalidraw が受け取り時に XML として
 * 読み直すと "Invalid SVG" で弾かれ、中身の無い壊れた画像だけがキャンバスに残る（図が出ない）。
 * ＝この形は使わず、必ず自前のPNG化へ回す。
 *
 * 例: mermaid v11 の flowchart は subgraph の <g> に id を付けないため、同ライブラリの
 *     subgraph 探索が必ず失敗する（SubGraph element not found）→ この経路に落ちる。
 *
 * 判定: files を返すのは同ライブラリ内でこのフォールバック経路だけ。念のため画像だけの結果も弾く。
 */
function isImageFallback(elements: any[], files: unknown): boolean {
  const list = files && typeof files === "object" ? Object.values(files as Record<string, any>) : [];
  if (list.some((f) => typeof f?.mimeType === "string" && f.mimeType.includes("svg"))) return true;
  return elements.length > 0 && elements.every((e) => e?.type === "image");
}

// mermaid-to-excalidraw はラベル内の <br/> を改行に変換しないため、変換後のテキスト要素で改行へ置換する。
const fixBr = (t: string) => t.replace(/<br\s*\/?>/gi, "\n");

const NORMAL_FONT_FAMILY = 2;

/**
 * 生成した全要素に印(wbMermaid)を付け、グループ解除・フォント正規化・<br/>改行を行う。
 * - wbMermaid 印: この白板の自動処理（線を近くの図形へスナップする autoConnect 等）が mermaid の
 *   矢印・線を触って崩さないよう「除外対象」として使う（whiteboardAutoConnect / whiteboardSnap 参照）。
 * - groupIds を空に: mermaid-to-excalidraw は alt ブロック等をグループ化するため、クリックすると
 *   個別図形でなくグループが選択され「図形を個別に選択・移動できない」状態になる。個別編集できるよう解除。
 * - fontFamily=2(Helvetica 通常): 既定が手書きフォント(Excalifont)になるため、白板の既定スタイル
 *   (CLEAN_DEFAULTS の currentItemFontFamily=2)に合わせてシンプルなフォントにする。
 */
export function markMermaidElements(els: any[]): any[] {
  for (const e of els) {
    e.customData = { ...(e.customData ?? {}), wbMermaid: true };
    e.groupIds = [];
    // 手書き風の揺れ(roughness)をなくして直線・シンプルな罫線にする（白板の既定スタイルに合わせる）。
    e.roughness = 0;
    if (e.type === "arrow" || e.type === "line") {
      // 角丸ルーティングをやめて直線に。
      e.roundness = null;
      // 図形への「バインド(接続)」を外す。バインドが残ると undo/移動時に Excalidraw が
      // 束ねた矢印の位置を連鎖再計算し、この白板の Yjs 同期＋履歴と噛み合って図全体が崩れる。
      // 生成物は独立した図形として扱い、各要素を自由に動かせるようにする。
      e.startBinding = null;
      e.endBinding = null;
      // 【最重要】線形要素の正規化。Excalidraw は points[0] が [0,0] であることを要求する。
      // mermaid-to-excalidraw は未正規化の矢印(points[0]≠原点)を返すため、点をドラッグすると
      // LinearElementEditor が「not normalized」で壊れ、x が -1.5e23 等の異常値になり、
      // その結果 isValidEl に弾かれて矢印が消える/飛ぶ。ここで先頭点を原点へ揃えて根絶する
      // （TriangleToolButton の normalizeLinear と同じ処理）。
      if (Array.isArray(e.points) && e.points.length > 0) {
        const ox = e.points[0][0], oy = e.points[0][1];
        if (ox !== 0 || oy !== 0) {
          e.points = e.points.map((p: number[]) => [p[0] - ox, p[1] - oy]);
          e.x = (e.x ?? 0) + ox;
          e.y = (e.y ?? 0) + oy;
        }
        const xs = e.points.map((p: number[]) => p[0]);
        const ys = e.points.map((p: number[]) => p[1]);
        e.width = Math.max(...xs) - Math.min(...xs);
        e.height = Math.max(...ys) - Math.min(...ys);
      }
    }
    // 図形側に残る「矢印バインド」参照も外す（テキストラベルの紐づけ type:"text" は残す）。
    if (Array.isArray(e.boundElements)) {
      e.boundElements = e.boundElements.filter((b: any) => b?.type === "text");
    }
    if (typeof e.text === "string") {
      e.text = fixBr(e.text);
      e.fontFamily = NORMAL_FONT_FAMILY;
    }
    if (typeof e.originalText === "string") e.originalText = fixBr(e.originalText);
  }
  return els;
}

/** 要素群の外接矩形 */
export function boundsOf(els: any[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of els) {
    const x = e.x ?? 0, y = e.y ?? 0, w = e.width ?? 0, h = e.height ?? 0;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** 要素群を平行移動する（破壊的） */
export function translateElements(els: any[], dx: number, dy: number): any[] {
  for (const e of els) { e.x = (e.x ?? 0) + dx; e.y = (e.y ?? 0) + dy; }
  return els;
}

/** 外接矩形の左上が (x, y) に来るよう移動する */
export function placeTopLeft(els: any[], x: number, y: number): any[] {
  const b = boundsOf(els);
  return translateElements(els, x - b.minX, y - b.minY);
}

function pngSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 400, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 400, height: 300 });
    img.src = dataUrl;
  });
}

/**
 * Mermaid 定義から要素を作る。ネイティブ変換 → 失敗時は PNG 画像へフォールバック。
 * 座標は変換結果のまま（配置は呼び出し側で placeTopLeft / 中央寄せする）。
 * 画像ファイルの登録(api.addFiles)はここで行う。両方失敗したら例外を投げる。
 */
export async function mermaidToElements(api: any, code: string, maxImageWidth = 600): Promise<any[]> {
  const src = code.trim();
  if (!src) throw new Error("Mermaidの定義が空です");

  // ① ネイティブ変換（編集可能な図形）
  try {
    const { elements: skeleton, files } = await runWithMermaidConfig(
      CONVERT_CONFIG,
      () => parseMermaidToExcalidraw(src),
    );
    // ライブラリ内部のSVG画像フォールバックは表示できないので、②の自前PNG化に任せる。
    if (isImageFallback(skeleton as any[], files)) throw new Error("この図種はネイティブ変換に非対応");
    const converted = convertToExcalidrawElements(skeleton as any) as any[];
    if (!converted.length) throw new Error("変換結果が空です");
    markMermaidElements(converted);
    if (files) { try { api.addFiles(Object.values(files)); } catch { /* noop */ } }
    return converted;
  } catch (nativeErr) {
    // ② フォールバック: SVG→PNG 画像として配置
    const res = await renderMermaid(src, { forRaster: true });
    if (!("svg" in res)) throw new Error(res.error);
    const dataUrl = await mermaidSvgToPngDataUrl(res.svg);
    const { width, height } = await pngSize(dataUrl);
    const scale = width > maxImageWidth ? maxImageWidth / width : 1;
    const w = Math.round(width * scale), h = Math.round(height * scale);
    const fileId = `mermaid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    api.addFiles([{ id: fileId, dataURL: dataUrl, mimeType: "image/png", created: Date.now() }]);
    const els = convertToExcalidrawElements([
      { type: "image", fileId, x: 0, y: 0, width: w, height: h, status: "saved" } as any,
    ]) as any[];
    markMermaidElements(els);
    // ネイティブ変換が落ちた旨は console にのみ残す（利用者には画像で成功として見せる）。
    console.debug("[Mermaid] native conversion failed, inserted as image:", nativeErr);
    return els;
  }
}
