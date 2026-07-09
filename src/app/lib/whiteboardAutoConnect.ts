// 線・矢印を図形（四角/ひし形/楕円/三角形）に「コネクト」する仕組み（ENHA2-022）。
// 全図形を自前方式に統一：接続を customData(triStart/triEnd) に「外周上の相対位置(fx,fy)」として記録し、
// followTriangleConnections が図形の移動/リサイズ/回転に合わせて端点を“固定して追従”させる。
// （Excalidrawネイティブbindは接続位置を固定できず戻ってしまうため使わず、接続端点のbindは無効化する。）
import { elementBBox, isTriangle, nearestPointOnPolyline } from "./whiteboardSnap";

interface Pt { x: number; y: number }
// 三角形への接続アンカー：三角形bbox内での相対位置(fx,fy ∈ [0,1])。
// 三角形の移動・リサイズ後も「同じ相対位置＝同じ辺上の点」に端点を貼り直す。
interface TriAnchor { id: string; fx: number; fy: number }

export const CONNECT_TOL = 22; // 端点がこの距離以内に図形があれば接続対象（ネイティブbind相当の広さ）
const TOL = CONNECT_TOL;

// 接続元になり得る線形要素（三角形は図形扱いなので除外）。
// mermaid から生成した矢印・線(customData.wbMermaid)は、図のレイアウトを崩さないよう自動接続の対象外にする。
const isConnector = (e: any) => (e?.type === "line" || e?.type === "arrow") && !isTriangle(e) && !e?.customData?.wbMermaid;
// 接続先になれる図形（四角/ひし形/楕円/三角形/テキストボックス）。全て「辺上の相対位置を固定」する自前方式でつなぐ。
// テキストボックスは矩形外周として扱い、四辺（上下左右）どこにでも端点を貼り付けられる（BRU5-054）。
// 図形内に埋め込まれたラベルテキスト(containerId あり)は、コンテナ図形側が接続対象なので除外する。
export const isConnectableShape = (e: any) =>
  !e?.isDeleted && (e?.type === "rectangle" || e?.type === "diamond" || e?.type === "ellipse"
    || (e?.type === "text" && !e?.containerId) || isTriangle(e));
const rand = () => Math.floor(Math.random() * 0x7fffffff);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// テキストボックスの枠線は文字bboxの外側 TEXT_BORDER_PAD(scene単位) に描かれる（TextBoxDecorLayer と一致）。
// 枠線付きテキストへ接続する時は、この枠線ちょうどに端点を貼り付けたいので接続用bboxを外側へ広げる。
// （枠線なしのテキストや他図形は素の外接矩形のまま。）
export const TEXT_BORDER_PAD = 6;
const hasTextBorder = (e: any) => e?.type === "text" && !!e?.customData?.wbTextBox?.border;
// 接続の吸着・追従・当たり判定に使う矩形。枠線付きテキストだけ枠線位置まで広げる。
const connectBBox = (el: any): { x: number; y: number; w: number; h: number } => {
  const b = elementBBox(el);
  if (!hasTextBorder(el)) return b;
  return { x: b.x - TEXT_BORDER_PAD, y: b.y - TEXT_BORDER_PAD, w: b.w + TEXT_BORDER_PAD * 2, h: b.h + TEXT_BORDER_PAD * 2 };
};

// 図形の geometry 署名（移動/リサイズ/回転の検知用）
const shapeSig = (t: any): string => { const b = elementBBox(t); return `${b.x},${b.y},${b.w},${b.h},${t.angle || 0}`; };

// 点 p から矩形 b までの距離（内側なら0）
const distToBox = (p: Pt, b: { x: number; y: number; w: number; h: number }) => {
  const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.w));
  const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.h));
  return Math.hypot(dx, dy);
};

