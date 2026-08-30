// 選択したチケットの一括エクスポート（CSV / Word / Markdown）。
//
// ・CSV  … 従来どおりの「表」。Excel で開いて集計する用途なので1行1チケットのまま。
// ・Word / Markdown … 表にすると13列で横に潰れて読めないので、**1チケット＝1セクションの文書**
//   として書き出す（見出し＝No＋チケット名、その下にメタ情報の箇条書き、続けて詳細の本文）。
//   組み立て先は記事エクスポートの ArticleDoc(IR)。IR に載せてしまえば
//   articleExport の Word/Markdown レンダラー・画像埋め込み・進捗オーバーレイを
//   そのまま使えるので、レンダラーを書き足さない。チケット詳細の見出し・箇条書き・表・
//   画像も HTML のまま IR へ流すので、書式が落ちない（CSV の平文とはここが違う）。
import type { SprintTicket } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import type { ArticleDoc, Block } from "@/app/lib/articleExport/types";
import { TICKET_EXPORT_HEADERS, buildTicketExportCells, toCsvLine, triggerCsvDownload } from "@/app/lib/csvExport";
import { safeFileName, dateStamp } from "@/app/lib/articleExport/download";

export type TicketExportFormat = "csv" | "docx" | "md";

export const TICKET_EXPORT_LABEL: Record<TicketExportFormat, string> = {
  csv: "CSV (.csv)",
  docx: "Word (.docx)",
  md: "Markdown (.md)",
};

export interface TicketExportItem {
  ticket: SprintTicket;
  sprintName: string;
}

interface ExportArgs {
  format: TicketExportFormat;
  /** 見出し・ファイル名に使う名前（プロジェクト名など） */
  title: string;
  items: TicketExportItem[];
  getCategoryLabel: (t: SprintTicket) => string;
  /** 関連PRを引くために使う。無ければPRの出力を省く */
  projectId?: string | null;
}

// ── 関連PR ───────────────────────────────────────────────────
// チケットに紐付いたプルリクエスト（ticket_github_links の kind='pull'）。
// 一覧の行数ぶん GitHub API を叩くのは重いので、prLinkAlert と同じく Supabase から直接読む
// （ticket_github_links の select は can_access_project で許可されている）。
export interface TicketPrLink {
  number: number;
  title: string;
  url: string;
}

async function fetchPrLinks(projectId: string | null | undefined, ticketIds: string[]): Promise<Map<string, TicketPrLink[]>> {
  const byTicket = new Map<string, TicketPrLink[]>();
  if (!isSupabaseEnabled || !projectId || ticketIds.length === 0) return byTicket;
  // 取れなくてもエクスポート自体は成立させる（PR欄が空になるだけ）
  const { data, error } = await supabase!
    .from("ticket_github_links")
    .select("ticket_id, number, title, url")
    .eq("project_id", projectId)
    .eq("kind", "pull")
    .in("ticket_id", ticketIds);
  if (error || !data) return byTicket;
  for (const r of data as { ticket_id: string; number: number; title: string | null; url: string | null }[]) {
    const arr = byTicket.get(r.ticket_id) ?? [];
    arr.push({ number: r.number, title: r.title ?? "", url: r.url ?? "" });
    byTicket.set(r.ticket_id, arr);
  }
  byTicket.forEach(arr => arr.sort((a, b) => a.number - b.number));
  return byTicket;
}

/** 「#123 PRタイトル」。タイトルが無いPRもあるので番号だけでも成立させる */
const prLabel = (pr: TicketPrLink) => `#${pr.number}${pr.title ? ` ${pr.title}` : ""}`;

/** CSV の列。既存のスプリントCSV／プロジェクトCSVには影響させたくないので、ここで足す */
const CSV_HEADERS = [...TICKET_EXPORT_HEADERS, "関連PR"];

function buildCells({ items, getCategoryLabel }: ExportArgs, prs: Map<string, TicketPrLink[]>): string[][] {
  return items.map((it, i) => [
    ...buildTicketExportCells(i + 1, it.sprintName, it.ticket, getCategoryLabel),
    // 1チケットに複数PRが付くので、セル内改行で並べる（CSVは全セルを引用符で囲っている）
    (prs.get(it.ticket.id) ?? []).map(pr => `${prLabel(pr)}${pr.url ? ` ${pr.url}` : ""}`).join("\n"),
  ]);
}

// ── Word / Markdown ──────────────────────────────────────────
// メタ情報として見出しの下に並べる項目（値が空のものは出さない）。
// 「No」「チケットNo」「チケット名」は見出しへ、「チケット詳細」は本文へ回すのでここには入れない。
const META_LABELS = [
  "スプリント名", "分類", "ステータス", "レビュー状況", "優先度",
  "担当者", "開始日", "期限日", "実績工数(人日)",
];

