import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { parseXlsxDrawings, calloutTailPoints } from "@/app/lib/xlsxDrawing";
import type { DrawingObject, Paragraph } from "@/app/lib/xlsxDrawing";
import { parseThemePalette, resolveCellColor, resolveFill } from "@/app/lib/xlsxCellColor";
import { textWidth, wrapHeight, spillExtents, shouldWrap, fitColumnWidth } from "@/app/lib/xlsxTextLayout";
import { fetchFileWithRetry } from "@/app/lib/projectFiles";
import { parseMergeRefs, buildMergeIndex, isMergeMaster, isMergeHidden } from "@/app/lib/xlsxMerge";

// ENHA2-035 Excel(.xlsx/.xlsm) ビューア
//
// セルの値だけでなく、シート上に浮いている画像・図形・矢印(描画レイヤー)も描く。
// 位置合わせのため、グリッドは Excel の列幅・行高をピクセル換算して再現している。
// DrawingML の完全実装ではないため、凝った図形は近似表示になる。

const MAX_ROWS = 400;
const MAX_COLS = 80;

// Excel の列幅は「標準フォントの数字1文字ぶん」単位。Calibri 11 での慣用換算。
// ExcelEditor でも同じ換算を使うので export する（描画レイヤーの座標系を一致させるため）。
export const CHAR_PX = 7;
export const COL_PADDING_PX = 5;
export const DEFAULT_COL_WIDTH = 8.43;
export const DEFAULT_ROW_HEIGHT_PT = 15;
export const PT_TO_PX = 4 / 3;

const HEADER_W = 34;
const HEADER_H = 20;

// BRU10-055 セル内の文字レイアウト。計測（canvas）と CSS で同じ値を使う。
export const CELL_FONT_FAMILY = `-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic UI", "Segoe UI", Meiryo, system-ui, sans-serif`;
const CELL_PAD_X = 3;
const CELL_PAD_Y = 1;
// 行送りは Excel と同じくフォントサイズの約1.2倍。既定(11pt=約15px)なら18pxで、
// 既定の行高20pxに収まる＝1行のセルでは行が膨らまない。
const lineHeightPx = (sizePx: number) => Math.round(sizePx * 1.2);
// td の枠(左右1px)とパディングを除いた、文字を置ける幅
const contentWidth = (cellW: number) => cellW - CELL_PAD_X * 2 - 2;

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

interface CellData {
  text: string;
  bold: boolean; italic: boolean;
  sizePx: number; color: string; bg: string | null;
  align: "left" | "center" | "right";
  vAlign: "top" | "middle" | "bottom";
  wrap: boolean;     // 折り返し表示（Excel の wrapText）
  spillL: number;    // はみ出し表示で左へ伸ばせる量(px)
  spillR: number;    // 同じく右へ伸ばせる量(px)
  colSpan: number; rowSpan: number;
  hidden: boolean;   // 結合セルに飲み込まれたセル
}

const emptyCell = (): CellData => ({
  text: "", bold: false, italic: false, sizePx: 11 * PT_TO_PX, color: "#1A1714", bg: null,
  align: "left", vAlign: "middle", wrap: false, spillL: 0, spillR: 0,
  colSpan: 1, rowSpan: 1, hidden: false,
});

const EMPTY_CELL = emptyCell();
const fontOf = (c: CellData) => ({ size: c.sizePx, bold: c.bold, italic: c.italic, family: CELL_FONT_FAMILY });

// exceljs の cell.text は文字列とは限らない。
// 例えばハイパーリンクのセルは HyperlinkValue.toString() が model.text をそのまま返すため、
// リンクの表示テキストが数値やリッチテキストのままここへ来る。後段の split/replace で落ちるので必ず文字列にする。
function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toLocaleDateString("ja-JP");
  if (typeof v === "object") {
    const o = v as any;
    if (Array.isArray(o)) return o.map(cellText).join("");
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => cellText(t?.text)).join("");
    if (o.text !== undefined) return cellText(o.text);
    if (o.result !== undefined) return cellText(o.result);
    if (o.error !== undefined) return cellText(o.error);
  }
  return String(v);
}
const sumPx = (arr: number[], from: number, to: number) => arr.slice(from, to).reduce((a, b) => a + b, 0);
// 折り返しなしのセルは CSS 上、改行が空白として1行に並ぶ
const flatText = (s: string) => s.replace(/\n/g, " ");

