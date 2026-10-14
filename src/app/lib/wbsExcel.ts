// ENHA2-053 WBSの Excel 入出力（エクスポート・テンプレート・インポートするファイルの読み込み）。
//
// エクスポートしたファイルと、インポート用のテンプレートは同じ形で、画面の表と同じ並びにしてある
// （見出しは lib/wbsImport.ts の WBS_FILE_HEADERS）。エクスポートしたファイルを直して、
// そのままインポートし直せる。
//
// 画面と同じく、一番右の段より上の行（3段なら大項目・中項目）は見出し行にする:
// No.・段・項目だけを書き、行全体（ガントの側まで）を色で塗りつぶす。段は「項目」の字下げでも表す。
//
// exceljs は大きいので、使うときにだけ読み込む（ファイルボックスの Excel 表示と同じやり方）。
import type ExcelJS from "exceljs";
import { businessDays, textColorOn, type WbsGanttModel, type WbsRow } from "@/app/lib/wbsCalc";
import { decodeCsvBytes, parseCsvTable } from "@/app/lib/wbsHolidayCsv";
import { WBS_FILE_HEADERS, WBS_FILE_LEVEL_MARKS, type WbsFileCell } from "@/app/lib/wbsImport";
import type { WbsStatus } from "@/app/types";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// 色は画面（wbsStyles.ts）と同じ。Excel は先頭に不透明度の FF を付けた ARGB で指定する
const HEAD_BG = "FF1E3989";
const GANTT_HEAD_BG = "FF19355D";
const GANTT_DOW_BG = "FF3E5F90";
const OFF_DAY_BG = "FFF2F4F9";
/** 見出し行に敷く色。大項目は濃いめ、中項目は薄め（画面の WbsTable と同じ） */
const HEADING_BG = ["FFD9E2F6", "FFEDF1FA"];
const BORDER = { style: "thin" as const, color: { argb: "FFE2E6EC" } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const DOW = ["日", "月", "火", "水", "木", "金", "土"];

/** 列の幅（Excel の文字数単位）。WBS_FILE_HEADERS と同じ並び */
const COL_WIDTHS = [6, 5, 52, 14, 13, 13, 9, 9, 12, 20, 28];
// 列の位置（1始まり）。WBS_FILE_HEADERS の並びと合わせること
const C = { no: 1, level: 2, name: 3, assignee: 4, start: 5, end: 6, days: 7, progress: 8, status: 9, tickets: 10, note: 11 } as const;

/** テンプレートで入力できる最後の行（見出しを除いて 299 行ぶん） */
const TEMPLATE_LAST_ROW = 300;
/** Excel の列の上限（XFD）。テンプレートで、表より右の列をすべて隠すのに使う */
const EXCEL_MAX_COL = 16384;

/** 列番号を A, B, … の文字にする */
function colLetter(n: number): string {
  let out = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) out = String.fromCharCode(65 + ((x - 1) % 26)) + out;
  return out;
}

function argb(hex: string): string {
  return "FF" + hex.replace("#", "").toUpperCase();
}

/** YYYY-MM-DD を Excel の日付にする（Excel は時差を持たないので UTC の0時で渡す） */
function toExcelDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

async function loadExcel(): Promise<typeof ExcelJS> {
  return (await import("exceljs")).default;
}

function styleHeader(row: ExcelJS.Row, count: number) {
  row.height = 22;
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_BG } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = ALL_BORDERS;
  }
}

// ── エクスポート ──────────────────────────────────────────────

/** 見出し行の見た目（行全体を塗りつぶし、項目の名前を太字にする） */
function styleHeadingRow(r: ExcelJS.Row, level: number, lastCol: number) {
  const bg = HEADING_BG[level - 1] ?? HEADING_BG[1];
  for (let c = 1; c <= lastCol; c++) {
    const cell = r.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
    cell.font = { size: 10, bold: c === C.name };
    // 塗りつぶした帯がひと続きに見えるよう、行の上下の線だけを引く
    cell.border = { top: BORDER, bottom: BORDER };
  }
  r.getCell(C.no).alignment = { vertical: "middle", horizontal: "center" };
  r.getCell(C.level).alignment = { vertical: "middle", horizontal: "center" };
  r.getCell(C.name).alignment = { vertical: "middle", horizontal: "left", indent: level - 1 };
}

/**
 * 画面のWBSを Excel にする。左に表、右に1日1列のガント（画面と同じ並び）。
 * 見出し行（大項目・中項目）は No.・段・項目だけを書いて、行全体を塗りつぶす。
 */
