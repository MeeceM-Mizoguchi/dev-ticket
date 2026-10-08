// ENHA2-053 WBS 1つぶんの作業領域（行の読み込みと、追加・編集・並べ替え・削除）。
//
// WbsPage がWBSの切り替えと枠を受け持ち、ここは選ばれた1つのWBSの中身を受け持つ。
// WBSを切り替えたら key で作り直すので、前のWBSの行や選択を持ち越さない。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, CornerDownRight } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useToast } from "@/app/contexts/ToastContext";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { PageLoader } from "@/app/components/shared/PageLoader";
import { computeSortOrder } from "@/app/lib/taskService";
import {
  WBS_LEVEL_LABELS, WBS_SORT_GAP, createWbsItem, deleteWbsItem, loadWbsItems, loadWbsStatuses, renumberWbsItems, updateWbsItem,
} from "@/app/lib/wbsService";
import { buildWbsRows, siblingsOf, todayStr } from "@/app/lib/wbsCalc";
import type { Project, WbsItem, WbsSheet, WbsStatus } from "@/app/types";
import { WbsTable, visibleWbsColumns, type WbsColKey, type WbsDropMode, type WbsEditing } from "./WbsTable";
import { wbsToolBtn, wbsToolBtnDisabled, wbsToolLabel, wbsToolSelect } from "./wbsStyles";

const NO_HOLIDAYS: ReadonlySet<string> = new Set();

/** 列固定の位置は、WBSごと・利用者ごとにブラウザへ保存する */
function freezeStorageKey(userId: string, sheetId: string) { return `devticket:wbs:freeze:${userId}:${sheetId}`; }

function readFreeze(userId: string, sheetId: string): WbsColKey {
  try {
    const v = localStorage.getItem(freezeStorageKey(userId, sheetId));
    if (v) return v as WbsColKey;
  } catch { /* 保存領域が使えない環境では既定値で動かす */ }
  return "note";
}