interface SheetData {
  name: string;
  rows: CellData[][];
  colWidths: number[];
  rowHeights: number[];
  drawings: DrawingObject[];
  truncated: boolean;
}

function ParagraphsView({ paragraphs }: { paragraphs: Paragraph[] }) {
  return (
    <>
      {paragraphs.map((p, i) => (
        <div key={i} style={{ textAlign: p.align, width: "100%" }}>
          {p.runs.map((r, j) => (
            <span key={j} style={{
              fontWeight: r.bold ? 700 : 400, fontStyle: r.italic ? "italic" : "normal",
              fontSize: r.sizePx, color: r.color, lineHeight: 1.25,
            }}>{r.text}</span>
          ))}
        </div>
      ))}
    </>
  );
}

// prstGeom → CSS の角丸。
// 注意: "wedgeRoundRectCallout" のように大文字始まりで含まれる形もあるため大小無視で判定する。
function borderRadiusFor(geom: string | undefined, w: number, h: number): string {
  if (!geom) return "0";
  const g = geom.toLowerCase();
  if (g === "ellipse" || g.startsWith("flowchartconnector")) return "50%";
  if (g.includes("roundrect")) return `${Math.min(w, h) * 0.16}px`;
  return "0";
}

// 矢印系の図形は矩形では別物になってしまうので多角形で描く。
// Office 既定の調整値（軸=0.5 / 矢じり=0.5）に合わせた近似。
function arrowPolygon(geom: string | undefined, w: number, h: number): string | null {
  const p = (pts: [number, number][]) => pts.map(([x, y]) => `${x},${y}`).join(" ");
  switch (geom) {
    case "downArrow":
      return p([[w * .25, 0], [w * .75, 0], [w * .75, h * .5], [w, h * .5], [w * .5, h], [0, h * .5], [w * .25, h * .5]]);
    case "upArrow":
      return p([[w * .5, 0], [w, h * .5], [w * .75, h * .5], [w * .75, h], [w * .25, h], [w * .25, h * .5], [0, h * .5]]);
    case "rightArrow":
      return p([[0, h * .25], [w * .5, h * .25], [w * .5, 0], [w, h * .5], [w * .5, h], [w * .5, h * .75], [0, h * .75]]);
    case "leftArrow":
      return p([[w * .5, 0], [w * .5, h * .25], [w, h * .25], [w, h * .75], [w * .5, h * .75], [w * .5, h], [0, h * .5]]);
    default:
      return null;
  }
}

