// 折れ線に「手動の折れ点」を好きなだけ足すためのオーバーレイ（BRU7-043 / BRU12-030）。
//
// 自前の折れ線(wbFolded)は両端のアンカーから毎フレーム経路を引き直すため、Excalidraw 標準の
// 点編集で中間点を足しても次のフレームで消える。そこで折れ点は customData.wbVias に持たせ、
// ここでは「つまみをドラッグして wbVias を書き換える」ことだけを行う（経路の計算は
// whiteboardAutoConnect 側の buildFoldedRoute が一手に引き受ける）。
//
// 【BRU12-030】折れ点＝角。ここで一度でも折れ点を触った線は自由折れ点モード(wbViaFree)になり、
// 経路は S→折れ点→…→E をそのまま結ぶだけになる。角の位置を自動調整しないので
//   ・置いた位置がそのまま角になる（＝好きな位置で折れる）
//   ・2点目・3点目…と何点でも増やせる（増やした分だけ角が増える）
// 初めて触った時は「今の経路の角」を折れ点として引き継ぐので、掴んだ瞬間に形は変わらない。
//
// つまみは2種類:
//   ・折れ点つまみ（濃い丸）… 既存の折れ点。ドラッグで移動、ダブルクリックで削除。
//   ・追加つまみ（薄い丸）  … 各区間の中点。ドラッグするとその位置に折れ点が1つ増える。
//
// 座標変換とDOM構築は TableResizeOverlay と同じ方式（React再レンダーを挟まない命令的な更新）。
import { useEffect, useRef } from "react";
import { applyConnectorVias, foldedRouteInfo, type RouteInfo } from "@/app/lib/whiteboardAutoConnect";
import { beginHistoryGesture } from "@/app/lib/whiteboardHistory";

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
const ADJ_SNAP_PX = 14;    // 隣り合う点とのスナップは広めに取る（直角のまま動かしやすくする・BRU12-030）
const MIN_SEG_PX = 18;     // これより短い区間には追加つまみを出さない（つまみ同士が重なるため）
const MOVE_PX = 3;         // これ以下の移動は「ただのクリック」とみなす（折れ点を増やさない）

