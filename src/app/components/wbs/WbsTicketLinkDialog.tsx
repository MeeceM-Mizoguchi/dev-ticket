// ENHA2-053 チケット紐づけダイアログ。
//
// WBSの行に、そのプロジェクトのチケットを後から紐づけ・解除する。
// スプリントをまたいでチケット番号とタイトルで探せ、複数をまとめて選べる。
// 一覧はスプリントごとに見出しを付けてまとめる（どのスプリントのチケットかが一目で分かるように）。
// スプリントを1つに絞るプルダウンもある。
// 紐づけは関連の表示だけに使う。行の進捗率・ステータス・日付にも、チケット側の内容にも影響しない。
//
// 画面上の「WBS」は既存ではチケット番号の意味でも使われているので、ここでは必ず
// 「チケット番号」と書き、WBS画面の「No.」と混同しないようにする。
import { useMemo, useRef, useState } from "react";
import { Check, Layers, Search } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { PickerCell } from "@/app/components/tasks/TaskPickerCell";
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
  // 絞り込むスプリント。"" はすべて
  const [sprintId, setSprintId] = useState("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(linkedIds));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // 連打で同じ紐づけを2回登録しないためのガード（state だけだとすり抜ける）
  const savingRef = useRef(false);

  const linked = useMemo(() => new Set(linkedIds), [linkedIds]);

  // スプリントの並び（チケットの並びに出てくる順＝スプリントの開始日順）
  const sprintOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of tickets) if (!seen.has(r.sprintId)) seen.set(r.sprintId, r.sprintName);
    return [...seen].map(([value, label]) => ({ value, label }));
  }, [tickets]);

  /** 条件に合うチケットを、スプリントごとにまとめたもの */
  const groups = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const map = new Map<string, { sprintId: string; sprintName: string; rows: WbsTicketRef[] }>();
    for (const r of tickets) {
      if (sprintId && r.sprintId !== sprintId) continue;
      if (kw && !r.ticket.wbs.toLowerCase().includes(kw) && !r.ticket.title.toLowerCase().includes(kw)) continue;
      const g = map.get(r.sprintId);
      if (g) g.rows.push(r); else map.set(r.sprintId, { sprintId: r.sprintId, sprintName: r.sprintName, rows: [r] });
    }
    return [...map.values()];
  }, [tickets, keyword, sprintId]);

  /** すでに紐づいているチケット（スプリント名つき）。一覧の上にまとめて出す */
  const linkedRefs = useMemo(() => tickets.filter(r => linked.has(r.ticket.id)), [tickets, linked]);

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

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <Search style={{ position: "absolute", left: 12, top: 11, width: 14, height: 14, color: "#A09790" }} />
          {/* 入力のたびに絞り込むので、Enter で確定する操作は無い */}
          <input autoFocus value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="チケット番号・タイトルで検索"
            style={{ width: "100%", height: 36, padding: "0 12px 0 34px", fontSize: 13, color: "#1A1714", background: "#F7F8F9", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10, outline: "none", boxSizing: "border-box" }} />
        </div>
        <PickerCell variant="chip" value={sprintId} onChange={setSprintId} title="スプリントで絞り込む"
          options={[{ value: "", label: "すべてのスプリント" }, ...sprintOptions]}
          textStyle={{ width: 220, height: 36, padding: "0 10px", fontSize: 12, color: "#1A1714", borderRadius: 10 }} />
      </div>

      {linkedRefs.length > 0 && (
        <div style={{ fontSize: 11, color: "#6B6458", lineHeight: 1.9 }}>
          <span style={{ fontWeight: 700, color: "#A09790", marginRight: 6 }}>紐づけ済み</span>
          {linkedRefs.map(r => (
            <span key={r.ticket.id} title={`${r.sprintName} ／ ${r.ticket.title}`}
              style={{ display: "inline-block", marginRight: 6, padding: "0 6px", fontWeight: 700, fontFamily: "var(--font-mono)", borderRadius: 5,
                color: checked.has(r.ticket.id) ? "#047857" : "#A09790", background: checked.has(r.ticket.id) ? "#ECFDF5" : "#F3F4F6",
                textDecoration: checked.has(r.ticket.id) ? "none" : "line-through" }}>
              {r.ticket.wbs}
            </span>
          ))}
        </div>
      )}

      <div style={{ height: 340, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
        {groups.length === 0 ? (
          <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>
            {tickets.length === 0 ? "このプロジェクトには、まだチケットがありません。" : "条件に合うチケットがありません。"}
          </p>
        ) : groups.map(g => (
          <div key={g.sprintId}>
            {/* スプリントの見出し。スクロールしても上に残るので、いま見ているチケットがどのスプリントのものか分かる */}
            <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "#F1F3F6", borderBottom: "1px solid rgba(26,23,20,0.08)", fontSize: 12, fontWeight: 700, color: "#1E3989" }}>
              <Layers style={{ width: 12, height: 12, flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={g.sprintName}>{g.sprintName}</span>
              <span style={{ fontWeight: 600, color: "#63748A", flexShrink: 0 }}>
                {g.rows.length} 件{g.rows.some(r => checked.has(r.ticket.id)) ? `・選択 ${g.rows.filter(r => checked.has(r.ticket.id)).length}` : ""}
              </span>
            </div>
            {g.rows.map(r => {
              const on = checked.has(r.ticket.id);
              const wasLinked = linked.has(r.ticket.id);
              return (
                <button key={r.ticket.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(r.ticket.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 12px", textAlign: "left", cursor: "pointer", border: "none", borderBottom: "1px solid rgba(26,23,20,0.05)", background: on ? "#F0FDF4" : "transparent" }}>
                  {/* 自前のチェックボックス（標準の input はOSごとに見た目が変わるため） */}
                  <span style={{ width: 16, height: 16, borderRadius: 4, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: on ? "#059669" : "#FFF", border: on ? "none" : "1.5px solid rgba(26,23,20,0.18)" }}>
                    {on && <Check style={{ width: 11, height: 11, color: "#FFF" }} />}
                  </span>
                  <span style={{ width: 110, fontSize: 12, fontWeight: 700, color: "#059669", fontFamily: "var(--font-mono)", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ticket.wbs}</span>
                  <span title={r.ticket.title} style={{ flex: 1, minWidth: 0, fontSize: 13, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.ticket.title}</span>
                  {wasLinked && <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", background: "#D1FAE5", borderRadius: 5, padding: "1px 6px", flexShrink: 0 }}>紐づけ済み</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {failed && <p style={{ fontSize: 12, color: "#DC2626" }}>保存できませんでした。時間をおいて、もう一度お試しください。</p>}
    </DialogShell>
  );
}
