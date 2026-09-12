import type { Sprint, SprintTicket } from "@/app/types";
import { htmlToText, calcTicketActualHours, formatPersonDays, getTicketStatusMeta } from "@/app/lib/helpers";
import { buildSharesFor, type AssigneeShare } from "@/app/lib/handover";

const PRIORITY_LABELS: Record<string, string> = { high: "高", medium: "中", low: "低" };

// BASE_CATEGORY_MAP をコピー（SprintListView と同じマスター）
const BASE_CATEGORY_MAP: Record<string, string> = {
  "CAT-1780106163889": "バグ",
  "CAT-1780106169442": "仕様確認",
  "CAT-1780106176626": "要望",
  "CAT-1780241120059": "改善",
  "CAT-1780293371590": "新規機能開発",
};

/**
 * レビュー状況を ticket のフィールドから導出する。
 * - in-review: 第○回レビュー依頼中
 * - review-done 以降 + requestedAt === approvedAt (カスケード同一 TS): スキップ
 * - review-done 以降 その他: レビュー承認済み
 * - reviewRound > 0 かつ in-progress: レビュー指摘あり（修正依頼後に差し戻し）
 */
function getReviewStatus(ticket: SprintTicket): string {
  const { status, reviewRound, reviewRequestedAt, reviewApprovedAt } = ticket;
  const postReview = ["review-done", "stg-test", "uat", "done", "closed"];

  if (status === "in-review") {
    return `第${reviewRound ?? 1}回レビュー依頼中`;
  }
  if (postReview.includes(status)) {
    if (reviewRequestedAt && reviewApprovedAt && reviewRequestedAt === reviewApprovedAt) {
      return "スキップ";
    }
    return "レビュー承認済み";
  }
  if ((reviewRound ?? 0) > 0) {
    return "レビュー指摘あり";
  }
  return "";
}

function escapeCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * チケット一覧の出力項目。CSV だけでなく Word / Markdown 出力
 * （lib/ticketExport.ts）でも同じ並びを使うので export している。
 */
export const TICKET_EXPORT_HEADERS = [
  "No", "スプリント名", "チケットNo", "チケット名", "チケット詳細",
  "分類", "ステータス", "レビュー状況", "優先度", "担当者",
  "開始日", "期限日", "実績工数(人日)",
  // 引継ぎがあったチケットだけ埋まる。「担当者」列は現在の担当しか出せないので、
  // 誰がどれだけやったのかは実績工数と並べて別列で持つ
  "担当履歴", "担当者別実績",
];

/** 「田中太郎 → 佐藤花子」。引継ぎが無いチケットは空 */
function handoverPath(shares: AssigneeShare[] | undefined): string {
  if (!shares || shares.length < 2) return "";
  // shares は区間の登場順に並んでいる（splitActualHours が古い順に積む）
  return shares.map(s => s.assignee).join(" → ");
}

/** 「田中太郎 1.5人日 / 佐藤花子 0.8人日」。合計はチケットの実績工数と必ず一致する */
function handoverShares(shares: AssigneeShare[] | undefined): string {
  if (!shares || shares.length < 2) return "";
  return shares.map(s => `${s.assignee} ${formatPersonDays(s.hours)}`).join(" / ");
}

