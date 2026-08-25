import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  FolderKanban, ChevronRight, Search, X, Trash2, Upload, Download, Link2,
  File as FileIcon, FileText, FileSpreadsheet, FileImage, Presentation, Loader2,
  Folder, FolderPlus, Plus, Pencil,
} from "lucide-react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { mapProject, mapProjectFile } from "@/app/lib/mappers";
import type { Project, ProjectFile, AccessLevel, UserPermissions } from "@/app/types";
import { emitLinkItemsChanged } from "@/app/lib/linkSuggestSync";
import { FILE_COMMENT_PARAM, FILE_REPLY_PARAM } from "@/app/lib/fileCommentLink";
import { FILE_FOLDER_PARAM } from "@/app/lib/shareLink";
import { useCopyShareLink } from "@/app/hooks/useCopyShareLink";
import { submitOnEnter } from "@/app/lib/submitKey";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { projectAccessView } from "@/app/components/shared/NotFoundView";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { FileViewerModal } from "@/app/components/files/FileViewerModal";
import {
  fetchSignedUrl, fetchDavUrl, uploadProjectFile, deleteProjectFile,
  officeProtocolUrl, getFileKind, formatFileSize, KIND_COLOR, createProjectFolder,
  downloadProjectFile, renameProjectFile, splitFileName,
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

// BRU10-055 読み込み中の表示。
// 素のスピナー1個だとカードの左端に取り残されて見えるので、
// 実際の一覧と同じ骨格（アイコン・ファイル名・メタ情報・操作ボタン）を
// アプリ共通のスケルトン(.skeleton-shimmer)で出す。
function Sk({ w, h, radius }: { w: number | string; h: number; radius?: number }) {
  return <div className="skeleton-shimmer" style={{ width: w, height: h, borderRadius: radius ?? 6, flexShrink: 0 }} />;
}

function FileListSkeleton() {
  const nameW = ["58%", "42%", "66%", "36%", "50%"];
  return (
    <div aria-busy="true" aria-label="ファイルを読み込み中">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 10px" }}>
        <span className="loading-dot" /><span className="loading-dot" /><span className="loading-dot" />
        <span style={{ fontSize: 11, color: "#A09790" }}>ファイルを読み込み中…</span>
      </div>
      {nameW.map((w, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderBottom: "1px solid rgba(26,23,20,0.05)", opacity: 1 - i * 0.15 }}>
          <Sk w={30} h={30} radius={7} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <Sk w={w} h={13} />
            <div style={{ height: 6 }} />
            <Sk w="26%" h={10} />
          </div>
          {/* 実際の操作ボタン(padding:5)と同じ位置に合わせる */}
          {[0, 1, 2, 3].map(k => (
            <span key={k} style={{ padding: 5, display: "flex", flexShrink: 0 }}><Sk w={13} h={13} radius={4} /></span>
          ))}
        </div>
      ))}
    </div>
  );
}

