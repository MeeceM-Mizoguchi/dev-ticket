// 表（BRU5-042）の再レイアウト・コントローラ。
// ホワイトボードの「表」は、セル1つ=標準の rectangle（バインドテキスト付き）を升目状に敷いた
// ものだが、Excalidraw には表の概念が無いため、1セルの高さが自動で伸びても同じ行の他セルや
// 下の行が連動せず、ズレ・空白・見切れが起きる。そこで onChange のたびに本関数で表全体を
// 再計測し、隙間なくタイル配置し直す（＝表としての可変レイアウトを自前で実現する）。
//
// レイアウト規則:
//   - 列幅  = セル内容の自然幅にフィット（手動上書き cw があればそれを優先。手動幅が内容より
//             狭ければテキストを折り返し、その行の高さが伸びる）。
//   - 行高  = その行の各セルの必要高さ（テキスト高＋余白）の最大。手動上書き rh があれば下限に。
//   - 原点  = 左上セル(0,0)の座標。セル群は groupId で束ねてあるため、表ごと移動しても (0,0) が
//             追従し、本関数がそこから全セルをタイルし直す。
//
// 文字の計測・折り返しは Excalidraw 内部関数に依存せず、オフスクリーン canvas で自前に行う
// （@excalidraw の getFontString/refreshTextDimensions は型宣言のみで実体が公開されていないため）。
// 生成した折り返し済みテキストと寸法をバインドテキスト要素へ直接反映するので、描画も一致する。
// 計測ヘルパーと編集中テキスト状態は素の図形フィット(whiteboardShapeFit)と共有する（whiteboardText）。
import { viewportCoordsToSceneCoords, convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";
import { fontString, indentSideOfAlign, lineW, wrapText, getEditingTextEl } from "./whiteboardText";

export { setEditingTextEl } from "./whiteboardText"; // 既存 import 経路の互換のため再エクスポート

const SOFT_BLACK = "#343a40";     // セル罫線色（TableToolButton の生成と揃える）
const rand = () => Math.floor(Math.random() * 0x7fffffff);

const MIN_COL_W = 40;   // 列の最小幅
const MIN_ROW_H = 32;   // 行の最小高
const HPAD = 5;         // セル左右の内側余白（Excalidraw の BOUND_TEXT_PADDING=5 に合わせ、折り返し幅
                        // と列幅の算出を Excalidraw の実描画と一致させる。手動で狭めた列でも高さがズレない）
const VPAD = 5;         // セル上下の内側余白（Excalidraw の BOUND_TEXT_PADDING=5 に合わせ、編集中セルの
                        // 実コンテナ高(=テキスト高+10)と自前算出の行高を一致させて隙間/はみ出しを防ぐ）
const EPS = 0.5;        // 変化とみなす閾値（再更新ループの収束用）

export interface WbTableMeta { tid: string; r: number; c: number; cw?: number; rh?: number }

const cellMeta = (e: any): WbTableMeta | null => {
  const t = e?.customData?.wbTable;
  return e?.type === "rectangle" && t && typeof t.tid === "string" && !e.isDeleted ? t : null;
};

export const isTableCell = (e: any) => cellMeta(e) != null;

// 選択中の要素が単一の表に属していれば、その tid を返す。
export function selectedTableId(api: any): string | null {
  const st = api.getAppState();
  const sel = st.selectedElementIds || {};
  const tids = new Set<string>();
  for (const e of api.getSceneElements()) {
    const m = cellMeta(e);
    if (m && sel[e.id]) tids.add(m.tid);
  }
  return tids.size === 1 ? [...tids][0] : null;
}

/**
 * 選択が「表のセルを含み、かつ表を丸ごと消す選択ではない」か（BRU10-054-1 追補）。
 *
 * セルは普通の rectangle なので、列を選んで Delete/Backspace を押すとその矩形だけが消え、
 * 表が歯抜けになる（行/列の削除と違って残りのセルは詰められないので、崩れたまま直せない）。
 * そこで**一部のセルだけを選んでいるときは削除キーを無効化**し、行・列の削除ボタンへ誘導する。
 * 表を丸ごと（その表の全セルを）選んでいる場合は「表を消したい」意図が明確なので従来どおり消せる。
 */
export function isPartialTableCellSelection(api: any): boolean {
  const sel = api.getAppState?.()?.selectedElementIds ?? {};
  const total = new Map<string, number>(); // tid -> セル総数
  const on = new Map<string, number>();    // tid -> 選択されているセル数
  for (const e of api.getSceneElements() as any[]) {
    const m = cellMeta(e);
    if (!m) continue;
    total.set(m.tid, (total.get(m.tid) ?? 0) + 1);
    if (sel[e.id]) on.set(m.tid, (on.get(m.tid) ?? 0) + 1);
  }
  if (!on.size) return false;                                        // 表のセルは選ばれていない
  for (const [tid, n] of on) if (n < (total.get(tid) ?? 0)) return true; // 一部だけ選択 → 阻止
  return false;                                                      // どの表も丸ごと選択 → 許可
}

// 指定 tid の格子（grid[r][c]=セル要素）と寸法を取り出す。整合が取れなければ null。
export function tableGrid(elements: readonly any[], tid: string) {
  const cells = elements.filter((e) => { const m = cellMeta(e); return m && m.tid === tid; });
  if (!cells.length) return null;
  let R = 0, C = 0;
  for (const e of cells) { const m = cellMeta(e)!; R = Math.max(R, m.r + 1); C = Math.max(C, m.c + 1); }
  const grid: any[][] = Array.from({ length: R }, () => Array(C).fill(null));
  for (const e of cells) { const m = cellMeta(e)!; if (m.r < R && m.c < C) grid[m.r][m.c] = e; }
  if (!grid[0]?.[0]) return null;
  return { grid, R, C };
}

// 表の現在レイアウト（原点・列幅・行高）。列幅/行高は「その列/行で最初に見つかったセル」の実寸から取る
// （reflowTables が同じ列/行のセルを同寸にタイルしているため、どれを見ても同じ）。
export function tableLayout(elements: readonly any[], tid: string) {
  const info = tableGrid(elements, tid);
  if (!info) return null;
  const { grid, R, C } = info;
  const anchor = grid[0][0];
  const colW = Array.from({ length: C }, (_, c) => {
    for (let r = 0; r < R; r++) if (grid[r][c]) return grid[r][c].width as number;
    return 0;
  });
  const rowH = Array.from({ length: R }, (_, r) => {
    for (let c = 0; c < C; c++) if (grid[r][c]) return grid[r][c].height as number;
    return 0;
  });
  return { grid, R, C, ox: anchor.x as number, oy: anchor.y as number, colW, rowH };
}

// 四角の角ハンドル（グループ全体のリサイズ）でサイズ変更した直後に呼ぶ。
// Excalidraw が拡大縮小した現在の各列幅/行高を、手動値 cw/rh として全セルへ焼き込む。
// これをしないと直後の reflowTables が内容フィット寸法へ戻してしまい「角で大きさを変えられない」。
// 対象は選択中の単一表。以後その表は手動サイズになる（列/行の境界つまみをダブルクリックで自動に戻せる）。
export function freezeSelectedTable(api: any): boolean {
  const tid = selectedTableId(api);
  if (!tid) return false;
  const els = api.getSceneElements() as any[];
  const lay = tableLayout(els, tid);
  if (!lay) return false;
  const { colW, rowH } = lay;
  let changed = false;
  const next = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid) return e;
    const cw = Math.round(colW[m.c]) || undefined;
    const rh = Math.round(rowH[m.r]) || undefined;
    if (cw === m.cw && rh === m.rh) return e;     // 変化なしはそのまま（余計な更新を出さない）
    changed = true;
    // 【BRU11-051】版を上げる。cw/rh は「ユーザー意図サイズの台帳」で、Yjsブリッジは version 比較で
    // しか伝播しないため、版を上げないと他メンバーへ届かない。届かないと相手側の再レイアウトは
    // 内容フィット幅で組み直し、さらに次のリモート反映で自分の cw/rh ごと巻き戻される
    // （＝角ハンドルで変えた表の大きさが、共同編集中に勝手に元へ戻る）。
    return {
      ...e,
      customData: { ...e.customData, wbTable: { ...m, cw, rh } },
      version: (e.version ?? 1) + 1, versionNonce: rand(),
    };
  });
  if (!changed) return false;
  api.updateScene({ elements: next });
  return true;
}

