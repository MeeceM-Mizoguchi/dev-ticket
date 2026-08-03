-- ============================================================
-- ナレッジノート: 検索RPC の改訂（v2）
-- Run in: Supabase Dashboard → SQL Editor → New query
-- 前提: supabase/add_knowledge_ai.sql を先に実行しておくこと
-- 冪等: 何度実行しても安全
--
-- 変更点:
--   ① 件数の頭打ちをやめる
--        ・文字列検索は「一致するかどうか」が明確なので上限なし（全件返す）
--        ・意味検索は全断片が何らかの距離を持つため、件数ではなく
--          「関連度の下限（p_min_vec）」で切る。上限は暴走防止の保険だけ残す
--   ② 意味検索と文字列検索を画面で別タブに分けるため、
--      合成スコアだけでなく vec_score / kw_score をそのまま返す
--        （呼び出し側が vec_score>0 / kw_score>0 で振り分ける）
-- ============================================================

-- 引数が変わるため、古い定義を明示的に落とす。
-- （create or replace は引数リストが違うと別関数として増えてしまい、
--   PostgREST から見て呼び出しが曖昧になる）
drop function if exists knowledge_search(text, text, text, int, float, uuid[]);
drop function if exists knowledge_search(text, text, vector, int, float, uuid[]);

create or replace function knowledge_search(
  p_project_id   text,
  p_query_text   text,
  p_query_vec    text default null,
  p_limit        int default 1000,     -- 暴走防止の保険。実質の上限ではない
  p_vec_weight   float default 0.7,
  p_document_ids uuid[] default null,
  p_min_vec      float default 0.78    -- 意味検索の関連度の下限
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
  -- 意味検索: 件数ではなく関連度で切る。
  -- HNSW索引を効かせるため order by は距離のまま書く。
  vec as (
    select s.id, (1 - (s.embedding <=> v_vec))::float as sc
    from scoped s
    where v_vec is not null
      and s.embedding is not null
      and (1 - (s.embedding <=> v_vec)) >= p_min_vec
    order by s.embedding <=> v_vec
    limit p_limit
  ),
  -- 文字列検索: 一致するものは全部返す（上限なし）
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

-- ============================================================
-- 動作確認クエリ（任意）
-- ============================================================
-- 文字列検索だけ（ベクトルなし）で何件出るか
-- select count(*) from knowledge_search('<project_id>', 'DB', null);
