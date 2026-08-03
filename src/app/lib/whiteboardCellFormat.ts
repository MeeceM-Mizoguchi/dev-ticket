// 表セル（BRU5-042）の文字書式を「セル矩形」に記録し、あとから入れたラベルへ着せる（BRU10-054-1）。
//
// 症状: 列をまるごと選んで「文字ぞろえ（左寄せ）」や文字色を変えても、まだ文字が入っていないセルには
// 効かず、あとからそのセルへ入力すると中央揃え・既定色で出てくる。
//
// 原因は2つ:
//   ・Excalidraw の書式アクション（changeTextAlign など）は changeProperty(includeBoundText) で
//     **既存のテキスト要素にしか書き込まない**。空セルには適用先が無いので操作が何も残らない。
//   ・その空セルへあとから入力すると、コンテナ付きテキストは textAlign="center" / verticalAlign="middle"
//     で**強制的に**生成される（currentItemTextAlign すら見ない）。色・サイズ・書体は currentItem* から。
//   reflowTables はテキストの textAlign/verticalAlign を尊重する（BRU7-038）ので、この生成時の中央が
//   そのまま最終描画になる ＝「既存セルだけ左寄せ・新しく入力したセルは中央」になる。
//
// 方式は文字色（whiteboardTextColor の wbTextColor）と同じ:
// 「セルに“いま文字を入れたらこうなる”を覚えさせ、ラベルが生まれた瞬間に着せる」。
// 記録先は cell.customData.wbTextFmt（色は既存の wbTextColor を継続利用し、二重管理しない）。
//
//   (A) pinCellTextFormat … onChange の静穏フェーズ。
//        ・ミラー … 選択中でテキストを持つセルは、その実書式を記録へ写す（記録を常に正しく保つ）
//        ・伝播   … 選択が同じまま「テキスト持ちセルの全会一致の書式」が変わった項目だけを、
//                   選択中の全セル（空セル含む）へ配る ＝ **書式操作をした瞬間だけ**配る。
//                   単に選択しただけでは何も書かないので、個別に決めた空セルの書式を潰さない。
//   (B) seedNewCellText … 生まれたてのラベルへ記録を1回だけ着せる。テキスト編集中は onChange が
//        発火しないため、表編集用の rAF ループから呼ぶ（WhiteboardCanvas）。
//   (C) 行/列を追加したときの継承は whiteboardTable の makeCellFrom が行う。
//
// (A) のミラーと (B) の着せ替えは向きが逆なので、(B) は「生まれたてのラベル1回だけ」に限定して
// 向きを固定する。着せた直後は両者が同値になるためミラーは差分ゼロ＝更新を出さない（綱引きしない）。
import { viewportCoordsToSceneCoords } from "@excalidraw/excalidraw";
import { COMMIT } from "./whiteboardHistory";
import { isTableCell } from "./whiteboardTable";
import { getEditingTextEl } from "./whiteboardText";

/** セルに記録する「ラベルの書式」。色は wbTextColor（whiteboardTextColor）が持つ。 */
export interface WbTextFmt { textAlign?: string; verticalAlign?: string; fontSize?: number; fontFamily?: number }

const FMT_KEYS = ["textAlign", "verticalAlign", "fontSize", "fontFamily"] as const;
type FmtKey = (typeof FMT_KEYS)[number];

const rand = () => Math.floor(Math.random() * 0x7fffffff);
const PAD = 5; // Excalidraw の BOUND_TEXT_PADDING（セル内側の余白。whiteboardTable の HPAD/VPAD と同値）
const val = (o: any, k: FmtKey): any => (o == null ? undefined : o[k]);

/** テキスト要素の実書式（未設定は Excalidraw のバインドテキスト既定値で埋める）。 */
function fmtOfText(t: any): WbTextFmt {
  return {
    textAlign: t?.textAlign ?? "center",
    verticalAlign: t?.verticalAlign ?? "middle",
    fontSize: t?.fontSize ?? 16,
    fontFamily: t?.fontFamily ?? 2,
  };
}

/** セルに記録済みの書式（無ければ null）。 */
export function readCellFmt(cell: any): WbTextFmt | null {
  const f = cell?.customData?.wbTextFmt;
  return f && typeof f === "object" ? (f as WbTextFmt) : null;
}

/** 複数セルの記録が全会一致していればその値、割れていれば undefined（パネルのハイライト用）。 */
export function commonCellFmt(cells: readonly any[]): WbTextFmt {
  const out: WbTextFmt = {};
  for (const k of FMT_KEYS) {
    let v: any; let first = true;
    for (const c of cells) {
      const cur = val(readCellFmt(c), k);
      if (first) { v = cur; first = false; }
      else if (cur !== v) { v = undefined; break; }
    }
    if (v !== undefined) (out as any)[k] = v;
  }
  return out;
}

