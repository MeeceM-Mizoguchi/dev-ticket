// テキストボックス／図形ラベルの行インデント（BRU9-040）。
//
// 要望: 枠の端から文字を少し離して置きたい。細かい単位で刻みたい。改行しても同じ位置から始めたい。
//
// 方式: インデントの実体は「テキスト自身の行頭（右揃えなら行末）の半角スペース」。
//   customData に段数を持たず、originalText の空白そのものを唯一の真実とする。理由:
//   ・Excalidraw は行頭空白を確定時に trim せず（textWysiwyg の nextOriginalText は生値）、
//     折り返し(wrapText)でも幅に収まる行はそのまま通し、SVG出力も white-space:pre を明示している。
//     → 描画・同期(Yjs)・エクスポートのすべてを無改造で通過する。
//   ・段数を customData に持つと onChange で空白を再生成するヘルパーが1本増え、編集中に
//     「消しては書き戻す」綱引き＝ちらつきの温床になる（BRU5-063 / BRU6-011 / BRU7-043 の轍）。
//   本モジュールは onChange 副作用を一切持たない（呼ばれた時だけ動く）。
//
// 揃えとの関係（BRU9-040 の決定事項）: 対応するのは左揃え・右揃えのみ。
//   ・左揃え … 行頭にスペース（文字が右へ寄る）
//   ・右揃え … 行末にスペース（行は右端基準で描かれるため、行頭に入れても文字は1ミリも動かない）
//   ・中央揃え … 入れた量の半分しか動かず反対側にも余白が出るので非対応。textAlign を勝手に
//     書き換えることはせず、ユーザーが「左揃えにする」を押した時だけ変える（setTextAlignLeft）。
//
// 最小単位は半角スペース1個。U+2009 等の可変幅スペースは Excalidraw の既定フォントにグリフが無く、
// フォールバック幅が端末依存になる（共同編集で見た目が人により変わる）ため使わない。
//
// 折り返し（BRU9-053）: 改行せずに枠の端で折り返した「続きの行」にも同じインデントを付ける
//   （ぶら下げインデント）。折り返し自体は whiteboardText の wrapText が担い、表示用テキストの
//   組み直しは whiteboardIndentWrap が onChange の静穏フェーズで行う。本モジュールは変わらず
//   originalText（生の空白）だけを扱う。
import { COMMIT } from "./whiteboardHistory";
import { fontString, indentPadOf, indentSideOfAlign, lineW, wrapText, type IndentSide } from "./whiteboardText";
import { isTableCell } from "./whiteboardTable";
import { boundTextPos, maxTextWidth } from "./whiteboardShapeFit";
import { boundTextOf } from "./whiteboardTextColor";

/** インデントを入れる側。"start"=行頭（左揃え）／"end"=行末（右揃え） */
export type { IndentSide };

/** 1段あたりの半角スペース数の選択肢 */
export const INDENT_STEPS = [1, 2, 4] as const;
export const INDENT_STEP_LABELS: Record<number, string> = { 1: "細", 2: "標準", 4: "広" };

const STEP_KEY = "wb.indentStep";
const DEFAULT_STEP = 2; // Excalidraw 標準(4)の半分＝より細かく刻める
const rand = () => Math.floor(Math.random() * 0x7fffffff);

/** 1段の幅（半角スペース数）。ボードのデータではなく編集者ごとの好みなので localStorage に持つ。 */
export function readIndentStep(): number {
  try {
    const v = Number(localStorage.getItem(STEP_KEY));
    return (INDENT_STEPS as readonly number[]).includes(v) ? v : DEFAULT_STEP;
  } catch { return DEFAULT_STEP; }
}
export function writeIndentStep(n: number): void {
  try { localStorage.setItem(STEP_KEY, String(n)); } catch { /* noop */ }
}

/**
 * このテキスト要素のインデント方向。中央揃え（＝非対応）なら null。
 * textAlign 未設定は Excalidraw 既定の "left" 扱い（素のテキストボックスは既定で左揃え）。
 */
