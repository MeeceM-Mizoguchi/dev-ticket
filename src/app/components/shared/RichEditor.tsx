import { useEditor, EditorContent, ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableMap } from "@tiptap/pm/tables";
import Mention from "@tiptap/extension-mention";
import { MermaidNode } from "./MermaidNode";
import { MermaidEditModal } from "./MermaidEditModal";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
// 貼り付けた Markdown テキスト（Claude のコピーボタン等）を書式つきで取り込む
import { markdownToHtml, markdownFileToHtml } from "@/app/lib/markdown";
import { isSubmitShortcut } from "@/app/lib/submitKey";
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
import { createPortal } from "react-dom";
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
      // 🌟 BRU4-049: 表がエディタ幅を超えないようにするクランプ。列幅の合計が利用可能幅(=表ラッパーの
      //   実幅)を超えたら、全列を比例縮小してフィットさせ横スクロールを抑止する。合計が幅未満のときは
      //   何もしないので「左寄せ・内容幅」は維持される。DOM実測が要るので view プラグインで実装し、
      //   コンテナのリサイズにも ResizeObserver で追従する。
      new Plugin({
        key: new PluginKey("clampTableWidths"),
        view: (editorView) => {
          const run = () => {
            const view = editorView;
            if (!view || !view.dom || !view.dom.isConnected) return;
            let tr: any = null;
            view.state.doc.descendants((node: any, pos: number) => {
              if (node.type.name !== "table") return;
              const firstRow = node.firstChild;
              if (!firstRow) return false;
              // 先頭行の colwidth 合計（全列に幅がある表のみ対象。partは normalize が先に補完）
              let total = 0;
              let allSized = true;
              firstRow.forEach((cell: any) => {
                const colspan: number = cell.attrs.colspan || 1;
                const cw: (number | null)[] | null = cell.attrs.colwidth;
                for (let j = 0; j < colspan; j++) {
                  const w = cw && cw[j];
                  if (!w) allSized = false;
                  total += w || 60;
                }
              });
              if (!allSized) return false;
              const dom = view.nodeDOM(pos);
              if (!(dom instanceof HTMLElement)) return false;
              const avail = dom.clientWidth; // 表ラッパーの表示幅（横スクロールバーは高さ側なので影響なし）
              if (avail < 80 || total <= avail) return false; // 未レイアウト or 収まっている
              const scale = (avail - 2) / total;
              const tableStart = pos + 1;
              node.forEach((rowNode: any, rowOffset: number) => {
                let cellPos = tableStart + rowOffset + 1;
                rowNode.forEach((cellNode: any) => {
                  const cw: (number | null)[] | null = cellNode.attrs.colwidth;
                  if (cw) {
                    const scaled = cw.map((w) => (w ? Math.max(60, Math.floor(w * scale)) : w));
                    if (scaled.some((w, i) => w !== cw[i])) {
                      if (!tr) tr = view.state.tr;
                      tr.setNodeMarkup(cellPos, null, { ...cellNode.attrs, colwidth: scaled });
                    }
                  }
                  cellPos += cellNode.nodeSize;
                });
              });
              return false;
            });
            if (tr) {
              tr.setMeta("addToHistory", false);
              view.dispatch(tr);
            }
          };
          // ドラッグ中は prosemirror-tables が DOM を直接広げる（トランザクション未発火）ため、
          // 上の run() では間に合わず一瞬枠を超える。そこで毎フレーム DOM を直接キャップして
          // 描画前にフィットさせ、ドラッグ中も横スクロールを一切出さない（確定時の run() と同じ比例縮小）。
          const dragCapDom = () => {
            const view = editorView;
            if (!view || !view.dom || !view.dom.isConnected) return;
            const wrappers = view.dom.querySelectorAll(".tableWrapper");
            wrappers.forEach((wrapper: any) => {
              const table = wrapper.querySelector("table");
              const colgroup = table && table.firstChild;
              if (!table || !colgroup || !colgroup.children.length) return;
              const cols = colgroup.children;
              let total = 0;
              for (let i = 0; i < cols.length; i++) total += parseFloat(cols[i].style.width) || 0;
              const avail = wrapper.clientWidth;
              if (!total || avail < 80 || total <= avail) return;
              const scale = (avail - 2) / total;
              let newTotal = 0;
              const widths: number[] = [];
              for (let i = 0; i < cols.length; i++) {
                const w = parseFloat(cols[i].style.width) || 0;
                const nw = w ? Math.max(60, Math.floor(w * scale)) : 0;
                widths.push(nw);
                newTotal += nw;
              }
              for (let i = 0; i < cols.length; i++) cols[i].style.width = widths[i] + "px";
              table.style.width = newTotal + "px";
              table.style.minWidth = "";
            });
          };
          let raf = 0;
          const loop = () => { dragCapDom(); raf = requestAnimationFrame(loop); };
          const onDown = () => { if (!raf) raf = requestAnimationFrame(loop); };
          const onUp = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } dragCapDom(); };
          editorView.dom.addEventListener("mousedown", onDown);
          window.addEventListener("mouseup", onUp);

          let ro: ResizeObserver | null = null;
          if (typeof ResizeObserver !== "undefined") {
            ro = new ResizeObserver(() => run());
            ro.observe(editorView.dom);
          }
          run();
          return {
            update: (v: any, prev: any) => { if (v.state.doc !== prev.doc) run(); },
            destroy: () => {
              if (ro) ro.disconnect();
              if (raf) cancelAnimationFrame(raf);
              editorView.dom.removeEventListener("mousedown", onDown);
              window.removeEventListener("mouseup", onUp);
            },
          };
        },
      }),
    ];
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
function ImageNodeView({ node, deleteNode, editor }: NodeViewProps) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState(false);
  const src = (node.attrs as { src: string }).src;
  const isEditable = editor.isEditable;

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
        onClick={() => setPreview(true)} />
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
      {preview && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out" }}
          onClick={() => setPreview(false)}
        >
          <img src={src} alt="" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8, objectFit: "contain", boxShadow: "0 24px 80px rgba(0,0,0,0.6)", cursor: "default" }}
            onClick={e => e.stopPropagation()} />
          <button type="button" onClick={() => setPreview(false)}
            style={{ position: "absolute", top: 20, right: 20, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>,
        document.body
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
      TableRow, TableCell, TableHeader,
      NormalizeTableWidths,
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
  }, [editor, members, tickets, backlogItems, wikiItems, minuteItems]);

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

  // 🌟 BRU4-049: 縦罫線をダブルクリックで、その列の最長1行の自然幅に自動フィット
  useEffect(() => {
    if (!editor || readOnly) return;
    const dom = editor.view.dom;

    // 列内の全セルを計測し、最長1行の自然幅（+左右padding）を返す。下限は最小列幅60px。
    const measureColWidth = (tableDom: HTMLTableElement, colIndex: number): number => {
      const m = document.createElement("div");
      m.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;top:0;padding:0;margin:0;";
      document.body.appendChild(m);
      let max = 0;
      try {
        for (const row of Array.from(tableDom.rows)) {
          const cell = row.cells[colIndex];
          if (!cell) continue;
          const cs = getComputedStyle(cell);
          m.style.fontFamily = cs.fontFamily;
          m.style.fontSize = cs.fontSize;
          m.style.fontWeight = cs.fontWeight;
          m.style.fontStyle = cs.fontStyle;
          m.style.letterSpacing = cs.letterSpacing;
          for (const line of (cell.innerText || "").split("\n")) {
            m.textContent = line || " ";
            if (m.scrollWidth > max) max = m.scrollWidth;
          }
        }
      } finally {
        document.body.removeChild(m);
      }
      // padding(10px*2) + 罫線 + わずかな余白
      return Math.max(60, Math.ceil(max) + 24);
    };

    // 指定列の全行セルに colwidth をセットする（アプリ内の表はセル結合なし前提でDOM列index=マップ列index）
    const setColumnWidth = (cellDomInCol: HTMLElement, colIndex: number, width: number) => {
      const view = editor.view;
      const $pos = view.state.doc.resolve(view.posAtDOM(cellDomInCol, 0));
      let d = $pos.depth;
      while (d > 0 && $pos.node(d).type.name !== "table") d--;
      if (d === 0) return;
      const table = $pos.node(d);
      const tableStart = $pos.start(d);
      const map = TableMap.get(table);
      const tr = view.state.tr;
      const seen = new Set<number>();
      for (let r = 0; r < map.height; r++) {
        const cellRel = map.map[r * map.width + colIndex];
        if (seen.has(cellRel)) continue;
        seen.add(cellRel);
        const cellNode = table.nodeAt(cellRel);
        if (!cellNode) continue;
        tr.setNodeMarkup(tableStart + cellRel, null, { ...cellNode.attrs, colwidth: [width] });
      }
      if (tr.docChanged) view.dispatch(tr);
    };

    const handler = (e: MouseEvent) => {
      const cell = (e.target as HTMLElement).closest("td, th") as HTMLTableCellElement | null;
      if (!cell || !cell.parentElement) return;
      const rect = cell.getBoundingClientRect();
      const nearRight = Math.abs(e.clientX - rect.right) <= 6;
      const nearLeft = Math.abs(e.clientX - rect.left) <= 6;
      if (!nearRight && !nearLeft) return; // 縦罫線の近傍以外は通常のダブルクリック（単語選択など）に委ねる
      const row = cell.parentElement as HTMLTableRowElement;
      let targetCell: HTMLTableCellElement = cell;
      let colIndex = Array.from(row.cells).indexOf(cell);
      // 右罫線でなく左罫線をダブルクリックした場合は、左隣の列を対象にする（Excel的挙動）
      if (nearLeft && !nearRight) {
        const prev = cell.previousElementSibling as HTMLTableCellElement | null;
        if (prev) { targetCell = prev; colIndex -= 1; }
      }
      const tableDom = cell.closest("table") as HTMLTableElement | null;
      if (!tableDom || colIndex < 0) return;
      e.preventDefault();
      e.stopPropagation();
      setColumnWidth(targetCell, colIndex, measureColWidth(tableDom, colIndex));
    };

    dom.addEventListener("dblclick", handler);
    return () => dom.removeEventListener("dblclick", handler);
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
        /* 🌟 BRU4-049: 列幅リサイズ対応。表は左寄せ・内容幅(width:auto)。合計がエディタ幅を超えたら
           clampプラグインが全列を比例縮小してフィットさせるので、横スクロールは基本発生しない。
           (列数が多く最小幅60pxでも収まらない極端なケースのみラッパーで横スクロール) */
        .tiptap .tableWrapper { overflow-x: auto; max-width: 100%; }
        .tiptap table { border-collapse: collapse; table-layout: fixed; width: auto; max-width: 100%; margin: 8px 0; }
        .tiptap th, .tiptap td { border: 1px solid rgba(26,23,20,0.12); padding: 6px 10px; font-size: 12px; position: relative; }
        .tiptap th { background: #F4F5F6; font-weight: 700; }
        .tiptap .column-resize-handle { position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #059669; pointer-events: none; z-index: 5; }
        .tiptap.resize-cursor { cursor: col-resize; }
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