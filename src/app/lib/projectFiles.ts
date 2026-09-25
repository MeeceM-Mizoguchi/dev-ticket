import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// ENHA2-035 ファイルボックス共通ロジック
// 「ブラウザで閲覧」は全てクライアント内(自前ビューア)で完結させ、
// Microsoft/Google などの外部ビューアには一切ファイルを渡さない。

export type FileKind =
  | "pdf" | "excel" | "word" | "powerpoint" | "image" | "text" | "other"
  | "gsheet" | "gdoc" | "gslide" | "drawio";

// ── Googleドライブ上のファイル（docs/google-drive-integration-design.md）──
// storage に実体を持たず、別タブで Google 上の編集画面を開く。
// 種別は拡張子ではなく file_type(MIMEタイプ)で判定する。
export const GOOGLE_MIME = {
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  document: "application/vnd.google-apps.document",
  presentation: "application/vnd.google-apps.presentation",
} as const;

export type GoogleAppKind = keyof typeof GOOGLE_MIME;

// Drive 上の draw.io 図（.drawio）。Google形式ではない普通のファイルだが、扱いは Googleファイルと同じ
// （storage に実体を持たず、別タブで開く）。編集は draw.io 側が Drive のファイルを直接読み書きする。
// ★ api/google/[action].ts と api/project-files/[action].ts の DRAWIO_MIME と揃えること。
//   サーバーが取り込み時に file_type をこの値へ揃えるので、画面側はこれだけで判定できる。
export const DRAWIO_MIME = "application/vnd.jgraph.mxfile";

/**
 * 「Googleアプリ」メニューから新規作成できる種別。
 * GoogleAppKind（Office文書の変換先）とは分けておく。draw.io は変換先にならないため、
 * GoogleAppKind に混ぜると OFFICE_APP_LABEL などの「変換」用の表に穴が空く。
 */
export type GoogleCreateKind = GoogleAppKind | "drawio";

const GOOGLE_MIME_KIND: Record<string, FileKind> = {
  [GOOGLE_MIME.spreadsheet]: "gsheet",
  [GOOGLE_MIME.document]: "gdoc",
  [GOOGLE_MIME.presentation]: "gslide",
  [DRAWIO_MIME]: "drawio",
};

/** Googleドライブ上のファイルか（storage に実体が無い＝署名付きURLもWebDAVも使えない） */
export function isGoogleFile(f: { externalProvider?: string | null }): boolean {
  return f.externalProvider === "google";
}

export const GOOGLE_APP_LABEL: Record<GoogleAppKind, string> = {
  spreadsheet: "スプレッドシート",
  document: "ドキュメント",
  presentation: "スライド",
};

/** 「Googleアプリ」メニューの新規作成の表示名 */
export const GOOGLE_CREATE_LABEL: Record<GoogleCreateKind, string> = {
  ...GOOGLE_APP_LABEL,
  drawio: "draw.io",
};

/** 変換元の Office アプリ名。アップロード時の案内文を種別に合わせるために使う */
export const OFFICE_APP_LABEL: Record<GoogleAppKind, string> = {
  spreadsheet: "Excel",
  document: "Word",
  presentation: "PowerPoint",
};

export const GOOGLE_KIND_LABEL: Partial<Record<FileKind, string>> = {
  gsheet: "Googleスプレッドシート",
  gdoc: "Googleドキュメント",
  gslide: "Googleスライド",
  drawio: "draw.io（Googleドライブ）",
};

// Google形式ではないが Drive に置いてあるファイル（Office文書・PDF・画像など）の呼び名。
// storage にあるものと同じアイコン・同じ拡張子で並ぶので、
// 「これは Drive 側にある」ことが分かるよう、表示名に（Googleドライブ）を添える。
const DRIVE_KIND_LABEL: Partial<Record<FileKind, string>> = {
  excel: "Excel", word: "Word", powerpoint: "PowerPoint",
  pdf: "PDF", image: "画像", text: "テキスト",
};

/** Googleドライブ上のファイルの表示名（一覧のサブ行・メンションのカードで使う） */
export function googleFileLabel(file: { fileName: string; fileType: string }): string {
  const kind = getFileKind(file.fileName, file.fileType);
  const google = GOOGLE_KIND_LABEL[kind];
  if (google) return google;
  const drive = DRIVE_KIND_LABEL[kind];
  return drive ? `${drive}（Googleドライブ）` : "Googleドライブ";
}

