// 大括弧（波括弧）図形（BRU9-042）。Excalidraw に括弧のプリミティブは無いため、三角形
// （TriangleToolButton）と同じ「line 要素 ＋ customData の印 ＝ 図形として扱う」方式で作る。
//
// 【形】4本の四分楕円弧＋2本の縦棒で構成する。3つの先端（トゲ・両端）では接線が水平、弧と縦棒の
// 継ぎ目では接線が垂直になるので、継ぎ目は折れ目なく繋がり、中央は上下の弧が水平な接線で向きを
// 反転して出会う＝尖ったトゲになる。縦棒は外接矩形の横中央に立ち、トゲは外接矩形の一辺に、
// 両端はその対辺に必ず届く（＝外接矩形をぴったり埋める）。これにより「先端の位置＝外接矩形の
// 相対位置」が常に一定になり、下の braceAnchorFracs と自前コネクトのアンカー(fx,fy)が一致する。
//
// 【リサイズ】Excalidraw は線形要素をリサイズすると点列をそのまま拡大縮小するため、縦に伸ばすと
// 弧まで縦に引き伸ばされて括弧に見えなくなる。normalizeBraces が外接矩形から点列を作り直し、
// どんな大きさでも弧の形を保つ（三角形の repairOpenTriangles と同じ「確定後に整える」方針）。
//
// 【トゲの位置】高さに対する割合 tip(0..1) として customData に持つ。BraceTipHandle のつまみで
// 動かす。反転・リサイズでも壊れないよう、向きと同じく点列からも読み直せるようにしてある。
//
// 【接続】接続は自前方式（customData.triStart/triEnd に外接矩形相対のアンカーを記録）に乗るので、
// 移動・リサイズ・回転への追従は followTriangleConnections がそのまま面倒を見る。括弧は
// 「3つの先端」だけを接続点にする（whiteboardAutoConnect の connectTo が下の関数を使う）。
import { elementBBox, isBrace, type Pt } from "./whiteboardSnap";

// トゲ（中央の尖り）が向く方向。既定は画像どおりの `{`（トゲが左）。
// 他の向きは Excalidraw 標準の回転ハンドルでも作れるが、点列を作り直す時に元の向きが必要なので保持する。
export type BraceDir = "left" | "right" | "up" | "down";

const ARC_SAMPLES = 10; // 四分弧あたりの分割数。10 なら 1辺 9度でズームしても角が見えない
const HALF = Math.PI / 2;
const EPS = 0.05;       // 点列のズレがこれ未満なら作り直さない（毎tick updateScene するのを防ぐ）

// トゲ位置の可動範囲。端に寄せすぎると狭い側の弧が入る余地を失って継ぎ目が角ばるので、
// 形が保てる範囲で止める（既定比率 1:4 の括弧なら 0.15 でも弧は滑らかなまま）。
export const TIP_MIN = 0.15;
export const TIP_MAX = 0.85;

const clampTip = (v: any): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(TIP_MIN, Math.min(TIP_MAX, v)) : 0.5;

export const braceDir = (el: any): BraceDir => {
  const d = el?.customData?.wbBrace?.dir;
  return d === "right" || d === "up" || d === "down" ? d : "left";
};
/** トゲの位置（括弧が伸びる方向の 0..1）。既定は中央。 */
export const braceTip = (el: any): number => clampTip(el?.customData?.wbBrace?.tip);
/** 括弧が縦に伸びるか（トゲが左右を向いている＝ `{` `}`） */
export const isVerticalBrace = (dir: BraceDir) => dir === "left" || dir === "right";

