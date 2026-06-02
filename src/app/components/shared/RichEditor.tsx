import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useRef } from "react";

const btnStyle = (active?: boolean): React.CSSProperties => ({
  padding: "3px 7px", fontSize: 11, fontWeight: 600, borderRadius: 5,
  border: `1px solid ${active ? "#059669" : "rgba(26,23,20,0.12)"}`,
  background: active ? "#ECFDF5" : "transparent",
  color: active ? "#059669" : "#6B6458",
  cursor: "pointer", lineHeight: 1.4,
});

export function RichEditor({
  value, onChange, placeholder, minHeight = 120, maxHeight, readOnly = false,
}: {
  value?: string; onChange?: (html: string) => void;
  placeholder?: string; minHeight?: number; maxHeight?: number; readOnly?: boolean;
}) {
  const idRef = useRef(`re-${Math.random().toString(36).slice(2, 8)}`);
  const id = idRef.current;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: false }),
      TableRow, TableCell, TableHeader,
    ],
    content: value || "",
    editable: !readOnly,
    onUpdate: ({ editor }) => { onChange?.(editor.getHTML()); },
    editorProps: {
      clipboardTextSerializer: (slice) => {
        function serializeInline(node: any): string {
          if (node.isText) return node.text ?? '';
          let out = '';
          node.forEach((c: any) => { out += serializeInline(c); });
          return out;
        }

        function serializeItem(node: any, depth: number): string {
          const bullet = '  '.repeat(depth) + '• ';
          const lines: string[] = [];
          let firstPara = true;
          node.forEach((child: any) => {
            const t: string = child.type.name;
            if (t === 'paragraph') {
              lines.push((firstPara ? bullet : '  '.repeat(depth) + '  ') + serializeInline(child) + '\n');
              firstPara = false;
            } else if (t === 'bulletList' || t === 'orderedList') {
              child.forEach((li: any) => { lines.push(serializeItem(li, depth + 1)); });
            } else {
              lines.push(serializeBlock(child));
            }
          });
          return lines.join('');
        }

        function serializeBlock(node: any): string {
          if (node.isText) return node.text ?? '';
          const t: string = node.type.name;
          if (t === 'paragraph' || t === 'heading') return serializeInline(node) + '\n\n';
          if (t === 'bulletList' || t === 'orderedList') {
            const lines: string[] = [];
            node.forEach((li: any) => { lines.push(serializeItem(li, 0)); });
            return lines.join('') + '\n';
          }
          if (t === 'hardBreak') return '\n';
          if (t === 'codeBlock') return '```\n' + serializeInline(node) + '\n```\n\n';
          let out = '';
          node.forEach((c: any) => { out += serializeBlock(c); });
          return out;
        }

        const parts: string[] = [];
        slice.content.forEach((node: any) => { parts.push(serializeBlock(node)); });
        return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || "";
    if (current !== incoming) editor.commands.setContent(incoming, false);
  }, [value]);

  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [readOnly, editor]);

  if (!editor) return null;

  return (
    <div id={id} style={{ border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, overflow: "hidden", background: readOnly ? "#FAFAF8" : "#FFF" }}>
      <style>{`
        .tiptap { outline: none; padding: 12px 14px; min-height: ${minHeight}px; font-size: 13px; line-height: 1.7; color: #1A1714; }
        #${id} .tiptap { min-height: ${minHeight}px;${maxHeight ? ` max-height: ${maxHeight}px; overflow-y: auto;` : ""} }
        .tiptap p { margin: 0 0 6px; }
        .tiptap p:last-child { margin-bottom: 0; }
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
      `}</style>
      {!readOnly && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "8px 10px", borderBottom: "1px solid rgba(26,23,20,0.08)", background: "#F9F8F6" }}>
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
      <EditorContent editor={editor} />
      {!readOnly && !editor.getText() && placeholder && (
        <style>{`.tiptap p.is-editor-empty:first-child::before { content: "${placeholder}"; }`}</style>
      )}
    </div>
  );
}
