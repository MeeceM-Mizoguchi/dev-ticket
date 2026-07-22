// 折れ線に「手動の折れ点（経由点）」を好きなだけ足すためのオーバーレイ（BRU7-043）。
//
// 自前の折れ線(wbFolded)は両端のアンカーから毎フレーム経路を引き直すため、Excalidraw 標準の
// 点編集で中間点を足しても次のフレームで消える。そこで折れ点は customData.wbVias に持たせ、
// ここでは「つまみをドラッグして wbVias を書き換える」ことだけを行う（経路の計算は
// whiteboardAutoConnect 側の routeOrthogonalVia / routeFreeVia が一手に引き受ける）。
//
// つまみは2種類:
//   ・折れ点つまみ（濃い丸）… 既存の折れ点。ドラッグで移動、ダブルクリックで削除。
//   ・追加つまみ（薄い丸）  … 各区間の中点。ドラッグするとその位置に折れ点が1つ増える。
// 直線区間に打った折れ点は経路計算側で畳まれるため、「その区間を平行移動する」操作としても働く。
//
// 座標変換とDOM構築は TableResizeOverlay と同じ方式（React再レンダーを挟まない命令的な更新）。
import { useEffect, useRef } from "react";
import { applyConnectorVias, foldedRouteInfo, type RouteInfo } from "@/app/lib/whiteboardAutoConnect";

interface Props {
  api: any;
  containerRef: React.RefObject<HTMLDivElement | null>;
  canEdit: boolean;
}

interface Pt { x: number; y: number }

const ACCENT = "#6965db";  // Excalidraw の選択色
const VIA_SIZE = 11;       // 折れ点つまみの直径(px・画面)
const ADD_SIZE = 9;        // 追加つまみの直径(px・画面)
const SNAP_PX = 7;         // 端点・他の折れ点と軸を揃えるスナップ距離(px・画面)
const MIN_SEG_PX = 22;     // これより短い区間には追加つまみを出さない（つまみ同士が重なるため）

type Drag = { id: string; viaIndex: number; vias: Pt[] } | null;

