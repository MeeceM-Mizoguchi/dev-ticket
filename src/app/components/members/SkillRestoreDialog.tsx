// BRU9-041 スキルを過去の時点へ戻す確認ダイアログ
//
// ★ 無言で戻さない ★
//   先に dry run で「何が変わるか」を引いて必ず見せる。0件なら実行させない。
//
// ★ 既定で「スキル自動更新をOFFにする」にチェックを入れる ★
//   復元した行は source='auto' のまま残るため、OFFにしないと今夜の自動判定で
//   また上書きされうる。「戻したのに戻ってない」を防ぐための既定値。

import { useEffect, useState } from "react";
import { X, RotateCcw, AlertTriangle } from "lucide-react";
import type { Skill, SkillRestoreChange } from "@/app/types";
import { previewSkillRestore, restoreMemberSkills } from "@/app/lib/skillsApi";
import { layerMeta } from "@/app/lib/skills";
import { useToast } from "@/app/contexts/ToastContext";

export function SkillRestoreDialog({ profileId, memberName, at, skills, actorProfileId, onClose, onRestored }: {
  profileId: string;
  memberName: string;
  at: string;                       // この時点(直後)の状態に戻す
  skills: Skill[];
  actorProfileId: string | null;
  onClose: () => void;
  /** disabledAutoUpdate: 自動更新をOFFにしたかどうか（呼び出し元の表示を合わせるため） */
  onRestored: (disabledAutoUpdate: boolean) => void;
}) {
  const { toast } = useToast();
  const [changes, setChanges] = useState<SkillRestoreChange[] | null>(null);
  const [disableAuto, setDisableAuto] = useState(true);   // ★既定ON
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const skillById = new Map(skills.map(s => [s.id, s]));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await previewSkillRestore(profileId, at);
        if (!cancelled) setChanges(c);
      } catch (e) {
        if (!cancelled) { setError(String(e)); setChanges([]); }
      }
    })();
    return () => { cancelled = true; };
  }, [profileId, at]);

  const run = async () => {
    setBusy(true);
    try {
      const { changed } = await restoreMemberSkills({ profileId, at, disableAutoUpdate: disableAuto, actorProfileId });
      toast(`「${memberName}」のスキルを ${changed}件 戻しました`);
      onRestored(disableAuto);
      onClose();
    } catch (e) {
      const msg = String(e);
      // RPC 側の権限チェックに引っかかった場合は、そのまま英語を出さず日本語にする
      setError(msg.includes("owner or admin") ? "スキルを復元できるのはオーナーまたは管理者のみです" : msg);
      setBusy(false);
    }
  };

  const when = new Date(at).toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const canRun = !busy && changes !== null && changes.length > 0 && !error;

  return (
    // ★ stopPropagation を必ず付ける ★
    //   このダイアログは親モーダル（スキル編集）の中に描画される。付けないと背景クリックが
    //   親まで伝わって、親モーダルごと閉じてしまう。
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 400, padding: 20 }}
      onClick={e => { e.stopPropagation(); onClose(); }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, width: 480, maxWidth: "100%", maxHeight: "82vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 15.5, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
              {when} 時点に戻す
            </h2>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
              {memberName} さんのスキルを、この時点直後の状態へ戻します
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 22px" }}>
          {changes === null ? (
            <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "30px 0" }}>変更内容を確認中...</p>
          ) : changes.length === 0 ? (
            <div style={{ textAlign: "center", padding: "26px 0" }}>
              <p style={{ fontSize: 12.5, color: "#6B6458", fontWeight: 600 }}>変わるものはありません</p>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 5 }}>
                現在のスキルは、すでにこの時点と同じ状態です。
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 12, color: "#1A1714", fontWeight: 600, marginBottom: 9 }}>
                {changes.length}件 変わります
              </p>
              <div style={{ border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, overflow: "hidden" }}>
                {changes.map((c, i) => {
                  const s = skillById.get(c.skillId);
                  const lm = s ? layerMeta(s.layer) : null;
                  return (
                    <div key={c.skillId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", background: i % 2 ? "#FAFAFA" : "#FFFFFF" }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: s ? "#1A1714" : "#C9C4BB", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {lm && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 2, background: lm.color, marginRight: 6 }} />}
                        {s?.name ?? "（削除済みスキル）"}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {c.changeType === "removed" ? (
                          <><span style={{ color: "#B0A9A4" }}>Lv{c.oldLevel}</span> <span style={{ color: "#DC2626" }}>→ 削除</span></>
                        ) : c.changeType === "added" ? (
                          <span style={{ color: "#059669" }}>＋復活 Lv{c.newLevel}</span>
                        ) : c.changeType === "source_changed" ? (
                          // レベルは同じで、自動判定/手動確定の別だけが戻る
                          <span style={{ color: "#6B6458", fontWeight: 600 }}>Lv{c.newLevel} のまま（自動判定に戻す）</span>
                        ) : (
                          <><span style={{ color: "#B0A9A4" }}>Lv{c.oldLevel}</span> <span style={{ color: "#D97706" }}>→ Lv{c.newLevel}</span></>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* 自動更新の扱い。既定ON。 */}
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={disableAuto} onChange={e => setDisableAuto(e.target.checked)}
                  style={{ marginTop: 2, accentColor: "#D97706", cursor: "pointer" }} />
                <span>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: "#92400E" }}>
                    復元後、このメンバーのスキル自動更新をOFFにする
                  </span>
                  <span style={{ display: "block", fontSize: 10.5, color: "#B45309", marginTop: 3, lineHeight: 1.5 }}>
                    OFFにしないと、毎日未明の自動判定で再び上書きされる可能性があります。
                    OFFにしてもレコメンドの対象からは外れません。
                  </span>
                </span>
              </label>
            </>
          )}

          {error && (
            <div style={{ display: "flex", gap: 7, alignItems: "flex-start", marginTop: 12, padding: "9px 11px", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 9 }}>
              <AlertTriangle style={{ width: 13, height: 13, color: "#DC2626", flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: 11, color: "#B91C1C", lineHeight: 1.5 }}>{error}</p>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 22px", borderTop: "1px solid rgba(26,23,20,0.08)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
            キャンセル
          </button>
          <button onClick={run} disabled={!canRun}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", background: canRun ? "#D97706" : "#D1D5DB", color: "#fff", cursor: canRun ? "pointer" : "not-allowed", boxShadow: canRun ? "0 2px 8px rgba(217,119,6,0.25)" : "none" }}>
            <RotateCcw style={{ width: 13, height: 13 }} />
            {busy ? "戻しています..." : "この時点に戻す"}
          </button>
        </div>
      </div>
    </div>
  );
}
