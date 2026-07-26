import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Loader2, Save, Bold, Italic, List, ListOrdered, Heading1, Heading2 } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { uploadProjectFile, fetchFileWithRetry } from "@/app/lib/projectFiles";
import { htmlToDocxBlob } from "@/app/lib/htmlToDocx";
import type { EditorHandle } from "./ExcelEditor";

// ENHA2-035 Word(.docx) 画面内エディタ
//
// mammoth で docx → HTML にして TipTap で編集。保存時は htmlToDocx で docx を
// 再生成する（再生成方式なので図形・一部レイアウト・脚注・変更履歴は失われる）。

interface Props {
  url: string;
  file: ProjectFile;
  onSaved: () => void;
  onClose: () => void;
}

export const WordEditor = forwardRef<EditorHandle, Props>(function WordEditor({ url, file, onSaved, onClose }, ref) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Table.configure({ resizable: false }),
      TableRow, TableHeader, TableCell,
    ],
    content: "",
    editorProps: {
      attributes: { style: "outline:none; min-height:100%;" },
    },
  });

  // ── 読み込み（docx → HTML → TipTap）────────────────────────
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    (async () => {
      try {
        const buf = await (await fetchFileWithRetry(url)).arrayBuffer();
        const mammoth: any = await import("mammoth/mammoth.browser");
        const { value } = await (mammoth.default ?? mammoth).convertToHtml({ arrayBuffer: buf });
        if (cancelled) return;
        editor.commands.setContent(value || "<p></p>");
        setLoading(false);
      } catch (e) {
        console.error("[WordEditor] load error:", e);
        if (!cancelled) { setError("Wordファイルの読み込みに失敗しました"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [editor, url]);

  // 編集を検知して未保存フラグを立てる
  useEffect(() => {
    if (!editor) return;
    const h = () => setDirty(true);
    editor.on("update", h);
    return () => { editor.off("update", h); };
  }, [editor]);

  // 保存だけ行い成功可否を返す（閉じない）
  const doSave = useCallback(async (): Promise<boolean> => {
    if (!editor) return false;
    setSaving(true);
    try {
      const blob = await htmlToDocxBlob(editor.getHTML());
      const newFile = new File([blob], file.fileName, { type: blob.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
      await uploadProjectFile(file.projectId, newFile);
      onSaved();
      setDirty(false);
      return true;
    } catch (e) {
      console.error("[WordEditor] save error:", e);
      setError(e instanceof Error ? e.message : "保存に失敗しました");
      return false;
    } finally {
      setSaving(false);
    }
  }, [editor, file, onSaved]);

  const handleSave = useCallback(async () => {
    if (!window.confirm("保存すると、図形・一部レイアウト・脚注・変更履歴などは失われる場合があります。続行しますか？")) return;
    if (await doSave()) onClose();
  }, [doSave, onClose]);

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save: () => doSave() }), [dirty, doSave]);

  if (error) return <Centered>{error}</Centered>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* ツールバー */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 12px", borderBottom: "1px solid rgba(26,23,20,0.07)", flexShrink: 0, flexWrap: "wrap" }}>
        <TB onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")}><Bold style={ic} /></TB>
        <TB onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")}><Italic style={ic} /></TB>
        <div style={sep} />
        <TB onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} active={editor?.isActive("heading", { level: 1 })}><Heading1 style={ic} /></TB>
        <TB onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} active={editor?.isActive("heading", { level: 2 })}><Heading2 style={ic} /></TB>
        <div style={sep} />
        <TB onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")}><List style={ic} /></TB>
        <TB onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList")}><ListOrdered style={ic} /></TB>
        <div style={{ flex: 1 }} />
        <button onClick={handleSave} disabled={saving || loading}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", background: loading ? "#D4CEC8" : "#059669", color: "#fff", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: saving || loading ? "default" : "pointer" }}>
          {saving ? <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} /> : <Save style={{ width: 12, height: 12 }} />}
          {saving ? "保存中..." : "保存（新バージョン）"}
        </button>
      </div>

      {/* 警告バー */}
      <p style={{ margin: 0, padding: "5px 12px", fontSize: 11, color: "#92400E", background: "#FEF3C7", borderBottom: "1px solid rgba(217,119,6,0.2)", flexShrink: 0 }}>
        本文・見出し・太字/斜体・箇条書き・表を編集できます。保存すると図形・一部レイアウト・脚注・変更履歴は失われる場合があります。
      </p>

      {/* エディタ本体 */}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, background: "#F4F5F6", padding: 16 }}>
        {loading && <Centered><Loader2 style={{ width: 22, height: 22, animation: "spin 1s linear infinite" }} /> 読み込み中...</Centered>}
        <div style={{ display: loading ? "none" : "block", maxWidth: 820, margin: "0 auto", background: "#fff", padding: "40px 48px", borderRadius: 6, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", minHeight: "100%" }}>
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
});

const ic: React.CSSProperties = { width: 14, height: 14 };
const sep: React.CSSProperties = { width: 1, height: 18, background: "rgba(26,23,20,0.10)", margin: "0 4px" };

function TB({ onClick, active, children }: { onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 28,
      borderRadius: 6, cursor: "pointer", border: "none",
      background: active ? "#ECFDF5" : "transparent", color: active ? "#059669" : "#6B6458",
    }}>{children}</button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: "100%", color: "#B0A9A4", fontSize: 12 }}>{children}</div>;
}
