-- ============================================================================
-- BRU10-078: チケットの「保留・取下」を progress のマイナス値(-1/-2)から
--            status カラム('on-hold'/'withdrawn')へ移行する
--
-- 【使い方】このファイルを丸ごとコピーして Supabase SQL Editor で1回実行するだけ。
-- 【タイミング】PR #302 をデプロイした直後に実行すること。
--
-- 安全装置:
--   ・全体が1つのトランザクション。途中で1つでも異常があれば全部なかったことになる
--   ・実行前のデータを sprint_tickets_bak_bru10078 に退避する（切り戻し用）
--   ・2回目を実行しようとするとバックアップを守るため自動で中止する
-- ============================================================================

DO $$
DECLARE
  v_hold_before   int;
  v_wd_before     int;
  v_hold_after    int;
  v_wd_after      int;
  v_negative_left int;
  v_bad_status    text;
BEGIN
  ---------------------------------------------------------------------------
  -- 0. 二重実行の防止
  ---------------------------------------------------------------------------
  IF to_regclass('public.sprint_tickets_bak_bru10078') IS NOT NULL THEN
    RAISE EXCEPTION
      'このマイグレーションは既に実行済みです（バックアップ表 sprint_tickets_bak_bru10078 が存在します）。再実行する場合は先にバックアップ表を確認・退避してください。';
  END IF;

  ---------------------------------------------------------------------------
  -- 1. 事前チェック
  ---------------------------------------------------------------------------
  -- -1 / -2 以外のマイナス値があれば、変換ルールが決められないので中止する
  IF EXISTS (SELECT 1 FROM sprint_tickets WHERE progress < 0 AND progress NOT IN (-1, -2)) THEN
    RAISE EXCEPTION '想定外のマイナス progress が存在します。手動で調査してください。';
  END IF;

  -- 新しい CHECK 制約の許可リストに無い status が既にあれば、制約追加が失敗するので先に知らせる
  SELECT string_agg(DISTINCT status, ', ') INTO v_bad_status
  FROM sprint_tickets
  WHERE status NOT IN (
    'todo','in-progress','in-review','review-done','stg-test','uat',
    'done','closed','waiting-release','released','on-hold','withdrawn'
  );
  IF v_bad_status IS NOT NULL THEN
    RAISE EXCEPTION '許可リストに無い status が存在します: %  （許可リストに追加してから再実行してください）', v_bad_status;
  END IF;

  SELECT count(*) INTO v_hold_before FROM sprint_tickets WHERE progress = -1;
  SELECT count(*) INTO v_wd_before   FROM sprint_tickets WHERE progress = -2;

  ---------------------------------------------------------------------------
  -- 2. バックアップ（切り戻し用。移行後もしばらく残すこと）
  ---------------------------------------------------------------------------
  CREATE TABLE sprint_tickets_bak_bru10078 AS
  SELECT id, status AS old_status, progress AS old_progress, now() AS backed_up_at
  FROM sprint_tickets
  WHERE progress < 0;

  ---------------------------------------------------------------------------
  -- 3. status の CHECK 制約に 'on-hold' / 'withdrawn' を追加
  --    これを先にやらないと、次の UPDATE が制約違反で失敗する
  ---------------------------------------------------------------------------
  ALTER TABLE sprint_tickets DROP CONSTRAINT IF EXISTS sprint_tickets_status_check;
  ALTER TABLE sprint_tickets ADD CONSTRAINT sprint_tickets_status_check
    CHECK (status IN (
      'todo','in-progress','in-review','review-done','stg-test','uat',
      'done','closed','waiting-release','released',
      'on-hold','withdrawn'
    ));

  ---------------------------------------------------------------------------
  -- 4. 保留データ (-1) の移行
  --    旧 status から進捗率を復元してから status を 'on-hold' に上書きする。
  --    新仕様は「解除時に progress から保留前のステータスを逆引きする」ため、
  --    CASE の値は SprintBoardView.tsx の STATUS_PROGRESS と一致させること。
  ---------------------------------------------------------------------------
  UPDATE sprint_tickets
  SET progress = CASE status
        WHEN 'in-progress'     THEN 10
        WHEN 'in-review'       THEN 30
        WHEN 'review-done'     THEN 50
        WHEN 'stg-test'        THEN 70
        WHEN 'uat'             THEN 90
        WHEN 'done'            THEN 100
        WHEN 'closed'          THEN 100
        WHEN 'waiting-release' THEN 100
        WHEN 'released'        THEN 100
        ELSE 0
      END,
      status = 'on-hold'
  WHERE progress = -1;

  ---------------------------------------------------------------------------
  -- 5. 取下データ (-2) の移行
  ---------------------------------------------------------------------------
  UPDATE sprint_tickets
  SET progress = CASE status
        WHEN 'in-progress'     THEN 10
        WHEN 'in-review'       THEN 30
        WHEN 'review-done'     THEN 50
        WHEN 'stg-test'        THEN 70
        WHEN 'uat'             THEN 90
        WHEN 'done'            THEN 100
        WHEN 'closed'          THEN 100
        WHEN 'waiting-release' THEN 100
        WHEN 'released'        THEN 100
        ELSE 0
      END,
      status = 'withdrawn'
  WHERE progress = -2;

  ---------------------------------------------------------------------------
  -- 6. 検証（1件でも合わなければ例外を投げて全部ロールバックする）
  ---------------------------------------------------------------------------
  SELECT count(*) INTO v_negative_left FROM sprint_tickets WHERE progress < 0;
  IF v_negative_left <> 0 THEN
    RAISE EXCEPTION 'マイナスの progress が % 件残っています。移行を中止しました。', v_negative_left;
  END IF;

  SELECT count(*) INTO v_hold_after FROM sprint_tickets WHERE status = 'on-hold';
  SELECT count(*) INTO v_wd_after   FROM sprint_tickets WHERE status = 'withdrawn';

  IF v_hold_after <> v_hold_before THEN
    RAISE EXCEPTION '保留の件数が一致しません（移行前 % 件 / 移行後 % 件）。移行を中止しました。', v_hold_before, v_hold_after;
  END IF;
  IF v_wd_after <> v_wd_before THEN
    RAISE EXCEPTION '取下の件数が一致しません（移行前 % 件 / 移行後 % 件）。移行を中止しました。', v_wd_before, v_wd_after;
  END IF;

  RAISE NOTICE '移行完了: 保留 % 件 / 取下 % 件', v_hold_after, v_wd_after;
END $$;

-- 実行結果の確認（この表が返ってくれば成功）
SELECT
  (SELECT count(*) FROM sprint_tickets_bak_bru10078)                  AS "バックアップ件数",
  (SELECT count(*) FROM sprint_tickets WHERE status = 'on-hold')      AS "保留(on-hold)",
  (SELECT count(*) FROM sprint_tickets WHERE status = 'withdrawn')    AS "取下(withdrawn)",
  (SELECT count(*) FROM sprint_tickets WHERE progress < 0)            AS "残マイナス(0であること)";


-- ============================================================================
-- 【切り戻しが必要になった場合】以下を実行すると実行前の状態に戻る
--
-- UPDATE sprint_tickets t
-- SET    status = b.old_status, progress = b.old_progress
-- FROM   sprint_tickets_bak_bru10078 b
-- WHERE  t.id = b.id;
--
--
-- 【後日やること】上記が問題なく安定したら、マイナス値が二度と入らないよう制約を追加する。
-- 移行と同時に実行しないこと（1件でも想定外の値があると全体が失敗するため）。
--
-- ALTER TABLE sprint_tickets ADD CONSTRAINT sprint_tickets_progress_check
--   CHECK (progress >= 0 AND progress <= 100);
-- ============================================================================