export function indentSideOf(t: any): IndentSide | null {
  if (!t || t.type !== "text" || t.isDeleted) return null;
  return indentSideOfAlign(t.textAlign);
}

/** 要素（テキスト or ラベルを持つ図形）から、実際にインデントするテキスト要素を引く。 */
export function indentTargetOf(el: any, byId: Map<string, any>): any | undefined {
  if (!el || el.isDeleted) return undefined;
  return el.type === "text" ? el : boundTextOf(el, byId);
}

/** 行の先頭（または末尾）に続く半角スペースの数。 */
export const padCount = indentPadOf;

const rawTextOf = (t: any): string =>
  typeof t?.originalText === "string" ? t.originalText : (t?.text ?? "");

// 1回の書き換え（旧テキスト上の座標）。キャレット位置の付け替えに使う。
interface Edit { start: number; deleteLen: number; insertLen: number }

function shiftOne(line: string, delta: number, step: number, side: IndentSide, start: number, end: number)
  : { line: string; edit: Edit | null } {
  if (delta > 0) {
    const pad = " ".repeat(step);
    return {
      line: side === "start" ? pad + line : line + pad,
      edit: { start: side === "start" ? start : end, deleteLen: 0, insertLen: step },
    };
  }
  const cut = Math.min(step, padCount(line, side));
  if (!cut) return { line, edit: null };
  return {
    line: side === "start" ? line.slice(cut) : line.slice(0, line.length - cut),
    edit: { start: side === "start" ? start : end - cut, deleteLen: cut, insertLen: 0 },
  };
}

/**
 * [from, to] にかかる各行のインデントを delta 段ぶん増減した結果と、その書き換え内容を返す。
 * from/to 省略時は全行が対象。
 */
function planShift(
  text: string, delta: number, step: number, side: IndentSide, from: number, to: number,
): { next: string; edits: Edit[] } {
  const edits: Edit[] = [];
  const out: string[] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const start = pos, end = pos + line.length;
    pos = end + 1; // +1 は "\n"
    // 行が範囲と重なるか。選択の終端がちょうど行頭のときはその行を含めない（一般的なエディタ挙動）
    const hit = from <= end && to >= start && !(to === start && to > from);
    if (!hit) { out.push(line); continue; }
    const r = shiftOne(line, delta, step, side, start, end);
    out.push(r.line);
    if (r.edit) edits.push(r.edit);
  }
  return { next: out.join("\n"), edits };
}

/** テキスト全体（または範囲）のインデントを delta 段ぶん増減する。 */
export function shiftLines(
  text: string, delta: number, step: number, side: IndentSide, from = 0, to = text.length,
): string {
  return planShift(text, delta, step, side, from, to).next;
}

// 旧テキスト上のオフセットを、書き換え後のオフセットへ写す。
// 行頭挿入はキャレットも後ろへ送り（Tab で入力位置が indent の後ろに来る）、
// 行末挿入は送らない（右インデントでは文字位置が変わらないのが自然）。
function remap(off: number, edits: Edit[], side: IndentSide): number {
  let d = 0;
  for (const e of edits) {
    const editEnd = e.start + e.deleteLen;
    if (off < e.start) break;
    if (off === e.start) {
      if (side === "start" && e.deleteLen === 0) d += e.insertLen;
      break;
    }
    if (off >= editEnd) d += e.insertLen - e.deleteLen;
    else d += e.start - off; // 削除範囲の内側 → 削除開始位置へ寄せる
  }
  return Math.max(0, off + d);
}

