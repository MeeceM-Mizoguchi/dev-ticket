-- ============================================================
-- ナレッジノート: 埋め込みモデルの入れ替え（e5-small 384次元 → e5-base 768次元）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 前提: add_knowledge_ai.sql / add_knowledge_folders.sql / add_knowledge_search_v2.sql 実行済み
--
-- ⚠ 既存の埋め込みはすべて破棄され、資料は「未索引」に戻ります。
--    実行後、画面の「索引を作成」で作り直してください（原文と資料は消えません）。
--
-- ── なぜ入れ替えるか（実測にもとづく） ────────────────────────
-- multilingual-e5-small では、日本語の技術文書で意味を捉えられていなかった。
-- 同じ資料・同じ質問で比較した結果:
--
--   質問「データベース」
--     small : 2位に「11. リスクと対策」（無関係）。スコアの幅 3.6pt
--     base  : 1位「6. データモデル」2位「6-0. 全体像（ER図）」。幅 5.8pt
--   質問「DB」
--     small : 1位「3-1. 構成図」（無関係）
--     base  : 1位「6-0. 全体像（ER図）」
--
-- q8→fp32 の量子化変更や、見出しパスの与え方の変更では改善しなかった。
-- モデルの表現力そのものが不足していた。
-- 代償はモデルの初回DLが 113MB → 266MB に増えること。
-- ============================================================

-- ── 埋め込み列を 768 次元へ ───────────────────────────────────
-- 384→768 は値を変換できないため、列ごと作り直す（既存ベクトルは破棄）
drop index if exists idx_kn_chunks_vec;
alter table knowledge_chunks drop column if exists embedding;
alter table knowledge_chunks add column embedding vector(768);

create index if not exists idx_kn_chunks_vec on knowledge_chunks
  using hnsw (embedding vector_cosine_ops);

-- 全資料を未索引に戻す（原文・チャンクは残る）
update knowledge_documents
   set indexed_at = null, embedding_model = ''
 where indexed_at is not null;

-- ── 検索RPC を 768 次元で再定義 ───────────────────────────────
drop function if exists knowledge_search(text, text, text, int, float, uuid[], float);
drop function if exists knowledge_search(text, text, text, int, float, uuid[]);

create or replace function knowledge_search(
  p_project_id   text,
  p_query_text   text,
  p_query_vec    text default null,
  p_limit        int default 1000,
  p_vec_weight   float default 0.7,
  p_document_ids uuid[] default null,
  p_min_vec      float default 0.78
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
#variable_conflict use_column
declare
  v_vec vector(768);
  v_q   text := coalesce(trim(p_query_text), '');
begin
  if p_query_vec is not null and length(trim(p_query_vec)) > 0 then
    v_vec := p_query_vec::vector(768);
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
    where v_vec is not null
      and s.embedding is not null
      and (1 - (s.embedding <=> v_vec)) >= p_min_vec
    order by s.embedding <=> v_vec
    limit p_limit
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

-- ── 埋め込みの一括反映を 768 次元で再定義 ─────────────────────
create or replace function knowledge_set_embeddings(p_rows jsonb)
returns int
language plpgsql
security definer
as $$
declare
  v_count int := 0;
begin
  update knowledge_chunks c
     set embedding = ((r->'embedding')::text)::vector(768)
    from jsonb_array_elements(p_rows) as r
   where c.id = (r->>'id')::uuid
     and can_access_project(c.project_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ============================================================
-- 実行後の確認
-- ============================================================
-- select count(*) filter (where embedding is null) as 未索引,
--        count(*) as 全体 from knowledge_chunks;
