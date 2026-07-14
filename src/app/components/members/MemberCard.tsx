import React, { useState, useEffect } from "react";
import { Eye, Edit2, Mail, Trash2, Layers, Zap, Sparkles } from "lucide-react";
import type { Member, Skill, MemberSkill } from "@/app/types";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { getRoleMeta } from "@/app/lib/helpers";
import { layerMeta } from "@/app/lib/skills";
import { setSkillAutoUpdate } from "@/app/lib/skillsApi";
import { Avatar } from "@/app/components/shared/Avatar";

const ROLE_COLORS: Record<string, { grad: string; badge: string; text: string }> = {
  admin: { grad: "linear-gradient(135deg,#FB7185,#F43F5E)", badge: "#FFF1F2", text: "#F43F5E" },
  "project-manager": { grad: "linear-gradient(135deg,#34D399,#059669)", badge: "#ECFDF5", text: "#059669" },
  developer: { grad: "linear-gradient(135deg,#38BDF8,#0284C7)", badge: "#F0F9FF", text: "#0284C7" },
  designer: { grad: "linear-gradient(135deg,#A78BFA,#7C3AED)", badge: "#F5F3FF", text: "#7C3AED" },
};
const DEFAULT_ROLE_COLOR = { grad: "linear-gradient(135deg,#9CA3AF,#6B7280)", badge: "#F3F4F6", text: "#6B7280" };
function getRoleColor(role: string) { return ROLE_COLORS[role] ?? DEFAULT_ROLE_COLOR; }

