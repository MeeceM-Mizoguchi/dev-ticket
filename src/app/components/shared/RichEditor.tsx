import { useEditor, EditorContent, ReactRenderer, ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Mention from "@tiptap/extension-mention";
import { Extension } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import type { SuggestionKeyDownProps } from "@tiptap/suggestion";
import { Copy, X, CheckCheck } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

// ---- インライン画像 NodeView（ホバーでコピー/削除ボタン表示） ----
function ImageNodeView({ node, deleteNode }: NodeViewProps) {
  const [hovered, setHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const src = (node.attrs as { src: string }).src;

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
      <img src={src} style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 6, margin: "4px 0", display: "block", objectFit: "contain", boxShadow: "0 1px 4px rgba(0,0,0,0.10)", cursor: "default" }} />
      {hovered && (
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
    </NodeViewWrapper>
  );
}

const CustomImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView as any);
  },
}).configure({ inline: true, allowBase64: false });

// ---- SuggestionStore: editor.storage 経由でチケット/メンバーをプラグインに渡す ----
// TipTap のプラグインは最初のレンダーで closure をキャプチャするため、
// useRef の .current 更新が届かないケースがある。
// editor.storage は items({ editor }) で受け取る生きたインスタンス経由でアクセスするので確実。
const SuggestionStore = Extension.create({
  name: "suggestionStore",
  addStorage() {
    return {
      members: [] as string[],
      tickets: [] as { wbs: string; title: string }[],
      backlogItems: [] as { id: string; title: string }[],
      wikiItems: [] as { id: string; title: string }[],
      minuteItems: [] as { id: string; title: string }[],
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
      if (event.key === "ArrowUp")   { setSel(i => (i - 1 + items.length) % items.length); return true; }
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

interface LinkMentionOption { id: string; title: string; type: "backlog" | "wiki" | "minute" }
interface LinkMentionListProps {
  items: LinkMentionOption[];
  command: (p: { id: string; label: string }) => void;
}

const TYPE_STYLE: Record<LinkMentionOption["type"], { bg: string; color: string; label: string }> = {
  backlog: { bg: "#EDE9FE", color: "#6D28D9", label: "バックログ" },
  wiki:    { bg: "#E0F2FE", color: "#0284C7", label: "Wiki" },
  minute:  { bg: "#D1FAE5", color: "#059669", label: "議事録" },
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
      if (event.key === "ArrowUp")   { setSel(i => (i - 1 + items.length) % items.length); return true; }
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
          </button>
        );
      })}
    </>
  );
});
LinkMentionList.displayName = "LinkMentionList";

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
      if (event.key === "ArrowUp")   { setSel(i => (i - 1 + items.length) % items.length); return true; }
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
  value, onChange, placeholder, minHeight = 120, maxHeight, readOnly = false, toolbar = true, members = [], tickets = [], backlogItems = [], wikiItems = [], minuteItems = [], onTicketClick, onBacklogClick, onWikiClick, onMinuteClick, onImageUpload, style,
}: {
  value?: string; onChange?: (html: string) => void;
  placeholder?: string; minHeight?: number | string; maxHeight?: number | string; readOnly?: boolean; toolbar?: boolean;
  members?: string[];
  tickets?: { wbs: string; title: string }[];
  backlogItems?: { id: string; title: string }[];
  wikiItems?: { id: string; title: string }[];
  minuteItems?: { id: string; title: string }[];
  onTicketClick?: (wbs: string) => void;
  onBacklogClick?: (id: string) => void;
  onWikiClick?: (id: string) => void;
  onMinuteClick?: (id: string) => void;
  onImageUpload?: (file: File) => Promise<string>;
  style?: React.CSSProperties;
}) {
  const idRef = useRef(`re-${Math.random().toString(36).slice(2, 8)}`);
  const id = idRef.current;

  const editor = useEditor({
    extensions: [
      StarterKit,
      CustomImage,
      Table.configure({ resizable: false }),
      TableRow, TableCell, TableHeader,
      SuggestionStore,
      // TipTap v3: suggestions 配列で @mention と #ticket を1つの Mention extension に統合
      Mention.configure({
        HTMLAttributes: {},
        renderText({ node, suggestion }) {
          const char = (node.attrs.mentionSuggestionChar as string) ?? suggestion?.char ?? "@";
          if (char === "#") return `#${node.attrs.id ?? ""}`;
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
            return ["span", { ...options.HTMLAttributes, class: "ticket-mention" }, `#${node.attrs.id ?? ""}`];
          }
          if (char === "$") {
            const rawId = node.attrs.id ?? "";
            const [type] = rawId.split(":");
            const label = node.attrs.label ?? rawId.split(":").slice(1).join(":") ?? rawId;
            const cls = type === "wiki" ? "wiki-mention" : type === "minute" ? "minute-mention" : "backlog-mention";
            return ["span", { ...options.HTMLAttributes, class: cls }, `$${label}`];
          }
          return ["span", { ...options.HTMLAttributes, class: "mention" }, `@${node.attrs.label ?? node.attrs.id ?? ""}`];
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
            // $リンクメンション（$B=バックログ, $W=Wiki, $G=議事録, $ のみ=全表示）
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
        ],
      }),
    ],
    content: value || "",
    editable: !readOnly,
    onUpdate: ({ editor }) => { onChange?.(editor.getHTML()); },
    editorProps: {
      handlePaste: onImageUpload ? (_view, event) => {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imgFiles = items.filter(i => i.type.startsWith("image/")).map(i => i.getAsFile()).filter(Boolean) as File[];
        if (imgFiles.length === 0) return false;
        event.preventDefault();
        imgFiles.forEach(async (file) => {
          const url = await onImageUpload(file);
          if (url) editor?.chain().focus().setImage({ src: url }).run();
        });
        return true;
      } : undefined,
      handleDrop: onImageUpload ? (_view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []).filter(f => f.type.startsWith("image/"));
        if (files.length === 0) return false;
        event.preventDefault();
        files.forEach(async (file) => {
          const url = await onImageUpload(file);
          if (url) editor?.chain().focus().setImage({ src: url }).run();
        });
        return true;
      } : undefined,
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
          if (t === 'codeBlock') return '```\n' + (node.textContent ?? '') + '\n```\n';
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

        const parts: string[] = [];
        slice.content.forEach((node: any) => { parts.push(block(node)); });
        return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
      },
    },
  });

  // editor.storage に最新の members/tickets を同期
  // useLayoutEffect でペイント前に確実に更新（ユーザーが入力する前に必ず反映される）
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.storage.suggestionStore.members = members;
    editor.storage.suggestionStore.tickets = tickets;
    editor.storage.suggestionStore.backlogItems = backlogItems;
    editor.storage.suggestionStore.wikiItems = wikiItems;
    editor.storage.suggestionStore.minuteItems = minuteItems;
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

  // ticket-mention クリックでナビゲーション
  useEffect(() => {
    if (!editor || !onTicketClick) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest(".ticket-mention[data-id]");
      if (!target) return;
      const wbs = target.getAttribute("data-id");
      if (wbs) {
        e.preventDefault();
        e.stopPropagation();
        onTicketClick(wbs);
      }
    };
    dom.addEventListener("click", handler);
    return () => dom.removeEventListener("click", handler);
  }, [editor, onTicketClick]);

  // backlog/wiki/minute mention クリックでナビゲーション
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handler = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      const backlogEl = el.closest(".backlog-mention[data-id]");
      if (backlogEl && onBacklogClick) {
        const rawId = backlogEl.getAttribute("data-id") ?? "";
        const id = rawId.startsWith("backlog:") ? rawId.slice(8) : rawId;
        e.preventDefault(); e.stopPropagation();
        onBacklogClick(id);
        return;
      }
      const wikiEl = el.closest(".wiki-mention[data-id]");
      if (wikiEl && onWikiClick) {
        const rawId = wikiEl.getAttribute("data-id") ?? "";
        const id = rawId.startsWith("wiki:") ? rawId.slice(5) : rawId;
        e.preventDefault(); e.stopPropagation();
        onWikiClick(id);
        return;
      }
      const minuteEl = el.closest(".minute-mention[data-id]");
      if (minuteEl && onMinuteClick) {
        const rawId = minuteEl.getAttribute("data-id") ?? "";
        const id = rawId.startsWith("minute:") ? rawId.slice(7) : rawId;
        e.preventDefault(); e.stopPropagation();
        onMinuteClick(id);
      }
    };
    dom.addEventListener("click", handler);
    return () => dom.removeEventListener("click", handler);
  }, [editor, onBacklogClick, onWikiClick, onMinuteClick]);

  if (!editor) return null;

  return (
    <div id={id} style={{ border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, overflow: "hidden", background: readOnly ? "#FAFAF8" : "#FFF", display: "flex", flexDirection: "column", ...style }}>
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
        .tiptap table { border-collapse: collapse; width: 100%; margin: 8px 0; }
        .tiptap th, .tiptap td { border: 1px solid rgba(26,23,20,0.12); padding: 6px 10px; font-size: 12px; }
        .tiptap th { background: #F4F5F6; font-weight: 700; }
        .tiptap blockquote { border-left: 3px solid #059669; padding-left: 12px; margin: 8px 0; color: #6B6458; font-style: italic; }
        .tiptap h1 { font-size: 18px; font-weight: 800; margin: 10px 0 6px; }
        .tiptap h2 { font-size: 15px; font-weight: 700; margin: 8px 0 4px; }
        .tiptap h3 { font-size: 13px; font-weight: 700; margin: 6px 0 4px; }
        .tiptap p.is-editor-empty:first-child::before { content: attr(data-placeholder); color: #C9C4BB; pointer-events: none; float: left; height: 0; }
        .tiptap .mention { color: #059669; font-weight: 700; background: #ECFDF5; padding: 1px 4px; border-radius: 4px; }
        .tiptap .ticket-mention { color: #2563EB; font-weight: 700; background: #DBEAFE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .ticket-mention:hover { background: #BFDBFE; }
        .tiptap .backlog-mention { color: #6D28D9; font-weight: 700; background: #EDE9FE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .backlog-mention:hover { background: #DDD6FE; }
        .tiptap .wiki-mention { color: #0284C7; font-weight: 700; background: #E0F2FE; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .wiki-mention:hover { background: #BAE6FD; }
        .tiptap .minute-mention { color: #059669; font-weight: 700; background: #D1FAE5; padding: 1px 6px; border-radius: 4px; cursor: pointer; }
        .tiptap .minute-mention:hover { background: #A7F3D0; }
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
          <button type="button" style={btnStyle(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>"引用</button>
          <span style={{ width: 1, background: "rgba(26,23,20,0.10)", margin: "0 2px" }} />
          <button type="button" style={btnStyle()} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>表</button>
        </div>
      )}
      {/* ツールバーは固定、EditorContentだけスクロール */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        <EditorContent editor={editor} />
        {!readOnly && !editor.getText() && placeholder && (
          <style>{`.tiptap p.is-editor-empty:first-child::before { content: "${placeholder}"; }`}</style>
        )}
      </div>
    </div>
  );
}
