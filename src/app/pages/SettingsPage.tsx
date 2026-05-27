import { useState } from "react";
import { useAuth } from "@/app/contexts/AuthContext";
import { MEMBERS } from "@/app/data/mock";
import { getRoleMeta, labelCls } from "@/app/lib/helpers";
import type { NotifKey } from "@/app/types";
import { Avatar } from "@/app/components/shared/Avatar";
import { Toggle } from "@/app/components/shared/Toggle";
import { FieldInput } from "@/app/components/shared/FieldInput";
import { FieldSelect } from "@/app/components/shared/FieldSelect";

export function SettingsPage() {
  const { userName, userRole } = useAuth();
  const [tab, setTab] = useState("general");
  const [saved, setSaved] = useState(false);
  const [notifs, setNotifs] = useState<Record<NotifKey, boolean>>({ email: true, assign: true, status: false, comment: true, reminder: false });

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2200); };

  const tabs = [{ id: "general", label: "一般" }, { id: "notifications", label: "通知" }, { id: "team", label: "チーム" }, { id: "integrations", label: "連携" }];

  const notifItems: { key: NotifKey; label: string; desc: string }[] = [
    { key: "email",   label: "メール通知",          desc: "重要なアップデートをメールで受け取る" },
    { key: "assign",  label: "担当割り当て通知",      desc: "チケットが自分に割り当てられたときに通知" },
    { key: "status",  label: "ステータス変更通知",    desc: "チケットのステータスが変更されたときに通知" },
    { key: "comment", label: "コメント通知",          desc: "コメントが追加されたときに通知" },
    { key: "reminder",label: "リマインダー通知",      desc: "期限の前日にデスクトップ通知を受け取る" },
  ];

  const integrations = [
    { name: "Slack",           desc: "チャンネルに通知を送信",              icon: "💬" },
    { name: "GitHub",          desc: "PRとIssueをチケットにリンク",         icon: "🐙" },
    { name: "Google Calendar", desc: "スプリント期間をカレンダーに同期",    icon: "📅" },
  ];

  return (
    <div style={{ padding: "24px", maxWidth: 660 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: "#1A1714", fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>設定</h1>
        <p style={{ fontSize: 12, color: "#A09790", marginTop: 3 }}>アカウントとシステムの設定</p>
      </div>

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
              <FieldSelect label="言語">
                <option value="ja">日本語</option>
                <option value="en">English</option>
              </FieldSelect>
              <FieldSelect label="タイムゾーン">
                <option value="Asia/Tokyo">Asia/Tokyo (UTC+9)</option>
                <option value="UTC">UTC</option>
              </FieldSelect>
            </div>
          </div>
          <button onClick={handleSave}
            style={{ padding: "10px 20px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", transition: "all 0.2s", background: "#059669", color: "#fff", width: "fit-content" }}>
            {saved ? "✓ 保存しました" : "設定を保存"}
          </button>
        </div>
      )}

      {tab === "notifications" && (
        <div style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "20px 24px" }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "#1A1714", fontFamily: "var(--font-heading)", marginBottom: 4 }}>通知設定</h2>
          <p style={{ fontSize: 11, color: "#B0A9A4", marginBottom: 20 }}>通知の受け取り方をカスタマイズしてください</p>
          <div>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <FieldInput label="表示名" value={userName} readOnly />
            <div>
              <label className={labelCls}>メンバーID</label>
              <p style={{ fontSize: 13, fontFamily: "var(--font-mono)", color: "#6B6458", paddingTop: 10 }}>{MEMBERS.find(m => m.name === userName)?.id ?? "—"}</p>
            </div>
          </div>
        </div>
      )}

      {tab === "integrations" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {integrations.map(({ name, desc, icon }) => (
            <div key={name} style={{ background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 44, height: 44, borderRadius: 10, background: "#F4F5F6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>{name}</p>
                  <p style={{ fontSize: 11, color: "#A09790", marginTop: 2 }}>{desc}</p>
                </div>
              </div>
              <button
                style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, borderRadius: 8, border: "1px solid rgba(26,23,20,0.12)", background: "transparent", cursor: "pointer", color: "#6B6458", flexShrink: 0 }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = "#ECFDF5"; el.style.color = "#059669"; el.style.borderColor = "rgba(5,150,105,0.3)"; }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = "transparent"; el.style.color = "#6B6458"; el.style.borderColor = "rgba(26,23,20,0.12)"; }}>
                接続する
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
