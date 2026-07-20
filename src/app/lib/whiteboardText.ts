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
// raw を最大内側幅 maxW で折り返す（半角は語優先、CJK等はグリフ単位で貪欲に折る）。
export function wrapText(raw: string, font: string, maxW: number): string[] {
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
