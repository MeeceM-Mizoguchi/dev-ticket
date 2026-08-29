import { useEditor, EditorContent, ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableMap, CellSelection } from "@tiptap/pm/tables";
import Mention from "@tiptap/extension-mention";
import { MermaidNode } from "./MermaidNode";
import { MermaidEditModal } from "./MermaidEditModal";
import { ImageLightbox, useImageLightbox } from "./ImageLightbox";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
// 貼り付けた Markdown テキスト（Claude のコピーボタン等）を書式つきで取り込む
import { markdownToHtml, markdownFileToHtml } from "@/app/lib/markdown";
import { isSubmitShortcut, isImeComposing } from "@/app/lib/submitKey";
import { useToast } from "@/app/contexts/ToastContext";
import type { NodeViewProps } from "@tiptap/react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
// 🌟 修正: ゴミ箱アイコン (Trash2) を lucide-react から追加インポート
import { Copy, X, CheckCheck, Trash2, FileUp } from "lucide-react";
// 🌟 追加: 外部リンクを開く共通ヘルパー（ネイティブはアプリ内ブラウザ、Webは別タブ）
import { openExternalUrl } from "@/lib/openExternal";
// ホワイトボードのオブジェクトリンクは外部ブラウザではなく、右半分のプレビューで開く
import { usePreviewPanel } from "@/app/contexts/PreviewPanelContext";
import { parseWhiteboardLink } from "@/app/lib/whiteboardLink";
import { requestWhiteboardFocus } from "@/app/lib/whiteboardFocusBus";
// 貼られた DevTicket 内リンク(チケット/バックログ/Wiki/議事録/ファイル/ボード)をチップ表示にする
import { InternalLinkNode, INTERNAL_LINK_NODE_NAME, convertInternalUrlsInEditor } from "./InternalLinkChip";
import type { InternalLinkHandlers } from "./InternalLinkChip";
import { navigateInActiveTab, getActiveTabPath } from "@/app/contexts/TabContext";
import { useNavigate } from "react-router";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

// ── Markdown ファイル取り込み ────────────────────────────────
// 受け付ける拡張子。file.type は環境によって空文字や text/plain になり当てにならないため、
// MIME ではなく拡張子で判定する（macOS/Windows/WKWebView で挙動が揃う）。
const MD_FILE_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
const MD_FILE_ACCEPT = MD_FILE_EXTENSIONS.join(",");
// 解析コストと事故防止の上限。設計書クラス(数十KB)でも十分に余裕がある。
const MD_FILE_MAX_BYTES = 2 * 1024 * 1024;
function isMarkdownFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return MD_FILE_EXTENSIONS.some(ext => name.endsWith(ext));
}

// 🌟 BRU4-049: 表の列幅暴走(横スクロール)対策。
//   prosemirror-tables は「先頭行のセルの colwidth」だけで表幅を決め、全列に幅があれば
//   table 実寸(px)を指定して左寄せに、1列でも欠けると width:100% にフォールバックし、
//   幅未指定の列が残り幅を全部吸って異常に広がる（＝partial状態が暴走の原因）。
//   ドラッグ・列追加・既存表など、あらゆる経路で partial になり得るため、doc変更のたびに
//   「一部だけ幅がある表」を検出して未指定セルを既定幅(150px)で補完し、暴走を根本から防ぐ。
const TABLE_DEFAULT_COL_WIDTH = 150;
const NormalizeTableWidths = Extension.create({
  name: "normalizeTableWidths",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("normalizeTableWidths"),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((t) => t.docChanged)) return null;
          let tr: any = null;
          newState.doc.descendants((node: any, pos: number) => {
            if (node.type.name !== "table") return;
            const firstRow = node.firstChild;
            if (!firstRow) return false;
            // 先頭行が「一部だけ幅あり」= partial のときだけ補完（全指定/全未指定は触らない）
            let hasSized = false;
            let hasUnsized = false;
            firstRow.forEach((cell: any) => {
              const colspan: number = cell.attrs.colspan || 1;
              const cw: (number | null)[] | null = cell.attrs.colwidth;
              if (cw && cw.length === colspan && cw.every((w) => !!w)) hasSized = true;
              else hasUnsized = true;
            });
            if (!(hasSized && hasUnsized)) return false;
            const tableStart = pos + 1;
            node.forEach((rowNode: any, rowOffset: number) => {
              let cellPos = tableStart + rowOffset + 1;
              rowNode.forEach((cellNode: any) => {
                const colspan: number = cellNode.attrs.colspan || 1;
                const cw: (number | null)[] | null = cellNode.attrs.colwidth;
                if (!cw || cw.length !== colspan || cw.some((w) => !w)) {
                  const filled = Array.from({ length: colspan }, (_, i) => (cw && cw[i]) || TABLE_DEFAULT_COL_WIDTH);
                  if (!tr) tr = newState.tr;
                  tr.setNodeMarkup(cellPos, null, { ...cellNode.attrs, colwidth: filled });
                }
                cellPos += cellNode.nodeSize;
              });
            });
            return false;
          });
          if (tr) tr.setMeta("addToHistory", false);
          return tr;
        },
      }),
      // 🌟 BRU13-045: 以前ここにあった「エディタ幅に収める比例縮小(clampTableWidths)」は撤去した。
      //   列を広げても画面幅で頭打ちになり、列数の多い設計書のような表が潰れて読めなくなるため。
      //   幅が溢れたぶんは表ラッパー(.tableWrapper)の横スクロールで見る。
    ];
  },
});

// 🌟 BRU13-045: 列の内容にフィットする幅(px)を実測する。
//   セルのHTMLごと複製して測るので、チップ・画像・太字などもそのままの見た目で幅に反映される。
//   上限は長文セル1つで列が数千pxに伸びるのを防ぐため。手動ドラッグ側には上限を設けない。
const TABLE_FIT_MAX_WIDTH = 640;
const TABLE_MIN_COL_WIDTH = 60;
function measureCellsWidth(cells: HTMLTableCellElement[]): number {
  const m = document.createElement("div");
  // 本文と同じ .tiptap のスタイル（リストの字下げ・メンションチップの余白など）を効かせて測るため
  // クラスを合わせる。エディタ本体の中に入れると ProseMirror が編集とみなすので body 直下に置く。
  m.className = "tiptap";
  m.style.cssText = "position:absolute;visibility:hidden;left:-9999px;top:0;padding:0;margin:0;min-height:0;white-space:nowrap;width:max-content;";
  document.body.appendChild(m);
  let max = 0;
  try {
    for (const cell of cells) {
      if (!cell) continue;
      const cs = getComputedStyle(cell);
      m.style.fontFamily = cs.fontFamily;
      m.style.fontSize = cs.fontSize;
      m.style.fontWeight = cs.fontWeight;
      m.style.fontStyle = cs.fontStyle;
      m.style.letterSpacing = cs.letterSpacing;
      m.innerHTML = cell.innerHTML;
      // 子要素の折り返し・幅制限（img の max-width:100% など）を外して自然幅にする
      m.querySelectorAll<HTMLElement>("*").forEach(el => { el.style.whiteSpace = "nowrap"; el.style.maxWidth = "none"; });
      if (m.scrollWidth > max) max = m.scrollWidth;
      // 稀に複製が測れない（0）ときはテキストだけで測り直す
      if (!m.scrollWidth) {
        for (const line of (cell.innerText || "").split("\n")) {
          m.textContent = line || " ";
          if (m.scrollWidth > max) max = m.scrollWidth;
        }
      }
    }
  } finally {
    document.body.removeChild(m);
  }
  // padding(10px*2) + 罫線 + わずかな余白
  return Math.min(TABLE_FIT_MAX_WIDTH, Math.max(TABLE_MIN_COL_WIDTH, Math.ceil(max) + 24));
}
// 列内の全セルを見て、その列が内容に合う幅を返す
function measureColWidthDom(tableDom: HTMLTableElement, colIndex: number): number {
  return measureCellsWidth(Array.from(tableDom.rows).map(r => r.cells[colIndex]).filter(Boolean));
}

// 🌟 BRU13-045: 行罫線のハイライト（列の .column-resize-handle と同じ緑線）とドラッグ中の高さ表示。
//   どちらもデコレーションで当てる。<tr> の style や class を直接いじると、
//   prosemirror-tables の TableView.ignoreMutation が tbody 内（＝行）の変更を無視しない作りなので、
//   ProseMirror が「外から編集された」と判断してその場で描き直し、見た目が即座に元へ戻ってしまう。
//   （列側が DOM 直接操作で成立しているのは、colgroup が tbody の外にあり無視対象だから）
//   height:null は「罫線にホバー中（緑線だけ）」、数値は「ドラッグ中（その高さで表示）」を表す。
//   複数行を選択したままドラッグすると、選択中の行すべてが同じ高さで動くので positions は配列。
type RowResizeState = { positions: number[]; height: number | null } | null;
const rowResizeKey = new PluginKey<RowResizeState>("rowResize");
const RowResizeDecoration = Extension.create({
  name: "rowResizeDecoration",
  addProseMirrorPlugins() {
    return [
      new Plugin<RowResizeState>({
        key: rowResizeKey,
        state: {
          init: () => null,
          apply(tr, value) {
            const meta = tr.getMeta(rowResizeKey);
            if (meta !== undefined) return meta as RowResizeState;
            if (!value) return null;
            return tr.docChanged ? { ...value, positions: value.positions.map(p => tr.mapping.map(p)) } : value;
          },
        },
        props: {
          decorations(state) {
            const v = rowResizeKey.getState(state);
            if (!v) return null;
            const attrs: Record<string, string> = { class: "row-resize-active" };
            if (v.height !== null) attrs.style = `height: ${v.height}px`;
            const decos = v.positions.flatMap(pos => {
              const node = state.doc.nodeAt(pos);
              if (!node || node.type.name !== "tableRow") return [];
              return [Decoration.node(pos, pos + node.nodeSize, attrs)];
            });
            return decos.length ? DecorationSet.create(state.doc, decos) : null;
          },
        },
      }),
    ];
  },
});

// 🌟 BRU13-045: 行の高さ(rowheight)を持てる tableRow。
//   prosemirror-tables は列幅(colwidth)しか持たないため、行だけ「内容なり」で固定だった。
//   横罫線のドラッグで高さを変えられるようにし、ダブルクリックで内容にフィット(=高さ解除)する。
//   HTML の <tr style="height:NNpx"> として保存するので、Excel/Word から貼った行高も引き継げる。
const ResizableTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowheight: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.style.height || element.getAttribute("data-rowheight") || element.getAttribute("height") || "";
          const n = parseFloat(raw);
          return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
        },
        renderHTML: (attributes: Record<string, any>) => {
          const h = attributes.rowheight;
          if (!h) return {};
          return { style: `height: ${h}px`, "data-rowheight": String(h) };
        },
      },
    };
  },
});

