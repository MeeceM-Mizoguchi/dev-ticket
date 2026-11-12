// ENHA2-055-3 高度検索の出典から資料の画面へ移ったとき、根拠の文（AI が資料から書き写した文）を
// 黄色で目立たせて、その位置までスクロールする。
//
// 移るときに navigate(path, { state: { researchQuote } }) で文を渡す。受け取りは、この部品1つで
// 全画面（議事録・Wiki・バックログ・チケット詳細）に効かせる（AppRoutes の ProtectedRoutes に置く）。
//
// ★ 目立たせるのは見た目だけ ★
//   CSS Custom Highlight API（CSS.highlights）で、文の範囲（Range）に色を付けるだけにする。
//   DOM には何も書き足さないので、ProseMirror（tiptap）が描き直すことも、onUpdate → 自動保存が走ることもない
//   （CLAUDE.md BUG-07。議事録・Wiki は本文の変更が自動保存につながっている）。
//   CSS.highlights が使えないブラウザでは、色は付けずにスクロールだけ行う。
//
// 資料は開いてから少し遅れて描かれる（読み込み・エディタの準備）ので、見つかるまで少し待つ。
// 待っても見つからなければ（資料が直されて文が無い）、画面は開いたまま「該当の文が見つかりませんでした」と出す。
import { useEffect } from "react";
import { useLocation } from "react-router";
import { useToast } from "@/app/contexts/ToastContext";

const HIGHLIGHT_NAME = "research-quote";
/** 文を探しに行く間隔と回数（約12秒） */
const POLL_MS = 300;
const MAX_TRIES = 40;
/** 見つけたあと、描き直しで範囲が外れていないかを見張る回数（約10秒） */
const KEEP_TRIES = 10;

export interface ResearchQuoteState { researchQuote?: string }

/** Markdown の印（AI が API の本文から書き写すと入る）と空白を落として、画面の文字と比べられる形にする */
function normalizeQuote(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:[-*・>]|\d+[.)]|#{1,6})\s+/gm, "")
    .replace(/\*\*|~~|`/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function isSkipped(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest("script, style, textarea, [inert], [aria-hidden='true']")) return true;
  return el.getClientRects().length === 0;
}

/** 画面に見えている文字（空白を除く）をつなぎ、1文字ずつ元のテキストノードの位置を覚える */
function collectText(): { text: string; map: { node: Text; offset: number }[] } {
  const map: { node: Text; offset: number }[] = [];
  let text = "";
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    const value = node.nodeValue ?? "";
    if (value.trim() && !isSkipped(node.parentElement)) {
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (/\s/.test(ch)) continue;
        text += ch.toLowerCase();
        map.push({ node, offset: i });
      }
    }
    node = walker.nextNode() as Text | null;
  }
  return { text, map };
}

function findRange(quote: string): Range | null {
  const q = normalizeQuote(quote);
  if (!q) return null;
  const { text, map } = collectText();
  // 全文 → 最初の1文 → 先頭30文字 の順に探す（AI が末尾を少し変えて書き写したときの受け皿）
  const firstSentence = normalizeQuote(quote.split(/[。．.!?！？\n]/)[0] ?? "");
  const candidates = [q, firstSentence.length >= 8 ? firstSentence : "", q.length > 30 ? q.slice(0, 30) : ""].filter(Boolean);
  for (const cand of candidates) {
    const at = text.indexOf(cand);
    if (at < 0) continue;
    const start = map[at];
    const end = map[at + cand.length - 1];
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset + 1);
    return range;
  }
  return null;
}

type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void };
function registry(): HighlightRegistry | null {
  const css = (globalThis as any).CSS;
  const HighlightCtor = (globalThis as any).Highlight;
  return css?.highlights && typeof HighlightCtor === "function" ? css.highlights as HighlightRegistry : null;
}

function applyHighlight(range: Range) {
  const reg = registry();
  if (reg) reg.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(range));
}

function clearHighlight() {
  registry()?.delete(HIGHLIGHT_NAME);
}

function scrollToRange(range: Range) {
  const el = range.startContainer.parentElement;
  el?.scrollIntoView({ block: "center", behavior: "smooth" });
}

export function ResearchQuoteHighlighter() {
  const location = useLocation();
  const quote = (location.state as ResearchQuoteState | null)?.researchQuote?.trim() || "";
  const { toast } = useToast();

  useEffect(() => {
    if (!quote) return;
    let tries = 0;
    let found: Range | null = null;
    let keep = 0;
    const timer = window.setInterval(() => {
      if (!found) {
        tries++;
        const range = findRange(quote);
        if (range) {
          found = range;
          applyHighlight(range);
          scrollToRange(range);
          return;
        }
        if (tries >= MAX_TRIES) {
          window.clearInterval(timer);
          toast("該当の文が見つかりませんでした", "error");
        }
        return;
      }
      // 画面が描き直されて範囲の文字が DOM から外れたら、探し直して付け直す（スクロールはしない）
      keep++;
      if (!found.startContainer.isConnected || !found.endContainer.isConnected) {
        const again = findRange(quote);
        if (again) { found = again; applyHighlight(again); }
      }
      if (keep >= KEEP_TRIES) window.clearInterval(timer);
    }, POLL_MS);
    return () => { window.clearInterval(timer); clearHighlight(); };
  }, [location.key, quote, toast]);

  return quote ? <style>{`::highlight(${HIGHLIGHT_NAME}) { background-color: #FDE047; color: inherit; }`}</style> : null;
}
