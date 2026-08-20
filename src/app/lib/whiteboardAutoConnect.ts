// 線・矢印を図形（四角/ひし形/楕円/三角形/大括弧）に「コネクト」する仕組み（ENHA2-022）。
// 全図形を自前方式に統一：接続を customData(triStart/triEnd) に「外周上の相対位置(fx,fy)」として記録し、
// followTriangleConnections が図形の移動/リサイズ/回転に合わせて端点を“固定して追従”させる。
// （Excalidrawネイティブbindは接続位置を固定できず戻ってしまうため使わず、接続端点のbindは無効化する。）
import { elementBBox, isBrace, isTriangle, nearestPointOnPolyline } from "./whiteboardSnap";
import { braceTip, nearestBraceAnchor } from "./whiteboardBrace";
// 【BRU7-058】ユーザー操作そのもの（書式パネル・折れ点の確定など）は 1操作＝1 undo ステップに
// なるよう IMMEDIATELY で履歴へ記録する。追従・自動接続などの自動導出は captureUpdate を
// 指定せず、WhiteboardCanvas の guardApi が NEVER を与える（＝履歴に載せない）。
import { COMMIT } from "./whiteboardHistory";

interface Pt { x: number; y: number }
// 三角形への接続アンカー：三角形bbox内での相対位置(fx,fy ∈ [0,1])。
// 三角形の移動・リサイズ後も「同じ相対位置＝同じ辺上の点」に端点を貼り直す。
interface TriAnchor { id: string; fx: number; fy: number }

export const CONNECT_TOL = 16; // 端点がこの距離以内に図形があれば接続対象。22より小さくして「引き寄せが強すぎ／
                               // 少し離しても解除されない」を緩和しつつ、繋がりやすさも確保（BRU5-064）。
const FOLD_FIND_TOL = 40;      // 折れ矢印だけは広めに探索（Shiftの角度スナップで端点がズレても両端を拾う）
const TOL = CONNECT_TOL;

// 内部的には line だが「図形」として扱うもの（三角形・大括弧）。
// コネクタ（接続元）にはならず接続先になり、4点アンカー(辺の中点)ではなく独自の接続点を持つ。
const isPolyShape = (e: any) => isTriangle(e) || isBrace(e);
// 接続元になり得る線形要素（三角形・大括弧は図形扱いなので除外）。
// mermaid から生成した矢印・線(customData.wbMermaid)は、図のレイアウトを崩さないよう自動接続の対象外にする。
// Elbow arrow(elbowed)は Excalidraw のエルボー・ルーターが中間点を直交に保つため、
// 端点だけを書き換える自前コネクト方式とは相容れない（斜め/波打ちに崩れる・BRU5-050系）。
// elbow はネイティブ結合＋ルーターに任せ、自前の接続/追従の対象から外す。
// Markdown 貼り付けで作る飾りの線(customData.wbDecor: 水平線・引用の縦線)も、意図せず
// 近くの図形へ吸着して曲がらないよう自動接続の対象外にする（whiteboardPasteMarkdown）。
const isConnector = (e: any) => (e?.type === "line" || e?.type === "arrow") && !e?.elbowed && !isPolyShape(e) && !e?.customData?.wbMermaid && !e?.customData?.wbDecor;
// 接続先になれる図形（四角/ひし形/楕円/三角形/大括弧/テキストボックス）。全て「辺上の相対位置を固定」する自前方式でつなぐ。
// テキストボックスは矩形外周として扱い、四辺（上下左右）どこにでも端点を貼り付けられる（BRU5-054）。
// 図形内に埋め込まれたラベルテキスト(containerId あり)は、コンテナ図形側が接続対象なので除外する。
// 大括弧は3つの先端（トゲ・両端）だけを接続点にする（BRU9-042）。
export const isConnectableShape = (e: any) =>
  !e?.isDeleted && !e?.customData?.wbBgFor  // テキスト背景の影矩形(BRU5-062)は接続対象外
    && !e?.customData?.wbFrameBg            // フレーム装飾の影矩形(BRU5-063)も接続対象外
    && (e?.type === "rectangle" || e?.type === "diamond" || e?.type === "ellipse"
    || (e?.type === "text" && !e?.containerId) || isPolyShape(e));
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

// 図形の geometry 署名（移動/リサイズ/回転の検知用）。
// 大括弧はトゲ位置を動かしても外接矩形が変わらないため、tip も署名に含める。これが無いと
// followTriangleConnections が「図形は静止」と判断し、トゲに繋いだ矢印が取り残される（BRU9-042）。
export const shapeSig = (t: any): string => {
  const b = elementBBox(t);
  return `${b.x},${b.y},${b.w},${b.h},${t.angle || 0}${isBrace(t) ? `,${braceTip(t)}` : ""}`;
};

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
 *
 * 大括弧（BRU9-042）も同じ理由で点編集を止める。こちらは弧のサンプル点まで掴めてしまうため、
 * 1点でも動かすと括弧に見えなくなる（形は normalizeBraces が外接矩形から作り直して管理する）。
 */