/**
 * 三角形の“点編集”を無効化する（BRU4-051 の根本対策）。
 *
 * 三角形は塗りを出すために頂点(上・中央)を先頭点＝末尾点として二重に持つ4点の閉じた line。
 * Excalidraw 標準の点編集で頂点をドラッグすると二重の点の片方だけが動き、
 * テッペンが二股（台形）に割れてしまう。三角形は「図形」として扱いたいので、
 * 点編集UI（selectedLinearElement / editingLinearElement）が三角形に付いたら即座に外す。
 * バウンディングボックス（リサイズハンドル）は points.length>2 の間は残るため、
 * 移動・リサイズは従来どおり可能。
 */
export function suppressTrianglePointEditing(api: any, elements: readonly any[], appState: any): void {
  const selId = appState?.selectedLinearElement?.elementId;
  const editId = appState?.editingLinearElement?.elementId;
  if (!selId && !editId) return;
  const isTriId = (id: string | undefined) => !!id && isTriangle(elements.find((e) => e.id === id));
  const patch: any = {};
  if (isTriId(selId)) patch.selectedLinearElement = null;
  if (isTriId(editId)) patch.editingLinearElement = null;
  if (patch.selectedLinearElement === undefined && patch.editingLinearElement === undefined) return;
  api.updateScene({ appState: patch });
}

/**
 * 三角形（閉じた line）の“塗りが透明になってしまう”バグの修復（BRU4-051）。
 *
 * 三角形は内部的に頂点(上・中央)を先頭点と末尾点として二重に持つ「閉じた折れ線」で、
 * Excalidraw はこの先頭点≈末尾点（isPathALoop）が成立している間だけ塗りを描く。
 * 標準の点編集（緑の＋ハンドル等）で頂点をドラッグするとループが開き、
 * 塗りが描かれず＝透明に見えてしまう（リサイズ自体ではループは開かないことを検証済み）。
 *
 * ここではループが開いた三角形を検出し、現在の頂点群の外接矩形から
 * “きれいな三角形”へ作り直してループを閉じ直す（位置・大きさは維持）。
 * 操作中（選択/点編集/描画中）は触らず、解除後のフレームで修復する。
 * @returns updateScene で反映したら true
 */
export function repairOpenTriangles(api: any, elements: readonly any[], appState: any): boolean {
  const selected = appState?.selectedElementIds ?? {};
  const editId = appState?.editingLinearElement?.elementId;
  const newId = appState?.newElement?.id;
  const CLOSE_TOL = 1; // 頂点(先頭/末尾)のズレがこの距離を超えたら「ループが開いた」とみなす
  let changed = false;
  const fixed = elements.map((el) => {
    if (el.isDeleted || !isTriangle(el)) return el;
    if (selected[el.id] || el.id === editId || el.id === newId) return el; // 操作中は触らない
    const pts = el.points;
    if (!Array.isArray(pts) || pts.length < 3) return el;
    const p0 = pts[0], pL = pts[pts.length - 1];
    if (Math.hypot(p0[0] - pL[0], p0[1] - pL[1]) <= CLOSE_TOL) return el; // 閉じている＝正常

    // 現在の頂点群の外接矩形(scene座標)から、頂点(上・中央)を原点にした正しい三角形へ作り直す
    const xs = pts.map((p: number[]) => el.x + p[0]);
    const ys = pts.map((p: number[]) => el.y + p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = maxX - minX, h = maxY - minY;
    if (w < 1 || h < 1) return el; // 潰れすぎ：作り直せないので触らない
    changed = true;
    return {
      ...el,
      x: minX + w / 2, y: minY, // element.x=頂点(上・中央), element.y=上端
      points: [[0, 0], [w / 2, h], [-w / 2, h], [0, 0]],
      width: w, height: h,
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: fixed });
  return true;
}

// 図形の外周ポリライン(scene座標, 非回転bbox基準)。端点の射影・ハイライト描画に使う。
export const shapeOutline = (el: any): Pt[] => {
  if (isTriangle(el)) return (Array.isArray(el.points) ? el.points : []).map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
  const b = connectBBox(el); // 枠線付きテキストは枠線位置の矩形で外周を作る
  const { x, y, w, h } = b;
  if (el.type === "diamond") return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }, { x: x + w / 2, y }];
  if (el.type === "ellipse") {
    const cx = x + w / 2, cy = y + h / 2, pts: Pt[] = [];
    for (let i = 0; i <= 32; i++) { const t = (i / 32) * 2 * Math.PI; pts.push({ x: cx + (w / 2) * Math.cos(t), y: cy + (h / 2) * Math.sin(t) }); }
    return pts;
  }
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }]; // rectangle
};

