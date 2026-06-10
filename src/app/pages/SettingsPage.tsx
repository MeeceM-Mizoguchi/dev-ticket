import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "@/app/contexts/AuthContext";
import { MEMBERS } from "@/app/data/mock";
import { getRoleMeta, labelCls } from "@/app/lib/helpers";
import type { NotifKey } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { Toggle } from "@/app/components/shared/Toggle";
import { FieldInput } from "@/app/components/shared/FieldInput";
// 🌟 修正: FieldSelect を CustomSelect に差し替え
import { CustomSelect } from "@/app/components/shared/CustomSelect";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

export function SettingsPage() {
  const { userName, userRole, userId } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get("tab") ?? "general");
  const [saved, setSaved] = useState(false);
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({ email: true, assign: true, status: false, comment: true, reminder: false });

  // 🌟 追加: 言語とタイムゾーンの状態管理用State（初期値は現在の表示に合わせる）
  const [lang, setLang] = useState("ja");
  const [timezone, setTimezone] = useState("Asia/Tokyo");

  // Slackメンバー連携
  const [slackMemberId, setSlackMemberId] = useState("");
  const [slackIdSaved, setSlackIdSaved] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);

  // OAuthコールバック後の結果バナー
  const slackUserResult = searchParams.get("slackuser");
  const slackUserNewId = searchParams.get("slackId");
  const [slackBanner, setSlackBanner] = useState<{ type: "success" | "error"; message: string } | null>(
    slackUserResult === "success"
      ? { type: "success", message: `Slackアカウントと連携しました（${slackUserNewId ?? ""}）` }
      : slackUserResult === "error"
        ? { type: "error", message: "Slack連携に失敗しました。再度お試しください。" }
        : null
  );

  useEffect(() => {
    if (slackUserResult) {
      setSearchParams({}, { replace: true });
      if (slackUserResult === "success" && slackUserNewId) setSlackMemberId(decodeURIComponent(slackUserNewId));
      const t = setTimeout(() => setSlackBanner(null), 5000);
      return () => clearTimeout(t);
    }
  }, []);

  useEffect(() => {
    if (!userId || !isSupabaseEnabled) return;
    supabase!.from("profiles").select("slack_member_id").eq("id", userId).maybeSingle()
      .then(({ data }) => { if ((data as any)?.slack_member_id) setSlackMemberId((data as any).slack_member_id); });
  }, [userId]);

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2200); };

  const saveSlackMemberId = async () => {
    if (!userId || !isSupabaseEnabled) return;
    await supabase!.from("profiles").update({ slack_member_id: slackMemberId.trim() || null }).eq("id", userId);
    setSlackIdSaved(true);
    setTimeout(() => setSlackIdSaved(false), 2200);
  };

  const handleSlackOAuth = () => {
    if (!userId) return;
    window.location.href = `/api/slack-user-oauth-start?userId=${encodeURIComponent(userId)}`;
  };

  const handleDisconnectSlack = async () => {
    if (!userId || !isSupabaseEnabled) return;
    await supabase!.from("profiles").update({ slack_member_id: null }).eq("id", userId);
    setSlackMemberId("");
  };

  const tabs = [
    { id: "general", label: "一般" },
    { id: "notifications", label: "通知" },
    { id: "team", label: "チーム" },
  ];

  const notifItems: { key: NotifKey; label: string; desc: string }[] = [
    { key: "email", label: "メール通知", desc: "重要なアップデートをメールで受け取る" },
    { key: "assign", label: "担当割り当て通知", desc: "チケットが自分に割り当てられたときに通知" },
    { key: "status", label: "ステータス変更通知", desc: "チケットのステータスが変更されたときに通知" },
    { key: "comment", label: "コメント通知", desc: "コメントが追加されたときに通知" },
    { key: "reminder", label: "リマインダー通知", desc: "期限の前日にデスクトップ通知を受け取る" },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: 660 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>設定</h1>
        <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>アカウントとシステムの設定</p>
      </div>

      {/* Slack連携バナー */}
      {slackBanner && (
        <div style={{
          marginBottom: 16, padding: "11px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "space-between",
          background: slackBanner.type === "success" ? "#ECFDF5" : "#FEF2F2",
          color: slackBanner.type === "success" ? "#059669" : "#DC2626",
          border: `1px solid ${slackBanner.type === "success" ? "rgba(5,150,105,0.3)" : "rgba(220,38,38,0.3)"}`
        }}>
          <span>{slackBanner.type === "success" ? "✅ " : "❌ "}{slackBanner.message}</span>
          <button onClick={() => setSlackBanner(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "inherit", lineHeight: 1, marginLeft: 12 }}>×</button>
        </div>
      )}

      <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 4, marginBottom: 24, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: tab === t.id ? "#059669" : "transparent", color: tab === t.id ? "#fff" : "#6B6458" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 16 }}>システム設定</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* 🌟 修正: 言語のプルダウンを CustomSelect に置き換え */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#9E9690", marginBottom: 6 }}>言語</label>
                <CustomSelect
                  value={lang}
                  options={[
                    { value: "ja", label: "日本語" },
                    { value: "en", label: "English" }
                  ]}
                  onChange={setLang}
                />
              </div>

              {/* 🌟 修正: タイムゾーンのプルダウンを CustomSelect に置き換え */}
              <div>
                <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#9E9690", marginBottom: 6 }}>タイムゾーン</label>
                <CustomSelect
                  value={timezone}
                  options={[
                    { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+9)" },
                    { value: "UTC", label: "UTC" }
                  ]}
                  onChange={setTimezone}
                />
              </div>
            </div>
          </div>
          <button onClick={handleSave}
            style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", background: "#059669", color: "#fff", width: "fit-content" }}>
            {saved ? "✓ 保存しました" : "設定を保存"}
          </button>
        </div>
      )}

      {tab === "notifications" && (
        <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 4 }}>通知設定</h2>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginBottom: 20 }}>通知の受け取り方をカスタマイズしてください</p>
          {notifItems.map(({ key, label, desc }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#1A1714" }}>{label}</p>
                <p style={{ fontSize: 11, color: "#B0A9A4", marginTop: 2 }}>{desc}</p>
              </div>
              <Toggle checked={notifs[key]} onChange={() => setNotifs(prev => ({ ...prev, [key]: !prev[key] }))} />
            </div>
          ))}
        </div>
      )}

      {tab === "team" && (
        <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 16 }}>チーム情報</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px", background: "#F4F5F6", borderRadius: 10, marginBottom: 20 }}>
            <Avatar name={userName} size="lg" />
            <div>
              <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714" }}>{userName}</p>
              <span style={{ fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 20, background: "#ECFDF5", color: "#059669", display: "inline-block", marginTop: 4 }}>{getRoleMeta(userRole).label}</span>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>
            <FieldInput label="表示名" value={userName} readOnly />
            <div>
              <label className={labelCls}>メンバーID</label>
              <p style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "#6B6458", paddingTop: 10 }}>{MEMBERS.find(m => m.name === userName)?.id ?? "—"}</p>
            </div>
          </div>

          {/* Slackアカウント連携 */}
          <div style={{ borderTop: "1px solid rgba(26,23,20,0.07)", paddingTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <div style={{ width: 20, height: 20, borderRadius: 5, background: "#4A154B", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="white" />
                  <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="white" />
                  <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="rgba(255,255,255,0.6)" />
                  <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="rgba(255,255,255,0.6)" />
                  <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="white" />
                  <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="white" />
                  <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="rgba(255,255,255,0.6)" />
                  <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="rgba(255,255,255,0.6)" />
                </svg>
              </div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714" }}>Slackアカウント連携</h3>
            </div>
            <p style={{ fontSize: 11, color: "#B0A9A4", marginBottom: 16 }}>
              連携するとチケット操作の通知がSlackでメンション付きで届きます
            </p>

            {slackMemberId ? (
              /* 連携済み */
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                    <div>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>連携済み</span>
                      <code style={{ fontSize: 11, color: "#166534", marginLeft: 8, fontFamily: "var(--font-mono)", background: "rgba(5,150,105,0.1)", padding: "2px 6px", borderRadius: 4 }}>{slackMemberId}</code>
                    </div>
                  </div>
                  <button onClick={handleDisconnectSlack}
                    style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", cursor: "pointer" }}>
                    解除する
                  </button>
                </div>
                <button onClick={handleSlackOAuth}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 12, fontWeight: 500, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", color: "#6B6458", cursor: "pointer", width: "fit-content" }}>
                  別のアカウントで連携し直す
                </button>
              </div>
            ) : (
              /* 未連携 */
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button onClick={handleSlackOAuth}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 20px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", background: "#4A154B", color: "#fff", width: "fit-content", boxShadow: "0 2px 8px rgba(74,21,75,0.25)" }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#611f69"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#4A154B"; }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="white" />
                    <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="white" />
                    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="rgba(255,255,255,0.6)" />
                    <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="rgba(255,255,255,0.6)" />
                    <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="white" />
                    <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="white" />
                    <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="rgba(255,255,255,0.6)" />
                    <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="rgba(255,255,255,0.6)" />
                  </svg>
                  Slackアカウントと連携する
                </button>

                {/* 手動入力（折りたたみ） */}
                <button onClick={() => setShowManualInput(v => !v)}
                  style={{ fontSize: 11, color: "#A09790", background: "none", border: "none", cursor: "pointer", textAlign: "left" as const, padding: 0 }}>
                  {showManualInput ? "▲ 手動入力を閉じる" : "▼ メンバーIDを手動で入力する"}
                </button>
                {showManualInput && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ flex: 1 }}>
                      <label className={labelCls}>SlackメンバーID</label>
                      <input
                        style={{ width: "100%", padding: "8px 12px", fontSize: 13, borderRadius: 8, border: "1px solid rgba(26,23,20,0.15)", background: "#FAFAF8", outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" as const }}
                        placeholder="U1234ABCD"
                        value={slackMemberId}
                        onChange={e => setSlackMemberId(e.target.value)}
                        maxLength={20}
                      />
                    </div>
                    <button onClick={saveSlackMemberId}
                      style={{ padding: "8px 16px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer", background: "#059669", color: "#fff", flexShrink: 0 }}>
                      {slackIdSaved ? "✓ 保存" : "保存"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
