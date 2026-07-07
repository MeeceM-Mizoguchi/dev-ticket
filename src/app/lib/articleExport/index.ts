// 記事エクスポートのエントリポイント。
// wiki ページ / 議事録 を ArticleDoc(IR) に組み立て、画像を取得し、指定フォーマットで生成・ダウンロードする。
// 各レンダラーは動的 import で遅延ロードし、初期バンドルを肥大させない（ReportsPage と同方針）。
import type { MeetingMinute, WikiPage, ActionMemoCategory } from "@/app/types";
import { supabase } from "@/lib/supabase";
import { mapActionMemo } from "@/app/lib/mappers";
import { htmlToBlocks } from "./htmlToDoc";
import { collectImageUrls, loadImages } from "./imageLoader";
import { downloadBlob, safeFileName, dateStamp } from "./download";
import { startExport, reportImages, reportRender, finishExport } from "./exportProgress";
import type { ActionItemRow, ArticleDoc, Block, ExportFormat, MetaField } from "./types";

const CATEGORY_LABEL: Record<ActionMemoCategory, string> = {
  todo: "TODO", review: "レビュー", test: "テスト", memo: "メモ",
};

const EXT: Record<ExportFormat, string> = { pdf: "pdf", docx: "docx", xlsx: "xlsx" };

function fmtDateTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fmtDate(ymd: string | undefined | null): string {
  if (!ymd) return "";
  return ymd.replace(/-/g, "/");
}

async function render(doc: ArticleDoc, format: ExportFormat): Promise<Blob> {
  const urls = collectImageUrls(doc.blocks as any);
  const images = await loadImages(urls, reportImages);
  reportRender();
  // 「生成中」表示を一度ペイントさせてから重い生成に入る（生成はメインスレッドを一時ブロックするため）。
  await new Promise(r => setTimeout(r, 30));
  if (format === "pdf") return (await import("./exportPdf")).renderPdf(doc, images);
  if (format === "docx") return (await import("./exportDocx")).renderDocx(doc, images);
  return (await import("./exportXlsx")).renderXlsx(doc, images);
}

// 進捗表示(start/finish)とダウンロードを共通化する。build でドキュメントを組み立てる。
async function runExport(format: ExportFormat, scope: string, build: () => ArticleDoc | Promise<ArticleDoc>): Promise<void> {
  startExport(format, scope);
  try {
    const doc = await build();
    const blob = await render(doc, format);
    downloadBlob(blob, safeFileName(doc.title, dateStamp(), EXT[format]));
  } finally {
    finishExport();
  }
}

export async function exportWikiArticle(page: WikiPage, breadcrumbTitles: string[], format: ExportFormat): Promise<void> {
  const title = page.title || "無題のページ";
  return runExport(format, title, () => {
    const meta: MetaField[] = [];
    const place = breadcrumbTitles.filter(Boolean).join(" ＞ ");
    if (place) meta.push({ label: "場所", value: `Wikiホーム ＞ ${place}` });
    if (page.updatedBy) meta.push({ label: "更新者", value: page.updatedBy });
    if (page.updatedAt) meta.push({ label: "更新日時", value: fmtDateTime(page.updatedAt) });
    return { kind: "wiki", title, meta, blocks: htmlToBlocks(page.content) };
  });
}

// フォルダ配下の全ページ・記事を再帰的に集め、フォルダ名を見出し(ナビゲーション)として
// 反映した1つの結合ドキュメントにまとめて出力する（子・孫フォルダも全て含む）。
export async function exportWikiFolder(folder: WikiPage, allPages: WikiPage[], format: ExportFormat): Promise<void> {
  const childrenOf = (parentId: string) =>
    allPages.filter(p => p.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const clampLevel = (d: number): 1 | 2 | 3 => (d <= 1 ? 1 : d === 2 ? 2 : 3);

  const blocks: Block[] = [];
  let pageCount = 0;

  // depth: フォルダ自身を1として数える見出し階層。pathTitles: folder 以下のサブフォルダ名(ナビ用)。
  const walk = (parentId: string, depth: number, pathTitles: string[]) => {
    for (const node of childrenOf(parentId)) {
      const title = node.title || (node.isFolder ? "無題のフォルダ" : "無題のページ");
      if (node.isFolder) {
        blocks.push({ type: "heading", level: clampLevel(depth + 1), runs: [{ text: `📁 ${title}`, bold: true }] });
        walk(node.id, depth + 1, [...pathTitles, title]);
      } else {
        pageCount++;
        blocks.push({ type: "heading", level: clampLevel(depth + 1), runs: [{ text: `📄 ${title}`, bold: true }] });
        const nav = ["Wikiホーム", folder.title || "無題のフォルダ", ...pathTitles].join(" ＞ ");
        blocks.push({ type: "paragraph", runs: [{ text: nav, italic: true }] });
        blocks.push(...htmlToBlocks(node.content));
      }
    }
  };

  const rootTitle = folder.title || "無題のフォルダ";
  return runExport(format, rootTitle, () => {
    blocks.push({ type: "heading", level: 1, runs: [{ text: `📁 ${rootTitle}`, bold: true }] });
    walk(folder.id, 1, []);
    return {
      kind: "wiki",
      title: rootTitle,
      meta: [{ label: "内容", value: `フォルダ内 ${pageCount} ページを一括エクスポート` }],
      blocks,
    };
  });
}

export async function exportMinuteArticle(minute: MeetingMinute, format: ExportFormat): Promise<void> {
  const title = minute.title || "無題の議事録";
  return runExport(format, title, async () => {
    const meta: MetaField[] = [];
    if (minute.meetingDate) meta.push({ label: "会議日", value: fmtDate(minute.meetingDate) });
    if (minute.attendees?.length) meta.push({ label: "参加者", value: minute.attendees.join("、") });
    if (minute.createdBy) meta.push({ label: "作成者", value: minute.createdBy });
    if (minute.updatedAt) meta.push({ label: "更新日時", value: fmtDateTime(minute.updatedAt) });

    // アクションアイテムを取得（ActionItemsPanel と同じ action_memos）
    let actionItems: ActionItemRow[] | undefined;
    if (supabase) {
      const { data } = await supabase.from("action_memos").select("*").eq("meeting_minute_id", minute.id).order("created_at");
      const memos = (data ?? []).map(mapActionMemo);
      if (memos.length) {
        actionItems = memos.map(m => ({
          category: CATEGORY_LABEL[m.category] ?? m.category,
          title: m.userName ? `${m.title}（${m.userName}）` : m.title,
          done: m.isDone,
        }));
      }
    }
    return { kind: "minutes", title, meta, blocks: htmlToBlocks(minute.content), actionItems };
  });
}

export type { ExportFormat } from "./types";
