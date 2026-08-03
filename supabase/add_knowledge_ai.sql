-- ============================================================
-- ナレッジAI（プロジェクト単位の資料取り込み＋意味検索）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 冪等: 何度実行しても安全
--
-- 設計: docs/knowledge-ai-design.md
--   ・既存テーブル（wiki_pages / project_files 等）には一切触れない独立の箱
--   ・原文は Storage ではなく text 列に直接持つ（Markdown は数百KB程度）
--   ・埋め込みはブラウザ内(transformers.js)で計算し、ここには結果だけが入る
--   ・LLM による回答生成はしない。「該当箇所を返す」までが責務
-- ============================================================

-- ── 拡張 ──────────────────────────────────────────────────────
-- vector : 意味検索（コサイン距離）
-- pg_trgm: 日本語はPostgres標準の全文検索が単語分割できないため trigram で代替する
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ── プロジェクトのアクセス判定 ────────────────────────────────
-- projects.members は「メンバー名(profiles.name)の配列」。
--   （BacklogPage 等の `project.members.includes(userName)` と同じ判定をDB側でも行う）
-- profiles.organization_id は環境により uuid / text のどちらもあり得るため ::text で明示比較する。
create or replace function can_access_project(p_project_id text)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.projects p
    join public.profiles me on me.id = auth.uid()
    where p.id = p_project_id
      and (
        me.role = 'owner'
        or (
          p.organization_id::text = me.organization_id::text
          and (
            me.name = any(p.members)
            or me.role in ('admin', 'project-manager')
          )
        )
      )
  )
$$;

-- ── 取り込んだ資料 ────────────────────────────────────────────
create table if not exists knowledge_documents (
  id              uuid primary key default gen_random_uuid(),
  project_id      text not null references projects(id) on delete cascade,
  title           text not null,
  file_name       text not null default '',
  content         text not null,                  -- 原文をそのまま保持（表示・ハイライトに使う）
  content_hash    text not null default '',       -- 同一内容の再取り込み検出
  byte_size       int  not null default 0,
  tags            text[] not null default '{}',
  chunk_count     int  not null default 0,
  indexed_at      timestamptz,                    -- null = 未索引（ベクトル未生成）
  embedding_model text not null default '',       -- モデル差し替え時の再索引判定
  uploaded_by     text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_kn_docs_project
  on knowledge_documents(project_id, created_at desc);

-- ── 検索の実体（本文の断片） ──────────────────────────────────
-- source_kind: 将来 wiki / 議事録 も索引対象に含める余地を残すための列。
--   現時点では 'knowledge' 固定。テーブルを作り直さずに行を足せるようにしておく。
create table if not exists knowledge_chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references knowledge_documents(id) on delete cascade,
  project_id   text not null,                     -- 非正規化。RLSと絞り込みを単純かつ速くする
  source_kind  text not null default 'knowledge',
  seq          int  not null,
  heading_path text not null default '',          -- 「3. インフラ > 3-3. セッション共有」
  content      text not null,
  char_start   int  not null default 0,           -- 原文内の位置（ハイライト用）
  char_end     int  not null default 0,
  embedding    vector(384),                       -- multilingual-e5-small の次元数
  created_at   timestamptz not null default now()
);

create index if not exists idx_kn_chunks_doc     on knowledge_chunks(document_id, seq);
create index if not exists idx_kn_chunks_project on knowledge_chunks(project_id);

-- 意味検索用。件数が数万に育っても効くよう HNSW を張る。
-- （embedding が null の行は索引対象外になるため、後追いで埋める運用と相性が良い）
create index if not exists idx_kn_chunks_vec on knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- キーワード検索用（部分一致・類似度）
create index if not exists idx_kn_chunks_trgm on knowledge_chunks
  using gin (content gin_trgm_ops);

-- ── RLS ───────────────────────────────────────────────────────
alter table knowledge_documents enable row level security;
alter table knowledge_chunks    enable row level security;

drop policy if exists "kn_docs_all"   on knowledge_documents;
drop policy if exists "kn_chunks_all" on knowledge_chunks;

create policy "kn_docs_all" on knowledge_documents
  for all
  using      (can_access_project(project_id))
  with check (can_access_project(project_id));

create policy "kn_chunks_all" on knowledge_chunks
  for all
  using      (can_access_project(project_id))
  with check (can_access_project(project_id));

