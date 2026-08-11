// MDファイルからのタスク取り込みで使う中間表現。
//
// 見出し・メタ行・詳細の切り分けは mdImport/parseCommon に任せ、ここは
// 「セクション → タスク」の写像だけを担う。確認画面はこの型をそのまま描画する。
import type { TaskStatus, Priority } from "@/app/types";
import type { MdParseWarning } from "@/app/lib/mdImport/parseCommon";

/** MDから拾えたタスク1件分。未記載の項目は空（＝未設定で登録する）。 */
export interface ParsedTask {
  /** 確認画面の key に使う、この解析結果内で一意な連番ID */
  uid: string;
  title: string;
  /** 型・DB制約上「空」を表現できないため、未記載でも既定値が入る */
  status: TaskStatus;
  priority: Priority;
  /** 分類（自由入力の複数要素）。未記載なら空配列 */
  categories: string[];
  /** 未記載、または組織のメンバーに存在しない名前だった場合 null */
  assignee: string | null;
  /** "2026-08-03" 形式。解釈できなければ null */
  startDate: string | null;
  dueDate: string | null;
  /** 詳細メモのHTML（RichEditor 準拠）。本文が無ければ null */
  descriptionHtml: string | null;
  /** 詳細の先頭抜粋（確認画面のツールチップ用）。本文が無ければ null */
  descriptionExcerpt: string | null;
  /** 明示的に書かれていた項目。確認画面のバッジ表示に使う */
  filled: {
    status: boolean;
    priority: boolean;
    categories: boolean;
    assignee: boolean;
    startDate: boolean;
    dueDate: boolean;
  };
  /** サブタスク。1階層のみ（子の children は常に空） */
  children: ParsedTask[];
}

/** 取り込みをブロックしない注意書き。確認画面の黄色ストリップに出す。 */
export type ParseWarning = MdParseWarning;

export interface ParseResult {
  tasks: ParsedTask[];
  warnings: ParseWarning[];
}

/** 解析時に必要な、画面側の文脈 */
export interface ParseContext {
  /** 担当者名の照合に使う。空配列なら照合せず、書かれた名前をそのまま採用する */
  memberNames: string[];
  /**
   * 既に使われている分類。同じ綴りがあればそれに寄せる（表記ゆれを増やさないため）。
   * チケットと違いマスタは無いので、候補に無い分類もそのまま採用する。
   */
  categoryOptions: string[];
}
