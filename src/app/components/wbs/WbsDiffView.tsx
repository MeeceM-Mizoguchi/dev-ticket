// KAIZEN2611-015 WBS の「比べる画面」（帯と表）。
//
// 変更の中身（wbsDiff.ts の buildWbsDiff の結果）と warnings を受け取って、新旧を見比べられる形で出すだけの部品。
// AI からの更新の案（KAIZEN2611-015）と、インポートの「変わったところだけ反映する」（KAIZEN2611-016）で使う。
//   ・変わるセル … 旧の値を取り消し線、→ のあとの新の値を紫の背景
//   ・足す行     … 行ごと薄い緑。「追加・小項目」などの印
//   ・大項目・中項目の行 … No と項目名だけ（いつもの表と同じ）
//   ・「変わる行だけ表示」… 最初からオン。変わる行・足す行と、その上の段の行（薄く）だけを出す
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Sparkles, AlertTriangle } from "lucide-react";
import { TruncatedText } from "@/app/components/shared/TruncatedText";
import { WBS_COLORS, wbsToolBtn, wbsToolBtnDisabled } from "@/app/components/wbs/wbsStyles";
import { WBS_LEVEL_LABELS } from "@/app/lib/wbsService";
import { wbsDiffDateText, type WbsDiffField, type WbsDiffModel, type WbsDiffRow } from "@/app/lib/wbsDiff";

const PURPLE = "#7C3AED";
const PURPLE_BG = "#EDE9FE";
const GREEN_BG = "#F0FDF4";
const GREEN = "#16A34A";

const COLUMNS: { field: WbsDiffField | "no"; label: string; width: number | string }[] = [
  { field: "no", label: "No", width: 48 },
  { field: "name", label: "項目名", width: "minmax(220px, 2fr)" },
  { field: "assignee", label: "担当者", width: "minmax(110px, 1fr)" },
  { field: "startDate", label: "開始日", width: 150 },
  { field: "endDate", label: "終了日", width: 150 },
  { field: "progress", label: "進捗率", width: 100 },
  { field: "status", label: "ステータス", width: "minmax(110px, 1fr)" },
  { field: "tickets", label: "チケット", width: "minmax(120px, 1fr)" },
  { field: "note", label: "備考", width: "minmax(140px, 1.4fr)" },
];

function display(field: WbsDiffField, v: string): string {
  if (field === "startDate" || field === "endDate") return wbsDiffDateText(v);
  if (field === "progress") return v === "" ? "" : `${v}%`;
  return v;
}

