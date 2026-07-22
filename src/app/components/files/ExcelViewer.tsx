import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { parseXlsxDrawings } from "@/app/lib/xlsxDrawing";
import type { DrawingObject, Paragraph } from "@/app/lib/xlsxDrawing";

// ENHA2-035 Excel(.xlsx/.xlsm) ビューア
//
// セルの値だけでなく、シート上に浮いている画像・図形・矢印(描画レイヤー)も描く。
// 位置合わせのため、グリッドは Excel の列幅・行高をピクセル換算して再現している。
// DrawingML の完全実装ではないため、凝った図形は近似表示になる。

const MAX_ROWS = 400;
const MAX_COLS = 80;

// Excel の列幅は「標準フォントの数字1文字ぶん」単位。Calibri 11 での慣用換算。
const CHAR_PX = 7;
const COL_PADDING_PX = 5;
const DEFAULT_COL_WIDTH = 8.43;
const DEFAULT_ROW_HEIGHT_PT = 15;
const PT_TO_PX = 4 / 3;

const HEADER_W = 34;
const HEADER_H = 20;

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
  colSpan: number; rowSpan: number;
  hidden: boolean;   // 結合セルに飲み込まれたセル
}

interface SheetData {
  name: string;
  rows: CellData[][];
  colWidths: number[];
  rowHeights: number[];
  drawings: DrawingObject[];
  truncated: boolean;
}

// ARGB(exceljs) → CSS
function argb(v: string | undefined | null): string | null {
  if (!v) return null;
  const h = v.length === 8 ? v.slice(2) : v;
  return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h}` : null;
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

function DrawingLayer({ objects, width, height }: { objects: DrawingObject[]; width: number; height: number }) {
  return (
    // width/height を明示する。幅0のままだと Tailwind リセットの img{max-width:100%} が
    // max-width:0 と解決され、画像だけが潰れて見えなくなる。
    <div style={{ position: "absolute", left: HEADER_W, top: HEADER_H, width, height, pointerEvents: "none" }}>
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
        const buf = await (await fetch(url)).arrayBuffer();
        const ExcelJS = (await import("exceljs")).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);

        const out: SheetData[] = wb.worksheets.map((ws, sheetIdx) => {
          const defColW = ws.properties?.defaultColWidth ?? DEFAULT_COL_WIDTH;
          const defRowH = ws.properties?.defaultRowHeight ?? DEFAULT_ROW_HEIGHT_PT;
          const colPx = (i: number) => {
            const w = ws.getColumn(i + 1)?.width ?? defColW;
            return Math.round(w * CHAR_PX + COL_PADDING_PX);
          };
          const rowPx = (i: number) => Math.round((ws.getRow(i + 1)?.height ?? defRowH) * PT_TO_PX);

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
          const rowCount = Math.min(Math.max(ws.rowCount, dMaxRow + 2), MAX_ROWS);
          const colCount = Math.min(Math.max(ws.columnCount, dMaxCol + 2), MAX_COLS);

          // 結合セル: "A1:C3" → 左上に span を持たせ、それ以外は hidden
          const spans = new Map<string, { cs: number; rs: number }>();
          const covered = new Set<string>();
          for (const range of Object.values((ws.model as any)?.merges ?? {}) as string[]) {
            const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(range));
            if (!m) continue;
            const toNum = (s: string) => s.split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
            const c1 = toNum(m[1]), r1 = Number(m[2]), c2 = toNum(m[3]), r2 = Number(m[4]);
            spans.set(`${r1}:${c1}`, { cs: c2 - c1 + 1, rs: r2 - r1 + 1 });
            for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
              if (!(r === r1 && c === c1)) covered.add(`${r}:${c}`);
            }
          }

          const rows: CellData[][] = [];
          for (let r = 1; r <= rowCount; r++) {
            const row = ws.getRow(r);
            const cells: CellData[] = [];
            for (let c = 1; c <= colCount; c++) {
              const cell = row.getCell(c);
              const font = cell.font ?? {};
              const fillFg = (cell.fill as any)?.type === "pattern"
                ? argb((cell.fill as any)?.fgColor?.argb) : null;
              const al = cell.alignment?.horizontal;
              const span = spans.get(`${r}:${c}`);
              cells.push({
                text: cell.text ?? "",
                bold: !!font.bold, italic: !!font.italic,
                sizePx: (font.size ?? 11) * PT_TO_PX,
                color: argb((font.color as any)?.argb) ?? "#1A1714",
                bg: fillFg,
                align: al === "center" ? "center" : al === "right" ? "right" : "left",
                colSpan: span?.cs ?? 1, rowSpan: span?.rs ?? 1,
                hidden: covered.has(`${r}:${c}`),
              });
            }
            rows.push(cells);
          }

          return {
            name: ws.name, rows, drawings,
            colWidths: Array.from({ length: colCount }, (_, i) => colPx(i)),
            rowHeights: Array.from({ length: rowCount }, (_, i) => rowPx(i)),
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
      <div style={{ flex: 1, overflow: "auto", padding: 12, minHeight: 0, background: "#fff" }}>
        <div style={{ position: "relative", width: HEADER_W + totalW }}>
          <table style={{ borderCollapse: "collapse", tableLayout: "fixed", width: HEADER_W + totalW }}>
            <colgroup>
              <col style={{ width: HEADER_W }} />
              {sheet.colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}
            </colgroup>
            <thead>
              <tr style={{ height: HEADER_H }}>
                <th style={{ background: "#EEF0F2", border: "1px solid #D9DCE0" }} />
                {sheet.colWidths.map((_, c) => (
                  <th key={c} style={{ background: "#EEF0F2", border: "1px solid #D9DCE0", fontSize: 10, fontWeight: 600, color: "#6B6458" }}>
                    {colLetter(c + 1)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r} style={{ height: sheet.rowHeights[r] }}>
                  <td style={{ background: "#EEF0F2", border: "1px solid #D9DCE0", fontSize: 10, color: "#6B6458", textAlign: "center" }}>{r + 1}</td>
                  {row.map((cell, c) => cell.hidden ? null : (
                    <td key={c} colSpan={cell.colSpan} rowSpan={cell.rowSpan}
                      style={{
                        border: "1px solid #E5E7EA", padding: "0 3px", overflow: "hidden",
                        whiteSpace: "nowrap", verticalAlign: "middle",
                        background: cell.bg ?? undefined, textAlign: cell.align,
                        fontWeight: cell.bold ? 700 : 400, fontStyle: cell.italic ? "italic" : "normal",
                        fontSize: cell.sizePx, color: cell.color,
                      }}>
                      {cell.text}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <DrawingLayer objects={sheet.drawings} width={totalW} height={totalH} />
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#B0A9A4", fontSize: 12 }}>{children}</div>;
}
