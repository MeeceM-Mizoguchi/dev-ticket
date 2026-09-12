// タスク表の列幅と表示モード。
//
// 見出し・追加行（TaskQuickAddRow）・データ行（TaskListView）の3者が同じ幅を使う（縦を揃えるため）。
// 行ごとに props で幅を配ると渡し漏れで縦がずれるので、Context で1か所から配る。
//
// モードは2つあり、組み合わせられる（BRU15-005）。
//   列幅を広げる … 全列を px の固定幅にして、表の中だけ横にスクロールさせる。
//                  オンにした瞬間は中身の最長の文字数ぶんまで広げ、あとは見出しの境目を
//                  ドラッグして変えられる。タイトル列（行頭の完了トグル・開閉を含む）は左に固定。
//   折り返し表示 … 列幅に収まらない中身を「…」で切らずに折り返して、行の高さを伸ばす。
//                  広げるモードと一緒に使うと「広げた幅で、それでも余る分だけ折り返す」になる。
//
// 縦の罫線は taskColRuleOffsets が返す位置に、見出しと本体それぞれ1枚ずつ敷いて引く
// （セルごとに線を持たせると、見出しと本体で1pxずつずれたり二重線になったりするため）。
import { createContext, useContext } from "react";

/** 見出し・データ行・追加行で共有する列幅（通常モード） */
export const TASK_COLS = {
  toggle: 18,
  expand: 14,
  category: 150,
  priority: 48,
  project: 132,
  assignee: 112,
  /** 起票者（BRU11-040）。作った人は変えられないので読むだけの列 */
  creator: 96,
  start: 106,
  due: 106,
  progress: 52,
  status: 86,
  /** 行末の共有ボタン。追加行・見出しでは空けておく */
  share: 26,
  /** 行末の削除ボタン。追加行・見出しでは空けておく */
  menu: 20,
  gap: 10,
  padX: 14,
  /** 行の上下の余白。固定列の罫線を行の高さいっぱいに伸ばすのに使う */
  padY: 8,
};

/**
 * タイトルと詳細は幅を固定せず、余った横幅を分け合う（通常モード）。
 * 詳細のほうが長い文章が入るので、タイトルより広く取る（1 : 1.6）。
 */
export const TITLE_CELL: React.CSSProperties = { flex: "1 1 0", minWidth: 0 };
export const DESC_CELL: React.CSSProperties = { flex: "1.6 1 0", minWidth: 0 };

/** 幅を変えられる列 */
export type TaskColKey =
  | "title" | "desc" | "category" | "project" | "priority" | "assignee"
  | "creator" | "start" | "due" | "progress" | "status";

export type TaskColWidths = Record<TaskColKey, number>;

/** タイトルより右の列の並び（罫線の位置と見出しの順番はこれに従う） */
export const TASK_COL_ORDER_AFTER_TITLE: TaskColKey[] = [
  "desc", "category", "project", "priority", "assignee", "creator", "start", "due", "progress", "status",
];

export const TASK_COL_LABELS: Record<TaskColKey, string> = {
  title: "タイトル", desc: "詳細", category: "分類", project: "プロジェクト",
  priority: "優先度", assignee: "担当者", creator: "起票者",
  start: "開始日", due: "期限", progress: "進捗率", status: "ステータス",
};

/**
 * 広げるモードの初期値。自動調整はここより狭くしない（「広げる」モードなので）。
 * タイトル・詳細以外は通常モードと同じ幅から始める。
 */
export const DEFAULT_COL_WIDTHS: TaskColWidths = {
  title: 280, desc: 420,
  category: TASK_COLS.category, project: TASK_COLS.project, priority: TASK_COLS.priority,
  assignee: TASK_COLS.assignee, creator: TASK_COLS.creator,
  start: TASK_COLS.start, due: TASK_COLS.due, progress: TASK_COLS.progress, status: TASK_COLS.status,
};

/** ドラッグで縮められる下限。日付・進捗率・ステータスは中身が潰れない幅を残す */
export const MIN_COL_WIDTHS: TaskColWidths = {
  title: 120, desc: 80, category: 60, project: 60, priority: 40, assignee: 60,
  creator: 50, start: 92, due: 92, progress: 44, status: 76,
};

/** 自動調整の上限。長文の詳細が1件あるだけで表が数千pxになるのを防ぐ（ドラッグならそれ以上も可） */
export const MAX_AUTO_COL_WIDTH = 960;

/** 行頭の固定部分（完了トグル＋開閉とその間隔）。タイトル列と一緒に左へ固定する */
export const LEAD_FIXED_W = TASK_COLS.toggle + TASK_COLS.gap + TASK_COLS.expand + TASK_COLS.gap;

/** 縦罫線の色。1pxの実線1本だけを引く（線を足すときは必ずここを使う） */
export const TASK_RULE_COLOR = "rgba(26,23,20,0.08)";

