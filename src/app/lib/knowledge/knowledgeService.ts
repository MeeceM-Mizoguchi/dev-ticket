// ナレッジノート: 取り込み・索引・検索のサービス層。
// 画面はここだけを呼ぶ（Supabase と Worker の詳細を画面に漏らさない）。

import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type {
  KnowledgeDocument, KnowledgeChunk, KnowledgeSearchHit, KnowledgeImportProgress, KnowledgeFolder,
} from "@/app/types";
import { mapKnowledgeDocument, mapKnowledgeHit, mapKnowledgeChunk, mapKnowledgeFolder } from "@/app/lib/mappers";
import {
  chunkMarkdown, normalizeText, toPassageInput, toQueryInput, hashContent,
} from "./chunk";
import { embedAll, embedOne, toVectorLiteral, EMBEDDING_MODEL, getUnavailableReason } from "./embed";

/** 取り込めるファイル。RichEditor の MD 取り込み(BRU10-043)と揃える */
export const KNOWLEDGE_FILE_EXTENSIONS = [".md", ".markdown", ".mdown", ".mkd", ".txt"];
export const KNOWLEDGE_FILE_ACCEPT = KNOWLEDGE_FILE_EXTENSIONS.join(",");
export const KNOWLEDGE_FILE_MAX_BYTES = 2 * 1024 * 1024;

/** 一覧では原文(content)を引かない。数百KB × 件数を毎回転送しないため */
const LIST_COLUMNS =
  "id, project_id, folder_id, title, file_name, content_hash, byte_size, tags, chunk_count, indexed_at, embedding_model, uploaded_by, created_at, updated_at";

const CHUNK_INSERT_BATCH = 200;
const EMBED_WRITE_BATCH = 50;

export function isKnowledgeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return KNOWLEDGE_FILE_EXTENSIONS.some(ext => name.endsWith(ext));
}

/**
 * 資料を取り出す（ダウンロードする）ときのファイル名。
 *
 * 取り込んだときの名前をそのまま返すのが基本。
 * 資料名を変更していても、元のファイル名で保存された方が
 * 手元の同じファイルを上書き・差し替えしやすい。
 * file_name が空の古いデータもあるので、その場合はタイトルから作る。
 */
export function downloadFileName(doc: { fileName?: string | null; title?: string | null }): string {
  const raw = (doc.fileName ?? "").trim() || `${(doc.title ?? "").trim() || "document"}.md`;
  // Windows で使えない文字だけ落とす。拡張子が無ければ .md を付ける
  const safe = raw.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim() || "document.md";
  return KNOWLEDGE_FILE_EXTENSIONS.some(ext => safe.toLowerCase().endsWith(ext)) ? safe : `${safe}.md`;
}

/**
 * 「supabase/add_knowledge_ai.sql が未適用」に起因するエラーかどうか。
 *
 * この機能は専用テーブルとRPCを使うため、SQL 未適用だと PostgREST が
 * 404（Could not find the table … in the schema cache）を返す。
 * 生の英語メッセージをそのままトーストに出しても利用者は何をすべきか分からないので、
 * 呼び出し側で判定して「SQLを実行してください」という案内に差し替える。
 */
export function isSetupMissingError(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  const touchesKnowledge =
    m.includes("knowledge_documents") || m.includes("knowledge_chunks") ||
    m.includes("knowledge_search") || m.includes("knowledge_set_embeddings") ||
    m.includes("can_access_project");
  const looksMissing =
    m.includes("schema cache") || m.includes("could not find") ||
    m.includes("does not exist") || m.includes("undefined function") ||
    m.includes("relation");
  return touchesKnowledge && looksMissing;
}

/**
 * DBから返る英語メッセージを、次に何をすべきかが分かる日本語に置き換える。
 *
 * SQL を4本すべて実行していない状態は、テーブルが無いのとは違って
 * 404 にならず「次元が違う」「関数が違う」という形で表面化する。
 * 生のメッセージのままだと、SQLの実行漏れだと気づけない。
 */
export function explainKnowledgeError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("dimension")) {
    return "埋め込みの次元が合っていません。supabase/add_knowledge_embedding_768.sql を実行してください";
  }
  if (m.includes("vec_score") || m.includes("kw_score")) {
    return "検索の関数が古いままです。supabase/add_knowledge_search_v2.sql を実行してください";
  }
  return message;
}

