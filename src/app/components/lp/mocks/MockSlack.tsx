import { MockAppShell } from './MockAppShell';
import { Bell, CheckCircle, ExternalLink, RefreshCw } from 'lucide-react';

const channels = [
  { name: '#dev-general',    project: 'ECサイトリニューアル',  events: ['チケット更新', 'レビュー依頼', 'コメント'], active: true },
  { name: '#mobile-dev',     project: 'モバイルアプリ開発',    events: ['チケット更新', 'レビュー依頼'],             active: true },
  { name: '#system-updates', project: '社内システム改修',      events: ['チケット更新'],                             active: false },
];

const recentNotifications = [
  { channel: '#dev-general', type: 'レビュー依頼', title: 'EC-0011: カート機能の実装', user: '鈴木花子', time: '14:23', color: '#7C3AED' },
  { channel: '#dev-general', type: 'ステータス変更', title: 'EC-0009: ログイン画面改修', user: '田中太郎', time: '13:45', color: '#059669' },
  { channel: '#mobile-dev',  type: 'コメント追加', title: 'AP-0003: カートUIモバイル対応', user: '山田一郎', time: '12:30', color: '#0284C7' },
  { channel: '#dev-general', type: 'チケット作成', title: 'EC-0014: 決済APIインテグレーション', user: '伊藤美咲', time: '11:15', color: '#D97706' },
];

const s = (o: React.CSSProperties): React.CSSProperties => o;

export function MockSlack() {
  return (
    <MockAppShell activePage="settings">
      <div style={s({ padding: '12px 16px', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12, background: '#F9FAFB', boxSizing: 'border-box' })}>
        <div>
          <h1 style={s({ fontSize: 15, fontWeight: 800, color: '#1A1714', margin: 0 })}>Slack通知連携</h1>
          <p style={s({ fontSize: 9, color: '#B0A9A4', margin: '2px 0 0' })}>プロジェクトごとにSlackチャンネルと連携できます</p>
        </div>

        {/* Connection status */}
        <div style={s({ background: '#ECFDF5', border: '1px solid #059669', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 })}>
          <div style={s({ width: 32, height: 32, borderRadius: 8, background: '#4A154B', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
            <span style={s({ fontSize: 14 })}>S</span>
          </div>
          <div style={s({ flex: 1 })}>
            <div style={s({ fontSize: 10, fontWeight: 700, color: '#1A1714' })}>Slackワークスペース接続済み</div>
            <div style={s({ fontSize: 9, color: '#059669' })}>dev-team.slack.com · 接続済み</div>
          </div>
          <div style={s({ display: 'flex', alignItems: 'center', gap: 4 })}>
            <CheckCircle style={{ width: 14, height: 14, color: '#059669' }} />
            <span style={s({ fontSize: 9, fontWeight: 700, color: '#059669' })}>連携中</span>
          </div>
        </div>

        <div style={s({ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 10, flex: 1, minHeight: 0 })}>
          {/* Channels */}
          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
            <div style={s({ padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
              <span style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>通知チャンネル設定</span>
              <button style={s({ fontSize: 9, fontWeight: 600, color: '#059669', background: 'none', border: 'none', cursor: 'pointer' })}>+ チャンネル追加</button>
            </div>
            <div style={s({ flex: 1, overflow: 'hidden' })}>
              {channels.map((c, i) => (
                <div key={i} style={s({ padding: '10px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', display: 'flex', flexDirection: 'column', gap: 6 })}>
                  <div style={s({ display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
                    <div>
                      <div style={s({ display: 'flex', alignItems: 'center', gap: 6 })}>
                        <span style={s({ fontSize: 11, fontWeight: 700, color: '#4A154B' })}>{c.name}</span>
                        <span style={s({ fontSize: 8, color: '#B0A9A4' })}>{c.project}</span>
                      </div>
                    </div>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 6 })}>
                      <div style={s({ width: 28, height: 15, borderRadius: 8, background: c.active ? '#059669' : '#D1D5DB', position: 'relative', cursor: 'pointer' })}>
                        <div style={s({ width: 11, height: 11, borderRadius: 6, background: '#fff', position: 'absolute', top: 2, left: c.active ? 15 : 2, transition: 'left 0.2s' })} />
                      </div>
                    </div>
                  </div>
                  <div style={s({ display: 'flex', flexWrap: 'wrap', gap: 4 })}>
                    {c.events.map(ev => (
                      <span key={ev} style={s({ fontSize: 8, background: '#EFF6FF', color: '#0284C7', borderRadius: 20, padding: '1px 7px', fontWeight: 600 })}>{ev}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent notifications */}
          <div style={s({ background: '#FFFFFF', borderRadius: 10, border: '1px solid rgba(26,23,20,0.07)', overflow: 'hidden', display: 'flex', flexDirection: 'column' })}>
            <div style={s({ padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' })}>
              <span style={s({ fontSize: 11, fontWeight: 700, color: '#1A1714' })}>最近の通知</span>
              <RefreshCw style={{ width: 11, height: 11, color: '#B0A9A4', cursor: 'pointer' }} />
            </div>
            <div style={s({ flex: 1, overflow: 'hidden' })}>
              {recentNotifications.map((n, i) => (
                <div key={i} style={s({ padding: '8px 12px', borderBottom: '1px solid rgba(26,23,20,0.04)', display: 'flex', gap: 8 })}>
                  <div style={s({ width: 24, height: 24, borderRadius: 7, background: `${n.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 })}>
                    <Bell style={{ width: 11, height: 11, color: n.color }} />
                  </div>
                  <div style={s({ flex: 1, minWidth: 0 })}>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 })}>
                      <span style={s({ fontSize: 8, fontWeight: 700, color: n.color, background: `${n.color}15`, borderRadius: 20, padding: '0 5px' })}>{n.type}</span>
                      <span style={s({ fontSize: 8, color: '#B0A9A4' })}>{n.time}</span>
                    </div>
                    <div style={s({ fontSize: 9, fontWeight: 600, color: '#1A1714', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>{n.title}</div>
                    <div style={s({ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 })}>
                      <span style={s({ fontSize: 8, color: '#4A154B', fontWeight: 600 })}>{n.channel}</span>
                      <span style={s({ fontSize: 8, color: '#B0A9A4' })}>by {n.user}</span>
                    </div>
                  </div>
                  <ExternalLink style={{ width: 10, height: 10, color: '#C9C4BB', flexShrink: 0, marginTop: 2 }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MockAppShell>
  );
}
