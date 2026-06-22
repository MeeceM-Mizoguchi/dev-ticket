import { MockAppShell } from './MockAppShell';
import { FolderOpen, Zap, Clock, TrendingUp, Plus } from 'lucide-react';

const projectBars = [
  { name: 'ECサイトリニューアル', done: 8, inProgress: 5, todo: 12 },
  { name: 'モバイルアプリ開発',   done: 15, inProgress: 8, todo: 6 },
  { name: '社内システム改修',     done: 3,  inProgress: 2, todo: 10 },
  { name: 'APIゲートウェイ構築',  done: 12, inProgress: 10, todo: 9 },
];

const activeTickets = [
  { title: 'カート機能の実装',      status: '進行中', statusColor: '#0284C7', initials: '田', color: '#059669' },
  { title: 'ログイン画面のUI改修',  status: '進行中', statusColor: '#0284C7', initials: '鈴', color: '#0284C7' },
  { title: 'バッチ処理の最適化',    status: '未着手', statusColor: '#6B7280', initials: '佐', color: '#7C3AED' },
  { title: '決済APIの統合テスト',   status: '進行中', statusColor: '#0284C7', initials: '山', color: '#D97706' },
  { title: 'レート制限の実装',      status: '未着手', statusColor: '#6B7280', initials: '伊', color: '#F43F5E' },
];

const projects = [
  { name: 'ECサイトリニューアル', client: '株式会社サンプル商事', progress: 52, status: '進行中', color: '#059669' },
  { name: 'モバイルアプリ開発',   client: 'テクノ株式会社',       progress: 64, status: '進行中', color: '#059669' },
  { name: '社内システム改修',     client: 'ビジネス合同会社',     progress: 20, status: '計画中', color: '#6B7280' },
];

const s = (obj: React.CSSProperties): React.CSSProperties => obj;

