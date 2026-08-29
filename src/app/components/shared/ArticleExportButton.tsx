// wiki記事 / 議事録 を Excel / Word / PDF / Markdown に出力するエクスポートボタン(ドロップダウン)。
// 実体の生成は articleExport モジュールを動的 import で遅延ロードする。
import { useState } from "react";
import { Download, FileCode2, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/app/components/ui/dropdown-menu";
import { useToast } from "@/app/contexts/ToastContext";
import type { ExportFormat } from "@/app/lib/articleExport";

interface Props {
  // フォーマットを受け取り、生成～ダウンロードまで行う非同期処理
  onExport: (format: ExportFormat) => Promise<void>;
  // 出すメニュー項目。省略時は Excel / Word / PDF の3つ
  formats?: ExportFormat[];
  disabled?: boolean;
}

const OPTION: Record<ExportFormat, { label: string; Icon: typeof FileText }> = {
  xlsx: { label: "Excel (.xlsx)", Icon: FileSpreadsheet },
  docx: { label: "Word (.docx)", Icon: FileText },
  pdf: { label: "PDF (.pdf)", Icon: FileType2 },
  md: { label: "Markdown (.md)", Icon: FileCode2 },
};

const DEFAULT_FORMATS: ExportFormat[] = ["xlsx", "docx", "pdf"];

export function ArticleExportButton({ onExport, formats = DEFAULT_FORMATS, disabled }: Props) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handle = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(true);
    try {
      await onExport(format);
    } catch (e) {
      console.error("[articleExport]", e);
      toast("エクスポートに失敗しました", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          disabled={disabled || busy}
          style={{
            display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
            padding: "6px 12px", fontSize: 12, fontWeight: 600,
            color: "#4A4540", background: "#fff",
            border: "1px solid rgba(26,23,20,0.12)", borderRadius: 8,
            cursor: disabled || busy ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
          }}
        >
          {busy ? <Loader2 style={{ width: 14, height: 14 }} className="animate-spin" /> : <Download style={{ width: 14, height: 14 }} />}
          エクスポート
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map(format => {
          const { label, Icon } = OPTION[format];
          return (
            <DropdownMenuItem key={format} onSelect={() => handle(format)} disabled={busy}>
              <Icon style={{ width: 15, height: 15 }} />
              {label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