type Drag = { id: string; viaIndex: number; vias: Pt[]; origin: Pt; added: boolean; moved: boolean } | null;

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

    // 掴んだ点 add を含む「自由折れ点モードの折れ点列」を作る（BRU12-030）。
    //   ・自由折れ点モードの線 … 既存の折れ点に add を経路順で挿し込むだけ
    //   ・それ以外の線         … いまの経路の角を折れ点として引き継いでから add を挿し込む
    //     （＝掴んだ瞬間に形が変わらない。以後はその角がユーザーの持ち物になる）
    // 戻り値の index は add がどこに入ったか（＝これからドラッグする折れ点）。
    const seedVias = (info: RouteInfo, add: Pt): { vias: Pt[]; index: number } => {
      const src = info.free ? info.vias : [...info.route.slice(1, -1), ...info.vias];
      const all = [...src, add]
        .map((p) => ({ p: { x: p.x, y: p.y }, t: routePos(p, info.route) }))
        .sort((a, b) => a.t - b.t);
      const vias: Pt[] = [];
      for (const { p } of all) {
        const last = vias[vias.length - 1];
        if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 0.5) vias.push(p);
      }
      let index = 0, best = Infinity;
      vias.forEach((p, i) => {
        const d = Math.hypot(p.x - add.x, p.y - add.y);
        if (d < best) { best = d; index = i; }
      });
      return { vias, index };
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
    // 隣り合う点（前後の折れ点・端点）だけは許容を広く取る。自由折れ点では折れ点を動かすと
    // 前後の区間がそのまま斜めになるため、ここが緩いと直角を保ったまま動かすのが難しい（BRU12-030）。
    const snap = (p: Pt, S: Pt, E: Pt, vias: readonly Pt[], index: number): Pt => {
      const z = zoomOf();
      const adj: Pt[] = [index > 0 ? vias[index - 1] : S, index < vias.length - 1 ? vias[index + 1] : E];
      const others: Pt[] = [S, E, ...vias.filter((_, i) => i !== index)];
      const fit = (targets: readonly Pt[], tol: number, cur: number, get: (t: Pt) => number): number | null => {
        let best = tol, v: number | null = null;
        for (const t of targets) { const d = Math.abs(get(t) - cur); if (d <= best) { best = d; v = get(t); } }
        return v;
      };
      const pick = (cur: number, get: (t: Pt) => number) =>
        fit(adj, ADJ_SNAP_PX / z, cur, get) ?? fit(others, SNAP_PX / z, cur, get) ?? cur;
      return { x: pick(p.x, (t) => t.x), y: pick(p.y, (t) => t.y) };
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
      // ドラッグ確定(onUp)の1回で履歴に載せる。それまでの中間状態は EVENTUALLY で溜める（BRU7-058）。
      beginHistoryGesture(api);
      const idx = Number(h.dataset.index);
      // 掴んだ点: 折れ点つまみはその折れ点、追加つまみは掴んだ区間の中点。
      // どちらも「今そこにある形」の点なので、掴んだ瞬間に線は動かない。
      let grabbed: Pt;
      if (kind === "via") {
        grabbed = t.info.vias[idx];
        if (!grabbed) return;
      } else {
        const a = t.info.route[idx], b = t.info.route[idx + 1];
        if (!a || !b) return;
        grabbed = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      const seed = seedVias(t.info, grabbed);
      dragRef.current = {
        id: t.id, viaIndex: seed.index, vias: seed.vias,
        origin: { x: e.clientX, y: e.clientY }, added: kind === "add", moved: false,
      };
      // 折れ点の持ち主をユーザーへ移す（自由折れ点モードへ切り替える）。形は変わらない。
      if (kind === "add" || !t.info.free) applyConnectorVias(api, t.id, seed.vias, false);
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(e.clientX - d.origin.x, e.clientY - d.origin.y) < MOVE_PX) return;
      d.moved = true;
      const elements = api.getSceneElements() as any[];
      const el = elements.find((x) => x.id === d.id);
      const info = el ? foldedRouteInfo(el, elements) : null;
      if (!info) return;
      const p = snap(toScene(e.clientX, e.clientY), info.S, info.E, d.vias, d.viaIndex);
      d.vias[d.viaIndex] = p;
      applyConnectorVias(api, d.id, d.vias, false);
      // ドラッグ中はつまみを作り直さない。掴んでいるものだけ（スナップ後の位置へ）追従させる。
      const h = e.target as HTMLElement;
      if (h?.dataset?.kind) {
        const st = api.getAppState();
        const rect = container.getBoundingClientRect();
        const zoom = st.zoom?.value ?? 1;
        const size = h.dataset.kind === "via" ? VIA_SIZE : ADD_SIZE;
        h.style.left = `${p.x * zoom + st.scrollX * zoom + (st.offsetLeft ?? 0) - rect.left - size / 2}px`;
        h.style.top = `${p.y * zoom + st.scrollY * zoom + (st.offsetTop ?? 0) - rect.top - size / 2}px`;
      }
    };

    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) return;
      // 追加つまみを「掴んだだけ」で離した時は折れ点を増やさない（クリックのたびに無駄な角が溜まるため）。
      const vias = d.added && !d.moved ? d.vias.filter((_, i) => i !== d.viaIndex) : d.vias;
      // 指を離したフレームで、隣と重なった折れ点（＝長さ0の区間）だけ掃除する。
      // ※ここで structRef を潰してつまみを作り直すと、削除用の dblclick が拾えなくなる
      //   （dblclick は2回目の pointerup の後に来るため、DOMノードが差し替わると届かない）。
      //   構成が本当に変わった時は position() が署名の変化で作り直すので、それに任せる。
      // 確定フレームだけ履歴へ記録する（1ドラッグ＝1 undo ステップ・BRU7-058）。
      applyConnectorVias(api, d.id, vias, true, true);
    };

    // 折れ点つまみのダブルクリック＝その折れ点を削除
    const onDbl = (e: MouseEvent) => {
      const h = e.target as HTMLElement;
      if (h.dataset.kind !== "via") return;
      const t = readTarget();
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      const target = t.info.vias[Number(h.dataset.index)];
      if (!target) return;
      // 自由折れ点モードへ揃えてから1点だけ落とす（他の角は今の位置のまま残す）
      const seed = seedVias(t.info, target);
      const vias = seed.vias.filter((_, i) => i !== seed.index);
      applyConnectorVias(api, t.id, vias, true, true); // 削除も 1 undo ステップ（BRU7-058）
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
        // 折れ点つまみは常に折れ点そのものの座標へ置く（＝置いた位置がそのまま角）
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