export function DrawingLayer({ objects, width, height, offsetLeft = HEADER_W, offsetTop = HEADER_H }: { objects: DrawingObject[]; width: number; height: number; offsetLeft?: number; offsetTop?: number }) {
  return (
    // width/height を明示する。幅0のままだと Tailwind リセットの img{max-width:100%} が
    // max-width:0 と解決され、画像だけが潰れて見えなくなる。
    <div style={{ position: "absolute", left: offsetLeft, top: offsetTop, width, height, pointerEvents: "none" }}>
      {objects.map(o => {
        // コネクタは線の始終点座標で反転を表現するので transform では反転させない
        const transform = [
          o.rot ? `rotate(${o.rot}deg)` : "",
          o.kind !== "connector" && o.flipH ? "scaleX(-1)" : "",
          o.kind !== "connector" && o.flipV ? "scaleY(-1)" : "",
        ].filter(Boolean).join(" ");
        const base: CSSProperties = {
          position: "absolute", left: o.x, top: o.y, width: o.w, height: o.h,
          transform: transform || undefined, transformOrigin: "center center",
        };

        if (o.kind === "image") {
          // maxWidth/maxHeight は CSS リセット(img{max-width:100%;height:auto})の打ち消し
          return <img key={o.id} src={o.src} alt="" draggable={false}
            style={{ ...base, objectFit: "fill", maxWidth: "none", maxHeight: "none" }} />;
        }

        if (o.kind === "connector") {
          // 矢印はアンカー矩形の対角線として引く。flip で向きを反転。
          const c = o.line?.color ?? "#000";
          const wdt = o.line?.width ?? 1;
          const x1 = o.flipH ? o.w : 0, x2 = o.flipH ? 0 : o.w;
          const y1 = o.flipV ? o.h : 0, y2 = o.flipV ? 0 : o.h;
          const mid = `m${o.id}`;
          // 幅/高さ0の直線でもSVGが潰れないよう最低1pxを確保する
          const sw = Math.max(o.w, 1), sh = Math.max(o.h, 1);
          return (
            <svg key={o.id} style={{ ...base, width: sw, height: sh }} viewBox={`0 0 ${sw} ${sh}`} width={sw} height={sh} overflow="visible">
              <defs>
                <marker id={mid} markerWidth="10" markerHeight="10" refX="8" refY="3"
                  orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L9,3 z" fill={c} />
                </marker>
              </defs>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={c} strokeWidth={wdt}
                markerEnd={o.arrowTail ? `url(#${mid})` : undefined}
                markerStart={o.arrowHead ? `url(#${mid})` : undefined} />
            </svg>
          );
        }

        const poly = arrowPolygon(o.geom, o.w, o.h);
        const label = o.paragraphs && o.paragraphs.length > 0
          ? <div style={{ width: "100%", position: "relative", padding: 3, boxSizing: "border-box" }}>
              <ParagraphsView paragraphs={o.paragraphs} />
            </div>
          : null;

        if (poly) {
          return (
            <div key={o.id} style={{ ...base, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={o.w} height={o.h} viewBox={`0 0 ${o.w} ${o.h}`} style={{ position: "absolute", inset: 0 }}>
                <polygon points={poly} fill={o.fill ?? "transparent"}
                  stroke={o.line?.color ?? "none"} strokeWidth={o.line?.width ?? 0} />
              </svg>
              {label}
            </div>
          );
        }

        // 吹き出し：本体（角丸）＋尾（三角）。編集モードと同じ形で描く。
        // 尾は本体の外へ出るので、下の汎用分岐(overflow:hidden)には落とせない。
        if (o.geom && /callout/i.test(o.geom) && o.adj) {
          const tail = calloutTailPoints(o.w, o.h, o.adj);
          return (
            <div key={o.id} style={{ ...base, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {tail && (
                <svg style={{ position: "absolute", inset: 0, overflow: "visible" }} width={o.w} height={o.h}>
                  <polygon points={tail} fill={o.fill ?? "#fff"}
                    stroke={o.line?.color ?? "none"} strokeWidth={o.line?.width ?? 0} />
                </svg>
              )}
              <div style={{
                position: "absolute", inset: 0, background: o.fill ?? "transparent",
                border: o.line ? `${o.line.width}px solid ${o.line.color}` : "none",
                borderRadius: `${Math.min(o.w, o.h) * 0.14}px`, boxSizing: "border-box",
              }} />
              <div style={{ position: "relative", zIndex: 1, width: "100%" }}>{label}</div>
            </div>
          );
        }

        return (
          <div key={o.id} style={{
            ...base,
            background: o.fill ?? "transparent",
            border: o.line ? `${o.line.width}px solid ${o.line.color}` : "none",
            borderRadius: borderRadiusFor(o.geom, o.w, o.h),
            display: "flex", alignItems: "center", justifyContent: "center",
            boxSizing: "border-box", overflow: "hidden",
          }}>
            {label}
          </div>
        );
      })}
    </div>
  );
}

// 1セルの描画。Excel と同じく3通りの見せ方をする。
//  ・折り返し   … セル内で改行し、行はその高さまで伸びている
//  ・はみ出し   … 隣の空セルの上に文字を重ねて表示（絶対配置の箱で必要な幅だけ許す）
//  ・通常       … セル幅で切る
function CellView({ cell, width }: { cell: CellData; width: number }) {
  const base: CSSProperties = {
    border: "1px solid #E5E7EA", boxSizing: "border-box",
    background: cell.bg ?? undefined, textAlign: cell.align,
    verticalAlign: cell.vAlign === "middle" ? "middle" : cell.vAlign,
    fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? "italic" : "normal",
    fontSize: cell.sizePx, color: cell.color, lineHeight: `${lineHeightPx(cell.sizePx)}px`,
  };

  if (cell.wrap) {
    return (
      <td colSpan={cell.colSpan} rowSpan={cell.rowSpan}
        style={{ ...base, padding: `${CELL_PAD_Y}px ${CELL_PAD_X}px`, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {cell.text}
      </td>
    );
  }

  if (cell.spillL > 0 || cell.spillR > 0) {
    const flex = cell.align === "center" ? "center" : cell.align === "right" ? "flex-end" : "flex-start";
    const vFlex = cell.vAlign === "top" ? "flex-start" : cell.vAlign === "bottom" ? "flex-end" : "center";
    return (
      // overflow:visible + 絶対配置の内箱。内箱の幅がはみ出せる範囲そのものなので、
      // 隣に文字があるセルの手前でぴたりと切れる。
      <td colSpan={cell.colSpan} rowSpan={cell.rowSpan}
        style={{ ...base, padding: 0, position: "relative", overflow: "visible" }}>
        <div style={{
          position: "absolute", top: 0, bottom: 0,
          left: -cell.spillL, width: width + cell.spillL + cell.spillR,
          display: "flex", alignItems: vFlex, justifyContent: flex,
          padding: `0 ${CELL_PAD_X}px`, boxSizing: "border-box",
          whiteSpace: "nowrap", overflow: "hidden", pointerEvents: "none",
          // 隣のセルが背景色を持つと はみ出した文字が隠れるので、手前に描く
          zIndex: 1,
        }}>
          {flatText(cell.text)}
        </div>
      </td>
    );
  }

  return (
    <td colSpan={cell.colSpan} rowSpan={cell.rowSpan}
      style={{ ...base, padding: `0 ${CELL_PAD_X}px`, overflow: "hidden", whiteSpace: "nowrap" }}>
      {flatText(cell.text)}
    </td>
  );
}

export function ExcelViewer({ url }: { url: string }) {
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const disposeRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    disposeRef.current = () => {};
    (async () => {
      try {
        const buf = await (await fetchFileWithRetry(url)).arrayBuffer();
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        // Excel の色指定はテーマ色（theme + tint）が大半なので、theme1.xml から色表を作る
        const themePalette = parseThemePalette(buf);

        const out: SheetData[] = wb.worksheets.map((ws, sheetIdx) => {
          const defColW = ws.properties?.defaultColWidth ?? DEFAULT_COL_WIDTH;
          const defRowH = ws.properties?.defaultRowHeight ?? DEFAULT_ROW_HEIGHT_PT;
          const colPx = (i: number) => {
            const w = ws.getColumn(i + 1)?.width ?? defColW;
            return Math.round(w * CHAR_PX + COL_PADDING_PX);
          };
          const baseRowPx = (i: number) => Math.round((ws.getRow(i + 1)?.height ?? defRowH) * PT_TO_PX);

          // 結合セル（編集画面と共通の解析）。左上に span を持たせ、それ以外は hidden にする
          const mergeIndex = buildMergeIndex(parseMergeRefs((ws.model as any)?.merges));

          // まず実データのある範囲だけ組み立てる（図形ぶんの余白は後から足す）。
          // 折り返しの行高計算に中身が要るので、描画レイヤーの解析より先に行う。
          const baseRows = Math.min(Math.max(ws.rowCount, 1), MAX_ROWS);
          const baseCols = Math.min(Math.max(ws.columnCount, 1), MAX_COLS);
          const rows: CellData[][] = [];
          for (let r = 1; r <= baseRows; r++) {
            const row = ws.getRow(r);
            const cells: CellData[] = [];
            for (let c = 1; c <= baseCols; c++) {
              const cell = row.getCell(c);
              const font = cell.font ?? {};
              // 塗りは argb 直指定とは限らない（テーマ色＋tint / インデックス色）ので解決する
              const fillFg = resolveFill(cell.fill, themePalette);
              const al = cell.alignment?.horizontal;
              const va = cell.alignment?.vertical;
              const mg = mergeIndex.get(`${r - 1}:${c - 1}`);
              const master = isMergeMaster(mg, r - 1, c - 1);
              cells.push({
                ...emptyCell(),
                text: cellText(cell.text),
                bold: !!font.bold, italic: !!font.italic,
                sizePx: (font.size ?? 11) * PT_TO_PX,
                color: resolveCellColor(font.color as any, themePalette) ?? "#1A1714",
                bg: fillFg,
                align: al === "center" ? "center" : al === "right" ? "right" : "left",
                vAlign: va === "top" ? "top" : va === "bottom" ? "bottom" : "middle",
                wrap: !!cell.alignment?.wrapText,
                colSpan: master ? mg!.colspan : 1, rowSpan: master ? mg!.rowspan : 1,
                hidden: isMergeHidden(mg, r - 1, c - 1),
              });
            }
            rows.push(cells);
          }

          // セル内改行があるセルは、ファイルに折り返し指定が無くても改行して見せる（編集画面と共通の規則）
          for (const line of rows) for (const cd of line) cd.wrap = shouldWrap(cd.text, cd.wrap);

          const colWidths = Array.from({ length: baseCols }, (_, i) => colPx(i));

          // 開いた時点で文字が見えない列を広げる（編集画面と共通の規則）。広げるだけで狭めない。
          for (let c = 0; c < baseCols; c++) {
            const w = fitColumnWidth(
              Array.from({ length: baseRows }, (_, r) => {
                const cd = rows[r][c];
                const next = rows[r][c + 1];
                // 結合セルは1列だけ広げても意味が無いので対象外
                const skip = !cd || cd.hidden || cd.colSpan > 1;
                return {
                  text: skip ? "" : cd.text,
                  wrap: !skip && cd.wrap,
                  font: fontOf(cd ?? EMPTY_CELL),
                  spillable: !!next && !next.hidden && next.text === "",
                };
              }), CELL_PAD_X);
            if (w > colWidths[c]) colWidths[c] = w;
          }

          // 折り返しセルのぶん行高を広げる。
          // Excel はファイルに計算済みの行高(ht)を持っているが、こちらは列幅もフォントも
          // 完全一致ではないので、必要ならファイルの高さより広げる（＝絶対に見切れない）。
          // 縦結合セルは Excel でも自動調整の対象外なので触らない。
          const rowHeights: number[] = [];
          for (let r = 0; r < baseRows; r++) {
            let h = baseRowPx(r);
            for (let c = 0; c < baseCols; c++) {
              const cd = rows[r][c];
              if (!cd || cd.hidden || !cd.text || cd.rowSpan > 1) continue;
              // 折り返しは行数ぶん、そうでなくても大きい文字は1行ぶんの高さを確保する
              h = Math.max(h, cd.wrap
                ? wrapHeight(cd.text, contentWidth(sumPx(colWidths, c, c + cd.colSpan)), fontOf(cd), lineHeightPx(cd.sizePx), CELL_PAD_Y * 2 + 2)
                : lineHeightPx(cd.sizePx) + CELL_PAD_Y * 2 + 2);
            }
            rowHeights.push(h);
          }
          const rowPx = (i: number) => rowHeights[i] ?? baseRowPx(i);

          // 描画レイヤー（画像・図形・矢印）
          let drawings: DrawingObject[] = [];
          let dMaxCol = 0, dMaxRow = 0;
          try {
            const parsed = parseXlsxDrawings(buf, sheetIdx, { colPx, rowPx });
            drawings = parsed.objects;
            dMaxCol = parsed.maxCol; dMaxRow = parsed.maxRow;
            const prev = disposeRef.current;
            disposeRef.current = () => { prev(); parsed.dispose(); };
          } catch (e) {
            console.error("[ExcelViewer] drawing parse error:", e);
          }

          // 図形がセル範囲より外に広がるので、グリッドはその分まで伸ばす
          const rowCount = Math.min(Math.max(baseRows, dMaxRow + 2), MAX_ROWS);
          const colCount = Math.min(Math.max(baseCols, dMaxCol + 2), MAX_COLS);
          for (let i = baseCols; i < colCount; i++) colWidths.push(colPx(i));
          for (let i = baseRows; i < rowCount; i++) rowHeights.push(baseRowPx(i));
          for (const row of rows) while (row.length < colCount) row.push(emptyCell());
          while (rows.length < rowCount) rows.push(Array.from({ length: colCount }, emptyCell));

          // はみ出し表示：隣が空セルなら、そこまで文字を伸ばせる量を求めておく
          for (const line of rows) {
            const isEmpty = (c: number) => !!line[c] && !line[c].hidden && line[c].text === "";
            for (let c = 0; c < line.length; c++) {
              const cd = line[c];
              if (cd.hidden || cd.wrap || !cd.text) continue;
              const contentW = contentWidth(sumPx(colWidths, c, c + cd.colSpan));
              const tw = textWidth(flatText(cd.text), fontOf(cd));
              if (tw <= contentW) continue;
              const { left, right } = spillExtents({
                col: c, span: cd.colSpan, widths: colWidths, isEmpty,
                align: cd.align, textW: tw, contentW,
              });
              cd.spillL = left; cd.spillR = right;
            }
          }

          return {
            name: ws.name, rows, drawings, colWidths, rowHeights,
            truncated: ws.rowCount > MAX_ROWS || ws.columnCount > MAX_COLS,
          };
        });

        if (!cancelled) setSheets(out);
      } catch (e) {
        console.error("[ExcelViewer] xlsx parse error:", e);
        if (!cancelled) setError("Excelファイルの読み込みに失敗しました");
      }
    })();
    return () => { cancelled = true; disposeRef.current(); };
  }, [url]);

  if (error) return <Centered>{error}</Centered>;
  if (!sheets) return <Centered>読み込み中...</Centered>;
  if (sheets.length === 0) return <Centered>表示できるシートがありません</Centered>;

  const sheet = sheets[Math.min(active, sheets.length - 1)];
  const totalW = sheet.colWidths.reduce((a, b) => a + b, 0);
  const totalH = sheet.rowHeights.reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {sheets.length > 1 && (
        <div style={{ display: "flex", gap: 4, padding: "8px 12px 0", flexWrap: "wrap", flexShrink: 0 }}>
          {sheets.map((s, i) => (
            <button key={s.name + i} onClick={() => setActive(i)}
              style={{ padding: "5px 12px", fontSize: 11, fontWeight: 600, border: "none", borderRadius: "6px 6px 0 0", cursor: "pointer", background: i === active ? "#059669" : "#F4F5F6", color: i === active ? "#fff" : "#6B6458" }}>
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.truncated && (
        <p style={{ margin: "8px 12px 0", fontSize: 11, color: "#92400E", background: "#FEF3C7", border: "1px solid rgba(217,119,6,0.25)", borderRadius: 6, padding: "5px 9px" }}>
          データが大きいため先頭 {MAX_ROWS} 行 × {MAX_COLS} 列のみ表示しています。
        </p>
      )}
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, background: "#fff" }}>
        {/* 余白は内側に持たせる。スクロール枠に padding があると、固定したヘッダの上に
            余白ぶんの隙間ができて、そこをセルが通り抜けて見えてしまう。 */}
        <div style={{ padding: 12, width: "fit-content" }}>
          <div style={{ position: "relative", width: HEADER_W + totalW }}>
            {/* フォントは固定する。文字幅の計測(canvas)と実際の描画を一致させるため。 */}
            <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: HEADER_W + totalW, fontFamily: CELL_FONT_FAMILY }}>
              <colgroup>
                <col style={{ width: HEADER_W }} />
                {sheet.colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr style={{ height: HEADER_H }}>
                  <th style={{ ...stickyHead, left: 0, zIndex: 3 }} />
                  {sheet.colWidths.map((_, c) => (
                    <th key={c} style={{ ...stickyHead, fontSize: 10, fontWeight: 600, color: "#6B6458" }}>
                      {colLetter(c + 1)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.map((row, r) => (
                  <tr key={r} style={{ height: sheet.rowHeights[r] }}>
                    <td style={{ ...stickyRowHead, fontSize: 10, color: "#6B6458", textAlign: "center" }}>{r + 1}</td>
                    {row.map((cell, c) => cell.hidden ? null : (
                      <CellView key={c} cell={cell} width={sumPx(sheet.colWidths, c, c + cell.colSpan)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <DrawingLayer objects={sheet.drawings} width={totalW} height={totalH} />
          </div>
        </div>
      </div>
    </div>
  );
}

// BRU13-023 スクロールしても列名（A,B,C…）・行番号（1,2,3…）が消えないよう貼り付ける。
// borderCollapse: collapse の表では、貼り付いたセルの枠線は表側に描かれて消えてしまうので、
// 枠線は box-shadow（セルの内側）で描く。
const stickyHead: CSSProperties = {
  position: "sticky", top: 0, zIndex: 2,
  background: "#EEF0F2", border: "1px solid #D9DCE0", boxShadow: "inset 0 0 0 1px #D9DCE0",
};
const stickyRowHead: CSSProperties = {
  position: "sticky", left: 0, zIndex: 1,
  background: "#EEF0F2", border: "1px solid #D9DCE0", boxShadow: "inset 0 0 0 1px #D9DCE0",
};

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#B0A9A4", fontSize: 12 }}>{children}</div>;
}
