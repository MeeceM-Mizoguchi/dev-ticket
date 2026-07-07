import type { ComponentType } from 'react';
import { Rocket, Megaphone, type LucideIcon } from 'lucide-react';

// ── 記事本文コンポーネント（articles/ 配下・本文のみを記述） ──
import OfficialRelease from './articles/20260624-official-release';
import ReportManagement from './articles/20260627-report-management';
import BiometricLogin from './articles/20260628-biometric-login';
import Whiteboard from './articles/20260706-whiteboard';

/**
 * ============================================================
 * LP ニュース台帳（唯一の情報源）
 * ============================================================
 * 【記事を追加する手順（2ステップ）】
 *  1. src/app/pages/lp/news/articles/ に本文の .tsx を作成
 *     （NewsArticleLayout に囲まれるため、本文JSXのみを default export）
 *  2. 下の import に1行足し、NEWS 配列の「先頭」にエントリを追加
 *
 *  ※ これだけで LP の最新3件・一覧(/news)・記事(/news/:slug) が
 *    すべて自動連動します（App.tsx の編集は不要）。
 * ============================================================
 */

export type NewsCategory = 'リリース' | 'お知らせ';

export interface NewsEntry {
  /** URL スラッグ。/news/:slug で使用。ファイル名と揃える（例: 20260706-whiteboard） */
  slug: string;
  /** 表示日付 'YYYY.MM.DD' */
  date: string;
  category: NewsCategory;
  title: string;
  /** 一覧・LPでの抜粋 */
  excerpt: string;
  /** 記事本文コンポーネント */
  Component: ComponentType;
}

/** カテゴリごとの見た目（バッジ色・アイコン） */
export const CATEGORY_META: Record<NewsCategory, { badge: string; text: string; icon: LucideIcon }> = {
  'リリース': { badge: 'bg-teal-100', text: 'text-teal-700', icon: Rocket },
  'お知らせ': { badge: 'bg-amber-100', text: 'text-amber-700', icon: Megaphone },
};

/** 一覧・LPで使う共通カテゴリバッジ */
export function NewsCategoryBadge({ category }: { category: NewsCategory }) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full ${meta.badge} ${meta.text}`}>
      <Icon className="w-3 h-3" />
      {category}
    </span>
  );
}

// ★ 新しい記事は「この配列の先頭」に追加してください ★
export const NEWS: NewsEntry[] = [
  {
    slug: '20260706-whiteboard',
    date: '2026.07.06',
    category: 'リリース',
    title: 'ホワイトボード機能を実装しました',
    excerpt: '付箋・図形・手描きで自由に描けるキャンバスをリアルタイム共同編集で。アイデア出しや設計の共有がチームでスムーズに行えます。',
    Component: Whiteboard,
  },
  {
    slug: '20260628-biometric-login',
    date: '2026.06.28',
    category: 'リリース',
    title: '生体認証ログインに対応しました',
    excerpt: 'Face ID / Touch ID を使ったパスワード不要のログインに対応。毎日のサインインがよりすばやく安全になりました。',
    Component: BiometricLogin,
  },
  {
    slug: '20260627-report-management',
    date: '2026.06.27',
    category: 'リリース',
    title: 'レポート管理機能を実装しました',
    excerpt: 'チケットやスプリントのデータを集計し、チームの生産性をグラフで可視化。期間やメンバーごとの状況をひと目で把握できます。',
    Component: ReportManagement,
  },
  {
    slug: '20260624-official-release',
    date: '2026.06.24',
    category: 'リリース',
    title: '開発チケット管理ツール「Dev Ticket」をファーストリリースしました',
    excerpt: 'チケット・スプリント・メンバー管理を一元化する Dev Ticket を正式公開。チームの生産性を最大化する7つのコア機能を搭載しています。',
    Component: OfficialRelease,
  },
];

/** slug から記事を取得（/news/:slug 用） */
export function getArticle(slug: string | undefined): NewsEntry | undefined {
  return NEWS.find((n) => n.slug === slug);
}
