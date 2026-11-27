// KAIZEN2611-021 「WBSの設定」のモーダル。
//
// 行の削除のつもりで WBS 全体の「削除」を押してしまう誤操作が多かったため、あまり使わない操作
// （名前変更・段数・公開設定・ステータス設定・休日設定・ロック・アーカイブ・WBSの削除）を画面の上から外し、
// 「設定」ボタンから開くこのモーダルにまとめる。処理そのもの（確認ダイアログ・保存・権限）は今のまま呼ぶだけ。
//
//   ・ダイアログを開く項目は、このモーダルを閉じてから今のダイアログを開く（重ねない）
//   ・段数はこの中のプルダウンで変える（減らせないときは、今と同じ「段数を減らせません」が出る）
//   ・WBSの削除・アーカイブは、いちばん下の「危険な操作」の区画に、線で分けて置く
//   ・使えない項目は押せない形で出し、理由を今と同じ文で出す
import type { ReactNode } from "react";
import { Pencil, Trash2, Globe, Lock, LockKeyhole, LockKeyholeOpen, Archive, Tags, CalendarOff, Layers } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { PickerCell } from "@/app/components/tasks/TaskPickerCell";
import { WBS_LEVEL_OPTIONS } from "@/app/lib/wbsService";
import type { WbsLevels, WbsSheet } from "@/app/types";
import { wbsToolBtn, wbsToolBtnDisabled } from "./wbsStyles";

/** ロック中に削除へ出す説明（WbsSheetBar にあったものと同じ文） */
const LOCKED_DELETE_HINT = "このWBSはロックされているため削除できません。削除する場合はロックを解除してください";
const EDIT_ONLY_HINT = "WBSの権限が「編集可」の人だけが変更できます";
const MANAGE_ONLY_VISIBILITY_HINT = "公開設定を変更できるのは、作成者とオーナーです";
const MANAGE_ONLY_DELETE_HINT = "WBSを削除できるのは、作成者とオーナーです";
const VIEWING_HINT = "過去の時点を表示している間は変更できません。「今の状態に戻る」を押してから操作してください";

function Row({ icon, label, desc, children }: { icon: ReactNode; label: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid rgba(26,23,20,0.06)" }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B6458", flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{label}</p>
        {desc && <p style={{ fontSize: 11, color: "#8A847C", marginTop: 2, lineHeight: 1.6 }}>{desc}</p>}
      </div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6 }}>{children}</div>
    </div>
  );
}

/** 押せるときは押せる、押せないときは理由をマウスに出すボタン */
function ActionBtn({ label, onClick, disabledReason, danger, icon }: { label: string; onClick: () => void; disabledReason?: string; danger?: boolean; icon?: ReactNode }) {
  if (disabledReason) {
    // 押せないボタンにはマウスを乗せても説明が出ないブラウザがあるので、外側の span に持たせる
    return (
      <span title={disabledReason} style={{ display: "inline-flex", flexShrink: 0 }}>
        <button type="button" disabled aria-label={`${label}（${disabledReason}）`} style={{ ...wbsToolBtnDisabled, pointerEvents: "none" }}>{icon}{label}</button>
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} style={danger ? { ...wbsToolBtn, color: "#DC2626", borderColor: "rgba(220,38,38,0.35)" } : wbsToolBtn}>
      {icon}{label}
    </button>
  );
}

