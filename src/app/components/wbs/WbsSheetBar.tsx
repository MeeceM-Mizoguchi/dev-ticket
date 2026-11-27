// ENHA2-053 WBS画面の上部の操作列。
// WBSの切り替え・新規作成を並べる。
// KAIZEN2611-021 名前変更・削除・ロック・段数・公開設定・アーカイブは、行の削除との押し間違いを防ぐため
// 「設定」ボタンから開くモーダル（WbsSettingsDialog）にまとめた。ここには置かない。
// KAIZEN2611-004 バックアップの日付の選択（過去の時点の表示）と、アーカイブ・アーカイブ済みの入口も置く。
// KAIZEN2611-013 「AIで更新」（会議の文字起こしなどから、AI が API で WBS を更新する手順書のコピー）の入口も置く。
import type { ReactNode } from "react";
import { Plus, BookOpen, Link2, CalendarRange, LockKeyhole, History, Sparkles, Settings } from "lucide-react";
import { wbsSnapshotLabel } from "@/app/lib/wbsService";
import type { WbsSheet, WbsSnapshotMeta } from "@/app/types";
import { PickerCell } from "@/app/components/tasks/TaskPickerCell";
import { wbsToolBtn, wbsToolLabel } from "./wbsStyles";

/** WBSを切り替えるプルダウンの、アーカイブ済みの一覧へ移る選択肢の値（WBSの id とは重ならない） */
const ARCHIVED_OPTION = "__archived__";
/** KAIZEN2611-022 削除済みの一覧へ移る選択肢の値 */
const DELETED_OPTION = "__deleted__";

