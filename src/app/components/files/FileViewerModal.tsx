import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Download, Loader2, FileWarning, MonitorCog, Pencil, Eye, MessageSquare, List, History, RotateCcw } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { escStack } from "@/app/lib/escStack";
import { fetchSignedUrl, getFileKind, getExt, formatFileSize, isOfficeFile, canPreviewInBrowser, isEditableInBrowser, fetchFileWithRetry, restoreFileVersion } from "@/app/lib/projectFiles";
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
  /** このファイルの全バージョン（同じフォルダの同名の行）。渡されたときだけ履歴を出す */
  versions?: ProjectFile[];
  /** 過去バージョンへ戻した後（一覧の取り直し用） */
  onRestored?: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export function FileViewerModal({ file, onClose, onDownload, onOpenInApp, onSaved, focusCommentId, focusReplyId, versions, onRestored }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const editorRef = useRef<EditorHandle | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // バージョン履歴。viewing は「表示中の過去の版」（null なら最新版 = file）
  const history = (versions ?? []).filter(v => !v.isFolder && !v.externalProvider)
    .sort((a, b) => b.version - a.version);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewing, setViewing] = useState<ProjectFile | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<ProjectFile | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState("");
  const restoringRef = useRef(false);
  const shown = viewing ?? file;
  const isOldVersion = viewing !== null && viewing.id !== file.id;

  const kind = getFileKind(file.fileName);
  const canEdit = isEditableInBrowser(file.fileName) && canPreviewInBrowser(file.fileName) && !isOldVersion;

  // コメント（BRU12-025）。ホワイトボードと同じで、モード自体はツールバー側（ここ）が持つ
  const [commentMode, setCommentMode] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);
  // 編集モード中はコメントを出さない（エディタが画面を作り替えるのでピンの位置が合わない。
  // キー操作もセル入力とぶつかる）。表示できない形式も対象外。
  // 過去の版を表示している間も出さない（ピンは最新版の見た目に合わせて置かれているため）
  const commentsEnabled = !editing && !error && !isOldVersion && canPreviewInBrowser(file.fileName);

  // 別ファイルに切り替わったら（戻した結果、最新版が変わった場合も）最新版の閲覧モードへ戻す
  useEffect(() => { setEditing(false); setCloseConfirm(false); setViewing(null); setRestoreTarget(null); }, [file.id]);

  const handleRestore = async () => {
    if (!restoreTarget || restoringRef.current) return;
    restoringRef.current = true;
    setRestoring(true);
    try {
      await restoreFileVersion(restoreTarget.id);
      setRestoreTarget(null);
      setViewing(null);
      onRestored?.();
    } catch (e) {
      // ダイアログは開いたままにして理由を出す（閉じてしまうと失敗に気づけない）
      setRestoreError(e instanceof Error ? e.message : "バージョンを戻せませんでした");
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  };

  // 編集モードへ入ったらコメントモードは畳む（ピンごと消えるので開いたままにしない）
  useEffect(() => { if (!commentsEnabled) { setCommentMode(false); setListOpen(false); } }, [commentsEnabled]);

  // 閉じるガード：編集中で未保存なら確認ダイアログを出す
  const attemptCloseRef = useRef<() => void>(() => {});
  attemptCloseRef.current = () => {
    if (closeConfirm) { setCloseConfirm(false); return; }
    if (restoreTarget) { if (!restoringRef.current) setRestoreTarget(null); return; }
    if (historyOpen) { setHistoryOpen(false); return; }
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

  // 署名付きURLの有効期限は60秒。開いたまま時間が経ってから編集に入る／閲覧に戻ると、
  // 失効したURLのままビューアやエディタが取りに行って「読み込みに失敗しました」になる。
  // モードが切り替わるたびに発行し直し、届くまではスピナーを出す（古いURLで描き始めさせない）。
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError("");
    fetchSignedUrl(shown.id, "inline")
      .then(u => { if (!cancelled) setUrl(u); })
      .catch(e => { if (!cancelled) setError(e?.message || "ファイルURLの取得に失敗しました"); });
    return () => { cancelled = true; };
  }, [shown.id, editing]);

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
            <p style={{ margin: 0, fontSize: 11, color: "#A09790" }}>{formatFileSize(shown.fileSize)} · {shown.uploadedBy}</p>
          </div>
          {/* バージョン履歴（版が2つ以上あるときだけ） */}
          {history.length > 1 && !editing && (
            <button onClick={() => setHistoryOpen(v => !v)} title="バージョン履歴（過去の版の表示・ダウンロード・復元）"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: historyOpen ? "#EEF2FF" : "#F8FAFC", color: "#4F46E5", border: `1.5px solid ${historyOpen ? "#A5B4FC" : "#E0E7FF"}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <History style={{ width: 12, height: 12 }} />履歴
              <span style={{ fontSize: 10, fontWeight: 700, padding: "0 5px", borderRadius: 8, background: "#E0E7FF" }}>v{file.version}</span>
            </button>
          )}
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
            <button onClick={() => onOpenInApp(file)} title="デスクトップのOfficeで最新版を開きます（保存すると新しいバージョンとして反映されます）"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#EFF6FF", color: "#2563EB", border: "1.5px solid #BFDBFE", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <MonitorCog style={{ width: 12, height: 12 }} />アプリで開く
            </button>
          )}
          <button onClick={() => onDownload(shown)} title={isOldVersion ? `v${shown.version} をダウンロード` : "ダウンロード"}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", background: "#ECFDF5", color: "#059669", border: "1.5px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Download style={{ width: 12, height: 12 }} />ダウンロード
          </button>
          <button onClick={attemptClose} title="閉じる"
            style={{ width: 30, height: 30, borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        {isOldVersion && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#FFFBEB", borderBottom: "1px solid #FDE68A", fontSize: 12, color: "#92400E", flexShrink: 0 }}>
            <History style={{ width: 13, height: 13, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              過去のバージョン <strong>v{shown.version}</strong>（{formatDateTime(shown.createdAt)} · {shown.uploadedBy}）を表示しています。最新は v{file.version} です。
            </span>
            <button onClick={() => { setRestoreError(""); setRestoreTarget(shown); }}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 10px", background: "#F59E0B", color: "#fff", border: "none", borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
              <RotateCcw style={{ width: 12, height: 12 }} />この版に戻す
            </button>
            <button onClick={() => setViewing(null)}
              style={{ padding: "4px 10px", background: "#fff", color: "#92400E", border: "1px solid #FDE68A", borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              最新版を表示
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {/* コメントのピン層をこの箱の中に敷くので position:relative にする */}
        <div ref={bodyRef} style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
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
        {historyOpen && !editing && (
          <aside style={{ width: 300, flexShrink: 0, borderLeft: "1px solid rgba(26,23,20,0.08)", background: "#FAFAF9", display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
              <History style={{ width: 13, height: 13, color: "#4F46E5", marginRight: 6 }} />
              <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "#1A1714" }}>バージョン履歴</span>
              <button onClick={() => setHistoryOpen(false)} title="閉じる"
                style={{ width: 24, height: 24, borderRadius: 6, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458" }}>
                <X style={{ width: 13, height: 13 }} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              {history.map(v => {
                const isLatest = v.id === file.id;
                const active = shown.id === v.id;
                return (
                  <div key={v.id} onClick={() => setViewing(isLatest ? null : v)}
                    style={{ padding: "8px 10px", borderRadius: 8, cursor: "pointer", background: active ? "#EEF2FF" : "#fff", border: `1px solid ${active ? "#A5B4FC" : "rgba(26,23,20,0.08)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5" }}>v{v.version}</span>
                      {isLatest && <span style={{ fontSize: 10, fontWeight: 700, padding: "0 6px", borderRadius: 8, background: "#DCFCE7", color: "#15803D" }}>最新</span>}
                      <span style={{ marginLeft: "auto", fontSize: 10, color: "#A09790" }}>{formatFileSize(v.fileSize)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: "#6B6458", marginTop: 2 }}>{formatDateTime(v.createdAt)} · {v.uploadedBy}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={e => { e.stopPropagation(); onDownload(v); }} title={`v${v.version} をダウンロード`}
                        style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", background: "#fff", color: "#059669", border: "1px solid #A7F3D0", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                        <Download style={{ width: 11, height: 11 }} />DL
                      </button>
                      {!isLatest && (
                        <button onClick={e => { e.stopPropagation(); setRestoreError(""); setRestoreTarget(v); }}
                          style={{ display: "flex", alignItems: "center", gap: 3, padding: "3px 8px", background: "#FFFBEB", color: "#B45309", border: "1px solid #FDE68A", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
                          <RotateCcw style={{ width: 11, height: 11 }} />この版に戻す
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        )}
        </div>
      </div>

      {/* 過去バージョンへ戻す確認 */}
      {restoreTarget && (
        <div onClick={e => e.stopPropagation()}
          style={{ position: "fixed", inset: 0, zIndex: 13000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 400, maxWidth: "90vw", background: "#fff", borderRadius: 14, padding: "22px 24px", boxShadow: "0 12px 40px rgba(0,0,0,0.25)" }}>
            <p style={{ margin: "0 0 6px", fontSize: 15, fontWeight: 700, color: "#1A1714" }}>v{restoreTarget.version} に戻しますか？</p>
            <p style={{ margin: "0 0 14px", fontSize: 13, color: "#6B6458", lineHeight: 1.6 }}>
              v{restoreTarget.version}（{formatDateTime(restoreTarget.createdAt)} · {restoreTarget.uploadedBy}）の内容を、
              新しいバージョン <strong>v{file.version + 1}</strong> として保存します。
              現在の v{file.version} を含む履歴は消えないので、あとから戻し直せます。
            </p>
            {restoreError && <p style={{ margin: "0 0 12px", fontSize: 12, color: "#DC2626" }}>{restoreError}</p>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setRestoreTarget(null)} disabled={restoring}
                style={{ padding: "9px 14px", background: "#F4F5F6", color: "#6B6458", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: restoring ? "default" : "pointer" }}>
                キャンセル
              </button>
              <button onClick={handleRestore} disabled={restoring}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 14px", background: "#F59E0B", color: "#fff", border: "none", borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: restoring ? "default" : "pointer", opacity: restoring ? 0.7 : 1 }}>
                {restoring ? <Loader2 style={{ width: 13, height: 13, animation: "spin 1s linear infinite" }} /> : <RotateCcw style={{ width: 13, height: 13 }} />}
                {restoring ? "戻しています..." : "この版に戻す"}
              </button>
            </div>
          </div>
        </div>
      )}

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
