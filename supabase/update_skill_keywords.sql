-- ENHA2-034 スキル辞書拡充（段階A強化）を既存組織に反映する。
--
-- 背景: skills.keywords は組織の初回セットアップ時に SEED_SKILLS から書き込まれ、以降は
--   ensureSkillMaster(api/ml/recommend/analyze-skills) が「既存スキルがあれば即return」で
--   二度と上書きしない。そのためコード(SEED_SKILLS)を拡充しても、既存組織のDBには反映されない。
--   このSQLで既存の skills 行の keywords を新しい辞書に合わせて上書きする。
--
-- 対応方針:
--   - (layer, name) が一致する既存行の keywords だけを更新する（新規スキル行は追加しない）。
--   - 組織を問わず全組織の該当行を更新する。
--   - src/app/lib/skills.ts / api/ml/analyze-skills.ts の SEED_SKILLS と内容を一致させること。
--
-- 実行: Supabase SQL Editor に貼り付けて実行。冪等（何度流しても同じ結果）。

with seed(layer, name, keywords) as (
  values
    ('frontend', 'React',          array['react','リアクト','jsx','tsx','コンポーネント','フック','hooks','再レンダリング']),
    ('frontend', 'Vue',            array['vue','nuxt']),
    ('frontend', 'TypeScript',     array['typescript','ts型','型定義','型エラー','型安全','ジェネリクス','interface']),
    ('frontend', 'HTML・CSS',      array['css','html','スタイル','見た目','レイアウト','tailwind','装飾','余白','フォント','中央寄せ','枠線']),
    ('frontend', 'UI実装',         array['ui','画面','フロント','表示','ボタン','モーダル','ダイアログ','一覧画面','フォーム','入力欄','プルダウン','セレクトボックス','チェックボックス','トグル','タブ','サイドバー','ヘッダー','フッター','パネル','カード','リスト表示','バッジ','トースト','ツールチップ','ドロワー','クリック','画面遷移','ページ','一覧','詳細画面']),
    ('frontend', 'レスポンシブ対応', array['レスポンシブ','スマホ対応','モバイル対応','ブレークポイント','タブレット対応','画面幅','スマホ表示']),
    ('frontend', '状態管理',       array['状態管理','redux','zustand','context','グローバルstate','ストア','状態保持']),
    ('backend',  'API設計',        array['api','エンドポイント','rest','リクエスト','レスポンス','graphql','取得処理','保存処理','サーバー処理','通信','呼び出し']),
    ('backend',  'DB設計',         array['db','テーブル','スキーマ','マイグレーション','database','カラム追加','レコード','データ削除','一括削除','物理削除','論理削除','データ保存','データ更新','リレーション','外部キー','テーブル追加','supabase']),
    ('backend',  'SQL',            array['sql','クエリ','select','join','インデックス','集計','サブクエリ','upsert','トランザクション','一括更新','一括登録']),
    ('backend',  'Node.js',        array['node','express','npm','サーバーサイド','vercel','serverless']),
    ('backend',  'Python',         array['python','django','fastapi','スクリプト']),
    ('backend',  'PHP',            array['php','laravel']),
    ('backend',  'Java',           array['java','spring']),
    ('backend',  '認証・認可',      array['認証','ログイン','権限','auth','oauth','jwt','パスワード','rls','ログアウト','サインイン','サインアップ','セッション','アクセス制御','ロール','管理者権限','生体認証','2要素']),
    ('backend',  'バッチ処理',      array['バッチ','cron','定期実行','ジョブ','夜間','スケジュール実行','自動実行','定時']),
    ('backend',  '外部連携',        array['連携','webhook','slack','外部api','サードパーティ','line','メール送信','通知連携','api連携']),
    ('infra',    'AWS',            array['aws','ec2','s3','lambda','rds']),
    ('infra',    'GCP',            array['gcp','firebase','cloud run']),
    ('infra',    'Docker',         array['docker','コンテナ','dockerfile']),
    ('infra',    'CI・CD',         array['ci','cd','デプロイ','パイプライン','github actions','リリース作業','ビルド','本番反映','デプロイ失敗']),
    ('infra',    'サーバー構築',    array['サーバー','サーバ構築','nginx','本番環境','ステージング環境','環境構築','環境変数','インフラ']),
    ('infra',    '監視・ログ',      array['監視','ログ','アラート','メトリクス','モニタリング','エラーログ','ログ出力']),
    ('infra',    'ネットワーク',    array['ネットワーク','dns','ドメイン','ssl','証明書','https','cors','リダイレクト']),
    ('infra',    'セキュリティ',    array['セキュリティ','脆弱性','csrf','xss','暗号化','サニタイズ','エスケープ','情報漏洩']),
    ('design',   'Figma',          array['figma','フィグマ','モック','ワイヤーフレーム','プロトタイプ','デザインカンプ']),
    ('design',   'UIデザイン',      array['デザイン','uiデザイン','配色','スタイリング','カラーパレット','トンマナ','ビジュアル']),
    ('design',   'UXデザイン',      array['ux','導線','ユーザビリティ','体験','使いやすさ','操作性','わかりやすさ','ユーザー体験']),
    ('qa',       'テスト設計',      array['テスト設計','テストケース','test case','観点','テスト項目']),
    ('qa',       '自動テスト',      array['自動テスト','e2e','ユニットテスト','jest','playwright','結合テスト','カバレッジ']),
    ('qa',       '動作検証',        array['動作確認','検証','テスト','qa','不具合再現','再現','バグ再現','リグレッション']),
    ('other',    '要件定義',        array['要件定義','要件','ヒアリング','仕様','仕様策定','要求']),
    ('other',    '設計',            array['設計','基本設計','詳細設計','アーキテクチャ','方式検討']),
    ('other',    'コードレビュー',   array['レビュー','リファクタ','リファクタリング','コード改善','保守性']),
    ('other',    'ドキュメント',    array['ドキュメント','wiki','手順書','マニュアル','議事録','記事','ナレッジ']),
    ('other',    '調査・分析',      array['調査','分析','原因究明','切り分け','原因調査'])
)
update skills s
set keywords = seed.keywords
from seed
where s.layer = seed.layer and s.name = seed.name;
