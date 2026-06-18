import { useEffect, useState } from "react";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";
import { Toggle } from "@/app/components/shared/Toggle";
import { labelCls, inputCls } from "@/app/lib/helpers";

const SLACK_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52z" fill="currentColor" opacity=".9"/>
    <path d="M6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="currentColor" opacity=".9"/>
    <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834z" fill="currentColor" opacity=".65"/>
    <path d="M8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="currentColor" opacity=".65"/>
    <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834z" fill="currentColor" opacity=".9"/>
    <path d="M17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="currentColor" opacity=".9"/>
    <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52z" fill="currentColor" opacity=".65"/>
    <path d="M15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="currentColor" opacity=".65"/>
  </svg>
);

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
  orgId?: string | null;
}

export function SlackNotificationSetting({ isAdminOrPM, connectedProjectId, orgId }: Props) {
  const [projects, setProjects] = useState<ProjectSlackConfig[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [channel, setChannel] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [copied, setCopied] = useState(false);

  const selected = projects.find(p => p.id === selectedId) ?? null;
  const isConnected = !!selected?.slackTeamName;
  const inviteCommand = "/invite @Dev Ticket";

  useEffect(() => {
    if (!isSupabaseEnabled) return;
    let q = supabase!
      .from("projects")
      .select("id, name, slug, slack_team_name, slack_channel, slack_notifications_enabled")
      .order("name");
    if (orgId) q = q.eq("organization_id", orgId);
    q.then(({ data }) => {
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
  }, [connectedProjectId, orgId]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleCopyInvite = () => {
    navigator.clipboard.writeText(inviteCommand).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
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

  if (!isAdminOrPM) return <p style={{ fontSize: 12, color: "#A09790" }}>管理者またはプロジェクトマネージャーのみ変更できます。</p>;
  if (!isSupabaseEnabled) return <p style={{ fontSize: 12, color: "#A09790" }}>Supabase未接続のため利用できません。</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* プロジェクト選択 */}
      <div>
        <label className={labelCls}>対象プロジェクト</label>
        <select className={inputCls} value={selectedId} onChange={e => handleProjectChange(e.target.value)}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {selected && (isConnected ? (
        /* ── 接続済み ── */
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* 接続済みバッジ */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 4px rgba(5,150,105,0.3)" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#15803D" }}>接続済み</span>
                <span style={{ fontSize: 12, color: "#166534", marginLeft: 8 }}>{selected.slackTeamName}</span>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={disconnecting}
              style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, borderRadius: 7, border: "1px solid rgba(220,38,38,0.25)", background: "#FEF2F2", color: "#DC2626", cursor: disconnecting ? "default" : "pointer", opacity: disconnecting ? 0.6 : 1, transition: "all 0.15s" }}
            >
              {disconnecting ? "切断中..." : "切断する"}
            </button>
          </div>

          {/* 通知先チャンネル */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label className={labelCls}>通知先チャンネル</label>
            <input
              className={inputCls}
              placeholder="#dev-notifications または C1234ABCD"
              value={channel}
              onChange={e => setChannel(e.target.value)}
            />
            <p style={{ fontSize: 11, color: "#A09790", marginTop: 1 }}>
              チャンネル名（例: #dev-notifications）またはチャンネルID（例: C1234ABCD）を入力してください
            </p>

            {/* プライベートチャンネル招待コマンド */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
              <p style={{ fontSize: 11, color: "#A09790", flexShrink: 0 }}>プライベートチャンネルの場合のみ</p>
              <div style={{ flex: 1, padding: "7px 10px", background: "#F4F5F6", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 7 }}>
                <code style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "#1A1714" }}>
                  {inviteCommand}
                </code>
              </div>
              <button
                onClick={handleCopyInvite}
                style={{
                  padding: "7px 14px",
                  fontSize: 12,
                  fontWeight: 600,
                  borderRadius: 7,
                  border: "none",
                  cursor: "pointer",
                  background: "linear-gradient(135deg,#059669,#047857)",
                  color: "#fff",
                  whiteSpace: "nowrap" as const,
                  boxShadow: "0 2px 8px rgba(5,150,105,0.25)",
                  transition: "all 0.15s",
                  letterSpacing: "-0.01em",
                  flexShrink: 0,
                }}
              >
                {copied ? "✓ コピー済み" : "コピー"}
              </button>
            </div>
          </div>

          {/* 通知 ON/OFF */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderTop: "1px solid rgba(26,23,20,0.06)" }}>
            <div>
              <p style={{ fontSize: 13, fontWeight: 600, color: "#1A1714" }}>Slack通知を有効にする</p>
              <p style={{ fontSize: 11, color: "#A09790", marginTop: 3 }}>担当割り当て・レビュー・@メンション時に、対象者を @メンションしてチャンネルに通知します</p>
            </div>
            <Toggle checked={enabled} onChange={() => setEnabled(v => !v)} />
          </div>

          {/* 保存ボタン */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: "9px 22px",
                fontSize: 13,
                fontWeight: 700,
                borderRadius: 10,
                border: "none",
                cursor: saving ? "default" : "pointer",
                background: saving ? "#E5E7EB" : "linear-gradient(135deg,#059669,#047857)",
                color: saving ? "#9CA3AF" : "#fff",
                boxShadow: saving ? "none" : "0 2px 10px rgba(5,150,105,0.30), inset 0 1px 0 rgba(255,255,255,0.12)",
                letterSpacing: "-0.01em",
                transition: "all 0.15s",
              }}
            >
              {saved ? "✓ 保存しました" : saving ? "保存中..." : "設定を保存"}
            </button>
          </div>
        </div>

      ) : (
        /* ── 未接続 ── */
        <div style={{ background: "#FAFAF8", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 14, padding: "32px 24px", display: "flex", flexDirection: "column", alignItems: "center" }}>

          {/* アイコン */}
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#4A154B", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 14, color: "#fff", boxShadow: "0 4px 16px rgba(74,21,75,0.22)" }}>
            {SLACK_ICON}
          </div>

          <p style={{ fontSize: 15, fontWeight: 700, color: "#1A1714", marginBottom: 5, fontFamily: "var(--font-heading)", letterSpacing: "-0.02em" }}>
            Slackに接続する
          </p>
          <p style={{ fontSize: 12, color: "#6B6458", marginBottom: 24, lineHeight: 1.7, textAlign: "center" as const }}>
            担当割り当て・レビュー依頼・@メンション時に<br />対象メンバーへ直接通知します
          </p>

          {/* 接続の流れ */}
          <div style={{ width: "100%", background: "#fff", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: "14px 16px", marginBottom: 24 }}>
            <p style={{ fontSize: 10, fontWeight: 700, color: "#A09790", letterSpacing: "0.08em", textTransform: "uppercase" as const, marginBottom: 12 }}>接続の流れ</p>
            {["「Slackに接続する」をクリック", "Slackの認証画面でワークスペースを選択・許可", "このページに戻ったら通知先チャンネルを入力して保存"].map((text, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 0", borderBottom: i < 2 ? "1px solid rgba(26,23,20,0.05)" : "none" }}>
                <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#059669,#047857)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0, boxShadow: "0 1px 4px rgba(5,150,105,0.3)" }}>
                  {i + 1}
                </div>
                <p style={{ fontSize: 12, color: "#374151" }}>{text}</p>
              </div>
            ))}
          </div>

          {/* 接続ボタン */}
          <button
            onClick={handleOAuthStart}
            style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "11px 26px", fontSize: 13, fontWeight: 600, borderRadius: 10, border: "none", cursor: "pointer", background: "#4A154B", color: "#fff", boxShadow: "0 2px 10px rgba(74,21,75,0.28), inset 0 1px 0 rgba(255,255,255,0.08)", letterSpacing: "-0.01em", transition: "background 0.15s" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#611f69"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "#4A154B"; }}
          >
            <span style={{ color: "#fff" }}>{SLACK_ICON}</span>
            Slackに接続する
          </button>
        </div>
      ))}
    </div>
  );
}
