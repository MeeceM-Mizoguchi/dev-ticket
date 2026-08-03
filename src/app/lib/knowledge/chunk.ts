// ナレッジノート: Markdown を検索単位（チャンク）へ分割する。
//
// 設計上の不変条件（これが崩れると原文ハイライトがズレる）:
//   chunk.content === normalizedText.slice(chunk.charStart, chunk.charEnd)
// オーバーラップは「前チャンクの末尾を複製する」のではなく
// 「開始位置を手前へ伸ばす」ことで実現し、この不変条件を保っている。
//
// 詳細は docs/knowledge-ai-design.md §5-1。

export interface KnowledgeChunkDraft {
  seq: number;
  headingPath: string;
  content: string;
  charStart: number;
  charEnd: number;
}

// サイズ設計は埋め込みモデルの入力上限に合わせている。
// multilingual-e5-base は 512 トークンで打ち切られ、超過分は「静かに」無視される。
// 日本語はおおむね 1トークン ≒ 1〜1.5文字なので、実効上限は 400〜700文字程度。
// これを大きく超えるチャンクを作ると、末尾が検索に一切ヒットしなくなる。

/** 目標サイズ。これを超えたら次のチャンクへ切り替える */
const TARGET_CHARS = 600;
/**
 * 単一ユニット（コードブロック等）がこれを超えたら、やむを得ず行単位で強制分割する。
 * 分割は避けたいが、上限を超えた末尾が丸ごと検索対象外になる方が実害が大きい。
 */
const HARD_MAX_CHARS = 1200;
/** 前チャンクへ食い込ませる文字数。境界での取りこぼしを防ぐ */
const OVERLAP_CHARS = 80;
/** これ未満のチャンクは捨てる（見出しだけの断片など） */
const MIN_CHARS = 20;

/**
 * 改行コードを \n に統一する。
 * 取り込み時にこの結果を原文として保存すること。
 * （保存する原文とオフセットの基準がズレるとハイライトが破綻する）
 */
export function normalizeText(raw: string): string {
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

interface Line {
  text: string;
  start: number;
  end: number; // 改行を含まない終端
}

function toLines(text: string): Line[] {
  const out: Line[] = [];
  let pos = 0;
  for (const t of text.split("\n")) {
    out.push({ text: t, start: pos, end: pos + t.length });
    pos += t.length + 1; // \n の分
  }
  return out;
}

const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const TABLE_RE = /^\s*\|/;

interface Section {
  headingPath: string;
  lines: Line[];
}

/** 見出しでセクションに割る。コードブロック内の # は見出しとして扱わない */
function splitByHeading(lines: Line[]): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let current: Line[] = [];
  let inFence = false;

  const pathOf = () => stack.map(s => s.title).join(" > ");

  const flush = (path: string) => {
    if (current.length > 0) sections.push({ headingPath: path, lines: current });
    current = [];
  };

  for (const line of lines) {
    if (FENCE_RE.test(line.text)) {
      inFence = !inFence;
      current.push(line);
      continue;
    }
    const m = !inFence ? line.text.match(HEADING_RE) : null;
    if (m) {
      // 見出しに到達 → ここまでを1セクションとして確定する
      flush(pathOf());
      const level = m[1].length;
      const title = m[2].trim();
      while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      // 見出し行そのものは次のセクションの先頭に含める（本文と一緒に検索対象にする）
      current.push(line);
    } else {
      current.push(line);
    }
  }
  flush(pathOf());
  return sections;
}

/**
 * セクション内の行を「これ以上分割したくない塊」にまとめる。
 *   ・コードブロック（``` 〜 ```）は途中で切ると意味を失うので1ユニット
 *   ・表（| で始まる連続行）も行の途中で切らないよう1ユニット
 *   ・それ以外は空行区切りの段落
 */
function toUnits(lines: Line[]): { start: number; end: number }[] {
  const units: { start: number; end: number }[] = [];
  let i = 0;

  const push = (from: number, to: number) => {
    if (to <= from) return;
    units.push({ start: lines[from].start, end: lines[to - 1].end });
  };

  while (i < lines.length) {
    const text = lines[i].text;

    if (text.trim() === "") { i++; continue; }

    if (FENCE_RE.test(text)) {
      const from = i;
      i++;
      while (i < lines.length && !FENCE_RE.test(lines[i].text)) i++;
      if (i < lines.length) i++; // 閉じフェンスを含める
      push(from, i);
      continue;
    }

    if (TABLE_RE.test(text)) {
      const from = i;
      while (i < lines.length && TABLE_RE.test(lines[i].text)) i++;
      push(from, i);
      continue;
    }

    const from = i;
    while (i < lines.length && lines[i].text.trim() !== "" && !FENCE_RE.test(lines[i].text)) i++;
    push(from, i);
  }
  return units;
}

