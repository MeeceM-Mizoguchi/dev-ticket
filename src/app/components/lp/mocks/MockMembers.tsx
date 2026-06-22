import { MockAppShell } from './MockAppShell';
import { Plus, Pencil, Trash2 } from 'lucide-react';

const members = [
  { name: '田中太郎', email: 'tanaka@example.com', roleLabel: 'アドミン', rC: '#F43F5E', group: '管理グループ', status: 'アクティブ', sC: '#059669', projects: 3, tickets: 12, initials: '田', ac: '#059669' },
  { name: '鈴木花子', email: 'suzuki@example.com', roleLabel: 'デベロッパー', rC: '#0284C7', group: '開発チーム',   status: 'アクティブ', sC: '#059669', projects: 2, tickets: 8,  initials: '鈴', ac: '#0284C7' },
  { name: '佐藤健',   email: 'sato@example.com',   roleLabel: 'デザイナー',   rC: '#7C3AED', group: 'デザインチーム', status: 'アクティブ', sC: '#059669', projects: 2, tickets: 5,  initials: '佐', ac: '#7C3AED' },
  { name: '山田一郎', email: 'yamada@example.com', roleLabel: 'PMO',         rC: '#059669', group: '管理グループ', status: 'アクティブ', sC: '#059669', projects: 4, tickets: 3,  initials: '山', ac: '#D97706' },
  { name: '伊藤美咲', email: 'ito@example.com',    roleLabel: 'デベロッパー', rC: '#0284C7', group: '開発チーム',   status: 'アクティブ', sC: '#059669', projects: 1, tickets: 6,  initials: '伊', ac: '#F43F5E' },
  { name: '渡辺誠',   email: 'watanabe@example.com', roleLabel: 'デベロッパー', rC: '#0284C7', group: '開発チーム', status: '招待中', sC: '#D97706', projects: 0, tickets: 0, initials: '渡', ac: '#6B7280' },
];

const tabs = ['すべて 6','アドミン 1','PMO 1','デベロッパー 3','デザイナー 1'];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockMembers() {
  return (
    <MockAppShell activePage="members">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, background: '#F9FAFB', boxSizing: 'border-box' })}>

        {/* Title */}
        <div style={s({ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' })}>
          <div>
            <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>メンバー管理</h1>
            <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>全6名 · アクティブ5名</p>
          </div>
          <button style={s({ display: 'flex', alignItems: 'center', gap: 4, background: '#059669', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 10px', fontSize: 10, fontWeight: 600, cursor: 'pointer' })}>
            <Plus style={{ width: 11, height: 11 }} />メンバー招待
          </button>
        </div>

        {/* Search + tabs */}
        <div style={s({ display: 'flex', alignItems: 'center', gap: 6 })}>
          <div style={s({ background: '#FFFFFF', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '5px 10px', fontSize: 10, color: '#B0A9A4', minWidth: 140 })}>名前、メールで検索...</div>
          <div style={s({ display: 'flex', gap: 4 })}>
            {tabs.map((t, i) => (
              <button key={t} style={s({ padding: '4px 10px', borderRadius: 8, fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer', background: i === 0 ? '#059669' : '#FFFFFF', color: i === 0 ? '#fff' : '#9E9690', boxShadow: i === 0 ? 'none' : '0 0 0 1px rgba(26,23,20,0.10)' })}>{t}</button>
            ))}
          </div>
        </div>

        {/* Cards */}
        <div style={s({ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, flex: 1, overflow: 'hidden' })}>
          {members.map(m => (
            <div key={m.email} style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', padding: '12px', display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.04)', cursor: 'pointer' })}>
              {/* Header */}
              <div style={s({ display: 'flex', alignItems: 'flex-start', gap: 10 })}>
                <div style={s({ width: 36, height: 36, borderRadius: 18, background: m.ac, color: '#fff', fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{m.initials}</div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' })}>
                    <span style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>{m.name}</span>
                    <span style={s({ fontSize: 8, fontWeight: 700, color: m.rC, background: `${m.rC}15`, borderRadius: 20, padding: '1px 6px' })}>{m.roleLabel}</span>
                  </div>
                  <div style={s({ fontSize: 9, color: '#B0A9A4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{m.email}</div>
                  <div style={s({ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 })}>
                    <span style={s({ fontSize: 8, fontWeight: 600, color: m.sC, background: `${m.sC}15`, borderRadius: 20, padding: '1px 6px' })}>{m.status}</span>
                    <span style={s({ fontSize: 8, color: '#B0A9A4' })}>{m.group}</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div style={s({ display: 'flex', gap: 16, paddingTop: 8, borderTop: '1px solid rgba(26,23,20,0.05)' })}>
                <div>
                  <div style={s({ fontSize: 14, fontWeight: 800, color: '#1A1714' })}>{m.projects}</div>
                  <div style={s({ fontSize: 8, color: '#B0A9A4' })}>プロジェクト</div>
                </div>
                <div>
                  <div style={s({ fontSize: 14, fontWeight: 800, color: '#1A1714' })}>{m.tickets}</div>
                  <div style={s({ fontSize: 8, color: '#B0A9A4' })}>チケット</div>
                </div>
              </div>

              {/* Actions */}
              <div style={s({ display: 'flex', gap: 6 })}>
                <button style={s({ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 9, fontWeight: 600, color: '#6B7280', background: 'none', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 7, padding: '5px 0', cursor: 'pointer' })}>
                  <Pencil style={{ width: 9, height: 9 }} />詳細
                </button>
                <button style={s({ width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'none', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 7, cursor: 'pointer' })}>
                  <Trash2 style={{ width: 9, height: 9, color: '#C9C4BB' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MockAppShell>
  );
}