// トゲが左を向く `{` の点列。外接矩形 (0,0)-(w,h) の座標系で、上端 → 下端の順に返す。
//
// 弧の「接線が垂直になる端」＝楕円の左右の端(中心±rx)を縦棒側に、「接線が水平になる端」＝
// 楕円の上下の端(中心±ry)を先端側に置くのが要点。これを逆にすると縦棒との継ぎ目が直角になり、
// トゲも尖らず丸いコブになる（＝括弧に見えない）。中心の位置は上下の弧が縦棒の左（トゲ側）、
// 両端の弧が縦棒の右（開く側）。
function leftBracePoints(w: number, h: number, tip: number): number[][] {
  const rx = w / 2;        // 弧の横半径。トゲは左端(x=0)、両端は右端(x=w)に届く
  const ty = h * tip;      // トゲのy
  // 弧の縦半径。縦長のうちは w/2（＝真円の弧）だが、幅を広げても h/8 で止める。
  // 上限が無いと（h/4 だと）弧4つで高さを食い尽くして縦棒が消え、括弧ではなく単なるS字カーブに
  // なってしまう（＝「サイズを変えたら別の形になる」）。h/8 なら縦棒が必ず高さの半分残る。
  //
  // トゲより上／下は独立に抑える（ty/2・(h-ty)/2）。トゲを端へ寄せた時に狭い側の弧だけが潰れ、
  // 広い側の弧はきれいな丸みを保つ。共通の半径にすると狭い側に引きずられて両方潰れてしまう。
  //
  // なお「幅が高さの7割」程度までは継ぎ目が滑らかに見えるが、それより極端に横長（高さの4倍幅など）に
  // したり、トゲを端いっぱいに寄せたりすると弧が潰れて縦棒との継ぎ目が角ばって見える。トゲを尖らせるには
  // 弧が縦棒との継ぎ目からトゲまでに90度向きを変える必要があり、その回転を消化する縦方向の余地が
  // 無くなるためで、形の作り方の問題ではなく「尖った括弧」に内在する限界。横に広い括弧が要るときは
  // 回転ハンドルで上向き/下向きにする。
  const cap = Math.min(w / 2, h / 8);
  const rUp = Math.min(cap, ty / 2);          // トゲより上の弧2本
  const rDn = Math.min(cap, (h - ty) / 2);    // トゲより下の弧2本
  // 中心(cx,cy)・縦半径 ry の楕円上を a0→a1 まで辿る。skipFirst は継ぎ目の重複点を落とすため。
  const arc = (cx: number, cy: number, ry: number, a0: number, a1: number, skipFirst = false): number[][] => {
    const out: number[][] = [];
    for (let i = skipFirst ? 1 : 0; i <= ARC_SAMPLES; i++) {
      const t = a0 + ((a1 - a0) * i) / ARC_SAMPLES;
      out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]);
    }
    return out;
  };
  return [
    ...arc(w, rUp, rUp, -HALF, -Math.PI),           // 上端(w,0) → 上の縦棒の頭(w/2,rUp)
    ...arc(0, ty - rUp, rUp, 0, HALF),              // 上の縦棒の足(w/2,ty-rUp) → トゲ(0,ty)
    ...arc(0, ty + rDn, rDn, -HALF, 0, true),       // トゲ → 下の縦棒の頭(w/2,ty+rDn)
    ...arc(w, h - rDn, rDn, Math.PI, HALF),         // 下の縦棒の足(w/2,h-rDn) → 下端(w,h)
  ];
}

/** 点列のうちトゲの添字（弧の分割数は固定なので中央の点がトゲになる）。 */
const tipIndexOf = (len: number) => (len - 1) / 2;

/** 外接矩形 w×h・向き dir・トゲ位置 tip の括弧の点列（外接矩形座標系）。 */
export function bracePoints(w: number, h: number, dir: BraceDir, tip = 0.5): number[][] {
  const t = clampTip(tip);
  if (dir === "left") return leftBracePoints(w, h, t);
  if (dir === "right") return leftBracePoints(w, h, t).map(([x, y]) => [w - x, y]);
  // 上下向きは「縦横を入れ替えた空間」で作ってから転置する
  const p = leftBracePoints(h, w, t);
  return dir === "up" ? p.map(([x, y]) => [y, x]) : p.map(([x, y]) => [y, h - x]);
}

/**
 * 接続できる3つの先端（外接矩形に対する相対位置 fx,fy ∈ [0,1]）。トゲ → 一方の端 → 他方の端の順。
 * bracePoints が外接矩形をぴったり埋めるので、この相対位置は実際の先端と厳密に一致する。
 */
export function braceAnchorFracs(dir: BraceDir, tip = 0.5): { fx: number; fy: number }[] {
  const t = clampTip(tip);
  if (dir === "right") return [{ fx: 1, fy: t }, { fx: 0, fy: 0 }, { fx: 0, fy: 1 }];
  if (dir === "up") return [{ fx: t, fy: 0 }, { fx: 0, fy: 1 }, { fx: 1, fy: 1 }];
  if (dir === "down") return [{ fx: t, fy: 1 }, { fx: 0, fy: 0 }, { fx: 1, fy: 0 }];
  return [{ fx: 0, fy: t }, { fx: 1, fy: 0 }, { fx: 1, fy: 1 }]; // left（既定）
}

