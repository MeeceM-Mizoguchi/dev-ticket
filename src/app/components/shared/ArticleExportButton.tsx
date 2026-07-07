// wiki記事 / 議事録 を Excel / Word / PDF に出力するエクスポートボタン(ドロップダウン)。
// 実体の生成は articleExport モジュールを動的 import で遅延ロードする。
import { useState } from "react";
import { Download, FileSpreadsheet, FileText, FileType2, Loader2 } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/app/components/ui/dropdown-menu";
import { useToast } from "@/app/contexts/ToastContext";
import type { ExportFormat } from "@/app/lib/articleExport";

interface Props {
  // フォーマットを受け取り、生成～ダウンロードまで行う非同期処理
  onExport: (format: ExportFormat) => Promise<void>;
  disabled?: boolean;
}

const OPTIONS: { format: ExportFormat; label: string; Icon: typeof FileText }[] = [
  { format: "xlsx", label: "Excel (.xlsx)", Icon: FileSpreadsheet },
  { format: "docx", label: "Word (.docx)", Icon: FileText },
  { format: "pdf", label: "PDF (.pdf)", Icon: FileType2 },
];

export function ArticleExportButton({ onExport, disabled }: Props) {
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
        {OPTIONS.map(({ format, label, Icon }) => (
          <DropdownMenuItem key={format} onSelect={() => handle(format)} disabled={busy}>
            <Icon style={{ width: 15, height: 15 }} />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
