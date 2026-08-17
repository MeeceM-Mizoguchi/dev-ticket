-- ============================================================
-- BRU12-022 コメント／返信の二重送信ガード（DB側の防護措置）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- ============================================================
--
-- 本来の修正はフロント側（TicketDetailPanel の「投稿」「返信」ボタンを送信中は非活性にする）。
-- ここは最終防衛線で、フロントを通らない多重送信を止める:
--   ・通信の自動リトライやネットワーク再送
--   ・別タブ／別端末で同じチケットを開いて同時に押した場合
--   ・将来 API 経由の投稿が増えた場合
--
-- 【方式】BEFORE INSERT トリガで「直近2秒に入った同一投稿」を静かに捨てる。
--   ・同一の判定は (ticket_id, user_name, content, reply_to) が全部一致すること。
--     reply_to は null（親コメント）同士も一致とみなしたいので IS NOT DISTINCT FROM で比較する。
--   ・RETURN NULL は「エラーにせず行を破棄する」挙動。エラーを返すと連打した側の
--     クライアントが投稿失敗として扱ってしまうため、あえて成功扱いのまま捨てる
--     （結果として1件だけ残る＝べき等になる）。
--   ・comment_type = 'comment'（人が書いた投稿・返信）だけを対象にする。
--     status_change などの自動コメントは同じ本文が続いても正常な履歴なので触らない。
--
-- 【なぜ advisory lock が必要か】
-- 連打で2つのINSERTが「ほぼ同時」に届くと、それぞれ別トランザクションになる。
-- READ COMMITTED では相手の未コミット行は見えないので、EXISTS だけでは両方すり抜ける。
-- そこで同一投稿ごとに同じキーでトランザクション単位のロックを取り、2本目を待たせる。
-- 待っている間に1本目がコミット（＝ロック解放）し、plpgsql の次の文は新しいスナップショットを
-- 取るため、2本目の EXISTS からは1本目の行が見えるようになる。
-- ロックはトランザクション終了時に自動で解放されるので後始末は不要。
-- hashtext の衝突で無関係な投稿が一瞬待たされることはあるが、待つだけなので害はない。

create or replace function ticket_comments_block_duplicate()
returns trigger as $$
begin
  -- 自動コメント（status_change / review など）は対象外
  if new.comment_type is distinct from 'comment' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(new.ticket_id || '|' || new.user_name || '|' || coalesce(new.reply_to, '') || '|' || new.content)
  );

  if exists (
    select 1
      from ticket_comments c
     where c.ticket_id = new.ticket_id
       and c.user_name = new.user_name
       and c.content = new.content
       and c.comment_type = 'comment'
       and c.reply_to is not distinct from new.reply_to
       and c.created_at > now() - interval '2 seconds'
  ) then
    return null; -- 二重送信 → 破棄
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_ticket_comments_block_duplicate on ticket_comments;
create trigger trg_ticket_comments_block_duplicate
  before insert on ticket_comments
  for each row execute function ticket_comments_block_duplicate();

-- 上の EXISTS が全件走査にならないように。投稿のたびに走る判定なので必須。
create index if not exists idx_ticket_comments_dup_guard
  on ticket_comments (ticket_id, user_name, created_at desc);
