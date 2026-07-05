// エクスポート: PNG / SVG ダウンロードと、画像としてクリップボードへコピー。
import { useState, useRef, useLayoutEffect, type RefObject } from "react";
import { createPortal } from "react-dom";
import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import { Download, Copy, Check } from "lucide-react";
import { copyImage } from "@/lib/clipboard";

interface Props { api: any; title: string; containerRef: RefObject<HTMLDivElement> }

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function WhiteboardExportMenu({ api, title, containerRef }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  // メニューはフレーム枠線canvas(zIndex:4)より前面へ出すため、ボタン直下ではなく
  // ボード コンテナへ portal して高いzIndexで描く。位置はボタンの矩形から算出。
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setMenuPos(null); return; }
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setMenuPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [open]);

  const scene = () => ({
    elements: api.getSceneElements(),
    // 画面はviewBackgroundColorを透明にしている（フレーム背景を内容の背面に描くため）。
    // エクスポートは従来どおり白背景で書き出す。
    appState: { ...api.getAppState(), exportBackground: true, viewBackgroundColor: "#ffffff" },
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
      <button ref={btnRef} onClick={() => setOpen((o) => !o)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12, fontWeight: 600,
          color: "#059669", background: "#fff", border: "1px solid rgba(5,150,105,0.25)", borderRadius: 8,
          cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.08)", whiteSpace: "nowrap", flexShrink: 0 }}>
        {copied ? <Check style={{ width: 13, height: 13 }} /> : <Download style={{ width: 13, height: 13 }} />}
        {copied ? "コピーしました" : "エクスポート"}
      </button>
      {open && menuPos && containerRef.current && createPortal(
        <>
          {/* 外クリックで閉じる背面レイヤ */}
          <div style={{ position: "fixed", inset: 0, zIndex: 100 }} onClick={() => setOpen(false)} />
          {/* メニュー本体: フレーム枠線canvas(zIndex:4)やツールバー(25)より前面へ */}
          <div style={{ position: "fixed", top: menuPos.top, right: menuPos.right, background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.14)", overflow: "hidden", minWidth: 180, zIndex: 101 }}>
            <button style={item} onClick={exportPng}><Download style={{ width: 13, height: 13 }} />PNG形式で保存</button>
            <button style={item} onClick={exportSvg}><Download style={{ width: 13, height: 13 }} />SVG形式で保存</button>
            <button style={item} onClick={() => { copyToClipboard(); setOpen(false); }}>
              <Copy style={{ width: 13, height: 13 }} />画像をクリップボードにコピー
            </button>
          </div>
        </>,
        containerRef.current
      )}
    </div>
  );
}
