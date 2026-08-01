// ホワイトボードの表（BRU5-042）の生成を1箇所に集約する。
//
// 表の実体はツールバーの「表」ボタンと同じ: セル1つ = 標準の rectangle を升目状に敷き詰め、
// 同一 groupId でグループ化し、customData.wbTable に格子座標(tid/r/c)を持たせる。
// ここを共通化したことで、Markdown の貼り付け（whiteboardPasteMarkdown）も
// 「中身入りの表」をまったく同じ形で作れる＝既存の列幅ドラッグ・行列挿入・reflowTables が
// そのまま効く。
import { convertToExcalidrawElements, CaptureUpdateAction } from "@excalidraw/excalidraw";

export const WB_CELL_W = 120;              // セル既定幅
export const WB_CELL_H = 44;               // セル既定高
const SOFT_BLACK = "#343a40";              // 白板の既定線色（CLEAN_DEFAULTS と揃える）
const HEADER_FILL = "#f1f3f5";             // 先頭行（ヘッダー）の薄いグレー
const CELL_FONT_SIZE = 16;
const NORMAL_FONT_FAMILY = 2;              // 2 = Helvetica（CLEAN_DEFAULTS と同じ）

export interface CreateTableOpts {
  /** 表の左上（scene座標） */
  x: number;
  y: number;
  rows: number;
  cols: number;
  /** セルの文字（[r][c]）。省略したセルは空 */
  cells?: string[][];
  /**
   * セルのリンク（[r][c]）。Excalidraw は「要素1つにリンク1本」なので、セル矩形の
   * element.link として持たせる（クリックで開ける・リンクアイコンが出る）。
   * whole=true（セルの文字全体がリンク）のときは文字色も linkColor にする。
   */
  cellLinks?: ({ href: string; whole: boolean } | null)[][];
  /** リンクセルの文字色（既定は SOFT_BLACK のまま） */
  linkColor?: string;
  /** 列幅（省略時は WB_CELL_W）。指定すると「手動幅」として customData に載り、reflow でも保持される */
  colWidths?: number[];
  /** 先頭行をヘッダー色にするか（既定: rows > 1） */
  header?: boolean;
}

/** 表の要素（セル矩形＋バインドテキスト）を作る。シーンへの追加は呼び出し側。 */
export function createTableElements(opts: CreateTableOpts): any[] {
  const { x, y, rows, cols, cells, colWidths } = opts;
  if (rows < 1 || cols < 1) return [];
  const header = opts.header ?? rows > 1;
  const groupId = `wb_table_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const widths = Array.from({ length: cols }, (_, c) => Math.max(40, Math.round(colWidths?.[c] ?? WB_CELL_W)));
  const colX: number[] = []; { let a = 0; for (let c = 0; c < cols; c++) { colX[c] = a; a += widths[c]; } }

  const { cellLinks, linkColor } = opts;
  const skeleton: any[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const text = cells?.[r]?.[c] ?? "";
      const link = cellLinks?.[r]?.[c] ?? null;
      const textColor = link?.whole && linkColor ? linkColor : SOFT_BLACK;
      skeleton.push({
        type: "rectangle",
        x: x + colX[c],
        y: y + r * WB_CELL_H,
        width: widths[c],
        height: WB_CELL_H,
        strokeColor: SOFT_BLACK,
        strokeWidth: 1,
        roughness: 0,
        // 先頭行はヘッダーとして薄グレー、他は不透明の白（背後の図が透けない）
        backgroundColor: header && r === 0 ? HEADER_FILL : "#ffffff",
        fillStyle: "solid",
        customData: { wbTable: { tid: groupId, r, c } },
        ...(link ? { link: link.href } : {}),
        ...(text
          ? {
            label: {
              text,
              fontSize: CELL_FONT_SIZE,
              fontFamily: NORMAL_FONT_FAMILY,
              textAlign: "left",       // 表のセルは左揃えが読みやすい（reflow も left を尊重する）
              verticalAlign: "middle",
              strokeColor: textColor,
            },
          }
          : {}),
      });
    }
  }

  const els = convertToExcalidrawElements(skeleton) as any[];
  // convertToExcalidrawElements は customData を保持しないことがあるため、行/列順で確実に再付与する。
  // ラベル付きの場合は [矩形, テキスト, 矩形, ...] のように並ぶので、矩形だけを順に拾う。
  const containers = els.filter((e) => e?.type === "rectangle");
  const textColorByContainer = new Map<string, string>();
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const e = containers[i++];
      if (!e) continue;
      const link = cellLinks?.[r]?.[c] ?? null;
      if (link) e.link = link.href;     // skeleton 経由で落ちることがあるので明示的に付け直す
      if (link?.whole && linkColor) {
        // 文字色の“正”は customData.wbTextColor（whiteboardTextColor）。ここに書いておかないと
        // pinBoundTextColor が「線の色」から色を決め直してリンク色が消える。
        e.customData = { ...(e.customData ?? {}), wbTextColor: linkColor };
        textColorByContainer.set(e.id, linkColor);
      }
      e.roundness = null;                 // 角あり（表の罫線は角丸にしない）
      e.roughness = 0;                    // 直線罫線
      e.fillStyle = "solid";
      e.groupIds = [groupId];             // 全セルを1グループに（一体で移動・削除）
      e.customData = {
        ...(e.customData ?? {}),
        // 列幅を明示したときは「手動幅(cw)」として持たせる。これが無いと reflowTables が
        // 文字の実幅で列を広げてしまい、長文セルの列が極端に広くなる。
        wbTable: { tid: groupId, r, c, ...(colWidths ? { cw: widths[c] } : {}) },
      };
    }
  }

  // バインドテキスト側にも文字色を記録する（pinBoundTextColor が“正”として読む値）
  for (const t of els) {
    if (t?.type !== "text" || !t.containerId) continue;
    const color = textColorByContainer.get(t.containerId);
    if (!color) continue;
    t.strokeColor = color;
    t.customData = { ...(t.customData ?? {}), wbTextColor: color };
  }
  return els;
}

/** 現在のビューポート中心（scene座標）。WhiteboardToolbar / MermaidToolButton と同じ算出。 */
export function viewportCenter(api: any): { cx: number; cy: number } {
  const st = api.getAppState();
  const zoom = st.zoom?.value ?? 1;
  return {
    cx: (st.width ?? 800) / 2 / zoom - st.scrollX,
    cy: (st.height ?? 600) / 2 / zoom - st.scrollY,
  };
}

/** rows×cols の空の表をビューポート中央に生成して選択する（ツールバーの「表」ボタン用）。 */
export function insertTableAtCenter(api: any, rows: number, cols: number): void {
  if (!api || rows < 1 || cols < 1) return;
  const { cx, cy } = viewportCenter(api);
  const els = createTableElements({
    x: cx - (cols * WB_CELL_W) / 2,
    y: cy - (rows * WB_CELL_H) / 2,
    rows,
    cols,
  });
  if (!els.length) return;
  // 生成を undo 履歴の1ステップとして記録（IMMEDIATELY）。MermaidToolButton と同方針。
  api.updateScene({ elements: [...api.getSceneElements(), ...els], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  // 生成直後は表全体を選択（選択のみは履歴に残さない・NEVER）
  const ids: Record<string, boolean> = {};
  els.forEach((e) => { if (e?.id) ids[e.id] = true; });
  api.updateScene({ appState: { selectedElementIds: ids }, captureUpdate: CaptureUpdateAction.NEVER });
}
