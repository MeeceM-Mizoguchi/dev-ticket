import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Download, Loader2, FileWarning, MonitorCog, Pencil, Eye, MessageSquare, List } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { escStack } from "@/app/lib/escStack";
import { fetchSignedUrl, getFileKind, getExt, formatFileSize, isOfficeFile, canPreviewInBrowser, isEditableInBrowser, fetchFileWithRetry } from "@/app/lib/projectFiles";
import { ExcelViewer } from "./ExcelViewer";
import { ExcelEditor, type EditorHandle } from "./ExcelEditor";
import { WordEditor } from "./WordEditor";
import { FileCommentLayer } from "./FileCommentLayer";

// ENHA2-035 自前ファイルビューア
// 署名付きURLからブラウザが直接ファイルを取得し、レンダリングもすべてブラウザ内で行う。
// Microsoft/Google の外部ビューアは経由しないため、社外秘ファイルでも外部に出ない。

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, height: "100%", color: "#B0A9A4", fontSize: 12 }}>{children}</div>;
}

function Spinner() {
  return <Centered><Loader2 style={{ width: 22, height: 22, animation: "spin 1s linear infinite" }} /><span>読み込み中...</span></Centered>;
}

function ErrorBox({ message }: { message: string }) {
  return <Centered><FileWarning style={{ width: 26, height: 26, color: "#D4CEC8" }} /><span>{message}</span></Centered>;
}

// ─── Word (.docx) ────────────────────────────────────────────
function WordViewer({ url }: { url: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "done" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const blob = await (await fetchFileWithRetry(url)).blob();
        const { renderAsync } = await import("docx-preview");
        if (cancelled || !hostRef.current) return;
        hostRef.current.innerHTML = "";
        await renderAsync(blob, hostRef.current, undefined, {
          className: "docx-preview", inWrapper: true, ignoreLastRenderedPageBreak: true,
        });
        if (!cancelled) setState("done");
      } catch (e) {
        console.error("[FileViewer] docx render error:", e);
        if (!cancelled) setState("error");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  return (
    <div style={{ height: "100%", overflow: "auto", background: "#F4F5F6", minHeight: 0 }}>
      {state === "loading" && <Spinner />}
      {state === "error" && <ErrorBox message="Wordファイルの表示に失敗しました。ダウンロードして開いてください。" />}
      <div ref={hostRef} style={{ display: state === "done" ? "block" : "none", padding: 16 }} />
    </div>
  );
}

// ─── テキスト系 ───────────────────────────────────────────────
function TextViewer({ url }: { url: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await (await fetchFileWithRetry(url)).text();
        if (!cancelled) setText(t);
      } catch {
        if (!cancelled) setError("ファイルの読み込みに失敗しました");
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (error) return <ErrorBox message={error} />;
  if (text === null) return <Spinner />;
  return (
    <div style={{ height: "100%", overflow: "auto", padding: 16, minHeight: 0 }}>
      <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "var(--font-mono, monospace)", color: "#1A1714" }}>{text}</pre>
    </div>
  );
}

// ─── モーダル本体 ─────────────────────────────────────────────
interface Props {
  file: ProjectFile;
  onClose: () => void;
  onDownload: (file: ProjectFile) => void;
  onOpenInApp: (file: ProjectFile) => void;
  onSaved?: () => void;
  /** コメントへのリンク（?comment=&reply=）から開かれた場合の着地先（BRU12-025） */
  focusCommentId?: string | null;
  focusReplyId?: string | null;
}