// textarea への挿入。execCommand を使うのは textarea 自身の undo スタックを壊さないため
// （value 直書きは undo 履歴を消す。Excalidraw 標準の indent() はそれをやっている）。
function insertText(ta: HTMLTextAreaElement, str: string): boolean {
  ta.focus();
  let ok = false;
  try {
    // 空文字の insertText はブラウザ差が大きいので、選択範囲の削除として明示的に扱う
    // （キャレットが潰れている時は「1文字前を消す」になってしまうので実行しない）
    ok = str === ""
      ? ta.selectionStart !== ta.selectionEnd && document.execCommand("delete")
      : document.execCommand("insertText", false, str);
  } catch { ok = false; }
  if (ok) return true;
  const { selectionStart: s, selectionEnd: e, value } = ta;
  ta.value = value.slice(0, s) + str + value.slice(e);
  const p = s + str.length;
  ta.setSelectionRange(p, p);
  ta.dispatchEvent(new Event("input", { bubbles: true })); // Excalidraw のエディタ追従を起こす
  return false;
}

/** 編集中の textarea に対して、カーソル行（選択があれば全行）のインデントを増減する。 */
export function indentEditor(ta: HTMLTextAreaElement, delta: number, step: number, side: IndentSide): void {
  const { selectionStart: s0, selectionEnd: e0, value } = ta;
  const { next, edits } = planShift(value, delta, step, side, s0, e0);
  if (next === value) return;
  const ns = remap(s0, edits, side);
  const ne = remap(e0, edits, side);
  ta.focus();
  ta.setSelectionRange(0, value.length);
  insertText(ta, next); // 全置換（1 undo ステップ）
  ta.setSelectionRange(ns, ne);
}

/** 編集中の textarea で改行し、直前の行のインデントを引き継ぐ。 */
export function newlineWithIndent(ta: HTMLTextAreaElement, side: IndentSide): void {
  const { selectionStart: s0, selectionEnd: e0, value } = ta;
  const lineStart = value.lastIndexOf("\n", Math.max(0, s0 - 1)) + 1;
  const nl = value.indexOf("\n", s0);
  const lineEnd = nl < 0 ? value.length : nl;
  const line = value.slice(lineStart, lineEnd);

  if (side === "start") {
    // 行頭スペースのうち「キャレット位置まで」を継ぐ（空白の途中で改行しても余分に継がない）
    const pad = Math.min(padCount(line, "start"), Math.max(0, s0 - lineStart));
    insertText(ta, "\n" + " ".repeat(pad));
    return;
  }

  // 右揃え: 行末スペースを継ぐ。キャレットが行末パッドの中（＝Tabで入れた直後の位置）なら、
  // 行そのものは崩さず「行末で改行して同じパッドを付ける」。
  const trail = padCount(line, "end");
  if (s0 === e0 && s0 >= lineEnd - trail) {
    ta.setSelectionRange(lineEnd, lineEnd);
    insertText(ta, "\n" + " ".repeat(trail));
    const p = Math.max(0, ta.selectionStart - trail); // 新しい行のパッドの手前へ
    ta.setSelectionRange(p, p);
    return;
  }
  // 行の途中で改行 → 前半にもパッドを付ける（後半は元のパッドをそのまま引き継ぐ）
  insertText(ta, " ".repeat(trail) + "\n");
}

// 範囲を選択してから置換する（execCommand 経由なので textarea の undo が保たれる）。
function replaceRange(ta: HTMLTextAreaElement, from: number, to: number, str: string): void {
  ta.focus();
  ta.setSelectionRange(from, to);
  insertText(ta, str);
}

/**
 * 削除キーの効き方。char=Backspace/Delete 単独、word=Option(Alt)+／Ctrl+（単語単位）、
 * line=Cmd+（行頭・行末まで）。修飾キー付きの削除もインデントを食い破るので同じ土俵で扱う。
 */
type DeleteMode = "char" | "word" | "line";

/** そのキーがこれから消そうとしている範囲 [from, to)。単語・行単位は行をまたがせない。 */
function deleteRange(
  value: string, s: number, backward: boolean, mode: DeleteMode, ls: number, le: number,
): [number, number] {
  if (mode === "line") return backward ? [ls, s] : [s, le];
  if (mode === "word") {
    let i = s;
    if (backward) {
      while (i > ls && value[i - 1] === " ") i--;
      while (i > ls && value[i - 1] !== " ") i--;
      return [i, s];
    }
    while (i < le && value[i] === " ") i++;
    while (i < le && value[i] !== " ") i++;
    return [s, i];
  }
  return backward ? [s - 1, s] : [s, s + 1];
}

