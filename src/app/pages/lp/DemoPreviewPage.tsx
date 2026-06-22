import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { DemoInteractivePage } from './DemoInteractivePage';

type Status = 'loading' | 'valid' | 'invalid' | 'expired';

export function DemoPreviewPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    const token = params.get('t');
    if (!token) { setStatus('invalid'); return; }

    fetch(`/api/verify-demo-token?t=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((data: { valid: boolean; reason?: string }) => {
        if (data.valid) {
          setStatus('valid');
        } else if (data.reason === 'token expired') {
          setStatus('expired');
        } else {
          setStatus('invalid');
        }
      })
      .catch(() => setStatus('invalid'));
  }, [params]);

  if (status === 'loading') {
    return (
      <div className="fixed inset-0 bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">デモを準備しています...</div>
      </div>
    );
  }

  if (status === 'valid') {
    return (
      <DemoInteractivePage onClose={() => navigate('/')} />
    );
  }

  const isExpired = status === 'expired';
  return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl p-10 max-w-md w-full text-center shadow-2xl">
        <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-6">
          <span className="text-3xl">{isExpired ? '⏱' : '🔒'}</span>
        </div>
        <h1 className="text-xl font-bold text-slate-900 mb-3">
          {isExpired ? 'リンクの有効期限が切れています' : 'このリンクは無効です'}
        </h1>
        <p className="text-sm text-slate-500 mb-8">
          {isExpired
            ? 'このデモリンクは24時間限定です。新しいリンクを発行するには、再度お問い合わせください。'
            : 'このリンクは正しくないか、すでに無効化されています。'}
        </p>
        <button
          onClick={() => navigate('/')}
          className="bg-teal-600 hover:bg-teal-700 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          トップページへ
        </button>
      </div>
    </div>
  );
}
