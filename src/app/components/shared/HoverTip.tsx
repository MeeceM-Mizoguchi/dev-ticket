// マウスを乗せたときの説明を、ブラウザ標準の title ではなくアプリのUIで出す共通部品。
//
// 見た目は TruncatedText / PlanTooltip と同じ（#1A1714 のダーク＋三角）。
// title 属性はOSごとに見た目も出るまでの時間も違い、改行も効かないので、表の中では使わない。
//
// それ以外の画面に書かれている title は、NativeTitleTips（アプリ最上位に1つ）が拾って
// 同じ見た目で出し直す。ブラウザ標準のツールチップはどの画面でも出ない。
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

/** 自前でツールチップを出している要素（data-tip / TruncatedText）。この内側では title 側は黙る */
const OWN_TIP_SELECTOR = "[data-tip], [data-truncated-tip]";
/** 見切れ判定で見る子孫の上限（大きな入れ物に title が付いていても重くしない） */
const TRUNCATION_SCAN_LIMIT = 40;
const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", "number", "password"]);

function isTextField(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
}

/** はみ出した分が実際に切られているか（スクロールできる入れ物は「見切れ」ではない） */
function isClipped(el: Element): boolean {
  // 1px はブラウザの丸め誤差の逃がし
  const w = el.scrollWidth > el.clientWidth + 1;
  const h = el.scrollHeight > el.clientHeight + 1;
  if (!w && !h) return false;
  if (isTextField(el)) return w;
  const cs = window.getComputedStyle(el);
  const cut = (v: string) => v === "hidden" || v === "clip";
  return (w && cut(cs.overflowX)) || (h && cut(cs.overflowY));
}

/**
 * title を黒いツールチップで出すかどうか。
 *   ・文字がある要素 … 見切れているときだけ（全部見えているなら邪魔なだけ）
 *   ・文字がない要素（アイコンだけのボタン等）… 説明がそれしか無いので常に出す
 */
function shouldShowTitleTip(el: Element): boolean {
  if (isTextField(el)) return el.value === "" || isClipped(el);
  const own = (el.textContent ?? "").trim();
  if (!own) return true;

  if (isClipped(el)) return true;
  const inner = el.querySelectorAll("*");
  for (let i = 0; i < inner.length && i < TRUNCATION_SCAN_LIMIT; i++) {
    if (isClipped(inner[i])) return true;
  }
  // <td style="overflow:hidden"><span title>…</span></td> のように、切っているのが外側のこともある。
  // 他の文字も抱えている入れ物まで遡ると、関係ない見切れを拾うのでそこで止める
  for (let p = el.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
    if ((p.textContent ?? "").trim() !== own) break;
    if (isClipped(p)) return true;
  }
  return false;
}

/**
 * React が DOM に持たせている「いまの props」の title。
 * 外していた title を戻すとき、乗せている間に props が変わっていたら古い文言を戻さないために見る。
 * undefined = React の管理外（外部ライブラリが直接作った要素など）。
 */
function liveTitleProp(el: Element): string | null | undefined {
  const key = Object.keys(el).find(k => k.startsWith("__reactProps$"));
  if (!key) return undefined;
  const title = (el as unknown as Record<string, { title?: unknown } | undefined>)[key]?.title;
  return typeof title === "string" ? title : null;
}

/**
 * ブラウザ標準の title ツールチップを、全画面でアプリのツールチップに置き換える。
 * アプリの最上位に1つだけ置く（App.tsx）。各画面は今まで通り title を書けばよい。
 *
 * ブラウザ標準のツールチップは CSS では止められず、title 属性が付いている限り出る。
 * そこで、マウスが乗っている間だけ title を DOM から外し（＝標準は出ない）、
 * 離れたら戻す。外すのは祖先の title も含む（子の title を外すと、親の title が出てくるため）。
 *
 * 出す条件は shouldShowTitleTip を参照。data-tip / TruncatedText の内側では、
 * そちらが自前で出すのでここでは出さない（標準を止めるだけ）。
 */
export function NativeTitleTips() {
  const [shown, setShown] = useState<{ anchor: TipAnchor; text: string } | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    /** いま狙っている要素。同じ要素の中で動いただけなら出し直さない（点滅防止） */
    let target: Element | null = null;
    /** title を外している要素と、その文言 */
    const stash = new Map<Element, string>();

    const clearTimer = () => {
      if (timer !== null) { window.clearTimeout(timer); timer = null; }
    };
    const hide = () => { clearTimer(); setShown(null); };

    const restore = (el: Element, text: string) => {
      stash.delete(el);
      el.removeAttribute("data-title-stashed");
      if (el.hasAttribute("title")) return;   // 乗せている間に React が書き直した
      const live = liveTitleProp(el);
      const value = live === undefined ? text : live;
      if (value) el.setAttribute("title", value);
    };
    const restoreAll = () => {
      Array.from(stash).forEach(([el, text]) => restore(el, text));
      target = null;
    };

    const onOver = (e: MouseEvent) => {
      const from = e.target instanceof Element ? e.target : null;

      // 近い順に、title を持つ（または外してある）祖先を集める。
      // iframe は中へイベントが届かず外し時を取れない。本文エディタ(.ProseMirror)の中は
      // エディタが DOM の変化を監視していて、属性を触ると描き直しが走るので触らない
      const editor = from?.closest(".ProseMirror") ?? null;
      const chain: Element[] = [];
      for (let el = from; el; el = el.parentElement) {
        if (el.tagName === "IFRAME" || (el as HTMLElement).isContentEditable || editor?.contains(el)) continue;
        if (el.hasAttribute("title") || stash.has(el)) chain.push(el);
      }

      Array.from(stash).forEach(([el, text]) => { if (!chain.includes(el)) restore(el, text); });
      for (const el of chain) {
        const title = el.getAttribute("title");
        if (title === null) continue;
        stash.set(el, title);
        el.removeAttribute("title");
        // title を外している間の目印（TruncatedText がこの上では出さないために見る）
        el.setAttribute("data-title-stashed", "");
      }

      const nearest = chain[0] ?? null;
      if (nearest === target) return;
      hide();
      target = nearest;
      if (!nearest || !from) return;

      const own = from.closest(OWN_TIP_SELECTOR);
      if (own && (own === nearest || nearest.contains(own))) return;
      // 見切れツールチップを抱えている入れ物（行など）。そちらがセル単位で出すので重ねない
      if (nearest.querySelector("[data-truncated-tip]")) return;

      timer = window.setTimeout(() => {
        const text = stash.get(nearest) ?? "";
        if (!text.trim() || !nearest.isConnected || !shouldShowTitleTip(nearest)) return;
        const r = nearest.getBoundingClientRect();
        setShown({ anchor: { top: r.top, bottom: r.bottom, left: r.left }, text });
      }, OPEN_DELAY_MS);
    };

    const onLeave = () => { hide(); restoreAll(); };

    document.addEventListener("mouseover", onOver);
    document.documentElement.addEventListener("mouseleave", onLeave);
    // 出したまま画面が動くとずれるだけなので消す。押したときも用が済んだとみなす
    document.addEventListener("mousedown", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      clearTimer();
      restoreAll();
      document.removeEventListener("mouseover", onOver);
      document.documentElement.removeEventListener("mouseleave", onLeave);
      document.removeEventListener("mousedown", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, []);

  return shown ? createPortal(<Tip anchor={shown.anchor} text={shown.text} />, document.body) : null;
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