// 点 p から図形の外周（実際の辺）までの距離。ターゲット選定のスコアに使う。
const distToOutline = (p: Pt, shape: any): number => {
  const q = nearestPointOnPolyline(p, shapeOutline(shape));
  return Math.hypot(q.x - p.x, q.y - p.y);
};

/**
 * 端点 pt に対する「最良の接続先」を1つ返す（無ければ null）。密集・積層した図形の中でも
 * 狙った1つへ確実に繋ぐための統一ロジック（BRU5-061）。従来の shapes.find()（＝最初の一致＝最背面）
 * を置き換え、自動接続・追従の再アンカー・ハイライトの全箇所でこれを使って挙動を一致させる。
 *
 * 選定規則:
 *  1. connectBBox から TOL 以内の図形を候補にする。
 *  2. pt を内包する図形があれば、それらだけを対象にする（セルの中に端点を落としたらそのセルへ）。
 *     内包群は「面積が小さい順（積層/入れ子の最小セル）→ 前面(z-order)」で最良を選ぶ。
 *  3. 内包が無ければ「外周までの距離が近い順 → 前面」で最良を選ぶ。
 *
 * shapes は z-order 昇順（配列後方＝前面）を前提とする。同点は配列後方＝前面を優先する。
 */
export function pickConnectTarget(pt: Pt, shapes: readonly any[]): any | null {
  const containing: any[] = [];
  const near: any[] = [];
  for (const s of shapes) {
    const b = connectBBox(s);
    if (distToBox(pt, b) > TOL) continue;
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) containing.push(s);
    else near.push(s);
  }
  if (containing.length) {
    // 面積最小＝最も内側の小さいセル。同点(<=)は配列後方＝前面を採用。
    const area = (s: any) => { const b = connectBBox(s); return b.w * b.h; };
    return containing.reduce((best, s) => (area(s) <= area(best) ? s : best));
  }
  if (near.length) {
    // 外周まで最短。同点(<=)は配列後方＝前面を採用。
    return near.reduce((best, s) => (distToOutline(pt, s) <= distToOutline(pt, best) ? s : best));
  }
  return null;
}

// 端点を図形の外周へ射影し、bbox相対アンカー(fx,fy)と、貼り付け先の外周上の点を返す
const connectTo = (pt: Pt, shape: any): { anchor: TriAnchor; point: Pt } => {
  const proj = nearestPointOnPolyline(pt, shapeOutline(shape));
  const b = connectBBox(shape);
  return {
    anchor: { id: shape.id, fx: b.w ? clamp01((proj.x - b.x) / b.w) : 0.5, fy: b.h ? clamp01((proj.y - b.y) / b.h) : 0.5 },
    point: proj,
  };
};

// 旧形式(文字列id)も許容してアンカーを読む
const readAnchor = (v: any): TriAnchor | null => {
  if (!v) return null;
  if (typeof v === "string") return { id: v, fx: 0.5, fy: 0.5 };
  return { id: v.id, fx: v.fx ?? 0.5, fy: v.fy ?? 0.5 };
};