// ── 行・列の追加/削除（BRU5-042） ────────────────────────────────────────────
// 表は「セル=rectangle＋customData.wbTable{tid,r,c}」の格子。行/列の増減は (1) 既存セルの
// r/c を付け替え、(2) 新規セル(空)を差し込む/対象セルを isDeleted にする、だけで良い。位置・寸法は
// updateScene 後の onChange 駆動 reflowTables が隙間なくタイルし直すため、ここでは指定しない。
// 変更したセルは version/versionNonce を上げてリアルタイム同期（Yjsブリッジは version 比較で伝播）
// と undo（captureUpdate: IMMEDIATELY）に確実に乗せる。

// scene 座標 (x,y) を含む表セルを返す（pointerdown で「クリックしたセル」を特定するのに使う）。
export function tableCellAtPoint(els: readonly any[], x: number, y: number): { tid: string; r: number; c: number; id: string } | null {
  for (const e of els) {
    const m = cellMeta(e);
    if (!m) continue;
    if (x >= e.x && x <= e.x + e.width && y >= e.y && y <= e.y + e.height) return { tid: m.tid, r: m.r, c: m.c, id: e.id };
  }
  return null;
}

// ── 行/列の軸選択と一括サイズ調整（BRU9-039-2） ────────────────────────────────
// 「複数の列（行）を選んでまとめて幅（高さ）を変える」ための土台。
// セルはグループなので1クリックでは表全体が選ばれ、個別セルを行数ぶん Shift+クリックする以外に
// 「列を選ぶ」手段が無かった。そこで TableResizeOverlay のヘッダー帯から列/行を丸ごと選択できるように
// し、その明示的な選択をここでローカル UI 状態として保持する（他ユーザーへは同期しない）。
//
// 手でセルを複数選択した場合も、それが「完全な列/行」を2本以上覆っていれば一括の対象として扱う
// （bulkSizeTargets の補助ルール）。表全体選択（1クリックのグループ選択）は従来どおり1本だけ動く。

export type TableAxisSel = { tid: string; kind: "col" | "row"; indices: number[] } | null;

let _axisSel: TableAxisSel = null;

export function setTableAxisSel(sel: TableAxisSel): void {
  _axisSel = sel && sel.indices.length
    ? { tid: sel.tid, kind: sel.kind, indices: [...new Set(sel.indices)].sort((a, b) => a - b) }
    : null;
}

// 保持中の軸選択を妥当性検証つきで返す。次のいずれかなら破棄して null（古い選択が残らないようにする）:
//   ・表が消えた / index が行列数の外（行・列の増減で崩れた）
//   ・現在の選択セルが「その軸のセル集合」と一致しない（ユーザーが別の選択をした）
export function tableAxisSel(api: any, elements?: readonly any[]): TableAxisSel {
  const s = _axisSel;
  if (!s) return null;
  const els = elements ?? (api.getSceneElements() as any[]);
  const info = tableGrid(els, s.tid);
  if (!info) { _axisSel = null; return null; }
  const limit = s.kind === "col" ? info.C : info.R;
  if (s.indices.some((i) => i < 0 || i >= limit)) { _axisSel = null; return null; }
  const want = new Set(s.indices);
  const sel = api.getAppState().selectedElementIds || {};
  let on = 0;
  for (const e of els) {
    const m = cellMeta(e);
    if (!m || m.tid !== s.tid) continue;
    const isSel = !!sel[e.id];
    if (isSel !== want.has(s.kind === "col" ? m.c : m.r)) { _axisSel = null; return null; }
    if (isSel) on++;
  }
  if (!on) { _axisSel = null; return null; }
  return s;
}