function requireClient() {
  if (!isSupabaseEnabled || !supabase) throw new Error("Supabase が未設定です");
  return supabase;
}

// ── 参照 ──────────────────────────────────────────────────────

export async function listDocuments(projectId: string): Promise<KnowledgeDocument[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("knowledge_documents")
    .select(LIST_COLUMNS)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapKnowledgeDocument);
}

/** 原文つきで1件取得する（原文ビュー用） */
export async function getDocument(id: string): Promise<KnowledgeDocument | null> {
  const db = requireClient();
  const { data, error } = await db
    .from("knowledge_documents").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapKnowledgeDocument(data) : null;
}

export async function listChunks(documentId: string): Promise<KnowledgeChunk[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("knowledge_chunks")
    .select("id, document_id, project_id, seq, heading_path, content, char_start, char_end")
    .eq("document_id", documentId)
    .order("seq");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapKnowledgeChunk);
}

// ── フォルダ ──────────────────────────────────────────────────
// 階層は1段。資料を種類（設計書 / 議事録 / 参考資料 …）で仕分け、
// フォルダ単位で検索対象を切り替えるために使う。

export async function listFolders(projectId: string): Promise<KnowledgeFolder[]> {
  const db = requireClient();
  const { data, error } = await db
    .from("knowledge_folders")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order")
    .order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map(mapKnowledgeFolder);
}

export async function createFolder(projectId: string, name: string, createdBy: string): Promise<KnowledgeFolder> {
  const db = requireClient();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("フォルダ名を入力してください");
  const { data, error } = await db
    .from("knowledge_folders")
    .insert({ project_id: projectId, name: trimmed, created_by: createdBy })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "フォルダを作成できませんでした");
  return mapKnowledgeFolder(data);
}

