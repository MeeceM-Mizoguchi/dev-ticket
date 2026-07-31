import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, FileWarning } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProjectFile } from "@/app/lib/mappers";
import type { ProjectFile } from "@/app/types";
import { downloadProjectFile, openProjectFileInApp } from "@/app/lib/projectFiles";
import { FileViewerModal } from "./FileViewerModal";

// ENHA2-035 %ファイルメンションのプレビュー
// チケット/バックログ/Wiki/議事録の本文からその場で開く。
// 閉じても画面遷移は起こさないので、直前に見ていた画面のまま戻る。

export function FileLinkPreview({ fileId, onClose }: { fileId: string; onClose: () => void }) {
  const [file, setFile] = useState<ProjectFile | null>(null);
  const [error, setError] = useState("");
  const { toast } = useToast();

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    let cancelled = false;
    (async () => {
      // メンションが持つのは挿入時点の行ID。保存のたびに版が増えるため、
      // 同じ(プロジェクト, ファイル名)の最新版に解決してから開く。
      const { data: base } = await supabase!.from("project_files")
        .select("project_id, file_name").eq("id", fileId).maybeSingle();
      if (!base) {
        if (!cancelled) setError("ファイルが見つかりません。削除された可能性があります。");
        return;
      }
      const { data: rows } = await supabase!.from("project_files").select("*")
        .eq("project_id", base.project_id).eq("file_name", base.file_name)
        .order("version", { ascending: false }).limit(1);
      if (cancelled) return;
      if (rows?.[0]) setFile(mapProjectFile(rows[0]));
      else setError("ファイルが見つかりません。削除された可能性があります。");
    })();
    return () => { cancelled = true; };
  }, [fileId]);

  const handleDownload = useCallback(async (f: ProjectFile) => {
    try { await downloadProjectFile(f.id); }
    catch (e) { toast(e instanceof Error ? e.message : "ダウンロードに失敗しました", "error"); }
  }, [toast]);

  const handleOpenInApp = useCallback(async (f: ProjectFile) => {
    try {
      if (!await openProjectFileInApp(f.id, f.fileName)) {
        toast("この形式はアプリで開けません", "error");
        return;
      }
      onClose();
      toast(`「${f.fileName}」をアプリで開いています。保存すると新しいバージョンとして反映されます`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "アプリの起動に失敗しました", "error");
    }
  }, [toast, onClose]);

  if (error) {
    return createPortal(
      <div onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div onClick={e => e.stopPropagation()}
          style={{ background: "#fff", borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, maxWidth: 360 }}>
          <FileWarning style={{ width: 26, height: 26, color: "#D4CEC8" }} />
          <p style={{ margin: 0, fontSize: 12, color: "#6B6458", textAlign: "center" }}>{error}</p>
          <button onClick={onClose}
            style={{ marginTop: 4, padding: "6px 16px", background: "#F4F5F6", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}>
            <X style={{ width: 12, height: 12 }} />閉じる
          </button>
        </div>
      </div>,
      document.body
    );
  }

  if (!file) return null;

  return <FileViewerModal file={file} onClose={onClose}
    onDownload={handleDownload} onOpenInApp={handleOpenInApp} />;
}
