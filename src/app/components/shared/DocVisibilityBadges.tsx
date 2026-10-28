// BRU22-006 本文の上に出す公開範囲のバッジ（議事録・クライアントメモ）。
//   ・自分の範囲が「指定したメンバーのみ」 … 「指定したメンバーのみ（○人）」
//   ・上のフォルダで絞られている           … 「フォルダ『○○』の範囲で公開中」
//   ・「全員」で、自分が作成者かオーナー     … 「全員に公開」（押すと設定を開く）
// 押すと公開範囲のダイアログを開く（作成者・オーナー以外は読み取りだけ）。
import { useEffect, useState } from "react";
import { Globe, Lock } from "lucide-react";
import { PRIVATE_BG, PRIVATE_BORDER, PRIVATE_COLOR } from "@/app/components/whiteboard/PrivateBadge";
import { loadDocMembers, type DocVisibilityKind } from "@/app/lib/docVisibility";
import type { DocVisibility } from "@/app/types";

const badgeStyle = (restricted: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", fontSize: 11, fontWeight: 700,
  borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
  color: restricted ? PRIVATE_COLOR : "#6B6458",
  background: restricted ? PRIVATE_BG : "#F4F5F6",
  border: `1px solid ${restricted ? PRIVATE_BORDER : "rgba(26,23,20,0.08)"}`,
});

export function DocVisibilityBadges({
  kind, item, inheritedFolder, canManage, reloadKey, onOpenOwn, onOpenFolder,
}: {
  kind: DocVisibilityKind;
  item: { id: string; visibility: DocVisibility };
  /** 一番近い「指定したメンバーのみ」の上のフォルダ */
  inheritedFolder: { title: string } | null;
  /** 作成者かオーナーか（人数を数えられるのも、この人だけ） */
  canManage: boolean;
  /** 公開範囲を保存したら増やす（人数を読み直す） */
  reloadKey: number;
  onOpenOwn: () => void;
  onOpenFolder: () => void;
}) {
  const [count, setCount] = useState<number | null>(null);
  const restricted = item.visibility === "members";

  useEffect(() => {
    setCount(null);
    // 公開先の一覧を読めるのは作成者とオーナーだけ（RLS）。それ以外の人には人数を出さない
    if (!restricted || !canManage) return;
    let cancelled = false;
    void loadDocMembers(kind, item.id).then(list => { if (!cancelled && list) setCount(list.length); });
    return () => { cancelled = true; };
  }, [kind, item.id, restricted, canManage, reloadKey]);

  if (!restricted && !inheritedFolder && !canManage) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {restricted ? (
        <button type="button" onClick={onOpenOwn} style={badgeStyle(true)}
          title={canManage ? "公開範囲を変更する" : "公開範囲を確認する"}>
          <Lock style={{ width: 10, height: 10 }} />
          指定したメンバーのみ{count === null ? "" : count === 0 ? "（作成者だけ）" : `（${count}人）`}
        </button>
      ) : canManage && (
        <button type="button" onClick={onOpenOwn} style={badgeStyle(false)} title="公開範囲を変更する">
          <Globe style={{ width: 10, height: 10 }} />全員に公開
        </button>
      )}
      {inheritedFolder && (
        <button type="button" onClick={onOpenFolder} style={badgeStyle(true)} title="フォルダの公開範囲を確認する">
          <Lock style={{ width: 10, height: 10 }} />
          フォルダ「{inheritedFolder.title || "無題のフォルダ"}」の範囲で公開中
        </button>
      )}
    </div>
  );
}