// 指定の列（行）を丸ごと選択する。選択の変更だけなので履歴には残さない（NEVER）。
// selectedGroupIds も落とす: 表をクリックした直後はグループが選択済みで、残したままだと
// 個別セルの選択が表全体へ戻ってしまう。
export function selectTableAxis(api: any, tid: string, kind: "col" | "row", indices: number[]): boolean {
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const limit = kind === "col" ? info.C : info.R;
  const idx = [...new Set(indices)].filter((i) => i >= 0 && i < limit).sort((a, b) => a - b);
  if (!idx.length) return false;
  const want = new Set(idx);
  const ids: Record<string, true> = {};
  for (const e of els) {
    const m = cellMeta(e);
    if (m && m.tid === tid && want.has(kind === "col" ? m.c : m.r)) ids[e.id] = true;
  }
  setTableAxisSel({ tid, kind, indices: idx });
  api.updateScene({
    appState: { selectedElementIds: ids, selectedGroupIds: {}, editingGroupId: null },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return true;
}

// 一括サイズ変更の対象になり得る列/行。
//   ・明示の軸選択（ヘッダー帯）があればそれ
//   ・無ければ「全行そろって選択されている列」「全列そろって選択されている行」（手でセルを選んだ場合）
//   ・表全体選択は対象外＝従来どおり1本だけ動く
export function bulkSizeTargets(api: any, tid: string, elements?: readonly any[]): { cols: number[]; rows: number[] } {
  const els = elements ?? (api.getSceneElements() as any[]);
  const ax = tableAxisSel(api, els);
  if (ax && ax.tid === tid) {
    return ax.kind === "col" ? { cols: ax.indices, rows: [] } : { cols: [], rows: ax.indices };
  }
  const info = tableGrid(els, tid);
  if (!info) return { cols: [], rows: [] };
  const { grid, R, C } = info;
  const sel = api.getAppState().selectedElementIds || {};
  let total = 0, on = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const cell = grid[r][c];
    if (!cell) continue;
    total++;
    if (sel[cell.id]) on++;
  }
  if (!on || on >= total) return { cols: [], rows: [] };
  const cols: number[] = [], rows: number[] = [];
  for (let c = 0; c < C; c++) {
    let any = false, all = true;
    for (let r = 0; r < R; r++) { const cell = grid[r][c]; if (!cell) continue; any = true; if (!sel[cell.id]) { all = false; break; } }
    if (any && all) cols.push(c);
  }
  for (let r = 0; r < R; r++) {
    let any = false, all = true;
    for (let c = 0; c < C; c++) { const cell = grid[r][c]; if (!cell) continue; any = true; if (!sel[cell.id]) { all = false; break; } }
    if (any && all) rows.push(r);
  }
  return { cols, rows };
}

// 境界つまみを掴んだ / ダブルクリックしたときの実対象。2本以上まとまっている時だけ一括にする。
export function resolveSizeTargets(api: any, tid: string, kind: "col" | "row", index: number): number[] {
  const t = bulkSizeTargets(api, tid)[kind === "col" ? "cols" : "rows"];
  return t.length >= 2 && t.includes(index) ? t : [index];
}

// 複数の列/行へ手動サイズ（cw/rh）を一括適用。value<=0 でクリア（自動フィットへ復帰）。
// commit=true のときは undo の1ステップとして記録し、version も上げて他クライアントへ確実に伝播させる
// （Yjsブリッジは version 比較で伝播するため。ドラッグ中は commit=false で、離した時にまとめて記録する）。
export function applyTableSizes(
  api: any, tid: string, kind: "col" | "row", indices: number[], value: number, commit = false,
): boolean {
  const want = new Set(indices);
  const els = api.getSceneElements() as any[];
  let changed = false;
  const next = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid || !want.has(kind === "col" ? m.c : m.r)) return e;
    const wb: WbTableMeta = { ...m };
    if (kind === "col") { if (value > 0) wb.cw = value; else delete wb.cw; }
    else { if (value > 0) wb.rh = value; else delete wb.rh; }
    if (wb.cw === m.cw && wb.rh === m.rh) return e;   // 変化なしはそのまま（余計な更新を出さない）
    changed = true;
    const patch = { ...e, customData: { ...e.customData, wbTable: wb } };
    return commit ? { ...patch, version: (e.version ?? 1) + 1, versionNonce: rand() } : patch;
  });
  if (!changed) return false;
  api.updateScene(commit ? { elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY } : { elements: next });
  return true;
}

// 選択列/行のサイズをそろえる。
//   列 = 現在幅の平均（合計を保ったまま均等割り＝表の総幅が変わらない）
//   行 = 現在高の最大（rh は下限としてしか効かないため、平均だと「そろえたのにそろわない」になる）
export function distributeTableSizes(api: any, tid: string, kind: "col" | "row", indices: number[]): boolean {
  const lay = tableLayout(api.getSceneElements(), tid);
  if (!lay || indices.length < 2) return false;
  const sizes = indices.map((i) => (kind === "col" ? lay.colW[i] : lay.rowH[i])).filter((v) => v > 0);
  if (!sizes.length) return false;
  const value = kind === "col"
    ? Math.max(MIN_COL_W, Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length))
    : Math.max(MIN_ROW_H, Math.round(Math.max(...sizes)));
  return applyTableSizes(api, tid, kind, indices, value, true);
}

// ── 矢印キーによるセル移動（BRU10-064） ───────────────────────────────────────
// セルは普通の rectangle なので、セルを選んだまま矢印キーを押すと Excalidraw の既定動作で
// 「その矩形だけが数 px 動く」。表としては崩れでしかない（reflow が位置を戻すが、原点セル(0,0)を
// 動かした場合は表ごとずれる）。表を扱う道具としては「隣のセルへ選択が移る」のが自然なので、
// 表のセルを選んでいる間の矢印キーは選択の移動へ読み替える。
//
// 基点は選択範囲の端（表計算ソフトと同じで、範囲選択から矢印を押すと進行方向の端へ寄って1セルへ畳む）。
// 表まるごと選択（1クリックのグループ選択）は従来どおり＝矢印で表全体を動かせる。

export type TableArrowDir = "up" | "down" | "left" | "right";

