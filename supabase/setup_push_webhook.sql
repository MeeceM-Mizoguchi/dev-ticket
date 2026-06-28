-- ============================================================
-- プッシュ通知 Webhook 配線: notifications INSERT → /api/push-send
-- ============================================================
-- ENHA2-014。notifications テーブルに通知行が INSERT されたら、
-- Vercel の /api/push-send を叩いて該当ユーザーの端末へ APNs プッシュを送る。
--
-- 前提: 先に add_push_tokens.sql を実行して device_tokens を作成しておくこと。
--
-- 【方法A（推奨）】Supabase Dashboard の Database Webhooks で配線
--   Dashboard → Database → Webhooks → "Create a new hook"
--     - Table: notifications
--     - Events: Insert
--     - Type: HTTP Request / POST
--     - URL: https://<本番ドメイン>/api/push-send
--     - HTTP Headers: x-webhook-secret: <PUSH_WEBHOOK_SECRET と同じ値>
--   ※ Dashboard Webhook の送信ボディは { type, table, record, ... } 形式で、
--     /api/push-send はその record を読む実装になっている。
--
-- 【方法B（SQLで配線したい場合）】pg_net トリガー（下記を SQL Editor で実行）
--   <YOUR-VERCEL-DOMAIN> と <SECRET> を実値に置き換えてから実行すること。
-- ============================================================

-- 方法B: pg_net を使ったトリガー
create extension if not exists pg_net;

create or replace function notify_push_on_notification()
returns trigger
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url     := 'https://<YOUR-VERCEL-DOMAIN>/api/push-send',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-webhook-secret', '<SECRET>'   -- Vercel の PUSH_WEBHOOK_SECRET と一致させる
               ),
    body    := jsonb_build_object(
                 'type',  'INSERT',
                 'table', 'notifications',
                 'record', to_jsonb(NEW)
               )
  );
  return NEW;
end;
$$;

drop trigger if exists trg_push_on_notification on notifications;
create trigger trg_push_on_notification
after insert on notifications
for each row execute function notify_push_on_notification();

-- ============================================================
-- 必要な Vercel 環境変数（Project Settings → Environment Variables）
-- ------------------------------------------------------------
--   APNS_KEY_ID       … APNs 認証キー(.p8)の Key ID
--   APNS_TEAM_ID      … Apple Developer の Team ID
--   APNS_BUNDLE_ID    … io.meece.devticket
--   APNS_PRIVATE_KEY  … .p8 の中身(PEM)。複数行 or "\n" エスケープどちらでも可
--   APNS_PRODUCTION   … TestFlight/配布ビルドなら "true"。開発ビルド(実機デバッグ)は未設定=sandbox
--   PUSH_WEBHOOK_SECRET … 任意の秘密文字列（上記 Webhook ヘッダと一致させる）
--   ※ VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は既存のものを流用
-- ============================================================