/** チケット1件ぶんのセル（TICKET_EXPORT_HEADERS と同じ並び）。 */
export function buildTicketExportCells(
  no: number,
  sprintName: string,
  ticket: SprintTicket,
  getCategoryLabel: (t: SprintTicket) => string,
  /** 担当者別の実績。引継ぎのあったチケットぶんだけ入っている（buildSharesFor の結果） */
  shares?: Map<string, AssigneeShare[]>,
): string[] {
  // progress を見ないと保留(-1)/取下(-2)が元ステータスのまま出力され、
  // 子チケットの closed も「未着手」に誤フォールバックする（getTicketStatusMeta が両方を吸収する）。
  const statusLabel = getTicketStatusMeta(ticket.status, ticket.progress).label;
  const actualHours = calcTicketActualHours(ticket);
  return [
    String(no),
    sprintName,
    ticket.wbs,
    ticket.title,
    htmlToText(ticket.description),
    getCategoryLabel(ticket),
    statusLabel,
    getReviewStatus(ticket),
    PRIORITY_LABELS[ticket.priority] ?? ticket.priority,
    ticket.assignee || "",
    ticket.startDate || "",
    ticket.dueDate || "",
    actualHours > 0 ? formatPersonDays(actualHours) : "",
    handoverPath(shares?.get(ticket.id)),
    handoverShares(shares?.get(ticket.id)),
  ];
}

/** セル配列 → CSV の1行。 */
export function toCsvLine(cells: string[]): string {
  return cells.map(escapeCell).join(",");
}

function buildRow(
  no: number,
  sprintName: string,
  ticket: SprintTicket,
  getCategoryLabel: (t: SprintTicket) => string,
  shares?: Map<string, AssigneeShare[]>,
): string {
  return toCsvLine(buildTicketExportCells(no, sprintName, ticket, getCategoryLabel, shares));
}

export function triggerCsvDownload(csvContent: string, filename: string): void {
  const bom = "﻿";
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * スプリント単体の CSV ダウンロード。
 * displayTickets はフィルタ適用済みの親チケット一覧。
 * 各親の子チケットも後続行として含める。
 */
export async function downloadSprintCsv(
  sprint: Sprint,
  displayTickets: SprintTicket[],
  getCategoryLabel: (t: SprintTicket) => string
): Promise<void> {
  // 出力対象（親＋その子）を先に並べてから、担当者別実績をまとめて1回で引く
  const ordered: SprintTicket[] = [];
  for (const ticket of displayTickets) {
    ordered.push(ticket, ...sprint.tickets.filter(t => t.parentId === ticket.id));
  }
  const shares = await buildSharesFor(ordered, calcTicketActualHours);

  const rows: string[] = [toCsvLine(TICKET_EXPORT_HEADERS)];
  ordered.forEach((ticket, i) => rows.push(buildRow(i + 1, sprint.name, ticket, getCategoryLabel, shares)));
  triggerCsvDownload(rows.join("\r\n"), `${sprint.name}.csv`);
}

/**
 * プロジェクト全体の CSV ダウンロード（全スプリント・全チケット）。
 * categories は ticket_categories テーブルから取得したデータ。
 */
export async function downloadProjectCsv(
  projectName: string,
  sprints: Sprint[],
  categories: Array<{ id: string; name: string }>
): Promise<void> {
  const map: Record<string, string> = { ...BASE_CATEGORY_MAP };
  categories.forEach(c => { if (c.id && c.name) map[c.id] = c.name; });
  const getCategoryLabel = (t: SprintTicket): string => map[t.categoryId ?? ""] || "分類なし";

  // 出力順（スプリント → 親 → その子）を先に確定させてから、担当者別実績を1回で引く
  const ordered: { sprintName: string; ticket: SprintTicket }[] = [];
  for (const sprint of sprints) {
    for (const ticket of sprint.tickets.filter(t => !t.parentId)) {
      ordered.push({ sprintName: sprint.name, ticket });
      for (const child of sprint.tickets.filter(t => t.parentId === ticket.id)) {
        ordered.push({ sprintName: sprint.name, ticket: child });
      }
    }
  }
  const shares = await buildSharesFor(ordered.map(o => o.ticket), calcTicketActualHours);

  const rows: string[] = [toCsvLine(TICKET_EXPORT_HEADERS)];
  ordered.forEach((o, i) => rows.push(buildRow(i + 1, o.sprintName, o.ticket, getCategoryLabel, shares)));
  triggerCsvDownload(rows.join("\r\n"), `${projectName}.csv`);
}