// 🌟 BRU9-044: クリップボードのHTMLに表が含まれるか判定する。
//   Excel / Googleスプレッドシート / Word / Notion などから表をコピーすると、
//   クリップボードには「表のHTML」と「セル範囲を描画したビットマップ画像」が同時に載る。
//   画像を優先すると表が画像として貼り付いてしまうため、表があれば画像側は捨てる。
//   コピー元によっては <table> ではなく <tr> から始まる断片が載るので、そちらも表とみなす
//   （ProseMirror の readHTML が <table><tbody> を補ってくれるため、どちらでも表として貼れる）。
export function clipboardHasTable(data: DataTransfer | null): boolean {
  const html = data?.getData("text/html") ?? "";
  return /<table[\s>]/i.test(html) || (/<tr[\s>]/i.test(html) && /<t[dh][\s>]/i.test(html));
}

// 🌟 BRU9-044: タブ区切りテキストを表のHTMLに変換する。表のHTMLをクリップボードに載せない
//   表計算ソフト向けのフォールバック。誤検知（タブを含むコードの貼り付けなど）を避けるため、
//   「2行以上」「2列以上」「全行の列数が一致」を満たすときだけ表とみなす。
//   セル内改行は Excel の TSV と同じくダブルクォートで囲まれるので、その解除も行う。
export function tsvToTableHtml(text: string): string | null {
  if (!text.includes("\t")) return null;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { cell += ch; continue; }
      if (text[i + 1] === '"') { cell += '"'; i++; continue; }
      quoted = false;
      continue;
    }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === "\t") { row.push(cell); cell = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  const cols = rows[0]?.length ?? 0;
  if (rows.length < 2 || cols < 2 || rows.some(r => r.length !== cols)) return null;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cellHtml = (s: string) => `<td>${s.split("\n").map(line => `<p>${esc(line)}</p>`).join("")}</td>`;
  return `<table><tbody>${rows.map(r => `<tr>${r.map(cellHtml).join("")}</tr>`).join("")}</tbody></table>`;
}

// ---- インライン画像 NodeView（ホバーでコピー/削除、クリックで拡大表示） ----
function ImageNodeView({ node, deleteNode, editor, getPos }: NodeViewProps) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const { lightbox, openLightbox, closeLightbox, setLightboxIndex } = useImageLightbox();
  const src = (node.attrs as { src: string }).src;
  const isEditable = editor.isEditable;

  // 同じ本文に並んでいる画像をまとめて対象にし、拡大表示から矢印で送れるようにする
  const openPreview = () => {
    let selfPos: number | null = null;
    try { selfPos = typeof getPos === "function" ? getPos() ?? null : null; } catch { selfPos = null; }
    const srcs: string[] = [];
    let selfIndex = 0;
    editor.state.doc.descendants((n, pos) => {
      if (n.type.name !== "image") return;
      const s = (n.attrs as { src?: string }).src;
      if (!s) return;
      if (selfPos !== null && pos === selfPos) selfIndex = srcs.length;
      srcs.push(s);
    });
    if (srcs.length === 0) { openLightbox([src], 0); return; }
    openLightbox(srcs, selfIndex);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(src);
      const blob = await res.blob();
      let pngBlob: Blob;
      if (blob.type === "image/png") {
        pngBlob = blob;
      } else {
        const bmp = await createImageBitmap(blob);
        const canvas = document.createElement("canvas");
        canvas.width = bmp.width; canvas.height = bmp.height;
        canvas.getContext("2d")!.drawImage(bmp, 0, 0);
        pngBlob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(b => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png")
        );
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) { console.error(err); }
  };

  return (
    <NodeViewWrapper as="span" style={{ display: "inline-block", position: "relative", lineHeight: 0 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}>
      <img src={src} style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 6, margin: "4px 0", display: "block", objectFit: "contain", boxShadow: "0 1px 4px rgba(0,0,0,0.10)", cursor: "zoom-in" }}
        onClick={openPreview} />
      {hovered && isEditable && (
        <div contentEditable={false} style={{ position: "absolute", top: 8, right: 4, display: "flex", gap: 4 }}>
          <button type="button" onMouseDown={handleCopy}
            style={{ width: 22, height: 22, borderRadius: "50%", background: "#1A1714", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="コピー">
            {copied ? <CheckCheck style={{ width: 10, height: 10, color: "#4ADE80" }} /> : <Copy style={{ width: 10, height: 10, color: "#FFF" }} />}
          </button>
          <button type="button" onMouseDown={(e) => { e.stopPropagation(); deleteNode(); }}
            style={{ width: 22, height: 22, borderRadius: "50%", background: "#DC2626", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            title="削除">
            <X style={{ width: 10, height: 10, color: "#FFF" }} />
          </button>
        </div>
      )}
      {lightbox && (
        <ImageLightbox images={lightbox.images} index={lightbox.index}
          onIndexChange={setLightboxIndex} onClose={closeLightbox} />
      )}
    </NodeViewWrapper>
  );
}

const CustomImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView as any);
  },
}).configure({ inline: true, allowBase64: false });

// ---- SuggestionStore: editor.storage 経由でチケット/メンバーをプラグインに渡す ----
const SuggestionStore = Extension.create({
  name: "suggestionStore",
  addStorage() {
    return {
      members: [] as string[],
      tickets: [] as { wbs: string; title: string }[],
      backlogItems: [] as { id: string; title: string }[],
      wikiItems: [] as { id: string; title: string }[],
      minuteItems: [] as { id: string; title: string }[],
      fileItems: [] as { id: string; title: string }[],
    };
  },
});

// ---- MentionList popup component ----------------------------------------
interface MentionListProps {
  items: string[];
  command: (p: { id: string; label: string }) => void;
}
interface MentionListHandle {
  onKeyDown: (p: SuggestionKeyDownProps) => boolean;
}

