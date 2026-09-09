// ホワイトボードの内容を draw.io（mxGraphModel）へ変換する。
//
// 【なぜ必要か】
// ホワイトボードのコピーはクリップボードへ `excalidraw/clipboard` の JSON を載せる。draw.io は
// この形式を知らない（draw.io 本体のソースに excalidraw の扱いは無く、Lucidchart / Miro / Visio の
// インポータしか持たない）ため、貼り付けると JSON がそのまま巨大なテキスト図形になっていた。
// draw.io が読める形は自前で作って渡すしかない。
//
// 【どう渡すか】
// クリップボードに 2 種類を同時に載せる（書き込みは whiteboardFrameCopy）。
//   text/plain … 従来どおり excalidraw/clipboard JSON   → 自ボード・他の Excalidraw が読む
//   text/html  … ここで作る mxGraphModel XML を包んだもの → draw.io が読む
// 両立する理由:
//   - draw.io の EditorUi.pasteCells は text/html を先に見て、その textContent が
//     `<mxGraphModel` で始まり `</mxGraphModel>` で終わっていれば XML として importXml する。
//   - Excalidraw の parseClipboard は text/html を見るが、`<img>` を含まない（＝全ノードがテキスト）
//     HTML はそのまま捨てて text/plain を読みに戻る。
// つまり同じ 1 回のコピーが、draw.io では図形に、自ボードでは従来どおりに貼り付く。
//
// 【方針】
//  - この module は純粋関数だけにする（Excalidraw API を受け取らない）。要素配列と files があれば
//    完結するので単体で検証でき、ダウンロード用の .drawio 生成とも共用できる。
//  - **失敗したら null を返す**。呼び出し側は text/html を載せずに従来動作へフォールバックする。
//    未知の要素 1 個で全体を落とさないよう、セル単位でも例外を握り潰して読み飛ばす。
//
// 【draw.io 側の仕様で踏むと壊れるところ】
//  - style は `;` 区切り・`=` 区切り。値に `;` を含められないので、画像の dataURL は
//    `data:image/png;base64,XXX` ではなく draw.io 流儀の `data:image/png,XXX` に直す（imageUrl）。
//  - value は `html=1` 前提の HTML。改行は `<br>` にし、XML 属性としてもエスケープする（二重）。
//  - 貼り付け判定は substring の完全一致なので、XML の前後に空白・改行を入れない。
import { isBrace, isTriangle } from "./whiteboardSnap";
import { braceDir } from "./whiteboardBrace";

// テキストボックスの枠線は文字 bbox の外側この距離に描かれる（whiteboardAutoConnect の
// TEXT_BORDER_PAD と同値）。あちらは Excalidraw 本体を読み込む重い module なので、
// この module を「Excalidraw に依存しない純粋な変換器」に保つため値だけ持つ。
const TEXT_BORDER_PAD = 6;

const isFrameEl = (e: any) => e?.type === "frame" || e?.type === "magicframe";
// 線・矢印・手描きは draw.io の「エッジ」にする。三角形と大括弧は内部的に line だが図形なので除く。
const isEdgeEl = (e: any) =>
  e?.type === "arrow" || e?.type === "freedraw" || (e?.type === "line" && !isTriangle(e) && !isBrace(e));
// 線形要素（x/y が外接矩形の左上ではなく points[0] の位置）か。
const isLinearShape = (e: any) => e?.type === "line" || e?.type === "arrow" || e?.type === "freedraw";

// 画像 1 枚の上限。dataURL をそのまま style へ埋めるため、大きいとクリップボードが数 MB になる。
// 超えた画像は破線の枠だけにして落とす（貼り付け全体が失敗するより 1 枚欠ける方が被害が小さい）。
const MAX_IMAGE_BYTES = 1_500_000;
// 生成物全体の上限。超えたら XML 生成を諦めて null を返す（＝従来どおりのコピーになる）。
const MAX_XML_BYTES = 10_000_000;
// 要素数の上限。変換は copy イベントの中で同期に走るので、極端に大きい選択では諦めて
// コピー操作自体の体感を落とさない（draw.io 形式が載らないだけで、通常のコピーは成立する）。
const MAX_ELEMENTS = 5000;
// 手描き線の間引き許容誤差(px)・点数上限・RDP へ渡す前の粗間引き上限。
// 全点を waypoint にすると draw.io が重くなり、RDP の再帰も深くなりすぎる。
const FREEDRAW_TOLERANCE = 1.2;
const MAX_EDGE_POINTS = 120;
const MAX_RDP_INPUT = 2000;

/* ────────────────────────── 文字列ユーティリティ ────────────────────────── */

