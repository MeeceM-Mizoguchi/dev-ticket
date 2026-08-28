-- 実行中の書き込み操作（マージ／まとめてマージ／PR作成）の記録。
--
-- マージもPR作成も、GitHubの呼び出し・監査ログ・リリース反映まで全部サーバー側で
-- 完結しているので、タブやブラウザを閉じても処理そのものは最後まで走り切る。
-- ただし github_action_logs は「終わったこと」しか書かないため、開き直したときに
-- 「まだ実行中なのか」「もう終わったのか」を知る手段が無かった。
--
-- そこで開始時に running の行を1つ置き、終わったら done / error に書き換える。
-- 画面はログイン直後にこの表を見て、実行中なら進捗モーダルを出して結果まで見届ける。
-- ユーザーIDで引くので、別のPC・別のブラウザから開き直しても復帰できる。
--
-- 書き込むのはサーバー(service_role)だけ。参照は自分の行だけ。
create table if not exists github_action_runs (
  id           uuid primary key,
  project_id   text not null references projects(id) on delete cascade,
  -- 復帰したモーダルから「GitHubの画面をひらく」へ飛ぶために持つ（表示専用）
  project_slug text,
  actor_id     uuid not null,
  kind         text not null,        -- merge / merge-bulk / create-pull
  label        text,                 -- 「#12 をマージ」など、画面にそのまま出す一言
  state        text not null default 'running' check (state in ('running','done','error')),
  message      text,                 -- error のときの理由
  result       jsonb,                -- 応答そのもの（まとめてマージの1件ごとの結果など）
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- 参照は必ず「自分の・新しい順」で引く
create index if not exists idx_github_action_runs_actor
  on github_action_runs (actor_id, started_at desc);

alter table github_action_runs enable row level security;

drop policy if exists github_action_runs_select on github_action_runs;
create policy github_action_runs_select on github_action_runs
  for select using (actor_id = auth.uid());
