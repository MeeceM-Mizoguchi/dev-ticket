// ENHA2-053 WBSの公開設定モーダル。
// 「プロジェクトの全メンバー」か「指定したメンバーのみ」を選ぶ。変更できるのは作成者とオーナー。
import { useEffect, useRef, useState } from "react";
import { Globe, Lock, Check } from "lucide-react";
import { DialogShell } from "@/app/components/shared/DialogShell";
import { BtnPrimary } from "@/app/components/shared/BtnPrimary";
import { BtnSecondary } from "@/app/components/shared/BtnSecondary";
import { loadWbsMemberCandidates, loadWbsSheetMemberIds, saveWbsVisibility, type WbsMemberCandidate } from "@/app/lib/wbsService";
import type { WbsSheet, WbsVisibility } from "@/app/types";

export function WbsVisibilityDialog({ sheet, orgId, onSaved, onClose }: {
  sheet: WbsSheet;
  orgId: string | null;
  onSaved: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [visibility, setVisibility] = useState<WbsVisibility>(sheet.visibility);
  const [candidates, setCandidates] = useState<WbsMemberCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [list, ids] = await Promise.all([
        loadWbsMemberCandidates(sheet.projectId, orgId),
        loadWbsSheetMemberIds(sheet.id),
      ]);
      if (cancelled) return;
      // 作成者は公開先に入れなくても常に見られるので、選ぶ一覧からは外す
      setCandidates(list.filter(c => c.id !== sheet.createdBy));
      setSelected(new Set(ids));
      setLoading(false);
    })().catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sheet.id, sheet.projectId, sheet.createdBy, orgId]);

  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFailed(false);
    try {
      // 候補から外れた人（プロジェクトから外れた人）は公開先にも残さない
      const ids = candidates.filter(c => selected.has(c.id)).map(c => c.id);
      const ok = await saveWbsVisibility(sheet.id, visibility, ids);
      if (!ok) { setFailed(true); return; }
      await onSaved();
      onClose();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const options: { value: WbsVisibility; label: string; desc: string; icon: typeof Globe }[] = [
    { value: "project", label: "プロジェクトの全メンバー", desc: "このプロジェクトで WBS の権限がある人は全員見られます。", icon: Globe },
    { value: "members", label: "指定したメンバーのみ", desc: "作成者・オーナーと、下で選んだメンバーだけが見られます。", icon: Lock },
  ];

  return (
    <DialogShell title="公開設定" size="md" minHeight={0} onClose={saving ? () => {} : onClose} busy={saving}
      footer={<>
        <BtnSecondary onClick={onClose} disabled={saving}>キャンセル</BtnSecondary>
        <BtnPrimary onClick={handleSave} disabled={loading} loading={saving}>保存する</BtnPrimary>
      </>}>
      <p style={{ fontSize: 12, color: "#6B6458" }}>「{sheet.name}」を誰に見せるかを選びます。</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map(o => {
          const active = visibility === o.value;
          const Icon = o.icon;
          return (
            <button key={o.value} type="button" onClick={() => setVisibility(o.value)}
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", textAlign: "left", borderRadius: 12, cursor: "pointer",
                background: active ? "#ECFDF5" : "#FFFFFF", border: `1.5px solid ${active ? "#059669" : "rgba(26,23,20,0.10)"}` }}>
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

      {visibility === "members" && (
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "#A09790", marginBottom: 6 }}>見られるメンバー（{candidates.filter(c => selected.has(c.id)).length}人）</p>
          <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10 }}>
            {loading ? (
              <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>読み込み中...</p>
            ) : candidates.length === 0 ? (
              <p style={{ fontSize: 12, color: "#A09790", padding: 14 }}>選べるメンバーがいません（このプロジェクトにアサインされている人が対象です）。</p>
            ) : candidates.map(c => {
              const on = selected.has(c.id);
              return (
                <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer", borderBottom: "1px solid rgba(26,23,20,0.05)", background: on ? "#F0FDF4" : "transparent" }}>
                  <input type="checkbox" checked={on} onChange={() => toggle(c.id)} style={{ accentColor: "#059669" }} />
                  <span style={{ fontSize: 13, color: "#1A1714" }}>{c.name}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {failed && <p style={{ fontSize: 12, color: "#DC2626" }}>保存できませんでした。時間をおいて、もう一度お試しください。</p>}
    </DialogShell>
  );
}
