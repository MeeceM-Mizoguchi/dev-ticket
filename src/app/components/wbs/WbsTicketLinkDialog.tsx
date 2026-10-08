// ENHA2-053 チケット紐づけダイアログ。
//
// WBSの行に、そのプロジェクトのチケットを後から紐づけ・解除する。
// スプリントをまたいでチケット番号とタイトルで探せ、複数をまとめて選べる。
// 紐づけは関連の表示だけに使う。行の進捗率・ステータス・日付にも、チケット側の内容にも影響しない。
//
// 画面上の「WBS」は既存ではチケット番号の意味でも使われているので、ここでは必ず
// 「チケット番号」と書き、WBS画面の「No.」と混同しないようにする。
import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import type { SprintTicket } from "@/app/types";

/** 紐づけの候補にするチケット（スプリント名つき） */
export interface WbsTicketRef { ticket: SprintTicket; sprintId: string; sprintName: string }

export function WbsTicketLinkDialog({ itemName, tickets, linkedIds, onSubmit, onClose }: {
  /** 紐づける行の名前 */
  itemName: string;
  tickets: WbsTicketRef[];
  /** すでにその行に紐づいているチケットの id */
  linkedIds: string[];
  /** 保存できたら true を返す。false のときはダイアログを開いたままにする */
  onSubmit: (addIds: string[], removeIds: string[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(linkedIds));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // 連打で同じ紐づけを2回登録しないためのガード（state だけだとすり抜ける）
  const savingRef = useRef(false);

  const linked = useMemo(() => new Set(linkedIds), [linkedIds]);

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const list = kw
      ? tickets.filter(r => r.ticket.wbs.toLowerCase().includes(kw) || r.ticket.title.toLowerCase().includes(kw))
      : tickets;
    // すでに紐づいているチケットを上に寄せる（選択済みであることが開いてすぐ分かるように）
    return [...list].sort((a, b) => Number(linked.has(b.ticket.id)) - Number(linked.has(a.ticket.id)));
  }, [tickets, keyword, linked]);

  const addIds = [...checked].filter(id => !linked.has(id));
  const removeIds = linkedIds.filter(id => !checked.has(id));
  const changed = addIds.length > 0 || removeIds.length > 0;

  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleSave = async () => {
    if (!changed || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      if (await onSubmit(addIds, removeIds)) onClose();
      else setFailed(true);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <DialogShell title="チケットを紐づける" size="lg" minHeight={0} onClose={saving ? () => {} : onClose} busy={saving}
      footer={<>
        <span style={{ flex: 1, alignSelf: "center", fontSize: 12, color: "#6B6458" }}>
          選択中 {checked.size} 件{changed ? `（追加 ${addIds.length}・解除 ${removeIds.length}）` : ""}
        </span>
        <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleSave} disabled={!changed} loading={saving}>保存する</BtnPrimary>
      </>}>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
        「{itemName || "（名前なし）"}」に関連するチケットを選びます。チェックを外すと紐づけを解除します。
        紐づけても、行の進捗率・ステータス・日付やチケットの内容は変わりません。
      </p>

      <div style={{ position: "relative" }}>
        <Search style={{ position: "absolute", left: 12, top: 11, width: 14, height: 14, color: "#A09790" }} />
        {/* 入力のたびに絞り込むので、Enter で確定する操作は無い */}
        <input autoFocus value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="チケット番号・タイトルで検索"
          style={{ width: "100%", height: 36, padding: "0 12px 0 34px", fontSize: 13, color: "#1A1714", background: "#F7F8F9", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ height: 340, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
        {visible.length === 0 ? (
          <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>
            {tickets.length === 0 ? "このプロジェクトには、まだチケットがありません。" : "条件に合うチケットがありません。"}
          </p>
        ) : visible.map(r => {
          const on = checked.has(r.ticket.id);
          const wasLinked = linked.has(r.ticket.id);
          return (
            <label key={r.ticket.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid rgba(26,23,20,0.05)", background: on ? "#F0FDF4" : "transparent" }}>
              <input type="checkbox" checked={on} onChange={() => toggle(r.ticket.id)} style={{ accentColor: "#059669", flexShrink: 0 }} />
              <span style={{ width: 96, fontSize: 12, fontWeight: 700, color: "#059669", fontFamily: "var(--font-mono)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ticket.wbs}</span>
              <span title={r.ticket.title} style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ticket.title}</span>
              {wasLinked && <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#D1FAE5", borderRadius: 5, padding: "1px 6px", flexShrink: 0 }}>紐づけ済み</span>}
              <span title={r.sprintName} style={{ width: 130, fontSize: 11, color: "#A09790", textAlign: "right", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.sprintName}</span>
            </label>
          );
        })}
      </div>
      {failed && <p style={{ fontSize: 12, color: "#DC2626" }}>保存できませんでした。時間をおいて、もう一度お試しください。</p>}
    </DialogShell>
  );
}
