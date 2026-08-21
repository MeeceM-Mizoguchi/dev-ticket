// ENHA2-035 Word の書式を TipTap 上で保持・編集するための拡張
//
// TipTap の標準セットは「太字・斜体・下線・打ち消し・見出し・箇条書き・表」までで、
// 文字色/サイズ/書体・上付き下付き・配置・字下げ・行間・段落の網かけ/罫線・
// セルの塗り/列幅は保持できない。ここでは
//   DocxSpan   … 文字の書式を span の style として持ち回るマーク
//   Superscript / Subscript … 上付き・下付き
//   DocxBlockStyle … 段落・見出し・引用・セルに style 属性を生やす拡張
// を用意する。style を文字列のまま持つのは、Word 由来の書式を取りこぼさずに
// 保存側（htmlToDocx）へ渡すため。ツールバーからの変更は mergeStyle で
// 必要なプロパティだけ差し替える。

import { Mark, Extension, mergeAttributes } from "@tiptap/core";

// ── style 文字列のユーティリティ ────────────────────────────

export function parseStyle(style?: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (style ?? "").split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}

export function serializeStyle(map: Record<string, string>): string {
  return Object.entries(map).map(([k, v]) => `${k}:${v}`).join(";");
}

/** 既存の style に指定分だけ上書きする（null を渡した項目は削除） */
export function mergeStyle(style: string | null | undefined, patch: Record<string, string | null>): string | null {
  const map = parseStyle(style);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete map[k];
    else map[k] = v;
  }
  const out = serializeStyle(map);
  return out || null;
}

/** style から1プロパティだけ取り出す（ツールバーの現在値表示に使う） */
export function styleValue(style: string | null | undefined, prop: string): string | undefined {
  return parseStyle(style)[prop];
}

// ── 文字の書式 ────────────────────────────────────────────

export const DocxSpan = Mark.create({
  name: "docxSpan",
  priority: 1000,
  keepOnSplit: true,

  addAttributes() {
    return {
      style: {
        default: null,
        parseHTML: el => (el as HTMLElement).getAttribute("style"),
        renderHTML: attrs => (attrs.style ? { style: attrs.style } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[style]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      /** 選択範囲の文字書式を（既存の指定を残したまま）変更する */
      setRunStyle: (patch: Record<string, string | null>) => ({ state, tr, dispatch }: any) => {
        const type = state.schema.marks.docxSpan;
        if (!type) return false;
        const { from, to, empty } = state.selection;
        if (empty) {
          const current = type.isInSet(state.storedMarks || state.selection.$from.marks());
          const style = mergeStyle(current?.attrs.style, patch);
          if (dispatch) {
            if (style) tr.addStoredMark(type.create({ style }));
            else tr.removeStoredMark(type);
            dispatch(tr);
          }
          return true;
        }
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!node.isText) return;
          const start = Math.max(pos, from);
          const end = Math.min(pos + node.nodeSize, to);
          if (start >= end) return;
          const current = type.isInSet(node.marks);
          const style = mergeStyle(current?.attrs.style, patch);
          tr.removeMark(start, end, type);
          if (style) tr.addMark(start, end, type.create({ style }));
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    } as any;
  },
});

// ── 上付き・下付き ────────────────────────────────────────

function simpleMark(name: string, tag: string) {
  return Mark.create({
    name,
    parseHTML() { return [{ tag }]; },
    renderHTML({ HTMLAttributes }) { return [tag, mergeAttributes(HTMLAttributes), 0]; },
  });
}

export const Superscript = simpleMark("superscript", "sup");
export const Subscript = simpleMark("subscript", "sub");

// ── 段落・見出し・引用・セルの書式 ─────────────────────────

const BLOCK_TYPES = ["paragraph", "heading", "blockquote", "listItem", "tableCell", "tableHeader"];
// 表そのものにも style を持たせる（--dv-cell-border＝その表の既定罫線を保持するため）
const STYLED_TYPES = [...BLOCK_TYPES, "table"];

export const DocxBlockStyle = Extension.create({
  name: "docxBlockStyle",

  addGlobalAttributes() {
    return [{
      types: STYLED_TYPES,
      attributes: {
        style: {
          default: null,
          parseHTML: (el: HTMLElement) => el.getAttribute("style"),
          renderHTML: (attrs: any) => (attrs.style ? { style: attrs.style } : {}),
        },
      },
    }];
  },

  addCommands() {
    return {
      /** 選択している段落（見出し・セル）の書式を変更する */
      setBlockStyle: (patch: Record<string, string | null>) => ({ state, tr, dispatch }: any) => {
        const { from, to } = state.selection;
        let touched = false;
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!node.isTextblock || !BLOCK_TYPES.includes(node.type.name)) return;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, style: mergeStyle(node.attrs.style, patch) });
          touched = true;
        });
        if (touched && dispatch) dispatch(tr);
        return touched;
      },

      /** カーソルがある表そのものの書式（既定罫線など）を変更する */
      setTableStyle: (patch: Record<string, string | null>) => ({ state, tr, dispatch }: any) => {
        const $from = state.selection.$from;
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name !== "table") continue;
          const pos = $from.before(depth);
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, style: mergeStyle(node.attrs.style, patch) });
            dispatch(tr);
          }
          return true;
        }
        return false;
      },

      /** 段落の字下げを1段（Word と同じ 0.5インチ）増減する */
      changeIndent: (deltaPx: number) => ({ state, chain }: any) => {
        const { from, to } = state.selection;
        const patches: Array<{ pos: number; style: string | null; attrs: any }> = [];
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!node.isTextblock || !BLOCK_TYPES.includes(node.type.name)) return;
          const current = parseFloat((styleValue(node.attrs.style, "margin-left") ?? "0").replace("px", "")) || 0;
          const next = Math.max(0, current + deltaPx);
          patches.push({ pos, attrs: node.attrs, style: mergeStyle(node.attrs.style, { "margin-left": next ? `${next}px` : null }) });
        });
        if (!patches.length) return false;
        return chain().command(({ tr, dispatch }: any) => {
          patches.forEach(p => tr.setNodeMarkup(p.pos, undefined, { ...p.attrs, style: p.style }));
          if (dispatch) dispatch(tr);
          return true;
        }).run();
      },
    } as any;
  },
});
