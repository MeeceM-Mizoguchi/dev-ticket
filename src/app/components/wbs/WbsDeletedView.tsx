// KAIZEN2611-022 削除済みのWBSの一覧。
//
// WBSを切り替えるプルダウンの一番下の「削除済み（◯件）」を選ぶと、表とガントの代わりにここが出る。
// 削除したWBSは中身とバックアップを Storage に圧縮して保管してあるので、表示はできない。
// できる操作は「元に戻す」と「完全に削除」（作成者とオーナーだけ。この一覧もその人にだけ出す）。
// 削除済みのWBSは期限なしで残す（自動で完全に削除しない）。
import { Trash2, RotateCcw } from "lucide-react";
import type { WbsSheet } from "@/app/types";
import { WBS_COLORS, wbsToolBtn, wbsToolBtnDisabled } from "./wbsStyles";

function deletedAtText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WbsDeletedView({ sheets, selectedId, busyId, onUndelete, onPurge }: {
  /** 削除済みのWBS（見られる人：作成者とオーナー） */
  sheets: WbsSheet[];
  /** URL で開いたWBS（枠を付けて目立たせる） */
  selectedId: string | null;
  /** 元に戻している・完全に削除している途中のWBS */
  busyId: string | null;
  onUndelete: (sheet: WbsSheet) => void;
  /** 完全に削除（確認は呼び出し側で挟む） */
  onPurge: (sheet: WbsSheet) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 12, padding: "18px 20px" }}>
      <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", display: "flex", alignItems: "center", gap: 6 }}>
        <Trash2 style={{ width: 15, height: 15, color: "#6B6458" }} />削除済みのWBS（{sheets.length}件）
      </p>
      <p style={{ fontSize: 12, color: "#A09790", marginTop: 4, lineHeight: 1.7 }}>
        削除したWBSは、行・ステータス・チケットの紐づけ・このWBSだけの休日・バックアップを圧縮して保管しています（期限はありません）。
        「元に戻す」を押すと、元の一覧に戻り、バックアップの履歴も戻ります。「完全に削除」すると、元に戻せなくなります。
      </p>

      {sheets.length === 0 && (
        <p style={{ fontSize: 13, color: "#A09790", textAlign: "center", padding: "28px 0" }}>削除済みのWBSはありません</p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
        {sheets.map(s => {
          const selected = s.id === selectedId;
          const busy = busyId === s.id;
          return (
            <div key={s.id} style={{
              display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 10,
              border: selected ? "1px solid #059669" : `1px solid ${WBS_COLORS.border}`, background: selected ? "#F0FDF4" : "#FFFFFF",
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</p>
                <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>
                  削除：{deletedAtText(s.deletedAt)}{s.deletedByName ? `（${s.deletedByName}）` : ""}
                </p>
              </div>
              <button type="button" onClick={() => onUndelete(s)} disabled={!!busyId}
                title="このWBSを、行・ステータス・チケットの紐づけ・休日・バックアップの履歴ごと元に戻します"
                style={busyId ? wbsToolBtnDisabled : { ...wbsToolBtn, color: "#059669" }}>
                <RotateCcw style={{ width: 12, height: 12 }} />{busy ? "処理中..." : "元に戻す"}
              </button>
              <button type="button" onClick={() => onPurge(s)} disabled={!!busyId}
                title="このWBSと、保管している中身・バックアップをすべて消します。元に戻せません"
                style={busyId ? wbsToolBtnDisabled : { ...wbsToolBtn, color: "#DC2626" }}>
                <Trash2 style={{ width: 12, height: 12 }} />完全に削除
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
