-- KAIZEN2611-006 リリース：作業だけのチケット用に「リリース不要」のチェックを追加する
--
-- 資料の更新・調査など、作業だけでリリースするものが無いチケットを終わらせるときに付ける。
-- 付けるとその場でクローズ（released）になり、リリースノートには表示しない（リリース日も入れない）。
-- 後から外しても、ステータスはクローズのまま戻さない（チェックの記録だけ外れる）。
--
-- 「PR不要」（pr_link_waived）とは別の列。リリース不要は PR不要を兼ねないため、
-- PR不要にチェックが無ければ、今までどおり一覧の「!」と詳細の紐付けの案内を出す。
alter table sprint_tickets
  add column if not exists release_not_required boolean not null default false;

comment on column sprint_tickets.release_not_required is
  'リリース不要（作業のみ）。付けた時点でクローズにし、リリースノートに表示しない';
