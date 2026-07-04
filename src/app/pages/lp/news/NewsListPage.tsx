import { useState } from 'react';
import { Link } from 'react-router';
import { Inbox, ArrowRight } from 'lucide-react';
import { NewsChrome } from './NewsChrome';
import { NEWS, NewsCategoryBadge, type NewsCategory } from './newsRegistry';

type Tab = 'すべて' | NewsCategory;
const TABS: Tab[] = ['すべて', 'リリース', 'お知らせ'];

/**
 * /news : ニュース一覧
 * エディトリアルなリスト型（Linear / Vercel / Stripe のチェンジログ調）。
 * ハムライン区切りの各行を「左メタ列（日付＋カテゴリ）／右コンテンツ」の2カラムで構成。
 */
export function NewsListPage() {
  const [tab, setTab] = useState<Tab>('すべて');
  const items = tab === 'すべて' ? NEWS : NEWS.filter((n) => n.category === tab);

  return (
    <NewsChrome>
      <div className="max-w-4xl mx-auto px-5 sm:px-6 lg:px-8">
        {/* ヘッダー */}
        <header className="pt-16 sm:pt-24 pb-10">
          <p className="text-xs font-semibold tracking-[0.2em] text-teal-600 mb-3">NEWS</p>
          <h1 className="text-3xl sm:text-[2.5rem] font-bold tracking-tight text-slate-900">お知らせ</h1>
          <p className="mt-3 text-base text-slate-500">Dev Ticket の最新のリリース情報とお知らせをお届けします。</p>
        </header>

        {/* フィルタ（下線セグメント型） */}
        <div className="flex items-center gap-6 border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative -mb-px pb-3 text-sm font-semibold transition-colors ${
                tab === t ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t}
              {tab === t && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-500" />}
            </button>
          ))}
        </div>

        {/* リスト */}
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-28 text-center text-slate-400">
            <Inbox className="w-9 h-9 text-slate-300" />
            該当する記事がありません。
          </div>
        ) : (
          <ul className="pb-24">
            {items.map((n) => (
              <li key={n.slug}>
                <Link
                  to={`/news/${n.slug}`}
                  className="group -mx-4 grid items-baseline gap-x-6 gap-y-2.5 rounded-2xl border-b border-slate-100 px-4 py-7 transition-colors hover:bg-slate-50 sm:grid-cols-[9.5rem_1fr]"
                >
                  {/* メタ列（日付＋カテゴリ） */}
                  <div className="flex items-center gap-3 sm:flex-col sm:items-start sm:gap-2.5 sm:pt-1">
                    <time className="font-mono text-[13px] tracking-wide text-slate-400">{n.date}</time>
                    <NewsCategoryBadge category={n.category} />
                  </div>

                  {/* コンテンツ */}
                  <div className="min-w-0">
                    <div className="flex items-start gap-3">
                      <h2 className="flex-1 text-lg font-bold leading-snug text-slate-900 transition-colors group-hover:text-teal-600">
                        {n.title}
                      </h2>
                      <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-slate-300 transition-all group-hover:translate-x-0.5 group-hover:text-teal-500" />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-slate-500 line-clamp-2">{n.excerpt}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </NewsChrome>
  );
}
