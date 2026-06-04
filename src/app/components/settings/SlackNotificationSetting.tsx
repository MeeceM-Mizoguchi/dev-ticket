import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { Toggle } from "@/app/components/shared/Toggle";
import { labelCls, inputCls } from "@/app/lib/helpers";

interface ProjectSlackConfig {
  id: string;
  name: string;
  slug: string;
  slackTeamName: string | null;
  slackChannel: string;
  slackEnabled: boolean;
}

interface Props {
  isAdminOrPM: boolean;
  connectedProjectId?: string | null;
}

export function SlackNotificationSetting({ isAdminOrPM, connectedProjectId }: Props) {
  const [projects, setProjects] = useState<ProjectSlackConfig[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [channel, setChannel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const selected = projects.find(p => p.id === selectedId) ?? null;
  const isConnected = !!selected?.slackTeamName;

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    supabase!
      .from("projects")
      .select("id, name, slug, slack_team_name, slack_channel, slack_notifications_enabled")
      .order("name")
      .then(({ data }) => {
        if (!data) return;
        const mapped: ProjectSlackConfig[] = (data as any[]).map(p => ({
          id: p.id, name: p.name, slug: p.slug,
          slackTeamName: p.slack_team_name ?? null,
          slackChannel: p.slack_channel ?? "",
          slackEnabled: p.slack_notifications_enabled ?? false,
        }));
        setProjects(mapped);
        const initialId = connectedProjectId && mapped.find(p => p.id === connectedProjectId)
          ? connectedProjectId : mapped[0]?.id ?? "";
        setSelectedId(initialId);
        const initial = mapped.find(p => p.id === initialId);
        if (initial) { setChannel(initial.slackChannel); setEnabled(initial.slackEnabled); }
      });
  }, [connectedProjectId]);

  const handleProjectChange = (id: string) => {
    setSelectedId(id);
    const p = projects.find(pr => pr.id === id);
    if (p) { setChannel(p.slackChannel); setEnabled(p.slackEnabled); }
  };

  const handleOAuthStart = () => {
    if (!selectedId) return;
    window.location.href = `/api/slack-oauth-start?projectId=${encodeURIComponent(selectedId)}`;
  };

  const handleDisconnect = async () => {
    if (!selectedId || !isSupabaseEnabled) return;
    setDisconnecting(true);
    await supabase!.from("projects").update({
      slack_access_token: null, slack_team_name: null,
      slack_channel: null, slack_notifications_enabled: false,
    }).eq("id", selectedId);
    setProjects(prev => prev.map(p =>
      p.id === selectedId ? { ...p, slackTeamName: null, slackChannel: "", slackEnabled: false } : p
    ));
    setChannel(""); setEnabled(false);
    setDisconnecting(false);
  };

  const handleSave = async () => {
    if (!selectedId || !isSupabaseEnabled) return;
    setSaving(true);
    await supabase!.from("projects").update({
      slack_channel: channel.trim() || null,
      slack_notifications_enabled: enabled,
    }).eq("id", selectedId);
    setProjects(prev => prev.map(p =>
      p.id === selectedId ? { ...p, slackChannel: channel.trim(), slackEnabled: enabled } : p
    ));
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  if (!isAdminOrPM) return <p style={{ fontSize: 12, color: "#9CA3AF" }}>管理者またはプロジェクトマネージャーのみ変更できます。</p>;
  if (!isSupabaseEnabled) return <p style={{ fontSize: 12, color: "#9CA3AF" }}>Supabase未接続のため利用できません。</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* プロジェクト選択 */}
      <div>
        <label className={labelCls}>対象プロジェクト</label>
        <select className={inputCls} value={selectedId} onChange={e => handleProjectChange(e.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {selected && (isConnected ? (
        /* ── 接続済み ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 接続済みバッジ */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>接続済み</span>
                <span style={{ fontSize: 12, color: "#166534", marginLeft: 8 }}>{selected.slackTeamName}</span>
              </div>
            </div>
            <button onClick={handleDisconnect} disabled={disconnecting}
              style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 6, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", cursor: "pointer" }}>
              {disconnecting ? "切断中..." : "切断する"}
            </button>
          </div>

          {/* チャンネル */}
          <div>
            <label className={labelCls}>通知先チャンネル</label>
            <input className={inputCls} placeholder="#dev-notifications または C1234ABCD"
              value={channel} onChange={e => setChannel(e.target.value)} />
            <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 5 }}>
              チャンネル名（例: #dev-notifications）またはチャンネルID（例: C1234ABCD）を入力してください
            </p>
          </div>

          {/* ON/OFF */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid #F3F4F6" }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 500, color: "#111827" }}>Slack通知を有効にする</p>
              <p style={{ fontSize: 11, color: "#9CA3AF", marginTop: 2 }}>チケット操作のたびに通知を送信します</p>
            </div>
            <Toggle checked={enabled} onChange={() => setEnabled(v => !v)} />
          </div>

          {/* 保存 */}
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: "9px 22px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: saving ? "default" : "pointer", background: "#059669", color: "#fff", opacity: saving ? 0.7 : 1 }}>
              {saved ? "✓ 保存しました" : saving ? "保存中..." : "設定を保存"}
            </button>
          </div>
        </div>
      ) : (
        /* ── 未接続 ── */
        <div style={{ background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 10, padding: "28px 24px", textAlign: "center" as const }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#4A154B", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", boxShadow: "0 4px 14px rgba(74,21,75,0.25)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="rgba(255,255,255,0.9)"/>
              <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="rgba(255,255,255,0.9)"/>
              <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="rgba(255,255,255,0.65)"/>
              <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="rgba(255,255,255,0.65)"/>
              <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="rgba(255,255,255,0.9)"/>
              <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="rgba(255,255,255,0.9)"/>
              <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="rgba(255,255,255,0.65)"/>
              <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="rgba(255,255,255,0.65)"/>
            </svg>
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#111827", marginBottom: 6 }}>Slackに接続する</p>
          <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 20, lineHeight: 1.6 }}>
            このプロジェクトのチケット操作をSlackに通知します
          </p>

          <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 8, padding: "14px 16px", marginBottom: 20, textAlign: "left" as const }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#6B7280", letterSpacing: "0.06em", textTransform: "uppercase" as const, marginBottom: 10 }}>接続の流れ</p>
            {["「Slackに接続する」をクリック", "Slackの認証画面でワークスペースを選択・許可", "このページに戻ったら通知先チャンネルを入力して保存"].map((text, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{i + 1}</div>
                <p style={{ fontSize: 12, color: "#374151" }}>{text}</p>
              </div>
            ))}
          </div>

          <button onClick={handleOAuthStart}
            style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", fontSize: 13, fontWeight: 600, borderRadius: 8, border: "none", cursor: "pointer", background: "#4A154B", color: "#fff", boxShadow: "0 2px 8px rgba(74,21,75,0.25)" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#611f69"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#4A154B"; }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="white"/>
              <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="white"/>
              <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="rgba(255,255,255,0.7)"/>
              <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="rgba(255,255,255,0.7)"/>
              <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="white"/>
              <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="white"/>
              <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="rgba(255,255,255,0.7)"/>
              <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="rgba(255,255,255,0.7)"/>
            </svg>
            Slackに接続する
          </button>
        </div>
      ))}
    </div>
  );
}