// アンカー(相対位置)＋三角形の現在geometry から、貼り付け先の端点(scene座標)を求める
const anchorToPoint = (a: TriAnchor, tri: any): Pt => {
  const b = connectBBox(tri);
  let x = b.x + a.fx * b.w, y = b.y + a.fy * b.h;
  if (tri.angle) { // bbox中心まわりに回転
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, s = Math.sin(tri.angle), c = Math.cos(tri.angle);
    const dx = x - cx, dy = y - cy; x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
  }
  return { x, y };
};

/**
 * 描画された線・矢印の端点が図形（四角/ひし形/楕円/三角形）に近ければ接続する。
 * 接続は customData(triStart/triEnd) に「外周上の相対位置」として記録し、followShapeConnections が固定・追従する。
 * @returns updateScene で反映を行ったら true（呼び出し側で追従処理の二重実行を避けるのに使う）
 */
export function autoConnectLines(
  api: any,
  elements: readonly any[],
  appState: any,
  processed: Set<string>,
): boolean {
  const drawingId = appState?.newElement?.id ?? appState?.editingLinearElement?.elementId;
  const shapes = elements.filter(isConnectableShape);
  if (shapes.length === 0) return false;

  let changed = false;
  const converted = elements.map((el) => {
    if (!isConnector(el) || el.isDeleted) return el;
    if (el.id === drawingId) return el;          // まだ描画中
    if (processed.has(el.id)) return el;          // 処理済み
    if (!Array.isArray(el.points) || el.points.length < 2) return el;

    const p0 = el.points[0];
    const pN = el.points[el.points.length - 1];
    const startPt = { x: el.x + p0[0], y: el.y + p0[1] };
    const endPt = { x: el.x + pN[0], y: el.y + pN[1] };

    const sShape = pickConnectTarget(startPt, shapes);
    const eShape = pickConnectTarget(endPt, shapes);
    // どこにも近くない → まだ処理済みにしない（後で図形へ近づいた時に接続できるよう毎フレーム再判定）
    if (!sShape && !eShape) return el;

    processed.add(el.id); // 実際に接続する時だけ処理済みにする
    changed = true;

    const customData = { ...(el.customData ?? {}) };
    const sC = sShape ? connectTo(startPt, sShape) : null;
    const eC = eShape ? connectTo(endPt, eShape) : null;
    if (sC) customData.triStart = sC.anchor;
    if (eC) customData.triEnd = eC.anchor;

    // 端点を外周の点へ吸着させる（接続直後から辺にピタッと付く）
    const gp = el.points.map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
    if (sC) gp[0] = sC.point;
    if (eC) gp[gp.length - 1] = eC.point;
    const ox = gp[0].x, oy = gp[0].y;
    const np = gp.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);

    return {
      ...el,
      x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      customData,
      // 自前方式に一本化するため、接続した端点のネイティブbindは無効化（競合防止）
      ...(sC ? { startBinding: null } : {}),
      ...(eC ? { endBinding: null } : {}),
      version: (el.version ?? 1) + 1,
      versionNonce: rand(),
    };
  });

  if (!changed) return false;
  api.updateScene({ elements: converted });
  return true;
}

/**
 * 接続された線・矢印の端点を、三角形の「記録した辺上の相対位置(アンカー)」へ毎フレーム合わせ直す。
 * 差分検知に頼らずステートレスに強制するため、三角形の移動・リサイズ・回転すべてに確実に追従する。
 * 実際に位置が変わった時だけ updateScene するので、静止時はループしない。
 *
 * 接続解除は「三角形が動いていないのに端点が三角形から離れている（＝ユーザーが線を動かした）」時だけ行う
 * （四角のネイティブbind解除と同じ体験）。三角形が動いたフレームでは必ず追従し、絶対に解除しない。
 * prevSig は前フレームの三角形geometry署名（呼び出し側で保持）。
 * @param active false（リモート反映中／autoConnect反映直後）のときは追従/解除しない（二重適用防止）
 * @returns updateScene で反映を行ったら true
 */
