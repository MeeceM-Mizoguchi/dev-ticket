import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Loader2, Save, Bold, Italic, List, ListOrdered, Heading1, Heading2, X } from "lucide-react";
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
  const [confirmOpen, setConfirmOpen] = useState(false);

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

  const handleSaveClick = useCallback(() => {
    setConfirmOpen(true);
  }, []);

  const executeSave = useCallback(async () => {
    setConfirmOpen(false);
    if (await doSave()) onClose();
  }, [doSave, onClose]);

  useImperativeHandle(ref, () => ({ isDirty: () => dirty, save: () => doSave() }), [dirty, doSave]);

  if (error) return <Centered>{error}</Centered>;

  return (
    <>
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
          <button onClick={handleSaveClick} disabled={saving || loading}
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

      {/* 🌟 グリーンボタンデザインの確認モーダル */}
      {confirmOpen && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(0,0,0,0.4)", backdropFilter: "blur(2px)"
        }}>
          <div style={{
            position: "relative",
            background: "#fff", width: 440, maxWidth: "90vw", borderRadius: 16, overflow: "hidden",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)",
            animation: "fadeIn 0.15s ease-out"
          }}>
            {/* ヘッダー部分 */}
            <div style={{
              position: "relative",
              background: "#0E835F",
              padding: "24px 32px",
              overflow: "hidden"
            }}>
              {/* 背景の装飾円 */}
              <div style={{ position: "absolute", top: -40, right: -20, width: 140, height: 140, borderRadius: "50%", background: "rgba(0,0,0,0.08)" }} />
              <div style={{ position: "absolute", bottom: -60, left: 20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.06)" }} />

              <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: "0.1em", marginBottom: 6 }}>
                    DEV TICKET
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#FFF", letterSpacing: "0.02em" }}>
                    保存の確認
                  </div>
                </div>
                <button
                  onClick={() => setConfirmOpen(false)}
                  style={{
                    width: 36, height: 36, borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF", cursor: "pointer", flexShrink: 0
                  }}
                >
                  <X style={{ width: 18, height: 18 }} />
                </button>
              </div>
            </div>

            {/* 本文エリア */}
            <div style={{ padding: "32px 32px 28px 32px" }}>
              <p style={{ margin: "0 0 16px 0", fontSize: 17, fontWeight: 700, color: "#1A1714", lineHeight: 1.4 }}>
                新バージョンとして保存しますか？
              </p>
              <p style={{ margin: 0, fontSize: 14, color: "#8B8680", lineHeight: 1.5 }}>
                保存すると、図形・一部レイアウト・脚注・変更履歴などは失われる場合があります。
              </p>
            </div>

            {/* ボタンエリア */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, padding: "24px 32px", borderTop: "1px solid rgba(26,23,20,0.06)" }}>
              <button
                onClick={() => setConfirmOpen(false)}
                style={{
                  padding: "10px 24px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#FFF",
                  fontSize: 14, fontWeight: 700, color: "#4B4540", cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)"
                }}
              >
                キャンセル
              </button>
              <button
                onClick={executeSave}
                style={{
                  padding: "10px 24px", borderRadius: 8, border: "none",
                  background: "#0E835F", // 画像通りのグリーンボタン
                  fontSize: 14, fontWeight: 700, color: "#FFF", cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(14, 131, 95, 0.3)" // 緑のシャドウ効果
                }}
              >
                保存する
              </button>
            </div>
          </div>
          <style>{`
            @keyframes fadeIn {
              from { opacity: 0; transform: scale(0.96); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}
    </>
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