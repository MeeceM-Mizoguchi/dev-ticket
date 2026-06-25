import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { BellRing, Users } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { Navigate } from "react-router";
import { SlackNotificationSetting } from "@/app/components/settings/SlackNotificationSetting";
import { MemberSlackSetting } from "@/app/components/settings/MemberSlackSetting";

export function AdminSettingsPage() {
  const { userPermissions, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const { plan } = usePlan();
  const effectiveOrgId = selectedOrgId ?? userOrgId;
  const [searchParams, setSearchParams] = useSearchParams();

  if (!userPermissions.canAccessAdminSettings) return <Navigate to="/dashboard" replace />;
  if (!plan.featureNotifications) return <Navigate to="/dashboard" replace />;

  const urlTab = searchParams.get("tab");
  const slackResult = searchParams.get("slack");
  const slackMessage = searchParams.get("message");
  const slackConnectedProjectId = searchParams.get("projectId");

  const [tab, setTab] = useState(urlTab ?? "slack");
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(
    slackResult === "success"
      ? { type: "success", message: "Slackへの接続が完了しました" }
      : slackResult === "error"
        ? { type: "error", message: slackMessage ? decodeURIComponent(slackMessage) : "接続に失敗しました" }
        : null
  );

  useEffect(() => {
    if (slackResult) {
      setSearchParams({}, { replace: true });
      const timer = setTimeout(() => setBanner(null), 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  const tabs = [
    { id: "slack", label: "Slack通知" },
    { id: "members", label: "メンバー設定" },
  ];

  return (
    <div style={{ padding: "28px 32px" }}>

      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <BellRing style={{ width: 18, height: 18, color: "#fff" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>通知管理</h1>
            <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>Slack通知のプロジェクト連携設定を管理します</p>
          </div>
        </div>
        <OrgSelector />
      </div>

      {/* バナー */}
      {banner && (
        <div style={{ marginBottom: 20, padding: "11px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "space-between",
          background: banner.type === "success" ? "#ECFDF5" : "#FEF2F2",
          color:      banner.type === "success" ? "#059669"  : "#DC2626",
          border:     `1px solid ${banner.type === "success" ? "rgba(5,150,105,0.3)" : "rgba(220,38,38,0.3)"}` }}>
          <span>{banner.type === "success" ? "✅ " : "❌ "}{banner.message}</span>
          <button onClick={() => setBanner(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "inherit", lineHeight: 1, marginLeft: 12 }}>×</button>
        </div>
      )}

      {/* タブ */}
      <div style={{ display: "flex", gap: 4, background: "#FFFFFF", border: "1px solid rgba(26,23,20,0.08)", borderRadius: 10, padding: 4, marginBottom: 24, width: "fit-content" }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "7px 16px", fontSize: 13, fontWeight: 500, borderRadius: 7, border: "none", cursor: "pointer", transition: "all 0.15s", background: tab === t.id ? "#059669" : "transparent", color: tab === t.id ? "#fff" : "#6B6458" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "members" && (
        <div>
          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <Users style={{ width: 16, height: 16, color: "#059669" }} />
              <p style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>メンバーのSlack連携</p>
            </div>
            <p style={{ fontSize: 12, color: "#9CA3AF" }}>
              各メンバーのSlackメンバーIDを設定します。設定済みのメンバーには通知がメンション付きで届きます。
            </p>
          </div>
          <MemberSlackSetting orgId={effectiveOrgId} />
        </div>
      )}

      {tab === "slack" && (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>

          {/* メイン設定カード */}
          <div style={{ flex: 1, minWidth: 0, background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Slack通知設定</p>
              <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>プロジェクトごとにSlackワークスペースを接続し、通知先チャンネルを設定します</p>
            </div>
            <SlackNotificationSetting
              isAdminOrPM={userPermissions.canAccessAdminSettings}
              connectedProjectId={slackConnectedProjectId}
              orgId={effectiveOrgId}
            />
          </div>

          {/* サイドメモ */}
          <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 10 }}>通知が送られるタイミング</p>
              {[
                { icon: "🎯", text: "チケットアサイン変更" },
                { icon: "🔍", text: "レビュー依頼" },
                { icon: "✏️", text: "修正依頼" },
                { icon: "✅", text: "レビュー承認" },
                { icon: "🆕", text: "新規チケット作成" },
              ].map(item => (
                <div key={item.text} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                  <span style={{ fontSize: 13 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: "#374151" }}>{item.text}</span>
                </div>
              ))}
            </div>

            <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#15803D", marginBottom: 6 }}>メンション通知</p>
              <p style={{ fontSize: 11, color: "#166534", lineHeight: 1.7 }}>
                各ユーザーが<br />
                <strong>設定 → チーム</strong> タブで<br />
                SlackメンバーIDを登録すると<br />
                メンション付きで通知されます
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
