// 見切れた（… で省略された）タイトルに、マウスオーバーで全文ツールチップを出す共通部品。
//
//   ・省略されている時だけ出す。収まっている行に乗せても何も起きない。
//   ・見た目は PlanTooltip と同じオリジナルUI（#1A1714 のダーク + 三角）。
//     違うのは「長いタイトルは折り返す」点だけ（PlanTooltip は短い定型文なので nowrap）。
//   ・サイドバーや表の overflow に切られないよう body へ portal し、fixed で置く。
//     ツリーの行はスクロール領域の中にあるので、absolute だと端が欠ける。
//
// 使い方 — 既存の「省略スタイル付き span/p」をそのまま置き換える:
//
//   <TruncatedText as="p" text={node.title || "無題"} style={{ fontSize: 12, ... }} />
//
// バッジ等を並べたい行は children を渡す（ツールチップの中身は text 側を使う）:
//
//   <TruncatedText text={f.fileName} style={{...}}>{f.fileName}<Badge/></TruncatedText>
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";
import { createPortal } from "react-dom";
// ツールチップの見た目そのものは共通部品（data-tip 方式の useDelegatedTips と同じ絵）
import { Tip, type TipAnchor } from "@/app/components/shared/HoverTip";

/** マウスを乗せてから出るまで。長いと「反応しない」と感じるので短く */
const OPEN_DELAY_MS = 120;

type Anchor = TipAnchor;

/**
 * セルの中にある「それ自体が押せる／自分の説明を持つ」もの。この上ではタイトルの
 * ツールチップを出さない（ボタンの説明と重なるため）。data-title-stashed は
 * NativeTitleTips が title を外している間に付ける目印。
 */
const HOT_SELECTOR = "button, a, input, select, textarea, [title], [data-title-stashed], [data-tip]";

/** マウスが乗っていれば反応する範囲。横は x、縦は y の要素の箱で決める */
type Zone = { x: Element; y: Element };

/** 同じ範囲に、見切れツールチップを持つ別の要素があるか（あると2つ同時に出てしまう） */
function holdsOtherTip(box: Element, el: Element): boolean {
  return Array.from(box.querySelectorAll("[data-truncated-tip]")).some(o => o !== el);
}

/**
 * 文字の箱ではなく「セル」で反応させるための範囲を決める。
 *
 *   ・表の行（1段の grid）の中 … 横はその列、縦は行の高さいっぱい。
 *     行は alignItems:center が多く、セルの箱は文字の高さしかないので、縦は行から取る。
 *   ・横並び(flex)の中 … 縦はその並びの高さ。他に文字が無ければ横も並び全体
 *     （行頭の丸やすき間でも反応させる）。
 *   ・どちらでもない、または同じ範囲に別の見切れツールチップがある … 文字の箱だけ。
 */
function resolveZone(el: HTMLElement): Zone {
  const self: Zone = { x: el, y: el };
  const parent = el.parentElement;
  if (!parent) return self;

  let cell: Element = el;
  for (let p: Element | null = parent, i = 0; p && i < 2; cell = p, p = p.parentElement, i++) {
    const cs = window.getComputedStyle(p);
    if (cs.display !== "grid" && cs.display !== "inline-grid") continue;
    if (holdsOtherTip(cell, el)) return self;
    // カードを縦横に並べた grid は行ではない。縦を広げると同じ列のカード全部で反応してしまう
    const cr = cell.getBoundingClientRect();
    const singleRow = Array.from(p.children).every(c => {
      const r = c.getBoundingClientRect();
      return r.height === 0 || (r.top < cr.bottom && r.bottom > cr.top);
    });
    return { x: cell, y: singleRow ? p : cell };
  }

  const cs = window.getComputedStyle(parent);
  const isFlexRow = (cs.display === "flex" || cs.display === "inline-flex") && cs.flexDirection.startsWith("row");
  if (!isFlexRow || holdsOtherTip(parent, el)) return self;
  const alone = (parent.textContent ?? "").trim() === (el.textContent ?? "").trim();
  return { x: alone ? parent : el, y: parent };
}

function inZone(zone: Zone, el: Element, e: MouseEvent): boolean {
  if (e.target instanceof Element) {
    const hot = e.target.closest(HOT_SELECTOR);
    if (hot && !hot.contains(el)) return false;
  }
  const xr = zone.x.getBoundingClientRect();
  const yr = zone.y.getBoundingClientRect();
  return e.clientX >= xr.left && e.clientX <= xr.right && e.clientY >= yr.top && e.clientY <= yr.bottom;
}