// 移動先セルが画面外なら最小限だけスクロールして見えるようにする。
// scene→viewport は Excalidraw と同じ (scene + scroll) * zoom（st.width/height と同じ座標系）。
function scrollPatchForCell(st: any, cell: any): { scrollX: number; scrollY: number } | null {
  const zoom = st?.zoom?.value ?? 1;
  const vw = st?.width ?? 0, vh = st?.height ?? 0;
  if (!vw || !vh || !zoom) return null;
  const M = 24;                       // 画面端に貼り付かないための余白
  let sx = st.scrollX ?? 0, sy = st.scrollY ?? 0;
  const l = (cell.x + sx) * zoom, r = (cell.x + cell.width + sx) * zoom;
  const t = (cell.y + sy) * zoom, b = (cell.y + cell.height + sy) * zoom;
  if (l < M) sx += (M - l) / zoom;                    // 左が切れている → 右へ送る
  else if (r > vw - M) sx -= (r - (vw - M)) / zoom;   // 右が切れている → 左へ送る（セルが画面より大きい時は左端合わせ）
  if (t < M) sy += (M - t) / zoom;
  else if (b > vh - M) sy -= (b - (vh - M)) / zoom;
  return Math.abs(sx - (st.scrollX ?? 0)) > EPS || Math.abs(sy - (st.scrollY ?? 0)) > EPS ? { scrollX: sx, scrollY: sy } : null;
}

/**
 * 選択中の表セルを矢印キーで隣のセルへ移す。戻り値 true = キーを消費した（既定の移動を止める）。
 * 次のときは false（＝Excalidraw の既定動作に任せる）:
 *   ・表のセルを選んでいない（未選択なら矢印でキャンバスがスクロールする）
 *   ・表以外の要素も一緒に選んでいる
 *   ・表を丸ごと選んでいる（表ごと動かしたい意図）
 * 端で行き止まりの場合は何もせず true（＝セルがずれるのを防ぐ）。
 */
