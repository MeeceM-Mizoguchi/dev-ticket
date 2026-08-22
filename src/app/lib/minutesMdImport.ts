// 議事録の「MDファイルから作成 / 一括MD取り込み」でファイルを読み取る部分。
// DBへの登録は呼び出し側(MinutesPage)が行い、ここは「ファイル → 議事録1件分の中身」だけを担う。
//
// Wiki(wikiMdImport)との違いは、議事録がタイトル以外に「開催日」「出席者」を持つこと。
// AI や手書きの議事録MDは冒頭に
//     # ○○定例会議 議事録
//     - 日時: 2026-08-22 10:00〜11:00
//     - 出席者: 山田太郎、佐藤花子
// のような前置きを持つことが多いので、そこだけを拾ってフィールドへ振り分ける。
// 本文の変換経路(markdownFileToHtml)は貼り付け・Wiki取り込みと同じなので、
// 見出し・表・コードブロックまでそのまま揃う。
import { markdownFileToHtml, MD_MAX_LENGTH } from "@/app/lib/markdown";
import { isWikiMarkdownFile, WIKI_MD_ACCEPT, WIKI_MD_MAX_BYTES } from "@/app/lib/wikiMdImport";
import { normalizeKey, splitKeyValue, matchMember } from "@/app/lib/mdImport/parseCommon";

/** input[type=file] の accept。Wiki / チケットのMD取り込みと揃える。 */
export const MINUTES_MD_ACCEPT = WIKI_MD_ACCEPT;

/** 開催日として読むキー */
const DATE_KEYS = new Set([
  "日時", "日付", "開催日", "開催日時", "開催", "実施日", "実施日時", "会議日", "会議日時",
  "date", "meetingdate", "datetime",
]);
/** 出席者として読むキー */
const ATTENDEE_KEYS = new Set([
  "出席者", "出席", "参加者", "参加", "参加メンバー", "出席メンバー", "メンバー", "同席者",
  "attendees", "attendee", "participants", "members",
]);

/** 前置きとして見る範囲（これより後ろの「日時:」らしき行は本文なので触らない） */
const META_SCAN_LINES = 15;

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const BULLET_RE = /^ {0,3}[-*+][ \t]+(.+?)[ \t]*$/;
/** `| 日時 | 2026-08-22 |` 形式の2列テーブル行 */
const TABLE_ROW_RE = /^ {0,3}\|([^|]+)\|([^|]*)\|\s*$/;
/** 出席者の区切り。半角スペースは姓名の区切りと紛れるので含めない。 */
const ATTENDEE_SPLIT_RE = /[、,，;；\/・･｜|]+/;

