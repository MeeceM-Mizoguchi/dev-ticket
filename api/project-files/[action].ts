import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ENHA2-035 ファイルボックス
// project-files バケットは非公開。クライアントは storage を直接叩かず、
// 全ての操作をここ(service_role)経由に寄せている。理由は2つ:
//   1. アップロード/閲覧/削除のたびに「プロジェクトメンバーか」をサーバーで検証できる
//   2. storage.objects の RLS ポリシーが一切不要になる
//      (Supabase の SQL Editor では storage.objects にポリシーを作れないため、
//       Dashboard での手作業を前提にしない設計にしている)
//
// アップロードは署名付きアップロードURLを発行してブラウザ→ストレージへ直接送る。
// サーバーレス関数の body を経由しないので、Vercel のリクエストサイズ上限に縛られない。
//
// endpoints (Vercel の [action] 動的セグメント):
//   POST /api/project-files/upload-url  { projectId, fileName }  → { path, token }
//   POST /api/project-files/register    { projectId, path, fileName, fileSize, fileType, parentId? } → { file }
//   POST /api/project-files/signed-url  { fileId, mode }         → { url, ... }
//   POST /api/project-files/rename      { fileId, newName }        → { fileName }
//   POST /api/project-files/delete      { fileId }               → { ok: true }

const BUCKET = "project-files";
const SIGNED_URL_TTL_SEC = 60;
const DAV_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

// ★ api/dav/[...path].ts の verifyDavToken と対になっている。
//   片方だけ変えると WebDAV 保存が 401 になるので必ず両方あわせて直すこと。
//   (api/ 配下のルートファイル同士を import し合わないよう、あえて複製している)
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signDavToken(payload: { p: string; n: string; u: string; e: number; f?: string }): string {
  const secret = process.env.DAV_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret).update(body).digest());
  return `${body}.${sig}`;
}

// @vercel/node の型チェックが auth.getUser を解決できないケースがあるため型だけ緩める
// (api/webauthn/[action].ts と同じ回避)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthLike = { getUser: (jwt?: string) => Promise<{ data: { user: any }; error: any }> };

function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// Authorization: Bearer <access_token> からプロフィールを引く
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getProfile(sb: SupabaseClient, req: any) {
  const header: string = req.headers?.authorization || req.headers?.Authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;
  const { data, error } = await (sb.auth as unknown as AuthLike).getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await sb.from("profiles").select("name, role").eq("id", data.user.id).maybeSingle();
  return profile ? { ...profile, id: data.user.id as string } : null;
}

// そのプロジェクトを見てよい人か。
//
// BRU14-001 まではここが `role === "admin"` で即 true を返しており、
// 組織を一切見ていなかった。A社の管理者がB社のプロジェクトIDを指定すれば、
// 非公開バケットのファイルに署名付きURLが発行できてしまう状態だった。
// 判定は DB の can_user_access_project() に寄せる。RLS と同じ1本の規則を使うため、
// 「画面は絞れているのにAPIは絞れていない」がここで再発しない。
async function isMember(sb: SupabaseClient, projectId: string, profile: { id: string }) {
  const { data, error } = await sb.rpc("can_user_access_project", {
    p_user_id: profile.id,
    p_project_id: projectId,
  });
  // 関数が無い(=マイグレーション未適用)ときは通さない。
  if (error) return false;
  return data === true;
}

// Google形式（スプレッドシート・ドキュメント・スライド等）の MIME タイプの接頭辞。
// Googleドライブ上のファイルでも、Google形式でないもの（Office文書・PDF・draw.io 図など）は
// 拡張子を持つので、改名のときに扱いを分ける。
const GOOGLE_NATIVE_PREFIX = "application/vnd.google-apps.";

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

// 先頭ドット（.gitignore 等）は拡張子扱いしない
function splitName(fileName: string): { base: string; ext: string } {
  const i = fileName.lastIndexOf(".");
  return i > 0 ? { base: fileName.slice(0, i), ext: fileName.slice(i) } : { base: fileName, ext: "" };
}

