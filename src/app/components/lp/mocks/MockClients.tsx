import { MockAppShell } from './MockAppShell';
import { Plus, Globe, Phone, Building2, MoreHorizontal, Folder } from 'lucide-react';

const clients = [
  { id: 'C-001', name: '株式会社サンプル商事',   industry: '小売・EC',          contact: '山本部長',   email: 'yamamoto@sample.co.jp', phone: '03-1234-5678', projects: 2, active: 1 },
  { id: 'C-002', name: 'テクノ株式会社',         industry: 'IT・ソフトウェア',   contact: '田村CTO',   email: 'tamura@techno.co.jp',   phone: '03-2345-6789', projects: 1, active: 1 },
  { id: 'C-003', name: 'ビジネス合同会社',       industry: 'コンサルティング',   contact: '中村代表',   email: 'nakamura@biz.co.jp',    phone: '03-3456-7890', projects: 1, active: 0 },
  { id: 'C-004', name: 'クラウドサービス株式会社', industry: 'クラウド・インフラ', contact: '松本部長',   email: 'matsumoto@cloud.co.jp', phone: '03-4567-8901', projects: 1, active: 1 },
  { id: 'C-005', name: 'デジタル工房株式会社',   industry: 'デジタルマーケ',     contact: '岡田マネージャー', email: 'okada@digi.co.jp', phone: '03-5678-9012', projects: 0, active: 0 },
  { id: 'C-006', name: '株式会社フューチャーラボ', industry: 'R&D',              contact: '高橋リード', email: 'takahashi@future.co.jp', phone: '03-6789-0123', projects: 0, active: 0 },
];

const ic: Record<string, string> = {
  '小売・EC': '#059669', 'IT・ソフトウェア': '#0284C7', 'コンサルティング': '#7C3AED',
  'クラウド・インフラ': '#0891B2', 'デジタルマーケ': '#D97706', 'R&D': '#F43F5E',
};

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockClients() {
  return (
    <MockAppShell activePage="clients">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, background: '#F9FAFB', boxSizing: 'border-box' })}>
        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>クライアント管理</h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>全6社 · 進行中プロジェクト3件</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' })}>
            <Plus style={{ width: 11, height: 11 }} />新規クライアント
          </button>
        </div>

        <div style={s({ background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '5px 10px', fontSize: 10, color: '#B0A9A4', maxWidth: 280 })}>会社名・担当者で検索...</div>

        <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, flex: 1, overflow: 'hidden' })}>
          {clients.map(c => {
            const color = ic[c.industry] || '#6B7280';
            return (
              <div key={c.id} style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer' })}>
                <div style={s({ height: 3, background: color })} />
                <div style={s({ padding: '10px 12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 7 })}>
                  <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 8 })}>
                      <div style={s({ width: 30, height: 30, borderRadius: 8, background: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
                        <Building2 style={{ width: 14, height: 14, color }} />
                      </div>
                      <div>
                        <div style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714', lineHeight: 1.3 })}>{c.name}</div>
                        <span style={s({ fontSize: 8, fontWeight: 700, color, background: `${color}15`, borderRadius: 20, padding: '1px 5px' })}>{c.industry}</span>
                      </div>
                    </div>
                    <MoreHorizontal style={{ width: 13, height: 13, color: '#C9C4BB' }} />
                  </div>

                  <div style={s({ display: 'flex', flexDirection: 'column', gap: 3 })}>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#6B7280' })}>
                      <Phone style={{ width: 9, height: 9, color: '#B0A9A4' }} />{c.phone}
                    </div>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, color: '#6B7280' })}>
                      <Globe style={{ width: 9, height: 9, color: '#B0A9A4' }} />{c.email}
                    </div>
                  </div>

                  <div style={s({ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, borderTop: '1px solid rgba(26,23,20,0.05)', marginTop: 'auto' })}>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 4 })}>
                      <Folder style={{ width: 10, height: 10, color: '#B0A9A4' }} />
                      <span style={s({ fontSize: 9, color: '#6B7280' })}>{c.projects}件</span>
                    </div>
                    <span style={s({ fontSize: 8, fontWeight: 600, color: c.active > 0 ? '#059669' : '#6B7280', background: c.active > 0 ? '#ECFDF5' : '#F4F5F6', borderRadius: 20, padding: '2px 7px' })}>
                      {c.active > 0 ? `進行中 ${c.active}件` : 'プロジェクトなし'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </MockAppShell>
  );
}