export function followTriangleConnections(
  api: any,
  elements: readonly any[],
  appState: any,
  prevSig: Map<string, string>,
  active: boolean,
): boolean {
  const shapeMap = new Map<string, any>();
  const curSig = new Map<string, string>();
  const shapeArr: any[] = []; // z-order昇順（再アンカー時のターゲット選定用・BRU5-061）
  for (const t of elements) if (isConnectableShape(t)) { shapeMap.set(t.id, t); curSig.set(t.id, shapeSig(t)); shapeArr.push(t); }

  // このフレームで geometry が変わった図形（移動/リサイズ/回転）
  const movedShape = new Set<string>();
  for (const [id, sig] of curSig) { const p = prevSig.get(id); if (p !== undefined && p !== sig) movedShape.add(id); }
  const finish = () => { prevSig.clear(); for (const [id, sig] of curSig) prevSig.set(id, sig); };
  if (!active || shapeMap.size === 0) { finish(); return false; }

  const selected = appState?.selectedElementIds ?? {};
  const editId = appState?.editingLinearElement?.elementId;
  const newId = appState?.newElement?.id;
  const EPS = 0.01;
  let did = false;
  const moved = elements.map((el) => {
    if (el.isDeleted || isConnectableShape(el)) return el;
    if (!(el.type === "line" || el.type === "arrow")) return el;
    // 線自体をドラッグ/編集/描画中は触らない（操作の邪魔をしない）
    if (selected[el.id] || el.id === editId || el.id === newId) return el;
    const cd = el.customData;
    if (!cd) return el;
    const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
    const sShape = aS ? shapeMap.get(aS.id) : undefined;
    const eShape = aE ? shapeMap.get(aE.id) : undefined;
    if (!sShape && !eShape) return el;
    if (!Array.isArray(el.points) || el.points.length < 2) return el;

    const gp = el.points.map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
    const L = gp.length - 1;
    const REANCHOR = 1.5; // 端点がアンカー位置からこれ以上ズレていたら「ユーザーが接続位置を変更した」とみなす
    let touched = false, dropStart = false, dropEnd = false;
    let reStart: TriAnchor | null = null, reEnd: TriAnchor | null = null;

    // 挙動:
    //  ・三角形が動いたフレーム → 記録済みアンカーへ端点を追従させる
    //  ・三角形は静止 & 端点が遠い       → ユーザーが線を離した → 接続解除
    //  ・三角形は静止 & 端点が近いがズレた → ユーザーが接続位置を変えた → アンカーを記憶し直す
    if (sShape) {
      if (movedShape.has(aS!.id)) {
        const tp = anchorToPoint(aS!, sShape);
        if (Math.hypot(tp.x - gp[0].x, tp.y - gp[0].y) > EPS) { gp[0] = tp; touched = true; }
      } else if (distToBox(gp[0], connectBBox(sShape)) > TOL) {
        dropStart = true;
      } else {
        const tp = anchorToPoint(aS!, sShape);
        if (Math.hypot(tp.x - gp[0].x, tp.y - gp[0].y) > REANCHOR) {
          // 端点が近接する別セルへズレた場合はそちらへ乗り換える（密集セルの繋ぎ替え・BRU5-061）
          const re = connectTo(gp[0], pickConnectTarget(gp[0], shapeArr) ?? sShape); gp[0] = re.point; reStart = re.anchor; touched = true;
        }
      }
    }
    if (eShape) {
      if (movedShape.has(aE!.id)) {
        const tp = anchorToPoint(aE!, eShape);
        if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > EPS) { gp[L] = tp; touched = true; }
      } else if (distToBox(gp[L], connectBBox(eShape)) > TOL) {
        dropEnd = true;
      } else {
        const tp = anchorToPoint(aE!, eShape);
        if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > REANCHOR) {
          // 端点が近接する別セルへズレた場合はそちらへ乗り換える（密集セルの繋ぎ替え・BRU5-061）
          const re = connectTo(gp[L], pickConnectTarget(gp[L], shapeArr) ?? eShape); gp[L] = re.point; reEnd = re.anchor; touched = true;
        }
      }
    }
    if (!touched && !dropStart && !dropEnd) return el;

    let customData = cd;
    if (dropStart || dropEnd || reStart || reEnd) {
      customData = { ...cd };
      if (dropStart) delete customData.triStart;
      if (dropEnd) delete customData.triEnd;
      if (reStart) customData.triStart = reStart;
      if (reEnd) customData.triEnd = reEnd;
    }
    const ox = gp[0].x, oy = gp[0].y;
    const np = gp.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
    did = true;
    return {
      ...el, x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      customData,
      // 接続端点のネイティブbindは無効化（自前方式に一本化）
      ...(customData.triStart ? { startBinding: null } : {}),
      ...(customData.triEnd ? { endBinding: null } : {}),
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  finish();
  if (!did) return false;
  api.updateScene({ elements: moved });
  return true;
}

/**
 * ドラッグ確定時に、一緒に運ばれたコネクタ（線・矢印）の接続端点をアンカー図形へ貼り直す（BRU5-061）。
 *
 * followTriangleConnections は選択中のコネクタを追従対象から外すため、図形＋矢印をまとめて
 * ドラッグすると、矢印全体が平行移動して「ドラッグに含めなかった静止図形側の端点」が図形から
 * 浮いたまま固定されてしまう（＝離した後にコネクトがズレる）。ドラッグ確定フレームで一度だけ、
 * ドラッグ選択に含まれていたコネクタの triStart/triEnd を、各アンカー図形の現在の記録位置へ
 * 再接着して両端の接続を保つ。
 *
 * 端点編集(editingLinearElement)中のコネクタは対象外＝端点を意図的に動かした操作は壊さない。
 * 選択に含まれないコネクタは通常の follow（解除/再アンカー）に委ねる。
 *
 * @returns updateScene で反映したら true
 */
export function reconnectDraggedConnectors(api: any, appState: any): boolean {
  const sel = appState?.selectedElementIds ?? {};
  const editId = appState?.editingLinearElement?.elementId;
  const elements = api.getSceneElements();
  const shapeMap = new Map<string, any>();
  for (const e of elements) if (isConnectableShape(e)) shapeMap.set(e.id, e);
  if (shapeMap.size === 0) return false;

  const EPS = 0.01;
  let changed = false;
  const updated = elements.map((el: any) => {
    if (el.isDeleted) return el;
    if (!(el.type === "line" || el.type === "arrow") || isTriangle(el)) return el;
    if (!sel[el.id] || el.id === editId) return el; // ドラッグされたコネクタのみ（端点編集は除外）
    const cd = el.customData;
    if (!cd) return el;
    const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
    const sShape = aS ? shapeMap.get(aS.id) : undefined;
    const eShape = aE ? shapeMap.get(aE.id) : undefined;
    if (!sShape && !eShape) return el;
    if (!Array.isArray(el.points) || el.points.length < 2) return el;

    const gp = el.points.map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
    const L = gp.length - 1;
    let touched = false;
    if (sShape) { const tp = anchorToPoint(aS!, sShape); if (Math.hypot(tp.x - gp[0].x, tp.y - gp[0].y) > EPS) { gp[0] = tp; touched = true; } }
    if (eShape) { const tp = anchorToPoint(aE!, eShape); if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > EPS) { gp[L] = tp; touched = true; } }
    if (!touched) return el;

    const ox = gp[0].x, oy = gp[0].y;
    const np = gp.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
    changed = true;
    return {
      ...el, x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      ...(cd.triStart ? { startBinding: null } : {}),
      ...(cd.triEnd ? { endBinding: null } : {}),
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: updated });
  return true;
}