export function moveTableCellSelection(api: any, dir: TableArrowDir): boolean {
  const tid = selectedTableId(api);
  if (!tid) return false;
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const { grid, R, C } = info;
  const sel = api.getAppState().selectedElementIds || {};
  // 表以外の要素も選択に混じっていたら手を出さない（セルのラベル=bound text は選択の一部として無視）
  for (const e of els) {
    if (!sel[e.id] || e.isDeleted) continue;
    if (e.type === "text" && e.containerId) continue;
    const m = cellMeta(e);
    if (!m || m.tid !== tid) return false;
  }
  const rows: number[] = [], cols: number[] = [];
  let total = 0, on = 0;
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const cell = grid[r][c]; if (!cell) continue;
    total++;
    if (sel[cell.id]) { on++; rows.push(r); cols.push(c); }
  }
  if (!on || on >= total) return false;
  // 進行方向の端を基点にする（範囲選択 → その端から1セルぶん動いた1セル選択になる）
  const br = dir === "down" ? Math.max(...rows) : Math.min(...rows);
  const bc = dir === "right" ? Math.max(...cols) : Math.min(...cols);
  const nr = Math.max(0, Math.min(R - 1, br + (dir === "down" ? 1 : dir === "up" ? -1 : 0)));
  const nc = Math.max(0, Math.min(C - 1, bc + (dir === "right" ? 1 : dir === "left" ? -1 : 0)));
  const target = grid[nr][nc];
  if (!target) return true;                                  // 欠けたセル（通常は無い）: 何もせずキーだけ消費
  if (on === 1 && nr === br && nc === bc) return true;        // 端で行き止まり: 選択はそのまま
  setTableAxisSel(null);                                      // 列/行の軸選択は畳む（1セル選択になるため）
  const st = api.getAppState();
  const scroll = scrollPatchForCell(st, target);
  // 選択の変更だけなので履歴には残さない（NEVER）。editingGroupId は触らない
  // （グループ内編集で入ったセル選択なら、その状態のまま隣へ移りたい）。
  api.updateScene({
    appState: { selectedElementIds: { [target.id]: true }, selectedGroupIds: {}, ...(scroll ?? {}) },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  return true;
}

export interface TableSel { tid: string; rows: number[]; cols: number[]; R: number; C: number; single: boolean; focusedId: string | null; axis: "col" | "row" | null }

// 追加・削除の基準となる「選択が跨る行・列」を返す。
//   ・セルを個別に複数選択している（＝全セルではない部分選択）→ その選択が跨る行数/列数を単位にする
//     （3セル選択→3行/3列 追加・削除）。
//   ・表を1クリックして全セルが選択されている → グループ選択なので単一セルの意図が取れない。そこで
//     直前に pointerdown で当てた focused セルを基準にする（single=true。操作後にそのセルへ選択を寄せる）。
//     ただしヘッダー帯で明示的に軸選択している時は「その列/行を選んだ」意図が確実なので、1列だけの表など
//     結果的に全セルが選ばれるケースでも単一へフォールバックしない（BRU9-039-2）。
// 表以外の選択・非選択は null。
export function selectedTableRange(api: any, focused: { tid: string; r: number; c: number; id: string } | null): TableSel | null {
  const tid = selectedTableId(api);
  if (!tid) return null;
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return null;
  const ax = tableAxisSel(api, els);
  const axis = ax && ax.tid === tid ? ax.kind : null;
  const sel = api.getAppState().selectedElementIds || {};
  let total = 0, selCount = 0;
  const rows = new Set<number>(), cols = new Set<number>();
  for (const e of els) {
    const m = cellMeta(e);
    if (!m || m.tid !== tid) continue;
    total++;
    if (sel[e.id]) { selCount++; rows.add(m.r); cols.add(m.c); }
  }
  if (!selCount) return null;
  const f = focused && focused.tid === tid && focused.r < info.R && focused.c < info.C ? focused : null;
  // 全セル選択（グループ選択）でフォーカスセルが取れていれば、そのセル1つを基準にする
  if (selCount >= total && f && !axis) {
    return { tid, rows: [f.r], cols: [f.c], R: info.R, C: info.C, single: true, focusedId: f.id, axis: null };
  }
  return { tid, rows: [...rows].sort((a, b) => a - b), cols: [...cols].sort((a, b) => a - b), R: info.R, C: info.C, single: false, focusedId: null, axis };
}

// テンプレセル（見た目の継承元）から空セルを1つ生成する。列幅/行高の手動値は carry で引き継ぐ。
// ラベルの書式（wbTextFmt・BRU10-054-1）と文字色（wbTextColor・BRU7-056-2）も引き継ぐ。
// これが無いと、左寄せ／文字色を決めた列に行や列を足したとき、増えたセルだけ既定の中央・既定色に戻る。
function makeCellFrom(tmpl: any, tid: string, r: number, c: number, carry: { cw?: number; rh?: number }): any {
  const [el] = convertToExcalidrawElements([{
    type: "rectangle",
    x: tmpl?.x ?? 0, y: tmpl?.y ?? 0, width: tmpl?.width ?? 120, height: tmpl?.height ?? 44,
    strokeColor: tmpl?.strokeColor ?? SOFT_BLACK, strokeWidth: tmpl?.strokeWidth ?? 1, roughness: 0,
    backgroundColor: tmpl?.backgroundColor ?? "#ffffff", fillStyle: "solid",
  }] as any) as any[];
  el.roundness = null; el.roughness = 0; el.fillStyle = "solid";       // 角あり・直線罫線
  el.groupIds = tmpl?.groupIds ? [...tmpl.groupIds] : [tid];           // 同一グループへ（一体で移動/削除）
  const inherit: Record<string, any> = {};
  const fmt = tmpl?.customData?.wbTextFmt;
  if (fmt && typeof fmt === "object") inherit.wbTextFmt = { ...fmt };
  if (typeof tmpl?.customData?.wbTextColor === "string") inherit.wbTextColor = tmpl.customData.wbTextColor;
  el.customData = { ...(el.customData ?? {}), ...inherit, wbTable: { tid, r, c, ...carry } };
  return el;
}

// テンプレセルの「今の見た目のサイズ」を手動値として取り出す。
// 手動値(cw/rh)があればそれ、無ければ実寸（＝内容フィットや過去のリサイズで決まった現在のサイズ）。
// これを新しい列/行へ焼き込まないと、追加した列/行だけ最小サイズ(40/32px)で生まれ、
// 直前の行・列より明らかに小さく見える（BRU9-039-2）。
function sizeOfCell(tmpl: any, kind: "col" | "row"): number | undefined {
  const m = cellMeta(tmpl);
  const manual = kind === "col" ? m?.cw : m?.rh;
  if ((manual ?? 0) > 0) return Math.round(manual!);
  const v = kind === "col" ? tmpl?.width : tmpl?.height;
  return typeof v === "number" && v > 0 ? Math.round(v) : undefined;
}

// at 列目に count 列ぶんの新しい列を挿入（at=0..C。C は末尾に追加）。手動行高 rh は行で共有のため隣列から引き継ぐ。
// 幅は「1つ前の列（先頭に挿す時は元の先頭列）と同じ」にする（BRU9-039-2）。
export function insertTableColumns(api: any, tid: string, at: number, count = 1): boolean {
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const { grid, R, C } = info;
  const idx = Math.max(0, Math.min(at, C));
  const n = Math.max(1, count);
  const created: any[] = [];
  for (let r = 0; r < R; r++) {
    const ref = grid[r][idx - 1] ?? grid[r][idx] ?? grid[r].find(Boolean);
    const rh = cellMeta(ref)?.rh;          // 行高は行で共有なので手動値だけ引き継ぐ
    const cw = sizeOfCell(ref, "col");     // 列幅は「1つ前の列と同じ」で生む
    for (let k = 0; k < n; k++) created.push(makeCellFrom(ref, tid, r, idx + k, { ...(rh ? { rh } : {}), ...(cw ? { cw } : {}) }));
  }
  const shifted = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid || m.c < idx) return e;
    return { ...e, customData: { ...e.customData, wbTable: { ...m, c: m.c + n } }, version: (e.version ?? 1) + 1, versionNonce: rand() };
  });
  // 保持中の軸選択も一緒にずらす（そうしないと「3列選択→左に追加」で選択が外れる・BRU9-039-2）
  if (_axisSel && _axisSel.tid === tid && _axisSel.kind === "col") {
    setTableAxisSel({ ..._axisSel, indices: _axisSel.indices.map((i) => (i >= idx ? i + n : i)) });
  }
  // 選択は変更しない（元の選択セルを保持＝同じ位置へ続けて追加できる）。新規セルは非選択のまま。
  api.updateScene({ elements: [...shifted, ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return true;
}

// at 行目に count 行ぶんの新しい行を挿入（at=0..R。R は末尾に追加）。手動列幅 cw は列で共有のため隣行から引き継ぐ。
// 高さは「1つ前の行（先頭に挿す時は元の先頭行）と同じ」にする（BRU9-039-2）。
export function insertTableRows(api: any, tid: string, at: number, count = 1): boolean {
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const { grid, R, C } = info;
  const idx = Math.max(0, Math.min(at, R));
  const n = Math.max(1, count);
  const created: any[] = [];
  for (let c = 0; c < C; c++) {
    const ref = grid[idx - 1]?.[c] ?? grid[idx]?.[c] ?? grid.map((row) => row[c]).find(Boolean);
    const cw = cellMeta(ref)?.cw;          // 列幅は列で共有なので手動値だけ引き継ぐ
    const rh = sizeOfCell(ref, "row");     // 行高は「1つ前の行と同じ」で生む
    for (let k = 0; k < n; k++) created.push(makeCellFrom(ref, tid, idx + k, c, { ...(cw ? { cw } : {}), ...(rh ? { rh } : {}) }));
  }
  const shifted = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid || m.r < idx) return e;
    return { ...e, customData: { ...e.customData, wbTable: { ...m, r: m.r + n } }, version: (e.version ?? 1) + 1, versionNonce: rand() };
  });
  // 保持中の軸選択も一緒にずらす（BRU9-039-2）
  if (_axisSel && _axisSel.tid === tid && _axisSel.kind === "row") {
    setTableAxisSel({ ..._axisSel, indices: _axisSel.indices.map((i) => (i >= idx ? i + n : i)) });
  }
  // 選択は変更しない（元の選択セルを保持＝同じ位置へ続けて追加できる）。新規セルは非選択のまま。
  api.updateScene({ elements: [...shifted, ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return true;
}

// 選択が跨る複数列を一括削除（残りが1列以上になる範囲のみ）。対象セル＋バインドテキストを isDeleted にし、
// 右側の列を詰める。削除したセルは選択から外れるため、パネルは自然に閉じる（deselect も明示する）。
export function deleteTableColumns(api: any, tid: string, cols: number[]): boolean {
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const { grid, R, C } = info;
  const del = new Set(cols.filter((c) => c >= 0 && c < C));
  if (!del.size || del.size >= C) return false;             // 全列は消さない
  const cellIds = new Set<string>();
  for (let r = 0; r < R; r++) for (const c of del) { const cell = grid[r][c]; if (cell) cellIds.add(cell.id); }
  const shift = (c: number) => c - [...del].filter((x) => x < c).length;   // 左詰め後の新インデックス
  const next = els.map((e) => {
    if (cellIds.has(e.id) || (e.type === "text" && cellIds.has(e.containerId)))
      return { ...e, isDeleted: true, version: (e.version ?? 1) + 1, versionNonce: rand() };
    const m = cellMeta(e);
    if (m && m.tid === tid && !del.has(m.c) && shift(m.c) !== m.c)
      return { ...e, customData: { ...e.customData, wbTable: { ...m, c: shift(m.c) } }, version: (e.version ?? 1) + 1, versionNonce: rand() };
    return e;
  });
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  setTableAxisSel(null); // 選択ごと消えるので軸選択も畳む
  api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
  return true;
}

// 選択が跨る複数行を一括削除（残りが1行以上になる範囲のみ）。対象セル＋バインドテキストを isDeleted にし、
// 下側の行を詰める。
export function deleteTableRows(api: any, tid: string, rows: number[]): boolean {
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const { grid, R, C } = info;
  const del = new Set(rows.filter((r) => r >= 0 && r < R));
  if (!del.size || del.size >= R) return false;             // 全行は消さない
  const cellIds = new Set<string>();
  for (const r of del) for (let c = 0; c < C; c++) { const cell = grid[r][c]; if (cell) cellIds.add(cell.id); }
  const shift = (r: number) => r - [...del].filter((x) => x < r).length;   // 上詰め後の新インデックス
  const next = els.map((e) => {
    if (cellIds.has(e.id) || (e.type === "text" && cellIds.has(e.containerId)))
      return { ...e, isDeleted: true, version: (e.version ?? 1) + 1, versionNonce: rand() };
    const m = cellMeta(e);
    if (m && m.tid === tid && !del.has(m.r) && shift(m.r) !== m.r)
      return { ...e, customData: { ...e.customData, wbTable: { ...m, r: shift(m.r) } }, version: (e.version ?? 1) + 1, versionNonce: rand() };
    return e;
  });
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  setTableAxisSel(null); // 選択ごと消えるので軸選択も畳む
  api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: CaptureUpdateAction.NEVER });
  return true;
}

