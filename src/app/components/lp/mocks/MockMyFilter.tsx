import { MockAppShell } from './MockAppShell';
import { SlidersHorizontal, Bookmark, ChevronRight, X, Plus } from 'lucide-react';

const savedFilters = [
  { name: '自分のチケット', active: true,  conditions: ['担当者: 田中太郎'] },
  { name: '期限超過',       active: false, conditions: ['期限: 過去', 'ステータス: 未完了'] },
  { name: '高優先度未着手', active: false, conditions: ['優先度: 高', 'ステータス: 未着手'] },
  { name: 'レビュー待ち',   active: false, conditions: ['ステータス: レビュー依頼中'] },
];

const tickets = [
  { wbs: 'EC-0001', title: 'トップページのビジュアルデザイン実装', status: '進行中', sC: '#0284C7', priority: '高', pC: '#DC2626', due: '06/05' },
  { wbs: 'EC-0003', title: '商品一覧ページのページネーション',      status: '未着手', sC: '#6B7280', priority: '中', pC: '#D97706', due: '06/06' },
  { wbs: 'EC-0007', title: '決済APIとのインテグレーション',         status: '未着手', sC: '#6B7280', priority: '高', pC: '#DC2626', due: '06/12' },
];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockMyFilter() {
  return (
    <MockAppShell activePage="projects">
      <div style={s({ display: 'flex', height: '100%', overflow: 'hidden' })}>
        {/* Filter sidebar */}
        <div style={s({ width: 200, background: '#FFFFFF', borderRight: '1px solid rgba(26,23,20,0.07)', display: 'flex', flexDirection: 'column', flexShrink: 0 })}>
          <div style={s({ padding: '10px 12px', borderBottom: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 5 })}>
              <Bookmark style={{ width: 11, height: 11, color: '#059669' }} />
              <span style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714' })}>Myフィルタ</span>
            </div>
            <button style={s({ background: 'none', border: 'none', cursor: 'pointer' })}>
              <Plus style={{ width: 11, height: 11, color: '#059669' }} />
            </button>
          </div>
          <div style={s({ flex: 1, overflow: 'hidden' })}>
            {savedFilters.map(f => (
              <div key={f.name} style={s({ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid rgba(26,23,20,0.04)', background: f.active ? '#ECFDF5' : 'transparent', borderLeft: f.active ? '2px solid #059669' : '2px solid transparent' })}>
                <div style={s({ fontSize: 10, fontWeight: f.active ? 700 : 500, color: f.active ? '#059669' : '#3D3732' })}>{f.name}</div>
                <div style={s({ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 3 })}>
                  {f.conditions.map(c => (
                    <span key={c} style={s({ fontSize: 7, color: '#6B7280', background: '#F4F5F6', borderRadius: 4, padding: '1px 5px' })}>{c}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Current filter */}
          <div style={s({ padding: '10px 12px', borderTop: '1px solid rgba(26,23,20,0.06)', background: '#F9FAFB' })}>
            <div style={s({ fontSize: 9, fontWeight: 700, color: '#1A1714', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 })}>
              <SlidersHorizontal style={{ width: 10, height: 10, color: '#059669' }} />適用中
            </div>
            <div style={s({ display: 'flex', flexWrap: 'wrap', gap: 4 })}>
              {['担当者: 田中太郎'].map(c => (
                <span key={c} style={s({ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, fontWeight: 600, color: '#059669', background: '#ECFDF5', borderRadius: 20, padding: '2px 7px', border: '1px solid #059669' })}>
                  {c}<X style={{ width: 8, height: 8 }} />
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div style={s({ flex: 1, background: '#F9FAFB', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' })}>
          <div style={s({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
            <span style={s({ color: '#059669', fontWeight: 600 })}>ECサイトリニューアル</span>
            <ChevronRight style={{ width: 10, height: 10 }} />
            <span>スプリント1</span>
          </div>

          <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
            <div>
              <h1 style={s({ fontSize: 14, fontWeight: 800, color: '#1A1714', margin: 0 })}>スプリント管理</h1>
              <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '1px 0 0' })}>
                フィルタ適用中: <span style={s({ color: '#059669', fontWeight: 600 })}>自分のチケット</span> · {tickets.length}件該当
              </p>
            </div>
            <div style={s({ display: 'flex', gap: 5 })}>
              <button style={s({ padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, border: '1px solid rgba(26,23,20,0.10)', background: '#FFFFFF', color: '#9E9690', cursor: 'pointer' })}>フィルタを保存</button>
              <button style={s({ padding: '5px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, border: '1px solid rgba(26,23,20,0.10)', background: '#FFFFFF', color: '#9E9690', cursor: 'pointer' })}>クリア</button>
            </div>
          </div>

          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden' })}>
            <div style={s({ display: 'grid', gridTemplateColumns: '70px 1fr 70px 50px 60px', padding: '6px 12px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.07)', gap: 8 })}>
              {['WBS', 'タイトル', 'ステータス', '優先度', '期限'].map(h => (
                <span key={h} style={s({ fontSize: 8, fontWeight: 700, color: '#9E9690' })}>{h}</span>
              ))}
            </div>
            {tickets.map(t => (
              <div key={t.wbs} style={s({ display: 'grid', gridTemplateColumns: '70px 1fr 70px 50px 60px', padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', gap: 8, alignItems: 'center', cursor: 'pointer' })}>
                <span style={s({ fontSize: 9, color: '#B0A9A4', fontWeight: 600 })}>{t.wbs}</span>
                <span style={s({ fontSize: 9, color: '#1A1714', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{t.title}</span>
                <span style={s({ fontSize: 8, fontWeight: 700, color: t.sC, background: `${t.sC}15`, borderRadius: 20, padding: '1px 6px', textAlign: 'center' })}>{t.status}</span>
                <span style={s({ fontSize: 8, fontWeight: 700, color: t.pC, textAlign: 'center' })}>{t.priority}</span>
                <span style={s({ fontSize: 9, color: '#6B7280' })}>{t.due}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockAppShell>
  );
}
