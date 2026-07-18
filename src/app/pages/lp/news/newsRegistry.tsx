import type { ComponentType } from 'react';
import { Rocket, Megaphone, type LucideIcon } from 'lucide-react';

// ── 記事本文コンポーネント（articles/ 配下・本文のみを記述） ──
import OfficialRelease from './articles/20260624-official-release';
import ReportManagement from './articles/20260627-report-management';
import BiometricLogin from './articles/20260628-biometric-login';
import Whiteboard from './articles/20260706-whiteboard';
import VoiceCall from './articles/20260707-voice-call';
import ScreenShare from './articles/20260708-screen-share';
import CallFixes from './articles/20260708-call-fixes';
import WhiteboardFixes from './articles/20260708-whiteboard-fixes';
import MermaidDiagram from './articles/20260709-mermaid-diagram';
import WhiteboardFollow from './articles/20260713-whiteboard-follow';
import WhiteboardTable from './articles/20260713-whiteboard-table';
import AssigneeRecommend from './articles/20260718-assignee-recommend';

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
    slug: '20260718-assignee-recommend',
    date: '2026.07.18',
    category: 'リリース',
    title: '担当者をAIがおすすめする「担当者レコメンド」機能を追加しました',
    excerpt: '2つのAIが連携。毎晩実績を学習してスキルを自動更新する「分析AI」と、スキル×チケット内容と今の空き状況から担当者をおすすめする「アサインAI」を搭載しました。決めるたびに精度が上がり、外部AIは使わず自社の実績データだけで動作します。',
    Component: AssigneeRecommend,
  },
  {
    slug: '20260713-whiteboard-table',
    date: '2026.07.13',
    category: 'リリース',
    title: 'ホワイトボードに「表」を追加できるようになりました',
    excerpt: 'ツールバーの「表」ボタンから列×行を選ぶだけで、きれいに揃った表をキャンバスに作成。セルはダブルクリックで入力でき、内容に合わせて自動でレイアウトが整います。',
    Component: WhiteboardTable,
  },
  {
    slug: '20260713-whiteboard-follow',
    date: '2026.07.13',
    category: 'リリース',
    title: 'ホワイトボードに追従機能を追加しました',
    excerpt: '右上のメンバーアイコンをクリックするだけで、その人が見ている範囲に自分の画面が自動で追従。大きなボードでも「今どこを見ているか」がすぐに揃います。',
    Component: WhiteboardFollow,
  },
  {
    slug: '20260709-mermaid-diagram',
    date: '2026.07.09',
    category: 'リリース',
    title: 'Mermaid図（テキストで描く図）に対応しました',
    excerpt: 'フローチャートやシーケンス図などを、テキストで書くだけで作図。Wiki・議事録・チケットからホワイトボードまで対応し、PDF/Word/Excel でも図として出力できます。',
    Component: MermaidDiagram,
  },
  {
    slug: '20260708-screen-share',
    date: '2026.07.08',
    category: 'リリース',
    title: '通話中の画面共有機能を追加しました',
    excerpt: '音声通話をしながら、自分の画面をメンバーへ共有。ポインターや手書きで印を付けながら、認識のズレなく議論を進められます。',
    Component: ScreenShare,
  },
  {
    slug: '20260708-call-fixes',
    date: '2026.07.08',
    category: 'お知らせ',
    title: 'オンライン通話の不具合を修正しました',
    excerpt: '通話の切断や発信音、着信の終了に関する複数の不具合を修正。通話ウィンドウの最小化にも対応し、より快適にご利用いただけます。',
    Component: CallFixes,
  },
  {
    slug: '20260708-whiteboard-fixes',
    date: '2026.07.08',
    category: 'お知らせ',
    title: 'ホワイトボードの不具合を修正しました',
    excerpt: '共同編集時の同期やフレームのグループ化、初期表示など、ホワイトボードに関する複数の不具合を修正しました。',
    Component: WhiteboardFixes,
  },
  {
    slug: '20260707-voice-call',
    date: '2026.07.07',
    category: 'リリース',
    title: 'オンライン音声通話機能を実装しました',
    excerpt: 'プロジェクトのメンバーと、アプリ内でそのまま音声通話。ワンクリックで発信でき、画面を移動しても通話は途切れません。',
    Component: VoiceCall,
  },
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