export interface BraceAnchor { fx: number; fy: number; x: number; y: number }

/**
 * 3つの先端の scene 座標（回転込み）。先頭がトゲ。
 * whiteboardAutoConnect の anchorToPoint と同じ式で求めるので、接続した瞬間の位置と
 * 以後の追従先が完全に一致する（＝繋いだ直後に端点がわずかに跳ねることがない）。
 */
export function braceAnchorPoints(el: any): BraceAnchor[] {
  const b = elementBBox(el);
  const a = el?.angle || 0, s = Math.sin(a), c = Math.cos(a);
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return braceAnchorFracs(braceDir(el), braceTip(el)).map(({ fx, fy }) => {
    const x = b.x + fx * b.w, y = b.y + fy * b.h;
    if (!a) return { fx, fy, x, y };
    const dx = x - cx, dy = y - cy;
    return { fx, fy, x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  });
}

/** 点 pt に最も近い先端。矢印・棒の端点をどの先端へ吸着させるかの判定に使う。 */
export function nearestBraceAnchor(pt: Pt, el: any): BraceAnchor {
  const d2 = (a: BraceAnchor) => (a.x - pt.x) ** 2 + (a.y - pt.y) ** 2;
  return braceAnchorPoints(el).reduce((best, a) => (d2(a) < d2(best) ? a : best));
}

/**
 * 点列から「今の向き」を読む（左右反転・上下反転への追従・BRU9-042）。
 *
 * Excalidraw の反転（Shift+H / Shift+V）は点列を鏡像にするだけで customData は書き換えない。
 * 記録した向きのまま作り直すと「反転しても元に戻る」ように見え、さらに接続点（先端）の位置が
 * 実際の形と食い違ってしまう。点列の中央の点がトゲ、両端が端。
 *
 * 軸（縦の括弧か横の括弧か）は「両端がどちらに並んでいるか」で判定する。トゲと両端の中点との
 * 位置関係で判定してはいけない: トゲを端に寄せる（tip≠0.5）とトゲが縦方向に大きくズレて、
 * 縦の括弧を上下向きと誤判定する（＝リサイズしただけで形が変わる）。
 */
function dirFromPoints(el: any, fallback: BraceDir): BraceDir {
  const pts: number[][] = Array.isArray(el?.points) ? el.points : [];
  if (pts.length < 3 || pts.length % 2 === 0) return fallback; // 想定外の点列は記録された向きを信じる
  const tip = pts[tipIndexOf(pts.length)];
  const a = pts[0], b = pts[pts.length - 1];
  // 両端は「括弧が伸びる方向」に並ぶ（`{` なら縦に、`⏞` なら横に）
  if (Math.abs(b[1] - a[1]) >= Math.abs(b[0] - a[0])) return tip[0] <= (a[0] + b[0]) / 2 ? "left" : "right";
  return tip[1] <= (a[1] + b[1]) / 2 ? "up" : "down";
}

/** 点列から「今のトゲ位置」を読む（反転・リサイズへの追従。理由は dirFromPoints と同じ）。 */
function tipFromPoints(el: any, dir: BraceDir, fallback: number): number {
  const pts: number[][] = Array.isArray(el?.points) ? el.points : [];
  if (pts.length < 3 || pts.length % 2 === 0) return fallback;
  const tip = pts[tipIndexOf(pts.length)];
  const ax = isVerticalBrace(dir) ? 1 : 0; // 括弧が伸びる方向の成分（縦なら y）
  const vals = pts.map((p) => p[ax]);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1) return fallback;
  return clampTip((tip[ax] - lo) / (hi - lo));
}

/**
 * 外接矩形・向き・トゲ位置から点列を作り直した要素を返す（既に一致していれば null）。
 * normalizeBraces（自動整形）と BraceTipHandle（つまみ操作）の両方から使う唯一の生成口。
 */
