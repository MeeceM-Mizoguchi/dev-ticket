-- 工数の工程別内訳を保存するカラム。
-- 実績モニタ／対応工数の修正モーダルで、ユーザーが入力した各工程の時間を
-- そのまま再現するために使用する。
-- 値は ["1","1","1","1","1"] のような文字列配列（時間単位）。
-- 配列の並びは [開始→レビュー依頼, レビュー依頼→レビュー承認, レビュー承認→STG完了, STG完了→UAT完了, UAT完了→対応完了]。
ALTER TABLE public.sprint_tickets
  ADD COLUMN IF NOT EXISTS actual_work_hours_breakdown JSONB DEFAULT NULL;
