-- 層A（マージ前の関門）と層B（本番反映の確認）を実際に有効化する。
-- Supabase Dashboard → SQL Editor で実行してください。
--
-- 背景: add_deploy_verification.sql で仕組みは作ったが、既定値が
--   require_checks_mode = 'warn' … 警告を出すだけでマージは通る
--   deploy_check_mode   = 'off'  … 本番反映を確認しない
-- のままだったため、どちらも実際には止めていなかった。
--
-- 2026-09-01、CIが赤いPR 3件（#419 / #420 / #421）がそのままマージされ、
-- Vercel のビルドが落ちていたため本番に何も反映されず、
-- 人が手で本番を見るまで誰も気づかなかった。
-- （add_deploy_verification.sql に書かれている「11コミットが11日間滞留」と同じ事故の再発）
--
-- ★★ 実行順序が重要 ★★
-- STEP 2 の deploy_check_key = 'commit' は、build-info.json に commit が
-- 出るようになってからでないと機能しない（vite.config.ts の genCommitSha）。
-- 先に本番へデプロイし、STEP 3 は本番反映を確認してから実行すること。

-- ── STEP 1: 層A。赤いPRをマージさせない（すぐ実行してよい） ──────────────────
--
-- block にすると、失敗しているチェックがあるPRは Dev Ticket からマージできなくなる。
-- 理由を書けば通したい運用なら 'block' を 'reason' に変える。
update projects
   set require_checks_mode = 'block'
 where github_repo_full_name = 'MeeceM-Mizoguchi/dev-ticket';

-- ── STEP 2: 層B。本番に何が乗っているかを観測させる ─────────────────────────
--
-- deploy_check_url … 本番が公開しているビルド情報
-- deploy_check_key … その JSON の中でコミットSHAを持つキー
--                    ※ version は "v2026.09.01.2352" 形式でSHAではないため使えない。
--                       SHA以外を指すと state=unknown になり確認が完全に無効化される。
-- deploy_check_mode … まず warn（観測して警告・Slack通知はするが、リリース済み判定は従来どおり）
update projects
   set deploy_check_url  = 'https://dv-ticket.com/build-info.json',
       deploy_check_key  = 'commit',
       deploy_check_mode = 'warn'
 where github_repo_full_name = 'MeeceM-Mizoguchi/dev-ticket';

-- 確認: GitHub画面かリリースノート画面のバナーが「本番は最新です」になること。
--       ここで state が unknown / unreachable のまま STEP 3 に進むと、
--       リリース済みへ進めなくなって運用が止まる。
--
--   select state, deployed_sha, head_sha, message
--     from project_deploy_status
--    where project_id = (select id from projects
--                         where github_repo_full_name = 'MeeceM-Mizoguchi/dev-ticket');

-- ── STEP 3: 層C。本番へ届くまで「リリース済み」にしない ─────────────────────
--
-- ↑の確認が取れてから実行すること。
-- gate にすると、本番に反映されていないコミットのチケットはリリース済みにならない。
--
-- update projects
--    set deploy_check_mode = 'gate'
--  where github_repo_full_name = 'MeeceM-Mizoguchi/dev-ticket';

-- ── （任意）これから作るプロジェクトの既定を安全側にする ───────────────────
--
-- 既存プロジェクトには影響しない。新規作成分だけが block で始まる。
-- 他の利用組織の運用を変えることになるので、入れるかどうかは判断して実行すること。
--
-- alter table projects alter column require_checks_mode set default 'block';

-- ── （任意）全プロジェクトに一括適用 ────────────────────────────────────────
--
-- ★ 他の組織のプロジェクトも赤いPRをマージできなくなる。影響範囲を理解した上で。
--
-- update projects set require_checks_mode = 'block'
--  where github_enabled = true and require_checks_mode = 'warn';