export function WbsWorkspace({ sheet, project, canEdit, highlightIds, onHighlightChange }: {
  sheet: WbsSheet;
  project: Project;
  canEdit: boolean;
  /** 段数を減らせない理由になっている行 */
  highlightIds: string[];
  onHighlightChange: (ids: string[]) => void;
}) {
  const { userId } = useAuth();
  const { toast } = useToast();

  const [items, setItems] = useState<WbsItem[]>([]);
  const [statuses, setStatuses] = useState<WbsStatus[]>([]);
  const [loading, setLoading] = useState(true);
  // 一度でもデータを読んだら、以後は再読み込みでスピナーに差し替えない（画面のちらつき防止）
  const initializedRef = useRef(false);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<WbsEditing | null>(null);
  const [scrollTo, setScrollTo] = useState<{ id: string; nonce: number } | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [freezeKey, setFreezeKey] = useState<WbsColKey>(() => readFreeze(userId, sheet.id));
  // 追加の連打で同じ行を2つ作らないためのガード
  const addingRef = useRef(false);

  const load = useCallback(async () => {
    const [its, sts] = await Promise.all([loadWbsItems(sheet.id), loadWbsStatuses(sheet.id)]);
    setItems(its);
    setStatuses(sts);
    initializedRef.current = true;
    setLoading(false);
  }, [sheet.id]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const today = todayStr();
  const rows = useMemo(() => buildWbsRows(items, sheet.levels, today), [items, sheet.levels, today]);
  const cols = useMemo(() => visibleWbsColumns(sheet.levels), [sheet.levels]);
  const selected = rows.find(r => r.item.id === selectedId) ?? null;
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

  const changeFreeze = (key: WbsColKey) => {
    setFreezeKey(key);
    try { localStorage.setItem(freezeStorageKey(userId, sheet.id), key); } catch { /* 保存できなくても表示は切り替える */ }
  };

  // ── 編集 ────────────────────────────────────────────────────
  const handleUpdate = useCallback((id: string, patch: Partial<WbsItem>) => {
    // 先に画面へ反映してから保存する。失敗したら読み直して元へ戻す
    setItems(prev => prev.map(i => (i.id === id ? { ...i, ...patch } : i)));
    updateWbsItem(id, patch).then(ok => {
      if (!ok) { toast("保存できませんでした", "error"); load().catch(() => { }); }
    });
  }, [load, toast]);

  // ── 追加 ────────────────────────────────────────────────────
  const addItem = async (parentId: string | null, level: number, sortOrder: number) => {
    if (addingRef.current) return;
    addingRef.current = true;
    try {
      // 新しい行の初期値は先頭のステータス（既定では「未着手」）
      const created = await createWbsItem({ sheetId: sheet.id, parentId, level, statusId: statuses[0]?.id ?? null, sortOrder });
      if (!created) { toast("行を追加できませんでした", "error"); return; }
      setItems(prev => [...prev, created]);
      setSelectedId(created.id);
      setEditing({ id: created.id, field: "name" });
      setScrollTo({ id: created.id, nonce: Date.now() });
    } finally {
      addingRef.current = false;
    }
  };

  /** 同じ親の末尾に積むための値 */
  const tailOrder = (parentId: string | null) => {
    const sibs = siblingsOf(items, parentId);
    return sibs.length ? sibs[sibs.length - 1].sortOrder + WBS_SORT_GAP : 0;
  };

  const addTop = () => addItem(null, 1, tailOrder(null));

  /** 選んだ行のすぐ下に、同じ段の行を足す */
  const addSibling = async () => {
    if (!selected) return;
    const it = selected.item;
    const sibs = siblingsOf(items, it.parentId);
    const idx = sibs.findIndex(s => s.id === it.id);
    let order = computeSortOrder(it.sortOrder, sibs[idx + 1]?.sortOrder ?? null);
    if (order === null) {
      // 中点が潰れていたら、同じ親の行を振り直してから間に入れる
      await renumberWbsItems(sibs.map(s => s.id));
      setItems(prev => prev.map(p => {
        const i = sibs.findIndex(s => s.id === p.id);
        return i < 0 ? p : { ...p, sortOrder: i * WBS_SORT_GAP };
      }));
      order = idx * WBS_SORT_GAP + WBS_SORT_GAP / 2;
    }
    await addItem(it.parentId, it.level, order);
  };

  /** 選んだ行の下の段に足す（一番右の段の行には足せない） */
  const addChild = () => {
    if (!selected || selected.item.level >= sheet.levels) return;
    return addItem(selected.item.id, selected.item.level + 1, tailOrder(selected.item.id));
  };

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

  // ── 削除 ────────────────────────────────────────────────────
  const deleteTarget = rows.find(r => r.item.id === deleteTargetId) ?? null;

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.item.id;
    const ok = await deleteWbsItem(id);
    if (!ok) { toast("行を削除できませんでした", "error"); return; }
    // 下の行は DB 側で一緒に消える。画面からも同じ範囲を外す
    setItems(prev => {
      const gone = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const i of prev) {
          if (i.parentId && gone.has(i.parentId) && !gone.has(i.id)) { gone.add(i.id); grew = true; }
        }
      }
      return prev.filter(i => !gone.has(i.id));
    });
    if (selectedId === id) setSelectedId(null);
  };

  if (loading && !initializedRef.current) return <PageLoader label="WBSを読み込み中..." />;

  const childLabel = selected && selected.item.level < sheet.levels ? WBS_LEVEL_LABELS[selected.item.level] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid #E2E6EC", flexWrap: "wrap" }}>
        {canEdit && (
          <>
            <button type="button" onClick={addTop} style={wbsToolBtn}>
              <Plus style={{ width: 12, height: 12 }} />大項目を追加
            </button>
            <button type="button" onClick={addSibling} disabled={!selected}
              title={selected ? "選んだ行のすぐ下に、同じ段の行を追加します" : "行を選ぶと使えます"}
              style={selected ? wbsToolBtn : wbsToolBtnDisabled}>
              <Plus style={{ width: 12, height: 12 }} />
              {selected ? `${WBS_LEVEL_LABELS[selected.item.level - 1]}を追加` : "同じ段に追加"}
            </button>
            <button type="button" onClick={addChild} disabled={!childLabel}
              title={childLabel ? "選んだ行の下の段に追加します" : selected ? "一番右の段の行には、下の段を追加できません" : "行を選ぶと使えます"}
              style={childLabel ? wbsToolBtn : wbsToolBtnDisabled}>
              <CornerDownRight style={{ width: 12, height: 12 }} />
              {childLabel ? `${childLabel}を追加` : "下の段に追加"}
            </button>
            <button type="button" onClick={() => selected && setDeleteTargetId(selected.item.id)} disabled={!selected}
              title={selected ? "選んだ行を削除します" : "行を選ぶと使えます"}
              style={selected ? { ...wbsToolBtn, color: "#DC2626" } : wbsToolBtnDisabled}>
              <Trash2 style={{ width: 12, height: 12 }} />行を削除
            </button>
          </>
        )}

        <div style={{ flex: 1 }} />
        <span style={wbsToolLabel}>列固定</span>
        <select value={cols.some(c => c.key === freezeKey) ? freezeKey : "note"} onChange={e => changeFreeze(e.target.value as WbsColKey)}
          title="どの列までを左に固定するか。固定していない列は横にスクロールします" style={wbsToolSelect}>
          {cols.map(c => <option key={c.key} value={c.key}>{c.key === "note" ? "すべての列" : `「${c.label}」まで`}</option>)}
        </select>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        <WbsTable
          rows={rows} levels={sheet.levels} statuses={statuses} members={project.members}
          holidays={NO_HOLIDAYS} canEdit={canEdit} freezeKey={freezeKey}
          selectedId={selectedId} onSelect={setSelectedId}
          editing={editing} onEditingChange={setEditing}
          highlightIds={highlightSet} scrollTo={scrollTo}
          onUpdate={handleUpdate} onMove={handleMove}
        />
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title="行の削除"
          message={deleteTarget.descendantCount > 0
            ? `「${deleteTarget.item.name || "（名前なし）"}」の下に ${deleteTarget.descendantCount} 行あります。\n下の行ごと削除しますか？`
            : `「${deleteTarget.item.name || "（名前なし）"}」を削除しますか？`}
          onConfirm={handleDelete}
          onClose={() => setDeleteTargetId(null)}
        />
      )}
    </div>
  );
}
