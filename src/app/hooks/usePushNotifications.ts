import { useEffect } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/app/contexts/AuthContext";
import { initPushNotifications } from "@/lib/push";

// 認証後の共通レイヤー(AppShell)から呼ぶ。ネイティブのみプッシュ通知を初期化し、
// 通知タップ時は Topbar のベル通知クリックと同じ宛先(プロジェクト/チケット)へ遷移する。
export function usePushNotifications(): void {
  const { userName } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!userName) return;
    void initPushNotifications(userName, ({ projectSlug, ticketWbs }) => {
      if (projectSlug && ticketWbs) navigate(`/${projectSlug}/${ticketWbs}`);
      else if (projectSlug) navigate(`/${projectSlug}`);
    });
  }, [userName, navigate]);
}