/** `**日時**` `` `日時` `` のような装飾を落とす */
function stripDecoration(s: string): string {
  return s.replace(/[*_`]/g, "").trim();
}

/** 「2026-08-22 10:00〜」「2026年8月22日(金)」などから日付部分だけを取り出す */
function pickDate(raw: string): string | null {
  const s = raw.replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  const m = /(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/.exec(s);
  if (!m) return null;
  return toIsoDate(m[1], m[2], m[3]);
}

/** 「20260822_定例.md」「2026-08-22 定例.md」のようなファイル名から日付を拾う */
function pickDateFromFileName(name: string): string | null {
  const m = /(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})/.exec(name);
  if (!m) return null;
  return toIsoDate(m[1], m[2], m[3]);
}

/** 実在しない日付(13月・2月31日など)は採用しない */
function toIsoDate(y: string, mo: string, d: string): string | null {
  const year = Number(y), month = Number(mo), day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** ファイル名（拡張子除く）をタイトルに使う。空になるときは既定名へ倒す。 */
function fileNameTitle(name: string): string {
  return name.replace(/\.(md|markdown|mdown|mkd)$/i, "").trim() || "新規議事録";
}

/** 「山田太郎、佐藤花子(SE)」→ ["山田太郎", "佐藤花子(SE)"]。メンバー名に一致すればその表記へ寄せる。 */
function parseAttendees(raw: string, memberNames: string[]): string[] {
  const out: string[] = [];
  for (const token of stripDecoration(raw).split(ATTENDEE_SPLIT_RE)) {
    const name = token.replace(/^[-*+\s]+/, "").trim();
    if (!name || name.length > 40) continue;
    const resolved = matchMember(name, memberNames) ?? name;
    if (!out.includes(resolved)) out.push(resolved);
    if (out.length >= 30) break;
  }
  return out;
}

/** 行から「キー: 値」を取り出す。箇条書き・素の行・2列テーブル行のどれでも読む。 */
function readMetaLine(line: string): { key: string; value: string; removable: boolean } | null {
  const table = TABLE_ROW_RE.exec(line);
  if (table) {
    const kv = { key: stripDecoration(table[1]), value: stripDecoration(table[2]) };
    // テーブルは1行だけ抜くと表が壊れるので、読むだけで本文には残す
    return kv.key ? { ...kv, removable: false } : null;
  }
  const bullet = BULLET_RE.exec(line);
  const kv = splitKeyValue(stripDecoration(bullet ? bullet[1] : line));
  return kv ? { key: kv.key, value: kv.value, removable: true } : null;
}

export interface ImportedMinute {
  title: string;
  /** yyyy-mm-dd。読めなければ呼び出し側が当日で埋める想定の "" */
  meetingDate: string;
  attendees: string[];
  /** RichEditor がそのまま扱えるHTML */
  content: string;
}

export interface MinutesMdImportResult {
  minutes: ImportedMinute[];
  skipped: { name: string; reason: string }[];
}

/**
 * MDテキスト1本を議事録1件分へ変換する。
 *
 * タイトルは「先頭の見出し」を優先し、無ければファイル名。議事録のMDはファイル名が
 * 日付だけということが多く、文書自身の見出しのほうが会議名として正確なため。
 * 見出しをタイトルへ移したときは本文から取り除く（フィールドと二重に出さない）。
 */
export function markdownToMinute(text: string, fileName: string, memberNames: string[]): ImportedMinute {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ").split("\n");

  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;

  const heading = i < lines.length ? HEADING_RE.exec(lines[i]) : null;
  const headingTitle = heading ? heading[2].trim() : "";
  const body = lines.slice(0);
  if (headingTitle) body[i] = "";   // タイトルへ移したので本文からは落とす

  // 前置き（見出しの次の行から、次の見出しの手前まで）だけをメタとして見る
  let meetingDate = "";
  let attendees: string[] = [];
  const start = headingTitle ? i + 1 : i;
  for (let j = start; j < lines.length && j < start + META_SCAN_LINES; j++) {
    if (HEADING_RE.test(lines[j])) break;
    if (!lines[j].trim()) continue;
    const meta = readMetaLine(lines[j]);
    if (!meta) continue;
    const key = normalizeKey(meta.key);
    if (!meetingDate && DATE_KEYS.has(key)) {
      const date = pickDate(meta.value);
      if (date) {
        meetingDate = date;
        if (meta.removable) body[j] = "";
      }
    } else if (attendees.length === 0 && ATTENDEE_KEYS.has(key)) {
      const names = parseAttendees(meta.value, memberNames);
      if (names.length > 0) {
        attendees = names;
        if (meta.removable) body[j] = "";
      }
    }
  }

  return {
    title: headingTitle || fileNameTitle(fileName),
    meetingDate: meetingDate || pickDateFromFileName(fileName) || "",
    attendees,
    content: markdownFileToHtml(body.join("\n")) ?? "",
  };
}

/**
 * .md ファイル群を読み込み、議事録1件分へ変換する。
 * 読めなかったファイルは skipped に理由付きで積み、読めた分はそのまま取り込む
 * （1件の失敗で一括取り込み全体を落とさない）。
 */
export async function readMinutesMarkdownFiles(
  files: File[],
  memberNames: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<MinutesMdImportResult> {
  const minutes: ImportedMinute[] = [];
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
          minutes.push(markdownToMinute(text, file.name, memberNames));
        }
      }
    }
    onProgress?.(minutes.length + skipped.length, total);
  }

  return { minutes, skipped };
}
