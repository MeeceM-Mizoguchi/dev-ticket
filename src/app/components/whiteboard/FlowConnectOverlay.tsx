// フロー自動接続（draw.io/Whimsical 風）。図形を1つ選択すると上下左右に「＋」ボタンが出て、
// クリックすると矢印が伸び、その先に同種（またはセレクタで選んだ形）の図形が接続される。
import { useEffect, useRef, useState } from "react";
import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import { elementBBox, isTriangle } from "@/app/lib/whiteboardSnap";
import { isTableCell } from "@/app/lib/whiteboardTable";

type Dir = "up" | "down" | "left" | "right";
type SpawnType = "rectangle" | "diamond" | "ellipse";
const GAP = 90;
const SOFT_BLACK = "#343a40"; // WhiteboardCanvas の既定色と揃える
const FLOW_TYPES: SpawnType[] = ["rectangle", "diamond", "ellipse"];
const SHAPE_LABEL: Record<SpawnType, string> = { rectangle: "□ 四角", diamond: "◇ ひし形", ellipse: "○ 楕円" };

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

interface Box { x: number; y: number; w: number; h: number; el: any }

// convertToExcalidrawElements は線形要素の points[0] を [0,0] にしない（例: [0.5,0]）ことがあり、
// Excalidrawの「正規化」要件を満たさず not normalized エラー/座標破壊を招く。生成後に再正規化する。
function normalizeLinear(el: any) {
  if (!el || !Array.isArray(el.points) || el.points.length === 0) return;
  const [ox, oy] = el.points[0];
  if (ox === 0 && oy === 0) return;
  el.points = el.points.map(([px, py]: number[]) => [px - ox, py - oy]);
  el.x += ox;
  el.y += oy;
  const xs = el.points.map((p: number[]) => p[0]);
  const ys = el.points.map((p: number[]) => p[1]);
  el.width = Math.max(...xs) - Math.min(...xs);
  el.height = Math.max(...ys) - Math.min(...ys);
}

