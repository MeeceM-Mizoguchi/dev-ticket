// ENHA2-035 Word(.docx) → 編集用HTML
//
// 骨組み（段落・見出し・箇条書き・表・画像・リンク・脚注）は mammoth に任せ、
// mammoth が落としてしまう書式を docxLook が読んだ値から着せ直す。
//   ラン   … スタイルマップに「ランのスタイル名」を割り当てて span を出させる
//   段落   … 同じくスタイル名を割り当てて p/h1..h6 にクラスを付けさせる
//            （箇条書きは mammoth のリスト化を壊さないよう触らない）
//   表     … 出力後のHTMLに列幅とセル書式を差し込む
//
// ラン・段落の突き合わせは「文書順＋本文一致」で確かめ、1つでもズレたら
// そこで着せるのをやめる（ズレたまま着せると別の場所が化けるため）。
// 着せられなくても mammoth の変換結果そのものは無傷なので、
// 最悪でも「書式が付かない」だけで済む。

import { readDocxLook, type BlockKind, type DocxLook } from "./docxLook";

export interface EditorDocx {
  html: string;
  look: DocxLook | null;
}

/** mammoth の要素の本文（テキストノードだけ拾う） */
function elementText(el: any): string {
  let out = "";
  const walk = (node: any) => {
    if (!node) return;
    if (node.type === "text") { out += node.value ?? ""; return; }
    (node.children ?? []).forEach(walk);
  };
  (el.children ?? []).forEach(walk);
  return out;
}

/** 同じ書式をひとまとめにして、mammoth のスタイル名（＝出力されるクラス名）を振る */
class StyleBucket<T> {
  readonly items: T[] = [];
  private readonly index = new Map<string, number>();
  constructor(private readonly prefix: string) {}

  nameFor(key: string, item: T): string {
    let i = this.index.get(key);
    if (i === undefined) { i = this.items.length; this.items.push(item); this.index.set(key, i); }
    return `${this.prefix}${i}`;
  }

  entries(to: (name: string, item: T) => string): string[] {
    return this.items.map((item, i) => to(`${this.prefix}${i}`, item));
  }
}

/** class="dvfmt-3" のようなクラスを、そのままインラインstyleに置き換える */
function classToStyle(html: string, prefix: string, css: string[]): string {
  const re = new RegExp(`class="${prefix}(\\d+)"`, "g");
  return html.replace(re, (_m, n) => {
    const style = css[Number(n)];
    return style ? `style="${style}"` : "";
  });
}

/**
 * 表に列幅とセル書式を差し込む。
 * mammoth の出力は機械生成なのでタグを順に走査すれば足りる。
 * セル数が docx と食い違う表（縦結合など）は、その行の書式だけ諦める。
 */
function applyTableLooks(html: string, look: DocxLook): string {
  if (!look.tables.length) return html;
  let tableIndex = -1;
  let rowIndex = -1;
  let cellIndex = -1;
  // 結合セルが出たら、それ以降はセルの並びが docx とズレるので着せるのをやめる
  let merged = false;
  return html.replace(/<table>|<tr>|<t([hd])([^>]*)>/g, (m, td, rest) => {
    if (m === "<table>") {
      tableIndex++; rowIndex = -1;
      // 表の既定罫線は表そのものに持たせる。こうしておくと、編集中に足した行や
      // セルも同じ罫線で描かれ、保存時も同じ罫線で書き出せる。
      merged = false;
      const border = look.tables[tableIndex]?.defaultBorder;
      return border ? `<table style="--dv-cell-border:${border}">` : m;
    }
    if (m === "<tr>") { rowIndex++; cellIndex = -1; return m; }
    cellIndex++;
    const table = look.tables[tableIndex];
    if (!table || merged) return m;
    if (/colspan=|rowspan=/.test(rest)) merged = true;
    const styles: string[] = [];
    // 1行目のセルに列幅を持たせる（table-layout:fixed で Word と同じ割り付けになる）
    if (rowIndex === 0 && table.colWidthsPct && !/colspan=/.test(rest)) {
      const width = table.colWidthsPct[cellIndex];
      if (width) styles.push(`width:${width}%`);
    }
    const row = table.rows[rowIndex];
    if (row && row[cellIndex]) styles.push(row[cellIndex]);
    return styles.length ? `<t${td}${rest} style="${styles.join(";")}">` : m;
  });
}

/**
 * docx のバイト列を、編集用のHTML＋見た目情報に変換する。
 * @param mammothModule テスト時に node 版 mammoth を差し込むための口（通常は省略）
 */
export async function docxToEditorHtml(bytes: Uint8Array, mammothModule?: any): Promise<EditorDocx> {
  const mod: any = mammothModule ?? (await import("mammoth/mammoth.browser"));
  const mammoth = mod.default ?? mod;

  const look = readDocxLook(bytes);

  const runBucket = new StyleBucket<string>("dvfmt-");
  const paraBucket = new StyleBucket<{ kind: BlockKind; css: string }>("dvpar-");
  const runNames = look ? look.runs.map(r => (r.css ? runBucket.nameFor(r.css, r.css) : null)) : [];
  const paraNames = look
    ? look.paragraphs.map(p => (p.isList ? null : paraBucket.nameFor(`${p.kind}|${p.css}`, { kind: p.kind, css: p.css })))
    : [];

  let runAt = 0;
  let paraAt = 0;
  let runOk = !!look;
  let paraOk = !!look;
  const transformRun = (run: any) => {
    if (!runOk || !look) return run;
    const expected = look.runs[runAt];
    if (!expected || expected.text !== elementText(run)) { runOk = false; return run; }
    const name = runNames[runAt++];
    return name ? { ...run, styleName: name } : run;
  };
  const transformParagraph = (para: any) => {
    if (!paraOk || !look) return para;
    const expected = look.paragraphs[paraAt];
    if (!expected || expected.text !== elementText(para)) { paraOk = false; return para; }
    const name = paraNames[paraAt++];
    // 箇条書き（mammoth が numbering から li にする段落）はリスト化を壊さないよう触らない
    return name && !para.numbering ? { ...para, styleName: name } : para;
  };

  const styleMap = [
    // 下線は mammoth の既定では捨てられる（Word で引いた下線を残す）
    "u => u",
    ...paraBucket.entries((name, item) => `p[style-name='${name}'] => ${item.kind}.${name}:fresh`),
    ...runBucket.entries(name => `r[style-name='${name}'] => span.${name}`),
  ];

  const { value } = await mammoth.convertToHtml(
    { arrayBuffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    {
      styleMap,
      transformDocument: (doc: any) =>
        mammoth.transforms.paragraph(transformParagraph)(mammoth.transforms.run(transformRun)(doc)),
    },
  );

  let html = value || "<p></p>";
  html = classToStyle(html, "dvfmt-", runBucket.items);
  html = classToStyle(html, "dvpar-", paraBucket.items.map(i => i.css));
  html = html
    // thead/tbody は TipTap の表スキーマに無い（行が table 直下に来る形にする）
    .replace(/<\/?(?:thead|tbody|tfoot)>/g, "")
    // Word のブックマーク（Googleドキュメント書き出しが大量に埋める空アンカー）
    .replace(/<a id="[^"]*"><\/a>/g, "");
  if (look) html = applyTableLooks(html, look);

  if (look && (!runOk || !paraOk)) {
    console.warn("[docxToHtml] 途中で並びが合わなくなったため、以降の書式は反映していません",
      { ラン: `${runAt}/${look.runs.length}`, 段落: `${paraAt}/${look.paragraphs.length}` });
  }
  return { html, look };
}
