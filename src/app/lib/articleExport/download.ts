// Blob をファイルとしてダウンロードさせる共通処理。
// 既存 csvExport.ts / reportPdf.tsx と同じ <a download> 方式。
// ※ Capacitor(iPad/Mac)ネイティブでは a.download が効かない可能性があるが、
//   既存の CSV/PDF 出力も同方式のため踏襲する（必要なら将来 Filesystem+Share でフォールバック）。
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ファイル名に使えない文字を除去し、日付スタンプ付きの安全な名前を作る。
export function safeFileName(title: string, stamp: string, ext: string): string {
  const base = (title || "無題").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base}_${stamp}.${ext}`;
}

// YYYYMMDD スタンプ
export function dateStamp(d: Date = new Date()): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
