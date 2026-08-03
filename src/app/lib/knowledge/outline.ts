// ナレッジノート: Markdown から目次（見出しツリー）を作る。
//
// 検索の類似度に一切依存しない。見出しを機械的に拾うだけなので、
// 「押せば必ずその節が出る」という確実性がある。
// ブラウズ（ぽちぽち辿る）操作の土台。

export interface OutlineNode {
  /** 一意キー。同名見出しが複数あっても衝突しない */
  id: string;
  /** 見出しレベル 1〜6 */
  level: number;
  /** 見出しテキスト（# を除いたもの） */
  title: string;
  /** 本文の範囲。見出し行そのものを含む */
  start: number;
  end: number;
  /** 直下の子見出し */
  children: OutlineNode[];
}

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

interface Flat { level: number; title: string; start: number; lineEnd: number }

/**
 * Markdown の見出しを拾って木構造にする。
 *
 * コードブロック内の `#` は見出しとして扱わない
 * （SQL のコメントや Python の行コメントを誤って拾わないため）。
 */
export function outlineFromMarkdown(content: string): OutlineNode[] {
  const flat: Flat[] = [];
  let pos = 0;
  let inFence = false;

  for (const line of content.split("\n")) {
    const start = pos;
    pos += line.length + 1;

    if (FENCE_RE.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;

    const m = line.match(HEADING_RE);
    if (!m) continue;
    flat.push({ level: m[1].length, title: m[2].trim(), start, lineEnd: start + line.length });
  }

  if (flat.length === 0) return [];

  // 各見出しの範囲 = 次の「同じか浅い見出し」の直前まで
  const ranges = flat.map((h, i) => {
    let end = content.length;
    for (let j = i + 1; j < flat.length; j++) {
      if (flat[j].level <= h.level) { end = flat[j].start; break; }
    }
    return { ...h, end };
  });

  // 木に組み立てる
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];

  ranges.forEach((h, i) => {
    const node: OutlineNode = {
      id: `${i}-${h.start}`,
      level: h.level,
      title: h.title,
      start: h.start,
      end: h.end,
      children: [],
    };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  });

  return roots;
}

/** 木を平坦化する（検索や件数表示用） */
export function flattenOutline(nodes: OutlineNode[]): OutlineNode[] {
  const out: OutlineNode[] = [];
  const walk = (ns: OutlineNode[]) => {
    for (const n of ns) { out.push(n); walk(n.children); }
  };
  walk(nodes);
  return out;
}

/**
 * 検索ヒットが「どの節のものか」を決める。
 *
 * 位置（charStart）だけで決めてはいけない。チャンクは境界の取りこぼしを防ぐため
 * 開始位置を手前へ 80 文字ほど伸ばしており、節の先頭付近のチャンクは
 * ひとつ前の節にはみ出す。位置で判定すると 6-4 のヒットが 6-3 に着地する。
 *
 * チャンク自身が持つ見出しパスの方が確実なので、まずそれで照合し、
 * 見つからないときだけ位置にフォールバックする。
 */
export function resolveSection(
  flat: OutlineNode[],
  charStart: number,
  headingPath?: string,
): OutlineNode | null {
  const last = headingPath?.split(" > ").pop()?.trim();
  if (last) {
    const hits = flat.filter(n => n.title === last);
    // 同名の見出しが複数ある資料もあるので、その場合は位置が近い方を採る
    if (hits.length > 0) {
      return hits.reduce((a, b) =>
        Math.abs(b.start - charStart) < Math.abs(a.start - charStart) ? b : a);
    }
  }
  let best: OutlineNode | null = null;
  for (const n of flat) {
    if (charStart >= n.start && charStart < n.end) {
      if (!best || n.level > best.level) best = n;
    }
  }
  return best;
}

/**
 * 節の本文（見出し行を除いた中身）。
 * 見出しは UI 側で別途表示するため、本文からは落として重複を避ける。
 */
export function sectionBody(content: string, node: OutlineNode): string {
  const raw = content.slice(node.start, node.end);
  const nl = raw.indexOf("\n");
  return (nl < 0 ? "" : raw.slice(nl + 1)).replace(/\s+$/, "");
}

/**
 * 子見出しを含まない、その節だけの本文。
 * 「3. インフラ」を開いたときに 3-1〜3-3 の中身まで全部出ると長すぎるため、
 * 直下の本文だけを見せて、子は目次から辿らせる。
 */
export function ownBody(content: string, node: OutlineNode): string {
  const firstChild = node.children[0];
  const end = firstChild ? firstChild.start : node.end;
  const raw = content.slice(node.start, end);
  const nl = raw.indexOf("\n");
  return (nl < 0 ? "" : raw.slice(nl + 1)).replace(/\s+$/, "");
}
