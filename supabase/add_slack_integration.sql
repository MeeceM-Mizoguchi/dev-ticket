-- Slack連携用カラム追加
-- Supabase Dashboard → SQL Editor で実行してください

-- ユーザーのSlackメンバーIDを保存するカラム
alter table profiles add column if not exists slack_member_id text default null;

-- プロジェクトのSlack通知設定カラム
-- slack_access_token: OAuth認証で取得したワークスペース固有のBotトークン
-- slack_team_name:    接続中のSlackワークスペース名（表示用）
-- slack_channel:      通知先チャンネル名またはID（例: #dev-notify, C1234ABCD）
-- slack_notifications_enabled: 通知のON/OFF
alter table projects add column if not exists slack_access_token text default null;
alter table projects add column if not exists slack_team_name text default null;
alter table projects add column if not exists slack_channel text default null;
alter table projects add column if not exists slack_notifications_enabled boolean not null default false;