const sameFmt = (a: any, b: any): boolean => FMT_KEYS.every((k) => val(a, k) === val(b, k));

// セル: 「ラベルの書式」を覚えるだけ（セル矩形の見た目そのものには触らない）
function withFmt(el: any, fmt: WbTextFmt): any {
  return {
    ...el,
    customData: { ...(el.customData ?? {}), wbTextFmt: { ...fmt } },
    version: (el.version ?? 1) + 1,
    versionNonce: rand(),
  };
}

// テキスト: 指定の項目だけ実際に書き換える（変化が無ければ元の要素をそのまま返す）
function withTextFmt(t: any, fmt: WbTextFmt): any {
  const upd: any = {};
  for (const k of FMT_KEYS) {
    const v = val(fmt, k);
    if (v !== undefined && t[k] !== v) upd[k] = v;
  }
  if (!Object.keys(upd).length) return t;
  return { ...t, ...upd, version: (t.version ?? 1) + 1, versionNonce: rand() };
}

const rawTextOf = (t: any): string => (typeof t?.originalText === "string" ? t.originalText : (t?.text ?? ""));

// container.id -> バインドテキスト
function textByContainerOf(els: readonly any[]): Map<string, any> {
  const m = new Map<string, any>();
  for (const e of els) if (e.type === "text" && !e.isDeleted && e.containerId) m.set(e.containerId, e);
  return m;
}

/**
 * セルの書式を明示的に設定する（書式パネルから呼ぶ）。記録を書き、ラベルがあれば実際にも適用する。
 * ユーザー操作なので 1 undo ステップとして記録する（BRU7-058）。
 */
export function setCellTextFormat(api: any, cellIds: string[], patch: WbTextFmt): void {
  if (!cellIds.length) return;
  const set = new Set(cellIds);
  const els = api.getSceneElements() as any[];
  let changed = false;
  const next = els.map((e) => {
    if (set.has(e.id) && isTableCell(e)) {
      const merged = { ...(readCellFmt(e) ?? {}), ...patch };
      if (sameFmt(readCellFmt(e) ?? {}, merged)) return e;
      changed = true;
      return withFmt(e, merged);
    }
    if (e.type === "text" && !e.isDeleted && e.containerId && set.has(e.containerId)) {
      const t = withTextFmt(e, patch);
      if (t !== e) changed = true;
      return t;
    }
    return e;
  });
  if (!changed) return;
  api.updateScene({ elements: next, ...COMMIT });
}

// ── (A) 記録 ────────────────────────────────────────────────────────────────
// 「選択が変わらないまま、テキスト持ちセルの全会一致の書式が変わった」＝いま書式操作をした、と見なす。
// 前回値は書き込んだ tick だけ更新する（他のヘルパーが updateScene した tick は丸ごとスキップされるが、
// 比較相手は“最後に見た値”なので変化は次の tick で拾える）。
let _prevSig = "";
let _prevCons: WbTextFmt | null = null;

/**
 * セルの書式記録を最新に保ち、書式操作を空セルへも配る。onChange の静穏フェーズから毎tick呼ぶ。
 * remote反映中・新規描画中・テキスト編集中は何もしない（編集中は seedNewCellText の担当）。
 * @returns updateScene で反映したら true（onChange の二重適用回避に使う）
 */
