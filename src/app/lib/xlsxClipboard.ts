// BRU13-019 Excel エディタのセルのコピー＆貼り付け（クリップボードの読み書き）
// Handsontable 標準のコピーは文字だけで、塗り・揃え・折り返しは持ち出せない。
// そこで copy/cut/paste を自前で処理し、
//   ・text/plain … TSV（Excel や他アプリへ貼れる）
//   ・text/html  … 背景色つきの表（Excel へ色ごと貼れる）＋自前の完全な内容を data 属性で同梱
// の2形式を書き出す。エディタ内で貼るときは data 属性を読み戻して丸ごと再現する。
export type ClipAlignH = "left" | "center" | "right";
export type ClipAlignV = "top" | "middle" | "bottom";
export interface ClipFont {
  name?: string; size?: number; bold?: boolean; italic?: boolean; underline?: boolean; color?: string;
}
export interface ClipCell {
  raw: string;       // 数式は "=..."
  display: string;   // 表示テキスト
  fill: string | null;
  h?: ClipAlignH;
  v?: ClipAlignV;
  wrap: boolean;
  link?: string;
  /**
   * styles.xml の書式インデックス。フォント・サイズ・太字・罫線・表示形式まで
   * これ1つで運べるが、番号は同じファイル（token が一致するとき）でしか通じない。
   */
  style?: number;
  font?: ClipFont;   // 表示用＆他アプリへ渡すため
}
const CLIP_ATTR = "data-dvticket-xls";
export const emptyClip = (): ClipCell => ({ raw: "", display: "", fill: null, wrap: false });

const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const tsvField = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
export const clipToTsv = (cells: ClipCell[][]) => cells.map(r => r.map(c => tsvField(c.display)).join("\t")).join("\n");

export function clipToHtml(cells: ClipCell[][], token: string): string {
  const body = cells.map(r => "<tr>" + r.map(c => {
    const f = c.font ?? {};
    const st = [
      c.fill ? `background-color:${c.fill}` : "",
      c.h ? `text-align:${c.h}` : "",
      c.v ? `vertical-align:${c.v}` : "",
      c.wrap ? "white-space:pre-wrap" : "white-space:nowrap",
      f.name ? `font-family:'${f.name.replace(/['\\]/g, "")}'` : "",
      f.size ? `font-size:${f.size}pt` : "",
      f.bold ? "font-weight:bold" : "",
      f.italic ? "font-style:italic" : "",
      f.underline ? "text-decoration:underline" : "",
      f.color ? `color:${f.color}` : "",
    ].filter(Boolean).join(";");
    return `<td style="${st}">${escHtml(c.display).replace(/\n/g, "<br>")}</td>`;
  }).join("") + "</tr>").join("");
  // 自前の完全な内容。Chrome のクリップボードでも data 属性は残る
  const payload = encodeURIComponent(JSON.stringify({ token, cells }));
  return `<table ${CLIP_ATTR}="${payload}" border="1" style="border-collapse:collapse">${body}</table>`;
}

// TSV（引用符つきフィールド対応）
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') { cur += ch; continue; }
      if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === "\t") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// CSS の色を "#RRGGBB" に正規化する。白・透明・解釈できない値は「塗り無し」扱い
// （Excel や Google スプレッドシートは無色のセルにも white を書いてくるため）。
let colorCtx: CanvasRenderingContext2D | null | undefined;
const NAMED_COLORS: Record<string, string> = {
  white: "#FFFFFF", black: "#000000", red: "#FF0000", lime: "#00FF00", green: "#008000",
  blue: "#0000FF", yellow: "#FFFF00", aqua: "#00FFFF", cyan: "#00FFFF", fuchsia: "#FF00FF",
  magenta: "#FF00FF", silver: "#C0C0C0", gray: "#808080", grey: "#808080", maroon: "#800000",
  olive: "#808000", purple: "#800080", teal: "#008080", navy: "#000080", orange: "#FFA500",
};
// 名前つきの色は canvas に解かせる（描画はせず fillStyle の正規化だけ使う）
function canvasColor(s: string): string | null {
  try {
    if (colorCtx === undefined) colorCtx = document.createElement("canvas").getContext("2d");
    if (!colorCtx) return null;
    // 不正な値は代入が無視されるので、違う既定値から2回試して一致を見る
    colorCtx.fillStyle = "#000000"; colorCtx.fillStyle = s; const a = colorCtx.fillStyle;
    colorCtx.fillStyle = "#FFFFFF"; colorCtx.fillStyle = s; const b = colorCtx.fillStyle;
    return a === b && typeof a === "string" && a.startsWith("#") ? a : null;
  } catch { return null; }
}
export function normalizeColor(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s || /^(transparent|none|auto|inherit|initial|windowtext)$/.test(s)) return null;
  let hex: string | null = null;
  let m: RegExpExecArray | null;
  if ((m = /^#([0-9a-f]{3})$/.exec(s))) {
    hex = "#" + m[1].split("").map(ch => ch + ch).join("");
  } else if ((m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(s))) {
    if (m[2] && parseInt(m[2], 16) === 0) return null;  // 完全に透明
    hex = "#" + m[1];
  } else if ((m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+)%?)?\s*\)$/.exec(s))) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    hex = "#" + [m[1], m[2], m[3]]
      .map(x => Math.max(0, Math.min(255, Math.round(parseFloat(x)))).toString(16).padStart(2, "0")).join("");
  } else {
    hex = NAMED_COLORS[s] ?? canvasColor(s);
  }
  if (!hex) return null;
  const up = hex.toUpperCase();
  return up === "#FFFFFF" ? null : up;  // 無色のセルにも白を書くアプリがあるので白は塗り無し扱い
}

