// ENHA2-056 高度検索：ファイルボックスのファイルの中の文字を取り出して保存する（サーバー側API共通）。
//
//   対象: Excel（.xlsx）・Word（.docx）・PDF（文字のデータがあるもの）・PowerPoint（.pptx）、
//         Googleのドキュメント・スプレッドシート・スライド（api/google/[action].ts の extract-text から）
//   対象外: 古い形式（.xls・.doc・.ppt）、画像だけのPDF、そのほかの形式（理由を error に残す）
//
// 保存先は project_file_texts（supabase/add_project_file_texts.sql）。1行 = project_files の1行（＝1つの版）。
// 取り出しに失敗しても、アップロードやファイルを開く処理は失敗にしない（呼び出し側は結果を待たないか、握りつぶす）。
//
// 呼ばれる所:
//   ・api/project-files/[action].ts … アップロードの登録（register）・版を戻す（restore-version）のあと、
//     応答を返してから裏で取り出す（waitUntil）。既存のファイルの一括取り出し（extract-text-backfill）
//   ・api/dav-open.ts               … Office から保存して新しい版ができたあと（同じく裏で）
//   ・api/google/[action].ts        … Googleのファイルを開いたとき（開いた人の権限で書き出す）
import type { SupabaseClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import { unzipSync, strFromU8 } from "fflate";
import { extractText as extractPdfText } from "unpdf";

/** 1ファイルから保存する文字数の上限（超えた分は捨てる） */
export const MAX_FILE_TEXT_CHARS = 200_000;
/** これより大きいファイルは取り出さない（関数の実行時間・メモリに収めるため） */
export const MAX_EXTRACT_BYTES = 30 * 1024 * 1024;

const BUCKET = "project-files";

export type FileTextKind = "xlsx" | "docx" | "pptx" | "pdf";
export type ExtractResult = { ok: true; text: string } | { ok: false; error: string };

const GOOGLE_NATIVE = {
  document: "application/vnd.google-apps.document",
  spreadsheet: "application/vnd.google-apps.spreadsheet",
  presentation: "application/vnd.google-apps.presentation",
} as const;

function extOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

/** 取り出せる形式なら種類を返す。古い形式・対象外は null（理由は unsupportedReason） */
export function fileTextKind(fileName: string): FileTextKind | null {
  const ext = extOf(fileName);
  return ext === "xlsx" || ext === "docx" || ext === "pptx" || ext === "pdf" ? ext : null;
}

export function unsupportedReason(fileName: string): string {
  const ext = extOf(fileName);
  if (ext === "xls" || ext === "doc" || ext === "ppt") return `古い形式（.${ext}）のため、文字を取り出していません`;
  return ext ? `.${ext} のファイルは文字の取り出しの対象外です` : "拡張子が無いため、文字の取り出しの対象外です";
}

/** 空白行を詰め、上限で切る */
function finish(text: string): string {
  const cleaned = text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length > MAX_FILE_TEXT_CHARS ? cleaned.slice(0, MAX_FILE_TEXT_CHARS) : cleaned;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

async function xlsxText(buf: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // exceljs の型は古い Buffer を想定しているため、型だけ合わせる
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: string[] = [];
  wb.eachSheet(ws => {
    out.push(`【${ws.name}】`);
    ws.eachRow({ includeEmpty: false }, row => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, cell => {
        const t = String(cell.text ?? "").trim();
        if (t) cells.push(t);
      });
      if (cells.length) out.push(cells.join("\t"));
    });
    out.push("");
  });
  return out.join("\n");
}

async function docxText(buf: Buffer): Promise<string> {
  const r = await mammoth.extractRawText({ buffer: buf });
  return r.value ?? "";
}

/** スライドの XML（ppt/slides/slideN.xml）から、段落ごとに <a:t> の文字を拾う */
function pptxText(buf: Buffer): string {
  const files = unzipSync(new Uint8Array(buf), { filter: f => /^ppt\/slides\/slide\d+\.xml$/.test(f.name) });
  const names = Object.keys(files).sort((a, b) => Number(a.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(b.match(/(\d+)\.xml$/)?.[1] ?? 0));
  const out: string[] = [];
  names.forEach((name, i) => {
    const xml = strFromU8(files[name]);
    const paras = xml.split(/<\/a:p>/).map(p => Array.from(p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)).map(m => decodeXml(m[1])).join("")).filter(s => s.trim());
    out.push(`【スライド${i + 1}】`, ...paras, "");
  });
  return out.join("\n");
}

async function pdfText(buf: Buffer): Promise<string> {
  const r = await extractPdfText(new Uint8Array(buf), { mergePages: true });
  return r.text ?? "";
}

