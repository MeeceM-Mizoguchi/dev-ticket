-- ============================================================
-- sprint_tickets に prefixes カラムを追加
-- チケットに最大3つのプレフィックスラベルを付けられる機能
-- ※ 冪等（何度実行しても安全）
-- ============================================================

alter table sprint_tickets
  add column if not exists prefixes text[] not null default '{}';
