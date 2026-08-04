// MDファイルからのチケット一括作成で使う中間表現。
//
// Markdown → MdBlock[] の解析は既存の src/app/lib/markdown/ に任せ、ここは
// 「MdBlock[] → チケット」の写像だけを担う。確認画面はこの型をそのまま描画する。
import type { TicketStatus, Priority } from "@/app/types";

/** MDから拾えたチケット1件分。未記載の項目は null（＝空欄で登録する）。 */
export interface ParsedTicket {
  /** 確認画面の key に使う、この解析結果内で一意な連番ID */
  uid: string;
  title: string;
  /** 型・DB制約上「空」を表現できないため、未記載でも既定値が入る */
  status: TicketStatus;
  priority: Priority;
  /** 未記載、またはプロジェクトに登録の無い分類名だった場合 null */
  categoryId: string | null;
  /** 確認画面のバッジ表示用（DBへは categoryId だけを送る） */
  categoryName: string | null;
  /** 未記載、またはプロジェクトメンバーに存在しない名前だった場合 null */
  assignee: string | null;
  /** "2026-08-03" 形式。解釈できなければ null */
  startDate: string | null;
  dueDate: string | null;
  /** 未記載なら 0（既存の表からの一括作成と揃える） */
  estimatedHours: number;
  /** 詳細のHTML（TipTapスキーマ準拠）。本文が無ければ null */
  descriptionHtml: string | null;
  /** 詳細の先頭抜粋（確認画面のツールチップ用）。本文が無ければ null */
  descriptionExcerpt: string | null;
  /** 明示的に書かれていた項目。確認画面のバッジ表示に使う */
  filled: {
    status: boolean;
    priority: boolean;
    category: boolean;
    assignee: boolean;
    startDate: boolean;
    dueDate: boolean;
    estimatedHours: boolean;
  };
  /** 子チケット。1階層のみ（子の children は常に空） */
  children: ParsedTicket[];
}

/** 取り込みをブロックしない注意書き。確認画面の黄色ストリップに出す。 */
export interface ParseWarning {
  /** 対象チケットのタイトル（全体に関わる警告なら null） */
  ticketTitle: string | null;
  message: string;
}

export interface ParseResult {
  tickets: ParsedTicket[];
  warnings: ParseWarning[];
}

/** 解析時に必要な、プロジェクト側の文脈 */
export interface ParseContext {
  /** 担当者名の照合に使う。空配列なら照合せず、書かれた名前をそのまま採用する */
  memberNames: string[];
  /** 分類名の照合に使う。プロジェクトに登録済みのカテゴリだけを受け付ける */
  categories: { id: string; name: string }[];
}