// 保存キーやURLを壊す文字を落とす。パス区切りは階層を作られないよう潰す。
function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "").trim().replace(/^\.+/, "").slice(0, 200).trim();
}

/**
 * 同名が既にあれば「foo (1).xlsx」「foo (2).xlsx」…と空き番号を探す。
 * 手動アップロードで既存ファイルの新バージョンにされてしまうのを避けるため。
 */
function nextFreeName(fileName: string, taken: Set<string>): string {
  if (!taken.has(fileName)) return fileName;
  const { base, ext } = splitName(fileName);
  // 既に「foo (1)」なら「foo (1) (1)」ではなく「foo (2)」へ続ける
  const stem = base.replace(/ \(\d+\)$/, "");
  for (let n = 1; n <= 999; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * 同じフォルダの行だけに絞る（parentId が null ならルート直下）。
 *
 * ファイルの引き当てキーは (project_id, parent_id, file_name)。
 * 以前は (project_id, file_name) だったため、別フォルダに同名があるだけで
 * アップロードや改名に「(1)」が付いていた。版・改名・削除・重複判定はすべてこの範囲で行う。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inFolder<Q extends { eq: any; is: any }>(q: Q, parentId: string | null): Q {
  return parentId ? q.eq("parent_id", parentId) : q.is("parent_id", null);
}

/** そのファイルの全版の id（コメントは file_id でどのファイルのものかを見分ける） */
async function versionIdsOf(sb: SupabaseClient, projectId: string, parentId: string | null, fileName: string) {
  const { data } = await inFolder(sb.from("project_files")
    .select("id").eq("project_id", projectId).eq("file_name", fileName), parentId);
  return (data ?? []).map(r => String(r.id));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method Not Allowed" });

  const action = String(req.query?.action ?? "");
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body ?? {});

  let sb: SupabaseClient;
  try { sb = admin(); } catch { return res.status(500).json({ error: "Supabase not configured" }); }

  const profile = await getProfile(sb, req);
  if (!profile) return res.status(401).json({ error: "Unauthorized" });

  // ── アップロード用の署名付きURLを発行 ──────────────────────
  if (action === "upload-url") {
    const projectId = String(body.projectId ?? "");
    const fileName = String(body.fileName ?? "");
    if (!projectId || !fileName) return res.status(400).json({ error: "projectId and fileName are required" });
    if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });

    // 保存キーはサーバーが決める（クライアントに任意パスを書かせない）。
    // 日本語ファイル名をキーに使わないため、表示名は register 時にDBへ保存する。
    const ext = extOf(fileName);
    const path = `${projectId}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext ? `.${ext}` : ""}`;

    const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (error || !data) return res.status(500).json({ error: error?.message || "Failed to create upload URL" });
    return res.json({ path: data.path, token: data.token });
  }

  // ── アップロード完了後のDB登録 ─────────────────────────────
  if (action === "register") {
    const projectId = String(body.projectId ?? "");
    const path = String(body.path ?? "");
    let fileName = String(body.fileName ?? "");
    if (!projectId || !path || !fileName) return res.status(400).json({ error: "projectId, path and fileName are required" });
    if (!(await isMember(sb, projectId, profile))) return res.status(403).json({ error: "Forbidden" });
    // 他プロジェクト配下のオブジェクトを自プロジェクトの行として登録させない
    if (!path.startsWith(`${projectId}/`)) return res.status(400).json({ error: "Invalid path" });

    // 置き場所のフォルダ。フォルダごとのアップロードで階層を再現するために受け取る。
    // 他プロジェクトのフォルダや、フォルダでない行を親に指定させない。
    // 不正なら storage の実体を残さず弾く（DB登録失敗と同じ扱い）。
    const rawParentId = body.parentId ?? body.parent_id ?? body.folderId ?? null;
    let parentId: string | null = null;
    if (rawParentId) {
      const { data: parent } = await sb.from("project_files")
        .select("id, project_id, is_folder").eq("id", String(rawParentId)).maybeSingle();
      if (!parent || parent.project_id !== projectId || !parent.is_folder) {
        await sb.storage.from(BUCKET).remove([path]);
        return res.status(400).json({ error: "保存先のフォルダが見つかりません" });
      }
      parentId = String(parent.id);
    }

    // 手動アップロード（uniqueName）は「既存ファイルの新バージョン」ではなく別ファイルとして扱う。
    // エディタ保存・WebDAV保存はフラグを立てないので、これまで通り版が上がる。
    // 重複を避けるのは同じフォルダの中だけ（別フォルダの同名は別ファイル）。
    if (body.uniqueName) {
      const { data: rows } = await inFolder(sb.from("project_files")
        .select("file_name").eq("project_id", projectId), parentId);
      fileName = nextFreeName(fileName, new Set((rows ?? []).map(r => String(r.file_name))));
    }

    // 版番号はサーバーで採番する（クライアント側の一覧が古くても衝突しない）
    const { data: sameName } = await inFolder(sb.from("project_files")
      .select("version").eq("project_id", projectId).eq("file_name", fileName), parentId)
      .order("version", { ascending: false }).limit(1);
    const version = (sameName?.[0]?.version ?? 0) + 1;

    const { data: inserted, error } = await sb.from("project_files").insert({
      project_id: projectId, folder_path: "", file_name: fileName,
      file_size: Number(body.fileSize) || 0, file_type: String(body.fileType ?? ""),
      file_path: path, version, uploaded_by: profile.name,
      // ルート直下のときは列に触れない（旧スキーマでも動くようにするため）
      ...(parentId ? { parent_id: parentId } : {}),
    }).select().maybeSingle();
    if (error) {
      // DB登録に失敗したらストレージ上の孤児を残さない
      await sb.storage.from(BUCKET).remove([path]);
      return res.status(500).json({ error: error.message });
    }
    // 改名した場合があるので、実際に登録した名前を返す
    return res.json({ file: inserted, fileName });
  }

  // ── 閲覧/DL用の短命な署名付きURLを発行 ──────────────────────
  if (action === "signed-url") {
    const fileId = String(body.fileId ?? "");
    const mode = body.mode === "download" ? "download" : "inline";
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name, file_type, file_path, external_provider, external_url").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });

    // Googleドライブ上のファイルは storage に実体が無い。署名付きURLは発行できないので、
    // 開く先(webViewLink)をそのまま返す（docs/google-drive-integration-design.md 9.2）
    if (file.external_provider === "google") {
      if (!file.external_url) return res.status(404).json({ error: "このファイルのURLが見つかりません" });
      return res.json({ url: file.external_url, fileName: file.file_name, fileType: file.file_type, external: true });
    }

    const { data: signed, error } = await sb.storage.from(BUCKET)
      .createSignedUrl(file.file_path, SIGNED_URL_TTL_SEC,
        mode === "download" ? { download: file.file_name } : undefined);
    if (error || !signed?.signedUrl) return res.status(500).json({ error: error?.message || "Failed to sign URL" });
    return res.json({ url: signed.signedUrl, fileName: file.file_name, fileType: file.file_type, expiresIn: SIGNED_URL_TTL_SEC });
  }

  // ── アプリで開く用の WebDAV URL を発行 ──────────────────────
  // Office はアプリのログインセッションを送ってこないため、URLに署名トークンを埋める。
  // トークンは「プロジェクト+ファイル名」を指すので、保存で版が増えても失効しない。
  if (action === "dav-url") {
    const fileId = String(body.fileId ?? "");
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name, parent_id, external_provider").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });
    // Googleドライブ上のファイルは storage に実体が無く、WebDAV で開く対象にならない
    if (file.external_provider === "google") {
      return res.status(400).json({ error: "Googleドライブ上のファイルはデスクトップアプリで開けません" });
    }

    // 有効期限は固定の時間枠に丸める。毎回 Date.now()+TTL にすると
    // 「アプリで開く」のたびにトークン＝URLが変わり、Office のドキュメントキャッシュが
    // 同じファイルを別物と見なして、開くたびに更新を促してくる。
    // 枠に丸めることで、同じファイルなら同じURLになる（有効期間は 12〜24時間）。
    const slot = (Math.floor(Date.now() / DAV_TOKEN_TTL_MS) + 2) * DAV_TOKEN_TTL_MS;
    // f = 置き場所のフォルダ（""=ルート）。別フォルダに同名のファイルがありうるので、
    // 名前だけでは「どのファイルか」が決まらない。
    const token = signDavToken({
      p: file.project_id, n: file.file_name, u: profile.name, e: slot, f: file.parent_id ?? "",
    });
    const proto = String(req.headers["x-forwarded-proto"] ?? "https");
    const base = process.env.PUBLIC_URL || `${proto}://${req.headers.host}`;
    // URL 末尾を実ファイル名にしておくと、Office のタイトルバーに正しい名前が出る
    return res.json({ url: `${base}/api/dav/${token}/${encodeURIComponent(file.file_name)}` });
  }

  // ── 名前の変更（同名ファイルの全バージョン + コメントの引き当てキー） ──
  // (parent_id, file_name) は「どのファイルか」を指す引き当てキーそのもの（版・コメント・
  // WebDAV がこれで引く）。1行だけ書き換えると版が分裂し、コメントも迷子になるので、
  // 削除と同じ粒度＝同じフォルダの同名の全行をまとめて付け替える。
  if (action === "rename") {
    const fileId = String(body.fileId ?? "");
    const rawName = String(body.newName ?? "");
    if (!fileId || !rawName.trim()) return res.status(400).json({ error: "fileId and newName are required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name, file_type, parent_id, is_folder, external_provider").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });
    const parentId: string | null = file.parent_id ?? null;

    // Googleドライブ上のファイルは版を持たない。フォルダと同じく1行だけを書き換える。
    const isSingleRow = file.is_folder || file.external_provider === "google";
    // 拡張子を持たないのは Google形式（スプレッドシート等）とフォルダだけ。
    // Drive 上の draw.io 図・Office文書・PDF などは拡張子がファイルの種別そのものなので、
    // 落とすと Drive 上でも DevTicket 上でも何のファイルか分からなくなる。必ず保つ。
    const keepExt = !file.is_folder
      && (!isSingleRow || !String(file.file_type ?? "").startsWith(GOOGLE_NATIVE_PREFIX));

    let newName = sanitizeFileName(rawName);
    if (!newName) return res.status(400).json({ error: "使用できない名前です" });

    // 拡張子はファイルの種別そのもの（ビューアの判定・Officeの起動・保存キーの拡張子）。
    // 消したり書き換えたりされると開けないファイルになるため、元の拡張子を必ず保つ。
    if (keepExt) {
      const orgExt = splitName(String(file.file_name)).ext;
      if (orgExt && splitName(newName).ext.toLowerCase() !== orgExt.toLowerCase()) {
        newName = `${splitName(newName).base}${orgExt}`;
      }
    }

    if (newName === file.file_name) return res.json({ fileName: newName });

    // 版番号の採番・手動アップロード時の重複回避と同じく、同じフォルダの中だけで重複を避ける
    // （自分自身の版は除く）。別フォルダの同名は別ファイルなので気にしない。
    const { data: rows } = await inFolder(sb.from("project_files")
      .select("file_name").eq("project_id", file.project_id).neq("file_name", file.file_name), parentId);
    newName = nextFreeName(newName, new Set((rows ?? []).map(r => String(r.file_name))));

    // コメントの付け替え対象を、名前を変える前に押さえておく（版の id で引く）
    const versionIds = isSingleRow ? [] : await versionIdsOf(sb, file.project_id, parentId, file.file_name);

    // フォルダとGoogleファイルは版もコメントも持たず、別の階層に同名が並びうる。
    // 巻き込み更新をしていいのはファイル（＝同じフォルダの同名が同一ファイルの版）だけ。
    const update = sb.from("project_files").update({ file_name: newName });
    const { error } = await (isSingleRow
      ? update.eq("id", fileId)
      : inFolder(update.eq("project_id", file.project_id).eq("file_name", file.file_name), parentId));
    if (error) return res.status(500).json({ error: error.message });

    // コメント(BRU12-025)は project_files への FK を持たず (project_id, file_name) で引くので、
    // ここで一緒に付け替えないとリネームした瞬間に全部見えなくなる。
    // 別フォルダの同名ファイルのコメントを巻き込まないよう、このファイルの版に付いたものだけ。
    if (versionIds.length > 0) {
      const { error: cErr } = await sb.from("project_file_comments")
        .update({ file_name: newName })
        .eq("project_id", file.project_id).in("file_id", versionIds);
      if (cErr) console.error("[project-files] comment rename failed:", cErr.message);
    }

    return res.json({ fileName: newName });
  }

  // ── 削除（同名ファイルの全バージョン + ストレージ実体） ──────
  if (action === "delete") {
    const fileId = String(body.fileId ?? "");
    if (!fileId) return res.status(400).json({ error: "fileId is required" });

    const { data: file } = await sb.from("project_files")
      .select("project_id, file_name, parent_id, external_provider").eq("id", fileId).maybeSingle();
    if (!file) return res.status(404).json({ error: "File not found" });
    if (!(await isMember(sb, file.project_id, profile))) return res.status(403).json({ error: "Forbidden" });
    const parentId: string | null = file.parent_id ?? null;

    // ★ Googleファイルは「その1行だけ」を id で消す。
    //   通常のファイルは同名＝同じファイルの別バージョンなので file_name でまとめて消してよいが、
    //   Googleファイルに版の概念は無く、名前は Google 側で自由に変えられる。
    //   名前で引くと、たまたま同名になった無関係なファイルまで巻き添えで消える。
    if (file.external_provider === "google") {
      const { error } = await sb.from("project_files").delete().eq("id", fileId);
      if (error) return res.status(500).json({ error: error.message });
      // Googleドライブ上の実体にはここでは触れない（storage にも実体は無い）。
      // Drive 側をゴミ箱へ入れるかは利用者が確認ダイアログで選び、
      // 選ばれたときだけクライアントが「先に」 api/google/trash を呼ぶ（設計書 2章 決定事項8）。
      // ★ 順序が逆になるとこの行が消え、実体を指す external_id ごと失われて手が出せなくなる。
      return res.json({ ok: true, deleted: 0 });
    }

    // 一覧は最新版だけを見せているので、削除も同じフォルダの同名の全版をまとめて消す。
    // (最新版だけ消すと、画面上は古い版が復活したように見えてしまう)
    // 別フォルダの同名は別ファイルなので巻き込まない。
    const { data: all } = await inFolder(sb.from("project_files")
      .select("id, file_path").eq("project_id", file.project_id).eq("file_name", file.file_name), parentId);
    const ids = (all ?? []).map(r => String(r.id));
    const paths = (all ?? []).map(r => r.file_path).filter(Boolean);

    const { error } = await inFolder(sb.from("project_files")
      .delete().eq("project_id", file.project_id).eq("file_name", file.file_name), parentId);
    if (error) return res.status(500).json({ error: error.message });
    if (paths.length) await sb.storage.from(BUCKET).remove(paths);

    // コメント(BRU12-025)は版をまたぐため project_files への FK を持たない＝
    // 行を消しても連鎖しない。このファイルの版に付いたものをここで一緒に片付ける（孤児を残さない）。
    if (ids.length > 0) {
      const { error: cErr } = await sb.from("project_file_comments")
        .delete().eq("project_id", file.project_id).in("file_id", ids);
      if (cErr) console.error("[project-files] comment cleanup failed:", cErr.message);
    }

    return res.json({ ok: true, deleted: paths.length });
  }

  return res.status(404).json({ error: "Unknown action" });
}
