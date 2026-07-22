// 線・矢印を図形（四角/ひし形/楕円/三角形）に「コネクト」する仕組み（ENHA2-022）。
// 全図形を自前方式に統一：接続を customData(triStart/triEnd) に「外周上の相対位置(fx,fy)」として記録し、
// followTriangleConnections が図形の移動/リサイズ/回転に合わせて端点を“固定して追従”させる。
// （Excalidrawネイティブbindは接続位置を固定できず戻ってしまうため使わず、接続端点のbindは無効化する。）
import { elementBBox, isTriangle, nearestPointOnPolyline } from "./whiteboardSnap";

interface Pt { x: number; y: number }
// 三角形への接続アンカー：三角形bbox内での相対位置(fx,fy ∈ [0,1])。
// 三角形の移動・リサイズ後も「同じ相対位置＝同じ辺上の点」に端点を貼り直す。
interface TriAnchor { id: string; fx: number; fy: number }

export const CONNECT_TOL = 16; // 端点がこの距離以内に図形があれば接続対象。22より小さくして「引き寄せが強すぎ／
                               // 少し離しても解除されない」を緩和しつつ、繋がりやすさも確保（BRU5-064）。
const FOLD_FIND_TOL = 40;      // 折れ矢印だけは広めに探索（Shiftの角度スナップで端点がズレても両端を拾う）
const TOL = CONNECT_TOL;

// 接続元になり得る線形要素（三角形は図形扱いなので除外）。
// mermaid から生成した矢印・線(customData.wbMermaid)は、図のレイアウトを崩さないよう自動接続の対象外にする。
// Elbow arrow(elbowed)は Excalidraw のエルボー・ルーターが中間点を直交に保つため、
// 端点だけを書き換える自前コネクト方式とは相容れない（斜め/波打ちに崩れる・BRU5-050系）。
// elbow はネイティブ結合＋ルーターに任せ、自前の接続/追従の対象から外す。
const isConnector = (e: any) => (e?.type === "line" || e?.type === "arrow") && !e?.elbowed && !isTriangle(e) && !e?.customData?.wbMermaid;
// 接続先になれる図形（四角/ひし形/楕円/三角形/テキストボックス）。全て「辺上の相対位置を固定」する自前方式でつなぐ。
// テキストボックスは矩形外周として扱い、四辺（上下左右）どこにでも端点を貼り付けられる（BRU5-054）。
// 図形内に埋め込まれたラベルテキスト(containerId あり)は、コンテナ図形側が接続対象なので除外する。
export const isConnectableShape = (e: any) =>
  !e?.isDeleted && !e?.customData?.wbBgFor  // テキスト背景の影矩形(BRU5-062)は接続対象外
    && !e?.customData?.wbFrameBg            // フレーム装飾の影矩形(BRU5-063)も接続対象外
    && (e?.type === "rectangle" || e?.type === "diamond" || e?.type === "ellipse"
    || (e?.type === "text" && !e?.containerId) || isTriangle(e));
// 折れ線の角の既定（BRU5-078）。左メニュー「折れ線の角」で切り替え、以後に折る線へ引き継ぐ。
// Excalidraw の currentItemRoundness は四角形など図形の角丸とも共有される設定なので使わない
// （線の角を変えたら図形の角まで変わってしまうため）。折れ線専用の設定としてここに持つ。
export const foldCorner: { round: boolean } = { round: false }; // 既定＝角あり
const foldRoundness = () => (foldCorner.round ? { type: 2 } : null);

const rand = () => Math.floor(Math.random() * 0x7fffffff);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// テキストボックスの枠線は文字bboxの外側 TEXT_BORDER_PAD(scene単位) に描かれる（whiteboardTextBoxBg の影矩形と一致）。
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
export const shapeSig = (t: any): string => { const b = elementBBox(t); return `${b.x},${b.y},${b.w},${b.h},${t.angle || 0}`; };

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
// preferId: 既に繋がっている図形の id。候補に入っていればそれを優先する（安定化・BRU5-064）。
// これで Alt複製 等で「同じ位置に重なった新しい図形（＝最前面）」へ勝手に乗り換えるのを防ぐ。
// ただし端点を旧図形から離して別図形へ動かした場合は、旧図形は候補に入らないので通常どおり乗り換わる。
export function pickConnectTarget(pt: Pt, shapes: readonly any[], preferId?: string, tol: number = TOL): any | null {
  const containing: any[] = [];
  const near: any[] = [];
  for (const s of shapes) {
    const b = connectBBox(s);
    if (distToBox(pt, b) > tol) continue;
    if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) containing.push(s);
    else near.push(s);
  }
  if (containing.length) {
    if (preferId) { const p = containing.find((s) => s.id === preferId); if (p) return p; }
    // 面積最小＝最も内側の小さいセル。同点(<=)は配列後方＝前面を採用。
    const area = (s: any) => { const b = connectBBox(s); return b.w * b.h; };
    return containing.reduce((best, s) => (area(s) <= area(best) ? s : best));
  }
  if (near.length) {
    if (preferId) { const p = near.find((s) => s.id === preferId); if (p) return p; }
    // 外周まで最短。同点(<=)は配列後方＝前面を採用。
    return near.reduce((best, s) => (distToOutline(pt, s) <= distToOutline(pt, best) ? s : best));
  }
  return null;
}

// 端点を図形の接続点へ吸着させ、bbox相対アンカー(fx,fy)と貼り付け先の点を返す。
// 四角/ひし形/楕円/テキストボックスは「上下左右の4点(各辺の中点)」のみに接続する（BRU5-064）。
// これで接続位置がブレず、折れ矢印も辺の中央から出入りして綺麗に決まる。図形中心から端点への
// 向きで最寄りの1辺を選ぶ。三角形だけは辺の中点が外周上に無いため従来どおり外周へ射影する。
const connectTo = (pt: Pt, shape: any): { anchor: TriAnchor; point: Pt } => {
  const b = connectBBox(shape);
  if (isTriangle(shape)) {
    const proj = nearestPointOnPolyline(pt, shapeOutline(shape));
    return {
      anchor: { id: shape.id, fx: b.w ? clamp01((proj.x - b.x) / b.w) : 0.5, fy: b.h ? clamp01((proj.y - b.y) / b.h) : 0.5 },
      point: proj,
    };
  }
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const ndx = b.w ? (pt.x - cx) / (b.w / 2) : 0; // 中心からの正規化方向(-1..1)
  const ndy = b.h ? (pt.y - cy) / (b.h / 2) : 0;
  let fx: number, fy: number;
  if (Math.abs(ndx) >= Math.abs(ndy)) { fx = ndx >= 0 ? 1 : 0; fy = 0.5; } // 左右いずれかの辺の中点
  else { fx = 0.5; fy = ndy >= 0 ? 1 : 0; }                                // 上下いずれかの辺の中点
  return { anchor: { id: shape.id, fx, fy }, point: { x: b.x + fx * b.w, y: b.y + fy * b.h } };
};

