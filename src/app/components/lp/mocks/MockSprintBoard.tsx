import { MockAppShell } from './MockAppShell';
import { List, LayoutGrid, BarChart2, ChevronRight, Plus } from 'lucide-react';

const columns = [
  { label: '未着手',   count: 5, color: '#6B7280', cards: [
    { id: 'EC-0003', initials: '田', ac: '#059669', priority: '中', pc: '#D97706' },
    { id: 'EC-0005', initials: '山', ac: '#D97706', priority: '高', pc: '#DC2626' },
    { id: 'EC-0006', initials: '伊', ac: '#F43F5E', priority: '低', pc: '#6B7280' },
    { id: 'EC-0007', initials: '田', ac: '#059669', priority: '高', pc: '#DC2626' },
    { id: 'EC-0008', initials: '鈴', ac: '#0284C7', priority: '中', pc: '#D97706' },
  ]},
  { label: '進行中',   count: 3, color: '#0284C7', cards: [
    { id: 'EC-0001', initials: '田', ac: '#059669', priority: '高', pc: '#DC2626' },
    { id: 'EC-0002', initials: '鈴', ac: '#0284C7', priority: '高', pc: '#DC2626' },
    { id: 'EC-0004', initials: '佐', ac: '#7C3AED', priority: '中', pc: '#D97706' },
  ]},
  { label: 'レビュー中',  count: 0, color: '#7C3AED', cards: [] },
  { label: 'レビュー完了', count: 0, color: '#059669', cards: [] },
  { label: 'STG完了',     count: 0, color: '#D97706', cards: [] },
  { label: 'UAT完了',     count: 0, color: '#F59E0B', cards: [] },
  { label: '完了',        count: 0, color: '#10B981', cards: [] },
  { label: 'クローズ',    count: 0, color: '#374151', cards: [] },
];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockSprintBoard() {
  return (
    <MockAppShell activePage="projects">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8, background: '#F9FAFB', boxSizing: 'border-box' })}>

        {/* Breadcrumb */}
        <div style={s({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
          <span style={s({ color: '#059669', fontWeight: 600 })}>プロジェクト</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>ECサイトリニューアル</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>スプリント</span>
        </div>

        {/* Title */}
        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>スプリント管理</h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>ECサイトリニューアル・1スプリント</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' })}>
            <Plus style={{ width: 11, height: 11 }} />新規スプリント
          </button>
        </div>

        {/* Tabs */}
        <div style={s({ display: 'flex', gap: 4 })}>
          {[{ Icon: List, label: 'リスト', active: false }, { Icon: LayoutGrid, label: 'ボード', active: true }, { Icon: BarChart2, label: 'ガントチャート', active: false }].map(({ Icon, label, active }) => (
            <button key={label} style={s({ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer', background: active ? '#059669' : '#FFFFFF', color: active ? '#fff' : '#9E9690', boxShadow: active ? 'none' : '0 0 0 1px rgba(26,23,20,0.10)' })}>
              <Icon style={{ width: 11, height: 11 }} />{label}
            </button>
          ))}
        </div>

        {/* Sprint label */}
        <div style={s({ borderBottom: '2px solid #059669', paddingBottom: 6, flexShrink: 0 })}>
          <span style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>第1スプリント — フロントエンド基盤構築</span>
          <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>ECサイトのフロントエンド部分をReactで構築し、APIとの接続を完了する</p>
          <div style={s({ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4, fontSize: 9 })}>
            <span style={s({ color: '#9E9690' })}>05/31 → 06/12</span>
            <span style={s({ color: '#059669', fontWeight: 600 })}>詳細</span>
            <span style={s({ color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 2 })}><Plus style={{ width: 9, height: 9 }} />新規チケット</span>
          </div>
        </div>

        {/* Kanban columns */}
        <div style={s({ display: 'flex', gap: 8, overflow: 'hidden', flex: 1 })}>
          {columns.map(col => (
            <div key={col.label} style={s({ flex: col.cards.length > 0 ? '0 0 120px' : '0 0 90px', display: 'flex', flexDirection: 'column' })}>
              {/* Column header */}
              <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexShrink: 0 })}>
                <span style={s({ fontSize: 10, fontWeight: 700, color: col.color })}>{col.label}</span>
                <span style={s({ fontSize: 9, color: '#B0A9A4', background: '#F4F5F6', borderRadius: 10, padding: '1px 5px', fontWeight: 600 })}>{col.count}</span>
              </div>
              {/* Cards */}
              <div style={s({ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, overflow: 'hidden' })}>
                {col.cards.map(card => (
                  <div key={card.id} style={s({ background: '#FFFFFF', borderRadius: 8, border: '1px solid rgba(26,23,20,0.07)', padding: '8px 10px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', cursor: 'pointer' })}>
                    <div style={s({ fontSize: 9, fontFamily: 'monospace', color: '#6B7280', marginBottom: 6 })}>{card.id}</div>
                    <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
                      <div style={s({ width: 20, height: 20, borderRadius: 10, background: card.ac, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>{card.initials}</div>
                      <span style={s({ fontSize: 9, fontWeight: 700, color: card.pc })}>{card.priority}</span>
                    </div>
                  </div>
                ))}
                {col.cards.length === 0 && (
                  <div style={s({ fontSize: 9, color: '#D1D5DB', textAlign: 'center', padding: '12px 0' })}>なし</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockAppShell>
  );
}