export function WbsSettingsDialog({
  sheet, canEdit, canManage, viewing, onClose,
  onRename, onChangeLevels, onOpenVisibility, onOpenStatus, onOpenHoliday, onLock, onUnlock, onArchive, onDelete,
}: {
  sheet: WbsSheet;
  /** WBSの権限が「編集可」か（過去の時点の表示とは別に渡す） */
  canEdit: boolean;
  /** 公開設定の変更と削除ができるか（作成者・オーナー） */
  canManage: boolean;
  /** 過去の時点（バックアップ）を表示している間か。変更の操作をすべて押せなくする */
  viewing: boolean;
  onClose: () => void;
  onRename: () => void;
  onChangeLevels: (levels: WbsLevels) => void;
  onOpenVisibility: () => void;
  onOpenStatus: () => void;
  onOpenHoliday: () => void;
  onLock: () => void;
  onUnlock: () => void;
  /** 渡さなければアーカイブを出さない（バックアップの仕組みがある環境だけ） */
  onArchive?: () => void;
  onDelete: () => void;
}) {
  // 押したら、このモーダルを閉じてから次の操作（ダイアログ）へ進む
  const then = (fn: () => void) => () => { onClose(); fn(); };
  const editReason = viewing ? VIEWING_HINT : !canEdit ? EDIT_ONLY_HINT : undefined;
  const VisIcon = sheet.visibility === "members" ? Lock : Globe;
  const visLabel = sheet.visibility === "members" ? "指定したメンバーのみ" : "全メンバーに公開";
  const deleteReason = viewing ? VIEWING_HINT : !canManage ? MANAGE_ONLY_DELETE_HINT : sheet.isLocked ? LOCKED_DELETE_HINT : undefined;
  const icon = (C: typeof Pencil) => <C style={{ width: 13, height: 13 }} />;

  return (
    <DialogShell title="WBSの設定" size="md" minHeight={0} onClose={onClose}
      footer={<BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
      <p style={{ fontSize: 12, color: "#6B6458", lineHeight: 1.7 }}>「{sheet.name}」の設定です。</p>

      <div>
        <Row icon={icon(Pencil)} label="名前変更" desc={sheet.name}>
          <ActionBtn label="変更" onClick={then(onRename)} disabledReason={editReason} />
        </Row>

        <Row icon={icon(Layers)} label="段数" desc="減らすときは、減らす段に行が残っていると変更できません">
          {/* 一覧は body の直下に出て position:fixed で置かれる（モーダルの枠に切られない） */}
          <span title={editReason} style={{ display: "inline-flex" }}>
            <PickerCell variant="chip" value={String(sheet.levels)} disabled={!!editReason} title="項目の段数"
              onChange={v => { const lv = Number(v) as WbsLevels; if (lv !== sheet.levels) { onClose(); onChangeLevels(lv); } }}
              options={WBS_LEVEL_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))}
              textStyle={{ height: 30, padding: "0 10px", fontSize: 12, color: "#1A1714" }} />
          </span>
        </Row>

        <Row icon={<VisIcon style={{ width: 13, height: 13 }} />} label="公開設定" desc={visLabel}>
          <ActionBtn label="変更" onClick={then(onOpenVisibility)} disabledReason={viewing ? VIEWING_HINT : !canManage ? MANAGE_ONLY_VISIBILITY_HINT : undefined} />
        </Row>

        <Row icon={icon(Tags)} label="ステータス設定" desc="ステータスの名前・色・並び順">
          <ActionBtn label="開く" onClick={then(onOpenStatus)} disabledReason={editReason} />
        </Row>

        <Row icon={icon(CalendarOff)} label="休日設定" desc="土日のほかに休みにする日">
          <ActionBtn label="開く" onClick={then(onOpenHoliday)} disabledReason={editReason} />
        </Row>

        {/* BRU22-008 ロック。列が無い環境（isLocked が null）では出さない */}
        {sheet.isLocked !== null && (
          <Row icon={sheet.isLocked ? icon(LockKeyhole) : icon(LockKeyholeOpen)} label="ロック"
            desc={sheet.isLocked ? "ロック中です。ロックを解除するまで削除できません" : "ロックすると、誤って削除されないようにできます"}>
            {sheet.isLocked
              ? <ActionBtn label="ロック解除" icon={icon(LockKeyholeOpen)} onClick={then(onUnlock)} disabledReason={editReason} />
              : <ActionBtn label="ロックする" icon={icon(LockKeyhole)} onClick={then(onLock)} disabledReason={editReason} />}
          </Row>
        )}
      </div>

      {/* 危険な操作。ほかの項目と線で分ける */}
      <div style={{ marginTop: 6, border: "1px solid rgba(220,38,38,0.25)", borderRadius: 12, padding: "4px 14px", background: "#FFFBFB" }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: "#B91C1C", padding: "8px 0 2px" }}>危険な操作</p>
        {onArchive && (
          <Row icon={icon(Archive)} label="アーカイブ" desc="圧縮して保管し、一覧から外します（プルダウンの「アーカイブ済み」から戻せます）">
            <ActionBtn label="アーカイブ" onClick={then(onArchive)} disabledReason={editReason} />
          </Row>
        )}
        <div style={{ borderBottom: "none" }}>
          <Row icon={<Trash2 style={{ width: 13, height: 13, color: "#DC2626" }} />} label="WBSの削除" desc="このWBSそのものを削除します（行の削除ではありません）">
            <ActionBtn label="WBSを削除" danger icon={<Trash2 style={{ width: 12, height: 12 }} />} onClick={then(onDelete)} disabledReason={deleteReason} />
          </Row>
        </div>
      </div>
    </DialogShell>
  );
}
