// ENHA2-034 スキル＆担当者レコメンドAI ─ スキルの共通ドメインロジック
//
// ここは「①スキル分析」の中核。集計とルール判定だけで、機械学習は使わない。
// （学習するのは「②担当者レコメンド」の方。ml/train.py を参照）
//
// フロント（表示・手動編集）と、api/ml/analyze-skills.ts（自動判定バッチ）の
// 両方から使う。ルールを1箇所に集約して、UIとバッチの判定がズレないようにする。

// ※ import は相対パスにする。この modules は Vercel の api/ 配下（別ビルド、@エイリアス無し）
//    からも読み込むため、"@/..." エイリアスに依存させない。
import type { SkillLayer, SkillLevel, SkillEvidence, DevScale } from "../types";

// ── レイヤー（固定6種） ──
export const SKILL_LAYERS: { key: SkillLayer; label: string; color: string; bg: string }[] = [
  { key: "frontend", label: "フロントエンド", color: "#0284C7", bg: "#F0F9FF" },
  { key: "backend",  label: "バックエンド",   color: "#059669", bg: "#ECFDF5" },
  { key: "infra",    label: "インフラ",       color: "#D97706", bg: "#FFFBEB" },
  { key: "design",   label: "デザイン",       color: "#7C3AED", bg: "#F5F3FF" },
  { key: "qa",       label: "QA",             color: "#DB2777", bg: "#FDF2F8" },
  { key: "other",    label: "その他",         color: "#6B7280", bg: "#F3F4F6" },
];

export function layerMeta(layer: SkillLayer) {
  return SKILL_LAYERS.find(l => l.key === layer) ?? SKILL_LAYERS[5];
}

// ── レベル定義（1〜4） ──
// 所要時間・難易度ベース。この定義が既存チケットの工数と直結しているからこそ、
// 過去実績からレベルを機械的に判定できる。
export const SKILL_LEVELS: { level: SkillLevel; label: string; detail: string }[] = [
  { level: 1, label: "簡単なものであればできる", detail: "だいたい15分〜30分でできるもの" },
  { level: 2, label: "少し難しいものならできる", detail: "だいたい1時間〜3時間でできるもの" },
  { level: 3, label: "普通",                     detail: "バックエンドも考慮したI/Fまでできる" },
  { level: 4, label: "リーダークラス",           detail: "ほぼなんでもできる" },
];

export function levelMeta(level: SkillLevel) {
  return SKILL_LEVELS.find(l => l.level === level) ?? SKILL_LEVELS[0];
}

// ── 開発規模 ──
export const DEV_SCALES: { key: DevScale; label: string; hint: string }[] = [
  { key: "S",  label: "S",  hint: "小さい（〜3h）" },
  { key: "M",  label: "M",  hint: "普通（〜1日）" },
  { key: "L",  label: "L",  hint: "大きい（数日）" },
  { key: "XL", label: "XL", hint: "非常に大きい（1週間〜）" },
];

// ============================================================
// 初期スキル辞書
//
// 製品に同梱する「種」。初回セットアップ時に過去チケットをこの辞書で走査し、
// 実際にヒットしたスキルだけを、その組織の skills テーブルに登録する。
// （80個すべてを登録すると、使っていない技術まで並んで邪魔になるため）
// ============================================================
export interface SeedSkill { layer: SkillLayer; name: string; keywords: string[] }

