// ENHA2-034 メンバーのスキル編集モーダル
//
// 構造は「レイヤー(固定6種) → その配下にスキル名＋レベル1〜4」。
// 初回は①スキル分析が実績から自動登録しているので、管理者は中身を確認して直すだけ。
// 保存すると source='manual' になり、以降は自動判定に上書きされなくなる。

import { useEffect, useMemo, useState } from "react";
import { X, Plus, Trash2, Sparkles, Check } from "lucide-react";
import type { Member, Skill, MemberSkill, SkillLevel, SkillLayer } from "@/app/types";
import { SKILL_LAYERS, SKILL_LEVELS, SEED_SKILLS, evidenceText } from "@/app/lib/skills";
import { fetchSkills, fetchMemberSkills, saveMemberSkills, createSkill } from "@/app/lib/skillsApi";
import { useToast } from "@/app/contexts/ToastContext";

interface Row {
  skillId: string;
  level: SkillLevel;
  source: "auto" | "manual";
  evidence: string;
}

export function MemberSkillDialog({ member, orgId, onClose, onSaved }: {
  member: Member;
  orgId: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingLayer, setAddingLayer] = useState<SkillLayer | null>(null);

  useEffect(() => {
    (async () => {
      const [sk, ms] = await Promise.all([fetchSkills(orgId), fetchMemberSkills([member.id])]);
      setSkills(sk);
      setRows(ms.map((m: MemberSkill) => ({
        skillId: m.skillId,
        level: m.level,
        source: m.source,
        evidence: evidenceText(m.evidence),
      })));
      setLoading(false);
    })();
  }, [member.id, orgId]);

  const skillById = useMemo(() => Object.fromEntries(skills.map(s => [s.id, s])), [skills]);
  const hasAuto = rows.some(r => r.source === "auto");

  // レイヤーごとに行をまとめる
  const byLayer = useMemo(() => {
    const m: Record<string, Row[]> = {};
    for (const r of rows) {
      const layer = skillById[r.skillId]?.layer;
      if (!layer) continue;
      (m[layer] ??= []).push(r);
    }
    return m;
  }, [rows, skillById]);

  const setLevel = (skillId: string, level: SkillLevel) =>
    setRows(prev => prev.map(r => (r.skillId === skillId ? { ...r, level, source: "manual" } : r)));

  const removeRow = (skillId: string) => {
    setRows(prev => prev.filter(r => r.skillId !== skillId));
    setRemoved(prev => [...prev, skillId]);
  };

  // あるレイヤーで「追加できるスキル」の候補。
  //   ① スキルマスタに登録済みでこのメンバーが未保有のもの
  //   ② 初期辞書(SEED_SKILLS)にあってスキルマスタ未登録のもの（選んだら自動でマスタに登録）
  // これで、実績から見つからなかったスキル（フロントのVue等）も常に追加できる。
  type AddOption = { key: string; name: string; layer: SkillLayer; skillId?: string; keywords?: string[] };
  const optionsForLayer = (layer: SkillLayer): AddOption[] => {
    const registered: AddOption[] = skills
      .filter(s => s.layer === layer && !rows.some(r => r.skillId === s.id))
      .map(s => ({ key: s.id, name: s.name, layer, skillId: s.id }));
    const masterNames = new Set(skills.filter(s => s.layer === layer).map(s => s.name));
    const seed: AddOption[] = SEED_SKILLS
      .filter(s => s.layer === layer && !masterNames.has(s.name))
      .map(s => ({ key: `seed:${s.name}`, name: s.name, layer, keywords: s.keywords }));
    return [...registered, ...seed];
  };

  const addSkill = async (opt: AddOption) => {
    let skillId = opt.skillId;
    // 初期辞書のスキル → まずスキルマスタに登録して skillId を得る
    if (!skillId) {
      const created = await createSkill(orgId, opt.layer, opt.name, opt.keywords ?? []);
      if (!created) return;
      setSkills(prev => [...prev, created]);
      skillId = created.id;
    }
    if (rows.some(r => r.skillId === skillId)) { setAddingLayer(null); return; }
    setRows(prev => [...prev, { skillId: skillId!, level: 1, source: "manual", evidence: "手動で追加" }]);
    setRemoved(prev => prev.filter(id => id !== skillId));
    setAddingLayer(null);
  };

  const save = async () => {
    setSaving(true);
    try {
      // 確認して保存＝すべて「人が承認した値」になる。以降、自動判定は上書きしない。
      await saveMemberSkills(
        member.id,
        rows.map(r => ({ skillId: r.skillId, level: r.level })),
        removed,
      );
      toast(`「${member.name}」のスキルを保存しました`);
      onSaved?.();
      onClose();
    } catch (e) {
      toast(`保存に失敗しました: ${e}`, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, width: 640, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>

        {/* ヘッダー */}
        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
              {member.name} さんのスキル
            </h2>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
              レイヤーごとにスキルとレベル(1〜4)を設定します
            </p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>

        {/* AI推定の注意書き */}
        {hasAuto && (
          <div style={{ margin: "14px 22px 0", padding: "10px 12px", background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Sparkles style={{ width: 14, height: 14, color: "#D97706", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 11.5, color: "#92400E", lineHeight: 1.5 }}>
              過去の実績からシステムが推定したスキルが含まれています。内容をご確認ください。
              <br />修正して保存すると、以降は自動更新で上書きされなくなります。
            </p>
          </div>
        )}

        {/* 本体 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {loading ? (
            <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "40px 0" }}>読み込み中...</p>
          ) : skills.length === 0 ? (
            <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "40px 0" }}>
              スキルマスタが未登録です。先に「スキル管理」からスキルを登録してください。
            </p>
          ) : (
            SKILL_LAYERS.map(layer => {
              const layerRows = byLayer[layer.key] ?? [];
              const addOptions = optionsForLayer(layer.key);

              return (
                <div key={layer.key} style={{ marginBottom: 18 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: layer.bg, color: layer.color }}>
                      {layer.label}
                    </span>
                    {layerRows.length === 0 && (
                      <span style={{ fontSize: 11, color: "#C9C4BB" }}>未登録</span>
                    )}
                  </div>

                  {layerRows.map(r => {
                    const s = skillById[r.skillId];
                    if (!s) return null;
                    return (
                      <div key={r.skillId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, background: "#FAFAFA", marginBottom: 6 }}>
                        <div style={{ width: 128, flexShrink: 0 }}>
                          <p style={{ fontSize: 12.5, fontWeight: 600, color: "#1A1714" }}>{s.name}</p>
                          {r.source === "auto" && (
                            <span style={{ fontSize: 9, color: "#D97706", fontWeight: 600 }}>AI推定</span>
                          )}
                        </div>

                        {/* レベル ①②③④ */}
                        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                          {SKILL_LEVELS.map(lv => (
                            <button key={lv.level} title={`Lv${lv.level}: ${lv.label}（${lv.detail}）`}
                              onClick={() => setLevel(r.skillId, lv.level)}
                              style={{
                                width: 26, height: 26, borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer",
                                border: r.level >= lv.level ? "1px solid #059669" : "1px solid rgba(26,23,20,0.12)",
                                background: r.level >= lv.level ? "#059669" : "#FFFFFF",
                                color: r.level >= lv.level ? "#FFFFFF" : "#C9C4BB",
                                transition: "all 0.12s",
                              }}>
                              {lv.level}
                            </button>
                          ))}
                        </div>

                        {/* 根拠（なぜそのレベルなのか。納得して直せるように見せる） */}
                        <p style={{ flex: 1, fontSize: 10.5, color: "#A09790", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {r.evidence}
                        </p>

                        <button onClick={() => removeRow(r.skillId)} title="削除"
                          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 4, flexShrink: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                          <Trash2 style={{ width: 13, height: 13 }} />
                        </button>
                      </div>
                    );
                  })}

                  {/* スキル追加（初期辞書も候補に含めるので、どのレイヤーでも追加できる） */}
                  {addOptions.length > 0 && (
                    addingLayer === layer.key ? (
                      <select autoFocus defaultValue=""
                        onChange={e => { const o = addOptions.find(x => x.key === e.target.value); if (o) void addSkill(o); }}
                        onBlur={() => setAddingLayer(null)}
                        style={{ marginTop: 4, padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(5,150,105,0.4)", outline: "none", background: "#FFFFFF", color: "#1A1714" }}>
                        <option value="">スキルを選択...</option>
                        {addOptions.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
                      </select>
                    ) : (
                      <button onClick={() => setAddingLayer(layer.key)}
                        style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "1px dashed rgba(26,23,20,0.15)", borderRadius: 8, padding: "5px 10px", fontSize: 11, color: "#A09790", cursor: "pointer" }}>
                        <Plus style={{ width: 11, height: 11 }} />スキルを追加
                      </button>
                    )
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* フッター */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid rgba(26,23,20,0.08)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose}
            style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
            キャンセル
          </button>
          <button onClick={save} disabled={saving || loading}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", background: saving ? "#9CA3AF" : "#059669", color: "#fff", cursor: saving ? "not-allowed" : "pointer", boxShadow: "0 2px 8px rgba(5,150,105,0.25)" }}>
            <Check style={{ width: 13, height: 13 }} />
            {saving ? "保存中..." : "確認済みで保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
