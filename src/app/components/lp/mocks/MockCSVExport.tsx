import { MockAppShell } from './MockAppShell';
import { Download, CheckCircle, FileText, ChevronRight } from 'lucide-react';

const tickets = [
  { wbs: 'EC-0001', title: 'トップページのビジュアルデザイン実装', status: '完了',   sC: '#059669', priority: '高', assignee: '田中太郎', due: '06/05', hours: 8  },
  { wbs: 'EC-0002', title: 'カート機能のフロントエンド実装',       status: '進行中', sC: '#0284C7', priority: '高', assignee: '鈴木花子', due: '06/08', hours: 16 },
  { wbs: 'EC-0003', title: '商品一覧ページのページネーション',      status: '完了',   sC: '#059669', priority: '中', assignee: '田中太郎', due: '06/06', hours: 4  },
  { wbs: 'EC-0004', title: '検索機能のAPIとの接続',                status: '進行中', sC: '#0284C7', priority: '中', assignee: '佐藤健',   due: '06/09', hours: 8  },
  { wbs: 'EC-0005', title: 'ユーザー認証フローの実装',             status: '未着手', sC: '#6B7280', priority: '高', assignee: '山田一郎', due: '06/07', hours: 12 },
];

const exportFields = ['WBS番号', 'タイトル', 'ステータス', '優先度', '担当者', '期限', '工数(h)'];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockCSVExport() {
  return (
    <MockAppShell activePage="projects">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8, background: '#F9FAFB', boxSizing: 'border-box' })}>
        <div style={s({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
          <span style={s({ color: '#059669', fontWeight: 600 })}>プロジェクト</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>ECサイトリニューアル · スプリント1</span>
        </div>

        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>スプリント管理</h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>5件のチケット</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 5, background: 'linear-gradient(135deg, #059669, #0284C7)', color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(5,150,105,0.35)' })}>
            <Download style={{ width: 12, height: 12 }} />CSVエクスポート
          </button>
        </div>

        {/* Export options panel */}
        <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', padding: '10px 14px', display: 'flex', gap: 16, alignItems: 'flex-start' })}>
          <div style={s({ flex: 1 })}>
            <div style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714', marginBottom: 6 })}>エクスポート項目</div>
            <div style={s({ display: 'flex', flexWrap: 'wrap', gap: 5 })}>
              {exportFields.map(f => (
                <div key={f} style={s({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#3D3732', background: '#F9FAFB', borderRadius: 6, padding: '3px 8px', border: '1px solid rgba(26,23,20,0.08)' })}>
                  <CheckCircle style={{ width: 10, height: 10, color: '#059669' }} />{f}
                </div>
              ))}
            </div>
          </div>
          <div style={s({ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6 })}>
            <div style={s({ fontSize: 9, fontWeight: 600, color: '#6B7280' })}>対象: 全5件</div>
            <div style={s({ display: 'flex', gap: 5 })}>
              <div style={s({ fontSize: 9, fontWeight: 600, color: '#6B7280', background: '#F4F5F6', borderRadius: 6, padding: '3px 8px' })}>フィルタ適用中</div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', flex: 1 })}>
          <div style={s({ display: 'grid', gridTemplateColumns: '70px 1fr 70px 50px 80px 60px 50px', padding: '6px 12px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.07)', gap: 8 })}>
            {['WBS', 'タイトル', 'ステータス', '優先度', '担当者', '期限', '工数'].map(h => (
              <span key={h} style={s({ fontSize: 8, fontWeight: 700, color: '#9E9690', textTransform: 'uppercase' })}>{h}</span>
            ))}
          </div>
          {tickets.map(t => (
            <div key={t.wbs} style={s({ display: 'grid', gridTemplateColumns: '70px 1fr 70px 50px 80px 60px 50px', padding: '7px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', gap: 8, alignItems: 'center' })}>
              <span style={s({ fontSize: 9, color: '#B0A9A4', fontWeight: 600 })}>{t.wbs}</span>
              <span style={s({ fontSize: 9, color: '#1A1714', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{t.title}</span>
              <span style={s({ fontSize: 8, fontWeight: 700, color: t.sC, background: `${t.sC}15`, borderRadius: 20, padding: '1px 6px', textAlign: 'center' })}>{t.status}</span>
              <span style={s({ fontSize: 9, color: '#6B7280', textAlign: 'center' })}>{t.priority}</span>
              <span style={s({ fontSize: 9, color: '#3D3732' })}>{t.assignee}</span>
              <span style={s({ fontSize: 9, color: '#6B7280' })}>{t.due}</span>
              <span style={s({ fontSize: 9, color: '#6B7280', textAlign: 'center' })}>{t.hours}h</span>
            </div>
          ))}
        </div>

        {/* Export complete toast */}
        <div style={s({ position: 'absolute', bottom: 20, right: 20, background: '#1A1714', color: '#fff', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', zIndex: 10 })}>
          <div style={s({ width: 26, height: 26, borderRadius: 8, background: '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
            <FileText style={{ width: 13, height: 13, color: '#fff' }} />
          </div>
          <div>
            <div style={s({ fontSize: 10, fontWeight: 700 })}>CSVエクスポート完了</div>
            <div style={s({ fontSize: 8, color: '#9E9690' })}>sprint1_tickets.csv (5件)</div>
          </div>
          <CheckCircle style={{ width: 14, height: 14, color: '#34D399', marginLeft: 4 }} />
        </div>
      </div>
    </MockAppShell>
  );
}