/**
 * 選択範囲からインデントを外す（BRU9-040 追補2）。
 * 「インデントは書式であって文字ではない」以上、そもそも**選べない**のが素直。全選択（Cmd+A）でも
 * ドラッグでも、インデントの空白には選択の帯が掛からないようにする。
 *
 * textarea の選択は連続した1区間しか持てないので、外せるのは**選択の端**だけ:
 *   ・左揃え … 始点がその行の行頭パッドの中にあれば、パッドの後ろへ送る
 *   ・右揃え … 終点がその行の行末パッドの中にあれば、パッドの手前へ戻す
 * 複数行選択の「途中の行」のパッドは区間の内側なので外しようがない（削除時はその行ごと消えるので
 * 実害は無い。端だけは handleIndentDelete が守る）。
 *
 * 反対側の端は詰めない。左揃えで終点を行頭へ戻すと、消した後に前の行のパッドと合体して
 * かえってインデントが増えて見えるため（右揃えは左右逆）。
 *
 * キャレットだけ（選択なし）の時は動かさない。インデントの中にキャレットを置くこと自体は
 * 妨げない（Shift+Tab の起点になるし、置けないと矢印キーの移動が跳ねて気持ち悪い）。
 *
 * @returns true＝実際に詰めた（＝呼び出し側は再入を気にしなくてよい。詰めた結果は冪等）
 */
export function clampIndentSelection(ta: HTMLTextAreaElement, side: IndentSide): boolean {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (s === e) return false;

  let ns = s, ne = e;
  if (side === "start") {
    const ls = value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
    const nl = value.indexOf("\n", s);
    const pt = ls + padCount(value.slice(ls, nl < 0 ? value.length : nl), "start");
    if (s < pt) ns = Math.min(pt, e); // 選択がパッドの中で終わるなら潰れて空選択になる＝選べない
  } else {
    const ls = value.lastIndexOf("\n", Math.max(0, e - 1)) + 1;
    const nl = value.indexOf("\n", e);
    const le = nl < 0 ? value.length : nl;
    const pf = le - padCount(value.slice(ls, le), "end");
    if (e > pf) ne = Math.max(pf, s);
  }
  if (ns === s && ne === e) return false;

  ta.setSelectionRange(ns, ne, ta.selectionDirection || "forward");
  return true;
}

/**
 * 範囲を選択してからの削除（Cmd+A → Delete など）。選択ぶんは消すが、インデントだけは残す。
 *
 * 削除後に残るのは「選択の手前」と「選択の後ろ」が繋がった1行なので、守るインデントも1つだけ:
 * 左揃えなら**選択の始点がある行の行頭パッド**、右揃えなら**終点がある行の行末パッド**
 * （残る行の行頭／行末になる側）。間の行のインデントは行ごと消えるので追いかけない。
 */
function deleteSelection(ta: HTMLTextAreaElement, side: IndentSide, s: number, e: number, value: string): boolean {
  const anchor = side === "start" ? s : e;
  const ls = value.lastIndexOf("\n", Math.max(0, anchor - 1)) + 1;
  const nl = value.indexOf("\n", anchor);
  const le = nl < 0 ? value.length : nl;
  const pad = padCount(value.slice(ls, le), side);
  if (!pad) return false;

  const pf = side === "start" ? ls : le - pad;   // 保護範囲 [pf, pt)
  const pt = side === "start" ? ls + pad : le;
  const keep = Math.max(0, Math.min(e, pt) - Math.max(s, pf));
  if (!keep) return false;                       // インデントに触れない選択は妨げない
  if (keep === e - s) return true;               // インデントだけを選んで消そうとした → 握り潰す

  replaceRange(ta, s, e, " ".repeat(keep));      // インデントぶんだけ書き戻す
  const caret = side === "start" ? s + keep : s;
  ta.setSelectionRange(caret, caret);
  return true;
}

