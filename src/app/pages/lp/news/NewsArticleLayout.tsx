import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { NewsChrome } from './NewsChrome';
import { NewsCategoryBadge, type NewsEntry } from './newsRegistry';

/**
 * 本文の共通タイポグラフィ。記事ファイルはプレーンな
 * <h2>/<p>/<ul>/<strong>/<blockquote> を書くだけで整形される。
 */
const PROSE =
  'text-slate-700 text-[15px] sm:text-base leading-8 ' +
  '[&>*:first-child]:mt-0 ' +
  '[&_p]:my-5 ' +
  '[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-base sm:[&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:tracking-tight [&_h2]:leading-snug ' +
  '[&_ul]:my-5 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ul]:marker:text-teal-500 ' +
  '[&_ol]:my-5 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_ol]:marker:text-teal-500 ' +
  '[&_strong]:font-bold [&_strong]:text-slate-900 ' +
  '[&_a]:text-teal-600 [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-teal-700 ' +
  '[&_blockquote]:my-6 [&_blockquote]:rounded-xl [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:bg-slate-50 [&_blockquote]:px-5 [&_blockquote]:py-4 [&_blockquote]:text-slate-700';

/**
 * ニュース記事の共通レイアウト（ライトな editorial スタイル）。
 * 記事らしい導入（キッカー・タイトル・リード文）＋読みやすい本文カラム。
 */
export function NewsArticleLayout({ entry, children }: { entry: NewsEntry; children: ReactNode }) {
  return (
    <NewsChrome>
      <article className="max-w-6xl mx-auto px-5 sm:px-6 lg:px-8 pt-10 sm:pt-14 pb-20 sm:pb-28">
        {/* 戻る */}
        <Link
          to="/news"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-slate-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          ニュース一覧へ
        </Link>

        {/* PC ではメタ情報を左サイドに固定し、本文を右の広いカラムに配置して横幅を活かす */}
        <div className="mt-8 lg:grid lg:grid-cols-[19rem_minmax(0,1fr)] lg:gap-16 xl:gap-20">
          {/* 記事ヘッダー（キッカー → タイトル → リード文） */}
          <header className="lg:sticky lg:top-24 lg:self-start">
            <div className="flex items-center gap-3 mb-4">
              <NewsCategoryBadge category={entry.category} />
              <time className="text-sm text-slate-400 font-mono">{entry.date}</time>
            </div>
            <h1 className="text-2xl sm:text-[1.75rem] lg:text-3xl font-bold text-slate-900 leading-[1.35] tracking-tight">
              {entry.title}
            </h1>
            <p className="mt-4 text-lg text-slate-500 leading-relaxed">{entry.excerpt}</p>
          </header>

          {/* 本文カラム */}
          <div className="min-w-0">
            <hr className="my-8 sm:my-10 border-slate-200 lg:hidden" />

            {/* 本文 */}
            <div className={PROSE}>{children}</div>

            {/* フッター */}
            <div className="mt-14 pt-8 border-t border-slate-200">
              <Link
                to="/news"
                className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                ニュース一覧に戻る
              </Link>
            </div>
          </div>
        </div>
      </article>
    </NewsChrome>
  );
}