export function suppressTrianglePointEditing(api: any, elements: readonly any[], appState: any): void {
  const selId = appState?.selectedLinearElement?.elementId;
  const editId = appState?.editingLinearElement?.elementId;
  if (!selId && !editId) return;
  const isTriId = (id: string | undefined) => !!id && isPolyShape(elements.find((e) => e.id === id));
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
  // 三角形・大括弧は点列そのものが外周（括弧は閉じない開いた曲線）
  if (isPolyShape(el)) return (Array.isArray(el.points) ? el.points : []).map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
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
// 大括弧は「3つの先端（トゲ・両端）」だけに繋ぐ（BRU9-042）。細い曲線なので外周へ射影すると
// 曲線の途中に端点が付いて狙いが定まらず、先端に矢印を合わせたいという用途に合わないため。
const connectTo = (pt: Pt, shape: any): { anchor: TriAnchor; point: Pt } => {
  const b = connectBBox(shape);
  if (isBrace(shape)) {
    const a = nearestBraceAnchor(pt, shape);
    return { anchor: { id: shape.id, fx: a.fx, fy: a.fy }, point: { x: a.x, y: a.y } };
  }
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

// ── 自由折れ点（BRU12-030）──
//
// 上の routeOrthogonalVia / routeFreeVia は「経由点を必ず通る直交ルート」を自動生成する方式で、
// 角の位置はアルゴリズムが決める。そのため
//   ・打った位置が角にならない（直線区間の点は dedupeCollinear に畳まれ、角は別の場所に湧く）
//   ・2点目を足しても経路が変わらず「追加できていない」ように見える
// という「好きな位置で折れない」問題があった。
//
// 自由折れ点モード(customData.wbViaFree)では、経路＝S→折れ点→…→E をそのまま結ぶだけにして、
// 角の位置を一切自動調整しない。折れ点＝角、打った数だけ角が増える。
// 一直線上に並んだ折れ点も角として残す（畳むと掴んでいたつまみが消えてしまうため）。

// 辺 s に固定された端点 P と、隣の折れ点 q を直角に繋ぐ角。既に軸が揃っていれば不要(null)。
// 図形の辺からは真っ直ぐ出入りさせたいので、両端だけはこの角を1つ挟む（折れ点自体は動かさない）。
const elbowCorner = (P: Pt, s: Side, q: Pt): Pt | null =>
  axisOfSide(s) === "h"
    ? (Math.abs(q.y - P.y) < 0.5 ? null : { x: q.x, y: P.y })
    : (Math.abs(q.x - P.x) < 0.5 ? null : { x: P.x, y: q.y });

// 重なった点だけ落とす（dedupeCollinear と違い、一直線上の中間点は残す）。
function dedupeSame(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of pts) { const l = out[out.length - 1]; if (!l || Math.hypot(l.x - q.x, l.y - q.y) > 0.5) out.push(q); }
  return out.length >= 2 ? out : pts.slice(0, 2);
}

/** 自由折れ点モードの経路。打った折れ点をそのまま角にする（BRU12-030）。 */
export function routeViaPolyline(S: Pt, sS: Side | null, vias: readonly Pt[], E: Pt, sE: Side | null): Pt[] {
  if (vias.length === 0) return sS && sE ? routeOrthogonal(S, sS, E, sE) : routeFree(S, E);
  const out: Pt[] = [S];
  if (sS) { const c = elbowCorner(S, sS, vias[0]); if (c) out.push(c); }
  out.push(...vias.map((v) => ({ x: v.x, y: v.y })));
  if (sE) { const c = elbowCorner(E, sE, vias[vias.length - 1]); if (c) out.push(c); }
  out.push(E);
  return dedupeSame(out);
}

/**
 * 折れ線の経路を作る唯一の入口（BRU12-030）。
 * 手で折れ点を編集した線(wbViaFree)は打った点をそのまま角にし、それ以外は従来の自動ルートを使う。
 * ※既存の盤面（wbViaFree を持たない古い折れ線）は従来どおりの経路のまま＝見た目が変わらない。
 */
export function buildFoldedRoute(
  cd: any, S: Pt, sS: Side | null, vias: readonly Pt[], E: Pt, sE: Side | null,
): Pt[] {
  if (vias.length > 0 && cd?.wbViaFree) return routeViaPolyline(S, sS, vias, E, sE);
  return sS && sE ? routeOrthogonalVia(S, sS, vias, E, sE) : routeFreeVia(S, vias, E);
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
export interface RouteInfo { S: Pt; E: Pt; sS: Side | null; sE: Side | null; vias: Pt[]; route: Pt[]; free: boolean }
export function foldedRouteInfo(el: any, elements: readonly any[]): RouteInfo | null {
  if (!el || el.isDeleted || !isConnector(el)) return null;
  const pts: number[][] = Array.isArray(el.points) ? el.points : [];
  if (pts.length < 2) return null;
  const cd = el.customData ?? {};
  const aS = readAnchor(cd.triStart), aE = readAnchor(cd.triEnd);
  const findShape = (id?: string) => (id ? elements.find((e) => e.id === id && isConnectableShape(e)) : undefined);
  const sShape = aS ? findShape(aS.id) : undefined;
  const eShape = aE ? findShape(aE.id) : undefined;
  const both = !!(aS && aE && sShape && eShape && !isPolyShape(sShape) && !isPolyShape(eShape));
  const S = both ? anchorToPoint(aS!, sShape) : { x: el.x + pts[0][0], y: el.y + pts[0][1] };
  const E = both ? anchorToPoint(aE!, eShape) : { x: el.x + pts[pts.length - 1][0], y: el.y + pts[pts.length - 1][1] };
  let vias = viasToScene(cd, S);
  if (!both && !Array.isArray(cd.wbVias) && pts.length > 2) {
    vias = pts.slice(1, -1).map((p) => ({ x: el.x + p[0], y: el.y + p[1] }));
  }
  const sS = both ? sideFromAnchor(aS!) : null;
  const sE = both ? sideFromAnchor(aE!) : null;
  const route = buildFoldedRoute(cd, S, sS, vias, E, sE);
  return { S, E, sS, sE, vias, route, free: !!cd.wbViaFree && vias.length > 0 };
}

/**
 * 折れ点（経由点）を書き換えてコネクタの経路を引き直す（BRU7-043）。
 *
 * @param viasScene 新しい経由点(scene座標)。空配列を渡すと折れ点をすべて消して自動ルートへ戻す。
 * @param prune 隣（前後の折れ点・端点）と重なった経由点を捨てる（長さ0の区間の掃除）。
 *   ドラッグ中に捨てると掴んでいるつまみが消えるので、指を離したフレームだけ true にする。
 *   ※一直線上に並んだだけの点は捨てない（BRU12-030）。自由折れ点では折れ点＝角なので、
 *     「見た目が変わらないから」と消すと置いたはずの折れ点が消え、好きな位置で折れなくなる。
 * @param commit ジェスチャの確定フレームで true（BRU7-058）。折れ点の編集は明確なユーザー操作
 *   なので、確定時の1回だけ履歴へ記録して「Ctrl+Z で折れ点の移動だけを戻せる」ようにする。
 *   ドラッグ中の中間状態を記録すると 1ドラッグが何十もの undo ステップに割れるため false。
 * @returns updateScene で反映したら true
 */
export function applyConnectorVias(api: any, id: string, viasScene: readonly Pt[], prune = false, commit = false): boolean {
  const elements = api.getSceneElements();
  const el = elements.find((e: any) => e.id === id);
  const info = el ? foldedRouteInfo(el, elements) : null;
  if (!info) return false;
  // 手で編集した折れ点は常に自由折れ点モード＝打った位置がそのまま角になる（BRU12-030）
  const build = (vs: readonly Pt[]) => routeViaPolyline(info.S, info.sS, vs, info.E, info.sE);
  let route = build(viasScene);
  if (route.length < 2) return false;
  let kept: readonly Pt[] = viasScene;
  if (prune) {
    // 隣（前後の折れ点・端点）と重なった点だけ捨てる。長さ0の区間はつまみが掴めなくなるため。
    // ※一直線上に並んだだけの点は捨てない。捨てると「置いた折れ点が消える＝折れない」になる。
    const keep = [...viasScene];
    for (let i = keep.length - 1; i >= 0; i--) {
      const prev = i > 0 ? keep[i - 1] : info.S;
      const next = i < keep.length - 1 ? keep[i + 1] : info.E;
      const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1;
      if (near(keep[i], prev) || near(keep[i], next)) keep.splice(i, 1);
    }
    if (keep.length !== viasScene.length) { kept = keep; route = build(keep); }
  }
  const cd: any = { ...(el.customData ?? {}), wbFolded: true, wbViaFree: true, wbVias: viasFromScene(kept, info.S) };
  if (kept.length === 0) { delete cd.wbVias; delete cd.wbViaFree; }
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
    ...(commit ? COMMIT : {}),
  });
  return true;
}

