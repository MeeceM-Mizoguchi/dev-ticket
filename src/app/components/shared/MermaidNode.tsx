// 本文（チケット詳細・コメント・Wiki・議事録等）に埋め込む Mermaid 図の専用ノード。
//
// 設計: コードブロックではなく「atom ノード（コードは属性に保持）」。本文中はコードを一切見せず
// 図だけを表示し、スクロール増を防ぐ。入力・編集は MermaidEditModal に集約する。
// ノードには編集/削除ボタンと拡大表示（ライトボックス）を備える。
// 直列化は <div data-type="mermaid" data-code="..."> 形式（htmlToBlocks / エクスポートが検出）。
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";
import { Pencil, Trash2, Maximize2, X } from "lucide-react";
import { MermaidView } from "./MermaidView";
import { MermaidEditModal } from "./MermaidEditModal";

function MermaidNodeView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const code = (node.attrs.code as string) ?? "";
  const isEditable = editor.isEditable;
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(false);

  // 拡大表示中の Esc は「拡大を閉じる」だけにする。伝播を止めないと、親のチケット詳細
  // パネル等の Esc ハンドラまで届いてパネルごと閉じてしまう。window の capture 段階で
  // 捕まえ、stopImmediatePropagation で他ハンドラより先に確実に打ち切る。
  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setZoom(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [zoom]);

  const ctrlBtn: React.CSSProperties = {
    width: 26, height: 26, borderRadius: 6, border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", color: "#fff",
  };

  return (
    <NodeViewWrapper className="mermaid-node">
      <div
        className="mermaid-node-inner"
        contentEditable={false}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* 図本体。クリックで拡大表示 */}
        <div style={{ cursor: "zoom-in" }} onClick={() => setZoom(true)} title="クリックで拡大">
          <MermaidView code={code} />
        </div>

        {/* ホバー時の操作ボタン */}
        {hovered && (
          <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 6 }}>
            <button type="button" style={{ ...ctrlBtn, background: "#1A1714" }} title="拡大表示"
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setZoom(true); }}>
              <Maximize2 style={{ width: 13, height: 13 }} />
            </button>
            {isEditable && (
              <>
                <button type="button" style={{ ...ctrlBtn, background: "#059669" }} title="編集"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setEditing(true); }}>
                  <Pencil style={{ width: 13, height: 13 }} />
                </button>
                <button type="button" style={{ ...ctrlBtn, background: "#DC2626" }} title="削除"
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteNode(); }}>
                  <Trash2 style={{ width: 13, height: 13 }} />
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* 編集モーダル */}
      {editing && (
        <MermaidEditModal
          initialCode={code}
          title="Mermaid図を編集"
          saveLabel="保存"
          onSave={(c) => { updateAttributes({ code: c }); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}

      {/* 拡大表示（ライトボックス） */}
      {zoom && createPortal(
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, cursor: "zoom-out" }}
          onClick={() => setZoom(false)}
        >
          <div
            style={{ background: "#fff", borderRadius: 10, padding: 24, maxWidth: "94vw", maxHeight: "92vh", overflow: "auto", cursor: "default" }}
            onClick={(e) => e.stopPropagation()}
          >
            <MermaidView code={code} align="center" minHeight={200} natural />
          </div>
          <button type="button" onClick={() => setZoom(false)}
            style={{ position: "absolute", top: 20, right: 20, width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>,
        document.body
      )}
    </NodeViewWrapper>
  );
}

export const MermaidNode = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-code") ?? "",
        renderHTML: (attrs) => ({ "data-code": attrs.code ?? "" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "mermaid" })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
