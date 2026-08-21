import { useEffect, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { Loader2, X } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { uploadProjectFile, fetchProjectFileFresh } from "@/app/lib/projectFiles";
import { htmlToDocxBlob } from "@/app/lib/htmlToDocx";
import { docxToEditorHtml } from "@/app/lib/docxToHtml";
import { DocxSpan, DocxBlockStyle, Superscript, Subscript } from "@/app/lib/docxTiptap";
import type { DocxLook } from "@/app/lib/docxLook";
import { WordToolbar } from "./WordToolbar";
import type { EditorHandle } from "./ExcelEditor";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// ENHA2-035 Word(.docx) 画面内エディタ
//
// docxToEditorHtml で docx → HTML にして TipTap で編集し、保存時は htmlToDocx で
// docx を再生成する（再生成方式なので図形・テキストボックス・脚注・変更履歴・
// ヘッダー/フッターは失われる）。
//
// 見た目はビューア（docx-preview）に合わせる。用紙サイズ・余白・本文と見出しの
// 書体/大きさ/行間は docx から読んだ実際の値を使い、文字色・サイズ・書体や
// 段落の配置・字下げ・行間・網かけ・罫線、表の列幅やセルの塗りも読み込んで
// そのまま編集・保存できるようにしている。

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
  const [look, setLook] = useState<DocxLook | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      DocxSpan, DocxBlockStyle, Superscript, Subscript,
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
        // 署名付きURLは60秒で失効する。閲覧してから編集ボタンを押すまでに
        // それ以上かかるのが普通なので、渡されたURLは使わず発行し直して取りに行く。
        const buf = await (await fetchProjectFileFresh(file.id, url)).arrayBuffer();
        const { html, look: docxLook } = await docxToEditorHtml(new Uint8Array(buf));
        if (cancelled) return;
        setLook(docxLook);
        editor.commands.setContent(html);
        setDirty(false);
        setLoading(false);
      } catch (e) {
        console.error("[WordEditor] load error:", e);
        if (!cancelled) { setError("Wordファイルの読み込みに失敗しました"); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [editor, url, file.id]);

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
      // 用紙サイズと余白は元の docx のものを引き継ぐ
      const blob = await htmlToDocxBlob(editor.getHTML(), look?.page);
      const newFile = new File([blob], file.fileName, { type: blob.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });

      let targetParentId = (file as any).parentId ?? (file as any).parent_id ?? (file as any).folderId ?? null;
      if (isSupabaseEnabled && file.id) {
        try {
          const { data } = await supabase!.from("project_files").select("parent_id").eq("id", file.id).single();
          if (data && data.parent_id) targetParentId = data.parent_id;
        } catch (err) {
          console.warn("parent_id fetch failed", err);
        }
      }

      // APIに更新対象のファイルIDを明示的に伝える
      await uploadProjectFile(file.projectId, newFile, { parentId: targetParentId, fileId: file.id });
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
  }, [editor, file, look, onSaved]);

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
        <WordToolbar editor={editor} saving={saving} loading={loading} onSave={handleSaveClick} />

        {/* 警告バー */}
        <p style={{ margin: 0, padding: "5px 12px", fontSize: 11, color: "#92400E", background: "#FEF3C7", borderBottom: "1px solid rgba(217,119,6,0.2)", flexShrink: 0 }}>
          文字・段落・表の書式を編集できます。保存すると図形・テキストボックス・脚注・変更履歴・ヘッダー/フッターは失われる場合があります。
        </p>

        {/* エディタ本体（Wordの用紙を再現したページの上で編集する） */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0, background: "#F4F5F6", padding: 16 }}>
          <style>{PAGE_CSS}{look?.css ?? ""}</style>
          {loading && <Centered><Loader2 style={{ width: 22, height: 22, animation: "spin 1s linear infinite" }} /> 読み込み中...</Centered>}
          <div className="dv-docx" style={{ display: loading ? "none" : "block", margin: "0 auto", background: "#fff", boxShadow: "0 1px 4px rgba(0,0,0,0.06)", minHeight: "100%" }}>
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
                保存すると、図形・テキストボックス・脚注・変更履歴などは失われる場合があります。
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

// Word（ビューアの docx-preview）と揃えるための共通スタイル。
// 用紙幅・余白・本文/見出しの書体は docx から読んだ値で上書きされる（look.css が後勝ち）。
// ここに書いてあるのは、どの docx でも共通の「Wordらしさ」と、Tailwind の
// リセットで消えてしまう箇条書き・表・上付き下付きの体裁の復元。
const PAGE_CSS = `
.dv-docx{width:794px;max-width:100%;padding:96px;box-sizing:border-box;}
.dv-docx .ProseMirror{font-family:"Yu Gothic","游ゴシック","Hiragino Sans",Meiryo,sans-serif;font-size:11pt;line-height:1.15;color:#000;outline:none;}
.dv-docx .ProseMirror p{margin:0;}
.dv-docx .ProseMirror ul,.dv-docx .ProseMirror ol{margin:0;padding-left:48px;}
.dv-docx .ProseMirror ul{list-style:disc;}
.dv-docx .ProseMirror ul ul{list-style:circle;}
.dv-docx .ProseMirror ul ul ul{list-style:square;}
.dv-docx .ProseMirror ol{list-style:decimal;}
.dv-docx .ProseMirror ol ol{list-style:lower-alpha;}
.dv-docx .ProseMirror ol ol ol{list-style:lower-roman;}
.dv-docx .ProseMirror li{margin:0;}
.dv-docx .ProseMirror li>p{margin:0;}
.dv-docx .ProseMirror sup{vertical-align:super;font-size:64%;}
.dv-docx .ProseMirror sub{vertical-align:sub;font-size:64%;}
.dv-docx .ProseMirror u{text-decoration:underline;}
.dv-docx .ProseMirror table{border-collapse:collapse;width:100%;margin:10px 0;table-layout:fixed;}
/* 罫線は表そのものが持つ既定（--dv-cell-border）を全セルに効かせる。
   こうすると編集中に足した行やセルも同じ罫線になる。セル固有の罫線は
   インラインstyleで上書きされ、罫線の無い表は Word と同じ薄いガイド線になる。 */
.dv-docx .ProseMirror th,.dv-docx .ProseMirror td{border:var(--dv-cell-border,1px dashed rgba(0,0,0,0.18));padding:4px 6px;vertical-align:top;}
.dv-docx .ProseMirror th{font-weight:inherit;text-align:left;}
.dv-docx .ProseMirror .selectedCell:after{content:"";position:absolute;inset:0;background:rgba(5,150,105,0.10);pointer-events:none;}
.dv-docx .ProseMirror th,.dv-docx .ProseMirror td{position:relative;}
.dv-docx .ProseMirror img{max-width:100%;height:auto;}
.dv-docx .ProseMirror a{color:#1155CC;text-decoration:underline;}
.dv-docx .ProseMirror blockquote{margin:0 0 0 24px;}
.dv-docx .ProseMirror hr{border:none;border-top:1px solid #999;margin:10px 0;}
`;

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, height: "100%", color: "#B0A9A4", fontSize: 12 }}>{children}</div>;
}
