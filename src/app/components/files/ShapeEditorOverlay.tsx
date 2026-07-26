import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DrawingObject } from "@/app/lib/xlsxDrawing";

// ENHA2-035 / BRU7-054 図形エディタ（B1・常時操作可）
//
// DrawingObject を移動・リサイズ・削除・テキスト編集・色・揃え・吹き出しの尾まで編集できる。
// コンテナは pointer-events:none で、図形自体だけがイベントを拾う（＝図形以外はセル編集に透過）。

export type AddKind = "rect" | "roundRect" | "ellipse" | "callout" | "line" | "arrow" | "text";
export type HAlign = "left" | "center" | "right";
export type VAlign = "top" | "middle" | "bottom";
export interface SelectInfo { hAlign?: HAlign; vAlign?: VAlign; fill?: string | null; line?: string | null; textColor?: string }

export interface ShapeEditorHandle {
  addShape: (kind: AddKind) => void;
  recolorFill: (color: string) => void;
  recolorLine: (color: string) => void;
  recolorText: (color: string) => void;
  setHAlign: (a: HAlign) => void;
  setVAlign: (a: VAlign) => void;
  deleteSelected: () => void;
  bring: (dir: "front" | "back") => void;
  deselect: () => void;
  hasSelection: () => boolean;
}

interface Props {
  initialObjects: DrawingObject[];
  offsetLeft: number; offsetTop: number;
  width: number; height: number;
  onDirty: (objects: DrawingObject[], changedAnchors: number[]) => void;
  onSelectChange?: (info: SelectInfo | null) => void;
}

const ARROW_GEOMS = new Set(["downArrow", "upArrow", "leftArrow", "rightArrow"]);

function arrowPoints(geom: string, w: number, h: number): string {
  const p = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  switch (geom) {
    case "downArrow": return p([[w * .3, 0], [w * .7, 0], [w * .7, h * .55], [w, h * .55], [w * .5, h], [0, h * .55], [w * .3, h * .55]]);
    case "upArrow": return p([[w * .5, 0], [w, h * .45], [w * .7, h * .45], [w * .7, h], [w * .3, h], [w * .3, h * .45], [0, h * .45]]);
    case "rightArrow": return p([[0, h * .3], [w * .55, h * .3], [w * .55, 0], [w, h * .5], [w * .55, h], [w * .55, h * .7], [0, h * .7]]);
    case "leftArrow": return p([[w * .45, 0], [w * .45, h * .3], [w, h * .3], [w, h * .7], [w * .45, h * .7], [w * .45, h], [0, h * .5]]);
    default: return "";
  }
}

// 吹き出しの尾（三角形）の頂点を計算：尾先端＝(fx*w, fy*h)、底辺は最寄り辺上
function calloutTail(w: number, h: number, adj: { fx: number; fy: number }): string | null {
  const tx = adj.fx * w, ty = adj.fy * h;
  const bh = Math.min(w, h) * 0.16;
  const inside = tx >= 0 && tx <= w && ty >= 0 && ty <= h;
  if (inside) return null;
  let b1: [number, number], b2: [number, number];
  if (ty > h) { const cx = Math.max(bh, Math.min(w - bh, tx)); b1 = [cx - bh, h]; b2 = [cx + bh, h]; }
  else if (ty < 0) { const cx = Math.max(bh, Math.min(w - bh, tx)); b1 = [cx - bh, 0]; b2 = [cx + bh, 0]; }
  else if (tx > w) { const cy = Math.max(bh, Math.min(h - bh, ty)); b1 = [w, cy - bh]; b2 = [w, cy + bh]; }
  else { const cy = Math.max(bh, Math.min(h - bh, ty)); b1 = [0, cy - bh]; b2 = [0, cy + bh]; }
  return `${b1[0]},${b1[1]} ${tx},${ty} ${b2[0]},${b2[1]}`;
}

// コネクタの2端点（flip で向きを表現）
function connEndpoints(o: DrawingObject): [{ x: number; y: number }, { x: number; y: number }] {
  const p1 = { x: o.x + (o.flipH ? o.w : 0), y: o.y + (o.flipV ? o.h : 0) };
  const p2 = { x: o.x + (o.flipH ? 0 : o.w), y: o.y + (o.flipV ? 0 : o.h) };
  return [p1, p2];
}
function boxFromEndpoints(p1: { x: number; y: number }, p2: { x: number; y: number }): Partial<DrawingObject> {
  return { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y), flipH: p1.x > p2.x, flipV: p1.y > p2.y };
}