/**
 * Backspace / Delete をインデントの流儀で処理する（BRU9-040 追補）。
 * 戻り値 true＝こちらで処理した（＝呼び出し側でキーを握り潰す）。
 *
 * インデントの実体は普通の半角スペースなので、放っておくと**普通の文字として1つずつ削れて**
 * 揃えが崩れる。ユーザーの認識は「インデントは書式であって文字ではない」なので、次の2段で扱う:
 *
 *  1. **インデントだけで中身が無い行** … 行をひとまとまりとして扱い、**改行ごと消して隣の行へ移る**。
 *     Backspace なら直前の改行ごと消して上の行末へ、Delete なら直後の改行ごと消して下の行を上げる。
 *     （空白を1つずつ削るのではなく「空のインデント行を1回で畳む」＝ユーザーの期待どおり）
 *     繋ぐ先の行が無い（先頭行の Backspace／最終行の Delete）ときは 2. に落ちる＝**何も起きない**。
 *     ここを素通しにすると、インデントだけが1個ずつ削れていく（BRU9-040 の積み残し）。
 *  2. **インデントに掛かる削除** … 消える範囲からインデントぶんだけを残して実行する。
 *     Cmd+Backspace（行頭まで）や Option+Backspace（単語）でも、インデントだけは残る。
 *     消せるのがインデントしか無いときは、代わりに本文の1文字を消す（キーが完全に無反応になるのを
 *     避ける。右揃えで行末＝インデントの後ろにキャレットがある時など）。本文も無ければ握り潰す。
 *  3. **範囲を選択してからの削除**（Cmd+A → Delete 等） … 同じ考えでインデントだけ残す（§deleteSelection）。
 *     選択がある時はどの修飾キーでも「選択を消す」だけなので mode は見ない。
 *
 * インデントそのものを減らしたい時は Shift+Tab（または書式パネルの ⇤）を使う。
 * @param backward true=Backspace（手前を消す）／false=Delete（その場を消す）
 */
export function handleIndentDelete(
  ta: HTMLTextAreaElement, side: IndentSide, backward: boolean, mode: DeleteMode = "char",
): boolean {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  if (s !== e) return deleteSelection(ta, side, s, e, value);
  const ls = value.lastIndexOf("\n", Math.max(0, s - 1)) + 1;
  const nl = value.indexOf("\n", s);
  const le = nl < 0 ? value.length : nl;
  const line = value.slice(ls, le);
  const pad = padCount(line, side);
  if (!pad) return false; // インデントが無い行は素通し（素の空行の結合も従来どおり）

  // 1. インデントだけの行 → 改行ごと畳む（隣に行がある時だけ）
  if (line.trim() === "" && mode === "char") {
    if (backward && ls > 0) {
      replaceRange(ta, ls - 1, le, "");    // 直前の改行＋この行 → キャレットは上の行末へ
      return true;
    }
    if (!backward && le < value.length) {
      replaceRange(ta, ls, le + 1, "");    // この行＋直後の改行 → 下の行が上がってくる
      return true;
    }
  }

  // 2. インデントを残して削除する
  const pf = side === "start" ? ls : le - pad;   // 保護範囲 [pf, pt)
  const pt = side === "start" ? ls + pad : le;
  let [from, to] = deleteRange(value, s, backward, mode, ls, le);
  const keep = Math.max(0, Math.min(to, pt) - Math.max(from, pf)); // 範囲に掛かったインデントの文字数
  if (!keep) return false;                       // インデントに触れない削除は妨げない

  if (keep === to - from) {
    // 消せるのがインデントだけ → 代わりに本文の1文字を消す（無ければ何もしない）
    if (backward && side === "end" && pf > ls) [from, to] = [pf - 1, pf];
    else if (!backward && side === "start" && pt < le) [from, to] = [pt, pt + 1];
    else return true;
    replaceRange(ta, from, to, "");
    return true;
  }

  replaceRange(ta, from, to, " ".repeat(keep));   // インデントぶんだけ書き戻す
  const caret = side === "start" ? from + keep : from;
  ta.setSelectionRange(caret, caret);
  return true;
}

