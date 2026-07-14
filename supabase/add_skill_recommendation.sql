-- ============================================================
-- ENHA2-034 スキル＆担当者レコメンドAI
--
-- 処理は2種類（混同注意）:
--   ① スキル分析   … チケット実績から member_skills のレベルを自動判定（集計＋ルール。学習しない）
--   ② レコメンド   … チケット作成時に適任者をランキング提示（LightGBM。学習する）
-- ①の結果が②の学習材料になる。
--
-- ※ 冪等（何度実行しても安全）
-- ============================================================

-- ------------------------------------------------------------
-- 1. スキルマスタ（組織ごと）
--    layer は固定6種。その配下に「スキル名」がぶら下がる2階層。
--    keywords はチケットのタイトル/説明/ラベルから自動検出するための手がかり。
-- ------------------------------------------------------------
create table if not exists skills (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null,
  layer           text not null check (layer in ('frontend','backend','infra','design','qa','other')),
  name            text not null,
  keywords        text[] not null default '{}',
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, layer, name)
);

create index if not exists idx_skills_org on skills(organization_id);

-- ------------------------------------------------------------
-- 2. メンバーのスキル（レベル1〜4）
--    level 定義（所要時間・難易度ベース。既存チケットの工数と直結させるための軸）:
--      1: 簡単なものであればできる（15分〜30分でできるもの）
--      2: 少し難しいものならできる（1時間〜3時間でできるもの）
--      3: 普通（バックエンドも考慮したI/Fまでできる）
--      4: リーダークラス（ほぼなんでもできる）
--    source: 'auto' = ①スキル分析が判定 / 'manual' = 人が設定（①は上書きしない）
--    evidence: 判定根拠（完了件数・平均工数・レビュー件数など）を人に見せるため保持
-- ------------------------------------------------------------
create table if not exists member_skills (
  profile_id  uuid not null references profiles(id) on delete cascade,
  skill_id    uuid not null references skills(id) on delete cascade,
  level       int  not null check (level between 1 and 4),
  source      text not null default 'auto' check (source in ('auto','manual')),
  evidence    jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (profile_id, skill_id)
);

create index if not exists idx_member_skills_skill on member_skills(skill_id);

-- ------------------------------------------------------------
-- 3. チケットの必要スキル
--    importance: 3=必須 / 2=推奨 / 1=あれば尚可
-- ------------------------------------------------------------
create table if not exists ticket_required_skills (
  ticket_id  text not null references sprint_tickets(id) on delete cascade,
  skill_id   uuid not null references skills(id) on delete cascade,
  importance int  not null default 3 check (importance between 1 and 3),
  primary key (ticket_id, skill_id)
);

create index if not exists idx_ticket_required_skills_skill on ticket_required_skills(skill_id);

-- ------------------------------------------------------------
-- 4. sprint_tickets: 開発規模 と 差分検知フラグ
--    dev_scale … 工数(時間)とは別軸の「難易度・広がり」。学習の特徴量に使う。
--    ml_processed_at … ①/②が最後にこのチケットを処理した日時。
--        updated_at > ml_processed_at のものだけを再計算する（差分検知）。
--        ※ 差分なのは「特徴量の再計算」まで。学習(fit)は毎回全件でやり直す
--          （GBDTは差分学習すると直近データに過剰適合して精度が壊れるため）。
-- ------------------------------------------------------------
alter table sprint_tickets
  add column if not exists dev_scale       text,
  add column if not exists ml_processed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sprint_tickets_dev_scale_check'
  ) then
    alter table sprint_tickets
      add constraint sprint_tickets_dev_scale_check
      check (dev_scale is null or dev_scale in ('S','M','L','XL'));
  end if;
end $$;

create index if not exists idx_sprint_tickets_ml_processed on sprint_tickets(ml_processed_at);

-- ------------------------------------------------------------
-- 5. profiles: 自動更新トグル と お知らせモーダルの既読
--    skill_auto_update … ★ONのメンバーだけ①スキル分析が member_skills を更新する。
--        OFF でも②レコメンドの対象からは外さない（手動スキル＋実績で推薦される）。
--    ml_notice_dismissed … 「次回以降このお知らせを表示しない」チェック
-- ------------------------------------------------------------
alter table profiles
  add column if not exists skill_auto_update   boolean not null default true,
  add column if not exists ml_notice_dismissed boolean not null default false;

-- ------------------------------------------------------------
-- 6. organizations: 初回セットアップの状態
--    ※ organizations は他マイグレーションで作成済み。列だけ足す。
-- ------------------------------------------------------------
alter table organizations
  add column if not exists ml_setup_done      boolean not null default false,
  add column if not exists ml_skills_reviewed boolean not null default false,
  add column if not exists ml_last_analyzed_at timestamptz;

-- ------------------------------------------------------------
-- 7. 学習済みモデル（組織ごとに1つ。全組織を1モデルにするとスケールしない）
--    model_json … LightGBM の dump_model() をそのまま保持。
--        推論はフロント/APIのTypeScript側で木を辿って行う（実行時にPython不要）。
--    is_active  … オフライン評価でベースラインを超えたモデルだけ true にする。
--        false のうちはルールベース（ベースライン）で推薦する。
-- ------------------------------------------------------------
create table if not exists recommendation_models (
  id              uuid primary key default gen_random_uuid(),
  organization_id text not null,
  version         int  not null,
  model_json      jsonb not null,
  feature_names   text[] not null default '{}',
  metrics         jsonb not null default '{}'::jsonb,
  train_rows      int not null default 0,
  is_active       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, version)
);

create index if not exists idx_recommendation_models_active
  on recommendation_models(organization_id, is_active);

-- ------------------------------------------------------------
-- 8. 推薦ログ（オンライン評価＋次回の学習材料）
--    「AIは田中を勧めたが、PMは鈴木を選んだ」も学習の材料になる。
-- ------------------------------------------------------------
create table if not exists recommendation_logs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   text not null,
  ticket_id         text,
  recommended       jsonb not null default '[]'::jsonb,
  chosen_profile_id uuid,
  was_top1          boolean,
  source            text not null default 'model' check (source in ('model','baseline')),
  created_at        timestamptz not null default now()
);

create index if not exists idx_recommendation_logs_org on recommendation_logs(organization_id, created_at desc);

-- ------------------------------------------------------------
-- 9. RLS
--    既存テーブルと同じく authenticated ベース。
--    サーバー側のバッチ（①スキル分析API / ②Python学習）は
--    service_role で接続するため RLS をバイパスする。
-- ------------------------------------------------------------
alter table skills                 enable row level security;
alter table member_skills          enable row level security;
alter table ticket_required_skills enable row level security;
alter table recommendation_models  enable row level security;
alter table recommendation_logs    enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'skills' and policyname = 'skills_all') then
    create policy skills_all on skills for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'member_skills' and policyname = 'member_skills_all') then
    create policy member_skills_all on member_skills for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'ticket_required_skills' and policyname = 'ticket_required_skills_all') then
    create policy ticket_required_skills_all on ticket_required_skills for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;

  -- モデルは読み取り専用（書き込みは service_role のバッチのみ）
  if not exists (select 1 from pg_policies where tablename = 'recommendation_models' and policyname = 'recommendation_models_read') then
    create policy recommendation_models_read on recommendation_models for select
      using (auth.role() = 'authenticated');
  end if;

  if not exists (select 1 from pg_policies where tablename = 'recommendation_logs' and policyname = 'recommendation_logs_all') then
    create policy recommendation_logs_all on recommendation_logs for all
      using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
  end if;
end $$;
