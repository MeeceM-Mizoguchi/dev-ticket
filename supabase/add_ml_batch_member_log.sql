-- ============================================================
-- BRU10-062 学習ログをメンバー個別に貯める
--
-- 背景:
--   ml_batch_runs は「1組織 × 1回のバッチ実行」で1行しか持たない。
--   そのためメンバーのスキルモーダルにある「学習ログ」タブは、誰を開いても
--   組織全体の同じ内容が出ていた。実際に 8/8 の「スキル修正あり（1名・4件）」が
--   別メンバーの結果だったため、「変更履歴に載っていない＝バグでは？」という
--   誤読を招いていた（実際はどちらも正しく記録されていた）。
--
--   変更履歴（member_skill_changes）は "変わったときだけ" 残るので、
--   「この人は対象だったが変更が無かった」と「そもそも対象外だった」を区別できない。
--   個人単位でも "毎回必ず1行" のログが要る。それがこのテーブル。
--
-- ★ 行数を膨らませないための線引き ★
--   組織ごとスキップ（前回からチケットが動いていない等）の晩は、メンバー行を作らない。
--   1000組織×30人を毎晩書くと年1000万行規模になり、履歴機能がスナップショット方式を
--   捨てたのと同じ理由で破綻する。スキップ日は組織の行（ml_batch_runs）が理由を
--   持っているので、画面はそちらへフォールバックすれば同じことが言える。
--   ＝ 行が増えるのは「実際に分析が走った晩 × 在籍メンバー数」だけ。
--
-- ※ 冪等（何度実行しても安全）
-- ============================================================

-- ------------------------------------------------------------
-- 1. メンバー個別の実行ログ
--
--    status:
--      updated   … このメンバーのスキルが変わった（changed_count > 0）
--      unchanged … 分析対象だったが、判定結果が前回と同じで変更なし
--      excluded  … 対象外（スキル自動更新OFF など。reason に理由）
--
--    ★ profile_id に外部キーを張らない（意図的）★
--      member_skill_changes と同じ方針。メンバーが消えてもログは残す。
--
--    detail には変更の内訳をスキル「名」で持たせる。表示のたびに skills を
--    引き直さなくて済み、スキルが後から削除・改名されても当時の記録が保たれる。
-- ------------------------------------------------------------
create table if not exists ml_batch_member_runs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  text not null,
  batch_id         text not null,   -- ml_batch_runs.batch_id と同じ鍵（組織の行と1:N）
  profile_id       uuid not null,
  trigger          text not null check (trigger in ('daily','deploy','manual')),
  started_at       timestamptz not null default now(),
  status           text not null check (status in ('updated','unchanged','excluded')),
  changed_count    int  not null default 0,   -- このメンバーで変わったスキル数
  evaluated_skills int  not null default 0,   -- 判定材料になった(このメンバー×スキル)の組数
  matched_tickets  int  not null default 0,   -- 判定に使えたチケット数（担当＋レビュー）
  protected_skills int  not null default 0,   -- 手動設定のため自動判定を見送った数
  reason           text,
  detail           jsonb not null default '{}'::jsonb,   -- {changes:[{skill,changeType,oldLevel,newLevel}]}
  skill_run_id     uuid,             -- 対応する skill_update_runs.id（変更履歴へのリンク用）
  unique (organization_id, batch_id, profile_id)
);

-- 主役のクエリ:「このメンバーの直近30日ぶんを新しい順に」
create index if not exists idx_ml_batch_member_runs_profile
  on ml_batch_member_runs(profile_id, started_at desc);

-- 組織の行（ml_batch_runs）とまとめて引くとき用
create index if not exists idx_ml_batch_member_runs_batch
  on ml_batch_member_runs(organization_id, batch_id);

-- ------------------------------------------------------------
-- 2. 過去分の埋め合わせ
--
--    ★ 埋められるのは「変更があった人」だけ ★
--      過去に遡って「対象だったが変更が無かった」を復元することはできない。
--      当時それを記録していないので、無かったことを推測で 'unchanged' と
--      書くと嘘のログになる。分かる事実（変更があった人）だけを入れる。
--
--    member_skill_changes → skill_update_runs → ml_batch_runs.skill_run_id
--    の連結で、どのバッチ実行が誰を変えたのかは正確に復元できる。
-- ------------------------------------------------------------
insert into ml_batch_member_runs (
  organization_id, batch_id, profile_id, trigger, started_at,
  status, changed_count, detail, skill_run_id
)
select
  r.organization_id,
  r.batch_id,
  c.profile_id,
  r.trigger,
  r.started_at,
  'updated',
  count(*)::int,
  jsonb_build_object('changes', jsonb_agg(
    jsonb_build_object(
      'skill',      coalesce(s.name, '（削除済み）'),
      'changeType', c.change_type,
      'oldLevel',   c.old_level,
      'newLevel',   c.new_level
    )
    order by s.name
  )),
  r.skill_run_id
from ml_batch_runs r
join member_skill_changes c on c.run_id = r.skill_run_id
left join skills s on s.id = c.skill_id
where r.skill_run_id is not null
group by r.organization_id, r.batch_id, c.profile_id, r.trigger, r.started_at, r.skill_run_id
on conflict (organization_id, batch_id, profile_id) do nothing;

-- ------------------------------------------------------------
-- 3. RLS
--    ml_batch_runs と同じ方針。閲覧は認証済みユーザー、書き込みはバッチ(service_role)のみ。
-- ------------------------------------------------------------
alter table ml_batch_member_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'ml_batch_member_runs' and policyname = 'ml_batch_member_runs_read'
  ) then
    create policy ml_batch_member_runs_read on ml_batch_member_runs for select
      using (auth.role() = 'authenticated');
  end if;
end $$;
