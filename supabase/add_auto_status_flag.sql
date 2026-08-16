-- プロジェクト／スプリントのステータス自動設定フラグ
-- （本番DBには追加済み。schema.sql に載っていなかったため追記）
-- false = チケットの状況から自動算出 / true = ユーザーが手動で固定
alter table projects add column if not exists is_manual_status boolean not null default false;
alter table sprints  add column if not exists is_manual_status boolean not null default false;
