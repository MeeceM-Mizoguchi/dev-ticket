// ENHA2-053 WBS画面の上部の操作列。
// WBSの切り替え・新規作成・名前変更・削除・段数・公開設定を並べる。
// KAIZEN2611-004 バックアップの日付の選択（過去の時点の表示）と、アーカイブ・アーカイブ済みの入口も置く。
// KAIZEN2611-013 「AIで更新」（会議の文字起こしなどから、AI が API で WBS を更新する手順書のコピー）の入口も置く。
import type { ReactNode } from "react";
import { Plus, Pencil, Trash2, Globe, Lock, BookOpen, Link2, CalendarRange, LockKeyhole, LockKeyholeOpen, Archive, History, Sparkles } from "lucide-react";
import { WBS_LEVEL_OPTIONS, wbsSnapshotLabel } from "@/app/lib/wbsService";
import type { WbsLevels, WbsSheet, WbsSnapshotMeta } from "@/app/types";
import { PickerCell } from "@/app/components/tasks/TaskPickerCell";
import { wbsToolBtn, wbsToolBtnDisabled, wbsToolLabel } from "./wbsStyles";

/** ロック中に削除ボタンへ出す説明 */
const LOCKED_DELETE_HINT = "このWBSはロックされているため削除できません。削除する場合はロックを解除してください";

/** WBSを切り替えるプルダウンの、アーカイブ済みの一覧へ移る選択肢の値（WBSの id とは重ならない） */
const ARCHIVED_OPTION = "__archived__";

export function WbsSheetBar({
  sheets, current, canEdit, canManage, onSelect, onCreate, onRename, onDelete, onLock, onUnlock, onChangeLevels, onOpenVisibility, onOpenManual, onCopyUrl, onOpenMaster,
  archivedCount = 0, archivedSelected = false, onOpenArchived, onArchive,
  snapshots = [], snapshotId = "", snapshotLoadingId = null, onSelectSnapshot, onOpenAiUpdate, children,
}: {
  /** 切り替えの候補（アーカイブしていないWBS） */
  sheets: WbsSheet[];
  /** 開いているWBS。アーカイブ済みの一覧を開いているときは null */
  current: WbsSheet | null;
  /** WBSの権限が「編集可」か */
  canEdit: boolean;
  /** 公開設定の変更と削除ができるか（作成者・オーナー） */
  canManage: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** BRU22-008 ロックする（誤削除の防止） */
  onLock: () => void;
  /** BRU22-008 ロックを解除する（確認は呼び出し側で挟む） */
  onUnlock: () => void;
  onChangeLevels: (levels: WbsLevels) => void;
  onOpenVisibility: () => void;
  /** 使い方（マニュアル）を開く。閲覧のみの人にも出す */
  onOpenManual: () => void;
  /** いま開いているWBSのURLをコピーする。閲覧のみの人にも出す */
  onCopyUrl: () => void;
  /** マスタースケジュールの画面へ移る。閲覧のみの人にも出す */
  onOpenMaster: () => void;
  /** KAIZEN2611-004 アーカイブ済みのWBSの数。1件以上あれば、切り替えのプルダウンの一番下に出す */
  archivedCount?: number;
  /** アーカイブ済みの一覧を開いているか */
  archivedSelected?: boolean;
  onOpenArchived?: () => void;
  /** このWBSをアーカイブする（確認は呼び出し側で挟む）。渡さなければボタンを出さない */
  onArchive?: () => void;
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
  /** 右側に足す操作（ステータス設定など） */
  children?: ReactNode;
}) {
  const VisIcon = current?.visibility === "members" ? Lock : Globe;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      {/* プルダウンはブラウザ標準の <select> ではなく、タスク画面と同じ PickerCell を使う */}
      <PickerCell variant="chip" value={archivedSelected ? ARCHIVED_OPTION : current?.id ?? ""} title="WBSを切り替える"
        onChange={v => { if (v === ARCHIVED_OPTION) onOpenArchived?.(); else onSelect(v); }}
        options={[
          ...sheets.map(s => ({ value: s.id, label: s.name })),
          ...(archivedCount > 0 ? [{ value: ARCHIVED_OPTION, label: `アーカイブ済み（${archivedCount}件）` }] : []),
        ]}
        textStyle={{ minWidth: 180, maxWidth: 320, height: 30, padding: "0 10px", fontSize: 12, fontWeight: 700, color: "#1A1714" }} />

      {canEdit && current && (
        <button type="button" onClick={onRename} title="名前を変更" style={wbsToolBtn}>
          <Pencil style={{ width: 12, height: 12 }} />名前変更
        </button>
      )}
      {canManage && current && (current.isLocked ? (
        // ロック中は押せない。押せないボタンにはマウスを乗せても説明が出ないブラウザがあるので、外側の span に持たせる
        <span title={LOCKED_DELETE_HINT} style={{ display: "inline-flex", flexShrink: 0 }}>
          <button type="button" disabled aria-label={`削除（${LOCKED_DELETE_HINT}）`} style={{ ...wbsToolBtnDisabled, pointerEvents: "none" }}>
            <Trash2 style={{ width: 12, height: 12 }} />削除
          </button>
        </span>
      ) : (
        <button type="button" onClick={onDelete} title="このWBSを削除" style={{ ...wbsToolBtn, color: "#DC2626" }}>
          <Trash2 style={{ width: 12, height: 12 }} />削除
        </button>
      ))}
      {/* BRU22-008 ロック。列が無い環境（isLocked が null）では出さない */}
      {current && current.isLocked !== null && (current.isLocked ? (
        <>
          <span title="このWBSはロック中です。ロックを解除するまで削除できません"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, height: 24, padding: "0 9px", fontSize: 11, fontWeight: 700, color: "#B45309", background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 20, whiteSpace: "nowrap", flexShrink: 0 }}>
            <LockKeyhole style={{ width: 11, height: 11 }} />ロック中
          </span>
          {canEdit && (
            <button type="button" onClick={onUnlock} title="ロックを解除します（解除すると削除できるようになります）" style={wbsToolBtn}>
              <LockKeyholeOpen style={{ width: 12, height: 12 }} />ロック解除
            </button>
          )}
        </>
      ) : canEdit && (
        <button type="button" onClick={onLock} title="このWBSをロックして、誤って削除されないようにします" style={wbsToolBtn}>
          <LockKeyhole style={{ width: 12, height: 12 }} />ロックする
        </button>
      ))}

      {current && (
        <>
          <span style={{ ...wbsToolLabel, marginLeft: 6 }}>段数</span>
          {/* 選べるのは3段まで。4段以上の選択肢は置かない */}
          <PickerCell variant="chip" value={String(current.levels)} disabled={!canEdit} title="項目の段数"
            onChange={v => onChangeLevels(Number(v) as WbsLevels)}
            options={WBS_LEVEL_OPTIONS.map(o => ({ value: String(o.value), label: o.label }))}
            textStyle={{ height: 30, padding: "0 10px", fontSize: 12, color: "#1A1714" }} />

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
      {canEdit && current && onArchive && (
        <button type="button" onClick={onArchive}
          title="このWBSを圧縮して保管し、一覧から外します（プルダウンの「アーカイブ済み」から戻せます）" style={wbsToolBtn}>
          <Archive style={{ width: 12, height: 12 }} />アーカイブ
        </button>
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
    </div>
  );
}
