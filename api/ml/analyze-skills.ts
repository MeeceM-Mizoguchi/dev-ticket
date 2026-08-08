// ENHA2-034 ①スキル自動分析
//
// チケット実績から、各メンバーのスキルとレベル(1〜4)を判定して member_skills を更新する。
// これは「集計＋ルール判定」であって機械学習ではない（学習するのは ②レコメンド = ml/train.py）。
//
// 呼ばれる経路は3つ:
//   1. 初回セットアップ … 組織の ml_setup_done が false のとき、アプリから即時実行（未明を待たない）
//   2. 日次バッチ      … .github/workflows/ml-daily.yml（cron "45 16 * * *" UTC = 翌01:45 JST 狙い）
//        ※ Vercel cron ではない。LightGBM を使う②学習と直列に走らせる必要があるため
//          GitHub Actions 側に集約している。vercel.json に crons は無い。
//        ※ GitHub の schedule は best-effort。過去17回の実測で +56〜+98分（中央値+66分）
//          遅れていたため、cron 自体を約1時間前倒ししてある（着地は JST 02:41〜03:23）。
//   3. 手動            … 管理者の「今すぐ再学習」ボタン
//
// 差分検知: 前回分析以降にチケットが動いていない組織はスキップする。
//   1000組織あっても、昨日チケットが動いたのは一部だけ。ここが効いて日次でも軽い。
//   判定は sprint_tickets.updated_at（トリガで自動更新）を使う。
//   ※ 以前はマイルストーン日時の最大値で近似していたが、それだと
//     「マイルストーン日時を持たないまま closed になったチケット」や
//     「タイトル・担当者・実績工数の編集」を検知できず、再計算をサボっていた。
//
// ★ 必要スキル(ticket_required_skills)の自動付与 ★
//   ②モデル学習は「必要スキルが付いているチケット」しか学習材料にできない。
//   入力は画面からの任意なので実運用ではほぼ埋まらず（実測: 完了657件中9件）、
//   学習データが63行しか作れず MIN_TRAIN_ROWS(100) に届かないまま
//   モデルが一度も学習されない状態が続いていた。
//   メンバー集計でどのみち検出しているキーワードを、そのまま source='auto' で書く。
//   手動行があるチケットは触らない（member_skills の source 保護と同じ考え方）。

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// ★ここは src/app/lib/skills.ts の内容を「そのまま複製」したもの ★
//
// Vercel のサーバー関数(api/配下)は src/ フォルダを同梱しないため、
// src から import するとデプロイ後に ERR_MODULE_NOT_FOUND でクラッシュする。
// そのため、必要なロジックをこのファイル内に自己完結で持たせている。
//
// ⚠️ src/app/lib/skills.ts を変更したら、ここも同じ内容に合わせること。
//    （初期辞書・キーワード検出・レベル判定ルールの3点）
// ============================================================
type SkillLevel = 1 | 2 | 3 | 4;
interface SkillEvidence {
  doneCount?: number; avgHours?: number; maxHours?: number;
  reviewCount?: number; onTimeRate?: number;
}
interface SeedSkill { layer: string; name: string; keywords: string[] }
interface SkillStats {
  doneCount: number; hours: number[]; onTimeCount: number;
  reviewCount: number; largeScaleCount: number;
}