export function MockDashboard({ fillHeight }: { fillHeight?: boolean } = {}) {
  const maxTotal = Math.max(...projectBars.map(p => p.done + p.inProgress + p.todo));
  return (
    <MockAppShell activePage="dashboard" fillHeight={fillHeight}>
      <div style={s({ padding: '14px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, background: '#F9FAFB', boxSizing: 'border-box' })}>

        {/* Header */}
        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: 0 })}>2026年6月1日 月曜日</p>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: '2px 0 1px' })}>
              こんにちは、<span style={s({ color: '#059669' })}>田中太郎</span>さん
            </h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: 0 })}>今日のチーム状況 — 6月1日 時点</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' })}>
            <Plus style={{ width: 11, height: 11 }} />新規チケット
          </button>
        </div>

        {/* Summary cards */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 })}>
          {[
            { icon: FolderOpen, label: '進行中プロジェクト', value: '2',   sub: '全4件',    subC: '#B0A9A4', ic: '#059669', ib: '#ECFDF5' },
            { icon: Zap,        label: '進行中チケット',     value: '16',  sub: '期限超過 1件', subC: '#D97706', ic: '#0284C7', ib: '#EFF6FF' },
            { icon: Clock,      label: '未着手チケット',     value: '25',  sub: '全54件',   subC: '#B0A9A4', ic: '#7C3AED', ib: '#F5F3FF' },
            { icon: TrendingUp, label: 'チーム完了率',       value: '52%', sub: '完了 13件', subC: '#059669', ic: '#059669', ib: '#ECFDF5' },
          ].map(({ icon: Icon, label, value, sub, subC, ic, ib }) => (
            <div key={label} style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.06)', padding: '10px 12px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' })}>
              <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 })}>
                <div style={s({ width: 24, height: 24, borderRadius: 7, background: ib, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                  <Icon style={{ width: 13, height: 13, color: ic }} />
                </div>
                <span style={s({ fontSize: 9, fontWeight: 600, color: subC })}>{sub}</span>
              </div>
              <div style={s({ fontSize: 20, fontWeight: 800, color: '#1A1714', lineHeight: 1 })}>{value}</div>
              <div style={s({ fontSize: 9, color: '#9E9690', marginTop: 3 })}>{label}</div>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div style={s({ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 8, flex: 1, minHeight: 0 })}>
          {/* Bar chart */}
          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.06)', padding: '10px 12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
            <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 })}>
              <div>
                <div style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>プロジェクト進捗</div>
                <div style={s({ fontSize: 9, color: '#B0A9A4' })}>ステータス別チケット集計</div>
              </div>
              <div style={s({ display: 'flex', alignItems: 'center', gap: 8 })}>
                {[['#059669','完了'],['#F59E0B','進行中'],['#E5E7EB','未着手']].map(([c,l]) => (
                  <span key={l} style={s({ fontSize: 9, color: '#9E9690', display: 'flex', alignItems: 'center', gap: 3 })}>
                    <span style={s({ width: 7, height: 7, borderRadius: '50%', background: c, display: 'inline-block' })} />{l}
                  </span>
                ))}
              </div>
            </div>
            <div style={s({ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' })}>
              {projectBars.map(p => {
                const total = p.done + p.inProgress + p.todo;
                return (
                  <div key={p.name} style={s({ display: 'flex', alignItems: 'center', gap: 8 })}>
                    <span style={s({ fontSize: 9, color: '#9E9690', width: 90, flexShrink: 0, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' })}>{p.name}</span>
                    <div style={s({ flex: 1, display: 'flex', height: 14, borderRadius: 3, overflow: 'hidden', gap: 1 })}>
                      {p.done > 0    && <div style={s({ width: `${p.done/maxTotal*100}%`,    background: '#059669' })} />}
                      {p.inProgress > 0 && <div style={s({ width: `${p.inProgress/maxTotal*100}%`, background: '#F59E0B' })} />}
                      {p.todo > 0    && <div style={s({ width: `${p.todo/maxTotal*100}%`,    background: '#E5E7EB' })} />}
                    </div>
                    <span style={s({ fontSize: 9, color: '#B0A9A4', width: 20, textAlign: 'right' })}>{total}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Active tickets */}
          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.06)', padding: '10px 12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' })}>
            <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 })}>
              <span style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>アクティブチケット</span>
              <span style={s({ fontSize: 9, background: '#F4F5F6', color: '#9E9690', borderRadius: 20, padding: '2px 6px', fontWeight: 600 })}>{activeTickets.length}件</span>
            </div>
            <div style={s({ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly' })}>
              {activeTickets.map((t, i) => (
                <div key={i} style={s({ display: 'flex', alignItems: 'center', gap: 7, paddingBottom: 5, borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
                  <div style={s({ width: 22, height: 22, borderRadius: 11, background: t.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{t.initials}</div>
                  <div style={s({ minWidth: 0 })}>
                    <div style={s({ fontSize: 10, color: '#1A1714', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 })}>{t.title}</div>
                    <span style={s({ fontSize: 9, fontWeight: 600, color: t.statusColor })}>{t.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Project list */}
        <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.06)', overflow: 'hidden', flexShrink: 0 })}>
          <div style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714', padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>プロジェクト一覧</div>
          {projects.map(p => (
            <div key={p.name} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)' })}>
              <div style={s({ width: 7, height: 7, borderRadius: '50%', background: p.color, flexShrink: 0 })} />
              <div style={s({ flex: 1, minWidth: 0 })}>
                <div style={s({ fontSize: 10, fontWeight: 600, color: '#1A1714', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{p.name}</div>
                <div style={s({ fontSize: 9, color: '#B0A9A4' })}>{p.client}</div>
              </div>
              <div style={s({ width: 80, height: 5, background: '#F4F5F6', borderRadius: 3, overflow: 'hidden', flexShrink: 0 })}>
                <div style={s({ height: '100%', background: '#059669', width: `${p.progress}%`, borderRadius: 3 })} />
              </div>
              <span style={s({ fontSize: 10, color: '#6B7280', width: 28, textAlign: 'right', flexShrink: 0 })}>{p.progress}%</span>
              <span style={s({ fontSize: 9, fontWeight: 600, color: p.color, background: `${p.color}15`, borderRadius: 20, padding: '2px 6px', flexShrink: 0 })}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </MockAppShell>
  );
}
