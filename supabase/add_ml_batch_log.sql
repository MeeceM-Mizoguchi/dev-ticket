-- ============================================================
-- ENHA2-034 追補: 夜間バッチの学習ログ ＋ 必要スキルの自動付与
--
-- 背景（2026-08-01 の調査結果）:
--   ・②モデル学習は一度も成功していなかった。recommendation_models は0件。
--     原因は ticket_required_skills が完了チケット657件中9件にしか付いておらず、
--     build_dataset が残り648件を捨てて学習データが63行（100行未満）になっていたため。
--     必要スキルは画面から任意入力するだけで、バッチが付与する仕組みが無かった。
--   ・①スキル分析が7/14〜7/31の間ずっと308で素通りしていたが、
--     ワークフローは緑のままで誰も気付けなかった。
--   両方とも「結果がどこにも残らない」ことで発覚が遅れたので、実行ログを残す。
--
-- ※ 冪等（何度実行しても安全）
-- ============================================================

-- ------------------------------------------------------------
-- 1. ticket_required_skills に source を追加
--
--    'manual' … 人が画面で設定した（バッチは触らない）
--    'auto'   … ①スキル分析がチケット文章のキーワードから付与した
--
--    既存行はすべて人が入力したものなので default 'manual' のままで正しい。
--    member_skills の source と同じ考え方（自動判定が人の意思を潰さない）。
-- ------------------------------------------------------------
alter table ticket_required_skills
  add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ticket_required_skills_source_check'
  ) then
    alter table ticket_required_skills
      add constraint ticket_required_skills_source_check
      check (source in ('auto','manual'));
  end if;
end $$;

create index if not exists idx_ticket_required_skills_source
  on ticket_required_skills(ticket_id, source);

-- ------------------------------------------------------------
-- 2. 夜間バッチの実行ログ
--
--    1行 = 1組織 × 1回のバッチ実行。画面の「学習ログ」タブがこれを表示する。
--
--    ★ batch_id で ① と ② を紐づける ★
--      ①はTypeScript(Vercel)、②はPython(GitHub Actions)で別プロセスなので、
--      GitHub Actions の run_id を共通キーにして同じ行を更新していく。
--
--    ★ finished_at が null のまま残る = 異常終了 ★
--      ワークフローが途中で落ちた/タイムアウトした場合。画面では「問題あり」にする。
--
--    ★ 行が存在しない日 = バッチが起動しなかった ★
--      DBには何も書けないので、画面側で日付の穴を検出して「未実行」と表示する。
-- ------------------------------------------------------------
create table if not exists ml_batch_runs (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null,
  batch_id        text not null,   -- GitHub Actions の run_id-run_attempt。手動実行は manual-<時刻>
  trigger         text not null check (trigger in ('daily','deploy','manual')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  result          text check (result in ('completed','failed','not_run')),
  summary         text,            -- 画面のサマリ列にそのまま出す1行
  detail          jsonb not null default '{}'::jsonb,   -- {analyze:{...}, train:{...}} 内訳とエラー全文
  skill_run_id    uuid,            -- 対応する skill_update_runs.id（変更履歴へのリンク用）
  unique (organization_id, batch_id)
);

create index if not exists idx_ml_batch_runs_org_started
  on ml_batch_runs(organization_id, started_at desc);

-- ------------------------------------------------------------
-- 3. organizations に「最後にチェックした日時」
--
--    ml_last_analyzed_at … 最後に「スキルを書き換えた」日時（既存。変更履歴と一致する）
--    ml_last_checked_at  … 最後に「差分を確認した」日時（新規。変更が無くても更新する）
--
--    これまでは差分なしでスキップすると何も残らず、
--    「バッチが動かなかった」のか「動いたが変更が無かった」のか区別できなかった。
-- ------------------------------------------------------------
alter table organizations
  add column if not exists ml_last_checked_at timestamptz;

-- ------------------------------------------------------------
-- 4. sprint_tickets.updated_at ＋ 自動更新トリガ
--
--    ★差分検知の土台★
--      これまでは updated_at 列が無かったため、created_at と5つのマイルストーン日時の
--      最大値で「最後に動いた時刻」を近似していた。しかしこの近似では
--        ・マイルストーン日時を持たないまま closed になったチケット（実測66件）
--        ・タイトル/説明/担当者/実績工数の編集
--      が一切検知できず、スキル分析が「変更なし」と誤判定して再計算をサボっていた。
--
--    既存行は created_at で埋める（それ以上に正確な情報が無いため）。
-- ------------------------------------------------------------
alter table sprint_tickets
  add column if not exists updated_at timestamptz;

update sprint_tickets set updated_at = created_at where updated_at is null;

alter table sprint_tickets
  alter column updated_at set default now();

create or replace function touch_sprint_tickets_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_sprint_tickets_updated_at on sprint_tickets;
create trigger trg_sprint_tickets_updated_at
  before update on sprint_tickets
  for each row execute function touch_sprint_tickets_updated_at();

create index if not exists idx_sprint_tickets_updated_at
  on sprint_tickets(updated_at);

-- ------------------------------------------------------------
-- 5. 次回のバッチで全組織を1回だけ再分析させる
--
--    ★これが無いと必要スキルの自動付与が永久に始まらない★
--      自動付与は「差分検知を通過した組織」でしか走らない。しかし既に分析済みの組織は
--      チケットが動かない限り毎晩スキップされるため、いつまでも必要スキルが埋まらず、
--      ②モデル学習も学習データ不足のままになる（＝今回直したい状態が続く）。
--      ml_last_analyzed_at を空にして、次の1回だけフル再分析させる。
--
--    ml_setup_done は触らない（初回セットアップの案内が再度出るのを防ぐため）。
--    ml_last_analyzed_at はゲート判定には使われていないので、これで副作用は無い。
-- ------------------------------------------------------------
update organizations set ml_last_analyzed_at = null;

-- ------------------------------------------------------------
-- 6. RLS
--    学習ログは全メンバーが読める（自分たちのスキルがどう更新されたか確認するため）。
--    書き込みはバッチ（service_role）だけ。recommendation_models と同じ方針。
-- ------------------------------------------------------------
alter table ml_batch_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'ml_batch_runs' and policyname = 'ml_batch_runs_read'
  ) then
    create policy ml_batch_runs_read on ml_batch_runs for select
      using (auth.role() = 'authenticated');
  end if;
end $$;