export async function exportWbsXlsx(input: {
  sheetName: string;
  rows: WbsRow[];
  statuses: WbsStatus[];
  gantt: WbsGanttModel;
  /** 登録した休日（YYYY-MM-DD）。予定日数の計算に使う */
  holidays: ReadonlySet<string>;
  /** その行に紐づいたチケット番号 */
  ticketNumbersOf: (itemId: string) => string[];
}): Promise<Blob> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("WBS", { views: [{ state: "frozen", xSplit: C.name, ySplit: 2 }] });
  const base = WBS_FILE_HEADERS.length;
  const { days } = input.gantt;
  const lastCol = base + days.length;

  ws.columns = [
    ...COL_WIDTHS.map(width => ({ width })),
    ...days.map(() => ({ width: 3.2 })),
  ];

  // 見出しは2行。表の列は縦に結合し、ガントの列は「月/日」と曜日に分ける
  const head1 = ws.getRow(1);
  const head2 = ws.getRow(2);
  WBS_FILE_HEADERS.forEach((label, i) => { head1.getCell(i + 1).value = label; });
  styleHeader(head1, base);
  styleHeader(head2, base);
  for (let c = 1; c <= base; c++) ws.mergeCells(1, c, 2, c);
  days.forEach((d, i) => {
    const [, m, day] = d.str.split("-").map(Number);
    const c1 = head1.getCell(base + 1 + i);
    const c2 = head2.getCell(base + 1 + i);
    // 月の変わり目が分かるよう、1日だけ「月/日」で書く
    c1.value = day === 1 || i === 0 ? `${m}/${day}` : day;
    c2.value = DOW[d.dow];
    for (const [cell, bg] of [[c1, GANTT_HEAD_BG], [c2, GANTT_DOW_BG]] as const) {
      cell.font = { bold: true, size: 8, color: { argb: d.isHoliday ? "FFFF8A8A" : d.dow === 6 ? "FF93C6FF" : d.dow === 0 ? "FFFFA5A5" : "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      cell.alignment = { horizontal: "center", vertical: "middle", shrinkToFit: true };
    }
    if (d.holidayName) c2.note = d.holidayName;
  });

  const firstStatus = input.statuses[0];
  input.rows.forEach((row, idx) => {
    const { item } = row;
    const r = ws.getRow(3 + idx);
    r.getCell(C.no).value = row.no;
    r.getCell(C.level).value = WBS_FILE_LEVEL_MARKS[item.level - 1] ?? null;
    r.getCell(C.name).value = item.name || null;

    // 見出し行（一番右の段より上）は、ここまで。行全体を塗りつぶす
    if (!row.isLeafLevel) { styleHeadingRow(r, item.level, lastCol); return; }

    const status = input.statuses.find(s => s.id === item.statusId) ?? firstStatus;
    r.getCell(C.assignee).value = item.assignee || null;
    r.getCell(C.start).value = toExcelDate(item.startDate);
    r.getCell(C.end).value = toExcelDate(item.endDate);
    r.getCell(C.days).value = businessDays(item.startDate, item.endDate, input.holidays);
    r.getCell(C.progress).value = item.progress / 100;
    r.getCell(C.status).value = status?.name ?? null;
    r.getCell(C.tickets).value = input.ticketNumbersOf(item.id).join(", ") || null;
    r.getCell(C.note).value = item.note || null;

    const centered: number[] = [C.no, C.level, C.start, C.end, C.days, C.progress, C.status];
    for (let c = 1; c <= base; c++) {
      const cell = r.getCell(c);
      cell.border = ALL_BORDERS;
      cell.font = { size: 10 };
      cell.alignment = { vertical: "middle", horizontal: centered.includes(c) ? "center" : "left" };
    }
    r.getCell(C.name).alignment = { vertical: "middle", horizontal: "left", indent: item.level - 1 };
    r.getCell(C.start).numFmt = "yyyy/mm/dd";
    r.getCell(C.end).numFmt = "yyyy/mm/dd";
    r.getCell(C.progress).numFmt = "0%";
    if (status) {
      r.getCell(C.status).fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(status.color) } };
      r.getCell(C.status).font = { size: 10, bold: true, color: { argb: argb(textColorOn(status.color)) } };
    }
    if (row.delayed) {
      r.getCell(C.end).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE3E6" } };
      r.getCell(C.end).font = { size: 10, bold: true, color: { argb: "FF9F1239" } };
    }

    // ガント。稼働日はステータスの色、土日・休日はグレー
    const inRange = (s: string) => !!item.startDate && !!item.endDate && s >= item.startDate && s <= item.endDate;
    days.forEach((d, i) => {
      const cell = r.getCell(base + 1 + i);
      cell.border = ALL_BORDERS;
      const color = d.off ? OFF_DAY_BG : inRange(d.str) ? argb(status?.color ?? "#D6E2F9") : null;
      if (color) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    });
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

// ── テンプレート ──────────────────────────────────────────────

/**
 * インポート用のテンプレート。入力例と、書き方の説明のシートを付ける。
 * levels はそのWBSの段数。入力例は、その段数に合わせて作る。
 */
export async function buildWbsTemplateXlsx(statusNames: string[], levels: number): Promise<Blob> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("WBS", { views: [{ state: "frozen", ySplit: 1 }] });
  const base = WBS_FILE_HEADERS.length;
  ws.columns = COL_WIDTHS.map(width => ({ width }));
  ws.getRow(1).values = [...WBS_FILE_HEADERS];
  styleHeader(ws.getRow(1), base);

  const [s0, s1] = [statusNames[0] ?? "未着手", statusNames[1] ?? statusNames[0] ?? "着手中"];
  type Sample = { level: number; name: string; assignee?: string; start?: string; end?: string; progress?: number; status?: string; note?: string };
  // 入力例。段数に合わない行（2段のWBSなら小項目）は外し、残った一番右の段の行にだけ中身を入れる
  const all: Sample[] = [
    { level: 1, name: "調査" },
    { level: 2, name: "現行システム" },
    { level: 3, name: "機能一覧の作成", assignee: "山田 太郎", start: "2026-10-01", end: "2026-10-06", progress: 0.5, status: s1, note: "入力するのは、この段の行だけ" },
    { level: 3, name: "テーブル定義の確認", assignee: "山田 太郎", start: "2026-10-07", end: "2026-10-09", progress: 0, status: s0 },
    { level: 2, name: "連携先" },
    { level: 3, name: "外部連携の洗い出し", start: "2026-10-13", end: "2026-10-16", progress: 0, status: s0, note: "担当者・備考は空でもよい" },
    { level: 1, name: "設計" },
    { level: 2, name: "画面" },
    { level: 3, name: "画面一覧の作成", status: s0, note: "日付は空でもよい" },
  ];
  const leafDetails: Omit<Sample, "level" | "name"> = { assignee: "山田 太郎", start: "2026-10-01", end: "2026-10-06", progress: 0.5, status: s1 };
  const samples = all.filter(x => x.level <= levels).map(x => (x.level === levels && x.status === undefined ? { ...x, ...leafDetails } : x));

  // ── 入力例 ──
  // 見出し行の色は、下の条件付き書式が「段」の値を見て付ける（ここでは値だけを入れる）
  samples.forEach((x, i) => {
    const r = ws.getRow(2 + i);
    r.getCell(C.no).value = i + 1;
    r.getCell(C.level).value = WBS_FILE_LEVEL_MARKS[x.level - 1];
    r.getCell(C.name).value = x.name;
    r.getCell(C.name).alignment = { vertical: "middle", horizontal: "left", indent: x.level - 1 };
    if (x.level < levels) return;
    r.getCell(C.assignee).value = x.assignee ?? null;
    r.getCell(C.start).value = x.start ? toExcelDate(x.start) : null;
    r.getCell(C.end).value = x.end ? toExcelDate(x.end) : null;
    r.getCell(C.progress).value = x.progress ?? null;
    r.getCell(C.status).value = x.status ?? null;
    r.getCell(C.note).value = x.note ?? null;
  });

  // ── 入力できる範囲（2行目〜TEMPLATE_LAST_ROW 行目の、表の列）の書式と入力規則 ──
  const marks = WBS_FILE_LEVEL_MARKS.slice(0, levels);
  const leafMark = marks[levels - 1];
  const headingMarks = marks.slice(0, levels - 1);
  const levelCol = colLetter(C.level);
  // 見出し行（一番右の段より上の行）に入力してはいけない列
  const detailCols: number[] = [C.assignee, C.start, C.end, C.days, C.progress, C.status, C.tickets, C.note];
  for (let r = 2; r <= TEMPLATE_LAST_ROW; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= base; c++) {
      const cell = row.getCell(c);
      cell.border = ALL_BORDERS;
      cell.font = { size: 10 };
      // シートを保護するので、入力できるセルだけ鍵を外す
      cell.protection = { locked: false };
      if (c !== C.name) cell.alignment = { vertical: "middle", horizontal: ([C.no, C.level, C.start, C.end, C.days, C.progress, C.status] as number[]).includes(c) ? "center" : "left" };
    }
    row.getCell(C.level).dataValidation = {
      type: "list", allowBlank: true, formulae: [`"${marks.join(",")}"`],
      showErrorMessage: true, errorStyle: "stop", errorTitle: "段", error: `${marks.join("・")} のどれかを選んでください。`,
    };
    // 担当者〜備考は、「段」が一番右の段（入力する行）のときだけ入力できる。
    // 見出し行（大・中）や、段をまだ選んでいない行に入れようとすると、Excel がエラーを出して止める
    for (const c of detailCols) {
      row.getCell(c).dataValidation = {
        type: "custom", allowBlank: true, formulae: [`$${levelCol}${r}="${leafMark}"`],
        showErrorMessage: true, errorStyle: "stop", errorTitle: "ここには入力できません",
        error: headingMarks.length > 0
          ? `この欄に入力できるのは、段が「${leafMark}」の行だけです。\n${headingMarks.map(m => `「${m}」`).join("・")}の行は見出し行なので、No.・段・項目だけを入れます。\n（段が空のときは、先に段を選んでください）`
          : `先に「段」で「${leafMark}」を選んでください。`,
      };
    }
    row.getCell(C.start).numFmt = "yyyy/mm/dd";
    row.getCell(C.end).numFmt = "yyyy/mm/dd";
    row.getCell(C.progress).numFmt = "0%";
  }

  // ── 見出し行の色（条件付き書式） ──
  // 「段」に大・中を選んだ行は、行全体を塗りつぶして項目を太字にする。行を足したり段を変えたりしても追従する
  const inputRange = `A2:${colLetter(base)}${TEMPLATE_LAST_ROW}`;
  ws.addConditionalFormatting({
    ref: inputRange,
    rules: headingMarks.map((m, i) => ({
      type: "expression" as const,
      priority: i + 1,
      formulae: [`$${levelCol}2="${m}"`],
      style: {
        fill: { type: "pattern" as const, pattern: "solid" as const, bgColor: { argb: HEADING_BG[i] ?? HEADING_BG[1] } },
        font: { bold: true },
      },
    })),
  });

  // ── 表の外には入力させない ──
  // 表より右の列はすべて隠し、シートを保護して、鍵を外したセル（上の入力範囲）以外は選べなくする。
  // パスワードは付けない（Excel の「校閲 → シート保護の解除」で外せる。見出しを変えたい人の逃げ道）。
  for (let c = base + 1; c <= EXCEL_MAX_COL; c++) ws.getColumn(c).hidden = true;
  await ws.protect("", {
    selectLockedCells: false, selectUnlockedCells: true,
    formatCells: false, formatColumns: true, formatRows: true,
    insertRows: false, deleteRows: false, insertColumns: false, deleteColumns: false,
    sort: false, autoFilter: false,
  });

  // ── 印刷 ──
  // 表の列だけを、横向き・幅を1ページに収めて印刷する。見出しの行は各ページに繰り返す。
  // 印刷する行は、中身のある行まで（空の入力行を何ページも刷らないため）
  ws.pageSetup = {
    orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
    printArea: `A1:${colLetter(base)}${Math.max(1 + samples.length, 2)}`,
    printTitlesRow: "1:1",
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };

  const leafLabel = ["大項目", "中項目", "小項目"][levels - 1];
  const help = wb.addWorksheet("入力のしかた");
  help.columns = [{ width: 18 }, { width: 100 }];
  const lines: [string, string][] = [
    ["このファイルについて", "「WBS」シートに入力して、WBS画面の「インポート」から取り込みます。2行目からの入力例は、消してから使ってください。"],
    ["入力できる場所", `入力できるのは、「WBS」シートの A〜${colLetter(base)} 列の 2〜${TEMPLATE_LAST_ROW} 行目だけです。それ以外のセルは選べないようにしてあります（列を足したいときなどは、「校閲」→「シート保護の解除」で外せます）。`],
    ["1行＝1つの項目", "「段」で、その行が大項目・中項目・小項目のどれかを選び、「項目」に名前を入れます。上から順に読み、中項目は直前の大項目の下、小項目は直前の中項目の下に入ります。"],
    ["段", `このWBSは${levels}段です。${WBS_FILE_LEVEL_MARKS.slice(0, levels).join("・")} のどれかを選びます（セルを選ぶと、選択肢が出ます）。`],
    ["見出し行", levels > 1
      ? `${leafLabel}より上の段の行は見出し行です。「段」と「項目」だけを入れます。「段」を選ぶと行に色が付き、ほかの欄に入力しようとするとエラーになります。`
      : "このWBSは1段なので、見出し行はありません。すべての行に中身を入れられます。"],
    ["入力する行", `担当者・日付・進捗率・ステータス・チケット・備考を入れるのは、${leafLabel}の行です。`],
    ["No.／予定日数", "取り込みでは使いません（空でかまいません）。No. は上からの順番、予定日数は日付から自動で計算されます。"],
    ["担当者", "プロジェクトのメンバーの名前を、DevTicket の表示どおりに入れます。"],
    ["開始予定日／終了予定日", "2026/10/12 のように入れます。空でもかまいません。"],
    ["進捗率", "0〜100 で入れます（セルは％表示なので、50 と打てば 50% になります）。"],
    ["ステータス", `いまあるステータス：${statusNames.join("／") || "（なし）"}。空欄は先頭のステータスになります。ここに無い名前を入れると、新しいステータスとして追加されます。`],
    ["チケット", "紐づけるチケット番号を入れます。複数あるときは「,」で区切ります（例：BRU19-001, BRU19-002）。空でもかまいません。"],
    ["印刷", "印刷されるのは表の列だけです。行を足したあとは、「ページレイアウト」→「印刷範囲」で、印刷したい行までを選び直してください。"],
    ["CSV でも可", "同じ見出しの行があれば、CSV（UTF-8／Shift_JIS）でも取り込めます。列の順番は違っていてもかまいません。「段」が空の行があると、エラーになって取り込めません。"],
  ];
  lines.forEach(([k, v], i) => {
    const r = help.getRow(1 + i);
    r.values = [k, v];
    r.getCell(1).font = { bold: true, size: 10 };
    r.getCell(2).font = { size: 10 };
    r.getCell(2).alignment = { wrapText: true, vertical: "top" };
    r.getCell(1).alignment = { vertical: "top" };
  });

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: XLSX_MIME });
}

