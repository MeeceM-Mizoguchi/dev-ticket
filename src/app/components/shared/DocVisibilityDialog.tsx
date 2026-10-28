// BRU22-006 議事録・クライアントメモの公開範囲の設定ダイアログ（WbsVisibilityDialog と同じ見た目・操作）。
// 「全員」か「指定したメンバーのみ」を選ぶ。メンバーを0人にすると作成者だけが見られる（プライベート）。
// 変更できるのは作成者とオーナーだけ。それ以外の人が開いたときは読み取りだけにする。
import { useEffect, useRef, useState } from "react";
import { Globe, Lock, Check, AlertTriangle } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { loadDocMembers, saveDocVisibility, type DocMemberCandidate, type DocVisibilityKind } from "@/app/lib/docVisibility";
import type { DocVisibility } from "@/app/types";

export function DocVisibilityDialog({
  kind, doc, itemLabel, canManage, loadCandidates, allDescription, emptyCandidatesText,
  inheritedFolderTitle, loadActionAssignees, onSaved, onClose,
}: {
  kind: DocVisibilityKind;
  doc: { id: string; title: string; isFolder: boolean; visibility: DocVisibility; ownerId: string | null; createdBy: string };
  /** 「議事録」「メモ」 */
  itemLabel: string;
  /** 作成者かオーナーか。false なら読み取りだけ */
  canManage: boolean;
  /** 公開先に選べる人 */
  loadCandidates: () => Promise<DocMemberCandidate[]>;
  /** 「全員」の説明（誰が見られるか） */
  allDescription: string;
  /** 選べる人がいないときの文言 */
  emptyCandidatesText: string;
  /** 上のフォルダで絞られているとき、その（一番近い）フォルダの名前 */
  inheritedFolderTitle?: string | null;
  /** アクションの担当者（名前）。範囲の外にいる人を警告する（保存は止めない） */
  loadActionAssignees?: () => Promise<string[]>;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [visibility, setVisibility] = useState<DocVisibility>(doc.visibility);
  const [candidates, setCandidates] = useState<DocMemberCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignees, setAssignees] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // BUG-05 保存は await を含むので ref で二重起動を止める
  const savingRef = useRef(false);
  // 読み込みは開いたときに1回だけ。呼び出し側が毎回新しい関数を渡しても、選択中の状態を読み直して消さない
  const loadersRef = useRef({ loadCandidates, loadActionAssignees });
  loadersRef.current = { loadCandidates, loadActionAssignees };

  useEffect(() => {
    let cancelled = false;
    const loaders = loadersRef.current;
    (async () => {
      // 公開先の一覧を読めるのは作成者とオーナーだけ（RLS）。それ以外の人には一覧を出さない
      const [list, members, names] = await Promise.all([
        canManage ? loaders.loadCandidates() : Promise.resolve([]),
        canManage ? loadDocMembers(kind, doc.id) : Promise.resolve([]),
        loaders.loadActionAssignees ? loaders.loadActionAssignees() : Promise.resolve([]),
      ]);
      if (cancelled) return;
      // 今の公開先を読めないまま保存すると、選び直していない人まで外れてしまうので保存させない
      if (members === null) setLoadFailed(true);
      // 作成者は公開先に入れなくても常に見られるので、選ぶ一覧からは外す
      setCandidates(list.filter(c => c.id !== doc.ownerId));
      setSelected(new Set((members ?? []).map(m => m.id)));
      setAssignees(names);
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, doc.id, doc.ownerId, canManage]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleSave = async () => {
    if (!canManage || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      // 候補から外れた人（プロジェクト・組織から外れた人）は公開先にも残さない
      const ids = candidates.filter(c => selected.has(c.id)).map(c => c.id);
      const ok = await saveDocVisibility(kind, doc.id, visibility, ids);
      if (!ok) { setFailed(true); return; }
      await onSaved();
      onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // 範囲の外にいるアクションの担当者。作成者・選んだ人・オーナーは見られる
  const outsideAssignees = (() => {
    if (!canManage || visibility !== "members" || assignees.length === 0) return [];
    const allowed = new Set<string>([doc.createdBy]);
    for (const c of candidates) if (selected.has(c.id) || c.role === "owner") allowed.add(c.name);
    return [...new Set(assignees)].filter(n => n && !allowed.has(n));
  })();

  const target = doc.isFolder ? `フォルダ「${doc.title || "無題のフォルダ"}」` : `「${doc.title || `無題の${itemLabel}`}」`;
  const options: { value: DocVisibility; label: string; desc: string; icon: typeof Globe }[] = [
    { value: "project", label: "全員", desc: allDescription, icon: Globe },
    {
      value: "members", label: "指定したメンバーのみ",
      desc: "作成者・オーナーと、下で選んだメンバーだけが見られます。誰も選ばなければ、作成者だけが見られます（プライベート）。",
      icon: Lock,
    },
  ];
  const selectedCount = candidates.filter(c => selected.has(c.id)).length;

  return (
    <DialogShell title="公開範囲" size="md" minHeight={0} onClose={saving ? () => {} : onClose} busy={saving}
      footer={canManage ? <>
        <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleSave} disabled={loading || loadFailed} loading={saving}>保存する</BtnPrimary>
      </> : <BtnSecondary onClick={onClose}>閉じる</BtnSecondary>}>
      <p style={{ fontSize: 12, color: "#6B6458" }}>
        {target}を誰に見せるかを選びます。{doc.isFolder ? `フォルダの中の${itemLabel}すべてに効きます。` : ""}
      </p>
      {inheritedFolderTitle && (
        <p style={{ fontSize: 12, color: "#6D28D9", background: "#F5F3FF", border: "1px solid rgba(124,58,237,0.28)", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
          フォルダ「{inheritedFolderTitle}」の範囲で公開中です。ここで「全員」にしても、そのフォルダを見られない人には見えません。
        </p>
      )}
      {!canManage && (
        <p style={{ fontSize: 12, color: "#92400E", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px" }}>
          公開範囲を変えられるのは、作成者とオーナーだけです。
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map(o => {
          const active = visibility === o.value;
          const Icon = o.icon;
          return (
            <button key={o.value} type="button" onClick={() => setVisibility(o.value)} disabled={!canManage}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textAlign: "left", borderRadius: 12, cursor: canManage ? "pointer" : "default",
                background: active ? "#ECFDF5" : "#FFFFFF", border: `1.5px solid ${active ? "#059669" : "rgba(26,23,20,0.10)"}`, opacity: !canManage && !active ? 0.55 : 1 }}>
              <Icon style={{ width: 16, height: 16, color: active ? "#059669" : "#A09790", flexShrink: 0 }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1A1714" }}>{o.label}</span>
                <span style={{ display: "block", fontSize: 11, color: "#A09790", marginTop: 2 }}>{o.desc}</span>
              </span>
              {active && <Check style={{ width: 16, height: 16, color: "#059669", flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>

      {visibility === "members" && (canManage ? (
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>
            見られるメンバー（{selectedCount}人）{selectedCount === 0 && !loading ? "：作成者だけが見られます" : ""}
          </p>
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
            {loading ? (
              <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>読み込み中...</p>
            ) : candidates.length === 0 ? (
              <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>{emptyCandidatesText}</p>
            ) : candidates.map(c => {
              const on = selected.has(c.id);
              return (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid rgba(26,23,20,0.05)", background: on ? "#F0FDF4" : "transparent" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} style={{ accentColor: "#059669" }} />
                  <span style={{ fontSize: 13, color: "#1A1714" }}>{c.name}</span>
                  {c.role === "owner" && <span style={{ fontSize: 10, color: "#A09790" }}>オーナー（常に見られます）</span>}
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#A09790" }}>公開先の一覧は、作成者とオーナーだけが確認できます。</p>
      ))}

      {outsideAssignees.length > 0 && (
        <p style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12, color: "#B45309", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px", lineHeight: 1.6 }}>
          <AlertTriangle style={{ width: 14, height: 14, flexShrink: 0, marginTop: 2 }} />
          <span>
            担当の{outsideAssignees.map(n => `${n}さん`).join("・")}が入っていません。
            {doc.isFolder ? `フォルダの中の${itemLabel}の` : `この${itemLabel}の`}アクションは、その人から見えなくなります（マイアクションにも出ません）。
          </span>
        </p>
      )}
      {loadFailed && <p style={{ fontSize: 12, color: "#DC2626" }}>今の公開先を読み込めませんでした。時間をおいて、開き直してください。</p>}
      {failed && <p style={{ fontSize: 12, color: "#DC2626" }}>保存できませんでした。時間をおいて、もう一度お試しください。</p>}
    </DialogShell>
  );
}
