import { MockAppShell } from './MockAppShell';
import { Search, Ticket, FolderKanban, Users, MessageSquare, X } from 'lucide-react';

const results = {
  tickets: [
    { id: 'EC-0011', title: 'カート機能のフロントエンド実装', project: 'ECサイトリニューアル', status: '進行中', sC: '#0284C7' },
    { id: 'EC-0012', title: 'カート在庫バリデーション追加',   project: 'ECサイトリニューアル', status: '未着手',   sC: '#6B7280' },
    { id: 'AP-0003', title: 'カートUIのモバイル対応',         project: 'モバイルアプリ開発',   status: '進行中',   sC: '#0284C7' },
  ],
  projects: [
    { id: 'P-001', name: 'ECサイトリニューアル', client: '株式会社サンプル商事', status: '進行中', sC: '#059669' },
  ],
  members: [
    { name: '田中太郎', role: 'アドミン', email: 'tanaka@example.com', init: '田', color: '#059669' },
  ],
  comments: [
    { ticket: 'EC-0011', preview: 'カート機能の実装を確認しました。在庫...', author: '山田一郎', init: '山', color: '#D97706' },
  ],
};

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockGlobalSearch() {
  return (
    <MockAppShell activePage="dashboard">
      {/* Overlay */}
      <div style={s({ position: 'absolute', inset: 0, background: 'rgba(15,20,25,0.55)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: 60, zIndex: 50 })}>
        <div style={s({ width: '80%', maxWidth: 560, background: '#FFFFFF', borderRadius: 14, boxShadow: '0 24px 60px rgba(0,0,0,0.25)', overflow: 'hidden' })}>
          {/* Search input */}
          <div style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid rgba(26,23,20,0.08)' })}>
            <Search style={{ width: 16, height: 16, color: '#059669', flexShrink: 0 }} />
            <span style={s({ flex: 1, fontSize: 13, color: '#1A1714', fontWeight: 600 })}>カート</span>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 4 })}>
              <span style={s({ fontSize: 9, background: '#F4F5F6', color: '#9E9690', borderRadius: 5, padding: '2px 6px', fontWeight: 600 })}>ESC</span>
              <X style={{ width: 14, height: 14, color: '#B0A9A4', cursor: 'pointer' }} />
            </div>
          </div>

          {/* Results */}
          <div style={s({ padding: '6px 0', maxHeight: 380, overflow: 'hidden' })}>
            {/* Tickets */}
            <div style={s({ padding: '4px 16px 2px', fontSize: 8, fontWeight: 700, color: '#B0A9A4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 })}>
              <Ticket style={{ width: 9, height: 9 }} />チケット ({results.tickets.length}件)
            </div>
            {results.tickets.map(t => (
              <div key={t.id} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', cursor: 'pointer' })}
                onMouseEnter={e => (e.currentTarget.style.background = '#F9FAFB')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                <div style={s({ width: 24, height: 24, borderRadius: 7, background: '#EFF6FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
                  <Ticket style={{ width: 11, height: 11, color: '#0284C7' }} />
                </div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ fontSize: 10, fontWeight: 600, color: '#1A1714', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{t.title}</div>
                  <div style={s({ fontSize: 8, color: '#B0A9A4' })}>{t.id} · {t.project}</div>
                </div>
                <span style={s({ fontSize: 8, fontWeight: 600, color: t.sC, background: `${t.sC}15`, borderRadius: 20, padding: '1px 6px', flexShrink: 0 })}>{t.status}</span>
              </div>
            ))}

            <div style={s({ margin: '4px 16px', height: 1, background: 'rgba(26,23,20,0.06)' })} />

            {/* Projects */}
            <div style={s({ padding: '4px 16px 2px', fontSize: 8, fontWeight: 700, color: '#B0A9A4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 })}>
              <FolderKanban style={{ width: 9, height: 9 }} />プロジェクト ({results.projects.length}件)
            </div>
            {results.projects.map(p => (
              <div key={p.id} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', cursor: 'pointer' })}>
                <div style={s({ width: 24, height: 24, borderRadius: 7, background: '#ECFDF5', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
                  <FolderKanban style={{ width: 11, height: 11, color: '#059669' }} />
                </div>
                <div style={s({ flex: 1 })}>
                  <div style={s({ fontSize: 10, fontWeight: 600, color: '#1A1714' })}>{p.name}</div>
                  <div style={s({ fontSize: 8, color: '#B0A9A4' })}>{p.client}</div>
                </div>
                <span style={s({ fontSize: 8, fontWeight: 600, color: p.sC, background: `${p.sC}15`, borderRadius: 20, padding: '1px 6px' })}>{p.status}</span>
              </div>
            ))}

            <div style={s({ margin: '4px 16px', height: 1, background: 'rgba(26,23,20,0.06)' })} />

            {/* Members */}
            <div style={s({ padding: '4px 16px 2px', fontSize: 8, fontWeight: 700, color: '#B0A9A4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 })}>
              <Users style={{ width: 9, height: 9 }} />メンバー ({results.members.length}件)
            </div>
            {results.members.map(m => (
              <div key={m.name} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', cursor: 'pointer' })}>
                <div style={s({ width: 24, height: 24, borderRadius: 12, background: m.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{m.init}</div>
                <div>
                  <div style={s({ fontSize: 10, fontWeight: 600, color: '#1A1714' })}>{m.name}</div>
                  <div style={s({ fontSize: 8, color: '#B0A9A4' })}>{m.email}</div>
                </div>
                <span style={s({ marginLeft: 'auto', fontSize: 8, fontWeight: 600, color: '#7C3AED', background: '#F5F3FF', borderRadius: 20, padding: '1px 6px' })}>{m.role}</span>
              </div>
            ))}

            <div style={s({ margin: '4px 16px', height: 1, background: 'rgba(26,23,20,0.06)' })} />

            {/* Comments */}
            <div style={s({ padding: '4px 16px 2px', fontSize: 8, fontWeight: 700, color: '#B0A9A4', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 })}>
              <MessageSquare style={{ width: 9, height: 9 }} />コメント ({results.comments.length}件)
            </div>
            {results.comments.map((c, i) => (
              <div key={i} style={s({ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', cursor: 'pointer' })}>
                <div style={s({ width: 24, height: 24, borderRadius: 12, background: c.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>{c.init}</div>
                <div style={s({ flex: 1, minWidth: 0 })}>
                  <div style={s({ fontSize: 8, color: '#B0A9A4' })}>{c.ticket} · {c.author}</div>
                  <div style={s({ fontSize: 10, color: '#3D3732', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{c.preview}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div style={s({ padding: '6px 16px', borderTop: '1px solid rgba(26,23,20,0.06)', display: 'flex', gap: 12, fontSize: 8, color: '#B0A9A4' })}>
            <span>↑↓ 選択</span>
            <span>↵ 開く</span>
            <span>ESC 閉じる</span>
          </div>
        </div>
      </div>
    </MockAppShell>
  );
}