// 全ての表を再レイアウトする。1つでも寸法/位置を変えたら true。
// skip=true（リモート反映中や移動/リサイズ操作中）のときは何もしない。
//
// テキスト編集中は「ライブモード」となり、編集中セルだけは高さ・テキストに一切触れず x/y/幅 のみ
//   調整する。理由: 編集中は Excalidraw がその要素の折り返し・高さを毎フレーム再設定しており、こちらが
//   高さ/テキストを updateScene で書き換えると取り合いになって収束せず、無限ループ（白画面）になる。
//   Excalidraw が管理する唯一の要素（編集中セル）を触らなければ不動点に達し、他セル・列幅・行高は
//   ライブで整う。編集中セルの特定は appState 依存だと不確実なため、エディタ textarea の画面位置を
//   scene 座標へ変換して「その点を含むセル」を幾何学的に特定する（確実）。
let _reflowing = false; // 再入ガード。updateScene が同期的に onChange→reflow を呼び戻しても、
                        // ネストした reflow は即 return させ「Maximum update depth exceeded(白画面)」を構造的に防ぐ。
let _lastEditingId: string | null = null; // 直近に特定した編集中セル。特定がフレーム毎に一瞬失敗しても保持する。

/**
 * 手動サイズ（cw/rh）を、復元されたセルの実寸法へ合わせ直す（BRU10-073・undo/redo 直後のみ）。
 * 1つでも直したら true（呼び出し元はその tick のタイル処理を見送り、次 tick で整った値からタイルする）。
 *
 * cw/rh は freezeSelectedTable が NEVER で焼き込む「ユーザー意図サイズの台帳」で、履歴には載らない。
 * Excalidraw 標準の四隅ハンドルで表をリサイズした後に undo すると、セルの寸法だけが戻って cw/rh は
 * リサイズ後のまま残るため、直後のタイル処理が表を元のサイズへ広げ直してしまう＝「戻るが効かない」。
 * 台帳のほうを実寸法へ追従させることで、台帳が undo に逆らわないようにする。
 */
function resyncFrozenCellSizes(api: any, els: readonly any[]): boolean {
  const patch = new Map<string, any>();
  for (const e of els) {
    const m = cellMeta(e);
    if (!m) continue;
    const cw = (m.cw ?? 0) > 0 && Math.abs(m.cw! - e.width) > EPS ? Math.round(e.width) : undefined;
    const rh = (m.rh ?? 0) > 0 && Math.abs(m.rh! - e.height) > EPS ? Math.round(e.height) : undefined;
    if (cw === undefined && rh === undefined) continue;
    patch.set(e.id, {
      ...e,
      customData: { ...e.customData, wbTable: { ...m, ...(cw !== undefined && { cw }), ...(rh !== undefined && { rh }) } },
      // 台帳の直しも他メンバーへ伝える（版を上げないとYjsブリッジが伝播しない・BRU11-051）。
      version: (e.version ?? 1) + 1, versionNonce: rand(),
    });
  }
  if (!patch.size) return false;
  _reflowing = true; // 本体のタイル処理と同じ再入ガード（同期的な onChange 呼び戻しで多重更新しない）
  try { api.updateScene({ elements: els.map((e) => patch.get(e.id) ?? e) }); } finally { _reflowing = false; }
  return true;
}
export function reflowTables(api: any, skip: boolean, undoing = false): boolean {
  if (skip || _reflowing) return false;
  const els = api.getSceneElements() as any[];

  // 【BRU10-073】undo/redo 直後は、復元されたセルの実寸法を「手動サイズ」の正とみなして cw/rh を直す。
  // cw/rh は履歴に載らない NEVER 更新（freezeSelectedTable）で焼き込まれるため undo では戻らず、
  // そのままだと下のタイル処理が焼き込み済みのサイズへ表を広げ直して「戻るが効かない」ように見える。
  // 対象は既に cw/rh を持つ（＝手動サイズの）セルだけ。自動フィットのセルには書かない。
  if (undoing && resyncFrozenCellSizes(api, els)) return true;

  const patch = computeTableTiling(els, api);
  if (!patch.size) return false;
  const next = els.map((e) => patch.get(e.id) ?? e);
  _reflowing = true;
  try { api.updateScene({ elements: next }); } finally { _reflowing = false; }
  return true;
}

