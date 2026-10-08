// ENHA2-053 WBSのステータス設定モーダル。
//
// WBSごとのステータスを追加・削除・名前変更・色変更・並べ替えする。
// 変更は1件ずつその場で保存し、表のプルダウンと色にすぐ反映する。
// チケットのステータス（未着手・進行中・レビュー中など）とは別のもので、互いに影響しない。
import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { submitOnEnter } from "@/app/lib/submitKey";
import { WBS_SORT_GAP, createWbsStatus, deleteWbsStatus, reorderWbsStatuses, updateWbsStatus } from "@/app/lib/wbsService";
import type { WbsItem, WbsStatus } from "@/app/types";

const NEW_STATUS_COLOR = "#E0F2FE";

const nameInput = {
  flex: 1, minWidth: 0, height: 32, padding: "0 10px", fontSize: 13, color: "#1A1714", background: "#FFFFFF",
  border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, outline: "none", boxSizing: "border-box",
} as const;
const colorInput = { width: 32, height: 32, padding: 2, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, cursor: "pointer", flexShrink: 0 } as const;
const iconBtn = { width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: "none", borderRadius: 6, cursor: "pointer", color: "#6B6458", flexShrink: 0 } as const;

/** 1行ぶん。名前と色は手元に下書きを持ち、欄を抜けたときに保存する */
function StatusRow({ status, usedCount, isFirst, isLast, isOnly, busy, onRename, onRecolor, onMove, onAskDelete }: {
  status: WbsStatus; usedCount: number; isFirst: boolean; isLast: boolean; isOnly: boolean; busy: boolean;
  /** 保存できなかった理由を返す（保存できたら null） */
  onRename: (name: string) => Promise<string | null>;
  onRecolor: (color: string) => void;
  onMove: (dir: -1 | 1) => void;
  onAskDelete: () => void;
}) {
  const [name, setName] = useState(status.name);
  const [color, setColor] = useState(status.color);
  const [error, setError] = useState<string | null>(null);

  const commitName = async () => {
    const trimmed = name.trim();
    if (trimmed === status.name) { setName(trimmed); setError(null); return; }
    const err = await onRename(trimmed);
    setError(err);
    // 保存できなかったら元の名前へ戻す（空や重複のまま残さない）
    setName(err ? status.name : trimmed);
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={() => onMove(-1)} disabled={isFirst || busy} title="上へ" style={{ ...iconBtn, opacity: isFirst ? 0.25 : 1, cursor: isFirst ? "default" : "pointer" }}>
          <ArrowUp style={{ width: 14, height: 14 }} />
        </button>
        <button type="button" onClick={() => onMove(1)} disabled={isLast || busy} title="下へ" style={{ ...iconBtn, opacity: isLast ? 0.25 : 1, cursor: isLast ? "default" : "pointer" }}>
          <ArrowDown style={{ width: 14, height: 14 }} />
        </button>
        <input type="color" value={color} title="色を変更" aria-label={`${status.name}の色`}
          onChange={e => setColor(e.target.value)}
          onBlur={() => { if (color !== status.color) onRecolor(color); }}
          style={colorInput} />
        <input value={name} onChange={e => { setName(e.target.value); setError(null); }} maxLength={30} aria-label="ステータスの名前"
          onBlur={commitName}
          // Enter は欄から抜けるだけ。保存は blur 側の1か所で行う（二重に保存しないため）
          onKeyDown={submitOnEnter(() => (document.activeElement as HTMLElement | null)?.blur())}
          style={{ ...nameInput, borderColor: error ? "#DC2626" : "rgba(26,23,20,0.14)" }} />
        <span style={{ width: 56, textAlign: "right", fontSize: 11, color: "#A09790", flexShrink: 0 }}>{usedCount}行</span>
        <button type="button" onClick={onAskDelete} disabled={isOnly || busy}
          title={isOnly ? "最後の1つは削除できません" : "削除"}
          style={{ ...iconBtn, color: isOnly ? "#D5D0CB" : "#DC2626", cursor: isOnly ? "not-allowed" : "pointer" }}>
          <Trash2 style={{ width: 14, height: 14 }} />
        </button>
      </div>
      {error && <p style={{ fontSize: 11, color: "#DC2626", margin: "4px 0 0 100px" }}>{error}</p>}
    </div>
  );
}

