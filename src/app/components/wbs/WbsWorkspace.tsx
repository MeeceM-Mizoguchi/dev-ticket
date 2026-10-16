// ENHA2-053 WBS 1つぶんの作業領域（行の読み込みと、追加・編集・並べ替え・削除）。
//
// WbsPage がWBSの切り替えと枠を受け持ち、ここは選ばれた1つのWBSの中身を受け持つ。
// WBSを切り替えたら key で作り直すので、前のWBSの行や選択を持ち越さない。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Tags, CalendarOff, Download, Upload, FilterX, Maximize2, Minimize2 } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { computeSortOrder } from "@/app/lib/taskService";
import {
  WBS_SORT_GAP, addWbsItemTickets, createWbsItem, deleteWbsItems, loadWbsHolidays, loadWbsItemTickets, loadWbsItems,
  loadWbsStatuses, removeWbsItemTickets, renumberWbsItems, updateWbsItem,
} from "@/app/lib/wbsService";
import { buildWbsGantt, buildWbsRows, siblingsOf, todayStr } from "@/app/lib/wbsCalc";
import type { Project, WbsHoliday, WbsItem, WbsSheet, WbsStatus } from "@/app/types";
import { WbsSummary } from "./WbsSummary";
import { WbsStatusDialog } from "./WbsStatusDialog";
import { WbsHolidayDialog } from "./WbsHolidayDialog";
import { WbsImportDialog } from "./WbsImportDialog";
import { downloadBlob, safeFileName } from "@/app/lib/articleExport/download";
import { exportWbsXlsx } from "@/app/lib/wbsExcel";
import { WbsTicketLinkDialog, type WbsTicketRef } from "./WbsTicketLinkDialog";
import { WbsTicketCell } from "./WbsTicketCell";
import { FOCUS_PULSE_MS, WbsTable, type WbsColKey, type WbsDropMode, type WbsEditing } from "./WbsTable";
import { filterWbsRows, wbsFilterOptions, type WbsFilterCol, type WbsFilterCtx, type WbsFilters } from "./wbsFilter";
import { WbsAttentionDialog, collectWbsAttention, isWbsAttentionDismissed } from "./WbsAttentionDialog";
import { wbsToolBtn, wbsToolBtnDisabled } from "./wbsStyles";

/** 列固定の位置は、WBSごと・利用者ごとにブラウザへ保存する */
function freezeStorageKey(userId: string, sheetId: string) { return `devticket:wbs:freeze:${userId}:${sheetId}`; }

function readFreeze(userId: string, sheetId: string): WbsColKey {
  try {
    const v = localStorage.getItem(freezeStorageKey(userId, sheetId));
    if (v) return v as WbsColKey;
  } catch { /* 保存領域が使えない環境では既定値で動かす */ }
  return "note";
}

/** 列の並びも、WBSごと・利用者ごとにブラウザへ保存する（BRU20-011） */
function colOrderStorageKey(userId: string, sheetId: string) { return `devticket:wbs:colorder:${userId}:${sheetId}`; }

function readColOrder(userId: string, sheetId: string): WbsColKey[] {
  try {
    const raw = localStorage.getItem(colOrderStorageKey(userId, sheetId));
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(v)) return v.filter((k): k is WbsColKey => typeof k === "string");
  } catch { /* 保存領域が使えない・壊れているときは、定義どおりの並びで動かす */ }
  return [];
}