export function rebuiltBrace(el: any, dir: BraceDir, tip: number): any | null {
  const b = elementBBox(el);
  if (b.w < 1 || b.h < 1) return null; // 潰れすぎ：作り直せないので触らない
  const t = clampTip(tip);
  const raw = bracePoints(b.w, b.h, dir, t);
  // 線形要素は points[0] が [0,0] であることが Excalidraw の前提。x/y をずらして合わせる。
  const [ox, oy] = raw[0];
  const np = raw.map(([x, y]) => [x - ox, y - oy]);
  const nx = b.x + ox, ny = b.y + oy;
  const cur: number[][] = Array.isArray(el.points) ? el.points : [];
  const sameShape = cur.length === np.length
    && Math.abs(el.x - nx) < EPS && Math.abs(el.y - ny) < EPS
    && np.every((p, i) => Math.abs(p[0] - cur[i][0]) < EPS && Math.abs(p[1] - cur[i][1]) < EPS);
  // 反転では点列だけが鏡像になり「形は既に正しいが記録が古い」状態になるので、記録の一致も見る。
  const sameMeta = dir === braceDir(el) && Math.abs(t - braceTip(el)) < 1e-4;
  if (sameShape && sameMeta) return null;
  const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
  return {
    ...el,
    x: nx, y: ny, points: np,
    width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    customData: { ...(el.customData ?? {}), wbBrace: { ...(el.customData?.wbBrace ?? {}), dir, tip: t } },
    version: (el.version ?? 1) + 1, versionNonce: Math.floor(Math.random() * 0x7fffffff),
  };
}

/**
 * 括弧の点列を外接矩形から作り直す（リサイズで弧が歪むのを防ぐ・BRU9-042）。
 *
 * ドラッグ／リサイズ／回転の「最中」は触らない（Excalidraw 側の変形と綱引きになるため）。
 * 指を離したフレームで整えるので、選択が続いていても正しい形に戻る。
 * 形が既に一致している時は updateScene しないため、静止時にループしない。
 * @returns updateScene で反映したら true
 */
export function normalizeBraces(api: any, elements: readonly any[], appState: any): boolean {
  const selected = appState?.selectedElementIds ?? {};
  const editId = appState?.editingLinearElement?.elementId;
  const newId = appState?.newElement?.id;
  // 変形中の判定。この間は点列を書き換えず、確定後のフレームで作り直す。
  const transforming = !!(appState?.selectedElementsAreBeingDragged || appState?.isResizing
    || appState?.resizingElement || appState?.isRotating);
  let changed = false;
  const fixed = elements.map((el: any) => {
    if (el.isDeleted || !isBrace(el)) return el;
    if (el.id === newId || el.id === editId) return el;
    if (selected[el.id] && transforming) return el;
    // 向き・トゲ位置は「実際の点列」から読み直す（反転しても記録と食い違わない）
    const dir = dirFromPoints(el, braceDir(el));
    const patch = rebuiltBrace(el, dir, tipFromPoints(el, dir, braceTip(el)));
    if (!patch) return el;
    changed = true;
    return patch;
  });
  if (!changed) return false;
  api.updateScene({ elements: fixed });
  return true;
}

/**
 * トゲを動かした時、トゲに繋がっている線・矢印のアンカーも新しいトゲ位置へ移す（BRU9-042）。
 *
 * 接続は「外接矩形に対する相対位置(fx,fy)」で記録されているので、これをやらないと
 * トゲだけが動いて矢印は元の高さに取り残される。トゲのアンカーかどうかは
 * 「開く側でない座標」（`{` なら fx===0）で判別する＝両端のアンカーは反対側にあるので混ざらない。
 * @returns 書き換えた要素の配列（変更が無ければ null）
 */
export function retargetBraceTipAnchors(elements: readonly any[], braceId: string, dir: BraceDir, tip: number): any[] | null {
  const t = clampTip(tip);
  const vertical = isVerticalBrace(dir);
  const tipFrac = braceAnchorFracs(dir, t)[0];
  const moved = (a: any) => {
    if (!a || a.id !== braceId) return null;
    if (vertical ? a.fx !== tipFrac.fx : a.fy !== tipFrac.fy) return null;   // 両端のアンカー
    if (vertical ? a.fy === t : a.fx === t) return null;                     // 既に新しい位置
    return vertical ? { ...a, fy: t } : { ...a, fx: t };
  };
  let changed = false;
  const next = elements.map((el: any) => {
    const cd = el?.customData;
    if (el?.isDeleted || !cd) return el;
    const s = moved(cd.triStart), e = moved(cd.triEnd);
    if (!s && !e) return el;
    changed = true;
    return {
      ...el,
      customData: { ...cd, ...(s ? { triStart: s } : {}), ...(e ? { triEnd: e } : {}) },
      version: (el.version ?? 1) + 1, versionNonce: Math.floor(Math.random() * 0x7fffffff),
    };
  });
  return changed ? next : null;
}
