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
import FileBox from './articles/20260722-file-box';
import FileBoxEdit from './articles/20260726-file-box-edit';
import KnowledgeNote from './articles/20260803-knowledge-note';
import TaskManagement from './articles/20260809-task-management';
import WhiteboardPrivate from './articles/20260809-whiteboard-private';
import MdBulkCreate from './articles/20260811-md-bulk-create';
import ApiIntegration from './articles/20260811-api-integration';
import TicketSearch from './articles/20260829-ticket-search';
import GithubIntegration from './articles/20260901-github-integration';

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
    slug: '20260901-github-integration',
    date: '2026.09.01',
    category: 'リリース',
    title: 'GitHub連携を追加しました（ブランチ作成・PR作成・マージまで画面内で完結）',
    excerpt: 'プルリクエストやIssueをDev Ticketの画面内で確認でき、チケットからブランチを切り、PRを作り、マージするまで完結。閲覧するメンバーにGitHubアカウントは不要で、「誰に何を許すか」はブランチ作成／PR作成／マージの3つに分けて設定できます。',
    Component: GithubIntegration,
  },
  {
    slug: '20260829-ticket-search',
    date: '2026.08.29',
    category: 'リリース',
    title: 'スプリントをまたいでチケットを探せる「一覧検索」を追加しました',
    excerpt: 'キーワード・期間・ステータス・担当者など7つの条件で、プロジェクト内のチケットを横断検索。結果は1つの表に並び、下へスクロールしても見出し行が画面上端で固定されるので、どの列かを見失いません。',
    Component: TicketSearch,
  },
  {
    slug: '20260811-api-integration',
    date: '2026.08.11',
    category: 'リリース',
    title: 'AIや外部システムからチケットを登録できる「API連携」を追加しました',
    excerpt: 'プロジェクト単位でAPIキーを発行し、外部のAIやCIから直接チケットを登録できるようになりました。親子1階層までまとめて登録でき、読めなかった値は空欄＋警告で返して登録自体は止めません。',
    Component: ApiIntegration,
  },
  {
    slug: '20260811-md-bulk-create',
    date: '2026.08.11',
    category: 'リリース',
    title: 'MDファイルからチケット・タスクを一括作成できるようになりました',
    excerpt: 'AIに書かせたMarkdownを取り込むだけで、タイトル・ステータス・優先度・分類・担当者・日程まで入った状態でまとめて起票。メンバー名と分類名を埋め込んだAI用プロンプトもワンクリックでコピーできます。',
    Component: MdBulkCreate,
  },
  {
    slug: '20260809-whiteboard-private',
    date: '2026.08.09',
    category: 'リリース',
    title: 'ホワイトボードにボード単位のプライベートモードを追加しました',
    excerpt: '「作成者だけが見られるボード」を3点リーダーから切り替え。まとまる前の下書きや自分用のメモを置けます。遮断はデータベース側の権限で行っており、管理者であっても中身は見られません。',
    Component: WhiteboardPrivate,
  },
  {
    slug: '20260809-task-management',
    date: '2026.08.09',
    category: 'リリース',
    title: '未着手・進行中・完了だけを扱う軽量な「タスク」機能を追加しました',
    excerpt: 'モーダルは出さず、表の最終行に打って Enter するだけで登録。完了しても一覧から消えずグレーアウトして残ります。リスト／かんばん／ガントで見方を切り替えられ、個人・指名共有・プロジェクトの3つの公開範囲を選べます。',
    Component: TaskManagement,
  },
  {
    slug: '20260803-knowledge-note',
    date: '2026.08.03',
    category: 'リリース',
    title: '資料を目次で辿り、意味で探せる「ナレッジノート」を追加しました',
    excerpt: '設計書や調査資料をプロジェクトごとに保管。目次から該当の節へまっすぐ飛べるうえ、入力した語が本文に出てこなくても内容が近い箇所を見つけられます。解析はブラウザ内で完結し、外部のAIサービスへは送信しません。',
    Component: KnowledgeNote,
  },
  {
    slug: '20260726-file-box-edit',
    date: '2026.07.26',
    category: 'リリース',
    title: 'ファイルボックスの Excel・Word をブラウザ上でそのまま編集できるようになりました',
    excerpt: 'ダウンロードせず、開いている画面からそのまま修正。行や列の操作、セルの結合、書式の指定にも対応し、保存すると新しいバージョンとしてチームに共有されます。編集も外部サービスを経由しません。',
    Component: FileBoxEdit,
  },
  {
    slug: '20260722-file-box',
    date: '2026.07.22',
    category: 'リリース',
    title: 'プロジェクトの資料を一元管理する「ファイルボックス」機能を追加しました',
    excerpt: 'プロジェクトごとに資料をまとめて保管。PDF・Excel・Word・画像をダウンロードせずブラウザでそのまま閲覧でき、Excel / Word は「アプリで開く」からいつも通り保存するだけで新しいバージョンとして反映されます。',
    Component: FileBox,
  },
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
