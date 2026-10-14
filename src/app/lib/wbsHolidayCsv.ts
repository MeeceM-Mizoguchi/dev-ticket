// ENHA2-053 休日設定の CSV 取り込み。
//
// 決まった形式は求めない。国や会社によって休日の一覧の作りが違うので、
// 「どの行にも日付が1つあり、できれば名前がある」ことだけを当てにして読み取る:
//   ・区切りはカンマ／タブ／セミコロンのどれでもよい（いちばん多く出てくるものを採る）
//   ・列の順番・見出しの有無は問わない。行ごとに、日付として読めた最初のセルを日付にする
//   ・名前は、日付以外で文字が入っている最初のセル（数字だけのセルは連番とみなして飛ばす）
//   ・日付として読めるセルが無い行（見出し・空行・注記）は飛ばす
// 文字コードは UTF-8 と Shift_JIS（内閣府の祝日CSVなど）の両方を受け付ける。

export interface HolidayCsvRow { date: string; name: string }

export interface HolidayCsvResult {
  rows: HolidayCsvRow[];
  /** 日付が読み取れず飛ばした行の数（見出しや空行は数えない） */
  unreadable: number;
  /** ファイルの中で同じ日付が重なっていて、後のほうを捨てた数 */
  duplicated: number;
}

function pad(n: number) { return String(n).padStart(2, "0"); }

/** 実在する日付なら YYYY-MM-DD にする。2月30日などは null */
function toDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * セルを日付として読む。読めなければ null。
 * 年が先頭の書き方（2026-10-12 ／ 2026/10/12 ／ 2026.10.12 ／ 2026年10月12日 ／ 20261012）と、
 * 年が末尾の書き方（10/12/2026 ／ 12.10.2026）を受け付ける。後ろに時刻が付いていてもよい。
 * 年が末尾のときは、月と日の順番が国によって違う。片方が13以上ならそこから決まり、
 * どちらとも取れるとき（例：03/04/2026）は「月/日」と読む。
 */
export function parseHolidayDate(raw: string): string | null {
  // 全角の数字と記号を半角にそろえる
  const s = raw.trim().replace(/[０-９／．－]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  let m = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[\sT].*)?$/.exec(s);
  if (m) return toDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return toDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})(?:[\sT].*)?$/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]), y = Number(m[3]);
    return a > 12 ? toDate(y, b, a) : toDate(y, a, b);
  }
  return null;
}

/** 1行を区切り文字で分ける。"..." で囲んだセルの中の区切り文字と "" は文字として扱う */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(c => c.trim());
}

/** 空行を除いた行と、区切り文字（カンマ／タブ／セミコロンのうち、全体でいちばん多く出てくるもの） */
function linesAndSeparator(text: string): { lines: string[]; sep: string } {
  // 先頭の BOM（Excel が UTF-8 の CSV に付ける目印）は落とす
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter(l => l.trim() !== "");
  const sep = [",", "\t", ";"]
    .map(c => ({ c, n: lines.reduce((a, l) => a + l.split(c).length - 1, 0) }))
    .sort((a, b) => b.n - a.n)[0].c;
  return { lines, sep };
}

/** CSV を「行 × セル」の表にする（WBSのインポートなど、休日以外の取り込みでも使う） */
export function parseCsvTable(text: string): string[][] {
  const { lines, sep } = linesAndSeparator(text);
  return lines.map(l => splitLine(l, sep));
}

export function parseHolidayCsv(text: string): HolidayCsvResult {
  const { lines, sep } = linesAndSeparator(text);

  const rows: HolidayCsvRow[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  let duplicated = 0;
  lines.forEach((line, index) => {
    const cells = splitLine(line, sep);
    let date: string | null = null;
    let dateIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      date = parseHolidayDate(cells[i]);
      if (date) { dateIdx = i; break; }
    }
    if (!date) {
      // 1行目で日付が無いのは見出し。それ以外は読み取れなかった行として数える
      if (index > 0) unreadable++;
      return;
    }
    if (seen.has(date)) { duplicated++; return; }
    seen.add(date);
    const name = cells.find((c, i) => i !== dateIdx && c !== "" && !/^[\d.,\s-]+$/.test(c) && !parseHolidayDate(c)) ?? "";
    rows.push({ date, name: name.slice(0, 40) });
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, unreadable, duplicated };
}

/** ファイルの中身を文字にする。UTF-8 として読めなければ Shift_JIS として読む */
export function decodeCsvBytes(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}
