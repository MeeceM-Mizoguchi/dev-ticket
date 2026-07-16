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
import { viewportCoordsToSceneCoords, convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";

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

// ── 文字計測（自前・オフスクリーン canvas） ──
let _ctx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  return _ctx!;
}
function fontString(fontSize: number, fontFamily: number): string {
  const fam = fontFamily === 3 ? "Cascadia Code, monospace"
    : fontFamily === 1 ? "Virgil, Segoe UI Emoji, sans-serif"
    : "Helvetica, Segoe UI, Hiragino Sans, sans-serif";
  return `${fontSize}px ${fam}`;
}
function lineW(text: string, font: string): number {
  const g = ctx(); g.font = font; return g.measureText(text).width;
}
// raw を最大内側幅 maxW で折り返す（半角は語優先、CJK等はグリフ単位で貪欲に折る）。
function wrapText(raw: string, font: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of raw.split("\n")) {
    if (para === "") { lines.push(""); continue; }
    let line = "";
    for (const ch of para) {
      const trial = line + ch;
      if (line !== "" && lineW(trial, font) > maxW) { lines.push(line); line = ch === " " ? "" : ch; }
      else line = trial;
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

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

// 四角の角ハンドル（グループ全体のリサイズ）でサイズ変更した直後に呼ぶ。
// Excalidraw が拡大縮小した現在の各列幅/行高を、手動値 cw/rh として全セルへ焼き込む。
// これをしないと直後の reflowTables が内容フィット寸法へ戻してしまい「角で大きさを変えられない」。
// 対象は選択中の単一表。以後その表は手動サイズになる（列/行の境界つまみをダブルクリックで自動に戻せる）。
export function freezeSelectedTable(api: any): boolean {
  const tid = selectedTableId(api);
  if (!tid) return false;
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return false;
  const { grid, R, C } = info;
  const colW = Array.from({ length: C }, (_, c) => { for (let r = 0; r < R; r++) if (grid[r][c]) return grid[r][c].width; return 0; });
  const rowH = Array.from({ length: R }, (_, r) => { for (let c = 0; c < C; c++) if (grid[r][c]) return grid[r][c].height; return 0; });
  const next = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid) return e;
    return { ...e, customData: { ...e.customData, wbTable: { ...m, cw: Math.round(colW[m.c]) || undefined, rh: Math.round(rowH[m.r]) || undefined } } };
  });
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

export interface TableSel { tid: string; rows: number[]; cols: number[]; R: number; C: number; single: boolean; focusedId: string | null }

// 追加・削除の基準となる「選択が跨る行・列」を返す。
//   ・セルを個別に複数選択している（＝全セルではない部分選択）→ その選択が跨る行数/列数を単位にする
//     （3セル選択→3行/3列 追加・削除）。
//   ・表を1クリックして全セルが選択されている → グループ選択なので単一セルの意図が取れない。そこで
//     直前に pointerdown で当てた focused セルを基準にする（single=true。操作後にそのセルへ選択を寄せる）。
// 表以外の選択・非選択は null。
export function selectedTableRange(api: any, focused: { tid: string; r: number; c: number; id: string } | null): TableSel | null {
  const tid = selectedTableId(api);
  if (!tid) return null;
  const els = api.getSceneElements() as any[];
  const info = tableGrid(els, tid);
  if (!info) return null;
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
  if (selCount >= total && f) {
    return { tid, rows: [f.r], cols: [f.c], R: info.R, C: info.C, single: true, focusedId: f.id };
  }
  return { tid, rows: [...rows].sort((a, b) => a - b), cols: [...cols].sort((a, b) => a - b), R: info.R, C: info.C, single: false, focusedId: null };
}

// テンプレセル（見た目の継承元）から空セルを1つ生成する。列幅/行高の手動値は carry で引き継ぐ。
function makeCellFrom(tmpl: any, tid: string, r: number, c: number, carry: { cw?: number; rh?: number }): any {
  const [el] = convertToExcalidrawElements([{
    type: "rectangle",
    x: tmpl?.x ?? 0, y: tmpl?.y ?? 0, width: tmpl?.width ?? 120, height: tmpl?.height ?? 44,
    strokeColor: tmpl?.strokeColor ?? SOFT_BLACK, strokeWidth: tmpl?.strokeWidth ?? 1, roughness: 0,
    backgroundColor: tmpl?.backgroundColor ?? "#ffffff", fillStyle: "solid",
  }] as any) as any[];
  el.roundness = null; el.roughness = 0; el.fillStyle = "solid";       // 角あり・直線罫線
  el.groupIds = tmpl?.groupIds ? [...tmpl.groupIds] : [tid];           // 同一グループへ（一体で移動/削除）
  el.customData = { ...(el.customData ?? {}), wbTable: { tid, r, c, ...carry } };
  return el;
}