export function WbsDiffView({
  title, meta, model, warnings, notice, canApply, disabledReason, busy, onApply, onReject, onClose, applyLabel = "この内容で反映",
}: {
  title: string;
  /** 受け取った日時・送った人など、帯の2行目に出すもの */
  meta?: ReactNode;
  model: WbsDiffModel;
  warnings: string[];
  /** 反映できなかった理由など、帯の下に赤く出す文 */
  notice?: string | null;
  canApply: boolean;
  /** 押せないときの理由（マウスを乗せると出す） */
  disabledReason?: string;
  busy: boolean;
  onApply: () => void;
  /** 「取り消す」。無ければ出さない */
  onReject?: () => void;
  onClose: () => void;
  applyLabel?: string;
}) {
  const [onlyChanged, setOnlyChanged] = useState(true);

  // 変わる行・足す行と、その上の段の行（どこの行か分かるように薄く出す）
  const visible = useMemo(() => {
    if (!onlyChanged) return model.rows.map(r => ({ row: r, context: false }));
    const byId = new Map(model.rows.map(r => [r.id, r]));
    const keep = new Set<string>();
    const ctx = new Set<string>();
    for (const r of model.rows) {
      if (r.kind === "same") continue;
      keep.add(r.id);
      for (let p = r.parentId; p; p = byId.get(p)?.parentId ?? null) ctx.add(p);
    }
    return model.rows
      .filter(r => keep.has(r.id) || ctx.has(r.id))
      .map(r => ({ row: r, context: !keep.has(r.id) }));
  }, [model.rows, onlyChanged]);

  const nothing = model.changedCount === 0 && model.addedCount === 0;
  const gridTemplateColumns = COLUMNS.map(c => (typeof c.width === "number" ? `${c.width}px` : c.width)).join(" ");

  const applyDisabled = !canApply || busy || nothing;
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      {/* 帯 */}
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "9px 12px", background: "#F5F3FF", border: `1px solid ${PURPLE}33`, borderRadius: 10, flexWrap: "wrap" }}>
        <Sparkles style={{ width: 15, height: 15, color: PURPLE, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 800, color: "#3B0764" }}>{title}</p>
          {meta && <p style={{ fontSize: 11, color: "#6B6458", marginTop: 2 }}>{meta}</p>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700 }}>
          <span style={{ padding: "2px 8px", borderRadius: 20, background: PURPLE_BG, color: PURPLE }}>変わる行 {model.changedCount}</span>
          <span style={{ padding: "2px 8px", borderRadius: 20, background: "#DCFCE7", color: GREEN }}>追加 {model.addedCount}</span>
          <span style={{ padding: "2px 8px", borderRadius: 20, background: warnings.length ? "#FEF3C7" : "#F4F5F6", color: warnings.length ? "#B45309" : "#9E9690" }}>注意 {warnings.length}</span>
        </div>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#4B4640", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} />
          変わる行だけ表示
        </label>
        <div style={{ flex: 1 }} />
        {/* 押せないボタンにはマウスを乗せても説明が出ないブラウザがあるので、外側の span に持たせる */}
        <span title={applyDisabled && disabledReason ? disabledReason : undefined} style={{ display: "inline-flex" }}>
          <button type="button" onClick={onApply} disabled={applyDisabled}
            style={applyDisabled ? { ...wbsToolBtnDisabled, pointerEvents: "none" } : { ...wbsToolBtn, color: "#FFFFFF", background: PURPLE, border: `1px solid ${PURPLE}` }}>
            {busy ? "処理中…" : applyLabel}
          </button>
        </span>
        {onReject && (
          <span title={!canApply && disabledReason ? disabledReason : undefined} style={{ display: "inline-flex" }}>
            <button type="button" onClick={onReject} disabled={!canApply || busy}
              style={!canApply || busy ? { ...wbsToolBtnDisabled, pointerEvents: "none" } : { ...wbsToolBtn, color: "#B91C1C" }}>
              取り消す
            </button>
          </span>
        )}
        <button type="button" onClick={onClose} disabled={busy} style={busy ? wbsToolBtnDisabled : wbsToolBtn}>閉じる</button>
      </div>

      {notice && (
        <div style={{ flexShrink: 0, padding: "7px 12px", background: WBS_COLORS.delayBg, color: WBS_COLORS.delayText, borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
          {notice}
        </div>
      )}

      {warnings.length > 0 && (
        <div style={{ flexShrink: 0, maxHeight: 120, overflowY: "auto", padding: "7px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8 }}>
          {warnings.map((w, i) => (
            <p key={i} style={{ fontSize: 12, color: "#92400E", lineHeight: 1.7, display: "flex", gap: 6 }}>
              <AlertTriangle style={{ width: 12, height: 12, flexShrink: 0, marginTop: 4 }} />{w}
            </p>
          ))}
        </div>
      )}

      {/* 表 */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 10 }}>
        <div style={{ display: "grid", gridTemplateColumns, minWidth: 1100 }}>
          {COLUMNS.map(c => (
            <div key={c.field} style={{ position: "sticky", top: 0, zIndex: 1, background: WBS_COLORS.headBg, color: WBS_COLORS.headText, fontSize: 11, fontWeight: 700, padding: "7px 8px", whiteSpace: "nowrap" }}>
              {c.label}
            </div>
          ))}
          {visible.length === 0 ? (
            <div style={{ gridColumn: "1 / -1", padding: "32px 0", textAlign: "center", fontSize: 13, color: "#A09790" }}>
              {nothing ? "変わるところはありません" : "表示する行がありません"}
            </div>
          ) : visible.map(({ row, context }) => (
            <DiffRow key={row.id} row={row} context={context} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DiffRow({ row, context }: { row: WbsDiffRow; context: boolean }) {
  const isAdded = row.kind === "added";
  const bg = isAdded ? GREEN_BG : "#FFFFFF";
  const cellBase = {
    padding: "6px 8px", fontSize: 12, color: WBS_COLORS.text, borderBottom: `1px solid ${WBS_COLORS.border}`,
    background: bg, opacity: context ? 0.45 : 1, minWidth: 0, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" as const,
  };
  const levelLabel = WBS_LEVEL_LABELS[Math.min(Math.max(row.level, 1), 3) - 1];
  return (
    <>
      <div style={{ ...cellBase, color: WBS_COLORS.subText, fontFamily: "var(--font-mono)" }}>{row.no}</div>
      {COLUMNS.slice(1).map(c => {
        const f = c.field as WbsDiffField;
        // 上の段の行は、いつもの表と同じく項目名だけ
        if (!row.isLeaf && f !== "name") return <div key={f} style={cellBase} />;
        const cell = row.cells[f];
        if (f === "name") {
          return (
            <div key={f} style={{ ...cellBase, paddingLeft: 8 + (row.level - 1) * 16, flexWrap: "nowrap" }}>
              {isAdded && (
                <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: "#DCFCE7", color: GREEN, flexShrink: 0 }}>追加・{levelLabel}</span>
              )}
              {row.moved && (
                <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 6px", borderRadius: 10, background: PURPLE_BG, color: PURPLE, flexShrink: 0 }}>並べ替え</span>
              )}
              {cell.changed ? <Changed field={f} cell={cell} /> : (
                <TruncatedText text={cell.after || "(名前なし)"} style={{ fontWeight: row.isLeaf ? 500 : 700, minWidth: 0 }} />
              )}
            </div>
          );
        }
        return (
          <div key={f} style={cellBase}>
            {cell.changed ? <Changed field={f} cell={cell} /> : <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{display(f, cell.after)}</span>}
          </div>
        );
      })}
    </>
  );
}

function Changed({ field, cell }: { field: WbsDiffField; cell: { before: string; after: string } }) {
  const before = display(field, cell.before);
  const after = display(field, cell.after);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexWrap: "wrap", minWidth: 0 }}>
      <s style={{ color: "#9E9690" }}>{before || "（空）"}</s>
      <span style={{ color: "#9E9690" }}>→</span>
      <span style={{ background: PURPLE_BG, color: "#5B21B6", fontWeight: 700, padding: "0 5px", borderRadius: 4, wordBreak: "break-all" }}>{after || "（空）"}</span>
    </span>
  );
}
