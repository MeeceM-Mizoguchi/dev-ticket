import { ArrowLeft, Ticket, ShieldCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

export function PrivacyPolicyPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="fixed top-0 w-full bg-white/80 backdrop-blur-md border-b border-slate-200 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(145deg, #34D399, #059669)', boxShadow: '0 4px 12px rgba(5,150,105,0.35)' }}>
                <Ticket className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl font-bold text-slate-900">Dev Ticket</span>
            </div>
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

      <main className="flex-1 pt-32 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3 mb-8">
            <ShieldCheck className="w-8 h-8 text-teal-600" />
            <h1 className="text-3xl font-bold text-slate-900">プライバシーポリシー</h1>
          </div>
          <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 space-y-8 text-slate-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">1. 個人情報の収集</h2>
            <p>当社は、サービスの提供にあたり、適法かつ公正な手段によって個人情報を取得します。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">2. 利用目的</h2>
            <p>当社は、取得した個人情報を以下の目的で利用いたします。</p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li>本サービスの提供、維持、保護及び改善のため</li>
              <li>ユーザー登録の受付、本人確認および認証のため</li>
              <li>本サービスに関するご案内、お問い合わせ等への対応のため</li>
              <li>利用規約等の変更、アップデート情報の通知のため</li>
              <li>サービス利用状況の分析およびマーケティング施策の検討のため</li>
              <li>不正利用の防止および安全な利用環境の確保のため</li>
            </ul>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">3. 個人情報の第三者提供</h2>
            <p>当社は、個人情報保護法その他の法令に基づき開示が認められる場合を除き、あらかじめユーザーの同意を得ることなく個人情報を第三者に提供することはありません。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">4. 個人情報の管理・保護</h2>
            <p>当社は、個人情報の漏洩、滅失または毀損の防止その他の個人情報の安全管理のために、適切なセキュリティ対策を講じ、厳重に管理いたします。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">5. 個人情報の開示・訂正・利用停止</h2>
            <p>ユーザーから個人情報の開示、訂正、追加、削除、利用停止等を求められた場合は、ご本人であることを確認の上、速やかに対応いたします。具体的な手続きについてはお問い合わせ窓口までご連絡ください。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">6. Cookie（クッキー）および解析ツールの使用</h2>
            <p>当サイトでは、サービスの利便性向上や利用状況の把握のためにCookieを使用することがあります。また、Google Analytics等の解析ツールを使用して、トラフィックデータの収集を行っています。これらのデータは匿名で収集されており、個人を特定するものではありません。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">7. お問い合わせ窓口</h2>
            <p>個人情報の取り扱いに関するご質問やご相談は、下記までご連絡ください。</p>
            <p className="mt-2 text-sm">
              Dev Ticket カスタマーサポート<br />
              メールアドレス: support@devticket.jp
            </p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">8. 本ポリシーの変更</h2>
            <p>当社は、法令の変更やサービス内容の変化に伴い、本ポリシーを適宜変更することがあります。重要な変更がある場合には、本サイト上での告知等適切な方法で通知いたします。</p>
          </section>
        </div>
        </div>
      </main>

      {/* Footer */}
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