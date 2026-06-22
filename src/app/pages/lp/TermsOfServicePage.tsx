import { ArrowLeft, Ticket, FileText } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

export function TermsOfServicePage() {
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
            <FileText className="w-8 h-8 text-teal-600" />
            <h1 className="text-3xl font-bold text-slate-900">利用規約</h1>
          </div>
          <div className="bg-white p-8 sm:p-10 rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50 space-y-8 text-slate-600 leading-relaxed">
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第1条（適用）</h2>
            <p>本規約は、Meece株式会社（以下、「当社」）が提供する「Dev Ticket」（以下、「本サービス」）の利用条件を定めるものです。本サービスを利用する全てのユーザーに適用されます。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第2条（禁止事項）</h2>
            <p>ユーザーは、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
            <ul className="list-disc ml-6 mt-2 space-y-1">
              <li>法令または公序良俗に違反する行為</li>
              <li>当社または第三者の知的財産権を侵害する行為</li>
              <li>本サービスのネットワークまたはシステムに過度な負荷をかける行為</li>
              <li>不正アクセス、またはそれを試みる行為</li>
              <li>他のユーザーの情報を収集し、または不正に利用する行為</li>
            </ul>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第3条（サービスの停止等）</h2>
            <p>当社は、システムの保守・点検、または不可抗力により本サービスの提供が困難と判断した場合、ユーザーに事前に通知することなく本サービスの全部または一部を停止できるものとします。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第4条（利用制限および登録抹消）</h2>
            <p>当社は、ユーザーが本規約に違反した場合、事前の通知なく当該ユーザーに対して本サービスの利用を制限、または登録を抹消することができるものとします。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第5条（免責事項）</h2>
            <p>当社は、本サービスに関してユーザーに生じた損害について、当社の過失（重過失を除く）による債務不履行または不法行為により生じた損害のうち、特別な事情から生じた損害については一切の責任を負わないものとします。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第6条（利用規約の変更）</h2>
            <p>当社は、必要と判断した場合には、ユーザーに通知することなくいつでも本規約を変更することができるものとします。</p>
          </section>
          <section>
            <h2 className="text-xl font-bold text-slate-800 mb-3">第7条（準拠法・裁判管轄）</h2>
            <p>本規約の解釈にあたっては日本法を準拠法とし、本サービスに関して紛争が生じた場合には、当社の本店所在地を管轄する裁判所を専属的合意管轄とします。</p>
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