const SEED_SKILLS: SeedSkill[] = [
  { layer: "frontend", name: "React",          keywords: ["react", "リアクト", "jsx", "tsx", "コンポーネント", "フック", "hooks", "再レンダリング"] },
  { layer: "frontend", name: "Vue",            keywords: ["vue", "nuxt"] },
  { layer: "frontend", name: "TypeScript",     keywords: ["typescript", "ts型", "型定義", "型エラー", "型安全", "ジェネリクス", "interface"] },
  { layer: "frontend", name: "HTML・CSS",      keywords: ["css", "html", "スタイル", "見た目", "レイアウト", "tailwind", "装飾", "余白", "フォント", "中央寄せ", "枠線"] },
  { layer: "frontend", name: "UI実装",         keywords: ["ui", "画面", "フロント", "表示", "ボタン", "モーダル", "ダイアログ", "一覧画面", "フォーム", "入力欄", "プルダウン", "セレクトボックス", "チェックボックス", "トグル", "タブ", "サイドバー", "ヘッダー", "フッター", "パネル", "カード", "リスト表示", "バッジ", "トースト", "ツールチップ", "ドロワー", "クリック", "画面遷移", "ページ", "一覧", "詳細画面"] },
  { layer: "frontend", name: "レスポンシブ対応", keywords: ["レスポンシブ", "スマホ対応", "モバイル対応", "ブレークポイント", "タブレット対応", "画面幅", "スマホ表示"] },
  { layer: "frontend", name: "状態管理",       keywords: ["状態管理", "redux", "zustand", "context", "グローバルstate", "ストア", "状態保持"] },
  { layer: "backend", name: "API設計",         keywords: ["api", "エンドポイント", "rest", "リクエスト", "レスポンス", "graphql", "取得処理", "保存処理", "サーバー処理", "通信", "呼び出し"] },
  { layer: "backend", name: "DB設計",          keywords: ["db", "テーブル", "スキーマ", "マイグレーション", "database", "カラム追加", "レコード", "データ削除", "一括削除", "物理削除", "論理削除", "データ保存", "データ更新", "リレーション", "外部キー", "テーブル追加", "supabase"] },
  { layer: "backend", name: "SQL",             keywords: ["sql", "クエリ", "select", "join", "インデックス", "集計", "サブクエリ", "upsert", "トランザクション", "一括更新", "一括登録"] },
  { layer: "backend", name: "Node.js",         keywords: ["node", "express", "npm", "サーバーサイド", "vercel", "serverless"] },
  { layer: "backend", name: "Python",          keywords: ["python", "django", "fastapi", "スクリプト"] },
  { layer: "backend", name: "PHP",             keywords: ["php", "laravel"] },
  { layer: "backend", name: "Java",            keywords: ["java", "spring"] },
  { layer: "backend", name: "認証・認可",       keywords: ["認証", "ログイン", "権限", "auth", "oauth", "jwt", "パスワード", "rls", "ログアウト", "サインイン", "サインアップ", "セッション", "アクセス制御", "ロール", "管理者権限", "生体認証", "2要素"] },
  { layer: "backend", name: "バッチ処理",       keywords: ["バッチ", "cron", "定期実行", "ジョブ", "夜間", "スケジュール実行", "自動実行", "定時"] },
  { layer: "backend", name: "外部連携",         keywords: ["連携", "webhook", "slack", "外部api", "サードパーティ", "line", "メール送信", "通知連携", "api連携"] },
  { layer: "infra", name: "AWS",               keywords: ["aws", "ec2", "s3", "lambda", "rds"] },
  { layer: "infra", name: "GCP",               keywords: ["gcp", "firebase", "cloud run"] },
  { layer: "infra", name: "Docker",            keywords: ["docker", "コンテナ", "dockerfile"] },
  { layer: "infra", name: "CI・CD",            keywords: ["ci", "cd", "デプロイ", "パイプライン", "github actions", "リリース作業", "ビルド", "本番反映", "デプロイ失敗"] },
  { layer: "infra", name: "サーバー構築",       keywords: ["サーバー", "サーバ構築", "nginx", "本番環境", "ステージング環境", "環境構築", "環境変数", "インフラ"] },
  { layer: "infra", name: "監視・ログ",         keywords: ["監視", "ログ", "アラート", "メトリクス", "モニタリング", "エラーログ", "ログ出力"] },
  { layer: "infra", name: "ネットワーク",       keywords: ["ネットワーク", "dns", "ドメイン", "ssl", "証明書", "https", "cors", "リダイレクト"] },
  { layer: "infra", name: "セキュリティ",       keywords: ["セキュリティ", "脆弱性", "csrf", "xss", "暗号化", "サニタイズ", "エスケープ", "情報漏洩"] },
  { layer: "design", name: "Figma",            keywords: ["figma", "フィグマ", "モック", "ワイヤーフレーム", "プロトタイプ", "デザインカンプ"] },
  { layer: "design", name: "UIデザイン",       keywords: ["デザイン", "uiデザイン", "配色", "スタイリング", "カラーパレット", "トンマナ", "ビジュアル"] },
  { layer: "design", name: "UXデザイン",       keywords: ["ux", "導線", "ユーザビリティ", "体験", "使いやすさ", "操作性", "わかりやすさ", "ユーザー体験"] },
  { layer: "qa", name: "テスト設計",           keywords: ["テスト設計", "テストケース", "test case", "観点", "テスト項目"] },
  { layer: "qa", name: "自動テスト",           keywords: ["自動テスト", "e2e", "ユニットテスト", "jest", "playwright", "結合テスト", "カバレッジ"] },
  { layer: "qa", name: "動作検証",             keywords: ["動作確認", "検証", "テスト", "qa", "不具合再現", "再現", "バグ再現", "リグレッション"] },
  { layer: "other", name: "要件定義",          keywords: ["要件定義", "要件", "ヒアリング", "仕様", "仕様策定", "要求"] },
  { layer: "other", name: "設計",              keywords: ["設計", "基本設計", "詳細設計", "アーキテクチャ", "方式検討"] },
  { layer: "other", name: "コードレビュー",     keywords: ["レビュー", "リファクタ", "リファクタリング", "コード改善", "保守性"] },
  { layer: "other", name: "ドキュメント",       keywords: ["ドキュメント", "wiki", "手順書", "マニュアル", "議事録", "記事", "ナレッジ"] },
  { layer: "other", name: "調査・分析",         keywords: ["調査", "分析", "原因究明", "切り分け", "原因調査"] },
];