// ── 折れ矢印（直交ルート）・BRU5-064 ──
// 4点アンカー(上下左右の中点)は外向きの向きが明確なので、その向きを使って S→E を直交線で結ぶ。
export type Side = "top" | "bottom" | "left" | "right";
const DIRV: Record<Side, Pt> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
// 4点アンカー(fx,fy∈{0,0.5,1})から辺(向き)を判定。三角形の連続アンカーには使わない。
const sideFromAnchor = (a: TriAnchor): Side => (a.fy === 0 ? "top" : a.fy === 1 ? "bottom" : a.fx === 1 ? "right" : "left");

const FOLD_STUB = 20; // 端点から辺の外向きへ一旦出す距離（辺の中央から真っ直ぐ出てから折れる）
// 直交ルート。両端から外向きへスタブを出し、Z字(平行な辺どうし)/L字(直交する辺)で結ぶ。
function routeOrthogonal(S: Pt, sS: Side, E: Pt, sE: Side): Pt[] {
  const dS = DIRV[sS], dE = DIRV[sE];
  const hS = sS === "left" || sS === "right";
  const hE = sE === "left" || sE === "right";

  // 平行な辺どうし(Z字)の折り返し座標を決める（BRU5-075）。
  // 単純に「スタブの先どうしの中点」を取ると、図形が近い時に折り返しがスタブより手前へ来てしまい、
  //「一度外へ出てから戻る」＝端点の外に短いヒゲが飛び出した変な線になる。
  //  ・向かい合う辺（例: 下面→上面）… 2図形の“間”の中点で1回だけ折る（スタブは使わない＝ヒゲ無し）
  //  ・同じ向きの辺（例: 下面→下面）… 両方のスタブの先まで出してから折る
  //  ・重なっていて間が無い場合    … スタブの先へ出してから回り込む（これ以上は詰められない）
  const foldAt = (s: number, e: number, ds: number, de: number): number => {
    if (ds * de < 0) {                       // 向かい合っている
      const gap = (e - s) * ds;              // 出ていく向きに測った“間”の距離
      if (gap > 0) return s + ds * (gap / 2);
      return s + ds * FOLD_STUB;             // 重なり: 外へ出るしかない
    }
    return ds >= 0                           // 同じ向き: 両方の先へ
      ? Math.max(s, e) + FOLD_STUB
      : Math.min(s, e) - FOLD_STUB;
  };

  if (hS && hE) {                                     // 横−横 → Z
    const mx = foldAt(S.x, E.x, dS.x, dE.x);
    return dedupeCollinear([S, { x: mx, y: S.y }, { x: mx, y: E.y }, E]);
  }
  if (!hS && !hE) {                                   // 縦−縦 → Z
    const my = foldAt(S.y, E.y, dS.y, dE.y);
    return dedupeCollinear([S, { x: S.x, y: my }, { x: E.x, y: my }, E]);
  }
  // 横−縦 / 縦−横 → L字。角は「始点の辺の向きに真っ直ぐ出た先」に置く（スタブ不要）
  const corner = hS ? { x: E.x, y: S.y } : { x: S.x, y: E.y };
  return dedupeCollinear([S, corner, E]);
}
// 図形に繋がっていない矢印の直交ルート（BRU5-069）。外向きの向きが決まらないので、
// 距離の長い軸で先に折る Z字（コの字）にする。elbow を選んだのに斜めのまま、を防ぐ。
export function routeFree(S: Pt, E: Pt): Pt[] {
  const dx = E.x - S.x, dy = E.y - S.y;
  const mid: Pt[] = Math.abs(dx) >= Math.abs(dy)
    ? [{ x: (S.x + E.x) / 2, y: S.y }, { x: (S.x + E.x) / 2, y: E.y }]  // 横長 → 横・縦・横
    : [{ x: S.x, y: (S.y + E.y) / 2 }, { x: E.x, y: (S.y + E.y) / 2 }]; // 縦長 → 縦・横・縦
  return dedupeCollinear([S, ...mid, E]);
}
// ── 手動の折れ点（経由点・BRU7-043）──
//
// 自動ルートだけでは「ここでもう1回折りたい」に応えられないので、ユーザーが好きな数だけ
// 経由点を打てるようにする。経由点は customData.wbVias に保存し、上の routeOrthogonal /
// routeFree を「必ずこの点を通る」チェーンへ拡張して経路を作る。
//
// 座標は【線の始点(S)からの相対オフセット】で持つ。絶対座標にすると
//   ・始点図形を動かす → 折れ点だけ置き去りになり経路が破綻する
//   ・Alt複製         → 複製側の折れ点が元の位置に残る
//   ・線ごと移動      → 折れ点が付いてこない
// のすべてで壊れる。S基準ならこの3つが自動的に正しくなる
// （終点図形だけを動かした時は折れ点が始点側に留まる＝意図どおり）。
export interface ViaOffset { dx: number; dy: number }

export const readVias = (cd: any): ViaOffset[] =>
  Array.isArray(cd?.wbVias)
    ? cd.wbVias
      .filter((v: any) => Number.isFinite(v?.dx) && Number.isFinite(v?.dy))
      .map((v: any) => ({ dx: v.dx, dy: v.dy }))
    : [];
