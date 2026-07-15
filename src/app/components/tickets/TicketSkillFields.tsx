// ENHA2-034 チケットの「必要スキル」「開発規模」入力＋担当者レコメンド
//
// 日常の追加入力はここだけ。必要スキルを2〜3個選んで、規模をS/M/Lで選ぶ。数秒で終わる。
// 選んだ瞬間に、その条件に合う担当者候補が下に出る。

import { useMemo, useState } from "react";
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
  const skillById = useMemo(() => new Map(skills.map(s => [s.id, s])), [skills]);
  const available = skills.filter(s => !required.some(r => r.skillId === s.id));

  const add = (skillId: string) => {
    if (!skillId || required.some(r => r.skillId === skillId)) return;
    onRequiredChange([...required, { skillId, importance: 3 }]);
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

          {/* ワンクリックで開くよう、常に select を表示（value="" で選択後もプレースホルダーに戻す） */}
          {available.length > 0 && (
            <select value="" onChange={e => add(e.target.value)}
              style={{ fontSize: 11.5, padding: "5px 10px", borderRadius: 7, border: "1px dashed rgba(26,23,20,0.18)", background: "transparent", color: "#A09790", cursor: "pointer" }}>
              <option value="">＋ スキルを追加</option>
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
          )}
        </div>
      </div>

      {/* 開発規模 */}
      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "#6B6458", marginBottom: 6, display: "block" }}>開発規模</label>
        <div style={{ display: "flex", gap: 6 }}>
          {DEV_SCALES.map(s => {
            const active = devScale === s.key;
            return (
              <button key={s.key} type="button"
                onClick={() => onDevScaleChange(active ? null : s.key)}
                style={{
                  flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  padding: "8px 6px", borderRadius: 8, cursor: "pointer",
                  border: active ? "1px solid #059669" : "1px solid rgba(26,23,20,0.12)",
                  background: active ? "#059669" : "#FFFFFF",
                  color: active ? "#FFFFFF" : "#6B6458",
                  transition: "all 0.12s",
                }}>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{s.label}</span>
                <span style={{ fontSize: 9.5, opacity: active ? 0.95 : 0.6, lineHeight: 1.2, textAlign: "center" as const }}>{s.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

/**
 * 担当者レコメンドのモーダル。
 * 担当者欄の「自動アサイン」ボタンから開く。
 *   モーダル内で必要スキルと開発規模を選ぶ →「レコメンド」ボタン → TOP3を理由付きで表示
 *   → 担当をクリック → モーダルが閉じて、その担当が選択済みになる。
 * 候補には必ず「理由」を添える ─ これが無いと「AIが言うから」になって現場で信用されない。
 */
export function AssigneeRecommendModal({
  orgId, skills, estimatedHours, priority, candidateNames,
  initialRequired, initialScale, onClose, onPick,
}: {
  orgId: string;
  skills: Skill[];
  estimatedHours: number;
  priority: Priority;
  candidateNames?: string[];
  initialRequired: RequiredSkill[];
  initialScale: DevScale | null;
  onClose: () => void;
  // 担当者名と、モーダルで選んだ必要スキル・開発規模を親へ返す（チケットにも保存する）
  onPick: (name: string, required: RequiredSkill[], devScale: DevScale | null) => void;
}) {
  const [required, setRequired] = useState<RequiredSkill[]>(initialRequired);
  const [devScale, setDevScale] = useState<DevScale | null>(initialScale);
  const [loading, setLoading] = useState(false);
  const [candidates, setCandidates] = useState<AssigneeRecommendation[]>([]);
  const [source, setSource] = useState<"model" | "baseline">("baseline");
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState(false);

  const runRecommend = async () => {
    if (required.length === 0) return;
    setLoading(true); setError(false); setSearched(true);
    try {
      const r = await fetchRecommendations({
        organizationId: orgId, requiredSkillIds: required,
        devScale, estimatedHours, priority, candidateNames, limit: 3,
      });
      setCandidates(r.candidates ?? []);
      setSource(r.source ?? "baseline");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 500, padding: 20 }}
      onClick={onClose}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, width: 520, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        {/* ヘッダー */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", display: "flex", alignItems: "center", gap: 6 }}>
              <Sparkles style={{ width: 15, height: 15, color: "#059669" }} />自動アサイン
            </h2>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
              必要スキルと開発規模を選んで「レコメンド」を押すと、適任者トップ3を提案します
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* 本体 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {skills.length === 0 ? (
            <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "20px 0" }}>
              スキルマスタが未登録です。先にメンバー管理の「スキル管理」からスキルを登録してください。
            </p>
          ) : (
            <TicketSkillFields
              skills={skills}
              required={required}
              devScale={devScale}
              onRequiredChange={setRequired}
              onDevScaleChange={setDevScale}
            />
          )}

          {/* レコメンド実行ボタン */}
          <button onClick={runRecommend} disabled={required.length === 0 || loading}
            title={required.length === 0 ? "必要スキルを1つ以上選んでください" : undefined}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", background: required.length === 0 || loading ? "#D1D5DB" : "#059669", color: "#fff", cursor: required.length === 0 || loading ? "not-allowed" : "pointer", boxShadow: required.length === 0 || loading ? "none" : "0 2px 8px rgba(5,150,105,0.25)" }}>
            {loading
              ? <><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />候補を計算中...</>
              : <><Sparkles style={{ width: 14, height: 14 }} />レコメンド</>}
          </button>

          {/* 結果 */}
          {searched && !loading && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#047857" }}>おすすめ担当者トップ3</span>
                <span style={{ fontSize: 9.5, color: "#059669", opacity: 0.8 }}>{source === "model" ? "学習済みモデル" : "実績ベース"}</span>
              </div>

              {error ? (
                <p style={{ fontSize: 11.5, color: "#A09790", padding: "8px 0" }}>候補を取得できませんでした</p>
              ) : candidates.length === 0 ? (
                <p style={{ fontSize: 11.5, color: "#A09790", padding: "8px 0" }}>該当する候補がいません</p>
              ) : (
                candidates.map((c, i) => (
                  <button key={c.profileId} onClick={() => { onPick(c.name, required, devScale); onClose(); }}
                    style={{ width: "100%", textAlign: "left" as const, display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderRadius: 10, background: "#F0FDF4", border: "1px solid rgba(5,150,105,0.2)", marginBottom: 7, cursor: "pointer" }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#DCFCE7"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#F0FDF4"; }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: "#059669", width: 16, flexShrink: 0 }}>{i + 1}.</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1714" }}>{c.name}</span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#059669" }}>適合 {Math.round(c.score * 100)}%</span>
                      </div>
                      <p style={{ fontSize: 11, color: "#6B6458", marginTop: 3, lineHeight: 1.55 }}>{c.reasons.join(" · ")}</p>
                    </div>
                    <span style={{ flexShrink: 0, alignSelf: "center", fontSize: 11, fontWeight: 700, color: "#059669" }}>この人に決定 →</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* フッター */}
        <div style={{ padding: "12px 22px", borderTop: "1px solid rgba(26,23,20,0.08)", display: "flex", justifyContent: "flex-end" }}>
          <button onClick={onClose}
            style={{ padding: "9px 18px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
