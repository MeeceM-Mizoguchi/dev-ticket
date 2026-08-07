// Wiki の「MDファイルから作成 / 一括MD取り込み」でファイルを読み取る部分。(BRU10-080)
// DBへの登録は呼び出し側(WikiPage)が行い、ここは「ファイル → ページの中身」だけを担う。
import { markdownFileToHtml, MD_MAX_LENGTH } from "@/app/lib/markdown";

/** file.type は環境により空文字や text/plain になり当てにならないため、拡張子で判定する。 */
const WIKI_MD_EXTENSION_RE = /\.(md|markdown|mdown|mkd)$/i;
/** input[type=file] の accept。MD一括作成(チケット側)と揃える。 */
export const WIKI_MD_ACCEPT = ".md,.markdown,.mdown,.mkd,text/markdown";
/** 解析コストと事故防止の上限。設計書クラス(数十KB)でも十分に余裕がある。 */
export const WIKI_MD_MAX_BYTES = 2 * 1024 * 1024;

export function isWikiMarkdownFile(file: File): boolean {
  return WIKI_MD_EXTENSION_RE.test(file.name);
}

/** ファイル名（拡張子除外）をページタイトルにする。空になるときは既定名へ倒す。 */
export function mdFileNameToTitle(name: string): string {
  return name.replace(WIKI_MD_EXTENSION_RE, "").trim() || "無題のページ";
}

export interface ImportedMdPage {
  title: string;
  /** RichEditor がそのまま扱えるHTML */
  content: string;
}

export interface MdImportResult {
  pages: ImportedMdPage[];
  skipped: { name: string; reason: string }[];
}

/**
 * .md ファイル群を読み込み、ページ1件分の {タイトル, 本文HTML} に変換する。
 * 読めなかったファイルは skipped に理由付きで積み、読めた分はそのまま取り込む
 * （1件の失敗で一括取り込み全体を落とさない）。
 */
export async function readWikiMarkdownFiles(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<MdImportResult> {
  const pages: ImportedMdPage[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const total = files.length;

  for (const file of files) {
    if (!isWikiMarkdownFile(file)) {
      skipped.push({ name: file.name, reason: "MDファイルではありません" });
    } else if (file.size > WIKI_MD_MAX_BYTES) {
      skipped.push({ name: file.name, reason: `ファイルが大きすぎます（上限 ${Math.round(WIKI_MD_MAX_BYTES / 1024 / 1024)}MB）` });
    } else {
      let text: string | null = null;
      try {
        text = await file.text();
      } catch {
        skipped.push({ name: file.name, reason: "ファイルを読み込めませんでした" });
      }
      if (text !== null) {
        if (text.length > MD_MAX_LENGTH) {
          skipped.push({ name: file.name, reason: "内容が大きすぎます" });
        } else {
          // 空ファイルでも「ファイル名のページ」は作りたいので、変換不可(null)は空本文として通す
          pages.push({ title: mdFileNameToTitle(file.name), content: markdownFileToHtml(text) ?? "" });
        }
      }
    }
    onProgress?.(pages.length + skipped.length, total);
  }

  return { pages, skipped };
}