const cellAt = (cells: string[], label: string) => cells[TICKET_EXPORT_HEADERS.indexOf(label)] ?? "";

/**
 * チケット詳細の中の見出しを最下段(h3)へ揃える。
 * 文書は「タイトル(h1) ＞ チケット(h2) ＞ 詳細」の入れ子で、IR の見出しは3段までしかない。
 * 1段だけ下げると詳細の h1 がチケット見出しと同じ h2 に並んでしまい、
 * どこからが次のチケットなのか読めなくなる（チケット本文は h1 始まりのものが多い）。
 * 詳細の中の相対構造よりも「チケットの区切りが分かること」を優先して h3 に寄せる。
 */
function demoteHeadings(blocks: Block[]): Block[] {
  return blocks.map(b => {
    if (b.type === "heading") return { ...b, level: 3 as const };
    if (b.type === "blockquote") return { ...b, blocks: demoteHeadings(b.blocks) };
    return b;
  });
}

/** 選択したチケットを「1チケット＝1セクション」の文書(ArticleDoc)に組み立てる。 */
function buildDoc(args: ExportArgs, rows: string[][], prs: Map<string, TicketPrLink[]>, htmlToBlocks: (html?: string | null) => Block[]): ArticleDoc {
  const blocks: Block[] = [];

  rows.forEach((cells, i) => {
    const ticket = args.items[i].ticket;
    const wbs = cellAt(cells, "チケットNo");
    const title = cellAt(cells, "チケット名");
    // チケットの切れ目に区切り線を引く（詳細の本文が続くと、どこで次のチケットに
    // 移ったのか見出しだけでは追いにくいため）
    if (i > 0) blocks.push({ type: "divider" });
    // 見出しは太字にしない（Word/PDF は見出しスタイルが太字、Markdown は `## **…**` になってしまう）
    blocks.push({
      type: "heading", level: 2,
      runs: [{ text: `${i + 1}. ${wbs}${title ? ` ${title}` : ""}` }],
    });

    const meta = META_LABELS
      .map(label => ({ label, value: cellAt(cells, label) }))
      .filter(m => m.value.trim() !== "");
    if (meta.length) {
      blocks.push({
        type: "list", ordered: false,
        items: meta.map(m => ({ runs: [{ text: m.label, bold: true }, { text: `: ${m.value}` }] })),
      });
    }

    // 関連PR。Word はクリックできるリンク、Markdown は [#123 タイトル](URL) になる
    const prLinks = prs.get(ticket.id) ?? [];
    if (prLinks.length) {
      blocks.push({ type: "paragraph", runs: [{ text: "関連PR", bold: true }] });
      blocks.push({
        type: "list", ordered: false,
        items: prLinks.map(pr => ({
          runs: pr.url ? [{ text: prLabel(pr), href: pr.url }] : [{ text: prLabel(pr) }],
        })),
      });
    }

    // 詳細は平文ではなく本文HTMLから起こす（見出し・箇条書き・表・画像がそのまま残る）
    const body = demoteHeadings(htmlToBlocks(ticket.description));
    if (body.length) {
      blocks.push({ type: "paragraph", runs: [{ text: "詳細", bold: true }] });
      blocks.push(...body);
    }
  });

  return {
    kind: "wiki",
    title: args.title,
    meta: [{ label: "対象", value: `チケット ${rows.length} 件` }],
    blocks,
  };
}

async function exportDocument(args: ExportArgs, rows: string[][], prs: Map<string, TicketPrLink[]>): Promise<void> {
  const [{ exportArticleDoc }, { htmlToBlocks }] = await Promise.all([
    import("@/app/lib/articleExport"),
    import("@/app/lib/articleExport/htmlToDoc"),
  ]);
  await exportArticleDoc(args.format === "docx" ? "docx" : "md", args.title, () => buildDoc(args, rows, prs, htmlToBlocks));
}

/** 選択したチケットを指定フォーマットでダウンロードする。 */
export async function exportTicketList(args: ExportArgs): Promise<void> {
  const prs = await fetchPrLinks(args.projectId, args.items.map(it => it.ticket.id));
  const rows = buildCells(args, prs);
  if (args.format === "csv") {
    // BOM 付き・CRLF 区切り。Excel でそのまま開けるようにする（既存のCSV出力と同じ）
    triggerCsvDownload(
      [toCsvLine(CSV_HEADERS), ...rows.map(toCsvLine)].join("\r\n"),
      safeFileName(args.title, dateStamp(), "csv"),
    );
    return;
  }
  // Word / Markdown は articleExport 側でファイル名・ダウンロード・進捗表示まで面倒を見る
  await exportDocument(args, rows, prs);
}