export async function renameFolder(id: string, name: string): Promise<void> {
  const db = requireClient();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("フォルダ名を入力してください");
  const { error } = await db
    .from("knowledge_folders")
    .update({ name: trimmed, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** フォルダだけ消す。中の資料は未分類へ移るだけで消えない（on delete set null） */
export async function deleteFolder(id: string): Promise<void> {
  const db = requireClient();
  const { error } = await db.from("knowledge_folders").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function moveDocument(documentId: string, folderId: string | null): Promise<void> {
  const db = requireClient();
  const { error } = await db
    .from("knowledge_documents")
    .update({ folder_id: folderId, updated_at: new Date().toISOString() })
    .eq("id", documentId);
  if (error) throw new Error(error.message);
}

export async function deleteDocument(id: string): Promise<void> {
  const db = requireClient();
  // knowledge_chunks は on delete cascade で一緒に消える
  const { error } = await db.from("knowledge_documents").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function renameDocument(id: string, title: string): Promise<void> {
  const db = requireClient();
  const { error } = await db
    .from("knowledge_documents")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ── 編集・更新 ────────────────────────────────────────────────

/**
 * Markdown/テキストファイルの内容を更新する。
 * 本文を上書き後、既存のチャンク・ベクトルを破棄し、再生成（再インデックス）を行う。
 */
export async function updateDocumentContent(
  id: string,
  projectId: string,
  newContentRaw: string,
  onProgress?: (p: KnowledgeImportProgress) => void,
): Promise<ImportResult> {
  const db = requireClient();
  const notify = (p: Partial<KnowledgeImportProgress>) =>
    onProgress?.({ phase: "reading", fileName: "保存処理", done: 0, total: 0, ...p } as KnowledgeImportProgress);

  const content = normalizeText(newContentRaw);
  if (content.trim().length === 0) throw new Error("中身が空です");
  const contentHash = await hashContent(content);

  // 同一内容の重複チェック（自分自身は除外）
  const { data: dup } = await db
    .from("knowledge_documents")
    .select("id, title")
    .eq("project_id", projectId)
    .eq("content_hash", contentHash)
    .neq("id", id)
    .limit(1);
  if (dup && dup && dup.length > 0) {
    throw new Error(`同じ内容の資料が既にあります（「${(dup[0] as any).title}」）`);
  }

  // バイトサイズの再計算
  const byteSize = new Blob([newContentRaw]).size;

  notify({ phase: "chunking" });
  const drafts = chunkMarkdown(content);
  if (drafts.length === 0) throw new Error("保存できる本文がありませんでした");

  notify({ phase: "saving", total: drafts.length });

  // ① 古いチャンクの削除（インデックスも CASCADE で消えます）
  await db.from("knowledge_chunks").delete().eq("document_id", id);

  // ② 資料本体の更新（indexed_at を一旦リセット）
  const { error: docErr } = await db
    .from("knowledge_documents")
    .update({
      content,
      content_hash: contentHash,
      byte_size: byteSize,
      chunk_count: drafts.length,
      updated_at: new Date().toISOString(),
      indexed_at: null,
    })
    .eq("id", id);
  if (docErr) throw new Error(docErr.message ?? "資料の更新に失敗しました");

  // ③ 新しいチャンクの保存
  const chunkIds: string[] = [];
  try {
    for (let i = 0; i < drafts.length; i += CHUNK_INSERT_BATCH) {
      const batch = drafts.slice(i, i + CHUNK_INSERT_BATCH).map(d => ({
        document_id: id,
        project_id: projectId,
        seq: d.seq,
        heading_path: d.headingPath,
        content: d.content,
        char_start: d.charStart,
        char_end: d.charEnd,
      }));
      const { data, error } = await db.from("knowledge_chunks").insert(batch).select("id, seq");
      if (error) throw new Error(error.message);
      (data ?? []).forEach((r: any) => { chunkIds[r.seq] = r.id; });
      notify({ phase: "saving", done: Math.min(i + batch.length, drafts.length), total: drafts.length });
    }
  } catch (e) {
    throw e;
  }

  // ④ 埋め込み（AIベクトルの再生成）
  const unavailable = getUnavailableReason();
  if (unavailable) {
    return { documentId: id, chunkCount: drafts.length, indexed: false, indexNote: unavailable };
  }

  try {
    notify({ phase: "modelLoading", total: drafts.length });
    const inputs = drafts.map(d => toPassageInput(d.headingPath, d.content));
    const vectors = await embedAll(inputs, (done, total) => notify({ phase: "embedding", done, total }));

    for (let i = 0; i < vectors.length; i += EMBED_WRITE_BATCH) {
      const rows = vectors.slice(i, i + EMBED_WRITE_BATCH).map((vec, k) => ({
        id: chunkIds[i + k],
        embedding: vec,
      })).filter(r => !!r.id);
      if (rows.length === 0) continue;
      const { error } = await db.rpc("knowledge_set_embeddings", { p_rows: rows });
      if (error) throw new Error(error.message);
    }

    await db.from("knowledge_documents")
      .update({ indexed_at: new Date().toISOString(), embedding_model: EMBEDDING_MODEL })
      .eq("id", id);

    notify({ phase: "done", done: drafts.length, total: drafts.length });
    return { documentId: id, chunkCount: drafts.length, indexed: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    notify({ phase: "error", message });
    return { documentId: id, chunkCount: drafts.length, indexed: false, indexNote: message };
  }
}

// ── 取り込み ──────────────────────────────────────────────────

export interface ImportResult {
  documentId: string;
  chunkCount: number;
  /** 意味検索用のベクトルまで作れたか。false ならキーワード検索のみ有効 */
  indexed: boolean;
  /** indexed=false のときの理由（環境が非対応、途中で失敗 等） */
  indexNote?: string;
}

/**
 * Markdown/テキストファイルを取り込む。
 *
 * 設計上の要点は「先に本文だけ保存し、ベクトルは後追いで埋める」こと。
 * 埋め込みが失敗・中断しても資料と全文検索は残る。
 */
export async function importFile(
  file: File,
  projectId: string,
  uploadedBy: string,
  onProgress?: (p: KnowledgeImportProgress) => void,
  folderId?: string | null,
): Promise<ImportResult> {
  const db = requireClient();
  const notify = (p: Partial<KnowledgeImportProgress>) =>
    onProgress?.({ phase: "reading", fileName: file.name, done: 0, total: 0, ...p } as KnowledgeImportProgress);

  if (file.size > KNOWLEDGE_FILE_MAX_BYTES) {
    throw new Error(`ファイルが大きすぎます（上限 ${Math.round(KNOWLEDGE_FILE_MAX_BYTES / 1024 / 1024)}MB）`);
  }

  // ① 読み取り・正規化
  notify({ phase: "reading" });
  const raw = await file.text();
  const content = normalizeText(raw);
  if (content.trim().length === 0) throw new Error("中身が空のファイルです");
  const contentHash = await hashContent(content);

  // 同一内容の重複投入を弾く
  const { data: dup } = await db
    .from("knowledge_documents")
    .select("id, title")
    .eq("project_id", projectId)
    .eq("content_hash", contentHash)
    .limit(1);
  if (dup && dup.length > 0) {
    throw new Error(`同じ内容の資料が既にあります（「${(dup[0] as any).title}」）`);
  }

  // ② 分割
  notify({ phase: "chunking" });
  const drafts = chunkMarkdown(content);
  if (drafts.length === 0) throw new Error("取り込める本文がありませんでした");

  // ③ 本文の保存（ここまで終われば全文検索は効く）
  notify({ phase: "saving", total: drafts.length });
  const title = file.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, "");
  const { data: docRow, error: docErr } = await db
    .from("knowledge_documents")
    .insert({
      project_id: projectId,
      title,
      file_name: file.name,
      content,
      content_hash: contentHash,
      byte_size: file.size,
      chunk_count: drafts.length,
      uploaded_by: uploadedBy,
      folder_id: folderId ?? null,
    })
    .select("id")
    .single();
  if (docErr || !docRow) throw new Error(docErr?.message ?? "資料の保存に失敗しました");
  const documentId = (docRow as any).id as string;

  const chunkIds: string[] = [];
  try {
    for (let i = 0; i < drafts.length; i += CHUNK_INSERT_BATCH) {
      const batch = drafts.slice(i, i + CHUNK_INSERT_BATCH).map(d => ({
        document_id: documentId,
        project_id: projectId,
        seq: d.seq,
        heading_path: d.headingPath,
        content: d.content,
        char_start: d.charStart,
        char_end: d.charEnd,
      }));
      const { data, error } = await db.from("knowledge_chunks").insert(batch).select("id, seq");
      if (error) throw new Error(error.message);
      (data ?? []).forEach((r: any) => { chunkIds[r.seq] = r.id; });
      notify({ phase: "saving", done: Math.min(i + batch.length, drafts.length), total: drafts.length });
    }
  } catch (e) {
    // 途中で落ちたら中途半端な資料を残さない
    await db.from("knowledge_documents").delete().eq("id", documentId);
    throw e;
  }

  // ④ 埋め込み（失敗しても資料は残す）
  const unavailable = getUnavailableReason();
  if (unavailable) {
    return { documentId, chunkCount: drafts.length, indexed: false, indexNote: unavailable };
  }

  try {
    notify({ phase: "modelLoading", total: drafts.length });
    const inputs = drafts.map(d => toPassageInput(d.headingPath, d.content));
    const vectors = await embedAll(inputs, (done, total) =>
      notify({ phase: "embedding", done, total }));

    for (let i = 0; i < vectors.length; i += EMBED_WRITE_BATCH) {
      const rows = vectors.slice(i, i + EMBED_WRITE_BATCH).map((vec, k) => ({
        id: chunkIds[i + k],
        embedding: vec,
      })).filter(r => !!r.id);
      if (rows.length === 0) continue;
      const { error } = await db.rpc("knowledge_set_embeddings", { p_rows: rows });
      if (error) throw new Error(error.message);
    }

    await db.from("knowledge_documents")
      .update({ indexed_at: new Date().toISOString(), embedding_model: EMBEDDING_MODEL })
      .eq("id", documentId);

    notify({ phase: "done", done: drafts.length, total: drafts.length });
    return { documentId, chunkCount: drafts.length, indexed: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    notify({ phase: "error", message });
    return { documentId, chunkCount: drafts.length, indexed: false, indexNote: message };
  }
}

/**
 * 未索引の資料にベクトルを付ける（取り込み時に失敗した／モデルが後から使えるようになった場合）。
 * 既にベクトルがあるチャンクは対象外。
 */
export async function indexDocument(
  doc: KnowledgeDocument,
  onProgress?: (p: KnowledgeImportProgress) => void,
): Promise<{ indexed: boolean; note?: string }> {
  const db = requireClient();
  const unavailable = getUnavailableReason();
  if (unavailable) return { indexed: false, note: unavailable };

  const notify = (p: Partial<KnowledgeImportProgress>) =>
    onProgress?.({ phase: "embedding", fileName: doc.title, done: 0, total: 0, ...p } as KnowledgeImportProgress);

  const { data, error } = await db
    .from("knowledge_chunks")
    .select("id, heading_path, content")
    .eq("document_id", doc.id)
    .is("embedding", null)
    .order("seq");
  if (error) return { indexed: false, note: explainKnowledgeError(error.message) };

  const rows = (data ?? []) as any[];
  if (rows.length === 0) {
    await db.from("knowledge_documents")
      .update({ indexed_at: new Date().toISOString(), embedding_model: EMBEDDING_MODEL })
      .eq("id", doc.id);
    return { indexed: true };
  }

  try {
    notify({ phase: "modelLoading", total: rows.length });
    const inputs = rows.map(r => toPassageInput(r.heading_path ?? "", r.content ?? ""));
    const vectors = await embedAll(inputs, (done, total) => notify({ phase: "embedding", done, total }));

    for (let i = 0; i < vectors.length; i += EMBED_WRITE_BATCH) {
      const payload = vectors.slice(i, i + EMBED_WRITE_BATCH).map((vec, k) => ({
        id: rows[i + k].id, embedding: vec,
      }));
      const { error: upErr } = await db.rpc("knowledge_set_embeddings", { p_rows: payload });
      if (upErr) throw new Error(upErr.message);
    }

    await db.from("knowledge_documents")
      .update({ indexed_at: new Date().toISOString(), embedding_model: EMBEDDING_MODEL })
      .eq("id", doc.id);
    notify({ phase: "done", done: rows.length, total: rows.length });
    return { indexed: true };
  } catch (e) {
    const note = explainKnowledgeError(e instanceof Error ? e.message : String(e));
    notify({ phase: "error", message: note });
    return { indexed: false, note };
  }
}

// ── 検索 ──────────────────────────────────────────────────────

export interface SearchOptions {
  /** 暴走防止の保険。実質の上限ではない（件数で切らない方針） */
  limit?: number;
  vecWeight?: number;
  /** 意味検索の関連度の下限。これ未満は無関係とみなして返さない */
  minVec?: number;
  /** 対象資料を絞る。空/未指定なら全件 */
  documentIds?: string[];
}

export interface SearchOutcome {
  hits: KnowledgeSearchHit[];
  /** 意味検索が効いたか。false ならキーワードのみ（理由は note） */
  semantic: boolean;
  note?: string;
}

/**
 * ハイブリッド検索。
 * 埋め込みが使えない環境ではベクトルを省略し、キーワード検索だけで結果を返す。
 * 「モデルが動かないと何も出ない」状態を作らないための設計。
 */
export async function search(
  projectId: string,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchOutcome> {
  const db = requireClient();
  const q = query.trim();
  if (!q) return { hits: [], semantic: false };

  let vectorLiteral: string | null = null;
  let note: string | undefined;

  try {
    const vec = await embedOne(toQueryInput(q));
    vectorLiteral = toVectorLiteral(vec);
  } catch (e) {
    note = e instanceof Error ? e.message : String(e);
  }

  const { data, error } = await db.rpc("knowledge_search", {
    p_project_id: projectId,
    p_query_text: q,
    p_query_vec: vectorLiteral,
    p_limit: opts.limit ?? 1000,
    p_vec_weight: opts.vecWeight ?? 0.7,
    p_document_ids: opts.documentIds && opts.documentIds.length > 0 ? opts.documentIds : null,
    p_min_vec: opts.minVec ?? 0.78,
  });
  if (error) throw new Error(explainKnowledgeError(error.message));

  return {
    hits: (data ?? []).map(mapKnowledgeHit),
    semantic: vectorLiteral !== null,
    note,
  };
}
