// ENHA2-034 スキルマスタ管理
//
// 通常は使わない補助的な画面。初回に①スキル分析が過去チケットを解析して
// スキルを自動登録するので、ゼロから作る必要はない。
// これを使うのは「社内独自の技術が初期辞書に無かったので手で足したい」ときだけ。
//
// 検出キーワード: 過去チケットのタイトル等からこのスキルを自動判定するための手がかり。
//   ここに登録した語が、次回の分析からスキル検出に使われる。

import { useEffect, useState } from "react";
import { X, Plus, Trash2, RefreshCw } from "lucide-react";
import type { Skill, SkillLayer } from "@/app/types";
import { SKILL_LAYERS } from "@/app/lib/skills";
import { fetchSkills, createSkill, deleteSkill, runSkillAnalysis } from "@/app/lib/skillsApi";
import { useToast } from "@/app/contexts/ToastContext";

export function SkillMasterDialog({ orgId, onClose, onChanged }: {
  orgId: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [reanalyzing, setReanalyzing] = useState(false);

  const [layer, setLayer] = useState<SkillLayer>("frontend");
  const [name, setName] = useState("");
  const [keywords, setKeywords] = useState("");

  const load = async () => {
    setSkills(await fetchSkills(orgId));
    setLoading(false);
  };
  useEffect(() => { void load(); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const kw = keywords.split(/[,、\s]+/).map(s => s.trim()).filter(Boolean);
    try {
      await createSkill(orgId, layer, n, kw);
      setName(""); setKeywords("");
      await load();
      onChanged?.();
      toast(`スキル「${n}」を登録しました`);
    } catch (e) {
      toast(`登録に失敗しました: ${e}`, "error");
    }
  };

  const remove = async (s: Skill) => {
    await deleteSkill(s.id);
    await load();
    onChanged?.();
    toast(`スキル「${s.name}」を削除しました`);
  };

  // 「今すぐ再分析」。次の深夜3時を待たずにスキルを更新する。
  // （新メンバーが入った直後などに使う。無くても翌日には自動で反映される）
  const reanalyze = async () => {
    setReanalyzing(true);
    try {
      const { skillsWritten, reason, debug } = await runSkillAnalysis(orgId, true);
      await load();
      onChanged?.();
      if (skillsWritten > 0) {
        toast(`実績からスキルを再分析しました（${skillsWritten}件更新）`);
      } else {
        // 0件だった原因（止まった段階＋握りつぶしていたエラー）をそのまま画面に出す
        const detail = debug ? JSON.stringify(debug) : "";
        toast(`0件でした｜停止理由: ${reason ?? "不明"}｜${detail}`, "error");
        // 全文はコンソールにも出す（トーストが切れても追えるように）
        // eslint-disable-next-line no-console
        console.log("[skill-analysis] reason=", reason, "debug=", debug);
      }
    } catch (e) {
      toast(`再分析に失敗しました: ${e}`, "error");
    } finally {
      setReanalyzing(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(26,23,20,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, padding: 20 }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: "#FFFFFF", borderRadius: 16, width: 620, maxWidth: "100%", maxHeight: "88vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

        <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(26,23,20,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)" }}>スキル管理</h2>
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>
              通常は実績から自動登録されます。独自技術を足したいときだけ使います
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={reanalyze} disabled={reanalyzing}
              title="次の深夜3時を待たずに、実績からスキルを再分析します"
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", fontSize: 11.5, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(5,150,105,0.3)", background: "#ECFDF5", color: "#059669", cursor: reanalyzing ? "not-allowed" : "pointer" }}>
              <RefreshCw style={{ width: 12, height: 12, animation: reanalyzing ? "spin 1s linear infinite" : "none" }} />
              {reanalyzing ? "分析中..." : "今すぐ再分析"}
            </button>
            <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#B0A9A4", padding: 4 }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {loading ? (
            <p style={{ fontSize: 12, color: "#A09790", textAlign: "center", padding: "40px 0" }}>読み込み中...</p>
          ) : (
            SKILL_LAYERS.map(l => {
              const rows = skills.filter(s => s.layer === l.key);
              return (
                <div key={l.key} style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 20, background: l.bg, color: l.color }}>
                    {l.label}
                  </span>
                  <div style={{ marginTop: 7 }}>
                    {rows.length === 0 ? (
                      <p style={{ fontSize: 11, color: "#C9C4BB", padding: "4px 2px" }}>未登録</p>
                    ) : rows.map(s => (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 8, background: "#FAFAFA", marginBottom: 4 }}>
                        <p style={{ fontSize: 12.5, fontWeight: 600, color: "#1A1714", width: 130, flexShrink: 0 }}>{s.name}</p>
                        <p style={{ flex: 1, fontSize: 10.5, color: "#A09790", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {s.keywords.length > 0 ? `検出語: ${s.keywords.join(" / ")}` : "検出語なし"}
                        </p>
                        <button onClick={() => remove(s)} title="削除"
                          style={{ background: "transparent", border: "none", cursor: "pointer", color: "#C9C4BB", padding: 3, flexShrink: 0 }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#DC2626"; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; }}>
                          <Trash2 style={{ width: 12, height: 12 }} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 追加フォーム */}
        <div style={{ padding: "14px 22px", borderTop: "1px solid rgba(26,23,20,0.08)", background: "#FAFAFA", borderRadius: "0 0 16px 16px" }}>
          <p style={{ fontSize: 11.5, fontWeight: 700, color: "#6B6458", marginBottom: 8 }}>スキルを追加</p>
          <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
            <select value={layer} onChange={e => setLayer(e.target.value as SkillLayer)}
              style={{ padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", color: "#1A1714", outline: "none", width: 130 }}>
              {SKILL_LAYERS.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
            </select>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="スキル名（例: 社内共通基盤）"
              style={{ flex: 1, padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", color: "#1A1714", outline: "none", minWidth: 0 }} />
            <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="検出キーワード（カンマ区切り）"
              title="過去チケットのタイトル等からこのスキルを自動判定するための語"
              style={{ flex: 1, padding: "8px 10px", fontSize: 12, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "#fff", color: "#1A1714", outline: "none", minWidth: 0 }} />
            <button onClick={add} disabled={!name.trim()}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 13px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", background: name.trim() ? "#059669" : "#D1D5DB", color: "#fff", cursor: name.trim() ? "pointer" : "not-allowed", flexShrink: 0 }}>
              <Plus style={{ width: 12, height: 12 }} />追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
