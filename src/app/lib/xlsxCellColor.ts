// Excel セルの色（styles.xml の色指定）を CSS 色へ解決する
//
// ★背景: exceljs は <fgColor theme="4" tint="0.8"/> を { theme: 4, tint: 0.8 } の
//   まま返し、argb プロパティを持たない。テーマ色／インデックス色を解決しないと、
//   Excel では色が付いているセルがビューアでは真っ白に見えてしまう。
//   （Excel の「塗りつぶしの色」パレットの既定色はほぼ全部テーマ色）

import { unzipSync, strFromU8 } from "fflate";

/** exceljs が返す色オブジェクト（どれか1つが入る） */
export interface ExcelColor {
  argb?: string;
  theme?: number;
  tint?: number;
  indexed?: number;
}

/** theme 番号 → 色（12色）。未取得なら空配列 */
export type ThemePalette = string[];

// SpreadsheetML の theme 番号 → theme1.xml の clrScheme 要素名。
// ★注意: XML の並びは dk1,lt1,dk2,lt2,... だが、Excel の theme 番号は
//   0=lt1(背景1), 1=dk1(テキスト1), 2=lt2, 3=dk2 と入れ替わっている。
const THEME_ORDER = [
  "lt1", "dk1", "lt2", "dk2",
  "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
  "hlink", "folHlink",
];

// 旧来の 64色インデックスパレット（indexed="N"）。64/65 はシステム色なので解決しない。
const INDEXED = [
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF",
  "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080",
  "9999FF", "993366", "FFFFCC", "CCFFFF", "660066", "FF8080", "0066CC", "CCCCFF",
  "000080", "FF00FF", "FFFF00", "00FFFF", "800080", "800000", "008080", "0000FF",
  "00CCFF", "CCFFFF", "CCFFCC", "FFFF99", "99CCFF", "FF99CC", "CC99FF", "FFCC99",
  "3366FF", "33CCCC", "99CC00", "FFCC00", "FF9900", "FF6600", "666699", "969696",
  "003366", "339966", "003300", "333300", "993300", "993366", "333399", "333333",
];

const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";

/** xlsx バイト列から xl/theme/theme1.xml を読み、theme 番号順の色表を作る */
export function parseThemePalette(bytes: Uint8Array | ArrayBuffer): ThemePalette {
  try {
    const files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const entry = files["xl/theme/theme1.xml"]
      ?? files[Object.keys(files).find(k => /^xl\/theme\/theme\d+\.xml$/.test(k)) ?? ""];
    if (!entry) return [];
    const doc = new DOMParser().parseFromString(strFromU8(entry), "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return [];
    const scheme = doc.getElementsByTagNameNS(NS_A, "clrScheme")[0];
    if (!scheme) return [];

    const byName = new Map<string, string>();
    for (const el of Array.from(scheme.children)) {
      const srgb = Array.from(el.children).find(c => c.localName === "srgbClr");
      const sys = Array.from(el.children).find(c => c.localName === "sysClr");
      const hex = srgb?.getAttribute("val") ?? sys?.getAttribute("lastClr");
      if (hex) byName.set(el.localName, hex.toUpperCase());
    }
    return THEME_ORDER.map(n => byName.get(n) ?? "");
  } catch {
    return [];
  }
}

// ── tint（明度の増減）─────────────────────────────────────────
// SpreadsheetML の tint は HLS の輝度に対して効く（DrawingML の tint とは式が違う）。
//   tint > 0 : L' = L * (1 - tint) + tint   （白へ寄せる）
//   tint < 0 : L' = L * (1 + tint)          （黒へ寄せる）
function applyTint(hex: string, tint: number): string {
  const n = parseInt(hex, 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;

  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  const l2 = Math.min(1, Math.max(0, tint > 0 ? l * (1 - tint) + tint : l * (1 + tint)));

  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r2 = l2, g2 = l2, b2 = l2;
  if (s !== 0) {
    const q = l2 < 0.5 ? l2 * (1 + s) : l2 + s - l2 * s;
    const p = 2 * l2 - q;
    r2 = hue(p, q, h + 1 / 3); g2 = hue(p, q, h); b2 = hue(p, q, h - 1 / 3);
  }
  const to2 = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0").toUpperCase();
  return to2(r2) + to2(g2) + to2(b2);
}

/**
 * exceljs の色オブジェクトを CSS の "#RRGGBB" へ。解決できなければ null。
 * @param theme parseThemePalette() の結果
 */
export function resolveCellColor(c: ExcelColor | null | undefined, theme: ThemePalette): string | null {
  if (!c) return null;

  let hex: string | null = null;
  if (typeof c.argb === "string") {
    // ★先頭2桁(アルファ)は無視する。Excel も Google スプレッドシートも無視しており、
    //   exceljs / openpyxl は 6桁で指定された色を "00RRGGBB" と書き出す。
    //   00 を「透明」と解釈すると、それらが作った xlsx の塗りが丸ごと消える（BRU10-055）。
    //   xlsx で「塗りなし」を表すのは patternType="none"（＝fgColor が無い）ほう。
    const h = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
    if (/^[0-9a-fA-F]{6}$/.test(h)) hex = h.toUpperCase();
  } else if (typeof c.theme === "number") {
    hex = theme[c.theme] || null;
  } else if (typeof c.indexed === "number") {
    hex = INDEXED[c.indexed] ?? null; // 64(前景)/65(背景)はシステム色なので解決しない
  }
  if (!hex) return null;

  return "#" + (c.tint ? applyTint(hex, c.tint) : hex);
}

/**
 * exceljs の cell.fill を CSS 色へ。塗りが無ければ null。
 * patternType="none"（塗りなし）と、色指定のないパターン塗りを弾く。
 */
export function resolveFill(fill: unknown, theme: ThemePalette): string | null {
  const f = fill as { type?: string; pattern?: string; fgColor?: ExcelColor } | null | undefined;
  if (!f || f.type !== "pattern" || f.pattern === "none") return null;
  return resolveCellColor(f.fgColor, theme);
}