// ── 折れ線のリサイズ（BRU12-030）──
//
// 折れ線の形は点列そのものではなく「両端のアンカー＋折れ点(wbVias)」から毎フレーム引き直している。
// そのためバウンディングボックスの角/辺を掴んでサイズを変えても、伸び縮みするのは点列だけで
// 折れ点は元の位置に残る。選択を外した次のフレームで followTriangleConnections が“昔の折れ点”から
// 経路を作り直すため、変更したサイズがまるごと元へ戻ってしまう（＝報告された症状）。
//
// ここでは「掴む直前の形」を控えておき、指を離したフレームで折れ点を新しい形へ焼き直す。
//   ・線1本だけのリサイズ … 伸び縮みした点列の中間点をそのまま折れ点にする（見たままが残る）。
//     両端は記録済みアンカーへ戻す（＝図形から外れない）。
//   ・複数選択のリサイズ … 折れ点を外接矩形の変形に合わせて拡大縮小するだけにする。
//     盤面をまとめて拡大した時に、経路の作り方（自動ルート/自由折れ点）まで変えないため。
interface Box { x: number; y: number; w: number; h: number }
export interface FoldResizeState {
  resizing: boolean;                                  // 前tickでリサイズ中だったか
  solo: boolean;                                      // 折れ線1本だけを掴んだリサイズか
  pending: boolean;                                   // 焼き直しが未反映か（他処理と競合した時は次tickへ持ち越す）
  snap: Map<string, { box: Box; vias: Pt[] }>;        // 掴む直前の外接矩形と折れ点(scene座標)
}
export const newFoldResizeState = (): FoldResizeState => ({ resizing: false, solo: false, pending: false, snap: new Map() });

