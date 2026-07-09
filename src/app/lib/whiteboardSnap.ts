// ホワイトボード「図形ガイド」の幾何計算（ENHA2-022）。
// Excalidraw 標準スナップは外接矩形の四隅/中心を基準にするため、斜めの線・矢印では
// 「実際の端点」がスナップされない。ここでは線・矢印の“本当の開始点・終了点”を対象に、
// 他要素のアンカー（他の線の端点／図形の角・辺中点・中心）へ揃えるための補正量とガイド線を求める。
//
// 座標はすべて scene 座標。要素の型は版差があるため any で緩く扱う。

export type Pt = { x: number; y: number };
type El = any;

export const isLinearEl = (el: El): boolean => el?.type === "line" || el?.type === "arrow";

// 三角形は内部的に line だが「図形」として扱う（コネクトの対象、端点スナップの非対象）。
// customData/idが失われても検出できるよう、幾何形状（閉じた3頂点の折れ線）でもフォールバック判定する。
export const isTriangle = (el: El): boolean => {
  if (el?.type !== "line") return false;
  // mermaid 生成要素は三角形判定・修復の対象外（closed 4点lineと誤判定して崩さないため）
  if (el?.customData?.wbMermaid === true) return false;
  if (el?.customData?.wbTriangle === true) return true;
  if (typeof el?.id === "string" && el.id.startsWith("wb_tri_")) return true;
  const p = el?.points;
  return Array.isArray(p) && p.length === 4 && p[0]?.[0] === p[3]?.[0] && p[0]?.[1] === p[3]?.[1];
};

// 点(x,y)を中心(cx,cy)まわりに angle ラジアン回転
function rotate(x: number, y: number, cx: number, cy: number, angle: number): Pt {
  if (!angle) return { x, y };
  const s = Math.sin(angle), c = Math.cos(angle);
  const dx = x - cx, dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

// 線・矢印の実端点（開始点・終了点）を scene 座標で返す。回転・折れ線にも対応。
export function linearEndpoints(el: El): Pt[] {
  const pts: number[][] = Array.isArray(el?.points) ? el.points : [];
  if (pts.length < 2) return [];
  const cx = el.x + (el.width ?? 0) / 2;
  const cy = el.y + (el.height ?? 0) / 2;
  const first = pts[0], last = pts[pts.length - 1];
  return [first, last].map((p) => rotate(el.x + p[0], el.y + p[1], cx, cy, el.angle || 0));
}

// スナップ先アンカー点。線・矢印は全頂点、その他は外接矩形の角(4)・辺中点(上下左右4)・中心(1)。
export function anchorPoints(el: El): Pt[] {
  const angle = el?.angle || 0;
  if (isLinearEl(el)) {
    const pts: number[][] = Array.isArray(el.points) ? el.points : [];
    const cx = el.x + (el.width ?? 0) / 2, cy = el.y + (el.height ?? 0) / 2;
    return pts.map((p) => rotate(el.x + p[0], el.y + p[1], cx, cy, angle));
  }
  const w = el?.width ?? 0, h = el?.height ?? 0;
  const cx = el.x + w / 2, cy = el.y + h / 2;
  const raw: Pt[] = [
    { x: el.x, y: el.y }, { x: el.x + w, y: el.y }, { x: el.x, y: el.y + h }, { x: el.x + w, y: el.y + h }, // 角
    { x: cx, y: el.y }, { x: cx, y: el.y + h }, { x: el.x, y: cy }, { x: el.x + w, y: cy },                 // 辺中点(上下左右)
    { x: cx, y: cy },                                                                                        // 中心
  ];
  return raw.map((p) => rotate(p.x, p.y, cx, cy, angle));
}

// 要素の外接矩形(scene座標)。線・矢印(三角形含む)は element.x/y が bbox 左上でない
// （points[0]基準）ため、points から実際の範囲を求める。回転は無視した非回転bbox。
export function elementBBox(el: El): { x: number; y: number; w: number; h: number } {
  if (isLinearEl(el) && Array.isArray(el.points) && el.points.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of el.points) {
      const x = el.x + p[0], y = el.y + p[1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  return { x: el.x, y: el.y, w: el.width ?? 0, h: el.height ?? 0 };
}

// 線分 a-b 上で点 p に最も近い点
function nearestOnSeg(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// 折れ線(pts)上で点 p に最も近い点。三角形の辺への“貼り付け”に使う。
export function nearestPointOnPolyline(p: Pt, pts: Pt[]): Pt {
  if (pts.length === 0) return p;
  let best = pts[0], bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const q = nearestOnSeg(p, pts[i], pts[i + 1]);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < bestD) { bestD = d; best = q; }
  }
  return best;
}

export interface SnapResult {
  dx: number; // 適用すべき水平補正（縦ガイドに揃える）
  dy: number; // 適用すべき垂直補正（横ガイドに揃える）
  vLine?: { x: number; y0: number; y1: number }; // 縦ガイド（scene）
  hLine?: { y: number; x0: number; x1: number }; // 横ガイド（scene）
  marks: Pt[]; // 揃った点（マーカー描画用、補正適用後の位置）
}

// ドラッグ中の端点群 dragPts を anchors に揃える最小補正を、x/y 独立に求める。
// threshold は scene 単位（= 画面px / zoom）。
export function solveSnap(dragPts: Pt[], anchors: Pt[], threshold: number): SnapResult {
  let bestX = Infinity, dx = 0, vx = 0; let vDrag: Pt | null = null, vAnchor: Pt | null = null;
  let bestY = Infinity, dy = 0, hy = 0; let hDrag: Pt | null = null, hAnchor: Pt | null = null;

  for (const d of dragPts) {
    for (const a of anchors) {
      const adx = Math.abs(a.x - d.x);
      if (adx < bestX) { bestX = adx; dx = a.x - d.x; vx = a.x; vDrag = d; vAnchor = a; }
      const ady = Math.abs(a.y - d.y);
      if (ady < bestY) { bestY = ady; dy = a.y - d.y; hy = a.y; hDrag = d; hAnchor = a; }
    }
  }

  const res: SnapResult = {
    dx: bestX <= threshold ? dx : 0,
    dy: bestY <= threshold ? dy : 0,
    marks: [],
  };

  if (bestX <= threshold && vDrag && vAnchor) {
    const ys = [vDrag.y + res.dy, vAnchor.y]; // 補正適用後の y で線を張る
    res.vLine = { x: vx, y0: Math.min(...ys), y1: Math.max(...ys) };
    res.marks.push({ x: vx, y: vDrag.y + res.dy }, { x: vx, y: vAnchor.y });
  }
  if (bestY <= threshold && hDrag && hAnchor) {
    const xs = [hDrag.x + res.dx, hAnchor.x];
    res.hLine = { y: hy, x0: Math.min(...xs), x1: Math.max(...xs) };
    res.marks.push({ x: hDrag.x + res.dx, y: hy }, { x: hAnchor.x, y: hy });
  }
  return res;
}