export function MemberCard({ member, canEdit, canDelete, canManageSkills, skills, memberSkills, highlighted, cardRef, onEdit, onDetail, onDelete, onSkills, onAutoUpdateChanged }: {
  member: Member; canEdit: boolean; canDelete: boolean;
  // ENHA2-034: スキルUI は「メンバー管理」権限(canAccessMembers)を持つ人だけに見せる
  canManageSkills?: boolean;
  skills?: Skill[];
  memberSkills?: MemberSkill[];
  highlighted?: boolean; cardRef?: React.RefObject<HTMLDivElement | null>;
  onEdit?: () => void; onDetail?: () => void; onDelete?: () => void;
  onSkills?: () => void;
  onAutoUpdateChanged?: (on: boolean) => void;
}) {
  const [projectCount, setProjectCount] = useState<number>(member.projects ?? 0);
  const [ticketCount, setTicketCount] = useState<number>(member.tickets ?? 0);
  const [autoUpdate, setAutoUpdate] = useState<boolean>(member.skillAutoUpdate !== false);

  useEffect(() => { setAutoUpdate(member.skillAutoUpdate !== false); }, [member.skillAutoUpdate]);

  // 🌟 追加: カードが描画された際に、DBから実際の件数を同期取得する
  useEffect(() => {
    if (!isSupabaseEnabled || !member.name) return;

    const fetchCounts = async () => {
      // 担当プロジェクトのカウント
      const { data: projData } = await supabase!.from("projects").select("members");
      if (projData) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const count = projData.filter((p: any) => Array.isArray(p.members) && p.members.includes(member.name)).length;
        setProjectCount(count);
      }

      // 担当チケットのカウント
      const { count: tktCount } = await supabase!
        .from("sprint_tickets")
        .select("id", { count: "exact", head: true })
        .eq("assignee", member.name);
      if (tktCount !== null) {
        setTicketCount(tktCount);
      }
    };

    fetchCounts();
  }, [member.name]);

  const rc = getRoleColor(member.role);
  const roleMeta = getRoleMeta(member.role);

  // ENHA2-034: カード上にスキルを一目でわかるように出す。
  // 「AI推定・未確認」のバッジで、どの人がまだ確認されていないかが一覧で見える。
  const mySkills = (memberSkills ?? []).filter(ms => ms.profileId === member.id);
  const skillById = new Map((skills ?? []).map(s => [s.id, s]));
  const chips = mySkills
    .map(ms => ({ ms, skill: skillById.get(ms.skillId) }))
    .filter((x): x is { ms: MemberSkill; skill: Skill } => Boolean(x.skill))
    .sort((a, b) => b.ms.level - a.ms.level);
  const hasUnverified = mySkills.some(ms => ms.source === "auto");

  const toggleAuto = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !autoUpdate;
    setAutoUpdate(next);   // 楽観更新
    try {
      await setSkillAutoUpdate(member.id, next);
      onAutoUpdateChanged?.(next);
    } catch {
      setAutoUpdate(!next);   // 失敗したら戻す
    }
  };

  return (
    <div ref={cardRef}
      style={{ background: "#FFFFFF", borderRadius: 16, overflow: "hidden", boxShadow: highlighted ? "0 0 0 3px #059669, 0 8px 32px rgba(5,150,105,0.20)" : "0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)", transition: "all 0.2s", cursor: "pointer" }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = highlighted ? "0 0 0 3px #059669, 0 8px 32px rgba(5,150,105,0.25)" : "0 8px 28px rgba(26,23,20,0.12)"; (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = highlighted ? "0 0 0 3px #059669, 0 8px 32px rgba(5,150,105,0.20)" : "0 1px 3px rgba(26,23,20,0.06), 0 4px 12px rgba(26,23,20,0.04)"; (e.currentTarget as HTMLElement).style.transform = "none"; }}>
      <div style={{ height: 60, background: rc.grad, position: "relative", borderRadius: "16px 16px 0 0", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(circle at 80% 50%, rgba(255,255,255,0.12) 0%, transparent 60%)" }} />
        <div style={{ position: "absolute", top: 12, right: 14 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.9)", background: "rgba(255,255,255,0.18)", padding: "3px 8px", borderRadius: 20, letterSpacing: "0.04em" }}>
            {roleMeta.label.toUpperCase()}
          </span>
        </div>
      </div>
      <div style={{ position: "relative", height: 0 }}>
        <div style={{ position: "absolute", top: -20, left: 18, border: "3px solid #FFFFFF", borderRadius: "50%", boxShadow: "0 2px 8px rgba(26,23,20,0.15)", zIndex: 1 }}>
          <Avatar name={member.name} size="md" />
        </div>
      </div>
      <div style={{ padding: "28px 18px 18px" }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>{member.name}</p>
            {member.status === "invited"
              ? <span style={{ fontSize: 9, background: "#FFFBEB", color: "#D97706", padding: "2px 6px", borderRadius: 20, fontWeight: 600 }}>招待中</span>
              : member.status === "inactive"
                ? <span style={{ fontSize: 9, background: "#F3F4F6", color: "#9CA3AF", padding: "2px 6px", borderRadius: 20, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#D1D5DB", display: "inline-block" }} />オフライン</span>
                : <span style={{ fontSize: 9, background: "#ECFDF5", color: "#059669", padding: "2px 6px", borderRadius: 20, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />アクティブ</span>
            }
          </div>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 3, display: "flex", alignItems: "center", gap: 4 }}>
            <Mail style={{ width: 9, height: 9 }} />{member.email}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: rc.badge, color: rc.text }}>{roleMeta.label}</span>
            <span style={{ fontSize: 10, color: "#C9C4BB", display: "flex", alignItems: "center", gap: 3 }}>
              <Layers style={{ width: 9, height: 9 }} />{member.group}
            </span>
          </div>
        </div>
        {/* ── ENHA2-034 スキル（メンバー管理権限を持つ人だけに表示） ── */}
        {canManageSkills && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ background: "#FAFAFA", border: "1px solid rgba(26,23,20,0.06)", borderRadius: 10, padding: "8px 10px", minHeight: 52 }}>
              {chips.length === 0 ? (
                <p style={{ fontSize: 10.5, color: "#C9C4BB" }}>スキル未登録</p>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {chips.slice(0, 4).map(({ ms, skill }) => {
                      const lm = layerMeta(skill.layer);
                      return (
                        <span key={ms.skillId} title={`${lm.label} / ${skill.name} Lv${ms.level}`}
                          style={{ fontSize: 9.5, fontWeight: 600, padding: "2px 6px", borderRadius: 5, background: lm.bg, color: lm.color, whiteSpace: "nowrap" }}>
                          {skill.name} {ms.level}
                        </span>
                      );
                    })}
                    {chips.length > 4 && (
                      <span style={{ fontSize: 9.5, color: "#B0A9A4", padding: "2px 4px" }}>+{chips.length - 4}</span>
                    )}
                  </div>
                  {hasUnverified && (
                    <p style={{ fontSize: 9, color: "#D97706", fontWeight: 600, marginTop: 5, display: "flex", alignItems: "center", gap: 3 }}>
                      <Sparkles style={{ width: 9, height: 9 }} />AI推定・未確認
                    </p>
                  )}
                </>
              )}
            </div>

            {/* 自動更新トグル。
                OFF にすると①スキル分析がこのメンバーのスキルを上書きしなくなる。
                ②レコメンドの対象からは外れない（手動スキル＋実績で推薦される）。 */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8, padding: "0 2px" }}>
              <span title="OFFにすると、システムによるスキルの自動更新を停止します（レコメンドの対象からは外れません）"
                style={{ fontSize: 10.5, color: "#6B6458", fontWeight: 500 }}>
                スキル自動更新
              </span>
              <button onClick={toggleAuto} role="switch" aria-checked={autoUpdate}
                style={{ width: 34, height: 19, borderRadius: 999, border: "none", cursor: "pointer", padding: 2, background: autoUpdate ? "#059669" : "#D1D5DB", transition: "background 0.15s", display: "flex", justifyContent: autoUpdate ? "flex-end" : "flex-start", alignItems: "center" }}>
                <span style={{ width: 15, height: 15, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.2)", display: "block" }} />
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {/* 🌟 修正: valueの参照先を取得した projectCount と ticketCount に変更 */}
          {[{ value: projectCount, label: "PJ", accent: "#059669" }, { value: ticketCount, label: "チケット", accent: "#0284C7" }].map(({ value, label }) => (
            <div key={label} style={{ background: "#F4F5F6", borderRadius: 10, padding: "12px", textAlign: "center" as const }}>
              <p style={{ fontSize: 26, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.04em", lineHeight: 1 }}>{value}</p>
              <p style={{ fontSize: 9, color: "#B0A9A4", marginTop: 3, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em" }}>{label}</p>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 7 }}>
          <button onClick={e => { e.stopPropagation(); onDetail?.(); }}
            style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#F4F5F6"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
            <Eye style={{ width: 12, height: 12 }} />詳細
          </button>
          {canManageSkills && (
            <button onClick={e => { e.stopPropagation(); onSkills?.(); }}
              style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: hasUnverified ? "1px solid rgba(217,119,6,0.35)" : "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: hasUnverified ? "#D97706" : "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FFFBEB"; (e.currentTarget as HTMLElement).style.color = "#D97706"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(217,119,6,0.35)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = hasUnverified ? "#D97706" : "#6B6458"; (e.currentTarget as HTMLElement).style.borderColor = hasUnverified ? "rgba(217,119,6,0.35)" : "rgba(26,23,20,0.10)"; }}>
              <Zap style={{ width: 12, height: 12 }} />スキル
            </button>
          )}
          {canEdit && (
            <button onClick={e => { e.stopPropagation(); onEdit?.(); }}
              style={{ flex: 1, padding: "9px 0", fontSize: 12, fontWeight: 600, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#6B6458", display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#ECFDF5"; (e.currentTarget as HTMLElement).style.color = "#059669"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(5,150,105,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#6B6458"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
              <Edit2 style={{ width: 12, height: 12 }} />編集
            </button>
          )}
          {canDelete && onDelete && (
            <button onClick={e => { e.stopPropagation(); onDelete(); }}
              style={{ padding: "9px 10px", fontSize: 12, borderRadius: 9, border: "1px solid rgba(26,23,20,0.10)", background: "transparent", cursor: "pointer", color: "#C9C4BB", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; (e.currentTarget as HTMLElement).style.color = "#DC2626"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(220,38,38,0.25)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#C9C4BB"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(26,23,20,0.10)"; }}>
              <Trash2 style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
