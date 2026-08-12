// ホワイトボードへ貼り付けたテキストを、図として取り込む。
//
// Markdown（Claude のコピーボタン等）は共通の Markdown パーサ（app/lib/markdown）で IR にしてから、
// ブロックごとにホワイトボードの表現へ変換する。書式の無い素のテキストも
// pastePlainTextToWhiteboard で自前に組む（後述・BRU11-037）。
//
// ブロックごとの変換:
//
//   表        → ホワイトボードの表（セル矩形＋groupId・whiteboardTableCreate と共通）
//   ```mermaid → mermaid-to-excalidraw で図に展開（whiteboardMermaid と共通）
//   見出し     → 大きめのテキスト要素
//   段落/引用/リスト/コード → テキスト要素（Excalidraw に文字装飾が無いため書式記号は落とす）
//   ---       → 水平線
//
// 生成物は縦に積み、最後にまとめて1回だけ updateScene する（＝undo 1回で貼り付け前に戻る）。
import { convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { MdBlock, MdInline } from "./markdown";
import { looksLikeMarkdown, parseMarkdown, MD_MAX_LENGTH } from "./markdown";
import { createTableElements } from "./whiteboardTableCreate";
import { boundsOf, mermaidToElements, placeTopLeft } from "./whiteboardMermaid";
import { fontString, lineW, wrapText } from "./whiteboardText";

const MAX_W = 640;                 // 本文の折り返し幅
const GAP = 24;                    // ブロック間の縦の余白
const SOFT_BLACK = "#343a40";      // 本文色（CLEAN_DEFAULTS と揃える）
const HEADING_COLOR = "#1e1e1e";   // 見出しは少し濃く
const QUOTE_COLOR = "#6b6458";     // 引用は少し薄く
const RULE_COLOR = "#adb5bd";      // 水平線・引用の縦線
const CODE_BG = "#f1f3f5";         // コードブロックの背景
const NORMAL_FONT = 2;             // Helvetica
const CODE_FONT = 3;               // Cascadia Code（等幅）
const BODY_SIZE = 16;
const CODE_SIZE = 14;
const HPAD = 5;                    // 表セルの左右余白（whiteboardTable と同じ）
const TABLE_MIN_COL = 60;
const TABLE_MAX_COL = 320;
const TABLE_MAX_TOTAL = 1400;

const LINK_COLOR = "#1971c2";      // リンク文字の色（whiteboardTextColor の TEXT_COLORS と同じ青）

const headingSize = (level: number) => (level === 1 ? 28 : level === 2 ? 24 : level === 3 ? 20 : 18);

// ── リンク ──
// Excalidraw は「要素1つにつきリンク1本」（element.link）しか持てないため、
// ブロック/セルの中にリンクがちょうど1つのときだけ、その要素のリンクとして設定する。
// 文字全体がそのリンクなら、wiki と同じく文字色も青にして「リンクである」ことを見せる。

/** 相対URL(/PROJxxx/wiki/... 等)を絶対URLに直す。開けないリンクは null。 */
function absoluteUrl(href: string): string | null {
  const s = (href ?? "").trim();
  if (!s || s.startsWith("#")) return null;
  if (/^(javascript|data|vbscript):/i.test(s)) return null;
  if (/^(https?|mailto|tel):/i.test(s)) return s;
  try { return new URL(s, window.location.href).toString(); } catch { return null; }
}

function collectLinks(nodes: MdInline[], out: { href: string; text: string }[] = []): { href: string; text: string }[] {
  for (const n of nodes) {
    if (n.t === "link") { out.push({ href: n.href, text: inlineToPlain(n.children) }); continue; }
    // text / image はリンクを持たない
  }
  return out;
}

/** リンクがちょうど1つならそのURLと「文字全体がリンクか」を返す */
function linkOf(nodes: MdInline[]): { href: string; whole: boolean } | null {
  const ls = collectLinks(nodes);
  if (ls.length !== 1) return null;
  const href = absoluteUrl(ls[0].href);
  if (!href) return null;
  return { href, whole: inlineToPlain(nodes).trim() === ls[0].text.trim() };
}

// ── インライン → 素のテキスト（Excalidraw には太字/斜体が無いので記号ごと落とす） ──
function inlineToPlain(nodes: MdInline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.t === "text") out += n.v;
    else if (n.t === "link") out += inlineToPlain(n.children);
    else out += n.alt;
  }
  return out;
}

/** ブロック（引用の中身・リストの入れ子など）を素のテキスト行へ落とす */
function blockToPlain(b: MdBlock, indent = ""): string[] {
  switch (b.t) {
    case "heading": return [indent + inlineToPlain(b.children)];
    case "para": return inlineToPlain(b.children).split("\n").map((l) => indent + l);
    case "code": return b.code.split("\n").map((l) => indent + l);
    case "mermaid": return b.code.split("\n").map((l) => indent + l);
    case "hr": return [indent + "―――"];
    case "quote": return b.blocks.flatMap((x) => blockToPlain(x, indent));
    case "list": return listLines(b, indent);
    case "table": return [b.header, ...b.rows].map((r) => indent + r.map((c) => inlineToPlain(c)).join("  |  "));
  }
}