export function WbsWorkspace({ sheet, project, canEdit, tickets, onOpenTicket, highlightIds, onHighlightChange, focusItemId = null, onFocusDone }: {
  sheet: WbsSheet;
  project: Project;
  canEdit: boolean;
  /** そのプロジェクトのチケット（スプリントをまたいだ全件）。紐づけの候補とチップの表示に使う */
  tickets: WbsTicketRef[];
  /** チップを押したとき。WBS画面のままチケット詳細パネルを開く */
  onOpenTicket: (ticketId: string) => void;
  /** 段数を減らせない理由になっている行 */
  highlightIds: string[];
  onHighlightChange: (ids: string[]) => void;
  /** マスタースケジュールの行を押して来たときの行。最初の読み込みのあと、その行へ移動して強調する */
  focusItemId?: string | null;
  /** focusItemId の行を強調し終えたとき */
  onFocusDone?: () => void;
}) {
  const { userId } = useAuth();
  const { toast } = useToast();

  const [items, setItems] = useState<WbsItem[]>([]);
  const [statuses, setStatuses] = useState<WbsStatus[]>([]);
  const [holidays, setHolidays] = useState<WbsHoliday[]>([]);
  // 行の id → 紐づいたチケットの id
  const [links, setLinks] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  // 一度でもデータを読んだら、以後は再読み込みでスピナーに差し替えない（画面のちらつき防止）
  const initializedRef = useRef(false);

  // チェックを付けた行。行を選ぶ手段は、表の左端のチェックボックスだけ
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<WbsEditing | null>(null);
  const [scrollTo, setScrollTo] = useState<{ id: string; nonce: number } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const [freezeKey, setFreezeKey] = useState<WbsColKey>(() => readFreeze(userId, sheet.id));
  // 列の並び（チェックボックスの列を除く）。空なら定義順。無い列・増えた列の扱いは orderWbsColumns
  const [colOrder, setColOrder] = useState<WbsColKey[]>(() => readColOrder(userId, sheet.id));
  // 追加の連打で同じ行を2つ作らないためのガード
  const addingRef = useRef(false);
  // 列ごとの絞り込み。保存しない（WBSを切り替えると key で作り直されるので、そこで解除される）
  const [filters, setFilters] = useState<WbsFilters>({});
  // 開いたときのお知らせ（遅延・未着手）。出すかの判定は最初の読み込みのあと1回だけ
  const [attentionOpen, setAttentionOpen] = useState(false);
  const attentionCheckedRef = useRef(false);
  // お知らせから移動した行（薄い黄色）。6秒で消す
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current); }, []);

  // 横スクロールを、ブラウザの「戻る／進む」に化けさせない。
  // 左の表は横に動かないので、その上で横に送ると操作がブラウザまで抜けて、
  // ページを戻る／進むジェスチャーになってしまう。この領域の横スクロールはここで受け止め、
  // 代わりに右の枠（ガント）を横に送る。集計の件数の部分だけは、自分で横に動くので任せる。
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!rootEl) return;
    const onWheel = (e: WheelEvent) => {
      // 縦が主の操作・拡大縮小（Ctrl+ホイール）には手を出さない
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if ((e.target as HTMLElement | null)?.closest?.("[data-wbs-hscroll]")) return;
      e.preventDefault();
      const pane = rootEl.querySelector<HTMLElement>("[data-wbs-hpane]");
      // deltaMode 1 は「行」単位。px に直してから送る
      if (pane) pane.scrollLeft += e.deltaMode === 1 ? e.deltaX * 40 : e.deltaX;
    };
    // preventDefault するので passive: false が必須（React の onWheel は passive で登録される）
    rootEl.addEventListener("wheel", onWheel, { passive: false });
    return () => rootEl.removeEventListener("wheel", onWheel);
  }, [rootEl]);

  // ── 全画面 ──────────────────────────────────────────────────
  // ブラウザの全画面はページ全体（document.documentElement）にかけ、WBSの部分はアプリの中で
  // 画面いっぱいに広げる（position:fixed）。WBSの要素そのものを全画面にすると、その外（document.body）へ
  // 出しているプルダウン・日付の選択・ダイアログが表示されなくなるため。
  const [fullscreen, setFullscreen] = useState(false);
  const fullscreenRef = useRef(false);
  const enterFullscreen = () => {
    fullscreenRef.current = true;
    setFullscreen(true);
    // ブラウザが全画面を許さないときも、画面いっぱいの表示だけは行う
    document.documentElement.requestFullscreen?.().catch(() => { });
  };
  const exitFullscreen = useCallback(() => {
    fullscreenRef.current = false;
    setFullscreen(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    // Esc などでブラウザの全画面が終わったら、画面いっぱいの表示も戻す
    const onChange = () => { if (!document.fullscreenElement) exitFullscreen(); };
    // ブラウザの全画面になれなかったときは Esc がブラウザに使われないので、ここで受ける
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented && !document.fullscreenElement) exitFullscreen();
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, [fullscreen, exitFullscreen]);
  // 全画面のまま画面を離れたら、ブラウザの全画面も終える
  useEffect(() => () => {
    if (fullscreenRef.current && document.fullscreenElement) document.exitFullscreen().catch(() => { });
  }, []);

  const load = useCallback(async () => {
    const [its, sts, hols, lks] = await Promise.all([
      loadWbsItems(sheet.id), loadWbsStatuses(sheet.id), loadWbsHolidays(project.id, sheet.id), loadWbsItemTickets(sheet.id),
    ]);
    setItems(its);
    setStatuses(sts);
    setHolidays(hols);
    setLinks(lks);
    initializedRef.current = true;
    setLoading(false);
  }, [sheet.id, project.id]);

  const reloadHolidays = useCallback(async () => { setHolidays(await loadWbsHolidays(project.id, sheet.id)); }, [project.id, sheet.id]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const today = todayStr();
  const rows = useMemo(() => buildWbsRows(items, sheet.levels, today, statuses), [items, sheet.levels, today, statuses]);
  // 休日は「日付 → 休日名」。予定日数とガントの両方で、土日と同じく稼働日から除く
  const holidayNames = useMemo(() => new Map(holidays.map(h => [h.date, h.name])), [holidays]);
  const holidaySet = useMemo(() => new Set(holidays.map(h => h.date)), [holidays]);
  const gantt = useMemo(() => buildWbsGantt(rows, holidayNames, today), [rows, holidayNames, today]);
  const highlightSet = useMemo(() => new Set(highlightIds), [highlightIds]);

  // 強調している行が消えたら、強調の一覧からも外す（全部消えたら案内も消える）
  useEffect(() => {
    if (!initializedRef.current || highlightIds.length === 0) return;
    const alive = new Set(items.map(i => i.id));
    const rest = highlightIds.filter(id => alive.has(id));
    if (rest.length !== highlightIds.length) onHighlightChange(rest);
  }, [items, highlightIds, onHighlightChange]);

  // 「対象の行を確認する」を押したら、最初の対象行まで表をスクロールする
  const highlightKey = highlightIds.join(",");
  useEffect(() => {
    if (!highlightKey) return;
    const first = rows.find(r => highlightSet.has(r.item.id));
    if (first) setScrollTo({ id: first.item.id, nonce: Date.now() });
  }, [highlightKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 開いたときのお知らせ ────────────────────────────────────
  const attention = useMemo(() => collectWbsAttention(rows, today), [rows, today]);

  // 最初の読み込みが終わったら1回だけ判定する。編集後の読み直しでは出さない。
  // WBSを切り替えたときは key で作り直されるので、そのWBSで判定し直しになる
  useEffect(() => {
    if (!initializedRef.current || attentionCheckedRef.current) return;
    attentionCheckedRef.current = true;
    // マスタースケジュールから行を指定して来たときは出さない（強調した行がお知らせに隠れるので）
    if (focusItemId) return;
    if (attention.delayed.length + attention.notStarted.length === 0) return;
    if (isWbsAttentionDismissed(userId, sheet.id, today)) return;
    setAttentionOpen(true);
  }, [attention]); // eslint-disable-line react-hooks/exhaustive-deps

  /** お知らせの行を押した。その行へスクロールし、6秒だけ黄色にする */
  const handleJump = (itemId: string) => {
    setFlashId(itemId);
    setScrollTo({ id: itemId, nonce: Date.now() });
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => { flashTimerRef.current = null; setFlashId(null); }, 6000);
  };

  // マスタースケジュールの行を押して来たとき。最初の読み込みのあと1回だけ、その大項目まで表を送り、
  // 大項目から下の行のまとまり全体を黄色く光らせる（約3秒で消える）。消された行なら何もしない
  const [focusGroupId, setFocusGroupId] = useState<string | null>(null);
  const focusDoneRef = useRef(false);
  const focusTimerRef = useRef<number | null>(null);
  useEffect(() => () => { if (focusTimerRef.current !== null) window.clearTimeout(focusTimerRef.current); }, []);
  useEffect(() => {
    if (!initializedRef.current || focusDoneRef.current || !focusItemId) return;
    focusDoneRef.current = true;
    if (items.some(i => i.id === focusItemId)) {
      setFocusGroupId(focusItemId);
      setScrollTo({ id: focusItemId, nonce: Date.now() });
      focusTimerRef.current = window.setTimeout(() => { focusTimerRef.current = null; setFocusGroupId(null); }, FOCUS_PULSE_MS);
    }
    onFocusDone?.();
  }, [items, focusItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeFreeze = (key: WbsColKey) => {
    setFreezeKey(key);
    try { localStorage.setItem(freezeStorageKey(userId, sheet.id), key); } catch { /* 保存できなくても表示は切り替える */ }
  };

  const changeColOrder = (order: WbsColKey[], freeze: WbsColKey) => {
    setColOrder(order);
    try { localStorage.setItem(colOrderStorageKey(userId, sheet.id), JSON.stringify(order)); } catch { /* 保存できなくても表示は切り替える */ }
    // 固定の線は「左から何列目まで」を保つ。並べ替えでその位置に来た列を、固定の線の列に付け直す
    if (freeze !== freezeKey) changeFreeze(freeze);
  };

  // ── チケットの紐づけ ────────────────────────────────────────
  const ticketById = useMemo(() => new Map(tickets.map(t => [t.ticket.id, t])), [tickets]);

  /**
   * その行に紐づいたチケット。削除されたチケットは一覧に無いので、ここで自然に落ちる
   * （DB 側の紐づけも on delete cascade で消えている）。
   */
  const linkedTicketsOf = useCallback((itemId: string): WbsTicketRef[] =>
    (links.get(itemId) ?? []).map(id => ticketById.get(id)).filter((t): t is WbsTicketRef => !!t),
  [links, ticketById]);

  const linkTarget = rows.find(r => r.item.id === linkTargetId) ?? null;

  const handleLinkSubmit = async (addIds: string[], removeIds: string[]): Promise<boolean> => {
    if (!linkTarget) return false;
    const itemId = linkTarget.item.id;
    const [okAdd, okRemove] = await Promise.all([addWbsItemTickets(itemId, addIds), removeWbsItemTickets(itemId, removeIds)]);
    // 片方だけ通った場合もあるので、成否に関わらず DB の状態を読み直して合わせる
    setLinks(await loadWbsItemTickets(sheet.id));
    return okAdd && okRemove;
  };

  // ── 列ごとの絞り込み ────────────────────────────────────────
  // 集計とエクスポートは絞り込みに関係なく WBS 全体（rows）のまま
  const filterCtx = useMemo<WbsFilterCtx>(() => ({
    statuses, members: project.members, holidays: holidaySet,
    ticketNumbersOf: id => linkedTicketsOf(id).map(t => t.ticket.wbs),
  }), [statuses, project.members, holidaySet, linkedTicketsOf]);
  const filterOptions = useMemo(() => wbsFilterOptions(rows, filterCtx), [rows, filterCtx]);
  const shownIds = useMemo(() => filterWbsRows(rows, filters, filterCtx), [rows, filters, filterCtx]);
  const changeFilter = useCallback((col: WbsFilterCol, selected: Set<string>) => {
    setFilters(prev => ({ ...prev, [col]: selected }));
  }, []);

  const renderTickets = useCallback((row: (typeof rows)[number]) => (
    <WbsTicketCell tickets={linkedTicketsOf(row.item.id)} canEdit={canEdit}
      onOpen={onOpenTicket} onAdd={() => setLinkTargetId(row.item.id)} />
  ), [linkedTicketsOf, canEdit, onOpenTicket]);

  // ── エクスポート・インポート ────────────────────────────────
  /** いま画面に出ているWBSを Excel にして保存する（左に表、右にガント） */
  const handleExport = async () => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const blob = await exportWbsXlsx({
        sheetName: sheet.name, rows, statuses, gantt, holidays: holidaySet,
        ticketNumbersOf: id => linkedTicketsOf(id).map(t => t.ticket.wbs),
      });
      downloadBlob(blob, safeFileName(`WBS_${sheet.name}`, today.replace(/-/g, ""), "xlsx"));
    } catch (e) {
      console.error("[wbs] export failed:", e);
      toast("エクスポートできませんでした", "error");
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  const ticketIdByNumber = useMemo(() => new Map(tickets.map(t => [t.ticket.wbs, t.ticket.id])), [tickets]);

  // ── 編集 ────────────────────────────────────────────────────
  const handleUpdate = useCallback((id: string, patch: Partial<WbsItem>) => {
    // 先に画面へ反映してから保存する。失敗したら読み直して元へ戻す
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    updateWbsItem(id, patch).then(ok => {
      if (!ok) { toast("保存できませんでした", "error"); load().catch(() => { }); }
    });
  }, [load, toast]);

  // ── 追加 ────────────────────────────────────────────────────
  // 行の追加は、表の行の境目のボタン（handleInsert）か、いちばん下の空の行（handleAddNew）から来る。

  /** 同じ親の末尾に積むための値 */
  const tailOrder = (parentId: string | null) => {
    const sibs = siblingsOf(items, parentId);
    return sibs.length ? sibs[sibs.length - 1].sortOrder + WBS_SORT_GAP : 0;
  };

  const addItem = async (parentId: string | null, level: number, name: string): Promise<boolean> => {
    if (addingRef.current) return false;
    addingRef.current = true;
    try {
      // 新しい行の初期値は先頭のステータス（既定では「未着手」）
      const created = await createWbsItem({
        sheetId: sheet.id, parentId, level, name, statusId: statuses[0]?.id ?? null, sortOrder: tailOrder(parentId),
      });
      if (!created) { toast("行を追加できませんでした", "error"); return false; }
      setItems(prev => [...prev, created]);
      // 足した行は選択しない。入力は空の行で続いているので、選択まで移すと
      // 「行を削除」の対象が、いま打っている場所と食い違う
      setScrollTo({ id: created.id, nonce: Date.now() });
      return true;
    } finally {
      addingRef.current = false;
    }
  };

  /**
   * 行の境目のボタンを押した。afterId の行のすぐ下（null なら先頭）に、level の段の行を足し、
   * そのまま名前を入力できる状態にする。足した行が、押した境目の位置に現れるように親と並び順を決める:
   *   ・1つ下の段   … afterId の行の最初の子にする
   *   ・同じ段・上の段 … afterId の行が属している、その段の行のすぐ後ろに入れる
   */
  const handleInsert = async (afterId: string | null, level: number) => {
    if (addingRef.current || level > sheet.levels) return;
    let parentId: string | null = null;
    let order: number | null;
    const after = afterId ? items.find(i => i.id === afterId) : undefined;
    if (!after) {
      // 先頭に入れる（大項目）
      const tops = siblingsOf(items, null);
      order = tops.length ? tops[0].sortOrder - WBS_SORT_GAP : 0;
    } else if (level === after.level + 1) {
      parentId = after.id;
      const kids = siblingsOf(items, after.id);
      order = kids.length ? kids[0].sortOrder - WBS_SORT_GAP : 0;
    } else {
      // afterId の行から上へたどって、足す段と同じ段の行（anchor）を探す。その後ろに入れる
      let anchor: WbsItem | undefined = after;
      while (anchor && anchor.level > level) {
        const pid: string | null = anchor.parentId;
        anchor = pid ? items.find(i => i.id === pid) : undefined;
      }
      if (!anchor || anchor.level !== level) return;
      parentId = anchor.parentId;
      const sibs = siblingsOf(items, parentId);
      const idx = sibs.findIndex(x => x.id === anchor!.id);
      order = computeSortOrder(anchor.sortOrder, sibs[idx + 1]?.sortOrder ?? null);
      if (order === null) {
        // 中点が潰れていたら、同じ親の行を振り直してから間に入れる
        await renumberWbsItems(sibs.map(x => x.id));
        setItems(prev => prev.map(p => {
          const i = sibs.findIndex(x => x.id === p.id);
          return i < 0 ? p : { ...p, sortOrder: i * WBS_SORT_GAP };
        }));
        order = idx * WBS_SORT_GAP + WBS_SORT_GAP / 2;
      }
    }

    addingRef.current = true;
    try {
      // 新しい行の初期値は先頭のステータス（既定では「未着手」）
      const created = await createWbsItem({ sheetId: sheet.id, parentId, level, name: "", statusId: statuses[0]?.id ?? null, sortOrder: order });
      if (!created) { toast("行を追加できませんでした", "error"); return; }
      setItems(prev => [...prev, created]);
      // 足した行で、そのまま名前を打てるようにする
      setEditing({ id: created.id, field: "name" });
      setScrollTo({ id: created.id, nonce: Date.now() });
    } finally {
      addingRef.current = false;
    }
  };

  /** いちばん下の空の行に入力した。新しい大項目を末尾に足す */
  const handleAddNew = (name: string) => { addItem(null, 1, name); };

  // ── 並べ替え ────────────────────────────────────────────────
  const handleMove = useCallback(async (dragId: string, targetId: string, mode: WbsDropMode) => {
    const drag = items.find(i => i.id === dragId);
    const target = items.find(i => i.id === targetId);
    if (!drag || !target) return;

    let parentId: string | null;
    let order: number | null;
    if (mode === "into") {
      parentId = target.id;
      const sibs = siblingsOf(items, parentId).filter(s => s.id !== dragId);
      order = sibs.length ? sibs[sibs.length - 1].sortOrder + WBS_SORT_GAP : 0;
    } else {
      parentId = target.parentId;
      let sibs = siblingsOf(items, parentId).filter(s => s.id !== dragId);
      const idx = sibs.findIndex(s => s.id === targetId);
      const prev = mode === "before" ? sibs[idx - 1] : sibs[idx];
      const next = mode === "before" ? sibs[idx] : sibs[idx + 1];
      order = computeSortOrder(prev?.sortOrder ?? null, next?.sortOrder ?? null);
      if (order === null) {
        // 中点が潰れていたら、落とした後の並びで振り直す
        const at = mode === "before" ? idx : idx + 1;
        sibs = [...sibs.slice(0, at), drag, ...sibs.slice(at)];
        const ids = sibs.map(s => s.id);
        setItems(prevItems => prevItems.map(p => {
          const i = ids.indexOf(p.id);
          return i < 0 ? p : { ...p, parentId, sortOrder: i * WBS_SORT_GAP };
        }));
        const okParent = await updateWbsItem(dragId, { parentId });
        const okOrder = await renumberWbsItems(ids);
        if (!okParent || !okOrder) { toast("並べ替えを保存できませんでした", "error"); load().catch(() => { }); }
        return;
      }
    }
    if (parentId === drag.parentId && order === drag.sortOrder) return;
    handleUpdate(dragId, { parentId, sortOrder: order });
  }, [items, handleUpdate, load, toast]);

  // ── 行の選択（チェックボックス） ────────────────────────────
  /** その行の下にある行すべて */
  const descendantsOf = useCallback((id: string): string[] => {
    const out: string[] = [];
    const walk = (pid: string) => {
      for (const i of items) if (i.parentId === pid) { out.push(i.id); walk(i.id); }
    };
    walk(id);
    return out;
  }, [items]);

  /**
   * チェックを付け外しする。
   *   付ける … 下にある行にも付ける（見出し行を消すと下の行も一緒に消えるので、消える範囲がそのまま見える）
   *   外す   … 下にある行と、上の見出し行からも外す（下の行を残したいのに、上の行のチェックで一緒に消えないように）
   */
  const toggleCheck = useCallback((id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      const family = [id, ...descendantsOf(id)];
      if (prev.has(id)) {
        family.forEach(x => next.delete(x));
        for (let p = items.find(i => i.id === id)?.parentId; p; p = items.find(i => i.id === p)?.parentId) next.delete(p);
      } else {
        family.forEach(x => next.add(x));
      }
      return next;
    });
  }, [items, descendantsOf]);

  /**
   * 見出しのチェックボックスで選ぶ行。絞り込み中は見えている行だけにする。
   * 見えている見出し行でも、下に隠れた行があるものは選ばない
   * （見出し行を消すと下の行も一緒に消えるので、隠れた行まで「行を削除」の対象になってしまう）。
   */
  const toggleAllTargets = useMemo(() => {
    if (!shownIds) return items.map(i => i.id);
    return items.filter(i => shownIds.has(i.id) && descendantsOf(i.id).every(d => shownIds.has(d))).map(i => i.id);
  }, [items, shownIds, descendantsOf]);
  const allCheckState = toggleAllTargets.length > 0 && toggleAllTargets.every(id => checkedIds.has(id)) ? "on"
    : toggleAllTargets.some(id => checkedIds.has(id)) ? "some" : "off";

  const toggleAll = useCallback(() => {
    setCheckedIds(prev => (toggleAllTargets.length > 0 && toggleAllTargets.every(id => prev.has(id)) ? new Set() : new Set(toggleAllTargets)));
  }, [toggleAllTargets]);

  // 消えた行（削除・読み直し・置き換えインポート）のチェックは捨てる
  useEffect(() => {
    setCheckedIds(prev => {
      if (prev.size === 0) return prev;
      const alive = new Set(items.map(i => i.id));
      const next = new Set([...prev].filter(id => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [items]);

  // ── 削除 ────────────────────────────────────────────────────
  /** チェックを付けた行をまとめて消す */
  const handleDelete = async () => {
    if (checkedIds.size === 0) return;
    // 上の行にもチェックがある行は、上の行と一緒に消えるので送らない
    const byId = new Map(items.map(i => [i.id, i]));
    const tops = [...checkedIds].filter(id => {
      const pid = byId.get(id)?.parentId;
      return !pid || !checkedIds.has(pid);
    });
    const ok = await deleteWbsItems(tops);
    if (!ok) { toast("行を削除できませんでした", "error"); load().catch(() => { }); return; }
    // 下の行は DB 側で一緒に消える。画面からも同じ範囲を外す
    const gone = new Set(tops.flatMap(id => [id, ...descendantsOf(id)]));
    setItems(prev => prev.filter(i => !gone.has(i.id)));
    setCheckedIds(new Set());
  };

  if (loading && !initializedRef.current) return <PageLoader label="WBSを読み込み中..." />;

  return (
    <div ref={setRootEl} style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0,
      // 全画面中は画面いっぱいに広げる。重なり順はダイアログとチケット詳細のパネル（300）より下
      ...(fullscreen ? { position: "fixed", inset: 0, zIndex: 250, background: "#FFFFFF" } : null) }}>
      <WbsSummary rows={rows} statuses={statuses} gantt={gantt} />

      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #E2E6EC", flexWrap: "wrap" }}>
        {canEdit && (
          <>
            <button type="button" onClick={() => setDeleteOpen(true)} disabled={checkedIds.size === 0}
              title={checkedIds.size > 0 ? "チェックを付けた行を削除します" : "削除したい行の左のチェックボックスにチェックを付けると使えます"}
              style={checkedIds.size > 0 ? { ...wbsToolBtn, color: "#DC2626" } : wbsToolBtnDisabled}>
              {/* 何行が消えるのかを、押す前にボタンの上で分かるようにする */}
              <Trash2 style={{ width: 12, height: 12 }} />{checkedIds.size > 0 ? `選択した ${checkedIds.size} 行を削除` : "行を削除"}
            </button>
            <span style={{ fontSize: 11, color: "#A09790" }}>行と行の間にマウスを乗せると、その位置に行を追加できます。大項目・中項目の行は、左の三角で開閉できます</span>
          </>
        )}

        {shownIds && (
          <>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#059669", whiteSpace: "nowrap" }}>絞り込み中：{shownIds.size} / {rows.length} 行</span>
            <button type="button" onClick={() => setFilters({})} title="列ごとの絞り込みをすべて解除して、全部の行を表示します" style={wbsToolBtn}>
              <FilterX style={{ width: 12, height: 12 }} />絞り込みを解除
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />
        {canEdit && (
          <button type="button" onClick={() => setImportOpen(true)} title="Excel・CSV で作った行を、このWBSにまとめて取り込みます（テンプレートもここから）" style={wbsToolBtn}>
            <Upload style={{ width: 12, height: 12 }} />インポート
          </button>
        )}
        <button type="button" onClick={handleExport} disabled={exporting} title="このWBSを Excel ファイルにして保存します" style={exporting ? wbsToolBtnDisabled : wbsToolBtn}>
          <Download style={{ width: 12, height: 12 }} />{exporting ? "作成中..." : "エクスポート"}
        </button>
        {canEdit && (
          <button type="button" onClick={() => setStatusOpen(true)} title="このWBSのステータスを追加・削除・変更します" style={wbsToolBtn}>
            <Tags style={{ width: 12, height: 12 }} />ステータス設定
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={() => setHolidayOpen(true)} title="土日のほかに休みにする日を登録します（全WBSに適用するか、このWBSだけかを選べます）" style={wbsToolBtn}>
            <CalendarOff style={{ width: 12, height: 12 }} />休日設定
          </button>
        )}
        {/* 閲覧のみの人にも出す */}
        <button type="button" onClick={fullscreen ? exitFullscreen : enterFullscreen}
          title={fullscreen ? "全画面表示を終了します（Esc でも戻ります）" : "WBSを画面いっぱいに表示します"} style={wbsToolBtn}>
          {fullscreen
            ? <><Minimize2 style={{ width: 12, height: 12 }} />全画面を終了</>
            : <><Maximize2 style={{ width: 12, height: 12 }} />全画面</>}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <WbsTable
          rows={rows} levels={sheet.levels} statuses={statuses} members={project.members}
          holidays={holidaySet} canEdit={canEdit} freezeKey={freezeKey} onFreezeChange={changeFreeze}
          colOrder={colOrder} onColOrderChange={changeColOrder}
          checkedIds={checkedIds} onToggleCheck={toggleCheck} onToggleAll={toggleAll} allCheckState={allCheckState}
          filters={filters} filterOptions={filterOptions} onFilterChange={changeFilter} shownIds={shownIds}
          editing={editing} onEditingChange={setEditing}
          highlightIds={highlightSet} scrollTo={scrollTo} flashId={flashId}
          focusGroupId={focusGroupId}
          onUpdate={handleUpdate} onMove={handleMove}
          onInsert={handleInsert} onAddNew={handleAddNew}
          collapseKey={`devticket:wbs:collapsed:${userId}:${sheet.id}`}
          gantt={gantt} renderTickets={renderTickets}
        />
      </div>

      {statusOpen && (
        <WbsStatusDialog sheetId={sheet.id} statuses={statuses} items={items} onChanged={load} onClose={() => setStatusOpen(false)} />
      )}

      {holidayOpen && (
        <WbsHolidayDialog projectId={project.id} projectName={project.name} sheetId={sheet.id} sheetName={sheet.name} holidays={holidays} onChanged={reloadHolidays} onClose={() => setHolidayOpen(false)} />
      )}

      {importOpen && (
        <WbsImportDialog
          sheet={sheet} statuses={statuses}
          existingRowCount={items.length}
          tailSortOrder={tailOrder(null)}
          ticketIdByNumber={ticketIdByNumber}
          onImported={load}
          onClose={() => setImportOpen(false)}
        />
      )}

      {linkTarget && (
        <WbsTicketLinkDialog
          itemName={linkTarget.item.name}
          tickets={tickets}
          linkedIds={linkedTicketsOf(linkTarget.item.id).map(t => t.ticket.id)}
          onSubmit={handleLinkSubmit}
          onClose={() => setLinkTargetId(null)}
        />
      )}

      {attentionOpen && (
        <WbsAttentionDialog attention={attention} userId={userId} sheetId={sheet.id} today={today}
          onJump={handleJump} onClose={() => setAttentionOpen(false)} />
      )}

      {deleteOpen && checkedIds.size > 0 && (
        <ConfirmDialog
          title="行の削除"
          message={`選択した ${checkedIds.size} 行を削除しますか？`}
          onConfirm={handleDelete}
          onClose={() => setDeleteOpen(false)}
        />
      )}
    </div>
  );
}
