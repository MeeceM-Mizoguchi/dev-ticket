// ENHA2-034 チケットの「必要スキル」「開発規模」入力＋担当者レコメンド
//
// 日常の追加入力はここだけ。必要スキルを2〜3個選んで、規模をS/M/Lで選ぶ。数秒で終わる。
// 選んだ瞬間に、その条件に合う担当者候補が下に出る。

import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles, Loader2, X } from "lucide-react";
import type { Skill, DevScale, Priority, AssigneeRecommendation } from "@/app/types";
import { SKILL_LAYERS, DEV_SCALES, layerMeta } from "@/app/lib/skills";
import { fetchRecommendations } from "@/app/lib/skillsApi";

export interface RequiredSkill { skillId: string; importance: 1 | 2 | 3 }

const IMPORTANCE_LABEL: Record<number, string> = { 3: "必須", 2: "推奨", 1: "尚可" };

/** 必要スキル＋開発規模の入力欄 */
export function TicketSkillFields({ skills, required, devScale, onRequiredChange, onDevScaleChange }: {
  skills: Skill[];
  required: RequiredSkill[];
  devScale: DevScale | null;
  onRequiredChange: (r: RequiredSkill[]) => void;
  onDevScaleChange: (s: DevScale | null) => void;
}) {
  const [adding, setAdding] = useState(false);
  const skillById = useMemo(() => new Map(skills.map(s => [s.id, s])), [skills]);
  const available = skills.filter(s => !required.some(r => r.skillId === s.id));

  const add = (skillId: string) => {
    if (!skillId || required.some(r => r.skillId === skillId)) return;
    onRequiredChange([...required, { skillId, importance: 3 }]);
    setAdding(false);
  };
  const remove = (skillId: string) => onRequiredChange(required.filter(r => r.skillId !== skillId));
  const cycleImportance = (skillId: string) =>
    onRequiredChange(required.map(r =>
      r.skillId === skillId
        ? { ...r, importance: (r.importance === 3 ? 2 : r.importance === 2 ? 1 : 3) as 1 | 2 | 3 }
        : r,
    ));

  if (skills.length === 0) return null;

  return (
    <>
      {/* 必要スキル */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#6B6458", marginBottom: 6 }}>
          <Zap style={{ width: 12, height: 12 }} />必要スキル
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
          {required.map(r => {
            const s = skillById.get(r.skillId);
            if (!s) return null;
            const lm = layerMeta(s.layer);
            return (
              <span key={r.skillId}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, padding: "5px 7px 5px 9px", borderRadius: 7, background: lm.bg, color: lm.color }}>
                {s.name}
                <button onClick={() => cycleImportance(r.skillId)} title="必須 / 推奨 / 尚可 を切り替え"
                  style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 5px", borderRadius: 4, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.75)", color: lm.color }}>
                  {IMPORTANCE_LABEL[r.importance]}
                </button>
                <button onClick={() => remove(r.skillId)}
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: lm.color, padding: 0, display: "flex", opacity: 0.6 }}>
                  <X style={{ width: 11, height: 11 }} />
                </button>
              </span>
            );
          })}

          {available.length > 0 && (adding ? (
            <select autoFocus defaultValue="" onChange={e => add(e.target.value)} onBlur={() => setAdding(false)}
              style={{ padding: "6px 8px", fontSize: 11.5, borderRadius: 7, border: "1px solid rgba(5,150,105,0.4)", outline: "none", background: "#fff", color: "#1A1714" }}>
              <option value="">スキルを選択...</option>
              {SKILL_LAYERS.map(l => {
                const opts = available.filter(s => s.layer === l.key);
                if (opts.length === 0) return null;
                return (
                  <optgroup key={l.key} label={l.label}>
                    {opts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </optgroup>
                );
              })}
            </select>
          ) : (
            <button onClick={() => setAdding(true)}
              style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 7, border: "1px dashed rgba(26,23,20,0.18)", background: "transparent", color: "#A09790", cursor: "pointer" }}>
              ＋ スキルを追加
            </button>
          ))}
        </div>
      </div>

      {/* 開発規模 */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", marginBottom: 6, display: "block" }}>開発規模</label>
        <div style={{ display: "flex", gap: 6 }}>
          {DEV_SCALES.map(s => (
            <button key={s.key} title={s.hint}
              onClick={() => onDevScaleChange(devScale === s.key ? null : s.key)}
              style={{
                padding: "7px 16px", fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: "pointer",
                border: devScale === s.key ? "1px solid #059669" : "1px solid rgba(26,23,20,0.12)",
                background: devScale === s.key ? "#059669" : "#FFFFFF",
                color: devScale === s.key ? "#FFFFFF" : "#6B6458",
                transition: "all 0.12s",
              }}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * 担当者レコメンド。
 * 必要スキルを選ぶと自動で候補を取りに行く。
 * 候補には必ず「理由」を添える ─ これが無いと「AIが言うから」になって現場で信用されない。
 */
export function AssigneeRecommendPanel({
  orgId, required, devScale, estimatedHours, priority, candidateNames, currentAssignee, onPick,
}: {
  orgId: string;
  required: RequiredSkill[];
  devScale: DevScale | null;
  estimatedHours: number;
  priority: Priority;
  candidateNames?: string[];
  currentAssignee?: string;
  onPick: (name: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<AssigneeRecommendation[]>([]);
  const [source, setSource] = useState<"model" | "baseline">("baseline");
  const [error, setError] = useState(false);

  const key = JSON.stringify({ required, devScale, estimatedHours, priority, candidateNames });

  useEffect(() => {
    if (!orgId || required.length === 0) { setCandidates([]); return; }
    let cancelled = false;
    setLoading(true); setError(false);
    (async () => {
      try {
        const r = await fetchRecommendations({
          organizationId: orgId,
          requiredSkillIds: required,
          devScale, estimatedHours, priority, candidateNames, limit: 3,
        });
        if (cancelled) return;
        setCandidates(r.candidates ?? []);
        setSource(r.source ?? "baseline");
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [key, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  // 必要スキル未選択のうちは何も出さない（うるさくしない）
  if (required.length === 0) return null;

  return (
    <div style={{ marginBottom: 14, border: "1px solid rgba(5,150,105,0.2)", borderRadius: 11, background: "#F0FDF4", overflow: "hidden" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: candidates.length > 0 ? "1px solid rgba(5,150,105,0.15)" : "none" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, color: "#047857" }}>
          <Sparkles style={{ width: 13, height: 13 }} />おすすめ担当者
        </span>
        <span style={{ fontSize: 9.5, color: "#059669", opacity: 0.8 }}>
          {/* 学習済みモデルが育つまではルールベース。育ったら自動で切り替わる */}
          {source === "model" ? "学習済みモデル" : "実績ベース"}
        </span>
      </div>

      {loading ? (
        <p style={{ padding: "14px 12px", fontSize: 11.5, color: "#059669", display: "flex", alignItems: "center", gap: 6 }}>
          <Loader2 style={{ width: 12, height: 12, animation: "spin 1s linear infinite" }} />候補を計算中...
        </p>
      ) : error ? (
        <p style={{ padding: "12px", fontSize: 11.5, color: "#A09790" }}>候補を取得できませんでした</p>
      ) : candidates.length === 0 ? (
        <p style={{ padding: "12px", fontSize: 11.5, color: "#A09790" }}>該当する候補がいません</p>
      ) : (
        <div style={{ padding: "8px" }}>
          {candidates.map((c, i) => {
            const isCurrent = currentAssignee === c.name;
            return (
              <div key={c.profileId}
                style={{ display: "flex", alignItems: "flex-start", gap: 9, padding: "8px 9px", borderRadius: 8, background: "#FFFFFF", marginBottom: i === candidates.length - 1 ? 0 : 5, border: isCurrent ? "1px solid #059669" : "1px solid rgba(26,23,20,0.05)" }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: "#059669", width: 14, flexShrink: 0, marginTop: 1 }}>{i + 1}.</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <p style={{ fontSize: 12.5, fontWeight: 700, color: "#1A1714" }}>{c.name}</p>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#059669" }}>適合 {Math.round(c.score * 100)}%</span>
                  </div>
                  {/* なぜこの人なのか。納得して選べるようにする */}
                  <p style={{ fontSize: 10.5, color: "#6B6458", marginTop: 2, lineHeight: 1.5 }}>
                    {c.reasons.join(" · ")}
                  </p>
                </div>
                <button onClick={() => onPick(c.name)} disabled={isCurrent}
                  style={{ flexShrink: 0, padding: "5px 11px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "none", background: isCurrent ? "#D1FAE5" : "#059669", color: isCurrent ? "#047857" : "#fff", cursor: isCurrent ? "default" : "pointer" }}>
                  {isCurrent ? "選択中" : "選択"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