/** 保存形式(始点相対) → scene座標 */
export const viasToScene = (cd: any, S: Pt): Pt[] => readVias(cd).map((v) => ({ x: S.x + v.dx, y: S.y + v.dy }));
/** scene座標 → 保存形式(始点相対) */
export const viasFromScene = (pts: readonly Pt[], S: Pt): ViaOffset[] => pts.map((p) => ({ dx: p.x - S.x, dy: p.y - S.y }));

type Axis = "h" | "v";
const perpAxis = (a: Axis): Axis => (a === "h" ? "v" : "h");
const axisOfSide = (s: Side): Axis => (s === "left" || s === "right" ? "h" : "v");

// 端点 P から辺の外向き d へ「最低限のスタブ」を出す必要があるか判定する。
// 隣の経由点が既に外側にあるなら不要（余計なヒゲ・オーバーシュートを作らない）。
// 経由点が辺の内側／同じ高さにある時だけ一旦外へ出してから折る（図形を突き抜けないため）。
const stubOut = (P: Pt, d: Pt, q: Pt): Pt | null => {
  const along = (q.x - P.x) * d.x + (q.y - P.y) * d.y; // 外向き成分
  if (along > 0.5) return null;
  return { x: P.x + d.x * FOLD_STUB, y: P.y + d.y * FOLD_STUB };
};

/**
 * 経由点つきの直交ルート（BRU7-043）。
 * S（辺 sS から外向きに出る）→ 各経由点を必ず通る → E（辺 sE へ外側から入る）。
 *
 * 各区間は「直前の進行軸をそのまま進んでから1回だけ直交に折る」L字で繋ぐ（Uターンを作らない）。
 * 一直線に並んだ経由点は dedupeCollinear が畳むので、直線区間に打った点は
 * 「その区間を平行移動する」操作として自然に働く。
 * 経由点が無い時は従来の routeOrthogonal と完全に同一の結果を返す（既存の折れ線は挙動不変）。
 */
export function routeOrthogonalVia(S: Pt, sS: Side, vias: readonly Pt[], E: Pt, sE: Side): Pt[] {
  if (vias.length === 0) return routeOrthogonal(S, sS, E, sE);
  const aE = axisOfSide(sE);
  const out: Pt[] = [S];
  let cur = S;
  let axis: Axis = axisOfSide(sS); // 現在の進行軸
  const A = stubOut(S, DIRV[sS], vias[0]);
  if (A) { out.push(A); cur = A; }
  const B = stubOut(E, DIRV[sE], vias[vias.length - 1]);
  // 折る向きの指定:
  //   B あり … B へは辺の軸と垂直に到達させる（B で辺の軸へ乗って E へ真っ直ぐ入る）→ f = aE
  //   B なし … 最後の直線が辺の軸(aE)になるよう垂直軸から折る            → f = perp(aE)
  const legs: { p: Pt; f?: Axis }[] = vias.map((p) => ({ p }));
  if (B) legs.push({ p: B, f: aE });
  legs.push({ p: E, f: perpAxis(aE) });
  for (const leg of legs) {
    const f = leg.f ?? axis;
    const q = leg.p;
    const corner = f === "h" ? { x: q.x, y: cur.y } : { x: cur.x, y: q.y };
    out.push(corner, q);
    const turned = f === "h" ? Math.abs(q.y - cur.y) > 0.5 : Math.abs(q.x - cur.x) > 0.5;
    axis = turned ? perpAxis(f) : f;
    cur = q;
  }
  return dedupeCollinear(out);
}

/** 図形に繋がっていない線の、経由点つき直交ルート（BRU7-043）。最初の折れ向きは長い軸から。 */
export function routeFreeVia(S: Pt, vias: readonly Pt[], E: Pt): Pt[] {
  if (vias.length === 0) return routeFree(S, E);
  const out: Pt[] = [S];
  let cur = S;
  let axis: Axis = Math.abs(vias[0].x - S.x) >= Math.abs(vias[0].y - S.y) ? "h" : "v";
  for (const q of [...vias, E]) {
    const corner = axis === "h" ? { x: q.x, y: cur.y } : { x: cur.x, y: q.y };
    out.push(corner, q);
    const turned = axis === "h" ? Math.abs(q.y - cur.y) > 0.5 : Math.abs(q.x - cur.x) > 0.5;
    if (turned) axis = perpAxis(axis);
    cur = q;
  }
  return dedupeCollinear(out);
}

// 重複点・一直線上の中間点を除去（余計な折れ目を作らない）。
function dedupeCollinear(pts: Pt[]): Pt[] {
  const uniq: Pt[] = [];
  for (const q of pts) { const l = uniq[uniq.length - 1]; if (!l || Math.hypot(l.x - q.x, l.y - q.y) > 0.5) uniq.push(q); }
  const out: Pt[] = [];
  for (let i = 0; i < uniq.length; i++) {
    if (i > 0 && i < uniq.length - 1) {
      const a = uniq[i - 1], b = uniq[i], c = uniq[i + 1];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const sameDir = (b.x - a.x) * (c.x - b.x) >= 0 && (b.y - a.y) * (c.y - b.y) >= 0;
      if (Math.abs(cross) < 0.5 && sameDir) continue; // 直線上の中間点は捨てる
    }
    out.push(uniq[i]);
  }
  return out.length >= 2 ? out : uniq;
}

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
 * コネクタの「現在の経路情報」を返す（折れ点オーバーレイの描画・編集用・BRU7-043）。
 *
 * 両端が図形の4点アンカーに繋がっていれば辺基準の直交ルート、そうでなければ端点基準の自由ルート。
 * 図形に繋がっていない折れ線は経路の正解が points しか無いので、初回だけ現在の中間点を
 * 経由点として引き継ぐ（＝手で整えた形を勝手に作り直さない）。
 */