/** リストを「• 項目」「1. 項目」の行へ。入れ子は4スペースぶら下げ（whiteboardIndent と同じ半角スペース） */
function listLines(b: MdBlock & { t: "list" }, indent: string): string[] {
  const out: string[] = [];
  let n = b.start;
  for (const it of b.items) {
    const bullet = b.ordered ? `${n}. ` : indent.length >= 4 ? "◦ " : "• ";
    const check = it.checked === undefined ? "" : it.checked ? "☑ " : "☐ ";
    out.push(indent + bullet + check + inlineToPlain(it.children).replace(/\n/g, " "));
    for (const s of it.sub) out.push(...blockToPlain(s, indent + "    "));
    n++;
  }
  return out;
}

// ── テキスト要素 ──
function textElement(raw: string, x: number, y: number, opts: {
  fontSize?: number; fontFamily?: number; color?: string; maxW?: number; link?: string | null;
} = {}): any[] {
  const fontSize = opts.fontSize ?? BODY_SIZE;
  const fontFamily = opts.fontFamily ?? NORMAL_FONT;
  const font = fontString(fontSize, fontFamily);
  const maxW = opts.maxW ?? MAX_W;
  // 折り返しは自前で行う（Excalidraw のテキスト要素は幅を指定しないと折り返さない）。
  const lines = wrapText(raw === "" ? " " : raw, font, maxW);
  const els = convertToExcalidrawElements([{
    type: "text",
    x, y,
    text: lines.join("\n"),
    fontSize,
    fontFamily,
    textAlign: "left",
    verticalAlign: "top",
    strokeColor: opts.color ?? SOFT_BLACK,
    ...(opts.link ? { link: opts.link } : {}),
  } as any]) as any[];
  return els;
}

/** リンク付きのテキスト要素を作る（文字全体がリンクなら青くする） */
function linkedTextElement(nodes: MdInline[], raw: string, x: number, y: number, opts: {
  fontSize?: number; fontFamily?: number; color?: string; maxW?: number;
} = {}): any[] {
  const l = linkOf(nodes);
  return textElement(raw, x, y, {
    ...opts,
    link: l?.href ?? null,
    color: l?.whole ? LINK_COLOR : opts.color,
  });
}

// ── 表 ──
function tableElements(b: MdBlock & { t: "table" }, x: number, y: number): any[] {
  const rows = [b.header, ...b.rows];
  const cells = rows.map((r) => r.map((c) => inlineToPlain(c).replace(/\n/g, " ")));
  const cols = Math.max(...cells.map((r) => r.length));
  const font = fontString(BODY_SIZE, NORMAL_FONT);
  const widths: number[] = [];
  for (let c = 0; c < cols; c++) {
    let w = TABLE_MIN_COL;
    for (const row of cells) w = Math.max(w, Math.ceil(lineW(row[c] ?? "", font)) + 2 * HPAD);
    widths.push(Math.min(TABLE_MAX_COL, w));
  }
  // 全体が広くなりすぎたら比例縮小（最小幅は保つ）
  const total = widths.reduce((a, b2) => a + b2, 0);
  if (total > TABLE_MAX_TOTAL) {
    const scale = TABLE_MAX_TOTAL / total;
    for (let c = 0; c < cols; c++) widths[c] = Math.max(TABLE_MIN_COL, Math.floor(widths[c] * scale));
  }
  // セル内のリンク（1本だけのとき）をセル矩形の要素リンクにする
  const cellLinks = rows.map((r) => Array.from({ length: cols }, (_, c) => {
    const l = r[c] ? linkOf(r[c]) : null;
    return l ? { href: l.href, whole: l.whole } : null;
  }));

  return createTableElements({
    x, y,
    rows: cells.length,
    cols,
    cells: cells.map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? "")),
    cellLinks,
    linkColor: LINK_COLOR,
    colWidths: widths,
    header: true,
  });
}