/**
 * Google形式（スプレッドシート・ドキュメント・スライド等）か。
 * Google形式だけは拡張子を持たず、ダウンロード時に Office 形式へ変換される。
 * Drive 上の Office文書・PDF・draw.io 図はこれに当たらない。
 */
export function isGoogleNativeType(fileType?: string | null): boolean {
  return !!fileType && fileType.startsWith("application/vnd.google-apps.");
}

// アップロード時に Google 形式へ変換できる拡張子。
//
// ★ xlsm は入れない。マクロは変換で必ず失われ、しかも元ファイルが手元に残らない。
//   「マクロを積んだブックが黙って壊れる」のは取り返しがつかないので、選ばせない。
// レガシー形式(.xls/.doc/.ppt)は自前ビューアが描画できない（PREVIEWABLE_EXT 参照）ため、
// 変換するとむしろ DevTicket 内で閲覧できるようになる。
// ★ api/google/[action].ts の CONVERTIBLE と揃えること（そちらはサーバー側の判定に使う）。
const GOOGLE_CONVERTIBLE: Record<string, GoogleAppKind> = {
  xlsx: "spreadsheet", xls: "spreadsheet", csv: "spreadsheet",
  docx: "document", doc: "document",
  pptx: "presentation", ppt: "presentation",
};

/** Google 形式へ変換してアップロードできるファイルか。できないなら null */
export function googleConvertKind(fileName: string): GoogleAppKind | null {
  return GOOGLE_CONVERTIBLE[getExt(fileName)] ?? null;
}

// Google 形式から元の Office 形式へ書き出すURL。
// Drive API の files.export をサーバーで中継するとファイル本体が
// サーバーレス関数のレスポンス上限に引っかかるため、閲覧者自身の Google ログインで
// 直接落とさせる（編集できる人は必ずログイン済み）。
const GOOGLE_EXPORT: Partial<Record<FileKind, (id: string) => string>> = {
  gsheet: id => `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
  gdoc: id => `https://docs.google.com/document/d/${id}/export?format=docx`,
  gslide: id => `https://docs.google.com/presentation/d/${id}/export/pptx`,
};

// Google形式でないもの（draw.io の図・Office文書・PDF・画像など、Drive 上の普通のファイル）は
// 変換しようがないので、そのままの形で落とす。
const driveDownloadUrl = (id: string) => `https://drive.google.com/uc?export=download&id=${id}`;

/**
 * Googleドライブ上のファイルをダウンロードするURL。
 * スプレッドシート・ドキュメント・スライドは Office 形式へ書き出し、
 * それ以外（Office文書・PDF・画像・draw.io 図など）は元の形式のまま落とす。
 * 落としようがないもの（externalId が無い／Googleフォーム・図形描画など）は null。
 */
export function googleExportUrl(file: { fileType: string; fileName: string; externalId?: string | null }): string | null {
  if (!file.externalId) return null;
  const build = GOOGLE_EXPORT[getFileKind(file.fileName, file.fileType)];
  if (build) return build(file.externalId);
  // Google形式のうち Office に対応するものが無いもの（フォーム・図形描画・Jamboard 等）は、
  // ファイルとして落とせない。呼び出し側で「この形式は書き出せません」と伝える
  if (isGoogleNativeType(file.fileType)) return null;
  return driveDownloadUrl(file.externalId);
}

const EXT_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  xlsx: "excel", xlsm: "excel", xls: "excel", csv: "text",
  docx: "word", doc: "word",
  pptx: "powerpoint", ppt: "powerpoint",
  png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image",
  txt: "text", md: "text", json: "text", log: "text", xml: "text", yml: "text", yaml: "text",
};

// 自前ビューアで実際に描画できる拡張子。
// レガシーバイナリ形式(.xls/.doc)と pptx は対応ライブラリが無いため閲覧不可。
const PREVIEWABLE_EXT = new Set([
  "pdf",
  "xlsx", "xlsm",
  "docx",
  "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp",
  "txt", "md", "csv", "json", "log", "xml", "yml", "yaml",
]);

// Office のURIスキームで起動できる種別 → スキーム名
const OFFICE_SCHEME: Partial<Record<FileKind, string>> = {
  word: "ms-word",
  excel: "ms-excel",
  powerpoint: "ms-powerpoint",
};

