import { MockAppShell } from './MockAppShell';
import { ListPlus, ChevronRight, Trash2, Plus, Save } from 'lucide-react';

const rows = [
  { title: 'ログイン画面のUI実装',             assignee: '鈴木花子', priority: '高', due: '06/10', hours: '8'  },
  { title: 'ユーザープロフィール編集機能',       assignee: '田中太郎', priority: '中', due: '06/12', hours: '6'  },
  { title: 'パスワードリセットメール送信',       assignee: '佐藤健',   priority: '中', due: '06/11', hours: '4'  },
  { title: 'セッション管理・ログアウト処理',     assignee: '山田一郎', priority: '高', due: '06/09', hours: '10' },
  { title: 'ソーシャルログイン（Google）対応', assignee: '伊藤美咲', priority: '低', due: '06/14', hours: '12' },
];

const members = ['田中太郎', '鈴木花子', '佐藤健', '山田一郎', '伊藤美咲'];
const priorities = ['高', '中', '低'];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockBulkCreate() {
  return (
    <MockAppShell activePage="projects">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8, background: '#F9FAFB', boxSizing: 'border-box' })}>
        <div style={s({ display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
          <span style={s({ color: '#059669', fontWeight: 600 })}>ECサイトリニューアル · スプリント2</span>
          <ChevronRight style={{ width: 10, height: 10 }} />
          <span>チケット一括作成</span>
        </div>

        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div style={s({ display: 'flex', alignItems: 'center', gap: 8 })}>
            <div style={s({ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg, #34D399, #059669)', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
              <ListPlus style={{ width: 15, height: 15, color: '#fff' }} />
            </div>
            <div>
              <h1 style={s({ fontSize: 14, fontWeight: 800, color: '#1A1714', margin: 0 })}>チケット一括作成</h1>
              <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '1px 0 0' })}>{rows.length}件のチケットを入力中</p>
            </div>
          </div>
          <div style={s({ display: 'flex', gap: 6 })}>
            <button style={s({ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, border: '1px solid rgba(26,23,20,0.10)', background: '#FFFFFF', color: '#6B7280', cursor: 'pointer' })}>
              <Plus style={{ width: 11, height: 11 }} />行を追加
            </button>
            <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer' })}>
              <Save style={{ width: 11, height: 11 }} />一括登録 ({rows.length}件)
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column' })}>
          {/* Header */}
          <div style={s({ display: 'grid', gridTemplateColumns: '28px 1fr 100px 60px 70px 50px 28px', padding: '6px 12px', background: '#F9FAFB', borderBottom: '1px solid rgba(26,23,20,0.07)', gap: 8, alignItems: 'center' })}>
            <span style={s({ fontSize: 8, fontWeight: 700, color: '#9E9690', textAlign: 'center' })}>#</span>
            {['タイトル', '担当者', '優先度', '期限', '工数(h)', ''].map(h => (
              <span key={h} style={s({ fontSize: 8, fontWeight: 700, color: '#9E9690' })}>{h}</span>
            ))}
          </div>

          {/* Rows */}
          <div style={s({ flex: 1, overflow: 'hidden' })}>
            {rows.map((r, i) => (
              <div key={i} style={s({ display: 'grid', gridTemplateColumns: '28px 1fr 100px 60px 70px 50px 28px', padding: '6px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', gap: 8, alignItems: 'center', background: i % 2 === 0 ? '#FFFFFF' : '#FAFAFA' })}>
                <span style={s({ fontSize: 9, color: '#B0A9A4', fontWeight: 600, textAlign: 'center' })}>{i + 1}</span>

                {/* Title input */}
                <div style={s({ background: '#F9FAFB', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#1A1714', cursor: 'text' })}>{r.title}</div>

                {/* Assignee select */}
                <div style={s({ background: '#F9FAFB', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#3D3732', cursor: 'pointer' })}>
                  {r.assignee}
                </div>

                {/* Priority */}
                <div style={s({ background: '#F9FAFB', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: r.priority === '高' ? '#DC2626' : r.priority === '中' ? '#D97706' : '#6B7280', fontWeight: 700, cursor: 'pointer' })}>
                  {r.priority}
                </div>

                {/* Due date */}
                <div style={s({ background: '#F9FAFB', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#6B7280', cursor: 'pointer' })}>{r.due}</div>

                {/* Hours */}
                <div style={s({ background: '#F9FAFB', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 6, padding: '4px 8px', fontSize: 9, color: '#6B7280', textAlign: 'center', cursor: 'text' })}>{r.hours}</div>

                {/* Delete */}
                <button style={s({ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                  <Trash2 style={{ width: 11, height: 11, color: '#C9C4BB' }} />
                </button>
              </div>
            ))}

            {/* Add row hint */}
            <div style={s({ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', cursor: 'pointer', color: '#B0A9A4' })}>
              <Plus style={{ width: 11, height: 11 }} />
              <span style={s({ fontSize: 9 })}>行を追加してチケットを入力...</span>
            </div>
          </div>
        </div>

        {/* Summary bar */}
        <div style={s({ background: '#1A1714', borderRadius: 8, padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 16 })}>
          <span style={s({ fontSize: 9, color: '#9E9690' })}>合計 <span style={s({ color: '#34D399', fontWeight: 700 })}>{rows.length}件</span> のチケット</span>
          <span style={s({ fontSize: 9, color: '#9E9690' })}>合計工数 <span style={s({ color: '#34D399', fontWeight: 700 })}>{rows.reduce((a, r) => a + Number(r.hours), 0)}h</span></span>
          <span style={s({ marginLeft: 'auto', fontSize: 9, color: '#6B7280' })}>担当者未設定: 0件</span>
        </div>
      </div>
    </MockAppShell>
  );
}