/**
 * 編集中の textarea に対するキー処理をまとめて行う。WhiteboardCanvas から
 * containerRef の **capture 段階**で呼ぶ（Excalidraw のハンドラは textarea 自身の
 * onkeydown なので、祖先の capture が必ず先に走る）。
 *
 *  Tab / Shift+Tab / Ctrl+[ ]  … インデントを増減（Excalidraw 標準の 4スペース固定を置き換える）
 *  Enter                        … 直前の行のインデントを引き継いで改行
 *  Backspace / Delete           … インデント行を畳む／インデントを守る（§handleIndentDelete）
 *
 * @param editingText 今編集しているテキスト要素（揃えの判定に使う）
 * @returns true＝こちらで処理した（preventDefault / stopPropagation 済み）
 */
export function handleIndentKey(e: KeyboardEvent, editingText: any): boolean {
  const ta = e.target as HTMLTextAreaElement | null;
  if (!ta?.classList?.contains("excalidraw-wysiwyg")) return false; // フレーム名・チャット等は対象外
  if (e.isComposing || (e as any).keyCode === 229) return false;    // IME変換中は一切触らない

  const ctrl = e.metaKey || e.ctrlKey;
  const isTab = e.key === "Tab" || (ctrl && (e.code === "BracketLeft" || e.code === "BracketRight"));
  const isPlainEnter = e.key === "Enter" && !e.shiftKey && !ctrl && !e.altKey;
  const isDelete = e.key === "Backspace" || e.key === "Delete";
  if (!isTab && !isPlainEnter && !isDelete) return false;

  const side = indentSideOf(editingText);

  // 文字消しでインデントが崩れないようにする（中央揃え＝インデント非対応の時は素通し）
  if (isDelete) {
    // 修飾キー付きの削除も同じ土俵に乗せる。mac: Cmd=行頭/行末まで・Option=単語。
    // Windows/Linux: Ctrl=単語（mac の Ctrl+Backspace は1文字削除なので単語扱いにしない）。
    const mac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent);
    const mode: DeleteMode = e.metaKey ? "line" : e.altKey || (!mac && e.ctrlKey) ? "word" : "char";
    if (!side || !handleIndentDelete(ta, side, e.key === "Backspace", mode)) return false;
    e.preventDefault();
    e.stopPropagation();
    return true;
  }

  if (!side) {
    // 中央揃え: Tab は Excalidraw 標準の「4スペース挿入」ごと握り潰す（中途半端にずれるのを防ぐ）。
    // Enter は素通し（継ぐインデントが無いので自前処理に入る意味がない）。
    if (isTab) { e.preventDefault(); e.stopPropagation(); }
    return isTab;
  }

  e.preventDefault();
  e.stopPropagation(); // Excalidraw 標準の Tab(4スペース固定) / 素の改行を置き換える
  if (isTab) indentEditor(ta, e.shiftKey || e.code === "BracketLeft" ? -1 : 1, readIndentStep(), side);
  else newlineWithIndent(ta, side);
  return true;
}

/**
 * 編集中の textarea の選択が変わったときに呼ぶ（select イベント）。インデントに掛かった選択を詰める。
 * handleIndentKey と同じく、対象は Excalidraw のテキストエディタだけ。
 * @param editingText 今編集しているテキスト要素（揃えの判定に使う）
 */
export function handleIndentSelect(target: EventTarget | null, editingText: any): boolean {
  const ta = target as HTMLTextAreaElement | null;
  if (!ta?.classList?.contains("excalidraw-wysiwyg")) return false;
  const side = indentSideOf(editingText);
  return side ? clampIndentSelection(ta, side) : false;
}

/**
 * テキスト要素の text/width/height を、インデント後の originalText から計算し直す。
 * Excalidraw の refreshTextDimensions は非公開なので、コードベース既存の自前計測
 * （whiteboardText / whiteboardShapeFit）を使って同じ式で求める。
 * 折り返しは wrapText がぶら下げインデント込みで行う（BRU9-053）。
 */
