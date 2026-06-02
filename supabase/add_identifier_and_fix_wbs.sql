-- ============================================================
-- Dev Ticket — identifier / wbs_prefix カラム追加 + 空WBS修復
-- Supabase Dashboard → SQL Editor → New query に貼り付けて実行
-- ※ 全て冪等（何度実行しても安全）
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 不足カラムの追加
-- ────────────────────────────────────────────────────────────

-- sprints: スプリント識別子（例: BRU, SP5）
ALTER TABLE sprints ADD COLUMN IF NOT EXISTS identifier TEXT NOT NULL DEFAULT '';

-- projects: WBSプレフィックス（例: PRJ）、スラッグ（URLに使用）
ALTER TABLE projects ADD COLUMN IF NOT EXISTS wbs_prefix TEXT NOT NULL DEFAULT 'T';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS slug      TEXT NOT NULL DEFAULT '';

-- ────────────────────────────────────────────────────────────
-- 2. 現状確認クエリ（実行して内容を確認してください）
-- ────────────────────────────────────────────────────────────

-- 空WBSのチケットとそのスプリント一覧
SELECT
  st.id         AS ticket_id,
  st.title,
  st.wbs,
  st.created_at,
  s.id          AS sprint_id,
  s.name        AS sprint_name,
  s.identifier  AS sprint_identifier
FROM sprint_tickets st
JOIN sprints s ON s.id = st.sprint_id
WHERE st.wbs IS NULL OR st.wbs = ''
ORDER BY s.id, st.created_at;

-- ────────────────────────────────────────────────────────────
-- 3. 空WBSチケットの自動修復
--    スプリントに identifier が設定されているものだけ対象
--    既存の最大連番の続きから採番する
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  rec        RECORD;
  tkt        RECORD;
  prefix     TEXT;
  max_num    INTEGER;
  counter    INTEGER;
  new_wbs    TEXT;
BEGIN
  -- identifierが設定済みのスプリントで、空WBSチケットを持つものを処理
  FOR rec IN
    SELECT DISTINCT s.id AS sprint_id, s.identifier
    FROM sprint_tickets st
    JOIN sprints s ON s.id = st.sprint_id
    WHERE (st.wbs IS NULL OR st.wbs = '')
      AND s.identifier IS NOT NULL
      AND s.identifier <> ''
  LOOP
    prefix := rec.identifier;

    -- このスプリントの identifier で始まるトップレベルチケットの最大連番を取得
    -- 子チケット形式（BRU-001-1 など）は除外
    SELECT COALESCE(
      MAX(
        CASE
          WHEN wbs ~ ('^' || prefix || '-[0-9]+$')
          THEN CAST(SUBSTRING(wbs FROM LENGTH(prefix) + 2) AS INTEGER)
          ELSE 0
        END
      ), 0
    )
    INTO max_num
    FROM sprint_tickets
    WHERE sprint_id = rec.sprint_id
      AND (wbs LIKE prefix || '-%')
      AND parent_id IS NULL;

    counter := max_num + 1;

    -- 空WBSのトップレベルチケットに採番（作成日順）
    FOR tkt IN
      SELECT id
      FROM sprint_tickets
      WHERE sprint_id = rec.sprint_id
        AND (wbs IS NULL OR wbs = '')
        AND parent_id IS NULL
      ORDER BY created_at
    LOOP
      new_wbs := prefix || '-' || LPAD(counter::TEXT, 3, '0');
      UPDATE sprint_tickets SET wbs = new_wbs WHERE id = tkt.id;
      RAISE NOTICE 'Updated ticket % → wbs = %', tkt.id, new_wbs;
      counter := counter + 1;
    END LOOP;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 4. 修復後の確認クエリ
-- ────────────────────────────────────────────────────────────

-- 修復後も空WBSが残っていないか確認（0件なら成功）
SELECT COUNT(*) AS remaining_empty_wbs
FROM sprint_tickets
WHERE wbs IS NULL OR wbs = '';

-- 各スプリントのWBS一覧（修復結果確認）
SELECT
  s.name        AS sprint_name,
  s.identifier  AS sprint_identifier,
  st.wbs,
  st.title,
  st.created_at
FROM sprint_tickets st
JOIN sprints s ON s.id = st.sprint_id
ORDER BY s.id, st.wbs;
