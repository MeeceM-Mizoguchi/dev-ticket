import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import {
  FolderKanban, ChevronRight, Search, X, Trash2, Upload, Download, Link2,
  File as FileIcon, FileText, FileSpreadsheet, FileImage, Presentation, Loader2,
  Folder, FolderPlus, FolderUp, Plus, Pencil, Globe, Workflow,
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
import { findProjectBySlug } from "@/app/lib/projectResolve";
import { useCanonicalSlugRedirect } from "@/app/hooks/useCanonicalSlugRedirect";
import { submitOnEnter } from "@/app/lib/submitKey";
import { ProjectSubNav } from "@/app/components/layout/ProjectSubNav";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { projectAccessView } from "@/app/components/shared/NotFoundView";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { FileViewerModal } from "@/app/components/files/FileViewerModal";
import {
  fetchSignedUrl, fetchDavUrl, uploadProjectFile, deleteProjectFile,
  officeProtocolUrl, getFileKind, formatFileSize, KIND_COLOR, createProjectFolder,
  downloadProjectFile, renameProjectFile, splitFileName, ensureFolderPath,
  isGoogleFile, googleFileLabel, googleConvertKind, googleExportUrl,
  isEditableInBrowser, GOOGLE_APP_LABEL, OFFICE_APP_LABEL, type GoogleAppKind,
} from "@/app/lib/projectFiles";
import {
  openGoogleFile, renameGoogleFile, setGoogleLinkShare, uploadAsGoogleFile, syncGoogleNames,
  convertExistingFile, startGoogleOAuth, DRAWIO_OPEN_HINT, officeOnDriveHint, trashGoogleFiles,
  type GoogleDriveProjectConfig, type GoogleDriveMode, type TrashResult,
} from "@/app/lib/googleDrive";
import { GoogleAppsButton } from "@/app/components/files/GoogleAppsButton";
import { FileKindIcon } from "@/app/components/files/FileKindIcon";
import { BlockingSpinner } from "@/app/components/shared/BlockingSpinner";
import { GoogleGLogo } from "@/app/components/files/GoogleGLogo";
import { openPendingTab } from "@/app/lib/pendingTab";
import {
  collectDropEntries, collectInputEntries, looksLikeFolder,
  MAX_UPLOAD_ENTRIES, type UploadEntry,
} from "@/app/lib/folderUpload";

const MAX_FILE_SIZE = 52428800; // 50MB（バケットの file_size_limit と揃える）
// タブ復帰での Drive 同期を間引く間隔。
// タブを往復するだけの操作で毎回サーバーレス関数を起こさないため。
// Google 側で名前を変える操作はどう急いでもこれより時間がかかるので、取りこぼさない。
// 画面遷移・リロードのときは間引かず必ず同期する。
const DRIVE_SYNC_MIN_INTERVAL_MS = 10_000;
// パンくずのドロップ先を表すキー。ルートは folderId が null なので代わりにこれを使う
const ROOT_CRUMB = "__root__";
const TOO_MANY_MSG =`一度に扱えるのは ${MAX_UPLOAD_ENTRIES} 件までです。先頭の ${MAX_UPLOAD_ENTRIES} 件だけ取り込みます`;

// 何十件も並べるとトーストが画面を埋めるので、先頭数件だけ出して残りは件数で伝える
function summarize(items: string[], head = 3): string {
  return items.length <= head
    ? items.join("、")
    : `${items.slice(0, head).join("、")} ほか ${items.length - head} 件`;
}

/**
 * フォルダ配下（入れ子のフォルダの中まで）の行を集める。
 * 削除の確認ダイアログの件数と、削除後の一覧の整理に使う。
 * （サーバー側はフォルダの行を1つ消せば子孫もDBのカスケードで消えるが、
 *   画面側の files にはその子孫が残るため、ここで同じ範囲を割り出す）
 */
function collectDescendants(files: ProjectFile[], folderId: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const visited = new Set<string>();
  const stack = [folderId];
  while (stack.length) {
    const current = stack.pop() as string;
    if (visited.has(current)) continue; // 万一 parentId が循環していても止まる
    visited.add(current);
    for (const f of files) {
      if ((f.parentId ?? null) !== current) continue;
      out.push(f);
      if (f.isFolder) stack.push(f.id);
    }
  }
  return out;
}

const KIND_ICON = {
  pdf: FileText, excel: FileSpreadsheet, word: FileText,
  powerpoint: Presentation, image: FileImage, text: FileText, other: FileIcon,
  // Googleドライブ上のファイル（別タブで開く）
  gsheet: FileSpreadsheet, gdoc: FileText, gslide: Presentation, drawio: Workflow,
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
  // 旧識別子(project_slug_aliases)で着地したときの現行slug。URLを正へ寄せるためだけに使う
  const [aliasCanonicalSlug, setAliasCanonicalSlug] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Google形式に変換してアップロードしている間だけ true（画面中央のぐるぐる用）
  const [convertingUpload, setConvertingUpload] = useState(false);
  // BUG-05 送信ガード。state はボタンの見た目用で、二重起動を止めるのはこの ref
  const uploadingRef = useRef(false);
  // フォルダを丸ごと上げると時間がかかるので、何件目かを出す
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);
  // 削除のとき Googleドライブ上の実体もゴミ箱へ入れるか。
  // 既定は false（＝Drive には残す）。取り込んだファイルが利用者の原本のことがあり、
  // 既定で消すと巻き添えになるため、毎回この画面で選んでもらう。
  const [deleteFromDrive, setDeleteFromDrive] = useState(false);
  // BUG-05 削除も await を含むので ref で二重起動を止める
  const deletingRef = useRef(false);
  const [previewTarget, setPreviewTarget] = useState<ProjectFile | null>(null);
  // コメントのリンクから開かれた時の着地先（BRU12-025）
  const [focusComment, setFocusComment] = useState<{ commentId: string | null; replyId: string | null } | null>(null);

  // 開いているフォルダは URL(?folder=<id>) が持つ。state に持たせると履歴に残らず、
  // ブラウザの戻る/進むで階層を行き来できないため、URL を唯一の出どころにする。
  // 共有リンク(shareLink の "file-folder")と同じパラメータなので、
  // 深い階層のURLをそのまま人に渡せる。
  // 空文字は「指定なし＝ルート」に寄せる（手書きの ?folder= で空一覧にしない）
  const currentFolderId = searchParams.get(FILE_FOLDER_PARAM) || null;
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // 改名ダイアログはフォルダ・ファイル共用。ファイルのときは拡張子を除いた部分だけを編集する。
  const [renameTarget, setRenameTarget] = useState<ProjectFile | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renaming, setRenaming] = useState(false);

  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [draggingFile, setDraggingFile] = useState<ProjectFile | null>(null);
  // パンくずのどれにドラッグ中か。ルート（ファイルボックス）は ROOT_CRUMB で表す
  const [dragOverCrumb, setDragOverCrumb] = useState<string | null>(null);

  // Googleドライブ連携の設定。null なら「Googleアプリ」ボタンを出さない。
  // 一覧と同じ read で取るので、ボタンだけ遅れて出ることがない（load() 参照）。
  const [googleDrive, setGoogleDrive] = useState<GoogleDriveProjectConfig | null>(null);

  // Drive 上に見つからなかった Googleファイル（project_files の id）。
  // 行は消さず、一覧に「Driveで削除済み」と出して気づけるようにする。
  const [missingGoogleIds, setMissingGoogleIds] = useState<Set<string>>(new Set());

  // Office文書を入れられたときの「そのまま / Google形式に変換」の確認待ち
  const [convertPrompt, setConvertPrompt] = useState<
    { entries: UploadEntry[]; targetFolderId?: string | null; names: string[] } | null>(null);
  // どちらが適切かは利用者の用途次第なので、推奨も初期選択も置かない。
  // 未選択(null)の間は保存ボタンを押せないようにして、必ず自分で選ばせる。
  // （どちらかを初期選択にすると、それ自体が暗黙の推奨になる。変換は元に戻せないので、
  //   うっかり既定のまま進めてしまう形も避けたい）
  const [convertChoice, setConvertChoice] = useState<"keep" | "convert" | null>(null);

  const [effectiveWikiPerm, setEffectiveWikiPerm] = useState<AccessLevel>("edit");
  const [effectiveBacklogPerm, setEffectiveBacklogPerm] = useState<AccessLevel>("edit");
  const [effectiveMinutesPerm, setEffectiveMinutesPerm] = useState<AccessLevel>("edit");
  const [effectiveWhiteboardPerm, setEffectiveWhiteboardPerm] = useState<AccessLevel>("edit");

  const isAdminRole = userRole === "owner" || userRole === "admin";

  // ── Drive 側の変更の取り込み ─────────────────────────────
  // Google の画面で名前を変えても DevTicket は気づけないので、こちらから取りに行く。
  // （設計書 9.1 のとおり、同期は DevTicket → Google の一方通行のままで、
  //   名前と存在だけをこの経路で拾う。フォルダ移動は追わない）
  const lastDriveSyncRef = useRef(0);
  const syncFromDrive = useCallback(async (projectId: string, force: boolean) => {
    if (!force && Date.now() - lastDriveSyncRef.current < DRIVE_SYNC_MIN_INTERVAL_MS) return;
    lastDriveSyncRef.current = Date.now();
    try {
      const res = await syncGoogleNames(projectId);
      if (res.skipped) return;
      setMissingGoogleIds(new Set(res.missing));
      if (res.renamed.length === 0) return;

      // BUG-02/03 変わったときだけ引き直す。loading は触らない（スピナーへ戻さない）
      const { data } = await supabase!.from("project_files")
        .select("*").eq("project_id", projectId).order("created_at", { ascending: false });
      if (data) setFiles(data.map(mapProjectFile));
      toast(`Googleドライブ側の名前の変更を取り込みました：${summarize(res.renamed.map(r => `「${r.before}」→「${r.after}」`))}`);
    } catch (e) {
      // 取り込めなくてもファイルボックス自体は使えるので、画面は止めない
      console.warn("[FileBox] Drive の変更を取り込めませんでした", e);
    }
  }, [toast]);

  /**
   * @param forceDriveSync Drive 側の変更の取り込みを間引かずに行う。
   *   画面遷移・リロードのときは true。タブ復帰のときは false（短時間の往復で叩かない）。
   */
  const load = useCallback(async (forceDriveSync = false) => {
    if (!isSupabaseEnabled || !projectSlug) { setLoading(false); return; }
    // 404画面はリダイレクトせずその場に留まるので、別PJへ移ったときに前回の判定を
    // 引きずらないよう毎回クリアしてから引き直す。
    setNotFound(false);
    const found = await findProjectBySlug(projectSlug);
    if (!found) { setNotFound(true); setLoading(false); return; }
    const p = found.row;
    setAliasCanonicalSlug(found.viaAlias ? found.canonicalSlug : null);
    setProject(mapProject(p));

    // Googleドライブ連携の設定も、一覧と同じこの束で取る。
    // 別の useEffect で project.id を待ってから取りに行くと
    // 「プロジェクト解決 → 一覧取得 → 連携状態」と往復が数珠つなぎになり、
    // 一覧が描かれてから「Googleアプリ」ボタンだけ遅れて生えてくる（BUG-04 と同じ）。
    // 組織はプロジェクトの所属で引く（owner が他組織のPJを開いたときも正しくなる）。
    const [{ data }, permResult, orgResult] = await Promise.all([
      supabase!.from("project_files").select("*").eq("project_id", p.id).order("created_at", { ascending: false }),
      isAdminRole ? Promise.resolve({ data: null }) :
        supabase!.from("project_member_permissions").select("permissions").eq("project_id", p.id).eq("member_id", userId).maybeSingle(),
      p.organization_id
        ? supabase!.from("organizations")
          .select("google_drive_mode, google_shared_drive_name").eq("id", p.organization_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    setFiles((data ?? []).map(mapProjectFile));

    // 読めなかったとき(null)は連携なしに倒す。ボタンを出してから消すとチラつくため。
    const driveMode = (orgResult.data?.google_drive_mode ?? "off") as GoogleDriveMode;
    setGoogleDrive(driveMode === "off" ? null : {
      mode: driveMode,
      folderName: orgResult.data?.google_shared_drive_name ?? null,
    });

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

    // Googleファイルが1件も無ければ問い合わせる意味が無いので、そこで打ち切る。
    // await しないのは、Drive への往復で一覧の描画を待たせないため。
    if ((data ?? []).some(r => r.external_provider === "google")) {
      void syncFromDrive(p.id, forceDriveSync);
    }
  }, [projectSlug, userId, isAdminRole, syncFromDrive]);

  // 画面遷移・リロードのときは間引かずに同期する（タブ復帰だけ間引く）
  useEffect(() => { load(true); }, [load]);

  // 旧識別子で来たURLを現行のものへ置き換える（配布済みリンクの受け皿）
  useCanonicalSlugRedirect(projectSlug, aliasCanonicalSlug);

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
    if (newest && isGoogleFile(newest)) {
      // Googleファイルはビューアを持たない。共有リンクで来たら、そのタブのまま Google へ送る。
      //
      // ★ window.open（別タブ）を使ってはいけない。ここはページ読み込み後の処理で、
      //   クリック直後ではないため、ポップアップブロックで黙って弾かれる
      //   （noopener 付きだと成否に関係なく null が返るので、失敗にも気づけない）。
      //   結果、一覧だけが表示されて「リンクが壊れている」ように見えていた。
      //   同じタブの移動はブロックされないので、そちらで送る。
      //
      // ★ href ではなく replace で移動する。href だと履歴に ?file= 付きの一覧が残り、
      //   「戻る」でここへ戻る → また Google へ送られる、を繰り返して抜けられなくなる。
      if (newest.externalUrl) {
        window.location.replace(newest.externalUrl);
        return;
      }
      toast("このファイルのURLが見つかりません", "error");
    } else if (newest) {
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

  /**
   * 開くフォルダを URL に反映する。既定では履歴に積むので、
   * ブラウザの戻る/進むでそのまま階層を行き来できる。
   * @param replace 履歴に積まずに置き換える（不正なURLの後始末など、
   *   「戻る」で壊れた状態に戻ってほしくないとき）
   */
  const goToFolder = useCallback((folderId: string | null, replace = false) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (folderId) next.set(FILE_FOLDER_PARAM, folderId);
      else next.delete(FILE_FOLDER_PARAM);
      return next;
    }, { replace });
  }, [setSearchParams]);

  // パンくずは parent_id を根までたどって毎回組み立てる。
  // state に積まないので、URLでいきなり深い階層へ来ても・戻る/進むで飛んでも・
  // 途中のフォルダ名が変わっても、表示が実体とズレない。
  const breadcrumbs = useMemo(() => {
    if (!currentFolderId) return [];
    const chain: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    let cur: ProjectFile | undefined = files.find(f => f.id === currentFolderId && f.isFolder);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift({ id: cur.id, name: cur.fileName });
      const parentId: string | null = cur.parentId ?? null;
      cur = parentId ? files.find(f => f.id === parentId && f.isFolder) : undefined;
    }
    return chain;
  }, [files, currentFolderId]);

  // URL のフォルダが実在しないとき（消された・別プロジェクトのリンク）はルートへ戻す。
  // 読み込みが終わるまでは判定しない（読み込み中は「無い」ように見えるため）。
  useEffect(() => {
    if (!currentFolderId || loading || notFound) return;
    if (files.some(f => f.id === currentFolderId && f.isFolder)) return;
    toast("リンク先のフォルダが見つかりません", "error");
    goToFolder(null, true);
  }, [currentFolderId, files, loading, notFound, toast, goToFolder]);

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
  //
  // 受け取るのは File ではなく UploadEntry（＝ファイル＋元の所属フォルダ）。
  // フォルダをドロップされたら、同じ階層をファイルボックス側にも作ってから入れる。
  // フォルダ自身を File として送ると net::ERR_ACCESS_DENIED になるため、
  // 展開は必ず folderUpload.ts 側で済ませておくこと。
  // @param convert Office文書をGoogle形式へ変換して取り込む（アップロード前に選ばせる）。
  //   変換すると元の .xlsx 等は DevTicket に残らないため、既定では false。
  const uploadEntries = useCallback(async (
    entries: UploadEntry[], targetFolderId?: string | null, convert = false,
  ) => {
    if (!project || entries.length === 0) return;
    // BUG-05 連続でドロップされても2本同時に走らせない。
    // フォルダは1回が長いので、state だけだと確実にすり抜ける。
    if (uploadingRef.current) {
      toast("アップロード中です。完了してからもう一度お試しください", "error");
      return;
    }
    uploadingRef.current = true;

    const folderId = targetFolderId !== undefined ? targetFolderId : currentFolderId;

    setUploading(true);
    setUploadProgress({ done: 0, total: entries.length });
    // Google形式への変換は Drive との往復があり数秒以上かかるので、大きなぐるぐるを出す
    setConvertingUpload(convert && entries.some(e => googleConvertKind(e.file.name)));
    // 同じ階層を何度も引き直さないよう、1回のアップロード内で使い回す
    const folderCache = new Map<string, string>();
    let ok = 0;
    const renamed: string[] = [];
    const failed: string[] = [];
    // Google形式で取り込んだときに、権限を配れなかったメンバー
    const shareFailed: string[] = [];
    // Google形式への変換に失敗し、「そのまま保存」に切り替えたファイル
    const fellBack: string[] = [];
    try {
      for (let i = 0; i < entries.length; i++) {
        const { file: f, dirPath } = entries[i];
        setUploadProgress({ done: i, total: entries.length });
        if (f.size > MAX_FILE_SIZE) {
          failed.push(`「${f.name}」は上限(${formatFileSize(MAX_FILE_SIZE)})を超えています`);
          continue;
        }
        try {
          const parentId = dirPath.length > 0
            ? await ensureFolderPath(project.id, dirPath, folderId, userName, folderCache)
            : folderId;

          // Google形式へ変換して取り込む。対象外の拡張子はそのまま storage へ入れる
          // （画像やPDFを混ぜてドロップされても、そちらは従来どおり動く）。
          const convertKind = convert ? googleConvertKind(f.name) : null;
          if (convertKind) {
            const g = await uploadAsGoogleFile(project.id, f, convertKind, parentId);
            if (!g.converted) {
              // 変換できなかったが、ファイル自体は「そのまま」で保存できている
              fellBack.push(`「${f.name}」（${g.reason}）`);
              if (g.fileName !== f.name) renamed.push(`「${f.name}」→「${g.fileName}」`);
              ok++;
              continue;
            }
            if (g.fileName !== splitFileName(f.name).base) {
              renamed.push(`「${f.name}」→「${g.fileName}」`);
            }
            for (const x of g.failed) shareFailed.push(`${g.fileName} / ${x.name}`);
            ok++;
            continue;
          }

          // 同名でも上書き（新バージョン）にせず、別ファイルとして残す
          const stored = await uploadProjectFile(project.id, f, { uniqueName: true, parentId });
          if (stored !== f.name) renamed.push(`「${f.name}」→「${stored}」`);
          ok++;
        } catch (e) {
          console.error("[FileBox] upload error:", e);
          const reason = e instanceof Error ? e.message : "";
          // 展開に対応していないブラウザでフォルダ自身を拾ってしまったときの説明
          const hint = looksLikeFolder(f)
            ? "（フォルダの中身を読み取れませんでした。中のファイルを選んでください）" : "";
          failed.push(`「${f.name}」${reason ? `：${reason}` : ""}${hint}`);
        }
      }
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      setUploadProgress(null);
      setConvertingUpload(false);
    }

    // 件数が多いフォルダでもトーストが溢れないよう、結果はまとめて出す
    if (renamed.length > 0) {
      toast(`同名のファイルがあるため名前を変更しました：${summarize(renamed)}`);
    }
    if (failed.length > 0) {
      toast(`${failed.length} 件のアップロードに失敗しました：${summarize(failed)}`, "error");
    }
    if (shareFailed.length > 0) {
      toast(`Googleファイルを共有できなかった相手がいます：${summarize(shareFailed)}。Googleアカウントをお持ちか確認してください`, "error");
    }
    if (fellBack.length > 0) {
      toast(`Google形式に変換できなかったため、そのまま保存しました：${summarize(fellBack)}`, "error");
    }
    if (ok > 0) {
      toast(`${ok} 件のファイルをアップロードしました`);
      emitLinkItemsChanged(project.id, "file"); // 他タブの %サジェストへ即時反映
      load();
    }
  }, [project, toast, load, currentFolderId, userName]);

  /**
   * 取り込み方を選ばせてからアップロードする。
   * Office文書が混ざっていて、かつ組織がGoogle連携を有効にしているときだけ確認を挟む。
   * フォルダごとのアップロードは件数が多く、1件ずつ判断させる意味が薄いので対象外。
   */
  const startUpload = useCallback((entries: UploadEntry[], targetFolderId?: string | null) => {
    if (entries.length === 0) return;
    const isFolderUpload = entries.some(e => e.dirPath.length > 0);
    const convertible = entries.filter(e => googleConvertKind(e.file.name));
    if (googleDrive && !isFolderUpload && convertible.length > 0) {
      // 前回の選択を引きずらず、毎回まっさらな状態から選ばせる
      setConvertChoice(null);
      setConvertPrompt({ entries, targetFolderId, names: convertible.map(e => e.file.name) });
      return;
    }
    uploadEntries(entries, targetFolderId);
  }, [googleDrive, uploadEntries]);

  /** <input type="file"> から。フォルダ選択(webkitdirectory)なら階層も引き継がれる */
  const uploadFiles = useCallback((incoming: FileList | File[], targetFolderId?: string | null) => {
    const entries = collectInputEntries(incoming);
    if (entries.length >= MAX_UPLOAD_ENTRIES) toast(TOO_MANY_MSG, "error");
    startUpload(entries, targetFolderId);
  }, [startUpload, toast]);

  /**
   * ドロップされたものを取り込む。
   * DataTransfer はイベントを抜けると空になるため、collectDropEntries は
   * await を挟まずここで同期的に呼ぶこと（folderUpload.ts の先頭コメント参照）。
   */
  const handleDropUpload = useCallback((e: DragEvent<HTMLElement>, targetFolderId?: string | null) => {
    collectDropEntries(e.dataTransfer).then(entries => {
      if (entries.length === 0) return;
      if (entries.length >= MAX_UPLOAD_ENTRIES) toast(TOO_MANY_MSG, "error");
      startUpload(entries, targetFolderId);
    }).catch(err => {
      console.error("[FileBox] drop read error:", err);
      toast("ドロップされたフォルダを読み取れませんでした", "error");
    });
  }, [startUpload, toast]);

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

        // Drive 側の名前も合わせる。片方だけ変わると、DevTicketとDriveで
        // 同じファイルが別名に見えて追えなくなる。
        // (api/ 配下のルートファイル同士は import し合わない方針のため2回に分けて呼ぶ)
        if (isGoogleFile(renameTarget)) {
          try {
            await renameGoogleFile(renameTarget.id, finalName);
          } catch (e) {
            // DevTicket側は既に変わっている。ここで失敗しても巻き戻さず、ズレたことだけ伝える
            console.error("[FileBox] google rename failed:", e);
            toast("Googleドライブ側の名前は変更できませんでした", "error");
          }
        }
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
    goToFolder(folder.id);
  }, [goToFolder]);

  /** index < 0 は「ファイルボックス」＝ルート */
  const handleNavigateBreadcrumb = useCallback((index: number) => {
    goToFolder(index < 0 ? null : breadcrumbs[index].id);
  }, [breadcrumbs, goToFolder]);

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

  // Googleファイルを開く。ビューアは持たず、Google上の編集画面へ送る
  const handleOpenGoogle = useCallback((file: ProjectFile, missing = false) => {
    // Google の「ファイルが見つかりません」に飛ばすより、こちらで理由を伝える
    if (missing) {
      toast(`「${file.fileName}」はGoogleドライブ上で削除されているため開けません`, "error");
      return;
    }
    if (!openGoogleFile(file)) { toast("このファイルのURLが見つかりません", "error"); return; }
    // draw.io の図は Googleドライブのファイル画面が開くので、そこからの操作を案内する
    if (getFileKind(file.fileName, file.fileType) === "drawio") { toast(DRAWIO_OPEN_HINT, "info"); return; }
    // Office文書も同じくプレビュー画面が開く。編集したい人向けに、その先を案内する
    const office = googleConvertKind(file.fileName);
    if (office) toast(officeOnDriveHint(GOOGLE_APP_LABEL[office]), "info");
  }, [toast]);

  // GoogleファイルをOffice形式で書き出す。
  // 閲覧者自身のGoogleログインで直接落とすので、サーバーを経由しない。
  // Excel / Word / PowerPoint を Google形式にコピーして、別タブで開く。
  // 元のファイルは残り、Google形式のコピーが同じフォルダに1行増える。
  // クリックのたびに、その時点の最新版から新しくコピーを作る（古いコピーを開き直すと中身が古いため）。
  const convertOpenRef = useRef(false); // BUG-05 連打で何個もコピーを作らせない
  const [convertingOpen, setConvertingOpen] = useState(false);
  const handleOpenAsGoogle = useCallback(async (file: ProjectFile) => {
    const kind = googleConvertKind(file.fileName);
    if (!kind || !project) return;
    if (convertOpenRef.current) return;
    convertOpenRef.current = true;

    // 空タブはクリックと同じ実行の中で確保する（await の後だとポップアップブロックに当たる。pendingTab.ts 参照）
    const appName = `Google${GOOGLE_APP_LABEL[kind]}`;
    const tab = openPendingTab(
      `${appName}で開いています`,
      `「${file.fileName}」を${appName}にコピーして開きます。元のファイルはそのまま残ります。`,
    );
    setConvertingOpen(true);
    try {
      const res = await convertExistingFile(file.id);
      if (tab) tab.location.href = res.url;
      else toast("別タブを開けませんでした。一覧に追加されたファイルをクリックして開いてください", "error");

      // 元のファイルとは別物であることを必ず伝える（片方を編集してももう片方には反映されない）
      toast(`「${res.fileName}」として${appName}にコピーしました。元の「${file.fileName}」とは別のファイルです`);
      if (res.failed.length > 0) {
        toast(`${res.failed.length} 人に共有できませんでした（${summarize(res.failed.map(f => f.name))}）。Googleアカウントをお持ちか確認してください`, "error");
      }
      emitLinkItemsChanged(project.id, "file");
      load();
    } catch (e) {
      try { tab?.close(); } catch { /* 既に閉じられている場合は無視 */ }
      const err = e as Error & { status?: number };
      // 428 = Googleアカウント未連携 / 連携切れ。エラーで終わらせず連携へ誘導する
      if (err?.status === 428) {
        toast("Googleアカウントの連携が必要です。連携画面へ移動します");
        try { await startGoogleOAuth(); } catch { toast("連携を開始できませんでした", "error"); }
        return;
      }
      toast(err?.message || `${appName}で開けませんでした`, "error");
    } finally {
      convertOpenRef.current = false;
      setConvertingOpen(false);
    }
  }, [project, toast, load]);

  const handleExportGoogle = useCallback((file: ProjectFile) => {
    const url = googleExportUrl(file);
    if (!url) { toast("この形式は書き出せません", "error"); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }, [toast]);

  // リンクを知っている全員が編集できる状態にする / やめる。
  // URLが実質のパスワードになるため既定はオフ。ここから明示的に入れてもらう。
  const linkSharingRef = useRef(false);
  const handleToggleLinkShare = useCallback(async (file: ProjectFile) => {
    // BUG-05 連打ガード。Drive への往復があるので state だけでは抜ける
    if (linkSharingRef.current) return;
    linkSharingRef.current = true;
    const next = !file.linkShared;
    try {
      await setGoogleLinkShare(file.id, next);
      toast(next
        ? `「${file.fileName}」をリンクを知っている全員が編集できる状態にしました`
        : `「${file.fileName}」のリンク共有を解除しました`);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : "リンク共有の変更に失敗しました", "error");
    } finally {
      linkSharingRef.current = false;
    }
  }, [toast, load]);

  // モーダルの onClose は escStack に積まれるため、毎レンダーで作り直さないよう固定する
  const closePreview = useCallback(() => { setPreviewTarget(null); setFocusComment(null); }, []);
  const closeDelete = useCallback(() => { setDeleteTarget(null); setDeleteFromDrive(false); }, []);

  // 共有用リンク。Slack やメールに貼ると、開いた人はそのままプレビュー（フォルダなら
  // そのフォルダを開いた状態）で着地する。
  // （DevTicket内の本文に貼る場合は %メンションの方が画面遷移せず戻れるので推奨）
  const copyShareLink = useCopyShareLink(projectSlug ?? project?.slug);
  const handleCopyLink = useCallback((file: ProjectFile) => {
    void copyShareLink({ kind: file.isFolder ? "file-folder" : "file", id: file.id });
  }, [copyShareLink]);

  /**
   * @param alsoDrive  Googleドライブ上の実体もゴミ箱へ入れる（確認ダイアログのチェック）
   * @param googleCount 対象に含まれる Googleドライブ上のファイルの件数（文言の出し分け用）
   */
  const handleDelete = useCallback(async (file: ProjectFile, alsoDrive: boolean, googleCount: number) => {
    // BUG-05 await を含むので ref で二重起動を止める。
    // ダイアログは閉じずに「処理中...」を出したままにするので、state だけでは素通りしうる。
    if (deletingRef.current) return;
    deletingRef.current = true;
    try {
      // ★ Drive 側が先。DevTicket の行を消すと、実体を指す external_id ごと消えて
      //   「どのファイルを消せばいいか」が分からなくなる。
      //   消せないものがあっても DevTicket 側の削除は続ける（結果はトーストで伝える）。
      let drive: TrashResult | null = null;
      let driveError: string | null = null;
      if (alsoDrive) {
        try {
          drive = await trashGoogleFiles(file.isFolder ? { folderId: file.id } : { fileId: file.id });
        } catch (e) {
          driveError = e instanceof Error ? e.message : "Googleドライブ側で削除できませんでした";
        }
      }

      try {
        await deleteProjectFile(file.id);
      } catch (e) {
        toast(e instanceof Error ? e.message : "削除に失敗しました", "error");
        return;
      }

      toast(!alsoDrive && googleCount > 0
        ? `「${file.fileName}」をファイルボックスから削除しました。Googleドライブ上のファイルは残っています`
        : `「${file.fileName}」を削除しました`);

      // Drive 側の結果は別のトーストで伝える。消せなかったものに必ず気づけるようにする
      if (alsoDrive) {
        if (driveError) {
          toast(`Googleドライブ上のファイルは削除できませんでした（${driveError}）。Googleドライブには残っています`, "error");
        } else if (drive && drive.failed.length > 0) {
          toast(`Googleドライブ上のファイル ${drive.failed.length} 件を削除できませんでした：`
            + `${summarize(drive.failed.map(f => f.name))}。Googleドライブには残っています`, "error");
        } else if (drive && drive.trashed > 0) {
          toast(drive.trashed > 1
            ? `Googleドライブ上のファイル ${drive.trashed} 件をゴミ箱へ移動しました`
            : "Googleドライブ上のファイルをゴミ箱へ移動しました");
        }
      }

      if (file.isFolder) {
        // フォルダの行を消すと子孫の行もDBのカスケードで消える。画面側も同じ範囲を落とす
        // （残すと、検索したときだけ消えたはずのファイルが出てくる）
        const gone = new Set([file.id, ...collectDescendants(files, file.id).map(f => f.id)]);
        setFiles(prev => prev.filter(f => !gone.has(f.id)));
      } else if (isGoogleFile(file)) {
        // Googleドライブ上のファイルはサーバー側も id で1行だけ消す（同名＝別バージョンではない）
        setFiles(prev => prev.filter(f => f.id !== file.id));
      } else {
        // サーバー側は同名の全バージョンを消すので、画面側も同じ粒度で消す
        setFiles(prev => prev.filter(f => f.fileName !== file.fileName));
      }
      emitLinkItemsChanged(file.projectId, "file");
    } finally {
      deletingRef.current = false;
    }
  }, [toast, files]);

  // 保存や差し替えのたびに版が増えるので、一覧は同名ファイルの最新版だけを見せる。
  // (files は created_at 降順で取得済み。同名なら version が大きい方を残す)
  const latestOnly = files.filter(f =>
    !files.some(o => o.fileName === f.fileName && o.version > f.version));

  const currentLevelItems = search
    ? latestOnly.filter(f => f.fileName.toLowerCase().includes(search.toLowerCase()) || f.uploadedBy.toLowerCase().includes(search.toLowerCase()))
    : latestOnly.filter(f => (f.parentId ?? null) === currentFolderId);

  const visible = currentLevelItems;

  // パンくずをドロップ先にする。上の階層へ戻すのにフォルダ行は使えないので、
  // 一覧の行を掴んでパンくずで離せば、その階層へ移動できるようにする。
  // 外から来たファイル/フォルダはフォルダ行と同じく、その階層へアップロードする。
  const crumbDropProps = (targetFolderId: string | null) => {
    const key = targetFolderId ?? ROOT_CRUMB;
    // 今いる場所へ落としても何も変わらないので、ドロップ先として扱わない
    const isSameFolder = !!draggingFile && (draggingFile.parentId ?? null) === targetFolderId;
    return {
      onDragOver: (e: DragEvent<HTMLElement>) => {
        // 何もしない場所でも preventDefault しないとブラウザがファイルを開いてしまう
        e.preventDefault();
        e.stopPropagation();
        const isExternal = e.dataTransfer.types.includes("Files");
        if (!isExternal && (!draggingFile || isSameFolder)) {
          e.dataTransfer.dropEffect = "none";
          return;
        }
        e.dataTransfer.dropEffect = isExternal ? "copy" : "move";
        if (dragOverCrumb !== key) setDragOverCrumb(key);
      },
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOverCrumb(prev => (prev === key ? null : prev));
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOverCrumb(null);
        if (e.dataTransfer.types.includes("Files")) {
          handleDropUpload(e, targetFolderId);
        } else if (draggingFile && !isSameFolder) {
          handleMoveFile(draggingFile, targetFolderId);
          setDraggingFile(null);
        }
      },
    };
  };

  const crumbStyle = (targetFolderId: string | null, isCurrent: boolean): CSSProperties => {
    const isHover = dragOverCrumb === (targetFolderId ?? ROOT_CRUMB);
    return {
      background: isHover ? "#FEF3C7" : "none",
      border: "none",
      outline: isHover ? "2px dashed #D97706" : "none",
      outlineOffset: -2,
      borderRadius: 6,
      cursor: "pointer",
      color: isHover ? "#B45309" : isCurrent ? "#1A1714" : "#059669",
      fontWeight: isCurrent ? 700 : 600,
      // ドラッグで狙いやすいよう当たり判定を広げる（見た目の位置は margin で打ち消す）
      padding: "3px 6px",
      margin: "-3px -6px",
      fontSize: 12,
      transition: "background 0.15s",
    };
  };

  // ── ガード ─────────────────────────────────────────────────
  // 黙ってリダイレクトせず、理由と開こうとしたURLを出す（docs/not-found-page-design.md）。
  const accessBlocked = projectAccessView(notFound ? null : project, { userRole, userName, userOrgId });
  if (!loading && accessBlocked) return accessBlocked;

  return (
    <div style={{ padding: "24px 24px 0", minWidth: 900 }}>
      {/* 🌟 パンくず〜アップロード欄までを画面上部に固定する。
          ファイルが増えると下スクロールでタブ・検索・パンくずが見切れ、
          他画面へ移動することも、フォルダを辿ることもできなくなっていた。
          カードは「固定する上半分」と「スクロールする一覧」に分けて、
          角丸と枠線をつなぎ合わせて1枚のカードに見せている。
          margin の -24px は外側の padding を打ち消すため（背景を左右いっぱいに敷く） */}
      <div style={{ position: "sticky", top: 0, zIndex: 200, background: "#F5F6F8", margin: "-24px -24px 0", padding: "24px 24px 0" }}>
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
          {/* 🌟 BRU13-047: タブ(ProjectSubNav)は固定幅。幅が足りない時はこの見出し側が先に縮む */}
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>ファイルボックス</h1>
            {/* 読み込み中に「0 件」と出てから件数が入れ替わるのを避ける */}
            <p style={{ fontSize: 12, color: "#A09790", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {!project ? "..." : loading ? project.name : `${project.name} · ${latestOnly.length} 件`}
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <ProjectSubNav projectSlug={projectSlug ?? project?.slug ?? ""} active="files" marginBottom={0}
              minutesPerm={effectiveMinutesPerm} wikiPerm={effectiveWikiPerm}
              backlogPerm={effectiveBacklogPerm} whiteboardPerm={effectiveWhiteboardPerm} />
          </div>
        </div>
        {/* カードの上半分。ここまでが固定側。下の一覧カードと枠線をつなげるため
            下辺の枠線と角丸は持たせない */}
        <div style={{ background: "#FFFFFF", borderRadius: "14px 14px 0 0", border: "1px solid rgba(26,23,20,0.07)", borderBottom: "none", padding: "14px 14px 14px" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Googleアプリ（スプレッドシート/ドキュメント/スライド）を新規作成する。
                組織設定がオフのときは出さない */}
            {project && googleDrive && (
              <GoogleAppsButton
                projectId={project.id}
                parentId={currentFolderId}
                drive={googleDrive}
                userId={userId}
                onCreated={load}
                toast={toast}
              />
            )}
            {/* フォルダをそのまま上げる。ドラッグ&ドロップでも同じことができるが、
                クリックからも選べるようにしておく（ドロップできない環境向け） */}
            <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#FFFBEB", color: "#D97706", border: "1px solid #FDE68A", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: uploading ? "wait" : "pointer" }}>
              <FolderUp style={{ width: 14, height: 14 }} /> フォルダをアップロード
              <input type="file" disabled={uploading} style={{ display: "none" }}
                // React の型に無い属性。フォルダ選択ダイアログにするために必要。
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                onChange={e => { uploadFiles(e.target.files || []); e.target.value = ""; }} />
            </label>
            <button onClick={() => setShowFolderModal(true)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "#ECFDF5", color: "#059669", border: "1px solid #A7F3D0", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
              <FolderPlus style={{ width: 14, height: 14 }} /> フォルダ作成
            </button>
          </div>
        </div>

        {/* パンくずナビゲーション */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, fontSize: 12, flexWrap: "wrap" }}>
          <button onClick={() => handleNavigateBreadcrumb(-1)}
            {...crumbDropProps(null)}
            style={crumbStyle(null, breadcrumbs.length === 0)}>
            ファイルボックス
          </button>
          {breadcrumbs.map((b, idx) => (
            <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ChevronRight style={{ width: 10, height: 10, color: "#C9C4BB" }} />
              <button onClick={() => handleNavigateBreadcrumb(idx)}
                {...crumbDropProps(b.id)}
                style={crumbStyle(b.id, idx === breadcrumbs.length - 1)}>
                {b.name}
              </button>
            </div>
          ))}
          {draggingFile && (
            <span style={{ marginLeft: 8, fontSize: 11, color: "#B0A9A4" }}>
              パンくずで離すとその階層へ移動します
            </span>
          )}
        </div>

        {/* アップロード */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleDropUpload(e); }}
          style={{ marginBottom: 0 }}>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "16px 12px", border: `1.5px dashed ${dragOver ? "rgba(5,150,105,0.5)" : "rgba(26,23,20,0.12)"}`, borderRadius: 10, cursor: uploading ? "wait" : "pointer", background: dragOver ? "rgba(5,150,105,0.04)" : "#FAFAF8", transition: "border-color 0.15s, background 0.15s" }}>
            {uploading
              ? <Loader2 style={{ width: 14, height: 14, color: "#059669", animation: "spin 1s linear infinite" }} />
              : <Upload style={{ width: 14, height: 14, color: dragOver ? "#059669" : "#B0A9A4" }} />}
            <span style={{ fontSize: 12, color: dragOver || uploading ? "#059669" : "#B0A9A4" }}>
              {uploading
                ? `アップロード中...${uploadProgress && uploadProgress.total > 1 ? `（${uploadProgress.done + 1} / ${uploadProgress.total}）` : ""}`
                : dragOver ? "ドロップして追加"
                : `クリックしてファイルを追加、またはドラッグ&ドロップ（フォルダごと可・1ファイル ${formatFileSize(MAX_FILE_SIZE)} まで）`}
            </span>
            <input type="file" multiple disabled={uploading} style={{ display: "none" }}
              onChange={e => { uploadFiles(e.target.files || []); e.target.value = ""; }} />
          </label>
        </div>
        </div>{/* カードの上半分ここまで */}
      </div>{/* 固定ヘッダーここまで */}

      {/* 一覧。ここだけがスクロールする。上のカードと枠線をつなげるため、
          上辺の枠線と角丸は持たせない */}
      <div style={{ background: "#FFFFFF", borderRadius: "0 0 14px 14px", border: "1px solid rgba(26,23,20,0.07)", borderTop: "none", padding: "0 14px 14px" }}>
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
                      // 外から来たファイル/フォルダか、画面内の行を掴んだ移動かを見分ける。
                      // 行の移動は text/plain しか持たないので types に "Files" は入らない。
                      if (e.dataTransfer.types.includes("Files")) {
                        handleDropUpload(e, f.id);
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
                      <TruncatedText as="p" text={f.fileName}
                        style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#1A1714" }}>
                        {f.fileName}
                        {isFolderHover && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: "#D97706" }}>ここへ追加・移動</span>
                        )}
                      </TruncatedText>
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

              // Googleファイルは拡張子を持たないので、種別は file_type(MIME)で見る
              const kind = getFileKind(f.fileName, f.fileType);
              const Icon = KIND_ICON[kind];
              const isGoogle = isGoogleFile(f);
              const isMissing = isGoogle && missingGoogleIds.has(f.id);
              return (
                <div key={f.id} onClick={() => isGoogle ? handleOpenGoogle(f, isMissing) : setPreviewTarget(f)}
                  draggable
                  onDragStart={e => {
                    setDraggingFile(f);
                    e.dataTransfer.setData("text/plain", f.id);
                  }}
                  onDragEnd={() => { setDraggingFile(null); setDragOverCrumb(null); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "10px 10px", borderRadius: 8, cursor: "grab", borderBottom: "1px solid rgba(26,23,20,0.05)",
                    opacity: draggingFile?.id === f.id ? 0.4 : 1,
                  }}>
                  {/* Office と Google は色が近いので、形で見分けられるアイコンにする */}
                  <FileKindIcon kind={kind} fallback={Icon} fallbackColor={KIND_COLOR[kind]} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <TruncatedText as="p" text={f.fileName}
                      style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "#1A1714" }}>
                      {f.fileName}
                      {/* Googleファイルに版の概念は無い（常に v1）ので出さない */}
                      {!isGoogle && f.version > 1 && (
                        <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "#EEF2FF", color: "#4F46E5" }}>v{f.version}</span>
                      )}
                      {/* リンク共有は「URLを知っていれば誰でも編集できる」状態。
                          気づかないまま放置されないよう、一覧で常に見えるようにする */}
                      {f.linkShared && (
                        <span title="リンクを知っている全員が編集できます"
                          style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "#FEF3C7", color: "#B45309", display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Globe style={{ width: 9, height: 9 }} />リンク公開中
                        </span>
                      )}
                      {/* Drive 側で消された行。DevTicket 側は消さずに、開けないことだけ伝える */}
                      {isMissing && (
                        <span title="Googleドライブ上で削除されているため開けません"
                          style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "#FEF2F2", color: "#DC2626" }}>
                          Driveで削除済み
                        </span>
                      )}
                    </TruncatedText>
                    <p style={{ margin: "2px 0 0", fontSize: 11, color: "#A09790" }}>
                      {/* Googleドライブ上のファイルは種別を出す（Google形式はサイズを持たないため）。
                          Office文書・PDF などはサイズが分かるので、種別に続けて出す */}
                      {isGoogle
                        ? (f.fileSize > 0 ? `${googleFileLabel(f)} · ${formatFileSize(f.fileSize)}` : googleFileLabel(f))
                        : formatFileSize(f.fileSize)} · {f.uploadedBy || "不明"} · {formatDateTime(f.createdAt)}
                    </p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); handleCopyLink(f); }} title="リンクをコピー"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                    <Link2 style={{ width: 13, height: 13 }} />
                  </button>
                  {isGoogle && (
                    <button onClick={e => { e.stopPropagation(); handleToggleLinkShare(f); }}
                      title={f.linkShared ? "リンク共有を解除する" : "リンクを知っている全員が編集できるようにする"}
                      style={{ background: "none", border: "none", cursor: "pointer", color: f.linkShared ? "#D97706" : "#C9C4BB", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                      <Globe style={{ width: 13, height: 13 }} />
                    </button>
                  )}
                  {/* Excel / Word / PowerPoint を Google形式にコピーして開く。
                      連携が有効な組織で、変換できる拡張子のときだけ（.xlsm は対象外） */}
                  {!isGoogle && googleDrive && googleConvertKind(f.fileName) && (() => {
                    const gk = googleConvertKind(f.fileName)!;
                    const label = `Google${GOOGLE_APP_LABEL[gk]}で開く（コピーを作成）`;
                    return (
                      <button onClick={e => { e.stopPropagation(); void handleOpenAsGoogle(f); }}
                        title={label} aria-label={label} disabled={convertingOpen}
                        style={{ background: "none", border: "none", cursor: convertingOpen ? "wait" : "pointer", padding: 5, display: "flex", alignItems: "center", flexShrink: 0 }}>
                        <GoogleGLogo size={13} />
                      </button>
                    );
                  })()}
                  {/* Googleドライブ上のファイルは storage に実体が無いので、Drive から直接落とす。
                      Google形式だけは元の形式が無いため Office形式へ書き出す */}
                  <button onClick={e => { e.stopPropagation(); isGoogle ? handleExportGoogle(f) : handleDownload(f); }}
                    title={kind === "gsheet" || kind === "gdoc" || kind === "gslide"
                      ? "Office形式でダウンロード" : "ダウンロード"}
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

      {convertingUpload && <BlockingSpinner label="Google形式に変換してアップロードしています" />}
      {convertingOpen && <BlockingSpinner label="Google形式にコピーしています" />}
      {previewTarget && (
        <FileViewerModal file={previewTarget} onClose={closePreview}
          onDownload={handleDownload} onOpenInApp={handleOpenInApp}
          focusCommentId={focusComment?.commentId ?? null}
          focusReplyId={focusComment?.replyId ?? null}
          onSaved={() => { load(); if (project) emitLinkItemsChanged(project.id, "file"); }} />
      )}
      {deleteTarget && (() => {
        // Googleドライブ上のファイルの実体は Drive 側にある。どちらにするかは毎回選んでもらう。
        // フォルダは配下（入れ子のフォルダの中まで）をまとめて数え、
        // 「中身もすべて Drive から消す／Drive 上はすべて残す」を1つのチェックで選ばせる。
        const googleCount = deleteTarget.isFolder
          ? collectDescendants(files, deleteTarget.id).filter(f => !f.isFolder && isGoogleFile(f)).length
          : (isGoogleFile(deleteTarget) ? 1 : 0);
        // チェックが付いていても、Googleドライブ上のファイルが無ければ Drive へは行かない
        const alsoDrive = deleteFromDrive && googleCount > 0;

        const message = deleteTarget.isFolder
          ? `フォルダ「${deleteTarget.fileName}」を削除します。フォルダ内のフォルダとファイルもすべて削除されます。`
            + (googleCount > 0 ? `\nこのフォルダには Googleドライブ上のファイルが ${googleCount} 件あります。` : "")
          : deleteTarget.version > 1 && !isGoogleFile(deleteTarget)
            ? `「${deleteTarget.fileName}」を削除します。過去バージョン（v1〜v${deleteTarget.version}）もすべて削除されます。`
            : `「${deleteTarget.fileName}」を削除します。`;

        return (
          <ConfirmDialog
            title={deleteTarget.isFolder ? "フォルダを削除" : "ファイルを削除"}
            message={message}
            extra={googleCount > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#1A1714", cursor: "pointer" }}>
                  <input type="checkbox" checked={deleteFromDrive}
                    onChange={e => setDeleteFromDrive(e.target.checked)}
                    style={{ width: 14, height: 14, accentColor: "#059669", cursor: "pointer", flexShrink: 0 }} />
                  {deleteTarget.isFolder
                    ? `Googleドライブ上のファイル ${googleCount} 件もすべてゴミ箱へ移動する`
                    : "Googleドライブ上のファイルもゴミ箱へ移動する"}
                </label>
                <p style={{ margin: 0, fontSize: 12, color: "#6B6458", lineHeight: 1.6 }}>
                  {deleteFromDrive
                    // 完全削除ではなくゴミ箱なので、取り違えても Drive 側から戻せることを伝える
                    ? "Googleドライブのゴミ箱に入ります。取り消したいときは Googleドライブのゴミ箱から元に戻せます。"
                    : "チェックしない場合はファイルボックスから削除するだけで、Googleドライブ上のファイルは残ります。"}
                </p>
              </div>
            ) : undefined}
            confirmLabel="削除する"
            onConfirm={() => handleDelete(deleteTarget, alsoDrive, googleCount)}
            onClose={closeDelete}
          />
        );
      })()}
      {convertPrompt && (() => {
        // 変換すると元の .xlsx 等は DevTicket に残らない。既定は「そのまま」。
        const many = convertPrompt.names.length > 1;
        const close = () => setConvertPrompt(null);
        const go = () => {
          if (!convertChoice) return; // 未選択では進ませない
          const convert = convertChoice === "convert";
          setConvertPrompt(null);
          uploadEntries(convertPrompt.entries, convertPrompt.targetFolderId, convert);
        };

        // 入れられたものが1種類なら、その種別に合わせて文言を具体的にする
        // （Excel→スプレッドシート / Word→ドキュメント / PowerPoint→スライド）。
        // 複数種が混ざっているときだけ「Google形式」とまとめる。
        const kinds = convertPrompt.names
          .map(n => googleConvertKind(n)).filter((k): k is GoogleAppKind => k !== null);
        const only: GoogleAppKind | null =
          kinds.length > 0 && kinds.every(k => k === kinds[0]) ? kinds[0] : null;
        const googleLabel = only ? `Google${GOOGLE_APP_LABEL[only]}` : "Google形式";
        const officeLabel = only ? OFFICE_APP_LABEL[only] : "Excel / Word / PowerPoint";
        // 画面内エディタで開けるのは xlsx / xlsm / docx だけ。開けないものに案内しない
        const inAppEditable = convertPrompt.names.every(n => isEditableInBrowser(n));

        const OPTIONS = [
          {
            value: "keep" as const,
            label: "そのまま保存",
            desc: `書式もマクロもそのまま保ちます。${inAppEditable ? "画面内のエディタと" : ""}デスクトップの ${officeLabel} で編集できます。`,
            accent: "#059669", bg: "#ECFDF5", border: "#A7F3D0", head: "#065F46", body: "#047857",
          },
          {
            value: "convert" as const,
            label: `${googleLabel}に変換して保存`,
            desc: `複数人で同時に編集できます。ファイルは1つだけで、元の ${officeLabel} ファイルは残りません。`,
            warn: "マクロ・一部の書式・ピボットテーブルなどは失われることがあります。",
            accent: "#2563EB", bg: "#EFF6FF", border: "#BFDBFE", head: "#1E40AF", body: "#1D4ED8",
          },
        ];

        return (
          <DialogShell title="保存形式を選択" onClose={close} size="md" minHeight={0}
            footer={<>
              <button type="button" onClick={close}
                style={{ padding: "8px 16px", background: "#F4F5F6", color: "#1A1714", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer" }}>
                キャンセル
              </button>
              <button type="button" onClick={go} disabled={!convertChoice}
                title={convertChoice ? undefined : "保存形式を選択してください"}
                style={{ padding: "8px 16px", background: convertChoice ? "#059669" : "#9CA3AF", color: "#fff", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "none", cursor: convertChoice ? "pointer" : "not-allowed" }}>
                この形式で保存
              </button>
            </>}>
            <p style={{ margin: 0, fontSize: 12.5, color: "#1A1714", lineHeight: 1.85 }}>
              {many
                ? `${convertPrompt.names.length} 件の ${officeLabel} ファイルが含まれています（${summarize(convertPrompt.names)}）。どちらで保存しますか？`
                : `「${convertPrompt.names[0]}」をどちらで保存しますか？`}
            </p>
            <div role="radiogroup" aria-label="保存形式" style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
              {OPTIONS.map(o => {
                const on = convertChoice === o.value;
                return (
                  <label key={o.value}
                    style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px", borderRadius: 10, cursor: "pointer", transition: "all 0.15s",
                      background: on ? o.bg : "#FAFAF8",
                      border: `1px solid ${on ? o.border : "rgba(26,23,20,0.08)"}` }}>
                    <input type="radio" name="upload-format" value={o.value} checked={on}
                      onChange={() => setConvertChoice(o.value)}
                      style={{ marginTop: 2, accentColor: o.accent, cursor: "pointer", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: on ? o.head : "#1A1714" }}>{o.label}</p>
                      <p style={{ margin: "4px 0 0", fontSize: 11.5, color: on ? o.body : "#A09790", lineHeight: 1.75 }}>
                        {o.desc}
                        {o.warn && <><br /><strong>{o.warn}</strong></>}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "#B0A9A4", lineHeight: 1.7 }}>
              変換後も、ダウンロードボタンから {officeLabel} 形式で書き出せます。
              マクロ付き（.xlsm）は変換の対象外で、常にそのまま保存されます。
            </p>
          </DialogShell>
        );
      })()}
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
