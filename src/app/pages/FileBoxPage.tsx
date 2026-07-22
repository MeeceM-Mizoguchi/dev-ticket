import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router";
import {
  FolderKanban, ChevronRight, Search, X, Trash2, Upload, Download, Link2,
  File as FileIcon, FileText, FileSpreadsheet, FileImage, Presentation, Loader2,
} from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject, mapProjectFile } from "@/app/lib/mappers";
import type { Project, ProjectFile, AccessLevel, UserPermissions } from "@/app/types";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { FileViewerModal } from "@/app/components/files/FileViewerModal";
import {
  fetchSignedUrl, fetchDavUrl, uploadProjectFile, deleteProjectFile,
  officeProtocolUrl, getFileKind, formatFileSize, KIND_COLOR,
} from "@/app/lib/projectFiles";

const MAX_FILE_SIZE = 52428800; // 50MB（バケットの file_size_limit と揃える）

const KIND_ICON = {
  pdf: FileText, excel: FileSpreadsheet, word: FileText,
  powerpoint: Presentation, image: FileImage, text: FileText, other: FileIcon,
} as const;

function formatDateTime(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function FileBoxPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userName, userRole, userId } = useAuth();
  const { toast } = useToast();

  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);
  const [previewTarget, setPreviewTarget] = useState<ProjectFile | null>(null);

  const [effectiveFilesPerm, setEffectiveFilesPerm] = useState<AccessLevel>("edit");
  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("edit");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("edit");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("edit");
  const [effectiveWhiteboardPerm, setEffectiveWhiteboardPerm] = useState<AccessLevel>("edit");
  const [permsLoaded, setPermsLoaded] = useState(false);

  const isAdminRole = userRole === "owner" || userRole === "admin";
  const canEdit = effectiveFilesPerm === "edit";

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    const { data: bySlug } = await supabase!.from("projects").select("*").eq("slug", projectSlug).limit(1);
    const p = bySlug?.[0] ?? (await supabase!.from("projects").select("*").eq("id", projectSlug).maybeSingle()).data;
    if (!p) { setNotFound(true); setLoading(false); return; }
    setProject(mapProject(p));

    const [{ data }, permResult] = await Promise.all([
      supabase!.from("project_files").select("*").eq("project_id", p.id).order("created_at", { ascending: false }),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
    ]);
    setFiles((data ?? []).map(mapProjectFile));

    if (isAdminRole) {
      setEffectiveFilesPerm("edit");
      setEffectiveWikiPerm("edit"); setEffectiveBacklogPerm("edit");
      setEffectiveMinutesPerm("edit"); setEffectiveWhiteboardPerm("edit");
    } else {
      const perms = permResult.data?.permissions as Partial<UserPermissions> | null;
      // filesPermission は後追い追加の項目。未設定のプロジェクトでも使えるよう "edit" にフォールバックする
      // （アクセス自体は下のプロジェクトメンバー判定で絞られる）
      setEffectiveFilesPerm((perms?.filesPermission as AccessLevel | undefined) ?? "edit");
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWhiteboardPerm((perms?.whiteboardPermission as AccessLevel | undefined) ?? "none");
    }
    setPermsLoaded(true);
    setLoading(false);
  }, [projectSlug, userId, isAdminRole]);

  useEffect(() => { load(); }, [load]);

  // アプリ側(Excel/Word)での保存はブラウザの外で起きるため、この画面は気づけない。
  // タブに戻ってきたタイミングで一覧を取り直し、新しいバージョンを反映する。
  useEffect(() => {
    const refresh = () => { if (!document.hidden) load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  // 共有リンク(?file=...)で開かれたら、そのファイルのプレビューを直接開く。
  // URLに残った版が古くても、同名の最新版に読み替える。
  useEffect(() => {
    const wanted = searchParams.get("file");
    if (!wanted || files.length === 0) return;
    const base = files.find(f => f.id === wanted);
    const newest = base
      ? files.reduce<ProjectFile | null>((best, f) =>
          f.fileName === base.fileName && (!best || f.version > best.version) ? f : best, null)
      : null;
    if (newest) setPreviewTarget(newest);
    else toast("リンク先のファイルが見つかりません", "error");
    // 一度開いたらクエリを落とす（閉じた後に再度開いてしまわないように）
    searchParams.delete("file");
    setSearchParams(searchParams, { replace: true });
  }, [files, searchParams, setSearchParams, toast]);

  // ビューアを開いたまま保存された場合、表示中の行は古い版のままになる。
  // 一覧が更新されたら、同じファイルの最新版へ差し替える。
  useEffect(() => {
    if (!previewTarget) return;
    const newest = files.reduce<ProjectFile | null>((best, f) =>
      f.fileName === previewTarget.fileName && (!best || f.version > best.version) ? f : best, null);
    if (newest && newest.id !== previewTarget.id) setPreviewTarget(newest);
  }, [files, previewTarget]);

  // ── アップロード ────────────────────────────────────────────
  // 保存キーの採番・DB登録・版番号はすべてサーバー(api/project-files)側で行う。
  // ブラウザは署名付きアップロードURLへ直接送るだけなので storage のRLS設定が不要。
  const uploadFiles = useCallback(async (incoming: FileList | File[]) => {
    if (!project || !canEdit) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;

    setUploading(true);
    let ok = 0;
    for (const f of list) {
      if (f.size > MAX_FILE_SIZE) {
        toast(`「${f.name}」は上限(${formatFileSize(MAX_FILE_SIZE)})を超えています`, "error");
        continue;
      }
      try {
        await uploadProjectFile(project.id, f);
        ok++;
      } catch (e) {
        console.error("[FileBox] upload error:", e);
        toast(`「${f.name}」のアップロードに失敗しました：${e instanceof Error ? e.message : ""}`, "error");
      }
    }
    setUploading(false);
    if (ok > 0) {
      toast(`${ok} 件のファイルをアップロードしました`);
      emitLinkItemsChanged(project.id, "file"); // 他タブの %サジェストへ即時反映
      load();
    }
  }, [project, canEdit, toast, load]);

  // ── 各アクション ────────────────────────────────────────────
  const handleDownload = useCallback(async (file: ProjectFile) => {
    try {
      const url = await fetchSignedUrl(file.id, "download");
      // download 指定の署名付きURLなので、遷移すると元のファイル名で保存される
      window.location.href = url;
    } catch (e) {
      toast(e instanceof Error ? e.message : "ダウンロードに失敗しました", "error");
    }
  }, [toast]);

  const handleOpenInApp = useCallback(async (file: ProjectFile) => {
    try {
      // WebDAV URL で開くと Office 側の Ctrl+S がそのまま DevTicket に反映される。
      // (署名付きURLは読み取り専用なので、そちらで開くと「読み取り専用」になってしまう)
      const url = await fetchDavUrl(file.id);
      const proto = officeProtocolUrl(file.fileName, url);
      if (!proto) { toast("この形式はアプリで開けません", "error"); return; }
      window.location.href = proto;
      // アプリに処理が移るので、ビューアは閉じて一覧へ戻す
      setPreviewTarget(null);
      toast(`「${file.fileName}」をアプリで開いています。保存すると新しいバージョンとして反映されます`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "アプリの起動に失敗しました", "error");
    }
  }, [toast]);

  // モーダルの onClose は escStack に積まれるため、毎レンダーで作り直さないよう固定する
  const closePreview = useCallback(() => setPreviewTarget(null), []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  // 共有用リンク。Slack やメールに貼ると、開いた人はそのままプレビューが立ち上がる。
  // （DevTicket内の本文に貼る場合は %メンションの方が画面遷移せず戻れるので推奨）
  const handleCopyLink = useCallback(async (file: ProjectFile) => {
    const slug = projectSlug ?? project?.slug ?? "";
    const url = `${window.location.origin}/${slug}/files?file=${encodeURIComponent(file.id)}`;
    if (await copyText(url)) toast("リンクをコピーしました");
    else toast("リンクのコピーに失敗しました", "error");
  }, [projectSlug, project, toast]);

  const handleDelete = useCallback(async (file: ProjectFile) => {
    setDeleteTarget(null);
    try {
      await deleteProjectFile(file.id);
    } catch (e) {
      toast(e instanceof Error ? e.message : "削除に失敗しました", "error");
      return;
    }
    toast(`「${file.fileName}」を削除しました`);
    // サーバー側は同名の全バージョンを消すので、画面側も同じ粒度で消す
    setFiles(prev => prev.filter(f => f.fileName !== file.fileName));
    emitLinkItemsChanged(file.projectId, "file");
  }, [toast]);

  // ── ガード ─────────────────────────────────────────────────
  if (!loading && (notFound || !project)) return <Navigate to="/projects" replace />;
  if (!loading && project && userRole !== "owner" && !(project.members ?? []).includes(userName)) return <Navigate to="/projects" replace />;
  if (!loading && effectiveFilesPerm === "none") return <Navigate to="/dashboard" replace />;

  // 保存や差し替えのたびに版が増えるので、一覧は同名ファイルの最新版だけを見せる。
  // (files は created_at 降順で取得済み。同名なら version が大きい方を残す)
  const latestOnly = files.filter(f =>
    !files.some(o => o.fileName === f.fileName && o.version > f.version));

  const visible = search
    ? latestOnly.filter(f => f.fileName.toLowerCase().includes(search.toLowerCase()) || f.uploadedBy.toLowerCase().includes(search.toLowerCase()))
    : latestOnly;

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")} style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>ファイルボックス</h1>
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>{project ? `${project.name} · ${files.length} 件` : "..."}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {permsLoaded && effectiveFilesPerm === "view" && (
            <span style={{ fontSize: 11, fontWeight: 600, padding: "4px 10px", background: "#FEF3C7", color: "#92400E", borderRadius: 20, border: "1px solid rgba(217,119,6,0.25)" }}>閲覧のみ</span>
          )}
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="files" marginBottom={0}
            filesPerm={effectiveFilesPerm} minutesPerm={effectiveMinutesPerm} wikiPerm={effectiveWikiPerm}
            backlogPerm={effectiveBacklogPerm} whiteboardPerm={effectiveWhiteboardPerm} />
        </div>
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 14 }}>
        {/* 検索 */}
        <div style={{ position: "relative", marginBottom: 12, maxWidth: 320 }}>
          <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: search ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ファイル名・アップロード者で検索..."
            style={{ width: "100%", boxSizing: "border-box", padding: "7px 28px", fontSize: 12, background: "#F4F5F6", border: `1px solid ${search ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
          {search && (
            <button onClick={() => setSearch("")} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex", alignItems: "center" }}>
              <X style={{ width: 11, height: 11 }} />
            </button>
          )}
        </div>

        {/* アップロード */}
        {canEdit && (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
            onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files); }}
            style={{ marginBottom: 14 }}>
            <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px 12px", border: `1.5px dashed ${dragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.12)"}`, borderRadius: 10, cursor: uploading ? "wait" : "pointer", background: dragOver ? "rgba(5,150,105,0.04)" : "#FAFAF8", transition: "border-color 0.15s, background 0.15s" }}>
              {uploading
                ? <Loader2 style={{ width: 14, height: 14, color: "#059669", animation: "spin 1s linear infinite" }} />
                : <Upload style={{ width: 14, height: 14, color: dragOver ? "#059669" : "#B0A9A4" }} />}
              <span style={{ fontSize: 12, color: dragOver || uploading ? "#059669" : "#B0A9A4" }}>
                {uploading ? "アップロード中..." : dragOver ? "ドロップして追加" : `クリックしてファイルを追加、またはドラッグ&ドロップ（1ファイル ${formatFileSize(MAX_FILE_SIZE)} まで）`}
              </span>
              <input type="file" multiple disabled={uploading} style={{ display: "none" }}
                onChange={e => { uploadFiles(e.target.files || []); e.target.value = ""; }} />
            </label>
          </div>
        )}

        {/* 一覧 */}
        {loading ? (
          <div style={{ padding: "50px 0", textAlign: "center" }}>
            <Loader2 style={{ width: 22, height: 22, color: "#D4CEC8", animation: "spin 1s linear infinite" }} />
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "50px 0", textAlign: "center" }}>
            <FileIcon style={{ width: 30, height: 30, color: "#D4CEC8", margin: "0 auto 10px" }} />
            <p style={{ fontSize: 12, color: "#B0A9A4", margin: 0 }}>
              {search ? `「${search}」に一致するファイルがありません` : "ファイルがありません"}
            </p>
          </div>
        ) : (
          <div>
            {visible.map(f => {
              const kind = getFileKind(f.fileName);
              const Icon = KIND_ICON[kind];
              return (
                <div key={f.id} onClick={() => setPreviewTarget(f)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                  <span style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: `${KIND_COLOR[kind]}14` }}>
                    <Icon style={{ width: 14, height: 14, color: KIND_COLOR[kind] }} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.fileName}
                      {f.version > 1 && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "#EEF2FF", color: "#4F46E5" }}>v{f.version}</span>
                      )}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#A09790" }}>
                      {formatFileSize(f.fileSize)} · {f.uploadedBy || "不明"} · {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleCopyLink(f); }} title="リンクをコピー"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <Link2 style={{ width: 13, height: 13 }} />
                  </button>
                  {/* ダウンロードは閲覧のみの権限でも使えるようにする */}
                  <button onClick={e => { e.stopPropagation(); handleDownload(f); }} title="ダウンロード"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <Download style={{ width: 13, height: 13 }} />
                  </button>
                  {canEdit && (
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(f); }} title="削除"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <Trash2 style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewTarget && (
        <FileViewerModal file={previewTarget} onClose={closePreview}
          onDownload={handleDownload} onOpenInApp={handleOpenInApp} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title="ファイルを削除"
          message={deleteTarget.version > 1
            ? `「${deleteTarget.fileName}」を削除します。過去バージョン（v1〜v${deleteTarget.version}）もすべて削除されます。`
            : `「${deleteTarget.fileName}」を削除します。`}
          confirmLabel="削除する"
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={closeDelete}
        />
      )}
    </div>
  );
}
