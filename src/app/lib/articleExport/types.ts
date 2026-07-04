// 記事(wiki/議事録)エクスポート用の共通ドキュメントモデル(IR)。
// 本文HTML(TipTap) を一旦この中間表現に変換し、PDF/Word/Excel の各レンダラーが共通で消費する。
// パーサを3フォーマットぶん重複させないための設計。

export interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strike?: boolean;
  code?: boolean;
}

export interface HeadingBlock { type: "heading"; level: 1 | 2 | 3; runs: Run[] }
export interface ParagraphBlock { type: "paragraph"; runs: Run[] }
export interface ListItem { runs: Run[]; sub?: ListBlock }
export interface ListBlock { type: "list"; ordered: boolean; items: ListItem[] }
export interface QuoteBlock { type: "blockquote"; blocks: Block[] }
export interface CodeBlock { type: "codeblock"; text: string }
export interface TableCell { runs: Run[]; header?: boolean }
export interface TableBlock { type: "table"; rows: TableCell[][]; colWidths?: number[] }
export interface ImageBlock { type: "image"; url: string; alt?: string }

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | TableBlock
  | ImageBlock;

export interface MetaField { label: string; value: string }

export interface ActionItemRow {
  category: string;   // 表示ラベル(TODO/レビュー/テスト/メモ)
  title: string;
  done: boolean;
}

export interface ArticleDoc {
  kind: "wiki" | "minutes";
  title: string;
  meta: MetaField[];             // タイトル下に並べるメタ情報(会議日/参加者/更新者 等)
  blocks: Block[];               // 本文
  actionItems?: ActionItemRow[]; // 議事録のアクションアイテム
}

export type ExportFormat = "pdf" | "docx" | "xlsx";
