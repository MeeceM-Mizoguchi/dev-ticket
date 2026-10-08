// ENHA2-053 WBS画面の上部の操作列。
// WBSの切り替え・新規作成・名前変更・削除・段数・公開設定を並べる。
import type { ReactNode } from "react";
import { Plus, Pencil, Trash2, Globe, Lock } from "lucide-react";
import { WBS_LEVEL_OPTIONS } from "@/app/lib/wbsService";
import type { WbsLevels, WbsSheet } from "@/app/types";
import { wbsToolBtn, wbsToolLabel, wbsToolSelect } from "./wbsStyles";

export function WbsSheetBar({ sheets, current, canEdit, canManage, onSelect, onCreate, onRename, onDelete, onChangeLevels, onOpenVisibility, children }: {
  sheets: WbsSheet[];
  current: WbsSheet | null;
  /** WBSの権限が「編集可」か */
  canEdit: boolean;
  /** 公開設定の変更と削除ができるか（作成者・オーナー） */
  canManage: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  onChangeLevels: (levels: WbsLevels) => void;
  onOpenVisibility: () => void;
  /** 右側に足す操作（ステータス設定など） */
  children?: ReactNode;
}) {
  const VisIcon = current?.visibility === "members" ? Lock : Globe;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      <select value={current?.id ?? ""} onChange={e => onSelect(e.target.value)} title="WBSを切り替える"
        style={{ ...wbsToolSelect, minWidth: 180, maxWidth: 320, fontWeight: 700 }}>
        {sheets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>

      {canEdit && current && (
        <button type="button" onClick={onRename} title="名前を変更" style={wbsToolBtn}>
          <Pencil style={{ width: 12, height: 12 }} />名前変更
        </button>
      )}
      {canManage && current && (
        <button type="button" onClick={onDelete} title="このWBSを削除" style={{ ...wbsToolBtn, color: "#DC2626" }}>
          <Trash2 style={{ width: 12, height: 12 }} />削除
        </button>
      )}

      {current && (
        <>
          <span style={{ ...wbsToolLabel, marginLeft: 6 }}>段数</span>
          {/* 選べるのは3段まで。4段以上の選択肢は置かない */}
          <select value={current.levels} disabled={!canEdit} title="項目の段数"
            onChange={e => onChangeLevels(Number(e.target.value) as WbsLevels)}
            style={{ ...wbsToolSelect, cursor: canEdit ? "pointer" : "default" }}>
            {WBS_LEVEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          {canManage ? (
            <button type="button" onClick={onOpenVisibility} title="公開設定を変更" style={wbsToolBtn}>
              <VisIcon style={{ width: 12, height: 12 }} />
              {current.visibility === "members" ? "指定したメンバーのみ" : "全メンバーに公開"}
            </button>
          ) : (
            <span title="公開設定を変更できるのは、作成者とオーナーです"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6B6458", whiteSpace: "nowrap" }}>
              <VisIcon style={{ width: 12, height: 12 }} />
              {current.visibility === "members" ? "指定したメンバーのみ" : "全メンバーに公開"}
            </span>
          )}
        </>
      )}

      {children}

      <div style={{ flex: 1 }} />
      {canEdit && (
        <button type="button" onClick={onCreate} style={{ ...wbsToolBtn, color: "#FFFFFF", background: "#059669", border: "1px solid #059669" }}>
          <Plus style={{ width: 13, height: 13 }} />新しいWBS
        </button>
      )}
    </div>
  );
}