// ── コードブロック（等幅テキスト＋薄いグレーの背景板を1グループに） ──
function codeElements(code: string, x: number, y: number): any[] {
  const PAD = 12;
  const text = textElement(code || " ", x + PAD, y + PAD, { fontSize: CODE_SIZE, fontFamily: CODE_FONT, maxW: MAX_W - PAD * 2 });
  const tb = boundsOf(text);
  const gid = `wb_md_code_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const rect = convertToExcalidrawElements([{
    type: "rectangle",
    x, y,
    width: Math.max(120, tb.maxX - x + PAD),
    height: Math.max(32, tb.maxY - y + PAD),
    backgroundColor: CODE_BG,
    fillStyle: "solid",
    strokeColor: "transparent",
    strokeWidth: 1,
    roughness: 0,
  } as any]) as any[];
  for (const e of rect) { e.roundness = null; e.groupIds = [gid]; }
  for (const e of text) { e.groupIds = [gid]; }
  return [...rect, ...text];   // 背景板を先に（＝下に）置く
}

// ── 引用（左の縦線＋薄い色のテキスト） ──
function quoteElements(b: MdBlock & { t: "quote" }, x: number, y: number): any[] {
  const BAR = 12;
  const inline = b.blocks.flatMap((s) => (s.t === "para" || s.t === "heading" ? s.children : []));
  const text = linkedTextElement(inline, b.blocks.flatMap((s) => blockToPlain(s)).join("\n"), x + BAR + 8, y, {
    color: QUOTE_COLOR, maxW: MAX_W - BAR - 8,
  });
  const h = Math.max(20, boundsOf(text).maxY - y);
  const bar = convertToExcalidrawElements([{
    type: "line",
    x, y,
    points: [[0, 0], [0, h]],
    strokeColor: RULE_COLOR,
    strokeWidth: 2,
    roughness: 0,
    // 飾りの線は自動接続の対象外にする（近くの図形へ端点が吸着して曲がるのを防ぐ）
    customData: { wbDecor: true },
  } as any]) as any[];
  for (const e of bar) { e.roundness = null; e.customData = { ...(e.customData ?? {}), wbDecor: true }; }
  return [...bar, ...text];
}

// ── 水平線 ──
function hrElements(x: number, y: number): any[] {
  const els = convertToExcalidrawElements([{
    type: "line",
    x, y,
    points: [[0, 0], [MAX_W, 0]],
    strokeColor: RULE_COLOR,
    strokeWidth: 1,
    roughness: 0,
    customData: { wbDecor: true },
  } as any]) as any[];
  for (const e of els) { e.roundness = null; e.customData = { ...(e.customData ?? {}), wbDecor: true }; }
  return els;
}

/** 1ブロック分の要素を (x, y) を左上として作る */
async function blockElements(api: any, b: MdBlock, x: number, y: number): Promise<any[]> {
  switch (b.t) {
    case "heading":
      return linkedTextElement(b.children, inlineToPlain(b.children), x, y, { fontSize: headingSize(b.level), color: HEADING_COLOR });
    case "para":
      return linkedTextElement(b.children, inlineToPlain(b.children), x, y);
    case "list": {
      // 項目ごとに別リンクは持てない（要素1つにリンク1本）ので、リスト全体で1本のときだけ付ける
      const all = b.items.flatMap((it) => it.children);
      return linkedTextElement(all, listLines(b, "").join("\n"), x, y);
    }
    case "quote":
      return quoteElements(b, x, y);
    case "code":
      return codeElements(b.code, x, y);
    case "table":
      return tableElements(b, x, y);
    case "hr":
      return hrElements(x, y);
    case "mermaid":
      try {
        const els = await mermaidToElements(api, b.code);
        return placeTopLeft(els, x, y);
      } catch {
        // 図にできない定義はコードのまま置く（内容を失わせない）
        return codeElements(b.code, x, y);
      }
  }
}

/**
 * Markdown テキストをホワイトボードへ貼り付ける。変換した場合のみ true。
 * @param at 貼り付け位置（scene座標・左上）
 */
export async function pasteMarkdownToWhiteboard(api: any, text: string, at: { x: number; y: number }): Promise<boolean> {
  if (!api || !text || text.length > MD_MAX_LENGTH) return false;
  if (!looksLikeMarkdown(text)) return false;
  return pasteBlocksToWhiteboard(api, parseMarkdown(text), at);
}

/** IR(MdBlock[]) をホワイトボードへ貼り付ける。Markdown / HTML どちらの経路もここへ合流する。 */
export async function pasteBlocksToWhiteboard(api: any, blocks: MdBlock[], at: { x: number; y: number }): Promise<boolean> {
  if (!api || !blocks.length) return false;

  const created: any[] = [];
  let y = at.y;
  for (const b of blocks) {
    let els: any[] = [];
    try { els = await blockElements(api, b, at.x, y); } catch { els = []; }
    if (!els.length) continue;
    created.push(...els);
    y = boundsOf(els).maxY + GAP;
  }
  return commitPaste(api, created);
}

/** 生成した要素をシーンへ入れて選択する（貼り付け経路の共通の締め）。 */
function commitPaste(api: any, created: any[]): boolean {
  if (!created.length) return false;

  // 貼り付け全体を undo 履歴の1ステップとして記録（IMMEDIATELY）。
  api.updateScene({ elements: [...api.getSceneElements(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  // 貼り付けたものだけを選択（選択のみは履歴に残さない・NEVER）
  const ids: Record<string, boolean> = {};
  created.forEach((e) => { if (e?.id) ids[e.id] = true; });
  api.updateScene({ appState: { selectedElementIds: ids }, captureUpdate: CaptureUpdateAction.NEVER });
  return true;
}

// ── 書式の無い素のテキスト（BRU11-037） ──
//
// Excalidraw 既定の貼り付け（App.addTextFromPaste）は行ごとにテキスト要素を作るが、
//   ・貼り付け点を中心に左右中央へ置く（x - 幅/2）＝全部が真ん中寄せに見える
//   ・縦は「貼り付け点から高さ/2 だけ上」に置くのに、次の行への送りは「高さ + 10」
// という組み方なので、折り返して背が高くなった行ほど上へ大きくずれ、前の行に食い込む。
// 長文（＝折り返しが起きる文章）を貼るとこれが積み重なって行同士が重なり、表示が崩れる。
//
// そこで素のテキストは自前で組む: 貼り付け点を左上として、テキストボックス1枚に丸ごと入れる。
//   ・改行・空行は元のまま残す（行ごとにバラバラの要素へ切らない＝あとから文章として直せる）
//   ・折り返しは MAX_W。左揃え（Markdown 経路と同じ組み方）
// ただし Excalidraw 側に専用の受け皿がある形（mermaid 定義／埋め込みURL／グラフ化できる表）は
// 横取りせず既定に任せる。

const URL_LINE = /^https?:\/\/\S+$/i;

// Excalidraw の isMaybeMermaidDefinition と同じ図種（先頭行で mermaid 定義かを見る）
const MERMAID_HEAD = /^(?:%%\{.*?\}%%\s*)?(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|mindmap|timeline|zenuml|sankey|xychart|block)(?:-beta)?\b/;

// Excalidraw の tryParseNumber と同じ「数値とみなす」判定
const NUM_CELL = /^([-+]?)[$€£¥₩]?([-+]?)([\d.,]+)[%]?$/;

/** 2列以下・数値の列を持つ表か（Excalidraw の tryParseCells 相当＝グラフ化ダイアログの対象） */
function chartableCells(rows: string[][]): boolean {
  const cols = rows[0]?.length ?? 0;
  if (cols < 1 || cols > 2 || rows.length < 2) return false;
  // 先頭行は見出しのことがあるので、2行目以降がすべて数値の列があれば対象とみなす
  return rows[0].some((_, c) => rows.slice(1).every((r) => NUM_CELL.test(r[c] ?? "")));
}

/** Excalidraw の tryParseSpreadsheet 相当（タブ区切り優先・縦横どちらの向きでも見る） */
function looksLikeSpreadsheet(text: string): boolean {
  const raw = text.trim();
  let rows = raw.split("\n").map((l) => l.trim().split("\t"));
  if (rows[0]?.length !== 2) rows = raw.split("\n").map((l) => l.trim().split(","));
  if (!rows.length || !rows.every((r) => r.length === rows[0].length)) return false;
  const transposed = rows[0].map((_, c) => rows.map((r) => r[c]));
  return chartableCells(rows) || chartableCells(transposed);
}

/** 素のテキストとして自前で組むべき貼り付けか（false なら Excalidraw の既定に任せる） */
export function shouldPastePlainText(text: string): boolean {
  if (!text || text.length > MD_MAX_LENGTH) return false;
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return false;
  if (MERMAID_HEAD.test(text.trim())) return false;       // mermaid 定義は図に展開させる
  if (lines.every((l) => URL_LINE.test(l))) return false; // URLだけの貼り付けは埋め込みにさせる
  if (looksLikeSpreadsheet(text)) return false;           // 2列の数値表はグラフ化ダイアログに任せる
  return true;
}

/**
 * 貼り付けたテキストを整える。**改行と空行はそのまま残す**（元の行の切れ目を再現するため）。
 * タブは Excalidraw の normalizeText と同じ8スペースへ寄せて、折り返し計算と表示をずらさない。
 */
function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "        ")
    .split("\n").map((l) => l.replace(/[ 　]+$/, "")).join("\n") // 行末の余白だけ落とす
    .replace(/^\n+|\n+$/g, "");                                      // 前後の空行を落とす
}

/**
 * 書式の無い素のテキストを、テキストボックス1枚としてホワイトボードへ貼り付ける。作った場合のみ true。
 * @param at 貼り付け位置（scene座標・左上）
 */
export function pastePlainTextToWhiteboard(api: any, text: string, at: { x: number; y: number }): boolean {
  if (!api) return false;
  const body = normalizePlainText(text);
  if (!body) return false;
  return commitPaste(api, textElement(body, at.x, at.y));
}
