import { useState } from "react";
import {
  Paperclip, Download, X, Loader2,
  FileText, FileSpreadsheet, Presentation, FileImage, File as FileIcon,
} from "lucide-react";
import { getFileKind, formatFileSize, KIND_COLOR } from "@/app/lib/projectFiles";

// チケットの「ファイル添付」欄。ImageAttachments のファイル版で、見た目を揃えてある。
// アップロード先の都合は呼び出し側に持たせ、ここは一覧＋ドロップゾーンだけを担当する
// （チケット作成ダイアログでは、まだチケットが存在しないので実アップロードを後回しにする）。

const KIND_ICON = {
  pdf: FileText, excel: FileSpreadsheet, word: FileText,
  powerpoint: Presentation, image: FileImage, text: FileText, other: FileIcon,
} as const;

export interface FileAttachmentItem {
  id: string;
  fileName: string;
  fileSize: number;
  /** 未アップロード（作成前の待機中）のときは省略する */
  url?: string;
}

interface Props {
  items: FileAttachmentItem[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  /** 省略時は url を新しいタブで開く */
  onDownload?: (id: string) => void;
  readOnly?: boolean;
  uploading?: boolean;
}

export function FileAttachments({ items, onAdd, onRemove, onDownload, readOnly, uploading }: Props) {
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (list.length > 0) onAdd(list);
  };

  return (
    // 親（チケット詳細の画像ドロップ領域）に入れ子で置かれるため、
    // ここで受けたドラッグは必ず止める。伝播すると親にも同じファイルが渡って二重登録になる。
    <div
      onDragOver={readOnly ? undefined : e => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
      onDragLeave={readOnly ? undefined : e => { e.stopPropagation(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={readOnly ? undefined : e => { e.preventDefault(); e.stopPropagation(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
    >
      <style>{`@keyframes fa-spin { to { transform: rotate(360deg); } }`}</style>
      {!readOnly && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", border: `1.5px dashed ${dragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.10)"}`, borderRadius: 9, cursor: uploading ? "progress" : "pointer", background: dragOver ? "rgba(5,150,105,0.04)" : "#FAFAF8", transition: "border-color 0.15s, background 0.15s" }}>
          {uploading
            ? <Loader2 style={{ width: 13, height: 13, color: "#059669", animation: "fa-spin 0.9s linear infinite" }} />
            : <Paperclip style={{ width: 13, height: 13, color: dragOver ? "#059669" : "#B0A9A4" }} />}
          <span style={{ fontSize: 12, color: dragOver || uploading ? "#059669" : "#B0A9A4" }}>
            {uploading ? "アップロード中..." : dragOver ? "ドロップして添付" : "クリックしてファイルを追加、またはドラッグ&ドロップ（1ファイル50MBまで）"}
          </span>
          <input type="file" multiple style={{ display: "none" }} disabled={uploading}
            onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
        </label>
      )}

      {items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: readOnly ? 0 : 8 }}>
          {items.map(item => {
            const Icon = KIND_ICON[getFileKind(item.fileName)];
            const color = KIND_COLOR[getFileKind(item.fileName)];
            return (
              <div key={item.id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(26,23,20,0.07)", background: "#FFF" }}>
                <Icon style={{ width: 14, height: 14, color, flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 12, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={item.fileName}>
                  {item.fileName}
                </span>
                <span style={{ fontSize: 10, color: "#B0A9A4", flexShrink: 0 }}>{formatFileSize(item.fileSize)}</span>
                {item.url && (
                  <button type="button" title="ダウンロード"
                    onClick={() => { if (onDownload) onDownload(item.id); else window.open(item.url, "_blank", "noopener"); }}
                    style={{ padding: 3, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", color: "#B0A9A4", flexShrink: 0, display: "flex" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#059669"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#B0A9A4"; }}>
                    <Download style={{ width: 12, height: 12 }} />
                  </button>
                )}
                {!readOnly && (
                  <button type="button" title="削除" onClick={() => onRemove(item.id)}
                    style={{ padding: 3, borderRadius: 5, border: "none", background: "transparent", cursor: "pointer", color: "#D5D0CB", flexShrink: 0, display: "flex" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#D5D0CB"; }}>
                    <X style={{ width: 12, height: 12 }} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
