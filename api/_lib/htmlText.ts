// 本文・コメントの HTML（TipTap）を、AI に読ませるテキストに直す（サーバー側API共通）。
//
// もとは api/v1/[resource].ts の中にあった。BRU25-015 で、ブラウザの AI に添付する資料ファイルを作る
// api/research/[action].ts からも同じ変換を使うため、ここへ移した（api/ のルートファイル同士は import し合わない）。

// コードブロックを一時退避するときの目印。本文に絶対に現れない NUL を使う（[resource].ts の CODE_MARK と同じ値）。
const CODE_MARK = "\u0000";

// ── HTML → テキスト（AIに読ませるための逆変換） ───────────────
// 本文とコメントは TipTap の HTML で保存されている。そのまま返すとタグが大半を占めて
// 読みにくいので、Markdown 風のテキストへ直して返す。mdToHtml の完全な逆変換ではなく
// 「読んで内容が分かること」が目的（表は | 区切りの行、入れ子のリストは平らな箇条書きになる）。
// 画像は ![画像](URL) として本文中の位置に残し、URL は images にも集めて返す。

export function decodeEntities(s: string): string {
  const fromCode = (n: number) => { try { return String.fromCodePoint(n); } catch { return ""; } };
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => fromCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => fromCode(Number(d)))
    // &amp; は最後。先に戻すと "&amp;lt;" が "<" まで戻ってしまう
    .replace(/&amp;/g, "&");
}

/** タグの中から属性値を取り出す。data-src を src と取り違えないよう、直前は空白に限る */
export function attrOf(attrs: string, name: string): string {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeEntities(m?.[1] ?? m?.[2] ?? "");
}

// export しているのは検証用（api/v1/[resource].ts からも export し直している）。
export function htmlToText(html: string): { text: string; images: string[] } {
  const images: string[] = [];
  const blocks: string[] = [];

  let s = html.split(CODE_MARK).join("").replace(/\r\n?/g, "\n");

  // コードブロックは中の改行と字下げをそのまま残すため、先に退避する
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, body: string) => {
    const code = decodeEntities(body.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n+$/, "");
    blocks.push("```\n" + code + "\n```");
    return `\n\n${CODE_MARK}${blocks.length - 1}${CODE_MARK}\n\n`;
  });

  // HTML ソース上の改行は空白と同じ意味しか持たない
  s = s.replace(/\n+/g, " ");

  s = s.replace(/<img\b([^>]*)>/gi, (_m, attrs: string) => {
    const src = attrOf(attrs, "src");
    if (!src) return "";
    // 貼り付けた画像が data: のまま入っている古い本文がある。返すと応答が数MBになるので捨てる
    if (/^data:/i.test(src)) return "（本文に直接埋め込まれた画像。URLが無いため取得できません）";
    images.push(src);
    return `![${attrOf(attrs, "alt") || "画像"}](${src})`;
  });

  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs: string, label: string) => {
    const href = attrOf(attrs, "href");
    const text = label.replace(/<[^>]+>/g, "").trim();
    if (!href) return text;
    // 文字はエスケープされたまま（&amp; など）なので、戻してから href と比べる。比べないと URL が二重になる（BRU24-005）
    if (!text || decodeEntities(text) === href) return href;
    return `[${text}](${href})`;
  });

  s = s
    .replace(/<\/?(strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?(em|i)\b[^>]*>/gi, "*")
    .replace(/<\/?(s|del|strike)\b[^>]*>/gi, "~~")
    .replace(/<\/?code\b[^>]*>/gi, "`");

  // TipTap は <li><p>…</p></li> の形で出す。<p> を残すと項目ごとに空行が入るので剥がす（表のセルも同じ）
  s = s
    .replace(/<li\b([^>]*)>\s*<p\b[^>]*>/gi, "<li$1>").replace(/<\/p>\s*<\/li>/gi, "</li>")
    .replace(/<(td|th)\b([^>]*)>\s*<p\b[^>]*>/gi, "<$1$2>").replace(/<\/p>\s*<\/(td|th)>/gi, "</$1>");

  // 番号付きリストは番号を振り直す（入れ子でないものだけ。入れ子は下の箇条書きに落ちる）
  s = s.replace(/<ol\b[^>]*>((?:(?!<\/?[ou]l\b)[\s\S])*?)<\/ol>/gi, (_m, inner: string) => {
    let n = 0;
    return "\n\n" + inner.replace(/<li\b[^>]*>/gi, () => `\n${++n}. `) + "\n\n";
  });
  s = s.replace(/<li\b([^>]*)>/gi, (_m, attrs: string) => {
    const checked = attrOf(attrs, "data-checked");
    return checked === "true" ? "\n- [x] " : checked === "false" ? "\n- [ ] " : "\n- ";
  });

  s = s
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<blockquote\b[^>]*>/gi, "\n\n> ")
    .replace(/<hr\b[^>]*>/gi, "\n\n---\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<table\b[^>]*>/gi, "\n\n")
    .replace(/<tr\b[^>]*>/gi, "\n| ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/(p|div|h[1-6]|blockquote|ul|ol|table)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  s = decodeEntities(s)
    .split("\n").map(line => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  s = s.replace(new RegExp(CODE_MARK + "(\\d+)" + CODE_MARK, "g"), (_m, i: string) => blocks[Number(i)] ?? "");
  return { text: s, images };
}