export function ConnectorViaOverlay({ api, containerRef, canEdit }: Props) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const structRef = useRef<string>("");

  useEffect(() => {
    if (!canEdit) return;
    const container = containerRef.current;
    const layer = layerRef.current;
    if (!container || !layer) return;

    let raf = 0;

    // 折れ点つまみを出す対象（＝単独選択された自前の折れ線）と、その経路情報。
    // 描画中・ドラッグ中・リサイズ中・標準の点編集中は出さない（操作の邪魔をしない）。
    const readTarget = (): { id: string; info: RouteInfo } | null => {
      const st = api.getAppState();
      if (st.newElement || st.resizingElement || st.selectionElement || st.isResizing) return null;
      if (st.selectedElementsAreBeingDragged || st.editingLinearElement) return null;
      const sel = st.selectedElementIds ?? {};
      const ids = Object.keys(sel).filter((k) => sel[k]);
      if (ids.length !== 1) return null; // 複数選択中は出さない（どの線の折れ点か曖昧になる）
      const elements = api.getSceneElements() as any[];
      const el = elements.find((e) => e.id === ids[0]);
      if (!el || !el.customData?.wbFolded) return null;
      const info = foldedRouteInfo(el, elements);
      if (!info || info.route.length < 2) return null;
      return { id: el.id, info };
    };

    // 点 p が経路上のどのあたりにあるか（区間index + 区間内の比率）を返す。
    // 折れ点は「経路の頂点」とは限らない（直線区間に打った点は頂点としては畳まれる）ので、
    // 頂点一致ではなく“経路に沿った位置”で並び順を決める。
    const routePos = (p: Pt, route: Pt[]): number => {
      let best = 0, bestD = Infinity;
      for (let i = 0; i < route.length - 1; i++) {
        const a = route[i], b = route[i + 1];
        const vx = b.x - a.x, vy = b.y - a.y;
        const len2 = vx * vx + vy * vy;
        const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2)) : 0;
        const d = Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
        if (d < bestD) { bestD = d; best = i + t; }
      }
      return best;
    };

    // 経路上の点 p に折れ点を新設する時の、wbVias 配列での挿入位置（始点→終点の順を保つ）。
    const insertIndexAt = (info: RouteInfo, p: Pt): number => {
      const at = routePos(p, info.route);
      return info.vias.filter((v) => routePos(v, info.route) < at).length;
    };

    const zoomOf = () => api.getAppState().zoom?.value ?? 1;
    // 画面(client)座標 → scene座標
    const toScene = (cx: number, cy: number): Pt => {
      const st = api.getAppState();
      const zoom = st.zoom?.value ?? 1;
      return {
        x: (cx - (st.offsetLeft ?? 0)) / zoom - st.scrollX,
        y: (cy - (st.offsetTop ?? 0)) / zoom - st.scrollY,
      };
    };

    // 端点・他の折れ点と軸を揃える（縦横が揃った綺麗な経路を作りやすくする）。
    const snap = (p: Pt, info: RouteInfo, exclude: number): Pt => {
      const tol = SNAP_PX / zoomOf();
      const targets: Pt[] = [info.S, info.E, ...info.vias.filter((_, i) => i !== exclude)];
      let x = p.x, y = p.y, bx = tol, by = tol;
      for (const t of targets) {
        const dx = Math.abs(t.x - p.x), dy = Math.abs(t.y - p.y);
        if (dx <= bx) { bx = dx; x = t.x; }
        if (dy <= by) { by = dy; y = t.y; }
      }
      return { x, y };
    };

    const onDown = (e: PointerEvent) => {
      const h = e.target as HTMLElement;
      const kind = h.dataset.kind as "via" | "add" | undefined;
      if (!kind) return;
      const t = readTarget();
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      h.setPointerCapture?.(e.pointerId);
      const vias = t.info.vias.map((v) => ({ ...v }));
      if (kind === "via") {
        dragRef.current = { id: t.id, viaIndex: Number(h.dataset.index), vias };
      } else {
        // 掴んだ区間の中点に折れ点を新設する（掴んだ瞬間は形を変えず、動かした分だけ折れる）
        const seg = Number(h.dataset.index);
        const a = t.info.route[seg], b = t.info.route[seg + 1];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const at = insertIndexAt(t.info, mid);
        const p = snap(toScene(e.clientX, e.clientY), t.info, -1);
        vias.splice(at, 0, p);
        dragRef.current = { id: t.id, viaIndex: at, vias };
        applyConnectorVias(api, t.id, vias, false);
      }
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const elements = api.getSceneElements() as any[];
      const el = elements.find((x) => x.id === d.id);
      const info = el ? foldedRouteInfo(el, elements) : null;
      if (!info) return;
      const p = snap(toScene(e.clientX, e.clientY), info, d.viaIndex);
      d.vias[d.viaIndex] = p;
      applyConnectorVias(api, d.id, d.vias, false);
      // ドラッグ中はつまみを作り直さない。掴んでいるものだけ（スナップ後の位置へ）追従させる。
      const h = e.target as HTMLElement;
      if (h?.dataset?.kind) {
        const st = api.getAppState();
        const rect = container.getBoundingClientRect();
        const zoom = st.zoom?.value ?? 1;
        h.style.left = `${p.x * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left - VIA_SIZE / 2}px`;
        h.style.top = `${p.y * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top - VIA_SIZE / 2}px`;
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      // 指を離したフレームで「外しても経路が変わらない」折れ点（クリックしただけの点・重複点）を掃除する。
      // ※ここで structRef を潰してつまみを作り直すと、削除用の dblclick が拾えなくなる
      //   （dblclick は2回目の pointerup の後に来るため、DOMノードが差し替わると届かない）。
      //   構成が本当に変わった時は position() が署名の変化で作り直すので、それに任せる。
      applyConnectorVias(api, d.id, d.vias, true);
    };

    // 折れ点つまみのダブルクリック＝その折れ点を削除
    const onDbl = (e: MouseEvent) => {
      const h = e.target as HTMLElement;
      if (h.dataset.kind !== "via") return;
      const t = readTarget();
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const vias = t.info.vias.filter((_, i) => i !== Number(h.dataset.index));
      applyConnectorVias(api, t.id, vias, true);
    };

    const mkHandle = (kind: "via" | "add", index: number) => {
      const h = document.createElement("div");
      h.dataset.kind = kind;
      h.dataset.index = String(index);
      const size = kind === "via" ? VIA_SIZE : ADD_SIZE;
      h.style.cssText = [
        "position:absolute", "pointer-events:auto", "cursor:move", "z-index:1",
        "box-sizing:border-box", "border-radius:50%",
        `width:${size}px`, `height:${size}px`,
        `border:1.5px solid ${ACCENT}`,
        kind === "via" ? `background:${ACCENT}` : "background:#fff",
        kind === "via" ? "opacity:1" : "opacity:0.55",
        "box-shadow:0 0 0 1.5px rgba(255,255,255,0.9)",
      ].join(";");
      h.title = kind === "via" ? "ドラッグで折れ点を移動 / ダブルクリックで削除" : "ドラッグでここに折れ点を追加";
      h.addEventListener("pointerdown", onDown);
      h.addEventListener("dblclick", onDbl);
      h.addEventListener("pointerenter", () => { h.style.opacity = "1"; });
      h.addEventListener("pointerleave", () => { if (!dragRef.current) h.style.opacity = kind === "via" ? "1" : "0.55"; });
      layer.appendChild(h);
    };

    const position = () => {
      raf = requestAnimationFrame(position);
      if (dragRef.current) return; // ドラッグ中は onMove が掴んでいるつまみだけ動かす
      const t = readTarget();
      if (!t) {
        if (structRef.current) { layer.replaceChildren(); structRef.current = ""; }
        return;
      }
      const { info } = t;
      const st = api.getAppState();
      const rect = container.getBoundingClientRect();
      const zoom = st.zoom?.value ?? 1;
      const toLocalX = (sx: number) => sx * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left;
      const toLocalY = (sy: number) => sy * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top;

      // 追加つまみを出す区間。短すぎる区間と、中点が既存の折れ点と重なる区間は出さない
      // （つまみ同士が重なって掴めなくなるため）。
      const segs: number[] = [];
      for (let i = 0; i < info.route.length - 1; i++) {
        const a = info.route[i], b = info.route[i + 1];
        if (Math.hypot(b.x - a.x, b.y - a.y) * zoom < MIN_SEG_PX) continue;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (info.vias.some((v) => Math.hypot(v.x - mid.x, v.y - mid.y) * zoom < VIA_SIZE)) continue;
        segs.push(i);
      }
      const sig = `${t.id}:${segs.join("-")}:${info.vias.length}`;
      if (sig !== structRef.current) {
        layer.replaceChildren();
        for (const s of segs) mkHandle("add", s);
        info.vias.forEach((_, i) => mkHandle("via", i)); // 追加つまみより後＝前面
        structRef.current = sig;
      }

      for (const h of Array.from(layer.children) as HTMLElement[]) {
        const i = Number(h.dataset.index);
        const add = h.dataset.kind === "add";
        // 折れ点は「経路の頂点」とは限らない（直線区間の点は畳まれる）ので、常に自分の座標に置く
        const p: Pt = add
          ? { x: (info.route[i].x + info.route[i + 1].x) / 2, y: (info.route[i].y + info.route[i + 1].y) / 2 }
          : info.vias[i];
        if (!p) continue;
        const size = add ? ADD_SIZE : VIA_SIZE;
        h.style.left = `${toLocalX(p.x) - size / 2}px`;
        h.style.top = `${toLocalY(p.y) - size / 2}px`;
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    raf = requestAnimationFrame(position);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      layer.replaceChildren();
      structRef.current = "";
      dragRef.current = null;
    };
  }, [api, containerRef, canEdit]);

  // つまみ以外はクリックを透過（キャンバス操作を妨げない）
  return <div ref={layerRef} style={{ position: "absolute", inset: 0, zIndex: 6, pointerEvents: "none" }} />;
}
