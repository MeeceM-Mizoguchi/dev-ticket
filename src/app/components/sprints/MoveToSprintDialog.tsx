// BRU6-002-1 一括スプリント移動 ─ 移動先スプリント選択モーダル
//
// 単一チケットの移動UI(TicketDetailPanel の showMoveModal)と同じ見た目・操作感を、
// 複数チケット移動でも使えるよう独立コンポーネント化したもの。ラジオで移動先を1つ選ぶ。

import { useState } from "react";
import type { Sprint } from "@/app/types";
import { computeSprintStatus, getSprintStatusMeta, formatDate } from "@/app/lib/helpers";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { BtnSpinner } from "@/app/components/shared/PageLoader";

export function MoveToSprintDialog({
  sprints, count, excludeSprintId, onClose, onConfirm,
}: {
  sprints: Sprint[];               // 移動先候補（プロジェクト内の全スプリント）
  count: number;                   // 移動対象チケット数（表示用）
  excludeSprintId?: string | null; // 通常は使わない。単一元スプリントを除外したい場合に指定
  onClose: () => void;
  onConfirm: (targetSprintId: string) => void | Promise<void>;
}) {
  const [targetSprintId, setTargetSprintId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const candidates = sprints.filter(s => !excludeSprintId || s.id !== excludeSprintId);

  const handleConfirm = async () => {
    if (!targetSprintId) return;
    setLoading(true);
    try {
      await onConfirm(targetSprintId);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DialogShell title="スプリントへ移動" size="sm" onClose={loading ? () => {} : onClose}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={loading}>キャンセル</BtnSecondary>
        <button type="button" onClick={handleConfirm} disabled={loading || !targetSprintId}
          style={{ padding: "9px 20px", background: loading || !targetSprintId ? "#9CA3AF" : "#059669", color: "#fff", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", cursor: loading || !targetSprintId ? "not-allowed" : "pointer", boxShadow: loading || !targetSprintId ? "none" : "0 2px 8px rgba(5,150,105,0.30)", display: "flex", alignItems: "center" }}>
          {loading && <BtnSpinner />}
          {loading ? "移動中..." : "移動する"}
        </button>
      </>}>
      <p style={{ fontSize: 13, color: "#6B6458", lineHeight: 1.6 }}>
        選択した <strong style={{ color: "#1A1714" }}>{count}件</strong> のチケットの移動先スプリントを選択してください。
        <br />
        <span style={{ fontSize: 11, color: "#A09790" }}>子チケットも一緒に移動します。移動先で採番（WBS）は振り直されます。</span>
      </p>

      {candidates.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#A09790", textAlign: "center", padding: "12px 0" }}>移動先のスプリントがありません</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
          {candidates.map(s => {
            const sm = getSprintStatusMeta(computeSprintStatus(s));
            const active = targetSprintId === s.id;
            return (
              <label key={s.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, cursor: "pointer", border: active ? "1.5px solid #059669" : "1px solid rgba(26,23,20,0.10)", background: active ? "#ECFDF5" : "#FFFFFF", transition: "all 0.12s" }}>
                <input type="radio" name="bulkTargetSprint" checked={active}
                  onChange={() => setTargetSprintId(s.id)}
                  style={{ accentColor: "#059669", width: 15, height: 15, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", borderRadius: 20, background: sm.bg, color: sm.color, flexShrink: 0 }}>{sm.label}</span>
                  </div>
                  {(s.startDate || s.endDate) && (
                    <span style={{ fontSize: 10.5, color: "#B0A9A4", fontFamily: "var(--font-mono)" }}>
                      {formatDate(s.startDate)} → {formatDate(s.endDate)}
                    </span>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </DialogShell>
  );
}
