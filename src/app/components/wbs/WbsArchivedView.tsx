// KAIZEN2611-004 アーカイブ済みのWBSの一覧。
//
// WBSを切り替えるプルダウンの一番下の「アーカイブ済み（◯件）」を選ぶと、表とガントの代わりにここが出る。
// アーカイブしたWBSは中身とバックアップを Storage へ移してあるので、表示はできない。
// できる操作は「アーカイブから戻す」だけ（WBSの権限が「編集可」の人）。
import { Archive, ArchiveRestore } from "lucide-react";
import type { WbsSheet } from "@/app/types";
import { WBS_COLORS, wbsToolBtn, wbsToolBtnDisabled } from "./wbsStyles";

function archivedAtText(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function WbsArchivedView({ sheets, selectedId, canEdit, busyId, onUnarchive }: {
  /** アーカイブ済みのWBS */
  sheets: WbsSheet[];
  /** URL で開いたWBS（枠を付けて目立たせる） */
  selectedId: string | null;
  canEdit: boolean;
  /** アーカイブから戻している途中のWBS */
  busyId: string | null;
  onUnarchive: (sheet: WbsSheet) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#FFFFFF", border: `1px solid ${WBS_COLORS.border}`, borderRadius: 12, padding: "18px 20px" }}>
      <p style={{ fontSize: 14, fontWeight: 800, color: "#1A1714", display: "flex", alignItems: "center", gap: 6 }}>
        <Archive style={{ width: 15, height: 15, color: "#6B6458" }} />アーカイブ済みのWBS（{sheets.length}件）
      </p>
      <p style={{ fontSize: 12, color: "#A09790", marginTop: 4, lineHeight: 1.7 }}>
        アーカイブしたWBSは、行・ステータス・チケットの紐づけ・バックアップを圧縮して保管しています。
        {canEdit ? "「アーカイブから戻す」を押すと、元の一覧に戻り、バックアップの履歴も戻ります。" : "戻すことができるのは、WBSの権限が「編集可」の人です。"}
      </p>

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
                  アーカイブ：{archivedAtText(s.archivedAt)}{s.archivedByName ? `（${s.archivedByName}）` : ""}
                </p>
              </div>
              {canEdit && (
                <button type="button" onClick={() => onUnarchive(s)} disabled={!!busyId}
                  title="このWBSを、行・ステータス・チケットの紐づけ・バックアップの履歴ごと元に戻します"
                  style={busyId ? wbsToolBtnDisabled : { ...wbsToolBtn, color: "#059669" }}>
                  <ArchiveRestore style={{ width: 12, height: 12 }} />{busy ? "戻しています..." : "アーカイブから戻す"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
