import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import crypto from "crypto";

// ENHA2-035 ファイルボックス: WebDAV エンドポイント
//
// 目的は「Excel/Word で Ctrl+S したら DevTicket 側のファイルが差し替わる」こと。
// Office は ms-excel:ofe|u|<URL> で開いた URL に対して WebDAV で読み書きしようとするため、
// その最低限(OPTIONS/HEAD/GET/PROPFIND/LOCK/UNLOCK/PUT)を実装している。
//
// 認証: Office はアプリのログインセッション(JWT)を送ってこないので、
//       URL のパスに HMAC 署名付きトークンを埋めて本人性を担保する。
//       トークンは「プロジェクト + ファイル名」を指し、常に最新版に解決される。
//       (fileId 固定にすると、保存で版が増えた瞬間にトークンが古い版を指してしまう)
//
// 既知の制約:
//   - Vercel のリクエストボディ上限 4.5MB を超える保存は失敗する（エラーを返す）
//   - Office 側の WebDAV クライアントの相性で読み取り専用に落ちる場合がある

const BUCKET = "project-files";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12時間
const MAX_PUT_BYTES = 4.5 * 1024 * 1024;  // Vercel のリクエストボディ上限

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
};

export interface DavPayload { p: string; n: string; u: string; e: number }

function secret(): string {
  return process.env.DAV_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}
function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function signDavToken(payload: DavPayload): string {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}
function verifyDavToken(token: string): DavPayload | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expect = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  // 長さが違うと timingSafeEqual が例外を投げるので先に弾く
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) as DavPayload;
    return payload.e > Date.now() ? payload : null;
  } catch { return null; }
}