export function WbsSheetBar({
  sheets, current, canEdit, onSelect, onCreate, onOpenManual, onCopyUrl, onOpenMaster, onOpenSettings,
  archivedCount = 0, archivedSelected = false, onOpenArchived,
  deletedCount = 0, deletedSelected = false, onOpenDeleted,
  snapshots = [], snapshotId = "", snapshotLoadingId = null, onSelectSnapshot, onOpenAiUpdate, children,
}: {
  /** 切り替えの候補（アーカイブしていないWBS） */
  sheets: WbsSheet[];
  /** 開いているWBS。アーカイブ済みの一覧を開いているときは null */
  current: WbsSheet | null;
  /** WBSの権限が「編集可」か（過去の時点を表示している間は false） */
  canEdit: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  /** 使い方（マニュアル）を開く。閲覧のみの人にも出す */
  onOpenManual: () => void;
  /** いま開いているWBSのURLをコピーする。閲覧のみの人にも出す */
  onCopyUrl: () => void;
  /** マスタースケジュールの画面へ移る。閲覧のみの人にも出す */
  onOpenMaster: () => void;
  /**
   * KAIZEN2611-021 「WBSの設定」のモーダルを開く（名前変更・段数・公開設定・ステータス設定・休日設定・ロック・
   * アーカイブ・WBSの削除）。渡さなければボタンを出さない（閲覧のみの人には渡さない）
   */
  onOpenSettings?: () => void;
  /** KAIZEN2611-004 アーカイブ済みのWBSの数。1件以上あれば、切り替えのプルダウンの一番下に出す */
  archivedCount?: number;
  /** アーカイブ済みの一覧を開いているか */
  archivedSelected?: boolean;
  onOpenArchived?: () => void;
  /** KAIZEN2611-022 削除済みのWBSの数（作成者・オーナーが見られるもの）。1件以上あれば、プルダウンのいちばん下に出す */
  deletedCount?: number;
  /** 削除済みの一覧を開いているか */
  deletedSelected?: boolean;
  onOpenDeleted?: () => void;
  /** バックアップの一覧（新しい順）。onSelectSnapshot を渡したときだけ日付の選択を出す */
  snapshots?: WbsSnapshotMeta[];
  /** 表示中のバックアップ。"" は今の状態 */
  snapshotId?: string;
  /** 中身を読み込み中のバックアップ */
  snapshotLoadingId?: string | null;
  /** 日付を選んだ（"" は今の状態に戻る） */
  onSelectSnapshot?: (id: string) => void;
  /** KAIZEN2611-013 「AIで更新」の手順書を開く。渡さなければボタンを出さない（編集可の人だけに渡す） */
  onOpenAiUpdate?: () => void;
  /** 右側に足す操作 */
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      {/* プルダウンはブラウザ標準の <select> ではなく、タスク画面と同じ PickerCell を使う */}
      <PickerCell variant="chip" value={archivedSelected ? ARCHIVED_OPTION : deletedSelected ? DELETED_OPTION : current?.id ?? ""} title="WBSを切り替える"
        onChange={v => { if (v === ARCHIVED_OPTION) onOpenArchived?.(); else if (v === DELETED_OPTION) onOpenDeleted?.(); else onSelect(v); }}
        options={[
          ...sheets.map(s => ({ value: s.id, label: s.name })),
          ...(archivedCount > 0 ? [{ value: ARCHIVED_OPTION, label: `アーカイブ済み（${archivedCount}件）` }] : []),
          ...(deletedCount > 0 ? [{ value: DELETED_OPTION, label: `削除済み（${deletedCount}件）` }] : []),
        ]}
        textStyle={{ minWidth: 180, maxWidth: 320, height: 30, padding: "0 10px", fontSize: 12, fontWeight: 700, color: "#1A1714" }} />

      {/* BRU22-008 ロック中の印（ロックの付け外しは「設定」から）。列が無い環境（isLocked が null）では出さない */}
      {current?.isLocked && (
        <span title="このWBSはロック中です。ロックを解除するまで削除できません（ロックの解除は「設定」から）"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", fontSize: 11, fontWeight: 700, color: "#B45309", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>
          <LockKeyhole style={{ width: 11, height: 11 }} />ロック中
        </span>
      )}

      {/* KAIZEN2611-004 過去の時点の表示。閲覧のみの人にも出す */}
      {current && onSelectSnapshot && (
        <>
          <span style={{ ...wbsToolLabel, marginLeft: 6, display: "inline-flex", alignItems: "center", gap: 3 }}>
            <History style={{ width: 11, height: 11 }} />バックアップ
          </span>
          <span title={snapshots.length === 0 ? "バックアップはまだありません（毎日 3:00 に、前日から変更があったWBSだけ取ります）" : "日付を選ぶと、その時点のWBSを表示します（編集はできません）"}
            style={{ display: "inline-flex", flexShrink: 0 }}>
            <PickerCell variant="chip" value={snapshotId} disabled={snapshots.length === 0 || !!snapshotLoadingId} title="バックアップの日付"
              onChange={onSelectSnapshot}
              options={[
                { value: "", label: "今の状態" },
                ...snapshots.map(s => ({ value: s.id, label: wbsSnapshotLabel(s) })),
              ]}
              textStyle={{ minWidth: 120, height: 30, padding: "0 10px", fontSize: 12, color: "#1A1714" }} />
          </span>
          {snapshotLoadingId && <span style={{ fontSize: 11, color: "#A09790", whiteSpace: "nowrap" }}>読み込み中...</span>}
        </>
      )}

      {children}

      <div style={{ flex: 1 }} />
      {canEdit && current && onOpenAiUpdate && (
        <button type="button" onClick={onOpenAiUpdate}
          title="会議の文字起こしなどと一緒にAIへ渡す手順をコピーします。AIが決まったこと（日程・担当・進捗・新しい作業）をこのWBSに反映します"
          style={{ ...wbsToolBtn, color: "#7C3AED" }}>
          <Sparkles style={{ width: 12, height: 12 }} />AIで更新
        </button>
      )}
      {current && (
        <button type="button" onClick={onOpenMaster} title="大項目だけを並べた全体の日程（マスタースケジュール）を見る" style={wbsToolBtn}>
          <CalendarRange style={{ width: 12, height: 12 }} />マスタースケジュール
        </button>
      )}
      {current && (
        <button type="button" onClick={onCopyUrl} title="このWBSのURLをコピーして、メンバーに共有できます" style={wbsToolBtn}>
          <Link2 style={{ width: 12, height: 12 }} />URLをコピー
        </button>
      )}
      <button type="button" onClick={onOpenManual} title="WBS の使い方を見る" style={wbsToolBtn}>
        <BookOpen style={{ width: 12, height: 12 }} />マニュアル
      </button>
      {canEdit && (
        <button type="button" onClick={onCreate} style={{ ...wbsToolBtn, color: "#FFFFFF", background: "#059669", border: "1px solid #059669" }}>
          <Plus style={{ width: 13, height: 13 }} />新しいWBS
        </button>
      )}
      {current && onOpenSettings && (
        <button type="button" onClick={onOpenSettings}
          title="名前変更・段数・公開設定・ステータス設定・休日設定・ロック・アーカイブ・WBSの削除" style={wbsToolBtn}>
          <Settings style={{ width: 12, height: 12 }} />設定
        </button>
      )}
    </div>
  );
}
