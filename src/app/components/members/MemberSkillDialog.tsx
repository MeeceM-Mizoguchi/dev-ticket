// ENHA2-034 メンバーのスキル編集モーダル
//
// 構造は「レイヤー(固定6種) → その配下にスキル名＋レベル1〜4」。
// 初回は①スキル分析が実績から自動登録しているので、管理者は中身を確認して直すだけ。
// 保存すると source='manual' になり、以降は自動判定に上書きされなくなる。
//
// BRU9-041 で追加:
//   ・「履歴」タブ … このメンバーのスキルがいつ何に変わったかを時系列で見る／過去の時点へ戻す
//   ・スキル自動更新トグル … 従来はメンバーカードにしか無く、スキルを直す文脈で見つからなかった

import { useEffect, useMemo, useState } from "react";
import { X, Trash2, Sparkles, Check, History, Zap } from "lucide-react";
import type { Member, Skill, MemberSkill, SkillLevel, SkillLayer } from "@/app/types";
import { SKILL_LAYERS, SKILL_LEVELS, evidenceText } from "@/app/lib/skills";
import {
  fetchSkills, fetchMemberSkills, saveMemberSkills, createSkill,
  fetchSkillHistory, setSkillAutoUpdate, type SkillHistoryEntry,
} from "@/app/lib/skillsApi";
import { useToast } from "@/app/contexts/ToastContext";
import { useAuth } from "@/app/contexts/AuthContext";
import { SkillHistoryView } from "@/app/components/members/SkillHistoryView";
import { SkillRestoreDialog } from "@/app/components/members/SkillRestoreDialog";

interface Row {
  skillId: string;
  level: SkillLevel;
  source: "auto" | "manual";
  evidence: string;
}

