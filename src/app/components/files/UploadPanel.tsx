// ファイルボックスのアップロードの進み具合と結果を、どの画面でも右下に出す（BRU20-010）。
// 中身は UploadContext のキューそのもの。App の最上位に1つだけ置く。
//
// ★ z-index は BlockingSpinner(1000) より上にする。Google形式への変換中もこのパネルの
//   「すべて中止」を押せるようにするため。トースト(9999)・通話ウィジェット(9998)よりは下。
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronUp, Clock, Loader2, RotateCcw, Upload, X,
} from "lucide-react";
import { isPendingUpload, useUploads, type UploadItem } from "@/app/contexts/UploadContext";
import { formatFileSize, googleConvertKind } from "@/app/lib/projectFiles";

const GREEN = "#059669";
const RED = "#DC2626";
const MUTED = "#9E9690";

/** 送信中のファイルの進み具合（%）。ファイルボックスの点線枠でも同じ式を使う */
export function uploadPercent(it: UploadItem): number {
  return it.file.size > 0 ? Math.floor((it.loaded / it.file.size) * 100) : 100;
}

/** 送り終えて、サーバーで Google形式に変換している最中か */
export function isConvertingUpload(it: UploadItem): boolean {
  return it.status === "uploading" && it.convert && !!googleConvertKind(it.file.name) && it.loaded >= it.file.size;
}

function statusText(it: UploadItem): string {
  switch (it.status) {
    case "done": return "完了";
    case "queued": return "待機中";
    case "canceled": return "中止";
    case "failed": return `失敗（${it.reason || "アップロードに失敗しました"}）`;
    case "uploading":
      if (isConvertingUpload(it)) return "Google形式に変換中";
      return `送信中 ${uploadPercent(it)}%（${formatFileSize(it.loaded)} / ${formatFileSize(it.file.size)}）`;
  }
}

function StatusIcon({ it }: { it: UploadItem }) {
  const s = { width: 14, height: 14, flexShrink: 0 } as const;
  switch (it.status) {
    case "done": return <CheckCircle2 style={{ ...s, color: GREEN }} />;
    case "queued": return <Clock style={{ ...s, color: MUTED }} />;
    case "canceled": return <Ban style={{ ...s, color: MUTED }} />;
    case "failed": return <AlertTriangle style={{ ...s, color: RED }} />;
    case "uploading": return <Loader2 style={{ ...s, color: GREEN, animation: "spin 1s linear infinite" }} />;
  }
}

const iconBtn = {
  display: "flex", alignItems: "center", justifyContent: "center", width: 24, height: 24,
  border: "none", background: "transparent", borderRadius: 6, cursor: "pointer", color: "#6B6458", padding: 0,
} as const;

export function UploadPanel() {
  const { items, active, retry, cancelAll, dismiss } = useUploads();
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const finished = items.filter(it => it.status === "done" || it.status === "failed" || it.status === "canceled").length;
  const failed = items.filter(it => it.status === "failed").length;
  const doneCount = items.filter(it => it.status === "done").length;
  const pending = items.filter(isPendingUpload).length;

  // 全体の進み具合（中止したものは数えない）
  const counted = items.filter(it => it.status !== "canceled");
  const totalBytes = counted.reduce((n, it) => n + it.file.size, 0);
  const sentBytes = counted.reduce((n, it) => n + (it.status === "done" ? it.file.size : it.status === "uploading" ? it.loaded : 0), 0);
  const overall = totalBytes > 0 ? Math.floor((sentBytes / totalBytes) * 100) : (active ? 0 : 100);

  const title = active
    ? `アップロード中（${Math.min(finished + 1, items.length)} / ${items.length}）`
    : failed > 0
      ? `${failed} 件のアップロードに失敗しました`
      : doneCount > 0 ? `${doneCount} 件のアップロードが完了しました` : "アップロードを中止しました";
  const headColor = active ? GREEN : failed > 0 ? RED : doneCount > 0 ? GREEN : MUTED;

  return createPortal(
    <div role="region" aria-label="ファイルのアップロード"
      style={{
        position: "fixed", right: 20, bottom: 20, zIndex: 1001, width: 360, maxWidth: "calc(100vw - 32px)",
        background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.08)",
        boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden",
        display: "flex", flexDirection: "column",
      }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 10px 10px 14px", borderBottom: collapsed ? "none" : "1px solid rgba(26,23,20,0.06)" }}>
        {failed > 0 && !active
          ? <AlertTriangle style={{ width: 15, height: 15, color: headColor, flexShrink: 0 }} />
          : <Upload style={{ width: 15, height: 15, color: headColor, flexShrink: 0 }} />}
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
        {active && (
          <button onClick={cancelAll}
            style={{ border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: RED, borderRadius: 7, fontSize: 11, fontWeight: 600, padding: "4px 9px", cursor: "pointer", flexShrink: 0 }}>
            すべて中止
          </button>
        )}
        <button onClick={() => setCollapsed(v => !v)} style={iconBtn}
          title={collapsed ? "一覧を開く" : "一覧をたたむ"} aria-label={collapsed ? "一覧を開く" : "一覧をたたむ"}>
          {collapsed ? <ChevronUp style={{ width: 15, height: 15 }} /> : <ChevronDown style={{ width: 15, height: 15 }} />}
        </button>
        {!active && (
          <button onClick={dismiss} style={iconBtn} title="閉じる" aria-label="閉じる">
            <X style={{ width: 15, height: 15 }} />
          </button>
        )}
      </div>

      {active && (
        <div role="progressbar" aria-label="アップロード全体の進み具合" aria-valuemin={0} aria-valuemax={100} aria-valuenow={overall}
          style={{ height: 3, background: "#EFEDE9" }}>
          <div style={{ width: `${overall}%`, height: "100%", background: GREEN, transition: "width 0.3s" }} />
        </div>
      )}

      {!collapsed && (
        <div style={{ maxHeight: 280, overflowY: "auto", padding: "4px 0" }}>
          {items.map(it => {
            const name = [...it.dirPath, it.file.name].join("/");
            const showBar = it.status === "uploading" && !isConvertingUpload(it);
            return (
              <div key={it.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "7px 14px" }}>
                <span style={{ paddingTop: 1 }}><StatusIcon it={it} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div title={name} style={{ fontSize: 12, color: "#1A1714", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2, lineHeight: 1.45, color: it.status === "failed" ? RED : it.status === "uploading" ? GREEN : MUTED, wordBreak: "break-word" }}>
                    {statusText(it)}
                  </div>
                  {showBar && (
                    <div style={{ marginTop: 4, height: 4, borderRadius: 2, background: "#EFEDE9", overflow: "hidden" }}>
                      <div style={{ width: `${uploadPercent(it)}%`, height: "100%", borderRadius: 2, background: GREEN, transition: "width 0.2s" }} />
                    </div>
                  )}
                </div>
                {it.status === "failed" && it.retryable !== false && (
                  <button onClick={() => retry(it.id)}
                    style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0, border: "1px solid rgba(5,150,105,0.3)", background: "#ECFDF5", color: GREEN, borderRadius: 7, fontSize: 11, fontWeight: 600, padding: "3px 8px", cursor: "pointer" }}>
                    <RotateCcw style={{ width: 11, height: 11 }} /> やり直す
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {!collapsed && pending === 0 && failed === 0 && doneCount > 0 && (
        <div style={{ fontSize: 11, color: MUTED, padding: "0 14px 10px" }}>まもなく自動で閉じます</div>
      )}
    </div>,
    document.body,
  );
}
