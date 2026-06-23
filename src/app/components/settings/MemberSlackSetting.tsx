import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { getRoleMeta } from "@/app/lib/helpers";
import { Avatar } from "@/app/components/shared/Avatar";
import type { Role } from "@/app/types";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  slackMemberId: string;
  draft: string;
  saving: boolean;
  saved: boolean;
}

const HOW_TO_STEPS = [
  "Slack アプリを開く",
  "自分（またはメンバー）のアイコンをクリックしてプロフィールを表示",
  "プロフィール右上の「…」をクリック",
  "「メンバー ID をコピー」を選択",
];

function GuidePanel() {
  return (
    <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 12, padding: "16px 18px" }}>
        <p style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 14 }}>SlackメンバーIDの確認方法</p>
        {HOW_TO_STEPS.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 10, paddingBottom: i < HOW_TO_STEPS.length - 1 ? 11 : 0, marginBottom: i < HOW_TO_STEPS.length - 1 ? 11 : 0, borderBottom: i < HOW_TO_STEPS.length - 1 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
            <div style={{ width: 18, height: 18, borderRadius: "50%", background: "linear-gradient(135deg,#059669,#047857)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, color: "#fff", flexShrink: 0, marginTop: 2 }}>
              {i + 1}
            </div>
            <p style={{ fontSize: 11, color: "#374151", lineHeight: 1.6 }}>{step}</p>
          </div>
        ))}
      </div>

      <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "14px 16px" }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "#15803D", marginBottom: 8 }}>IDのフォーマット</p>
        <code style={{ display: "block", fontSize: 15, fontFamily: "var(--font-mono)", fontWeight: 700, color: "#059669", letterSpacing: "0.05em", marginBottom: 6 }}>
          U1234ABCD
        </code>
        <p style={{ fontSize: 11, color: "#166534", lineHeight: 1.7 }}>
          「U」で始まる英数字<br />
          8〜11文字の文字列
        </p>
      </div>

      <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "12px 14px" }}>
        <p style={{ fontSize: 11, color: "#92400E", lineHeight: 1.7 }}>
          他のメンバーのIDは、そのメンバーのプロフィールを開いて同じ手順で確認できます。
        </p>
      </div>
    </div>
  );
}