export function measureWrapped(t: any, raw: string, container: any | undefined): { text: string; width: number; height: number } {
  const fontSize = t.fontSize ?? 16;
  const lh = t.lineHeight ?? 1.25;
  const font = fontString(fontSize, t.fontFamily ?? 2);
  const fixedW = container ? Math.max(1, maxTextWidth(container))
    : t.autoResize === false ? Math.max(1, t.width ?? 1)
    : 0; // 0 = 折り返さない（autoResize の素のテキストボックス）
  const lines = fixedW ? wrapText(raw, font, fixedW, indentSideOf(t)) : raw.split("\n");
  const measuredW = lines.reduce((m, l) => Math.max(m, lineW(l, font)), 0);
  return {
    text: lines.join("\n"),
    width: t.autoResize === false ? (t.width ?? measuredW) : measuredW,
    height: lines.length * fontSize * lh,
  };
}

/**
 * 選択中の要素（テキストボックス／ラベルを持つ図形）のインデントを全行まとめて増減する。
 * 中央揃えの対象は黙って読み飛ばす。1操作＝1 undo（COMMIT）。
 */
export function indentElements(api: any, ids: string[], delta: number, step: number): void {
  const els = api.getSceneElements() as any[];
  const byId = new Map<string, any>(els.map((e) => [e.id, e]));
  const patch = new Map<string, any>();

  for (const id of ids) {
    const t = indentTargetOf(byId.get(id), byId);
    if (!t || patch.has(t.id)) continue;
    const side = indentSideOf(t);
    if (!side) continue;
    const raw = rawTextOf(t);
    const next = shiftLines(raw, delta, step, side);
    if (next === raw) continue;

    const container = t.containerId ? byId.get(t.containerId) : undefined;
    // 表のセルは reflowTables が text/width/height/x/y を毎tick生テキストから作り直すので、
    // ここでは originalText だけ変えて任せる（二重制御にしない）。
    if (container && isTableCell(container)) {
      patch.set(t.id, { ...t, originalText: next, version: (t.version ?? 1) + 1, versionNonce: rand() });
      continue;
    }
    const m = measureWrapped(t, next, container);
    const nt: any = { ...t, originalText: next, ...m, version: (t.version ?? 1) + 1, versionNonce: rand() };
    if (container) {
      // 幅が変わると右揃えラベルの x が動く。図形の高さ追従は reflowBoundTextShapes に任せる。
      const pos = boundTextPos(container, nt);
      nt.x = pos.x;
      nt.y = pos.y;
    }
    patch.set(t.id, nt);
  }

  if (!patch.size) return;
  api.updateScene({ elements: els.map((e) => patch.get(e.id) ?? e), ...COMMIT });
}

/**
 * 対象のテキストを左揃えにする（中央揃えでインデントできない時の導線）。
 * 揃えを自動では変えない代わりに、ユーザーが押した時だけ1クリックで変えられるようにする。
 */
export function setTextAlignLeft(api: any, ids: string[]): void {
  const els = api.getSceneElements() as any[];
  const byId = new Map<string, any>(els.map((e) => [e.id, e]));
  const patch = new Map<string, any>();

  for (const id of ids) {
    const t = indentTargetOf(byId.get(id), byId);
    if (!t || patch.has(t.id) || t.textAlign === "left") continue;
    const nt: any = { ...t, textAlign: "left", version: (t.version ?? 1) + 1, versionNonce: rand() };
    const container = t.containerId ? byId.get(t.containerId) : undefined;
    // 表セルは reflowTables が揃えを見て置き直すので触らない
    if (container && !isTableCell(container)) {
      const pos = boundTextPos(container, nt);
      nt.x = pos.x;
      nt.y = pos.y;
    }
    patch.set(t.id, nt);
  }

  if (!patch.size) return;
  api.updateScene({ elements: els.map((e) => patch.get(e.id) ?? e), ...COMMIT });
}
