// ENHA2-055-3 高度検索の結果（AI が書いた Markdown）を表示する。
//
// AI が書いた文をそのまま HTML にしない（dangerouslySetInnerHTML を使わない）。
// 見出し・箇条書き・番号付きリスト・段落・太字・コード・リンクだけを React の要素として組み立てるので、
// <script> や on〜属性が入っていても、ただの文字として表示されて実行されない。
// リンクは http(s) と画面内のパス（/〜）だけを生かす（javascript: などは文字のまま）。
// 本文の中の [1] [2] は出典の番号として、上付きの小さな番号（押せる）で出す。
import type { ReactNode } from "react";

interface Props {
  markdown: string;
  /** [n] を押したとき。出典の一覧にその番号が無ければ、ただの文字として出す */
  onCite?: (no: number) => void;
  /** 出典として存在する番号 */
  citeNos?: Set<number>;
}

type Block =
  | { type: "h"; level: number; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "p"; text: string };

function parseBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { type: "ul" | "ol"; items: string[] } | null = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: "p", text: para.join("\n") }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) { flushPara(); flushList(); continue; }
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) { flushPara(); flushList(); blocks.push({ type: "h", level: h[1].length, text: h[2] }); continue; }
    const ul = t.match(/^[-*・]\s+(.*)$/);
    if (ul) {
      flushPara();
      if (!list || list.type !== "ul") { flushList(); list = { type: "ul", items: [] }; }
      list.items.push(ul[1]);
      continue;
    }
    const ol = t.match(/^\d+[.)]\s+(.*)$/);
    if (ol) {
      flushPara();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(ol[1]);
      continue;
    }
    // 箇条書きの続きの行（字下げされた行）は、直前の項目へつなぐ
    if (list && /^\s+/.test(raw)) { list.items[list.items.length - 1] += " " + t; continue; }
    flushList();
    para.push(t);
  }
  flushPara();
  flushList();
  return blocks;
}

/** 「## 出典」以降の見出し1つ分を取り除く（出典は画面が sources から一覧を出すため） */
export function stripSourcesSection(md: string): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let skipping = false;
  let skipLevel = 0;
  for (const line of lines) {
    const h = line.trim().match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      if (skipping && h[1].length <= skipLevel) skipping = false;
      if (!skipping && /^出典/.test(h[2].trim())) { skipping = true; skipLevel = h[1].length; continue; }
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n").trim();
}

const SAFE_HREF = /^(https?:\/\/|\/(?!\/))/i;

function renderInline(text: string, props: Props, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // **太字** / `コード` / [文字](URL) / [1] [2,3]
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\[(\d+(?:\s*[,，、]\s*\d+)*)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1] !== undefined) {
      out.push(<strong key={k}>{m[1]}</strong>);
    } else if (m[2] !== undefined) {
      out.push(<code key={k} style={{ fontFamily: "var(--font-mono)", fontSize: "0.92em", background: "#F3F1EE", padding: "1px 5px", borderRadius: 4 }}>{m[2]}</code>);
    } else if (m[3] !== undefined) {
      const href = m[4];
      if (SAFE_HREF.test(href)) {
        out.push(<a key={k} href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" style={{ color: "#059669", textDecoration: "underline" }}>{m[3]}</a>);
      } else {
        out.push(m[0]);
      }
    } else if (m[5] !== undefined) {
      const nos = m[5].split(/\s*[,，、]\s*/).map(Number);
      nos.forEach((no, j) => {
        const known = props.citeNos?.has(no);
        out.push(
          <sup key={`${k}-${j}`} style={{ fontSize: "0.7em", lineHeight: 0, marginLeft: j === 0 ? 1 : 2 }}>
            {known && props.onCite ? (
              <button type="button" onClick={() => props.onCite?.(no)} title={`出典 ${no} を開く`}
                style={{ border: "none", background: "#ECFDF5", color: "#059669", fontWeight: 700, borderRadius: 4, padding: "0 4px", cursor: "pointer", fontSize: "1em" }}>
                {no}
              </button>
            ) : <span style={{ color: "#9E9690" }}>[{no}]</span>}
          </sup>,
        );
      });
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  // 段落の中の改行は改行として出す
  return out.flatMap((n, idx) => typeof n === "string"
    ? n.split("\n").flatMap((part, j, arr) => (j < arr.length - 1 ? [part, <br key={`${keyBase}-br-${idx}-${j}`} />] : [part]))
    : [n]);
}

export function ResearchMarkdown(props: Props) {
  const blocks = parseBlocks(props.markdown);
  return (
    <div style={{ fontSize: 13.5, lineHeight: 1.85, color: "#2C2824" }}>
      {blocks.map((b, i) => {
        const k = `b${i}`;
        if (b.type === "h") {
          const size = b.level <= 2 ? 15 : 13.5;
          return (
            <div key={k} style={{ fontSize: size, fontWeight: 700, color: "#1A1714", margin: i === 0 ? "0 0 6px" : "18px 0 6px", paddingBottom: b.level <= 2 ? 4 : 0, borderBottom: b.level <= 2 ? "1px solid rgba(26,23,20,0.08)" : "none" }}>
              {renderInline(b.text, props, k)}
            </div>
          );
        }
        if (b.type === "ul" || b.type === "ol") {
          const Tag = b.type === "ul" ? "ul" : "ol";
          return (
            <Tag key={k} style={{ margin: "4px 0 8px", paddingLeft: 22, listStyle: b.type === "ul" ? "disc" : "decimal" }}>
              {b.items.map((item, j) => <li key={`${k}-${j}`} style={{ margin: "2px 0" }}>{renderInline(item, props, `${k}-${j}`)}</li>)}
            </Tag>
          );
        }
        return <p key={k} style={{ margin: "4px 0 8px" }}>{renderInline(b.text, props, k)}</p>;
      })}
    </div>
  );
}
