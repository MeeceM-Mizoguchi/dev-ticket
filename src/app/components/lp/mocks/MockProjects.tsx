import { Building2, Calendar, CheckCircle2, Circle, Clock, Columns, LayoutGrid, MoreHorizontal, Plus, Search, Zap } from 'lucide-react';
import { MockAppShell } from './MockAppShell';

type Status = 'in-progress' | 'planning' | 'completed' | 'on-hold';

const statusMeta: Record<Status, { label: string; dotColor: string; badgeBg: string; badgeColor: string }> = {
  'in-progress': { label: '進行中', dotColor: '#FB923C', badgeBg: '#ECFDF5', badgeColor: '#059669' },
  'planning':    { label: '計画中', dotColor: '#C9C4BB', badgeBg: '#F4F5F6', badgeColor: '#A09790' },
  'completed':   { label: '完了',   dotColor: '#10B981', badgeBg: '#ECFDF5', badgeColor: '#059669' },
  'on-hold':     { label: '保留中', dotColor: '#F59E0B', badgeBg: '#FFFBEB', badgeColor: '#D97706' },
};

const AVATAR_COLORS = ['#059669', '#D97706', '#059669', '#0284C7', '#7C3AED', '#DB2777'];
const avatarColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

const projects: {
  id: string; name: string; client: string; status: Status; desc: string;
  done: number; inP: number; todo: number; progress: number;
  hours: string; hoursGt0: boolean; start: string; end: string; members: string[];
}[] = [
  { id: 'P-001', name: 'ECサイトリニューアル',    client: '株式会社サンプル商事',     status: 'in-progress', desc: 'オンラインショップのUI刷新とAPI連携', done: 8,  inP: 5,  todo: 12, progress: 32, hours: '24.5h', hoursGt0: true,  start: '05/01', end: '07/31', members: ['田中','鈴木','佐藤','山田','伊藤'] },
  { id: 'P-002', name: 'モバイルアプリ開発',      client: 'テクノ株式会社',           status: 'in-progress', desc: '',                                   done: 15, inP: 8,  todo: 6,  progress: 52, hours: '48.2h', hoursGt0: true,  start: '04/15', end: '08/15', members: ['伊藤','田中'] },
  { id: 'P-003', name: '社内システム改修',        client: 'ビジネス合同会社',         status: 'planning',    desc: '',                                   done: 0,  inP: 0,  todo: 0,  progress: 0,  hours: '0h',    hoursGt0: false, start: '',      end: '',      members: ['佐藤','山田','伊藤','鈴木'] },
  { id: 'P-004', name: 'APIゲートウェイ構築',    client: 'クラウドサービス株式会社', status: 'in-progress', desc: '',                                   done: 3,  inP: 2,  todo: 8,  progress: 8,  hours: '6.3h',  hoursGt0: true,  start: '05/31', end: '06/30', members: ['田中','鈴木','佐藤'] },
  { id: 'P-005', name: 'データ分析基盤構築',     client: 'アナリティクス株式会社',   status: 'planning',    desc: '',                                   done: 2,  inP: 1,  todo: 14, progress: 0,  hours: '3.0h',  hoursGt0: true,  start: '06/01', end: '09/30', members: ['山田','伊藤'] },
];

const filters = [
  { label: 'すべて',  count: 5, active: true },
  { label: '進行中', count: 3, active: false },
  { label: '計画中', count: 2, active: false },
  { label: '保留中', count: 0, active: false },
  { label: '完了',   count: 0, active: false },
];