export function WbsStatusDialog({ sheetId, statuses, items, onChanged, onClose }: {
  sheetId: string;
  statuses: WbsStatus[];
  /** 使われている件数を出すための行 */
  items: WbsItem[];
  /** 保存のたびに呼ぶ。呼び出し側でステータスと行を読み直す */
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(NEW_STATUS_COLOR);
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<{ id: string; moveToId: string } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // 追加・削除・並べ替えの連打で二重に走らせないためのガード
  const busyRef = useRef(false);

  const firstId = statuses[0]?.id ?? null;
  const known = new Set(statuses.map(s => s.id));
  /** そのステータスになっている行の数。status_id が空の行は先頭のステータスとして数える（表の表示と同じ） */
  const usedCount = (id: string) => items.filter(i => (i.statusId && known.has(i.statusId) ? i.statusId : firstId) === id).length;

  /** 名前の検査。使えないときは理由を返す */
  const validateName = (name: string, selfId?: string): string | null => {
    if (!name) return "名前を入力してください。";
    if (statuses.some(s => s.id !== selfId && s.name === name)) return `「${name}」は、すでにあります。`;
    return null;
  };

  const run = async (fn: () => Promise<boolean>, failMessage: string) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setFailed(null);
    try {
      const ok = await fn();
      if (!ok) setFailed(failMessage);
      await onChanged();
      return ok;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const handleAdd = async () => {
    const name = newName.trim();
    const err = validateName(name);
    if (err) { setAddError(err); return; }
    const sortOrder = statuses.length ? statuses[statuses.length - 1].sortOrder + WBS_SORT_GAP : 0;
    const ok = await run(async () => !!(await createWbsStatus({ sheetId, name, color: newColor, sortOrder })), "ステータスを追加できませんでした。");
    if (ok) { setNewName(""); setAddError(null); }
  };

  const handleRename = async (status: WbsStatus, name: string): Promise<string | null> => {
    const err = validateName(name, status.id);
    if (err) return err;
    const ok = await run(() => updateWbsStatus(status.id, { name }), "名前を変更できませんでした。");
    return ok ? null : "名前を変更できませんでした。";
  };

  const handleMove = (index: number, dir: -1 | 1) => {
    const ids = statuses.map(s => s.id);
    const to = index + dir;
    if (to < 0 || to >= ids.length) return;
    [ids[index], ids[to]] = [ids[to], ids[index]];
    run(() => reorderWbsStatuses(ids), "並び順を変更できませんでした。");
  };

  const askDelete = (status: WbsStatus) => {
    if (statuses.length <= 1) return;
    const fallback = statuses.find(s => s.id !== status.id)!;
    setDeleting({ id: status.id, moveToId: fallback.id });
  };

  const deletingStatus = deleting ? statuses.find(s => s.id === deleting.id) ?? null : null;
  const deletingUsed = deletingStatus ? usedCount(deletingStatus.id) : 0;

  const confirmDelete = async () => {
    if (!deleting || !deletingStatus || statuses.length <= 1) return;
    const ok = await run(() => deleteWbsStatus({
      sheetId, statusId: deleting.id,
      moveToId: deletingUsed > 0 ? deleting.moveToId : null,
      includeUnset: deleting.id === firstId,
    }), "ステータスを削除できませんでした。");
    if (ok) setDeleting(null);
  };

  return (
    <DialogShell title="ステータス設定" size="md" minHeight={0} onClose={busy ? () => {} : onClose}
      footer={<BtnSecondary onClick={onClose} disabled={busy}>閉じる</BtnSecondary>}>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
        このWBSで使うステータスです。変更はすぐに表へ反映されます。チケットのステータスとは別のもので、互いに影響しません。
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {statuses.map((s, i) => (
          <StatusRow key={s.id} status={s} usedCount={usedCount(s.id)}
            isFirst={i === 0} isLast={i === statuses.length - 1} isOnly={statuses.length <= 1} busy={busy}
            onRename={name => handleRename(s, name)}
            onRecolor={color => { run(() => updateWbsStatus(s.id, { color }), "色を変更できませんでした。"); }}
            onMove={dir => handleMove(i, dir)}
            onAskDelete={() => askDelete(s)} />
        ))}
      </div>

      {deletingStatus && deleting && (
        <div style={{ padding: 12, background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10 }}>
          {deletingUsed > 0 ? (
            <>
              <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7 }}>
                「{deletingStatus.name}」は {deletingUsed} 行で使われています。該当する行を移すステータスを選んでください。
              </p>
              <select value={deleting.moveToId} onChange={e => setDeleting({ id: deleting.id, moveToId: e.target.value })} aria-label="移し先のステータス"
                style={{ marginTop: 8, height: 32, padding: "0 8px", fontSize: 13, border: "1px solid rgba(26,23,20,0.14)", borderRadius: 8, background: "#FFFFFF" }}>
                {statuses.filter(s => s.id !== deleting.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#1A1714", lineHeight: 1.7 }}>「{deletingStatus.name}」を削除しますか？</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
            <BtnSecondary onClick={() => setDeleting(null)} disabled={busy}>やめる</BtnSecondary>
            <button type="button" onClick={confirmDelete} disabled={busy}
              style={{ padding: "9px 20px", background: busy ? "#9CA3AF" : "#DC2626", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: busy ? "not-allowed" : "pointer" }}>
              {deletingUsed > 0 ? "移して削除する" : "削除する"}
            </button>
          </div>
        </div>
      )}

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>ステータスを追加</p>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} title="色" aria-label="追加するステータスの色" style={colorInput} />
          <input value={newName} onChange={e => { setNewName(e.target.value); setAddError(null); }} maxLength={30} placeholder="例：確認待ち"
            onKeyDown={submitOnEnter(handleAdd, { enabled: !busy })}
            style={{ ...nameInput, borderColor: addError ? "#DC2626" : "rgba(26,23,20,0.14)" }} />
          <button type="button" onClick={handleAdd} disabled={busy}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 32, padding: "0 14px", fontSize: 13, fontWeight: 700, color: "#FFFFFF", background: busy ? "#9CA3AF" : "#059669", border: "none", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", flexShrink: 0 }}>
            <Plus style={{ width: 13, height: 13 }} />追加
          </button>
        </div>
        {addError && <p style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>{addError}</p>}
      </div>

      {failed && <p style={{ fontSize: 12, color: "#DC2626" }}>{failed}</p>}
    </DialogShell>
  );
}
