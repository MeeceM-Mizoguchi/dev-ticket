// エクスポート: PNG / SVG ダウンロードと、画像としてクリップボードへコピー。
import { useState } from "react";
import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { Download, Copy, Check } from "lucide-react";
import { copyImage } from "@/lib/clipboard";

interface Props { api: any; title: string }

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WhiteboardExportMenu({ api, title }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const scene = () => ({
    elements: api.getSceneElements(),
    appState: { ...api.getAppState(), exportBackground: true },
    files: api.getFiles(),
  });
  const safe = (title || "whiteboard").replace(/[\\/:*?"<>|]/g, "_");

  const exportPng = async () => {
    const blob = await exportToBlob({ ...scene(), mimeType: "image/png", quality: 1 });
    download(blob, `${safe}.png`);
    setOpen(false);
  };
  const exportSvg = async () => {
    const svg = await exportToSvg(scene());
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
    download(blob, `${safe}.svg`);
    setOpen(false);
  };
  const copyToClipboard = async () => {
    const blob = await exportToBlob({ ...scene(), mimeType: "image/png", quality: 1 });
    const ok = await copyImage(blob);
    setCopied(ok);
    setTimeout(() => setCopied(false), 1600);
  };

  const item: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 12,
    color: "#374151", background: "transparent", border: "none", cursor: "pointer", width: "100%", textAlign: "left",
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12, fontWeight: 600,
          color: "#059669", background: "#fff", border: "1px solid rgba(5,150,105,0.25)", borderRadius: 8,
          cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", whiteSpace: "nowrap", flexShrink: 0 }}>
        {copied ? <Check style={{ width: 13, height: 13 }} /> : <Download style={{ width: 13, height: 13 }} />}
        {copied ? "コピーしました" : "エクスポート"}
      </button>
      {open && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", right: 0, background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.14)", overflow: "hidden", minWidth: 180 }}>
          <button style={item} onClick={exportPng}><Download style={{ width: 13, height: 13 }} />PNG形式で保存</button>
          <button style={item} onClick={exportSvg}><Download style={{ width: 13, height: 13 }} />SVG形式で保存</button>
          <button style={item} onClick={() => { copyToClipboard(); setOpen(false); }}>
            <Copy style={{ width: 13, height: 13 }} />画像をクリップボードにコピー
          </button>
        </div>
      )}
    </div>
  );
}