function admin(): SupabaseClient {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readRawBody(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks);
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  const method = String(req.method || "GET").toUpperCase();

  // Office は最初に OPTIONS で WebDAV 対応可否を確認する。
  // ここで DAV ヘッダを返さないと「読み取り専用」で開かれる。
  const davHeaders = () => {
    res.setHeader("DAV", "1,2");
    res.setHeader("MS-Author-Via", "DAV");
    res.setHeader("Allow", "OPTIONS,HEAD,GET,PUT,PROPFIND,LOCK,UNLOCK");
    res.setHeader("Public", "OPTIONS,HEAD,GET,PUT,PROPFIND,LOCK,UNLOCK");
  };

  const segs: string[] = Array.isArray(req.query?.path) ? req.query.path
    : String(req.query?.path ?? "").split("/").filter(Boolean);

  // トークンを含まないルートへの OPTIONS は、Office の WebDAV 探索なので
  // 機能の広告だけ返す（中身は一切返さない）。
  if (segs.length === 0) {
    if (method !== "OPTIONS") { res.statusCode = 404; return res.end("Not Found"); }
    davHeaders(); res.statusCode = 200; return res.end();
  }

  // ここから先はトークン必須。OPTIONS も例外にしない。
  const payload = verifyDavToken(segs[0]);
  if (!payload) { res.statusCode = 401; return res.end("Unauthorized"); }

  if (method === "OPTIONS") { davHeaders(); res.statusCode = 200; return res.end(); }

  let sb: SupabaseClient;
  try { sb = admin(); } catch { res.statusCode = 500; return res.end("Not configured"); }

  // Office は本体と同じ場所に "~$名前.xlsx"（誰が開いているかの目印）を読み書きする。
  // これを素通しすると目印ファイルの中身で本体を上書きしてしまうので受け流す。
  //
  // ★弾く条件は "~$" 始まりだけに限定すること。
  //  「トークンの名前と一致しないもの全部」を弾く作りにすると、ファイル名の
  //  Unicode正規化(NFC/NFD)やパーセントエンコードの差だけで本物の保存が対象になり、
  //  Office には 201(成功) を返しつつ中身を捨てる＝サイレントなデータ消失になる。
  const requestedName = segs.length >= 2 ? decodeURIComponent(segs[segs.length - 1]) : "";
  if (/^(~\$|\.~lock)/.test(requestedName)) {
    if (method === "PUT") { res.statusCode = 201; return res.end(); }   // 受けるが保存しない
    if (method === "DELETE" || method === "UNLOCK") { res.statusCode = 204; return res.end(); }
    if (method === "LOCK") { res.statusCode = 200; return res.end(); }
    res.statusCode = 404; return res.end("Not Found");
  }

  // トークンが指すファイルの最新版を引く
  const latest = async () => {
    const { data } = await sb.from("project_files")
      .select("id, file_name, file_size, file_path, version, created_at")
      .eq("project_id", payload.p).eq("file_name", payload.n)
      .order("version", { ascending: false }).limit(1);
    return data?.[0] ?? null;
  };

  // ★ Office は ETag で「サーバー上の実体が自分の知っているものと同じか」を判定する。
  //   特に PUT の応答で新しい ETag を返さないと、保存後にサーバー側が変化したように見え、
  //   自分の保存を「他ユーザーの更新」と誤認して競合ダイアログを出す。
  const etagOf = (r: { id: string; version: number }) => `"${r.id}-v${r.version}"`;

  const row = await latest();
  if (!row && method !== "PUT") { res.statusCode = 404; return res.end("Not Found"); }

  const href = `/api/dav/${segs.map(encodeURIComponent).join("/")}`;
  const contentType = MIME[extOf(payload.n)] ?? "application/octet-stream";

  if (method === "HEAD" || method === "GET") {
    const etag = etagOf(row!);

    // 条件付きリクエストに応える。Office が持っている版が最新と同じなら 304 を返し、
    // 「手元のコピーは最新である」と確定させる。これが無いと Office は判断できず、
    // 開くたびに「サーバーに新しい版があります」と促してくる。
    const inm = String(req.headers["if-none-match"] ?? "");
    if (inm && inm.split(",").some(v => v.trim() === etag)) {
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-cache, must-revalidate");
      res.statusCode = 304;
      return res.end();
    }

    const { data: blob, error } = await sb.storage.from(BUCKET).download(row!.file_path);
    if (error || !blob) { res.statusCode = 404; return res.end("Not Found"); }
    const buf = Buffer.from(await blob.arrayBuffer());
    davHeaders();
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(buf.length));
    res.setHeader("Last-Modified", new Date(row!.created_at).toUTCString());
    res.setHeader("ETag", etag);
    // 使い回さず毎回検証させる（検証自体は上の 304 で安く済む）
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.setHeader("Accept-Ranges", "none");
    res.statusCode = 200;
    return method === "HEAD" ? res.end() : res.end(buf);
  }

  if (method === "PROPFIND") {
    davHeaders();
    res.setHeader("Content-Type", 'application/xml; charset="utf-8"');
    res.statusCode = 207;
    return res.end(`<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>${href}</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype/>
        <D:displayname>${payload.n.replace(/[<&]/g, "")}</D:displayname>
        <D:getcontentlength>${row!.file_size}</D:getcontentlength>
        <D:getcontenttype>${contentType}</D:getcontenttype>
        <D:getlastmodified>${new Date(row!.created_at).toUTCString()}</D:getlastmodified>
        <D:getetag>${etagOf(row!)}</D:getetag>
        <D:supportedlock>
          <D:lockentry>
            <D:lockscope><D:exclusive/></D:lockscope>
            <D:locktype><D:write/></D:locktype>
          </D:lockentry>
        </D:supportedlock>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`);
  }

  // ロックは実際の排他制御まではせず、Office が編集モードに入るための応答を返す。
  // (同時編集の競合は「保存のたびに版が増える」ことで失われないようにしている)
  if (method === "LOCK") {
    const lockToken = `opaquelocktoken:${crypto.randomUUID()}`;
    davHeaders();
    res.setHeader("Lock-Token", `<${lockToken}>`);
    res.setHeader("Content-Type", 'application/xml; charset="utf-8"');
    res.statusCode = 200;
    return res.end(`<?xml version="1.0" encoding="utf-8"?>
<D:prop xmlns:D="DAV:">
  <D:lockdiscovery>
    <D:activelock>
      <D:locktype><D:write/></D:locktype>
      <D:lockscope><D:exclusive/></D:lockscope>
      <D:depth>0</D:depth>
      <D:owner>${payload.u.replace(/[<&]/g, "")}</D:owner>
      <D:timeout>Second-3600</D:timeout>
      <D:locktoken><D:href>${lockToken}</D:href></D:locktoken>
      <D:lockroot><D:href>${href}</D:href></D:lockroot>
    </D:activelock>
  </D:lockdiscovery>
</D:prop>`);
  }

  if (method === "UNLOCK") { davHeaders(); res.statusCode = 204; return res.end(); }

  if (method === "PUT") {
    const body = await readRawBody(req);
    if (body.length === 0) { res.statusCode = 400; return res.end("Empty body"); }
    if (body.length > MAX_PUT_BYTES) {
      // 黙って壊れるより、はっきり失敗させる（Office 側に保存エラーとして表示される）
      res.statusCode = 413;
      return res.end("File too large for WebDAV save (limit 4.5MB)");
    }

    const ext = extOf(payload.n);
    const path = `${payload.p}/${Date.now()}_${crypto.randomBytes(3).toString("hex")}${ext ? `.${ext}` : ""}`;
    const { error: upErr } = await sb.storage.from(BUCKET)
      .upload(path, body, { contentType, upsert: false });
    if (upErr) { res.statusCode = 500; return res.end(upErr.message); }

    const { data: inserted, error: insErr } = await sb.from("project_files").insert({
      project_id: payload.p, folder_path: "", file_name: payload.n,
      file_size: body.length, file_type: contentType, file_path: path,
      version: (row?.version ?? 0) + 1, uploaded_by: payload.u,
    }).select("id, version, created_at").maybeSingle();
    if (insErr || !inserted) {
      await sb.storage.from(BUCKET).remove([path]);
      res.statusCode = 500; return res.end(insErr?.message ?? "Insert failed");
    }

    davHeaders();
    // 保存で作った新しい版の ETag / Last-Modified を必ず返す。
    // これが無いと Office は自分の保存を他ユーザーの更新と誤認して競合を出す。
    res.setHeader("ETag", etagOf(inserted));
    res.setHeader("Last-Modified", new Date(inserted.created_at).toUTCString());
    // 更新時は 204 ではなく 200 を返す。204(No Content) だと Office が
    // 応答ヘッダの ETag を取り込まないことがあり、保存直後にまた更新を促される。
    res.statusCode = row ? 200 : 201;
    return res.end();
  }

  res.statusCode = 405;
  return res.end("Method Not Allowed");
}