export function pinCellTextFormat(api: any, remote: boolean, appState?: any): boolean {
  if (remote || appState?.newElement) return false;
  if (document.querySelector(".excalidraw-wysiwyg")) return false;

  const els = api.getSceneElements() as any[];
  const sel = appState?.selectedElementIds ?? {};
  const selCells: any[] = [];
  for (const e of els) if (isTableCell(e) && sel[e.id]) selCells.push(e);
  if (!selCells.length) { _prevSig = ""; _prevCons = null; return false; }

  const textByContainer = textByContainerOf(els);

  // 選択中セルのうち、テキストを持つものの全会一致の書式
  const cons: WbTextFmt = {};
  let n = 0;
  for (const c of selCells) {
    const t = textByContainer.get(c.id);
    if (!t) continue;
    const f = fmtOfText(t);
    if (n === 0) Object.assign(cons, f);
    else for (const k of FMT_KEYS) { if (val(cons, k) !== val(f, k)) delete (cons as any)[k]; }
    n++;
  }
  const sig = selCells.map((c) => c.id).sort().join(",");
  const changed: FmtKey[] = [];
  if (sig === _prevSig && _prevCons) {
    for (const k of FMT_KEYS) {
      const v = val(cons, k);
      if (v !== undefined && v !== val(_prevCons, k)) changed.push(k);
    }
  }
  _prevSig = sig;
  _prevCons = n ? { ...cons } : null;

  const patch = new Map<string, any>();
  // ミラー: テキストを持つ選択セルは、その実書式を記録へ写す（記録を“正”に保つ）。
  // 全セルを毎tick走査すると盤面を開いただけで大量の版更新が出るため、選択中だけに限る
  // （表はクリックするとグループごと全セルが選択されるので、実運用ではこれで十分行き渡る）。
  for (const c of selCells) {
    const t = textByContainer.get(c.id);
    if (!t) continue;
    const f = fmtOfText(t);
    if (sameFmt(readCellFmt(c) ?? {}, f)) continue;
    patch.set(c.id, withFmt(c, f));
  }
  // 伝播: 変わった項目だけ、選択中の全セル（テキストがまだ無いセルを含む）へ配る
  if (changed.length) {
    for (const c of selCells) {
      const base = patch.get(c.id) ?? c;
      const cur = readCellFmt(base) ?? {};
      const nextFmt: WbTextFmt = { ...cur };
      for (const k of changed) (nextFmt as any)[k] = val(cons, k);
      if (sameFmt(cur, nextFmt)) continue;
      patch.set(c.id, withFmt(base, nextFmt));
    }
  }

  if (!patch.size) return false;
  api.updateScene({ elements: els.map((e) => patch.get(e.id) ?? e) });
  return true;
}

// ── (B) 着せ替え ────────────────────────────────────────────────────────────
// 判定済みのテキストid（この編集セッション中は二度と触らない）。エディタが閉じたらクリアする。
const _seeded = new Set<string>();

/**
 * いま文字を編集している表セルを返す（エディタ textarea が開いている時だけ）。
 *
 * appState.editingTextElement は「編集開始時のオブジェクト」で、こちらが updateScene で作り直すと
 * 参照が古くなる。さらに onChange 経由で控えている値（getEditingTextEl）は、表のセル編集中に
 * onChange が発火しないぶん**前回の編集のまま**になっていることがある。id だけを使う分には
 * それでも概ね正しいが、古い id を掴んだまま復帰できないと着せ替えが丸ごと不発になるため、
 * **エディタの画面位置がそのセルの中にあるか**で必ず裏を取り、外れていれば幾何で特定し直す。
 */
