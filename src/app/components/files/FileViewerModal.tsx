import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, Download, Loader2, FileWarning, MonitorCog } from "lucide-react";
import type { ProjectFile } from "@/app/types";
import { escStack } from "@/app/lib/escStack";
import { fetchSignedUrl, getFileKind, getExt, formatFileSize, isOfficeFile, canPreviewInBrowser } from "@/app/lib/projectFiles";
import { ExcelViewer } from "./ExcelViewer";

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
        const blob = await (await fetch(url)).blob();
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
        const t = await (await fetch(url)).text();
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
}

export function FileViewerModal({ file, onClose, onDownload, onOpenInApp }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const kind = getFileKind(file.fileName);

  useEffect(() => {
    escStack.push(onClose);
    return () => escStack.pop(onClose);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    fetchSignedUrl(file.id, "inline")
      .then(u => { if (!cancelled) setUrl(u); })
      .catch(e => { if (!cancelled) setError(e?.message || "ファイルURLの取得に失敗しました"); });
    return () => { cancelled = true; };
  }, [file.id]);

  const body = (() => {
    if (error) return <ErrorBox message={error} />;
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
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex" }}
      onClick={onClose}>
      {/* 図面やシートを見るため全画面。閉じるのは右上の×か Esc */}
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100vw", height: "100vh", background: "#FFFFFF", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid rgba(26,23,20,0.07)", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.fileName}</p>
            <p style={{ margin: 0, fontSize: 11, color: "#A09790" }}>{formatFileSize(file.fileSize)} · {file.uploadedBy}</p>
          </div>
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
          <button onClick={onClose} title="閉じる"
            style={{ width: 30, height: 30, borderRadius: 8, background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458" }}>
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>{body}</div>
      </div>
    </div>,
    document.body
  );
}