export function MockProjects() {
  return (
    <MockAppShell activePage="projects">
      {/* 外側: flex列で高さ固定、overflowはhidden */}
      <div style={{ padding: '20px 24px 16px', height: '100%', display: 'flex', flexDirection: 'column', background: '#F9FAFB', boxSizing: 'border-box', overflow: 'hidden' }}>

        {/* Header (固定) */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14, flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: 14, fontWeight: 800, color: '#1A1714', letterSpacing: '-0.02em', margin: 0 }}>プロジェクト管理</h1>
            <p style={{ fontSize: 9, color: '#A09790', margin: '2px 0 0' }}>進行中のプロジェクトとスプリント</p>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <div style={{ display: 'flex', gap: 2, background: '#F4F5F6', borderRadius: 9, padding: 3 }}>
              <button style={{ padding: '4px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, background: '#FFFFFF', color: '#1A1714', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                <LayoutGrid style={{ width: 9, height: 9 }} />グリッド
              </button>
              <button style={{ padding: '4px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 9, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, background: 'transparent', color: '#A09790' }}>
                <Columns style={{ width: 9, height: 9 }} />ボード
              </button>
            </div>
            <button style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', background: '#059669', color: '#fff', fontSize: 9, fontWeight: 600, borderRadius: 9, border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(5,150,105,0.25)' }}>
              <Plus style={{ width: 10, height: 10 }} />新規プロジェクト
            </button>
          </div>
        </div>

        {/* Search + Filters (固定) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', width: 9, height: 9, color: '#B0A9A4' }} />
            <div style={{ background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 9, padding: '5px 10px 5px 22px', fontSize: 9, color: '#B0A9A4' }}>
              名前、クライアントで検索...
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {filters.map(f => (
              <button key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '4px 8px', fontSize: 9, fontWeight: 500, borderRadius: 8, border: '1px solid', cursor: 'pointer', background: f.active ? '#059669' : '#FFFFFF', color: f.active ? '#fff' : '#6B6458', borderColor: f.active ? '#059669' : 'rgba(26,23,20,0.10)' }}>
                {f.label}<span style={{ fontSize: 7, opacity: 0.7 }}>{f.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* グリッドエリア */}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {projects.slice(0, 2).map(p => {
              const total = p.done + p.inP + p.todo;
              const meta = statusMeta[p.status];
              const progressColor = p.progress >= 30 ? '#059669' : '#C9C4BB';
              return (
                /* カード: flex・height指定なし → コンテンツの自然な高さ */
                <div key={p.id} style={{ background: '#FFFFFF', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)' }}>
                  <div style={{ height: 5, background: `linear-gradient(90deg, ${meta.dotColor}, ${meta.dotColor}CC)` }} />
                  {/* コンテンツ: flex・flex:1なし → 自然な高さ */}
                  <div style={{ padding: '12px 14px 14px' }}>

                    {/* ヘッダー */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                          <span style={{ fontSize: 7, color: '#B0A9A4' }}>{p.id}</span>
                          <span style={{ fontSize: 7, fontWeight: 600, background: meta.badgeBg, color: meta.badgeColor, padding: '1.5px 5px', borderRadius: 20 }}>{meta.label}</span>
                        </div>
                        <h3 style={{ fontSize: 11, fontWeight: 700, color: '#1A1714', lineHeight: 1.3, margin: '0 0 3px' }}>{p.name}</h3>
                        <p style={{ fontSize: 9, color: '#B0A9A4', display: 'flex', alignItems: 'center', gap: 3, margin: 0 }}>
                          {p.client && <Building2 style={{ width: 8, height: 8, flexShrink: 0 }} />}
                          {p.client}
                        </p>
                      </div>
                      <MoreHorizontal style={{ width: 12, height: 12, color: '#C9C4BB', flexShrink: 0 }} />
                    </div>

                    {/* 説明文 (任意) */}
                    {p.desc && (
                      <p style={{ fontSize: 9, color: '#A09790', lineHeight: 1.6, margin: '0 0 10px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{p.desc}</p>
                    )}

                    {/* 進捗 */}
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                        <span style={{ fontSize: 8, color: '#B0A9A4', fontWeight: 600 }}>進捗</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#3D3732' }}>{p.progress}%</span>
                      </div>
                      <div style={{ height: 4, background: '#EDE9E0', borderRadius: 9999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${p.progress}%`, background: progressColor, borderRadius: 9999 }} />
                      </div>
                      <div style={{ display: 'flex', gap: 9, marginTop: 6 }}>
                        <span style={{ fontSize: 8, color: '#059669', display: 'flex', alignItems: 'center', gap: 2 }}><CheckCircle2 style={{ width: 8, height: 8 }} />{p.done}</span>
                        <span style={{ fontSize: 8, color: '#D97706', display: 'flex', alignItems: 'center', gap: 2 }}><Zap style={{ width: 8, height: 8 }} />{p.inP}</span>
                        <span style={{ fontSize: 8, color: '#C9C4BB', display: 'flex', alignItems: 'center', gap: 2 }}><Circle style={{ width: 8, height: 8 }} />{p.todo}</span>
                        <span style={{ fontSize: 8, color: '#C9C4BB', marginLeft: 'auto' }}>{total}件</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 5 }}>
                        <Clock style={{ width: 8, height: 8, color: '#B0A9A4' }} />
                        <span style={{ fontSize: 8, color: '#B0A9A4', fontWeight: 600 }}>実績工数</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: p.hoursGt0 ? '#059669' : '#B0A9A4' }}>{p.hours}</span>
                      </div>
                    </div>

                    {/* フッター: marginTop:autoなし → 実績工数のすぐ下に配置 */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 9, borderTop: '1px solid rgba(26,23,20,0.05)' }}>
                      <span style={{ fontSize: 8, color: '#B0A9A4', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Calendar style={{ width: 8, height: 8 }} />
                        {p.start ? `${p.start} – ${p.end}` : '— – —'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center' }}>
                        {p.members.slice(0, 4).map((name, i) => (
                          <div key={`${name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -6, border: '1.5px solid #fff', borderRadius: '50%', zIndex: 4 - i, width: 18, height: 18, background: avatarColor(name), display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, fontWeight: 700, color: '#fff', boxSizing: 'border-box' }}>
                            {name.slice(0, 2)}
                          </div>
                        ))}
                        {p.members.length > 4 && (
                          <div style={{ marginLeft: -6, width: 18, height: 18, borderRadius: '50%', background: '#F4F5F6', border: '1.5px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 6, fontWeight: 700, color: '#6B6458', boxSizing: 'border-box' }}>
                            +{p.members.length - 4}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              );
            })}
          </div>
        </div>

      </div>
    </MockAppShell>
  );
}
