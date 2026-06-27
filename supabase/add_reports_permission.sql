-- ── レポート管理 権限フラグ追加（roles.base_permissions に既存JSONBで格納） ──
-- DDL不要（base_permissions は JSONB）。未設定ロールは AuthContext 側の DEFAULT_PERMISSIONS で false 扱い。
-- 中間管理職ロール（admin / project-manager）にレポート管理アクセスを既定で許可する。
-- ※ owner は AuthContext でハードコード許可のため対象外。
update roles set base_permissions = base_permissions
  || '{"canAccessReports":true}'::jsonb
  where name in ('admin','project-manager');
