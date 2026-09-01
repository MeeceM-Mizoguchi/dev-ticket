import type { SprintTicket, TicketCategory } from "@/app/types";

// 分類マスタ(ticket_categories)を作る前に起票されたチケットは、分類名ではなく
// 生のID(CAT-...)を持ったままになっている。表示のたびに名前へ読み替えるための対応表。
// スプリント一覧の表と同じ並び・同じ名前にそろえてある。
export const BASE_CATEGORY_MAP: Record<string, string> = {
  "CAT-1780106163889": "バグ",
  "CAT-1780106169442": "仕様確認",
  "CAT-1780106176626": "要望",
  "CAT-1780241120059": "改善",
  "CAT-1780293371590": "新規機能開発",
};

export const NO_CATEGORY_LABEL = "分類なし";

/**
 * ID → 分類名の対応表を組み立てる。
 * 既定表 → DBの分類マスタ → チケットが自前で持っている名前、の順に上書きする。
 */
export function buildCategoryMap(
  dbCategories: Pick<TicketCategory, "id" | "name">[],
  tickets: SprintTicket[],
): Record<string, string> {
  const map: Record<string, string> = { ...BASE_CATEGORY_MAP };
  dbCategories.forEach(c => { if (c.id && c.name) map[c.id] = c.name; });
  tickets.forEach(t => {
    const id = t.categoryId || "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const name = (t as any).categoryName || (t as any).category?.name || "";
    if (id && name && !String(name).startsWith("CAT-") && !map[id]) map[id] = String(name);
  });
  return map;
}

/** チケット1件の分類名。解決できないときは「分類なし」。 */
export function resolveCategoryLabel(ticket: SprintTicket, map: Record<string, string>): string {
  const id = ticket.categoryId || "";
  if (map[id]) return map[id];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = String((ticket as any).categoryName || (ticket as any).category?.name || "");
  if (raw && !raw.startsWith("CAT-")) return raw;
  if (raw && map[raw]) return map[raw];
  return NO_CATEGORY_LABEL;
}