// 半角英数字のみの短い英語語（"ui" "ci" "db" 等）は別の英単語の一部へ紛れて誤爆しやすいので、
// 前後が英数字でない語境界でのみ一致させる。日本語・空白入りの語は従来どおり部分一致。
const ASCII_TERM = /^[a-z0-9.+#]+$/;
function termMatches(haystack: string, term: string): boolean {
  if (!ASCII_TERM.test(term)) return haystack.includes(term);
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(haystack);
}

function detectSkillKeywords(
  text: string,
  skills: { id: string; name: string; keywords: string[] }[],
): string[] {
  const haystack = text.toLowerCase();
  const hit: string[] = [];
  for (const s of skills) {
    const terms = [s.name, ...s.keywords].map(t => t.toLowerCase()).filter(Boolean);
    if (terms.some(t => termMatches(haystack, t))) hit.push(s.id);
  }
  return hit;
}

function ticketSearchText(t: {
  title?: string; description?: string; prefixes?: string[]; categoryName?: string;
}): string {
  return [t.title ?? "", t.description ?? "", ...(t.prefixes ?? []), t.categoryName ?? ""].join(" ");
}

const STABLE_MIN = 3;
const LV1_MAX_HOURS = 0.5;
const LV2_MAX_HOURS = 3;

function inferSkillLevel(stats: SkillStats): { level: SkillLevel; evidence: SkillEvidence } | null {
  if (stats.doneCount === 0) return null;

  const hours = stats.hours.filter(h => h > 0).sort((a, b) => a - b);
  const avgHours = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0;
  const onTimeRate = stats.doneCount > 0 ? stats.onTimeCount / stats.doneCount : 0;
  const stableMaxHours = hours.length
    ? hours[Math.max(0, Math.floor(hours.length * 0.75) - 1)] ?? hours[hours.length - 1]
    : 0;

  const evidence: SkillEvidence = {
    doneCount: stats.doneCount,
    avgHours: Math.round(avgHours * 10) / 10,
    maxHours: Math.round(stableMaxHours * 10) / 10,
    reviewCount: stats.reviewCount,
    onTimeRate: Math.round(onTimeRate * 100) / 100,
  };

  if (stats.reviewCount >= STABLE_MIN && (stats.largeScaleCount >= 1 || stableMaxHours > LV2_MAX_HOURS)) {
    return { level: 4, evidence };
  }
  const overLv2 = hours.filter(h => h > LV2_MAX_HOURS).length;
  if (overLv2 >= STABLE_MIN || stats.largeScaleCount >= STABLE_MIN) {
    return { level: 3, evidence };
  }
  const inLv2 = hours.filter(h => h > LV1_MAX_HOURS && h <= LV2_MAX_HOURS).length;
  if (inLv2 >= STABLE_MIN || stableMaxHours > LV1_MAX_HOURS) {
    return { level: 2, evidence };
  }
  return { level: 1, evidence };
}
// ============================================================
// 複製ここまで
// ============================================================

// 完了とみなすステータス（実績として数える）
const DONE_STATUSES = ["done", "closed", "released", "waiting-release"];

// 学習・分析に使う期間。古すぎる実績は今のスキルを反映しないうえ、
// データ量が無限に膨らむのを防ぐ意味もある。
const LOOKBACK_MONTHS = 18;

interface TicketRow {
  id: string;
  title: string | null;
  description: string | null;
  prefixes: string[] | null;
  status: string;
  assignee: string | null;
  reviewer_name: string | null;
  due_date: string | null;
  dev_scale: string | null;
  estimated_hours: number | null;
  actual_work_hours: number | null;
  started_at: string | null;
  released_at: string | null;
  uat_completed_at: string | null;
  stg_completed_at: string | null;
  review_approved_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** 1回のリクエストで返る行数には上限があるので、必ず分割して全件取る。 */
const PAGE = 1000;
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ rows: T[]; error?: string }> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) return { rows, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) return { rows };
  }
}

