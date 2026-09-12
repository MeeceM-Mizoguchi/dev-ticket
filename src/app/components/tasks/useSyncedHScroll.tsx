// 横にスクロールする表の、見出しと本体の横位置を揃える（BRU15-005）。
//
// 見出しは画面上部に固定（position:sticky）しているので、本体と同じスクロール枠には入れられない
// （overflow を持つ枠の中では sticky が「動かない枠」に吸着して効かなくなる）。
// そこで見出し・本体・下端のスクロールバーをそれぞれ別の枠にして、横位置だけを揃える。
//
// 本体のスクロールバーは表の一番下に付くので、行が多いと見えない。
// 本体側のバーは隠し（.task-hscroll-hide）、画面の下端に貼り付くバー（StickyHScrollBar）を代わりに出す。
import { useCallback, useEffect, useRef, useState } from "react";

export function useSyncedHScroll() {
  const head = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  const bar = useRef<HTMLDivElement | null>(null);
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const [scrollW, setScrollW] = useState(0);
  const [viewW, setViewW] = useState(0);

  // 中身の幅（列幅のドラッグ・行の増減で変わる）と、見えている幅を測り続ける
  useEffect(() => {
    if (!bodyEl || !contentEl) return;
    const measure = () => {
      setScrollW(contentEl.scrollWidth);
      setViewW(bodyEl.clientWidth);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bodyEl);
    ro.observe(contentEl);
    return () => ro.disconnect();
  }, [bodyEl, contentEl]);

  /** どの枠を動かしても残りの枠を同じ位置へ。同じ値を入れ直しても scroll は起きないので往復しない */
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const src = e.currentTarget;
    const x = src.scrollLeft;
    for (const el of [head.current, body.current, bar.current]) {
      if (el && el !== src && el.scrollLeft !== x) el.scrollLeft = x;
    }
  }, []);

  const bodyRef = useCallback((el: HTMLDivElement | null) => { body.current = el; setBodyEl(el); }, []);

  return {
    head, body, bar, bodyRef, contentRef: setContentEl, onScroll,
    scrollW,
    /** 横にはみ出しているか（はみ出していなければ下端のバーは出さない） */
    overflowing: scrollW > viewW + 1,
  };
}

export type SyncedHScroll = ReturnType<typeof useSyncedHScroll>;

/** 画面の下端に貼り付く横スクロールバー。本体の枠の外（表の外枠の直下）に置く */
export function StickyHScrollBar({ hs }: { hs: SyncedHScroll }) {
  if (!hs.overflowing) return null;
  return (
    <div
      ref={el => {
        hs.bar.current = el;
        // 出した瞬間は 0 から始まるので、本体の今の位置に合わせる
        if (el && hs.body.current) el.scrollLeft = hs.body.current.scrollLeft;
      }}
      onScroll={hs.onScroll}
      style={{
        position: "sticky", bottom: 0, zIndex: 20,
        overflowX: "auto", overflowY: "hidden",
        background: "#FAFAF9", borderTop: "1px solid rgba(26,23,20,0.07)",
      }}>
      <div style={{ width: hs.scrollW, height: 1 }} />
    </div>
  );
}