// 点列の外接矩形（el.x,y は先頭点であって左上ではないので、点から求める）
const pointsBox = (el: any): Box => {
  const xs = el.points.map((p: number[]) => el.x + p[0]);
  const ys = el.points.map((p: number[]) => el.y + p[1]);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const sameBox = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;

/** リサイズ確定フレームの焼き直し本体。1tick 1 updateScene を守るためまとめて反映する。 */
function bakeResizedVias(api: any, elements: readonly any[], st: FoldResizeState): boolean {
  const live = (id: string) => {
    const el = elements.find((e: any) => e.id === id);
    return el && !el.isDeleted && Array.isArray(el.points) && el.points.length >= 2 ? el : null;
  };
  if (st.solo) {
    for (const [id, s] of st.snap) {
      const el = live(id);
      if (!el || sameBox(pointsBox(el), s.box)) continue; // 形が変わっていない＝別要素のリサイズ
      const info = foldedRouteInfo(el, elements);
      if (!info) continue;
      // 伸び縮みした点列の中間点＝そのまま折れ点にする。両端は applyConnectorVias が
      // 記録済みアンカー（繋いでいない線は今の端点）から引き直す。
      let vias = el.points.slice(1, -1).map((p: number[]) => ({ x: el.x + p[0], y: el.y + p[1] }));
      if (!vias.length) continue;
      // ただし「辺から真っ直ぐ出るための肘」は折れ点にしない。経路生成側(routeViaPolyline)が
      // その時の端点から作り直すので、折れ点にしてしまうと後で図形を動かした時に
      // 昔の肘の位置まで戻ってから端点へ向かう＝経路が行って戻るようになる。
      // 肘しか無い（コの字の）折れ線は、深さを保つために真ん中の1点だけ折れ点として残す。
      if (vias.length >= 2 && info.sS && info.sE) {
        const isCorner = (c: Pt | null, v: Pt) => !!c && Math.hypot(c.x - v.x, c.y - v.y) < 1;
        const dropS = isCorner(elbowCorner(info.S, info.sS, vias[1]), vias[0]);
        const dropE = isCorner(elbowCorner(info.E, info.sE, vias[vias.length - 2]), vias[vias.length - 1]);
        const trimmed = vias.slice(dropS ? 1 : 0, dropE ? vias.length - 1 : vias.length);
        vias = trimmed.length ? trimmed : [{
          x: (vias[0].x + vias[vias.length - 1].x) / 2,
          y: (vias[0].y + vias[vias.length - 1].y) / 2,
        }];
      }
      // 履歴には載せない（リサイズ自体は Excalidraw が既に1ステップとして記録済み。ここは
      // そこから導いた形の焼き直しなので、記録すると Ctrl+Z が2回必要になる・BRU7-058）。
      if (applyConnectorVias(api, id, vias, true)) return true;
    }
    return false;
  }
  // 複数選択のリサイズ: 折れ点だけを外接矩形の変形へ合わせる（経路の引き直しは追従処理に任せる）
  const patch = new Map<string, ViaOffset[]>();
  for (const [id, s] of st.snap) {
    if (!s.vias.length) continue; // 折れ点が無い線は自動ルートが新しいアンカーから引き直す
    const el = live(id);
    if (!el) continue;
    const box = pointsBox(el);
    if (sameBox(box, s.box)) continue;
    const scale = (v: number, from: number, fw: number, to: number, tw: number) =>
      fw > 0.5 ? to + ((v - from) / fw) * tw : to + (v - from); // 幅0（縦一直線）は平行移動だけ
    const info = foldedRouteInfo(el, elements);
    if (!info) continue;
    const moved = s.vias.map((p) => ({
      x: scale(p.x, s.box.x, s.box.w, box.x, box.w),
      y: scale(p.y, s.box.y, s.box.h, box.y, box.h),
    }));
    patch.set(id, viasFromScene(moved, info.S));
  }
  if (!patch.size) return false;
  api.updateScene({
    elements: elements.map((e: any) => (!patch.has(e.id) ? e : {
      ...e,
      customData: { ...(e.customData ?? {}), wbVias: patch.get(e.id) },
      version: (e.version ?? 1) + 1, versionNonce: rand(),
    })),
  });
  return true;
}

/**
 * 折れ線のサイズ変更を折れ点(wbVias)へ反映する（BRU12-030）。毎tick呼ぶ。
 *
 * リサイズ中は何もせず「掴む直前の形」を凍結し、指を離したフレームで焼き直す。
 * @param active false（リモート反映中／他ヘルパーが反映済みのtick）の時は書き込まず、次tickへ持ち越す
 * @returns updateScene で反映したら true
 */
export function syncFoldedViasOnResize(
  api: any, elements: readonly any[], appState: any, st: FoldResizeState, active: boolean,
): boolean {
  const resizing = !!(appState?.isResizing || appState?.resizingElement);
  if (resizing) {
    // リサイズ中に控え直すと「変形の途中」を基準にしてしまう。開始フレームで凍結する。
    if (!st.resizing) {
      st.resizing = true;
      st.solo = Object.values(appState?.selectedElementIds ?? {}).filter(Boolean).length === 1;
      st.pending = st.snap.size > 0;
    }
    return false;
  }
  st.resizing = false;
  if (st.pending) {
    if (!active) return false; // 控えは保ったまま次tickで焼き直す
    st.pending = false;
    const did = bakeResizedVias(api, elements, st);
    st.snap.clear();
    if (did) return true;
  }
  // 静止中は「掴む直前の形」を控え続ける。
  // 対象は“折れ点がズレると形が戻ってしまう線”だけ＝両端が図形に繋がった折れ線と、手動の折れ点を持つ折れ線。
  st.snap.clear();
  const sel = appState?.selectedElementIds ?? {};
  for (const el of elements as any[]) {
    if (el.isDeleted || !sel[el.id] || !isConnector(el) || !el.customData?.wbFolded) continue;
    if (!Array.isArray(el.points) || el.points.length < 2) continue;
    const info = foldedRouteInfo(el, elements);
    if (!info) continue;
    if (!(info.sS && info.sE) && readVias(el.customData).length === 0) continue;
    st.snap.set(el.id, { box: pointsBox(el), vias: info.vias });
  }
  return false;
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
  // Ctrl/Cmd 押下中（BRU7-056-4）: 接続しない。ただし「評価済み」にはする＝キーを離した後に
  // 無関係な操作をした拍子へ判定が持ち越されて、あとから勝手に吸着するのを防ぐ。
  suppress?: boolean,
  // 端点つまみを掴んで離した線の id（BRU7-056-4）。この線だけは「今繋がっている図形」を
  // 優先せず、端点を落とした位置から接続先を選び直す（狙った図形へ繋ぎ替えられるようにする）。
  retargetId?: string,
  // 直前のドラッグで“一緒に動いた”要素の id（複数選択して移動した一群）。
  // 一群の中どうしは相対位置が1mmも変わっていない＝接続関係は移動前のまま正しいので、
  // ここに含まれる線には、同じく一群の中にある図形を**新しい接続先として選ばせない**。
  // これが無いと、囲んで動かしただけで線が近くの（多くは全体を囲っている大きな）図形へ
  // 吸着し、端点が辺の中点へ飛んで矢印・棒が崩れる。
  coMoved?: Set<string>,
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
    // Ctrl/Cmd 押下中は接続しない（BRU7-056-4）。評価だけ消化して、素の線のまま残す。
    if (suppress) { processed.add(el.id); foldIds?.delete(el.id); return el; }

    const p0 = el.points[0];
    const pN = el.points[el.points.length - 1];
    const startPt = { x: el.x + p0[0], y: el.y + p0[1] };
    const endPt = { x: el.x + pN[0], y: el.y + pN[1] };

    // 折れ矢印(Shift/トグル)要求時は、両端を図形に繋ぎたい意図が明確なので探索半径を広げる。
    // これで Shift の角度スナップで端点が図形から少しズレても拾って、辺の中央へ吸着＆折れる（BRU5-064）。
    const wantFold = !!foldAll || (foldIds?.has(el.id) ?? false);
    const findTol = wantFold ? FOLD_FIND_TOL : TOL;
    // 既に接続している図形を優先候補として渡す（BRU7-056-3）。
    // これを渡さないと、再評価のたびに「たまたま近くにある別の図形」へ乗り換えてしまい、
    // 何も触っていない矢印が突然よその図形へ繋ぎ変わって向きが変わる。
    //
    // 優先を外すのは「端点つまみを掴んで離した線」だけ（BRU7-056-4/-6）。その線は狙って端点を
    // 落としているので、四角の中の小さい四角のように“今の接続先の内側”へも繋ぎ替えられる必要がある。
    // 逆にそれ以外の線まで優先を外すと、端点が接続先の矩形からわずかにはみ出しているだけで
    // 「それを囲む外側の図形」が選ばれ、端点が外枠の辺の中央へ飛んで盤面が崩れる（BRU7-056-6）。
    const aS0 = readAnchor(el.customData?.triStart);
    const aE0 = readAnchor(el.customData?.triEnd);
    const retarget = !!retargetId && el.id === retargetId;
    const preferOf = (a: TriAnchor | null): string | undefined => (a && !retarget ? a.id : undefined);
    // 複数選択して一緒に動かした一群の中の線は、同じ一群の図形を新しい接続先に選ばない（上の coMoved 参照）。
    // 既に繋がっている図形だけは候補に残す（記録どおりの追従を妨げないため）。
    const group = coMoved && coMoved.has(el.id) ? coMoved : null;
    const cand = group
      ? shapes.filter((s) => !group.has(s.id) || s.id === aS0?.id || s.id === aE0?.id)
      : shapes;
    let sShape = pickConnectTarget(startPt, cand, preferOf(aS0), findTol);
    let eShape = pickConnectTarget(endPt, cand, preferOf(aE0), findTol);
    // 折れ矢印で終端(離した側)が図形に届かない場合、実カーソル位置(pointerHint)で拾い直す。
    // Shiftの角度スナップで端点が図形からズレても、狙った図形へ繋いで折れるようにする（BRU5-064）。
    let endRef = endPt;
    if (wantFold && !eShape && pointerHint) {
      const s = pickConnectTarget(pointerHint, cand, preferOf(aE0), FOLD_FIND_TOL);
      if (s) { eShape = s; endRef = pointerHint; }
    }
    // 線を丸ごと呑み込んでいる図形（＝全体を囲っているだけの大きな枠）は接続先にしない。
    // pickConnectTarget は「点を内包する図形」を距離0として拾うため、枠の中に引いただけの線は
    // 端点が枠の辺から何百px離れていても枠に繋がってしまう。すると端点が辺の中点へ吹き飛び、
    // 図の中の複数の線が枠の同じ1点へ集まって扇状に崩れる（＝報告された症状）。
    // 枠の辺そのものへ繋いだ線（端点が外周のすぐ近く）は従来どおり接続を認める。
    const swallows = (s: any, pt: Pt, other: Pt): boolean => {
      const b = connectBBox(s);
      const inside = (p: Pt) => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
      return inside(pt) && inside(other) && distToOutline(pt, s) > TOL;
    };
    if (sShape && swallows(sShape, startPt, endPt)) sShape = null;
    if (eShape && swallows(eShape, endRef, startPt)) eShape = null;
    // 【BRU7-056-3】両端が同じ図形へ吸着する接続は作らない。
    // 図形の“中”に引いただけの線・矢印（四角の中に置いた棒など）は、端点がその図形のbboxに
    // 内包されるため両端ともその図形を接続先に選ぶ。すると始点は左辺の中点・終点は上辺の中点…と
    // バラバラの辺へ引っ張られ、水平だった棒がいきなり斜めに化ける（＝報告された症状）。
    // 4点アンカー方式では自己ループを表現できず繋いでも意味が無いので、接続そのものを見送る。
    if (sShape && eShape && sShape.id === eShape.id) { sShape = null; eShape = null; }

    // 【BRU7-056-3】評価は1要素につき1回だけ（接続できなくても「評価済み」にする）。
    // 以前は接続できるまで毎フレーム再判定していたため、ずっと前に引いた線・矢印が
    // 「別の図形を追加した」「無関係な要素を動かした」拍子に初めて評価され、近くの図形へ
    // 突然吸着して向きが変わっていた（＝再現に規則性が無い原因）。
    // 掴んで動かした線は WhiteboardCanvas 側が“離したフレーム”で未処理へ戻し、その時に再判定する。
    processed.add(el.id);
    foldIds?.delete(el.id); // 折れ要求も同時に消化（未接続で残り続けるのを防ぐ）
    if (!sShape && !eShape) return el;
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
    if (wantFold && sC && eC && sShape && eShape && !isPolyShape(sShape) && !isPolyShape(eShape)) {
      // 手動の折れ点(wbVias)があれば必ず通す（BRU7-043 / 自由折れ点なら角そのもの・BRU12-030）
      gp = buildFoldedRoute(customData, sC.point, sideFromAnchor(sC.anchor), viasToScene(customData, sC.point), eC.point, sideFromAnchor(eC.anchor));
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
  // Ctrl/Cmd 押下中（BRU7-056-4）: 端点を動かした線は繋ぎ替えず、接続を外して置いた場所に残す。
  // ※「押しながら端点をずらして接続を切る」＝ユーザーの意図どおりの解除。図形が動いた時の追従
  //   （記録済みアンカーへの復元）はキーに関係なく従来どおり行う。
  noConnect?: boolean,
  // 複製処理が接続を握っているコネクタ（BRU7-056-10）。反映が済むまでここは一切触らない。
  // これが無いと、複製の付け替えと追従が同じ端点を奪い合い、最後に書いた方が勝つ
  // （updateScene が rAF へ集約され last-write-wins になるため）。実測では追従が勝ち続け、
  // 矢印がコピー先へ付いていったままになっていた。
  pinned?: Set<string>,
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
    if (pinned?.has(el.id)) return el; // 複製処理が接続を握っている間は触らない（BRU7-056-10）
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
    const bothConnected = !!(aS && aE && sShape && eShape && !isPolyShape(sShape) && !isPolyShape(eShape));
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
      const route = buildFoldedRoute(cd, rS, sideFromAnchor(aS!), viasToScene(cd, rS), anchorToPoint(aE!, eShape), sideFromAnchor(aE!));
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
        const t = noConnect ? null : pickConnectTarget(gp[0], shapeArr);
        if (t) { const re = connectTo(gp[0], t); gp[0] = re.point; reStart = re.anchor; touched = true; }
        else dropStart = true;
      } else {
        const tp = anchorToPoint(aS!, sShape);
        if (Math.hypot(tp.x - gp[0].x, tp.y - gp[0].y) > REANCHOR) {
          // 端点が近接する別セルへズレた場合はそちらへ乗り換える（現在のアンカーを優先して安定化・BRU5-061/064）。
          // 【重要・BRU7-056-6】ここで現在のアンカーを優先しないと、端点が接続先の矩形からわずかに
          // はみ出しているだけで「それを囲む外側の図形」が接続先に選ばれ、端点が外枠の辺の中央へ
          // 飛ぶ（枠の中の線が外枠の右辺へ集まって交差する）。この分岐は端点をドラッグしていない
          // 線も通る（記録が旧形式で位置が一致しない等）ため、優先を外すと盤面が勝手に崩れる。
          // 狙って繋ぎ替えたい時だけ＝端点ドラッグを離したフレーム(editApply)に限って優先を外す。
          const prefer = editApply ? undefined : aS!.id;
          if (noConnect) dropStart = true; // Ctrl/Cmd 中は吸い戻さず、そこで接続を切る（BRU7-056-4）
          else { const re = connectTo(gp[0], pickConnectTarget(gp[0], shapeArr, prefer) ?? sShape); gp[0] = re.point; reStart = re.anchor; touched = true; }
        }
      }
    }
    if (eShape) {
      if (forceAnchor || movedShape.has(aE!.id)) {
        const tp = anchorToPoint(aE!, eShape);
        if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > EPS) { gp[L] = tp; touched = true; }
      } else if (distToBox(gp[L], connectBBox(eShape)) > TOL) {
        // 旧アンカーから離れた: 近くに別図形があれば4点で繋ぎ替え、無ければ解除（BRU5-064）
        const t = noConnect ? null : pickConnectTarget(gp[L], shapeArr);
        if (t) { const re = connectTo(gp[L], t); gp[L] = re.point; reEnd = re.anchor; touched = true; }
        else dropEnd = true;
      } else {
        const tp = anchorToPoint(aE!, eShape);
        if (Math.hypot(tp.x - gp[L].x, tp.y - gp[L].y) > REANCHOR) {
          // 端点が近接する別セルへズレた場合はそちらへ乗り換える（現在のアンカーを優先して安定化・BRU5-061/064）。
          // 優先を外すのは端点ドラッグを離したフレームだけ。理由は始点側と同じ（BRU7-056-6）。
          const prefer = editApply ? undefined : aE!.id;
          if (noConnect) dropEnd = true; // Ctrl/Cmd 中は吸い戻さず、そこで接続を切る（BRU7-056-4）
          else { const re = connectTo(gp[L], pickConnectTarget(gp[L], shapeArr, prefer) ?? eShape); gp[L] = re.point; reEnd = re.anchor; touched = true; }
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
 * 複製・コピペで生まれた要素が持つ「自前の id 参照」を、複製された側の id へ貼り替える（BRU7-056-5）。
 *
 * 【なぜ必要か】
 * Excalidraw の複製（Alt+ドラッグ / Ctrl+D / コピー＆ペースト）は deepCopyElement で要素を丸ごと
 * 複製し、**自分が知っている参照だけ**を新しい id へ貼り替える
 * （boundElements・startBinding/endBinding・frameId・containerId・groupIds）。
 * このボードは接続と所属を customData に自前で持っているため、
 *   ・triStart / triEnd … 線・矢印の接続先の図形 id
 *   ・wbParent          … フレームへの所属
 *   ・wbBgFor / wbFrameBg … 背景・枠線を描く影矩形の対象 id
 * は貼り替えられず、**複製された要素が“コピー元”の要素を指したまま**になる。
 *
 * その結果、コピーした瞬間にコピー元がぐちゃぐちゃになる:
 *   ・複製された線の端点が、コピー元の図形へ引き寄せられて画面を横切る長い線になる
 *   ・複製された子要素が、コピー元のフレームの移動に付いていく
 * Alt+ドラッグでは「複製が元の位置に残り、掴んで動くのは元の要素」なので、
 * 見た目には “置いてきたはずのコピー元” が壊れて見える（＝報告された症状）。
 *
 * 【直し方】
 * 「今のフレームで新しく現れた要素の集まり（＝複製された一群）」を求め、その中で
 * 複製元→複製先の対応表を作り、一群の中の参照を貼り替える。
 * 対応付けは複製が保つ性質を使う:
 *   ・見た目・寸法・points・customData は複製元と完全に同一（deepCopyElementのため）
 *   ・一群はすべて同じ平行移動量で置かれる（貼り付け位置 / Alt複製なら元の位置）
 * → 「同一の指紋を持つ既存要素」との位置差の多数決で平行移動量を決め、その差で1対1に対応付ける。
 *
 * 【一群の外への接続の扱い】
 * 複製は必ず「持ち出す側」と「その場に残る側」に分かれる。
 *   ・Alt+ドラッグ … 持ち出すのは元の要素（同じid）。複製が元の位置に残る。
 *   ・Ctrl+D / 貼り付け … 持ち出す（＝別の場所に置かれる）のは複製の方。
 * どちらの場合も「持ち出される側」は選択状態になっているので、それで判別する。
 *
 * 持ち出される側が一群の外の図形へ繋がったままだと、離れていくにつれて線が引き伸ばされ、
 * コピー元とコピー先を結ぶ長い線が画面を横切る（＝報告された「コピー元が大きく崩れる」）。
 * 枠の中に引いただけの飾り線が昔の自動接続で外枠に繋がっている、というだけで起きるので、
 * **持ち出される側の「一群の外への接続」は複製の時点で切る**。コピーは独立した一塊になる。
 *
 * その場に残る側は位置が変わらないので外への接続をそのまま保つ（Alt複製で元の位置に残った線が
 * 引き続き外の矢印と繋がっているのが正しい・BRU5-068）。ただし端点が実際にその図形へ
 * 触れていなければ捨てる（離れた場所へ貼り付けたコピーの取りこぼし対策）。
 *
 * 【必ず“毎tick再評価できる”形にすること】
 * onChange 内の updateScene は commitフェーズ外(rAF)へ遅延され、同じフレームに onChange が
 * 複数回来ると last-write-wins で握り潰される（guardApi 参照）。この設計は
 * 「未反映分は次tickで再評価される」ことを前提にしているので、複製を見つけた一度きりで
 * 書き換える作りにすると、握り潰された瞬間に永久に反映されない（＝ドラッグ中は毎フレーム
 * pointermove が複数回来るためほぼ必ず起きる）。
 * そこで検出（複製元→複製先の対応表づくり）と適用を分け、対応表を plan として持ち回り、
 * **反映されるまで毎tick同じ書き換えを試みる**。書き換え済みなら差分ゼロで false を返すだけなので、
 * 何度呼ばれても結果は変わらない（冪等）。
 *
 * 【複製された線は自動接続にかけない・BRU7-056-7】
 * これが「コピーするとコピー元が崩れる」の直接の原因だった。複製された線は新しい id を持つため
 * autoConnectLines から見ると「まだ評価していない新しい線」に見え、接続の判定にかけられる。
 * その結果、**元々どこにも繋がっていなかった飾り線**（枠の中に引いただけの線）が、コピーした
 * 瞬間に近くの図形へ勝手に接続される。しかも始点と終点が別々の図形に繋がると線が引き裂かれ、
 * 画面を横切る長い線になる。実測ログ:
 *   [WB-TRACE] 自動接続: line#roP2cD 始点 - → PnWB9J(0,0.5) / 終点 - → 6RqAAe(0.5,1)
 * 複製は「元の線の写し」であって新しく引かれた線ではないので、接続状態は元から引き継ぐのが正しい
 * （繋がっていなかった線の複製は繋がっていない）。対応の付いた複製は評価済みとして登録する。
 *
 * @param known これまでに見たことのある要素id。初回は現況を種まきするだけで何もしない。
 * @param skip リモート反映中など、貼り替えを行わずに台帳だけ更新したい時 true。
 * @param planRef 検出した複製の対応表。反映が確認できるまで持ち越して毎tick適用する。
 * @param processed autoConnectLines の「評価済み」台帳。複製された線をここへ登録する。
 * @returns updateScene で反映したら true
 */
export interface DupPlan {
  map: Map<string, string>;  // 複製元id → 複製先id
  dups: Set<string>;         // 複製された側（＝新しく現れた要素）
  batch: Set<string>;        // 複製に関わった一群（元＋複製）
  carried: Set<string>;      // 持ち出される側（一群の外への接続を切る対象）
  external: Set<string>;     // 一群の外にいて、持ち出される図形に繋がっているコネクタ
  pinned: Set<string>;       // この plan が接続を握っているコネクタ（追従処理は触らない）
  until: number;             // この時刻(performance.now)を過ぎたら諦める
}

export function remapDuplicatedCustomRefs(
  api: any,
  elements: readonly any[],
  appState: any,
  known: Set<string>,
  skip: boolean,
  planRef: { current: DupPlan | null },
  processed?: Set<string>,
): boolean {
  const detected = detectDuplication(elements, appState, known, skip);
  if (detected && processed) {
    // 複製された線・矢印は「評価済み」にして自動接続の判定にかけない（BRU7-056-7・上の説明を参照）。
    // ここは検出したフレームで必ず通るため、以降どのタイミングで autoConnectLines が走っても
    // 複製が勝手に繋がることはない。
    for (const el of elements) if (detected.dups.has(el.id) && isConnector(el)) processed.add(el.id);
  }
  const plan = detected ?? planRef.current;
  planRef.current = plan;
  if (!plan) return false;
  if (performance.now() > plan.until) { planRef.current = null; return false; }
  const applied = applyDupPlan(api, elements, plan);
  // 書き換えるものが無くなった＝反映が確認できた。役目を終えたので破棄する
  // （握り潰されている間は「まだ書き換えるものがある」ので true が返り、次tickも再挑戦する）。
  if (!applied) planRef.current = null;
  return applied;
}

/** 複製された一群を検出して対応表を作る（見つからなければ null） */
function detectDuplication(
  elements: readonly any[],
  appState: any,
  known: Set<string>,
  skip: boolean,
): DupPlan | null {
  // 初回（起動直後）は盤面にある要素をすべて「既知」にするだけ。
  // ここで種まきしないと、ロード時の全要素が「新しく現れた一群」に見えて誤った貼り替えをする。
  if (known.size === 0) {
    for (const e of elements) known.add(e.id);
    return null;
  }
  // 今まさに描いている要素は「複製」ではないので対象外（描き始めの1フレームで拾わない）。
  const drawingId = appState?.newElement?.id ?? appState?.editingLinearElement?.elementId;
  const fresh: any[] = [];
  for (const e of elements) if (!known.has(e.id) && e.id !== drawingId) fresh.push(e);
  for (const e of elements) known.add(e.id);
  if (skip || fresh.length === 0) return null;

  // 対応表づくりは安くないので、関係のある新要素が無ければ抜ける。ただし範囲は広く取る:
  //  ・線・矢印 … 「自動接続にかけない」ための登録が要る（繋がっていない飾り線の複製が
  //                勝手に接続されるのを防ぐ・BRU7-056-7）
  //  ・図形     … その図形に**外から繋がっている矢印**を、その場に残る複製へ向け直す必要がある。
  //                【BRU7-056-11】ここを線と参照持ちだけに絞っていたため、素の図形を1つだけ
  //                コピーすると対応表が作られず、握り潰されて負ける旧処理へフォールバックし、
  //                矢印がコピー側へ付いていっていた（＝「図形だけコピーすると再発する」の正体）。
  //  ・参照持ち … フレーム所属や影矩形など、id で他要素を指しているもの
  const hasRef = (e: any) => {
    const cd = e?.customData;
    return !!cd && !!(cd.triStart || cd.triEnd || cd.wbParent || cd.wbBgFor || cd.wbFrameBg);
  };
  if (!fresh.some((e) => isConnector(e) || isConnectableShape(e) || hasRef(e))) return null;

  const freshIds = new Set<string>(fresh.map((e) => e.id));
  const selMap = appState?.selectedElementIds ?? {};
  const selSet = new Set<string>(Object.keys(selMap).filter((k) => selMap[k]));

  // 【BRU7-056-12】複製元の候補を、可能なら「選択されている要素」だけに絞る。
  //
  // 複製は必ず〈新しく現れた側〉と〈選択されている側〉の2つに分かれる。
  //   ・Alt+ドラッグ … 掴んで動くのは複製元（同じid）＝選択されている側
  //   ・貼り付け/Ctrl+D … 置かれるのは複製の方＝選択されている側
  // 前者では複製元が選択中なので、候補を選択中の要素に絞れば対応が一意に決まる。
  //
  // これが無いと、寸法もスタイルも同一の図形が複数ある盤面（同じ大きさの破線矩形が上下に
  // 並んでいる等）で対応付けを誤る。指紋は「見た目・寸法・points・customData」で作るため、
  // 同一の図形どうしは区別できない。図形を1つだけコピーした場合は候補ごとに1票ずつしか
  // 入らず同点になり、先に見つかった方＝コピーしていない図形とペアになってしまう。
  // その結果、矢印の付け替えが空振りして矢印がコピー側へ付いていく（実測の症状）。
  const freshIsSelected = fresh.some((e) => selSet.has(e.id));
  const olds = elements.filter((e) => {
    if (freshIds.has(e.id) || e.isDeleted) return false;
    if (!freshIsSelected && selSet.size > 0) return selSet.has(e.id); // Alt+ドラッグ: 選択中が複製元
    return true;
  });
  if (olds.length === 0) return null;

  // 複製で必ず保たれる値だけで作る「指紋」。位置(x,y)は入れない（平行移動するため）。
  const fp = (e: any) => JSON.stringify([
    e.type, e.width, e.height, e.angle ?? 0, e.strokeColor, e.backgroundColor,
    e.fillStyle, e.strokeWidth, e.strokeStyle, e.roughness, e.opacity,
    e.text ?? null, e.fontSize ?? null, e.fontFamily ?? null,
    Array.isArray(e.points) ? e.points : null, e.customData ?? null,
  ]);
  const oldByFp = new Map<string, any[]>();
  for (const o of olds) {
    const k = fp(o);
    const arr = oldByFp.get(k);
    if (arr) arr.push(o); else oldByFp.set(k, [o]);
  }

  // 一群の平行移動量を多数決で決める（同じ形の要素が偶然そこに在っても最多の差が勝つ）
  const votes = new Map<string, { dx: number; dy: number; n: number }>();
  for (const f of fresh) {
    for (const o of oldByFp.get(fp(f)) ?? []) {
      const dx = f.x - o.x, dy = f.y - o.y;
      const k = `${Math.round(dx * 100)},${Math.round(dy * 100)}`;
      const v = votes.get(k);
      if (v) v.n++; else votes.set(k, { dx, dy, n: 1 });
    }
  }
  if (votes.size === 0) return null;
  let D = { dx: 0, dy: 0, n: 0 };
  for (const v of votes.values()) if (v.n > D.n) D = v;

  const EPS_POS = 0.01;
  const map = new Map<string, string>(); // 複製元id → 複製先id
  for (const f of fresh) {
    const o = (oldByFp.get(fp(f)) ?? []).find((c) =>
      !map.has(c.id) && Math.abs(c.x + D.dx - f.x) <= EPS_POS && Math.abs(c.y + D.dy - f.y) <= EPS_POS);
    if (o) map.set(o.id, f.id);
  }
  if (map.size === 0) return null;

  const selIds = [...selSet];
  // 複製に関わった一群。対応の付いた元＋複製に加えて「新しく現れた要素」と「選択中の要素」も含める。
  // 複製は必ず〈新しく現れた側〉と〈選択されている側〉の2つに分かれるので、指紋照合で1対1の対応が
  // 付かなかった要素（同形が並んでいて絞れない等）があっても、一群の内か外かの判定は正しく効く。
  const batch = new Set<string>([...map.keys(), ...map.values(), ...freshIds, ...selIds]);
  // 持ち出される側＝選択されている方の一群。
  // Alt+ドラッグの最中は「掴んで動いている＝複製元(同じid)」が持ち出される側なので、
  // 選択状態がまだ更新されていない環境向けの保険としてドラッグ中は複製元側も持ち出し扱いにする。
  const draggingNow = !!appState?.selectedElementsAreBeingDragged;
  const carried = new Set<string>(selIds);
  if (draggingNow) for (const id of map.keys()) carried.add(id);

  // 【BRU7-056-10】一群の外にいて「持ち出される図形」に繋がっているコネクタを拾う。
  // Alt+ドラッグでは持ち出されるのは複製元（同じid）なので、そこに繋がっている矢印は
  // そのままだとコピー先へ付いていってしまう。元の位置に残った複製の方へ繋ぎ直すのが正しい
  // （BRU5-068 と同じ意図。ただしあちらは一度きりの書き換えで、握り潰されると復帰できなかった）。
  // 貼り付け／Ctrl+D では持ち出されるのは複製の方なので、複製元に繋がっている矢印は動かさない
  // ＝ carried な図形だけを対象にすることで、両方のケースが自動的に正しくなる。
  const carriedShapes = new Set<string>([...map.keys()].filter((id) => carried.has(id)));
  const external = new Set<string>();
  for (const el of elements) {
    if (el.isDeleted || !isConnector(el)) continue;
    if (freshIds.has(el.id) || carried.has(el.id)) continue;
    const aS = readAnchor(el.customData?.triStart), aE = readAnchor(el.customData?.triEnd);
    if ((aS && carriedShapes.has(aS.id)) || (aE && carriedShapes.has(aE.id))) external.add(el.id);
  }

  // この plan が接続を握るコネクタ。反映が済むまで追従処理には触らせない（奪い合いの防止）。
  const pinned = new Set<string>([...external]);
  for (const el of elements) {
    if (el.isDeleted || !isConnector(el)) continue;
    if (freshIds.has(el.id) || carried.has(el.id)) pinned.add(el.id);
  }

  // 反映されるまで毎tick適用し直す。until は「いつまでも直らない時に諦める」ための保険で、
  // 通常は反映が確認できた時点（applyDupPlan が差分ゼロを返した時点）で破棄される。
  return { map, dups: new Set(map.values()), batch, carried, external, pinned, until: performance.now() + 3000 };
}

/**
 * 対応表どおりに customData の id 参照を書き換える。**冪等**（書き換え済みなら何もしない）。
 * @returns updateScene で反映したら true
 */
function applyDupPlan(api: any, elements: readonly any[], plan: DupPlan): boolean {
  const { map, dups, batch, carried, external } = plan;
  const byId = new Map<string, any>(elements.map((e) => [e.id, e]));
  const carriedShapes = new Set<string>([...map.keys()].filter((id) => carried.has(id)));

  let changed = false;
  const updated = elements.map((el: any) => {
    // 【BRU7-056-10】一群の外の矢印を「持ち出される図形」から「その場に残る複製」へ繋ぎ替える。
    // 記録だけでなく端点も新しいアンカーの位置へ戻すのが要点。端点を放置すると、追従処理が
    // 「アンカーから離れている」と判断して元の図形へ繋ぎ直し、両者が同じ端点を奪い合う。
    if (external.has(el.id) && !el.isDeleted) {
      const cd0 = el.customData;
      const pts0: number[][] = Array.isArray(el.points) ? el.points : [];
      if (!cd0 || pts0.length < 2) return el;
      const aS = readAnchor(cd0.triStart), aE = readAnchor(cd0.triEnd);
      const nS = aS && carriedShapes.has(aS.id) ? map.get(aS.id) : undefined;
      const nE = aE && carriedShapes.has(aE.id) ? map.get(aE.id) : undefined;
      if (!nS && !nE) return el;
      const nextCd = {
        ...cd0,
        ...(nS ? { triStart: { ...aS!, id: nS } } : {}),
        ...(nE ? { triEnd: { ...aE!, id: nE } } : {}),
      };
      const gp = pts0.map((p) => ({ x: el.x + p[0], y: el.y + p[1] }));
      const L0 = gp.length - 1;
      if (nS && byId.has(nS)) gp[0] = anchorToPoint({ ...aS!, id: nS }, byId.get(nS));
      if (nE && byId.has(nE)) gp[L0] = anchorToPoint({ ...aE!, id: nE }, byId.get(nE));
      const ox0 = gp[0].x, oy0 = gp[0].y;
      const np0 = gp.map((p) => [p.x - ox0, p.y - oy0]);
      const xs0 = np0.map((p) => p[0]), ys0 = np0.map((p) => p[1]);
      changed = true;
      return {
        ...el, x: ox0, y: oy0, points: np0,
        width: Math.max(...xs0) - Math.min(...xs0), height: Math.max(...ys0) - Math.min(...ys0),
        customData: nextCd, version: (el.version ?? 1) + 1, versionNonce: rand(),
      };
    }
    const isFresh = dups.has(el.id);
    const isCarried = carried.has(el.id);
    if (el.isDeleted || (!isFresh && !isCarried)) return el;
    const cd = el.customData;
    if (!cd) return el;
    let next: any = null;
    const put = (k: string, v: any) => {
      next = next ?? { ...cd };
      if (v === undefined) delete next[k]; else next[k] = v;
    };

    // 接続（線・矢印の端点）
    const pts: number[][] = Array.isArray(el.points) ? el.points : [];
    for (const key of ["triStart", "triEnd"] as const) {
      const a = readAnchor(cd[key]);
      if (!a) continue;
      if (isFresh) {
        if (dups.has(a.id)) continue; // 既に複製先を指している（貼り替え済み）。冪等性のため触らない
        // 複製された側: 一群の中を指す接続は複製先へ貼り替える（これが本命の修正）
        const nid = map.get(a.id);
        if (nid) { put(key, { ...a, id: nid }); continue; }
        // 一群の中を指しているのに対応が付かなかった場合は切る。
        // 残すと複製元の図形に引かれて画面を横切る長い線になるため、繋がっていない方がまだ良い。
        if (batch.has(a.id)) { put(key, undefined); continue; }
      } else if (batch.has(a.id)) {
        continue; // 複製元側が一群の中を指している＝一緒に動くので正しい。触らない
      }
      // ここから先は「一群の外の図形」への接続。
      if (isCarried) { put(key, undefined); continue; } // 持ち出す側は切り離す（長い線が伸びるのを防ぐ）
      // その場に残る側: 端点が実際にその図形へ触れているなら残す
      const sh = byId.get(a.id);
      if (!sh || !isConnectableShape(sh) || pts.length < 2) { put(key, undefined); continue; }
      const p = key === "triStart" ? pts[0] : pts[pts.length - 1];
      if (distToBox({ x: el.x + p[0], y: el.y + p[1] }, connectBBox(sh)) > TOL) put(key, undefined);
    }
    // 所属（フレーム）と、背景/枠線を描く影矩形の対象。複製された側だけ貼り替える。
    if (isFresh) {
      for (const key of ["wbParent", "wbBgFor", "wbFrameBg"] as const) {
        const v = cd[key];
        if (typeof v !== "string") continue;
        const nid = map.get(v);
        if (nid) put(key, nid);
      }
    }

    if (!next) return el;
    changed = true;
    return { ...el, customData: next, version: (el.version ?? 1) + 1, versionNonce: rand() };
  });
  if (!changed) return false;
  api.updateScene({ elements: updated });
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
  const shapeById = new Map<string, any>(shapes.map((s: any) => [s.id, s]));
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
    const nextCd = {
      ...cd,
      ...(nS ? { triStart: { ...aS!, id: nS } } : {}),
      ...(nE ? { triEnd: { ...aE!, id: nE } } : {}),
    };
    // 【要注意】両端が同じ図形を指していても、片方だけ map に載っていれば片方だけ貼り替わる。
    // その場合コネクタは「複製の側」と「動いた元の側」に引き裂かれて画面を横切る線になる。

    // 【BRU7-056-8】アンカーの付け替えと同時に、端点も新しいアンカーの位置へ戻す。
    // ここで端点を動かさないと、端点は「動いていった元図形」に付いていったままなので、
    // followTriangleConnections が「アンカーから離れている」と判断して元の図形へ繋ぎ直し、
    // 次のtickでまたここが付け替え……と両者が同じ端点を奪い合って往復する（実測済み）。
    // 端点まで戻せば状態が一貫し、矢印は狙いどおり元の位置（＝残った複製）に留まる。
    const pts: number[][] = Array.isArray(el.points) ? el.points : [];
    if (pts.length < 2) return { ...el, customData: nextCd, version: (el.version ?? 1) + 1, versionNonce: rand() };
    const gp = pts.map((p) => ({ x: el.x + p[0], y: el.y + p[1] }));
    const L = gp.length - 1;
    if (nS && shapeById.has(nS)) gp[0] = anchorToPoint({ ...aS!, id: nS }, shapeById.get(nS));
    if (nE && shapeById.has(nE)) gp[L] = anchorToPoint({ ...aE!, id: nE }, shapeById.get(nE));
    const ox = gp[0].x, oy = gp[0].y;
    const np = gp.map((p) => [p.x - ox, p.y - oy]);
    const xs = np.map((p) => p[0]), ys = np.map((p) => p[1]);
    return {
      ...el, x: ox, y: oy, points: np,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
      customData: nextCd, version: (el.version ?? 1) + 1, versionNonce: rand(),
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
    delete nextCd.wbViaFree;
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
  // 「直線に戻す」は明確なユーザー操作なので 1 undo ステップとして記録する（BRU7-058）
  api.updateScene({ elements: updated, ...COMMIT });
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
    const both = !!(aS && aE && sShape && eShape && !isPolyShape(sShape) && !isPolyShape(eShape));

    const S = { x: el.x + pts[0][0], y: el.y + pts[0][1] };
    const E = { x: el.x + pts[pts.length - 1][0], y: el.y + pts[pts.length - 1][1] };
    const rS = both ? anchorToPoint(aS!, sShape) : S;
    const vias = viasToScene(cd, rS); // 手動の折れ点があれば維持したまま折り直す（BRU7-043）
    const route = both
      ? buildFoldedRoute(cd, rS, sideFromAnchor(aS!), vias, anchorToPoint(aE!, eShape), sideFromAnchor(aE!))
      : buildFoldedRoute(cd, S, null, vias, E, null);
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
  // 「折れ線にする」は明確なユーザー操作なので 1 undo ステップとして記録する（BRU7-058）
  api.updateScene({ elements: updated, ...COMMIT });
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
    const both = !!(sShape && eShape && !isPolyShape(sShape) && !isPolyShape(eShape));
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
export function reconnectDraggedConnectors(api: any, appState: any, skipIds?: Set<string>): boolean {
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
    if (!(el.type === "line" || el.type === "arrow") || el.elbowed || isPolyShape(el)) return el; // elbowはネイティブ結合に委ねる
    if (!sel[el.id] || el.id === editId) return el; // ドラッグされたコネクタのみ（端点編集は除外）
    // 【BRU7-056-8】コピー操作で運ばれた線は貼り直さない。
    // ここは「両端を記録どおりのアンカーへ強制的に貼り直す」処理なので、片方の接続先が一緒に動き、
    // もう片方が置いて行かれていると、指を離した瞬間に線が画面を横切って伸びる
    // （＝「移動中は崩れないのに、マウスを離すと崩れる」の正体）。コピーで持ち出した一群は
    // 落とした場所の見た目のままにするのが正しいので、この貼り直しから除外する。
    if (skipIds?.has(el.id)) return el;
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