/** XML 属性値としてのエスケープ。 */
const escXml = (s: string): string =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/**
 * ラベル文字列 → mxCell の value。
 * `html=1` なので value は HTML として解釈される。まず HTML エスケープしてから改行を `<br>` にし、
 * それを XML 属性としてもう一度エスケープする（＝二重エスケープが正しい）。
 */
function labelValue(text: any): string {
  const html = String(text ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\r\n|\r|\n/g, "<br>");
  return escXml(html);
}

// style は `;` 区切りなので、値に `;` が混ざると壊れる（`=` は最初の 1 個だけが区切りなので可）。
const styleSafe = (v: string) => !v.includes(";");

/** `k=v` の配列から style 文字列を組む。 */
const buildStyle = (pairs: (string | null | undefined | false)[]): string =>
  pairs.filter((p): p is string => !!p).join(";") + ";";

/** Excalidraw の色 → draw.io の色。"transparent" と未設定は `none`。 */
const color = (c: any): string => {
  if (typeof c !== "string" || !c || c === "transparent") return "none";
  return styleSafe(c) ? c : "none";
};

const num = (v: any, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const round = (v: number): number => Math.round(v * 100) / 100;

/* ────────────────────────── 幾何 ────────────────────────── */

type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

const rotatePt = (x: number, y: number, cx: number, cy: number, a: number): Pt => {
  if (!a) return { x, y };
  const s = Math.sin(a), c = Math.cos(a);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
};

/**
 * 線形要素（線・矢印・手描き）の**回転前**の外接矩形（scene 座標）。
 *
 * 【注意】線形要素は `x`/`y` が外接矩形の左上とは限らない。points は `x`/`y` からの相対で、
 * 負の値も取る。実際この盤では
 *   - 三角形: `repairOpenTriangles` が `x = 外接矩形の中央`、`points = [[0,0],[w/2,h],[-w/2,h],[0,0]]`
 *   - 大括弧: `rebuiltBrace` が `x = 外接矩形の左 + points[0].x`（`{` なら右端）
 * と持っている。したがって**必ず points から求める**こと。
 */
function linearBBox(el: any): Rect {
  const pts: number[][] = Array.isArray(el?.points) ? el.points : [];
  if (pts.length === 0) return normRect(el);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const px = num(p?.[0]), py = num(p?.[1]);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return { x: num(el.x) + minX, y: num(el.y) + minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Excalidraw の回転中心。
 *
 * 素の図形は `(x + width/2, y + height/2)`。**線形要素は「点列から求めた外接矩形の中心」**で、
 * `x + width/2` ではない（Excalidraw の getElementAbsoluteCoords は線形要素だけ points から
 * 境界を出している）。上のとおり三角形・大括弧では両者が一致しないため、ここを取り違えると
 * 回転した図形だけが横へずれる（三角形は幅ぶん、大括弧は幅の2倍ぶん）。
 *
 * ※ whiteboardSnap の `linearEndpoints` / `anchorPoints` は `x + width/2` を使っている。
 *   スナップ・接続の用途では実害が出ていないようだが、式としてはこちらが正しい。
 */
function rotationCenter(el: any): Pt {
  if (isLinearShape(el)) {
    const b = linearBBox(el);
    return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return { x: num(el.x) + num(el.width) / 2, y: num(el.y) + num(el.height) / 2 };
}

/** 線形要素（線・矢印・手描き）の全頂点を scene 座標で返す（回転込み）。 */
function absPoints(el: any): Pt[] {
  const pts: number[][] = Array.isArray(el?.points) ? el.points : [];
  if (pts.length === 0) return [];
  const c = rotationCenter(el);
  const a = num(el.angle);
  return pts.map(([px, py]) => rotatePt(num(el.x) + num(px), num(el.y) + num(py), c.x, c.y, a));
}

/** 矩形の正規化（フレームはドラッグ方向で width/height が負になり得る）。 */
function normRect(e: any): Rect {
  const w = num(e.width), h = num(e.height);
  return { x: Math.min(num(e.x), num(e.x) + w), y: Math.min(num(e.y), num(e.y) + h), w: Math.abs(w), h: Math.abs(h) };
}

/**
 * 図形セルの mxGeometry（＝**回転前**の矩形）。
 *
 * Excalidraw も draw.io も「回転前の矩形」＋「その中心まわりの回転角」で図形を表すので、
 * 回転前の外接矩形をそのまま渡せば回転結果まで一致する。線形要素（三角形・大括弧）だけは
 * x/y が外接矩形の左上ではないので、points から矩形を求める（linearBBox）。
 */
function vertexRect(el: any): Rect {
  return isLinearShape(el) ? linearBBox(el) : normRect(el);
}

/** Ramer–Douglas–Peucker。手描き線の点列を間引く。 */
function simplify(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 2) return pts;
  const last = pts.length - 1;
  const a = pts[0], b = pts[last];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let maxD = -1, idx = -1;
  for (let i = 1; i < last; i++) {
    const p = pts[i];
    let d: number;
    if (len2 === 0) d = Math.hypot(p.x - a.x, p.y - a.y);
    else {
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol || idx < 0) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}

/** 点列を上限 n 個まで等間隔に粗く間引く。 */
function decimate(pts: Pt[], n: number): Pt[] {
  if (pts.length <= n) return pts;
  const step = Math.ceil(pts.length / n);
  const out = pts.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/* ────────────────────────── 図形ごとの style ────────────────────────── */

// Excalidraw の fontFamily(数値) → draw.io の fontFamily。
// 手描き系フォント(Virgil/Excalifont/Comic)は draw.io に無いので Helvetica へ丸め、
// 手描き“風”は roughness 由来の sketch=1 の方で表現する。
function fontFamily(f: any): string {
  return f === 3 || f === 8 ? "Courier New" : "Helvetica"; // Cascadia / Comic Shanns（等幅系）
}

/** 線種（実線/破線/点線）。 */
function dashStyle(el: any): string[] {
  if (el.strokeStyle === "dashed") return ["dashed=1", "dashPattern=8 8"];
  if (el.strokeStyle === "dotted") return ["dashed=1", "dashPattern=1 4"];
  return ["dashed=0"];
}

/** 全セル共通の見た目（線の太さ・線種・不透明度・回転・手描き風）。 */
function commonStyle(el: any, opts: { rotation?: boolean } = {}): string[] {
  const out: string[] = [...dashStyle(el)];
  const sw = num(el.strokeWidth, 1);
  if (sw && sw !== 1) out.push(`strokeWidth=${round(sw)}`);
  const op = num(el.opacity, 100);
  if (op < 100) out.push(`opacity=${Math.round(op)}`);
  if (opts.rotation !== false) {
    const deg = (num(el.angle) * 180) / Math.PI;
    if (Math.abs(deg) > 0.01) out.push(`rotation=${round(((deg % 360) + 360) % 360)}`);
  }
  // 手描き風（roughness>0）は draw.io のスケッチスタイルで近似する。
  if (num(el.roughness) > 0) out.push("sketch=1", "curveFitting=1", "jiggle=2");
  return out;
}

/** ラベル（図形内テキスト or 素のテキスト）の書式。 */
function labelStyle(t: any, override: { verticalAlign?: string } = {}): string[] {
  const va = override.verticalAlign
    ?? (t?.verticalAlign === "top" ? "top" : t?.verticalAlign === "bottom" ? "bottom" : "middle");
  const out = [
    `align=${t?.textAlign === "right" ? "right" : t?.textAlign === "left" ? "left" : "center"}`,
    `verticalAlign=${va}`,
    `fontSize=${Math.round(num(t?.fontSize, 16))}`,
    `fontFamily=${fontFamily(t?.fontFamily)}`,
  ];
  // 文字色は wbTextColor が正（whiteboardTextColor が strokeColor より優先させている）。
  const c = color(t?.customData?.wbTextColor ?? t?.strokeColor);
  if (c !== "none") out.push(`fontColor=${c}`);
  return out;
}

// Excalidraw の矢じり → draw.io の endArrow/startArrow。
// 既定の "arrow" は 2 本線の開いた矢じりなので open が最も近い。
function arrowHead(kind: any): { shape: string; fill: 0 | 1 } {
  switch (kind) {
    case "arrow": return { shape: "open", fill: 0 };
    case "triangle": return { shape: "block", fill: 1 };
    case "triangle_outline": return { shape: "block", fill: 0 };
    case "diamond": return { shape: "diamondThin", fill: 1 };
    case "diamond_outline": return { shape: "diamondThin", fill: 0 };
    case "dot":
    case "circle": return { shape: "oval", fill: 1 };
    case "circle_outline": return { shape: "oval", fill: 0 };
    case "bar": return { shape: "ERone", fill: 0 };
    default: return { shape: "none", fill: 0 };
  }
}

/**
 * 三角形（4 点の閉じた line）の向き。頂点のうち「底辺を共有しない 1 点」がどこにあるかで決める。
 * draw.io の triangle は既定で東（右）向きなので、上向きなら direction=north を付ける。
 * 回転は rotation で別に効くため、ここでは回転前の点列で判定する。
 */
function triangleDirection(el: any): string {
  const pts: number[][] = Array.isArray(el?.points) ? el.points : [];
  const p = pts.slice(0, 3).map(([x, y]) => ({ x: num(x), y: num(y) }));
  if (p.length < 3) return "north";
  const b = linearBBox(el);
  const eps = Math.max(1, Math.min(b.w, b.h) * 0.1);
  for (let i = 0; i < 3; i++) {
    const a = p[i], c = p[(i + 1) % 3], apex = p[(i + 2) % 3];
    if (Math.abs(a.y - c.y) < eps) return apex.y < a.y ? "north" : "south";
    if (Math.abs(a.x - c.x) < eps) return apex.x < a.x ? "west" : "east";
  }
  return "north";
}

/**
 * 大括弧の向き。
 *
 * draw.io の `curlyBracket`（Shapes.js の CurlyBracketShape）は
 *   (w,0) → (s,0) → (s,h/2) → (0,h/2) → (s,h/2) → (s,h) → (w,h)   ※ s = w * size（既定 0.5）
 * を描く。つまり**トゲが左辺の中央・縦棒が横中央・両端が右辺**の `{` が基準で、
 * これはこちらの括弧（縦棒は外接矩形の横中央、トゲは一辺、両端は対辺）と同じ形。
 *
 * 向きは `direction` で与えるが、`mxShape.getShapeRotation()` は
 *   north → +270° / west → +180° / south → +90°（いずれも時計回り）
 * であり、**基準の向きが「西」なので三角形（基準が「東」）とは上下が逆になる**。
 * トゲのベクトル (-1,0) を時計回りに θ 回すと (-cosθ, -sinθ) なので、
 *   θ=90（south）→ (0,-1) ＝ 上  ／  θ=270（north）→ (0,1) ＝ 下
 * となる。ここを取り違えると上下の括弧が逆さまに出る。
 *
 * 右向き `}` は左右反転で作る（curlyBracket は y=h/2 に対して対称なので 180° 回転と等価）。
 * なお `direction` が north/south のときは mxShape 側で flipH と flipV が入れ替わるため、
 * 回転と反転を混ぜるのは避けている。
 * トゲの位置 tip は draw.io 側に該当する設定が無く、常に中央（h/2）になる。
 */
function braceStyle(el: any): string[] {
  const d = braceDir(el);
  const out = ["shape=curlyBracket", "rounded=1"];
  if (d === "right") out.push("flipH=1");
  else if (d === "up") out.push("direction=south");
  else if (d === "down") out.push("direction=north");
  return out;
}

/**
 * 画像の dataURL を draw.io の style へ埋められる形にする。
 * style は `;` 区切りなので `data:image/png;base64,XXX` はそのまま入れられない。
 * draw.io 自身も `data:image/png,XXX`（`;base64` を落とした形）で持っているのでそれに合わせる。
 * @returns 埋め込める文字列。無理なら null
 */
function imageUrl(dataURL: any): string | null {
  if (typeof dataURL !== "string" || !dataURL) return null;
  if (/^https?:\/\//.test(dataURL)) return styleSafe(dataURL) ? dataURL : null;
  if (dataURL.length > MAX_IMAGE_BYTES) return null;
  const m = /^data:([^,;]+)(;base64)?,([\s\S]*)$/.exec(dataURL);
  if (!m) return null;
  return `data:${m[1]},${m[3]}`;
}

/* ────────────────────────── コンテナ（フレーム / グループ） ────────────────────────── */

interface Container {
  key: string;                 // "frame:<id>" / "group:<groupId>"
  cellId: string;
  parentKey: string | null;
  x: number; y: number; w: number; h: number;   // scene 座標での矩形
  style: string;
  value: string;
  emitted: boolean;
}

/** Excalidraw の groupIds は内側→外側の順。いちばん外側のグループだけを draw.io のグループにする。 */
const outerGroupId = (el: any): string | null => {
  const g = el?.groupIds;
  return Array.isArray(g) && g.length > 0 && typeof g[g.length - 1] === "string" ? g[g.length - 1] : null;
};

/** 要素の所属フレームのコンテナキー（無ければ null）。 */
function frameKeyOf(el: any, containers: Map<string, Container>): string | null {
  const p = el?.customData?.wbParent;
  return typeof p === "string" && containers.has(`frame:${p}`) ? `frame:${p}` : null;
}

// Excalidraw の id はランダム英数だが、念のため mxCell id に使えない文字を落とす。
const cellId = (id: string): string => `wb_${String(id).replace(/[^A-Za-z0-9_-]/g, "_")}`;

/* ────────────────────────── 変換本体 ────────────────────────── */

/**
 * 要素配列 → mxGraphModel XML。
 * @param elements コピー対象（collectSelectionClosure が返す“連れ子込み”の配列。シーン順＝重なり順）
 * @param files    画像の実体（api.getFiles() の戻り）
 * @returns XML 文字列。変換できるセルが 1 つも無い／失敗した場合は null
 */
export function buildDrawioXml(elements: readonly any[], files: Record<string, any> = {}): string | null {
  try {
    if (elements.length > MAX_ELEMENTS) return null;
    const xml = convert(elements, files ?? {});
    if (!xml || xml.length > MAX_XML_BYTES) return null;
    return xml;
  } catch {
    return null; // 変換に失敗しても従来のコピーは壊さない
  }
}

function convert(elements: readonly any[], files: Record<string, any>): string | null {
  const live = elements.filter((e) => e && !e.isDeleted);
  const byId = new Map<string, any>(live.map((e) => [e.id, e]));

  // 影矩形（テキストボックス背景・フレーム装飾）は「持ち主の塗り/枠線」なので、
  // 独立したセルにはせず持ち主へ畳む。図形内テキストも親図形の value へ畳む。
  const textBgOf = new Map<string, any>();    // textId      -> 影矩形
  const frameBgOf = new Map<string, any>();   // frameId     -> 影矩形
  const boundTextOf = new Map<string, any>(); // containerId -> text 要素
  for (const e of live) {
    const cd = e.customData || {};
    if (typeof cd.wbBgFor === "string") textBgOf.set(cd.wbBgFor, e);
    else if (typeof cd.wbFrameBg === "string") frameBgOf.set(cd.wbFrameBg, e);
    else if (e.type === "text" && typeof e.containerId === "string") boundTextOf.set(e.containerId, e);
  }
  const isFolded = (e: any) =>
    typeof e?.customData?.wbBgFor === "string" ||
    typeof e?.customData?.wbFrameBg === "string" ||
    (e.type === "text" && typeof e.containerId === "string" && byId.has(e.containerId));

  const targets = live.filter((e) => !isFolded(e));
  if (targets.length === 0) return null;

  /* ── コンテナを用意する ─────────────────────────────────────── */
  const containers = new Map<string, Container>();

  // フレーム: 自分の矩形をそのまま使う。塗り/枠線は装飾の影矩形から取る（無ければ既定のグレー枠）。
  for (const e of targets) {
    if (!isFrameEl(e)) continue;
    const r = normRect(e);
    const decor = frameBgOf.get(e.id);
    containers.set(`frame:${e.id}`, {
      key: `frame:${e.id}`,
      cellId: cellId(e.id),
      parentKey: null, // 入れ子は後段で張る
      x: r.x, y: r.y, w: r.w, h: r.h,
      style: buildStyle([
        decor?.roundness ? "rounded=1" : "rounded=0",
        "whiteSpace=wrap", "html=1", "container=1", "collapsible=0", "recursiveResize=0",
        `fillColor=${color(decor?.backgroundColor)}`,
        `strokeColor=${color(decor ? decor.strokeColor : "#adb5bd")}`, // DEFAULT_FRAME_BORDER
        "verticalAlign=top", "align=left", "spacing=4", "fontSize=12", "fontColor=#868e96",
        ...commonStyle(e, { rotation: false }),
      ]),
      value: labelValue(e.name ?? ""),
      emitted: false,
    });
  }

  // Excalidraw のグループ: メンバー（図形セルになるもの）が 2 つ以上で、所属フレームが揃っている場合だけ。
  // エッジはグループに入れない（＝常にルート直下）。source/target は id 参照なので所属が違っても繋がる。
  const groupMembers = new Map<string, any[]>();
  for (const e of targets) {
    if (isEdgeEl(e) || isFrameEl(e)) continue;
    const g = outerGroupId(e);
    if (!g) continue;
    const arr = groupMembers.get(g) ?? [];
    arr.push(e);
    groupMembers.set(g, arr);
  }
  for (const [gid, members] of groupMembers) {
    if (members.length < 2) continue;
    const frames = new Set(members.map((m) => frameKeyOf(m, containers)));
    if (frames.size !== 1) continue; // フレームをまたぐグループは親が決まらないので作らない
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members) {
      const r = vertexRect(m);
      minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
    }
    if (!Number.isFinite(minX)) continue;
    containers.set(`group:${gid}`, {
      key: `group:${gid}`,
      cellId: cellId(`g_${gid}`),
      parentKey: [...frames][0],
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      style: "group;",
      value: "",
      emitted: false,
    });
  }

  // フレームの入れ子（wbParent）を張る
  for (const c of containers.values()) {
    if (!c.key.startsWith("frame:")) continue;
    const el = byId.get(c.key.slice("frame:".length));
    const p = el?.customData?.wbParent;
    c.parentKey = typeof p === "string" && p !== el?.id && containers.has(`frame:${p}`) ? `frame:${p}` : null;
  }

  /** 要素が属するコンテナ（グループ優先、無ければフレーム）。 */
  const containerOf = (el: any): Container | null => {
    if (!isEdgeEl(el)) {
      const g = outerGroupId(el);
      if (g && containers.has(`group:${g}`)) return containers.get(`group:${g}`)!;
    }
    const fk = frameKeyOf(el, containers);
    return fk ? containers.get(fk)! : null;
  };

  /* ── 出力先セル id の対応表（エッジの source/target 解決に使う）───────── */
  const cellOf = new Map<string, string>();
  for (const e of targets) cellOf.set(e.id, cellId(e.id));
  // 畳んだ要素を指す接続は持ち主へ付け替える
  for (const [textId, rect] of textBgOf) { const c = cellOf.get(textId); if (c) cellOf.set(rect.id, c); }
  for (const [frameId, rect] of frameBgOf) { const c = cellOf.get(frameId); if (c) cellOf.set(rect.id, c); }
  for (const [containerId, t] of boundTextOf) { const c = cellOf.get(containerId); if (c) cellOf.set(t.id, c); }

  /* ── セルを組み立てる ────────────────────────────────────────── */
  const out: string[] = [];

  // コンテナを（自分の親を先に）出す。draw.io は親が先に現れる並びを前提にしている。
  const emitContainer = (c: Container | null): void => {
    if (!c || c.emitted) return;
    const parent = c.parentKey ? containers.get(c.parentKey) ?? null : null;
    emitContainer(parent);
    c.emitted = true;
    const ox = parent ? parent.x : 0, oy = parent ? parent.y : 0;
    out.push(
      `<mxCell id="${escXml(c.cellId)}" value="${c.value}" style="${escXml(c.style)}" vertex="1" parent="${escXml(parent ? parent.cellId : "1")}">` +
      geometryXml(c.x - ox, c.y - oy, c.w, c.h) +
      `</mxCell>`,
    );
  };

  for (const el of targets) {
    try {
      if (isFrameEl(el)) { emitContainer(containers.get(`frame:${el.id}`) ?? null); continue; }
      if (isEdgeEl(el)) { const xml = edgeCell(el, cellOf, byId, boundTextOf); if (xml) out.push(xml); continue; }
      const box = containerOf(el);
      emitContainer(box);
      const xml = vertexCell(el, box, boundTextOf, textBgOf, files);
      if (xml) out.push(xml);
    } catch {
      /* このセルだけ諦めて続行 */
    }
  }

  if (out.length === 0) return null;

  // 貼り付け判定は substring の完全一致なので、前後に空白・改行を入れない。
  return (
    `<mxGraphModel dx="0" dy="0" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    out.join("") +
    `</root></mxGraphModel>`
  );
}

const geometryXml = (x: number, y: number, w: number, h: number): string =>
  `<mxGeometry x="${round(x)}" y="${round(y)}" width="${round(Math.max(w, 1))}" height="${round(Math.max(h, 1))}" as="geometry"/>`;

/* ────────────────────────── 図形セル ────────────────────────── */

function vertexCell(
  el: any,
  box: Container | null,
  boundTextOf: Map<string, any>,
  textBgOf: Map<string, any>,
  files: Record<string, any>,
): string | null {
  let { x, y, w, h } = vertexRect(el);
  const parts: string[] = [];
  let value = "";
  let label: any = boundTextOf.get(el.id) ?? null;
  let labelOverride: { verticalAlign?: string } = {};
  let painted = false; // 塗り/枠線を style へ入れたか（画像シェイプには入れない）

  switch (el.type) {
    case "rectangle":
      parts.push(el.roundness ? "rounded=1" : "rounded=0", "whiteSpace=wrap", "html=1");
      break;
    case "ellipse":
      parts.push("ellipse", "whiteSpace=wrap", "html=1");
      break;
    case "diamond":
      parts.push("rhombus", "whiteSpace=wrap", "html=1");
      break;
    case "image": {
      const url = imageUrl(files?.[el.fileId]?.dataURL);
      if (url) {
        parts.push("shape=image", "html=1", "imageAspect=0", "verticalLabelPosition=bottom", "verticalAlign=top", `image=${url}`);
        painted = true; // 画像は塗り/枠線を持たせない
      } else {
        // 埋められない画像（未読込・巨大）は破線の枠だけにして位置を残す
        parts.push("rounded=0", "whiteSpace=wrap", "html=1");
      }
      break;
    }
    case "text": {
      // 素のテキストボックス。背景/枠線の影矩形があれば、その矩形を採用して見た目を合わせる。
      const bg = textBgOf.get(el.id);
      parts.push("text", "html=1", "whiteSpace=wrap", "rounded=0");
      if (bg) {
        ({ x, y, w, h } = normRect(bg));
        // 影矩形は文字 bbox の外側 TEXT_BORDER_PAD ぶん大きい＝文字は矩形の中央にある
        labelOverride = { verticalAlign: "middle" };
      } else {
        // 影矩形が無い場合は文字 bbox ぴったり。draw.io は独自のフォント計測で折り返すため、
        // ぴったりだと最後の 1 文字が次行へ落ちることがある。同じ余白ぶんだけ広げて逃がす。
        x -= TEXT_BORDER_PAD; y -= TEXT_BORDER_PAD; w += TEXT_BORDER_PAD * 2; h += TEXT_BORDER_PAD * 2;
      }
      parts.push(`fillColor=${color(bg?.backgroundColor)}`, `strokeColor=${color(bg?.strokeColor)}`);
      painted = true;
      label = el;
      break;
    }
    case "line":
      if (isTriangle(el)) parts.push("triangle", "whiteSpace=wrap", "html=1", `direction=${triangleDirection(el)}`);
      else if (isBrace(el)) parts.push(...braceStyle(el), "html=1");
      else return null;
      break;
    default:
      return null; // 未知の型（embeddable / iframe など）は出さない
  }

  if (!painted) parts.push(`fillColor=${color(el.backgroundColor)}`, `strokeColor=${color(el.strokeColor)}`);
  parts.push(...commonStyle(el));

  if (label) {
    parts.push(...labelStyle(label, labelOverride));
    value = labelValue(label.text ?? label.originalText ?? "");
  }

  const ox = box ? box.x : 0, oy = box ? box.y : 0;
  const inner =
    `<mxCell id="${escXml(cellId(el.id))}" value="${value}" style="${escXml(buildStyle(parts))}" vertex="1" parent="${escXml(box ? box.cellId : "1")}">` +
    geometryXml(x - ox, y - oy, w, h) +
    `</mxCell>`;
  return wrapLink(el, inner);
}

/**
 * リンク付きの要素は UserObject で包む（draw.io のリンクはセルではなく UserObject が持つ）。
 * 包むときは id を UserObject へ移し、mxCell からは外すのが draw.io の形。
 */
function wrapLink(el: any, cellXml: string): string {
  const link = typeof el?.link === "string" && el.link ? el.link : null;
  if (!link) return cellXml;
  const id = escXml(cellId(el.id));
  const stripped = cellXml.replace(`<mxCell id="${id}" `, `<mxCell `);
  return `<UserObject label="" link="${escXml(link)}" id="${id}">${stripped}</UserObject>`;
}

/* ────────────────────────── エッジセル ────────────────────────── */

function edgeCell(
  el: any,
  cellOf: Map<string, string>,
  byId: Map<string, any>,
  boundTextOf: Map<string, any>,
): string | null {
  const pts = absPoints(el);
  if (pts.length < 2) return null;

  // 接続先。自前方式(customData.triStart/triEnd)を第一に、Excalidraw ネイティブの binding も見る。
  const cd = el.customData || {};
  const startRef = anchorRef(cd.triStart) ?? bindingRef(el.startBinding);
  const endRef = anchorRef(cd.triEnd) ?? bindingRef(el.endBinding);
  const source = startRef && byId.has(startRef.id) ? cellOf.get(startRef.id) ?? null : null;
  const target = endRef && byId.has(endRef.id) ? cellOf.get(endRef.id) ?? null : null;

  const isFree = el.type === "freedraw";
  const parts: string[] = ["html=1"];
  // 経路は画面に描かれている点列をそのまま waypoint にするので、draw.io 側の自動ルートは切る。
  parts.push(el.elbowed ? "edgeStyle=orthogonalEdgeStyle" : "edgeStyle=none");
  if (el.roundness || isFree) parts.push("curved=1");
  parts.push("rounded=0", "jettySize=auto", "orthogonalLoop=1");

  // 矢じり。line/freedraw は矢じり無し、arrow は未設定なら既定の "arrow"。
  const rawEnd = isFree ? null : el.endArrowhead !== undefined ? el.endArrowhead : el.type === "arrow" ? "arrow" : null;
  const s = arrowHead(isFree ? null : el.startArrowhead);
  const e = arrowHead(rawEnd);
  parts.push(`startArrow=${s.shape}`, `startFill=${s.fill}`, `endArrow=${e.shape}`, `endFill=${e.fill}`);
  parts.push(`strokeColor=${color(el.strokeColor)}`);
  parts.push(...commonStyle(el, { rotation: false })); // 点列は回転済みなので rotation は付けない

  // 接続位置（自前アンカーは外接矩形に対する相対位置なので exit/entry へそのまま写せる）
  if (source && startRef?.fx != null) parts.push(`exitX=${round(startRef.fx)}`, `exitY=${round(startRef.fy!)}`, "exitDx=0", "exitDy=0");
  if (target && endRef?.fx != null) parts.push(`entryX=${round(endRef.fx)}`, `entryY=${round(endRef.fy!)}`, "entryDx=0", "entryDy=0");

  // 中間点。手描きは間引く。
  let mid: Pt[];
  if (isFree) mid = simplify(decimate(pts, MAX_RDP_INPUT), FREEDRAW_TOLERANCE).slice(1, -1);
  else mid = pts.slice(1, -1);
  mid = decimate(mid, MAX_EDGE_POINTS);

  const geo: string[] = [];
  if (!source) geo.push(`<mxPoint x="${round(pts[0].x)}" y="${round(pts[0].y)}" as="sourcePoint"/>`);
  if (!target) geo.push(`<mxPoint x="${round(pts[pts.length - 1].x)}" y="${round(pts[pts.length - 1].y)}" as="targetPoint"/>`);
  if (mid.length) geo.push(`<Array as="points">${mid.map((p) => `<mxPoint x="${round(p.x)}" y="${round(p.y)}"/>`).join("")}</Array>`);

  // 矢印のラベル（バインドテキスト）は draw.io ではエッジの value になる
  const label = boundTextOf.get(el.id);
  if (label) parts.push(...labelStyle(label));
  const value = label ? labelValue(label.text ?? label.originalText ?? "") : "";

  const inner =
    `<mxCell id="${escXml(cellId(el.id))}" value="${value}" style="${escXml(buildStyle(parts))}" edge="1" parent="1"` +
    (source ? ` source="${escXml(source)}"` : "") + (target ? ` target="${escXml(target)}"` : "") + `>` +
    `<mxGeometry relative="1" as="geometry">${geo.join("")}</mxGeometry>` +
    `</mxCell>`;
  return wrapLink(el, inner);
}

/** 自前接続アンカー（customData.triStart/triEnd）を読む。 */
function anchorRef(a: any): { id: string; fx?: number; fy?: number } | null {
  if (!a || typeof a.id !== "string") return null;
  const fx = typeof a.fx === "number" ? a.fx : undefined;
  const fy = typeof a.fy === "number" ? a.fy : undefined;
  return fx != null && fy != null ? { id: a.id, fx, fy } : { id: a.id };
}

/** Excalidraw ネイティブの binding を読む（focus/gap は draw.io に相当が無いので位置は自動に任せる）。 */
function bindingRef(b: any): { id: string } | null {
  return b && typeof b.elementId === "string" ? { id: b.elementId } : null;
}

/* ────────────────────────── 受け渡し用の器 ────────────────────────── */

/**
 * クリップボードの text/html に載せる形。**draw.io 自身が使っているのと同じ形にする。**
 *
 *   <span>encodeURIComponent(XML)</span>
 *
 * 【なぜ span ＋ URI エンコードなのか】
 * draw.io の pasteCells には XML の取り出し口が 2 つある。
 *   (a) 貼り付けた要素全体の textContent が `<mxGraphModel` で始まり `</mxGraphModel>` で
 *       終わるか（substring の完全一致）
 *   (b) 最初の `<span>` の textContent を decodeURIComponent して trim したもの
 * (a) は**クリップボードを往復すると成立しない**。ブラウザは text/html を CF_HTML 形式で持ち、
 * 読み出すときに `<html>\n<body>\n<!--StartFragment-->…<!--EndFragment-->\n</body>\n</html>`
 * のように包む。この改行が textContent の前後に残るため `substring(0, 13)` が一致しなくなり、
 * XML がただのテキストとして貼られてしまう（実機で確認）。
 * (b) は span 自身の textContent を見て trim もするので、外側に何が付いても影響を受けない。
 * さらに URI エンコードすると `<` `&` `%` や日本語がすべて英数字になるので、HTML エスケープの
 * 取り違えも、draw.io 側の DOMPurify（Graph.sanitizeHtml）も、`decodeURIComponent` が
 * 不正な `%` で例外を投げる問題（ラベルに「50%」等が入ると起きる）も同時に避けられる。
 * draw.io 自身の copyCells も `setTextContent(elt, encodeURIComponent(xml))` と書いている。
 *
 * Excalidraw 側は「`<img>` を含まない HTML」を捨てて text/plain へ戻るので、span でも従来どおり。
 */
export function buildDrawioClipboardHtml(xml: string): string {
  return `<span>${encodeURIComponent(xml)}</span>`;
}

/**
 * ダウンロード用の .drawio ファイル本文（draw.io の「ファイル > 開く」で読める形）。
 * クリップボードが使えない環境（社内ポリシー・ネイティブアプリ）向けの逃げ道。
 */
export function buildDrawioFile(elements: readonly any[], files: Record<string, any>, title: string): string | null {
  const xml = buildDrawioXml(elements, files);
  if (!xml) return null;
  return (
    `<mxfile host="app.diagrams.net" type="device">` +
    `<diagram name="${escXml(title || "whiteboard")}">${xml}</diagram>` +
    `</mxfile>`
  );
}
