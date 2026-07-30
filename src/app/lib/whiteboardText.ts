// ホワイトボードの文字計測・折り返しの共有ユーティリティ。
// 表（whiteboardTable）と素の図形の高さフィット（whiteboardShapeFit）が同じ計測を使うため、
// Excalidraw 内部関数に依存しないオフスクリーン canvas 実装をここへ集約する
// （@excalidraw の getFontString/refreshTextDimensions は型宣言のみで実体が公開されていない）。

// ── 文字計測（自前・オフスクリーン canvas） ──
let _ctx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!_ctx) _ctx = document.createElement("canvas").getContext("2d");
  return _ctx!;
}
export function fontString(fontSize: number, fontFamily: number): string {
  const fam = fontFamily === 3 ? "Cascadia Code, monospace"
    : fontFamily === 1 ? "Virgil, Segoe UI Emoji, sans-serif"
    : "Helvetica, Segoe UI, Hiragino Sans, sans-serif";
  return `${fontSize}px ${fam}`;
}
export function lineW(text: string, font: string): number {
  const g = ctx(); g.font = font; return g.measureText(text).width;
}

// ── インデント（whiteboardIndent の実体＝行頭／行末の半角スペース） ──
// 折り返しもインデントを考慮する必要があるため、判定の素だけをここに置く（循環importを避ける）。

/** インデントを入れている側。"start"=行頭（左揃え）／"end"=行末（右揃え） */
export type IndentSide = "start" | "end";

/** 揃えからインデント方向を決める。中央揃え（＝インデント非対応）は null。未設定は左揃え扱い。 */
export function indentSideOfAlign(textAlign: string | null | undefined): IndentSide | null {
  if (textAlign === "right") return "end";
  if (textAlign === "center") return null;
  return "start";
}

/** 行の先頭（または末尾）に続く半角スペースの数＝その行のインデント量。 */
export function indentPadOf(line: string, side: IndentSide): number {
  const m = side === "start" ? /^ */.exec(line) : / *$/.exec(line);
  return m ? m[0].length : 0;
}

// ── 折り返し ──
// 「どこで折ってよいか」の単位（トークン）へ分解する。
//   ・空白の連なり … 1トークン。幅を超えても行に載せ、折り返し位置では行末から落とす
//   ・英数字の語   … 1トークン。語の途中では折らない（1行に収まらない語だけ文字単位に割る）
//   ・それ以外     … 1文字ずつ（CJK・仮名・全角記号はグリフ単位で折れる）
const WORD_CHAR = /[0-9A-Za-zÀ-ʯͰ-᳿'’&./:@_+#$%^~*=<>?!,;()[\]{}"|\\-]/;

function tokenize(para: string): string[] {
  const out: string[] = [];
  let buf = "", kind = "";
  const flush = () => { if (buf) { out.push(buf); buf = ""; } };
  for (const ch of para) {
    const k = ch === " " || ch === "\t" ? "space" : WORD_CHAR.test(ch) ? "word" : "";
    if (!k) { flush(); kind = ""; out.push(ch); continue; }
    if (k !== kind) { flush(); kind = k; }
    buf += ch;
  }
  flush();
  return out;
}

// 1行に収まらない1トークン（長い英単語・URL）を文字単位で割る。
function splitToken(tok: string, font: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const ch of tok) {
    const trial = line + ch;
    if (line !== "" && lineW(trial, font) > maxW) { out.push(line); line = ch; }
    else line = trial;
  }
  if (line) out.push(line);
  return out;
}

// 1段落（改行を含まない文字列）を幅 maxW で折る。
function wrapPara(para: string, font: string, maxW: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const tok of tokenize(para)) {
    if (tok[0] === " " || tok[0] === "\t") { line += tok; continue; } // 空白は幅超過を許す（折り返し時に落とす）
    if (line !== "" && lineW(line + tok, font) > maxW) {
      const trimmed = line.replace(/[ \t]+$/, "");
      if (trimmed !== "") out.push(trimmed);
      line = "";
    }
    if (line === "" && lineW(tok, font) > maxW) {
      const parts = splitToken(tok, font, maxW);
      out.push(...parts.slice(0, -1));
      line = parts[parts.length - 1] ?? "";
      continue;
    }
    line += tok;
  }
  out.push(line);
  return out;
}

// インデントを差し引いた実質幅がこの割合を下回るなら、折り返し行のインデントは諦める
// （細い図形に広いインデント＝1行1文字のような極端な組みになるのを防ぐ）。
const MIN_INNER_RATIO = 0.34;

/**
 * raw を最大内側幅 maxW で折り返す（半角は語優先、CJK等はグリフ単位で貪欲に折る）。
 *
 * インデント（行頭／行末の半角スペース・whiteboardIndent）が入っている段落は、
 * 端で折り返した**続きの行にも同じインデントを付ける**＝ぶら下げインデント（BRU9-053）。
 * ユーザーの認識は「インデントは書式」なので、改行した時と同じ位置から続きが始まる。
 * @param side インデントを入れている側（中央揃え等で null を渡すとぶら下げインデントをしない）
 */
export function wrapText(raw: string, font: string, maxW: number, side: IndentSide | null = "start"): string[] {
  const lines: string[] = [];
  for (const para of raw.split("\n")) {
    if (para === "") { lines.push(""); continue; }
    const pad = side ? indentPadOf(para, side) : 0;
    const body = side === "start" ? para.slice(pad) : para.slice(0, para.length - pad);
    const ind = " ".repeat(pad);
    const innerW = pad ? maxW - lineW(ind, font) : maxW;
    if (!pad || body === "" || innerW <= 0 || innerW < maxW * MIN_INNER_RATIO) {
      lines.push(...wrapPara(para, font, maxW));
      continue;
    }
    for (const l of wrapPara(body, font, innerW)) lines.push(side === "start" ? ind + l : l + ind);
  }
  return lines.length ? lines : [""];
}

// ── 編集中のバインドテキスト要素（onChange の appState から確実に受け取る） ──
// api.getAppState() には editingTextElement が入らないことがあるため、onChange 側で set・終了で null。
let _editingTextEl: any = null;
export function setEditingTextEl(el: any): void { _editingTextEl = el ?? null; }
export function getEditingTextEl(): any { return _editingTextEl; }

// 現在編集中のバインドテキストの「コンテナ id」と「ライブ生テキスト」を返す。
// エディタ textarea(.excalidraw-wysiwyg・同時に1つ)が開いている時のみ有効。編集中は要素の
// originalText/text が確定まで stale なので、縮小の即時反映には textarea の生値が唯一の真値。
export function getLiveEditing(api: any): { containerId: string | null; liveText: string | null } {
  const ta = document.querySelector(".excalidraw-wysiwyg") as HTMLTextAreaElement | null;
  if (!ta || ta.offsetParent === null) return { containerId: null, liveText: null };
  const liveText = ta.value;
  const st = api.getAppState?.();
  const editEl: any = _editingTextEl ?? st?.editingTextElement;
  let containerId: string | null = editEl?.containerId ?? null;
  if (!containerId && editEl?.id) {
    const te = (api.getSceneElements() as any[]).find((e) => e.id === editEl.id);
    containerId = te?.containerId ?? null;
  }
  return { containerId, liveText };
}