/** id の配列を where in で使うときの分割単位（URLが長くなりすぎるのを防ぐ） */
const IN_CHUNK = 200;
function chunk<T>(xs: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/**
 * チケットの「最終活動日時」。差分検知に使う。
 *
 * updated_at（トリガで自動更新）があればそれが最も正確。
 * 移行直後などで null の行だけ、従来どおり作成日時とマイルストーン日時の最大値で近似する。
 */
function lastActivityMs(t: TicketRow): number {
  if (t.updated_at) return new Date(t.updated_at).getTime();
  const ts = [t.created_at, t.started_at, t.review_approved_at, t.stg_completed_at, t.uat_completed_at, t.released_at]
    .map(x => (x ? new Date(x).getTime() : 0));
  return Math.max(0, ...ts);
}

/** チケット1件の実績工数（h）。手入力があればそれを優先し、無ければマイルストーン差分で概算する。 */
function ticketActualHours(t: TicketRow): number {
  if (t.actual_work_hours && t.actual_work_hours > 0) return t.actual_work_hours;
  const start = t.started_at;
  const end = t.review_approved_at || t.stg_completed_at || t.uat_completed_at || t.released_at;
  if (!start || !end) return t.estimated_hours ?? 0;
  const h = (new Date(end).getTime() - new Date(start).getTime()) / 36e5;
  return h > 0 ? h : (t.estimated_hours ?? 0);
}

// 納期は「その日のうち(JST)に終わっていればセーフ」で判定する。
// ★ml/features.py の ON_TIME_GRACE_DAYS / due_deadline() / is_on_time() と同じ定義にすること★
//   ここで出す納期遵守率はスキルのレベル判定に効き、
//   ②モデル学習(features.py)は同じ定義で正解ラベルを作っている。
const ON_TIME_GRACE_DAYS = 0;

/** due_date(日付) → これを過ぎたら遅延、という時刻。due_date は JST の暦日として扱う */
function dueDeadline(due: string | null): number | null {
  if (!due) return null;
  const start = Date.parse(`${due.slice(0, 10)}T00:00:00+09:00`);
  if (Number.isNaN(start)) return null;
  return start + (1 + ON_TIME_GRACE_DAYS) * 24 * 36e5;
}

/** 納期内に終わったか */
function isOnTime(t: TicketRow): boolean {
  const deadline = dueDeadline(t.due_date);
  if (deadline === null) return true;   // 期限が無いものは減点しない
  const end = t.released_at || t.uat_completed_at || t.stg_completed_at || t.review_approved_at;
  if (!end) return true;
  return new Date(end).getTime() < deadline;
}

/**
 * 組織のスキルマスタを用意する。
 * 初期辞書(SEED_SKILLS)で過去チケットを走査し、実際にヒットしたスキルだけを登録する。
 * （辞書80個をそのまま入れると、使っていない技術まで並んで邪魔になる）
 */
async function ensureSkillMaster(sb: SupabaseClient, orgId: string, tickets: TicketRow[], debug: Record<string, unknown>) {
  const { data: existing, error: exErr } = await sb.from("skills").select("id, name, layer, keywords").eq("organization_id", orgId);
  if (exErr) debug.skillsSelectError = exErr.message;
  if (existing && existing.length > 0) return existing;

  const corpus = tickets.map(t => ticketSearchText({
    title: t.title ?? "", description: t.description ?? "", prefixes: t.prefixes ?? [],
  })).join(" ").toLowerCase();

  const hits = SEED_SKILLS.filter(s =>
    [s.name, ...s.keywords].some(term => corpus.includes(term.toLowerCase()))
  );

  // 1件もヒットしない（＝実績が少ない/命名が独特）組織にも、最低限の器は用意しておく。
  // 手動でスキルを追加できる状態にしておくため。
  const toInsert = (hits.length > 0 ? hits : SEED_SKILLS.slice(0, 12)).map((s, i) => ({
    organization_id: orgId, layer: s.layer, name: s.name, keywords: s.keywords, sort_order: i,
  }));
  debug.toInsertCount = toInsert.length;

  const { error: upErr } = await sb.from("skills").upsert(toInsert, { onConflict: "organization_id,layer,name" });
  if (upErr) debug.skillsUpsertError = upErr.message;   // ← 握りつぶさず記録

  const { data, error: selErr } = await sb.from("skills").select("id, name, layer, keywords").eq("organization_id", orgId);
  if (selErr) debug.skillsSelect2Error = selErr.message;
  return data ?? [];
}

type SkillRow = { id: string; name: string; keywords: string[] };

/**
 * 完了チケットに「必要スキル」を自動付与する（②モデル学習の材料づくり）。
 *
 * ★ここが無いと②は永久に学習できない★
 *   build_dataset は必要スキルの付いていないチケットを丸ごと捨てる。
 *   画面からの入力は任意なので実運用では埋まらず、学習データが常に不足していた。
 *
 * ルール:
 *   ・手動行(source='manual')が1件でもあるチケットは一切触らない
 *   ・タイトルで当たったスキルは importance=3(必須)、説明/プレフィクスだけなら 2(推奨)
 *   ・検出されなくなった自動行は消す（タイトルを直したら追従させるため）
 */
async function syncRequiredSkills(
  sb: SupabaseClient,
  tickets: TicketRow[],
  skills: SkillRow[],
  debug: Record<string, unknown>,
): Promise<number> {
  const doneTickets = tickets.filter(t => DONE_STATUSES.includes(t.status));
  if (doneTickets.length === 0 || skills.length === 0) return 0;

  const ticketIds = doneTickets.map(t => t.id);

  // 既存の付与状況を読む。
  // ★必ず全件取る★ 1チケットに複数スキルが付くので行数は簡単に上限を超える。
  //   ここが切れると手動行(source='manual')を見落とし、人が設定した必要スキルを
  //   自動判定で上書きしてしまう。
  type ReqRow = { ticket_id: string; skill_id: string; importance: number; source: string };
  const existing: ReqRow[] = [];
  for (const ids of chunk(ticketIds)) {
    const { rows, error } = await fetchAllPages<ReqRow>((from, to) =>
      sb.from("ticket_required_skills")
        .select("ticket_id, skill_id, importance, source")
        .in("ticket_id", ids)
        .order("ticket_id").order("skill_id")
        .range(from, to));
    if (error) { debug.requiredSelectError = error; return 0; }
    existing.push(...rows);
  }

  const manualTickets = new Set(existing.filter(r => r.source === "manual").map(r => r.ticket_id));
  const autoNow = new Map<string, Map<string, number>>();   // ticketId -> skillId -> importance
  for (const r of existing) {
    if (r.source !== "auto") continue;
    if (!autoNow.has(r.ticket_id)) autoNow.set(r.ticket_id, new Map());
    autoNow.get(r.ticket_id)!.set(r.skill_id, r.importance);
  }

  const toUpsert: { ticket_id: string; skill_id: string; importance: number; source: string }[] = [];
  const toDelete: { ticketId: string; skillIds: string[] }[] = [];

  for (const t of doneTickets) {
    if (manualTickets.has(t.id)) continue;   // 人が設定したチケットは自動判定の対象外

    // タイトル一致は「そのチケットの主題」とみなして必須(3)、それ以外は推奨(2)。
    const titleHits = new Set(detectSkillKeywords(t.title ?? "", skills));
    const allHits = detectSkillKeywords(
      ticketSearchText({ title: t.title ?? "", description: t.description ?? "", prefixes: t.prefixes ?? [] }),
      skills,
    );

    const desired = new Map<string, number>();
    for (const sid of allHits) desired.set(sid, titleHits.has(sid) ? 3 : 2);

    const current = autoNow.get(t.id) ?? new Map<string, number>();

    for (const [sid, imp] of desired) {
      if (current.get(sid) !== imp) {
        toUpsert.push({ ticket_id: t.id, skill_id: sid, importance: imp, source: "auto" });
      }
    }
    const gone = [...current.keys()].filter(sid => !desired.has(sid));
    if (gone.length > 0) toDelete.push({ ticketId: t.id, skillIds: gone });
  }

  for (const rows of chunk(toUpsert, 500)) {
    const { error } = await sb
      .from("ticket_required_skills")
      .upsert(rows, { onConflict: "ticket_id,skill_id" });
    if (error) debug.requiredUpsertError = error.message;
  }
  for (const d of toDelete) {
    const { error } = await sb
      .from("ticket_required_skills")
      .delete()
      .eq("ticket_id", d.ticketId)
      .eq("source", "auto")
      .in("skill_id", d.skillIds);
    if (error) debug.requiredDeleteError = error.message;
  }

  debug.requiredUpserted = toUpsert.length;
  debug.requiredDeleted = toDelete.reduce((a, d) => a + d.skillIds.length, 0);
  debug.requiredManualTickets = manualTickets.size;
  return toUpsert.length;
}

/**
 * BRU10-062 メンバー1人ぶんの実行ログ（ml_batch_member_runs の1行）。
 *
 * 変更履歴は「変わったときだけ」残るので、
 *   ・対象だったが変更が無かった
 *   ・そもそも対象外だった（自動更新OFF）
 * を区別できない。個人単位でも "実行のたびに必ず1行" 残すのがこれ。
 */
interface MemberBatchLog {
  profileId: string;
  status: "updated" | "unchanged" | "excluded";
  changedCount: number;
  evaluatedSkills: number;
  matchedTickets: number;
  protectedSkills: number;
  reason: string | null;
  detail: {
    changes: { skill: string; changeType: string; oldLevel: number | null; newLevel: number }[];
  };
}

interface AnalyzeResult {
  orgId: string;
  skipped: boolean;
  /** 自動更新の対象メンバー数 */
  members: number;
  /** 実際にスキルが変わったメンバー数（学習ログのサマリに出す） */
  changedMembers?: number;
  skillsWritten: number;
  requiredWritten?: number;
  skillRunId?: string | null;
  reason?: string;
  error?: string;
  debug?: Record<string, unknown>;
  /**
   * メンバー個別のログ。
   * ★組織ごとスキップした晩は付けない★ 1000組織×30人を毎晩書くと年1000万行規模になる。
   *   スキップ理由は組織の行(ml_batch_runs)が持っているので、画面はそちらを見ればよい。
   */
  memberLogs?: MemberBatchLog[];
}

/** 1組織を分析する */
async function analyzeOrg(sb: SupabaseClient, orgId: string, force: boolean): Promise<AnalyzeResult> {
  // どこで・なぜ止まったかを必ず返す（握りつぶさない）
  const debug: Record<string, unknown> = {};

  const { data: org, error: orgErr } = await sb
    .from("organizations")
    .select("id, ml_last_analyzed_at")
    .eq("id", orgId)
    .maybeSingle();
  if (orgErr) debug.orgError = orgErr.message;

  // 「変更が無かった」場合でも、チェックしたこと自体は必ず残す。
  // これが無いと「バッチが動かなかった」のか「動いたが変更が無かった」のか区別できない。
  const markChecked = async () => {
    await sb.from("organizations").update({ ml_last_checked_at: new Date().toISOString() }).eq("id", orgId);
  };

  const since = new Date(Date.now() - LOOKBACK_MONTHS * 30 * 864e5).toISOString();

  // 対象チケット（この組織のプロジェクト配下、直近LOOKBACK_MONTHS）
  const { data: projects, error: projErr } = await sb.from("projects").select("id").eq("organization_id", orgId);
  if (projErr) debug.projectsError = projErr.message;
  const projectIds = (projects ?? []).map(p => p.id);
  debug.projectCount = projectIds.length;
  if (projectIds.length === 0) { await markChecked(); return { orgId, skipped: true, members: 0, skillsWritten: 0, reason: "プロジェクトがまだありません", debug }; }

  const sprintIds: string[] = [];
  for (const ids of chunk(projectIds)) {
    const { data, error } = await sb.from("sprints").select("id").in("project_id", ids);
    if (error) debug.sprintsError = error.message;
    sprintIds.push(...(data ?? []).map(s => s.id));
  }
  debug.sprintCount = sprintIds.length;
  if (sprintIds.length === 0) { await markChecked(); return { orgId, skipped: true, members: 0, skillsWritten: 0, reason: "スプリントがまだありません", debug }; }

  // ★ 全件取る ★ 1回のリクエストで返る行数には上限があるため、分割して読む。
  //   ここで静かに切れると、欠けたチケットで判定して誤ったスキルを書いてしまう。
  const tickets: TicketRow[] = [];
  for (const ids of chunk(sprintIds)) {
    const { rows, error } = await fetchAllPages<TicketRow>((from, to) =>
      sb.from("sprint_tickets")
        .select("id, title, description, prefixes, status, assignee, reviewer_name, due_date, dev_scale, estimated_hours, actual_work_hours, started_at, released_at, uat_completed_at, stg_completed_at, review_approved_at, created_at, updated_at")
        .in("sprint_id", ids)
        .gte("created_at", since)
        .order("id")
        .range(from, to));
    if (error) debug.ticketsError = error;
    tickets.push(...rows);
  }
  debug.ticketCount = tickets.length;
  if (tickets.length === 0) { await markChecked(); return { orgId, skipped: true, members: 0, skillsWritten: 0, reason: "対象チケットがありません", debug }; }

  // ── 差分検知 ──
  // 前回分析以降にチケットが1件も動いていなければ、分析するだけ無駄なのでスキップする。
  const lastAnalyzed = org?.ml_last_analyzed_at ? new Date(org.ml_last_analyzed_at).getTime() : 0;
  if (!force && lastAnalyzed > 0) {
    const changed = tickets.some(t => lastActivityMs(t) > lastAnalyzed);
    if (!changed) { await markChecked(); return { orgId, skipped: true, members: 0, skillsWritten: 0, reason: "前回から変更がありません", debug }; }
  }

  const skills = await ensureSkillMaster(sb, orgId, tickets, debug);
  debug.skillMasterCount = skills.length;
  if (skills.length === 0) { await markChecked(); return { orgId, skipped: true, members: 0, skillsWritten: 0, reason: "スキルマスタが空です", debug }; }

  // ── ②モデル学習の材料づくり ──
  // メンバー集計より先に走らせる。ここが埋まらないと②は永久に学習できない。
  const requiredWritten = await syncRequiredSkills(sb, tickets, skills as SkillRow[], debug);

  // ── メンバー ──
  // ★ skill_auto_update が ON のメンバーだけがスキル自動更新の対象。
  //   OFF のメンバーは手動で設定した値を守る（ただしレコメンドの対象からは外さない）。
  //   招待中(invited)など在籍していないメンバーは対象外にする。
  const { data: profiles, error: profErr } = await sb
    .from("profiles")
    .select("id, name, status, skill_auto_update")
    .eq("organization_id", orgId);
  if (profErr) debug.profilesError = profErr.message;

  const activeMembers = (profiles ?? []).filter(p => p.status === "active");
  const autoMembers = activeMembers.filter(p => p.skill_auto_update !== false);
  debug.autoMemberCount = autoMembers.length;

  // 自動更新OFFのメンバーも「対象外だった」と個人ログに残す。
  // 何も残さないと「バッチが動かなかった」のか「意図的に外していた」のか区別できない。
  const excludedLogs: MemberBatchLog[] = activeMembers
    .filter(p => p.skill_auto_update === false)
    .map(p => ({
      profileId: p.id, status: "excluded" as const,
      changedCount: 0, evaluatedSkills: 0, matchedTickets: 0, protectedSkills: 0,
      reason: "スキル自動更新がOFFです", detail: { changes: [] },
    }));

  if (autoMembers.length === 0) {
    const ts = new Date().toISOString();
    await sb.from("organizations")
      .update({ ml_setup_done: true, ml_last_analyzed_at: ts, ml_last_checked_at: ts })
      .eq("id", orgId);
    return {
      orgId, skipped: false, members: 0, skillsWritten: 0, requiredWritten,
      reason: "自動更新の対象メンバーがいません", debug, memberLogs: excludedLogs,
    };
  }

  // assignee は名前の文字列（UUIDではない）ので、名前 → profile の名寄せをする。
  const byName = new Map<string, { id: string; name: string }>();
  for (const p of autoMembers) if (p.name) byName.set(p.name, { id: p.id, name: p.name });

  // ── メンバー×スキルの実績を集計 ──
  const stats = new Map<string, SkillStats>();   // key: `${profileId}::${skillId}`
  const keyOf = (pid: string, sid: string) => `${pid}::${sid}`;
  const bump = (pid: string, sid: string, fn: (s: SkillStats) => void) => {
    const k = keyOf(pid, sid);
    if (!stats.has(k)) stats.set(k, { doneCount: 0, hours: [], onTimeCount: 0, reviewCount: 0, largeScaleCount: 0 });
    fn(stats.get(k)!);
  };
  // 個人ログ用。「判定材料が何件あったか」が分かると、変更が無かった理由
  //（実績が少ないのか、実績はあるが判定が同じなのか）を後から説明できる。
  const ticketsByMember = new Map<string, Set<string>>();
  const touchTicket = (pid: string, tid: string) => {
    if (!ticketsByMember.has(pid)) ticketsByMember.set(pid, new Set());
    ticketsByMember.get(pid)!.add(tid);
  };

  for (const t of tickets) {
    if (!DONE_STATUSES.includes(t.status)) continue;

    const skillIds = detectSkillKeywords(
      ticketSearchText({ title: t.title ?? "", description: t.description ?? "", prefixes: t.prefixes ?? [] }),
      skills as { id: string; name: string; keywords: string[] }[],
    );
    if (skillIds.length === 0) continue;

    const hours = ticketActualHours(t);
    const onTime = isOnTime(t);
    const isLarge = t.dev_scale === "L" || t.dev_scale === "XL";

    // 担当者としての実績
    const assignee = t.assignee ? byName.get(t.assignee) : undefined;
    if (assignee) {
      touchTicket(assignee.id, t.id);
      for (const sid of skillIds) {
        bump(assignee.id, sid, s => {
          s.doneCount++;
          if (hours > 0) s.hours.push(hours);
          if (onTime) s.onTimeCount++;
          if (isLarge) s.largeScaleCount++;
        });
      }
    }

    // レビュアーとしての実績 ← Lv4(リーダークラス)判定の決め手。
    // 「他人のチケットをレビュー・承認する側にいる」は既存DBにある強力なシグナル。
    const reviewer = t.reviewer_name ? byName.get(t.reviewer_name) : undefined;
    if (reviewer && t.review_approved_at && reviewer.id !== assignee?.id) {
      touchTicket(reviewer.id, t.id);
      for (const sid of skillIds) bump(reviewer.id, sid, s => { s.reviewCount++; });
    }
  }

  // ── レベル判定 → member_skills へ書き込み ──
  //
  // ★ 現在値を読んでから「実際に変わった行だけ」書く ★
  //   以前は判定結果を全件そのまま upsert し、updated_at に毎回 now を書いていた。
  //   そのため (a) 変わっていない行にも書き込みが走り (b) updated_at が
  //   「最後に変わった日」として使えず (c) 履歴を採ると毎晩「全件変更」になって読めない。
  //   差分を取ることでこの3つが同時に解決する。
  //
  // source='manual'（人が設定した）行は上書きしない。自動判定が人の意思を潰さないため。
  const existingRows: { profile_id: string; skill_id: string; level: number; source: string }[] = [];
  for (const ids of chunk(autoMembers.map(m => m.id))) {
    const { data, error } = await sb
      .from("member_skills")
      .select("profile_id, skill_id, level, source")
      .in("profile_id", ids);
    if (error) debug.memberSkillsSelectError = error.message;
    existingRows.push(...(data ?? []));
  }

  const existing = new Map<string, { level: number; source: string }>();
  for (const r of existingRows) {
    existing.set(keyOf(r.profile_id, r.skill_id), { level: r.level, source: r.source });
  }

  const rows: {
    profile_id: string; skill_id: string; level: number; source: string;
    evidence: unknown; updated_at: string;
  }[] = [];
  // 履歴に残す変更（run_id は run を作ってから埋める）
  const changes: {
    organization_id: string; profile_id: string; skill_id: string; change_type: string;
    old_level: number | null; new_level: number; old_source: string | null; new_source: string;
    evidence: unknown; changed_at: string;
  }[] = [];
  const now = new Date().toISOString();

  // 個人ログ用: 判定材料の組数と、手動設定のため見送った数をメンバーごとに数える
  const evaluatedByMember = new Map<string, number>();
  const protectedByMember = new Map<string, number>();
  const countUp = (m: Map<string, number>, pid: string) => m.set(pid, (m.get(pid) ?? 0) + 1);

  for (const [k, s] of stats) {
    const prev = existing.get(k);
    const [pid] = k.split("::");
    countUp(evaluatedByMember, pid);
    if (prev?.source === "manual") { countUp(protectedByMember, pid); continue; }   // 人が設定した行は触らない
    const [profileId, skillId] = k.split("::");
    const inferred = inferSkillLevel(s);
    if (!inferred) continue;

    // 値が変わらないなら書かない（無駄な書き込みと、無意味な履歴を作らない）
    if (prev && prev.level === inferred.level) continue;

    rows.push({
      profile_id: profileId, skill_id: skillId,
      level: inferred.level, source: "auto",
      evidence: inferred.evidence, updated_at: now,
    });
    changes.push({
      organization_id: orgId, profile_id: profileId, skill_id: skillId,
      change_type: prev ? "level_changed" : "added",
      old_level: prev ? prev.level : null, new_level: inferred.level,
      old_source: prev ? prev.source : null, new_source: "auto",
      evidence: inferred.evidence, changed_at: now,
    });
  }

  debug.matchedPairs = stats.size;   // チケット文章からスキル検出できた(メンバー×スキル)の数
  debug.candidateRows = rows.length;
  let skillRunId: string | null = null;
  if (rows.length > 0) {
    const { error: msErr } = await sb.from("member_skills").upsert(rows, { onConflict: "profile_id,skill_id" });
    if (msErr) debug.memberSkillsUpsertError = msErr.message;

    // ── BRU9-041 履歴を残す ──
    // 失敗しても分析そのものは成立させる（履歴が欠けるだけ）。
    try {
      const added = changes.filter(c => c.change_type === "added").length;
      const { data: run, error: runErr } = await sb
        .from("skill_update_runs")
        .insert({
          organization_id: orgId, kind: "auto", created_at: now,
          summary: { added, updated: changes.length - added, removed: 0, members: new Set(changes.map(c => c.profile_id)).size },
        })
        .select("id").maybeSingle();
      if (runErr) debug.runInsertError = runErr.message;

      if (run?.id) {
        skillRunId = run.id;
        const { error: chErr } = await sb
          .from("member_skill_changes")
          .insert(changes.map(c => ({ ...c, run_id: run.id })));
        if (chErr) debug.changesInsertError = chErr.message;
      }
    } catch (e) {
      debug.historyError = String(e);
    }
  }

  await sb.from("organizations")
    .update({ ml_setup_done: true, ml_last_analyzed_at: now, ml_last_checked_at: now })
    .eq("id", orgId);

  // ── BRU10-062 メンバー個別の実行ログ ──
  // 対象メンバー全員ぶんを、変更が無くても必ず1行作る。
  // スキル名を埋め込んで持たせるので、表示側は skills を引き直さなくてよい
  // （スキルが後から削除・改名されても、当時の記録がそのまま残る）。
  const skillNameById = new Map((skills as SkillRow[]).map(s => [s.id, s.name]));
  const changesByMember = new Map<string, typeof changes>();
  for (const c of changes) {
    if (!changesByMember.has(c.profile_id)) changesByMember.set(c.profile_id, []);
    changesByMember.get(c.profile_id)!.push(c);
  }

  const memberLogs: MemberBatchLog[] = [
    ...autoMembers.map(m => {
      const mine = changesByMember.get(m.id) ?? [];
      const evaluated = evaluatedByMember.get(m.id) ?? 0;
      const matched = ticketsByMember.get(m.id)?.size ?? 0;
      return {
        profileId: m.id,
        status: (mine.length > 0 ? "updated" : "unchanged") as MemberBatchLog["status"],
        changedCount: mine.length,
        evaluatedSkills: evaluated,
        matchedTickets: matched,
        protectedSkills: protectedByMember.get(m.id) ?? 0,
        // 「変更なし」のとき、なぜ変わらなかったのかを一言で残す
        reason: mine.length > 0 ? null
          : matched === 0 ? "判定に使えるチケットがありませんでした"
          : "判定結果が前回と同じでした",
        detail: {
          changes: mine.map(c => ({
            skill: skillNameById.get(c.skill_id) ?? "（削除済み）",
            changeType: c.change_type,
            oldLevel: c.old_level,
            newLevel: c.new_level,
          })),
        },
      };
    }),
    ...excludedLogs,
  ];

  return {
    orgId, skipped: false, members: autoMembers.length,
    changedMembers: new Set(changes.map(c => c.profile_id)).size,
    skillsWritten: rows.length, requiredWritten, skillRunId,
    debug, memberLogs,
  };
}

// ============================================================
// 学習ログ（ml_batch_runs）
//
// ★①と②を1行にまとめる★
//   ①はここ(TypeScript/Vercel)、②は ml/train.py(Python/GitHub Actions) と
//   別プロセスなので、GitHub Actions の run_id を batch_id にして同じ行を更新する。
//   ②が走らない経路（アプリからの手動実行）では、ここで行を完結させる。
// ============================================================

/** アプリからの手動実行など、②が続かない場合の総合判定 */
function analyzeOnlyResult(r: AnalyzeResult): { result: string; summary: string } {
  if (r.error) return { result: "failed", summary: r.error };
  if (r.skillsWritten > 0) {
    return { result: "completed", summary: `スキル修正あり（${r.changedMembers ?? 0}名・${r.skillsWritten}件）` };
  }
  if (r.skipped) return { result: "not_run", summary: r.reason ?? "変更がないためスキップしました" };
  return { result: "completed", summary: "スキル修正なし" };
}

async function recordAnalyzePhase(
  sb: SupabaseClient,
  batchId: string,
  trigger: string,
  r: AnalyzeResult,
  finalize: boolean,
): Promise<void> {
  const analyze = {
    status: r.error ? "failed" : r.skipped ? "skipped" : "done",
    changed: r.skillsWritten,
    changedMembers: r.changedMembers ?? 0,
    members: r.members,
    requiredWritten: r.requiredWritten ?? 0,
    reason: r.reason ?? null,
    error: r.error ?? null,
    debug: r.debug ?? {},
  };

  const row: Record<string, unknown> = {
    organization_id: r.orgId,
    batch_id: batchId,
    trigger,
    started_at: new Date().toISOString(),
    detail: { analyze },
    skill_run_id: r.skillRunId ?? null,
  };

  // ②が続かない経路ではここで確定させる（finished_at を残さないと「異常終了」に見えるため）
  if (finalize) {
    const { result, summary } = analyzeOnlyResult(r);
    row.finished_at = new Date().toISOString();
    row.result = result;
    row.summary = summary;
    row.detail = { analyze, train: { status: "skipped", reason: "スキル分析のみ実行（モデル学習は夜間バッチで行います）" } };
  }

  // 学習ログの記録に失敗しても分析そのものは成立させる（ログが欠けるだけ）
  const { error } = await sb.from("ml_batch_runs").upsert(row, { onConflict: "organization_id,batch_id" });
  if (error && r.debug) r.debug.batchLogError = error.message;

  // ── BRU10-062 メンバー個別のログ ──
  //
  // ★組織ごとスキップした晩は memberLogs が付かない＝ここは書かない★
  //   スキップ理由は上の組織行が持っている。全組織×全メンバーを毎晩書くと
  //   年1000万行規模になり、履歴機能がスナップショット方式を捨てたのと同じ理由で破綻する。
  //
  // 1組織ぶんをまとめて1クエリ。②モデル学習の再実行で同じ batch_id が来ても
  // 二重にならないよう upsert にしてある。
  if (r.memberLogs && r.memberLogs.length > 0) {
    const startedAt = String(row.started_at);
    const memberRows = r.memberLogs.map(m => ({
      organization_id: r.orgId,
      batch_id: batchId,
      profile_id: m.profileId,
      trigger,
      started_at: startedAt,
      status: m.status,
      changed_count: m.changedCount,
      evaluated_skills: m.evaluatedSkills,
      matched_tickets: m.matchedTickets,
      protected_skills: m.protectedSkills,
      reason: m.reason,
      detail: m.detail,
      skill_run_id: r.skillRunId ?? null,
    }));
    const { error: mErr } = await sb
      .from("ml_batch_member_runs")
      .upsert(memberRows, { onConflict: "organization_id,batch_id,profile_id" });
    if (mErr && r.debug) r.debug.memberBatchLogError = mErr.message;
  }
}

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: "Supabase not configured" });

  // cron からの呼び出しは Vercel が Authorization: Bearer <CRON_SECRET> を付ける。
  // アプリ（初回セットアップ/手動ボタン）からは organizationId 付きで叩く。
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && req.headers?.authorization === `Bearer ${cronSecret}`;

  const orgId: string | undefined = req.body?.organizationId ?? req.query?.organizationId;
  const force: boolean = Boolean(req.body?.force);

  // 学習ログを ②train.py と同じ行に書くための鍵。バッチからは GitHub の run_id が渡る。
  // アプリからの手動実行では発行されないので、ここで時刻ベースの鍵を作る。
  const batchId: string = String(req.body?.batchId ?? `manual-${new Date().toISOString()}`);
  const trigger: string = ["daily", "deploy", "manual"].includes(String(req.body?.trigger))
    ? String(req.body.trigger)
    : "manual";
  // ②モデル学習が後続するのはバッチ経由のときだけ。手動実行はここで完結させる。
  const finalize = !req.body?.batchId;

  if (!isCron && !orgId) return res.status(400).json({ error: "organizationId is required" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    if (orgId) {
      const r = await analyzeOrg(sb, orgId, force);
      await recordAnalyzePhase(sb, batchId, trigger, r, finalize);
      return res.json({ ok: true, results: [r] });
    }

    // cron: 全組織を回す。変更のない組織は差分検知でスキップされるので実質的な負荷は軽い。
    //
    // ★ setupOnly ★ デプロイ時(ml-bootstrap)は「まだ一度も分析していない組織」だけを見る。
    //   以前は毎デプロイで全組織を分析しており、ml_last_analyzed_at が日中に進んでしまうため
    //   夜間バッチが毎晩「変更なし」で空振りしていた。初期セットアップという本来の役割に戻す。
    const setupOnly = Boolean(req.body?.setupOnly);
    let orgQuery = sb.from("organizations").select("id");
    if (setupOnly) orgQuery = orgQuery.eq("ml_setup_done", false);
    const { data: orgs } = await orgQuery;
    const results: AnalyzeResult[] = [];
    for (const o of orgs ?? []) {
      let r: AnalyzeResult;
      try {
        r = await analyzeOrg(sb, o.id, force);
      } catch (e) {
        r = { orgId: o.id, skipped: true, members: 0, skillsWritten: 0, error: String(e), debug: {} };
      }
      // 1組織の記録失敗で全体を止めない
      try {
        await recordAnalyzePhase(sb, batchId, trigger, r, finalize);
      } catch { /* 記録できなくても分析結果は返す */ }
      results.push(r);
    }
    const analyzed = results.filter(r => !r.skipped).length;
    return res.json({ ok: true, orgs: results.length, analyzed, batchId, results });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