/**
 * 表のタイル結果を**要素配列へ先に適用して返す**（副作用なし・BRU11-051）。
 *
 * 表のレイアウト（列幅・行高・セル位置・折り返し済みテキスト）は内容から毎回導出する派生値で、
 * Yjs へは伝播しない（reflowTables の更新は版を上げないため、ブリッジの version 比較を通らない）。
 * つまり **Y.Map に入っているセル座標は「タイルされる前の生の座標」** で、リモート反映は毎回その
 * 生の座標でシーンを丸ごと置き換える。従来はその直後の onChange 駆動 reflow が整え直していたため、
 * 相手が何か操作するたびに「崩れた表 → 整った表」が一瞬見える＝チカチカした。
 * 特に列/行を追加した直後は、新しいセルがテンプレセルの座標に重なったまま同期されるので、
 * 追加した列が消えて見えるほど大きく崩れる。
 *
 * → 反映する配列の時点でタイル済みにしてしまえば、崩れた状態は一度も描画されない。
 *   派生値は各自のローカルで作る（＝Yjs へ流さない）という現在の設計のまま、ちらつきだけが消える。
 *
 * @param api 編集中セルの特定にだけ使う（省略可＝「誰も編集していない」前提で計算する）
 */
export function tileTables(els: readonly any[], api?: any): any[] {
  const patch = computeTableTiling(els, api);
  if (!patch.size) return els as any[];
  return els.map((e) => patch.get(e.id) ?? e);
}