let uidSeq = 0;
const newId = () => `new_${uidSeq++}`;

export const ShapeEditorOverlay = forwardRef<ShapeEditorHandle, Props>(function ShapeEditorOverlay(
  { initialObjects, offsetLeft, offsetTop, width, height, onDirty, onSelectChange }, ref,
) {
  const [objects, setObjects] = useState<DrawingObject[]>(() => initialObjects.map(o => ({ ...o })));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const changedRef = useRef<Set<number>>(new Set());
  const objectsRef = useRef(objects);
  const rootRef = useRef<HTMLDivElement>(null);
  objectsRef.current = objects;

  useEffect(() => {
    const o = objects.find(x => x.id === selectedId);
    onSelectChange?.(o ? {
      hAlign: o.paragraphs?.[0]?.align, vAlign: o.vAlign,
      fill: o.fill, line: o.line?.color, textColor: o.paragraphs?.[0]?.runs?.[0]?.color,
    } : null);
  }, [selectedId, objects, onSelectChange]);

  const commit = useCallback((next: DrawingObject[]) => {
    objectsRef.current = next;
    setObjects(next);
    onDirty(next, Array.from(changedRef.current));
  }, [onDirty]);

  const markChanged = (o: DrawingObject) => { if (o.anchorIndex !== undefined) changedRef.current.add(o.anchorIndex); };

  const updateObject = useCallback((id: string, patch: Partial<DrawingObject>) => {
    commit(objectsRef.current.map(o => { if (o.id !== id) return o; markChanged(o); return { ...o, ...patch }; }));
  }, [commit]);

  const selected = () => objectsRef.current.find(o => o.id === selectedId);

  // ── ドラッグ（移動・リサイズ・尾）─────────────────────────
  const drag = useRef<{ id: string; mode: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; ofx: number; ofy: number; e1x: number; e1y: number; e2x: number; e2y: number } | null>(null);

  const startDrag = (e: React.PointerEvent, o: DrawingObject, mode: string) => {
    if (e.button !== 0) return; // 右クリックでは掴まない（右クリックはセル/図形メニュー側へ）
    e.stopPropagation();
    setSelectedId(o.id);
    const [p1, p2] = connEndpoints(o);
    drag.current = { id: o.id, mode, sx: e.clientX, sy: e.clientY, ox: o.x, oy: o.y, ow: o.w, oh: o.h, ofx: o.adj?.fx ?? 0.5, ofy: o.adj?.fy ?? 0.5, e1x: p1.x, e1y: p1.y, e2x: p2.x, e2y: p2.y };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (d.mode === "tail") { updateObject(d.id, { adj: { fx: d.ofx + dx / Math.max(d.ow, 1), fy: d.ofy + dy / Math.max(d.oh, 1) } }); return; }
      if (d.mode === "p1" || d.mode === "p2") {
        const e1 = d.mode === "p1" ? { x: d.e1x + dx, y: d.e1y + dy } : { x: d.e1x, y: d.e1y };
        const e2 = d.mode === "p2" ? { x: d.e2x + dx, y: d.e2y + dy } : { x: d.e2x, y: d.e2y };
        updateObject(d.id, boxFromEndpoints(e1, e2));
        return;
      }
      let { ox: x, oy: y, ow: w, oh: h } = d;
      const MIN = 8;
      if (d.mode === "move") { x = d.ox + dx; y = d.oy + dy; }
      else {
        if (d.mode.includes("e")) w = Math.max(MIN, d.ow + dx);
        if (d.mode.includes("s")) h = Math.max(MIN, d.oh + dy);
        if (d.mode.includes("w")) { w = Math.max(MIN, d.ow - dx); x = d.ox + (d.ow - w); }
        if (d.mode.includes("n")) { h = Math.max(MIN, d.oh - dy); y = d.oy + (d.oh - h); }
      }
      updateObject(d.id, { x, y, w, h });
    };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [updateObject]);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    const t = objectsRef.current.find(o => o.id === selectedId);
    if (t) markChanged(t);
    commit(objectsRef.current.filter(o => o.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, commit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingId) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteSelected(); }
      else if (e.key === "Escape" && selectedId) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId, selectedId, deleteSelected]);

  // ── 命令ハンドル ──────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    addShape: (kind) => {
      let o: DrawingObject;
      if (kind === "line" || kind === "arrow") {
        // 真横の直線で追加（h=0）。端点は選択時のハンドルで自由に伸ばせる
        o = { id: newId(), kind: "connector", x: 40, y: 60, w: 220, h: 0, rot: 0, flipH: false, flipV: false, anchorIndex: undefined,
          geom: "straightConnector1", line: { color: "#334155", width: 2 }, arrowHead: false, arrowTail: kind === "arrow" };
      } else {
        o = { id: newId(), kind: "shape", x: 40, y: 40, w: 170, h: kind === "text" ? 40 : 96, rot: 0, flipH: false, flipV: false, anchorIndex: undefined,
          geom: kind === "ellipse" ? "ellipse" : kind === "roundRect" ? "roundRect" : kind === "callout" ? "wedgeRoundRectCallout" : "rect",
          fill: kind === "text" ? null : "#FDE68A", line: kind === "text" ? null : { color: "#B45309", width: 1.5 },
          vAlign: "middle",
          adj: kind === "callout" ? { fx: 0.22, fy: 1.4 } : undefined,
          paragraphs: [{ align: "center", runs: [{ text: kind === "text" ? "テキスト" : "文字", bold: false, italic: false, sizePx: 16, color: "#1A1714" }] }] };
      }
      commit([...objectsRef.current, o]);
      setSelectedId(o.id);
    },
    recolorFill: (color) => { if (selectedId) updateObject(selectedId, { fill: color }); },
    recolorLine: (color) => { const o = selected(); if (o) updateObject(o.id, { line: { color, width: o.line?.width ?? 1.5 } }); },
    recolorText: (color) => {
      const o = selected(); if (!o) return;
      const ps = (o.paragraphs && o.paragraphs.length ? o.paragraphs : [{ align: "center" as HAlign, runs: [{ text: "", bold: false, italic: false, sizePx: 16, color }] }])
        .map(p => ({ ...p, runs: p.runs.map(r => ({ ...r, color })) }));
      updateObject(o.id, { paragraphs: ps });
    },
    setHAlign: (a) => { const o = selected(); if (!o?.paragraphs) return; updateObject(o.id, { paragraphs: o.paragraphs.map(p => ({ ...p, align: a })) }); },
    setVAlign: (a) => { if (selectedId) updateObject(selectedId, { vAlign: a }); },
    deleteSelected,
    bring: (dir) => {
      if (!selectedId) return;
      const arr = [...objectsRef.current];
      const idx = arr.findIndex(o => o.id === selectedId);
      if (idx < 0) return;
      const [it] = arr.splice(idx, 1); markChanged(it);
      if (dir === "front") arr.push(it); else arr.unshift(it);
      commit(arr);
    },
    deselect: () => setSelectedId(null),
    hasSelection: () => !!selectedId,
  }), [selectedId, updateObject, deleteSelected, commit]);

  // ── 図形本体の描画 ────────────────────────────────────────
  const renderBody = (o: DrawingObject, editing = false) => {
    if (o.kind === "image") {
      return <img src={o.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "fill", maxWidth: "none", maxHeight: "none", pointerEvents: "none" }} />;
    }
    // shape（connector は別ブランチで描画）
    const vJustify = o.vAlign === "top" ? "flex-start" : o.vAlign === "bottom" ? "flex-end" : "center";
    // 編集中はラベルを出さない（contentEditable と二重表示になるため）
    const label = !editing && o.paragraphs && o.paragraphs.length > 0 ? (
      <div style={{ width: "100%", padding: 3, boxSizing: "border-box", pointerEvents: "none" }}>
        {o.paragraphs.map((p, i) => (
          <div key={i} style={{ textAlign: p.align }}>
            {p.runs.map((r, j) => <span key={j} style={{ fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? "italic" : "normal", fontSize: r.sizePx, color: r.color }}>{r.text}</span>)}
          </div>
        ))}
      </div>
    ) : null;

    if (o.geom && ARROW_GEOMS.has(o.geom)) {
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width={o.w} height={o.h} viewBox={`0 0 ${o.w} ${o.h}`} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <polygon points={arrowPoints(o.geom, o.w, o.h)} fill={o.fill ?? "transparent"} stroke={o.line?.color ?? "none"} strokeWidth={o.line?.width ?? 0} />
          </svg>
          {label}
        </div>
      );
    }

    // 吹き出し：本体（角丸）＋尾（三角）
    if (o.geom && /callout/i.test(o.geom) && o.adj) {
      const tail = calloutTail(o.w, o.h, o.adj);
      return (
        <div style={{ position: "relative", width: "100%", height: "100%", display: "flex", alignItems: vJustify, justifyContent: "center" }}>
          {tail && (
            <svg style={{ position: "absolute", inset: 0, overflow: "visible", pointerEvents: "none" }} width={o.w} height={o.h}>
              <polygon points={tail} fill={o.fill ?? "#fff"} stroke={o.line?.color ?? "none"} strokeWidth={o.line?.width ?? 0} />
            </svg>
          )}
          <div style={{ position: "absolute", inset: 0, background: o.fill ?? "transparent", border: o.line ? `${o.line.width}px solid ${o.line.color}` : "none", borderRadius: `${Math.min(o.w, o.h) * 0.14}px`, pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 1, width: "100%" }}>{label}</div>
        </div>
      );
    }

    const radius = o.geom === "ellipse" ? "50%" : o.geom === "roundRect" ? `${Math.min(o.w, o.h) * 0.16}px` : "0";
    return (
      <div style={{ width: "100%", height: "100%", boxSizing: "border-box", background: o.fill ?? "transparent",
        border: o.line ? `${o.line.width}px solid ${o.line.color}` : "none", borderRadius: radius,
        display: "flex", alignItems: vJustify, justifyContent: "center", overflow: "hidden" }}>{label}</div>
    );
  };

  const commitText = (o: DrawingObject, text: string) => {
    const prev = o.paragraphs?.[0]?.runs?.[0];
    const align = (o.paragraphs?.[0]?.align ?? "center") as HAlign;
    // 改行ごとに段落を分ける（＝図形内でも改行が反映される）
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const paragraphs = text
      ? lines.map(line => ({ align, runs: [{ text: line, bold: prev?.bold ?? false, italic: prev?.italic ?? false, sizePx: prev?.sizePx ?? 16, color: prev?.color ?? "#1A1714" }] }))
      : [];
    updateObject(o.id, { paragraphs });
    setEditingId(null);
  };

  // 右クリックは図形に吸わせず、下のセル（Handsontable）へ転送する。
  // オーバーレイを一瞬 visibility:hidden にして真下の要素へ contextmenu を再送する。
  const forwardContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const root = rootRef.current;
    if (!root) return;
    const prev = root.style.visibility;
    root.style.visibility = "hidden";
    const under = document.elementFromPoint(e.clientX, e.clientY);
    root.style.visibility = prev;
    under?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: e.clientX, clientY: e.clientY, button: 2 }));
  };

  // コンテナは pointer-events:none（＝図形以外の空白はセル編集へ透過）
  return (
    <div ref={rootRef} style={{ position: "absolute", left: offsetLeft, top: offsetTop, width, height, pointerEvents: "none" }}>
      {objects.map(o => {
        const sel = o.id === selectedId;

        // ── コネクタ（直線・矢印）：端点ハンドルで両端を自由に動かす ──
        if (o.kind === "connector") {
          const [p1, p2] = connEndpoints(o);
          const minX = Math.min(p1.x, p2.x), minY = Math.min(p1.y, p2.y);
          const sw = Math.max(Math.abs(p2.x - p1.x), 1), sh = Math.max(Math.abs(p2.y - p1.y), 1);
          const c = o.line?.color ?? "#000", wdt = o.line?.width ?? 1;
          const l = (p: { x: number; y: number }) => ({ x: p.x - minX, y: p.y - minY });
          const a = l(p1), b = l(p2), mid = `me${o.id}`;
          return (
            <div key={o.id} onContextMenu={forwardContextMenu}>
              <svg style={{ position: "absolute", left: minX, top: minY, overflow: "visible", pointerEvents: "none" }} width={sw} height={sh}>
                <defs><marker id={mid} markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill={c} /></marker></defs>
                {/* 透明の太線＝つかみやすい移動ヒット領域 */}
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14}
                  style={{ pointerEvents: "stroke", cursor: "move" }} onPointerDown={e => startDrag(e as any, o, "move")} />
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={c} strokeWidth={wdt}
                  markerEnd={o.arrowTail ? `url(#${mid})` : undefined} markerStart={o.arrowHead ? `url(#${mid})` : undefined} style={{ pointerEvents: "none" }} />
              </svg>
              {sel && ([["p1", p1], ["p2", p2]] as const).map(([m, p]) => (
                <div key={m} onPointerDown={e => startDrag(e, o, m)} title="端点"
                  style={{ position: "absolute", left: p.x - 6, top: p.y - 6, width: 12, height: 12, background: "#fff", border: "2px solid #2563EB", borderRadius: "50%", cursor: "grab", pointerEvents: "auto" }} />
              ))}
            </div>
          );
        }

        // ── 図形・画像 ──
        const transform = [o.rot ? `rotate(${o.rot}deg)` : "", o.flipH ? "scaleX(-1)" : "", o.flipV ? "scaleY(-1)" : ""].filter(Boolean).join(" ");
        const box: CSSProperties = { position: "absolute", left: o.x, top: o.y, width: o.w, height: o.h, transform: transform || undefined, transformOrigin: "center center", cursor: "move", pointerEvents: "auto" };
        const hAlign = (o.paragraphs?.[0]?.align ?? "center") as HAlign;
        const vJustify = o.vAlign === "top" ? "flex-start" : o.vAlign === "bottom" ? "flex-end" : "center";
        const initialText = o.paragraphs?.map(p => p.runs.map(r => r.text).join("")).join("\n") ?? "";
        return (
          <div key={o.id}>
            <div style={box}
              onPointerDown={e => { if (editingId !== o.id) startDrag(e, o, "move"); }}
              onContextMenu={forwardContextMenu}
              onDoubleClick={e => { if (o.kind === "shape") { e.stopPropagation(); setEditingId(o.id); } }}>
              {renderBody(o, editingId === o.id)}
              {editingId === o.id && (
                // Enter=改行 / 枠外クリック=確定 / Esc=取消。設定した水平・垂直揃えを反映
                <div style={{ position: "absolute", inset: 0, border: "2px solid #2563EB", background: "#FFFFFF", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: vJustify, padding: 3, pointerEvents: "auto", overflow: "auto" }}
                  onPointerDown={e => e.stopPropagation()}>
                  <div contentEditable suppressContentEditableWarning
                    ref={el => { if (el && el.dataset.init !== "1") { el.dataset.init = "1"; el.innerText = initialText; el.focus(); const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } }}
                    onBlur={e => commitText(o, (e.currentTarget as HTMLElement).innerText)}
                    onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setEditingId(null); } }}
                    style={{ width: "100%", textAlign: hAlign, outline: "none", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }} />
                </div>
              )}
            </div>
            {sel && editingId !== o.id && (
              <>
                <div style={{ position: "absolute", left: o.x, top: o.y, width: o.w, height: o.h, border: "1.5px solid #2563EB", pointerEvents: "none", boxSizing: "border-box" }} />
                {(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const).map(pos => {
                  const hx = pos.includes("w") ? o.x : pos.includes("e") ? o.x + o.w : o.x + o.w / 2;
                  const hy = pos.includes("n") ? o.y : pos.includes("s") ? o.y + o.h : o.y + o.h / 2;
                  const cur = pos === "n" || pos === "s" ? "ns-resize" : pos === "e" || pos === "w" ? "ew-resize" : pos === "ne" || pos === "sw" ? "nesw-resize" : "nwse-resize";
                  return <div key={pos} onPointerDown={e => startDrag(e, o, pos)}
                    style={{ position: "absolute", left: hx - 5, top: hy - 5, width: 10, height: 10, background: "#fff", border: "1.5px solid #2563EB", borderRadius: 2, cursor: cur, pointerEvents: "auto" }} />;
                })}
                {o.geom && /callout/i.test(o.geom) && o.adj && (
                  <div onPointerDown={e => startDrag(e, o, "tail")} title="吹き出しの向き"
                    style={{ position: "absolute", left: o.x + o.adj.fx * o.w - 6, top: o.y + o.adj.fy * o.h - 6, width: 12, height: 12, background: "#F59E0B", border: "2px solid #fff", borderRadius: "50%", cursor: "grab", pointerEvents: "auto", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
});
