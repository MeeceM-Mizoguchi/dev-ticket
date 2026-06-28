// プッシュ通知(APNs)共通ヘルパー
// ネイティブ(iOS/iPad/Mac)でのみ動作し、Web では何もしない。
// 権限要求 → APNs 登録 → デバイストークンを Supabase(device_tokens) に保存し、
// 通知タップ時に payload(project_slug / ticket_wbs)から該当チケットへ遷移する。
//
// ※ Push capability(aps-environment entitlement) が未設定の環境では register() が
//   失敗するが、すべて try/catch で握りつぶしてアプリは落とさない（ビルド/起動の安全優先）。
import { Capacitor } from "@capacitor/core";
import { PushNotifications, type Token, type ActionPerformed } from "@capacitor/push-notifications";
import { supabase, isSupabaseEnabled } from "@/lib/supabase";

// 通知タップ時の遷移先（Topbar のベル通知クリックと同じ宛先）
export type PushTapTarget = { projectSlug?: string; ticketWbs?: string };

// リスナーは多重登録を避けて一度だけ張り、宛先はモジュール変数で差し替える
// （ユーザー切替や AppShell の再マウントでも重複しないようにする）。
let listenersAdded = false;
let currentUserName = "";
let currentOnTap: (t: PushTapTarget) => void = () => {};

// デバイストークンを Supabase に保存（token を一意キーに upsert）
async function saveToken(userName: string, token: string): Promise<void> {
  if (!isSupabaseEnabled || !userName || !token) return;
  const platform = Capacitor.getPlatform(); // iPad/iPhone/Mac いずれも "ios"
  const { error } = await supabase!
    .from("device_tokens")
    .upsert(
      { user_name: userName, token, platform, updated_at: new Date().toISOString() },
      { onConflict: "token" },
    );
  if (error) console.error("[push] token save failed:", error.message);
}

// プッシュ通知の初期化。ネイティブのみ動作。Web は即 return。
export async function initPushNotifications(
  userName: string,
  onTap: (t: PushTapTarget) => void,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  currentUserName = userName;
  currentOnTap = onTap;

  try {
    if (!listenersAdded) {
      listenersAdded = true;

      // APNs 登録成功 → トークンを保存
      await PushNotifications.addListener("registration", (token: Token) => {
        void saveToken(currentUserName, token.value);
      });

      // 登録失敗（権限なし/entitlement未設定など）。落とさずログのみ。
      await PushNotifications.addListener("registrationError", (err) => {
        console.warn("[push] registration error:", JSON.stringify(err));
      });

      // 通知タップ → 該当チケットへ遷移
      await PushNotifications.addListener(
        "pushNotificationActionPerformed",
        (action: ActionPerformed) => {
          const data = (action.notification.data ?? {}) as Record<string, string>;
          currentOnTap({ projectSlug: data.project_slug, ticketWbs: data.ticket_wbs });
        },
      );
    }

    // 権限確認 → 未確認なら要求
    let receive = (await PushNotifications.checkPermissions()).receive;
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      receive = (await PushNotifications.requestPermissions()).receive;
    }
    if (receive !== "granted") return; // 拒否/未許可なら静かに終了

    await PushNotifications.register();
  } catch (e) {
    // entitlement 未設定の環境等。アプリは継続。
    console.warn("[push] init skipped:", e);
  }
}
