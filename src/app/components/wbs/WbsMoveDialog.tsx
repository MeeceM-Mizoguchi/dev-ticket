// BRU22-007 チェックを付けた行を、移動先を選んでまとめて移すダイアログ。
// ドラッグと同じく段（大・中・小）は変えない（下の行の深さが崩れないようにするため）。
// 移動先に選べるのは、移す行の1つ上の段の行（中項目なら大項目、小項目なら中項目）。大項目は最上位の並びの中で動かす。
import { useMemo, useRef, useState } from "react";
import { Check, FolderInput } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { WBS_LEVEL_LABELS } from "@/app/lib/wbsService";
import { siblingsOf, type WbsRow } from "@/app/lib/wbsCalc";
import type { WbsItem } from "@/app/types";

export type WbsMovePosition = "head" | "tail";

/**
 * 移す行（上の行にチェックが無い行）を、表の上からの順で返す。
 * 下の行は上の行と一緒に動くので、ここには含めない。
 */
export function wbsMoveTops(rows: WbsRow[], checkedIds: ReadonlySet<string>): WbsItem[] {
  return rows.map(r => r.item).filter(i => checkedIds.has(i.id) && !(i.parentId && checkedIds.has(i.parentId)));
}

export function WbsMoveDialog({ rows, items, checkedIds, onSubmit, onClose }: {
  rows: WbsRow[];
  items: WbsItem[];
  checkedIds: ReadonlySet<string>;
  /** 移す。成功したら true（ダイアログは呼び出し側が閉じる） */
  onSubmit: (targetParentId: string | null, position: WbsMovePosition) => Promise<boolean>;
  onClose: () => void;
}) {
  const tops = useMemo(() => wbsMoveTops(rows, checkedIds), [rows, checkedIds]);
  const levelSet = new Set(tops.map(t => t.level));
  const mixed = levelSet.size > 1;
  const level = tops[0]?.level ?? 1;

  // 移動先の候補。1つ上の段の行（チェックの付いた行は除く）。大項目は最上位だけ
  const parentLevel = level - 1;
  const candidateRows = useMemo(
    () => rows.filter(r => r.item.level <= parentLevel && !checkedIds.has(r.item.id)),
    [rows, parentLevel, checkedIds],
  );

  // undefined = まだ選んでいない。大項目を移すときは最上位しか無いので、最初から選んでおく
  const [target, setTarget] = useState<string | null | undefined>(level === 1 ? null : undefined);
  const [position, setPosition] = useState<WbsMovePosition>("tail");
  const [saving, setSaving] = useState(false);
  // BUG-05 移動は await を含むので ref で二重起動を止める
  const savingRef = useRef(false);

  // 今と同じ並びになる移動は受け付けない
  const unchanged = useMemo(() => {
    if (target === undefined) return false;
    const topIds = tops.map(t => t.id);
    const current = siblingsOf(items, target).map(s => s.id);
    const rest = current.filter(id => !topIds.includes(id));
    const next = position === "head" ? [...topIds, ...rest] : [...rest, ...topIds];
    return next.length === current.length && next.every((id, i) => id === current[i]);
  }, [target, position, tops, items]);

  const canSubmit = !mixed && tops.length > 0 && target !== undefined && !unchanged;

  const handleSubmit = async () => {
    if (!canSubmit || savingRef.current || target === undefined) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onSubmit(target, position);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const levelLabel = WBS_LEVEL_LABELS[level - 1] ?? "行";
  const parentLabel = parentLevel >= 1 ? WBS_LEVEL_LABELS[parentLevel - 1] : null;
  const pick = (id: string | null) => setTarget(id);
  const optionStyle = (on: boolean, selectable: boolean, depth: number): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 12px", paddingLeft: 12 + depth * 16,
    textAlign: "left", border: "none", borderBottom: "1px solid rgba(26,23,20,0.05)", fontFamily: "inherit",
    background: on ? "#ECFDF5" : "transparent", cursor: selectable ? "pointer" : "default",
  });

  return (
    <DialogShell title={`行の移動先を選択（${checkedIds.size}行）`} size="md" minHeight={0}
      onClose={saving ? () => {} : onClose} busy={saving}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleSubmit} disabled={!canSubmit} loading={saving}>{saving ? "移動中..." : "移動する"}</BtnPrimary>
      </>}>
      {mixed ? (
        <p style={{ fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "10px 12px", lineHeight: 1.7 }}>
          段の違う行（{[...levelSet].sort().map(l => WBS_LEVEL_LABELS[l - 1]).join("・")}）が選ばれているため、まとめて移動できません。
          移動は段（大項目・中項目・小項目）を変えずに行うので、同じ段の行だけにチェックを付けてください。
        </p>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>
            {parentLabel
              ? `選んだ${levelLabel} ${tops.length} 件を、どの${parentLabel}の下へ移すかを選びます。`
              : `選んだ大項目 ${tops.length} 件を、最上位の並びの中で移します。`}
            下の行も一緒に移ります。段（大項目・中項目・小項目）は変わりません。
          </p>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>移動先</p>
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
              {parentLevel < 1 ? (
                <button type="button" onClick={() => pick(null)} style={optionStyle(target === null, true, 0)}>
                  <FolderInput style={{ width: 14, height: 14, color: "#059669", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "#1A1714" }}>最上位（大項目の並び）</span>
                  {target === null && <Check style={{ width: 14, height: 14, color: "#059669" }} />}
                </button>
              ) : candidateRows.length === 0 ? (
                <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>移動先にできる{parentLabel}がありません。</p>
              ) : candidateRows.map(r => {
                const selectable = r.item.level === parentLevel;
                const on = selectable && target === r.item.id;
                const label = `No.${r.no}　${r.item.name || "（名前なし）"}`;
                return selectable ? (
                  <button key={r.item.id} type="button" onClick={() => pick(r.item.id)} style={optionStyle(on, true, r.item.level - 1)}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: on ? 700 : 500, color: on ? "#059669" : "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                    {on && <Check style={{ width: 14, height: 14, color: "#059669", flexShrink: 0 }} />}
                  </button>
                ) : (
                  // 上の段の行は、どこの下にある行かを分かるようにする見出しとして出す（選べない）
                  <div key={r.item.id} style={{ ...optionStyle(false, false, r.item.level - 1), background: "#F8F9FB" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700, color: "#63748A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>入れる位置</p>
            <div style={{ display: "flex", gap: 8 }}>
              {([["tail", "末尾に追加"], ["head", "先頭に追加"]] as const).map(([value, label]) => {
                const on = position === value;
                return (
                  <button key={value} type="button" onClick={() => setPosition(value)}
                    style={{ flex: 1, padding: "9px 12px", fontSize: 12, fontWeight: 700, borderRadius: 10, cursor: "pointer", fontFamily: "inherit",
                      color: on ? "#059669" : "#6B6458", background: on ? "#ECFDF5" : "#FFFFFF", border: `1.5px solid ${on ? "#059669" : "rgba(26,23,20,0.10)"}` }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {unchanged && <p style={{ fontSize: 12, color: "#A09790" }}>今と同じ位置です。別の移動先か位置を選んでください。</p>}
        </>
      )}
    </DialogShell>
  );
}