const MentionList = forwardRef<MentionListHandle, MentionListProps>(({ items, command }, ref) => {
  const [sel, setSel] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { setSel(0); }, [items]);

  useEffect(() => {
    itemRefs.current[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // 日本語変換中の ↑↓ は候補送り、Enter は変換確定。ここで拾うと打ちかけで挿入されてしまう
      if (isImeComposing(event)) return false;
      if (event.key === "ArrowUp") { setSel(i => (i - 1 + items.length) % items.length); return true; }
      if (event.key === "ArrowDown") { setSel(i => (i + 1) % items.length); return true; }
      if (event.key === "Enter") {
        const item = items[sel];
        if (item) command({ id: item, label: item });
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return null;

  return (
    <>
      {items.map((item, i) => (
        <button key={item}
          ref={el => { itemRefs.current[i] = el; }}
          onMouseDown={e => { e.preventDefault(); command({ id: item, label: item }); }}
          style={{ width: "100%", padding: "7px 12px", textAlign: "left" as const, background: i === sel ? "#ECFDF5" : "transparent", border: "none", cursor: "pointer", fontSize: 12, color: i === sel ? "#059669" : "#1A1714", display: "flex", alignItems: "center", gap: 8, transition: "background 0.1s", boxSizing: "border-box" as const }}
          onMouseEnter={() => setSel(i)}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#E8F5F1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#059669", flexShrink: 0 }}>
            {item.charAt(0)}
          </span>
          {item}
        </button>
      ))}
    </>
  );
});
MentionList.displayName = "MentionList";

// ---- LinkMentionList popup: バックログ・Wiki・議事録の統合 $メンション ----
interface LinkMentionOption { id: string; title: string; sub?: string; type: "backlog" | "wiki" | "minute" }
interface LinkMentionListProps {
  items: LinkMentionOption[];
  command: (p: { id: string; label: string }) => void;
}

const TYPE_STYLE: Record<LinkMentionOption["type"], { bg: string; color: string; label: string }> = {
  backlog: { bg: "#EDE9FE", color: "#6D28D9", label: "バックログ" },
  wiki: { bg: "#E0F2FE", color: "#0284C7", label: "Wiki" },
  minute: { bg: "#D1FAE5", color: "#059669", label: "議事録" },
};

const LinkMentionList = forwardRef<MentionListHandle, LinkMentionListProps>(({ items, command }, ref) => {
  const [sel, setSel] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { setSel(0); }, [items]);

  useEffect(() => {
    itemRefs.current[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // 日本語変換中の ↑↓ は候補送り、Enter は変換確定。ここで拾うと打ちかけで挿入されてしまう
      if (isImeComposing(event)) return false;
      if (event.key === "ArrowUp") { setSel(i => (i - 1 + items.length) % items.length); return true; }
      if (event.key === "ArrowDown") { setSel(i => (i + 1) % items.length); return true; }
      if (event.key === "Enter") {
        const item = items[sel];
        if (item) command({ id: `${item.type}:${item.id}`, label: item.title });
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return (
    <div style={{ padding: "10px 14px", fontSize: 11, color: "#B0A9A4" }}>該当なし</div>
  );

  return (
    <>
      {items.map((item, i) => {
        const ts = TYPE_STYLE[item.type];
        return (
          <button key={`${item.type}:${item.id}`}
            ref={el => { itemRefs.current[i] = el; }}
            onMouseDown={e => { e.preventDefault(); command({ id: `${item.type}:${item.id}`, label: item.title }); }}
            style={{
              width: "100%", padding: "7px 12px", textAlign: "left" as const,
              background: i === sel ? "#F5F3FF" : "transparent",
              border: "none", cursor: "pointer", fontSize: 12,
              color: i === sel ? "#6D28D9" : "#1A1714",
              display: "flex", alignItems: "center", gap: 8,
              transition: "background 0.1s", boxSizing: "border-box" as const,
            }}
            onMouseEnter={() => setSel(i)}>
            <span style={{
              padding: "1px 6px", borderRadius: 4, background: ts.bg,
              fontSize: 10, fontWeight: 700, color: ts.color,
              flexShrink: 0, whiteSpace: "nowrap" as const,
            }}>
              {ts.label}
            </span>
            <span style={{
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
              flex: 1, color: "#6B6458", fontSize: 11,
            }}>
              {item.title}
            </span>
            {/* プロジェクト横断で候補を出す画面では、同名を区別できるようPJ名を添える */}
            {item.sub && (
              <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0, whiteSpace: "nowrap" as const }}>
                {item.sub}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
});
LinkMentionList.displayName = "LinkMentionList";

// ---- FileMentionList popup: ファイルボックスの %メンション (ENHA2-035) ----
interface FileMentionListProps {
  items: { id: string; title: string; sub?: string }[];
  command: (p: { id: string; label: string }) => void;
}

const FileMentionList = forwardRef<MentionListHandle, FileMentionListProps>(({ items, command }, ref) => {
  const [sel, setSel] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { setSel(0); }, [items]);
  useEffect(() => { itemRefs.current[sel]?.scrollIntoView({ block: "nearest" }); }, [sel]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // 日本語変換中の ↑↓ は候補送り、Enter は変換確定。ここで拾うと打ちかけで挿入されてしまう
      if (isImeComposing(event)) return false;
      if (event.key === "ArrowUp") { setSel(i => (i - 1 + items.length) % items.length); return true; }
      if (event.key === "ArrowDown") { setSel(i => (i + 1) % items.length); return true; }
      if (event.key === "Enter") {
        const item = items[sel];
        if (item) command({ id: item.id, label: item.title });
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return (
    <div style={{ padding: "10px 14px", fontSize: 11, color: "#B0A9A4" }}>該当なし</div>
  );

  return (
    <>
      {items.map((item, i) => (
        <button key={item.id}
          ref={el => { itemRefs.current[i] = el; }}
          onMouseDown={e => { e.preventDefault(); command({ id: item.id, label: item.title }); }}
          onMouseEnter={() => setSel(i)}
          style={{
            width: "100%", padding: "7px 12px", textAlign: "left" as const,
            background: i === sel ? "#ECFEFF" : "transparent",
            border: "none", cursor: "pointer", fontSize: 12,
            color: i === sel ? "#0891B2" : "#1A1714",
            display: "flex", alignItems: "center", gap: 8,
            transition: "background 0.1s", boxSizing: "border-box" as const,
          }}>
          <span style={{
            padding: "1px 6px", borderRadius: 4, background: "#CFFAFE",
            fontSize: 10, fontWeight: 700, color: "#0891B2",
            flexShrink: 0, whiteSpace: "nowrap" as const,
          }}>ファイル</span>
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
            flex: 1, color: "#6B6458", fontSize: 11,
          }}>{item.title}</span>
          {item.sub && (
            <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0, whiteSpace: "nowrap" as const }}>
              {item.sub}
            </span>
          )}
        </button>
      ))}
    </>
  );
});
FileMentionList.displayName = "FileMentionList";

// ---- TicketMentionList popup component --------------------------------------
interface TicketItem { wbs: string; title: string }
interface TicketMentionListProps {
  items: TicketItem[];
  command: (p: { id: string; label: string }) => void;
}

const TicketMentionList = forwardRef<MentionListHandle, TicketMentionListProps>(({ items, command }, ref) => {
  const [sel, setSel] = useState(0);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { setSel(0); }, [items]);

  useEffect(() => {
    itemRefs.current[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      // 日本語変換中の ↑↓ は候補送り、Enter は変換確定。ここで拾うと打ちかけで挿入されてしまう
      if (isImeComposing(event)) return false;
      if (event.key === "ArrowUp") { setSel(i => (i - 1 + items.length) % items.length); return true; }
      if (event.key === "ArrowDown") { setSel(i => (i + 1) % items.length); return true; }
      if (event.key === "Enter") {
        const item = items[sel];
        if (item) command({ id: item.wbs, label: item.title });
        return true;
      }
      return false;
    },
  }));

  if (!items.length) return (
    <div style={{ padding: "10px 14px", fontSize: 11, color: "#B0A9A4" }}>チケットを読み込み中...</div>
  );

  return (
    <>
      {items.map((item, i) => (
        <button key={item.wbs}
          ref={el => { itemRefs.current[i] = el; }}
          onMouseDown={e => { e.preventDefault(); command({ id: item.wbs, label: item.title }); }}
          style={{
            width: "100%", padding: "7px 12px", textAlign: "left" as const,
            background: i === sel ? "#EFF6FF" : "transparent",
            border: "none", cursor: "pointer", fontSize: 12,
            color: i === sel ? "#1E40AF" : "#1A1714",
            display: "flex", alignItems: "center", gap: 8,
            transition: "background 0.1s", boxSizing: "border-box" as const,
          }}
          onMouseEnter={() => setSel(i)}>
          <span style={{
            padding: "1px 6px", borderRadius: 4, background: "#DBEAFE",
            fontSize: 10, fontWeight: 700, color: "#2563EB",
            flexShrink: 0, whiteSpace: "nowrap" as const,
          }}>
            #{item.wbs}
          </span>
          <span style={{
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
            flex: 1, color: "#6B6458", fontSize: 11,
          }}>
            {item.title}
          </span>
        </button>
      ))}
    </>
  );
});
TicketMentionList.displayName = "TicketMentionList";

// ---- helpers ----------------------------------------------------------------
const btnStyle = (active?: boolean): React.CSSProperties => ({
  padding: "3px 7px", fontSize: 11, fontWeight: 600, borderRadius: 5,
  border: `1px solid ${active ? "#059669" : "rgba(26,23,20,0.12)"}`,
  background: active ? "#ECFDF5" : "transparent",
  color: active ? "#059669" : "#6B6458",
  cursor: "pointer", lineHeight: 1.4,
});

// メンション候補ポップアップの目印。候補が開いている間の Enter は「候補の確定」が優先。
const SUGGESTION_POPUP_ATTR = "data-mention-suggestion";
const isSuggestionOpen = () => !!document.querySelector(`[${SUGGESTION_POPUP_ATTR}]`);

function makeSuggestionPopup<T>(
  Component: React.ComponentType<any>,
  width = 260,
) {
  return () => {
    let renderer: ReactRenderer<MentionListHandle, any> | null = null;
    let wrapper: HTMLDivElement | null = null;

    const position = (clientRect: (() => DOMRect | null) | null) => {
      if (!wrapper || !clientRect) return;
      const rect = clientRect();
      if (!rect) return;
      const GAP = 4;
      const MAX_H = 340;
      const spaceBelow = window.innerHeight - rect.bottom - GAP;
      const spaceAbove = rect.top - GAP;
      let top: number;
      let maxH: number;
      if (spaceBelow >= 100 || spaceBelow >= spaceAbove) {
        top = rect.bottom + GAP;
        maxH = Math.min(MAX_H, Math.max(80, spaceBelow));
      } else {
        maxH = Math.min(MAX_H, Math.max(80, spaceAbove));
        top = rect.top - maxH - GAP;
      }
      let left = rect.left;
      if (left + width + 8 > window.innerWidth) left = Math.max(8, window.innerWidth - width - 8);
      wrapper.style.top = `${top}px`;
      wrapper.style.left = `${left}px`;
      wrapper.style.maxHeight = `${maxH}px`;
    };

    return {
      onStart: (props: any) => {
        wrapper = document.createElement("div");
        // 候補が開いている間は ⌘/Ctrl+Enter の確定を抑止したいので、DOM から見分けられるようにする
        wrapper.setAttribute(SUGGESTION_POPUP_ATTR, "");
        wrapper.style.cssText = [
          "position:fixed", "z-index:9999",
          "background:#FFF", "border:1px solid rgba(26,23,20,0.12)",
          "border-radius:10px", "box-shadow:0 8px 24px rgba(0,0,0,0.14)",
          `overflow-y:auto`, `min-width:${width}px`, `max-width:${width + 60}px`,
        ].join(";");
        document.body.appendChild(wrapper);
        renderer = new ReactRenderer<MentionListHandle, any>(Component, { props, editor: props.editor });
        wrapper.appendChild(renderer.element);
        position(props.clientRect ?? null);
      },
      onUpdate: (props: any) => {
        renderer?.updateProps(props);
        position(props.clientRect ?? null);
      },
      onKeyDown: (props: any) => {
        if (props.event.key === "Escape") {
          wrapper?.remove(); renderer?.destroy(); wrapper = null; renderer = null;
          return true;
        }
        return renderer?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        wrapper?.remove(); renderer?.destroy(); wrapper = null; renderer = null;
      },
    };
  };
}

// ---- RichEditor -------------------------------------------------------------
export function RichEditor({
  value, onChange, placeholder, minHeight = 120, maxHeight, readOnly = false, toolbar = true, members = [], tickets = [], backlogItems = [], wikiItems = [], minuteItems = [], fileItems = [], onTicketClick, onBacklogClick, onWikiClick, onMinuteClick, onFileClick, onImageUpload, onSubmit, style,
}: {
  value?: string; onChange?: (html: string) => void;
  placeholder?: string; minHeight?: number | string; maxHeight?: number | string; readOnly?: boolean; toolbar?: boolean;
  members?: string[];
  tickets?: { wbs: string; title: string }[];
  // sub はプロジェクト横断で候補を出す画面(マイアクション等)の所属PJ名
  backlogItems?: { id: string; title: string; sub?: string }[];
  wikiItems?: { id: string; title: string; sub?: string }[];
  minuteItems?: { id: string; title: string; sub?: string }[];
  fileItems?: { id: string; title: string; sub?: string }[];
  onTicketClick?: (wbs: string) => void;
  onBacklogClick?: (id: string) => void;
  onWikiClick?: (id: string) => void;
  onMinuteClick?: (id: string) => void;
  onFileClick?: (id: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  // ⌘(Mac) / Ctrl(Windows) + Enter で確定。渡した画面だけ有効になる（Enter 単体は改行のまま）
  onSubmit?: () => void;
  style?: React.CSSProperties;
}) {
  const idRef = useRef(`re-${Math.random().toString(36).slice(2, 8)}`);
  const id = idRef.current;
  // useEditor は初回だけ生成されるので、editorProps の中から最新の onSubmit を見るために ref 経由にする
  const onSubmitRef = useRef(onSubmit);
  onSubmitRef.current = onSubmit;
  // Mermaid挿入モーダルの開閉（本文中はコードを見せず、入力はモーダルに集約する）
  const [mermaidModalOpen, setMermaidModalOpen] = useState(false);
  // ホワイトボードのオブジェクトリンク用。Provider の外(LP等)で使われても既定値が no-op なので安全。
  const { open: openPreviewPanel } = usePreviewPanel();
  // 内部リンクのチップから飛ぶための遷移手段（タブモードではアクティブタブ内で動かす）
  const navigate = useNavigate();
  // Markdown ファイルの取り込み（ツールバーの「MD取込」／エディタへのドロップ）
  const mdInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const editor = useEditor({
    extensions: [
      // 🌟 修正: StarterKit(v3)にLinkが内蔵されているため、別パッケージを追加せず
      //   StarterKit経由で設定する。URLを検知してリンク(aタグ)に自動変換。
      //   クリック時の遷移は openOnClick:false にして下のクリックハンドラで一元処理する
      //   （ネイティブ=アプリ内ブラウザ / Web=別タブ）。
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer",
          },
        },
      }),
      // Mermaid図の専用ノード（本文中は図だけ表示、コードはモーダルで編集）。
      MermaidNode,
      CustomImage,
      // 🌟 BRU4-049: 列幅ドラッグ可変。両端固定はやめ、表は左寄せで右方向へ伸縮。最小列幅60px。
      Table.configure({ resizable: true, cellMinWidth: 60 }),
      ResizableTableRow, TableCell, TableHeader,
      NormalizeTableWidths,
      RowResizeDecoration,
      // 生URLのアンカーを内部リンクのチップに読み替える。Link マークより先に <a> を判定するため
      // StarterKit より後ろに置き、拡張自体の priority を上げてある。
      InternalLinkNode,
      SuggestionStore,
      Mention.configure({
        HTMLAttributes: {},
        renderText({ node, suggestion }) {
          const char = (node.attrs.mentionSuggestionChar as string) ?? suggestion?.char ?? "@";
          if (char === "#") return `#${node.attrs.id ?? ""}`;
          if (char === "%") return `%${node.attrs.label ?? node.attrs.id ?? ""}`;
          if (char === "$") {
            const rawId = node.attrs.id ?? "";
            const label = node.attrs.label ?? rawId.split(":").slice(1).join(":") ?? rawId;
            return `$${label}`;
          }
          return `@${node.attrs.label ?? node.attrs.id ?? ""}`;
        },
        renderHTML({ options, node, suggestion }) {
          const char = (node.attrs.mentionSuggestionChar as string) ?? suggestion?.char ?? "@";
          if (char === "#") {
            return ["span", { ...options.HTMLAttributes, class: "ticket-mention", "data-id": node.attrs.id ?? "" }, `#${node.attrs.id ?? ""}`];
          }
          if (char === "%") {
            return ["span", { ...options.HTMLAttributes, class: "file-mention", "data-id": node.attrs.id ?? "" }, `%${node.attrs.label ?? node.attrs.id ?? ""}`];
          }
          if (char === "$") {
            const rawId = node.attrs.id ?? "";
            const [type] = rawId.split(":");
            const label = node.attrs.label ?? rawId.split(":").slice(1).join(":") ?? rawId;
            const cls = type === "wiki" ? "wiki-mention" : type === "minute" ? "minute-mention" : "backlog-mention";
            return ["span", { ...options.HTMLAttributes, class: cls, "data-id": rawId }, `$${label}`];
          }
          return ["span", { ...options.HTMLAttributes, class: "mention", "data-id": node.attrs.id ?? "" }, `@${node.attrs.label ?? node.attrs.id ?? ""}`];
        },
        suggestions: [
          {
            // @ユーザーメンション
            char: "@",
            items: ({ query, editor: ed }: { query: string; editor: any }) => {
              const m: string[] = ed?.storage?.suggestionStore?.members ?? [];
              return m.filter((s): s is string => typeof s === "string" && s.toLowerCase().includes(query.toLowerCase())).slice(0, 8);
            },
            render: makeSuggestionPopup(MentionList, 260),
          },
          {
            // #チケットメンション
            char: "#",
            items: ({ query, editor: ed }: { query: string; editor: any }) => {
              const t: { wbs: string; title: string }[] = ed?.storage?.suggestionStore?.tickets ?? [];
              const q = query.toLowerCase();
              return q
                ? t.filter(ticket =>
                  ticket.wbs.toLowerCase().includes(q) ||
                  ticket.title.toLowerCase().includes(q)
                )
                : t;
            },
            render: makeSuggestionPopup(TicketMentionList, 300),
          },
          {
            // $リンクメンション
            char: "$",
            items: ({ query, editor: ed }: { query: string; editor: any }) => {
              const b: { id: string; title: string }[] = ed?.storage?.suggestionStore?.backlogItems ?? [];
              const w: { id: string; title: string }[] = ed?.storage?.suggestionStore?.wikiItems ?? [];
              const m: { id: string; title: string }[] = ed?.storage?.suggestionStore?.minuteItems ?? [];
              const prefix = query[0]?.toUpperCase();
              const rest = query.slice(1).trimStart().toLowerCase();
              if (prefix === "B") {
                const src = rest ? b.filter(i => i.id.toLowerCase().includes(rest) || i.title.toLowerCase().includes(rest)) : b;
                return src.map(i => ({ ...i, type: "backlog" as const }));
              }
              if (prefix === "W") {
                const src = rest ? w.filter(i => i.title.toLowerCase().includes(rest)) : w;
                return src.map(i => ({ ...i, type: "wiki" as const }));
              }
              if (prefix === "G") {
                const src = rest ? m.filter(i => i.title.toLowerCase().includes(rest)) : m;
                return src.map(i => ({ ...i, type: "minute" as const }));
              }
              const all: { id: string; title: string; type: "backlog" | "wiki" | "minute" }[] = [
                ...b.map(i => ({ ...i, type: "backlog" as const })),
                ...w.map(i => ({ ...i, type: "wiki" as const })),
                ...m.map(i => ({ ...i, type: "minute" as const })),
              ];
              const q = query.toLowerCase();
              return q ? all.filter(i => i.title.toLowerCase().includes(q)) : all;
            },
            render: makeSuggestionPopup(LinkMentionList, 320),
          },
          {
            // %ファイルメンション (ENHA2-035)
            char: "%",
            items: ({ query, editor: ed }: { query: string; editor: any }) => {
              const f: { id: string; title: string }[] = ed?.storage?.suggestionStore?.fileItems ?? [];
              const q = query.toLowerCase();
              return q ? f.filter(i => i.title.toLowerCase().includes(q)) : f;
            },
            render: makeSuggestionPopup(FileMentionList, 320),
          },
        ],
      }),
    ],
    content: value || "",
    editable: !readOnly,
    // 🌟 BRU4-049: 読取専用では列幅補完(appendTransaction)による onChange を発火させない
    onUpdate: ({ editor }) => { if (!editor.isEditable) return; onChange?.(editor.getHTML()); },
    editorProps: {
      // ⌘/Ctrl + Enter で確定（作成する・更新する・投稿する 等）。
      // editorProps は拡張のプラグインより先に呼ばれるため、メンション候補が開いている間は
      // 候補確定を優先させて false を返す。IME変換中(isComposing)も拾わない。
      handleKeyDown: (_view, event) => {
        const submit = onSubmitRef.current;
        if (!submit) return false;
        if (!isSubmitShortcut(event)) return false;
        if (isSuggestionOpen()) return false;
        event.preventDefault();
        submit();
        return true;
      },
      handlePaste: onImageUpload ? (_view, event) => {
        const data = event.clipboardData;
        // 🌟 BRU9-044: Excel等の表をコピーすると、クリップボードには text/html(表のHTML) と
        //   image/png(セル範囲のビットマップ)の両方が載る。ここで image/* を無条件に拾って
        //   アップロードしていたため、表が画像として貼り付けられてしまっていた。
        //   HTMLに表が含まれるときは画像を無視し、ProseMirror標準のHTMLパース(=表として貼付)に任せる。
        if (clipboardHasTable(data)) return false;
        const items = Array.from(data?.items ?? []);
        const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
        if (imgFiles.length === 0) return false;
        // 🌟 BRU9-044: 表のHTMLをクリップボードに載せない表計算ソフトもある。画像と一緒に
        //   タブ区切りテキストが載っていれば表計算のセル範囲なので、そこから表を組み立てる。
        const tsvTable = tsvToTableHtml(data?.getData("text/plain") ?? "");
        if (tsvTable) {
          event.preventDefault();
          editor?.chain().focus().insertContent(tsvTable).run();
          return true;
        }
        event.preventDefault();
        imgFiles.forEach(async (file) => {
          const url = await onImageUpload(file);
          if (url) editor?.chain().focus().setImage({ src: url }).run();
          // アップロードが失敗すると「貼り付けたのに何も起きない」状態になるので必ず記録する
          else console.warn("[RichEditor] 画像を貼り付けられませんでした（アップロード先がURLを返しませんでした）", { type: file.type, size: file.size, clipboardTypes: data?.types });
        });
        return true;
      } : undefined,
      // 画像ドロップに加えて、Markdown ファイルのドロップも受ける。
      // MD 取り込みは画像アップロード先(onImageUpload)を持たないエディタでも動かしたいので、
      // handleDrop 自体は常に登録し、中で経路を分ける。
      handleDrop: (_view, event) => {
        if (readOnly) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        const mdFile = files.find(isMarkdownFile);
        if (mdFile) {
          event.preventDefault();
          void importMarkdownFile(mdFile);
          return true;
        }
        if (!onImageUpload) return false;
        const imgFiles = files.filter(f => f.type.startsWith("image/"));
        if (imgFiles.length === 0) return false;
        event.preventDefault();
        imgFiles.forEach(async (file) => {
          const url = await onImageUpload(file);
          if (url) editor?.chain().focus().setImage({ src: url }).run();
        });
        return true;
      },
      // 🌟 テキスト（text/plain）で貼られた Markdown を書式つきで取り込む。
      //   ProseMirror の parseFromClipboard は「text/html が無い」「Cmd+Shift+V」「コードブロック内」の
      //   ときだけテキスト経路に入り、このフックを呼ぶ（prosemirror-view: parseFromClipboard）。つまり
      //     ・ブラウザ選択コピー(HTMLあり) → 従来どおり HTML 経路（二重変換にならない）
      //     ・plain=true(Cmd/Ctrl+Shift+V) → ここで変換せず素の文字として貼る
      //     ・コードブロック内 → そもそも呼ばれない（貼ったコードが勝手に整形されない）
      //   が構造的に保証される。undefined を返すと ProseMirror の既定（改行で段落分割）に落ちる。
      clipboardTextParser: (text, $context, plain, view) => {
        if (plain) return undefined as any;
        // 表計算ソフト由来のタブ区切り(BRU9-044)も、画像を伴わない貼り付けでここに来る
        const html = tsvToTableHtml(text) ?? markdownToHtml(text);
        if (!html) return undefined as any;
        const dom = document.createElement("div");
        dom.innerHTML = html;
        return PMDOMParser.fromSchema(view.state.schema).parseSlice(dom, { context: $context });
      },
      clipboardTextSerializer: (slice) => {
        function inline(node: any): string {
          if (node.isText) {
            let t: string = node.text ?? '';
            const marks: string[] = (node.marks ?? []).map((m: any) => m.type.name as string);
            if (marks.includes('code')) return `\`${t}\``;
            if (marks.includes('bold')) t = `**${t}**`;
            if (marks.includes('italic')) t = `*${t}*`;
            if (marks.includes('strike')) t = `~~${t}~~`;
            return t;
          }
          // 段落内の改行(<br> = hardBreak)。ProseMirror の leaf ノードなので子を辿っても文字が出ず、
          // ここで拾わないと**コピーした文字から改行だけが消える**（BRU11-037）。
          // 段落内の改行は Markdown 取込(escText)やShift+Enterで普通に入るため、実害が大きい。
          if (node.type?.name === 'hardBreak') return '\n';
          // 内部リンクのチップはURLとしてコピーする（貼り直せば同じチップに戻る）
          if (node.type?.name === 'internalLink') return node.attrs?.href ?? '';
          if (node.type?.name === 'mention') {
            const char = node.attrs?.mentionSuggestionChar ?? '@';
            if (char === '#') return `#${node.attrs?.id ?? ''}`;
            if (char === '$') return `$${node.attrs?.id ?? ''}`;
            return `@${node.attrs?.label ?? node.attrs?.id ?? ''}`;
          }
          let out = '';
          node.forEach((c: any) => { out += inline(c); });
          return out;
        }

        function listBlock(node: any, depth: number): string {
          const t: string = node.type.name;
          const items: string[] = [];
          let idx = 0;
          node.forEach((li: any) => {
            const bullet = t === 'bulletList' ? '- ' : `${idx + 1}. `;
            const indent = '  '.repeat(depth);
            let text = '';
            let nested = '';
            li.forEach((child: any) => {
              const ct: string = child.type.name;
              if (ct === 'bulletList' || ct === 'orderedList') {
                nested += listBlock(child, depth + 1);
              } else {
                text += inline(child);
              }
            });
            const line = `${indent}${bullet}${text.replace(/\n+/g, ' ').trim()}`;
            items.push(nested.trim() ? `${line}\n${nested.trimEnd()}` : line);
            idx++;
          });
          return items.join('\n') + '\n';
        }

        function block(node: any): string {
          if (node.isText) return node.text ?? '';
          const t: string = node.type.name;
          if (t === 'internalLink') return node.attrs?.href ?? '';
          if (t === 'mention') {
            const char = node.attrs?.mentionSuggestionChar ?? '@';
            if (char === '#') return `#${node.attrs?.id ?? ''}`;
            if (char === '$') return `$${node.attrs?.id ?? ''}`;
            return `@${node.attrs?.label ?? node.attrs?.id ?? ''}`;
          }
          if (t === 'paragraph') return inline(node).trim() + '\n';
          if (t === 'hardBreak') return '\n';
          if (t === 'heading') {
            const level: number = node.attrs?.level ?? 1;
            return '#'.repeat(level) + ' ' + inline(node).trim() + '\n';
          }
          if (t === 'codeBlock') return '```' + (node.attrs?.language ?? '') + '\n' + (node.textContent ?? '') + '\n```\n';
          if (t === 'mermaid') return '```mermaid\n' + (node.attrs?.code ?? '') + '\n```\n';
          if (t === 'blockquote') {
            let inner = '';
            node.forEach((c: any) => { inner += block(c); });
            return inner.trim().split('\n').map((l: string) => `> ${l}`).join('\n') + '\n';
          }
          if (t === 'bulletList' || t === 'orderedList') return listBlock(node, 0);
          if (t === 'table') {
            const rows: string[][] = [];
            node.forEach((row: any) => {
              const cells: string[] = [];
              row.forEach((cell: any) => { cells.push(inline(cell).trim()); });
              rows.push(cells);
            });
            if (!rows.length) return '';
            const header = '| ' + rows[0].join(' | ') + ' |';
            const sep = '| ' + rows[0].map(() => '---').join(' | ') + ' |';
            return [header, sep, ...rows.slice(1).map(r => '| ' + r.join(' | ') + ' |')].join('\n') + '\n';
          }
          let out = '';
          node.forEach((c: any) => { out += block(c); });
          return out;
        }

        // ブロック（段落・見出し・リスト等）の区切りは空行にする。各 block() が末尾に '\n' を付けるので
        // '\n' で繋いで '\n\n' になる。単なる連結だと段落同士が1行で繋がり、Markdown として読み戻したとき
        // 1つの段落に融合してしまう（＝改行が失われる）。mdBlocksToMarkdown の区切りとも揃う。
        const parts: string[] = [];
        slice.content.forEach((node: any) => { parts.push(block(node)); });
        return parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      },
    },
  });

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.storage.suggestionStore.members = members;
    editor.storage.suggestionStore.tickets = tickets;
    editor.storage.suggestionStore.backlogItems = backlogItems;
    editor.storage.suggestionStore.wikiItems = wikiItems;
    editor.storage.suggestionStore.minuteItems = minuteItems;
    editor.storage.suggestionStore.fileItems = fileItems;
  }, [editor, members, tickets, backlogItems, wikiItems, minuteItems, fileItems]);

  // 内部リンクチップのクリック先。画面ごとに違うので editor.storage 経由で最新を渡す
  // （NodeView は useEditor の外側にいるため props では届かない）。
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // タブモードではアクティブタブの現在地、Web/iPhone では実URLを基準にする
    const basePath = getActiveTabPath() ?? (typeof window !== "undefined" ? window.location.pathname : "");
    const handlers: InternalLinkHandlers = {
      openPreview: openPreviewPanel,
      navigate: (path) => { if (!navigateInActiveTab(path)) navigate(path); },
      onTicketClick,
      currentProjectSlug: basePath.split("?")[0].split("/").filter(Boolean)[0] ?? "",
    };
    editor.storage[INTERNAL_LINK_NODE_NAME].handlers = handlers;
  }, [editor, openPreviewPanel, navigate, onTicketClick]);

  // 「URLを打って、空白も入れずにそのまま保存」に備える。autolink は末尾に空白か改行が来ないと
  // 動かないので、フォーカスが外れた時点で生URLを拾い直してチップにする。
  //
  // 走らせるのは「そのフォーカス中に実際に編集があったとき」だけ。読むために開いただけの本文まで
  // 書き換えると、触っていないのに更新扱い(更新者・更新日時の変化)になってしまう。
  useEffect(() => {
    if (!editor) return;
    let editedSinceFocus = false;
    const onFocus = () => { editedSinceFocus = false; };
    const onUpdate = () => { editedSinceFocus = true; };
    const onBlur = () => {
      if (!editedSinceFocus) return;
      editedSinceFocus = false;
      convertInternalUrlsInEditor(editor);
    };
    editor.on("focus", onFocus);
    editor.on("update", onUpdate);
    editor.on("blur", onBlur);
    return () => {
      editor.off("focus", onFocus);
      editor.off("update", onUpdate);
      editor.off("blur", onBlur);
    };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "";
    if (current !== incoming) editor.commands.setContent(incoming, false);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [readOnly, editor]);

  // 各種メンション（チケット / バックログ / Wiki / 議事録 / ファイル）のクリック統合ハンドラー
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;

      // 貼り付けたURLのチップは、見た目をそろえるため同じクラスを付けているが、行き先の決め方が違う
      // （別プロジェクトも指せる／議事録はURLのslugを正規IDに直す必要がある）。自分の onClick に任せる。
      if (el.closest(".internal-link-chip")) return;

      // メンション対象の要素を取得
      const mentionEl = el.closest(".ticket-mention, .backlog-mention, .wiki-mention, .minute-mention, .file-mention") as HTMLElement | null;
      if (!mentionEl) return;

      const rawId = mentionEl.getAttribute("data-id") ?? "";
      const innerText = mentionEl.innerText || mentionEl.textContent || "";

      // 1. テキストまたは data-id 内から WBS形式 (例: BRU-048, TT-001) を最優先で抽出
      //    #BRU-048 や $BRU-048 など、先頭記号やクラス名に関わらず確実にチケットとしてヒットさせる
      const wbsInText = innerText.match(/([A-Za-z0-9]+-\d+)/);
      const wbsInId = rawId.match(/([A-Za-z0-9]+-\d+)/);
      const matchedWbs = wbsInText?.[1] || wbsInId?.[1];

      if (matchedWbs) {
        e.preventDefault();
        e.stopPropagation();
        if (onTicketClick) {
          onTicketClick(matchedWbs);
        }
        return;
      }

      // 2. WBS形式でない場合、通常の各種メンション処理に振り分ける
      let cleanId = rawId;
      if (cleanId.includes(":")) {
        cleanId = cleanId.split(":").slice(1).join(":");
      }
      if (!cleanId) {
        cleanId = innerText.replace(/^[#$%]/, "").trim();
      }

      if ((mentionEl.classList.contains("backlog-mention") || rawId.startsWith("backlog:")) && onBacklogClick) {
        if (cleanId) {
          e.preventDefault();
          e.stopPropagation();
          onBacklogClick(cleanId);
          return;
        }
      }

      if ((mentionEl.classList.contains("wiki-mention") || rawId.startsWith("wiki:")) && onWikiClick) {
        if (cleanId) {
          e.preventDefault();
          e.stopPropagation();
          onWikiClick(cleanId);
          return;
        }
      }

      if ((mentionEl.classList.contains("minute-mention") || rawId.startsWith("minute:")) && onMinuteClick) {
        if (cleanId) {
          e.preventDefault();
          e.stopPropagation();
          onMinuteClick(cleanId);
          return;
        }
      }

      if ((mentionEl.classList.contains("file-mention") || rawId.startsWith("file:")) && onFileClick) {
        if (cleanId) {
          e.preventDefault();
          e.stopPropagation();
          onFileClick(cleanId);
          return;
        }
      }
    };

    dom.addEventListener("click", handler);
    return () => dom.removeEventListener("click", handler);
  }, [editor, onTicketClick, onBacklogClick, onWikiClick, onMinuteClick, onFileClick]);

  // 🌟 BRU4-049 / BRU13-045: 罫線の操作。
  //   - 縦罫線をダブルクリック → その列の内容にフィットした幅へ自動調整
  //   - 横罫線をダブルクリック → その行の高さ指定を解除して内容にフィット
  //   - 横罫線をドラッグ       → その行の高さを変更（列幅ドラッグの行版。prosemirror-tables は列しか持たない）
  useEffect(() => {
    if (!editor || readOnly) return;
    const dom = editor.view.dom;
    const EDGE = 5;          // 縦罫線の当たり判定(px)。prosemirror-tables の列ハンドル(5px)に合わせる
    const ROW_EDGE = 6;      // 横罫線の当たり判定(px)
    const MIN_ROW_HEIGHT = 24;

    // セルDOMから、その表のノード・位置・マップをまとめて引く
    type TableInfo = { table: any; tableStart: number; map: TableMap };
    const tableInfoAt = (cellDom: HTMLElement): TableInfo | null => {
      const view = editor.view;
      const $pos = view.state.doc.resolve(view.posAtDOM(cellDom, 0));
      let d = $pos.depth;
      while (d > 0 && $pos.node(d).type.name !== "table") d--;
      if (d === 0) return null;
      const table = $pos.node(d);
      return { table, tableStart: $pos.start(d), map: TableMap.get(table) };
    };

    // セル選択（複数セルをドラッグで選んだ状態）の範囲。列 [left,right) 行 [top,bottom)
    const selectedRect = (): { left: number; right: number; top: number; bottom: number; info: TableInfo } | null => {
      const sel: any = editor.view.state.selection;
      if (!(sel instanceof CellSelection)) return null;
      const table = sel.$anchorCell.node(-1);
      const tableStart = sel.$anchorCell.start(-1);
      const map = TableMap.get(table);
      const rect = map.rectBetween(sel.$anchorCell.pos - tableStart, sel.$headCell.pos - tableStart);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, info: { table, tableStart, map } };
    };

    // 指定列（複数可）の全行セルに colwidth をセットする
    // （アプリ内の表はセル結合なし前提でDOM列index=マップ列index）
    const applyColWidths = (info: TableInfo, widths: Map<number, number>) => {
      const view = editor.view;
      const tr = view.state.tr;
      widths.forEach((width, colIndex) => {
        const seen = new Set<number>();
        for (let r = 0; r < info.map.height; r++) {
          const cellRel = info.map.map[r * info.map.width + colIndex];
          if (seen.has(cellRel)) continue;
          seen.add(cellRel);
          const cellNode = info.table.nodeAt(cellRel);
          if (!cellNode) continue;
          tr.setNodeMarkup(info.tableStart + cellRel, null, { ...cellNode.attrs, colwidth: [width] });
        }
      });
      if (tr.docChanged) view.dispatch(tr);
    };

    // 行(<tr>)に対応する tableRow ノードの位置を引く。以降は DOM ではなくこの位置で行を追う
    // （属性だけの変更では前方の位置がずれないので、ドラッグ中も同じ pos を使い続けられる）
    const rowPosAt = (rowDom: HTMLTableRowElement): number | null => {
      const view = editor.view;
      const cell = rowDom.cells[0];
      if (!cell) return null;
      const $pos = view.state.doc.resolve(view.posAtDOM(cell, 0));
      for (let d = $pos.depth; d > 0; d--) {
        if ($pos.node(d).type.name === "tableRow") return $pos.before(d);
      }
      return null;
    };

    // tbody の中での行index。選択範囲（行index基準）との突き合わせに使う
    const rowIndexOf = (rowDom: HTMLTableRowElement): number =>
      rowDom.parentElement ? Array.prototype.indexOf.call(rowDom.parentElement.children, rowDom) : -1;
    const rowDomAt = (tableDom: HTMLTableElement, index: number): HTMLTableRowElement | null =>
      (tableDom.rows[index] as HTMLTableRowElement | undefined) ?? null;

    // 行index範囲 [from,to) に対応する tableRow の位置
    const rowPositionsIn = (info: TableInfo, from: number, to: number): number[] => {
      const out: number[] = [];
      info.table.forEach((_rowNode: any, offset: number, index: number) => {
        if (index >= from && index < to) out.push(info.tableStart + offset);
      });
      return out;
    };

    // 行の高さを保存する。null を渡すと指定解除＝内容にフィット。あわせてドラッグ表示も畳む
    const setRowHeights = (positions: number[], height: number | null) => {
      const view = editor.view;
      const tr = view.state.tr;
      for (const pos of positions) {
        const node = view.state.doc.nodeAt(pos);
        if (!node || node.type.name !== "tableRow") continue;
        if ((node.attrs.rowheight ?? null) === height) continue;
        tr.setNodeMarkup(pos, null, { ...node.attrs, rowheight: height });
      }
      tr.setMeta(rowResizeKey, { positions, height: null }); // 緑線は残したままドラッグ表示だけ解除
      view.dispatch(tr);
    };

    // 罫線のハイライト／ドラッグ中の高さはデコレーションで見せる
    // （DOMを直接いじると ProseMirror に戻される）。変化がないときは何も流さない
    const setRowResize = (next: RowResizeState) => {
      const view = editor.view;
      const cur = rowResizeKey.getState(view.state) ?? null;
      if (!cur && !next) return;
      if (cur && next && cur.height === next.height && cur.positions.length === next.positions.length
        && cur.positions.every((p, i) => p === next.positions[i])) return;
      view.dispatch(view.state.tr.setMeta(rowResizeKey, next));
    };

    // その行のセルが折り返さずに収まるよう、足りない列だけを広げる。
    // 行の高さは内容（＝列幅による折り返し）で決まるので、「行を内容に合わせる」の実体はこれになる。
    // すでに収まっている列は触らない（他の行を巻き込んで崩さないため）。
    const fitColumnsForRows = (rowDoms: HTMLTableRowElement[]) => {
      const first = rowDoms[0]?.cells[0];
      if (!first) return;
      const info = tableInfoAt(first);
      if (!info) return;
      const widths = new Map<number, number>();
      for (const rowDom of rowDoms) {
        Array.from(rowDom.cells).forEach((cellDom, colIndex) => {
          if (colIndex >= info.map.width) return;
          const need = measureCellsWidth([cellDom]);
          if (need <= Math.round(cellDom.getBoundingClientRect().width) + 1) return;
          widths.set(colIndex, Math.max(widths.get(colIndex) ?? 0, need));
        });
      }
      if (widths.size) applyColWidths(info, widths);
    };

    // 罫線の当たり判定。縦罫線を優先し（角では列リサイズを優先）、なければ横罫線を見る
    type Edge =
      | { kind: "col"; cell: HTMLTableCellElement; colIndex: number; tableDom: HTMLTableElement }
      | { kind: "row"; rowDom: HTMLTableRowElement };
    const edgeAt = (e: MouseEvent): Edge | null => {
      const cell = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement | null;
      if (!cell || !cell.parentElement) return null;
      const rect = cell.getBoundingClientRect();
      const nearRight = Math.abs(e.clientX - rect.right) <= EDGE;
      const nearLeft = Math.abs(e.clientX - rect.left) <= EDGE;
      const row = cell.parentElement as HTMLTableRowElement;
      const tableDom = cell.closest("table") as HTMLTableElement | null;
      if (nearRight || nearLeft) {
        if (!tableDom) return null;
        let targetCell: HTMLTableCellElement = cell;
        let colIndex = Array.from(row.cells).indexOf(cell);
        // 右罫線でなく左罫線を掴んだ場合は、左隣の列を対象にする（Excel的挙動。先頭列の左端は自列のまま）
        if (nearLeft && !nearRight) {
          const prev = cell.previousElementSibling as HTMLTableCellElement | null;
          if (prev) { targetCell = prev; colIndex -= 1; }
        }
        if (colIndex < 0) return null;
        return { kind: "col", cell: targetCell, colIndex, tableDom };
      }
      const nearBottom = Math.abs(e.clientY - rect.bottom) <= ROW_EDGE;
      const nearTop = Math.abs(e.clientY - rect.top) <= ROW_EDGE;
      if (nearBottom) return { kind: "row", rowDom: row };
      // 上罫線を掴んだ場合は、上の行を対象にする（先頭行の上端は対象なし）
      if (nearTop) {
        const prevRow = row.previousElementSibling as HTMLTableRowElement | null;
        if (prevRow && prevRow.cells.length) return { kind: "row", rowDom: prevRow };
      }
      return null;
    };

    // 掴んだ罫線が「選択範囲の中の列/行」なら、選択している列/行すべてを対象にする（Excel/Excel的挙動）。
    // 選択の外の罫線を掴んだときは、これまで通りその1列/1行だけ。
    const targetCols = (colIndex: number, info: TableInfo): number[] => {
      const rect = selectedRect();
      // 別の表を選択したまま隣の表の罫線を掴んでも巻き込まないよう、同じ表かを見る
      if (rect && rect.info.tableStart === info.tableStart
        && colIndex >= rect.left && colIndex < rect.right && rect.right - rect.left > 1) {
        return Array.from({ length: rect.right - rect.left }, (_, i) => rect.left + i);
      }
      return [colIndex];
    };
    const targetRows = (rowDom: HTMLTableRowElement): { doms: HTMLTableRowElement[]; positions: number[] } => {
      const tableDom = rowDom.closest("table") as HTMLTableElement | null;
      const index = rowIndexOf(rowDom);
      const rect = selectedRect();
      const own = rowDom.cells[0] ? tableInfoAt(rowDom.cells[0]) : null;
      if (tableDom && rect && own && rect.info.tableStart === own.tableStart
        && index >= rect.top && index < rect.bottom && rect.bottom - rect.top > 1) {
        const doms: HTMLTableRowElement[] = [];
        for (let i = rect.top; i < rect.bottom; i++) {
          const d = rowDomAt(tableDom, i);
          if (d) doms.push(d);
        }
        return { doms, positions: rowPositionsIn(rect.info, rect.top, rect.bottom) };
      }
      const pos = rowPosAt(rowDom);
      return { doms: [rowDom], positions: pos === null ? [] : [pos] };
    };

    // ドラッグ状態。行はデコレーション、列は colgroup の直接更新でプレビューする
    // （colgroup は tbody の外なので TableView.ignoreMutation の対象＝直接いじってよい）
    let drag:
      | { kind: "row"; positions: number[]; startY: number; startH: number; height: number; raf: number }
      | { kind: "col"; cols: number[]; info: TableInfo; tableDom: HTMLTableElement; startX: number; startW: number; width: number; raf: number }
      | null = null;

    // 横罫線の近くでは、その罫線を緑でハイライトしカーソルを row-resize にして掴めることを示す
    // （縦罫線側で prosemirror-tables がやっていることの行版）
    const onMove = (e: MouseEvent) => {
      if (drag) return;
      const edge = edgeAt(e);
      const isRow = !!edge && edge.kind === "row";
      dom.classList.toggle("row-resize-cursor", isRow);
      // IME変換中はデコレーションを動かさない（変換が途切れる）
      if (editor.view.composing) return;
      if (!isRow) { setRowResize(null); return; }
      const { positions } = targetRows((edge as { rowDom: HTMLTableRowElement }).rowDom);
      setRowResize(positions.length ? { positions, height: null } : null);
    };
    const onLeave = () => {
      if (drag) return;
      dom.classList.remove("row-resize-cursor");
      setRowResize(null);
    };

    // 罫線のドラッグ開始。行は常に自前で処理し、列は「複数列を選択中」のときだけ横取りする
    // （単独列は prosemirror-tables の列リサイズに任せる＝従来どおりの挙動）
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const edge = edgeAt(e);
      if (!edge) return;
      if (edge.kind === "row") {
        const { positions } = targetRows(edge.rowDom);
        if (!positions.length) return;
        // ProseMirror 側の選択開始を止める（capture 段階で握りつぶす）
        e.preventDefault();
        e.stopPropagation();
        const h = edge.rowDom.getBoundingClientRect().height;
        drag = { kind: "row", positions, startY: e.clientY, startH: h, height: h, raf: 0 };
        dom.classList.add("row-resize-cursor");
      } else {
        const info = tableInfoAt(edge.cell);
        if (!info) return;
        const cols = targetCols(edge.colIndex, info);
        if (cols.length < 2) return; // 単独列は prosemirror-tables に任せる
        e.preventDefault();
        e.stopPropagation();
        const w = Math.round(edge.cell.getBoundingClientRect().width);
        drag = { kind: "col", cols, info, tableDom: edge.tableDom, startX: e.clientX, startW: w, width: w, raf: 0 };
      }
      window.addEventListener("mousemove", onDragMove, true);
      window.addEventListener("mouseup", onDragEnd, true);
    };

    // ドラッグ中の列幅は colgroup を直接書き換えて見せる（prosemirror-tables と同じやり方）
    const previewColWidths = (tableDom: HTMLTableElement, cols: number[], width: number) => {
      const colgroup = tableDom.querySelector("colgroup");
      if (!colgroup) return;
      const els = colgroup.children as HTMLCollectionOf<HTMLElement>;
      for (const c of cols) if (els[c]) els[c].style.width = `${width}px`;
      let total = 0;
      for (let i = 0; i < els.length; i++) total += parseFloat(els[i].style.width) || 0;
      if (total) { tableDom.style.width = `${total}px`; tableDom.style.minWidth = ""; }
    };

    const onDragMove = (e: MouseEvent) => {
      if (!drag) return;
      if (drag.kind === "row") {
        drag.height = Math.max(MIN_ROW_HEIGHT, Math.round(drag.startH + (e.clientY - drag.startY)));
      } else {
        drag.width = Math.max(TABLE_MIN_COL_WIDTH, Math.round(drag.startW + (e.clientX - drag.startX)));
      }
      // 1フレームに1回だけ反映する（mousemove ごとに描き直すと重い）
      if (drag.raf) return;
      drag.raf = requestAnimationFrame(() => {
        if (!drag) return;
        drag.raf = 0;
        if (drag.kind === "row") setRowResize({ positions: drag.positions, height: drag.height });
        else previewColWidths(drag.tableDom, drag.cols, drag.width);
      });
    };
    const onDragEnd = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.raf) cancelAnimationFrame(d.raf);
      dom.classList.remove("row-resize-cursor");
      window.removeEventListener("mousemove", onDragMove, true);
      window.removeEventListener("mouseup", onDragEnd, true);
      if (d.kind === "row") {
        // 動いていなければ（＝罫線をクリックしただけなら）高さは変えず、ハイライトだけ残す
        if (Math.abs(d.height - d.startH) < 2) { setRowResize({ positions: d.positions, height: null }); return; }
        setRowHeights(d.positions, d.height);
      } else {
        if (Math.abs(d.width - d.startW) < 2) return;
        applyColWidths(d.info, new Map(d.cols.map(c => [c, d.width])));
      }
    };

    const onDblClick = (e: MouseEvent) => {
      const edge = edgeAt(e);
      if (!edge) return; // 罫線の近傍以外は通常のダブルクリック（単語選択など）に委ねる
      e.preventDefault();
      e.stopPropagation();
      if (edge.kind === "col") {
        const info = tableInfoAt(edge.cell);
        if (!info) return;
        // 選択中の列はそれぞれ自分の中身に合わせる（同じ幅に揃えるのではなく各列を最適化）
        const widths = new Map(targetCols(edge.colIndex, info).map(c => [c, measureColWidthDom(edge.tableDom, c)]));
        applyColWidths(info, widths);
        return;
      }
      const { doms, positions } = targetRows(edge.rowDom);
      if (!positions.length) return;
      // 手で高さを付けた行があれば、まずその指定を外す（＝内容ぴったりの高さに戻す）
      const sized = positions.filter(p => editor.view.state.doc.nodeAt(p)?.attrs.rowheight);
      if (sized.length) { setRowHeights(sized, null); return; }
      // すでに内容ぴったり＝高さは列幅で決まっている。対象行のセルが折り返さずに収まるよう
      // 列側を広げて、行を詰める（狭い列に長文が入って縦長になった表の救済）
      fitColumnsForRows(doms);
    };

    dom.addEventListener("dblclick", onDblClick);
    dom.addEventListener("mousedown", onDown, true);
    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mouseleave", onLeave);
    return () => {
      dom.removeEventListener("dblclick", onDblClick);
      dom.removeEventListener("mousedown", onDown, true);
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("mousemove", onDragMove, true);
      window.removeEventListener("mouseup", onDragEnd, true);
      dom.classList.remove("row-resize-cursor");
      // 表示専用へ切り替わったときなどに緑線が残らないようにする
      if (!editor.isDestroyed) setRowResize(null);
    };
  }, [editor, readOnly]);

  if (!editor) return null;

  // 🌟 修正: コメントエリア内にテーブルタグが実在しており、かつ空のテーブルでないことを厳密に判定
  const hasTableInContent = editor.getHTML().includes("<table") && editor.getHTML().includes("</table>");

  // 🌟 追加: リンク(aタグ)クリックを一元処理する。
  //   ネイティブ(Mac/iPad)はアプリ内ブラウザ、Webは別タブで開く。
  //   readOnly表示時は通常クリックで、編集時は ⌘/Ctrl+クリックで開く（カーソル操作を妨げない）。
  // 🌟 BRU4-049: カーソルがある表の「幅未指定の列」に既定幅(150px)を補完する。
  //   全列に幅が付くと TipTap が table 実寸(px)をインライン指定し、内容幅で左寄せになる。
  //   （幅が1つでも欠けると width:100% にフォールバックして全幅になるため、列追加時などに補う）
  const ensureColWidths = () => {
    const view = editor.view;
    const { $from } = view.state.selection;
    let d = $from.depth;
    while (d > 0 && $from.node(d).type.name !== "table") d--;
    if (d === 0) return;
    const table = $from.node(d);
    const tableStart = $from.start(d);
    const tr = view.state.tr;
    table.forEach((rowNode, rowOffset) => {
      let cellPos = tableStart + rowOffset + 1;
      rowNode.forEach((cellNode) => {
        const colspan: number = cellNode.attrs.colspan || 1;
        const cw: (number | null)[] | null = cellNode.attrs.colwidth;
        if (!cw || cw.length !== colspan || cw.some((w) => !w)) {
          const filled = Array.from({ length: colspan }, (_, i) => (cw && cw[i]) || 150);
          tr.setNodeMarkup(cellPos, null, { ...cellNode.attrs, colwidth: filled });
        }
        cellPos += cellNode.nodeSize;
      });
    });
    if (tr.docChanged) view.dispatch(tr);
  };

  const handleInsertTable = () => {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    ensureColWidths();
  };

  // 🌟 BRU13-045: 表全体の自動調整。全列を内容に合う幅にし、手で付けた行の高さは解除する。
  //   罫線のダブルクリックは1列/1行ずつなので、取り込んだ設計書のように列が潰れた表を
  //   一発で読める状態に戻す入口をツールバーにも置く。カーソルが表の外なら本文の最初の表を対象にする。
  const autoFitTable = () => {
    const view = editor.view;
    let tablePos = -1;
    const { $from } = view.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === "table") { tablePos = $from.before(d); break; }
    }
    if (tablePos < 0) {
      view.state.doc.descendants((node, pos) => {
        if (tablePos >= 0) return false;
        if (node.type.name === "table") { tablePos = pos; return false; }
        return true;
      });
    }
    if (tablePos < 0) return;
    const table = view.state.doc.nodeAt(tablePos);
    const dom = view.nodeDOM(tablePos);
    const tableDom = dom instanceof HTMLElement
      ? (dom instanceof HTMLTableElement ? dom : dom.querySelector("table"))
      : null;
    if (!table || !tableDom) return;
    const map = TableMap.get(table);
    const tableStart = tablePos + 1;
    const tr = view.state.tr;
    for (let col = 0; col < map.width; col++) {
      const width = measureColWidthDom(tableDom, col);
      const seen = new Set<number>();
      for (let r = 0; r < map.height; r++) {
        const cellRel = map.map[r * map.width + col];
        if (seen.has(cellRel)) continue;
        seen.add(cellRel);
        const cellNode = table.nodeAt(cellRel);
        if (!cellNode) continue;
        tr.setNodeMarkup(tableStart + cellRel, null, { ...cellNode.attrs, colwidth: [width] });
      }
    }
    // 属性だけの変更なので前方の位置はずれない。行の高さ指定もまとめて解除する
    table.forEach((rowNode, rowOffset) => {
      if (rowNode.attrs.rowheight) {
        tr.setNodeMarkup(tableStart + rowOffset, null, { ...rowNode.attrs, rowheight: null });
      }
    });
    if (tr.docChanged) view.dispatch(tr);
  };

  // Mermaid 図を挿入（モーダルで入力 → 図ノードとして挿入。本文中はコードを見せない）。
  const insertMermaid = (code: string) => {
    editor.chain().focus().insertContent({ type: "mermaid", attrs: { code } }).run();
    setMermaidModalOpen(false);
  };

  // ── Markdown ファイルの取り込み ───────────────────────────────
  // 貼り付け(clipboardTextParser)と同じ変換経路を通すので、見出し・表・リンク・
  // コードブロック・Mermaid まで同じ結果になる。カーソル位置に挿入する（全置換はしない）。
  const importMarkdownFile = async (file: File) => {
    if (file.size > MD_FILE_MAX_BYTES) {
      toast(`ファイルが大きすぎます（上限 ${Math.round(MD_FILE_MAX_BYTES / 1024 / 1024)}MB）`, "error");
      return;
    }
    let text = "";
    try {
      text = await file.text();
    } catch {
      toast("ファイルを読み込めませんでした", "error");
      return;
    }
    const html = markdownFileToHtml(text);
    if (!html) {
      toast("取り込める内容がありませんでした", "error");
      return;
    }
    editor.chain().focus().insertContent(html).run();
    toast(`「${file.name}」を取り込みました`);
  };

  const handleMdInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルを続けて選び直せるように値をクリアする
    e.target.value = "";
    if (file) void importMarkdownFile(file);
  };

  const handleLinkClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href) return;

    // 内部リンクのチップは自分の onClick で行き先を決める（プレビューを開く / 画面内で開く）。
    // ここで拾うと外部ブラウザに逃げてしまうので、必ず先に降りる。
    if (anchor.classList.contains("internal-link-chip")) return;

    // ホワイトボードのオブジェクトリンクは外部ブラウザではなくアプリ内で開く。
    //   ・そのボードが既に見えている（＝ホワイトボード画面を開いている）→ その場で対象へ移動
    //     （同じボードを2枚マウントすると Yjs/保存が二重化するため）
    //   ・それ以外 → 右半分のプレビューパネルで開く
    //
    // ※編集中(readOnly=false)でも「素のクリック」で開く。外部リンクは誤爆防止のため
    //   Cmd/Ctrl+クリックを要求しているが、こちらは $メンションのチップと同じ
    //   「アプリ内の参照」なので、同じ感覚で開けるほうが自然（本文を書きながら参照できる）。
    const wb = parseWhiteboardLink(href);
    if (wb) {
      e.preventDefault();
      e.stopPropagation();
      if (requestWhiteboardFocus(wb.boardId, { elementId: wb.elementId, commentId: wb.commentId, replyId: wb.replyId })) return;
      openPreviewPanel("whiteboard", wb.boardId, {
        elementId: wb.elementId, commentId: wb.commentId, replyId: wb.replyId, projectSlug: wb.projectSlug,
      });
      return;
    }

    // 外部リンク: 編集中の誤クリックでページを離れないよう Cmd/Ctrl 併用を要求する（従来どおり）
    if (!readOnly && !(e.metaKey || e.ctrlKey)) return;
    e.preventDefault();
    e.stopPropagation();
    void openExternalUrl(href);
  };

  return (
    <div id={id} onClickCapture={handleLinkClick} style={{ border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, overflow: "hidden", background: readOnly ? "#FAFAF8" : "#FFF", display: "flex", flexDirection: "column", ...style }}>
      <style>{`
        .tiptap { outline: none; padding: 12px 14px; min-height: ${typeof minHeight === "string" ? minHeight : `${minHeight}px`}; font-size: 13px; line-height: 1.7; color: #1A1714; flex: 1; }
        #${id} .tiptap { min-height: ${typeof minHeight === "string" ? minHeight : `${minHeight}px`};${maxHeight ? ` max-height: ${typeof maxHeight === "string" ? maxHeight : `${maxHeight}px`}; overflow-y: auto;` : ""} }
        #${id} .ProseMirror-focused { outline: none; }
        #${id} > .ProseMirror, #${id} > [data-radix-scroll-area-viewport] { flex: 1; display: flex; flex-direction: column; }
        .tiptap p { margin: 0; }
        .tiptap strong { font-weight: 700; }
        .tiptap ul { list-style-type: disc; padding-left: 20px; margin: 6px 0; }
        .tiptap ol { list-style-type: decimal; padding-left: 20px; margin: 6px 0; }
        .tiptap li { margin: 2px 0; }
        .tiptap code { background: #F4F5F6; padding: 1px 5px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: #D97706; }
        .tiptap pre { background: #1A1714; color: #F4F5F6; padding: 12px 14px; border-radius: 8px; margin: 8px 0; overflow-x: auto; }
        .tiptap pre code { background: none; color: inherit; padding: 0; font-size: 12px; }
        /* 🌟 Mermaid図ノード（本文中は図だけ表示・ホバーで操作ボタン・クリックで拡大） */
        .tiptap .mermaid-node { margin: 8px 0; }
        .tiptap .mermaid-node-inner { position: relative; border: 1px solid rgba(26,23,20,0.12); border-radius: 8px; padding: 12px; background: #FFFFFF; }
        .tiptap .mermaid-svg svg { max-width: 100%; height: auto; }
        .tiptap .mermaid-node.ProseMirror-selectednode .mermaid-node-inner { outline: 2px solid #059669; outline-offset: 1px; }
        /* 🌟 BRU13-045: 列幅・行高リサイズ対応。表は左寄せ・内容幅(width:auto)で、エディタ幅による
           制限はかけない（max-width なし）。広げて溢れたぶんはラッパー側の横スクロールで見る。 */
        .tiptap .tableWrapper { overflow-x: auto; max-width: 100%; }
        .tiptap table { border-collapse: collapse; table-layout: fixed; width: auto; margin: 8px 0; }
        .tiptap th, .tiptap td { border: 1px solid rgba(26,23,20,0.12); padding: 6px 10px; font-size: 12px; position: relative; }
        .tiptap th { background: #F4F5F6; font-weight: 700; }
        .tiptap .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #059669; pointer-events: none; z-index: 5; }
        .tiptap.resize-cursor { cursor: col-resize; }
        /* 🌟 BRU13-045: 横罫線ドラッグ中/近傍のカーソル。列(col-resize)より後ろに置いて優先させる */
        .tiptap.row-resize-cursor, .tiptap.row-resize-cursor * { cursor: row-resize; }
        /* 掴める横罫線のハイライト。列の .column-resize-handle と同じ緑線を、行の下端に横一直線で引く
           （セルごとに ::before を出すので、行全体でつながって見える。::after はセル選択が使う） */
        .tiptap tr.row-resize-active > td::before,
        .tiptap tr.row-resize-active > th::before { content: ""; position: absolute; left: 0; right: 0; bottom: -2px; height: 4px; background: #059669; pointer-events: none; z-index: 5; }
        /* 🌟 BRU13-045: セルをまたいでドラッグしたときの選択（prosemirror-tables の CellSelection）。
           これまでスタイルが無かったため、隣のセルへ入った瞬間に選択が消えたように見えていた。 */
        .tiptap .selectedCell::after { content: ""; position: absolute; inset: 0; background: rgba(37,99,235,0.16); pointer-events: none; z-index: 2; }
        .tiptap blockquote { border-left: 3px solid #059669; padding-left: 12px; margin: 8px 0; color: #6B6458; font-style: italic; }
        .tiptap h1 { font-size: 18px; font-weight: 800; margin: 10px 0 6px; }
        .tiptap h2 { font-size: 15px; font-weight: 700; margin: 8px 0 4px; }
        .tiptap h3 { font-size: 13px; font-weight: 700; margin: 6px 0 4px; }
        .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #C9C4BB; pointer-events: none; float: left; height: 0; }
        /* 🌟 追加: リンク(aタグ)のスタイル（青色、ホバーで下線＋ポインター） */
        .tiptap a { color: #2563EB; cursor: pointer; text-decoration: none; }
        .tiptap a:hover { text-decoration: underline; }
        .tiptap .mention { color: #059669; font-weight: 700; background: #ECFDF5; padding: 1px 4px; border-radius: 4px; }
        .tiptap .ticket-mention { color: #2563EB; font-weight: 700; background: #DBEAFE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .ticket-mention:hover { background: #BFDBFE; }
        .tiptap .backlog-mention { color: #6D28D9; font-weight: 700; background: #EDE9FE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .backlog-mention:hover { background: #DDD6FE; }
        .tiptap .wiki-mention { color: #0284C7; font-weight: 700; background: #E0F2FE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .wiki-mention:hover { background: #BAE6FD; }
        .tiptap .minute-mention { color: #059669; font-weight: 700; background: #D1FAE5; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .minute-mention:hover { background: #A7F3D0; }
        .tiptap .file-mention { color: #0891B2; font-weight: 700; background: #CFFAFE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .file-mention:hover { background: #A5F3FC; }
        /* 🌟 BRU13-043: 貼り付けた DevTicket 内リンクのチップ。既存の #/$/% メンションと同じ見た目に
           そろえたうえで、メンションに無い種別（スプリント/ホワイトボード/プロジェクト）を足す。 */
        .tiptap .sprint-mention { color: #B45309; font-weight: 700; background: #FEF3C7; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .sprint-mention:hover { background: #FDE68A; }
        .tiptap .whiteboard-mention { color: #4F46E5; font-weight: 700; background: #E0E7FF; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .whiteboard-mention:hover { background: #C7D2FE; }
        .tiptap .project-mention { color: #475569; font-weight: 700; background: #E2E8F0; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .project-mention:hover { background: #CBD5E1; }
        /* チップ共通。<a> なので、リンクの既定色と hover 下線を打ち消す */
        .tiptap a.internal-link-chip { text-decoration: none; white-space: nowrap; }
        .tiptap a.internal-link-chip:hover { text-decoration: none; }
        /* タイトル取得中。色は確定してから付けるので、ここで一度だけ落ち着いて切り替わる */
        .tiptap a.internal-link-chip.is-pending { opacity: 0.75; }
        /* 存在しないリンク（削除済み / 権限なし / 打ち間違い）。理由は title 属性で出す */
        .tiptap a.internal-link-chip.is-missing { color: #DC2626; background: #FEE2E2; font-weight: 700; padding: 1px 6px; border-radius: 4px; cursor: not-allowed; text-decoration: line-through; text-decoration-color: rgba(220,38,38,0.5); }
        .tiptap a.internal-link-chip.is-missing:hover { background: #FECACA; text-decoration: line-through; }
        .tiptap .internal-link-chip-icon { width: 11px; height: 11px; display: inline-block; vertical-align: -1px; margin-right: 3px; }
        .tiptap img { max-width: 100%; }
      `}</style>
      {!readOnly && toolbar && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 10px", borderBottom: "1px solid rgba(26,23,20,0.08)", background: "#F9F8F6", flexShrink: 0 }}>
          <button type="button" style={btnStyle(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
          <button type="button" style={{ ...btnStyle(editor.isActive("italic")), fontStyle: "italic" }} onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
          <button type="button" style={btnStyle(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()}>S̶</button>
          <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
          <button type="button" style={btnStyle(editor.isActive("heading", { level: 1 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
          <button type="button" style={btnStyle(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
          <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
          <button type="button" style={btnStyle(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>• リスト</button>
          <button type="button" style={btnStyle(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. リスト</button>
          <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
          <button type="button" style={btnStyle(editor.isActive("code"))} onClick={() => editor.chain().focus().toggleCode().run()}>{'<>'}</button>
          <button type="button" style={btnStyle(editor.isActive("codeBlock"))} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>コード</button>
          <button type="button" style={btnStyle(editor.isActive("mermaid"))} onClick={() => setMermaidModalOpen(true)} title="Mermaid図を挿入（フロー図・シーケンス図など）">Mermaid</button>
          <button type="button" style={btnStyle(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>"引用</button>
          <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
          <button type="button" style={btnStyle()} onClick={handleInsertTable}>表</button>
          <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
          <button
            type="button"
            style={btnStyle()}
            onClick={() => mdInputRef.current?.click()}
            title="Markdownファイル(.md)を取り込む。カーソル位置に書式つきで挿入されます（エディタへドラッグ＆ドロップでも可）"
          >
            <FileUp style={{ width: 11, height: 11, display: "inline-block", marginRight: 3, verticalAlign: "-1px" }} />
            MD取込
          </button>
          <input
            ref={mdInputRef}
            type="file"
            accept={MD_FILE_ACCEPT}
            onChange={handleMdInputChange}
            style={{ display: "none" }}
          />

          {/* 🌟 修正: エディタ内に表のデータ(hasTableInContent)が存在していれば、どこを触っていてもツールバーを表示 */}
          {hasTableInContent && (
            <>
              <span style={{ width: "100%", height: 0 }} />
              <span style={{ fontSize: 11, color: "rgba(26,23,20,0.45)", alignSelf: "center", paddingRight: 2 }}>表編集:</span>
              <button type="button" style={btnStyle()} onClick={() => { editor.chain().focus().addColumnBefore().run(); ensureColWidths(); }} title="左に列を挿入">左列+</button>
              <button type="button" style={btnStyle()} onClick={() => { editor.chain().focus().addColumnAfter().run(); ensureColWidths(); }} title="右に列を挿入">右列+</button>
              <button type="button" style={btnStyle()} onClick={() => editor.chain().focus().deleteColumn().run()} title="列を削除">列削除</button>
              <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
              <button type="button" style={btnStyle()} onClick={() => editor.chain().focus().addRowBefore().run()} title="上に行を挿入">上行+</button>
              <button type="button" style={btnStyle()} onClick={() => editor.chain().focus().addRowAfter().run()} title="下に行を挿入">下行+</button>
              <button type="button" style={btnStyle()} onClick={() => editor.chain().focus().deleteRow().run()} title="行を削除">行削除</button>
              <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
              {/* 🌟 BRU13-045: 全列を内容に合う幅へ。罫線ダブルクリックの表全体版 */}
              <button type="button" style={btnStyle()} onClick={autoFitTable} title="全ての列幅を中身に合わせて自動調整し、手で付けた行の高さを解除する">幅を自動調整</button>
              <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
              {/* 🌟 追加: 現在選択（またはカーソルが乗っている）している表を丸ごと一発で削除するボタン */}
              <button
                type="button"
                style={{ ...btnStyle(), color: "#DC2626" }}
                onClick={() => editor.chain().focus().deleteTable().run()}
                title="表を丸ごと削除"
              >
                <Trash2 style={{ width: 11, height: 11, display: "inline-block", marginRight: 3, verticalAlign: "-1px" }} />
                表削除
              </button>
            </>
          )}
        </div>
      )}
      {/* ツールバーは固定、EditorContentだけスクロール */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <EditorContent editor={editor} />
        {!readOnly && !editor.getText() && placeholder && (
          <style>{`.tiptap p.is-editor-empty:first-child::before { content: "${placeholder}"; }`}</style>
        )}
      </div>
      {mermaidModalOpen && (
        <MermaidEditModal
          initialCode=""
          title="Mermaid図を挿入"
          saveLabel="挿入"
          onSave={insertMermaid}
          onClose={() => setMermaidModalOpen(false)}
        />
      )}
    </div>
  );
}