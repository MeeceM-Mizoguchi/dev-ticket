-- BRU13-013 チケット詳細からのプルリク作成・マージ
--
-- 「リリース待ち」以降なのに関連PRが1件も無いチケットは、一覧の行を赤くして知らせる。
-- ただし仕様確認・ドキュメント作業など、そもそもPRが発生しないチケットもあるため、
-- 「このチケットはPR不要」と人が確定できる逃げ道を1列で持つ。
--
-- 判定そのものは ticket_github_links の有無から導出するので、ここに持つのは
-- 「アラートを畳んだ」という意思表示だけ。PRを紐付ければ列の値に関係なく赤は消える。
alter table sprint_tickets
  add column if not exists pr_link_waived boolean not null default false;

comment on column sprint_tickets.pr_link_waived is
  'PR未紐付けアラートを出さない（PR不要と確定したチケット）。判定は ticket_github_links から導出し、この列はアラート抑止のみ';
