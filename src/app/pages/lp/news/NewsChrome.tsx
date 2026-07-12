import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Ticket } from 'lucide-react';
import ScrollToTop from '@/app/components/lp/ScrollToTop';

/**
 * ニュース一覧・記事ページ共通の外枠（固定ヘッダー＋フッター）。
 * LP本体（LandingPage）と同じ Dev Ticket ブランドのヘッダー/フッターを踏襲。
 */
export function NewsChrome({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* ページ遷移（一覧→記事・記事間）で最上部へ戻す。記事が途中から表示されるのを防ぐ */}
      <ScrollToTop />
      {/* ヘッダー */}
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #34D399, #059669)', boxShadow: '0 4px 12px rgba(5,150,105,0.35)' }}>
                <Ticket className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900">Dev Ticket</span>
            </Link>
            <button
              onClick={() => navigate('/')}
              className="text-sm font-medium text-slate-500 hover:text-teal-600 flex items-center gap-1.5 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              トップに戻る
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 pt-16">{children}</main>

      {/* フッター（LP本体と同一） */}
      <footer className="bg-slate-900 text-slate-400 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid md:grid-cols-3 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #34D399, #059669)', boxShadow: '0 3px 8px rgba(5,150,105,0.35)' }}>
                  <Ticket className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold text-white">Dev Ticket</span>
              </div>
              <p className="text-sm">
                チームの生産性を最大化する<br />プロジェクト管理ツール
              </p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">製品</h4>
              <ul className="space-y-2 text-sm">
                <li><Link to="/#features" className="hover:text-teal-400 transition-colors">機能</Link></li>
                <li><Link to="/#pricing" className="hover:text-teal-400 transition-colors">料金</Link></li>
                <li><Link to="/news" className="hover:text-teal-400 transition-colors">お知らせ</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">会社情報</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="https://meece-jp.com/" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition-colors">運営会社</a></li>
                <li><Link to="/privacy" className="hover:text-teal-400 transition-colors">プライバシーポリシー</Link></li>
                <li><Link to="/terms" className="hover:text-teal-400 transition-colors">利用規約</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center text-sm">
            <p>&copy; 2026 Dev Ticket. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
