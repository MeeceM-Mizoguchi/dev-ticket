// BRU13-029 Excel の結合セル（mergeCells）の共通ロジック
//
// ExcelViewer（閲覧）と ExcelEditor（編集）で結合セルの見え方を揃えるため、
// 「A1:C3」形式の解析と、行/列の増減にともなう追従をここへ集約する。
//
// 座標は Handsontable の mergeCells 設定と同じ 0 始まり（row/col と rowspan/colspan）。

export interface MergeCell {
  row: number;      // 左上の行（0始まり）
  col: number;      // 左上の列（0始まり）
  rowspan: number;  // 縦の結合数（1以上）
  colspan: number;  // 横の結合数（1以上）
}

const REF_RANGE = /^\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/;
const toColNum = (s: string) => s.split("").reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
const toColLetter = (n: number) => {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

/** "A1:C3" の並び（exceljs の ws.model.merges 等）を MergeCell へ。1セルぶんのものは捨てる */
export function parseMergeRefs(refs: unknown): MergeCell[] {
  const out: MergeCell[] = [];
  for (const raw of Object.values((refs ?? {}) as Record<string, unknown>)) {
    // シート名つき（'Sheet 1'!A1:C3）で来ることがあるので落とす
    const ref = String(raw).toUpperCase().split("!").pop() ?? "";
    const m = REF_RANGE.exec(ref);
    if (!m) continue;
    const c1 = toColNum(m[1]), r1 = Number(m[2]), c2 = toColNum(m[3]), r2 = Number(m[4]);
    const row = Math.min(r1, r2) - 1, col = Math.min(c1, c2) - 1;
    const rowspan = Math.abs(r2 - r1) + 1, colspan = Math.abs(c2 - c1) + 1;
    if (row < 0 || col < 0 || (rowspan <= 1 && colspan <= 1)) continue;
    out.push({ row, col, rowspan, colspan });
  }
  return out;
}

/** MergeCell → "A1:C3"（1始まりの範囲文字列） */
export function mergeRef(mg: MergeCell): string {
  return `${toColLetter(mg.col + 1)}${mg.row + 1}:${toColLetter(mg.col + mg.colspan)}${mg.row + mg.rowspan}`;
}

/** 結合に含まれる全セル("r:c") → その結合。左上セルも含む */
export function buildMergeIndex(merges: MergeCell[]): Map<string, MergeCell> {
  const idx = new Map<string, MergeCell>();
  for (const mg of merges) {
    for (let r = mg.row; r < mg.row + mg.rowspan; r++) {
      for (let c = mg.col; c < mg.col + mg.colspan; c++) idx.set(`${r}:${c}`, mg);
    }
  }
  return idx;
}

/** そのセルが結合の左上（＝実際に描かれるセル）か */
export const isMergeMaster = (mg: MergeCell | undefined, r: number, c: number) =>
  !!mg && mg.row === r && mg.col === c;
/** そのセルが結合に飲み込まれて表示されないセルか */
export const isMergeHidden = (mg: MergeCell | undefined, r: number, c: number) =>
  !!mg && !(mg.row === r && mg.col === c);

/** 範囲(0始まり・両端含む)に掛かる結合を返す */
export function mergesInRange(merges: MergeCell[], r0: number, c0: number, r1: number, c1: number): MergeCell[] {
  return merges.filter(mg =>
    mg.row <= r1 && mg.row + mg.rowspan - 1 >= r0 && mg.col <= c1 && mg.col + mg.colspan - 1 >= c0);
}

// ── 行/列の増減への追従（best-effort）──────────────────────────
// Excel と同じ考え方にそろえる。
//  ・挿入   … 境界より後ろの結合はずれる。結合の途中に挿すと結合が広がる。
//  ・削除   … 交差した分だけ縮む。全部消えた（＝1セルになった）結合は解除。
//  ・複製   … 複製元にすっぽり収まる結合だけ、複製先にも同じ形で作る。
//  ・入れ替え… 帯ごと動いた結合だけ追従。飛び飛びになるものは解除する。

type Axis = "row" | "col";
const startOf = (mg: MergeCell, ax: Axis) => (ax === "row" ? mg.row : mg.col);
const spanOf = (mg: MergeCell, ax: Axis) => (ax === "row" ? mg.rowspan : mg.colspan);
const withLine = (mg: MergeCell, ax: Axis, start: number, span: number): MergeCell =>
  ax === "row" ? { ...mg, row: start, rowspan: span } : { ...mg, col: start, colspan: span };
const alive = (mg: MergeCell) => mg.rowspan > 1 || mg.colspan > 1;

/** at（0始まり）の位置に count 本挿入したときの結合 */
export function insertLines(merges: MergeCell[], axis: Axis, at: number, count: number): MergeCell[] {
  if (count <= 0) return merges;
  return merges.map(mg => {
    const s = startOf(mg, axis), n = spanOf(mg, axis), e = s + n - 1;
    if (s >= at) return withLine(mg, axis, s + count, n);
    if (e >= at) return withLine(mg, axis, s, n + count);   // 途中に挿すと結合が広がる
    return mg;
  });
}

/** at（0始まり）から count 本削除したときの結合 */
export function removeLines(merges: MergeCell[], axis: Axis, at: number, count: number): MergeCell[] {
  if (count <= 0) return merges;
  const last = at + count - 1;
  const out: MergeCell[] = [];
  for (const mg of merges) {
    const s = startOf(mg, axis), e = s + spanOf(mg, axis) - 1;
    const ns = s > last ? s - count : s >= at ? at : s;
    const ne = e > last ? e - count : e >= at ? at - 1 : e;
    if (ne < ns) continue;
    const next = withLine(mg, axis, ns, ne - ns + 1);
    if (alive(next)) out.push(next);
  }
  return out;
}

/** src0 から count 本を複製して at0 へ差し込んだときの結合 */
export function copyLines(merges: MergeCell[], axis: Axis, src0: number, count: number, at0: number): MergeCell[] {
  if (count <= 0) return merges;
  // 複製ぶんは「ずらす前の座標」から拾い、差し込み後の位置へ置く
  const dup = merges
    .filter(mg => startOf(mg, axis) >= src0 && startOf(mg, axis) + spanOf(mg, axis) <= src0 + count)
    .map(mg => withLine(mg, axis, at0 + (startOf(mg, axis) - src0), spanOf(mg, axis)));
  return [...insertLines(merges, axis, at0, count), ...dup];
}

/** 1本ずつの写像で結合を追従させる。飛び飛びになった結合は解除する（入れ替え用） */
export function remapLines(merges: MergeCell[], axis: Axis, map: (i: number) => number | null): MergeCell[] {
  const out: MergeCell[] = [];
  for (const mg of merges) {
    const s = startOf(mg, axis), n = spanOf(mg, axis);
    const ids: number[] = [];
    for (let i = s; i < s + n; i++) { const v = map(i); if (v !== null) ids.push(v); }
    if (ids.length === 0) continue;
    const lo = Math.min(...ids), hi = Math.max(...ids);
    if (hi - lo + 1 !== ids.length) continue;   // 連続していない＝結合として保てない
    const next = withLine(mg, axis, lo, ids.length);
    if (alive(next)) out.push(next);
  }
  return out;
}
