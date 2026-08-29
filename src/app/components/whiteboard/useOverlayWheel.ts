// UI の上でのピンチ操作をキャンバスのズームに変える（BRU12-033）。
//
// トラックパッドのピンチは Chrome/Edge では ctrl+wheel として飛んでくる。Excalidraw の
// キャンバス上ならライブラリ側が拾って preventDefault するのでブラウザの拡大は起きないが、
// コメントピン・ツールバー・各種パネルといった自前の DOM の上では誰も止めないため、
// 「ページ全体がブラウザズームで拡大される」ことになる（画面全部が巨大化して戻せない）。
//
// そこでホワイトボードの領域内で起きたピンチは window の capture 段で横取りし、
// キャンバス上と同じ「カーソル位置を中心にした scene のズーム」に読み替える。
// Safari は ctrl+wheel ではなく gesture イベントなので、そちらも同じ扱いにする。
import { useEffect } from "react";
import type { RefObject } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const MAX_DELTA = 50; // 1イベントあたりの変化量の上限（環境差で飛びすぎるのを抑える）

/** Excalidraw 自身が処理してくれる場所（＝キャンバス）か */
function onCanvas(t: EventTarget | null): boolean {
  const el = t as Element | null;
  if (!el || typeof (el as any).closest !== "function") return false;
  return !!el.closest("canvas");
}

export function useOverlayPinchZoom(api: any, containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!api) return;

    // ホワイトボードの持ち物の上か。全画面用に body へポータルしたパネル（data-wbc-ui）も含める。
    const inWhiteboard = (t: EventTarget | null): boolean => {
      const el = t as Element | null;
      if (!el || typeof (el as any).closest !== "function") return false;
      const root = containerRef.current;
      if (root?.contains(el)) return true;
      return !!el.closest("[data-wbc-ui]");
    };

    // カーソル位置の scene 座標を動かさないまま zoom だけ差し替える。
    //   sceneX = (clientX - offsetLeft) / zoom - scrollX
    // を新旧の zoom で等しく保つと scrollX の補正量が出る。
    const zoomAt = (factor: number, clientX: number, clientY: number) => {
      let st: any;
      try { st = api.getAppState(); } catch { return; }
      if (!st) return;
      const z1 = st.zoom?.value ?? 1;
      const z2 = Math.min(Math.max(z1 * factor, MIN_ZOOM), MAX_ZOOM);
      if (z2 === z1) return;
      const vx = clientX - (st.offsetLeft ?? 0);
      const vy = clientY - (st.offsetTop ?? 0);
      try {
        api.updateScene({
          appState: {
            ...st,
            zoom: { value: z2 },
            scrollX: st.scrollX + vx / z2 - vx / z1,
            scrollY: st.scrollY + vy / z2 - vy / z1,
          },
          captureUpdate: CaptureUpdateAction.NEVER, // ズームは undo 履歴に積まない（Excalidraw本体と同じ）
        });
      } catch { /* ズームできなくてもページ拡大だけは防げていれば良い */ }
    };

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;              // ピンチ以外（通常のスクロール）は素通し
      if (!inWhiteboard(e.target)) return; // ボード外は普段どおり
      if (onCanvas(e.target)) return;      // キャンバス上は Excalidraw 本体に任せる
      e.preventDefault();
      e.stopPropagation();
      const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.deltaY));
      zoomAt(Math.exp(-delta / 100), e.clientX, e.clientY);
    };

    // Safari のピンチ。scale は開始時からの累積倍率なので、前回との比を使う。
    let lastScale = 1;
    const onGestureStart = (e: any) => {
      if (!inWhiteboard(e.target) || onCanvas(e.target)) return;
      lastScale = 1;
      e.preventDefault();
    };
    const onGestureChange = (e: any) => {
      if (!inWhiteboard(e.target) || onCanvas(e.target)) return;
      e.preventDefault();
      const scale = e.scale || 1;
      if (lastScale > 0) zoomAt(scale / lastScale, e.clientX, e.clientY);
      lastScale = scale;
    };
    const onGestureEnd = (e: any) => {
      if (!inWhiteboard(e.target) || onCanvas(e.target)) return;
      e.preventDefault();
      lastScale = 1;
    };

    const opts = { passive: false, capture: true } as AddEventListenerOptions;
    window.addEventListener("wheel", onWheel, opts);
    window.addEventListener("gesturestart", onGestureStart, opts);
    window.addEventListener("gesturechange", onGestureChange, opts);
    window.addEventListener("gestureend", onGestureEnd, opts);
    return () => {
      window.removeEventListener("wheel", onWheel, opts);
      window.removeEventListener("gesturestart", onGestureStart, opts);
      window.removeEventListener("gesturechange", onGestureChange, opts);
      window.removeEventListener("gestureend", onGestureEnd, opts);
    };
  }, [api, containerRef]);
}