// 他アプリ（Excel / スプレッドシート / ブラウザ）からの表を読む
export function parseHtmlTable(html: string): ClipCell[][] | null {
  let doc: Document;
  try { doc = new DOMParser().parseFromString(html, "text/html"); } catch { return null; }
  const table = doc.querySelector("table");
  if (!table) return null;
  // Excel は class="xl65" と <style> の組み合わせで書式を書いてくる
  const classDecl = new Map<string, string>();
  for (const st of Array.from(doc.getElementsByTagName("style"))) {
    for (const m of (st.textContent ?? "").matchAll(/\.([\w-]+)[^{]*\{([^}]*)\}/g)) {
      classDecl.set(m[1], (classDecl.get(m[1]) ?? "") + ";" + m[2]);
    }
  }
  const declOf = (td: Element) => {
    let s = "";
    for (const cn of Array.from(td.classList)) s += ";" + (classDecl.get(cn) ?? "");
    s += ";" + (td.getAttribute("style") ?? "");
    const bg = td.getAttribute("bgcolor");
    if (bg) s += ";background-color:" + bg;
    return s;
  };
  const prop = (s: string, name: string) => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i").exec(s)?.[1].trim() ?? "";
  const textOf = (td: Element) => {
    const clone = td.cloneNode(true) as Element;
    for (const br of Array.from(clone.getElementsByTagName("br"))) br.replaceWith("\n");
    return (clone.textContent ?? "").replace(/\u00a0/g, " ").replace(/\r/g, "").trim();
  };
  const out: ClipCell[][] = [];
  for (const tr of Array.from(table.getElementsByTagName("tr"))) {
    const line: ClipCell[] = [];
    for (const td of Array.from(tr.children)) {
      if (td.tagName !== "TD" && td.tagName !== "TH") continue;
      const s = declOf(td);
      const text = textOf(td);
      const h = prop(s, "text-align"), v = prop(s, "vertical-align"), ws = prop(s, "white-space");
      // background は "#FFFF00 none repeat" のような複合指定もあるので先頭語も試す
      const bgRaw = prop(s, "background-color") || prop(s, "background");
      line.push({
        raw: text, display: text,
        fill: normalizeColor(bgRaw) ?? normalizeColor(bgRaw.split(/\s+/)[0]),
        h: h === "left" || h === "center" || h === "right" ? h : undefined,
        v: v === "top" || v === "bottom" ? v : (v === "middle" || v === "center" ? "middle" : undefined),
        wrap: ws ? !/nowrap/i.test(ws) : text.includes("\n"),
      });
      const span = Number(td.getAttribute("colspan") ?? 1);
      for (let k = 1; k < span && k < 64; k++) line.push(emptyClip());
    }
    if (line.length) out.push(line);
  }
  return out.length ? out : null;
}

// 自前のコピー（data 属性）を読み戻す。token は「同じ読み込み中のファイルか」の目印で、
// 一致するときだけ書式インデックス（style）を使ってよい。
export function readClipPayload(html: string): { token: string; cells: ClipCell[][] } | null {
  const m = new RegExp(`${CLIP_ATTR}="([^"]*)"`).exec(html);
  if (!m) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(m[1]));
    const cells = Array.isArray(parsed) ? parsed : parsed?.cells;   // 旧形式（配列のみ）にも対応
    if (Array.isArray(cells) && cells.every((r: unknown) => Array.isArray(r))) {
      return { token: typeof parsed?.token === "string" ? parsed.token : "", cells: cells as ClipCell[][] };
    }
  } catch { /* 壊れていれば通常の表として読む */ }
  return null;
}