export function MemberSkillDialog({ member, orgId, canRestore, onClose, onSaved }: {
  member: Member;
  orgId: string;
  /** 復元できるのはオーナー/管理者のみ。false なら履歴は見えるが戻せない。 */
  canRestore?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { toast } = useToast();
  const { userId } = useAuth();
  const [tab, setTab] = useState<"skills" | "history">("skills");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);   // 何か変更したか（未変更なら保存ボタンを非活性に）
  // 自由入力モード（辞書に無いスキルを自分で入力して追加する）
  const [customLayer, setCustomLayer] = useState<SkillLayer | null>(null);
  const [customName, setCustomName] = useState("");
  // ── BRU9-041 履歴・復元・自動更新トグル ──
  const [history, setHistory] = useState<SkillHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [restoreAt, setRestoreAt] = useState<string | null>(null);
  const [autoUpdate, setAutoUpdate] = useState<boolean>(member.skillAutoUpdate !== false);

  const reload = async () => {
    const [sk, ms] = await Promise.all([fetchSkills(orgId), fetchMemberSkills([member.id])]);
    setSkills(sk);
    setRows(ms.map((m: MemberSkill) => ({
      skillId: m.skillId,
      level: m.level,
      source: m.source,
      evidence: evidenceText(m.evidence),
    })));
    setRemoved([]);
    setDirty(false);
    setLoading(false);
  };

  useEffect(() => {
    void reload();
  }, [member.id, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setAutoUpdate(member.skillAutoUpdate !== false); }, [member.skillAutoUpdate]);

  // 履歴タブを開いたときに読む（初回だけでなく、復元後の再読込にも使う）
  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      setHistory(await fetchSkillHistory(orgId, { profileId: member.id }));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "history" && history.length === 0 && !historyLoading) void loadHistory();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleAuto = async () => {
    const next = !autoUpdate;
    setAutoUpdate(next);   // 楽観更新
    try {
      await setSkillAutoUpdate(member.id, next);
      toast(next ? "スキルの自動更新をONにしました" : "スキルの自動更新をOFFにしました");
      onSaved?.();   // メンバー一覧のカードにも反映させる
    } catch (e) {
      setAutoUpdate(!next);   // 失敗したら戻す。握りつぶさず理由を出す。
      toast(`設定を変更できませんでした: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

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

  const setLevel = (skillId: string, level: SkillLevel) => {
    setRows(prev => prev.map(r => (r.skillId === skillId ? { ...r, level, source: "manual" } : r)));
    setDirty(true);
  };

  const removeRow = (skillId: string) => {
    setRows(prev => prev.filter(r => r.skillId !== skillId));
    setRemoved(prev => [...prev, skillId]);
    setDirty(true);
  };

  // あるレイヤーで「追加できるスキル」の候補。
  //   ① スキルマスタに登録済みで、このメンバーがまだ持っていないもの
  //   ② 「自分で入力...」… 新しいスキルを入力してスキルマスタ(DB)に登録して追加
  // 内蔵辞書の候補は出さない（登録済み＋自由入力のみ）。
  type AddOption = { key: string; name: string; layer: SkillLayer; skillId?: string };
  const optionsForLayer = (layer: SkillLayer): AddOption[] => {
    const registered: AddOption[] = skills
      .filter(s => s.layer === layer && !rows.some(r => r.skillId === s.id))
      .map(s => ({ key: s.id, name: s.name, layer, skillId: s.id }));
    const custom: AddOption = { key: "__custom__", name: "＋ 自分で入力...", layer };
    return [...registered, custom];
  };

  // 自由入力で新しいスキルを作って追加する
  const addCustom = async (layer: SkillLayer) => {
    const name = customName.trim();
    if (!name) return;
    // 同名が既にあればそれを使う（重複作成を防ぐ）
    const existing = skills.find(s => s.layer === layer && s.name === name);
    let skillId = existing?.id;
    if (!skillId) {
      const created = await createSkill(orgId, layer, name, []);
      if (!created) return;
      setSkills(prev => [...prev, created]);
      skillId = created.id;
    }
    if (!rows.some(r => r.skillId === skillId)) {
      setRows(prev => [...prev, { skillId: skillId!, level: 1, source: "manual", evidence: "手動で追加" }]);
      setRemoved(prev => prev.filter(id => id !== skillId));
      setDirty(true);
    }
    setCustomLayer(null); setCustomName("");
  };

  // 登録済みスキル（スキルマスタにあるもの）をこのメンバーに付与する
  const addSkill = (opt: AddOption) => {
    const skillId = opt.skillId;
    if (!skillId || rows.some(r => r.skillId === skillId)) { return; }
    setRows(prev => [...prev, { skillId, level: 1, source: "manual", evidence: "手動で追加" }]);
    setRemoved(prev => prev.filter(id => id !== skillId));
    setDirty(true);
   
  };

  const save = async () => {
    setSaving(true);
    try {
      // 確認して保存＝すべて「人が承認した値」になる。以降、自動判定は上書きしない。
      await saveMemberSkills(
        member.id,
        rows.map(r => ({ skillId: r.skillId, level: r.level })),
        removed,
        userId,
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
        <div style={{ padding: "18px 22px 0", borderBottom: "1px solid rgba(26,23,20,0.08)" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>
                {member.name} さんのスキル
              </h2>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
                レイヤーごとにスキルとレベル(1〜4)を設定します
              </p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* スキル自動更新トグル。
                  OFF にすると①スキル分析（毎日未明）がこのメンバーのスキルを上書きしなくなる。
                  ②レコメンドの対象からは外れない（手動スキル＋実績で推薦される）。 */}
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span title="OFFにすると、毎日未明のスキル自動更新がこのメンバーに触らなくなります（レコメンドの対象からは外れません）"
                  style={{ fontSize: 11, color: "#6B6458", fontWeight: 600, whiteSpace: "nowrap" }}>
                  スキル自動更新
                </span>
                <button onClick={toggleAuto} role="switch" aria-checked={autoUpdate} aria-label="スキル自動更新"
                  style={{ width: 34, height: 19, borderRadius: 999, border: "none", cursor: "pointer", padding: 2, background: autoUpdate ? "#059669" : "#D1D5DB", transition: "background 0.15s", display: "flex", justifyContent: autoUpdate ? "flex-end" : "flex-start", alignItems: "center", flexShrink: 0 }}>
                  <span style={{ width: 15, height: 15, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", display: "block" }} />
                </button>
              </div>
              <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
                <X style={{ width: 18, height: 18 }} />
              </button>
            </div>
          </div>

          {/* タブ */}
          <div style={{ display: "flex", gap: 2, marginTop: 14 }}>
            {([
              { key: "skills" as const, label: "スキル", Icon: Zap },
              { key: "history" as const, label: "履歴", Icon: History },
            ]).map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "8px 14px", fontSize: 12, fontWeight: 700, border: "none", background: "transparent", cursor: "pointer", color: tab === t.key ? "#059669" : "#A09790", borderBottom: tab === t.key ? "2px solid #059669" : "2px solid transparent", marginBottom: -1 }}>
                <t.Icon style={{ width: 12, height: 12 }} />{t.label}
              </button>
            ))}
          </div>
        </div>

        {/* 自動更新OFFの明示。なぜスキルが更新されないのかが分かるように。 */}
        {!autoUpdate && tab === "skills" && (
          <div style={{ margin: "14px 22px 0", padding: "9px 12px", background: "#F3F4F6", border: "1px solid rgba(26,23,20,0.10)", borderRadius: 10 }}>
            <p style={{ fontSize: 11.5, color: "#6B6458", lineHeight: 1.5 }}>
              このメンバーは<strong style={{ fontWeight: 700 }}>スキル自動更新がOFF</strong>です。毎日未明の自動判定では変更されません。
            </p>
          </div>
        )}

        {/* AI推定の注意書き */}
        {hasAuto && tab === "skills" && (
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
          {tab === "history" ? (
            <SkillHistoryView
              entries={history}
              skills={skills}
              loading={historyLoading}
              // 復元できるのはオーナー/管理者のみ。それ以外には閲覧だけ見せる。
              onRestore={canRestore ? entry => setRestoreAt(entry.run.createdAt) : undefined} />
          ) : loading ? (
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

                  {/* スキル追加（初期辞書＋自由入力。どのレイヤーでも必ず追加できる） */}
                  {customLayer === layer.key ? (
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <input autoFocus value={customName} onChange={e => setCustomName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void addCustom(layer.key); if (e.key === "Escape") { setCustomLayer(null); setCustomName(""); } }}
                        placeholder="スキル名を入力（例: Svelte）"
                        style={{ flex: 1, padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(5,150,105,0.4)", outline: "none", background: "#FFFFFF", color: "#1A1714" }} />
                      <button onClick={() => void addCustom(layer.key)} disabled={!customName.trim()}
                        style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", background: customName.trim() ? "#059669" : "#D1D5DB", color: "#fff", cursor: customName.trim() ? "pointer" : "not-allowed" }}>
                        追加
                      </button>
                      <button onClick={() => { setCustomLayer(null); setCustomName(""); }}
                        style={{ padding: "6px 9px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#A09790", cursor: "pointer" }}>
                        ×
                      </button>
                    </div>
                  ) : (
                    // ワンクリックで開くよう常に select を表示（value="" で選択後もプレースホルダーに戻す）
                    <select value=""
                      onChange={e => {
                        const o = addOptions.find(x => x.key === e.target.value);
                        if (!o) return;
                        if (o.key === "__custom__") { setCustomLayer(layer.key); setCustomName(""); }
                        else addSkill(o);
                      }}
                      style={{ marginTop: 4, padding: "6px 10px", fontSize: 12, borderRadius: 8, border: "1px dashed rgba(26,23,20,0.2)", outline: "none", background: "transparent", color: "#A09790", cursor: "pointer" }}>
                      <option value="">＋ スキルを追加</option>
                      {addOptions.map(o => <option key={o.key} value={o.key}>{o.name}</option>)}
                    </select>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* フッター */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid rgba(26,23,20,0.08)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {tab === "history" ? (
            <button onClick={onClose}
              style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
              閉じる
            </button>
          ) : (
            <>
              <button onClick={onClose}
                style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer" }}>
                キャンセル
              </button>
              {(() => {
                const disabled = saving || loading || !dirty;
                return (
                  <button onClick={save} disabled={disabled}
                    title={!dirty ? "変更がありません" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 5, padding: "9px 16px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, border: "none", background: disabled ? "#D1D5DB" : "#059669", color: "#fff", cursor: disabled ? "not-allowed" : "pointer", boxShadow: disabled ? "none" : "0 2px 8px rgba(5,150,105,0.25)" }}>
                    <Check style={{ width: 13, height: 13 }} />
                    {saving ? "保存中..." : "保存"}
                  </button>
                );
              })()}
            </>
          )}
        </div>
      </div>

      {/* 復元の確認（プレビュー付き） */}
      {restoreAt && (
        <SkillRestoreDialog
          profileId={member.id}
          memberName={member.name}
          at={restoreAt}
          skills={skills}
          actorProfileId={userId ?? null}
          onClose={() => setRestoreAt(null)}
          onRestored={async disabledAutoUpdate => {
            // 復元は自動更新もOFFにしうるので、スキル・履歴・親一覧すべて読み直す
            if (disabledAutoUpdate) setAutoUpdate(false);
            await Promise.all([reload(), loadHistory()]);
            onSaved?.();
          }} />
      )}
    </div>
  );
}
