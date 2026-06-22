import { MockAppShell } from './MockAppShell';
import { ChevronRight, Paperclip, Send, AtSign } from 'lucide-react';

const comments = [
  { id: 1, name: '山田一郎', init: '山', color: '#D97706', time: '06/01 14:23', body: 'カート機能の実装を確認しました。数量変更の処理はOKですが、在庫切れ時のエラーハンドリングを追加してください。', mentions: [], reactions: [{ emoji: '👍', count: 2 }] },
  { id: 2, name: '鈴木花子', init: '鈴', color: '#0284C7', time: '06/01 15:05', body: '@山田一郎 ご確認ありがとうございます！在庫切れ時のバリデーションを追加しました。再度ご確認をお願いします。', mentions: ['山田一郎'], reactions: [] },
  { id: 3, name: '田中太郎', init: '田', color: '#059669', time: '06/01 15:30', body: '@鈴木花子 エラーメッセージのコピーが英語のままになっています。日本語に修正してからマージをお願いします。', mentions: ['鈴木花子'], reactions: [{ emoji: '✅', count: 1 }] },
  { id: 4, name: '鈴木花子', init: '鈴', color: '#0284C7', time: '06/01 16:10', body: '対応完了しました！エラーメッセージを日本語化し、再プッシュしました。', mentions: [], reactions: [{ emoji: '🎉', count: 3 }, { emoji: '👍', count: 1 }] },
];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockComments() {
  return (
    <MockAppShell activePage="projects">
      <div style={s({ display: 'flex', height: '100%', overflow: 'hidden' })}>
        {/* Left: ticket list (narrow) */}
        <div style={s({ width: 200, background: '#F9FAFB', borderRight: '1px solid rgba(26,23,20,0.07)', padding: '10px 0', flexShrink: 0, overflow: 'hidden' })}>
          <div style={s({ padding: '0 10px 6px', fontSize: 9, fontWeight: 700, color: '#B0A9A4', textTransform: 'uppercase', letterSpacing: '0.05em' })}>スプリントチケット</div>
          {[
            { id: 'EC-0011', title: 'カート機能の実装', active: true, status: '進行中', sC: '#0284C7' },
            { id: 'EC-0012', title: 'ユーザー認証フロー', active: false, status: '未着手', sC: '#6B7280' },
            { id: 'EC-0013', title: '商品一覧ページネーション', active: false, status: '未着手', sC: '#6B7280' },
            { id: 'EC-0014', title: '決済API連携', active: false, status: '未着手', sC: '#6B7280' },
          ].map(t => (
            <div key={t.id} style={s({ padding: '6px 10px', cursor: 'pointer', background: t.active ? '#ECFDF5' : 'transparent', borderLeft: t.active ? '2px solid #059669' : '2px solid transparent' })}>
              <div style={s({ fontSize: 8, color: '#B0A9A4' })}>{t.id}</div>
              <div style={s({ fontSize: 9, fontWeight: t.active ? 700 : 500, color: t.active ? '#1A1714' : '#6B7280', lineHeight: 1.3 })}>{t.title}</div>
              <span style={s({ fontSize: 7, fontWeight: 600, color: t.sC })}>{t.status}</span>
            </div>
          ))}
        </div>

        {/* Right: ticket detail + comments */}
        <div style={s({ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FFFFFF' })}>
          {/* Breadcrumb */}
          <div style={s({ padding: '8px 14px', borderBottom: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center', gap: 4, fontSize: 9, color: '#B0A9A4' })}>
            <span style={s({ color: '#059669', fontWeight: 600 })}>ECサイトリニューアル</span>
            <ChevronRight style={{ width: 9, height: 9 }} />
            <span>EC-0011</span>
            <ChevronRight style={{ width: 9, height: 9 }} />
            <span>コメント</span>
          </div>

          {/* Ticket header */}
          <div style={s({ padding: '10px 14px', borderBottom: '1px solid rgba(26,23,20,0.06)' })}>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 })}>
              <span style={s({ fontSize: 8, color: '#B0A9A4' })}>EC-0011</span>
              <span style={s({ fontSize: 8, fontWeight: 700, color: '#0284C7', background: '#EFF6FF', borderRadius: 20, padding: '1px 6px' })}>進行中</span>
              <span style={s({ fontSize: 8, fontWeight: 700, color: '#DC2626', background: '#FEF2F2', borderRadius: 20, padding: '1px 6px' })}>優先度:高</span>
            </div>
            <div style={s({ fontSize: 13, fontWeight: 800, color: '#1A1714', marginBottom: 4 })}>カート機能のフロントエンド実装</div>
            <div style={s({ display: 'flex', alignItems: 'center', gap: 10, fontSize: 9, color: '#6B7280' })}>
              <span>担当: 鈴木花子</span>
              <span>期限: 06/08</span>
              <span>進捗: 40%</span>
            </div>
          </div>

          {/* Comments */}
          <div style={s({ flex: 1, overflow: 'hidden', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 })}>
            <div style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714' })}>コメント ({comments.length}件)</div>
            <div style={s({ display: 'flex', flexDirection: 'column', gap: 8, overflow: 'hidden' })}>
              {comments.map(c => (
                <div key={c.id} style={s({ display: 'flex', gap: 8 })}>
                  <div style={s({ width: 24, height: 24, borderRadius: 12, background: c.color, color: '#fff', fontSize: 8, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 })}>{c.init}</div>
                  <div style={s({ flex: 1, minWidth: 0 })}>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 })}>
                      <span style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714' })}>{c.name}</span>
                      <span style={s({ fontSize: 8, color: '#B0A9A4' })}>{c.time}</span>
                    </div>
                    <div style={s({ fontSize: 9, color: '#3D3732', background: '#F9FAFB', borderRadius: 8, padding: '6px 10px', lineHeight: 1.5 })}>
                      {c.body.split(/(@\S+)/g).map((part, i) =>
                        part.startsWith('@') ? (
                          <span key={i} style={s({ color: '#0284C7', fontWeight: 700, background: '#EFF6FF', borderRadius: 4, padding: '0 3px' })}>{part}</span>
                        ) : part
                      )}
                    </div>
                    {c.reactions.length > 0 && (
                      <div style={s({ display: 'flex', gap: 4, marginTop: 4 })}>
                        {c.reactions.map(r => (
                          <span key={r.emoji} style={s({ fontSize: 9, background: '#F4F5F6', borderRadius: 20, padding: '1px 6px', cursor: 'pointer' })}>{r.emoji} {r.count}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Comment input */}
          <div style={s({ padding: '8px 14px', borderTop: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center', gap: 8 })}>
            <div style={s({ width: 22, height: 22, borderRadius: 11, background: '#059669', color: '#fff', fontSize: 7, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>田</div>
            <div style={s({ flex: 1, background: '#F9FAFB', border: '1px solid rgba(26,23,20,0.10)', borderRadius: 8, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 })}>
              <span style={s({ fontSize: 9, color: '#C9C4BB', flex: 1 })}>コメントを入力... (@メンションで通知)</span>
              <AtSign style={{ width: 11, height: 11, color: '#B0A9A4' }} />
              <Paperclip style={{ width: 11, height: 11, color: '#B0A9A4' }} />
            </div>
            <button style={s({ width: 28, height: 28, borderRadius: 8, background: '#059669', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' })}>
              <Send style={{ width: 12, height: 12, color: '#fff' }} />
            </button>
          </div>
        </div>
      </div>
    </MockAppShell>
  );
}
