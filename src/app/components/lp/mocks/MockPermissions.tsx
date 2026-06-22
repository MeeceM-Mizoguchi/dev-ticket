import { MockAppShell } from './MockAppShell';
import { CheckCircle, XCircle, Plus } from 'lucide-react';

const groups = [
  { name: '管理グループ', color: '#F43F5E', members: ['田', '山'], count: 2 },
  { name: '開発チーム',   color: '#0284C7', members: ['鈴', '伊', '渡'], count: 3 },
  { name: 'デザインチーム', color: '#7C3AED', members: ['佐'], count: 1 },
  { name: 'PMO',         color: '#D97706', members: ['山'], count: 1 },
];

const permissions = [
  { action: 'チケット作成',     admin: true,  pm: true,  dev: true,  design: false },
  { action: 'チケット編集',     admin: true,  pm: true,  dev: true,  design: false },
  { action: 'チケット削除',     admin: true,  pm: true,  dev: false, design: false },
  { action: 'レビュー承認',     admin: true,  pm: true,  dev: false, design: false },
  { action: 'スプリント作成',   admin: true,  pm: true,  dev: false, design: false },
  { action: 'メンバー招待',     admin: true,  pm: false, dev: false, design: false },
  { action: 'プロジェクト設定', admin: true,  pm: true,  dev: false, design: false },
  { action: 'CSVエクスポート',  admin: true,  pm: true,  dev: true,  design: true  },
];

const s = (o: React.CSSProperties): React.CSSProperties => o;
const C = ({ ok }: { ok: boolean }) => ok
  ? <CheckCircle style={{ width: 13, height: 13, color: '#059669' }} />
  : <XCircle style={{ width: 13, height: 13, color: '#E5E7EB' }} />;

export function MockPermissions() {
  return (
    <MockAppShell activePage="permissions">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, background: '#F9FAFB', boxSizing: 'border-box' })}>
        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>権限グループ管理</h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>ロールとグループごとに権限を管理</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' })}>
            <Plus style={{ width: 11, height: 11 }} />グループ追加
          </button>
        </div>

        <div style={s({ display: 'grid', gridTemplateColumns: '2fr 3fr', gap: 10, flex: 1, minHeight: 0 })}>
          {/* Groups */}
          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
            <div style={s({ padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.06)', fontSize: 11, fontWeight: 700, color: '#1A1714' })}>グループ一覧</div>
            <div style={s({ flex: 1, overflow: 'hidden' })}>
              {groups.map((g, i) => (
                <div key={g.name} style={s({ padding: '10px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', display: 'flex', alignItems: 'center', gap: 10, background: i === 1 ? '#F9FAFB' : 'transparent', cursor: 'pointer', borderLeft: i === 1 ? '3px solid #059669' : '3px solid transparent' })}>
                  <div style={s({ width: 30, height: 30, borderRadius: 8, background: `${g.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
                    <span style={s({ fontSize: 11, fontWeight: 800, color: g.color })}>{g.name.slice(0, 1)}</span>
                  </div>
                  <div style={s({ flex: 1, minWidth: 0 })}>
                    <div style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714' })}>{g.name}</div>
                    <div style={s({ display: 'flex', gap: 3, marginTop: 2 })}>
                      {g.members.map(m => (
                        <div key={m} style={s({ width: 16, height: 16, borderRadius: 8, background: g.color, color: '#fff', fontSize: 7, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{m}</div>
                      ))}
                      <span style={s({ fontSize: 8, color: '#B0A9A4', lineHeight: '16px' })}>{g.count}名</span>
                    </div>
                  </div>
                  <span style={s({ width: 8, height: 8, borderRadius: 4, background: g.color, display: 'block', flexShrink: 0 })} />
                </div>
              ))}
            </div>
          </div>

          {/* Permission matrix */}
          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
            <div style={s({ padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.06)', fontSize: 11, fontWeight: 700, color: '#1A1714' })}>権限マトリクス</div>
            <div style={s({ overflow: 'hidden' })}>
              {/* Header */}
              <div style={s({ display: 'grid', gridTemplateColumns: '1fr 70px 70px 70px 70px', padding: '6px 12px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.06)', gap: 4 })}>
                <span style={s({ fontSize: 8, fontWeight: 700, color: '#9E9690' })}>アクション</span>
                {[['#F43F5E','アドミン'],['#D97706','PMO'],['#0284C7','開発者'],['#7C3AED','デザイナー']].map(([c,l]) => (
                  <span key={String(l)} style={s({ fontSize: 8, fontWeight: 700, color: String(c), textAlign: 'center' })}>{String(l)}</span>
                ))}
              </div>
              {permissions.map(p => (
                <div key={p.action} style={s({ display: 'grid', gridTemplateColumns: '1fr 70px 70px 70px 70px', padding: '6px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', gap: 4, alignItems: 'center' })}>
                  <span style={s({ fontSize: 9, color: '#3D3732', fontWeight: 500 })}>{p.action}</span>
                  <div style={s({ display: 'flex', justifyContent: 'center' })}><C ok={p.admin} /></div>
                  <div style={s({ display: 'flex', justifyContent: 'center' })}><C ok={p.pm} /></div>
                  <div style={s({ display: 'flex', justifyContent: 'center' })}><C ok={p.dev} /></div>
                  <div style={s({ display: 'flex', justifyContent: 'center' })}><C ok={p.design} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MockAppShell>
  );
}
