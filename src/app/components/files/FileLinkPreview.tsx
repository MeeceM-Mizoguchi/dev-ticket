import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, FileWarning, ExternalLink, File as FileIcon } from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProjectFile } from "@/app/lib/mappers";
import type { ProjectFile } from "@/app/types";
import {
  downloadProjectFile, openProjectFileInApp,
  isGoogleFile, getFileKind, googleFileLabel, googleConvertKind, GOOGLE_APP_LABEL, KIND_COLOR,
} from "@/app/lib/projectFiles";
import { openGoogleFile, DRAWIO_OPEN_HINT, officeOnDriveHint } from "@/app/lib/googleDrive";
import { FileViewerModal } from "./FileViewerModal";
import { FileKindIcon } from "./FileKindIcon";

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
      // 同じ(プロジェクト, フォルダ, ファイル名)の最新版に解決してから開く。
      // 別フォルダには同名の別ファイルがありうるので、フォルダも合わせる。
      const { data: base } = await supabase!.from("project_files")
        .select("*").eq("id", fileId).maybeSingle();
      if (!base) {
        if (!cancelled) setError("ファイルが見つかりません。削除された可能性があります。");
        return;
      }
      // Googleファイルに版は無く、名前は Google 側で自由に変わる。
      // 名前で引き直すと別のファイルを掴みうるので、メンションの行そのものを使う。
      if (base.external_provider === "google") {
        if (!cancelled) setFile(mapProjectFile(base));
        return;
      }
      let versions = supabase!.from("project_files").select("*")
        .eq("project_id", base.project_id).eq("file_name", base.file_name);
      versions = base.parent_id ? versions.eq("parent_id", base.parent_id) : versions.is("parent_id", null);
      const { data: rows } = await versions
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

  // Googleファイルはビューアで描画できない（中身は Drive にあり、storage に実体が無い）。
  // ビューアに渡すと空の画面になるので、Google で開くためのカードを出す。
  //
  // ★ ここで自動的に window.open してはいけない。ファイル情報を取りに行く await を
  //   挟んでいるため、メンションをクリックした操作の有効期間が切れており、
  //   ポップアップブロックで弾かれる。ボタンを押してもらい、その操作で開く。
  // この画面は「開いても直前の画面から離れない」ためのものなので、同じタブで移動もしない。
  if (isGoogleFile(file)) {
    const kind = getFileKind(file.fileName, file.fileType);
    return createPortal(
      <div onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div onClick={e => e.stopPropagation()} role="dialog" aria-label={file.fileName}
          style={{ background: "#fff", borderRadius: 14, padding: 24, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%", maxWidth: 380 }}>
          <FileKindIcon kind={kind} fallback={FileIcon} fallbackColor={KIND_COLOR[kind]} />
          <div style={{ textAlign: "center", minWidth: 0, width: "100%" }}>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={file.fileName}>
              {file.fileName}
            </p>
            <p style={{ margin: "4px 0 0", fontSize: 11.5, color: "#A09790" }}>
              {/* Google形式は「Googleスプレッドシート」、Drive上の Office文書等は
                  「Excel（Googleドライブ）」のように出る。どちらも Drive で開く */}
              {googleFileLabel(file)}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={onClose}
              style={{ padding: "8px 16px", background: "#F4F5F6", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", gap: 5 }}>
              <X style={{ width: 12, height: 12 }} />閉じる
            </button>
            <button autoFocus
              onClick={() => {
                if (!openGoogleFile(file)) { toast("このファイルのURLが見つかりません", "error"); return; }
                // draw.io の図と Office文書は Googleドライブのファイル画面が開くので、
                // そこからの操作を案内する（FileBoxPage の handleOpenGoogle と同じ案内）
                if (kind === "drawio") toast(DRAWIO_OPEN_HINT, "info");
                else {
                  const office = googleConvertKind(file.fileName);
                  if (office) toast(officeOnDriveHint(GOOGLE_APP_LABEL[office]), "info");
                }
                onClose();
              }}
              style={{ padding: "8px 16px", background: "#059669", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#fff", display: "flex", alignItems: "center", gap: 6 }}>
              <ExternalLink style={{ width: 12, height: 12 }} />Googleドライブで開く
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return <FileViewerModal file={file} onClose={onClose}
    onDownload={handleDownload} onOpenInApp={handleOpenInApp} />;
}
