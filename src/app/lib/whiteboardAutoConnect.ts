// 線(line)は Excalidraw 標準では図形にバインドしない。
// 端点が図形に近い線を「矢じり無しの矢印(arrow)」に変換してバインドする。
// 見た目は線のままで、図形を動かすと追従するようになる。

interface Pt { x: number; y: number }

const TOL = 12; // 端点がこの距離以内に図形があればバインド対象

export function autoConnectLines(
  api: any,
  elements: readonly any[],
  appState: any,
  processed: Set<string>,
): void {
  const drawingId = appState?.newElement?.id ?? appState?.editingLinearElement?.elementId;
  const shapes = elements.filter(
    (e) => !e.isDeleted && (e.type === "rectangle" || e.type === "diamond" || e.type === "ellipse"),
  );
  if (shapes.length === 0) return;

  const near = (pt: Pt) =>
    shapes.find((s) => pt.x >= s.x - TOL && pt.x <= s.x + s.width + TOL && pt.y >= s.y - TOL && pt.y <= s.y + s.height + TOL);

  let changed = false;
  const boundAdds = new Map<string, { id: string; type: string }[]>();

  const converted = elements.map((el) => {
    if (el.type !== "line" || el.isDeleted) return el;
    if (el.id === drawingId) return el;          // まだ描画中
    if (processed.has(el.id)) return el;          // 処理済み
    if (!Array.isArray(el.points) || el.points.length < 2) return el;
    processed.add(el.id);

    const p0 = el.points[0];
    const pN = el.points[el.points.length - 1];
    const startPt = { x: el.x + p0[0], y: el.y + p0[1] };
    const endPt = { x: el.x + pN[0], y: el.y + pN[1] };
    const sShape = near(startPt);
    const eShape = near(endPt);
    if (!sShape && !eShape) return el;            // どちらも図形に近くない → 線のまま

    changed = true;
    if (sShape) boundAdds.set(sShape.id, [...(boundAdds.get(sShape.id) ?? []), { id: el.id, type: "arrow" }]);
    if (eShape) boundAdds.set(eShape.id, [...(boundAdds.get(eShape.id) ?? []), { id: el.id, type: "arrow" }]);

    // 線 → 矢じり無しの矢印（見た目は線のまま、バインド可能に）
    return {
      ...el,
      type: "arrow",
      startArrowhead: null,
      endArrowhead: null,
      startBinding: sShape ? { elementId: sShape.id, focus: 0, gap: 1 } : null,
      endBinding: eShape ? { elementId: eShape.id, focus: 0, gap: 1 } : null,
      version: (el.version ?? 1) + 1,
      versionNonce: Math.floor(Math.random() * 0x7fffffff),
    };
  });

  if (!changed) return;

  const final = converted.map((el) =>
    boundAdds.has(el.id) ? { ...el, boundElements: [...(el.boundElements ?? []), ...boundAdds.get(el.id)!] } : el,
  );
  api.updateScene({ elements: final });
}
