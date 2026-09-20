import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { Plug, Users } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useOrg } from "@/app/contexts/OrgContext";
import { usePlan } from "@/app/contexts/PlanContext";
import { OrgSelector } from "@/app/components/shared/OrgSelector";
import { NotFoundView } from "@/app/components/shared/NotFoundView";
import { SlackNotificationSetting } from "@/app/components/settings/SlackNotificationSetting";
import { MemberSlackSetting } from "@/app/components/settings/MemberSlackSetting";
import { GithubIntegrationSetting } from "@/app/components/settings/GithubIntegrationSetting";
import { GoogleDriveSetting } from "@/app/components/settings/GoogleDriveSetting";

export function AdminSettingsPage() {
  const { userPermissions, userOrgId } = useAuth();
  const { selectedOrgId } = useOrg();
  const { plan } = usePlan();
  const effectiveOrgId = selectedOrgId ?? userOrgId;
  const [searchParams, setSearchParams] = useSearchParams();

  // 黙ってダッシュボードへ飛ばすと「リンクが壊れているのか権限が無いのか」が分からないため、
  // 理由を出す共通画面をその場に描画する（docs/not-found-page-design.md）。
  if (!userPermissions.canAccessAdminSettings) return <NotFoundView kind="no-permission" label="外部連携" />;
  // 以前は「通知・GitHubが両方プランでOFFなら画面ごと閉じる」としていたが、
  // Googleドライブ連携はプランのフラグを持たない（ファイルボックス自体が全プラン共通）ため、
  // 画面ごと閉じると設定に辿り着けなくなる。プラン判定はタブ単位の出し分けに寄せる。

  const urlTab = searchParams.get("tab");
  const slackResult = searchParams.get("slack");
  const slackMessage = searchParams.get("message");
  const slackConnectedProjectId = searchParams.get("projectId");
  const githubResult = searchParams.get("github");
  const githubRepos = searchParams.get("repos");
  const googleResult = searchParams.get("google");

  // Googleドライブ連携はプランのフラグを持たない（ファイルボックス自体が全プラン共通のため）。
  // サーバー側が未設定なら、タブの中身が「まだ有効化されていません」を出す。
  const tabs = [
    ...(plan.featureNotifications ? [{ id: "slack", label: "Slack通知" }, { id: "members", label: "メンバー設定" }] : []),
    ...(plan.featureGithub ? [{ id: "github", label: "GitHub連携" }] : []),
    { id: "google", label: "Googleドライブ" },
  ];

  const [tab, setTab] = useState(
    urlTab && tabs.some(t => t.id === urlTab) ? urlTab : (tabs[0]?.id ?? "slack")
  );
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(
    slackResult === "success"
      ? { type: "success", message: "Slackへの接続が完了しました" }
      : slackResult === "error"
        ? { type: "error", message: slackMessage ? decodeURIComponent(slackMessage) : "接続に失敗しました" }
        : githubResult === "success"
          // 成功で終わらせず、次の作業（②リポジトリの紐付け）へ誘導する
          ? { type: "success", message: `GitHubに接続しました${githubRepos ? `（${githubRepos}リポジトリ）` : ""}。次に、プロジェクトとリポジトリを紐付けてください。` }
          // 「リポジトリを追加・変更」から戻ってきたとき。新規接続ではないので文言を分ける
          : githubResult === "updated"
            ? { type: "success", message: `GitHubのリポジトリ設定を更新しました${githubRepos ? `（${githubRepos}リポジトリ）` : ""}。` }
            : githubResult === "error"
              ? { type: "error", message: slackMessage ? decodeURIComponent(slackMessage) : "GitHubへの接続に失敗しました" }
              : googleResult === "success"
                ? { type: "success", message: "Googleアカウントを連携しました。続けて保存先を選択して保存してください。" }
                : googleResult === "error"
                  ? { type: "error", message: slackMessage ? decodeURIComponent(slackMessage) : "Googleへの接続に失敗しました" }
                  : null
  );

  // クエリは直後に消すため、接続直後かどうかは初期値として固定しておく
  const [justConnectedGithub] = useState(githubResult === "success" || githubResult === "updated");

  useEffect(() => {
    if (slackResult || githubResult || googleResult) {
      setSearchParams({}, { replace: true });
      const timer = setTimeout(() => setBanner(null), 8000);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div style={{ padding: "28px 32px" }}>

      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "#059669", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Plug style={{ width: 18, height: 18, color: "#fff" }} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: "#111827", letterSpacing: "-0.01em" }}>外部連携</h1>
            <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 1 }}>Slack通知・GitHub連携・Googleドライブ連携の設定を管理します</p>
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

      {tab === "google" && (
        <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0, background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "20px 24px" }}>
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>Googleドライブ連携</p>
              <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 2 }}>
                ファイルボックスから Googleスプレッドシート／ドキュメント／スライドを作成できるようにします
              </p>
            </div>
            <GoogleDriveSetting isAdmin={userPermissions.canAccessAdminSettings} orgId={effectiveOrgId} />
          </div>

          <div style={{ width: 260, flexShrink: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: "#FFF", border: "1px solid #E5E7EB", borderRadius: 12, padding: "16px 18px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginBottom: 10 }}>できること</p>
              {[
                { icon: "📊", text: "スプレッドシートを作成" },
                { icon: "📄", text: "ドキュメントを作成" },
                { icon: "📽", text: "スライドを作成" },
                { icon: "👥", text: "メンバーへ自動で共有" },
              ].map(item => (
                <div key={item.text} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid rgba(26,23,20,0.05)" }}>
                  <span style={{ fontSize: 13 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, color: "#374151" }}>{item.text}</span>
                </div>
              ))}
            </div>

            <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12, padding: "14px 16px" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#92400E", marginBottom: 6 }}>データの置き場所</p>
              <p style={{ fontSize: 11, color: "#B45309", lineHeight: 1.7 }}>
                作成したファイルは<br />
                <strong>Googleドライブ側</strong>に保存されます。<br />
                DevTicket のストレージには<br />
                実体を持ちません
              </p>
            </div>
          </div>
        </div>
      )}

      {tab === "github" && (
        <GithubIntegrationSetting
          isAdmin={userPermissions.canAccessAdminSettings}
          orgId={effectiveOrgId}
          justConnected={justConnectedGithub}
        />
      )}

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