/** 表のタイル計算（id -> 差し替え後要素）。updateScene はせず、計算結果だけを返す。 */
function computeTableTiling(els: readonly any[], api?: any): Map<string, any> {
  const patch = new Map<string, any>(); // id -> 差し替え後要素
  const tids = new Set<string>();
  for (const e of els) { const m = cellMeta(e); if (m) tids.add(m.tid); }
  if (!tids.size) return patch;

  // container.id -> 束ねられたテキスト要素
  // 削除済み(tombstone)は必ず除く。api.getSceneElements() は tombstone を含まないが、Yjs 反映前の
  // 配列（ブリッジ経由）は含むため、除かないと消したはずのラベルで行高を測って両者の計算が食い違う。
  const textByContainer = new Map<string, any>();
  for (const e of els) { if (e.type === "text" && e.containerId && !e.isDeleted) textByContainer.set(e.containerId, e); }

  // 編集中セルは Excalidraw の要素(originalText/cell.height)が「確定するまで更新されない(stale)」ため、
  // 複数行→一行に減らしても要素上は多行のまま＝行だけ高いまま空白が残る。実際に入力中の生テキストは
  // エディタの textarea(.excalidraw-wysiwyg・同時に1つ)から直接読むのが唯一の即時の真値。
  // 編集中セルの特定は、その textarea の画面位置(左上付近)を scene 座標へ変換し「その点を含むセル」を探す。
  // 編集中セル(コンテナ)の id を特定する。textarea は「伸びるが縮まない」ため位置依存の特定は縮小時に
  // 誤爆する。そこで位置非依存の確実な信号を優先: (1) 各セルの boundElements が編集中テキスト id を参照して
  // いるセル → (2) 編集中テキスト要素の containerId → (3) 最後の手段として textarea 上端の座標判定。
  let editingId: string | null = null;
  let liveText: string | null = null;
  const st0 = api?.getAppState?.() ?? null;
  const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLTextAreaElement | null;
  if (ta && ta.offsetParent !== null) {
    liveText = ta.value;
    // onChange で捕まえた編集中テキスト要素を最優先（api.getAppState()の editingTextElement は欠けることがある）。
    const editEl: any = getEditingTextEl() ?? st0?.editingTextElement;
    const editTextId: string | null = editEl?.id ?? null;
    if (editEl?.containerId) editingId = editEl.containerId;
    if (!editingId && editTextId) {
      for (const e of els) {
        if (cellMeta(e) && Array.isArray(e.boundElements) && e.boundElements.some((b: any) => b?.id === editTextId)) { editingId = e.id; break; }
      }
      if (!editingId) { const te = els.find((e) => e.id === editTextId); editingId = te?.containerId ?? null; }
    }
    if (!editingId && st0) {
      // 最後の手段: textarea の矩形を scene 変換し、水平中心が列に入り、垂直方向の重なりが最大のセルを選ぶ
      // （textarea が縮まず縦にずれても、重なり最大＝編集中セルを外さない）。
      const r = ta.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        const tl = viewportCoordsToSceneCoords({ clientX: r.left, clientY: r.top }, st0);
        const br = viewportCoordsToSceneCoords({ clientX: r.right, clientY: r.bottom }, st0);
        const cxS = (tl.x + br.x) / 2;
        let best = -1;
        for (const e of els) {
          if (!cellMeta(e)) continue;
          if (cxS < e.x || cxS > e.x + e.width) continue; // 列が一致しないセルは除外
          const ov = Math.min(br.y, e.y + e.height) - Math.max(tl.y, e.y); // 垂直方向の重なり
          if (ov > best) { best = ov; editingId = e.id; }
        }
      }
    }
    // 特定できたら記憶。フレーム毎の特定が一瞬失敗しても（＝最後の一行に減らした瞬間など）、
    // 直前に特定したセルを使い続けて stale へ戻らないようにする（編集が続く間だけ有効）。
    if (editingId) _lastEditingId = editingId;
    else if (_lastEditingId && els.some((e) => e.id === _lastEditingId && cellMeta(e))) editingId = _lastEditingId;
  } else {
    _lastEditingId = null; // 編集終了（textareaなし）でクリア
  }
  const rawTextOf = (cell: any, t: any): string => {
    if (editingId && cell.id === editingId && liveText != null) return liveText;
    return typeof t?.originalText === "string" ? t.originalText : (t?.text ?? "");
  };

  for (const tid of tids) {
    const info = tableGrid(els, tid);
    if (!info) continue;
    const { grid, R, C } = info;
    const anchor = grid[0][0];
    const ox = anchor.x, oy = anchor.y;

    // ── 列幅 ──
    const colW: number[] = new Array(C).fill(MIN_COL_W);
    for (let c = 0; c < C; c++) {
      let manual = 0, auto = MIN_COL_W;
      for (let r = 0; r < R; r++) {
        const cell = grid[r][c]; if (!cell) continue;
        const m = cellMeta(cell)!;
        if ((m.cw ?? 0) > 0) manual = Math.max(manual, m.cw!);
        const t = textByContainer.get(cell.id);
        if (t) {
          const font = fontString(t.fontSize ?? 16, t.fontFamily ?? 2);
          const raw = rawTextOf(cell, t);
          let natural = 0;
          for (const ln of raw.split("\n")) natural = Math.max(natural, lineW(ln, font));
          auto = Math.max(auto, natural + 2 * HPAD);
        }
      }
      colW[c] = manual > 0 ? Math.max(MIN_COL_W, manual) : Math.max(MIN_COL_W, Math.ceil(auto));
    }

    // ── 各セルの折り返し後テキストと行高 ──
    const rowH: number[] = new Array(R).fill(MIN_ROW_H);
    const wrapInfo = new Map<string, { text: string; w: number; h: number }>();
    for (let r = 0; r < R; r++) {
      let manual = 0, auto = MIN_ROW_H;
      for (let c = 0; c < C; c++) {
        const cell = grid[r][c]; if (!cell) continue;
        const m = cellMeta(cell)!;
        if ((m.rh ?? 0) > 0) manual = Math.max(manual, m.rh!);
        // 行高は生テキスト(rawTextOf=編集中はliveText)からの計測で算出する（＝確定後と同じ正しい高さ）。
        // Excalidraw の cell.height は編集中に縮めきらない(伸びるが縮まない)ため使わない。編集中セルの
        // 高さは apply 側で rowH に強制設定して、この正しい高さへ縮める。
        const t = textByContainer.get(cell.id);
        if (t) {
          const fontSize = t.fontSize ?? 16;
          const lineHeight = t.lineHeight ?? 1.25;
          const font = fontString(fontSize, t.fontFamily ?? 2);
          const raw = rawTextOf(cell, t);
          const innerW = Math.max(1, colW[c] - 2 * HPAD);
          // 左/右揃えのセルはインデントを折り返し行にも引き継ぐ（中央揃え＝インデント非対応・BRU9-053）
          const wrapped = wrapText(raw, font, innerW, indentSideOfAlign(t.textAlign));
          let w = 0; for (const ln of wrapped) w = Math.max(w, lineW(ln, font));
          const h = wrapped.length * fontSize * lineHeight;
          wrapInfo.set(cell.id, { text: wrapped.join("\n"), w: Math.ceil(w), h: Math.ceil(h) });
          auto = Math.max(auto, h + 2 * VPAD);
        }
      }
      rowH[r] = Math.max(MIN_ROW_H, Math.ceil(auto), manual);
    }

    // ── 累積オフセット ──
    const colX: number[] = new Array(C); { let a = 0; for (let c = 0; c < C; c++) { colX[c] = a; a += colW[c]; } }
    const rowY: number[] = new Array(R); { let a = 0; for (let r = 0; r < R; r++) { rowY[r] = a; a += rowH[r]; } }

    // ── 反映（矩形＋バインドテキスト） ──
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) {
        const cell = grid[r][c]; if (!cell) continue;
        const nx = ox + colX[c], ny = oy + rowY[r], nw = colW[c], nh = rowH[r];
        if (cell.id === editingId) {
          // 編集中セル: テキストは Excalidraw(エディタ)管理なので触らない。ただし高さは Excalidraw が
          // 編集中に縮めきらず余分な高さが残る（＝セル内の余白）ため、正しい rowH を強制設定して縮める。
          // 1行に収まる text なら Excalidraw もこの高さを受け入れる（fit と一致）ので取り合いにならない。
          // ※ 逆に「行高 > 文字フィット高」（手動 rh・同じ行の別セルが複数行）のセルは、Excalidraw の
          //   textWysiwyg.updateWysiwygStyle にある自動縮小が毎フレームここへ縮めに来て綱引きになり、
          //   編集中だけ高さがちらついていた（BRU10-054-2）。表セルの高さの所有者は本関数ただ一つ、と
          //   決めて pnpm patch で本体の自動縮小から表セルを除外している
          //   → patches/@excalidraw__excalidraw@0.18.1.patch（customData.wbTable で判定）。
          if (Math.abs(cell.x - nx) > EPS || Math.abs(cell.y - ny) > EPS ||
              Math.abs(cell.width - nw) > EPS || Math.abs(cell.height - nh) > EPS) {
            patch.set(cell.id, { ...cell, x: nx, y: ny, width: nw, height: nh });
          }
          continue;
        }
        if (Math.abs(cell.x - nx) > EPS || Math.abs(cell.y - ny) > EPS ||
            Math.abs(cell.width - nw) > EPS || Math.abs(cell.height - nh) > EPS) {
          patch.set(cell.id, { ...cell, x: nx, y: ny, width: nw, height: nh });
        }
        const t = textByContainer.get(cell.id);
        const wi = wrapInfo.get(cell.id);
        if (t && wi) {
          // 文字の配置はユーザー設定(textAlign/verticalAlign)を尊重する。以前は毎回 center/middle を
          // 強制上書きしていたため、左寄せ/右寄せにしてもフォーカスアウト時の reflow で中央へ戻ってしまった
          // （BRU7-038）。既定は中央そろえ（未設定・不正値は center/middle にフォールバック）。
          const hAlign = t.textAlign === "left" || t.textAlign === "right" ? t.textAlign : "center";
          const vAlign = t.verticalAlign === "top" || t.verticalAlign === "bottom" ? t.verticalAlign : "middle";
          const tx = hAlign === "left" ? nx + HPAD
                   : hAlign === "right" ? nx + nw - wi.w - HPAD
                   : nx + (nw - wi.w) / 2;
          const ty = vAlign === "top" ? ny + VPAD
                   : vAlign === "bottom" ? ny + nh - wi.h - VPAD
                   : ny + (nh - wi.h) / 2;
          if (t.text !== wi.text || Math.abs(t.width - wi.w) > EPS || Math.abs(t.height - wi.h) > EPS ||
              Math.abs(t.x - tx) > EPS || Math.abs(t.y - ty) > EPS) {
            patch.set(t.id, { ...t, text: wi.text, width: wi.w, height: wi.h, x: tx, y: ty });
          }
        }
      }
    }
  }

  return patch;
}