export interface RouteInfo { S: Pt; E: Pt; sS: Side | null; sE: Side | null; vias: Pt[]; route: Pt[] }
export function foldedRouteInfo(el: any, elements: readonly any[]): RouteInfo | null {
  if (!el || el.isDeleted || !isConnector(el)) return null;
  const pts: number[][] = Array.isArray(el.points) ? el.points : [];
  if (pts.length < 2) return null;
  const cd = el.customData ?? {};
  const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
  const findShape = (id?: string) => (id ? elements.find((e) => e.id === id && isConnectableShape(e)) : undefined);
  const sShape = aS ? findShape(aS.id) : undefined;
  const eShape = aE ? findShape(aE.id) : undefined;
  const both = !!(aS && aE && sShape && eShape && !isTriangle(sShape) && !isTriangle(eShape));
  const S = both ? anchorToPoint(aS!, sShape) : { x: el.x + pts[0][0], y: el.y + pts[0][1] };
  const E = both ? anchorToPoint(aE!, eShape) : { x: el.x + pts[pts.length - 1][0], y: el.y + pts[pts.length - 1][1] };
  let vias = viasToScene(cd, S);
  if (!both && !Array.isArray(cd.wbVias) && pts.length > 2) {
    vias = pts.slice(1, -1).map((p) => ({ x: el.x + p[0], y: el.y + p[1] }));
  }
  const sS = both ? sideFromAnchor(aS!) : null;
  const sE = both ? sideFromAnchor(aE!) : null;
  const route = both ? routeOrthogonalVia(S, sS!, vias, E, sE!) : routeFreeVia(S, vias, E);
  return { S, E, sS, sE, vias, route };
}

/**
 * 折れ点（経由点）を書き換えてコネクタの経路を引き直す（BRU7-043）。
 *
 * @param viasScene 新しい経由点(scene座標)。空配列を渡すと折れ点をすべて消して自動ルートへ戻す。
 * @param prune 「外しても経路が1mmも変わらない」経由点を捨てる（重複点・意味を失った点の掃除）。
 *   ドラッグ中に捨てると掴んでいるつまみが消えるので、指を離したフレームだけ true にする。
 *   ※「経路の頂点に現れない点」は捨ててはいけない。直線区間に打った点は dedupeCollinear で
 *     頂点としては畳まれるが、その区間の位置を決めている（＝区間の平行移動）ので必須。
 * @returns updateScene で反映したら true
 */