export interface TruncatedTextProps {
  /** ツールチップに出す全文。children 未指定ならこれをそのまま描画する */
  text: string;
  /** バッジ等を混ぜたい行だけ指定する。ツールチップは text を使う */
  children?: ReactNode;
  /** 既存のマークアップに合わせてタグを変える（p / div / h1 …） */
  as?: ElementType;
  /** 省略スタイル(overflow/textOverflow/whiteSpace)は既定で入る。上書きも可 */
  style?: CSSProperties;
  className?: string;
  title?: string;
  /**
   * 見切れの計測をせず、必ず出す。
   * CSS ではなく JS で切っている（truncateText 等）行はブラウザから見ると
   * 収まっているので、計測任せだと出ない。
   */
  always?: boolean;
}

/**
 * 見切れ判定 → ツールチップ表示の中身。TruncatedText で包めない要素
 * （チケット詳細の編集できるタイトル <input> 等）はこれを直接使う:
 *
 *   const tip = useTruncatedTip<HTMLInputElement>(title, { disabled: editing });
 *   <input ref={tip.ref} onMouseEnter={tip.onMouseEnter} onMouseLeave={tip.close} ... />
 *   {tip.tip}
 *
 * <input> も scrollWidth > clientWidth で見切れを判定できる。
 */
export function useTruncatedTip<T extends HTMLElement = HTMLElement>(
  text: string,
  opts?: {
    always?: boolean;
    disabled?: boolean;
    /**
     * "cell" にすると、文字の箱ではなくセル全体（resolveZone 参照）で反応する。
     * マウスの出入りはフックが自分で聞くので、onMouseEnter / close を要素へ渡さないこと。
     */
    area?: "self" | "cell";
  },
) {
  const always = opts?.always ?? false;
  const disabled = opts?.disabled ?? false;
  const area = opts?.area ?? "self";
  const ref = useRef<T | null>(null);
  const timerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const close = useCallback(() => { clearTimer(); setAnchor(null); }, []);

  useEffect(() => () => clearTimer(), []);

  // 編集を始めた等で無効になったら、出ているものも消す
  useEffect(() => { if (disabled) close(); }, [disabled, close]);

  // 出している間にスクロール/リサイズされると位置がずれるだけなので閉じる。
  // ツリーやモーダルの中のスクロールも拾うので capture で聞く。
  useEffect(() => {
    if (!anchor) return;
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor, close]);

  const onMouseEnter = () => {
    clearTimer();
    if (disabled) return;
    timerRef.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el || !text) return;
      // 全部見えているならツールチップは邪魔なだけ。1px はブラウザの丸め誤差の逃がし
      if (!always && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) return;
      const r = el.getBoundingClientRect();
      setAnchor({ top: r.top, bottom: r.bottom, left: r.left });
    }, OPEN_DELAY_MS);
  };

  // セルで反応させる場合。行(2つ上まで)に聞き役を置き、マウスが範囲に入ったかを自分で判定する
  const enterRef = useRef(onMouseEnter);
  enterRef.current = onMouseEnter;
  useEffect(() => {
    if (area !== "cell") return;
    const el = ref.current;
    const outer = el?.parentElement?.parentElement ?? el?.parentElement;
    if (!el || !outer) return;

    let zone: Zone | null = null;
    let inside = false;
    const onMove = (e: MouseEvent) => {
      zone ??= resolveZone(el);
      const hit = inZone(zone, el, e);
      // 範囲の中を動いているだけなら何もしない（スクロールや押下で閉じた後に出し直さない）
      if (hit === inside) return;
      inside = hit;
      if (hit) enterRef.current(); else close();
    };
    const onLeave = () => { zone = null; inside = false; close(); };

    outer.addEventListener("mousemove", onMove);
    outer.addEventListener("mouseleave", onLeave);
    // 行をクリックして画面が変わった後に残らないように
    outer.addEventListener("mousedown", close);
    return () => {
      outer.removeEventListener("mousedown", close);
      outer.removeEventListener("mousemove", onMove);
      outer.removeEventListener("mouseleave", onLeave);
    };
  }, [area, close]);

  return {
    ref,
    onMouseEnter,
    close,
    tip: anchor ? createPortal(<Tip anchor={anchor} text={text} />, document.body) : null,
  };
}

export function TruncatedText({
  text, children, as: Tag = "span", style, className, title, always = false,
}: TruncatedTextProps) {
  // 文字の上ぴったりでなくても、セルに乗っていれば出す（行の上下の余白や行頭の丸でも反応する）
  const { ref, close, tip } = useTruncatedTip(text, { always, area: "cell" });

  return (
    <>
      <Tag
        ref={ref}
        className={className}
        title={title}
        // NativeTitleTips 向けの目印（ここは自前で出すので、title 側のツールチップを重ねない）
        data-truncated-tip=""
        // 行をクリックして画面が変わった後に残らないように
        onClick={close}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
      >
        {children ?? text}
      </Tag>
      {tip}
    </>
  );
}