export function FileViewerModal({ file, onClose, onDownload, onOpenInApp, onSaved, focusCommentId, focusReplyId }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const kind = getFileKind(file.fileName);
  const canEdit = isEditableInBrowser(file.fileName) && canPreviewInBrowser(file.fileName);

  // コメント（BRU12-025）。ホワイトボードと同じで、モード自体はツールバー側（ここ）が持つ
  const [commentMode, setCommentMode] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  // 編集モード中はコメントを出さない（エディタが画面を作り替えるのでピンの位置が合わない。
  // キー操作もセル入力とぶつかる）。表示できない形式も対象外。
  const commentsEnabled = !editing && !error && canPreviewInBrowser(file.fileName);

  // 別ファイルに切り替わったら閲覧モードへ戻す
  useEffect(() => { setEditing(false); setCloseConfirm(false); }, [file.id]);

  // 編集モードへ入ったらコメントモードは畳む（ピンごと消えるので開いたままにしない）
  useEffect(() => { if (!commentsEnabled) { setCommentMode(false); setListOpen(false); } }, [commentsEnabled]);

  // 閉じるガード：編集中で未保存なら確認ダイアログを出す
  const attemptCloseRef = useRef<() => void>(() => {});
  attemptCloseRef.current = () => {
    if (closeConfirm) { setCloseConfirm(false); return; }
    if (editing && editorRef.current?.isDirty()) { setCloseConfirm(true); return; }
    onClose();
  };
  const attemptClose = () => attemptCloseRef.current();
  const closeWithoutSave = () => { setCloseConfirm(false); onClose(); };
  const saveAndClose = async () => {
    const ok = await editorRef.current?.save();
    setCloseConfirm(false);
    if (ok) onClose();
  };

  useEffect(() => {
    const h = () => attemptCloseRef.current();
    escStack.push(h);
    return () => escStack.pop(h);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchSignedUrl(file.id, "inline")
      .then(u => { if (!cancelled) setUrl(u); })
      .catch(e => { if (!cancelled) setError(e?.message || "ファイルURLの取得に失敗しました"); });
    return () => { cancelled = true; };
  }, [file.id]);

  const body = (() => {
    if (error) return <ErrorBox message={error} />;
    // 編集モード：自前エディタで画面内編集（保存は新バージョンとして登録）
    if (editing && url) {
      const exit = () => setEditing(false);
      if (kind === "excel") return <ExcelEditor ref={editorRef} url={url} file={file} onSaved={() => onSaved?.()} onClose={exit} />;
      if (kind === "word") return <WordEditor ref={editorRef} url={url} file={file} onSaved={() => onSaved?.()} onClose={exit} />;
    }
    // 非対応形式(.doc/.xls/.pptx 等)はビューアを起動させない。
    // 起動すると描画に失敗して「読み込み失敗」と出るだけで、理由が伝わらないため。
    if (!canPreviewInBrowser(file.fileName)) {
      return <ErrorBox message={isOfficeFile(file.fileName)
        ? `.${getExt(file.fileName)} はブラウザ表示に対応していません。「アプリで開く」かダウンロードしてご覧ください。`
        : `.${getExt(file.fileName)} はブラウザで表示できません。ダウンロードしてご覧ください。`} />;
    }
    if (!url) return <Spinner />;
    switch (kind) {
      case "pdf":
        // ブラウザ内蔵のPDFビューアで描画（外部サービスを経由しない）
        return <iframe src={url} title={file.fileName} style={{ width: "100%", height: "100%", border: "none" }} />;
      case "excel": return <ExcelViewer url={url} />;
      case "word": return <WordViewer url={url} />;
      case "image":
        return <div style={{ height: "100%", overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "#F4F5F6" }}>
          <img src={url} alt={file.fileName} style={{ maxWidth: "100%", objectFit: "contain" }} />
        </div>;
      case "text": return <TextViewer url={url} />;
      default: return <ErrorBox message="この形式はブラウザで表示できません。ダウンロードして開いてください。" />;
    }
  })();

  return createPortal(
    // data-file-viewer は「ビューアが開いている」ことの目印。裏でホワイトボードが開いていても
    // 「c」キーをこちらのコメントモードだけが拾えるよう、CommentLayer がこれを見て降りる。
    <div data-file-viewer style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex" }}
      onClick={attemptClose}>
      {/* 図面やシートを見るため全画面。閉じるのは右上の×か Esc */}
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100vw", height: "100vh", background: "#FFFFFF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.fileName}</p>
            <p style={{ margin: 0, fontSize: 11, color: "#A09790" }}>{formatFileSize(file.fileSize)} · {file.uploadedBy}</p>
          </div>
          {/* コメント（BRU12-025）。ホワイトボードと同じで、モードに入ってから書類をクリックする。
              ショートカットは「c」（PDFはiframeにフォーカスが入るとキーが届かないのでボタンが確実） */}
          {commentsEnabled && (
            <>
              <button onClick={() => { setCommentMode(v => !v); setListOpen(false); }}
                title={commentMode ? "コメントモードを終了（Esc）" : "コメントモード（c）：書類をクリックしてコメントを置きます"}
                style={{ position: "relative", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: commentMode ? "#F59E0B" : "#FFFBEB", color: commentMode ? "#fff" : "#B45309", border: `1.5px solid ${commentMode ? "#F59E0B" : "#FDE68A"}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                <MessageSquare style={{ width: 12, height: 12 }} />コメント
                {openCount > 0 && (
                  <span style={{
                    minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, boxSizing: "border-box",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: commentMode ? "rgba(255,255,255,0.25)" : "#F59E0B", color: "#fff",
                    fontSize: 10, fontWeight: 700,
                  }}>{openCount}</span>
                )}
              </button>
              <button onClick={() => setListOpen(v => !v)} title="コメント一覧（未解決／解決済み）"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 8, background: listOpen ? "#FEF3C7" : "transparent", border: "none", cursor: "pointer", color: listOpen ? "#B45309" : "#6B6458" }}>
                <List style={{ width: 15, height: 15 }} />
              </button>
            </>
          )}
          {/* 画面内エディタ（xlsx/xlsm/docx）。閲覧⇔編集をトグルする */}
          {canEdit && (
            <button onClick={() => setEditing(v => !v)}
              title={editing ? "閲覧モードに戻る" : "この画面で直接編集します"}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: editing ? "#F4F5F6" : "#FEF3C7", color: editing ? "#6B6458" : "#B45309", border: `1.5px solid ${editing ? "rgba(26,23,20,0.12)" : "#FDE68A"}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              {editing ? <><Eye style={{ width: 12, height: 12 }} />閲覧</> : <><Pencil style={{ width: 12, height: 12 }} />編集</>}
            </button>
          )}
          {/* Office系は本物のアプリで開いて編集できるようにする（保存は再アップロード運用） */}
          {isOfficeFile(file.fileName) && (
            <button onClick={() => onOpenInApp(file)} title="デスクトップのOfficeで開きます（編集後は再アップロードが必要）"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#EFF6FF", color: "#2563EB", border: "1.5px solid #BFDBFE", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <MonitorCog style={{ width: 12, height: 12 }} />アプリで開く
            </button>
          )}
          <button onClick={() => onDownload(file)} title="ダウンロード"
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Download style={{ width: 12, height: 12 }} />ダウンロード
          </button>
          <button onClick={attemptClose} title="閉じる"
            style={{ width: 30, height: 30, borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        {/* コメントのピン層をこの箱の中に敷くので position:relative にする */}
        <div ref={bodyRef} style={{ flex: 1, minHeight: 0, position: "relative" }}>
          {body}
          {commentsEnabled && (
            <FileCommentLayer
              file={file}
              hostRef={bodyRef}
              commentMode={commentMode}
              setCommentMode={setCommentMode}
              listOpen={listOpen}
              setListOpen={setListOpen}
              focusCommentId={focusCommentId}
              focusReplyId={focusReplyId}
              onCountChange={setOpenCount}
            />
          )}
        </div>
      </div>

      {/* 未保存の確認 */}
      {closeConfirm && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: "fixed", inset: 0, zIndex: 13000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 380, maxWidth: "90vw", background: "#fff", borderRadius: 14, padding: "22px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#1A1714" }}>保存されていない変更があります</p>
            <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6B6458", lineHeight: 1.6 }}>編集内容を保存してから閉じますか？</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button onClick={saveAndClose}
                style={{ padding: "10px 14px", background: "#059669", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                保存して閉じる
              </button>
              <button onClick={closeWithoutSave}
                style={{ padding: "10px 14px", background: "#FEF2F2", color: "#DC2626", border: "1.5px solid #FECACA", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                保存せずに閉じる
              </button>
              <button onClick={() => setCloseConfirm(false)}
                style={{ padding: "10px 14px", background: "#F4F5F6", color: "#6B6458", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
