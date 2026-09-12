// マウスを乗せたときの説明を、ブラウザ標準の title ではなくアプリのUIで出す共通部品。
//
// 見た目は TruncatedText / PlanTooltip と同じ（#1A1714 のダーク＋三角）。
// title 属性はOSごとに見た目も出るまでの時間も違い、改行も効かないので、表の中では使わない。
//
// 表は「説明を出したい要素」が1行に10個以上あり、行数も数百になる。要素ごとに
// 状態とイベントを持たせると重いので、入れ物に1つだけ聞き役を置いて data-tip 属性を拾う。
//
//   const { containerRef, tips } = useDelegatedTips();
//   <div ref={containerRef}>
//     <span data-tip={"担当者\nサブタスクの担当者をまとめて表示しています"}>A/B/C</span>
//     {tips}
//   </div>
//
// data-tip の中の \n はそのまま改行として出る（1行目に値、2行目に補足、という書き方ができる）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** 出るまでの間（すぐ出すと、通り過ぎただけで点滅する） */
const OPEN_DELAY_MS = 200;
const TIP_MAX_WIDTH = 380;
/** 対象とツールチップの隙間 */
const GAP = 6;
/** 画面端に張り付かせないための余白 */
const MARGIN = 8;

export type TipAnchor = { top: number; bottom: number; left: number };

/**
 * ツールチップの見た目そのもの。位置は実寸を測ってから決める
 * （測る前は visibility:hidden にして、左上でのちらつきを防ぐ）。
 */
export function Tip({ anchor, text }: { anchor: TipAnchor; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ top: number; left: number; arrowLeft: number; below: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();

    const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
    const left = Math.min(Math.max(MARGIN, anchor.left), maxLeft);

    // 基本は下。下に入らず上に入るなら上へ逃がす
    const fitsBelow = anchor.bottom + GAP + height <= window.innerHeight - MARGIN;
    const fitsAbove = anchor.top - GAP - height >= MARGIN;
    const below = fitsBelow || !fitsAbove;
    const top = below ? anchor.bottom + GAP : anchor.top - GAP - height;

    // 三角は対象の行頭を指す。画面端で箱をずらした分だけ箱の中で動かす
    const arrowLeft = Math.min(Math.max(anchor.left + 14 - left, 10), Math.max(10, width - 16));

    setPlaced({ top, left, arrowLeft, below });
  }, [anchor]);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: placed?.top ?? 0,
        left: placed?.left ?? 0,
        visibility: placed ? "visible" : "hidden",
        maxWidth: TIP_MAX_WIDTH,
        background: "#1A1714",
        color: "#fff",
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1.5,
        padding: "5px 10px",
        borderRadius: 7,
        // 長い文章が目的なので折り返す。URL のような切れ目のない文字列も折る
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        pointerEvents: "none",
        zIndex: 10000,
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
      }}
    >
      {text}
      {placed && (
        <div
          style={{
            position: "absolute",
            width: 0,
            height: 0,
            left: placed.arrowLeft,
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            ...(placed.below
              ? { bottom: "100%", borderBottom: "6px solid #1A1714" }
              : { top: "100%", borderTop: "6px solid #1A1714" }),
          }}
        />
      )}
    </div>
  );
}

/**
 * 入れ物の中の data-tip を拾ってツールチップを出す。
 * containerRef を入れ物に渡し、tips を入れ物の中（どこでもよい）に描くこと。
 *
 * 入れ物より内側であれば、あとから増えた行にもそのまま効く（イベント委譲なので、
 * 行が何百あっても聞き役は1つ）。ポータルで body へ出しているメニューの中は対象外。
 *
 * 入れ物は「ref オブジェクト」ではなく state で持つ。読み込み中は別のものを描いていて
 * あとから入れ物が現れる画面があり、ref オブジェクトだと現れたことに気付けず
 * イベントを張り損ねる（＝ツールチップが出ないまま）。
 */
export function useDelegatedTips(opts?: { delay?: number }): {
  containerRef: (el: HTMLElement | null) => void;
  tips: React.ReactNode;
} {
  const delay = opts?.delay ?? OPEN_DELAY_MS;
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState<{ anchor: TipAnchor; text: string } | null>(null);
  const timer = useRef<number | null>(null);
  /** いま狙っている要素。同じ要素の中で動いただけなら出し直さない（点滅防止） */
  const target = useRef<HTMLElement | null>(null);

  const clearTimer = () => {
    if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
  };

  const close = useCallback(() => {
    clearTimer();
    target.current = null;
    setShown(null);
  }, []);

  useEffect(() => () => clearTimer(), []);

  useEffect(() => {
    if (!root) return;

    const onOver = (e: Event) => {
      const from = e.target;
      const el = from instanceof Element ? from.closest<HTMLElement>("[data-tip]") : null;
      const text = el?.getAttribute("data-tip") ?? "";
      if (!el || !text) { close(); return; }
      if (el === target.current) return;      // 同じ要素の中を移動しただけ
      clearTimer();
      target.current = el;
      setShown(null);
      timer.current = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setShown({ anchor: { top: r.top, bottom: r.bottom, left: r.left }, text });
      }, delay);
    };

    root.addEventListener("mouseover", onOver);
    root.addEventListener("mouseleave", close);
    // 出したまま画面が動くとずれるだけなので消す。押したときも用が済んだとみなす
    root.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      root.removeEventListener("mouseover", onOver);
      root.removeEventListener("mouseleave", close);
      root.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [root, close, delay]);

  return {
    containerRef: setRoot,
    tips: shown ? createPortal(<Tip anchor={shown.anchor} text={shown.text} />, document.body) : null,
  };
}