// at 列目に count 列ぶんの新しい列を挿入（at=0..C。C は末尾に追加）。手動行高 rh は行で共有のため隣列から引き継ぐ。
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
    const rh = cellMeta(ref)?.rh;
    for (let k = 0; k < n; k++) created.push(makeCellFrom(ref, tid, r, idx + k, rh ? { rh } : {}));
  }
  const shifted = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid || m.c < idx) return e;
    return { ...e, customData: { ...e.customData, wbTable: { ...m, c: m.c + n } }, version: (e.version ?? 1) + 1, versionNonce: rand() };
  });
  // 選択は変更しない（元の選択セルを保持＝同じ位置へ続けて追加できる）。新規セルは非選択のまま。
  api.updateScene({ elements: [...shifted, ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  return true;
}

// at 行目に count 行ぶんの新しい行を挿入（at=0..R。R は末尾に追加）。手動列幅 cw は列で共有のため隣行から引き継ぐ。
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
    const cw = cellMeta(ref)?.cw;
    for (let k = 0; k < n; k++) created.push(makeCellFrom(ref, tid, idx + k, c, cw ? { cw } : {}));
  }
  const shifted = els.map((e) => {
    const m = cellMeta(e);
    if (!m || m.tid !== tid || m.r < idx) return e;
    return { ...e, customData: { ...e.customData, wbTable: { ...m, r: m.r + n } }, version: (e.version ?? 1) + 1, versionNonce: rand() };
  });
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
// onChange 側（appState に editingTextElement が確実に入る）から編集中テキスト要素を受け取る。
// api.getAppState() には editingTextElement が入らないことがあるため、こちらを最優先で使う。
let _editingTextEl: any = null;
export function setEditingTextEl(el: any): void { _editingTextEl = el ?? null; }
export function reflowTables(api: any, skip: boolean): boolean {
  if (skip || _reflowing) return false;
  const els = api.getSceneElements() as any[];
  const tids = new Set<string>();
  for (const e of els) { const m = cellMeta(e); if (m) tids.add(m.tid); }
  if (!tids.size) return false;

  // container.id -> 束ねられたテキスト要素
  const textByContainer = new Map<string, any>();
  for (const e of els) { if (e.type === "text" && e.containerId) textByContainer.set(e.containerId, e); }

  const patch = new Map<string, any>(); // id -> 差し替え後要素

  // 編集中セルは Excalidraw の要素(originalText/cell.height)が「確定するまで更新されない(stale)」ため、
  // 複数行→一行に減らしても要素上は多行のまま＝行だけ高いまま空白が残る。実際に入力中の生テキストは
  // エディタの textarea(.excalidraw-wysiwyg・同時に1つ)から直接読むのが唯一の即時の真値。
  // 編集中セルの特定は、その textarea の画面位置(左上付近)を scene 座標へ変換し「その点を含むセル」を探す。
  // 編集中セル(コンテナ)の id を特定する。textarea は「伸びるが縮まない」ため位置依存の特定は縮小時に
  // 誤爆する。そこで位置非依存の確実な信号を優先: (1) 各セルの boundElements が編集中テキスト id を参照して
  // いるセル → (2) 編集中テキスト要素の containerId → (3) 最後の手段として textarea 上端の座標判定。
  let editingId: string | null = null;
  let liveText: string | null = null;
  const st0 = api.getAppState();
  const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLTextAreaElement | null;
  if (ta && ta.offsetParent !== null) {
    liveText = ta.value;
    // onChange で捕まえた編集中テキスト要素を最優先（api.getAppState()の editingTextElement は欠けることがある）。
    const editEl: any = _editingTextEl ?? st0?.editingTextElement;
    const editTextId: string | null = editEl?.id ?? null;
    if (editEl?.containerId) editingId = editEl.containerId;
    if (!editingId && editTextId) {
      for (const e of els) {
        if (cellMeta(e) && Array.isArray(e.boundElements) && e.boundElements.some((b: any) => b?.id === editTextId)) { editingId = e.id; break; }
      }
      if (!editingId) { const te = els.find((e) => e.id === editTextId); editingId = te?.containerId ?? null; }
    }
    if (!editingId) {
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
          const wrapped = wrapText(raw, font, innerW);
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
          const tx = nx + (nw - wi.w) / 2;      // セル中央そろえ
          const ty = ny + (nh - wi.h) / 2;
          if (t.text !== wi.text || Math.abs(t.width - wi.w) > EPS || Math.abs(t.height - wi.h) > EPS ||
              Math.abs(t.x - tx) > EPS || Math.abs(t.y - ty) > EPS ||
              t.textAlign !== "center" || t.verticalAlign !== "middle") {
            patch.set(t.id, { ...t, text: wi.text, width: wi.w, height: wi.h, x: tx, y: ty, textAlign: "center", verticalAlign: "middle" });
          }
        }
      }
    }
  }

  if (!patch.size) return false;
  const next = els.map((e) => patch.get(e.id) ?? e);
  _reflowing = true;
  try { api.updateScene({ elements: next }); } finally { _reflowing = false; }
  return true;
}
