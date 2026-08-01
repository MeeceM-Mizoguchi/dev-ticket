// 貼り付けた Markdown テキストの中間表現(IR)。
//
// 出口が2つある（リッチエディタ用の HTML / ホワイトボード用の Excalidraw 要素）ため、
// 記事エクスポート(articleExport/htmlToDoc.ts)と同じく「パース → IR → 各レンダラー」に分ける。
// 対応範囲は TipTap のスキーマ（＝既存の htmlToMarkdown / clipboardTextSerializer が出力する範囲）
// に合わせてある。これにより dev-ticket → 外部 → dev-ticket のコピペが往復しても崩れない。

/** インライン要素。text は装飾フラグを持つ葉、link だけが子を持つ。 */
export type MdInline =
  | { t: "text"; v: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean }
  | { t: "link"; href: string; children: MdInline[] }
  | { t: "image"; src: string; alt: string };

export interface MdListItem {
  /** 項目の本文（1行目＋継続行） */
  children: MdInline[];
  /** チェックボックス付き項目（- [ ] / - [x]）。付いていなければ undefined */
  checked?: boolean;
  /** 入れ子のブロック（ほぼ入れ子リスト） */
  sub: MdBlock[];
}

export type MdBlock =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: MdInline[] }
  | { t: "para"; children: MdInline[] }
  | { t: "list"; ordered: boolean; start: number; items: MdListItem[] }
  | { t: "quote"; blocks: MdBlock[] }
  | { t: "code"; lang: string; code: string }
  | { t: "mermaid"; code: string }
  | { t: "table"; header: MdInline[][]; rows: MdInline[][][] }
  | { t: "hr" };