export const SEED_SKILLS: SeedSkill[] = [
  // ── フロントエンド ──
  { layer: "frontend", name: "React",          keywords: ["react", "リアクト", "jsx", "tsx", "コンポーネント"] },
  { layer: "frontend", name: "Vue",            keywords: ["vue", "nuxt"] },
  { layer: "frontend", name: "TypeScript",     keywords: ["typescript", "ts型", "型定義"] },
  { layer: "frontend", name: "HTML・CSS",      keywords: ["css", "html", "スタイル", "見た目", "レイアウト", "tailwind"] },
  { layer: "frontend", name: "UI実装",         keywords: ["ui", "画面", "フロント", "表示", "ボタン", "モーダル", "ダイアログ", "一覧画面"] },
  { layer: "frontend", name: "レスポンシブ対応", keywords: ["レスポンシブ", "スマホ対応", "モバイル対応", "ブレークポイント"] },
  { layer: "frontend", name: "状態管理",       keywords: ["状態管理", "redux", "zustand", "context"] },

  // ── バックエンド ──
  { layer: "backend", name: "API設計",         keywords: ["api", "エンドポイント", "rest", "リクエスト", "レスポンス", "graphql"] },
  { layer: "backend", name: "DB設計",          keywords: ["db", "テーブル", "スキーマ", "マイグレーション", "database", "カラム追加"] },
  { layer: "backend", name: "SQL",             keywords: ["sql", "クエリ", "select", "join", "インデックス"] },
  { layer: "backend", name: "Node.js",         keywords: ["node", "express", "npm"] },
  { layer: "backend", name: "Python",          keywords: ["python", "django", "fastapi"] },
  { layer: "backend", name: "PHP",             keywords: ["php", "laravel"] },
  { layer: "backend", name: "Java",            keywords: ["java", "spring"] },
  { layer: "backend", name: "認証・認可",       keywords: ["認証", "ログイン", "権限", "auth", "oauth", "jwt", "パスワード", "rls"] },
  { layer: "backend", name: "バッチ処理",       keywords: ["バッチ", "cron", "定期実行", "ジョブ"] },
  { layer: "backend", name: "外部連携",         keywords: ["連携", "webhook", "slack", "外部api", "サードパーティ"] },

  // ── インフラ ──
  { layer: "infra", name: "AWS",               keywords: ["aws", "ec2", "s3", "lambda", "rds"] },
  { layer: "infra", name: "GCP",               keywords: ["gcp", "firebase", "cloud run"] },
  { layer: "infra", name: "Docker",            keywords: ["docker", "コンテナ", "dockerfile"] },
  { layer: "infra", name: "CI・CD",            keywords: ["ci", "cd", "デプロイ", "パイプライン", "github actions", "リリース作業"] },
  { layer: "infra", name: "サーバー構築",       keywords: ["サーバー", "サーバ構築", "nginx", "本番環境", "ステージング環境"] },
  { layer: "infra", name: "監視・ログ",         keywords: ["監視", "ログ", "アラート", "メトリクス", "モニタリング"] },
  { layer: "infra", name: "ネットワーク",       keywords: ["ネットワーク", "dns", "ドメイン", "ssl", "証明書"] },
  { layer: "infra", name: "セキュリティ",       keywords: ["セキュリティ", "脆弱性", "csrf", "xss", "暗号化"] },

  // ── デザイン ──
  { layer: "design", name: "Figma",            keywords: ["figma", "フィグマ", "モック"] },
  { layer: "design", name: "UIデザイン",       keywords: ["デザイン", "uiデザイン", "配色", "アイコン"] },
  { layer: "design", name: "UXデザイン",       keywords: ["ux", "導線", "ユーザビリティ", "体験"] },

  // ── QA ──
  { layer: "qa", name: "テスト設計",           keywords: ["テスト設計", "テストケース", "test case"] },
  { layer: "qa", name: "自動テスト",           keywords: ["自動テスト", "e2e", "ユニットテスト", "jest", "playwright"] },
  { layer: "qa", name: "動作検証",             keywords: ["動作確認", "検証", "テスト", "qa", "不具合再現"] },

  // ── その他 ──
  { layer: "other", name: "要件定義",          keywords: ["要件定義", "要件", "ヒアリング"] },
  { layer: "other", name: "設計",              keywords: ["設計", "基本設計", "詳細設計", "アーキテクチャ"] },
  { layer: "other", name: "コードレビュー",     keywords: ["レビュー", "リファクタ", "リファクタリング"] },
  { layer: "other", name: "ドキュメント",       keywords: ["ドキュメント", "wiki", "手順書", "マニュアル"] },
  { layer: "other", name: "調査・分析",         keywords: ["調査", "分析", "原因究明", "切り分け"] },
];

// ============================================================
// キーワード検出
// ============================================================

/**
 * チケットの文章（タイトル・説明・ラベル・カテゴリ名）から、
 * どのスキルに該当するかをキーワードで判定する。
 *
 * 段階A（現行）: 過去チケットにはスキルラベルが無いので、文章から拾うしかない。
 * 段階B（将来）: 過去チケットの文章とラベルの対応を学習して、辞書に頼らず判定する。
 */
