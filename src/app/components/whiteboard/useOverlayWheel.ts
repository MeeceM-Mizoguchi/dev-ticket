// UI の上でのホイール／ピンチ操作をキャンバスの移動・ズームに読み替える（BRU12-033・BRU13-048）。
//
// Excalidraw の wheel ハンドラは target が canvas / textarea / iframe のときしか
// preventDefault しない。ところがコメントピン・ツールバー・各種パネルといった自前の
// オーバーレイはキャンバスの「兄弟」なので、その上でのホイールは誰も止めず素通しになる。
// 結果として、
//   ・トラックパッドの横スワイプ → ブラウザの「戻る／進む」でボードから離脱する
//   ・縦ホイール              → ボードではなくページのほうがスクロールする
//   ・ピンチ(ctrl+wheel)      → ページ全体がブラウザズームで巨大化する
// が起きる。ピンから離した位置でしか操作できないのは使い勝手として破綻しているので、
// ホワイトボードの領域で起きたホイールは window の capture 段で横取りし、キャンバス上と
// 同じ「スクロール＝ボードの移動 / ピンチ＝ボードのズーム」に統一する。
// Safari のピンチは ctrl+wheel ではなく gesture イベントなので、そちらも同じ扱いにする。
//
// ただし返信一覧やボード一覧のように「本当にスクロールさせたい」領域は素通しする。
// 端まで来た場合は止めるだけにして（overscroll-behavior:contain と同じ振る舞い）、
// 一覧の続きを送ろうとしただけでボードが動く、という事故を避ける。
import { useEffect } from "react";
import type { RefObject } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const MAX_DELTA = 50; // 1イベントあたりの変化量の上限（環境差で飛びすぎるのを抑える）

// ダイアログの上ではボードを動かさない（下の板が滑ると入力しづらいだけで、得がない）。
// 自前のモーダルは data-wbc-modal、Excalidraw 標準のダイアログは role="dialog"。
const MODAL_SEL = '[data-wbc-modal],[role="dialog"]';

/** Excalidraw 自身が処理してくれる場所（＝キャンバス）か */
function onCanvas(t: EventTarget | null): boolean {
  const el = t as Element | null;
  if (!el || typeof (el as any).closest !== "function") return false;
  return !!el.closest("canvas");
}

/** 表示中か。タブ機能(keep-alive)で visibility:hidden のまま生きている裏タブを弾く */
function visible(el: HTMLElement): boolean {
  try {
    if (typeof (el as any).checkVisibility === "function") {
      return (el as any).checkVisibility({ visibilityProperty: true, contentVisibilityAuto: true });
    }
  } catch { /* 未対応ブラウザは下のフォールバックへ */ }
  return el.isConnected;
}

/** その軸にスクロール余地を持つ要素か（中身がはみ出していて overflow が auto/scroll） */
function scrollableIn(el: HTMLElement, horizontal: boolean): boolean {
  let ov: string;
  try { ov = horizontal ? getComputedStyle(el).overflowX : getComputedStyle(el).overflowY; }
  catch { return false; }
  if (ov !== "auto" && ov !== "scroll") return false;
  const inner = horizontal ? el.scrollWidth : el.scrollHeight;
  const outer = horizontal ? el.clientWidth : el.clientHeight;
  return inner - outer > 1;
}

/** まだその向きへ動かせるか（端に着いていたら false） */
function canConsume(el: HTMLElement, horizontal: boolean, delta: number): boolean {
  const pos = horizontal ? el.scrollLeft : el.scrollTop;
  if (delta < 0) return pos > 1;
  const max = (horizontal ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight);
  return pos < max - 1;
}

/**
 * target からホワイトボードの外へ出るまで遡り、その軸のスクロール領域を探す。
 * body で打ち切るのは、ページ本体（<main>）まで拾うと「ボードが動かずページが動く」
 * という直したいバグそのものになるため。
 */
function scrollableAncestor(t: EventTarget | null, root: HTMLElement | null, horizontal: boolean): HTMLElement | null {
  let el = t as HTMLElement | null;
  while (el && el !== root && el !== document.body && el !== document.documentElement) {
    if (scrollableIn(el, horizontal)) return el;
    el = el.parentElement;
  }
  return null;
}

export function useOverlayWheel(api: any, containerRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!api) return;

    // ホワイトボードの持ち物の上か。全画面用に body へポータルしたパネル（data-wbc-ui）も含める。
    const inWhiteboard = (t: EventTarget | null): boolean => {
      const el = t as Element | null;
      if (!el || typeof (el as any).closest !== "function") return false;
      const root = containerRef.current;
      if (!root || !visible(root)) return false; // 裏タブのボードが表のページの操作を横取りしないように
      if (root.contains(el)) return true;
      return !!el.closest("[data-wbc-ui]");
    };

    const inModal = (t: EventTarget | null): boolean => {
      const el = t as Element | null;
      return !!el && typeof (el as any).closest === "function" && !!el.closest(MODAL_SEL);
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

    // キャンバス上のホイールと同じ量だけボードを動かす（Excalidraw 本体と同じ式）。
    const panBy = (dx: number, dy: number) => {
      let st: any;
      try { st = api.getAppState(); } catch { return; }
      if (!st) return;
      const z = st.zoom?.value || 1;
      try {
        api.updateScene({
          appState: { ...st, scrollX: st.scrollX - dx / z, scrollY: st.scrollY - dy / z },
          captureUpdate: CaptureUpdateAction.NEVER, // 移動は undo 履歴に積まない
        });
      } catch { /* 動かせなくても「戻る」だけは防げていれば良い */ }
    };

    const onWheel = (e: WheelEvent) => {
      if (!inWhiteboard(e.target)) return; // ボード外は普段どおり
      if (onCanvas(e.target)) return;      // キャンバス上は Excalidraw 本体に任せる

      if (e.ctrlKey || e.metaKey) {        // ピンチ／ズーム
        e.preventDefault();
        e.stopPropagation();
        const delta = Math.max(-MAX_DELTA, Math.min(MAX_DELTA, e.deltaY));
        zoomAt(Math.exp(-delta / 100), e.clientX, e.clientY);
        return;
      }

      // shift+ホイールは横移動（Excalidraw 本体と同じ読み替え）。
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.shiftKey) { dx = e.deltaY || e.deltaX; dy = 0; }
      if (!dx && !dy) return;

      const horizontal = Math.abs(dx) > Math.abs(dy);
      const delta = horizontal ? dx : dy;
      const sc = scrollableAncestor(e.target, containerRef.current, horizontal);
      if (sc && canConsume(sc, horizontal, delta)) return; // 一覧・返信欄などは普通にスクロールさせる

      // ダイアログの上は「止めるだけ」。背後のボードやページが滑らないようにする。
      if (inModal(e.target)) { e.preventDefault(); e.stopPropagation(); return; }

      // ポインタがキャンバスの矩形の外なら手を出さない。透明バックドロップ（表のサイズ選択など）は
      // 画面全体を覆うので、これが無いとボードの外でのスクロールまで奪ってしまう。
      const root = containerRef.current;
      const rect = root?.getBoundingClientRect();
      if (!rect || e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;

      // ここから先はブラウザに渡さない（横スワイプの「戻る／進む」とページスクロールを止める）。
      e.preventDefault();
      e.stopPropagation();
      if (sc) return; // スクロール領域の端：止めるだけ（ボードは動かさない）
      panBy(dx, dy);
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
