import { MockAppShell } from './MockAppShell';
import { ChevronRight, CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';

const tickets = [
  { wbs: 'EC-0011', title: 'カート機能のフロントエンド実装', reviewer: '山田一郎', rInit: '山', rC: '#D97706', requester: '鈴木花子', reqInit: '鈴', reqC: '#0284C7', status: 'レビュー依頼中', sC: '#7C3AED', priority: '高', pC: '#DC2626', since: '06/01', comment: 'カートの追加・削除・数量変更の実装完了。APIとの接続も確認済み。' },
  { wbs: 'EC-0012', title: 'ユーザー認証フローの実装',     reviewer: '田中太郎', rInit: '田', rC: '#059669', requester: '佐藤健',   reqInit: '佐', reqC: '#7C3AED', status: '差し戻し',     sC: '#DC2626', priority: '高', pC: '#DC2626', since: '05/30', comment: 'JWTのリフレッシュ処理を再確認してください。' },
  { wbs: 'EC-0013', title: '商品一覧ページネーション',     reviewer: '田中太郎', rInit: '田', rC: '#059669', requester: '田中太郎', reqInit: '田', reqC: '#059669', status: '承認済み',     sC: '#059669', priority: '中', pC: '#D97706', since: '05/28', comment: 'ページ遷移も正常動作。マージ可能。' },
  { wbs: 'EC-0014', title: '決済APIとのインテグレーション', reviewer: '山田一郎', rInit: '山', rC: '#D97706', requester: '伊藤美咲', reqInit: '伊', reqC: '#F43F5E', status: 'レビュー依頼中', sC: '#7C3AED', priority: '高', pC: '#DC2626', since: '06/02', comment: 'Stripe Webhookのエンドポイント実装。テストカードで動作確認済み。' },
  { wbs: 'EC-0015', title: 'レスポンシブデザインの調整',   reviewer: '鈴木花子', rInit: '鈴', rC: '#0284C7', requester: '佐藤健',   reqInit: '佐', reqC: '#7C3AED', status: 'レビュー依頼中', sC: '#7C3AED', priority: '中', pC: '#D97706', since: '06/03', comment: 'モバイル・タブレット・デスクトップ各サイズで確認済み。' },
];

const statusIcon = (s: string) => {
  if (s === '承認済み') return <CheckCircle style={{ width: 10, height: 10, color: '#059669' }} />;
  if (s === '差し戻し') return <XCircle style={{ width: 10, height: 10, color: '#DC2626' }} />;
  return <Clock style={{ width: 10, height: 10, color: '#7C3AED' }} />;
};

const ss = (o: React.CSSProperties): React.CSSProperties => o;

export function MockReviewFlow() {
  return (
    <MockAppShell activePage="projects">
      <div style={ss({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8, background: '#F9FAFB', boxSizing: 'border-box' })}>
        <div style={ss({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
          <span style={ss({ color: '#059669', fontWeight: 600 })}>プロジェクト</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>ECサイトリニューアル</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>レビュー管理</span>
        </div>

        <div style={ss({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={ss({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>レビューフロー</h1>
            <p style={ss({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>レビュー依頼中 3件 · 承認済み 1件 · 差し戻し 1件</p>
          </div>
          <div style={ss({ display: 'flex', gap: 6 })}>
            {[['#7C3AED','依頼中 3'],['#059669','承認 1'],['#DC2626','差戻 1']].map(([c,l]) => (
              <span key={String(l)} style={ss({ fontSize: 8, fontWeight: 700, color: String(c), background: `${String(c)}15`, borderRadius: 20, padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 3 })}>
                <AlertCircle style={{ width: 8, height: 8 }} />{String(l)}
              </span>
            ))}
          </div>
        </div>

        <div style={ss({ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'hidden' })}>
          {tickets.map(t => (
            <div key={t.wbs} style={ss({ background: '#FFFFFF', borderRadius: 10, border: `1px solid ${t.sC}30`, padding: '10px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer' })}>
              <div style={ss({ display: 'flex', alignItems: 'flex-start', gap: 10 })}>
                <div style={ss({ flex: 1, minWidth: 0 })}>
                  <div style={ss({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 })}>
                    <span style={ss({ fontSize: 8, color: '#B0A9A4', fontWeight: 600 })}>{t.wbs}</span>
                    <span style={ss({ fontSize: 8, fontWeight: 700, color: t.pC, background: `${t.pC}15`, borderRadius: 20, padding: '1px 5px' })}>優先度:{t.priority}</span>
                    <div style={ss({ display: 'flex', alignItems: 'center', gap: 3 })}>
                      {statusIcon(t.status)}
                      <span style={ss({ fontSize: 8, fontWeight: 700, color: t.sC })}>{t.status}</span>
                    </div>
                  </div>
                  <div style={ss({ fontSize: 11, fontWeight: 700, color: '#1A1714', marginBottom: 4 })}>{t.title}</div>
                  <div style={ss({ fontSize: 9, color: '#6B7280', background: '#F9FAFB', borderRadius: 6, padding: '4px 8px', borderLeft: `2px solid ${t.sC}` })}>
                    {t.comment}
                  </div>
                </div>

                <div style={ss({ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', flexShrink: 0 })}>
                  <div style={ss({ display: 'flex', alignItems: 'center', gap: 6 })}>
                    <div style={ss({ textAlign: 'center' })}>
                      <div style={ss({ fontSize: 7, color: '#B0A9A4', marginBottom: 1 })}>依頼者</div>
                      <div style={ss({ display: 'flex', alignItems: 'center', gap: 3 })}>
                        <div style={ss({ width: 18, height: 18, borderRadius: 9, background: t.reqC, color: '#fff', fontSize: 7, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{t.reqInit}</div>
                        <span style={ss({ fontSize: 9, color: '#3D3732', fontWeight: 600 })}>{t.requester}</span>
                      </div>
                    </div>
                    <span style={ss({ fontSize: 10, color: '#C9C4BB' })}>→</span>
                    <div style={ss({ textAlign: 'center' })}>
                      <div style={ss({ fontSize: 7, color: '#B0A9A4', marginBottom: 1 })}>レビュアー</div>
                      <div style={ss({ display: 'flex', alignItems: 'center', gap: 3 })}>
                        <div style={ss({ width: 18, height: 18, borderRadius: 9, background: t.rC, color: '#fff', fontSize: 7, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{t.rInit}</div>
                        <span style={ss({ fontSize: 9, color: '#3D3732', fontWeight: 600 })}>{t.reviewer}</span>
                      </div>
                    </div>
                  </div>
                  {t.status === 'レビュー依頼中' && (
                    <div style={ss({ display: 'flex', gap: 5 })}>
                      <button style={ss({ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', borderRadius: 7, fontSize: 9, fontWeight: 700, background: '#ECFDF5', color: '#059669', border: '1px solid #059669', cursor: 'pointer' })}>
                        <CheckCircle style={{ width: 9, height: 9 }} />承認
                      </button>
                      <button style={ss({ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 10px', borderRadius: 7, fontSize: 9, fontWeight: 700, background: '#FEF2F2', color: '#DC2626', border: '1px solid #DC2626', cursor: 'pointer' })}>
                        <XCircle style={{ width: 9, height: 9 }} />差し戻し
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockAppShell>
  );
}