export function FileBoxPage() {
  const { projectSlug } = useParams<{ projectSlug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { userName, userRole, userId, userOrgId } = useAuth();
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
  // コメントのリンクから開かれた時の着地先（BRU12-025）
  const [focusComment, setFocusComment] = useState<{ commentId: string | null; replyId: string | null } | null>(null);

  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // 改名ダイアログはフォルダ・ファイル共用。ファイルのときは拡張子を除いた部分だけを編集する。
  const [renameTarget, setRenameTarget] = useState<ProjectFile | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState<ProjectFile | null>(null);

  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("edit");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("edit");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("edit");
  const [effectiveWhiteboardPerm, setEffectiveWhiteboardPerm] = useState<AccessLevel>("edit");

  const isAdminRole = userRole === "owner" || userRole === "admin";

  const load = useCallback(async () => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
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
      setEffectiveWikiPerm("edit"); setEffectiveBacklogPerm("edit");
      setEffectiveMinutesPerm("edit"); setEffectiveWhiteboardPerm("edit");
    } else {
      const perms = permResult.data?.permissions as Partial<UserPermissions> | null;
      // ここで読むのはサブナビに出す他ページの権限のみ。
      // ファイルボックス自身はプロジェクトメンバーであれば常に利用できる
      setEffectiveWikiPerm((perms?.wikiPermission as AccessLevel | undefined) ?? "none");
      setEffectiveBacklogPerm((perms?.backlogPermission as AccessLevel | undefined) ?? "none");
      setEffectiveMinutesPerm((perms?.minutesPermission as AccessLevel | undefined) ?? "none");
      setEffectiveWhiteboardPerm((perms?.whiteboardPermission as AccessLevel | undefined) ?? "none");
    }
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
  // コメントのリンク(?file=..&comment=..[&reply=..], BRU12-025)なら、その付随情報も
  // ビューアへ渡して該当ピンへ着地させる。
  useEffect(() => {
    const wanted = searchParams.get("file");
    if (!wanted || files.length === 0) return;
    const base = files.find(f => f.id === wanted);
    const newest = base
      ? files.reduce<ProjectFile | null>((best, f) =>
        f.fileName === base.fileName && (!best || f.version > best.version) ? f : best, null)
      : null;
    if (newest) {
      setPreviewTarget(newest);
      setFocusComment({
        commentId: searchParams.get(FILE_COMMENT_PARAM),
        replyId: searchParams.get(FILE_REPLY_PARAM),
      });
    } else toast("リンク先のファイルが見つかりません", "error");
    // 一度開いたらクエリを落とす（閉じた後に再度開いてしまわないように）
    searchParams.delete("file");
    searchParams.delete(FILE_COMMENT_PARAM);
    searchParams.delete(FILE_REPLY_PARAM);
    setSearchParams(searchParams, { replace: true });
  }, [files, searchParams, setSearchParams, toast]);

  // 共有リンク(?folder=...)で開かれたら、そのフォルダを開いた状態にする。
  // パンくずは parent_id を根までたどって組み立てる（手で潜ったときと同じ状態にする）。
  useEffect(() => {
    const wanted = searchParams.get(FILE_FOLDER_PARAM);
    if (!wanted || files.length === 0) return;
    const folder = files.find(f => f.id === wanted && f.isFolder);
    if (folder) {
      const chain: { id: string; name: string }[] = [];
      const seen = new Set<string>();
      let cur: ProjectFile | undefined = folder;
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        chain.unshift({ id: cur.id, name: cur.fileName });
        const parentId: string | null = cur.parentId ?? null;
        cur = parentId ? files.find(f => f.id === parentId && f.isFolder) : undefined;
      }
      setCurrentFolderId(folder.id);
      setBreadcrumbs(chain);
    } else {
      toast("リンク先のフォルダが見つかりません", "error");
    }
    // 一度開いたらクエリを落とす（フォルダを移動しても戻されないように）
    searchParams.delete(FILE_FOLDER_PARAM);
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
  const uploadFiles = useCallback(async (incoming: FileList | File[], targetFolderId?: string | null) => {
    if (!project) return;
    const list = Array.from(incoming);
    if (list.length === 0) return;

    const folderId = targetFolderId !== undefined ? targetFolderId : currentFolderId;

    setUploading(true);
    let ok = 0;
    const renamed: string[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_SIZE) {
        toast(`「${f.name}」は上限(${formatFileSize(MAX_FILE_SIZE)})を超えています`, "error");
        continue;
      }
      try {
        // 同名でも上書き（新バージョン）にせず、別ファイルとして残す
        const stored = await uploadProjectFile(project.id, f, { uniqueName: true, parentId: folderId });
        // API側で parent_id が登録されない場合に備えて、DBを確実に更新
        if (folderId) {
          await supabase!.from("project_files")
            .update({ parent_id: folderId })
            .eq("project_id", project.id)
            .eq("file_name", stored);
        }
        if (stored !== f.name) renamed.push(`「${f.name}」→「${stored}」`);
        ok++;
      } catch (e) {
        console.error("[FileBox] upload error:", e);
        toast(`「${f.name}」のアップロードに失敗しました：${e instanceof Error ? e.message : ""}`, "error");
      }
    }
    setUploading(false);
    if (renamed.length > 0) {
      toast(`同名のファイルがあるため名前を変更しました：${renamed.join("、")}`);
    }
    if (ok > 0) {
      toast(`${ok} 件のファイルをアップロードしました`);
      emitLinkItemsChanged(project.id, "file"); // 他タブの %サジェストへ即時反映
      load();
    }
  }, [project, toast, load, currentFolderId]);

  const handleMoveFile = useCallback(async (file: ProjectFile, targetFolderId: string | null) => {
    if (!project) return;
    if (file.isFolder && file.id === targetFolderId) return;
    try {
      const { error } = await supabase!
        .from("project_files")
        .update({ parent_id: targetFolderId })
        .eq("project_id", project.id)
        .eq("file_name", file.fileName);
      if (error) throw error;
      const targetFolder = files.find(f => f.id === targetFolderId);
      toast(`「${file.fileName}」を「${targetFolder?.fileName ?? "ファイルボックス（ルート）"}」へ移動しました`);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "ファイルの移動に失敗しました", "error");
    }
  }, [project, files, toast, load]);

  const handleCreateFolder = useCallback(async () => {
    if (!project || !newFolderName.trim()) return;
    const inputName = newFolderName.trim();
    setCreatingFolder(true);
    try {
      const createdName = await createProjectFolder(project.id, inputName, currentFolderId, userName);
      if (createdName !== inputName) {
        toast(`同名のフォルダがあるため名前を変更しました：「${inputName}」→「${createdName}」`);
      }
      toast(`フォルダ「${createdName}」を作成しました`);
      setNewFolderName("");
      setShowFolderModal(false);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "フォルダ作成に失敗しました", "error");
    } finally {
      setCreatingFolder(false);
    }
  }, [project, newFolderName, currentFolderId, userName, toast, load]);

  // 改名ダイアログを開く。ファイルは拡張子を触らせないので、編集対象は拡張子を除いた部分だけ。
  const openRename = useCallback((f: ProjectFile) => {
    setRenameTarget(f);
    setRenameName(f.isFolder ? f.fileName : splitFileName(f.fileName).base);
  }, []);

  const handleRename = useCallback(async () => {
    if (!project || !renameTarget || !renameName.trim()) return;
    const isFolder = renameTarget.isFolder;
    const inputName = isFolder ? renameName.trim() : `${renameName.trim()}${splitFileName(renameTarget.fileName).ext}`;
    if (inputName === renameTarget.fileName) { setRenameTarget(null); setRenameName(""); return; }
    setRenaming(true);
    try {
      let finalName: string;
      if (isFolder) {
        // フォルダ名は同じ階層の中だけで重複を避ければよい（版もコメントも持たない）
        const targetParentId = renameTarget.parentId ?? null;
        let query = supabase!
          .from("project_files")
          .select("file_name")
          .eq("project_id", project.id)
          .neq("id", renameTarget.id);

        if (targetParentId === null) {
          query = query.is("parent_id", null);
        } else {
          query = query.eq("parent_id", targetParentId);
        }

        const { data: existingItems } = await query;
        const existingNames = new Set((existingItems ?? []).map(item => item.file_name));

        finalName = inputName;
        if (existingNames.has(finalName)) {
          let counter = 1;
          while (existingNames.has(`${inputName} (${counter})`)) {
            counter++;
          }
          finalName = `${inputName} (${counter})`;
        }

        const { error } = await supabase!
          .from("project_files")
          .update({ file_name: finalName })
          .eq("id", renameTarget.id);
        if (error) throw error;
      } else {
        // ファイル名は版・コメント・WebDAV の引き当てキーなので、
        // 同名の全バージョンとコメントをまとめて付け替えるサーバー側に任せる。
        finalName = await renameProjectFile(renameTarget.id, inputName);
      }

      if (finalName !== inputName) {
        toast(`同名の${isFolder ? "フォルダ" : "ファイル"}があるため名前を変更しました：「${inputName}」→「${finalName}」`);
      }
      toast(`${isFolder ? "フォルダ名" : "ファイル名"}を「${finalName}」に変更しました`);
      setRenameTarget(null);
      setRenameName("");
      if (!isFolder) emitLinkItemsChanged(project.id, "file"); // 他タブの %サジェストへ即時反映
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : `${isFolder ? "フォルダ" : "ファイル"}名の変更に失敗しました`, "error");
    } finally {
      setRenaming(false);
    }
  }, [project, renameTarget, renameName, toast, load]);

  const handleOpenFolder = useCallback((folder: ProjectFile) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.fileName }]);
  }, []);

  const handleNavigateBreadcrumb = useCallback((index: number) => {
    if (index < 0) {
      setCurrentFolderId(null);
      setBreadcrumbs([]);
    } else {
      const target = breadcrumbs[index];
      setCurrentFolderId(target.id);
      setBreadcrumbs(breadcrumbs.slice(0, index + 1));
    }
  }, [breadcrumbs]);

  // ── 各アクション ────────────────────────────────────────────
  const handleDownload = useCallback(async (file: ProjectFile) => {
    try {
      // 🌟 projectFiles.ts のデコード対応ダウンロード関数を呼び出す
      await downloadProjectFile(file.id, file.fileName);
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
  const closePreview = useCallback(() => { setPreviewTarget(null); setFocusComment(null); }, []);
  const closeDelete = useCallback(() => setDeleteTarget(null), []);

  // 共有用リンク。Slack やメールに貼ると、開いた人はそのままプレビュー（フォルダなら
  // そのフォルダを開いた状態）で着地する。
  // （DevTicket内の本文に貼る場合は %メンションの方が画面遷移せず戻れるので推奨）
  const copyShareLink = useCopyShareLink(projectSlug ?? project?.slug);
  const handleCopyLink = useCallback((file: ProjectFile) => {
    void copyShareLink({ kind: file.isFolder ? "file-folder" : "file", id: file.id });
  }, [copyShareLink]);

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

  // 保存や差し替えのたびに版が増えるので、一覧は同名ファイルの最新版だけを見せる。
  // (files は created_at 降順で取得済み。同名なら version が大きい方を残す)
  const latestOnly = files.filter(f =>
    !files.some(o => o.fileName === f.fileName && o.version > f.version));

  const currentLevelItems = search
    ? latestOnly.filter(f => f.fileName.toLowerCase().includes(search.toLowerCase()) || f.uploadedBy.toLowerCase().includes(search.toLowerCase()))
    : latestOnly.filter(f => (f.parentId ?? null) === currentFolderId);

  const visible = currentLevelItems;

  // ── ガード ─────────────────────────────────────────────────
  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      {/* パンくず・見出し・サブナビの並びは他のプロジェクト配下の画面（議事録／ナレッジノート等）と揃える。
          ここだけパンくずが無く、見出しから始まっていたので全体が上にずれていた */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 18, fontSize: 12 }}>
        <button onClick={() => navigate("/projects")}
          style={{ color: "#059669", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <FolderKanban style={{ width: 12, height: 12 }} /> プロジェクト
        </button>
        <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
        <span style={{ color: "#1A1714", fontWeight: 600 }}>{project?.name ?? projectSlug ?? ""}</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>ファイルボックス</h1>
          {/* 読み込み中に「0 件」と出てから件数が入れ替わるのを避ける */}
          <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>
            {!project ? "..." : loading ? project.name : `${project.name} · ${latestOnly.length} 件`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="files" marginBottom={0}
            minutesPerm={effectiveMinutesPerm} wikiPerm={effectiveWikiPerm}
            backlogPerm={effectiveBacklogPerm} whiteboardPerm={effectiveWhiteboardPerm} />
        </div>
      </div>

      <div style={{ background: "#FFFFFF", borderRadius: 14, border: "1px solid rgba(26,23,20,0.07)", padding: 14 }}>
        {/* 検索・フォルダ作成・パンくず */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
          <div style={{ position: "relative", width: 320 }}>
            <Search style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: search ? "#059669" : "#C9C4BB", pointerEvents: "none" }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ファイル名・アップロード者で検索..."
              style={{ width: "100%", boxSizing: "border-box", padding: "7px 28px", fontSize: 12, background: "#F4F5F6", border: `1px solid ${search ? "rgba(5,150,105,0.25)" : "transparent"}`, borderRadius: 8, outline: "none", fontFamily: "inherit" }} />
            {search && (
              <button onClick={() => setSearch("")} style={{ position: "absolute", right: 7, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: 2, color: "#A09790", display: "flex", alignItems: "center" }}>
                <X style={{ width: 11, height: 11 }} />
              </button>
            )}
          </div>
          <button onClick={() => setShowFolderModal(true)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <FolderPlus style={{ width: 14, height: 14 }} /> フォルダ作成
          </button>
        </div>

        {/* パンくずナビゲーション */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12, flexWrap: "wrap" }}>
          <button onClick={() => handleNavigateBreadcrumb(-1)}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              if (draggingFile) { handleMoveFile(draggingFile, null); setDraggingFile(null); }
            }}
            style={{ background: "none", border: "none", cursor: "pointer", color: breadcrumbs.length === 0 ? "#1A1714" : "#059669", fontWeight: breadcrumbs.length === 0 ? 700 : 600, padding: 0, fontSize: 12 }}>
            ファイルボックス
          </button>
          {breadcrumbs.map((b, idx) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
              <button onClick={() => handleNavigateBreadcrumb(idx)}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  if (draggingFile) { handleMoveFile(draggingFile, b.id); setDraggingFile(null); }
                }}
                style={{ background: "none", border: "none", cursor: "pointer", color: idx === breadcrumbs.length - 1 ? "#1A1714" : "#059669", fontWeight: idx === breadcrumbs.length - 1 ? 700 : 600, padding: 0, fontSize: 12 }}>
                {b.name}
              </button>
            </div>
          ))}
        </div>

        {/* アップロード */}
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

        {/* 一覧 */}
        {loading ? (
          <FileListSkeleton />
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
              if (f.isFolder) {
                const isFolderHover = dragOverFolderId === f.id;
                return (
                  <div key={f.id} onClick={() => handleOpenFolder(f)}
                    onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(f.id); }}
                    onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setDragOverFolderId(null); }}
                    onDrop={e => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDragOverFolderId(null);
                      if (e.dataTransfer.files.length > 0) {
                        uploadFiles(e.dataTransfer.files, f.id);
                      } else if (draggingFile) {
                        handleMoveFile(draggingFile, f.id);
                        setDraggingFile(null);
                      }
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 8, cursor: "pointer", borderBottom: "1px solid rgba(26,23,20,0.05)",
                      background: isFolderHover ? "#FEF3C7" : "transparent",
                      outline: isFolderHover ? "2px dashed #D97706" : "none",
                      outlineOffset: -2,
                      transition: "background 0.15s",
                    }}>
                    <span style={{ width: 30, height: 30, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#FEF3C7" }}>
                      <Folder style={{ width: 15, height: 15, color: "#D97706" }} />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.fileName}
                        {isFolderHover && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#D97706" }}>ここへ追加・移動</span>
                        )}
                      </p>
                      <p style={{ margin: "2px 0 0", fontSize: 11, color: "#A09790" }}>
                        フォルダ · {f.uploadedBy || "不明"} · {formatDateTime(f.createdAt)}
                      </p>
                    </div>
                    <button onClick={e => { e.stopPropagation(); handleCopyLink(f); }} title="リンクをコピー"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <Link2 style={{ width: 13, height: 13 }} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); openRename(f); }} title="名前を変更"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <Pencil style={{ width: 13, height: 13 }} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(f); }} title="削除"
                      style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <Trash2 style={{ width: 13, height: 13 }} />
                    </button>
                  </div>
                );
              }

              const kind = getFileKind(f.fileName);
              const Icon = KIND_ICON[kind];
              return (
                <div key={f.id} onClick={() => setPreviewTarget(f)}
                  draggable
                  onDragStart={e => {
                    setDraggingFile(f);
                    e.dataTransfer.setData("text/plain", f.id);
                  }}
                  onDragEnd={() => setDraggingFile(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 8, cursor: "grab", borderBottom: "1px solid rgba(26,23,20,0.05)",
                    opacity: draggingFile?.id === f.id ? 0.4 : 1,
                  }}>
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
                  <button onClick={e => { e.stopPropagation(); handleDownload(f); }} title="ダウンロード"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <Download style={{ width: 13, height: 13 }} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); openRename(f); }} title="名前を変更"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <Pencil style={{ width: 13, height: 13 }} />
                  </button>
                  <button onClick={e => { e.stopPropagation(); setDeleteTarget(f); }} title="削除"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <Trash2 style={{ width: 13, height: 13 }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {previewTarget && (
        <FileViewerModal file={previewTarget} onClose={closePreview}
          onDownload={handleDownload} onOpenInApp={handleOpenInApp}
          focusCommentId={focusComment?.commentId ?? null}
          focusReplyId={focusComment?.replyId ?? null}
          onSaved={() => { load(); if (project) emitLinkItemsChanged(project.id, "file"); }} />
      )}
      {deleteTarget && (
        <ConfirmDialog
          title={deleteTarget.isFolder ? "フォルダを削除" : "ファイルを削除"}
          message={deleteTarget.isFolder
            ? `フォルダ「${deleteTarget.fileName}」を削除します。フォルダ内のフォルダとファイルもすべて削除されます。`
            : deleteTarget.version > 1
              ? `「${deleteTarget.fileName}」を削除します。過去バージョン（v1〜v${deleteTarget.version}）もすべて削除されます。`
              : `「${deleteTarget.fileName}」を削除します。`}
          confirmLabel="削除する"
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={closeDelete}
        />
      )}
      {showFolderModal && (
        <DialogShell title="新規フォルダ作成" onClose={() => setShowFolderModal(false)} size="sm"
          footer={<>
            <button type="button" onClick={() => setShowFolderModal(false)} disabled={creatingFolder}
              style={{ padding: "8px 16px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
              キャンセル
            </button>
            <button type="button" onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}
              style={{ padding: "8px 16px", background: creatingFolder || !newFolderName.trim() ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: creatingFolder || !newFolderName.trim() ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {creatingFolder ? "作成中..." : "作成"}
            </button>
          </>}>
          <div style={{ padding: "8px 0" }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 6 }}>フォルダ名</label>
            <input
              type="text"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="新しいフォルダ名"
              autoFocus
              onKeyDown={submitOnEnter(handleCreateFolder, { enabled: !creatingFolder && !!newFolderName.trim(), onCancel: () => setShowFolderModal(false) })}
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", fontSize: 13, border: "1px solid rgba(26,23,20,0.15)", borderRadius: 8, outline: "none", fontFamily: "inherit" }}
            />
          </div>
        </DialogShell>
      )}
      {renameTarget && (() => {
        // 拡張子はビューアの種別判定・アプリ起動の要なので、入力欄の外に固定表示して触らせない
        const renameExt = renameTarget.isFolder ? "" : splitFileName(renameTarget.fileName).ext;
        const label = renameTarget.isFolder ? "フォルダ名" : "ファイル名";
        const disabled = renaming || !renameName.trim();
        return (
          <DialogShell title={`${label}の変更`} onClose={() => setRenameTarget(null)} size="sm"
            footer={<>
              <button type="button" onClick={() => setRenameTarget(null)} disabled={renaming}
                style={{ padding: "8px 16px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
                キャンセル
              </button>
              <button type="button" onClick={handleRename} disabled={disabled}
                style={{ padding: "8px 16px", background: disabled ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {renaming ? "保存中..." : "保存"}
              </button>
            </>}>
            <div style={{ padding: "8px 0" }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: "#9E9690", display: "block", marginBottom: 6 }}>{label}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="text"
                  value={renameName}
                  onChange={e => setRenameName(e.target.value)}
                  placeholder={`${label}を入力`}
                  autoFocus
                  onKeyDown={submitOnEnter(handleRename, { enabled: !disabled, onCancel: () => setRenameTarget(null) })}
                  style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "8px 12px", fontSize: 13, border: "1px solid rgba(26,23,20,0.15)", borderRadius: 8, outline: "none", fontFamily: "inherit" }}
                />
                {renameExt && (
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#A09790", flexShrink: 0 }}>{renameExt}</span>
                )}
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 11, color: "#B0A9A4", lineHeight: 1.6 }}>
                {renameExt
                  ? `拡張子（${renameExt}）は変更できません。過去バージョンとコメントも一緒に新しい名前へ引き継がれます。`
                  : "フォルダの中身はそのまま引き継がれます。"}
              </p>
            </div>
          </DialogShell>
        );
      })()}
    </div>
  );
}