function editingCellOf(api: any, els: readonly any[], ta: HTMLTextAreaElement): any | null {
  const st = api.getAppState?.();
  // 現在値(appState)を優先し、欠けている時だけ onChange で控えた値を使う
  const editEl: any = st?.editingTextElement ?? getEditingTextEl();
  const cand = editEl?.containerId ? els.find((e) => e.id === editEl.containerId) : null;
  let p: { x: number; y: number } | null = null;
  try {
    const r = ta.getBoundingClientRect();
    if (r.width > 0 || r.height > 0) {
      p = viewportCoordsToSceneCoords({ clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, st);
    }
  } catch { /* noop */ }
  const hit = (c: any) => !!c && isTableCell(c) && !!p &&
    p.x >= c.x - 2 && p.x <= c.x + c.width + 2 && p.y >= c.y - 2 && p.y <= c.y + c.height + 2;
  if (hit(cand)) return cand;
  if (p) for (const e of els) if (hit(e)) return e;
  return isTableCell(cand) ? cand : null;
}

/** セルのラベル（バインドテキスト）。無ければ null。 */
const cellTextOf = (els: readonly any[], cellId: string): any | null =>
  els.find((e) => e.type === "text" && !e.isDeleted && e.containerId === cellId) ?? null;

/**
 * 生まれたてのセルラベルへ、そのセルに記録された書式・文字色を1回だけ着せる。
 * 表セルのテキスト編集中は Excalidraw の onChange が発火しないため、rAF ループから呼ぶ。
 *
 * updateScene すると Excalidraw の scene.onUpdate → updateWysiwygStyle が走り、編集中の textarea の
 * 見た目（揃え・色・サイズ・書体）もその場で追従する＝**入力しながら正しい書式で見える**。
 * 既存ラベルの編集（生テキストが空でない）には一切触らない。
 * @returns updateScene で反映したら true
 */
export function seedNewCellText(api: any): boolean {
  const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLTextAreaElement | null;
  if (!ta || ta.offsetParent === null) { _seeded.clear(); return false; } // 編集していない
  const els = api.getSceneElements() as any[];

  const cell = editingCellOf(api, els, ta);
  if (!cell) return false;
  const t = cellTextOf(els, cell.id);
  if (!t || _seeded.has(t.id)) return false;
  _seeded.add(t.id); // 判定は一度きり（毎フレーム走査しない・二重適用しない）

  // 生まれたてのラベルだけが対象。既存ラベルの編集（要素に文字が入っている）には触らない
  // ＝ユーザーが個別に決めた書式を尊重する。編集中の要素は確定まで stale なので、
  // 「新規＝空のまま」「既存＝編集前の文字が入っている」で確実に見分けられる。
  if (rawTextOf(t) !== "") return false;

  const upd: any = {};
  const fmt = readCellFmt(cell);
  for (const k of FMT_KEYS) {
    const v = val(fmt, k);
    if (v !== undefined && t[k] !== v) upd[k] = v;
  }
  // 文字色（BRU7-056-2）も同時に着せる。従来は編集中スキップの pinBoundTextColor が確定後に
  // 直していたため、入力中だけ既定色で見えていた。
  const color = cell.customData?.wbTextColor;
  if (typeof color === "string" && t.strokeColor !== color) {
    upd.strokeColor = color;
    upd.customData = { ...(t.customData ?? {}), wbTextColor: color };
  }
  if (!Object.keys(upd).length) return false;

  const id = t.id;
  api.updateScene({
    elements: els.map((e) => (e.id === id ? { ...e, ...upd, version: (e.version ?? 1) + 1, versionNonce: rand() } : e)),
  });
  return true;
}

// ── 編集中のラベルを「揃えの位置」に置き続ける ──────────────────────────────
// 揃えを着せるだけでは**入力中の見た目が変わらない**。Excalidraw のエディタ(textarea)は
//   ・横位置  … テキスト要素の x をそのまま使う（updateWysiwygStyle: coordX = element.x。
//                揃えから計算し直さない）
//   ・箱の幅  … テキスト要素の width
// で置かれる。新規ラベルはコンテナ中央の x で作られるため、textAlign を left にしても箱は
// 中央に居座り、「入力中は中央、確定した瞬間に左へ飛ぶ」という見え方になる（redrawTextBoundingBox
// が確定時に初めて揃えから x を計算し直すため）。
//
// そこで編集中は毎フレーム、テキスト要素の x/y を揃えどおりの位置へ置き直す。位置の式は
// Excalidraw の computeBoundTextPosition と同一（PAD=BOUND_TEXT_PADDING=5・矩形セル）なので、
// updateWysiwygStyle が書き戻す値と一致し、取り合いにならない（y は元々 Excalidraw が同じ式で
// 毎回計算し直している）。テキストの中身・幅・高さには触れない＝reflowTables の「編集中セルには
// 触らない」原則は保ったまま、位置だけを正す。
function expectedTextPos(cell: any, t: any): { x: number; y: number } {
  const align = t.textAlign === "left" || t.textAlign === "right" ? t.textAlign : "center";
  const valign = t.verticalAlign === "top" || t.verticalAlign === "bottom" ? t.verticalAlign : "middle";
  const tw = t.width ?? 0, th = t.height ?? 0;
  return {
    x: align === "left" ? cell.x + PAD
      : align === "right" ? cell.x + cell.width - PAD - tw
      : cell.x + (cell.width - tw) / 2,
    y: valign === "top" ? cell.y + PAD
      : valign === "bottom" ? cell.y + cell.height - PAD - th
      : cell.y + (cell.height - th) / 2,
  };
}

/**
 * 編集中のセルラベルを、揃えどおりの位置へ置き直す（表のセル編集中に毎フレーム呼ぶ）。
 * セルの寸法が確定したあとに置きたいので reflowTables の**後**に呼ぶ。
 * @returns updateScene で反映したら true
 */
export function placeEditingCellText(api: any): boolean {
  const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLTextAreaElement | null;
  if (!ta || ta.offsetParent === null) return false;
  const els = api.getSceneElements() as any[];
  const cell = editingCellOf(api, els, ta);
  if (!cell) return false;
  const t = cellTextOf(els, cell.id);
  if (!t) return false;
  const { x, y } = expectedTextPos(cell, t);
  if (Math.abs((t.x ?? 0) - x) < 0.5 && Math.abs((t.y ?? 0) - y) < 0.5) return false;
  api.updateScene({
    elements: els.map((e) => (e.id === t.id ? { ...e, x, y, version: (e.version ?? 1) + 1, versionNonce: rand() } : e)),
  });
  return true;
}
