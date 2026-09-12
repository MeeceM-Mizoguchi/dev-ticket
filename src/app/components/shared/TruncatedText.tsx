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