export function MemberSlackSetting() {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isSupabaseEnabled) { setLoading(false); return; }
    supabase!
      .from("profiles")
      .select("id, name, email, role, slack_member_id")
      .in("status", ["active", "invited"])
      .order("name")
      .then(({ data }) => {
        if (!data) return;
        setMembers((data as any[]).map(m => ({
          id: m.id,
          name: m.name,
          email: m.email,
          role: m.role as Role,
          slackMemberId: m.slack_member_id ?? "",
          draft: m.slack_member_id ?? "",
          saving: false,
          saved: false,
        })));
        setLoading(false);
      });
  }, []);

  const handleSave = async (memberId: string) => {
    if (!isSupabaseEnabled) return;
    const target = members.find(m => m.id === memberId);
    if (!target) return;
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, saving: true } : m));
    const { error } = await supabase!
      .from("profiles")
      .update({ slack_member_id: target.draft.trim() || null })
      .eq("id", memberId);
    if (error) {
      console.error("[MemberSlackSetting] 保存失敗:", error.message);
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, saving: false } : m));
      alert("保存に失敗しました。権限を確認してください。");
      return;
    }
    setMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, slackMemberId: target.draft.trim(), saving: false, saved: true } : m
    ));
    setTimeout(() => setMembers(prev => prev.map(m => m.id === memberId ? { ...m, saved: false } : m)), 2200);
  };

  const handleClear = async (memberId: string) => {
    if (!isSupabaseEnabled) return;
    const { error, count } = await supabase!
      .from("profiles")
      .update({ slack_member_id: null })
      .eq("id", memberId)
      .select("id", { count: "exact", head: true });
    if (error || count === 0) {
      console.error("[MemberSlackSetting] 解除失敗:", error?.message ?? "0 rows updated (RLS?)");
      alert("解除に失敗しました。Supabase の RLS ポリシーを確認してください（add_admin_slack_update.sql を適用済みか確認）。");
      return;
    }
    setMembers(prev => prev.map(m =>
      m.id === memberId ? { ...m, slackMemberId: "", draft: "" } : m
    ));
  };

  if (!isSupabaseEnabled) {
    return <p style={{ fontSize: 12, color: "#A09790" }}>Supabase未接続のため利用できません。</p>;
  }

  const linked = members.filter(m => m.slackMemberId).length;

  return (
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

      {/* 左：カードグリッド */}
      <div style={{ flex: 1, minWidth: 0 }}>

        {/* 連携状況サマリー */}
        {!loading && members.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", background: linked === members.length ? "#F0FDF4" : "#FAFAF8", border: `1px solid ${linked === members.length ? "#BBF7D0" : "rgba(26,23,20,0.08)"}`, borderRadius: 10, marginBottom: 16 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: linked === members.length ? "#15803D" : "#6B6458", flexShrink: 0 }}>
              {linked} / {members.length} 名が連携済み
            </p>
            <div style={{ flex: 1, height: 5, borderRadius: 99, background: "rgba(26,23,20,0.08)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${members.length > 0 ? (linked / members.length) * 100 : 0}%`, borderRadius: 99, background: "linear-gradient(90deg,#059669,#047857)", transition: "width 0.4s" }} />
            </div>
          </div>
        )}

        {/* スケルトン */}
        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {[1, 2, 3, 4].map(i => (
              <div key={i} style={{ height: 160, borderRadius: 12, background: "linear-gradient(90deg,#F4F5F6 25%,#EBEBEB 50%,#F4F5F6 75%)", backgroundSize: "200% 100%" }} />
            ))}
          </div>
        )}

        {!loading && members.length === 0 && (
          <p style={{ fontSize: 13, color: "#A09790" }}>メンバーが見つかりません。</p>
        )}

        {/* カードグリッド */}
        {!loading && members.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
            {members.map(member => {
              const roleMeta = getRoleMeta(member.role);
              const isLinked = !!member.slackMemberId;
              const isDirty = member.draft !== member.slackMemberId;

              return (
                <div key={member.id} style={{ background: "#fff", border: `1px solid ${isLinked && !isDirty ? "#BBF7D0" : "rgba(26,23,20,0.08)"}`, borderRadius: 14, padding: "16px", display: "flex", flexDirection: "column", gap: 12, transition: "border-color 0.2s", position: "relative" as const }}>

                  {/* 連携済みバッジ */}
                  {isLinked && !isDirty && (
                    <div style={{ position: "absolute" as const, top: 12, right: 12, width: 18, height: 18, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                  )}

                  {/* メンバー情報 */}
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, paddingTop: 4 }}>
                    <Avatar name={member.name} size="lg" />
                    <div style={{ textAlign: "center" as const }}>
                      <p style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", lineHeight: 1.3 }}>{member.name}</p>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20, display: "inline-block", marginTop: 4 }} className={roleMeta.cls}>
                        {roleMeta.label}
                      </span>
                    </div>
                  </div>

                  {/* ID 入力 */}
                  <div>
                    <label style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#9E9690", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 5 }}>
                      Slack メンバー ID
                    </label>
                    <input
                      style={{ width: "100%", padding: "7px 10px", fontSize: 12, fontFamily: "var(--font-mono)", borderRadius: 8, border: `1px solid ${isLinked && !isDirty ? "#BBF7D0" : "rgba(26,23,20,0.14)"}`, background: isLinked && !isDirty ? "#F0FDF4" : "#FAFAF8", outline: "none", color: "#1A1714", boxSizing: "border-box" as const, transition: "border-color 0.15s, background 0.15s" }}
                      placeholder="U1234ABCD"
                      value={member.draft}
                      onChange={e => setMembers(prev => prev.map(m => m.id === member.id ? { ...m, draft: e.target.value } : m))}
                      maxLength={20}
                      onFocus={e => { e.currentTarget.style.borderColor = "#059669"; e.currentTarget.style.background = "#fff"; }}
                      onBlur={e => { e.currentTarget.style.borderColor = isLinked && !isDirty ? "#BBF7D0" : "rgba(26,23,20,0.14)"; e.currentTarget.style.background = isLinked && !isDirty ? "#F0FDF4" : "#FAFAF8"; }}
                    />
                  </div>

                  {/* ボタン */}
                  <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
                    <button
                      onClick={() => handleSave(member.id)}
                      disabled={member.saving || !isDirty}
                      style={{ flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: member.saving || !isDirty ? "default" : "pointer", background: member.saved ? "#ECFDF5" : isDirty ? "linear-gradient(135deg,#059669,#047857)" : "#F4F5F6", color: member.saved ? "#059669" : isDirty ? "#fff" : "#C0BAB5", transition: "all 0.15s", boxShadow: isDirty && !member.saving ? "0 2px 6px rgba(5,150,105,0.22)" : "none" }}
                    >
                      {member.saved ? "✓ 保存済み" : member.saving ? "保存中…" : "保存"}
                    </button>
                    {isLinked && !isDirty && (
                      <button
                        onClick={() => handleClear(member.id)}
                        style={{ padding: "7px 10px", fontSize: 12, fontWeight: 500, borderRadius: 8, border: "1px solid rgba(220,38,38,0.2)", background: "transparent", color: "#DC2626", cursor: "pointer", transition: "background 0.15s", flexShrink: 0 }}
                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#FEF2F2"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                      >
                        解除
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 右：ガイドパネル */}
      <GuidePanel />
    </div>
  );
}