/** 空白境界まで開始位置を手前へ伸ばす（語の途中で切らない） */
function extendBackward(text: string, start: number, by: number): number {
  let s = Math.max(0, start - by);
  if (s === 0) return 0;
  // 日本語は空白が無いことが多いので、見つからなければそのまま使う
  for (let i = s; i < start; i++) {
    if (/\s/.test(text[i])) return i + 1;
  }
  return s;
}

/**
 * Markdown をチャンクへ分割する。
 * @param text normalizeText() 済みの原文
 */
export function chunkMarkdown(text: string): KnowledgeChunkDraft[] {
  const normalized = text;
  const lines = toLines(normalized);
  const sections = splitByHeading(lines);
  const drafts: KnowledgeChunkDraft[] = [];
  let seq = 0;

  /**
   * @param floor この節の先頭。オーバーラップでここより手前へは食い込ませない。
   *   はみ出すと charStart がひとつ前の節の範囲に入り、
   *   検索ヒットを押したときに前の節へ着地する（実際に起きた）。
   * @returns 実際に採用したら true
   */
  const emit = (headingPath: string, start: number, end: number, allowOverlap: boolean, floor: number) => {
    let s = start;
    if (allowOverlap) s = Math.max(floor, extendBackward(normalized, start, OVERLAP_CHARS));
    const content = normalized.slice(s, end);
    if (content.trim().length < MIN_CHARS) return false;
    // 見出し行だけの断片は検索結果に出しても中身が無い。
    // 見出しの文言は headingPath として全チャンクに付くので、落としても失われない。
    if (content.replace(/^\s*#{1,6}\s+.*$/gm, "").trim().length === 0) return false;
    drafts.push({ seq: seq++, headingPath, content, charStart: s, charEnd: end });
    return true;
  };

  for (const section of sections) {
    const units = toUnits(section.lines);
    if (units.length === 0) continue;
    const sectionStart = section.lines[0].start;

    let bufStart = -1;
    let bufEnd = -1;
    let isFirstOfSection = true;

    const flushBuf = () => {
      if (bufStart < 0) return;
      // 採用されなかったときは「まだ節の先頭」のまま。
      // 見出しだけの断片を捨てた直後にオーバーラップを許すと、前の節へはみ出す。
      if (emit(section.headingPath, bufStart, bufEnd, !isFirstOfSection, sectionStart)) {
        isFirstOfSection = false;
      }
      bufStart = -1;
      bufEnd = -1;
    };

    for (const u of units) {
      const uLen = u.end - u.start;

      // 単体で巨大なユニット（長大なコードブロック等）は行単位で強制分割する。
      // 分割したくはないが、埋め込みモデルの入力長を超えると精度が落ちるため上限は設ける。
      if (uLen > HARD_MAX_CHARS) {
        flushBuf();
        let p = u.start;
        while (p < u.end) {
          const e = Math.min(u.end, p + HARD_MAX_CHARS);
          if (emit(section.headingPath, p, e, !isFirstOfSection, sectionStart)) {
            isFirstOfSection = false;
          }
          p = e;
        }
        continue;
      }

      if (bufStart < 0) {
        bufStart = u.start;
        bufEnd = u.end;
      } else {
        bufEnd = u.end;
      }

      if (bufEnd - bufStart >= TARGET_CHARS) flushBuf();
    }
    flushBuf();
  }

  return drafts;
}

/**
 * 埋め込みモデルへ渡す文字列を作る。
 *
 * e5 系モデルは接頭辞（passage: / query:）が必須。付け忘れると精度が明確に落ちる。
 * 保存側と検索側で取り違えないよう、変換はこの2関数に集約すること。
 */
export function toPassageInput(headingPath: string, content: string): string {
  const head = headingPath ? `${headingPath}\n` : "";
  return `passage: ${head}${content}`;
}

export function toQueryInput(query: string): string {
  return `query: ${query}`;
}

/** 同一内容の再取り込みを検出するためのハッシュ（衝突耐性より速度と依存の少なさを優先） */
export async function hashContent(text: string): Promise<string> {
  try {
    const buf = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  } catch {
    // crypto.subtle は安全なコンテキスト(HTTPS/localhost)でのみ使える。
    // 使えない環境では長さベースの簡易フォールバックにする（重複検出の精度は落ちる）。
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
    return `fallback-${text.length}-${(h >>> 0).toString(16)}`;
  }
}