// 三角形要素を生成（TriangleToolButton と同型。line + wbTriangle 印）。
function makeTriangle(x: number, y: number, w: number, h: number): any {
  const els = convertToExcalidrawElements([
    {
      type: "line",
      id: `wb_tri_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      x, y,
      points: [[w / 2, 0], [w, h], [0, h], [w / 2, 0]],
      roughness: 0, strokeWidth: 1, strokeColor: SOFT_BLACK, backgroundColor: "#ffffff",
    } as any,
  ], { regenerateIds: false }) as any[];
  els.forEach((e) => { if (e.type === "line") normalizeLinear(e); });
  if (els[0]) els[0].customData = { ...(els[0].customData ?? {}), wbTriangle: true };
  return els[0];
}

function sceneToLocal(api: any, containerRef: React.RefObject<HTMLDivElement | null>, sx: number, sy: number) {
  const st = api.getAppState();
  const rect = containerRef.current?.getBoundingClientRect();
  const zoom = st.zoom?.value ?? 1;
  const pageX = sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0);
  const pageY = sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0);
  return { x: pageX - (rect?.left ?? 0), y: pageY - (rect?.top ?? 0) };
}

export function FlowConnectOverlay({ api, containerRef, canEdit }: Props) {
  const [box, setBox] = useState<Box | null>(null);
  const [spawnType, setSpawnType] = useState<SpawnType>("rectangle");
  const raf = useRef<number>(0);
  const sigRef = useRef<string>("");

  // 選択中の単一図形を監視してボタン位置を更新（内容が変わった時だけsetState）
  useEffect(() => {
    if (!canEdit) { setBox(null); return; }
    const tick = () => {
      try {
        const st = api.getAppState();
        const sel = st.selectedElementIds || {};
        const ids = Object.keys(sel).filter((id) => sel[id]);
        // 新規描画/リサイズ/テキスト編集/範囲選択/点編集中はボタンを出さない（操作の邪魔をしない）
        const interacting = !!(st.newElement || st.resizingElement || st.editingTextElement || st.selectionElement || st.editingLinearElement);
        const el = ids.length === 1 && !interacting
          ? api.getSceneElements().find((e: any) => e.id === ids[0] && !e.isDeleted)
          : null;
        // 表（BRU5-042）のセルも rectangle だが、フロー接続の対象外。表には行/列の追加・削除UI
        // （TableRowColControls）を別途出すため、こちらの＋ボタン・図形変換メニューは表では出さない。
        const isShape = el && (el.type === "rectangle" || el.type === "diamond" || el.type === "ellipse") && !isTableCell(el);
        const isTri = el && isTriangle(el);
        if (isShape || isTri) {
          // 三角形は element.x/y が bbox 左上でないため elementBBox を使う
          const bb = isTri ? elementBBox(el) : { x: el.x, y: el.y, w: el.width, h: el.height };
          const sig = `${el.id}:${bb.x}:${bb.y}:${bb.w}:${bb.h}:${el.type}:${st.zoom?.value}:${st.scrollX}:${st.scrollY}`;
          if (sig !== sigRef.current) {
            sigRef.current = sig;
            const tl = sceneToLocal(api, containerRef, bb.x, bb.y);
            const br = sceneToLocal(api, containerRef, bb.x + bb.w, bb.y + bb.h);
            setBox({ x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y, el });
          }
        } else if (sigRef.current !== "") {
          sigRef.current = "";
          setBox(null);
        }
      } catch { /* noop */ }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [api, canEdit, containerRef]);

  const connect = (dir: Dir) => {
    const src = box?.el;
    if (!src) return;
    const srcTri = isTriangle(src);
    // 三角形は element.x/y が bbox 左上でないため elementBBox で寸法を取る
    const sb = srcTri ? elementBBox(src) : { x: src.x, y: src.y, w: src.width, h: src.height };
    const w = sb.w, h = sb.h;
    let nx = sb.x, ny = sb.y;
    if (dir === "right") { nx = sb.x + w + GAP; ny = sb.y; }
    if (dir === "left") { nx = sb.x - w - GAP; ny = sb.y; }
    if (dir === "down") { ny = sb.y + h + GAP; nx = sb.x; }
    if (dir === "up") { ny = sb.y - h - GAP; nx = sb.x; }

    // 始点＝元図形のエッジ中点、終点＝新図形の対向エッジ中点
    let sx = sb.x, sy = sb.y, ex = nx, ey = ny;
    if (dir === "right") { sx = sb.x + w; sy = sb.y + h / 2; ex = nx; ey = ny + h / 2; }
    if (dir === "left") { sx = sb.x; sy = sb.y + h / 2; ex = nx + w; ey = ny + h / 2; }
    if (dir === "down") { sx = sb.x + w / 2; sy = sb.y + h; ex = nx + w / 2; ey = ny; }
    if (dir === "up") { sx = sb.x + w / 2; sy = sb.y; ex = nx + w / 2; ey = ny + h; }

    // 新図形（元と同種）＋素の矢印を生成。両端の接続(customData)・固定・追従は autoConnect/follow に任せる。
    const shape = srcTri
      ? makeTriangle(nx, ny, w, h)
      : (convertToExcalidrawElements([
          { type: spawnType, id: `wb_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            x: nx, y: ny, width: w, height: h, roughness: 0, strokeWidth: 1, strokeColor: SOFT_BLACK, backgroundColor: "#ffffff" } as any,
        ]) as any[])[0];
    const arrow = (convertToExcalidrawElements([
      { type: "arrow", x: sx, y: sy, points: [[0, 0], [ex - sx, ey - sy]],
        roughness: 0, strokeWidth: 1, strokeColor: SOFT_BLACK, endArrowhead: "triangle" } as any,
    ]) as any[])[0];
    normalizeLinear(arrow);
    api.updateScene({ elements: [...api.getSceneElements(), shape, arrow] });
    if (shape) api.updateScene({ appState: { selectedElementIds: { [shape.id]: true } } });
  };

  // 選択中の図形の種類を変更（四角/ひし形/楕円は同構造なので type 差し替えで変換）
  const changeShapeType = (t: SpawnType) => {
    setSpawnType(t);
    const src = box?.el;
    if (!src) return;
    const els = api.getSceneElements().map((e: any) =>
      e.id === src.id
        ? { ...e, type: t, version: (e.version ?? 1) + 1, versionNonce: Math.floor(Math.random() * 0x7fffffff) }
        : e,
    );
    api.updateScene({ elements: els });
  };

  if (!box) return null;
  const srcTri = isTriangle(box.el);
  const spawnLabel = srcTri ? "△ 三角形" : SHAPE_LABEL[spawnType];
  const btn = (dir: Dir, left: number, top: number) => (
    <button
      key={dir}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => { e.stopPropagation(); connect(dir); }}
      title={`${spawnLabel}を${{ up: "上", down: "下", left: "左", right: "右" }[dir]}に接続`}
      style={{
        position: "absolute", left, top, width: 22, height: 22, transform: "translate(-50%,-50%)",
        display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto",
        background: "#059669", color: "#fff", border: "2px solid #fff", borderRadius: "50%",
        fontSize: 14, lineHeight: 1, cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
      }}
    >＋</button>
  );

  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const off = 18;
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 20, pointerEvents: "none" }}>
      {btn("up", cx, box.y - off)}
      {btn("down", cx, box.y + box.h + off)}
      {btn("left", box.x - off, cy)}
      {btn("right", box.x + box.w + off, cy)}
      {/* 図形の種類セレクタ（選択中の図形を変換 ＋ 追加する図形の既定）。三角形には出さない */}
      {!srcTri && (
      <div style={{ position: "absolute", left: box.x, top: box.y - 40, display: "flex", gap: 4, pointerEvents: "auto" }}>
        {FLOW_TYPES.map((t) => {
          const activeType = box.el.type === t;
          return (
            <button key={t} onMouseDown={(e) => e.preventDefault()} onClick={() => changeShapeType(t)}
              title={`この図形を${SHAPE_LABEL[t]}に変更`}
              style={{
                padding: "3px 8px", fontSize: 11, borderRadius: 6, cursor: "pointer",
                border: "1px solid rgba(0,0,0,0.1)", background: activeType ? "#059669" : "#fff",
                color: activeType ? "#fff" : "#444",
              }}>{SHAPE_LABEL[t]}</button>
          );
        })}
      </div>
      )}
    </div>
  );
}