// ── インポートするファイルの読み込み ──────────────────────────

function pad(n: number) { return String(n).padStart(2, "0"); }

/** Excel のセルを、読み取り用の形にする（日付・数値は、文字にする前の値も残す） */
function toFileCell(cell: ExcelJS.Cell): WbsFileCell {
  // 結合したセルは、左上の1つだけに値があるものとして読む。exceljs は結合した全部のセルから
  // 同じ値を返すので、そのまま読むと、縦に結合した見出しの2行目が「項目の行」に見えてしまう
  if (cell.isMerged && cell.master !== cell) return { text: "" };
  let v: unknown = cell.value;
  // 数式は計算結果、リッチテキスト・リンクは文字だけを取り出す
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: unknown; error?: unknown };
    if (o.richText) v = o.richText.map(t => t.text).join("");
    else if (o.result !== undefined) v = o.result;
    else if (o.text !== undefined) v = o.text;
    else v = "";
  }
  if (v === null || v === undefined) return { text: "" };
  if (v instanceof Date) {
    const date = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    return { text: date, date };
  }
  if (typeof v === "number") return { text: String(v), num: v, percent: (cell.numFmt ?? "").includes("%") };
  return { text: String(v) };
}

/**
 * インポートするファイルを「行 × セル」の表にする。
 * .xlsx は「WBS」という名前のシート（無ければ先頭のシート）を読む。それ以外は CSV として読む。
 */
export async function readWbsFile(file: File): Promise<WbsFileCell[][]> {
  const buf = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) {
    const Excel = await loadExcel();
    const wb = new Excel.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet("WBS") ?? wb.worksheets[0];
    if (!ws) return [];
    const table: WbsFileCell[][] = [];
    // 行番号をファイルと合わせるため、空の行も詰めずにそのまま並べる
    for (let r = 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const cells: WbsFileCell[] = [];
      // 表の列だけを読む（右に続くガントの列まで読むと、行数×日数ぶんのセルを作ってしまう）
      const last = Math.min(row.cellCount, 40);
      for (let c = 1; c <= last; c++) cells.push(toFileCell(row.getCell(c)));
      table.push(cells);
    }
    return table;
  }
  return parseCsvTable(decodeCsvBytes(buf)).map(row => row.map(text => ({ text })));
}
