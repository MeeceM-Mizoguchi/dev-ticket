// BRU25-005 子チケットの「親を変更」ダイアログ。
// 移し先の親チケットを WBS・タイトル・本文の文言で探して選ぶか、「単独の親チケットにする」を選ぶ。
// ［移す］で移したあとの WBS を確認に出し、確定で移す。

import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { ConfirmDialog } from "@/app/components/shared/ConfirmDialog";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";
import { submitOnEnter } from "@/app/lib/submitKey";
import { getTicketStatusMeta } from "@/app/lib/helpers";
import {
  searchParentCandidates, planReparent, executeReparent, PARENT_CANDIDATE_LIMIT,
  type ParentCandidate,
} from "@/app/lib/reparentTicket";

/** 単独の親チケットにする、を選んだとき */
const STANDALONE = "__standalone__";

export function ReparentTicketDialog({ ticketId, ticketWbs, currentParentId, currentParentWbs, projectId, userName, zIndex = 320, onClose, onMoved }: {
  ticketId: string;
  ticketWbs: string;
  currentParentId: string;
  currentParentWbs: string;
  projectId: string;
  userName: string;
  zIndex?: number;
  onClose: () => void;
  /** 移し終えたとき。移したあとの WBS と、移した先・元のスプリント */
  onMoved: (r: { newWbs: string; targetSprintId: string; oldSprintId: string }) => void | Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<ParentCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [confirm, setConfirm] = useState<null | { message: string }>(null);
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const seqRef = useRef(0);

  const runSearch = async (q: string) => {
    const seq = ++seqRef.current;
    setSearching(true);
    try {
      const rows = await searchParentCandidates({ projectId, query: q, excludeIds: [currentParentId] });
      if (seq !== seqRef.current) return; // 後から打った検索の結果を優先する
      setCandidates(rows);
      setError(null);
    } catch (e) {
      if (seq !== seqRef.current) return;
      setError(`検索に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  };

  // 打つたびに少し待ってから検索する（Enter ならすぐ検索）
  useEffect(() => {
    const t = setTimeout(() => void runSearch(query), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const selectedCandidate = candidates.find(c => c.id === selected) ?? null;
  const canMove = !!selected && (selected === STANDALONE || !!selectedCandidate) && !planning && !moving;

  /** ［移す］：移したあとの WBS を求めて確認を出す */
  const handleMoveClick = async () => {
    if (!canMove) return;
    setPlanning(true);
    setError(null);
    try {
      const targetParentId = selected === STANDALONE ? null : selected;
      const plan = await planReparent({ ticketId, targetParentId, projectId });
      setConfirm({
        message: selectedCandidate
          ? `${ticketWbs} を ${selectedCandidate.wbs} の子へ移します。WBS は ${plan.newWbs} になります`
          : `${ticketWbs} を親チケット ${currentParentWbs} から外し、単独の親チケットにします。WBS は ${plan.newWbs} になります`,
      });
    } catch (e) {
      setError(`移したあとの WBS を求められませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPlanning(false);
    }
  };

  /** 確定：移す。BUG-05 の連打ガード */
  const executeMove = async () => {
    if (movingRef.current) return;
    movingRef.current = true;
    setMoving(true);
    try {
      const r = await executeReparent({
        ticketId, targetParentId: selected === STANDALONE ? null : selected, projectId, userName,
      });
      await onMoved({ newWbs: r.newWbs, targetSprintId: r.targetSprintId, oldSprintId: r.oldSprintId });
    } catch (e) {
      setError(`移せませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
  };

  const rowStyle = (isSelected: boolean) => ({
    display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10,
    border: `2px solid ${isSelected ? "#059669" : "rgba(26,23,20,0.10)"}`,
    background: isSelected ? "#ECFDF5" : "#FAFAF8", cursor: "pointer", transition: "all 0.15s",
  });

  return (
    <>
      <DialogShell
        title="親チケットを変更"
        size="lg"
        zIndex={zIndex}
        busy={moving}
        onClose={onClose}
        footer={<>
          <BtnSecondary onClick={onClose} disabled={moving}>キャンセル</BtnSecondary>
          <button type="button" onClick={() => void handleMoveClick()} disabled={!canMove}
            style={{ padding: "9px 20px", background: canMove ? "#059669" : "#9CA3AF", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: canMove ? "pointer" : "not-allowed", boxShadow: canMove ? "0 2px 8px rgba(5,150,105,0.30)" : "none", display: "flex", alignItems: "center", gap: 6 }}>
            {(planning || moving) && <BtnSpinner />}
            {moving ? "移動中..." : "移す"}
          </button>
        </>}>
        <p style={{ fontSize: 13, color: "#6B7280", margin: 0 }}>
          {ticketWbs}（今の親：{currentParentWbs}）の移し先を選んでください
        </p>

        <div style={{ position: "relative" }}>
          <Search style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", width: 14, height: 14, color: "#A09790" }} />
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={submitOnEnter(() => void runSearch(query))}
            placeholder="WBS番号・チケット名・本文の文言で検索"
            style={{ width: "100%", padding: "9px 12px 9px 30px", fontSize: 13, borderRadius: 10, border: "1px solid rgba(26,23,20,0.15)", outline: "none", boxSizing: "border-box" }}
          />
        </div>

        <label style={rowStyle(selected === STANDALONE)}>
          <input type="radio" name="reparentTarget" checked={selected === STANDALONE} onChange={() => setSelected(STANDALONE)}
            style={{ accentColor: "#059669", width: 16, height: 16, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>単独の親チケットにする</span>
            <span style={{ fontSize: 11, color: "#A09790", marginLeft: 8 }}>今のスプリントのまま、新しい親の WBS を振ります</span>
          </div>
        </label>

        {error && <p style={{ fontSize: 12, color: "#DC2626", margin: 0 }}>{error}</p>}

        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {searching && candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: "#A09790", textAlign: "center", padding: "20px 0" }}>検索中...</p>
          ) : candidates.length === 0 ? (
            <p style={{ fontSize: 13, color: "#A09790", textAlign: "center", padding: "20px 0" }}>該当する親チケットがありません</p>
          ) : candidates.map(c => {
            const sm = getTicketStatusMeta(c.status);
            const isSelected = selected === c.id;
            return (
              <label key={c.id} style={rowStyle(isSelected)}>
                <input type="radio" name="reparentTarget" checked={isSelected} onChange={() => setSelected(c.id)}
                  style={{ accentColor: "#059669", width: 16, height: 16, flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: "#6B6458", fontFamily: "var(--font-mono)", flexShrink: 0 }}>{c.wbs}</span>
                <span title={c.title} style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                <span title={c.sprintName} style={{ fontSize: 11, color: "#A09790", flexShrink: 0, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.sprintName}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: sm.bg, color: sm.color, flexShrink: 0 }}>{sm.label}</span>
              </label>
            );
          })}
        </div>
        {candidates.length >= PARENT_CANDIDATE_LIMIT && (
          <p style={{ fontSize: 11, color: "#A09790", margin: 0 }}>新しい順に {PARENT_CANDIDATE_LIMIT} 件まで表示しています。見つからないときは検索の文言を足してください</p>
        )}
      </DialogShell>

      {confirm && (
        <ConfirmDialog
          title="親チケットの変更"
          message={confirm.message}
          confirmLabel="移す"
          confirmColor="#059669"
          hasWarningText={false}
          zIndex={zIndex + 10}
          onConfirm={executeMove}
          onClose={() => setConfirm(null)}
        />
      )}
    </>
  );
}