/** ファイルの中身（バイト列）から文字を取り出す */
export async function extractFromBuffer(kind: FileTextKind, buf: Buffer): Promise<ExtractResult> {
  if (buf.length > MAX_EXTRACT_BYTES) return { ok: false, error: `ファイルが大きすぎるため（${Math.round(MAX_EXTRACT_BYTES / 1024 / 1024)}MB まで）、文字を取り出していません` };
  try {
    const raw = kind === "xlsx" ? await xlsxText(buf)
      : kind === "docx" ? await docxText(buf)
        : kind === "pptx" ? pptxText(buf)
          : await pdfText(buf);
    const text = finish(raw);
    if (!text) {
      return { ok: false, error: kind === "pdf" ? "文字のデータがありません（画像だけのPDFは対象外です）" : "文字が見つかりませんでした" };
    }
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: `文字を取り出せませんでした: ${String(e?.message ?? e).slice(0, 300)}` };
  }
}

export interface FileTextRow {
  id: string; project_id: string; file_name: string; file_type?: string | null; file_path?: string | null;
  version?: number | null; external_provider?: string | null; is_folder?: boolean | null; file_size?: number | null;
}

/** 取り出した結果を保存する（同じ版の行は上書き）。テーブルが無いなどで失敗したら、その理由を返す */
export async function saveFileText(
  sb: SupabaseClient, row: FileTextRow, result: ExtractResult, source: "storage" | "google",
): Promise<string | null> {
  const { error } = await sb.from("project_file_texts").upsert({
    file_id: row.id,
    project_id: row.project_id,
    text: result.ok ? result.text : "",
    extracted_version: row.version ?? null,
    source,
    error: result.ok ? null : result.error,
    extracted_at: new Date().toISOString(),
  }, { onConflict: "file_id" });
  return error ? error.message : null;
}

const STORED_COLS = "id, project_id, file_name, file_type, file_path, version, external_provider, is_folder, file_size";

/**
 * ストレージにあるファイル（アップロードしたもの）の文字を取り出して保存する。
 * Googleドライブ上のファイル・フォルダは対象外（Googleは開いたときに api/google の extract-text が行う）。
 * 失敗しても例外は投げない（呼び出し側の処理を止めないため）。
 */
export async function extractStoredFileText(sb: SupabaseClient, fileId: string): Promise<{ ok: boolean; error?: string; skipped?: string }> {
  try {
    const { data: row, error } = await sb.from("project_files").select(STORED_COLS).eq("id", fileId).maybeSingle();
    if (error || !row) return { ok: false, error: error?.message ?? "ファイルが見つかりません" };
    const r = row as FileTextRow;
    if (r.is_folder || r.external_provider === "google" || !r.file_path) return { ok: false, skipped: "not-stored" };

    const kind = fileTextKind(r.file_name);
    let result: ExtractResult;
    if (!kind) {
      result = { ok: false, error: unsupportedReason(r.file_name) };
    } else if ((r.file_size ?? 0) > MAX_EXTRACT_BYTES) {
      result = { ok: false, error: `ファイルが大きすぎるため（${Math.round(MAX_EXTRACT_BYTES / 1024 / 1024)}MB まで）、文字を取り出していません` };
    } else {
      const { data: blob, error: dlError } = await sb.storage.from(BUCKET).download(r.file_path);
      result = dlError || !blob
        ? { ok: false, error: `ファイルを読み込めませんでした: ${dlError?.message ?? ""}` }
        : await extractFromBuffer(kind, Buffer.from(await blob.arrayBuffer()));
    }
    const saveError = await saveFileText(sb, r, result, "storage");
    if (saveError) {
      console.error("[fileText] save failed:", saveError);
      return { ok: false, error: saveError };
    }
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (e: any) {
    console.error("[fileText] extract failed:", e?.message ?? e);
    return { ok: false, error: String(e?.message ?? e) };
  }
}

/** Googleの形式なら、Drive API で書き出すときの形式を返す。Google形式でなければ null */
export function googleExportPlan(mimeType: string | null | undefined): { mime: string; kind: "plain" | "xlsx" } | null {
  if (mimeType === GOOGLE_NATIVE.document || mimeType === GOOGLE_NATIVE.presentation) return { mime: "text/plain", kind: "plain" };
  // スプレッドシートの text/csv 書き出しは最初のシートだけなので、全シートを読めるよう xlsx で書き出す
  if (mimeType === GOOGLE_NATIVE.spreadsheet) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "xlsx" };
  return null;
}

/** Drive から書き出した中身を、保存する文字にする */
export async function textFromGoogleExport(kind: "plain" | "xlsx", buf: Buffer): Promise<ExtractResult> {
  if (kind === "xlsx") return extractFromBuffer("xlsx", buf);
  // 先頭の BOM（U+FEFF）を落とす
  const text = finish(buf.toString("utf8").replace(new RegExp("^\\uFEFF"), ""));
  return text ? { ok: true, text } : { ok: false, error: "文字が見つかりませんでした" };
}