export function detectSkillKeywords(
  text: string,
  skills: { id: string; name: string; keywords: string[] }[],
): string[] {
  const haystack = text.toLowerCase();
  const hit: string[] = [];
  for (const s of skills) {
    // スキル名そのもの、またはキーワードのいずれかが含まれれば該当
    const terms = [s.name, ...s.keywords].map(t => t.toLowerCase()).filter(Boolean);
    if (terms.some(t => haystack.includes(t))) hit.push(s.id);
  }
  return hit;
}

/** チケットから検索対象テキストを組み立てる */
export function ticketSearchText(t: {
  title?: string; description?: string; prefixes?: string[]; categoryName?: string;
}): string {
  return [t.title ?? "", t.description ?? "", ...(t.prefixes ?? []), t.categoryName ?? ""].join(" ");
}

// ============================================================
// レベル判定ルール（①スキル分析の心臓部）
//
// 原則: 一発の大物ではなく「安定して成功させている最大の難易度帯」をレベルとする。
//       （たまたま1件だけ大きいのをやった、ではLv4にしない）
// ============================================================

/** レベル判定に必要な、あるメンバー×あるスキルの実績サマリ */
export interface SkillStats {
  doneCount: number;      // そのスキルの完了チケット数
  hours: number[];        // 各完了チケットの実績工数（h）
  onTimeCount: number;    // 納期内に終えた件数
  reviewCount: number;    // 他人のチケットをレビュー承認した回数（Lv4の決め手）
  largeScaleCount: number; // L / XL 規模を完了した件数
}

// 「安定して」とみなす最低件数。これ未満はそのレベルに到達したと認めない。
const STABLE_MIN = 3;
// レベル帯の上限工数（h）。SKILL_LEVELS の定義（15-30分 / 1-3時間 / …）に対応。
const LV1_MAX_HOURS = 0.5;   // 〜30分
const LV2_MAX_HOURS = 3;     // 〜3時間

/**
 * 実績からスキルレベル(1〜4)を判定する。
 * 該当実績が乏しい場合は null（＝そのスキルは登録しない）。
 */
export function inferSkillLevel(stats: SkillStats): { level: SkillLevel; evidence: SkillEvidence } | null {
  if (stats.doneCount === 0) return null;

  const hours = stats.hours.filter(h => h > 0).sort((a, b) => a - b);
  const avgHours = hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : 0;
  const onTimeRate = stats.doneCount > 0 ? stats.onTimeCount / stats.doneCount : 0;

  // 「安定してこなせた工数帯」= 上位25%を外した実質的な上限。
  // 外れ値（たまたまの大物1件）でレベルが跳ね上がるのを防ぐ。
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

  // Lv4: リーダークラス。
  //   決め手は「レビューする側に回っているか」。既存の sprint_tickets.reviewer_name が
  //   そのままリーダーシップのシグナルになる。加えて大規模も安定してこなせていること。
  if (stats.reviewCount >= STABLE_MIN && (stats.largeScaleCount >= 1 || stableMaxHours > LV2_MAX_HOURS)) {
    return { level: 4, evidence };
  }

  // Lv3: 普通。I/Fまで含む中〜大規模（3hを超える帯）を安定してこなせている。
  const overLv2 = hours.filter(h => h > LV2_MAX_HOURS).length;
  if (overLv2 >= STABLE_MIN || stats.largeScaleCount >= STABLE_MIN) {
    return { level: 3, evidence };
  }

  // Lv2: 1〜3時間の帯を安定してこなせている。
  const inLv2 = hours.filter(h => h > LV1_MAX_HOURS && h <= LV2_MAX_HOURS).length;
  if (inLv2 >= STABLE_MIN || stableMaxHours > LV1_MAX_HOURS) {
    return { level: 2, evidence };
  }

  // Lv1: 小粒（〜30分）中心。
  return { level: 1, evidence };
}

/** 判定根拠を人間に見せる文章にする（モーダルの「根拠」列） */
export function evidenceText(e: SkillEvidence): string {
  const parts: string[] = [];
  if (e.doneCount) parts.push(`${e.doneCount}件完了`);
  if (e.avgHours) parts.push(`平均${e.avgHours}h`);
  if (e.reviewCount) parts.push(`レビュー${e.reviewCount}件`);
  if (e.onTimeRate !== undefined && e.doneCount) parts.push(`納期遵守${Math.round(e.onTimeRate * 100)}%`);
  return parts.join(" · ") || "実績なし";
}