export function applyConnectorVias(api: any, id: string, viasScene: readonly Pt[], prune = false): boolean {
  const elements = api.getSceneElements();
  const el = elements.find((e: any) => e.id === id);
  const info = el ? foldedRouteInfo(el, elements) : null;
  if (!info) return false;
  const build = (vs: readonly Pt[]) => (info.sS && info.sE
    ? routeOrthogonalVia(info.S, info.sS, vs, info.E, info.sE)
    : routeFreeVia(info.S, vs, info.E));
  const sameRoute = (a: Pt[], b: Pt[]) => a.length === b.length && a.every((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y) < 0.5);
  let route = build(viasScene);
  if (route.length < 2) return false;
  let kept: readonly Pt[] = viasScene;
  if (prune) {
    const keep = [...viasScene];
    for (let i = keep.length - 1; i >= 0; i--) {
      const base = build(keep);
      const without = keep.filter((_, j) => j !== i);
      if (sameRoute(build(without), base)) keep.splice(i, 1);
    }
    if (keep.length !== viasScene.length) { kept = keep; route = build(keep); }
  }
  const cd: any = { ...(el.customData ?? {}), wbFolded: true, wbVias: viasFromScene(kept, info.S) };
  if (kept.length === 0) delete cd.wbVias;
  const ox = route[0].x, oy = route[0].y;
  const np = route.map((p) => [p.x - ox, p.y - oy]);
  const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
  api.updateScene({
    elements: elements.map((e: any) => (e.id !== id ? e : {
      ...e,
      x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      customData: cd,
      // 自前方式に一本化（接続端点のネイティブbindは無効化）
      ...(cd.triStart ? { startBinding: null } : {}),
      ...(cd.triEnd ? { endBinding: null } : {}),
      version: (e.version ?? 1) + 1, versionNonce: rand(),
    })),
  });
  return true;
}

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
  foldIds?: Set<string>,
  foldAll?: boolean, // 折れ矢印トグルON: 新規接続した矢印/線を常にカギ型にする（id追跡に依存しない）
  pointerHint?: Pt | null, // 直近カーソル(scene)。Shift角度スナップで端点がズレた時の接続先ヒント
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

    // 折れ矢印(Shift/トグル)要求時は、両端を図形に繋ぎたい意図が明確なので探索半径を広げる。
    // これで Shift の角度スナップで端点が図形から少しズレても拾って、辺の中央へ吸着＆折れる（BRU5-064）。
    const wantFold = !!foldAll || (foldIds?.has(el.id) ?? false);
    const findTol = wantFold ? FOLD_FIND_TOL : TOL;
    const sShape = pickConnectTarget(startPt, shapes, undefined, findTol);
    let eShape = pickConnectTarget(endPt, shapes, undefined, findTol);
    // 折れ矢印で終端(離した側)が図形に届かない場合、実カーソル位置(pointerHint)で拾い直す。
    // Shiftの角度スナップで端点が図形からズレても、狙った図形へ繋いで折れるようにする（BRU5-064）。
    let endRef = endPt;
    if (wantFold && !eShape && pointerHint) {
      const s = pickConnectTarget(pointerHint, shapes, undefined, FOLD_FIND_TOL);
      if (s) { eShape = s; endRef = pointerHint; }
    }
    // どこにも近くない → まだ処理済みにしない（後で図形へ近づいた時に接続できるよう毎フレーム再判定）
    if (!sShape && !eShape) return el;

    processed.add(el.id); // 実際に接続する時だけ処理済みにする
    foldIds?.delete(el.id); // 接続処理に入った時点で折れ要求は消化（未接続で残り続けるのを防ぐ）
    changed = true;

    const customData = { ...(el.customData ?? {}) };
    const sC = sShape ? connectTo(startPt, sShape) : null;
    const eC = eShape ? connectTo(endRef, eShape) : null;
    if (sC) customData.triStart = sC.anchor;
    if (eC) customData.triEnd = eC.anchor;

    // 端点を外周の点へ吸着させる（接続直後から辺にピタッと付く）
    let gp = el.points.map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
    if (sC) gp[0] = sC.point;
    if (eC) gp[gp.length - 1] = eC.point;

    // 折れ矢印(Shift/トグル)要求: 両端が4点アンカー(=非三角形)に繋がった時だけ直交ルートへ差し替える。
    // 記録した triStart/triEnd と wbFolded を頼りに、追従時(followTriangleConnections)も再ルートする。
    let folded = false;
    if (wantFold && sC && eC && sShape && eShape && !isTriangle(sShape) && !isTriangle(eShape)) {
      // 手動の折れ点(wbVias)があれば必ず通す（BRU7-043）
      gp = routeOrthogonalVia(sC.point, sideFromAnchor(sC.anchor), viasToScene(customData, sC.point), eC.point, sideFromAnchor(eC.anchor));
      customData.wbFolded = true;
      folded = true;
    }

    const ox = gp[0].x, oy = gp[0].y;
    const np = gp.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);

    return {
      ...el,
      x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      customData,
      ...(folded ? { roundness: foldRoundness() } : {}), // 折れ線の角は専用設定（既定＝角あり）に従う
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
 * @param forceAnchor undo/redo 直後（BRU5-066）: 端点を必ず記録済みアンカーへ戻す。
 *   undo は線の点列だけを巻き戻すことがあり、図形は動いていない＝下の「静止＆端点がズレた」分岐に落ちて
 *   「ユーザーが接続位置を変えた／線を離した」と誤判定され、別の面に繋ぎ替わったり接続が解除されてしまう。
 *   undo 中は繋ぎ替え/解除を一切せず、記録どおりの接続へ復元する（折れ矢印も直交ルートを引き直す）。
 * @returns updateScene で反映を行ったら true
 */
export function followTriangleConnections(
  api: any,
  elements: readonly any[],
  appState: any,
  prevSig: Map<string, string>,
  active: boolean,
  foldAll?: boolean, // 折れ矢印トグルON: 両端接続済みの直線をこの追従パスで確実に折る（描画タイミング非依存）
  forceAnchor?: boolean,
  // 点編集中でも“この要素だけ”は評価する（BRU5-073）。
  // 端点をドラッグして別の図形へ繋ぎ直す操作は editingLinearElement 中に起きるが、
  // 追従処理は編集の邪魔をしないよう編集中の要素を丸ごと除外している。そのままだと
  // 「別の場所にコネクトしようとしても繋がらない」ので、指を離したフレームだけ解禁する。
  editApplyId?: string,
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
    if (!(el.type === "line" || el.type === "arrow") || el.elbowed) return el; // elbowはネイティブ結合に委ねる
    // 線自体をドラッグ/編集/描画中は触らない（操作の邪魔をしない）。
    // ただし undo/redo 直後は例外: undo は巻き戻した要素を選択状態で復元するため、選択中スキップのままだと
    // ズレた端点も折れ崩れも一切直らずに残ってしまう（BRU5-066）。
    const editApply = !!editApplyId && el.id === editApplyId; // 端点ドラッグを離したフレーム
    if (!editApply && ((selected[el.id] && !forceAnchor) || el.id === editId || el.id === newId)) return el;
    const cd = el.customData;
    if (!cd) return el;
    const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
    const sShape = aS ? shapeMap.get(aS.id) : undefined;
    const eShape = aE ? shapeMap.get(aE.id) : undefined;
    if (!sShape && !eShape) return el;
    if (!Array.isArray(el.points) || el.points.length < 2) return el;

    // 折れ矢印(BRU5-064): 両端が4点アンカー(非三角形)に固定されている連結は直交ルートに保つ。
    //  - 既に折れ(wbFolded): 毎フレーム経路を引き直して形を維持（端点だけ動かすと折れ目が崩れるため）
    //  - トグルON(foldAll): まだ折れていない直線もこの追従パスで確実に折る（描画タイミング非依存の保険）
    const bothConnected = !!(aS && aE && sShape && eShape && !isTriangle(sShape) && !isTriangle(eShape));
    // 折れ矢印“そのもの”をユーザーが掴んで図形から遠くへ動かした場合は、直交ルートを引き直して
    // 元位置へ戻してはいけない（動かせない／複製が元に重なる原因・BRU5-067）。
    // 図形が動いたフレーム、または端点がまだアンカー図形の近くにある時だけ経路を維持する。
    const p0 = { x: el.x + el.points[0][0], y: el.y + el.points[0][1] };
    const pL = { x: el.x + el.points[el.points.length - 1][0], y: el.y + el.points[el.points.length - 1][1] };
    const NEAR = 1.5; // 端点が「記録したアンカー位置のまま」とみなす許容量
    // 端点が記録アンカーから動かされていないか（＝ユーザーが接続面を変えていないか）。
    // これを見ないと「端点を同じ図形の別の面（左面→上面）へドラッグしても、記録済みの左面から
    // 経路を引き直して元に戻る」＝繋ぎ替えができない（BRU5-074）。
    // 動かされていたら折れ分岐を通さず、下の通常ロジックで面を記録し直す（次tickで経路が引き直される）。
    const onAnchorS = !bothConnected ? false
      : forceAnchor || movedShape.has(aS!.id) || Math.hypot(p0.x - anchorToPoint(aS!, sShape).x, p0.y - anchorToPoint(aS!, sShape).y) <= NEAR;
    const onAnchorE = !bothConnected ? false
      : forceAnchor || movedShape.has(aE!.id) || Math.hypot(pL.x - anchorToPoint(aE!, eShape).x, pL.y - anchorToPoint(aE!, eShape).y) <= NEAR;
    const stillAnchored = !bothConnected ? false : (
      onAnchorS && onAnchorE &&
      (forceAnchor || movedShape.has(aS!.id) || distToBox(p0, connectBBox(sShape)) <= TOL) &&
      (forceAnchor || movedShape.has(aE!.id) || distToBox(pL, connectBBox(eShape)) <= TOL)
    );
    if ((cd.wbFolded || foldAll) && bothConnected && stillAnchored) {
      // 手動の折れ点(wbVias)は始点相対で保存されているので、始点図形の移動にもそのまま追従する（BRU7-043）
      const rS = anchorToPoint(aS!, sShape);
      const route = routeOrthogonalVia(rS, sideFromAnchor(aS!), viasToScene(cd, rS), anchorToPoint(aE!, eShape), sideFromAnchor(aE!));
      const cur = el.points.map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
      const same = !!cd.wbFolded && cur.length === route.length && route.every((q, i) => Math.hypot(q.x - cur[i].x, q.y - cur[i].y) < EPS);
      if (same) return el; // 既に折れていて形も一致 → 何もしない（churn防止）
      const ox = route[0].x, oy = route[0].y;
      const np = route.map((p) => [p.x - ox, p.y - oy]);
      const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
      did = true;
      return {
        ...el, x: ox, y: oy, points: np,
        ...(cd.wbFolded ? {} : { roundness: foldRoundness() }), // 新たに折る時だけ既定の角。以後は維持
        customData: cd.wbFolded ? cd : { ...cd, wbFolded: true }, // トグルで新たに折った線に印を付ける
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
        startBinding: null, endBinding: null,
        version: (el.version ?? 1) + 1, versionNonce: rand(),
      };
    }

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
      if (forceAnchor || movedShape.has(aS!.id)) {
        const tp = anchorToPoint(aS!, sShape);
        if (Math.hypot(tp.x - gp[0].x, tp.y - gp[0].y) > EPS) { gp[0] = tp; touched = true; }
      } else if (distToBox(gp[0], connectBBox(sShape)) > TOL) {
        // 旧アンカーから離れた: 近くに別図形があれば4点で繋ぎ替え、無ければ解除（BRU5-064）
        const t = pickConnectTarget(gp[0], shapeArr);
        if (t) { const re = connectTo(gp[0], t); gp[0] = re.point; reStart = re.anchor; touched = true; }
        else dropStart = true;
      } else {
        const tp = anchorToPoint(aS!, sShape);
        if (Math.hypot(tp.x - gp[0].x, tp.y - gp[0].y) > REANCHOR) {
          // 端点が近接する別セルへズレた場合はそちらへ乗り換える（現在のアンカーを優先して安定化・BRU5-061/064）
          const re = connectTo(gp[0], pickConnectTarget(gp[0], shapeArr, aS!.id) ?? sShape); gp[0] = re.point; reStart = re.anchor; touched = true;
        }
      }
    }
    if (eShape) {
      if (forceAnchor || movedShape.has(aE!.id)) {
        const tp = anchorToPoint(aE!, eShape);
        if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > EPS) { gp[L] = tp; touched = true; }
      } else if (distToBox(gp[L], connectBBox(eShape)) > TOL) {
        // 旧アンカーから離れた: 近くに別図形があれば4点で繋ぎ替え、無ければ解除（BRU5-064）
        const t = pickConnectTarget(gp[L], shapeArr);
        if (t) { const re = connectTo(gp[L], t); gp[L] = re.point; reEnd = re.anchor; touched = true; }
        else dropEnd = true;
      } else {
        const tp = anchorToPoint(aE!, eShape);
        if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > REANCHOR) {
          // 端点が近接する別セルへズレた場合はそちらへ乗り換える（現在のアンカーを優先して安定化・BRU5-061/064）
          const re = connectTo(gp[L], pickConnectTarget(gp[L], shapeArr, aE!.id) ?? eShape); gp[L] = re.point; reEnd = re.anchor; touched = true;
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
 * Option/Altドラッグ複製で、コネクタが「複製された側」に付いていくのを直す（BRU5-068）。
 *
 * Excalidraw の Alt複製は直感と逆で、**複製を元の位置に残し、掴んで動かしているのは元の要素（同じid）**。
 * コネクタは id でアンカーしているため、そのままでは「動いていく方＝見た目のコピー」に矢印が付いていく。
 * ユーザーの意図は「元の図形に矢印を残したまま、コピーだけ持ち出す」なので、
 * 元の位置に残った複製（＝新しいid）へアンカーを付け替える。
 *
 * 検出: ドラッグ開始時(pointerdown)の図形geometry署名を控えておき、
 *   ・署名台帳に無い新しい図形 = 複製
 *   ・その現在の署名が、動いた既存図形の「ドラッグ前の署名」と一致 = その図形の複製で、元の位置に残ったもの
 * この対応から oldId→newId を作り、コネクタのアンカーを差し替える。
 *
 * ドラッグ選択に含まれるコネクタ（＝コピーと一緒に持ち出している矢印）は付け替えない。
 * そちらは動いている元要素に付いたままでよい（コピー側に矢印も付いてくるのが正しい）。
 *
 * @param preDragSig pointerdown 時点の図形 id→geometry署名
 * @returns updateScene で反映したら true
 */
export function remapDuplicatedShapeAnchors(api: any, appState: any, preDragSig: Map<string, string>): boolean {
  if (preDragSig.size === 0) return false;
  const elements = api.getSceneElements();
  const shapes = elements.filter(isConnectableShape);

  // 元の位置に残った複製（新id）と、動かされた元図形（既存id）を突き合わせる
  const movedOld = shapes.filter((s: any) => preDragSig.has(s.id) && preDragSig.get(s.id) !== shapeSig(s));
  if (movedOld.length === 0) return false;
  const map = new Map<string, string>(); // oldId(動いた元) → newId(元位置に残った複製)
  const taken = new Set<string>();
  for (const ns of shapes) {
    if (preDragSig.has(ns.id)) continue; // 既存図形＝複製ではない
    const sig = shapeSig(ns);
    const old = movedOld.find((o: any) => !map.has(o.id) && !taken.has(ns.id) && preDragSig.get(o.id) === sig);
    if (old) { map.set(old.id, ns.id); taken.add(ns.id); }
  }
  if (map.size === 0) return false;

  const sel = appState?.selectedElementIds ?? {};
  let changed = false;
  const updated = elements.map((el: any) => {
    if (el.isDeleted || !isConnector(el)) return el;
    if (sel[el.id]) return el; // コピーと一緒に持ち出している矢印は付け替えない
    const cd = el.customData;
    if (!cd) return el;
    const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
    const nS = aS ? map.get(aS.id) : undefined;
    const nE = aE ? map.get(aE.id) : undefined;
    if (!nS && !nE) return el;
    changed = true;
    return {
      ...el,
      customData: {
        ...cd,
        ...(nS ? { triStart: { ...aS!, id: nS } } : {}),
        ...(nE ? { triEnd: { ...aE!, id: nE } } : {}),
      },
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: updated });
  return true;
}

/**
 * 選択中の折れ線を「直線」に戻す（BRU5-080）。
 *
 * Arrow type の Sharp / Curved を押した時に呼ぶ。自前の折れ矢印は elbowed:false なので、
 * Excalidraw 側では「もう Sharp になっている」扱いになり、点列(折れ)はそのまま残ってしまう。
 * その結果「Sharp にしたのに折れたまま」「ハイライトも Elbow のまま」になる。
 * 折れの印(wbFolded)を外し、両端(＝接続している面の中央)を結ぶ2点の直線へ戻す。
 *
 * @param round Curved を押した場合 true（角丸＝曲線）。Sharp は false。
 * @returns updateScene で反映したら true
 */
export function unfoldSelectedConnectors(api: any, appState: any, round: boolean): boolean {
  const sel = appState?.selectedElementIds ?? {};
  const elements = api.getSceneElements();
  let changed = false;
  const updated = elements.map((el: any) => {
    if (el.isDeleted || !sel[el.id] || !isConnector(el)) return el;
    const cd = el.customData;
    const pts: number[][] = Array.isArray(el.points) ? el.points : [];
    const folded = !!cd?.wbFolded;
    if (!folded && pts.length <= 2) return el; // 既に直線
    if (pts.length < 2) return el;

    // 両端はそのまま（接続位置は動かさない）。中間の折れ点だけ落として直線にする。
    const S = { x: el.x + pts[0][0], y: el.y + pts[0][1] };
    const E = { x: el.x + pts[pts.length - 1][0], y: el.y + pts[pts.length - 1][1] };
    const nextCd = { ...(cd ?? {}) };
    delete nextCd.wbFolded;
    delete nextCd.wbVias; // 手動の折れ点も一緒に捨てる（直線に戻すので意味を持たない・BRU7-043）
    changed = true;
    return {
      ...el,
      x: S.x, y: S.y,
      points: [[0, 0], [E.x - S.x, E.y - S.y]],
      width: Math.abs(E.x - S.x), height: Math.abs(E.y - S.y),
      roundness: round ? { type: 2 } : null,
      customData: nextCd,
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: updated });
  return true;
}

/**
 * 選択中の線・矢印を「折れ線」にする（BRU5-081）。
 *
 * Excalidraw の Arrow type（Sharp/Curved/Elbow）は矢印にしか出ないため、棒（line）は
 * 標準UIからは折れ線にできない。左メニューの自前パネル（線の形: 直線/折れ線）から呼ぶ。
 *  ・両端が図形に繋がっている → 接続面(上下左右の中央)基準の直交ルート
 *  ・繋がっていない          → 端点どうしを結ぶ直交ルート
 * 接続位置は動かさない。
 *
 * @returns updateScene で反映したら true
 */
export function foldSelectedConnectors(api: any, appState: any): boolean {
  const sel = appState?.selectedElementIds ?? {};
  const elements = api.getSceneElements();
  const shapeMap = new Map<string, any>();
  for (const e of elements) if (isConnectableShape(e)) shapeMap.set(e.id, e);

  let changed = false;
  const updated = elements.map((el: any) => {
    if (el.isDeleted || !sel[el.id] || !isConnector(el)) return el;
    const pts: number[][] = Array.isArray(el.points) ? el.points : [];
    if (pts.length < 2) return el;
    const cd = el.customData ?? {};
    const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
    const sShape = aS ? shapeMap.get(aS.id) : undefined;
    const eShape = aE ? shapeMap.get(aE.id) : undefined;
    const both = !!(aS && aE && sShape && eShape && !isTriangle(sShape) && !isTriangle(eShape));

    const S = { x: el.x + pts[0][0], y: el.y + pts[0][1] };
    const E = { x: el.x + pts[pts.length - 1][0], y: el.y + pts[pts.length - 1][1] };
    const rS = both ? anchorToPoint(aS!, sShape) : S;
    const vias = viasToScene(cd, rS); // 手動の折れ点があれば維持したまま折り直す（BRU7-043）
    const route = both
      ? routeOrthogonalVia(rS, sideFromAnchor(aS!), vias, anchorToPoint(aE!, eShape), sideFromAnchor(aE!))
      : routeFreeVia(S, vias, E);
    if (route.length < 2) return el;

    const ox = route[0].x, oy = route[0].y;
    const np = route.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
    changed = true;
    return {
      ...el,
      x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      roundness: foldRoundness(),
      customData: { ...cd, wbFolded: true },
      startBinding: null, endBinding: null,
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: updated });
  return true;
}

/**
 * Elbow arrow を「ネイティブのまま」正しく動くように修復する（BRU5-065 / BRU5-070）。
 *
 * 背景: 自前コネクト方式は接続端点のネイティブbindを無効化している（startBinding/endBinding=null）。
 * その線を左メニューの「Arrow type → Elbow」に切り替えると、Excalidraw のエルボー・ルーターは
 * bind が無いので経路を引き直せず、点列が斜めのまま elbowed:true になる。すると
 *  ・見た目が折れない（斜めのまま）
 *  ・セグメントを掴むと invariant("Fixed segments must be either horizontal or vertical") が毎フレーム throw
 * という壊れ方をする。
 *
 * 【方針】elbow は剥がさない。elbowed:true のまま、
 *  ・自前アンカー(triStart/triEnd)を **ネイティブbind(fixedPoint付き)** に翻訳して復元し、
 *  ・図形側の boundElements にも登録し、
 *  ・直交ルートを引いて fixedSegments をクリアする。
 * こうすると Excalidraw 純正のエルボー・ルーターが以後の経路・追従をすべて引き受ける。
 * （以前は elbowed:false にして自前の折れ矢印へ変換していたが、それだと「Elbowを押したのに
 *   Sharpに戻る」「自前ルーターの経路になり変な所へ繋がる」という結果になっていた。）
 *
 * fixedPoint は図形内の正規化座標。上下左右の面中央(fx,fy)をそのまま渡すので、
 * ネイティブelbowでも「接点は各面の中央」というこのボードのルールが保たれる。
 *
 * 図形に繋がっていない elbow は bind できないので、直交ルートだけ引いて elbowed のまま残す。
 * ネイティブに正しく作られた（点列が直交している）elbow arrow は一切触らない。
 *
 * @returns updateScene で反映したら true
 */
export function healBrokenElbowArrows(api: any, elements: readonly any[], appState?: any): boolean {
  // 描画中/点編集中の要素は絶対に触らない。Excalidraw が内部で握っている要素を差し替えると、
  // pointerup の確定処理が壊れて「描いた矢印が離した瞬間に消える」（BRU5-067）。
  const busyId = appState?.newElement?.id ?? appState?.editingLinearElement?.elementId;
  const shapeMap = new Map<string, any>();
  for (const e of elements) if (isConnectableShape(e)) shapeMap.set(e.id, e);

  let changed = false;
  const unbind = new Map<string, Set<string>>(); // 図形id → boundElements から外す矢印id

  const updated = elements.map((el: any) => {
    if (el.isDeleted || !el.elbowed) return el;
    if (el.id === busyId) return el;
    const pts: number[][] = Array.isArray(el.points) ? el.points : [];
    // 点が2個未満なのは「引き始めた直後」の正常な途中状態。触らない。
    if (pts.length < 2) return el;

    // ネイティブ elbow は「引いた直後で点列が正常」なものも含めて、すべて自前の折れ矢印へ変換する。
    // 以前は「点列が斜め＝壊れている」ものだけ変換していたため、Elbowツールで新しく引いた矢印は
    // ネイティブのまま残り、角丸固定・角パネルが出ない・掴んで動かせない、という状態になっていた。
    const cd = el.customData || {};
    const aS0 = readAnchor(cd.triStart), aE0 = readAnchor(cd.triEnd);
    // 接続先は「ネイティブbind」→「自前アンカー」の順に拾う（どちらで繋がっていても引き継ぐ）
    const sShape = shapeMap.get(el.startBinding?.elementId) ?? (aS0 ? shapeMap.get(aS0.id) : undefined);
    const eShape = shapeMap.get(el.endBinding?.elementId) ?? (aE0 ? shapeMap.get(aE0.id) : undefined);
    const both = !!(sShape && eShape && !isTriangle(sShape) && !isTriangle(eShape));
    changed = true;

    const S = { x: el.x + pts[0][0], y: el.y + pts[0][1] };
    const E = { x: el.x + pts[pts.length - 1][0], y: el.y + pts[pts.length - 1][1] };

    // ネイティブbindを外すので、図形側の boundElements からも参照を消す（二重追従の防止）
    for (const sh of [sShape, eShape]) {
      if (!sh) continue;
      const set = unbind.get(sh.id) ?? new Set<string>();
      set.add(el.id);
      unbind.set(sh.id, set);
    }

    const base = {
      ...el,
      elbowed: false,
      fixedSegments: null,
      startBinding: null, endBinding: null,
      roundness: foldRoundness(), // 折れ線の角は専用設定（既定＝角あり）に従う
      version: (el.version ?? 1) + 1, versionNonce: rand(),
    };

    if (!both) {
      // 図形に繋がっていない: 現在の点列をそのまま活かす（直交でなければ直交化）
      const route = routeFree(S, E);
      const keep = pts.length > 2; // 既に折れている（ネイティブが引いた経路）なら壊さない
      if (keep) return base;
      const ox = route[0].x, oy = route[0].y;
      const np = route.map((p) => [p.x - ox, p.y - oy]);
      const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
      return {
        ...base, x: ox, y: oy, points: np,
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      };
    }

    // 【重要】接続位置は動かさない（BRU5-071）。
    // 自前アンカーがあればそれを、無ければ現在の端点から最寄りの面（上下左右の中央）を割り出す。
    const cS = aS0 && shapeMap.get(aS0.id) === sShape ? { anchor: aS0, point: anchorToPoint(aS0, sShape) } : connectTo(S, sShape);
    const cE = aE0 && shapeMap.get(aE0.id) === eShape ? { anchor: aE0, point: anchorToPoint(aE0, eShape) } : connectTo(E, eShape);
    const route = routeOrthogonal(cS.point, sideFromAnchor(cS.anchor), cE.point, sideFromAnchor(cE.anchor));
    const ox = route[0].x, oy = route[0].y;
    const np = route.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);

    return {
      ...base,
      x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      customData: { ...cd, wbFolded: true, triStart: cS.anchor, triEnd: cE.anchor },
    };
  });
  if (!changed) return false;

  // 図形側の boundElements から、bindを外した矢印の参照を除去する
  const cleaned = updated.map((el: any) => {
    const rm = unbind.get(el.id);
    if (!rm || !Array.isArray(el.boundElements)) return el;
    const next = el.boundElements.filter((b: any) => !rm.has(b?.id));
    if (next.length === el.boundElements.length) return el;
    return { ...el, boundElements: next, version: (el.version ?? 1) + 1, versionNonce: rand() };
  });
  api.updateScene({ elements: cleaned });
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
 * 【重要・BRU5-067】アンカー図形が1つもドラッグ選択に含まれていないコネクタは対象外にする。
 * 「図形と一緒に運ばれた矢印のズレを直す」のがこの関数の目的であり、コネクタ“単独”のドラッグは
 * 「ユーザーが矢印そのものを動かした」意図なので、アンカーへ引き戻してはいけない。
 * 引き戻すと ①コネクト済みの矢印がまったく動かせない ②Option+ドラッグで複製しても、動かした側が
 * 元位置へ吸い戻されて置いてきた複製と完全に重なる（＝「複製が消えた」ように見える）という事故になる。
 * 単独ドラッグは follow の通常ルール（近ければ繋ぎ替え／遠ければ解除）に委ねる。
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
    if (!(el.type === "line" || el.type === "arrow") || el.elbowed || isTriangle(el)) return el; // elbowはネイティブ結合に委ねる
    if (!sel[el.id] || el.id === editId) return el; // ドラッグされたコネクタのみ（端点編集は除外）
    const cd = el.customData;
    if (!cd) return el;
    const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
    const sShape = aS ? shapeMap.get(aS.id) : undefined;
    const eShape = aE ? shapeMap.get(aE.id) : undefined;
    if (!sShape && !eShape) return el;
    // アンカー図形も一緒にドラッグされた時だけ貼り直す（コネクタ単独のドラッグは動かせるようにする）
    if (!(aS && sel[aS.id]) && !(aE && sel[aE.id])) return el;
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
