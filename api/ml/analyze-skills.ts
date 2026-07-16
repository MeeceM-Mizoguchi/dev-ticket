// ENHA2-034 ①スキル自動分析
//
// チケット実績から、各メンバーのスキルとレベル(1〜4)を判定して member_skills を更新する。
// これは「集計＋ルール判定」であって機械学習ではない（学習するのは ②レコメンド = ml/train.py）。
//
// 呼ばれる経路は3つ:
//   1. 初回セットアップ … 組織の ml_setup_done が false のとき、アプリから即時実行（AM3時を待たない）
//   2. 日次cron        … 毎日 AM3:00 JST（vercel.json の crons、UTC 18:00）
//   3. 手動            … 管理者の「今すぐ再学習」ボタン
//
// 差分検知: 前回分析以降にチケットが動いていない組織はスキップする。
//   1000組織あっても、昨日チケットが動いたのは一部だけ。ここが効いて日次でも軽い。

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
}

/**
 * チケットの「最終活動日時」。
 * ※ sprint_tickets には updated_at 列が無いため、作成日時とマイルストーン日時の
 *   最大値で「最後に動いた時刻」を近似する（差分検知に使う）。
 */
function lastActivityMs(t: TicketRow): number {
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

/** 納期内に終わったか */
function isOnTime(t: TicketRow): boolean {
  if (!t.due_date) return true;   // 期限が無いものは減点しない
  const end = t.released_at || t.uat_completed_at || t.stg_completed_at || t.review_approved_at;
  if (!end) return true;
  return new Date(end).getTime() <= new Date(t.due_date).getTime() + 24 * 36e5;
}

/**
 * 組織のスキルマスタを用意する。
 * 初期辞書(SEED_SKILLS)で過去チケットを走査し、実際にヒットしたスキルだけを登録する。
 * （辞書80個をそのまま入れると、使っていない技術まで並んで邪魔になる）
 */
async function ensureSkillMaster(sb: SupabaseClient, orgId: string, tickets: TicketRow[]) {
  const { data: existing } = await sb.from("skills").select("id, name, layer, keywords").eq("organization_id", orgId);
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

  await sb.from("skills").upsert(toInsert, { onConflict: "organization_id,layer,name" });
  const { data } = await sb.from("skills").select("id, name, layer, keywords").eq("organization_id", orgId);
  return data ?? [];
}

/** 1組織を分析する */
async function analyzeOrg(sb: SupabaseClient, orgId: string, force: boolean): Promise<{
  orgId: string; skipped: boolean; members: number; skillsWritten: number;
}> {
  const { data: org } = await sb
    .from("organizations")
    .select("id, ml_last_analyzed_at")
    .eq("id", orgId)
    .maybeSingle();

  const since = new Date(Date.now() - LOOKBACK_MONTHS * 30 * 864e5).toISOString();

  // 対象チケット（この組織のプロジェクト配下、直近LOOKBACK_MONTHS）
  const { data: projects } = await sb.from("projects").select("id").eq("organization_id", orgId);
  const projectIds = (projects ?? []).map(p => p.id);
  if (projectIds.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  const { data: sprints } = await sb.from("sprints").select("id").in("project_id", projectIds);
  const sprintIds = (sprints ?? []).map(s => s.id);
  if (sprintIds.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  const { data: ticketsRaw } = await sb
    .from("sprint_tickets")
    .select("id, title, description, prefixes, status, assignee, reviewer_name, due_date, dev_scale, estimated_hours, actual_work_hours, started_at, released_at, uat_completed_at, stg_completed_at, review_approved_at, created_at")
    .in("sprint_id", sprintIds)
    .gte("created_at", since);

  const tickets = (ticketsRaw ?? []) as TicketRow[];
  if (tickets.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  // ── 差分検知 ──
  // 前回分析以降にチケットが1件も動いていなければ、分析するだけ無駄なのでスキップする。
  const lastAnalyzed = org?.ml_last_analyzed_at ? new Date(org.ml_last_analyzed_at).getTime() : 0;
  if (!force && lastAnalyzed > 0) {
    const changed = tickets.some(t => lastActivityMs(t) > lastAnalyzed);
    if (!changed) return { orgId, skipped: true, members: 0, skillsWritten: 0 };
  }

  const skills = await ensureSkillMaster(sb, orgId, tickets);
  if (skills.length === 0) return { orgId, skipped: true, members: 0, skillsWritten: 0 };

  // ── メンバー ──
  // ★ skill_auto_update が ON のメンバーだけがスキル自動更新の対象。
  //   OFF のメンバーは手動で設定した値を守る（ただしレコメンドの対象からは外さない）。
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, name, skill_auto_update")
    .eq("organization_id", orgId);

  const autoMembers = (profiles ?? []).filter(p => p.skill_auto_update !== false);
  if (autoMembers.length === 0) {
    await sb.from("organizations").update({ ml_setup_done: true, ml_last_analyzed_at: new Date().toISOString() }).eq("id", orgId);
    return { orgId, skipped: false, members: 0, skillsWritten: 0 };
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
      for (const sid of skillIds) bump(reviewer.id, sid, s => { s.reviewCount++; });
    }
  }

  // ── レベル判定 → member_skills へ書き込み ──
  // source='manual'（人が設定した）行は上書きしない。自動判定が人の意思を潰さないため。
  const { data: manualRows } = await sb
    .from("member_skills")
    .select("profile_id, skill_id")
    .eq("source", "manual")
    .in("profile_id", autoMembers.map(m => m.id));
  const manualKeys = new Set((manualRows ?? []).map(r => keyOf(r.profile_id, r.skill_id)));

  const rows: {
    profile_id: string; skill_id: string; level: number; source: string;
    evidence: unknown; updated_at: string;
  }[] = [];
  const now = new Date().toISOString();

  for (const [k, s] of stats) {
    if (manualKeys.has(k)) continue;
    const [profileId, skillId] = k.split("::");
    const inferred = inferSkillLevel(s);
    if (!inferred) continue;
    rows.push({
      profile_id: profileId, skill_id: skillId,
      level: inferred.level, source: "auto",
      evidence: inferred.evidence, updated_at: now,
    });
  }

  if (rows.length > 0) {
    await sb.from("member_skills").upsert(rows, { onConflict: "profile_id,skill_id" });
  }

  await sb.from("organizations")
    .update({ ml_setup_done: true, ml_last_analyzed_at: now })
    .eq("id", orgId);

  return { orgId, skipped: false, members: autoMembers.length, skillsWritten: rows.length };
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

  if (!isCron && !orgId) return res.status(400).json({ error: "organizationId is required" });

  const sb = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

  try {
    if (orgId) {
      const r = await analyzeOrg(sb, orgId, force);
      return res.json({ ok: true, results: [r] });
    }

    // cron: 全組織を回す。変更のない組織は差分検知でスキップされるので実質的な負荷は軽い。
    const { data: orgs } = await sb.from("organizations").select("id");
    const results = [];
    for (const o of orgs ?? []) {
      try {
        results.push(await analyzeOrg(sb, o.id, false));
      } catch (e) {
        results.push({ orgId: o.id, skipped: true, members: 0, skillsWritten: 0, error: String(e) });
      }
    }
    const analyzed = results.filter(r => !r.skipped).length;
    return res.json({ ok: true, orgs: results.length, analyzed, results });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