interface TaskColLayout { wide: boolean; wrap: boolean; widths: TaskColWidths }

const TaskColLayoutContext = createContext<TaskColLayout>({ wide: false, wrap: false, widths: DEFAULT_COL_WIDTHS });

export const TaskColLayoutProvider = TaskColLayoutContext.Provider;

/** 保存してあった列幅を読み戻す。壊れた値・欠けた列は初期値で埋める */
export function sanitizeColWidths(raw: unknown): TaskColWidths {
  const out: TaskColWidths = { ...DEFAULT_COL_WIDTHS };
  if (!raw || typeof raw !== "object") return out;
  for (const k of Object.keys(DEFAULT_COL_WIDTHS) as TaskColKey[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = Math.max(MIN_COL_WIDTHS[k], Math.round(v));
  }
  return out;
}

/**
 * 広げるモードの縦罫線を引く位置（行の左端からの px）。見出しも本体も同じ値を使うので、
 * 「見出しの線と本体の線が数pxずれる」が起きない。
 *
 * 線は各列の右端ちょうどに引く（列と列の間の余白は次の列のものとして扱う）。
 * タイトル列の右端だけは、左に固定した列の影が引くのでここには含めない
 * （同じ位置に2本引くと二重線になる）。
 * 最後のステータスの右も引かない（その先は共有・削除ボタンの場所で、見出しが無いため）。
 */
export function taskColRuleOffsets(widths: TaskColWidths, showProject: boolean): number[] {
  const keys = TASK_COL_ORDER_AFTER_TITLE.filter(k => k !== "project" || showProject);
  let x = TASK_COLS.padX + LEAD_FIXED_W + widths.title;
  const out: number[] = [];
  keys.forEach((k, i) => {
    x += TASK_COLS.gap + widths[k];
    if (i < keys.length - 1) out.push(x);
  });
  return out;
}

/**
 * いまのモードでの列幅と見た目を返す。
 *   w(k)     … その列の px 幅（通常モードのタイトル・詳細は伸び縮みするので参考値）
 *   cell(k)  … その列のセルに当てる幅のスタイル
 *   clamp    … 1行で切るか、折り返すか（折り返し表示モードで切り替わる）
 *   lead(bg) … 行頭（完了トグル＋開閉＋タイトル）をまとめる器のスタイル。
 *              広げるモードではここを左に固定するので、下を流れる列が透けないよう背景を塗り、
 *              行の上下の余白まで覆って右端の罫線が途切れないようにする
 */
export function useTaskCols() {
  const { wide, wrap, widths } = useContext(TaskColLayoutContext);

  const w = (k: TaskColKey): number => (wide ? widths[k] : k === "title" || k === "desc" ? DEFAULT_COL_WIDTHS[k] : TASK_COLS[k]);

  const cell = (k: TaskColKey): React.CSSProperties => {
    if (!wide && k === "title") return TITLE_CELL;
    if (!wide && k === "desc") return DESC_CELL;
    return { width: w(k), flexShrink: 0, minWidth: 0 };
  };

  /** 収まらない文字の扱い。折り返し表示では「…」で切らずに全部見せる */
  const clamp: React.CSSProperties = wrap
    ? { whiteSpace: "normal", overflow: "visible", overflowWrap: "anywhere" }
    : { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

  const lead = (bg: string): React.CSSProperties => (wide
    ? {
      display: "flex", alignItems: wrap ? "flex-start" : "center", gap: TASK_COLS.gap, flexShrink: 0,
      boxSizing: "border-box",
      width: TASK_COLS.padX + LEAD_FIXED_W + widths.title,
      // 行の左 padding ぶんまで覆う（そこを横スクロールした列が透けて見えないように）
      marginLeft: -TASK_COLS.padX, paddingLeft: TASK_COLS.padX,
      // 上下も行の padding まで伸ばす。ここを content だけにすると、右端の罫線が
      // 行ごとに途切れて破線のように見えてしまう
      marginTop: -TASK_COLS.padY, marginBottom: -TASK_COLS.padY,
      paddingTop: TASK_COLS.padY, paddingBottom: TASK_COLS.padY,
      alignSelf: "stretch",
      position: "sticky", left: 0, zIndex: 2,
      background: bg,
      boxShadow: `1px 0 0 ${TASK_RULE_COLOR}`,
    }
    : {
      // 通常モードは器の中の固定部分を basis に含めて、これまでと同じ割り振りにする
      // （タイトルの取り分 = 余った幅 × 1/2.6 のまま）。
      // 画面が狭くても完了トグル・開閉は潰さない（縮むのはタイトルだけ＝これまでと同じ）
      display: "flex", alignItems: wrap ? "flex-start" : "center", gap: TASK_COLS.gap,
      flex: `1 1 ${LEAD_FIXED_W}px`, minWidth: LEAD_FIXED_W,
    });

  return { wide, wrap, widths, w, cell, clamp, lead };
}
