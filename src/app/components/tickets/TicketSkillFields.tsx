// ENHA2-034 チケットの「必要スキル」「開発規模」入力＋担当者レコメンド
//
// 日常の追加入力はここだけ。必要スキルを2〜3個選んで、規模をS/M/Lで選ぶ。数秒で終わる。
// 選んだ瞬間に、その条件に合う担当者候補が下に出る。

import { useEffect, useMemo, useState } from "react";
import { Zap, Sparkles, Loader2, X, RotateCcw, Wand2 } from "lucide-react";
import type { Skill, DevScale, Priority, AssigneeRecommendation } from "@/app/types";
import { SKILL_LAYERS, DEV_SCALES, layerMeta, detectSkillKeywords, ticketSearchText } from "@/app/lib/skills";
import { fetchRecommendations, logRecommendationAccepted } from "@/app/lib/skillsApi";

/** 見積工数(h)から開発規模をざっくり推定する（未入力なら未設定のまま） */
function estimateScale(hours: number): DevScale | null {
  if (!hours || hours <= 0) return null;
  if (hours <= 3) return "S";
  if (hours <= 8) return "M";
  if (hours <= 40) return "L";
  return "XL";
}

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
  initialRequired, initialScale, ticketTitle, ticketDescription, ticketPrefixes, ticketId,
  ticketStartDate, ticketDueDate,
  onClose, onPick,
}: {
  orgId: string;
  skills: Skill[];
  estimatedHours: number;
  priority: Priority;
  candidateNames?: string[];
  initialRequired: RequiredSkill[];
  initialScale: DevScale | null;
  // チケットの内容。新規で保存済みスキルが無いときだけ、ここから必要スキルを自動判定する。
  ticketTitle?: string;
  ticketDescription?: string;
  ticketPrefixes?: string[];
  ticketId?: string | null;   // 採用ログ(recommendation_logs)に紐づける
  // 開始日・期限日。入っていれば「その期間に空いている人」を優先してレコメンドする。
  ticketStartDate?: string | null;
  ticketDueDate?: string | null;
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
  const [autoFilled, setAutoFilled] = useState(false);   // チケット内容から自動判定したか
  const [showAll, setShowAll] = useState(false);         // 「もっと見る」で適合あり(>0%)を全員表示
  const [showZero, setShowZero] = useState(false);       // 「さらに全メンバー」で適合0%の人も最下部に表示

  // レコメンド実行。mount時の自動実行では state 反映を待たず、算出値を直接渡す。
  const runRecommend = async (reqArg?: RequiredSkill[], scaleArg?: DevScale | null) => {
    const req = reqArg ?? required;
    const scale = scaleArg !== undefined ? scaleArg : devScale;
    if (req.length === 0) { setSearched(true); setCandidates([]); return; }
    setLoading(true); setError(false); setSearched(true); setShowAll(false); setShowZero(false);
    try {
      const r = await fetchRecommendations({
        organizationId: orgId, requiredSkillIds: req,
        devScale: scale, estimatedHours, priority, candidateNames,
        startDate: ticketStartDate ?? null, dueDate: ticketDueDate ?? null, limit: 3,
      });
      setCandidates(r.candidates ?? []);
      setSource(r.source ?? "baseline");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // チケットのタイトル・説明・ラベルから必要スキルを辞書キーワードで判定する（外部AI不要）
  const detectFromContent = (): RequiredSkill[] =>
    detectSkillKeywords(
      ticketSearchText({
        title: ticketTitle ?? "",
        description: (ticketDescription ?? "").replace(/<[^>]*>/g, " "),
        prefixes: ticketPrefixes ?? [],
      }),
      skills,
    ).map(id => ({ skillId: id, importance: 3 as const }));

  // 「チケット内容から自動判定 → 規模を工数から推定 → そのままレコメンド」を実行する。
  // モーダルを開いた瞬間（mount）と、右上の「自動判定」ボタンから呼ぶ。
  const autoDetectAndRecommend = () => {
    const detected = detectFromContent();
    const scale = estimateScale(estimatedHours);
    setRequired(detected);
    setDevScale(scale);
    setAutoFilled(detected.length > 0);
    if (detected.length > 0) void runRecommend(detected, scale);
    else { setSearched(true); setCandidates([]); }
  };

  // 手で触った内容を白紙に戻す（結果もクリア）。＝手動で選び直すためのボタン。
  const reset = () => {
    setRequired([]);
    setDevScale(null);
    setCandidates([]);
    setSearched(false);
    setAutoFilled(false);
    setShowAll(false);
  };

  useEffect(() => {
    const scale = initialScale ?? estimateScale(estimatedHours);
    if (initialRequired.length > 0) {
      // 保存済みスキルあり（＝一度アサイン判定した／手で設定したチケットを開き直した）:
      // 内容から再検出して勝手に上書きしない。レコメンドも自動では走らせない
      // （開くたびに再判定が走る問題の解消）。ユーザーが「再レコメンド」で候補を取得する。
      setRequired(initialRequired);
      setDevScale(scale);
      setAutoFilled(false);
    } else {
      // 新規（保存済みスキル無し）: チケット内容から一度だけ検出し、その場でレコメンド。
      const detected = detectFromContent();
      setRequired(detected);
      setDevScale(scale);
      setAutoFilled(detected.length > 0);
      if (detected.length > 0) void runRecommend(detected, scale);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              チケット内容から必要スキルを自動判定して提案します。ズレていれば手で直して「再レコメンド」してください
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {skills.length > 0 && (
              <>
                <button onClick={reset} disabled={loading}
                  title="スキルを空にして手動で選び直す（自動判定はしない）"
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: loading ? "not-allowed" : "pointer" }}>
                  <RotateCcw style={{ width: 12, height: 12 }} />リセット
                </button>
                <button onClick={autoDetectAndRecommend} disabled={loading}
                  title="チケット本文からスキルを検出し直す（手動修正は破棄してレコメンド）"
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 9px", fontSize: 11, fontWeight: 600, borderRadius: 7, border: "1px solid rgba(5,150,105,0.35)", background: "#ECFDF5", color: "#059669", cursor: loading ? "not-allowed" : "pointer" }}>
                  <Wand2 style={{ width: 12, height: 12 }} />内容から再判定
                </button>
              </>
            )}
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        {/* 本体 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 22px" }}>
          {skills.length === 0 ? (
            <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "20px 0" }}>
              スキルマスタが未登録です。先にメンバー管理の「スキル管理」からスキルを登録してください。
            </p>
          ) : (
            <>
              {autoFilled && (
                <div style={{ marginBottom: 12, padding: "8px 11px", background: "#F0FDF4", border: "1px solid rgba(5,150,105,0.2)", borderRadius: 9, display: "flex", gap: 7, alignItems: "flex-start" }}>
                  <Sparkles style={{ width: 13, height: 13, color: "#059669", flexShrink: 0, marginTop: 1 }} />
                  <p style={{ fontSize: 11, color: "#047857", lineHeight: 1.5 }}>
                    チケット内容から必要スキルを自動判定しました。違っていれば下で調整して「再レコメンド」してください。
                  </p>
                </div>
              )}
              <TicketSkillFields
                skills={skills}
                required={required}
                devScale={devScale}
                onRequiredChange={setRequired}
                onDevScaleChange={setDevScale}
              />
            </>
          )}

          {/* 再レコメンド（スキル・規模を手で直したあと押し直す） */}
          <button onClick={() => void runRecommend()} disabled={required.length === 0 || loading}
            title={required.length === 0 ? "必要スキルを1つ以上選んでください" : undefined}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "11px 0", fontSize: 13, fontWeight: 700, borderRadius: 10, border: "none", background: required.length === 0 || loading ? "#D1D5DB" : "#059669", color: "#fff", cursor: required.length === 0 || loading ? "not-allowed" : "pointer", boxShadow: required.length === 0 || loading ? "none" : "0 2px 8px rgba(5,150,105,0.25)" }}>
            {loading
              ? <><Loader2 style={{ width: 14, height: 14, animation: "spin 1s linear infinite" }} />候補を計算中...</>
              : <><Sparkles style={{ width: 14, height: 14 }} />再レコメンド</>}
          </button>

          {/* 保存済みスキルで開いた直後は自動でレコメンドしない → 取得を促すヒント */}
          {!searched && !loading && required.length > 0 && (
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 10, textAlign: "center" as const }}>
              「再レコメンド」で空き状況からおすすめ担当者を取得します。
            </p>
          )}

          {/* 結果 */}
          {searched && !loading && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#047857" }}>おすすめ担当者（適合×空き）</span>
                <span style={{ fontSize: 9.5, color: "#059669", opacity: 0.8 }}>{source === "model" ? "学習済みモデル" : "実績ベース"}</span>
              </div>

              {error ? (
                <p style={{ fontSize: 11.5, color: "#A09790", padding: "8px 0" }}>候補を取得できませんでした</p>
              ) : (() => {
                // 適合あり(>0%)と適合0%（必須スキルを1つも持たない人）を分離。
                //   ・デフォルト: 適合ありの上位3人   ・「もっと見る」: 適合あり全員
                //   ・「さらに全メンバー」: 適合0%の人を最下部に追加表示
                const matched = candidates.filter(c => c.skillMatch > 0);
                const zero = candidates.filter(c => c.skillMatch <= 0);
                const matchedShown = showAll ? matched : matched.slice(0, 3);
                const matchedFull = showAll || matched.length <= 3;   // 適合ありを出し切ったか
                const zeroShown = showZero && matchedFull;            // 出し切った時だけ0%を追加
                const visible = zeroShown ? [...matchedShown, ...zero] : matchedShown;

                if (matched.length === 0 && !zeroShown) {
                  return (
                    <>
                      <p style={{ fontSize: 11.5, color: "#A09790", padding: "8px 0" }}>
                        必須スキルに適合するメンバーがいません
                      </p>
                      {zero.length > 0 && (
                        <button onClick={() => setShowZero(true)}
                          style={{ width: "100%", padding: "8px 0", fontSize: 11.5, fontWeight: 600, borderRadius: 8, border: "1px dashed rgba(26,23,20,0.15)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
                          {`すべてのメンバーを表示（適合0%の${zero.length}人）`}
                        </button>
                      )}
                    </>
                  );
                }

                return (
                  <>
                    {visible.map((c, i) => {
                      const recommended = i === 0 && c.skillMatch > 0;   // 先頭かつ適合あり＝推奨
                      return (
                        <button key={c.profileId} onClick={() => {
                          // 「レコメンド結果からこの人に決めた」を学習用に記録（採用ログ）
                          void logRecommendationAccepted({ organizationId: orgId, ticketId, candidates, chosen: c, source });
                          onPick(c.name, required, devScale);
                          onClose();
                        }}
                          style={{ width: "100%", textAlign: "left" as const, display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", borderRadius: 10, background: recommended ? "#ECFDF5" : "#F0FDF4", border: recommended ? "2px solid #059669" : "1px solid rgba(5,150,105,0.2)", marginBottom: 7, cursor: "pointer" }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#DCFCE7"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = recommended ? "#ECFDF5" : "#F0FDF4"; }}>
                          <span style={{ fontSize: 13, fontWeight: 800, color: "#059669", width: 16, flexShrink: 0 }}>{i + 1}.</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1714" }}>{c.name}</span>
                              {recommended && (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 800, color: "#fff", background: "#059669", padding: "2px 7px", borderRadius: 999 }}>
                                  <Sparkles style={{ width: 10, height: 10 }} />推奨
                                </span>
                              )}
                              <span style={{ fontSize: 10.5, fontWeight: 700, color: c.activeCount === 0 ? "#059669" : "#6B6458" }}>
                                稼働中{c.activeCount}件
                              </span>
                              <span style={{ fontSize: 10.5, fontWeight: 600, color: "#A09790" }}>適合 {Math.round(c.skillMatch * 100)}%</span>
                            </div>
                            <p style={{ fontSize: 11, color: "#6B6458", marginTop: 3, lineHeight: 1.55 }}>{c.reasons.join(" · ")}</p>
                          </div>
                          <span style={{ flexShrink: 0, alignSelf: "center", fontSize: 11, fontWeight: 700, color: "#059669" }}>この人に決定 →</span>
                        </button>
                      );
                    })}

                    {matched.length > 3 && (
                      <button onClick={() => setShowAll(v => !v)}
                        style={{ width: "100%", padding: "8px 0", fontSize: 11.5, fontWeight: 600, borderRadius: 8, border: "1px dashed rgba(26,23,20,0.15)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
                        {showAll ? "上位3人だけ表示" : `もっと見る（他${matched.length - 3}人）`}
                      </button>
                    )}

                    {matchedFull && zero.length > 0 && (
                      <button onClick={() => setShowZero(v => !v)}
                        style={{ width: "100%", marginTop: 4, padding: "8px 0", fontSize: 11.5, fontWeight: 600, borderRadius: 8, border: "1px dashed rgba(26,23,20,0.15)", background: "transparent", color: "#A09790", cursor: "pointer" }}>
                        {showZero ? "適合0%のメンバーを隠す" : `さらにすべてのメンバーを表示（適合0%の${zero.length}人）`}
                      </button>
                    )}
                  </>
                );
              })()}
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
