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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";
import { createPortal } from "react-dom";

/** マウスを乗せてから出るまで。長いと「反応しない」と感じるので短く */
const OPEN_DELAY_MS = 120;
const TIP_MAX_WIDTH = 380;
/** 対象の行とツールチップの隙間 */
const GAP = 6;
/** 画面端に張り付かせないための余白 */
const MARGIN = 8;

type Anchor = { top: number; bottom: number; left: number };

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

export function TruncatedText({
  text, children, as: Tag = "span", style, className, title, always = false,
}: TruncatedTextProps) {
  const ref = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const close = useCallback(() => { clearTimer(); setAnchor(null); }, []);

  useEffect(() => () => clearTimer(), []);

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

  const handleEnter = () => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      const el = ref.current;
      if (!el || !text) return;
      // 全部見えているならツールチップは邪魔なだけ。1px はブラウザの丸め誤差の逃がし
      if (!always && el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1) return;
      const r = el.getBoundingClientRect();
      setAnchor({ top: r.top, bottom: r.bottom, left: r.left });
    }, OPEN_DELAY_MS);
  };

  return (
    <>
      <Tag
        ref={ref}
        className={className}
        title={title}
        onMouseEnter={handleEnter}
        onMouseLeave={close}
        // 行をクリックして画面が変わった後に残らないように
        onClick={close}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...style }}
      >
        {children ?? text}
      </Tag>
      {anchor && createPortal(<Tip anchor={anchor} text={text} />, document.body)}
    </>
  );
}

function Tip({ anchor, text }: { anchor: Anchor; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // 実寸を測ってから置く。測る前は visibility:hidden にしておき、左上でのちらつきを防ぐ
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
        // 長いタイトルが目的なので折り返す。URL のような切れ目のない文字列も折る
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