export function getExt(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

// 名前と拡張子(先頭のドット込み)に割る。先頭ドット(.gitignore 等)は拡張子扱いしない。
// api/project-files/[action].ts の splitName と同じ規則。ずれると改名時に拡張子が二重になる。
export function splitFileName(fileName: string): { base: string; ext: string } {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? { base: fileName.slice(0, i), ext: fileName.slice(i) } : { base: fileName, ext: "" };
}

/**
 * ファイルの種別。
 * @param fileType DBの file_type（MIMEタイプ）。Googleファイルは拡張子を持たないため、
 *   種別はここでしか判別できない。省略時は拡張子だけで判定する。
 */
export function getFileKind(fileName: string, fileType?: string | null): FileKind {
  if (fileType && GOOGLE_MIME_KIND[fileType]) return GOOGLE_MIME_KIND[fileType];
  return EXT_KIND[getExt(fileName)] ?? "other";
}

export function canPreviewInBrowser(fileName: string): boolean {
  return PREVIEWABLE_EXT.has(getExt(fileName));
}

// デスクトップアプリ起動用URI。Office系以外は null(=「アプリで開く」を出さない)。
// 注意: 署名付きURLは読み取り専用のため、アプリ側から直接上書き保存はできない。
// 編集後は「名前を付けて保存 → ファイルボックスに再アップロード」の運用になる。
export function officeProtocolUrl(fileName: string, signedUrl: string): string | null {
  const scheme = OFFICE_SCHEME[getFileKind(fileName)];
  return scheme ? `${scheme}:ofe|u|${signedUrl}` : null;
}

export function isOfficeFile(fileName: string): boolean {
  return OFFICE_SCHEME[getFileKind(fileName)] !== undefined;
}

// 画面内エディタで直接編集できる拡張子。
// xlsx/xlsm: 元ファイルを直接パッチ（グラフ等を保持）。docx: 本文を再生成（書式は一部欠落）。
const EDITABLE_EXT = new Set(["xlsx", "xlsm", "docx"]);
export function isEditableInBrowser(fileName: string): boolean {
  return EDITABLE_EXT.has(getExt(fileName));
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// 種別ごとの表示色（一覧のアイコン用）
export const KIND_COLOR: Record<FileKind, string> = {
  pdf: "#DC2626", excel: "#059669", word: "#2563EB", powerpoint: "#EA580C",
  image: "#7C3AED", text: "#6B6458", other: "#9E9690",
  // Google 各アプリのブランド色に寄せる（一覧で一目で見分けられるように）
  gsheet: "#0F9D58", gdoc: "#4285F4", gslide: "#F4B400",
  drawio: "#F08705",
};

// 全ての storage 操作は api/project-files/[action] (service_role) 経由で行う。
// クライアントから storage.objects を直接触らないため、バケットのRLSポリシー設定が不要。
async function postApi<T>(action: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase!.auth.getSession();
  if (!session?.access_token) throw new Error("未ログインです");

  const res = await fetch(`/api/project-files/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg?.error || "リクエストに失敗しました");
  }
  return res.json() as Promise<T>;
}

/**
 * 署名付きURLからファイルを取得する（保存直後のストレージ整合待ちに備えてリトライ）。
 * アップロード直後はオブジェクトが即時に整合せず一時的に 400/404 を返すことがあるため、
 * res.ok を確認し、失敗時は短い待機を挟んで数回やり直す。
 */
export async function fetchFileWithRetry(url: string, tries = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  throw lastErr instanceof Error ? lastErr : new Error("ファイルの取得に失敗しました");
}

/** 閲覧・DL用の短命な署名付きURLを取得する（サーバー側でメンバー判定） */
export async function fetchSignedUrl(fileId: string, mode: "inline" | "download" = "inline"): Promise<string> {
  const res = await postApi<{ url: string }>("signed-url", { fileId, mode });
  return res.url;
}

/**
 * 署名付きURLを発行し直してからファイルを取得する。
 * 署名付きURLの有効期限は60秒しかないため、ビューアを開いたまま少し経ってから
 * （編集モードに入るなどして）取りに行くと必ず失効している。読む直前に発行し直す。
 * 発行に失敗したときだけ、手持ちのURLで取りに行く。
 */
export async function fetchProjectFileFresh(fileId?: string | null, fallbackUrl?: string): Promise<Response> {
  if (fileId) {
    try {
      return await fetchFileWithRetry(await fetchSignedUrl(fileId, "inline"));
    } catch (e) {
      if (!fallbackUrl) throw e;
      console.warn("[projectFiles] 署名付きURLの再発行に失敗。手持ちのURLで試します", e);
    }
  }
  if (!fallbackUrl) throw new Error("ファイルURLの取得に失敗しました");
  return fetchFileWithRetry(fallbackUrl);
}

/**
 * ファイルをアップロードする。
 * ①サーバーが保存キーを決めて署名付きアップロードURLを発行
 * ②ブラウザ→ストレージへ直接アップロード（サーバーレス関数のサイズ上限を回避）
 * ③サーバー側でDB登録（版番号の採番も含む）
 *
 * @param opts.uniqueName 同じフォルダに同名のファイルが既にあるとき、新バージョンにせず
 *   「foo (1).xlsx」のように別ファイルとして登録する（手動アップロード用）。
 *   エディタ保存やWebDAV保存では指定しない＝これまで通り版が上がる。
 * @returns 実際に登録されたファイル名（改名された場合はその名前）
 */
export async function uploadProjectFile(
  projectId: string, file: File, opts?: { uniqueName?: boolean; parentId?: string | null; fileId?: string },
): Promise<string> {
  const path = await stageProjectFile(projectId, file);
  return registerStagedFile(projectId, path, file, opts);
}

/**
 * ストレージへ実体だけを置く（DBにはまだ登録しない）。
 * 通常のアップロードの①②にあたる。Google形式への変換では、
 * ここに置いたものをサーバーが Drive へ中継する（googleDrive.ts の uploadAsGoogleFile）。
 * @returns ストレージ上の保存キー
 */
export async function stageProjectFile(projectId: string, file: File): Promise<string> {
  const { path, token } = await postApi<{ path: string; token: string }>(
    "upload-url", { projectId, fileName: file.name });

  const { error } = await supabase!.storage.from("project-files")
    .uploadToSignedUrl(path, token, file, { contentType: file.type || "application/octet-stream" });
  if (error) throw new Error(error.message);
  return path;
}

/**
 * ストレージに置いた実体をDBに登録する（通常のアップロードの③）。
 * Google形式への変換に失敗したときも、置いた実体をこれで「そのまま保存」に切り替える。
 * @returns 実際に登録されたファイル名（改名された場合はその名前）
 */
export async function registerStagedFile(
  projectId: string, path: string, file: File,
  opts?: { uniqueName?: boolean; parentId?: string | null; fileId?: string },
): Promise<string> {
  const fileName = file.name;
  const targetParentId = opts?.parentId ?? (opts as any)?.parent_id ?? null;

  const res = await postApi<{ file: any; fileName?: string }>("register", {
    projectId, path, fileName, fileSize: file.size, fileType: file.type || "",
    uniqueName: !!opts?.uniqueName,
    parentId: targetParentId,
    fileId: opts?.fileId,
  });

  // 親フォルダは register が行と一緒に入れる（以前はここで何度も更新し直していた）。
  // 入っていないときだけ、登録された行を id 指定で1回だけ直す。
  if (isSupabaseEnabled && targetParentId && res.file?.id && res.file.parent_id !== targetParentId) {
    const { error: fixErr } = await supabase!.from("project_files")
      .update({ parent_id: targetParentId }).eq("id", res.file.id);
    if (fixErr) console.warn("[projectFiles] parent_id の設定に失敗しました", fixErr);
  }

  return res.fileName ?? fileName;
}

/**
 * デスクトップアプリから直接保存できる WebDAV URL を取得する。
 * Office はここへ Ctrl+S で PUT を投げ、サーバー側が新バージョンとして登録する。
 */
export async function fetchDavUrl(fileId: string): Promise<string> {
  const res = await postApi<{ url: string }>("dav-url", { fileId });
  return res.url;
}

/**
 * ファイル名を変更する。
 * (フォルダ, file_name) は版・コメント・WebDAV の引き当てキーなので、サーバー側で同名の全バージョンと
 * コメントをまとめて付け替える。拡張子は元のものが保たれ、同じフォルダに同名が既にあれば「(1)」が付く
 * （別フォルダの同名は関係ない）。
 * @returns 実際に登録された名前（重複回避で変わることがある）
 */
export async function renameProjectFile(fileId: string, newName: string): Promise<string> {
  const res = await postApi<{ fileName: string }>("rename", { fileId, newName });
  return res.fileName;
}

/** DB行とストレージ実体をまとめて削除する */
export async function deleteProjectFile(fileId: string): Promise<void> {
  await postApi<{ ok: boolean }>("delete", { fileId });
}

/** 
 * ダウンロード（URLエンコードされた日本語ファイル名をデコードし、正しいファイル名で保存する）
 */
export async function downloadProjectFile(fileId: string, fileName?: string): Promise<void> {
  const url = await fetchSignedUrl(fileId, "download");
  try {
    // 署名付きURLからBlobとしてファイルを取得
    const res = await fetchFileWithRetry(url);
    const blob = await res.blob();

    // ファイル名の特定（引数 > Content-Dispositionヘッダー）
    let name = fileName;
    if (!name) {
      const cd = res.headers.get("content-disposition");
      if (cd) {
        const match = cd.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
        if (match && match[1]) {
          name = match[1].replace(/^["']|["']$/g, "");
        }
      }
    }

    // URLエンコードされている場合は safeDecode して本来の日本語ファイル名に戻す
    if (name) {
      try {
        name = decodeURIComponent(name);
      } catch {
        // すでにデコード済みの場合はそのまま
      }
    }

    // 同一オリジンの Blob URL を作成することで、a.download のファイル名設定を確実に適用させる
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    if (name) {
      a.download = name;
    }
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    console.error("[downloadProjectFile] blob download error, fallbacking to direct url:", e);
    // フォールバック: 直接URLへ遷移
    window.location.href = url;
  }
}

/**
 * デスクトップの Office で開く。WebDAV URL を渡すので Ctrl+S がそのまま反映される。
 * @returns 対応形式でなければ false
 */
export async function openProjectFileInApp(fileId: string, fileName: string): Promise<boolean> {
  const proto = officeProtocolUrl(fileName, await fetchDavUrl(fileId));
  if (!proto) return false;
  window.location.href = proto;
  return true;
}

/** フォルダを作成する */
export async function createProjectFolder(
  projectId: string, folderName: string, parentId?: string | null, userName?: string,
): Promise<string> {
  const targetParentId = parentId ?? null;
  let query = supabase!
    .from("project_files")
    .select("file_name")
    .eq("project_id", projectId);

  if (targetParentId === null) {
    query = query.is("parent_id", null);
  } else {
    query = query.eq("parent_id", targetParentId);
  }

  const { data: existingItems } = await query;
  const existingNames = new Set((existingItems ?? []).map((item) => item.file_name));

  let finalName = folderName;
  if (existingNames.has(finalName)) {
    let counter = 1;
    while (existingNames.has(`${folderName} (${counter})`)) {
      counter++;
    }
    finalName = `${folderName} (${counter})`;
  }

  const { error } = await supabase!.from("project_files").insert({
    project_id: projectId,
    file_name: finalName,
    folder_path: "",
    file_size: 0,
    file_type: "folder",
    file_path: "",
    version: 1,
    uploaded_by: userName || "",
    parent_id: targetParentId,
    is_folder: true,
  });
  if (error) throw new Error(error.message);
  return finalName;
}

/**
 * フォルダの相対パスを順に辿り、無い階層だけ作って末端フォルダのIDを返す。
 * フォルダごとのアップロードで、元の階層をそのまま再現するために使う。
 *
 * createProjectFolder と違い、同名フォルダが既にあれば「(1)」を作らず**再利用する**。
 * 同じフォルダを2回アップロードしても階層が増殖しない。
 *
 * @param cache 1回のアップロード内で同じ階層を何度も引き直さないための作業用マップ。
 *   呼び出し側で1つ作り、全ファイルで使い回すこと。
 */
export async function ensureFolderPath(
  projectId: string,
  dirPath: string[],
  rootParentId: string | null,
  userName: string | undefined,
  cache: Map<string, string>,
): Promise<string | null> {
  let parentId = rootParentId;
  for (const rawName of dirPath) {
    const name = rawName.trim() || "無題のフォルダ";
    const key = `${parentId ?? ""}/${name}`;
    const cached = cache.get(key);
    if (cached) { parentId = cached; continue; }

    let query = supabase!.from("project_files")
      .select("id")
      .eq("project_id", projectId)
      .eq("file_name", name)
      .eq("is_folder", true);
    query = parentId === null ? query.is("parent_id", null) : query.eq("parent_id", parentId);
    // BUG-01 同名が複数あっても毎回同じ1件を選ぶ（順序を固定する）
    const { data: found, error: findErr } = await query
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(1);
    if (findErr) throw new Error(findErr.message);

    let id: string | undefined = found?.[0]?.id;
    if (!id) {
      const { data: created, error: insErr } = await supabase!.from("project_files").insert({
        project_id: projectId,
        file_name: name,
        folder_path: "",
        file_size: 0,
        file_type: "folder",
        file_path: "",
        version: 1,
        uploaded_by: userName || "",
        parent_id: parentId,
        is_folder: true,
      }).select("id").maybeSingle();
      if (insErr || !created) throw new Error(insErr?.message || `フォルダ「${name}」の作成に失敗しました`);
      id = created.id as string;
    }
    cache.set(key, id);
    parentId = id;
  }
  return parentId;
}