-- ── 検索RPC（ハイブリッド） ───────────────────────────────────
-- ベクトル検索だけだと固有名詞・識別子（BRU10-043 / convert_deal_to_project 等）に弱いため、
-- キーワード検索と重み付きで合成する。重みは p_vec_weight で外から調整可能。
--
-- p_query_vec が null のとき（＝モデル未ロード / 未索引資料しか無い）でも
-- キーワード検索だけで結果を返す。「ベクトルが無いと何も出ない」を避ける。
-- p_query_vec は「'[0.1,0.2,...]' 形式のテキスト」で受ける。
--   PostgREST は JSON 配列を vector 型へ自動キャストできないため、
--   text で受けて関数内で ::vector する（クライアント実装が単純になる）。
create or replace function knowledge_search(
  p_project_id   text,
  p_query_text   text,
  p_query_vec    text default null,
  p_limit        int default 20,
  p_vec_weight   float default 0.7,
  p_document_ids uuid[] default null              -- 対象資料を絞る（null = 全件）
)
returns table (
  chunk_id     uuid,
  document_id  uuid,
  title        text,
  heading_path text,
  content      text,
  char_start   int,
  char_end     int,
  score        float,
  vec_score    float,
  kw_score     float
)
language plpgsql
stable
security definer
as $$
-- 戻り値の列名（content / title / score 等）と実テーブルの列名が同名のため、
-- 修飾なしの参照が曖昧になり得る。列を優先させて取り違えを防ぐ。
#variable_conflict use_column
declare
  v_vec vector(384);
  v_q   text := coalesce(trim(p_query_text), '');
begin
  if p_query_vec is not null and length(trim(p_query_vec)) > 0 then
    v_vec := p_query_vec::vector(384);
  end if;

  return query
  with scoped as (
    select c.*
    from knowledge_chunks c
    where c.project_id = p_project_id
      and (p_document_ids is null or c.document_id = any(p_document_ids))
  ),
  vec as (
    select s.id, (1 - (s.embedding <=> v_vec))::float as sc
    from scoped s
    where v_vec is not null and s.embedding is not null
    order by s.embedding <=> v_vec
    limit 50
  ),
  kw as (
    select s.id,
           greatest(
             similarity(s.content, v_q),
             case when s.content ilike '%' || v_q || '%' then 0.6 else 0 end
           )::float as sc
    from scoped s
    where v_q <> ''
      and (s.content ilike '%' || v_q || '%' or similarity(s.content, v_q) > 0.1)
    limit 50
  ),
  merged as (
    select t.id,
           sum(t.w)::float                as score,
           coalesce(max(t.vw), 0)::float  as vec_score,
           coalesce(max(t.kw2), 0)::float as kw_score
    from (
      select v.id, v.sc * p_vec_weight       as w, v.sc        as vw, null::float as kw2 from vec v
      union all
      select k.id, k.sc * (1 - p_vec_weight) as w, null::float as vw, k.sc        as kw2 from kw k
    ) t
    group by t.id
  )
  select c.id, c.document_id, d.title, c.heading_path, c.content,
         c.char_start, c.char_end,
         m.score, m.vec_score, m.kw_score
  from merged m
  join knowledge_chunks c    on c.id = m.id
  join knowledge_documents d on d.id = c.document_id
  where can_access_project(c.project_id)
  order by m.score desc
  limit p_limit;
end;
$$;

-- ── 埋め込みの一括反映 ────────────────────────────────────────
-- ブラウザ側で計算したベクトルをまとめて書き戻す。
-- 1行ずつ update すると数十〜数百リクエストになるため、jsonb 配列で1発にする。
--   p_rows: [{"id":"<uuid>","embedding":[0.1, ...]}, ...]
create or replace function knowledge_set_embeddings(p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_count int := 0;
begin
  update knowledge_chunks c
     set embedding = ((r->'embedding')::text)::vector(384)
    from jsonb_array_elements(p_rows) as r
   where c.id = (r->>'id')::uuid
     and can_access_project(c.project_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── プランによる機能ゲート ────────────────────────────────────
alter table plans add column if not exists feature_knowledge_ai boolean not null default false;
alter table plans add column if not exists max_knowledge_docs_per_project int;

-- 無制限プランでは常に利用可能にしておく
update plans set feature_knowledge_ai = true where id = 'system-unlimited';

-- ============================================================
-- 動作確認クエリ（任意）
-- ============================================================
-- select * from pg_extension where extname in ('vector','pg_trgm');
-- select can_access_project('<project_id>');
-- select * from knowledge_search('<project_id>', 'セッション共有', null, 10);
