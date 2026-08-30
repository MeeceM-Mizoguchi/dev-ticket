import type { Sprint, SprintTicket } from "@/app/types";
import { htmlToText, calcTicketActualHours, formatPersonDays, getTicketStatusMeta } from "@/app/lib/helpers";

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
];

/** チケット1件ぶんのセル（TICKET_EXPORT_HEADERS と同じ並び）。 */
export function buildTicketExportCells(
  no: number,
  sprintName: string,
  ticket: SprintTicket,
  getCategoryLabel: (t: SprintTicket) => string
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
  getCategoryLabel: (t: SprintTicket) => string
): string {
  return toCsvLine(buildTicketExportCells(no, sprintName, ticket, getCategoryLabel));
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
export function downloadSprintCsv(
  sprint: Sprint,
  displayTickets: SprintTicket[],
  getCategoryLabel: (t: SprintTicket) => string
): void {
  const rows: string[] = [toCsvLine(TICKET_EXPORT_HEADERS)];
  let no = 1;
  for (const ticket of displayTickets) {
    rows.push(buildRow(no++, sprint.name, ticket, getCategoryLabel));
    const children = sprint.tickets.filter(t => t.parentId === ticket.id);
    for (const child of children) {
      rows.push(buildRow(no++, sprint.name, child, getCategoryLabel));
    }
  }
  triggerCsvDownload(rows.join("\r\n"), `${sprint.name}.csv`);
}

/**
 * プロジェクト全体の CSV ダウンロード（全スプリント・全チケット）。
 * categories は ticket_categories テーブルから取得したデータ。
 */
export function downloadProjectCsv(
  projectName: string,
  sprints: Sprint[],
  categories: Array<{ id: string; name: string }>
): void {
  const map: Record<string, string> = { ...BASE_CATEGORY_MAP };
  categories.forEach(c => { if (c.id && c.name) map[c.id] = c.name; });
  const getCategoryLabel = (t: SprintTicket): string => map[t.categoryId ?? ""] || "分類なし";

  const rows: string[] = [toCsvLine(TICKET_EXPORT_HEADERS)];
  let no = 1;
  for (const sprint of sprints) {
    const parents = sprint.tickets.filter(t => !t.parentId);
    for (const ticket of parents) {
      rows.push(buildRow(no++, sprint.name, ticket, getCategoryLabel));
      const children = sprint.tickets.filter(t => t.parentId === ticket.id);
      for (const child of children) {
        rows.push(buildRow(no++, sprint.name, child, getCategoryLabel));
      }
    }
  }
  triggerCsvDownload(rows.join("\r\n"), `${projectName}.csv`);
}
